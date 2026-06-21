using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

public sealed record WhatsAppSettingsDto(
    bool Enabled,
    string? PhoneNumberId,
    bool HasAccessToken,
    string? BusinessAccountId,
    string? VerifyToken,
    string? ReminderTemplate,
    string Provider,
    string WebhookUrl,
    bool Configured);

public sealed record SaveWhatsAppSettingsRequest(
    bool Enabled,
    string? PhoneNumberId,
    string? AccessToken,
    string? BusinessAccountId,
    string? VerifyToken,
    string? ReminderTemplate);

public sealed record ReminderResultDto(
    bool Sent,
    bool Simulated,
    string ToPhone,
    string Body,
    string? ProviderMessageId,
    string? Error);

public sealed record WhatsAppMessageDto(
    Guid Id,
    Guid? AppointmentId,
    Guid? CustomerId,
    WhatsAppMessageDirection Direction,
    string Phone,
    string Body,
    WhatsAppMessageStatus Status,
    WhatsAppReplyIntent Intent,
    string? ProviderMessageId,
    string? ErrorMessage,
    DateTime CreatedAtUtc);
