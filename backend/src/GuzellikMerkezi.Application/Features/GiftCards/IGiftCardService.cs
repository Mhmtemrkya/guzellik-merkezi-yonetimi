using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.GiftCards;

public interface IGiftCardService
{
    Task<Result<IReadOnlyCollection<GiftCardDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> CreateAsync(Guid tenantId, CreateGiftCardRequest request, CancellationToken cancellationToken = default);
    /// <summary>Koda göre doğrula (satış/adisyon akışında uygulamadan önce).</summary>
    Task<Result<GiftCardDto>> GetByCodeAsync(Guid tenantId, string code, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> RedeemAsync(Guid tenantId, Guid id, RedeemGiftCardRequest request, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> SetActiveAsync(Guid tenantId, Guid id, SetGiftCardActiveRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kart üzerindeki QR'ın hedefi — ANONİM. Kod kurum içinde benzersiz olduğu için kurum
    /// anahtarı (slug) ZORUNLUDUR: yalnız kodla arama iki kurumun aynı kodunu karıştırırdı.
    /// </summary>
    Task<Result<PublicGiftCardDto>> GetPublicByCodeAsync(string slug, string code, CancellationToken cancellationToken = default);
}
