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
    string? WhatsAppVerifyToken,
    // --- Ödeme (iyzico) --- anahtarların KENDİSİ dönmez, yalnız "tanımlı mı" bilgisi döner.
    bool PaymentsEnabled = false,
    string PaymentProvider = "Simulation",
    bool HasIyzicoApiKey = false,
    bool HasIyzicoSecretKey = false,
    string? IyzicoBaseUrl = null,
    string? PaymentsReturnUrl = null,
    bool PaymentsConfigured = false,
    // --- Chatwoot köprüsü --- anahtarın kendisi dönmez.
    bool HasChatwootWebhookSecret = false);

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
    string? WhatsAppVerifyToken = null,
    // --- Ödeme (iyzico) --- boş bırakılan anahtar mevcut değeri KORUR (SMS/WhatsApp ile aynı kural).
    bool PaymentsEnabled = false,
    string? PaymentProvider = null,
    string? IyzicoApiKey = null,
    string? IyzicoSecretKey = null,
    string? IyzicoBaseUrl = null,
    string? PaymentsReturnUrl = null,
    // --- Chatwoot köprüsü --- boş = mevcut anahtar KORUNUR (bu alanı bilmeyen istemcinin tam
    // değiştirmeli kaydı, ör. Maydanoz köprüsü, anahtarı silemez).
    string? ChatwootWebhookSecret = null);

public sealed record MessagingTestRequest(string Target);

public sealed record MessagingTestResult(bool Success, bool Simulated, string? ProviderMessageId, string? Error);

/// <summary>
/// Kurumun kendi SMS hesabının ÇÖZÜLMÜŞ kimlik bilgisi (yalnız gönderim anında, bellekte).
/// <see cref="ToString"/> parolayı yazmaz — kayıt/istisna metnine sızmasın.
/// </summary>
public sealed record SmsAccountCredentials(string Provider, string Username, string Password, string Sender)
{
    public override string ToString() => $"SmsAccountCredentials {{ Provider = {Provider}, Sender = {Sender} }}";
}
