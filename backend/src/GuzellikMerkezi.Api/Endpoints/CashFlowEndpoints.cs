using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CashFlowEndpoints
{
    public static IEndpointRouteBuilder MapCashFlowEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/cash-flow").WithTags("CashFlow").RequireAuthorization().RequirePermission(Permissions.CashRegister);

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

        // Kâr raporu: aylık gelir-gider-net + hizmet kârlılığı (prim düşülmüş).
        group.MapGet("/profit-report", async (
            Guid? tenantId,
            int? months,
            ICurrentUser currentUser,
            ICashFlowService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await service.ProfitReportAsync(resolvedTenantId, months ?? 6, ct)).ToHttpResult(http);
        });

        return app;
    }
}
