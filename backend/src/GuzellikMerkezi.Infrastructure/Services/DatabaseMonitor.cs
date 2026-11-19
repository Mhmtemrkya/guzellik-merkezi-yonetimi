using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Features.PlatformOps;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// VERİTABANI İZLEME (kullanıcı isteği 19 Kas 2026: "Maydanoz'un veritabanları kısmı dinamik olsun"). Maydanoz panelinin
/// Veritabanları ekranı platform köprüsünden (<c>GET /api/platform/system/database[/schema]</c>) bunu okur.
/// <para>
/// SALT OKUNUR ve SATIR VERİSİZ: yalnız sürüm, <c>information_schema</c> boyutları, <c>SHOW GLOBAL STATUS</c> sayaçları,
/// şema (kolon/indeks/dış anahtar/DDL), sunucu yükü (<c>/proc</c>) ve yedek DOSYALARININ adı/zamanı/boyutu okunur. Hiçbir
/// tablonun satırı okunmaz. MySQL 8 ve MariaDB 10.6 (canlı) ile çalışır; bir bölüm okunamazsa (ör. performance_schema
/// yetkisi) o bölüm boş döner, ölçümün geri kalanı bozulmaz.
/// </para>
/// </summary>
public sealed partial class DatabaseMonitor(GuzellikDbContext db, IConfiguration config, IHostEnvironment env, ILogger<DatabaseMonitor> logger) : IDatabaseMonitor
{
    /// <summary>Canlının yedek klasörleri: gece yedeği ve yayın öncesi yedekler. <c>DatabaseMonitor:BackupDirectories</c> ile değişir.</summary>
    public static readonly string[] DefaultBackupDirectories = ["/var/backups/beautyasist/database", "../backups"];

    public const int MaxBackups = 40;

    private static readonly string[] CounterNames =
    [
        "Uptime", "Threads_connected", "Threads_running", "Max_used_connections", "Questions", "Slow_queries",
        "Aborted_connects", "Com_select", "Com_insert", "Com_update", "Com_delete",
    ];

    [GeneratedRegex("^[A-Za-z0-9_$]{1,64}$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex SafeIdentifier();

    public async Task<DatabaseSnapshotDto> SnapshotAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var backups = ReadBackups(BackupDirectories());
        var host = HostReader.Read(env.ContentRootPath);
        if (!db.Database.IsRelational())
        {
            return new DatabaseSnapshotDto(false, db.Database.ProviderName ?? "?", null, null, now, 0, 0, null, [], null, host, backups);
        }

        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var watch = Stopwatch.StartNew();
            await ScalarAsync(connection, "SELECT 1", ct);
            var probeMs = Math.Round(watch.Elapsed.TotalMilliseconds, 2);

            var (version, database, offset) = await IdentityAsync(connection, ct);
            var status = await PairsAsync(connection, $"SHOW GLOBAL STATUS WHERE Variable_name IN ({string.Join(", ", CounterNames.Select(name => $"'{name}'"))})", ct);
            var maxConnections = ToLong(await ScalarAsync(connection, "SELECT @@max_connections", ct));
            long Counter(string name) => status.TryGetValue(name, out var value) ? ToLong(value) : 0;
            var counters = new DatabaseCountersDto(
                Counter("Uptime"), Counter("Threads_connected"), Counter("Threads_running"), Counter("Max_used_connections"),
                Counter("Questions"), Counter("Slow_queries"), Counter("Aborted_connects"),
                Counter("Com_select"), Counter("Com_insert"), Counter("Com_update"), Counter("Com_delete"));

            // MySQL 8 tablo istatistiklerini 24 saate kadar önbellekler; oturumda kapatılır (MariaDB'de değişken yoktur).
            await TryExecuteAsync(connection, "SET SESSION information_schema_stats_expiry = 0", ct);
            var tables = await TablesAsync(connection, offset, ct);
            var io = await TableIoAsync(connection, ct);
            return new DatabaseSnapshotDto(true, EngineOf(version), version, database, now, probeMs, maxConnections, counters, tables, io, host, backups);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public async Task<DatabaseSchemaDto> SchemaAsync(CancellationToken ct = default)
    {
        if (!db.Database.IsRelational())
        {
            return new DatabaseSchemaDto(false, db.Database.ProviderName ?? "?", null, null, []);
        }

        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            var (version, database, _) = await IdentityAsync(connection, ct);
            var columns = await RowsAsync(connection,
                "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY " +
                "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION", ct);
            var indexes = await RowsAsync(connection,
                "SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS " +
                "WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX", ct);
            var keys = await RowsAsync(connection,
                "SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE " +
                "WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION", ct);
            var names = (await RowsAsync(connection,
                    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", ct))
                .Select(row => Text(row[0])).ToList();

            var tables = new List<DatabaseSchemaTableDto>(names.Count);
            foreach (var name in names)
            {
                tables.Add(new DatabaseSchemaTableDto(
                    name,
                    columns.Where(row => Text(row[0]) == name).Select(row => new DatabaseColumnDto(
                        Text(row[1]), Text(row[2]), Text(row[3]), Text(row[4]) == "YES", NullableText(row[5]), NullableText(row[6]), NullableText(row[7]))).ToList(),
                    indexes.Where(row => Text(row[0]) == name).GroupBy(row => Text(row[1]), StringComparer.Ordinal)
                        .Select(group => new DatabaseIndexDto(group.Key, group.Select(row => Text(row[2])).ToList(), ToLong(group.First()[3]) == 0, group.Key == "PRIMARY")).ToList(),
                    keys.Where(row => Text(row[0]) == name)
                        .Select(row => new DatabaseForeignKeyDto(Text(row[1]), Text(row[2]), Text(row[3]), Text(row[4]))).ToList(),
                    await DdlAsync(connection, name, ct)));
            }

            return new DatabaseSchemaDto(true, EngineOf(version), version, database, tables);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    public IReadOnlyList<string> BackupDirectories()
    {
        var configured = config.GetSection("DatabaseMonitor:BackupDirectories").Get<string[]>();
        var list = configured is { Length: > 0 } ? configured : DefaultBackupDirectories;
        return list.Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(env.ContentRootPath, path)))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Yedek dosyaları (<c>.sql</c>, <c>.sql.gz</c>): en yeni önce. İçerik OKUNMAZ; yalnız ad, zaman ve boyut.</summary>
    public static DatabaseBackupsDto ReadBackups(IReadOnlyList<string> directories)
    {
        var items = new List<DatabaseBackupDto>();
        var unreadable = new List<string>();
        var found = 0;
        foreach (var directory in directories)
        {
            if (!Directory.Exists(directory))
            {
                continue;
            }

            found++;
            try
            {
                foreach (var file in new DirectoryInfo(directory).EnumerateFiles())
                {
                    if (file.Name.EndsWith(".sql.gz", StringComparison.OrdinalIgnoreCase) || file.Name.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
                    {
                        items.Add(new DatabaseBackupDto(file.Name, directory, file.LastWriteTimeUtc, file.Length));
                    }
                }
            }
            catch (Exception error) when (error is UnauthorizedAccessException or IOException)
            {
                unreadable.Add(directory);
            }
        }

        var state = found == 0 ? "missing" : unreadable.Count == found ? "unreadable" : "ok";
        return new DatabaseBackupsDto(state, items.OrderByDescending(item => item.AtUtc).Take(MaxBackups).ToList(), unreadable);
    }

    public static string EngineOf(string? version) =>
        version is not null && version.Contains("MariaDB", StringComparison.OrdinalIgnoreCase) ? "MariaDB" : "MySQL";

    /// <summary>Sürüm, veritabanı adı ve oturum saat diliminin UTC'ye farkı (UPDATE_TIME sunucunun yerel saatidir).</summary>
    private static async Task<(string? Version, string? Database, long OffsetSeconds)> IdentityAsync(DbConnection connection, CancellationToken ct)
    {
        var row = (await RowsAsync(connection, "SELECT VERSION(), DATABASE(), TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())", ct)).Single();
        return (NullableText(row[0]), NullableText(row[1]), ToLong(row[2]));
    }

    private static async Task<IReadOnlyList<DatabaseTableStatDto>> TablesAsync(DbConnection connection, long offsetSeconds, CancellationToken ct) =>
        (await RowsAsync(connection,
            "SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, ENGINE, UPDATE_TIME FROM information_schema.TABLES " +
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", ct))
        .Select(row => new DatabaseTableStatDto(
            Text(row[0]), ToLong(row[1]), ToLong(row[2]), ToLong(row[3]), NullableText(row[4]),
            row[5] is DateTime updated ? DateTime.SpecifyKind(updated.AddSeconds(-offsetSeconds), DateTimeKind.Utc) : null))
        .ToList();

    /// <summary>Tablo G/Ç sayaçları — performance_schema yetkisi ya da özelliği yoksa null (ekran "ölçülmüyor" der).</summary>
    private async Task<IReadOnlyList<DatabaseTableIoDto>?> TableIoAsync(DbConnection connection, CancellationToken ct)
    {
        try
        {
            var rows = await RowsAsync(connection,
                "SELECT OBJECT_NAME, COUNT_FETCH, COUNT_INSERT, COUNT_UPDATE, COUNT_DELETE FROM performance_schema.table_io_waits_summary_by_table " +
                "WHERE OBJECT_SCHEMA = DATABASE() AND OBJECT_TYPE = 'TABLE'", ct);
            return rows.Count == 0 ? null : rows.Select(row => new DatabaseTableIoDto(Text(row[0]), ToLong(row[1]), ToLong(row[2]), ToLong(row[3]), ToLong(row[4]))).ToList();
        }
        catch (DbException error)
        {
            logger.LogDebug("performance_schema okunamadı ({Code}).", error.ErrorCode);
            return null;
        }
    }

    private static async Task<string?> DdlAsync(DbConnection connection, string table, CancellationToken ct)
    {
        if (!SafeIdentifier().IsMatch(table))
        {
            return null;
        }

        var row = (await RowsAsync(connection, $"SHOW CREATE TABLE `{table}`", ct)).SingleOrDefault();
        return row is { Length: > 1 } ? NullableText(row[1]) : null;
    }

    private static async Task TryExecuteAsync(DbConnection connection, string sql, CancellationToken ct)
    {
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync(ct);
        }
        catch (DbException)
        {
            // Değişkeni olmayan motor (MariaDB): önbellek zaten yoktur.
        }
    }

    private static async Task<object?> ScalarAsync(DbConnection connection, string sql, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return await command.ExecuteScalarAsync(ct);
    }

    private static async Task<Dictionary<string, object?>> PairsAsync(DbConnection connection, string sql, CancellationToken ct) =>
        (await RowsAsync(connection, sql, ct)).ToDictionary(row => Text(row[0]), row => row[1], StringComparer.OrdinalIgnoreCase);

    private static async Task<List<object?[]>> RowsAsync(DbConnection connection, string sql, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync(CommandBehavior.Default, ct);
        var rows = new List<object?[]>();
        while (await reader.ReadAsync(ct))
        {
            var values = new object?[reader.FieldCount];
            for (var index = 0; index < reader.FieldCount; index++)
            {
                values[index] = await reader.IsDBNullAsync(index, ct) ? null : reader.GetValue(index);
            }

            rows.Add(values);
        }

        return rows;
    }

    private static string Text(object? value) => value switch
    {
        null => string.Empty,
        byte[] bytes => System.Text.Encoding.UTF8.GetString(bytes),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
    };

    private static string? NullableText(object? value) => value is null ? null : Text(value);

    private static long ToLong(object? value) =>
        value is null ? 0 : long.TryParse(Text(value), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
}

/// <summary>Sunucu yükü: Linux'ta <c>/proc</c>; disk her işletim sisteminde içerik kökünün sürücüsünden.</summary>
public static class HostReader
{
    public static DatabaseHostDto? Read(string contentRoot, string procRoot = "/proc")
    {
        var cpuCount = Environment.ProcessorCount;
        double? load = null;
        double? cpu = null;
        double? memory = null;
        try
        {
            var loadPath = Path.Combine(procRoot, "loadavg");
            if (File.Exists(loadPath))
            {
                var first = File.ReadAllText(loadPath).Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
                load = double.Parse(first, CultureInfo.InvariantCulture);
                cpu = Math.Round(Math.Min(100, load.Value / Math.Max(1, cpuCount) * 100), 1);
            }

            var memoryPath = Path.Combine(procRoot, "meminfo");
            if (File.Exists(memoryPath))
            {
                var values = File.ReadAllLines(memoryPath)
                    .Select(line => line.Split(':', 2))
                    .Where(parts => parts.Length == 2)
                    .ToDictionary(parts => parts[0].Trim(), parts => long.TryParse(parts[1].Trim().Split(' ')[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var kb) ? kb : 0, StringComparer.Ordinal);
                if (values.TryGetValue("MemTotal", out var total) && total > 0 && values.TryGetValue("MemAvailable", out var available))
                {
                    memory = Math.Round((total - available) * 100.0 / total, 1);
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or FormatException or IndexOutOfRangeException)
        {
            // Okunamayan bölüm null kalır; ölçüm bozulmaz.
        }

        double? disk = null;
        long? diskTotal = null;
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(contentRoot));
            if (!string.IsNullOrEmpty(root))
            {
                var drive = new DriveInfo(root);
                if (drive.IsReady && drive.TotalSize > 0)
                {
                    diskTotal = drive.TotalSize;
                    disk = Math.Round((drive.TotalSize - drive.AvailableFreeSpace) * 100.0 / drive.TotalSize, 1);
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            // Disk bilgisi alınamadı.
        }

        return load is null && memory is null && disk is null ? null : new DatabaseHostDto(cpu, load, cpuCount, memory, disk, diskTotal);
    }
}
