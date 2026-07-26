using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Common;
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

        // KVKK aydınlatma metni — WhatsApp'la gönderilen linkin ve "PDF indir" bağlantısının hedefi.
        // Anonimdir: müşteri onay vermeden önce metni okuyabilmeli, giriş yapması beklenemez.
        // İçerik KURUMA ÖZELDİR (Ayarlar'dan düzenlenen metin), yayın anahtarına bağlı değildir —
        // vitrini kapalı kurumun müşterisi de kendi aydınlatma metnine erişebilmelidir.
        pub.MapGet("/{slug}/kvkk", async (string slug, IKvkkDocumentService service, HttpContext http, CancellationToken ct) =>
        {
            var tenantId = await service.ResolveTenantIdBySlugAsync(slug, ct);
            var content = tenantId is null ? null : await service.GetContentAsync(tenantId.Value, ct);
            // Diğer uçlarla aynı ApiResponse zarfı — istemci publicRequest zarf bekler.
            var result = content is null
                ? Result<KvkkContentDto>.Failure(Error.NotFound("Kurum bulunamadı."))
                : Result<KvkkContentDto>.Success(content);
            return result.ToHttpResult(http);
        });

        pub.MapGet("/{slug}/kvkk.pdf", async (string slug, IKvkkDocumentService service, CancellationToken ct) =>
        {
            var tenantId = await service.ResolveTenantIdBySlugAsync(slug, ct);
            if (tenantId is null) return Results.NotFound();
            var pdf = await service.BuildPdfAsync(tenantId.Value, null, ct);
            return pdf is null ? Results.NotFound() : Results.File(pdf, "application/pdf", $"KVKK-Aydinlatma-Metni-{slug}.pdf");
        });

        return app;
    }
}
