using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.ServiceCatalog;

public interface IServiceCatalogService
{
    Task<Result<PagedResult<ServiceDefinitionDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServiceDefinitionDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<ServiceDefinitionDto>> CreateAsync(Guid tenantId, UpsertServiceDefinitionRequest request, CancellationToken cancellationToken = default);
    Task<Result<ServiceDefinitionDto>> UpdateAsync(Guid tenantId, Guid id, UpsertServiceDefinitionRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
