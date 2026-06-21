using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Expenses;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomExpenseCategoryEndpoints
{
    public static IEndpointRouteBuilder MapCustomExpenseCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/expense-categories").WithTags("CustomExpenseCategories").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, ICustomExpenseCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (UpsertCustomExpenseCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomExpenseCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpsertCustomExpenseCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomExpenseCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomExpenseCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
