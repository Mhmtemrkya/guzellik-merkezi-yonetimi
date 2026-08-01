using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Expenses;

public sealed record BusinessExpenseDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    ExpenseCategory Category,
    decimal Amount,
    ExpensePaymentMethod PaymentMethod,
    DateTime OccurredAtUtc,
    Guid? StaffMemberId,
    string? StaffName,
    string? PeriodLabel,
    string? Description,
    string? Reference,
    bool IsApproved,
    DateTime? ApprovedAtUtc,
    DateTime CreatedAtUtc);

public sealed record CreateExpenseRequest(
    Guid? BranchId,
    ExpenseCategory Category,
    decimal Amount,
    ExpensePaymentMethod PaymentMethod,
    DateTime OccurredAtUtc,
    Guid? StaffMemberId,
    string? PeriodLabel,
    string? Description,
    string? Reference);

public sealed record UpdateExpenseRequest(
    ExpenseCategory Category,
    decimal Amount,
    ExpensePaymentMethod PaymentMethod,
    DateTime OccurredAtUtc,
    Guid? StaffMemberId,
    string? PeriodLabel,
    string? Description,
    string? Reference);

public sealed record ExpenseFilter(
    DateTime? FromUtc,
    DateTime? ToUtc,
    ExpenseCategory? Category,
    Guid? StaffMemberId);

/// <summary>
/// Gider özeti. <see cref="TotalAmount"/> ONAYLI giderler + müşteri iadelerini kapsar; kasa akışı
/// ve kâr-zarar da ikisini gider sayar.
/// <para>
/// <see cref="RefundAmount"/>/<see cref="RefundCount"/> ayrı verilir: iadeler gider LİSTESİNDE
/// (business_expenses) görünmez, bu yüzden liste toplamı ile özet toplamı arasında açıklanmayan
/// bir fark oluşuyordu. Ekran bu satırı ayrıca gösterirse fark okunur hâle gelir.
/// </para>
/// </summary>
public sealed record ExpenseSummaryDto(
    decimal TotalAmount,
    int Count,
    IReadOnlyCollection<ExpenseCategoryTotalDto> ByCategory,
    IReadOnlyCollection<ExpenseStaffTotalDto> ByStaff,
    decimal RefundAmount = 0m,
    int RefundCount = 0);

public sealed record ExpenseCategoryTotalDto(ExpenseCategory Category, decimal TotalAmount, int Count);

public sealed record ExpenseStaffTotalDto(Guid StaffMemberId, string StaffName, decimal TotalAmount, int Count);
