using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Adisyonlar;

namespace GuzellikMerkezi.Api.Endpoints;

public static class AdisyonEndpoints
{
    public static IEndpointRouteBuilder MapAdisyonEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/adisyonlar").WithTags("Adisyonlar").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapGet("/open/{customerId:guid}", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetOpenForCustomerAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateAdisyonRequest request, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateAdisyonRequest request, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/items", async (Guid id, AddAdisyonItemRequest request, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AddItemAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}/items/{itemId:guid}", async (Guid id, Guid itemId, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RemoveItemAsync(resolvedTenantId, id, itemId, ct)).ToHttpResult(http);
        });

        // Hediye çeki / kupon kodu uygula — indirim kalemi ekler, adisyon onayında redeem edilir.
        group.MapPost("/{id:guid}/gift-card", async (Guid id, ApplyAdisyonGiftCardRequest request, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ApplyGiftCardAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Onay yalnızca yönetici rollerinde — personel satışı adisyonda bekler, kurum sahibi onaylayınca işler.
        group.MapPost("/{id:guid}/approve", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            if (currentUser.Role == Domain.Enums.UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ApproveAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/cancel", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAdisyonService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}
