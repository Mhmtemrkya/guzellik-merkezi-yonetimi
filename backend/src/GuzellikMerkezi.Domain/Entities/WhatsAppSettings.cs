using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma özel WhatsApp yapılandırması. YENİ MODEL: Meta bağlantısı (numara → phone_number_id / WABA) artık
/// PLATFORM tarafından bağlanır (tek Business Manager + tek sistem token'ı; token
/// <see cref="PlatformIntegrationSettings"/>'te). Kurum yalnızca içeriği (şablon metni) ve faturalama tercihlerini
/// (kampanya izni, kontör taşması, harcama tavanı) yönetir. Eski per-tenant token alanı geriye uyumluluk için
/// korunur ama artık gönderim platform token'ıyla yapılır.
/// </summary>
public sealed class WhatsAppSettings : Entity
{
    private WhatsAppSettings() { }

    public WhatsAppSettings(Guid tenantId)
    {
        TenantId = tenantId;
    }

    public Guid TenantId { get; private set; }

    // --- Bağlantı (PLATFORM yönetir) ---
    public bool Enabled { get; private set; }
    public string? PhoneNumberId { get; private set; }
    public string? BusinessAccountId { get; private set; }   // WABA id
    /// <summary>Müşteriye görünen numara (ör. +90 555 ...), gösterim amaçlı.</summary>
    public string? DisplayPhoneNumber { get; private set; }
    public WhatsAppConnectionStatus ConnectionStatus { get; private set; } = WhatsAppConnectionStatus.NotConnected;
    /// <summary>Kuruma özel token (opsiyonel override). Boşsa platform sistem token'ı kullanılır.</summary>
    public string? AccessTokenEncrypted { get; private set; }
    public string? VerifyToken { get; private set; }
    public string Provider { get; private set; } = "Meta";

    // --- İçerik (KURUM yönetir) ---
    public string? ReminderTemplate { get; private set; }

    // --- Faturalama tercihleri (KURUM yönetir, platform tavan koyar) ---
    /// <summary>Kampanya (Marketing) mesajları açık mı? Varsayılan KAPALI — pahalı kategori istenmeden çalışmaz.</summary>
    public bool MarketingEnabled { get; private set; }
    /// <summary>Aylık kota bitince kontör bakiyesinden devam edilsin mi? Varsayılan KAPALI — sürpriz fatura önlenir.</summary>
    public bool AllowWalletOverage { get; private set; }
    /// <summary>Aylık kontör harcama tavanı (₺). null = platform varsayılanı kullanılır.</summary>
    public decimal? MonthlySpendCapTry { get; private set; }

    /// <summary>Canlı gönderim için bağlantı hazır mı? (Numara bağlı ve durum Connected.)</summary>
    public bool IsConnected => ConnectionStatus == WhatsAppConnectionStatus.Connected && !string.IsNullOrWhiteSpace(PhoneNumberId);

    /// <summary>Geriye uyumluluk: eski kod "HasCredentials" ile gerçek gönderim kontrolü yapıyordu.</summary>
    public bool HasCredentials => IsConnected;

    /// <summary>PLATFORM: kurumun Meta numarasını bağlar (phone_number_id + WABA + görünen numara).</summary>
    public void BindConnection(string? phoneNumberId, string? businessAccountId, string? displayPhoneNumber, WhatsAppConnectionStatus status, string? verifyToken = null)
    {
        PhoneNumberId = Clean(phoneNumberId);
        BusinessAccountId = Clean(businessAccountId);
        DisplayPhoneNumber = Clean(displayPhoneNumber);
        ConnectionStatus = status;
        VerifyToken = Clean(verifyToken) ?? VerifyToken;
        Enabled = status == WhatsAppConnectionStatus.Connected;
        Touch();
    }

    public void SetConnectionStatus(WhatsAppConnectionStatus status)
    {
        ConnectionStatus = status;
        Enabled = status == WhatsAppConnectionStatus.Connected;
        Touch();
    }

    /// <summary>PLATFORM: opsiyonel kuruma özel token (boş = platform token'ı kullan).</summary>
    public void SetAccessTokenOverride(string? accessTokenEncrypted)
    {
        if (accessTokenEncrypted is not null) AccessTokenEncrypted = accessTokenEncrypted;
        Touch();
    }

    /// <summary>KURUM: içerik (şablon metni). Bağlantıyı DEĞİŞTİRMEZ.</summary>
    public void UpdateContent(string? reminderTemplate)
    {
        ReminderTemplate = Clean(reminderTemplate);
        Touch();
    }

    /// <summary>KURUM: faturalama tercihleri.</summary>
    public void UpdateBillingPreferences(bool marketingEnabled, bool allowWalletOverage, decimal? monthlySpendCapTry)
    {
        MarketingEnabled = marketingEnabled;
        AllowWalletOverage = allowWalletOverage;
        MonthlySpendCapTry = monthlySpendCapTry is { } c && c >= 0 ? decimal.Round(c, 2) : null;
        Touch();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
