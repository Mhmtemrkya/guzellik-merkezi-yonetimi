using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class ServicePackage : Entity
{
    private readonly List<ServicePackageItem> _items = new();

    private ServicePackage() { }

    public ServicePackage(Guid tenantId, Guid? branchId, string name, decimal totalPrice, decimal depositAmount, int installmentCount, string? description = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Rename(name, description);
        ChangePricing(totalPrice, depositAmount, installmentCount);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    /// <summary>Kuruma özel kategori adı (hizmetlerdeki kategori ile aynı havuz).</summary>
    public string? Category { get; private set; }
    /// <summary>Alt kategori adı (üst kategori = Category). null = alt kategori yok.</summary>
    public string? SubCategory { get; private set; }
    public decimal TotalPrice { get; private set; }
    public decimal DepositAmount { get; private set; }
    public int InstallmentCount { get; private set; }
    public bool IsActive { get; private set; } = true;
    /// <summary>Yayın durumu (Taslak/Aktif/Pasif/Arşiv). IsActive ile senkron tutulur.</summary>
    public CatalogStatus Status { get; private set; } = CatalogStatus.Active;
    /// <summary>Paket ikonu anahtarı (frontend SVG ikon kütüphanesinden seçilir).</summary>
    public string? IconKey { get; private set; }
    /// <summary>
    /// Sadakat puanı karşılığı hediye maliyeti. null/0 = hediye edilemez; pozitif = adisyonda
    /// bu kadar puanla hediye olarak verilebilir. Kurum yöneticisi belirler.
    /// </summary>
    public int? LoyaltyPointCost { get; private set; }
    public IReadOnlyCollection<ServicePackageItem> Items => _items.AsReadOnly();

    public void Rename(string name, string? description)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Paket adı boş olamaz.");
        Name = name.Trim();
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Touch();
    }

    public void ChangePricing(decimal totalPrice, decimal depositAmount, int installmentCount)
    {
        if (totalPrice < 0) throw new DomainException("Paket tutarı negatif olamaz.");
        if (depositAmount < 0) throw new DomainException("Peşinat negatif olamaz.");
        if (depositAmount > totalPrice) throw new DomainException("Peşinat toplam tutardan büyük olamaz.");
        if (installmentCount < 0) throw new DomainException("Taksit sayısı negatif olamaz.");
        TotalPrice = totalPrice;
        DepositAmount = depositAmount;
        InstallmentCount = installmentCount;
        Touch();
    }

    public void ReplaceItems(IEnumerable<(Guid ServiceDefinitionId, int SessionCount, decimal UnitPrice)> items)
    {
        _items.Clear();
        foreach (var entry in items)
        {
            if (entry.SessionCount <= 0) throw new DomainException("Seans sayısı pozitif olmalı.");
            if (entry.UnitPrice < 0) throw new DomainException("Hizmet birim fiyatı negatif olamaz.");
            _items.Add(new ServicePackageItem(Id, entry.ServiceDefinitionId, entry.SessionCount, entry.UnitPrice));
        }
        Touch();
    }

    public void SetCategory(string? category, string? subCategory = null)
    {
        Category = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        SubCategory = string.IsNullOrWhiteSpace(subCategory) ? null : subCategory.Trim();
        Touch();
    }

    public void SetLoyaltyPointCost(int? pointCost)
    {
        if (pointCost is < 0) throw new DomainException("Sadakat puanı negatif olamaz.");
        LoyaltyPointCost = pointCost is null or 0 ? null : pointCost;
        Touch();
    }

    public void SetIcon(string? iconKey)
    {
        IconKey = string.IsNullOrWhiteSpace(iconKey) ? null : iconKey.Trim();
        Touch();
    }

    public void SetStatus(CatalogStatus status)
    {
        Status = status;
        IsActive = status == CatalogStatus.Active;
        Touch();
    }

    public void Activate() { Status = CatalogStatus.Active; IsActive = true; Touch(); }
    public void Deactivate() { Status = CatalogStatus.Passive; IsActive = false; Touch(); }
}

public sealed class ServicePackageItem : Entity
{
    private ServicePackageItem() { }

    public ServicePackageItem(Guid packageId, Guid serviceDefinitionId, int sessionCount, decimal unitPrice)
    {
        ServicePackageId = packageId;
        ServiceDefinitionId = serviceDefinitionId;
        SessionCount = sessionCount;
        UnitPrice = unitPrice;
    }

    public Guid ServicePackageId { get; private set; }
    public ServicePackage? Package { get; private set; }
    public Guid ServiceDefinitionId { get; private set; }
    public ServiceDefinition? ServiceDefinition { get; private set; }
    public int SessionCount { get; private set; }
    public decimal UnitPrice { get; private set; }
}
