using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Waitlist;

public interface IWaitlistService
{
    Task<Result<IReadOnlyCollection<WaitlistEntryDto>>> ListAsync(Guid tenantId, bool? activeOnly, CancellationToken cancellationToken = default);
    Task<Result<WaitlistEntryDto>> CreateAsync(Guid tenantId, CreateWaitlistRequest request, CancellationToken cancellationToken = default);
    Task<Result<WaitlistEntryDto>> SetStatusAsync(Guid tenantId, Guid id, UpdateWaitlistStatusRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
