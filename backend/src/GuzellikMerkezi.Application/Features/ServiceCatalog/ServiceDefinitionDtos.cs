using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.ServiceCatalog;

public sealed record ServiceDefinitionDto(Guid Id, Guid TenantId, Guid? BranchId, string Name, string? Category, int DurationMinutes, decimal Price, bool IsActive, string? IconKey = null, CatalogStatus Status = CatalogStatus.Active, int DefaultSessionCount = 1, int? LoyaltyPointCost = null);
public sealed record UpsertServiceDefinitionRequest(Guid? BranchId, string Name, string? Category, int DurationMinutes, decimal Price, bool IsActive, string? IconKey = null, CatalogStatus Status = CatalogStatus.Active, int DefaultSessionCount = 1, int? LoyaltyPointCost = null);
