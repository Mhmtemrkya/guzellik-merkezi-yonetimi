using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Customers;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomerEndpoints
{
    public static IEndpointRouteBuilder MapCustomerEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/customers").WithTags("Customers").RequireAuthorization().RequirePermission(Permissions.Customers);

        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct)).ToHttpResult(http);
        });

        // Onaylanmış paket/hizmet satışı olan müşteri Id'leri — randevu sayfası listesini bununla filtreler.
        group.MapGet("/with-approved-sales", async (Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetCustomerIdsWithApprovedSalesAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        // Kalan paket seansı olan müşteri Id'leri — yeni randevu modalı yalnızca bunları listeler.
        group.MapGet("/with-bookable-sessions", async (Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetCustomerIdsWithBookableSessionsAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        // Dashboard sayaç/trendleri — sınırsız ölçek: liste yerine sunucuda hesaplanan istatistik.
        group.MapGet("/stats", async (Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetStatsAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        // VIP müşteriler — şube-kapsamlı.
        group.MapGet("/vip", async (Guid? tenantId, int page, int pageSize, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetVipAsync(resolvedTenantId, new PageRequest(page, pageSize, null), ct)).ToHttpResult(http);
        });

        // VIP etiketi ekle/kaldır.
        group.MapPost("/{id:guid}/vip", async (Guid id, SetVipRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetVipAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Kara liste (randevu verilemeyen müşteriler) — şube-kapsamlı.
        group.MapGet("/blacklisted", async (Guid? tenantId, int page, int pageSize, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetBlacklistedAsync(resolvedTenantId, new PageRequest(page, pageSize, null), ct)).ToHttpResult(http);
        });

        // Pasif müşteriler — eşik (gün) kadar süredir randevu/paket işlemi olmayanlar; şube-kapsamlı.
        group.MapGet("/passive", async (Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetPassiveCustomersAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        // Pasif müşteri eşiği (gün) — kurum yöneticisi ayarlar.
        group.MapGet("/passive-threshold", async (Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetPassiveThresholdAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapPut("/passive-threshold", async (SetPassiveThresholdRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetPassiveThresholdAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/blacklist", async (Guid id, SetBlacklistRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetBlacklistAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Arama (tel:) için ham numara — personel ekranda maskeli görse de arayabilsin; erişim audit'e düşer.
        group.MapGet("/{id:guid}/dial", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetDialPhoneAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (UpsertCustomerRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertCustomerRequest>();

        group.MapPut("/{id:guid}", async (Guid id, UpsertCustomerRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertCustomerRequest>();

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
