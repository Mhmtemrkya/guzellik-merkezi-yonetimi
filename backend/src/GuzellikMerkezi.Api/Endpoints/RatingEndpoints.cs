using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Ratings;

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
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty
                ? EndpointHelpers.MissingTenant(http)
                : (await service.IssueAsync(resolvedTenantId, request.AppointmentId, ct)).ToHttpResult(http);
        });

        // Public (anonim): müşteri QR ile gelir; link durumunu okur ve yıldız gönderir.
        var pub = app.MapGroup("/api/public/ratings").WithTags("Ratings");
        pub.MapGet("/{token:guid}", async (Guid token, IRatingService service, HttpContext http, CancellationToken ct) =>
            (await service.GetPublicAsync(token, ct)).ToHttpResult(http));
        pub.MapPost("/{token:guid}", async (Guid token, SubmitRatingRequest request, IRatingService service, HttpContext http, CancellationToken ct) =>
            (await service.SubmitAsync(token, request, ct)).ToHttpResult(http));

        return app;
    }
}
