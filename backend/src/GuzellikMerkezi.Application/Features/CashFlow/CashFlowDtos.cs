namespace GuzellikMerkezi.Application.Features.CashFlow;

public enum CashFlowEntryType
{
    Income = 0,
    Expense = 1,
}

public sealed record CashFlowEntryDto(
    Guid Id,
    CashFlowEntryType Type,
    DateTime OccurredAtUtc,
    decimal Amount,
    string? Method,
    string? Category,
    string? Description,
    string? Reference,
    string? CustomerName,
    string? StaffName,
    string? AccountName,
    bool IsApproved);

public sealed record CashFlowSummaryDto(
    decimal TotalIncome,
    decimal TotalExpense,
    decimal NetAmount,
    int IncomeCount,
    int ExpenseCount,
    IReadOnlyCollection<CashFlowMethodTotalDto> ByMethod);

public sealed record CashFlowMethodTotalDto(string Method, decimal IncomeAmount, decimal ExpenseAmount, int Count);

public sealed record CashFlowFilter(DateTime? FromUtc, DateTime? ToUtc);
