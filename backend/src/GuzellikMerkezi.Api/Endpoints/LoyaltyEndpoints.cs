using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Loyalty;

namespace GuzellikMerkezi.Api.Endpoints;

public static class LoyaltyEndpoints
{
    public static IEndpointRouteBuilder MapLoyaltyEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/loyalty").WithTags("Loyalty").RequireAuthorization();

        group.MapGet("/{customerId:guid}", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, ILoyaltyService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetBalanceAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        group.MapPost("/adjust", async (AdjustLoyaltyRequest request, Guid? tenantId, ICurrentUser currentUser, ILoyaltyService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AdjustAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        return app;
    }
}
