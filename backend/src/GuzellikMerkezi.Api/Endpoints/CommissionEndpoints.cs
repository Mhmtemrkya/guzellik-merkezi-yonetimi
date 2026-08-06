using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Commissions;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CommissionEndpoints
{
    public static IEndpointRouteBuilder MapCommissionEndpoints(this IEndpointRouteBuilder app)
    {
        // PRİM UÇLARI İZİNSİZDİ. Grup yalnız kimlik doğrulaması istiyordu: izinsiz bir personel
        // TÜM personelin prim tutarlarını, oranlarını ve ödenme durumunu okuyabiliyordu (bordro
        // verisi), üstelik "/pay" ucu da aynı kapıdaydı — prim ödemesi bir MAAŞ GİDERİ oluşturur.
        // Okuma muhasebe sayfası iznine, ödeme ise gider iznine bağlandı.
        var group = app.MapGroup("/api/admin/commissions").WithTags("Commissions").RequireAuthorization()
            .RequirePermission(Permissions.Accounting);

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
        }).RequirePermission(Permissions.AccountingExpenses);   // prim ödemesi = maaş gideri

        return app;
    }
}
