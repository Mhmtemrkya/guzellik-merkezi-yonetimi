using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class PendingOperationEndpoints
{
    public static IEndpointRouteBuilder MapPendingOperationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/pending-operations").WithTags("PendingOperations").RequireAuthorization();

        group.MapGet("/", async (
            Guid? tenantId,
            PendingOperationStatus? status,
            Guid? requestedByUserId,
            PendingOperationType? operationType,
            int page,
            int pageSize,
            ICurrentUser currentUser,
            IPendingOperationService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            // Personel yalnızca KENDİ gönderdiği bekleyen işlemleri görebilir (başkasınınkini göremez).
            var effectiveRequestedBy = currentUser.Role == UserRole.Staff ? currentUser.UserId : requestedByUserId;
            var filter = new PendingOperationFilter(status, effectiveRequestedBy, operationType);
            return (await service.ListAsync(resolvedTenantId, filter, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreatePendingOperationRequest request, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            var name = currentUser.Email ?? "Personel";
            return (await service.CreateAsync(resolvedTenantId, currentUser.BranchId, currentUser.UserId.Value, name, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/approve", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            // GÜVENLİK: onaylama yalnızca yönetici rollerine açık — personel kendi (ya da başkasının) işlemini ONAYLAYAMAZ.
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.ApproveAsync(resolvedTenantId, id, currentUser.UserId.Value, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/reject", async (Guid id, RejectPendingOperationRequest request, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            // GÜVENLİK: reddetme yalnızca yönetici rollerine açık.
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.RejectAsync(resolvedTenantId, id, currentUser.UserId.Value, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/cancel", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.CancelAsync(resolvedTenantId, id, currentUser.UserId.Value, ct)).ToHttpResult(http);
        });

        return app;
    }
}
