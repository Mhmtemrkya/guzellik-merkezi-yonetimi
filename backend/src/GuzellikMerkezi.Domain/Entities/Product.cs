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
        string sku,
        ProductCategory category,
        string unit,
        decimal cost,
        decimal salePrice,
        decimal currentStock,
        decimal minStockLevel,
        string? supplier = null,
        string? location = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        UpdateInfo(name, sku, category, unit, supplier, location);
        ChangePricing(cost, salePrice);
        InitStock(currentStock, minStockLevel);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public string Name { get; private set; } = string.Empty;
    public string Sku { get; private set; } = string.Empty;
    public ProductCategory Category { get; private set; }
    public string Unit { get; private set; } = "adet";
    public string? Supplier { get; private set; }
    public string? Location { get; private set; }
    /// <summary>Barkod — kullanıcı elle girer veya boşsa otomatik üretilir (tenant içinde benzersiz).</summary>
    public string? Barcode { get; private set; }
    /// <summary>Ürün görseli (data-URL/base64 veya dosya yolu).</summary>
    public string? ImageUrl { get; private set; }
    /// <summary>Marka adı (tedarikçiden ayrı).</summary>
    public string? Brand { get; private set; }
    /// <summary>KDV / vergi oranı (%).</summary>
    public decimal? TaxRatePercent { get; private set; }
    /// <summary>Son kullanma tarihi.</summary>
    public DateOnly? ExpiryDate { get; private set; }
    /// <summary>Lot / parti numarası.</summary>
    public string? LotNumber { get; private set; }
    /// <summary>Sipariş verilmiş, henüz teslim alınmamış miktar.</summary>
    public decimal PendingInbound { get; private set; }
    /// <summary>Tedarik süresi (gün).</summary>
    public int LeadTimeDays { get; private set; }

    public decimal Cost { get; private set; }
    public decimal SalePrice { get; private set; }

    public decimal CurrentStock { get; private set; }
    public decimal MinStockLevel { get; private set; }

    public bool IsActive { get; private set; } = true;

    public bool IsOutOfStock => CurrentStock <= 0;
    public bool IsCritical => CurrentStock > 0 && CurrentStock <= MinStockLevel;

    public void UpdateInfo(string name, string sku, ProductCategory category, string unit, string? supplier, string? location)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Ürün adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(sku)) throw new DomainException("SKU boş olamaz.");
        if (string.IsNullOrWhiteSpace(unit)) unit = "adet";
        Name = name.Trim();
        Sku = sku.Trim().ToUpperInvariant();
        Category = category;
        Unit = unit.Trim();
        Supplier = string.IsNullOrWhiteSpace(supplier) ? null : supplier.Trim();
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

    public void SetExtras(string? brand, decimal? taxRatePercent, DateOnly? expiryDate, string? lotNumber, decimal? pendingInbound, int? leadTimeDays)
    {
        if (taxRatePercent is < 0 or > 100) throw new DomainException("Vergi oranı 0-100 aralığında olmalı.");
        if (pendingInbound is < 0) throw new DomainException("Bekleyen giriş negatif olamaz.");
        if (leadTimeDays is < 0) throw new DomainException("Tedarik süresi negatif olamaz.");
        Brand = string.IsNullOrWhiteSpace(brand) ? null : brand.Trim();
        TaxRatePercent = taxRatePercent;
        ExpiryDate = expiryDate;
        LotNumber = string.IsNullOrWhiteSpace(lotNumber) ? null : lotNumber.Trim();
        PendingInbound = pendingInbound ?? PendingInbound;
        LeadTimeDays = leadTimeDays ?? LeadTimeDays;
        Touch();
    }

    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}
