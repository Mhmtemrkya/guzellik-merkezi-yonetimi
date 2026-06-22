using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class StockService : IStockService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public StockService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<PagedResult<ProductDto>>> ListAsync(Guid tenantId, ProductCategory? category, bool? criticalOnly, PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Products
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId);

        if (category.HasValue) query = query.Where(p => p.Category == category.Value);

        var rows = await query.OrderBy(p => p.Name).ToListAsync(cancellationToken);

        // In-memory criticalOnly filter (provider IN bug'ından kaçınmak için sade tutuldu)
        if (criticalOnly == true)
        {
            rows = rows.Where(p => p.CurrentStock <= p.MinStockLevel).ToList();
        }

        var total = rows.Count;
        var paged = rows.Skip(request.Skip).Take(request.SafePageSize).Select(p => p.ToDto()).ToArray();
        return Result<PagedResult<ProductDto>>.Success(new PagedResult<ProductDto>(paged, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<ProductDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var product = await _db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id, cancellationToken);
        return product is null
            ? Result<ProductDto>.Failure(Error.NotFound("Ürün bulunamadı."))
            : Result<ProductDto>.Success(product.ToDto());
    }

    public async Task<Result<ProductDto>> CreateAsync(Guid tenantId, CreateProductRequest request, CancellationToken cancellationToken = default)
    {
        // SKU duplicate kontrolü (case-insensitive)
        var sku = (request.Sku ?? string.Empty).Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(sku))
        {
            var existingSkus = await _db.Products
                .AsNoTracking()
                .Where(p => p.TenantId == tenantId)
                .Select(p => p.Sku)
                .ToListAsync(cancellationToken);
            if (existingSkus.Any(s => string.Equals(s, sku, StringComparison.OrdinalIgnoreCase)))
                return Result<ProductDto>.Failure(Error.Conflict("Bu SKU ile başka bir ürün var."));
        }

        var product = new Product(
            tenantId,
            request.BranchId,
            request.Name,
            sku, // normalize edilmiş (trim + upper, non-null) SKU — duplicate kontrolüyle tutarlı
            request.Category,
            request.Unit,
            request.Cost,
            request.SalePrice,
            request.CurrentStock,
            request.MinStockLevel,
            request.Supplier,
            request.Location);
        if (!request.IsActive) product.Deactivate();
        product.SetImage(request.ImageUrl);
        product.SetExtras(request.Brand, request.TaxRatePercent, request.ExpiryDate, request.LotNumber, request.PendingInbound, request.LeadTimeDays);
        // Barkod: kullanıcı girdiyse benzersizlik kontrolü, boşsa otomatik üret.
        product.SetBarcode(await ResolveBarcodeAsync(tenantId, request.Barcode, null, cancellationToken));
        _db.Products.Add(product);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, product.BranchId, "Create", "Product", product.Id,
            $"Ürün eklendi: {product.Name} ({product.Sku})",
            new { product.Name, product.Sku, product.CurrentStock, product.Barcode }, cancellationToken);
        return Result<ProductDto>.Success(product.ToDto());
    }

    public async Task<Result<ProductDto>> UpdateAsync(Guid tenantId, Guid id, UpdateProductRequest request, CancellationToken cancellationToken = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id, cancellationToken);
        if (product is null) return Result<ProductDto>.Failure(Error.NotFound("Ürün bulunamadı."));

        product.UpdateInfo(request.Name, request.Sku, request.Category, request.Unit, request.Supplier, request.Location);
        product.ChangePricing(request.Cost, request.SalePrice);
        product.ChangeMinLevel(request.MinStockLevel);
        if (request.IsActive) product.Activate(); else product.Deactivate();
        product.SetExtras(request.Brand, request.TaxRatePercent, request.ExpiryDate, request.LotNumber, request.PendingInbound, request.LeadTimeDays);
        if (request.ImageUrl is not null) product.SetImage(request.ImageUrl);
        // Barkod boş gelirse mevcut korunur; doluysa benzersizlik kontrolüyle güncellenir.
        if (!string.IsNullOrWhiteSpace(request.Barcode))
            product.SetBarcode(await ResolveBarcodeAsync(tenantId, request.Barcode, product.Id, cancellationToken));
        else if (string.IsNullOrWhiteSpace(product.Barcode))
            product.SetBarcode(await ResolveBarcodeAsync(tenantId, null, product.Id, cancellationToken));
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, product.BranchId, "Update", "Product", product.Id,
            $"Ürün güncellendi: {product.Name}", null, cancellationToken);
        return Result<ProductDto>.Success(product.ToDto());
    }

    /// <summary>
    /// Barkodu çözer: kullanıcı girdiyse tenant içinde benzersizliğini doğrular (çakışırsa hata),
    /// boşsa benzersiz 13 haneli (EAN-13 benzeri) bir barkod üretir.
    /// </summary>
    private async Task<string> ResolveBarcodeAsync(Guid tenantId, string? requested, Guid? excludeProductId, CancellationToken cancellationToken)
    {
        var existing = await _db.Products
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId && (excludeProductId == null || p.Id != excludeProductId))
            .Select(p => p.Barcode)
            .ToListAsync(cancellationToken);
        var taken = existing
            .Where(b => !string.IsNullOrWhiteSpace(b))
            .Select(b => b!.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(requested))
        {
            var trimmed = requested.Trim();
            if (taken.Contains(trimmed))
                throw new GuzellikMerkezi.Domain.Exceptions.BusinessRuleException("Bu barkod başka bir üründe kayıtlı.");
            return trimmed;
        }

        // Otomatik üret: 200 prefix + 9 rastgele hane + EAN-13 kontrol hanesi.
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var body = "200" + Random.Shared.NextInt64(0, 1_000_000_000).ToString("D9");
            var code = body + Ean13CheckDigit(body);
            if (!taken.Contains(code)) return code;
        }
        return "200" + DateTime.UtcNow.Ticks.ToString().Substring(0, 10);
    }

    private static char Ean13CheckDigit(string twelveDigits)
    {
        var sum = 0;
        for (var i = 0; i < twelveDigits.Length; i++)
        {
            var d = twelveDigits[i] - '0';
            sum += (i % 2 == 0) ? d : d * 3;
        }
        var check = (10 - (sum % 10)) % 10;
        return (char)('0' + check);
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id, cancellationToken);
        if (product is null) return Result.Failure(Error.NotFound("Ürün bulunamadı."));
        var snapshot = new { product.Name, product.Sku, product.CurrentStock };
        product.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, product.BranchId, "Delete", "Product", product.Id,
            $"Ürün silindi: {product.Name}", snapshot, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyCollection<StockMovementDto>>> ListMovementsAsync(Guid tenantId, Guid? productId, int limit, CancellationToken cancellationToken = default)
    {
        if (limit <= 0 || limit > 500) limit = 50;
        var query = _db.StockMovements
            .AsNoTracking()
            .Where(m => m.TenantId == tenantId);
        if (productId.HasValue) query = query.Where(m => m.ProductId == productId.Value);

        var movements = await query
            .OrderByDescending(m => m.OccurredAtUtc)
            .Take(limit)
            .Select(m => new
            {
                m.Id,
                m.TenantId,
                m.ProductId,
                m.Type,
                m.Quantity,
                m.UnitCost,
                m.OccurredAtUtc,
                m.Reference,
                m.Notes,
                m.StaffMemberId,
            })
            .ToListAsync(cancellationToken);

        // Product + staff isimlerini bir kerede çek (provider in-memory join)
        var productIds = movements.Select(m => m.ProductId).Distinct().ToHashSet();
        var productList = await _db.Products
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => new { p.Id, p.Name, p.Sku })
            .ToListAsync(cancellationToken);
        var productMap = productList.Where(p => productIds.Contains(p.Id)).ToDictionary(p => p.Id);

        var staffIds = movements.Where(m => m.StaffMemberId.HasValue).Select(m => m.StaffMemberId!.Value).Distinct().ToHashSet();
        var staffList = await _db.StaffMembers
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName })
            .ToListAsync(cancellationToken);
        var staffMap = staffList.Where(s => staffIds.Contains(s.Id)).ToDictionary(s => s.Id, s => s.FullName);

        var items = movements.Select(m => new StockMovementDto(
            m.Id,
            m.TenantId,
            m.ProductId,
            productMap.TryGetValue(m.ProductId, out var p) ? p.Name : null,
            productMap.TryGetValue(m.ProductId, out var p2) ? p2.Sku : null,
            m.Type,
            m.Quantity,
            m.UnitCost,
            m.UnitCost.HasValue ? m.UnitCost.Value * m.Quantity : 0m,
            m.OccurredAtUtc,
            m.Reference,
            m.Notes,
            m.StaffMemberId,
            m.StaffMemberId.HasValue && staffMap.TryGetValue(m.StaffMemberId.Value, out var sn) ? sn : null)).ToArray();

        return Result<IReadOnlyCollection<StockMovementDto>>.Success(items);
    }

    public async Task<Result<StockMovementDto>> AddMovementAsync(Guid tenantId, Guid productId, CreateStockMovementRequest request, CancellationToken cancellationToken = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == productId, cancellationToken);
        if (product is null) return Result<StockMovementDto>.Failure(Error.NotFound("Ürün bulunamadı."));

        var occurredAt = request.OccurredAtUtc ?? DateTime.UtcNow;
        if (occurredAt.Kind != DateTimeKind.Utc) occurredAt = DateTime.SpecifyKind(occurredAt, DateTimeKind.Utc);

        var movement = new StockMovement(
            tenantId,
            productId,
            request.Type,
            request.Quantity,
            occurredAt,
            request.UnitCost,
            request.Reference,
            request.Notes,
            request.StaffMemberId);

        // Stok delta uygula (negatif olamaz iş kuralı domain'de)
        try
        {
            if (request.Type == StockMovementType.Adjustment)
            {
                // Sayım: Quantity'i mevcutla karşılaştırıp delta ekle
                // Burada Quantity gerçek tahmin sayım kabul edilir (set exact)
                product.SetExactStock(request.Quantity);
            }
            else
            {
                product.AdjustStock(request.Type, request.Quantity);
            }
        }
        catch (Exception ex)
        {
            return Result<StockMovementDto>.Failure(Error.Validation(ex.Message));
        }

        _db.StockMovements.Add(movement);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, product.BranchId, "StockMovement", "Product", product.Id,
            $"{movement.Type}: {product.Name} · {movement.Quantity}",
            new { movement.Type, movement.Quantity, movement.Reference, MovementId = movement.Id }, cancellationToken);

        var staffName = movement.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == movement.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;

        return Result<StockMovementDto>.Success(movement.ToDto(product.Name, product.Sku, staffName));
    }

    public async Task<Result<StockSummaryDto>> SummaryAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.Products
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => new
            {
                p.Category,
                p.CurrentStock,
                p.MinStockLevel,
                p.Cost,
                p.SalePrice,
            })
            .ToListAsync(cancellationToken);

        var totalProducts = rows.Count;
        var criticalCount = rows.Count(r => r.CurrentStock > 0 && r.CurrentStock <= r.MinStockLevel);
        var outOfStockCount = rows.Count(r => r.CurrentStock <= 0);
        var stockValueAtCost = rows.Sum(r => r.CurrentStock * r.Cost);
        var stockValueAtSale = rows.Sum(r => r.CurrentStock * r.SalePrice);

        var byCategory = rows
            .GroupBy(r => r.Category)
            .Select(g => new StockCategoryTotalDto(g.Key, g.Count(), g.Sum(x => x.CurrentStock * x.Cost)))
            .OrderByDescending(c => c.StockValueAtCost)
            .ToArray();

        return Result<StockSummaryDto>.Success(new StockSummaryDto(
            totalProducts,
            criticalCount,
            outOfStockCount,
            stockValueAtCost,
            stockValueAtSale,
            byCategory));
    }
}
