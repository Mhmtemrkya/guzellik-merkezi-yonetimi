using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Notifications;

public sealed record NotificationTemplateDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status,
    int TotalSentCount,
    DateTime? LastSentAtUtc,
    DateTime CreatedAtUtc);

public sealed record CreateNotificationTemplateRequest(
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status);

public sealed record UpdateNotificationTemplateRequest(
    Guid? BranchId,
    string Name,
    NotificationChannel Channel,
    NotificationTrigger Trigger,
    string Body,
    NotificationTemplateStatus Status);

public sealed record NotificationLogDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid? TemplateId,
    string? TemplateName,
    Guid? CustomerId,
    string? CustomerName,
    NotificationChannel Channel,
    string Recipient,
    string Body,
    NotificationLogStatus Status,
    string? ErrorMessage,
    DateTime? SentAtUtc,
    DateTime CreatedAtUtc,
    /// <summary>Şablonsuz sistem mesajının amacı ("rating-link", "kvkk-info"…); şablonlu gönderimde null.</summary>
    string? Purpose = null,
    /// <summary>Ücretin kaynağı (kota / kredi / simülasyon). Eski satırlarda None.</summary>
    WhatsAppBillingSource BillingSource = WhatsAppBillingSource.None,
    /// <summary>Krediden düşülen (iade edildiyse 0).</summary>
    decimal ChargedCredits = 0m,
    /// <summary>SMS parça sayısı (SMS dışı kanallarda 0).</summary>
    int SmsParts = 0);

/// <summary>
/// ŞABLONSUZ SİSTEM SMS'İ isteği — puanlama linki, bekleme listesi bildirimi, KVKK aydınlatma
/// linki, hediye çeki kodu. Gövde ÇAĞIRAN tarafından hazırlanır (metin akışa özeldir).
/// </summary>
/// <param name="Purpose">Bildirim geçmişinde görünen amaç anahtarı (ör. "rating-link").</param>
/// <param name="DedupeKey">
/// Verilirse aynı anahtar ikinci kez GÖNDERİLMEZ (iş kuyruğu yeniden denediğinde müşteriye
/// mükerrer SMS gitmesin). Elle gönderimde kısa bir zaman kovası taşır (çift tıklama koruması).
/// </param>
public sealed record SystemSmsRequest(
    Guid TenantId,
    Guid? BranchId,
    Guid? CustomerId,
    string Phone,
    string Body,
    string Purpose,
    string? DedupeKey);

public enum SystemSmsStatus
{
    /// <summary>Sağlayıcı kabul etti.</summary>
    Sent,
    /// <summary>Aynı anahtarla gönderim zaten yapılmış/işleniyor — tekrar GÖNDERİLMEDİ.</summary>
    AlreadyHandled,
    /// <summary>Kota/kredi/tavan izin vermedi — sağlayıcıya gidilmedi (sebep Error'da).</summary>
    Blocked,
    /// <summary>Sağlayıcı reddetti ya da yapılandırılmamış (simülasyon) — sebep Error'da.</summary>
    Failed,
}

public sealed record SystemSmsOutcome(
    SystemSmsStatus Status,
    string Body,
    int Parts,
    decimal ChargedCredits,
    bool Simulated,
    string? Error);

/// <summary>
/// Bir şablonu belirli müşterilere gönderir. CustomerIds boşsa Audience'a göre toplu kitle bulunur.
/// </summary>
public sealed record SendNotificationRequest(
    Guid TemplateId,
    IReadOnlyCollection<Guid>? CustomerIds,
    /// <summary>"all" | "active90" | "birthdayWeek" | "inactive30" — boşsa "all"</summary>
    string? Audience,
    /// <summary>
    /// OTOMATİK GÖNDERİMİN ZAMAN KOVASI (ör. <c>"20260806"</c> ya da <c>"2026"</c>).
    /// Verilirse her müşteri için "şablon + müşteri + kova" anahtarı üretilir; sağlayıcıya
    /// gitmeden ÖNCE rezerve edilir ve benzersiz indeks ikinci gönderimi eler (bkz.
    /// <c>NotificationLog.DedupeKey</c>). ELLE gönderimde boştur: yönetici aynı mesajı bilerek
    /// tekrar gönderebilmelidir.
    /// </summary>
    string? DedupeBucket = null);

/// <summary>
/// Gönderim ÖNCESİ özet: kaç kişiye gidecek, kaç SMS parçası, kotadan/krediden ne düşecek ve
/// gönderimi kısıtlayan durumlar. Kesin karar gönderimde verilir (eşzamanlı gönderimler araya girebilir).
/// </summary>
public sealed record NotificationSendEstimateDto(
    NotificationChannel Channel,
    /// <summary>WhatsApp'ta Meta faturalama sınıfı: hatırlatma/ödeme dışındaki her şey kampanyadır.</summary>
    bool Marketing,
    /// <summary>Kitledeki müşteri.</summary>
    int Recipients,
    /// <summary>Telefonu (SMS/WhatsApp) ya da e-postası olan.</summary>
    int Reachable,
    int TotalSmsParts,
    int MaxSmsParts,
    /// <summary>Plan kotasında kalan mesaj; -1 sınırsız.</summary>
    int QuotaRemaining,
    int QuotaCovered,
    int CreditMessages,
    decimal CreditsNeeded,
    decimal AvailableCredits,
    decimal CostPerUnit,
    int ExpectedToSend,
    bool Live,
    IReadOnlyList<string> Warnings,
    /// <summary>İlk alıcıya göre doldurulmuş örnek metin.</summary>
    string SampleBody,
    string? SampleRecipientName,
    /// <summary>SMS kurumun KENDİ hesabından gidecek: kota/kredi düşmez, ücreti sağlayıcısı keser.</summary>
    bool OwnAccount = false);

public sealed record SendNotificationResultDto(
    int Sent,
    int Failed,
    int Skipped,
    IReadOnlyCollection<NotificationLogDto> Logs);

public sealed record NotificationSummaryDto(
    int TotalTemplates,
    int ActiveTemplates,
    int TodaySent,
    int TodayFailed,
    int TodayQueued);
