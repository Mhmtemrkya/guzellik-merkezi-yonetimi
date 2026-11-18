using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Branches;

public interface IBranchService
{
    Task<Result<IReadOnlyCollection<BranchDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> CreateAsync(Guid tenantId, UpsertBranchRequest request, CancellationToken cancellationToken = default);
    Task<Result<BranchDto>> UpdateAsync(Guid tenantId, Guid id, UpsertBranchRequest request, CancellationToken cancellationToken = default);

    /// <summary>Silmeden önce: aktarılacak kayıtlar, engel (varsayılan / tek şube) ve paket tutarına etkisi.</summary>
    Task<Result<BranchDeletePreviewDto>> DeletePreviewAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Şubeyi siler: kayıtları hedef şubeye aktarır (hiçbir kayıt silinmez), şubeyi kaldırır.</summary>
    Task<Result<BranchDeleteResultDto>> DeleteAsync(Guid tenantId, Guid id, DeleteBranchRequest request, CancellationToken cancellationToken = default);
}
