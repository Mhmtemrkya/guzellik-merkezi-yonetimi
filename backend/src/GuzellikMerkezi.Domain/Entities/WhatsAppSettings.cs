namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma özel WhatsApp (Meta Cloud API) bağlantı ayarları — müşteriye randevu hatırlatması göndermek ve
/// gelen yanıtları (webhook) almak için. Erişim token'ı at-rest şifreli (ENC:v1:) saklanır.
/// </summary>
public sealed class WhatsAppSettings : Entity
{
    private WhatsAppSettings() { }

    public WhatsAppSettings(Guid tenantId)
    {
        TenantId = tenantId;
    }

    public Guid TenantId { get; private set; }
    public bool Enabled { get; private set; }
    public string? PhoneNumberId { get; private set; }
    public string? AccessTokenEncrypted { get; private set; }
    public string? BusinessAccountId { get; private set; }
    public string? VerifyToken { get; private set; }
    public string? ReminderTemplate { get; private set; }
    public string Provider { get; private set; } = "Meta";

    /// <summary>Gerçek gönderim için yeterli kimlik bilgisi var mı? Yoksa simülasyon kullanılır.</summary>
    public bool HasCredentials => !string.IsNullOrWhiteSpace(PhoneNumberId) && !string.IsNullOrWhiteSpace(AccessTokenEncrypted);

    /// <param name="accessTokenEncrypted">null ise mevcut token korunur (formda boş bırakılırsa değişmesin).</param>
    public void Update(bool enabled, string? phoneNumberId, string? accessTokenEncrypted, string? businessAccountId, string? verifyToken, string? reminderTemplate)
    {
        Enabled = enabled;
        PhoneNumberId = Clean(phoneNumberId);
        if (accessTokenEncrypted is not null) AccessTokenEncrypted = accessTokenEncrypted;
        BusinessAccountId = Clean(businessAccountId);
        VerifyToken = Clean(verifyToken);
        ReminderTemplate = Clean(reminderTemplate);
        Touch();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
