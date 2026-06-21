namespace GuzellikMerkezi.Application.Features.Loyalty;

public sealed record LoyaltyTransactionDto(
    Guid Id,
    Guid CustomerId,
    int Points,
    string SourceType,
    string? Description,
    DateTime OccurredAtUtc);

public sealed record LoyaltyBalanceDto(
    Guid CustomerId,
    int Balance,
    int TotalEarned,
    int TotalRedeemed,
    IReadOnlyCollection<LoyaltyTransactionDto> History);

public sealed record AdjustLoyaltyRequest(Guid CustomerId, int Points, string? Description);
