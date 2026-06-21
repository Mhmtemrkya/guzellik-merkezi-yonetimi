using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kampanya — hizmet/paket fiyatına uygulanan indirim tanımı. Tarih aralığında aktifse
/// ilgili hedefe (tüm / belirli hizmet / belirli paket) indirim uygular.
/// </summary>
public sealed class Campaign : Entity
{
    private Campaign() { }

    public Campaign(
        Guid tenantId,
        Guid? branchId,
        string name,
        DiscountType discountType,
        decimal discountValue,
        CampaignTarget target,
        Guid? targetId,
        DateOnly startDate,
        DateOnly endDate)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Rename(name);
        SetDiscount(discountType, discountValue);
        Target = target;
        TargetId = target == CampaignTarget.All ? null : targetId;
        SetDates(startDate, endDate);
        IsActive = true;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public DiscountType DiscountType { get; private set; }
    public decimal DiscountValue { get; private set; }
    public CampaignTarget Target { get; private set; }
    public Guid? TargetId { get; private set; }
    public DateOnly StartDate { get; private set; }
    public DateOnly EndDate { get; private set; }
    public bool IsActive { get; private set; } = true;

    /// <summary>Bugün tarih aralığında ve aktif mi?</summary>
    public bool IsRunning(DateOnly today) => IsActive && today >= StartDate && today <= EndDate;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Kampanya adı boş olamaz.");
        Name = name.Trim();
        Touch();
    }

    public void SetDiscount(DiscountType type, decimal value)
    {
        if (value <= 0) throw new DomainException("İndirim değeri pozitif olmalı.");
        if (type == DiscountType.Percent && value > 100) throw new DomainException("Yüzde indirim 100'ü aşamaz.");
        DiscountType = type;
        DiscountValue = value;
        Touch();
    }

    public void SetTarget(CampaignTarget target, Guid? targetId)
    {
        Target = target;
        TargetId = target == CampaignTarget.All ? null : targetId;
        Touch();
    }

    public void SetDates(DateOnly startDate, DateOnly endDate)
    {
        if (endDate < startDate) throw new DomainException("Bitiş tarihi başlangıçtan önce olamaz.");
        StartDate = startDate;
        EndDate = endDate;
        Touch();
    }

    /// <summary>Verilen tutara indirimi uygular (negatif olamaz).</summary>
    public decimal Apply(decimal price)
    {
        var discounted = DiscountType == DiscountType.Percent
            ? price - (price * DiscountValue / 100m)
            : price - DiscountValue;
        return Math.Max(0, Math.Round(discounted, 2, MidpointRounding.AwayFromZero));
    }

    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}
