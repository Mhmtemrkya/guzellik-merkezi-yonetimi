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
using NSubstitute;

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

    private static InvoicePaymentService Invoices(GuzellikDbContext db) => new(db, Resolver(db), new NoopAuditLogger());

    private static ConnectorCheckouts Connector(GuzellikDbContext db) => new(db, Billing(db), Credits(db), Invoices(db), new NoopAuditLogger());

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
            // Abonelik DÖNEMİ ödemesi: Maydanoz aylıkta otomatik ödeme seçeneğini bununla sunar.
            Assert.Equal("monthly", view.Period);
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
            var creditView = (await Connector(db).GetAsync(reference))!;
            Assert.Equal("credit", creditView.Kind);
            Assert.Null(creditView.Period);
        }

        await using (var db = NewDb(options))
        {
            var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_c", 25000, "TRY"));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
            Assert.Equal("settled", paid.Value!.Status);
            var wallet = await db.TenantMessagingWallets.IgnoreQueryFilters().SingleAsync(w => w.TenantId == tenantId);
            Assert.Equal(250m, wallet.BalanceCredits);
            // Mesaj kredisi kartı: ödeme maydanozasist.com'da (kart ya da havale / EFT orada seçilir).
            Assert.True((await Credits(db).GetWalletAsync(tenantId)).Value!.PayOnMaydanoz);
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

    /// <summary>
    /// HAVALE / EFT (18 Kas 2026): kurum havaleyi seçince kayıt havale süresince açık kalır (sayfa ve fatura ödeme kaydı
    /// yeniden kullanılabilir); geç gelen "ödendi" bildirimi her zamanki yoldan işlenir.
    /// </summary>
    [Fact]
    public async Task Transfer_KeepsTheCheckoutOpen_AndALateNoticeStillSettles()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        var (reference, amount) = await StartSubscriptionAsync(options, tenantId, planId);

        await using (var db = NewDb(options))
        {
            var connector = Connector(db);
            Assert.Equal("NotFound", (await connector.AwaitTransferAsync("x")).Error.Code);
            Assert.Equal("NotFound", (await connector.AwaitTransferAsync(new string('a', 32))).Error.Code);
            var started = await connector.AwaitTransferAsync(reference);
            Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
            Assert.Equal("pending", started.Value!.Status);
            Assert.True((await db.ExternalCheckouts.SingleAsync()).ExpiresAtUtc > DateTime.UtcNow.AddDays(6));
            Assert.True((await connector.AwaitTransferAsync(reference)).IsSuccess);   // tekrar zararsız
        }

        // 24 saat geçti: havale bekleyen kayıt hâlâ açık; bildirim gelince abonelik açılır.
        await using (var db = NewDb(options))
        {
            Assert.Equal("pending", (await Connector(db).GetAsync(reference))!.Status);
            var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_havale", (long)(amount * 100), "TRY"));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
            Assert.Equal("Conflict", (await Connector(db).AwaitTransferAsync(reference)).Error.Code);   // ödendi
        }
    }

    [Fact]
    public async Task Transfer_IsRefusedForAnExpiredCheckout()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        var (reference, _) = await StartSubscriptionAsync(options, tenantId, planId);
        await using var db = NewDb(options);
        var row = await db.ExternalCheckouts.SingleAsync();
        db.Entry(row).Property(nameof(ExternalCheckout.ExpiresAtUtc)).CurrentValue = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        Assert.Equal("Conflict", (await Connector(db).AwaitTransferAsync(reference)).Error.Code);
    }

    [Fact]
    public void AwaitTransfer_ExtendsButNeverShortens_AndOnlyWhilePending()
    {
        var now = DateTime.UtcNow;
        var checkout = new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, "x", Callback, now);
        Assert.True(checkout.AwaitTransfer(now));
        Assert.Equal(now + ExternalCheckout.TransferLifetime, checkout.ExpiresAtUtc);
        Assert.True(checkout.AwaitTransfer(now.AddDays(-1)));                      // daha erken bir an kısaltmaz
        Assert.Equal(now + ExternalCheckout.TransferLifetime, checkout.ExpiresAtUtc);
        Assert.False(checkout.AwaitTransfer(now + ExternalCheckout.TransferLifetime)); // süresi doldu
        checkout.RecordPaid("p", 1m, "TRY", now);
        Assert.False(checkout.AwaitTransfer(now));                                // ödendi
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

    /// <summary>
    /// AYNI PAKETİ DÖNEM BİTMEDEN ÖDEYEN KURUM GÜN KAYBETMEZ: tek paket olduğundan yenileme ödeme
    /// sayfasından gelir; yeni dönem mevcut bitişten devam eder.
    /// </summary>
    [Fact]
    public async Task EarlyRenewal_ThroughMaydanoz_ContinuesFromCurrentEnd()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        DateTime currentEnd;
        await using (var db = NewDb(options))
        {
            var tenant = await db.Tenants.SingleAsync(t => t.Id == tenantId);
            var plan = await db.SubscriptionPlans.SingleAsync(p => p.Id == planId);
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-20));
            await db.SaveChangesAsync();
            currentEnd = tenant.SubscriptionEndsAtUtc!.Value;
        }

        var (reference, amount) = await StartSubscriptionAsync(options, tenantId, planId);
        await using (var db = NewDb(options))
        {
            Assert.Equal("settled", (await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_r", (long)(amount * 100), "TRY"))).Value!.Status);
        }

        await using (var check = NewDb(options))
        {
            var tenant = await check.Tenants.SingleAsync(t => t.Id == tenantId);
            Assert.Equal(currentEnd.AddMonths(1), tenant.SubscriptionEndsAtUtc);
            var invoice = await check.TenantInvoices.SingleAsync(i => i.Status == "Paid");
            Assert.Equal(currentEnd, invoice.PeriodStartUtc);
        }
    }

    /// <summary>
    /// Ödeme kaydı yalnız abonelik DÖNEMİ ödemesinde dönemini söyler (Maydanoz aylıkta otomatik ödeme sunar):
    /// yıllık → "yearly"; aynı türde açılan şube farkı ödemesinde dönem boştur.
    /// </summary>
    [Fact]
    public async Task CheckoutView_ReportsThePeriod_OnlyForASubscriptionPeriodPayment()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        string yearlyRef;
        await using (var db = NewDb(options))
        {
            var started = await Billing(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Yearly, Callback);
            Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
            yearlyRef = started.Value!.CheckoutToken;

            var branch = new SubscriptionPayment(tenantId, planId, BillingPeriod.Monthly, 600m, MaydanozPaymentGateway.ProviderName, "brn-test-1", attemptNumber: 1);
            branch.MarkAsBranchAddon("{\"name\":\"Karşıyaka\"}");
            db.SubscriptionPayments.Add(branch);
            db.ExternalCheckouts.Add(new ExternalCheckout(new string('a', 32), "brn-test-1", ExternalCheckout.KindSubscription, tenantId, 600m, "Ek şube", Callback, DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        await using var check = NewDb(options);
        Assert.Equal("yearly", (await Connector(check).GetAsync(yearlyRef))!.Period);
        var branchView = (await Connector(check).GetAsync(new string('a', 32)))!;
        Assert.Equal(("subscription", null), (branchView.Kind, branchView.Period));
    }

    /// <summary>
    /// Ödeme Maydanoz'dayken BeautyAsist'in kartlı yenileme işi hiçbir şey çekmez ve satır yazmaz: eski bir
    /// kart satırı kalmış olsa bile çözülemeyen bekleyen deneme açılmaz, kurum askıya alınmaz.
    /// </summary>
    [Fact]
    public async Task Renewal_WithMaydanoz_ChargesNothing_EvenWithALegacyCard()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);
        await using (var db = NewDb(options))
        {
            var tenant = await db.Tenants.SingleAsync(t => t.Id == tenantId);
            var plan = await db.SubscriptionPlans.SingleAsync(p => p.Id == planId);
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1).AddDays(1));
            db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenantId, "Iyzico", "u", "t", "552879******0004", null, null, null));
            await db.SaveChangesAsync();
        }

        for (var tick = 0; tick < 4; tick++)
        {
            await using var db = NewDb(options);
            var outcome = await Billing(db).ChargeRenewalAsync(tenantId);
            Assert.True(outcome.IsSuccess);
            Assert.False(outcome.Value!.Charged);
            Assert.Equal(0, outcome.Value.AttemptNumber);
        }

        await using var check = NewDb(options);
        Assert.Empty(await check.SubscriptionPayments.ToListAsync());
        Assert.Equal(TenantStatus.Active, (await check.Tenants.SingleAsync(t => t.Id == tenantId)).Status);
    }

    /// <summary>
    /// Ödeme Maydanoz'dayken mesaj kredisi yalnız kurum yetkilisince alınır (Maydanoz hesabı yetkilinindir): başka rol için
    /// ödeme kaydı AÇILMAZ.
    /// </summary>
    [Fact]
    public async Task CreditCheckout_OnMaydanoz_IsForTheInstitutionOwnerOnly()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);
        await using var db = NewDb(options);
        var manager = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance, Resolver(db), new NoopAuditLogger(), new TestCurrentUser(UserRole.BranchManager));
        var refused = await manager.StartCreditCheckoutAsync(tenantId, new TopUpRequest(null, 250m), CreditCallback, null);
        Assert.Equal("Forbidden", refused.Error.Code);
        Assert.Empty(await db.ExternalCheckouts.ToListAsync());
        var admin = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance, Resolver(db), new NoopAuditLogger(), new TestCurrentUser(UserRole.PlatformAdmin));
        Assert.True((await admin.StartCreditCheckoutAsync(tenantId, new TopUpRequest(null, 250m), CreditCallback, null)).IsSuccess);
    }

    /// <summary>
    /// Maydanoz Hesabım'dan kredi alımı (bağlayıcı <c>accounts/{id}/credit-checkout</c>) panel kullanıcısı TAŞIMAZ; yetkili
    /// kuralına takılmamalı (19 Kas 2026: kuralın ilk hâli bu yolu 403 ile kesiyordu, bağlayıcı testleri kredi servisini
    /// taklit ettiği için görünmedi). Burada GERÇEK kredi servisiyle, bağlayıcı isteğindeki gibi kullanıcısız çağrılır.
    /// </summary>
    [Fact]
    public async Task CreditCheckout_FromMaydanozAccountConnector_IsNotBlockedByThePanelOwnerRule()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);
        await using var db = NewDb(options);
        var anonymous = new TestCurrentUser(role: null) { IsAuthenticated = false, UserId = null };
        var credits = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance, Resolver(db), new NoopAuditLogger(), anonymous);
        var env = NSubstitute.Substitute.For<Microsoft.Extensions.Hosting.IHostEnvironment>();
        env.EnvironmentName.Returns("Production");
        var connector = new GuzellikMerkezi.Api.Services.ConnectorAccountService(db, new PlainPasswordHasher(),
            new MemoryOtpStateStore(new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions())),
            NSubstitute.Substitute.For<GuzellikMerkezi.Application.Features.PlatformMessaging.IPlatformMessagingService>(), Billing(db),
            new FixedClock(DateTime.UtcNow), env, NullLogger<GuzellikMerkezi.Api.Services.ConnectorAccountService>.Instance, credits);

        var started = await connector.CreditCheckoutAsync(tenantId,
            new GuzellikMerkezi.Api.Services.ConnectorAccountCreditCheckoutRequest("whatsapp", null, 250, $"{Site}/hesabim"), default);
        Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
        Assert.StartsWith($"{Site}/odeme/asist/beauty/", started.Value!.Url);
        Assert.Single(await db.ExternalCheckouts.ToListAsync());
    }

    private static async Task<Guid> SeedOpenInvoiceAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId, decimal amount = 600m, bool withBranch = true)
    {
        await using var db = NewDb(options);
        var now = DateTime.UtcNow;
        var invoice = new TenantInvoice(tenantId, $"INV-TEST-{Guid.NewGuid():N}"[..20], now, now.AddMonths(1), amount, "BeautyAsist · Ek şube · Karşıyaka (ödenince açılacak)");
        invoice.ChangeStatus("Sent");
        if (withBranch) invoice.AwaitBranch("{\"name\":\"Karşıyaka\",\"city\":\"İzmir\",\"isDefault\":false}");
        db.TenantInvoices.Add(invoice);
        await db.SaveChangesAsync();
        return invoice.Id;
    }

    /// <summary>Açık fatura Maydanoz'da ödenir: bildirimle fatura kapanır, bekleyen şube bir kez açılır.</summary>
    [Fact]
    public async Task OpenInvoice_IsPaidOnMaydanoz_ClosesOnceAndOpensTheBranch()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);
        var invoiceId = await SeedOpenInvoiceAsync(options, tenantId);
        const string InvoiceCallback = "https://api.beautyasist.test/api/payments/invoice-callback";

        string reference;
        await using (var db = NewDb(options))
        {
            var started = await Invoices(db).StartAsync(tenantId, invoiceId, InvoiceCallback);
            Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
            reference = started.Value!.CheckoutToken;
            Assert.Equal($"{Site}/odeme/asist/beauty/{reference}", started.Value.RedirectUrl);
            // İkinci tıklama aynı ödeme sayfasını döner (iki ayrı ödeme açılmaz).
            Assert.Equal(reference, (await Invoices(db).StartAsync(tenantId, invoiceId, InvoiceCallback)).Value!.CheckoutToken);
            var view = await Connector(db).GetAsync(reference);
            Assert.Equal(("invoice", 60000L), (view!.Kind, view.AmountKurus));
            Assert.Contains("Karşıyaka", view.Description);
            Assert.False((await Invoices(db).OutcomeAsync(reference)).Paid);
        }

        await using (var db = NewDb(options))
        {
            var paid = await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_inv", 60000, "TRY"));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
            Assert.Equal("settled", paid.Value!.Status);
            // Tekrar bildirim işlem yapmaz.
            Assert.Equal("settled", (await Connector(db).RecordPaidAsync(reference, new ConnectorCheckoutPaidRequest("chk_inv", 60000, "TRY"))).Value!.Status);
        }

        await using (var check = NewDb(options))
        {
            var invoice = await check.TenantInvoices.SingleAsync(i => i.Id == invoiceId);
            Assert.Equal(("Paid", "chk_inv", (string?)null), (invoice.Status, invoice.PaymentReference, invoice.PendingBranchJson));
            Assert.Equal(["Karşıyaka", "Merkez"], (await check.Branches.IgnoreQueryFilters().Where(b => b.TenantId == tenantId).Select(b => b.Name).ToListAsync()).Order());
            Assert.True((await Invoices(check).OutcomeAsync(reference)).Paid);
            Assert.False((await Invoices(check).OutcomeAsync("yok")).Paid);
        }
    }

    [Fact]
    public async Task InvoicePayment_RefusesWrongAmountCancelledOrForeignClosure()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);

        async Task<(string Ref, Guid InvoiceId)> StartAsync()
        {
            var invoiceId = await SeedOpenInvoiceAsync(options, tenantId, withBranch: false);
            await using var db = NewDb(options);
            return ((await Invoices(db).StartAsync(tenantId, invoiceId, "https://api.beautyasist.test/cb")).Value!.CheckoutToken, invoiceId);
        }

        // Tutar uymuyor: fatura kapanmaz.
        var (wrong, wrongInvoice) = await StartAsync();
        await using (var db = NewDb(options))
        {
            var result = await Connector(db).RecordPaidAsync(wrong, new ConnectorCheckoutPaidRequest("chk_w", 100, "TRY"));
            Assert.Equal("Conflict", result.Error.Code);
            Assert.Equal("Sent", (await db.TenantInvoices.SingleAsync(i => i.Id == wrongInvoice)).Status);
        }

        // Ödeme beklerken fatura iptal edildi: ödeme işlenmez (iade edilmeli).
        var (cancelled, cancelledInvoice) = await StartAsync();
        await using (var db = NewDb(options))
        {
            (await db.TenantInvoices.SingleAsync(i => i.Id == cancelledInvoice)).ChangeStatus("Cancelled");
            await db.SaveChangesAsync();
            Assert.Equal("expired", (await Connector(db).GetAsync(cancelled))!.Status);
            Assert.Equal("Conflict", (await Connector(db).RecordPaidAsync(cancelled, new ConnectorCheckoutPaidRequest("chk_c", 60000, "TRY"))).Error.Code);
        }

        // Platform faturayı başka bir ödemeyle kapattı: ödeme sayfası kapanır, gelen ödeme işlenmez.
        var (foreign, foreignInvoice) = await StartAsync();
        await using (var db = NewDb(options))
        {
            Assert.Equal("pending", (await Connector(db).GetAsync(foreign))!.Status);
            (await db.TenantInvoices.SingleAsync(i => i.Id == foreignInvoice)).MarkPaid(DateTime.UtcNow, "elle-1");
            await db.SaveChangesAsync();
            Assert.Equal("expired", (await Connector(db).GetAsync(foreign))!.Status);
            Assert.Equal("Conflict", (await Connector(db).RecordPaidAsync(foreign, new ConnectorCheckoutPaidRequest("chk_f", 60000, "TRY"))).Error.Code);
            Assert.Equal("elle-1", (await db.TenantInvoices.SingleAsync(i => i.Id == foreignInvoice)).PaymentReference);
        }

        // Tutarı sonradan değişen fatura: eski tutarla ödeme sayfası kapanır.
        var (changed, changedInvoice) = await StartAsync();
        await using (var db = NewDb(options))
        {
            var invoice = await db.TenantInvoices.SingleAsync(i => i.Id == changedInvoice);
            invoice.UpdateDetails(700m, invoice.DueDateUtc, invoice.Notes);
            await db.SaveChangesAsync();
            Assert.Equal("expired", (await Connector(db).GetAsync(changed))!.Status);
        }

        // Para birimi TRY değil.
        var (currency, _) = await StartAsync();
        await using (var db = NewDb(options))
        {
            Assert.Equal("Conflict", (await Connector(db).RecordPaidAsync(currency, new ConnectorCheckoutPaidRequest("chk_u", 60000, "USD"))).Error.Code);
        }

        // Ödenmemiş ya da fatura olmayan kayıt fatura yolundan kapatılamaz.
        await using (var db = NewDb(options))
        {
            var subscription = new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c-x", ExternalCheckout.KindSubscription, tenantId, 1m, "x", Callback, DateTime.UtcNow);
            Assert.Equal("Validation", (await Invoices(db).SettleAsync(subscription)).Error.Code);
            var orphan = new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c-y", ExternalCheckout.KindInvoice, tenantId, 1m, "x", Callback, DateTime.UtcNow, Guid.NewGuid());
            orphan.RecordPaid("p", 1m, "TRY", DateTime.UtcNow);
            Assert.Equal("NotFound", (await Invoices(db).SettleAsync(orphan)).Error.Code);
        }
    }

    [Fact]
    public async Task InvoicePayment_StartsOnlyForAnOpenInvoiceOfTheTenantThroughMaydanoz()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);
        var invoiceId = await SeedOpenInvoiceAsync(options, tenantId);
        await using var db = NewDb(options);

        Assert.Equal("NotFound", (await Invoices(db).StartAsync(Guid.NewGuid(), invoiceId, Callback)).Error.Code);
        Assert.Equal("NotFound", (await Invoices(db).StartAsync(tenantId, Guid.NewGuid(), Callback)).Error.Code);

        var invoice = await db.TenantInvoices.SingleAsync(i => i.Id == invoiceId);
        invoice.ChangeStatus("Draft");
        await db.SaveChangesAsync();
        Assert.Equal("Conflict", (await Invoices(db).StartAsync(tenantId, invoiceId, Callback)).Error.Code);
        invoice.ChangeStatus("Overdue");
        invoice.UpdateDetails(0m, invoice.DueDateUtc, invoice.Notes);
        await db.SaveChangesAsync();
        Assert.Equal("Conflict", (await Invoices(db).StartAsync(tenantId, invoiceId, Callback)).Error.Code);

        // Sağlayıcı Maydanoz değilse fatura ödemesi açılmaz; ödeme kapalıysa çözücünün hatası döner.
        var settings = await db.PlatformIntegrationSettings.SingleAsync();
        settings.UpdatePayments(true, "Simulation", null, null, null, "https://beautyasist.test/panel/paket");
        await db.SaveChangesAsync();
        var simulation = new InvoicePaymentService(db, new PaymentTestDoubles.SimulationResolver(), new NoopAuditLogger());
        Assert.Equal("Conflict", (await simulation.StartAsync(tenantId, invoiceId, Callback)).Error.Code);
        var disabled = new InvoicePaymentService(db, new PaymentTestDoubles.DisabledResolver(), new NoopAuditLogger());
        Assert.True((await disabled.StartAsync(tenantId, invoiceId, Callback)).IsFailure);
    }

    [Fact]
    public void ExternalCheckout_InvoiceKindNeedsAnInvoice()
    {
        var now = DateTime.UtcNow;
        Assert.Throws<DomainException>(() => new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c", ExternalCheckout.KindInvoice, Guid.NewGuid(), 1m, "x", Callback, now));
        Assert.Throws<DomainException>(() => new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c", ExternalCheckout.KindSubscription, Guid.NewGuid(), 1m, "x", Callback, now, Guid.NewGuid()));
        Assert.NotNull(new ExternalCheckout(MaydanozPaymentGateway.NewRef(), "c", ExternalCheckout.KindInvoice, Guid.NewGuid(), 1m, "x", Callback, now, Guid.NewGuid()).InvoiceId);
    }
}

