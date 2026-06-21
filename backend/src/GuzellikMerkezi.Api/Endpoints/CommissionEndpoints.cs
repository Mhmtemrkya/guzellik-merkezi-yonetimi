using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Commissions;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CommissionEndpoints
{
    public static IEndpointRouteBuilder MapCommissionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/commissions").WithTags("Commissions").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, Guid? staffMemberId, bool? unpaidOnly, ICurrentUser currentUser, ICommissionService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new CommissionFilter(fromUtc, toUtc, staffMemberId, unpaidOnly), ct)).ToHttpResult(http);
        });

        group.MapGet("/summary", async (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, Guid? staffMemberId, bool? unpaidOnly, ICurrentUser currentUser, ICommissionService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SummaryAsync(resolvedTenantId, new CommissionFilter(fromUtc, toUtc, staffMemberId, unpaidOnly), ct)).ToHttpResult(http);
        });

        group.MapPost("/pay/{staffMemberId:guid}", async (Guid staffMemberId, Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, ICurrentUser currentUser, ICommissionService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.PayAsync(resolvedTenantId, staffMemberId, fromUtc, toUtc, ct)).ToHttpResult(http);
        });

        return app;
    }
}
