using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.CashFlow;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CashFlowEndpoints
{
    public static IEndpointRouteBuilder MapCashFlowEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/cash-flow").WithTags("CashFlow").RequireAuthorization();

        group.MapGet("/", async (
            Guid? tenantId,
            DateTime? fromUtc,
            DateTime? toUtc,
            ICurrentUser currentUser,
            ICashFlowService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await service.ListAsync(resolvedTenantId, new CashFlowFilter(fromUtc, toUtc), ct)).ToHttpResult(http);
        });

        group.MapGet("/summary", async (
            Guid? tenantId,
            DateTime? fromUtc,
            DateTime? toUtc,
            ICurrentUser currentUser,
            ICashFlowService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await service.SummaryAsync(resolvedTenantId, new CashFlowFilter(fromUtc, toUtc), ct)).ToHttpResult(http);
        });

        return app;
    }
}
