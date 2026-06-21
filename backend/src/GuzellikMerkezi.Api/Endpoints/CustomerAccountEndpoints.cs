using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomerAccountEndpoints
{
    public static IEndpointRouteBuilder MapCustomerAccountEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/accounts").WithTags("CustomerAccounts").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateCustomerAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateCustomerAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/reschedule", async (Guid id, RescheduleAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RescheduleAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/payments", async (Guid id, RegisterAccountPaymentRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RegisterPaymentAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        // Pano "Paket Raporu": paket satışı, yapılacak seans, ay ay taksit takvimi.
        // fromUtc/toUtc verilirse rapor o dönemde satılan paketlere göre süzülür (günlük/aylık/yıllık).
        group.MapGet("/report", async (Guid? tenantId, int? months, DateTime? fromUtc, DateTime? toUtc, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetReportAsync(resolvedTenantId, months ?? 6, fromUtc, toUtc, ct)).ToHttpResult(http);
        });

        // Müşterinin paketlerindeki hizmet-bazlı kalan seans bakiyeleri
        group.MapGet("/sessions/{customerId:guid}", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetCustomerSessionsAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        return app;
    }
}
