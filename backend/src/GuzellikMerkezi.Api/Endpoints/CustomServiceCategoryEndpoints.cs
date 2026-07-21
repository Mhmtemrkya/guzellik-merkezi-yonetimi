using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.ServiceCatalog;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomServiceCategoryEndpoints
{
    public static IEndpointRouteBuilder MapCustomServiceCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/service-categories").WithTags("CustomServiceCategories").RequireAuthorization().RequirePermission(Permissions.Services, writeOnly: true);

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, ICustomServiceCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (UpsertCustomServiceCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomServiceCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpsertCustomServiceCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomServiceCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomServiceCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/reorder", async (ReorderCustomServiceCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomServiceCategoryService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ReorderAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        return app;
    }
}
