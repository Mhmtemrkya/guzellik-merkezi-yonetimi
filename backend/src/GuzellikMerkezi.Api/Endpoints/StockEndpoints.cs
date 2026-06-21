using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class StockEndpoints
{
    public static IEndpointRouteBuilder MapStockEndpoints(this IEndpointRouteBuilder app)
    {
        var products = app.MapGroup("/api/admin/products").WithTags("Stock").RequireAuthorization();

        products.MapGet("/", async (
            Guid? tenantId,
            ProductCategory? category,
            bool? criticalOnly,
            int page,
            int pageSize,
            ICurrentUser currentUser,
            IStockService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await service.ListAsync(resolvedTenantId, category, criticalOnly, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        products.MapGet("/summary", async (
            Guid? tenantId,
            ICurrentUser currentUser,
            IStockService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SummaryAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        products.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IStockService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        products.MapPost("/", async (CreateProductRequest request, Guid? tenantId, ICurrentUser currentUser, IStockService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        products.MapPut("/{id:guid}", async (Guid id, UpdateProductRequest request, Guid? tenantId, ICurrentUser currentUser, IStockService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        products.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IStockService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        products.MapPost("/{id:guid}/movements", async (Guid id, CreateStockMovementRequest request, Guid? tenantId, ICurrentUser currentUser, IStockService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AddMovementAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        var movements = app.MapGroup("/api/admin/stock-movements").WithTags("Stock").RequireAuthorization();

        movements.MapGet("/", async (
            Guid? tenantId,
            Guid? productId,
            int limit,
            ICurrentUser currentUser,
            IStockService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListMovementsAsync(resolvedTenantId, productId, limit, ct)).ToHttpResult(http);
        });

        return app;
    }
}
