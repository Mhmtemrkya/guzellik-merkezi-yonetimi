using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÖDEME SAĞLAYICI ADRESİ ALLOWLIST'İ — İSTEK YOLUNDA DA UYGULANIR.
///
/// <para>
/// SOMUT AÇIK: <c>OutboundEndpointGuard.ValidatePaymentApiUrl</c> yalnızca ayar KAYDEDİLİRKEN
/// çağrılıyordu. Gerçek HttpClient'ı kuran <see cref="PaymentGatewayResolver"/> ise kayıtlı
/// değere hiç bakmadan güveniyordu: yazma kapısını atlayan her yol (doğrudan veritabanı
/// düzenlemesi, kapı eklenmeden önce yazılmış satır, yedekten geri yükleme) kart referanslarını
/// ve tahsilat isteklerini SAHTE bir host'a gönderebilirdi.
/// </para>
/// <para>
/// Bu, deponun kendi öğrendiği kuralın tekrarı: aynı kural iki yere yazılırsa saparlar
/// (bkz. <c>PaymentConfigGate</c>). Burada saptığı yer, kuralın YALNIZ yazma yolunda olmasıydı.
/// </para>
/// </summary>
public sealed class PaymentHostAllowlistTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed class PassthroughEncryption : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    private sealed class StubHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    /// <summary>Ortam adı verilebilsin: sandbox reddi yalnız üretimde çalışır.</summary>
    private static PaymentGatewayResolver NewResolver(GuzellikDbContext db, string environment)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_ENVIRONMENT"] = environment,
                ["Jwt:SigningKey"] = "test-signing-key-that-is-long-enough-for-qa",
            })
            .Build();
        return new PaymentGatewayResolver(
            db, new PassthroughEncryption(), new StubHttpFactory(), config,
            NullLogger<PaymentGatewayResolver>.Instance);
    }

    /// <param name="baseUrl">Yazma kapısını ATLAYARAK doğrudan veritabanına yazılan adres.</param>
    private static async Task SeedAsync(DbContextOptions<GuzellikDbContext> options, string baseUrl)
    {
        await using var db = NewDb(options);
        var settings = new PlatformIntegrationSettings();
        settings.UpdatePayments(true, "Iyzico", "enc-key", "enc-secret", baseUrl, "https://panel.test/donus");
        db.PlatformIntegrationSettings.Add(settings);
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// ASIL İDDİA: allowlist DIŞI bir host kayıtlıysa çözücü checkout'u DURDURUR.
    /// Düzeltmeden önce bu yapılandırma sorunsuz bir gateway döndürüyordu.
    /// </summary>
    [Theory]
    [InlineData("https://evil.example.com")]          // saldırganın host'u
    [InlineData("https://api.iyzipay.com.evil.test")] // allowlist'i taklit eden alan adı
    [InlineData("https://127.0.0.1:8443")]            // iç servis / SSRF
    [InlineData("https://169.254.169.254")]           // bulut metadata ucu
    public async Task IzinsizHost_CheckoutuDurdurur(string baseUrl)
    {
        var options = NewOptions();
        await SeedAsync(options, baseUrl);

        await using var db = NewDb(options);
        var result = await NewResolver(db, "Production").ResolveAsync();

        Assert.True(result.IsFailure, $"'{baseUrl}' reddedilmeliydi ama çözücü gateway döndürdü.");
        // Host adı ve allowlist keşif bilgisidir; istemciye verilen mesaj GENEL olmalı.
        Assert.DoesNotContain("evil", result.Error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("iyzipay", result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Allowlist'teki canlı adres çalışmaya devam etmeli (kapı fazla kısıtlamıyor).</summary>
    [Fact]
    public async Task IzinliCanliHost_Gecer()
    {
        var options = NewOptions();
        await SeedAsync(options, "https://api.iyzipay.com");

        await using var db = NewDb(options);
        var result = await NewResolver(db, "Production").ResolveAsync();

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>
    /// HTTP (şifresiz) reddedilir — allowlist'teki host olsa bile. Kart referansı taşıyan bir
    /// isteğin düz metin gitmesi, yanlış host kadar ciddidir.
    /// </summary>
    [Fact]
    public async Task HttpSema_Reddedilir()
    {
        var options = NewOptions();
        await SeedAsync(options, "http://api.iyzipay.com");

        await using var db = NewDb(options);
        Assert.True((await NewResolver(db, "Production").ResolveAsync()).IsFailure);
    }

    /// <summary>
    /// İSTEK YOLU DNS'E BAĞLANMAZ. Allowlist kontrolü ağ erişimi gerektirmemeli: geçici bir DNS
    /// kesintisi TÜM ödemeleri durduran bir arızaya dönüşmemeli (ad çözümlemesi ayarın
    /// KAYDEDİLDİĞİ anda yapılır — bkz. OutboundEndpointGuard.ValidatePaymentApiUrl).
    /// </summary>
    [Fact]
    public async Task IstekYolu_AdCozumlemesiYapmaz()
    {
        // Çözülemeyecek bir ad allowlist'te olmadığı için zaten reddedilir; buradaki iddia
        // kararın HIZLI ve ağdan bağımsız verildiğidir.
        var options = NewOptions();
        await SeedAsync(options, "https://bu-ad-cozulmez.invalid");

        await using var db = NewDb(options);
        var started = DateTime.UtcNow;
        Assert.True((await NewResolver(db, "Production").ResolveAsync()).IsFailure);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(2),
            "Karar ağ çözümlemesine takıldı; istek yolunda DNS kontrolü olmamalı.");
    }
}
