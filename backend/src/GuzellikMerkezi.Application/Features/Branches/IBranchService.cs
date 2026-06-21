using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Branches;

public interface IBranchService
{
    Task<Result<IReadOnlyCollection<BranchDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> CreateAsync(Guid tenantId, UpsertBranchRequest request, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> UpdateAsync(Guid tenantId, Guid id, UpsertBranchRequest request, CancellationToken cancellationToken = default);
}
