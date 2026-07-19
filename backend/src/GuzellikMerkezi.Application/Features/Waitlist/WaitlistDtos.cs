using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Waitlist;

public sealed record WaitlistEntryDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid CustomerId,
    Guid? ServiceDefinitionId,
    Guid? StaffMemberId,
    DateOnly PreferredDate,
    WaitlistStatus Status,
    string? Note,
    DateTime CreatedAtUtc,
    DateTime? PreferredStartUtc,
    int? DurationMinutes,
    string? CustomerName = null,
    string? CustomerPhone = null);

public sealed record CreateWaitlistRequest(
    Guid CustomerId,
    Guid? ServiceDefinitionId,
    Guid? StaffMemberId,
    DateOnly PreferredDate,
    string? Note,
    Guid? BranchId,
    DateTime? PreferredStartUtc = null,
    int? DurationMinutes = null);

public sealed record UpdateWaitlistStatusRequest(WaitlistStatus Status);
