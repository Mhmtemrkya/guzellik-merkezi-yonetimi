using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Notifications;

/// <summary>Kurumun kanalını (WhatsApp / SMS) seçebildiği TEK YÖNLÜ bildirimler.</summary>
public enum OneWayMessageKind
{
    /// <summary>Randevu tamamlanınca değerlendirme (yıldız) linki.</summary>
    RatingLink,
    /// <summary>Bekleme listesinden randevu oluştu bildirimi.</summary>
    WaitlistActivated,
    /// <summary>KVKK — WhatsApp'ta açık rıza isteği, SMS'te yalnız aydınlatma metni linki.</summary>
    Kvkk,
}

/// <summary>Hediye çekini SMS ile gönderme isteği (kod + geçerlilik; PDF SMS'le gitmez).</summary>
/// <param name="Phone">Boşsa karta bağlı müşterinin kayıtlı numarası kullanılır.</param>
public sealed record SendGiftCardSmsRequest(Guid GiftCardId, string? Phone);

/// <summary>Elle gönderilen SMS'in sonucu (kullanıcıya gösterilir). Personel görüntülüyorsa numara maskelidir.</summary>
public sealed record SmsSendResultDto(
    bool Sent,
    bool Simulated,
    string ToPhone,
    string Body,
    int Parts,
    decimal ChargedCredits,
    string? Error);

/// <summary>
/// MÜŞTERİYE TEK YÖNLÜ, LİNKLİ SİSTEM SMS'LERİ — puanlama linki, bekleme listesi "randevu
/// oluştu" bildirimi, KVKK aydınlatma linki, hediye çeki kodu.
///
/// <para>
/// Metni akışa göre kurar, gönderimi <see cref="INotificationService.SendSystemSmsAsync"/>'e
/// bırakır: kayıt sağlayıcıdan ÖNCE yazılır, plan SMS kotası / mesaj kredisi orada düşer, sonuç ve
/// kredi aynı kayıtta kapanır. Yanıt bekleyen akışlar (Evet/Hayır, bekleme teklifi, KVKK
/// ONAYLIYORUM) burada YOKTUR — SMS'te yanıt işlenmez.
/// </para>
/// </summary>
public interface ICustomerSmsService
{
    /// <summary>Kurumun bu bildirim için seçtiği kanal. Ayar yoksa WhatsApp (eski davranış).</summary>
    Task<NotificationChannel> ResolveChannelAsync(Guid tenantId, OneWayMessageKind kind, CancellationToken ct = default);

    Task<WhatsAppDispatchReport> SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken ct = default);

    Task<WhatsAppDispatchReport> SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default);

    /// <summary>
    /// KVKK aydınlatma metni LİNKİ. Açık rıza bu yoldan ALINMAZ (SMS yanıtı işlenmez); müşteri zaten
    /// onay verdiyse gönderilmez.
    /// </summary>
    Task<WhatsAppDispatchReport> SendKvkkInfoAsync(Guid tenantId, Guid customerId, CancellationToken ct = default);

    /// <summary>
    /// Hediye çekinin kodunu SMS ile gönderir (elle). WhatsApp gönderimiyle AYNI doğrulamalar:
    /// kart bu kurumun ve kullanıcının şubesinin, geçerli; müşteriye bağlıysa yalnız o müşterinin
    /// kayıtlı numarasına.
    /// </summary>
    Task<Result<SmsSendResultDto>> SendGiftCardAsync(Guid tenantId, SendGiftCardSmsRequest request, CancellationToken ct = default);
}
