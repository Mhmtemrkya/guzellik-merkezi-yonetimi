using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.PendingOperations;

public interface IPendingOperationService
{
    /// <param name="actorRole">Şube yöneticisi YALNIZ kendi şubesinin işlemlerini görür.</param>
    /// <param name="actorBranchId">Şube yöneticisinin şubesi.</param>
    Task<Result<PagedResult<PendingOperationDto>>> ListAsync(Guid tenantId, PendingOperationFilter filter, PageRequest pageRequest, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> GetAsync(Guid tenantId, Guid id, Guid actorUserId, UserRole? actorRole, Guid? actorBranchId = null, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> CreateAsync(Guid tenantId, Guid? branchId, Guid requestedByUserId, string requestedByName, CreatePendingOperationRequest request, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> ApproveAsync(Guid tenantId, Guid id, Guid decidedByUserId, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default);
    Task<Result<PendingOperationDto>> RejectAsync(Guid tenantId, Guid id, Guid decidedByUserId, RejectPendingOperationRequest request, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default);
    Task<Result> CancelAsync(Guid tenantId, Guid id, Guid decidedByUserId, UserRole? actorRole, Guid? actorBranchId = null, CancellationToken cancellationToken = default);
}
