using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;

namespace GuzellikMerkezi.Api.Endpoints;

public static class FeatureEndpoints
{
    public static IEndpointRouteBuilder MapFeatureEndpoints(this IEndpointRouteBuilder app)
    {
        // Platform admin — projedeki TÜM feature kataloğu (plan kurarken seçim için).
        app.MapGet("/api/platform/features-catalog", (IFeatureService svc, HttpContext http) =>
        {
            var catalog = svc.GetCatalog();
            return Results.Ok(ApiResponse<FeatureCatalogDto>.Ok(catalog, http.TraceIdentifier));
        }).WithTags("Features").RequireAuthorization("PlatformAdmin");

        // Kurum admin — kendi tenant'ının açık feature listesini çeker.
        // Frontend useFeature hook bu endpoint'i polling/cache ile kullanır.
        app.MapGet("/api/admin/features", async (Guid? tenantId, ICurrentUser cu, IFeatureService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty
                ? EndpointHelpers.MissingTenant(http)
                : (await svc.GetTenantFeaturesAsync(t, ct)).ToHttpResult(http);
        }).WithTags("Features").RequireAuthorization();

        return app;
    }
}
