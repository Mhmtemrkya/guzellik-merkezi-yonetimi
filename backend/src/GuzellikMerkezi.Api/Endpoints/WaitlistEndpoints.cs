using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Waitlist;

namespace GuzellikMerkezi.Api.Endpoints;

public static class WaitlistEndpoints
{
    public static IEndpointRouteBuilder MapWaitlistEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/waitlist").WithTags("Waitlist").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, bool? activeOnly, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, activeOnly, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateWaitlistRequest request, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/status", async (Guid id, UpdateWaitlistStatusRequest request, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetStatusAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
