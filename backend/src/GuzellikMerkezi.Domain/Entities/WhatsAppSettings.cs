using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma özel WhatsApp yapılandırması. YENİ MODEL: Meta bağlantısı (numara → phone_number_id / WABA) artık
/// PLATFORM tarafından bağlanır (tek Business Manager + tek sistem token'ı; token
/// <see cref="PlatformIntegrationSettings"/>'te). Kurum yalnızca içeriği (şablon metni), faturalama tercihlerini
/// (kampanya izni, kredi taşması, harcama tavanı) ve tek yönlü bildirimlerin kanalını (WhatsApp/SMS) yönetir.
/// Eski per-tenant token alanı geriye uyumluluk için
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
    /// <summary>
    /// Chatwoot köprüsü: bu numaranın Chatwoot'taki gelen kutusu kimliği. Meta webhook'u Chatwoot'a
    /// gittiğinde müşteri yanıtları (EVET/HAYIR/ONAYLIYORUM) Chatwoot'un webhook'uyla gelir; olaydaki
    /// gelen kutusu kimliği kurumu bulmanın TEK yoludur (Chatwoot yükü işletme numarasını taşımaz).
    /// </summary>
    public int? ChatwootInboxId { get; private set; }
    /// <summary>
    /// PAYLAŞIMLI NUMARA: true ise bu numaraya gelen mesajlardan yalnız BeautyAsist'in yakın zamanda mesaj
    /// gönderdiği kişilerin YANITLARI kurumun kaydına yazılır. Numara aynı zamanda başka bir işe (ör. canlı destek
    /// hattı) hizmet ediyorsa o konuşmalar salonun mesaj kaydına karışmaz. Salonun kendi numarasında false
    /// kalır (24 saat penceresi her gelen mesajın kaydına dayanır).
    /// </summary>
    public bool RecordRepliesOnly { get; private set; }

    // --- İçerik (KURUM yönetir) ---
    public string? ReminderTemplate { get; private set; }

    // --- Meta onaylı şablonlar (24 saat penceresi kapalıyken zorunlu) ---
    // Meta kuralı: müşteri son 24 saatte yazmadıysa serbest metin İLETİLMEZ; yalnızca önceden
    // onaylanmış şablonla mesaj gönderilebilir. Aşağıdaki adlar Meta panelinde oluşturulan
    // şablonların adıdır; boşsa serbest metin denenir (pencere açıksa sorunsuz çalışır).
    /// <summary>KVKK açık rıza isteği şablonu. Gövde: {{1}}=müşteri adı, {{2}}=kurum adı, {{3}}=metin linki.</summary>
    public string? KvkkTemplateName { get; private set; }
    /// <summary>Randevu hatırlatma şablonu. Gövde: {{1}}=ad, {{2}}=tarih, {{3}}=saat, {{4}}=hizmet, {{5}}=kurum.</summary>
    public string? ReminderTemplateName { get; private set; }
    /// <summary>Bekleme listesi teklifi ("yer açıldı"). Gövde: {{1}}=ad, {{2}}=tarih, {{3}}=saat, {{4}}=hizmet, {{5}}=kurum.</summary>
    public string? WaitlistOfferTemplateName { get; private set; }
    /// <summary>Bekleme listesinden randevu oluştu. Gövde: {{1}}=ad, {{2}}=tarih, {{3}}=saat, {{4}}=hizmet, {{5}}=kurum.</summary>
    public string? WaitlistActivatedTemplateName { get; private set; }
    /// <summary>Değerlendirme (yıldız) linki. Gövde: {{1}}=ad, {{2}}=kurum, {{3}}=link.</summary>
    public string? RatingTemplateName { get; private set; }
    /// <summary>Şablon dil kodu (Meta'da şablonun kayıtlı olduğu dil). Varsayılan "tr".</summary>
    public string TemplateLanguageCode { get; private set; } = "tr";

    // --- Faturalama tercihleri (KURUM yönetir, platform tavan koyar) ---
    // Mesaj kredisi cüzdanı WhatsApp ve SMS'in ORTAK bakiyesidir; bu tercihler ikisine birden uygulanır.
    /// <summary>WhatsApp kampanya (Marketing) mesajları açık mı? Varsayılan KAPALI — pahalı kategori istenmeden çalışmaz.</summary>
    public bool MarketingEnabled { get; private set; }
    /// <summary>Aylık kota bitince mesaj kredisinden devam edilsin mi (WhatsApp + SMS)? Varsayılan KAPALI — sürpriz harcama önlenir.</summary>
    public bool AllowWalletOverage { get; private set; }
    /// <summary>Aylık kredi harcama tavanı (WhatsApp + SMS toplamı). null = paket/platform varsayılanı kullanılır.</summary>
    public decimal? MonthlySpendCapCredits { get; private set; }

    /// <summary>ESKİ ₺ tavan (12 Kas 2026 kredi dönüşümü öncesi). Faturalama OKUMAZ.</summary>
    public decimal? MonthlySpendCapTry { get; private set; }

    // --- Tek yönlü bildirimlerin KANALI (KURUM seçer) ---
    // Varsayılan WhatsApp (eski davranış). SMS seçilirse mesaj platformun SMS hattından gider ve
    // plan SMS kotasından / mesaj kredisinden düşer. Yanıt bekleyen akışlar (Evet/Hayır, bekleme
    // teklifi, KVKK ONAYLIYORUM) WhatsApp'a bağlıdır ve burada YOKTUR.
    /// <summary>Randevu tamamlanınca giden değerlendirme (yıldız) linkinin kanalı.</summary>
    public NotificationChannel RatingLinkChannel { get; private set; } = NotificationChannel.WhatsApp;
    /// <summary>Bekleme listesinden randevu oluştu bildiriminin kanalı.</summary>
    public NotificationChannel WaitlistActivatedChannel { get; private set; } = NotificationChannel.WhatsApp;
    /// <summary>
    /// KVKK mesajının kanalı. WhatsApp: açık rıza isteği (müşteri ONAYLIYORUM yazar). SMS: yalnız
    /// aydınlatma metni LİNKİ gider — SMS'te yanıt işlenmediği için rıza bu yoldan ALINMAZ.
    /// </summary>
    public NotificationChannel KvkkChannel { get; private set; } = NotificationChannel.WhatsApp;

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

    /// <summary>PLATFORM: Chatwoot gelen kutusu kimliği; 0 ya da negatif = bağı kaldır.</summary>
    public void SetChatwootInbox(int inboxId)
    {
        ChatwootInboxId = inboxId > 0 ? inboxId : null;
        Touch();
    }

    /// <summary>PLATFORM: paylaşımlı numara → yalnız yanıtları kaydet (bkz. <see cref="RecordRepliesOnly"/>).</summary>
    public void SetRecordRepliesOnly(bool repliesOnly)
    {
        RecordRepliesOnly = repliesOnly;
        Touch();
    }

    /// <summary>KURUM: içerik (şablon metni). Bağlantıyı DEĞİŞTİRMEZ.</summary>
    public void UpdateContent(string? reminderTemplate)
    {
        ReminderTemplate = Clean(reminderTemplate);
        Touch();
    }

    /// <summary>KURUM: Meta'da onaylanmış şablon adları ve dil kodu (boş = serbest metin denenir).</summary>
    public void UpdateTemplateBindings(
        string? kvkkTemplateName,
        string? reminderTemplateName,
        string? languageCode,
        string? waitlistOfferTemplateName = null,
        string? waitlistActivatedTemplateName = null,
        string? ratingTemplateName = null)
    {
        KvkkTemplateName = Clean(kvkkTemplateName);
        ReminderTemplateName = Clean(reminderTemplateName);
        WaitlistOfferTemplateName = Clean(waitlistOfferTemplateName);
        WaitlistActivatedTemplateName = Clean(waitlistActivatedTemplateName);
        RatingTemplateName = Clean(ratingTemplateName);
        TemplateLanguageCode = Clean(languageCode) ?? "tr";
        Touch();
    }

    /// <summary>KURUM: faturalama tercihleri (tavan KREDİ cinsinden).</summary>
    public void UpdateBillingPreferences(bool marketingEnabled, bool allowWalletOverage, decimal? monthlySpendCapCredits)
    {
        MarketingEnabled = marketingEnabled;
        AllowWalletOverage = allowWalletOverage;
        MonthlySpendCapCredits = monthlySpendCapCredits is { } c && c >= 0 ? decimal.Round(c, 2) : null;
        Touch();
    }

    /// <summary>
    /// KURUM: tek yönlü bildirimlerin kanalı. Yalnız WhatsApp ve SMS geçerlidir — e-posta bu
    /// mesajlar için tanımlı değil (müşteride e-posta çoğu zaman yok, link telefonda açılıyor).
    /// </summary>
    public void UpdateChannelPreferences(NotificationChannel ratingLink, NotificationChannel waitlistActivated, NotificationChannel kvkk)
    {
        RatingLinkChannel = EnsurePhoneChannel(ratingLink);
        WaitlistActivatedChannel = EnsurePhoneChannel(waitlistActivated);
        KvkkChannel = EnsurePhoneChannel(kvkk);
        Touch();
    }

    private static NotificationChannel EnsurePhoneChannel(NotificationChannel channel) =>
        channel is NotificationChannel.WhatsApp or NotificationChannel.Sms
            ? channel
            : throw new Exceptions.DomainException("Bu bildirim için yalnız WhatsApp ya da SMS seçilebilir.");

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
