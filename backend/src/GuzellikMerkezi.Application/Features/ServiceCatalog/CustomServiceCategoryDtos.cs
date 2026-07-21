namespace GuzellikMerkezi.Application.Features.ServiceCatalog;

public sealed record CustomServiceCategoryDto(Guid Id, Guid TenantId, string Name, bool IsActive, DateTime CreatedAtUtc, Guid? ParentId = null, int SortOrder = 0);

public sealed record UpsertCustomServiceCategoryRequest(string Name, bool IsActive, Guid? ParentId = null);

/// <summary>Kategorileri elle sıralamak için: verilen id sırasına göre SortOrder 0..N yazılır.</summary>
public sealed record ReorderCustomServiceCategoryRequest(IReadOnlyList<Guid> OrderedIds);
