using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Infrastructure.Persistence;
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

    /// <summary>iyzico test ortamı — anahtar girilip base URL boş bırakılırsa buraya düşülür.</summary>
    private const string SandboxBaseUrl = "https://sandbox-api.iyzipay.com";

    /// <summary>Simülasyonun AÇIKÇA seçilmesi gereken adı.</summary>
    private const string SimulationProvider = "Simulation";
    private const string IyzicoProvider = "Iyzico";

    /// <summary>Simülasyon üretimde çalışabilir mi (varsayılan: HAYIR).</summary>
    private readonly bool _allowSimulationInProduction;
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
        _allowSimulationInProduction =
            bool.TryParse(configuration["Payments:AllowSimulationInProduction"], out var allow) && allow;
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
            // ÜRETİMDE SİMÜLASYON KAPALI: açıkça seçilmiş olsa bile gerçek para bekleyen bir
            // ortamda sahte başarı üretmemeli. Bilinçli istisna için açık bayrak gerekir.
            if (_isProduction && !_allowSimulationInProduction)
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

        var baseUrl = string.IsNullOrWhiteSpace(settings.IyzicoBaseUrl) ? SandboxBaseUrl : settings.IyzicoBaseUrl!;
        var http = _httpFactory.CreateClient("Iyzico");
        var gateway = new IyzicoPaymentGateway(http, apiKey!, secretKey!, baseUrl, _logger);
        return Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(gateway, settings.PaymentsReturnUrl));
    }
}
