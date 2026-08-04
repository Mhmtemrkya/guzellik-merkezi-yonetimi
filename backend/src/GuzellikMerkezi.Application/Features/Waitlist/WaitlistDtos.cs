using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Waitlist;

public sealed record WaitlistEntryDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid CustomerId,
    Guid? ServiceDefinitionId,
    Guid? StaffMemberId,
    DateOnly PreferredDate,
    WaitlistStatus Status,
    string? Note,
    DateTime CreatedAtUtc,
    DateTime? PreferredStartUtc,
    int? DurationMinutes,
    /// <summary>Randevu ekranında seçilmiş paket/seans — yer açıldığında randevu buna bağlanır.</summary>
    Guid? SourceCustomerPackageSessionId = null,
    string? CustomerName = null,
    string? CustomerPhone = null,
    string? ServiceName = null,
    string? StaffName = null);

public sealed record CreateWaitlistRequest(
    Guid CustomerId,
    Guid? ServiceDefinitionId,
    Guid? StaffMemberId,
    DateOnly PreferredDate,
    string? Note,
    Guid? BranchId,
    DateTime? PreferredStartUtc = null,
    int? DurationMinutes = null,
    /// <summary>
    /// Randevu ekranında seçilmiş paket/seans. Slot dolu çıkınca kayıt bekleme listesine düşer;
    /// bu alan taşınmazsa yer açıldığında aynı hizmetin EN ESKİ seansı tüketilir (yanlış paket).
    /// </summary>
    Guid? SourceCustomerPackageSessionId = null);

public sealed record UpdateWaitlistStatusRequest(WaitlistStatus Status);

/// <summary>Bekleme kaydını belirli bir gün/saate randevuya çevirme isteği (yönetici "Randevu oluştur" akışı).</summary>
public sealed record ScheduleWaitlistRequest(
    DateTime StartUtc,
    int? DurationMinutes = null,
    Guid? StaffMemberId = null,
    Guid? ServiceDefinitionId = null);
