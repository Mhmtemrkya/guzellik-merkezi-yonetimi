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

/// <summary>Ay bazında gelir-gider-net (ay anahtarı TR yerel: "yyyy-MM").</summary>
public sealed record ProfitMonthDto(string Month, decimal Income, decimal Expense, decimal Net);

/// <summary>Hizmet kârlılığı: tamamlanan randevu geliri − personel prim maliyeti.</summary>
public sealed record ServiceProfitDto(string ServiceName, int CompletedCount, decimal Revenue, decimal CommissionCost, decimal Net);

/// <summary>
/// Kâr raporu — gelir (tahsilat), gider (işletme gideri) ve net; ay kırılımı + hizmet kârlılığı.
/// </summary>
public sealed record ProfitReportDto(
    IReadOnlyCollection<ProfitMonthDto> Months,
    decimal TotalIncome,
    decimal TotalExpense,
    decimal TotalNet,
    IReadOnlyCollection<ServiceProfitDto> Services);
