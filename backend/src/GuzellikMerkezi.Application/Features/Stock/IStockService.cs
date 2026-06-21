using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Stock;

public interface IStockService
{
    Task<Result<PagedResult<ProductDto>>> ListAsync(Guid tenantId, ProductCategory? category, bool? criticalOnly, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProductDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<ProductDto>> CreateAsync(Guid tenantId, CreateProductRequest request, CancellationToken cancellationToken = default);
    Task<Result<ProductDto>> UpdateAsync(Guid tenantId, Guid id, UpdateProductRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyCollection<StockMovementDto>>> ListMovementsAsync(Guid tenantId, Guid? productId, int limit, CancellationToken cancellationToken = default);
    Task<Result<StockMovementDto>> AddMovementAsync(Guid tenantId, Guid productId, CreateStockMovementRequest request, CancellationToken cancellationToken = default);

    Task<Result<StockSummaryDto>> SummaryAsync(Guid tenantId, CancellationToken cancellationToken = default);
}
