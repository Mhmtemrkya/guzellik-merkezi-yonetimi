using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PublicSalons;
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

        // --- Salon vitrini (public profil + galeri) — kurum yöneticisi kendi kurumunu yönetir. ---
        adminGroup.MapGet("/public-profile", async (Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetProfileAsync(t, ct)).ToHttpResult(http);
        });

        adminGroup.MapPut("/public-profile", async (UpdateTenantPublicProfileRequest request, Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateProfileAsync(t, request, ct)).ToHttpResult(http);
        });

        adminGroup.MapPut("/public-profile/logo", async (SetTenantLogoRequest request, Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetLogoAsync(t, request, ct)).ToHttpResult(http);
        });

        adminGroup.MapGet("/gallery", async (string? kind, Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListGalleryAsync(t, kind, ct)).ToHttpResult(http);
        });

        adminGroup.MapPost("/gallery", async (AddTenantGalleryPhotoRequest request, Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AddGalleryPhotoAsync(t, request, ct)).ToHttpResult(http);
        });

        adminGroup.MapDelete("/gallery/{photoId:guid}", async (Guid photoId, Guid? tenantId, ICurrentUser cu, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteGalleryPhotoAsync(t, photoId, ct)).ToHttpResult(http);
        });

        // --- Platform admin: kurum eklerken/düzenlerken vitrin görselleri ve profili yönetir. ---
        group.MapGet("/{id:guid}/public-profile", async (Guid id, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.GetProfileAsync(id, ct)).ToHttpResult(http));
        group.MapPut("/{id:guid}/public-profile", async (Guid id, UpdateTenantPublicProfileRequest request, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.UpdateProfileAsync(id, request, ct)).ToHttpResult(http));
        // Premium / Öne Çıkan etiketi — yalnızca platform admin.
        group.MapGet("/{id:guid}/featured", async (Guid id, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.GetFeaturedAsync(id, ct)).ToHttpResult(http));
        group.MapPut("/{id:guid}/featured", async (Guid id, SetTenantFeaturedRequest request, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.SetFeaturedAsync(id, request, ct)).ToHttpResult(http));
        group.MapPut("/{id:guid}/public-profile/logo", async (Guid id, SetTenantLogoRequest request, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.SetLogoAsync(id, request, ct)).ToHttpResult(http));
        group.MapGet("/{id:guid}/gallery", async (Guid id, string? kind, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.ListGalleryAsync(id, kind, ct)).ToHttpResult(http));
        group.MapPost("/{id:guid}/gallery", async (Guid id, AddTenantGalleryPhotoRequest request, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.AddGalleryPhotoAsync(id, request, ct)).ToHttpResult(http));
        group.MapDelete("/{id:guid}/gallery/{photoId:guid}", async (Guid id, Guid photoId, ITenantProfileService service, HttpContext http, CancellationToken ct) =>
            (await service.DeleteGalleryPhotoAsync(id, photoId, ct)).ToHttpResult(http));

        return app;
    }
}
