using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÖDEME YAPILANDIRMASI HAZIRLIK KAPISI.
///
/// <para>
/// Ödeme AÇIKKEN eksik/çelişkili ayar hiçbir yerde yakalanmıyordu: örnek trafiğe alınıyor, kusur
/// ancak ilk gerçek tahsilat denemesinde — yani MÜŞTERİ ÖDERKEN — ortaya çıkıyordu.
/// </para>
/// <para>
/// EN ÖNEMLİ DAVRANIŞ İSE KAPININ GEÇMESİ: üretim <c>PaymentsEnabled=0</c> ile çalışıyor. Kapalı
/// ödeme GEÇERLİ bir yapılandırmadır ve asla trafiği kesmemelidir. "Sıkı kapı" yazarken en kolay
/// yapılan hata, doğru yapılandırmayı da reddetmektir.
/// </para>
/// </summary>
public sealed class PaymentReadinessGateTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    /// <summary>ÜRETİM KODUNUN TA KENDİSİ çağrılır — kural iki yere yazılırsa saparlar.</summary>
    private static async Task<string?> IssueAsync(
        DbContextOptions<GuzellikDbContext> options, bool production)
    {
        await using var db = NewDb(options);
        return await PaymentConfigGate.DescribeAsync(db, production, CancellationToken.None);
    }

    private static async Task SeedAsync(
        DbContextOptions<GuzellikDbContext> options, Action<PlatformIntegrationSettings> configure)
    {
        await using var db = NewDb(options);
        var settings = new PlatformIntegrationSettings();
        configure(settings);
        db.PlatformIntegrationSettings.Add(settings);
        await db.SaveChangesAsync();
    }

    /// <summary>ÜRETİM YAPILANDIRMASI: ödeme kapalı → kapı GEÇER (bu test en kritik olanı).</summary>
    [Fact]
    public async Task OdemeKapaliyken_KapiGecer()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(false, "Iyzico", null, null, null, null));

        Assert.Null(await IssueAsync(options, production: true));
    }

    /// <summary>Ayar satırı hiç yoksa da kapı geçmeli — yeni kurulum trafiğe alınabilir.</summary>
    [Fact]
    public async Task AyarSatiriYokken_KapiGecer()
    {
        Assert.Null(await IssueAsync(NewOptions(), production: true));
    }

    /// <summary>Ödeme açık ama sağlayıcı anahtarları eksik → gerçek çekim İMKÂNSIZ.</summary>
    [Fact]
    public async Task OdemeAcikAmaAnahtarYok_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(
            true, "Iyzico", null, null, "https://api.iyzipay.com", "https://panel.test/donus"));

        var issue = await IssueAsync(options, production: true);
        Assert.NotNull(issue);
        Assert.Contains("anahtar", issue, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// ÜRETİMDE SİMÜLASYON = PARA ÇEKİLMEDEN ABONELİK. Sessizce "başarılı" dönen sağlayıcı
    /// abonelikleri bedavaya açardı; bunu ilk faturada değil deploy anında görmeliyiz.
    /// </summary>
    [Fact]
    public async Task UretimdeSimulasyonSaglayicisi_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(
            true, "Simulation", null, null, null, "https://panel.test/donus"));

        Assert.NotNull(await IssueAsync(options, production: true));
        // ÜRETİM DIŞINDA aynı yapılandırma MEŞRUDUR: geliştirici/test ortamı simülasyonla çalışır.
        Assert.Null(await IssueAsync(options, production: false));
    }

    /// <summary>Dönüş adresi olmadan checkout başlatılamaz; kapı bunu müşteriden önce söyler.</summary>
    [Fact]
    public async Task DonusAdresiYok_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(
            true, "Iyzico", "enc-key", "enc-secret", "https://api.iyzipay.com", null));

        var issue = await IssueAsync(options, production: true);
        Assert.NotNull(issue);
        Assert.Contains("dönüş", issue, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Üretimde düz HTTP sağlayıcı adresi kabul edilmez.</summary>
    [Fact]
    public async Task UretimdeHttpAdres_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(
            true, "Iyzico", "enc-key", "enc-secret", "http://api.iyzipay.com", "https://panel.test/donus"));

        Assert.NotNull(await IssueAsync(options, production: true));
        // Yerelde HTTP meşru — kapı geliştiriciyi engellemez.
        Assert.Null(await IssueAsync(options, production: false));
    }

    /// <summary>DOĞRU ÜRETİM YAPILANDIRMASI reddedilmemeli (kapı fazla sıkı olmasın).</summary>
    [Fact]
    public async Task TamVeDogruYapilandirma_KapiGecer()
    {
        var options = NewOptions();
        await SeedAsync(options, s => s.UpdatePayments(
            true, "Iyzico", "enc-key", "enc-secret", "https://api.iyzipay.com", "https://panel.test/donus"));

        Assert.Null(await IssueAsync(options, production: true));
    }
}
