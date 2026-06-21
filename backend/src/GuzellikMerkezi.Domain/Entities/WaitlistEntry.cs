using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bekleme listesi kaydı — dolu bir güne randevu almak isteyen müşteri. Yer açıldığında
/// (iptal vb.) sıradakine teklif edilir. Statü Waiting → Notified → Booked/Cancelled akışını izler.
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
        string? note)
    {
        if (customerId == Guid.Empty) throw new DomainException("Müşteri seçilmeli.");
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        ServiceDefinitionId = serviceDefinitionId;
        StaffMemberId = staffMemberId;
        PreferredDate = preferredDate;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Status = WaitlistStatus.Waiting;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Guid? ServiceDefinitionId { get; private set; }
    public Guid? StaffMemberId { get; private set; }
    public DateOnly PreferredDate { get; private set; }
    public WaitlistStatus Status { get; private set; }
    public string? Note { get; private set; }

    public void SetStatus(WaitlistStatus status)
    {
        Status = status;
        Touch();
    }
}
