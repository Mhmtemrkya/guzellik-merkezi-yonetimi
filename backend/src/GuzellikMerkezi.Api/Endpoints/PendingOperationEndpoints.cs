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
            return (await service.ListAsync(resolvedTenantId, filter, new PageRequest(page, pageSize), currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
        });

        // GÜVENLİK: sahiplik kontrolü servistedir — personel BAŞKASININ bekleyen işlemini (çözülmüş
        // payload'ıyla birlikte) okuyamaz. Bkz. PendingOperationService.GetAsync.
        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.GetAsync(resolvedTenantId, id, currentUser.UserId.Value, currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
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
            return (await service.ApproveAsync(resolvedTenantId, id, currentUser.UserId.Value, currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/reject", async (Guid id, RejectPendingOperationRequest request, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            // GÜVENLİK: reddetme yalnızca yönetici rollerine açık.
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.RejectAsync(resolvedTenantId, id, currentUser.UserId.Value, request, currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
        });

        // TAKILI İŞLEMİN ELLE ÇÖZÜMÜ. Sonucu doğrulanamamış (Processing'de kalmış) kayıtların TEK
        // çıkışı budur; servis zaman aşımı + kilit + zorunlu not kapılarını uygular.
        group.MapPatch("/{id:guid}/resolve-stuck", async (Guid id, ResolveStuckOperationRequest request, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            // GÜVENLİK: onay/ret ile aynı kapı — personel kendi işlemini "uygulandı" ilan edemez.
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.ResolveStuckAsync(resolvedTenantId, id, currentUser.UserId.Value, request, currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/cancel", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IPendingOperationService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.CancelAsync(resolvedTenantId, id, currentUser.UserId.Value, currentUser.Role, currentUser.BranchId, ct)).ToHttpResult(http);
        });

        return app;
    }
}
