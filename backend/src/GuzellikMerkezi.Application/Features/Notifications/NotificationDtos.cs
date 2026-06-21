using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Notifications;

public sealed record NotificationTemplateDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status,
    int TotalSentCount,
    DateTime? LastSentAtUtc,
    DateTime CreatedAtUtc);

public sealed record CreateNotificationTemplateRequest(
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status);

public sealed record UpdateNotificationTemplateRequest(
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status);

public sealed record NotificationLogDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid? TemplateId,
    string? TemplateName,
    Guid? CustomerId,
    string? CustomerName,
    NotificationChannel Channel,
    string Recipient,
    string Body,
    NotificationLogStatus Status,
    string? ErrorMessage,
    DateTime? SentAtUtc,
    DateTime CreatedAtUtc);

/// <summary>
/// Bir şablonu belirli müşterilere gönderir. CustomerIds boşsa Audience'a göre toplu kitle bulunur.
/// </summary>
public sealed record SendNotificationRequest(
    Guid TemplateId,
    IReadOnlyCollection<Guid>? CustomerIds,
    /// <summary>"all" | "active90" | "birthdayWeek" | "inactive30" — boşsa "all"</summary>
    string? Audience);

public sealed record SendNotificationResultDto(
    int Sent,
    int Failed,
    int Skipped,
    IReadOnlyCollection<NotificationLogDto> Logs);

public sealed record NotificationSummaryDto(
    int TotalTemplates,
    int ActiveTemplates,
    int TodaySent,
    int TodayFailed,
    int TodayQueued);
