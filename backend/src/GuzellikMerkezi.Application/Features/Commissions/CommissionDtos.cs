namespace GuzellikMerkezi.Application.Features.Commissions;

public sealed record StaffCommissionDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid StaffMemberId,
    string? StaffName,
    Guid SourceAdisyonId,
    string SourceType,
    string Description,
    decimal BaseAmount,
    decimal RatePercent,
    decimal Amount,
    DateTime EarnedAtUtc,
    bool IsPaid,
    DateTime? PaidAtUtc);

public sealed record StaffCommissionTotalDto(
    Guid StaffMemberId,
    string? StaffName,
    decimal EarnedTotal,
    decimal PaidTotal,
    decimal UnpaidTotal,
    int Count);

public sealed record CommissionSummaryDto(
    decimal EarnedTotal,
    decimal PaidTotal,
    decimal UnpaidTotal,
    int Count,
    IReadOnlyCollection<StaffCommissionTotalDto> ByStaff);

public sealed record CommissionFilter(DateTime? FromUtc, DateTime? ToUtc, Guid? StaffMemberId, bool? UnpaidOnly);
