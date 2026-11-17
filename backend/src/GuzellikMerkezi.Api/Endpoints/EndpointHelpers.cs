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

/// <summary>Ödeme sağlayıcısının tarayıcıyı döndüreceği adres.</summary>
public static class PaymentCallbacks
{
    /// <summary>Ödeme dönüş adresinin kökü: <c>Payments:CallbackBaseUrl</c> (ör. herkese açık API adresi).</summary>
    public const string PaymentCallbackBaseKey = "Payments:CallbackBaseUrl";

    /// <summary>
    /// Ödeme sağlayıcısının tarayıcıyı döndüreceği MUTLAK adres. Ayar varsa ondan kurulur: istek
    /// web vekili (Next proxy) üzerinden geldiğinde Host sitenin adıdır ve <c>/api/payments/*</c> orada
    /// yoktur (canlıda 404 ölçüldü, 17 Kas 2026). Ayar yoksa eskisi gibi istekten kurulur.
    /// </summary>
    public static string PaymentCallbackUrl(HttpContext http, string path)
    {
        var configured = http.RequestServices.GetService<IConfiguration>()?[PaymentCallbackBaseKey];
        var origin = string.IsNullOrWhiteSpace(configured)
            ? $"{http.Request.Scheme}://{http.Request.Host}"
            : configured.Trim().TrimEnd('/');
        return origin + path;
    }
}
