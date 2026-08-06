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
    }

    public async Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default)
    {
        var settings = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (settings is null || !settings.PaymentsEnabled)
        {
            return Result<PaymentGatewayContext>.Failure(Error.Conflict(
                "Ödeme altyapısı henüz etkin değil. Platform yöneticisi ödeme ayarlarını tamamlamalı."));
        }

        // Simülasyon: anahtar aranmaz, gerçek çekim yapılmaz (akışı uçtan uca denemek için).
        if (!string.Equals(settings.PaymentProvider, "Iyzico", StringComparison.OrdinalIgnoreCase))
        {
            return Result<PaymentGatewayContext>.Success(
                new PaymentGatewayContext(new SimulationPaymentGateway(_simulationSigningSecret), settings.PaymentsReturnUrl));
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
