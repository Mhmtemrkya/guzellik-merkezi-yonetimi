namespace GuzellikMerkezi.Application.Features.PlatformOps;

/// <summary>Bir tablonun boyutu: satır sayısı motorun tahminidir (InnoDB), boyutlar bayttır.</summary>
public sealed record DatabaseTableStatDto(string Name, long Rows, long DataBytes, long IndexBytes, string? Engine, DateTime? UpdatedAtUtc);

/// <summary>
/// Sunucunun BİRİKİMLİ sayaçları (<c>SHOW GLOBAL STATUS</c>): saniyedeki sorgu gibi oranları okuyan taraf iki ölçümün
/// farkından hesaplar. Sunucu yeniden başlarsa sayaçlar sıfırlanır (<see cref="UptimeSeconds"/> küçülür).
/// </summary>
public sealed record DatabaseCountersDto(
    long UptimeSeconds,
    long ThreadsConnected,
    long ThreadsRunning,
    long MaxUsedConnections,
    long Questions,
    long SlowQueries,
    long AbortedConnects,
    long ComSelect,
    long ComInsert,
    long ComUpdate,
    long ComDelete);

/// <summary>Tablonun birikimli G/Ç sayaçları (performance_schema); erişim yoksa hiç gönderilmez.</summary>
public sealed record DatabaseTableIoDto(string Name, long Reads, long Inserts, long Updates, long Deletes);

/// <summary>Sunucunun yükü: CPU = 1 dk yük ortalaması ÷ çekirdek; bellek ve disk doluluk yüzdesi. Okunamayan alan null.</summary>
public sealed record DatabaseHostDto(double? CpuPercent, double? LoadAverage, int CpuCount, double? MemoryPercent, double? DiskPercent, long? DiskTotalBytes);

/// <summary>Bir yedek dosyası: yalnız adı, zamanı ve boyutu (içeriği okunmaz).</summary>
public sealed record DatabaseBackupDto(string Name, string Folder, DateTime AtUtc, long SizeBytes);

/// <summary>
/// Yedeklerin durumu: <c>ok</c> (klasör okundu), <c>missing</c> (tanımlı klasör yok), <c>unreadable</c> (izin yok).
/// Birden çok klasör varsa en kötü durum değil, OKUNAN klasörlerin listesi döner; okunamayan her klasör ayrıca yazılır.
/// </summary>
public sealed record DatabaseBackupsDto(string State, IReadOnlyList<DatabaseBackupDto> Items, IReadOnlyList<string> Unreadable);

/// <summary>
/// VERİTABANI ANLIK ÖLÇÜMÜ (kullanıcı isteği 19 Kas 2026: "veritabanları kısmı dinamik olsun"). Satır verisi TAŞIMAZ:
/// sürüm, boyutlar, tablolar, bağlantılar, birikimli sayaçlar, sunucu yükü ve yedek dosyalarının adı/zamanı/boyutu.
/// <see cref="Supported"/> false ise (ör. bellek içi test sağlayıcısı) ölçüm yapılmamıştır.
/// </summary>
public sealed record DatabaseSnapshotDto(
    bool Supported,
    string Engine,
    string? Version,
    string? Database,
    DateTime SampledAtUtc,
    double ProbeMs,
    long MaxConnections,
    DatabaseCountersDto? Counters,
    IReadOnlyList<DatabaseTableStatDto> Tables,
    IReadOnlyList<DatabaseTableIoDto>? TableIo,
    DatabaseHostDto? Host,
    DatabaseBackupsDto Backups);

public sealed record DatabaseColumnDto(string Name, string Type, string DataType, bool Nullable, string? Default, string? Extra, string? Key);

public sealed record DatabaseIndexDto(string Name, IReadOnlyList<string> Columns, bool Unique, bool Primary);

public sealed record DatabaseForeignKeyDto(string Name, string Column, string RefTable, string RefColumn);

public sealed record DatabaseSchemaTableDto(
    string Name,
    IReadOnlyList<DatabaseColumnDto> Columns,
    IReadOnlyList<DatabaseIndexDto> Indexes,
    IReadOnlyList<DatabaseForeignKeyDto> ForeignKeys,
    string? Ddl);

/// <summary>Şema: kolonlar, indeksler, dış anahtarlar ve salt okunur DDL. Değer taşımaz.</summary>
public sealed record DatabaseSchemaDto(bool Supported, string Engine, string? Version, string? Database, IReadOnlyList<DatabaseSchemaTableDto> Tables);

/// <summary>Platformun kendi veritabanını izler (salt okunur; satır verisine dokunmaz).</summary>
public interface IDatabaseMonitor
{
    Task<DatabaseSnapshotDto> SnapshotAsync(CancellationToken ct = default);

    Task<DatabaseSchemaDto> SchemaAsync(CancellationToken ct = default);
}
