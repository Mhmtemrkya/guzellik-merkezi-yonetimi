using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personel primi. Adisyon onaylandığında, personele atanmış charge kalemleri için
/// <c>BaseAmount × Rate%</c> olarak kesinleşir (idempotent: kaynak kalem başına tek prim).
/// </summary>
public sealed class StaffCommission : Entity
{
    private StaffCommission() { }

    public StaffCommission(
        Guid tenantId,
        Guid? branchId,
        Guid staffMemberId,
        Guid sourceAdisyonId,
        Guid? sourceItemId,
        string sourceType,
        string description,
        decimal baseAmount,
        decimal ratePercent,
        DateTime earnedAtUtc)
    {
        TenantId = tenantId;
        BranchId = branchId;
        StaffMemberId = staffMemberId;
        SourceAdisyonId = sourceAdisyonId;
        SourceItemId = sourceItemId;
        SourceType = sourceType;
        Description = string.IsNullOrWhiteSpace(description) ? sourceType : description.Trim();
        BaseAmount = baseAmount < 0 ? 0 : baseAmount;
        RatePercent = ratePercent < 0 ? 0 : ratePercent;
        Amount = Math.Round(BaseAmount * RatePercent / 100m, 2, MidpointRounding.AwayFromZero);
        if (earnedAtUtc.Kind != DateTimeKind.Utc) earnedAtUtc = DateTime.SpecifyKind(earnedAtUtc, DateTimeKind.Utc);
        EarnedAtUtc = earnedAtUtc;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }
    public Guid SourceAdisyonId { get; private set; }
    public Guid? SourceItemId { get; private set; }
    public string SourceType { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public decimal BaseAmount { get; private set; }
    public decimal RatePercent { get; private set; }
    public decimal Amount { get; private set; }
    public DateTime EarnedAtUtc { get; private set; }
    public bool IsPaid { get; private set; }
    public DateTime? PaidAtUtc { get; private set; }

    public void MarkPaid(DateTime? paidAtUtc = null)
    {
        if (IsPaid) return;
        IsPaid = true;
        PaidAtUtc = paidAtUtc ?? DateTime.UtcNow;
        if (PaidAtUtc.Value.Kind != DateTimeKind.Utc) PaidAtUtc = DateTime.SpecifyKind(PaidAtUtc.Value, DateTimeKind.Utc);
        Touch();
    }
}
