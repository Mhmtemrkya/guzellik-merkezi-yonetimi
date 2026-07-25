using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Stok kalemi (ürün). CurrentStock alanı StockMovement event'leri ile senkron tutulur.
/// </summary>
public sealed class Product : Entity
{
    private Product() { }

    public Product(
        Guid tenantId,
        Guid? branchId,
        string name,
        ProductCategory category,
        string unit,
        decimal cost,
        decimal salePrice,
        decimal currentStock,
        decimal minStockLevel,
        string? location = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        UpdateInfo(name, category, unit, location);
        ChangePricing(cost, salePrice);
        InitStock(currentStock, minStockLevel);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public string Name { get; private set; } = string.Empty;
    public ProductCategory Category { get; private set; }
    public string Unit { get; private set; } = "adet";
    public string? Location { get; private set; }
    /// <summary>Barkod — okuyucudan/elle girilir, boşsa otomatik üretilir (tenant içinde benzersiz). Ürünün tekil kimliği budur.</summary>
    public string? Barcode { get; private set; }
    /// <summary>Ürün görseli (data-URL/base64 veya dosya yolu).</summary>
    public string? ImageUrl { get; private set; }
    /// <summary>Marka adı.</summary>
    public string? Brand { get; private set; }
    /// <summary>Son kullanma tarihi.</summary>
    public DateOnly? ExpiryDate { get; private set; }
    /// <summary>Lot / parti numarası.</summary>
    public string? LotNumber { get; private set; }

    public decimal Cost { get; private set; }
    public decimal SalePrice { get; private set; }

    public decimal CurrentStock { get; private set; }
    public decimal MinStockLevel { get; private set; }

    public bool IsActive { get; private set; } = true;

    public bool IsOutOfStock => CurrentStock <= 0;
    public bool IsCritical => CurrentStock > 0 && CurrentStock <= MinStockLevel;

    public void UpdateInfo(string name, ProductCategory category, string unit, string? location)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Ürün adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(unit)) unit = "adet";
        Name = name.Trim();
        Category = category;
        Unit = unit.Trim();
        Location = string.IsNullOrWhiteSpace(location) ? null : location.Trim();
        Touch();
    }

    public void ChangePricing(decimal cost, decimal salePrice)
    {
        if (cost < 0) throw new DomainException("Maliyet negatif olamaz.");
        if (salePrice < 0) throw new DomainException("Satış fiyatı negatif olamaz.");
        Cost = cost;
        SalePrice = salePrice;
        Touch();
    }

    public void ChangeMinLevel(decimal minStockLevel)
    {
        if (minStockLevel < 0) throw new DomainException("Minimum stok seviyesi negatif olamaz.");
        MinStockLevel = minStockLevel;
        Touch();
    }

    private void InitStock(decimal currentStock, decimal minStockLevel)
    {
        if (currentStock < 0) throw new DomainException("Açılış stoğu negatif olamaz.");
        if (minStockLevel < 0) throw new DomainException("Minimum stok seviyesi negatif olamaz.");
        CurrentStock = currentStock;
        MinStockLevel = minStockLevel;
    }

    /// <summary>
    /// Stok hareketi tarafından çağrılır. CurrentStock'u günceller.
    /// Inbound/Adjustment yukarı, Outbound/Sale/Damage aşağı çeker.
    /// </summary>
    public void AdjustStock(StockMovementType type, decimal quantity)
    {
        if (quantity <= 0) throw new DomainException("Hareket miktarı pozitif olmalı.");
        var delta = type switch
        {
            StockMovementType.Inbound => quantity,
            StockMovementType.Adjustment => quantity,
            StockMovementType.Outbound => -quantity,
            StockMovementType.Sale => -quantity,
            StockMovementType.Damage => -quantity,
            _ => 0m,
        };
        var next = CurrentStock + delta;
        if (next < 0) throw new BusinessRuleException("Stok negatif olamaz.");
        CurrentStock = next;
        Touch();
    }

    /// <summary>
    /// Manuel sayım sonucu kesin set eder (delta hesabı yapılmaz, mevcut sayım kabul edilir).
    /// </summary>
    public void SetExactStock(decimal exact)
    {
        if (exact < 0) throw new DomainException("Stok negatif olamaz.");
        CurrentStock = exact;
        Touch();
    }

    public void SetBarcode(string? barcode)
    {
        Barcode = string.IsNullOrWhiteSpace(barcode) ? null : barcode.Trim();
        Touch();
    }

    public void SetImage(string? imageUrl)
    {
        ImageUrl = string.IsNullOrWhiteSpace(imageUrl) ? null : imageUrl.Trim();
        Touch();
    }

    public void SetExtras(string? brand, DateOnly? expiryDate, string? lotNumber)
    {
        Brand = string.IsNullOrWhiteSpace(brand) ? null : brand.Trim();
        ExpiryDate = expiryDate;
        LotNumber = string.IsNullOrWhiteSpace(lotNumber) ? null : lotNumber.Trim();
        Touch();
    }

    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}
