using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>Kurum yöneticisinin gördüğü WhatsApp ayarı: bağlantı DURUMU (salt-okunur, platform bağlar) + içerik + faturalama tercihleri.</summary>
public sealed record WhatsAppSettingsDto(
    bool Enabled,
    string? PhoneNumberId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    bool IsConnected,
    string? BusinessAccountId,
    string? ReminderTemplate,
    string Provider,
    string WebhookUrl,
    bool MarketingEnabled,
    bool AllowWalletOverage,
    decimal? MonthlySpendCapTry);

/// <summary>Kurum yöneticisi yalnızca içeriği ve faturalama tercihlerini kaydeder (bağlantıyı platform yönetir).</summary>
public sealed record SaveWhatsAppSettingsRequest(
    string? ReminderTemplate,
    bool MarketingEnabled = false,
    bool AllowWalletOverage = false,
    decimal? MonthlySpendCapTry = null);

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
    DateTime CreatedAtUtc,
    WhatsAppMessageCategory Category,
    WhatsAppBillingSource BillingSource,
    decimal ChargedAmountTry);

// --- Platform tarafı: bağlantı yönetimi ---

/// <summary>Platform admin'in "WhatsApp Bağlantıları" ekranında bir kurumun bağlantı durumu.</summary>
public sealed record WhatsAppConnectionDto(
    Guid TenantId,
    string TenantName,
    string? PlanName,
    string? PhoneNumberId,
    string? BusinessAccountId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    bool IsConnected,
    bool HasTokenOverride,
    string WebhookUrl);

public sealed record BindWhatsAppConnectionRequest(
    string? PhoneNumberId,
    string? BusinessAccountId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    string? VerifyToken,
    string? AccessTokenOverride);

public sealed record SendTestMessageRequest(string ToPhone, string? Text);
