using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Expenses;

public interface IExpenseService
{
    Task<Result<PagedResult<BusinessExpenseDto>>> ListAsync(Guid tenantId, ExpenseFilter filter, PageRequest pageRequest, CancellationToken cancellationToken = default);
    Task<Result<BusinessExpenseDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<BusinessExpenseDto>> CreateAsync(Guid tenantId, CreateExpenseRequest request, CancellationToken cancellationToken = default);
    Task<Result<BusinessExpenseDto>> UpdateAsync(Guid tenantId, Guid id, UpdateExpenseRequest request, CancellationToken cancellationToken = default);
    Task<Result<BusinessExpenseDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<BusinessExpenseDto>> RevokeAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// ONAYLANMIŞ gideri geçersiz kılar (silmez). Ayrı yetki + zorunlu gerekçe ister; satır kalıcı
    /// iz olarak kalır ve muhasebe toplamlarından düşer (bkz. <see cref="BusinessExpenseDto.VoidedAtUtc"/>).
    /// </summary>
    Task<Result<BusinessExpenseDto>> VoidAsync(Guid tenantId, Guid id, VoidExpenseRequest request, CancellationToken cancellationToken = default);
    Task<Result<ExpenseSummaryDto>> SummaryAsync(Guid tenantId, ExpenseFilter filter, CancellationToken cancellationToken = default);
}
