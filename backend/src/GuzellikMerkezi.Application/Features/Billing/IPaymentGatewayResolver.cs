using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Billing;

/// <summary>
/// Yapılandırmaya göre aktif ödeme sağlayıcısını çözer (platform ayarları tek kaynaktır).
/// Anahtarlar veritabanında şifreli durur; çözme yalnızca burada yapılır ve düz metin
/// hiçbir DTO'ya sızmaz.
/// </summary>
public interface IPaymentGatewayResolver
{
    Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default);
}

/// <param name="ReturnUrl">3D Secure sonrası kullanıcının döneceği panel adresi (platform ayarından).</param>
public sealed record PaymentGatewayContext(IPaymentGateway Gateway, string? ReturnUrl);
