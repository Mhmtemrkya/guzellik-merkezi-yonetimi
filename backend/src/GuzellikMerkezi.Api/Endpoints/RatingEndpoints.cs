using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Ratings;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class RatingEndpoints
{
    public static IEndpointRouteBuilder MapRatingEndpoints(this IEndpointRouteBuilder app)
    {
        // Personel/yönetici: randevu tamamlanınca puanlama linki üretir.
        // /api/admin altında DEĞİL → StaffApprovalGate'e takılmaz (anında çalışır).
        var authed = app.MapGroup("/api/ratings").WithTags("Ratings").RequireAuthorization();
        authed.MapPost("/issue", async (IssueRatingRequest request, Guid? tenantId, ICurrentUser currentUser, IRatingService service, HttpContext http, CancellationToken ct) =>
        {
            // BEYAZ LİSTE: müşteri portalı token'ı (UserRole.Customer) da "authenticated"tır;
            // rol açıkça sayılmazsa müşteri de bu ucu çağırabilirdi.
            if (Forbid(currentUser, http, StaffAndAbove) is { } denied) return denied;
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty
                ? EndpointHelpers.MissingTenant(http)
                : (await service.IssueAsync(resolvedTenantId, request.AppointmentId, null, ct)).ToHttpResult(http);
        });

        // Panel: son müşteri yorumları (salon + personel yıldızı). Vitrindekinin aksine
        // müşteri adı MASKELİ DEĞİLDİR — kurum kendi müşterisini görür.
        //
        // GÜVENLİK:
        //  • Rol BEYAZ LİSTESİ — personel ve müşteri portalı kullanıcıları 403 alır.
        //    ("Staff değilse geçsin" yazılırsa Customer rolü de geçer; müşteri diğer
        //     müşterilerin ad+yorumlarını okuyabilirdi.)
        //  • Çapraz kiracı: ResolveTenantId yalnız platform admin'in ?tenantId göndermesine
        //    izin verir; diğer roller JWT'deki kendi tenant'ına sabitlenir.
        //  • Şube kapsamı: sorguda global query filter geçerli — şube müdürü kendi şubesini görür.
        //  • take sunucuda 1..50 arasına kısılır (toplu veri kazımaya karşı).
        authed.MapGet("/reviews", async (int? take, Guid? tenantId, ICurrentUser currentUser, IRatingService service, HttpContext http, CancellationToken ct) =>
        {
            if (Forbid(currentUser, http, ManagersOnly) is { } denied) return denied;
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await service.GetRecentReviewsAsync(resolvedTenantId, take ?? 5, ct)).ToHttpResult(http);
        });

        // Public (anonim): müşteri QR ile gelir; link durumunu okur ve yıldız gönderir.
        // ANONİM PUANLAMA — token deneme-yanılmasına karşı hız sınırlı. Rastgele GUID token'larla
        // geçerli bir değerlendirme oturumu aranabilir; sınırsız bırakılırsa jeton uzayı taranırdı.
        var pub = app.MapGroup("/api/public/ratings").WithTags("Ratings").RequireRateLimiting("public-browse");
        pub.MapGet("/{token:guid}", async (Guid token, IRatingService service, HttpContext http, CancellationToken ct) =>
            (await service.GetPublicAsync(token, ct)).ToHttpResult(http));
        pub.MapPost("/{token:guid}", async (Guid token, SubmitRatingRequest request, IRatingService service, HttpContext http, CancellationToken ct) =>
            (await service.SubmitAsync(token, request, ct)).ToHttpResult(http));

        return app;
    }

    /// <summary>Yorum okuma: yalnız yöneticiler. Personel ve müşteri portalı kullanıcıları hariç.</summary>
    private static readonly UserRole[] ManagersOnly =
        [UserRole.InstitutionOwner, UserRole.BranchManager, UserRole.PlatformAdmin];

    /// <summary>Puanlama linki üretme: salon çalışanları. Müşteri portalı kullanıcıları hariç.</summary>
    private static readonly UserRole[] StaffAndAbove =
        [UserRole.Staff, UserRole.InstitutionOwner, UserRole.BranchManager, UserRole.PlatformAdmin];

    /// <summary>
    /// Rol beyaz listesi. İzin verilmeyen rolde 403 zarfı döner, aksi halde null (devam).
    /// Kara liste ("Staff değilse") YAZILMAZ: yeni bir rol eklendiğinde sessizce açılır.
    /// </summary>
    private static IResult? Forbid(ICurrentUser currentUser, HttpContext http, UserRole[] allowed)
    {
        if (currentUser.Role is { } role && allowed.Contains(role)) return null;
        return Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Bu işlem için yetkiniz yok.", http.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
    }
}
