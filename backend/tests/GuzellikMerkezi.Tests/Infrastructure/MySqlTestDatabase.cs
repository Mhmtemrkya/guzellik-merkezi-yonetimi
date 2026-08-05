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
/// testler ATLANIR — CI'da MySQL servisi olmadan da yeşil kalır.
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

    private static readonly Lazy<string?> ServerConnection = new(ProbeServer);

    /// <summary>Sunucuya bağlanılabiliyor mu (test keşfi sırasında bir kez ölçülür).</summary>
    public static bool Available => ServerConnection.Value is not null;

    public static string SkipReason =>
        $"Gerçek veritabanı testi atlandı: {EnvVar} tanımlı değil ya da sunucuya erişilemiyor.";

    private static string? ProbeServer()
    {
        var raw = Environment.GetEnvironmentVariable(EnvVar);
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var builder = new MySqlConnectionStringBuilder(raw) { Database = string.Empty, ConnectionTimeout = 3 };
            using var connection = new MySqlConnection(builder.ConnectionString);
            connection.Open();
            return builder.ConnectionString;
        }
        catch
        {
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

    /// <summary>
    /// BOŞ bir şema oluşturur; model UYGULANMAZ. Migration zincirinin kendisini test etmek için:
    /// <c>EnsureCreated</c> şemayı modelden kurar ve migration geçmişi yazmaz, dolayısıyla gerçek
    /// "yeni kurulum" senaryosunu göstermez.
    /// </summary>
    public static async Task<MySqlTestDatabase> CreateEmptyAsync()
    {
        var server = ServerConnection.Value
                     ?? throw new InvalidOperationException("Sunucuya erişilemiyor; MySqlFact ile korunmalıydı.");

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
        var server = ServerConnection.Value
                     ?? throw new InvalidOperationException("Sunucuya erişilemiyor; MySqlFact ile korunmalıydı.");

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

/// <summary>Yalnız erişilebilir bir MySQL/MariaDB varken çalışan test — yoksa atlanır.</summary>
public sealed class MySqlFactAttribute : FactAttribute
{
    public MySqlFactAttribute()
    {
        if (!MySqlTestDatabase.Available) Skip = MySqlTestDatabase.SkipReason;
    }
}
