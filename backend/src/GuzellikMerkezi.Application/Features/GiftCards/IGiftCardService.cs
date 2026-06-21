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
}
