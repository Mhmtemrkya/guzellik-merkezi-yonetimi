using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Appointments;

public sealed record AppointmentDto(
    Guid Id,
    Guid TenantId,
    Guid BranchId,
    Guid CustomerId,
    Guid StaffMemberId,
    Guid ServiceDefinitionId,
    DateTime StartUtc,
    DateTime EndUtc,
    AppointmentStatus Status,
    decimal Price,
    string? Notes,
    string? CancellationReason,
    string? CustomerName = null,
    string? StaffName = null,
    string? ServiceName = null,
    WhatsAppConfirmationStatus CustomerConfirmation = WhatsAppConfirmationStatus.None,
    DateTime? LastReminderAtUtc = null,
    bool IsOnline = false,
    string? CustomerPhone = null,
    bool CustomerIsVip = false,
    int? Number = null);
public sealed record CreateAppointmentRequest(Guid BranchId, Guid CustomerId, Guid StaffMemberId, Guid ServiceDefinitionId, DateTime StartUtc, DateTime EndUtc, decimal Price, string? Notes);
/// <summary>Sürükle-bırak taşıma: yeni zaman + (opsiyonel) yeni personel (farklı sütuna bırakınca).</summary>
public sealed record RescheduleAppointmentRequest(DateTime StartUtc, DateTime EndUtc, Guid? StaffMemberId = null);
public sealed record ChangeAppointmentStatusRequest(AppointmentStatus Status, string? Reason);

/// <summary>
/// Randevuyu tamamlar ve (verilirse) tahsilatı AYNI TRANSACTION'DA alır.
///
/// Ekran eskiden iki ayrı HTTP çağrısı yapıyordu: önce "Tamamlandı", sonra tahsilat. İkinci çağrı
/// düşerse randevu tamamlanmış (seans tüketilmiş) ama parası alınmamış hâlde kalıyordu ve
/// idempotency anahtarı bunu çözmüyordu — tekrar denemeyi güvenli kılıyor, atomikliği sağlamıyordu.
/// </summary>
public sealed record CompleteAppointmentRequest(string? Reason, CompleteAppointmentPaymentDto? Payment);

/// <summary>
/// Randevu tamamlanırken alınacak tahsilat. <paramref name="AccountId"/> verilmezse müşterinin
/// borcu olan en eski carisi seçilir; cari yoksa açık adisyon üzerinden tahsil edilir.
/// </summary>
public sealed record CompleteAppointmentPaymentDto(
    decimal Amount,
    string? Method,
    string? Reference,
    Guid? AccountId,
    DateTime? OccurredAtUtc);
public sealed record ChangeAppointmentNotesRequest(string? Notes);

/// <summary>
/// Randevu düzenleme ekranının TEK isteği: zaman + durum + not birlikte, TEK transaction'da.
/// <para>
/// Ekran "Kaydet"te üç ayrı uç çağırıyordu (reschedule → status → notes). Ortadaki başarılı olup
/// sonraki patlarsa randevu tamamlanmış ve seans düşmüş oluyor ama arayüz "kaydedilemedi" diyor;
/// kullanıcı tekrar deneyerek karışıklık üretiyordu. Null bırakılan alan DEĞİŞTİRİLMEZ.
/// </para>
/// </summary>
public sealed record UpdateAppointmentRequest(
    DateTime? StartUtc = null,
    DateTime? EndUtc = null,
    Guid? StaffMemberId = null,
    AppointmentStatus? Status = null,
    string? StatusReason = null,
    bool NotesProvided = false,
    string? Notes = null);

/// <summary>
/// Kurum yöneticisi aksiyon kutusu: saati gelmiş (sonucu bekleyen) randevular + personelin onaya gönderdiği taslaklar.
/// </summary>
public sealed record AppointmentInboxDto(
    IReadOnlyCollection<AppointmentDto> AwaitingOutcome,
    IReadOnlyCollection<AppointmentDto> AwaitingApproval);
