using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.DataImport;

namespace GuzellikMerkezi.Api.Endpoints;

public static class ImportEndpoints
{
    public static IEndpointRouteBuilder MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/import").WithTags("DataImport").RequireAuthorization().RequirePermission(Permissions.Customers);

        // Genel Excel içeri aktarma — frontend dosyayı analiz edip normalize satırları yollar.
        group.MapPost("/", async (BulkImportRequest request, Guid? tenantId, ICurrentUser currentUser, IDataImportService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ImportAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        // Platform admin: seçilen kuruma veri aktarımı (tenantId zorunlu query parametresi).
        var platform = app.MapGroup("/api/platform/import").WithTags("DataImport").RequireAuthorization("PlatformAdmin");
        platform.MapPost("/", async (BulkImportRequest request, Guid tenantId, IDataImportService service, HttpContext http, CancellationToken ct) =>
        {
            return tenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ImportAsync(tenantId, request, ct)).ToHttpResult(http);
        });

        return app;
    }
}
