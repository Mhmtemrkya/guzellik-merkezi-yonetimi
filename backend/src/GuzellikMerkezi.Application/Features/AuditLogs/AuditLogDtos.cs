namespace GuzellikMerkezi.Application.Features.AuditLogs;

public sealed record AuditLogDto(
    Guid Id,
    Guid? TenantId,
    Guid? BranchId,
    Guid? ActorUserId,
    string? ActorName,
    string? ActorRole,
    string Action,
    string EntityName,
    Guid? EntityId,
    string? Summary,
    string? DataJson,
    string? IpAddress,
    DateTime CreatedAtUtc);

public sealed record AuditLogFilter(
    string? Action,
    string? EntityName,
    Guid? ActorUserId,
    DateTime? FromUtc,
    DateTime? ToUtc,
    string? Search);

public sealed record AuditLogDeleteResultDto(int DeletedCount);
