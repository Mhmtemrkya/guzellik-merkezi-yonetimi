using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.PublicSalons;

namespace GuzellikMerkezi.Api.Endpoints;

public static class PublicSalonEndpoints
{
    public static IEndpointRouteBuilder MapPublicSalonEndpoints(this IEndpointRouteBuilder app)
    {
        // Herkese açık salon vitrini — anonim. IP bazlı hız sınırı ile korunur.
        var pub = app.MapGroup("/api/public/salons").WithTags("PublicSalons").RequireRateLimiting("public-browse");

        pub.MapGet("/", async (string? q, string? city, string? category, int? page, int? pageSize, IPublicSalonService service, HttpContext http, CancellationToken ct) =>
            (await service.ListAsync(q, city, category, page ?? 1, pageSize ?? 12, ct)).ToHttpResult(http));

        pub.MapGet("/facets", async (IPublicSalonService service, HttpContext http, CancellationToken ct) =>
            (await service.GetFacetsAsync(ct)).ToHttpResult(http));

        pub.MapGet("/{slug}", async (string slug, IPublicSalonService service, HttpContext http, CancellationToken ct) =>
            (await service.GetBySlugAsync(slug, ct)).ToHttpResult(http));

        pub.MapGet("/{slug}/reviews", async (string slug, Guid? branchId, int? page, int? pageSize, IPublicSalonService service, HttpContext http, CancellationToken ct) =>
            (await service.GetReviewsAsync(slug, branchId, page ?? 1, pageSize ?? 10, ct)).ToHttpResult(http));

        return app;
    }
}
