namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform geneli (tenant'sız) SMS + e-posta gönderim ayarları — yalnızca PlatformAdmin yönetir.
/// Tüm kurumlar bu merkezi altyapı üzerinden mesaj gönderir. Gizli alanlar at-rest şifreli (ENC:v1:).
/// Tek satır (singleton): servis ilk erişimde yoksa oluşturur.
/// </summary>
public sealed class PlatformIntegrationSettings : Entity
{
    public PlatformIntegrationSettings() { }

    // --- SMS ---
    public bool SmsEnabled { get; private set; }
    public string SmsProvider { get; private set; } = "Simulation"; // Netgsm | Twilio | Simulation
    public string? SmsApiKeyEncrypted { get; private set; }     // Netgsm: usercode · Twilio: AccountSid
    public string? SmsApiSecretEncrypted { get; private set; }  // Netgsm: password · Twilio: AuthToken
    public string? SmsSender { get; private set; }              // başlık / gönderen no
    public string? SmsApiUrl { get; private set; }              // opsiyonel override

    // --- E-posta (SMTP) ---
    public bool EmailEnabled { get; private set; }
    public string? EmailFromAddress { get; private set; }
    public string? EmailFromName { get; private set; }
    public string? SmtpHost { get; private set; }
    public int SmtpPort { get; private set; } = 587;
    public string? SmtpUsername { get; private set; }
    public string? SmtpPasswordEncrypted { get; private set; }
    public bool SmtpUseSsl { get; private set; } = true;

    public bool SmsConfigured => !string.IsNullOrWhiteSpace(SmsApiKeyEncrypted) && !string.IsNullOrWhiteSpace(SmsSender);
    public bool EmailConfigured => !string.IsNullOrWhiteSpace(SmtpHost) && !string.IsNullOrWhiteSpace(EmailFromAddress);

    /// <param name="apiKeyEnc">null = mevcut korunur (form boş bırakıldıysa).</param>
    public void UpdateSms(bool enabled, string? provider, string? apiKeyEnc, string? apiSecretEnc, string? sender, string? apiUrl)
    {
        SmsEnabled = enabled;
        SmsProvider = string.IsNullOrWhiteSpace(provider) ? "Simulation" : provider.Trim();
        if (apiKeyEnc is not null) SmsApiKeyEncrypted = apiKeyEnc;
        if (apiSecretEnc is not null) SmsApiSecretEncrypted = apiSecretEnc;
        SmsSender = Clean(sender);
        SmsApiUrl = Clean(apiUrl);
        Touch();
    }

    /// <param name="passwordEnc">null = mevcut korunur.</param>
    public void UpdateEmail(bool enabled, string? fromAddress, string? fromName, string? host, int port, string? username, string? passwordEnc, bool useSsl)
    {
        EmailEnabled = enabled;
        EmailFromAddress = Clean(fromAddress);
        EmailFromName = Clean(fromName);
        SmtpHost = Clean(host);
        SmtpPort = port <= 0 ? 587 : port;
        SmtpUsername = Clean(username);
        if (passwordEnc is not null) SmtpPasswordEncrypted = passwordEnc;
        SmtpUseSsl = useSsl;
        Touch();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
