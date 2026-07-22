namespace GuzellikMerkezi.Application.Features.PlatformMessaging;

public sealed record PlatformIntegrationSettingsDto(
    bool SmsEnabled,
    string SmsProvider,
    bool HasSmsApiKey,
    bool HasSmsApiSecret,
    string? SmsSender,
    string? SmsApiUrl,
    bool SmsConfigured,
    bool EmailEnabled,
    string? EmailFromAddress,
    string? EmailFromName,
    string? SmtpHost,
    int SmtpPort,
    string? SmtpUsername,
    bool HasSmtpPassword,
    bool SmtpUseSsl,
    bool EmailConfigured,
    // --- WhatsApp (Meta Cloud API) ---
    bool WhatsAppEnabled,
    string WhatsAppProvider,
    string? WhatsAppPhoneNumberId,
    bool HasWhatsAppAccessToken,
    string? WhatsAppBusinessAccountId,
    bool WhatsAppConfigured,
    bool HasWhatsAppAppSecret,
    string? WhatsAppVerifyToken);

public sealed record SavePlatformMessagingRequest(
    bool SmsEnabled,
    string? SmsProvider,
    string? SmsApiKey,
    string? SmsApiSecret,
    string? SmsSender,
    string? SmsApiUrl,
    bool EmailEnabled,
    string? EmailFromAddress,
    string? EmailFromName,
    string? SmtpHost,
    int SmtpPort,
    string? SmtpUsername,
    string? SmtpPassword,
    bool SmtpUseSsl,
    // --- WhatsApp (Meta Cloud API) ---
    bool WhatsAppEnabled = false,
    string? WhatsAppProvider = null,
    string? WhatsAppPhoneNumberId = null,
    string? WhatsAppAccessToken = null,
    string? WhatsAppBusinessAccountId = null,
    string? WhatsAppAppSecret = null,
    string? WhatsAppVerifyToken = null);

public sealed record MessagingTestRequest(string Target);

public sealed record MessagingTestResult(bool Success, bool Simulated, string? ProviderMessageId, string? Error);
