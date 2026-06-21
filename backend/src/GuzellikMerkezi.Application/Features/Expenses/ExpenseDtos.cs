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

public sealed record ExpenseSummaryDto(
    decimal TotalAmount,
    int Count,
    IReadOnlyCollection<ExpenseCategoryTotalDto> ByCategory,
    IReadOnlyCollection<ExpenseStaffTotalDto> ByStaff);

public sealed record ExpenseCategoryTotalDto(ExpenseCategory Category, decimal TotalAmount, int Count);

public sealed record ExpenseStaffTotalDto(Guid StaffMemberId, string StaffName, decimal TotalAmount, int Count);
