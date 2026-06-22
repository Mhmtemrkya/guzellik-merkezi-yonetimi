using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Tenants;

namespace GuzellikMerkezi.Api.Endpoints;

public static class TenantEndpoints
{
    public static IEndpointRouteBuilder MapTenantEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/platform/tenants").WithTags("Platform Tenants").RequireAuthorization("PlatformAdmin");

        group.MapGet("/", async (int page, int pageSize, string? search, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.ListAsync(new PageRequest(page, pageSize, search), ct)).ToHttpResult(http));

        group.MapGet("/availability", async (string? name, string? slug, string? domain, string? ownerName, string? ownerEmail, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.CheckAvailabilityAsync(name, slug, domain, ownerName, ownerEmail, ct)).ToHttpResult(http));

        group.MapGet("/{id:guid}", async (Guid id, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetAsync(id, ct)).ToHttpResult(http));

        group.MapPost("/", async (CreateTenantRequest request, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.CreateAsync(request, ct)).ToHttpResult(http))
            .ValidatesRequest<CreateTenantRequest>();

        group.MapPut("/{id:guid}", async (Guid id, UpdateTenantRequest request, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.UpdateAsync(id, request, ct)).ToHttpResult(http))
            .ValidatesRequest<UpdateTenantRequest>();

        group.MapDelete("/{id:guid}", async (Guid id, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.DeleteAsync(id, ct)).ToHttpResult(http));

        group.MapPost("/{id:guid}/access", async (Guid id, GrantTenantAccessRequest request, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.GrantAccessAsync(id, request, ct)).ToHttpResult(http))
            .ValidatesRequest<GrantTenantAccessRequest>();

        // Kurum yetkilisinin şifresini sıfırlar — yeni geçici şifre tek seferlik döner.
        group.MapPost("/{id:guid}/reset-owner-password", async (Guid id, ITenantService service, HttpContext http, CancellationToken ct) =>
            (await service.ResetOwnerPasswordAsync(id, ct)).ToHttpResult(http));

        // /api/admin/tenant — kurum yöneticisi kendi tenant'ını okuyup günceller.
        var adminGroup = app.MapGroup("/api/admin/tenant").WithTags("Admin Tenant").RequireAuthorization();

        adminGroup.MapGet("/", async (Guid? tenantId, ICurrentUser cu, ITenantService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(t, ct)).ToHttpResult(http);
        });

        adminGroup.MapPut("/", async (UpdateTenantRequest request, Guid? tenantId, ICurrentUser cu, ITenantService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(t, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpdateTenantRequest>();

        return app;
    }
}
