using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Campaigns;

public interface ICampaignService
{
    Task<Result<IReadOnlyCollection<CampaignDto>>> ListAsync(Guid tenantId, bool? runningOnly, CancellationToken cancellationToken = default);
    Task<Result<CampaignDto>> CreateAsync(Guid tenantId, UpsertCampaignRequest request, CancellationToken cancellationToken = default);
    Task<Result<CampaignDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCampaignRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
