using GuzellikMerkezi.Domain.Exceptions;
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

    // --- WhatsApp (Meta Cloud API) — platform geneli; müşteri OTP/2FA kodu buradan gider ---
    // YENİ: Tek Business Manager + tek sistem token'ı tüm kurumların numaralarını yönetir. Kuruma özel
    // phone_number_id WhatsAppSettings'te; buradaki token BM altındaki tüm numaralara gönderim yapar.
    public bool WhatsAppEnabled { get; private set; }
    public string WhatsAppProvider { get; private set; } = "Meta";
    public string? WhatsAppPhoneNumberId { get; private set; }          // platform kendi numarası (OTP/genel)
    public string? WhatsAppAccessTokenEncrypted { get; private set; }   // BM sistem kullanıcısı kalıcı token'ı
    public string? WhatsAppBusinessAccountId { get; private set; }      // platform WABA id
    /// <summary>Meta App Secret (webhook X-Hub-Signature-256 doğrulaması). DB'de yoksa config'e düşülür.</summary>
    public string? WhatsAppAppSecretEncrypted { get; private set; }
    /// <summary>Webhook doğrulama token'ı (Meta panelinde girilen hub.verify_token).</summary>
    public string? WhatsAppVerifyToken { get; private set; }

    // --- Ödeme (iyzico) — abonelik tahsilatı; yalnızca PlatformAdmin girer ---
    // Anahtarlar at-rest şifreli tutulur (ENC:v1:) ve HİÇBİR okuma ucunda düz metin dönmez;
    // arayüz yalnızca "tanımlı mı" bilgisini görür (bkz. PaymentsConfigured).
    public bool PaymentsEnabled { get; private set; }

    /// <summary>Iyzico | Simulation. Simülasyon: gerçek çekim yapmadan akışı uçtan uca denemek için.</summary>
    public string PaymentProvider { get; private set; } = "Simulation";

    public string? IyzicoApiKeyEncrypted { get; private set; }
    public string? IyzicoSecretKeyEncrypted { get; private set; }

    /// <summary>Sandbox: https://sandbox-api.iyzipay.com · Canlı: https://api.iyzipay.com</summary>
    public string? IyzicoBaseUrl { get; private set; }

    /// <summary>
    /// 3D Secure dönüşünde kullanıcının yönlendirileceği panel adresi (ör. https://panel.../admin/paket).
    /// Callback ucu sonucu işleyip kullanıcıyı buraya geri gönderir.
    /// </summary>
    public string? PaymentsReturnUrl { get; private set; }

    public bool SmsConfigured => !string.IsNullOrWhiteSpace(SmsApiKeyEncrypted) && !string.IsNullOrWhiteSpace(SmsSender);

    /// <summary>Gerçek çekim yapılabilir mi? Simülasyon sağlayıcısında anahtar aranmaz.</summary>
    public bool PaymentsConfigured =>
        string.Equals(PaymentProvider, "Simulation", StringComparison.OrdinalIgnoreCase)
        || (!string.IsNullOrWhiteSpace(IyzicoApiKeyEncrypted) && !string.IsNullOrWhiteSpace(IyzicoSecretKeyEncrypted));
    public bool EmailConfigured => !string.IsNullOrWhiteSpace(SmtpHost) && !string.IsNullOrWhiteSpace(EmailFromAddress);
    /// <summary>Platform sistem token'ı tanımlı mı? Kurumların numaralarına gönderim bunu kullanır.</summary>
    public bool WhatsAppConfigured => !string.IsNullOrWhiteSpace(WhatsAppAccessTokenEncrypted);

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

    /// <param name="accessTokenEnc">null = mevcut korunur (form boş bırakıldıysa).</param>
    /// <param name="appSecretEnc">null = mevcut korunur.</param>
    public void UpdateWhatsApp(bool enabled, string? provider, string? phoneNumberId, string? accessTokenEnc, string? businessAccountId,
        string? appSecretEnc = null, string? verifyToken = null)
    {
        WhatsAppEnabled = enabled;
        WhatsAppProvider = string.IsNullOrWhiteSpace(provider) ? "Meta" : provider.Trim();
        WhatsAppPhoneNumberId = Clean(phoneNumberId);
        if (accessTokenEnc is not null) WhatsAppAccessTokenEncrypted = accessTokenEnc;
        WhatsAppBusinessAccountId = Clean(businessAccountId);
        if (appSecretEnc is not null) WhatsAppAppSecretEncrypted = appSecretEnc;
        WhatsAppVerifyToken = Clean(verifyToken);
        Touch();
    }

    /// <param name="apiKeyEnc">null = mevcut korunur (form boş bırakıldıysa).</param>
    /// <param name="secretKeyEnc">null = mevcut korunur.</param>
    /// <summary>Tanınan ödeme sağlayıcıları. Yeni sağlayıcı eklenirken buraya AÇIKÇA yazılır.</summary>
    public static readonly IReadOnlyList<string> KnownPaymentProviders = ["Simulation", "Iyzico"];

    public void UpdatePayments(bool enabled, string? provider, string? apiKeyEnc, string? secretKeyEnc, string? baseUrl, string? returnUrl)
    {
        PaymentsEnabled = enabled;

        // SAĞLAYICI ADI KAYIT ANINDA DOĞRULANIR.
        //
        // Serbest metin kabul edilirken bir yazım hatası ("Iyzıco", "iyzipay") çözümleyicide
        // "Iyzico değil" sayılıp SESSİZCE simülasyona düşüyordu: üretimde para çekilmeden abonelik
        // "ödendi" oluyordu. Hata artık ayarların kaydedildiği anda, anlaşılır biçimde verilir.
        var normalized = string.IsNullOrWhiteSpace(provider) ? "Simulation" : provider.Trim();
        var known = KnownPaymentProviders.FirstOrDefault(p => string.Equals(p, normalized, StringComparison.OrdinalIgnoreCase));
        if (known is null)
        {
            throw new DomainException(
                $"Tanınmayan ödeme sağlayıcısı: '{normalized}'. Geçerli değerler: {string.Join(", ", KnownPaymentProviders)}.");
        }
        // Kanonik yazımla saklanır — büyük/küçük harf farkları aşağı akışta karşılaştırmaları bozmasın.
        PaymentProvider = known;
        if (apiKeyEnc is not null) IyzicoApiKeyEncrypted = apiKeyEnc;
        if (secretKeyEnc is not null) IyzicoSecretKeyEncrypted = secretKeyEnc;
        IyzicoBaseUrl = Clean(baseUrl);
        PaymentsReturnUrl = Clean(returnUrl);
        Touch();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
