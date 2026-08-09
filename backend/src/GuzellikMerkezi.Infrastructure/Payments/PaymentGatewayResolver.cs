using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Payments;

/// <inheritdoc />
public sealed class PaymentGatewayResolver : IPaymentGatewayResolver
{
    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<PaymentGatewayResolver> _logger;

    /// <summary>Simülasyon form anahtarını imzalayan sunucu sırrı (bkz. SimulationPaymentGateway).</summary>
    private readonly string _simulationSigningSecret;

    /// <summary>iyzico test ortamı — ÜRETİM DIŞINDA, base URL boş bırakılırsa buraya düşülür.</summary>
    private const string SandboxBaseUrl = "https://sandbox-api.iyzipay.com";

    /// <summary>Sandbox olduğu ad üzerinden anlaşılan host parçası; üretimde yasaktır.</summary>
    private const string SandboxHostMarker = "sandbox";

    /// <summary>Simülasyonun AÇIKÇA seçilmesi gereken adı.</summary>
    private const string SimulationProvider = "Simulation";
    private const string IyzicoProvider = "Iyzico";

    /// <summary>Eski kaçış kapısının anahtarı — üretimde AÇIKSA başlangıçta hata verilir.</summary>
    public const string LegacySimulationOverrideKey = "Payments:AllowSimulationInProduction";

    private readonly bool _isProduction;

    public PaymentGatewayResolver(
        GuzellikDbContext db,
        IEncryptionService encryption,
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<PaymentGatewayResolver> logger)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _logger = logger;
        // İmza sırrı: ayrı bir anahtar verilmediyse JWT imza anahtarına düşülür — ikisi de
        // sunucuya özel sırlardır ve konfigürasyon zaten güçlü anahtar zorunluluğu uygular.
        _simulationSigningSecret = configuration["Payments:SimulationSigningKey"]
                                   ?? configuration["Jwt:SigningKey"]
                                   ?? string.Empty;

        var env = configuration["ASPNETCORE_ENVIRONMENT"]
                  ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
                  ?? "Production";
        _isProduction = !string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(env, "Staging", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// ÜRETİMDE SAHTE ÖDEMEYE KONFİGÜRASYONLA GEÇİLEMEZ (başlangıç kapısı).
    ///
    /// <para>
    /// Eskiden <c>Payments:AllowSimulationInProduction=true</c> canlıda simülasyon sağlayıcısını
    /// açıyordu: hiç para çekilmeden her abonelik "ödendi" sayılırdı. Kaçış kapısı kaldırıldı;
    /// ayarı devralan bir kurulum SESSİZCE farklı davranmasın diye uygulama AÇILMAZ — operatör
    /// satırı silmek zorunda kalır.
    /// </para>
    /// </summary>
    public static void EnsureProductionPaymentConfiguration(IConfiguration configuration, string environmentName)
    {
        var isProduction = !string.Equals(environmentName, "Development", StringComparison.OrdinalIgnoreCase)
                           && !string.Equals(environmentName, "Staging", StringComparison.OrdinalIgnoreCase);
        if (!isProduction) return;

        if (bool.TryParse(configuration[LegacySimulationOverrideKey], out var allow) && allow)
        {
            throw new InvalidOperationException(
                $"'{LegacySimulationOverrideKey}' üretimde açık. Bu kaçış kapısı kaldırıldı: canlı ortamda " +
                "simülasyon ödeme sağlayıcısı çalıştırılamaz. Ayarı konfigürasyondan kaldırın.");
        }
    }

    public async Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default)
    {
        var settings = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (settings is null || !settings.PaymentsEnabled)
        {
            return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                "Ödeme altyapısı henüz etkin değil. Platform yöneticisi ödeme ayarlarını tamamlamalı."));
        }

        // SAĞLAYICI ADI ALLOWLIST'TEN GEÇER — TANIMSIZ AD SİMÜLASYONA DÜŞMEZ.
        //
        // SOMUT AÇIK: kural "Iyzico değilse simülasyon" idi. Yani bir yazım hatası ("Iyzıco",
        // "iyzipay"), yeni bir sağlayıcı adı ya da boş bir değer üretimde SESSİZCE sahte ödeme
        // döndürüyordu: para çekilmeden abonelik "ödendi" sayılıyor, kurum ücretsiz açılıyordu.
        // Simülasyon artık AÇIKÇA seçilmek zorunda; tanınmayan her ad hata verir.
        var provider = (settings.PaymentProvider ?? string.Empty).Trim();

        if (string.Equals(provider, SimulationProvider, StringComparison.OrdinalIgnoreCase))
        {
            // ÜRETİMDE SİMÜLASYON KAPALI — İSTİSNASIZ. Açıkça seçilmiş olsa bile gerçek para
            // bekleyen bir ortamda sahte başarı üretemez; konfigürasyonla açılabilen bir kaçış
            // kapısı da yoktur (bkz. EnsureProductionPaymentConfiguration).
            if (_isProduction)
            {
                _logger.LogError("Üretimde simülasyon ödeme sağlayıcısı seçili; ödeme akışı durduruldu.");
                return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                    "Ödeme sağlayıcısı 'Simulation' olarak ayarlı; canlı ortamda gerçek ödeme sağlayıcısı seçilmelidir."));
            }

            return Result<PaymentGatewayContext>.Success(
                new PaymentGatewayContext(new SimulationPaymentGateway(_simulationSigningSecret), settings.PaymentsReturnUrl));
        }

        if (!string.Equals(provider, IyzicoProvider, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogError("Tanınmayan ödeme sağlayıcısı: {Provider}. Ödeme akışı durduruldu.", provider);
            return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                $"Tanınmayan ödeme sağlayıcısı: '{provider}'. Geçerli değerler: {IyzicoProvider}, {SimulationProvider}."));
        }

        var apiKey = _encryption.Decrypt(settings.IyzicoApiKeyEncrypted);
        var secretKey = _encryption.Decrypt(settings.IyzicoSecretKeyEncrypted);
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(secretKey))
        {
            // SESSİZCE SİMÜLASYONA DÜŞÜLMEZ: "Iyzico" seçiliyken anahtar eksikse gerçek para
            // bekleyen bir akış sahte başarı döndürürdü — abonelik ödenmemişken açılırdı.
            _logger.LogError("iyzico seçili ancak API anahtarları tanımlı değil; ödeme akışı durduruldu.");
            return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                "Ödeme sağlayıcısı anahtarları tanımlı değil. Platform yöneticisi ödeme ayarlarını tamamlamalı."));
        }

        // ÜRETİMDE SANDBOX'A DÜŞÜLMEZ.
        //
        // Base URL boş bırakıldığında sessizce test ortamına düşülüyordu: sandbox her çekimi
        // gerçek para hareketi OLMADAN başarılı döner, yani canlı kurumlar ücretsiz abone olurdu.
        // Ayarın boş kalması bir yapılandırma hatasıdır ve canlıda hata verir; sandbox adresinin
        // ELLE girilmesi de aynı sonucu doğurduğu için ayrıca reddedilir.
        var configuredBaseUrl = settings.IyzicoBaseUrl?.Trim();
        if (_isProduction)
        {
            if (string.IsNullOrWhiteSpace(configuredBaseUrl))
            {
                _logger.LogError("Canlı ortamda iyzico API adresi tanımlı değil; ödeme akışı durduruldu.");
                return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                    "Ödeme sağlayıcısı API adresi tanımlı değil. Canlı ortamda test adresine düşülmez; " +
                    "platform yöneticisi canlı iyzico adresini girmeli."));
            }

            if (configuredBaseUrl.Contains(SandboxHostMarker, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogError("Canlı ortamda iyzico test (sandbox) adresi tanımlı: {BaseUrl}", configuredBaseUrl);
                return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                    "Ödeme sağlayıcısı test (sandbox) adresine ayarlı; canlı ortamda gerçek API adresi kullanılmalıdır."));
            }
        }

        var baseUrl = string.IsNullOrWhiteSpace(configuredBaseUrl) ? SandboxBaseUrl : configuredBaseUrl!;

        // HOST ALLOWLIST'İ BURADA DA UYGULANIR — YAZMA YOLUNA GÜVENİLMEZ.
        //
        // SOMUT AÇIK: `ValidatePaymentApiUrl` yalnızca ayar KAYDEDİLİRKEN çağrılıyordu
        // (PlatformMessagingService). Oysa bu satır, kart referanslarının ve tahsilat
        // isteklerinin gideceği HttpClient'ı KURAN yerdir ve kaydedilmiş değere hiç bakmadan
        // güveniyordu. Yazma kapısını atlayan her yol (doğrudan veritabanı düzenlemesi, kapı
        // eklenmeden önce yazılmış satır, yedekten geri yükleme, ileride eklenecek ikinci bir
        // ayar ucu) sahte bir host'u sessizce devreye alırdı.
        //
        // Bu, aynı dosyada PaymentConfigGate için yazılan kuralın ta kendisi: "aynı kural iki
        // yere yazılırsa saparlar" — burada saptığı yer, kuralın YALNIZ bir yerde olmasıydı.
        // Doğrulama kararın VERİLDİĞİ noktada tekrarlanır; tek kaynak OutboundEndpointGuard.
        if (OutboundEndpointGuard.ValidatePaymentApiHost(baseUrl) is { } hostError)
        {
            // Ayrıntı yalnız günlüğe: host adı ve allowlist keşif bilgisidir (bkz. PaymentConfigGate).
            _logger.LogError("Ödeme sağlayıcı adresi allowlist'i geçemedi: {BaseUrl} — {Error}", baseUrl, hostError);
            return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                "Ödeme sağlayıcısı adresi geçersiz. Platform yöneticisi ödeme ayarlarını düzeltmeli."));
        }

        var http = _httpFactory.CreateClient("Iyzico");
        var gateway = new IyzicoPaymentGateway(http, apiKey!, secretKey!, baseUrl, _logger);
        return Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(gateway, settings.PaymentsReturnUrl));
    }
}
