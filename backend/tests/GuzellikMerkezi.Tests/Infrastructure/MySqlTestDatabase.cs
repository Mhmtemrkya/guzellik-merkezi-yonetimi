using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// GERÇEK MySQL/MariaDB üzerinde çalışan testler için tek kullanımlık veritabanı.
///
/// <para>
/// Neden gerekli: InMemory sağlayıcı transaction, <c>SELECT ... FOR UPDATE</c> ve gerçek cascade
/// delete davranışını TAKLİT ETMEZ. İptal akışının en pahalı hataları (eşzamanlı iptalde kaybolan
/// tahsilat, yarım kalan arşivleme, silinen satırın raporlardan düşmesi) yalnız ilişkisel
/// veritabanında görünür — birim testleri bunları yapısal olarak yakalayamaz.
/// </para>
///
/// <para>
/// Bağlantı <c>GUZELLIK_TEST_MYSQL</c> ortam değişkeninden okunur (veritabanı adı YAZILMAZ; her test
/// kendi geçici şemasını kurar ve sonunda düşürür). Değişken yoksa ya da sunucuya erişilemiyorsa
/// testler ATLANIR — geliştirici yerelde veritabanı kurmak zorunda kalmasın.
/// </para>
///
/// <para>
/// CI'DA ATLAMA YOKTUR: <c>GUZELLIK_TEST_MYSQL_REQUIRED=1</c> ile atlama kapatılır. Bu kural
/// olmadan yanlış bir bağlantı dizesi ya da ayağa kalkmayan bir servis kabı 78 testi sessizce
/// eleyip kapıyı yeşil bırakıyordu; oysa transaction / satır kilidi / MariaDB lehçesi YALNIZ
/// burada doğrulanıyor.
/// </para>
///
/// <example>
/// PowerShell:
/// <code>$env:GUZELLIK_TEST_MYSQL = "server=localhost;port=3306;user=root;password=***;AllowPublicKeyRetrieval=true;SslMode=Disabled;"</code>
/// </example>
/// </summary>
public sealed class MySqlTestDatabase : IAsyncDisposable
{
    private const string EnvVar = "GUZELLIK_TEST_MYSQL";

    /// <summary>
    /// "GERÇEK VERİTABANI TESTLERİ ZORUNLU" bayrağı (CI bunu 1 yapar).
    ///
    /// <para>
    /// SOMUT AÇIK: atlama davranışı geliştirici makinesi için doğruydu ama CI'da SESSİZ bir boşluk
    /// üretiyordu — sunucu yoksa (ya da bağlantı dizesi yanlışsa) 78 test atlanıyor, kapı yine de
    /// YEŞİL yanıyordu. Transaction, <c>SELECT … FOR UPDATE</c> ve MariaDB lehçesi yalnız bu
    /// testlerde doğrulandığı için, CI "geçti" derken riskli yolların HİÇBİRİ denenmemiş oluyordu.
    /// Bayrak açıkken sunucuya erişilemezse test ATLANMAZ, PATLAR: yapılandırma hatası deploy'a
    /// değil, PR'a düşer.
    /// </para>
    /// </summary>
    private const string RequiredEnvVar = "GUZELLIK_TEST_MYSQL_REQUIRED";

    private static readonly Lazy<string?> ServerConnection = new(ProbeServer);
    private static readonly Lazy<string?> ProbeFailure = new(() => _probeError);
    private static string? _probeError;

    /// <summary>Sunucuya bağlanılabiliyor mu (test keşfi sırasında bir kez ölçülür).</summary>
    public static bool Available => ServerConnection.Value is not null;

    /// <summary>Gerçek veritabanı testleri ZORUNLU mu (CI)? Zorunluysa atlama yapılmaz.</summary>
    public static bool Required =>
        Environment.GetEnvironmentVariable(RequiredEnvVar) is { } v
        && (v == "1" || string.Equals(v, "true", StringComparison.OrdinalIgnoreCase));

    public static string SkipReason =>
        $"Gerçek veritabanı testi atlandı: {EnvVar} tanımlı değil ya da sunucuya erişilemiyor.";

    /// <summary>
    /// Zorunlu moddayken sunucuya erişilemiyorsa fırlatılacak hata. Sebebi de taşır: "değişken yok"
    /// ile "sunucu ayakta değil" farklı yapılandırma hatalarıdır.
    /// </summary>
    public static Exception RequiredButUnavailable() => new InvalidOperationException(
        $"{RequiredEnvVar} açık ama gerçek veritabanına bağlanılamadı; testler ATLANAMAZ. " +
        $"Sebep: {ProbeFailure.Value ?? $"{EnvVar} tanımlı değil"}. " +
        "CI'da bu, veritabanı servisinin ayağa kalkmadığı ya da bağlantı dizesinin yanlış olduğu anlamına gelir.");

    private static string? ProbeServer()
    {
        var raw = Environment.GetEnvironmentVariable(EnvVar);
        if (string.IsNullOrWhiteSpace(raw))
        {
            _probeError = $"{EnvVar} tanımlı değil";
            return null;
        }

        try
        {
            // Testler UYGULAMA İLE AYNI bağlantı kurallarını kullanmalı; aksi hâlde karakter seti
            // gibi bir kusur yalnız bazı makinelerde görünür (bkz. MySqlConnectionStrings).
            var builder = new MySqlConnectionStringBuilder(MySqlConnectionStrings.EnsureUtf8Mb4(raw))
            {
                Database = string.Empty,
                // CI'da servis kabı birkaç saniye gecikebilir; yerelde "sunucu yok" kararı hızlı olsun.
                ConnectionTimeout = Required ? (uint)30 : 3,
            };
            using var connection = new MySqlConnection(builder.ConnectionString);
            connection.Open();
            return builder.ConnectionString;
        }
        catch (Exception ex)
        {
            _probeError = ex.Message;
            return null;
        }
    }

    private readonly string _database;
    private readonly string _connectionString;

    private MySqlTestDatabase(string database, string connectionString)
    {
        _database = database;
        _connectionString = connectionString;
    }

    /// <summary>Ham bağlantı dizesi — EF dışı yollar (deploy betiği çalıştırma) için.</summary>
    public string ConnectionString => _connectionString;

    /// <summary>
    /// BOŞ bir şema oluşturur; model UYGULANMAZ. Migration zincirinin kendisini test etmek için:
    /// <c>EnsureCreated</c> şemayı modelden kurar ve migration geçmişi yazmaz, dolayısıyla gerçek
    /// "yeni kurulum" senaryosunu göstermez.
    /// </summary>
    public static async Task<MySqlTestDatabase> CreateEmptyAsync()
    {
        // Zorunlu modda hatanın SEBEBİ görünmeli: "servis kalkmadı" ile "değişken yok" farklı
        // yapılandırma hatalarıdır ve CI çıktısında ayırt edilebilmeleri gerekir.
        var server = ServerConnection.Value
                     ?? throw (Required
                         ? RequiredButUnavailable()
                         : new InvalidOperationException("Sunucuya erişilemiyor; MySqlFact ile korunmalıydı."));

        var database = $"guzellik_mig_{Guid.NewGuid():N}"[..40];
        await using (var connection = new MySqlConnection(server))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await command.ExecuteNonQueryAsync();
        }

        var builder = new MySqlConnectionStringBuilder(server) { Database = database };
        return new MySqlTestDatabase(database, builder.ConnectionString);
    }

    /// <summary>Boş bir şema oluşturur ve modeli uygular (migration zinciri değil — hızlı olsun).</summary>
    public static async Task<MySqlTestDatabase> CreateAsync()
    {
        // Zorunlu modda hatanın SEBEBİ görünmeli: "servis kalkmadı" ile "değişken yok" farklı
        // yapılandırma hatalarıdır ve CI çıktısında ayırt edilebilmeleri gerekir.
        var server = ServerConnection.Value
                     ?? throw (Required
                         ? RequiredButUnavailable()
                         : new InvalidOperationException("Sunucuya erişilemiyor; MySqlFact ile korunmalıydı."));

        var database = $"guzellik_it_{Guid.NewGuid():N}"[..40];
        await using (var connection = new MySqlConnection(server))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await command.ExecuteNonQueryAsync();
        }

        var builder = new MySqlConnectionStringBuilder(server) { Database = database };
        var db = new MySqlTestDatabase(database, builder.ConnectionString);

        await using var ctx = db.NewContext();
        await ctx.Database.EnsureCreatedAsync();
        return db;
    }

    /// <summary>Her çağrı YENİ bir DbContext döner — eşzamanlılık testleri ayrı bağlantı ister.</summary>
    public GuzellikDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseMySQL(_connectionString)
            .Options;
        return new GuzellikDbContext(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());
    }

    /// <summary>
    /// Açılış işleri (<c>DatabaseBootstrap</c>) <c>IServiceProvider</c> alır ve kendi scope'unu açar.
    /// Her scope AYRI bir DbContext (ve bağlantı) alır — iki backend örneğinin aynı anda açılması
    /// böyle taklit edilir. Fabrika açıkça verilir; DI'nın ctor'u kendi çözmesine gerek yok.
    /// </summary>
    public ServiceProvider NewServiceProvider() =>
        new ServiceCollection()
            .AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance)
            .AddScoped(_ => NewContext())
            .BuildServiceProvider();

    public async ValueTask DisposeAsync()
    {
        try
        {
            var builder = new MySqlConnectionStringBuilder(_connectionString) { Database = string.Empty };
            await using var connection = new MySqlConnection(builder.ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"DROP DATABASE IF EXISTS `{_database}`;";
            await command.ExecuteNonQueryAsync();
        }
        catch
        {
            // Temizlik başarısız olsa da test sonucunu bozmasın (geçici şema, adı benzersiz).
        }
    }
}

/// <summary>
/// Yalnız erişilebilir bir MySQL/MariaDB varken çalışan test.
///
/// <para>
/// Geliştirici makinesinde sunucu yoksa test ATLANIR (kimse yerelde veritabanı kurmak zorunda
/// kalmasın). CI'da ise <c>GUZELLIK_TEST_MYSQL_REQUIRED=1</c> ile atlama KAPATILIR: sunucuya
/// erişilemiyorsa test atlanmaz, başarısız olur. Aksi hâlde yanlış bir bağlantı dizesi ya da
/// ayağa kalkmayan bir servis kabı, 78 testi sessizce eleyip kapıyı yeşil bırakırdı.
/// </para>
/// </summary>
public sealed class MySqlFactAttribute : FactAttribute
{
    public MySqlFactAttribute()
    {
        if (MySqlTestDatabase.Available) return;
        // ZORUNLU MODDA ATLAMA YOK: Skip boş bırakılır, test gövdesi ilk çağrıda patlar
        // (bkz. MySqlTestDatabase.CreateAsync → RequiredButUnavailable).
        if (!MySqlTestDatabase.Required) Skip = MySqlTestDatabase.SkipReason;
    }
}
