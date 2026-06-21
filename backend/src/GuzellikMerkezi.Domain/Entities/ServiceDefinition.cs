using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class ServiceDefinition : Entity
{
    private ServiceDefinition() { }

    public ServiceDefinition(Guid tenantId, Guid? branchId, string name, int durationMinutes, decimal price, string? category = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Rename(name, category);
        ChangePricing(durationMinutes, price);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? Category { get; private set; }
    public int DurationMinutes { get; private set; }
    public decimal Price { get; private set; }
    public bool IsActive { get; private set; } = true;
    /// <summary>Yayın durumu (Taslak/Aktif/Pasif/Arşiv). IsActive ile senkron tutulur.</summary>
    public CatalogStatus Status { get; private set; } = CatalogStatus.Active;
    /// <summary>Hizmet ikonu anahtarı (frontend SVG ikon kütüphanesinden seçilir).</summary>
    public string? IconKey { get; private set; }
    /// <summary>Varsayılan seans sayısı — paket oluşturmada ön-dolum olarak kullanılır (orada düzenlenebilir).</summary>
    public int DefaultSessionCount { get; private set; } = 1;
    /// <summary>
    /// Sadakat puanı karşılığı hediye maliyeti. null/0 = hediye edilemez; pozitif = adisyonda
    /// bu kadar puanla hediye olarak verilebilir. Kurum yöneticisi belirler.
    /// </summary>
    public int? LoyaltyPointCost { get; private set; }

    public void Rename(string name, string? category)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Hizmet adı boş olamaz.");
        Name = name.Trim();
        Category = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        Touch();
    }

    public void SetIcon(string? iconKey)
    {
        IconKey = string.IsNullOrWhiteSpace(iconKey) ? null : iconKey.Trim();
        Touch();
    }

    public void ChangePricing(int durationMinutes, decimal price)
    {
        if (durationMinutes <= 0) throw new DomainException("Hizmet süresi pozitif olmalı.");
        if (price < 0) throw new DomainException("Hizmet fiyatı negatif olamaz.");
        DurationMinutes = durationMinutes;
        Price = price;
        Touch();
    }

    public void SetDefaultSessions(int sessionCount)
    {
        if (sessionCount <= 0) throw new DomainException("Seans sayısı pozitif olmalı.");
        DefaultSessionCount = sessionCount;
        Touch();
    }

    public void SetLoyaltyPointCost(int? pointCost)
    {
        if (pointCost is < 0) throw new DomainException("Sadakat puanı negatif olamaz.");
        LoyaltyPointCost = pointCost is null or 0 ? null : pointCost;
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
