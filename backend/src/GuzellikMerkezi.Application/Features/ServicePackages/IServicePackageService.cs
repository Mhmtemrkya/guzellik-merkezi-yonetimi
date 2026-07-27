using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.ServicePackages;

public interface IServicePackageService
{
    Task<Result<PagedResult<ServicePackageDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServicePackageDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<ServicePackageDto>> CreateAsync(Guid tenantId, UpsertServicePackageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServicePackageDto>> UpdateAsync(Guid tenantId, Guid id, UpsertServicePackageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServicePackageDto>> UpdateCategoryAsync(Guid tenantId, Guid id, UpdateServicePackageCategoryRequest request, CancellationToken cancellationToken = default);
    /// <summary>Paket TANIMINI gerekçesiyle iptal eder (müşterinin satış iptalinden ayrı kavram).</summary>
    Task<Result<ServicePackageDto>> CancelAsync(Guid tenantId, Guid id, CancelServicePackageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServicePackageDto>> RestoreAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
