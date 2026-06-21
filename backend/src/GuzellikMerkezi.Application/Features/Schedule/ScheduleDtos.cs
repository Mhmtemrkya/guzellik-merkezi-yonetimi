namespace GuzellikMerkezi.Application.Features.Schedule;

public sealed record StaffTimeOffDto(
    Guid Id,
    Guid StaffMemberId,
    string? StaffName,
    DateOnly Date,
    string? Reason);

public sealed record CreateTimeOffRequest(Guid StaffMemberId, DateOnly Date, string? Reason);
