using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Branches;

namespace GuzellikMerkezi.Api.Endpoints;

public static class BranchEndpoints
{
    public static IEndpointRouteBuilder MapBranchEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/branches").WithTags("Branches").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (UpsertBranchRequest request, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertBranchRequest>();

        group.MapPut("/{id:guid}", async (Guid id, UpsertBranchRequest request, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertBranchRequest>();

        return app;
    }
}
