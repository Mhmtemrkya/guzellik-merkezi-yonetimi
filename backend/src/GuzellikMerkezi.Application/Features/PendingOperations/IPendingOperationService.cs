using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.PendingOperations;

public interface IPendingOperationService
{
    Task<Result<PagedResult<PendingOperationDto>>> ListAsync(Guid tenantId, PendingOperationFilter filter, PageRequest pageRequest, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> CreateAsync(Guid tenantId, Guid? branchId, Guid requestedByUserId, string requestedByName, CreatePendingOperationRequest request, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> ApproveAsync(Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> RejectAsync(Guid tenantId, Guid id, Guid decidedByUserId, RejectPendingOperationRequest request, CancellationToken cancellationToken = default);
    Task<Result> CancelAsync(Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken cancellationToken = default);
}
