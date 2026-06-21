using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Expenses;

public interface ICustomExpenseCategoryService
{
    Task<Result<IReadOnlyCollection<CustomExpenseCategoryDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<CustomExpenseCategoryDto>> CreateAsync(Guid tenantId, UpsertCustomExpenseCategoryRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomExpenseCategoryDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomExpenseCategoryRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}
