using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class StaffMember : Entity
{
    private StaffMember() { }

    public StaffMember(Guid tenantId, Guid branchId, string fullName, string title, string? phone = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        UpdateProfile(fullName, title, phone, null);
    }

    public Guid TenantId { get; private set; }
    public Guid BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public Guid? TenantUserId { get; private set; }
    public TenantUser? TenantUser { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string Title { get; private set; } = string.Empty;
    public string? Phone { get; private set; }
    public string? Specialties { get; private set; }
    public decimal? CommissionRate { get; private set; }
    /// <summary>Personel fotoğrafı (data-URL/base64) — çizelgede ve kartlarda görünür.</summary>
    public string? PhotoUrl { get; private set; }
    public bool IsActive { get; private set; } = true;

    public void UpdateProfile(string fullName, string title, string? phone, string? specialties)
    {
        if (string.IsNullOrWhiteSpace(fullName)) throw new DomainException("Personel adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(title)) throw new DomainException("Personel unvanı boş olamaz.");
        FullName = fullName.Trim();
        Title = title.Trim();
        Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        Specialties = string.IsNullOrWhiteSpace(specialties) ? null : specialties.Trim();
        Touch();
    }

    public void LinkTenantUser(Guid? tenantUserId)
    {
        TenantUserId = tenantUserId;
        Touch();
    }

    /// <summary>Personeli başka bir şubeye aktarır (çok şubeli kurumlarda kullanılır).</summary>
    public void TransferToBranch(Guid branchId)
    {
        if (branchId == Guid.Empty) throw new DomainException("Şube seçimi zorunlu.");
        if (branchId == BranchId) throw new BusinessRuleException("Personel zaten bu şubede.");
        BranchId = branchId;
        Touch();
    }

    public void SetCommissionRate(decimal? commissionRate)
    {
        if (commissionRate is < 0 or > 100) throw new DomainException("Komisyon oranı 0-100 aralığında olmalı.");
        CommissionRate = commissionRate;
        Touch();
    }

    public void SetPhoto(string? photoUrl)
    {
        PhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? null : photoUrl.Trim();
        Touch();
    }

    public void Activate()
    {
        IsActive = true;
        Touch();
    }

    public void Deactivate()
    {
        IsActive = false;
        Touch();
    }
}
