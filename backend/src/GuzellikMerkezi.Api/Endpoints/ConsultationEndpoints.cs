using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Consultations;

namespace GuzellikMerkezi.Api.Endpoints;

public static class ConsultationEndpoints
{
    public static IEndpointRouteBuilder MapConsultationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/customers/{customerId:guid}/consultation")
            .WithTags("Consultations").RequireAuthorization();

        group.MapGet("/", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, IConsultationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        group.MapPut("/", async (Guid customerId, UpsertConsultationRequest request, Guid? tenantId, ICurrentUser currentUser, IConsultationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpsertAsync(resolvedTenantId, customerId, request, ct)).ToHttpResult(http);
        });

        // "Özel" bölümü — kuruma/şubeye özel işaretlenebilir seçenek kütüphanesi.
        var options = app.MapGroup("/api/admin/consultation-options").WithTags("Consultations").RequireAuthorization();

        options.MapGet("/", async (Guid? branchId, Guid? tenantId, ICurrentUser currentUser, IConsultationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListOptionsAsync(resolvedTenantId, branchId, ct)).ToHttpResult(http);
        });

        options.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IConsultationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteOptionAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
