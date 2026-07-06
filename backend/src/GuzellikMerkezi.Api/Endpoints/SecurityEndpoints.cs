using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Security;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Masaüstü kabuk güvenlik olayları (kapatma / odak kaybı → log) ve
/// personel ekran görüntüsü izni (kurum yöneticisi ayarı, mobil FLAG_SECURE bunu okur).
/// </summary>
public static class SecurityEndpoints
{
    public static IEndpointRouteBuilder MapSecurityEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/security").WithTags("Security").RequireAuthorization();

        // Masaüstü uygulaması olay bildirir; kim gönderdiyse onun kimliğiyle loglanır.
        group.MapPost("/desktop-events", async (DesktopEventRequest request, Guid? tenantId, ICurrentUser cu, ISecurityService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.LogDesktopEventAsync(t, request, ct)).ToHttpResult(http);
        });

        // Mobil uygulama da okur (personel dahil) — bu yüzden GET herkese açık.
        group.MapGet("/screenshots", async (Guid? tenantId, ICurrentUser cu, ISecurityService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.GetScreenshotSettingsAsync(t, ct)).ToHttpResult(http);
        });

        group.MapPut("/screenshots", async (UpdateScreenshotSettingsRequest request, Guid? tenantId, ICurrentUser cu, ISecurityService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.UpdateScreenshotSettingsAsync(t, request, ct)).ToHttpResult(http);
        });

        // Personel bazlı istisnalar — yalnızca kurum yöneticisi.
        group.MapGet("/screenshots/staff", async (Guid? tenantId, ICurrentUser cu, ISecurityService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.ListStaffScreenshotOverridesAsync(t, ct)).ToHttpResult(http);
        });

        group.MapPut("/screenshots/staff/{userId:guid}", async (Guid userId, UpdateStaffScreenshotRequest request, Guid? tenantId, ICurrentUser cu, ISecurityService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.UpdateStaffScreenshotAsync(t, userId, request, ct)).ToHttpResult(http);
        });

        return app;
    }

    private static bool IsManager(ICurrentUser cu) =>
        cu.Role is UserRole.InstitutionOwner or UserRole.PlatformAdmin;

    private static IResult Forbidden(HttpContext http) =>
        Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Ekran görüntüsü iznini yalnızca kurum yöneticisi değiştirebilir.", http.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
}
