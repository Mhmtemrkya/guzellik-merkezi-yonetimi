using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.ServiceCatalog;

public interface ICustomServiceCategoryService
{
    Task<Result<IReadOnlyCollection<CustomServiceCategoryDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<CustomServiceCategoryDto>> CreateAsync(Guid tenantId, UpsertCustomServiceCategoryRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomServiceCategoryDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomServiceCategoryRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
