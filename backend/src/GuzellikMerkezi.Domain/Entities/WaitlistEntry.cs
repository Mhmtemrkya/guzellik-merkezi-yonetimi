using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bekleme listesi kaydı — dolu bir slota (tarih+saat+personel) randevu almak isteyen müşteri.
/// Yer açıldığında (iptal vb.) sıradakine WhatsApp'tan teklif edilir. Statü
/// Waiting → Notified(teklif gönderildi) → Booked/Cancelled akışını izler.
/// </summary>
public sealed class WaitlistEntry : Entity
{
    private WaitlistEntry() { }

    public WaitlistEntry(
        Guid tenantId,
        Guid? branchId,
        Guid customerId,
        Guid? serviceDefinitionId,
        Guid? staffMemberId,
        DateOnly preferredDate,
        string? note,
        DateTime? preferredStartUtc = null,
        int? durationMinutes = null)
    {
        if (customerId == Guid.Empty) throw new DomainException("Müşteri seçilmeli.");
        if (preferredStartUtc is { } s && s.Kind != DateTimeKind.Utc)
            throw new DomainException("Bekleme saati UTC olmalı.");
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        ServiceDefinitionId = serviceDefinitionId;
        StaffMemberId = staffMemberId;
        PreferredDate = preferredDate;
        PreferredStartUtc = preferredStartUtc;
        DurationMinutes = durationMinutes is > 0 ? durationMinutes : null;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Status = WaitlistStatus.Waiting;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Guid? ServiceDefinitionId { get; private set; }
    public Guid? StaffMemberId { get; private set; }
    public DateOnly PreferredDate { get; private set; }
    /// <summary>İstenen slotun tam başlangıcı (randevu ekranından eklenince dolu; eski/esnek kayıtlarda null).</summary>
    public DateTime? PreferredStartUtc { get; private set; }
    /// <summary>İstenen slot süresi (dk) — teklif kabul edilince randevu bitişini hesaplamak için.</summary>
    public int? DurationMinutes { get; private set; }
    public WaitlistStatus Status { get; private set; }
    public string? Note { get; private set; }

    public void SetStatus(WaitlistStatus status)
    {
        Status = status;
        Touch();
    }

    /// <summary>
    /// Boşalan somut bir slot bu kayda teklif edildi → Notified yap ve kabul edilince randevu
    /// açmak için gereken tüm alanları (slot başlangıcı/süresi, personel, hizmet, şube) doldur.
    /// Eski tarih-bazlı (saatsiz) kayıtlar da böylece somut bir slota bağlanır.
    /// </summary>
    public void MarkOffered(DateTime startUtc, int durationMinutes, Guid staffMemberId, Guid serviceDefinitionId, Guid? branchId)
    {
        if (durationMinutes <= 0) durationMinutes = 30;
        // DB'den okunan DateTime Kind=Unspecified döner; değer zaten UTC instant olduğundan UTC işaretle.
        PreferredStartUtc = DateTime.SpecifyKind(startUtc, DateTimeKind.Utc);
        DurationMinutes = durationMinutes;
        StaffMemberId = staffMemberId;
        if (ServiceDefinitionId is null || ServiceDefinitionId == Guid.Empty) ServiceDefinitionId = serviceDefinitionId;
        if (BranchId is null || BranchId == Guid.Empty) BranchId = branchId;
        Status = WaitlistStatus.Notified;
        Touch();
    }
}
