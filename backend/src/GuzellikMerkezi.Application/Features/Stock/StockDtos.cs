using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Stock;

public sealed record ProductDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Name,
    ProductCategory Category,
    string Unit,
    string? Location,
    decimal Cost,
    decimal SalePrice,
    decimal CurrentStock,
    decimal MinStockLevel,
    bool IsActive,
    bool IsOutOfStock,
    bool IsCritical,
    string? Barcode,
    string? ImageUrl,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc,
    string? Brand = null,
    DateOnly? ExpiryDate = null,
    string? LotNumber = null);

public sealed record CreateProductRequest(
    Guid? BranchId,
    string Name,
    ProductCategory Category,
    string Unit,
    string? Location,
    decimal Cost,
    decimal SalePrice,
    decimal MinStockLevel,
    bool IsActive,
    string? Barcode = null,
    string? ImageUrl = null,
    string? Brand = null,
    DateOnly? ExpiryDate = null,
    string? LotNumber = null);

public sealed record UpdateProductRequest(
    string Name,
    ProductCategory Category,
    string Unit,
    string? Location,
    decimal Cost,
    decimal SalePrice,
    decimal MinStockLevel,
    bool IsActive,
    string? Barcode = null,
    string? ImageUrl = null,
    string? Brand = null,
    DateOnly? ExpiryDate = null,
    string? LotNumber = null);

public sealed record StockMovementDto(
    Guid Id,
    Guid TenantId,
    Guid ProductId,
    string? ProductName,
    string? ProductBarcode,
    StockMovementType Type,
    decimal Quantity,
    decimal? UnitCost,
    decimal TotalCost,
    DateTime OccurredAtUtc,
    string? Reference,
    string? Notes,
    Guid? StaffMemberId,
    string? StaffName);

public sealed record CreateStockMovementRequest(
    StockMovementType Type,
    decimal Quantity,
    DateTime? OccurredAtUtc,
    decimal? UnitCost,
    string? Reference,
    string? Notes,
    Guid? StaffMemberId);

public sealed record StockSummaryDto(
    int TotalProducts,
    int CriticalCount,
    int OutOfStockCount,
    decimal StockValueAtCost,
    decimal StockValueAtSale,
    IReadOnlyCollection<StockCategoryTotalDto> ByCategory);

public sealed record StockCategoryTotalDto(ProductCategory Category, int ProductCount, decimal StockValueAtCost);
