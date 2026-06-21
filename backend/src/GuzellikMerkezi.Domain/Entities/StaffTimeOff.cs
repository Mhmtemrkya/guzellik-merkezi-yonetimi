using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personel izni — çizelgede bir personelin belirli bir gününü tamamen kapatır (o gün randevu önerilmez).
/// </summary>
public sealed class StaffTimeOff : Entity
{
    private StaffTimeOff() { }

    public StaffTimeOff(Guid tenantId, Guid staffMemberId, DateOnly date, string? reason)
    {
        TenantId = tenantId;
        StaffMemberId = staffMemberId;
        Date = date;
        SetReason(reason);
    }

    public Guid TenantId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }
    public DateOnly Date { get; private set; }
    public string? Reason { get; private set; }

    public void SetReason(string? reason)
    {
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        Touch();
    }
}
