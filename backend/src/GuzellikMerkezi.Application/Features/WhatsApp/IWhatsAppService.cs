using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>
/// "BEST-EFFORT" GÖNDERİMİN KUYRUĞA VERDİĞİ CEVAP.
///
/// <para>
/// Bu yollar eskiden <c>Task</c> döndürüp her hatayı yutuyordu: kalıcı iş kuyruğu handler'ı sorunsuz
/// bittiği için işi BAŞARILI kapatıyor, sağlayıcının reddettiği ya da hiç gönderilemeyen KVKK
/// isteği / bekleme teklifi / değerlendirme linki hiç yeniden denenmeden kayboluyordu. Sonucu
/// döndürmek, "atlandı" ile "gönderilemedi" ayrımını kuyruğun görebileceği tek yer.
/// </para>
/// </summary>
public enum WhatsAppDispatchOutcome
{
    /// <summary>Gönderildi (ya da simülasyonda gönderilmiş sayıldı) — iş tamamdır.</summary>
    Sent,

    /// <summary>
    /// BİLEREK atlandı: kayıt/telefon yok, müşteri zaten onaylamış, özellik pakette yok, kota/kontör
    /// bitmiş. Tekrar denemek aynı sonucu verir — iş başarılı kapanmalıdır.
    /// </summary>
    Skipped,

    /// <summary>Gönderilemedi (sağlayıcı reddetti ya da hata fırlattı) — kuyruk YENİDEN DENEMELİ.</summary>
    Failed,
}

/// <param name="Error">Yalnız <see cref="WhatsAppDispatchOutcome.Failed"/>'de dolu; dead-letter kaydında görünür.</param>
public readonly record struct WhatsAppDispatchReport(WhatsAppDispatchOutcome Outcome, string? Error = null)
{
    public static readonly WhatsAppDispatchReport Sent = new(WhatsAppDispatchOutcome.Sent);
    public static readonly WhatsAppDispatchReport Skipped = new(WhatsAppDispatchOutcome.Skipped);
    public static WhatsAppDispatchReport Failed(string? error) => new(WhatsAppDispatchOutcome.Failed, error);

    public bool ShouldRetry => Outcome == WhatsAppDispatchOutcome.Failed;
}

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
    Task<WhatsAppDispatchReport> SendWaitlistOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// KVKK açık rıza isteği gönderir. Müşteri "ONAYLIYORUM" yazarsa gelen mesaj webhook'unda
    /// onay otomatik işlenir (bkz. ProcessInboundMessageAsync → kvkk-consent).
    /// </summary>
    Task<WhatsAppDispatchReport> SendKvkkConsentRequestAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    /// <summary>Bekleme teklifi kabul edilip randevu açılınca "randevunuz aktifleşti" mesajı gönderir. Best-effort.</summary>
    Task<WhatsAppDispatchReport> SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);

    /// <summary>Randevu tamamlanınca müşteriye değerlendirme (personel + salon yıldızı) linkini gönderir. Best-effort.</summary>
    Task<WhatsAppDispatchReport> SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken cancellationToken = default);

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
