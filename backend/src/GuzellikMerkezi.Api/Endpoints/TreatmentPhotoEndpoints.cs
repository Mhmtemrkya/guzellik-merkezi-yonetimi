using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.TreatmentPhotos;

namespace GuzellikMerkezi.Api.Endpoints;

public static class TreatmentPhotoEndpoints
{
    public static IEndpointRouteBuilder MapTreatmentPhotoEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/customers/{customerId:guid}/treatment-photos")
            .WithTags("TreatmentPhotos").RequireAuthorization();

        group.MapGet("/", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, ITreatmentPhotoService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (Guid customerId, CreateTreatmentPhotoRequest request, Guid? tenantId, ICurrentUser currentUser, ITreatmentPhotoService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AddAsync(resolvedTenantId, customerId, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid customerId, Guid id, Guid? tenantId, ICurrentUser currentUser, ITreatmentPhotoService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
