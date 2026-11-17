using GuzellikMerkezi.Api.Endpoints;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÖDEME MAYDANOZ'DA (kullanıcı 17 Kas 2026): BeautyAsist ödeme almaz, kurumu maydanozasist.com'a
/// yönlendirir. Değişmezler: (1) yönlendirme abonelik/kredi açmaz, (2) yalnız Maydanoz'un imzalı
/// "ödendi" bildirimi açar ve bildirimin tutarı beklenenle aynı olmalı, (3) bildirimin tekrarı ikinci
/// kez işlenmez, farklı ödeme kimliğiyle ikinci bildirim reddedilir, (4) ödeme sayfası kişisel veri almaz.
/// </summary>
public sealed class MaydanozCheckoutTests
{
    private const string Site = "https://maydanozasist.com";
    private const string Callback = "https://api.beautyasist.test/api/payments/callback";
    private const string CreditCallback = "https://api.beautyasist.test/api/payments/credit-callback";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed class PassthroughEncryption : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    private sealed class StubHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    private static PaymentGatewayResolver Resolver(GuzellikDbContext db, string? site = Site, string environment = "Production") =>
        new(db, new PassthroughEncryption(), new StubHttpFactory(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_ENVIRONMENT"] = environment,
                ["Jwt:SigningKey"] = "test-signing-key-that-is-long-enough-for-qa",
                [PaymentGatewayResolver.MaydanozSiteUrlKey] = site,
            }).Build(),
            NullLogger<PaymentGatewayResolver>.Instance);

    private static BillingService Billing(GuzellikDbContext db) =>
        new(db, Resolver(db), new PassthroughEncryption(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);

    private static WhatsAppBillingService Credits(GuzellikDbContext db) =>
        new(db, NullLogger<WhatsAppBillingService>.Instance, Resolver(db), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static ConnectorCheckouts Connector(GuzellikDbContext db) => new(db, Billing(db), Credits(db), new NoopAuditLogger());

    private static async Task<(Guid TenantId, Guid PlanId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var settings = new PlatformIntegrationSettings();
        settings.UpdatePayments(true, "Maydanoz", null, null, null, "https://beautyasist.test/panel/paket");
        db.PlatformIntegrationSettings.Add(settings);
        var tenant = new Tenant("Işıl Güzellik", $"isil-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        tenant.AddBranch("Merkez", "İzmir", true);
        tenant.SetContact("05550000000", "1234567890");
        db.Tenants.Add(tenant);
        var plan = new SubscriptionPlan("BeautyAsist", "BeautyAsist", 1000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10000m);
        db.SubscriptionPlans.Add(plan);
        db.WhatsAppBillingSettings.Add(PaymentTestDoubles.BillingOneTryPerCredit());
        await db.SaveChangesAsync();
        return (tenant.Id, plan.Id);
    }

    private static async Task<(string Ref, decimal Amount)> StartSubscriptionAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId, Guid planId)
    {
        await using var db = NewDb(options);
        var started = await Billing(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback);
        Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
        // Form gömülmez, Maydanoz'a yönlendirilir.
        Assert.Null(started.Value!.FormContent);
        Assert.Equal($"{Site}/odeme/asist/beauty/{started.Value.CheckoutToken}", started.Value.RedirectUrl);
        Assert.Matches("^[0-9a-f]{32}$", started.Value.CheckoutToken);
        return (started.Value.CheckoutToken, started.Value.AmountTRY);
    }

    [Fact]
    public async Task Subscription_IsRedirected_AndOpensOnlyOnSignedPaidNotice_Once()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        var (reference, amount) = await StartSubscriptionAsync(options, tenantId, planId);

        await using (var db = NewDb(options))
        {
            var view = await Connector(db).GetAsync(reference);
            Assert.NotNull(view);
            Assert.Equal(("pending", "subscription", (long)(amount * 100), "TRY", "Işıl Güzellik", tenantId),
                (view!.Status, view.Kind, view.AmountKurus, view.Currency, view.TenantName, view.TenantId));
            Assert.Equal($"{Callback}?token={reference}", view.ReturnUrl);
            // Ödeme sayfasına kişisel veri gitmez.
            var json = System.Text.Json.JsonSerializer.Serialize(view);
            Assert.DoesNotContain("05550000000", json);
            Assert.DoesNotContain("1234567890", json);

            // Tarayıcı ödemeden geri dönerse abonelik açılmaz; ödeme RED de sayılmaz (hâlâ ödenebilir).
            var early = await Billing(db).CompleteCheckoutAsync(reference);
            Assert.True(early.IsSuccess);
            Assert.False(early.Value!.Succeeded);
            Assert.Equal(SubscriptionPayment.Pending, (await db.SubscriptionPayments.SingleAsync()).Status);
        }

        await using (var db = NewDb(options))
        {
            var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_1", (long)(amount * 100), "try"));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
            Assert.Equal("settled", paid.Value!.Status);
        }

        await using (var db = NewDb(options))
        {
            var tenant = await db.Tenants.SingleAsync(t => t.Id == tenantId);
            Assert.Equal(TenantStatus.Active, tenant.Status);
            // Panel ödemenin Maydanoz'da alındığını bilir ("kartını kaydet" metni gösterilmez).
            Assert.Equal("Maydanoz", (await Billing(db).GetSummaryAsync(tenantId)).Value!.PaymentProvider);
            Assert.NotNull(tenant.SubscriptionEndsAtUtc);
            var payment = await db.SubscriptionPayments.SingleAsync();
            Assert.Equal((SubscriptionPayment.Succeeded, "Maydanoz", "chk_1"), (payment.Status, payment.Provider, payment.ProviderPaymentId));
            Assert.Equal("paid", (await Connector(db).GetAsync(reference))!.Status);

            // Aynı bildirim tekrar: işlem yok, "zaten alınmıştı". Tarayıcı dönüşü de idempotent.
            var again = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_1", (long)(amount * 100), "TRY"));
            Assert.Equal("settled", again.Value!.Status);
            Assert.True((await Billing(db).CompleteCheckoutAsync(reference)).Value!.Succeeded);
            Assert.Single(await db.TenantInvoices.ToListAsync());

            // Aynı ödemeye FARKLI ödeme kimliği: reddedilir (çift tahsilat Maydanoz'da incelenir).
            var other = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_2", (long)(amount * 100), "TRY"));
            Assert.True(other.IsFailure);
            Assert.Equal("Conflict", other.Error.Code);
        }
    }

    [Fact]
    public async Task PaidNotice_WithWrongAmount_DoesNotOpenSubscription()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        var (reference, amount) = await StartSubscriptionAsync(options, tenantId, planId);

        await using var db = NewDb(options);
        var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_low", 100, "TRY"));
        Assert.True(paid.IsSuccess);
        Assert.Equal("pending", paid.Value!.Status);
        Assert.NotEqual(TenantStatus.Active, (await db.Tenants.SingleAsync(t => t.Id == tenantId)).Status);
        Assert.Equal(SubscriptionPayment.Failed, (await db.SubscriptionPayments.SingleAsync()).Status);
    }

    [Fact]
    public async Task Credit_IsRedirected_AndGrantedOnPaidNotice()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);
        string reference;
        await using (var db = NewDb(options))
        {
            var started = await Credits(db).StartCreditCheckoutAsync(tenantId, new TopUpRequest(null, 250m), CreditCallback, null);
            Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
            reference = (await db.ExternalCheckouts.SingleAsync()).PublicRef;
            Assert.Equal(ExternalCheckout.KindCredit, (await db.ExternalCheckouts.SingleAsync()).Kind);
            Assert.Equal("credit", (await Connector(db).GetAsync(reference))!.Kind);
        }

        await using (var db = NewDb(options))
        {
            var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_c", 25000, "TRY"));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
            Assert.Equal("settled", paid.Value!.Status);
            var wallet = await db.TenantMessagingWallets.IgnoreQueryFilters().SingleAsync(w => w.TenantId == tenantId);
            Assert.Equal(250m, wallet.BalanceCredits);
        }
    }

    [Fact]
    public async Task Connector_RejectsUnknownMalformedAndIncompleteNotices()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        var (reference, _) = await StartSubscriptionAsync(options, tenantId, planId);
        await using var db = NewDb(options);
        var connector = Connector(db);

        Assert.Null(await connector.GetAsync("x"));
        Assert.Null(await connector.GetAsync(new string('a', 32)));
        Assert.Equal("NotFound", (await connector.RecordPaidAsync("x", new("p", 1, "TRY"))).Error.Code);
        Assert.Equal("NotFound", (await connector.RecordPaidAsync(new string('a', 32), new("p", 1, "TRY"))).Error.Code);
        foreach (var bad in new ConnectorCheckoutPaidRequest[] { new(null, 1, "TRY"), new(" ", 1, "TRY"), new(new string('p', 129), 1, "TRY"), new("p", 0, "TRY"), new("p", 1, null), new("p", 1, "TOOLONGCUR") })
            Assert.Equal("Validation", (await connector.RecordPaidAsync(reference, bad)).Error.Code);

        // Süresi dolan ödeme sayfası açılmaz.
        var row = await db.ExternalCheckouts.SingleAsync();
        db.Entry(row).Property(nameof(ExternalCheckout.ExpiresAtUtc)).CurrentValue = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        Assert.Equal("expired", (await connector.GetAsync(reference))!.Status);
    }

    [Fact]
    public async Task Gateway_ReadsOnlyItsOwnRecord_AndRefusesCardAndRefund()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var gateway = new MaydanozPaymentGateway(db, Site + "/");
        Assert.Equal("Maydanoz", gateway.Provider);

        Assert.True((await gateway.InitCheckoutAsync(new CheckoutInitRequest("c0", 10m, "x", "not-a-guid", "", "", "", "", "", "", "", "", Callback))).IsFailure);
        var init = await gateway.InitCheckoutAsync(new CheckoutInitRequest("c1", 1200m, "BeautyAsist", Guid.NewGuid().ToString("N"),
            "", "", "", "", "", "", "", "", Callback));
        Assert.StartsWith($"{Site}/odeme/asist/beauty/", init.Value!.PaymentPageUrl);

        var pending = await gateway.RetrievePaymentAsync("c1");
        Assert.Equal((false, PaymentOutcome.Unresolved), (pending.Value!.Succeeded, pending.Value.Outcome));
        var unknown = await gateway.RetrievePaymentAsync("yok");
        Assert.Equal((false, PaymentOutcome.Unresolved, "MAYDANOZ_UNKNOWN"), (unknown.Value!.Succeeded, unknown.Value.Outcome, unknown.Value.ErrorCode));
        Assert.True((await gateway.RetrieveCheckoutAsync("yok")).IsFailure);

        var row = await db.ExternalCheckouts.SingleAsync();
        Assert.Equal(ExternalCheckout.RecordOutcome.Recorded, row.RecordPaid("p1", 1200m, "TRY", DateTime.UtcNow));
        await db.SaveChangesAsync();
        var paid = await gateway.RetrievePaymentAsync("c1");
        Assert.Equal((true, PaymentOutcome.Succeeded, "p1", 1200m, "TRY"), (paid.Value!.Succeeded, paid.Value.Outcome, paid.Value.ProviderPaymentId, paid.Value.PaidAmountTry, paid.Value.Currency));

        Assert.True((await gateway.ChargeStoredCardAsync(new StoredCardChargeRequest("c2", 1m, "x", "k", "t", "b", "", "", "", "", "", "", "", ""))).IsFailure);
        Assert.True((await gateway.RefundAsync("p1", 1m)).IsFailure);
    }

    [Fact]
    public async Task Resolver_RequiresAValidSiteAddress()
    {
        var options = NewOptions();
        await SeedAsync(options);
        await using var db = NewDb(options);

        Assert.True((await Resolver(db).ResolveAsync()).IsSuccess);
        Assert.Equal("Maydanoz", (await Resolver(db).ResolveAsync()).Value!.Gateway.Provider);
        Assert.True((await Resolver(db, site: null).ResolveAsync()).IsFailure);
        Assert.True((await Resolver(db, site: "http://maydanozasist.com").ResolveAsync()).IsFailure);
        Assert.True((await Resolver(db, site: "http://localhost:3000", environment: "Development").ResolveAsync()).IsSuccess);

        Assert.Null(PaymentGatewayResolver.MaydanozSiteProblem("https://maydanozasist.com/", true));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem(" ", false));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem("maydanozasist.com", false));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem("ftp://maydanozasist.com", false));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem("https://maydanozasist.com/odeme", false));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem("https://maydanozasist.com/?a=1", false));
        Assert.NotNull(PaymentGatewayResolver.MaydanozSiteProblem("https://127.0.0.1/", true));

        // Ayar ekranı sağlayıcıyı tanır; iyzico anahtarı istemez.
        var settings = await db.PlatformIntegrationSettings.SingleAsync();
        Assert.Equal(("Maydanoz", true), (settings.PaymentProvider, settings.PaymentsConfigured));
    }

    [Fact]
    public void ExternalCheckout_GuardsItsInputs()
    {
        var now = DateTime.UtcNow;
        var r = MaydanozPaymentGateway.NewRef();
        Assert.Throws<DomainException>(() => new ExternalCheckout("kisa", "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, "x", Callback, now));
        Assert.Throws<DomainException>(() => new ExternalCheckout(r, " ", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, "x", Callback, now));
        Assert.Throws<DomainException>(() => new ExternalCheckout(r, "c", "Other", Guid.NewGuid(), 1m, "x", Callback, now));
        Assert.Throws<DomainException>(() => new ExternalCheckout(r, "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 0m, "x", Callback, now));
        Assert.Throws<DomainException>(() => new ExternalCheckout(r, "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, "x", " ", now));
        var checkout = new ExternalCheckout(r, "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, new string('d', 250), Callback, now);
        Assert.Equal(200, checkout.Description.Length);
        Assert.False(checkout.IsExpired(now));
        Assert.True(checkout.IsExpired(now + ExternalCheckout.Lifetime));
        Assert.Throws<DomainException>(() => checkout.RecordPaid(" ", 1m, "TRY", now));
        Assert.Equal(ExternalCheckout.RecordOutcome.Recorded, checkout.RecordPaid(" p ", 1m, "TRY", now));
        Assert.Equal("p", checkout.ProviderPaymentId);
        Assert.False(checkout.IsExpired(now + ExternalCheckout.Lifetime));
    }

    [Fact]
    public void CallbackUrl_UsesConfiguredPublicApiBase_WhenSet()
    {
        static HttpContext Http(string? configured)
        {
            var services = new ServiceCollection()
                .AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                {
                    [PaymentCallbacks.PaymentCallbackBaseKey] = configured,
                }).Build())
                .BuildServiceProvider();
            var http = new DefaultHttpContext { RequestServices = services };
            http.Request.Scheme = "https";
            http.Request.Host = new HostString("beautyasist.com");
            return http;
        }

        Assert.Equal("https://beautyasist.com/api/payments/callback", PaymentCallbacks.PaymentCallbackUrl(Http(null), "/api/payments/callback"));
        Assert.Equal("https://api.beautyasist.com/api/payments/callback",
            PaymentCallbacks.PaymentCallbackUrl(Http(" https://api.beautyasist.com/ "), "/api/payments/callback"));
    }
}
