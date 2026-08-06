using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.ServicePackages;

namespace GuzellikMerkezi.Api.Endpoints;

public static class ServicePackageEndpoints
{
    public static IEndpointRouteBuilder MapServicePackageEndpoints(this IEndpointRouteBuilder app)
    {
        // YETKİ: TÜM KURUM KULLANICILARI — paket kataloğu randevu/adisyon ekranlarının temel verisidir.
        // YAZMA yolları Services.Manage işlem iznine tabidir (bkz. StaffApprovalGateMiddleware.RequiredAction).
        var group = app.MapGroup("/api/admin/packages").WithTags("ServicePackages").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (UpsertServicePackageRequest request, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpsertServicePackageRequest request, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/category", async (Guid id, UpdateServicePackageCategoryRequest request, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateCategoryAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Paket TANIMININ gerekçeli iptali (kurum vazgeçti). Müşterinin satış iptali için
        // /api/admin/accounts/{id}/cancel-sale kullanılır — ikisi ayrı kavramdır.
        group.MapPost("/{id:guid}/cancel", async (Guid id, CancelServicePackageRequest request, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/restore", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RestoreAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IServicePackageService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
