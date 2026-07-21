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
public sealed record ChangeAppointmentNotesRequest(string? Notes);

/// <summary>
/// Kurum yöneticisi aksiyon kutusu: saati gelmiş (sonucu bekleyen) randevular + personelin onaya gönderdiği taslaklar.
/// </summary>
public sealed record AppointmentInboxDto(
    IReadOnlyCollection<AppointmentDto> AwaitingOutcome,
    IReadOnlyCollection<AppointmentDto> AwaitingApproval);
