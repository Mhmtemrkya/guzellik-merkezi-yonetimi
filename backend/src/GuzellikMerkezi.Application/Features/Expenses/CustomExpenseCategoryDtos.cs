namespace GuzellikMerkezi.Application.Features.Expenses;

public sealed record CustomExpenseCategoryDto(Guid Id, Guid TenantId, string Name, bool IsActive, DateTime CreatedAtUtc);

public sealed record UpsertCustomExpenseCategoryRequest(string Name, bool IsActive);
