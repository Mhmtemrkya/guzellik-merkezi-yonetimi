namespace GuzellikMerkezi.Application.Features.CashClosing;

public sealed record CashClosingDto(
    Guid Id,
    Guid? BranchId,
    DateOnly BusinessDate,
    decimal OpeningBalance,
    decimal CashIncome,
    decimal CashExpense,
    decimal SystemCash,
    decimal CountedCash,
    decimal Difference,
    string? Note,
    DateTime CreatedAtUtc);

/// <summary>Kapanış öncesi önizleme — sistemin hesapladığı nakit + önerilen devir.</summary>
public sealed record CashClosingPreviewDto(
    DateOnly BusinessDate,
    decimal CashIncome,
    decimal CashExpense,
    decimal SuggestedOpening,
    decimal SystemCash,
    bool AlreadyClosed);

public sealed record CreateCashClosingRequest(
    DateOnly BusinessDate,
    DateTime FromUtc,
    DateTime ToUtc,
    decimal OpeningBalance,
    decimal CountedCash,
    string? Note,
    Guid? BranchId);
