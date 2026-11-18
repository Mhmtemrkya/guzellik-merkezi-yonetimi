using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Api.Services;
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

        // KALICI KURUM SİLME (18 Kas 2026, Maydanoz platform paneli): ayrı yetki (tenants.delete) + kurum adı aynen.
        // Silme platform panelindeki "Kalıcı sil" ile aynı yoldan (TenantService.DeleteAsync) yapılır.
        g.MapPost("/tenants/{id:guid}/purge", async (Guid id, ConnectorTenantPurgeRequest request, ConnectorTenantPurge purge, HttpContext http, CancellationToken ct) =>
            (await purge.PurgeAsync(id, request, ct)).ToHttpResult(http))
            .Scope("tenants.delete");

        // ÖDEME MAYDANOZ'DA: ödeme sayfası tutarı ve dönüş adresini buradan okur; sonucu buraya bildirir.
        g.MapGet("/checkouts/{reference}", async (string reference, IConnectorCheckouts checkouts, CancellationToken ct) =>
            await checkouts.GetAsync(reference, ct) is { } checkout
                ? Results.Ok(new { success = true, data = checkout })
                : Results.NotFound(new { success = false, error = new { code = "checkout.not-found", message = "Ödeme kaydı bulunamadı." } }))
            .Scope("checkouts.read");

        // HAVALE / EFT (18 Kas 2026): kurum Maydanoz ödeme sayfasında havaleyi seçti — kayıt havale süresince açık kalır.
        g.MapPost("/checkouts/{reference}/transfer", async (string reference, IConnectorCheckouts checkouts, HttpContext http, CancellationToken ct) =>
            (await checkouts.AwaitTransferAsync(reference, ct)).ToHttpResult(http))
            .Scope("checkouts.write");

        g.MapPost("/checkouts/{reference}/paid", async (string reference, ConnectorCheckoutPaidRequest request, IConnectorCheckouts checkouts, HttpContext http, CancellationToken ct) =>
            (await checkouts.RecordPaidAsync(reference, request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");

        // KAYIT MAYDANOZ'DA (18 Kas 2026): başvurunun e-posta/telefon doğrulaması, onayla hesap açma ve
        // başvuru e-postaları. Kapsamlar canlıdaki dört kapsamla sınırlı (ortam dosyası değişmeden).
        var applications = g.MapGroup("/applications");
        applications.MapGet("/readiness", async (IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.ReadinessAsync(ct)).ToHttpResult(http))
            .Scope("tenants.read");
        applications.MapPost("/verify/start", async (ConnectorApplicationStartRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.StartVerificationAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        applications.MapPost("/verify/email", async (ConnectorApplicationCodeRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.VerifyApplicationEmailAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        applications.MapPost("/verify/phone", async (ConnectorApplicationCodeRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.VerifyApplicationPhoneAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        applications.MapPost("/verify/resend", async (ConnectorApplicationResendRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.ResendApplicationCodeAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        applications.MapPost("/approve", async (ConnectorApplicationApproveRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.ApproveAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        applications.MapPost("/notify", async (ConnectorApplicationNotifyRequest request, IConnectorApplications service, HttpContext http, CancellationToken ct) =>
            (await service.NotifyAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");

        // MAYDANOZ'DA GİRİŞ VE SATIN ALMA (18 Kas 2026): kurum sahibi maydanozasist.com'da girer, hesabını görür,
        // aylık/yıllık paketi Maydanoz'un ödeme sayfasından alır. Kurum kimliği Maydanoz'un SUNUCU oturumundan gelir.
        var accounts = g.MapGroup("/accounts");
        accounts.MapPost("/login", async (ConnectorAccountLoginRequest request, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.LoginAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        accounts.MapPost("/login/verify", async (ConnectorAccountVerifyRequest request, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.VerifyAsync(request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        accounts.MapPost("/password-reset/request", async (PasswordResetRequestBody request, PasswordResetService reset, HttpContext http, CancellationToken ct) =>
            (await reset.RequestAsync(request.Email, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        accounts.MapPost("/password-reset/complete", async (PasswordResetCompleteBody request, PasswordResetService reset, HttpContext http, CancellationToken ct) =>
            (await reset.CompleteAsync(request.ChallengeId, request.Code, request.NewPassword, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        accounts.MapGet("/{tenantId:guid}", async (Guid tenantId, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.AccountAsync(tenantId, ct)).ToHttpResult(http))
            .Scope("tenants.read");
        accounts.MapPost("/{tenantId:guid}/checkout", async (Guid tenantId, ConnectorAccountCheckoutRequest request, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.CheckoutAsync(tenantId, request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");
        // MESAJ KREDİSİ (18 Kas 2026): SMS ve WhatsApp kredisi ayrı; Hesabım'da bakiye + paketler, satın alma Maydanoz'da.
        accounts.MapGet("/{tenantId:guid}/credits", async (Guid tenantId, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.CreditsAsync(tenantId, ct)).ToHttpResult(http))
            .Scope("tenants.read");
        accounts.MapPost("/{tenantId:guid}/credit-checkout", async (Guid tenantId, ConnectorAccountCreditCheckoutRequest request, ConnectorAccountService service, HttpContext http, CancellationToken ct) =>
            (await service.CreditCheckoutAsync(tenantId, request, ct)).ToHttpResult(http))
            .Scope("checkouts.write");

        return app;
    }
}
