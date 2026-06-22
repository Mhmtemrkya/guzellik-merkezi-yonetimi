using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.CashClosing;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CashClosingEndpoints
{
    public static IEndpointRouteBuilder MapCashClosingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/cash/closing").WithTags("CashClosing").RequireAuthorization().RequirePermission(Permissions.CashRegister);

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, ICashClosingService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapGet("/preview", async (DateOnly businessDate, DateTime fromUtc, DateTime toUtc, decimal? openingBalance, Guid? tenantId, ICurrentUser currentUser, ICashClosingService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetPreviewAsync(resolvedTenantId, businessDate, fromUtc, toUtc, openingBalance, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateCashClosingRequest request, Guid? tenantId, ICurrentUser currentUser, ICashClosingService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICashClosingService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
