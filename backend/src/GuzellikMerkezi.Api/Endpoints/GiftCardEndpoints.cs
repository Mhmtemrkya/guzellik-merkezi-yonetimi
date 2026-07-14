using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.GiftCards;

namespace GuzellikMerkezi.Api.Endpoints;

public static class GiftCardEndpoints
{
    public static IEndpointRouteBuilder MapGiftCardEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/gift-cards").WithTags("GiftCards").RequireAuthorization().RequirePermission(Permissions.GiftCards, writeOnly: true);

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapGet("/validate", async (string code, Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetByCodeAsync(resolvedTenantId, code, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateGiftCardRequest request, Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/redeem", async (Guid id, RedeemGiftCardRequest request, Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RedeemAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/active", async (Guid id, SetGiftCardActiveRequest request, Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetActiveAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IGiftCardService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
