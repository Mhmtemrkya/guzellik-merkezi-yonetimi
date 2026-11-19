using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// VERİTABANI İZLEME (kullanıcı isteği 19 Kas 2026: "veritabanları kısmı dinamik olsun"): Maydanoz panelinin okuduğu ölçüm
/// GERÇEK sunucudan gelir (MySQL/MariaDB), satır verisi taşımaz; yedek klasöründen yalnız dosyanın adı, zamanı ve boyutu
/// okunur. Bellek içi sağlayıcıda ölçüm yapılmadığı açıkça söylenir.
/// </summary>
public sealed class DatabaseMonitorMySqlTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("ba-dbmon-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private IHostEnvironment Env()
    {
        var env = Substitute.For<IHostEnvironment>();
        env.ContentRootPath.Returns(Path.Combine(_root, "release"));
        Directory.CreateDirectory(env.ContentRootPath);
        return env;
    }

    private static IConfiguration Config(params string[] directories) =>
        new ConfigurationBuilder().AddInMemoryCollection(
            directories.Select((dir, index) => new KeyValuePair<string, string?>($"DatabaseMonitor:BackupDirectories:{index}", dir))).Build();

    [MySqlFact]
    public async Task Snapshot_and_schema_come_from_the_real_server_without_row_data()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var backups = Path.Combine(_root, "backups");
        Directory.CreateDirectory(backups);
        await File.WriteAllBytesAsync(Path.Combine(backups, "pre-deploy-abc.sql.gz"), new byte[128]);
        await File.WriteAllTextAsync(Path.Combine(backups, "notlar.txt"), "yedek değil");
        File.SetLastWriteTimeUtc(Path.Combine(backups, "pre-deploy-abc.sql.gz"), new DateTime(2026, 11, 18, 22, 56, 0, DateTimeKind.Utc));

        await using var db = database.NewContext();
        var sut = new DatabaseMonitor(db, Config("../backups", Path.Combine(_root, "yok")), Env(), NullLogger<DatabaseMonitor>.Instance);

        var snapshot = await sut.SnapshotAsync();
        Assert.True(snapshot.Supported);
        Assert.Contains(snapshot.Engine, new[] { "MySQL", "MariaDB" });
        Assert.False(string.IsNullOrWhiteSpace(snapshot.Version));
        Assert.StartsWith("guzellik_it_", snapshot.Database);
        Assert.True(snapshot.MaxConnections > 0);
        Assert.NotNull(snapshot.Counters);
        Assert.True(snapshot.Counters!.Questions > 0);
        Assert.True(snapshot.Counters.UptimeSeconds > 0);
        Assert.True(snapshot.Counters.ThreadsConnected >= 1);
        Assert.True(snapshot.ProbeMs >= 0);
        Assert.Contains(snapshot.Tables, table => table.Name.Equals("Tenants", StringComparison.OrdinalIgnoreCase));
        Assert.All(snapshot.Tables, table => Assert.True(table.DataBytes >= 0 && table.IndexBytes >= 0 && table.Rows >= 0));

        // Yedek klasörü: yalnız .sql/.sql.gz; tanımlı ama olmayan klasör listeyi bozmaz.
        Assert.Equal("ok", snapshot.Backups.State);
        var backup = Assert.Single(snapshot.Backups.Items);
        Assert.Equal(("pre-deploy-abc.sql.gz", 128L, new DateTime(2026, 11, 18, 22, 56, 0, DateTimeKind.Utc)), (backup.Name, backup.SizeBytes, backup.AtUtc));
        Assert.Empty(snapshot.Backups.Unreadable);

        var schema = await sut.SchemaAsync();
        Assert.True(schema.Supported);
        var tenants = schema.Tables.Single(table => table.Name.Equals("Tenants", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(tenants.Indexes, index => index.Primary && index.Unique);
        Assert.Contains(tenants.Columns, column => column.Name == "Id" && column.Key == "PRI" && !column.Nullable);
        Assert.StartsWith("CREATE TABLE", tenants.Ddl);
        Assert.Contains(schema.Tables, table => table.ForeignKeys.Count > 0);
    }

    [Fact]
    public async Task Without_a_relational_database_nothing_is_measured_and_it_says_so()
    {
        var options = new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new GuzellikDbContext(options);
        var sut = new DatabaseMonitor(db, Config(), Env(), NullLogger<DatabaseMonitor>.Instance);

        var snapshot = await sut.SnapshotAsync();
        Assert.False(snapshot.Supported);
        Assert.Null(snapshot.Counters);
        Assert.Empty(snapshot.Tables);
        // Varsayılan klasörler (gece yedeği + ../backups) bu makinede yok.
        Assert.Equal("missing", snapshot.Backups.State);
        Assert.False((await sut.SchemaAsync()).Supported);
        Assert.Equal(2, sut.BackupDirectories().Count);
    }

    [Fact]
    public void Host_load_comes_from_proc_and_a_broken_file_does_not_break_the_reading()
    {
        var proc = Path.Combine(_root, "proc");
        Directory.CreateDirectory(proc);
        File.WriteAllText(Path.Combine(proc, "loadavg"), $"{Environment.ProcessorCount * 0.5:0.00} 0.40 0.30 1/200 12345".Replace(',', '.'));
        File.WriteAllLines(Path.Combine(proc, "meminfo"), ["MemTotal:       1000 kB", "MemFree:         100 kB", "MemAvailable:    250 kB", "Bozuk satır"]);

        var host = HostReader.Read(_root, proc)!;
        Assert.Equal(50, host.CpuPercent);
        Assert.Equal(75, host.MemoryPercent);
        Assert.Equal(Environment.ProcessorCount, host.CpuCount);
        Assert.NotNull(host.DiskPercent);

        File.WriteAllText(Path.Combine(proc, "loadavg"), "bozuk");
        var broken = HostReader.Read(_root, proc)!;
        Assert.Null(broken.CpuPercent);
        Assert.NotNull(broken.DiskPercent);
    }

    [Fact]
    public void Engine_name_is_read_from_the_version()
    {
        Assert.Equal("MariaDB", DatabaseMonitor.EngineOf("10.6.23-MariaDB-0ubuntu0.22.04.1"));
        Assert.Equal("MySQL", DatabaseMonitor.EngineOf("8.4.3"));
        Assert.Equal("MySQL", DatabaseMonitor.EngineOf(null));
    }
}
