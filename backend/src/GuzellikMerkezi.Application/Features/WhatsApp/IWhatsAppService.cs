using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>Kuruma özel WhatsApp hatırlatma + 2 yönlü onay (Meta Cloud API / dev'de simülasyon).</summary>
public interface IWhatsAppService
{
    Task<Result<WhatsAppSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken cancellationToken = default);
    /// <summary>KURUM: yalnızca içerik (şablon) + faturalama tercihlerini kaydeder. Bağlantıyı platform yönetir.</summary>
    Task<Result<WhatsAppSettingsDto>> SaveSettingsAsync(Guid tenantId, SaveWhatsAppSettingsRequest request, CancellationToken cancellationToken = default);
    Task<Result<ReminderResultDto>> SendReminderAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<WhatsAppMessageDto>>> RecentMessagesAsync(Guid tenantId, Guid? appointmentId, CancellationToken cancellationToken = default);

    // --- PLATFORM: bağlantı yönetimi (tek Business Manager + tek token; kurum başına numara bağlanır) ---
    Task<Result<IReadOnlyCollection<WhatsAppConnectionDto>>> GetConnectionsAsync(CancellationToken cancellationToken = default);
    Task<Result<WhatsAppConnectionDto>> BindConnectionAsync(Guid tenantId, BindWhatsAppConnectionRequest request, CancellationToken cancellationToken = default);
    /// <summary>Platform: bir kuruma bağlı numaradan test mesajı göndererek bağlantıyı doğrular.</summary>
    Task<Result<ReminderResultDto>> SendTestMessageAsync(Guid tenantId, SendTestMessageRequest request, CancellationToken cancellationToken = default);

    /// <summary>Bekleme listesindeki müşteriye boşalan slot için "yer açıldı, ister misiniz? EVET/HAYIR" teklifi gönderir. Best-effort (feature/kota kapalıysa sessizce atlar).</summary>
    Task SendWaitlistOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default);

    /// <summary>Bekleme teklifi kabul edilip randevu açılınca "randevunuz aktifleşti" mesajı gönderir. Best-effort.</summary>
    Task SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);

    /// <summary>Randevu tamamlanınca müşteriye değerlendirme (personel + salon yıldızı) linkini gönderir. Best-effort.</summary>
    Task SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken cancellationToken = default);

    /// <summary>Meta webhook doğrulaması (GET). Eşleşen verify token varsa challenge döner.</summary>
    Task<string?> VerifyWebhookAsync(string? mode, string? verifyToken, string? challenge, CancellationToken cancellationToken = default);

    /// <summary>
    /// Meta webhook gelen mesaj gövdesi (POST) — tenant phone_number_id ile çözülür, yanıt yorumlanır.
    /// GÜVENLİK: gövde işlenmeden ÖNCE Meta imzası (X-Hub-Signature-256) app secret ile doğrulanır;
    /// geçersiz/eksik imza sessizce yok sayılır (forge edilmiş randevu iptali/onayı engellenir).
    /// </summary>
    /// <param name="signatureHeader">İstekteki <c>X-Hub-Signature-256</c> başlığı (ör. "sha256=abc...").</param>
    Task HandleInboundAsync(string payloadJson, string? signatureHeader, CancellationToken cancellationToken = default);
}
