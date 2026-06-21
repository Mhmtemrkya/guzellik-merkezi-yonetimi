using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.ServicePackages;

public sealed record ServicePackageItemDto(
    Guid ServiceDefinitionId,
    string? ServiceName,
    int SessionCount,
    decimal UnitPrice);

public sealed record ServicePackageDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Name,
    string? Description,
    string? Category,
    decimal TotalPrice,
    decimal DepositAmount,
    int InstallmentCount,
    bool IsActive,
    IReadOnlyCollection<ServicePackageItemDto> Items,
    int TotalDurationMinutes,
    int TotalSessions,
    string? IconKey = null,
    CatalogStatus Status = CatalogStatus.Active,
    DateTime? UpdatedAtUtc = null,
    int? LoyaltyPointCost = null);

public sealed record UpsertServicePackageItemRequest(Guid ServiceDefinitionId, int SessionCount, decimal? UnitPrice);

public sealed record UpdateServicePackageCategoryRequest(string? Category);

public sealed record UpsertServicePackageRequest(
    Guid? BranchId,
    string Name,
    string? Description,
    string? Category,
    decimal TotalPrice,
    decimal DepositAmount,
    int InstallmentCount,
    bool IsActive,
    IReadOnlyCollection<UpsertServicePackageItemRequest> Items,
    string? IconKey = null,
    CatalogStatus Status = CatalogStatus.Active,
    int? LoyaltyPointCost = null);
