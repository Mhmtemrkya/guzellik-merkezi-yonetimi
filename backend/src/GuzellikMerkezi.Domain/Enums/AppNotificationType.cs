namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Mobil/panel uygulama-içi bildirim türü (push + feed). Kanal yönlendirme ve deep-link için kullanılır.
/// JSON'da integer olarak serileştirilir (global JsonStringEnumConverter yok) — mobil DTO'lar int okur.
/// </summary>
public enum AppNotificationType
{
    General = 0,

    // Randevu
    AppointmentCreated = 1,
    AppointmentCancelled = 2,
    AppointmentUpdated = 3,
    AppointmentReminder = 4,

    // Onay akışı
    ApprovalPending = 10,

    // Bekleme listesi / online talep / WhatsApp
    WaitlistOffer = 20,
    OnlineBookingRequest = 21,
    WhatsAppReply = 22,

    // Güvenlik
    UnauthorizedDevice = 30,

    // Finans
    CashClosing = 40,
    PaymentDue = 41,

    // Raporlama
    MonthlyReport = 50,
}
