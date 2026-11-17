using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Connector;

/// <summary>
/// Maydanoz'da (maydanozasist.com/paketler) BeautyAsist satın alma: tutar ve uygunluk sorusu.
/// Kişisel veri GÖVDEDE gelir (adreste değil). Tutar BeautyAsist'in tek fiyat kaynağından
/// (<c>SubscriptionPricing</c>) — 1 şube, kademesiz yeni kurum.
/// </summary>
public sealed record ConnectorSignupQuoteRequest(string? Period, string? TenantName, string? Email, string? Phone);

/// <param name="Available">Bu e-posta / telefon / işletme adıyla yeni hesap açılabilir mi.</param>
/// <param name="Reason">Açılamıyorsa kullanıcıya gösterilecek neden.</param>
public sealed record ConnectorSignupQuoteDto(
    bool Available,
    string? Reason,
    string PlanName,
    string Period,
    int Branches,
    long NetKurus,
    long VatKurus,
    long TotalKurus,
    string Description);

/// <summary>
/// Maydanoz'un "ödeme alındı, hesabı aç" bildirimi. <c>OrderId</c> Maydanoz sipariş kimliğidir ve
/// tekrar koruması onun üzerindedir: aynı sipariş ikinci kez gelirse yeni kurum açılmaz.
/// </summary>
public sealed record ConnectorSignupRequest(
    string? OrderId,
    long AmountKurus,
    string? Currency,
    string? Period,
    string? TenantName,
    string? OwnerName,
    string? Email,
    string? Phone,
    string? City);

/// <param name="Created">Bu çağrıda mı açıldı (false: aynı siparişle daha önce açılmıştı).</param>
/// <param name="EmailSent">Hoş geldin e-postası gönderildi mi (şifre e-postaya yazılmaz).</param>
public sealed record ConnectorSignupDto(Guid TenantId, string Code, string LoginUrl, bool Created, bool EmailSent);

public interface IConnectorSignups
{
    Task<Result<ConnectorSignupQuoteDto>> QuoteAsync(ConnectorSignupQuoteRequest request, CancellationToken ct = default);

    Task<Result<ConnectorSignupDto>> CreatePaidAsync(ConnectorSignupRequest request, CancellationToken ct = default);
}
