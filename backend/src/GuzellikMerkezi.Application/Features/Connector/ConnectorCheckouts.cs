using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Connector;

/// <summary>
/// Maydanoz'un ödeme sayfasının okuduğu kayıt. Kişisel veri yoktur: yalnız kurum adı, tutar ve açıklama.
/// Durum: <c>pending</c> (ödenebilir), <c>paid</c>, <c>expired</c> (süresi doldu; yeni ödeme panelden başlar).
/// </summary>
public sealed record ConnectorCheckoutDto(
    string Ref,
    string Status,
    string Kind,
    long AmountKurus,
    string Currency,
    string Description,
    string TenantName,
    Guid TenantId,
    string ReturnUrl,
    DateTime ExpiresAtUtc);

/// <summary>Maydanoz'un "ödendi" bildirimi. Tutar kuruştur (tam sayı; para TL'den yeniden türetilmez).</summary>
public sealed record ConnectorCheckoutPaidRequest(string? PaymentId, long AmountKurus, string? Currency);

/// <summary>Bildirimin sonucu: <c>settled</c> (abonelik/kredi işlendi) ya da <c>pending</c> (kayıt alındı, işleme sürüyor).</summary>
public sealed record ConnectorCheckoutPaidDto(string Ref, string Status, string? Message);

public interface IConnectorCheckouts
{
    Task<ConnectorCheckoutDto?> GetAsync(string publicRef, CancellationToken ct = default);

    Task<Result<ConnectorCheckoutPaidDto>> RecordPaidAsync(string publicRef, ConnectorCheckoutPaidRequest request, CancellationToken ct = default);
}
