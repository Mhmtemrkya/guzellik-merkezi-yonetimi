using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.PendingOperations;

public sealed record PendingOperationDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid RequestedByUserId,
    string RequestedByName,
    PendingOperationType OperationType,
    string Title,
    string? Summary,
    string PayloadJson,
    PendingOperationStatus Status,
    DateTime RequestedAtUtc,
    DateTime? DecidedAtUtc,
    Guid? DecidedByUserId,
    string? RejectionReason,
    Guid? ResultEntityId);

public sealed record CreatePendingOperationRequest(
    PendingOperationType OperationType,
    string Title,
    string? Summary,
    string PayloadJson);

public sealed record RejectPendingOperationRequest(string? Reason);

public sealed record PendingOperationFilter(
    PendingOperationStatus? Status,
    Guid? RequestedByUserId,
    PendingOperationType? OperationType);
