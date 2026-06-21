namespace GuzellikMerkezi.Application.Features.ServiceCatalog;

public sealed record CustomServiceCategoryDto(Guid Id, Guid TenantId, string Name, bool IsActive, DateTime CreatedAtUtc);

public sealed record UpsertCustomServiceCategoryRequest(string Name, bool IsActive);
