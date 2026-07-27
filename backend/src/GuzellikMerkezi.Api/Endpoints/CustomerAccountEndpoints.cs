using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomerAccountEndpoints
{
    public static IEndpointRouteBuilder MapCustomerAccountEndpoints(this IEndpointRouteBuilder app)
    {
        // GÜVENLİK: cari/finansal veriler — personel yalnızca "Ön Muhasebe" (Accounting) SAYFA izniyle okuyabilir.
        // (Yazma işlemleri ayrıca onay kapısında Accounting.Accounts/Collect aksiyon iznine tabidir.)
        var group = app.MapGroup("/api/admin/accounts").WithTags("CustomerAccounts").RequireAuthorization().RequirePermission(Permissions.Accounting);

        // serviceDefinitionId / servicePackageId → katalog kartındaki satış paneli (sunucuda süzülür).
        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, Guid? customerId, Guid? serviceDefinitionId, Guid? servicePackageId, string? category, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct, customerId, serviceDefinitionId, servicePackageId, category)).ToHttpResult(http);
        });

        // Geçmiş satış: yazılıma geçmeden önce yapılmış paket/hizmet satışını sisteme işler.
        group.MapPost("/historical", async (CreateHistoricalSaleRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateHistoricalAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        // Satış iptali + gerekçe (finansal iz silinmez, kayıt "iptal" işaretlenir).
        group.MapPost("/{id:guid}/cancel-sale", async (Guid id, CancelSaleRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelSaleAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/restore-sale", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RestoreSaleAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
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
        // category/subCategory: rapor yalnızca o kategorideki paketlere daralır; dönemle birlikte çalışır.
        group.MapGet("/report", async (Guid? tenantId, int? months, DateTime? fromUtc, DateTime? toUtc, string? category, string? subCategory, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetReportAsync(resolvedTenantId, months ?? 6, fromUtc, toUtc, category, subCategory, ct)).ToHttpResult(http);
        });

        // Pano "Hizmet Raporu": paket raporundan AYRI — kategori hizmetin kategorisidir, paket sayılmaz.
        group.MapGet("/service-report", async (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, string? category, string? subCategory, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetServiceReportAsync(resolvedTenantId, fromUtc, toUtc, category, subCategory, ct)).ToHttpResult(http);
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
