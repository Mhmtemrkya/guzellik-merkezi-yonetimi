using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Application.Features.SubscriptionPlans;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Maydanoz bağlayıcısı v1 (sözleşme: maydanozasist.com deposu → ASIST_ENTEGRASYONU.md §4).
/// Kimlik ve tekrar koruması <see cref="ConnectorAuthMiddleware"/>'dadır; uçlar mevcut platform
/// servislerini çağırır, iş kuralı burada YENİDEN yazılmaz.
/// </summary>
public static class ConnectorEndpoints
{
    public const string Product = "beautyasist";
    public const int ContractVersion = 1;

    public static IEndpointRouteBuilder MapConnectorEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/connector/v1").WithTags("Connector").AllowAnonymous();

        // Bağlantı sınaması: Maydanoz panelinin "bağlı" rozeti bunu okur.
        g.MapGet("/ping", (HttpContext http) =>
        {
            var key = (ConnectorKey)http.Items[ConnectorAuthMiddleware.KeyItem]!;
            return Results.Ok(new
            {
                success = true,
                data = new { product = Product, contract = ContractVersion, keyId = key.Id, scopes = key.Scopes.Order().ToArray(), serverTimeUtc = DateTime.UtcNow },
            });
        });

        g.MapGet("/plans", async (ISubscriptionPlanService plans, HttpContext http, CancellationToken ct) =>
            (await plans.ListAsync(ct)).ToHttpResult(http)).Scope("plans.read");

        // Kurumlar sözleşmeye özel, kişisel veri taşımayan görünümle gelir (bkz. ConnectorTenantDto).
        g.MapGet("/tenants", async (int? page, int? pageSize, IConnectorQueries queries, HttpContext http, CancellationToken ct) =>
            Result<PagedResult<ConnectorTenantDto>>.Success(await queries.ListTenantsAsync(page ?? 1, pageSize ?? 100, ct)).ToHttpResult(http))
            .Scope("tenants.read");

        g.MapGet("/tenants/{id:guid}", async (Guid id, IConnectorQueries queries, CancellationToken ct) =>
            await queries.GetTenantAsync(id, ct) is { } tenant
                ? Results.Ok(new { success = true, data = tenant })
                : Results.NotFound(new { success = false, error = new { code = "tenant.not-found", message = "Kurum bulunamadı." } }))
            .Scope("tenants.read");

        // ÖDEME MAYDANOZ'DA: ödeme sayfası tutarı ve dönüş adresini buradan okur; sonucu buraya bildirir.
        g.MapGet("/checkouts/{reference}", async (string reference, IConnectorCheckouts checkouts, CancellationToken ct) =>
            await checkouts.GetAsync(reference, ct) is { } checkout
                ? Results.Ok(new { success = true, data = checkout })
                : Results.NotFound(new { success = false, error = new { code = "checkout.not-found", message = "Ödeme kaydı bulunamadı." } }))
            .Scope("checkouts.read");

        g.MapPost("/checkouts/{reference}/paid", async (string reference, ConnectorCheckoutPaidRequest request, IConnectorCheckouts checkouts, HttpContext http, CancellationToken ct) =>
            (await checkouts.RecordPaidAsync(reference, request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");

        return app;
    }
}
