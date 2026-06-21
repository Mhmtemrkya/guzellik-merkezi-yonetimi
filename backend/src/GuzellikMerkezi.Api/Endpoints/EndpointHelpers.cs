using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Api.Endpoints;

internal static class EndpointHelpers
{
    public static Guid ResolveTenantId(ICurrentUser currentUser, Guid? explicitTenantId)
    {
        // Güvenlik: yalnızca platform admin istemciden gelen tenantId ile başka kurumu hedefleyebilir.
        // Kurum yöneticisi / şube müdürü / personel her zaman KENDİ tenant'ına (JWT claim) sabitlenir —
        // böylece ?tenantId=<başka_kurum> ile çapraz-kiracı erişimi engellenir.
        if (currentUser.IsPlatformAdmin)
        {
            return explicitTenantId ?? currentUser.TenantId ?? Guid.Empty;
        }
        return currentUser.TenantId ?? Guid.Empty;
    }

    public static IResult MissingTenant(HttpContext httpContext) =>
        Results.BadRequest(ApiResponse<object>.Fail("TenantRequired", "TenantId bulunamadı. Token claim veya tenantId query parametresi gerekli.", httpContext.TraceIdentifier));
}
