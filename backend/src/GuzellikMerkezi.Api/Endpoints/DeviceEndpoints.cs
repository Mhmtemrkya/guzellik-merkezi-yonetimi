using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Devices;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Cihaz güvenliği: kurum ayarı (aç/kapat), personel cihaz listesi/limiti yönetimi.
/// Yazma işlemleri yalnızca kurum sahibi / şube yöneticisi; personel kendi cihazlarını görüntüler.
/// </summary>
public static class DeviceEndpoints
{
    public static IEndpointRouteBuilder MapDeviceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/devices").WithTags("Devices").RequireAuthorization();

        group.MapGet("/settings", async (Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.GetSettingsAsync(t, ct)).ToHttpResult(http);
        });

        group.MapPut("/settings", async (UpdateDeviceControlSettingsRequest request, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.UpdateSettingsAsync(t, request, ct)).ToHttpResult(http);
        });

        // Personelin kendi tanımlı cihazları.
        group.MapGet("/me", async (ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (cu.TenantId is null || cu.UserId is null) return EndpointHelpers.MissingTenant(http);
            return (await svc.ListForUserAsync(cu.TenantId.Value, cu.UserId.Value, ct)).ToHttpResult(http);
        });

        group.MapGet("/users/{userId:guid}", async (Guid userId, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu) && cu.UserId != userId) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.ListForUserAsync(t, userId, ct)).ToHttpResult(http);
        });

        group.MapGet("/users/{userId:guid}/limit", async (Guid userId, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu) && cu.UserId != userId) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.GetLimitAsync(t, userId, ct)).ToHttpResult(http);
        });

        group.MapPut("/users/{userId:guid}/limit", async (Guid userId, UpdateDeviceLimitRequest request, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.UpdateLimitAsync(t, userId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateDeviceRequest request, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.UpdateAsync(t, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser cu, IDeviceService svc, HttpContext http, CancellationToken ct) =>
        {
            if (!IsManager(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.DeleteAsync(t, id, ct)).ToHttpResult(http);
        });

        return app;
    }

    private static bool IsManager(ICurrentUser cu) =>
        cu.Role is UserRole.InstitutionOwner or UserRole.BranchManager or UserRole.PlatformAdmin;

    private static IResult Forbidden(HttpContext http) =>
        Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Cihaz yönetimi yalnızca kurum yöneticisine açıktır.", http.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
}
