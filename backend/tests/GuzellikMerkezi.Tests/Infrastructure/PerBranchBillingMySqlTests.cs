using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ŞUBE BAŞINA FİYATLAMA — GERÇEK MySQL. InMemory sağlayıcı işlemleri, satır kilitlerini ve sorgu
/// çevirisini sınamaz; para yolunun bu kısımları yalnız burada doğrulanır.
/// </summary>
public sealed class PerBranchBillingMySqlTests
{
    private static readonly PricingTier[] Tiers = [new(10_000, 250m), new(15_000, 500m), new(20_000, 1_000m)];

    private sealed record Seed(Guid TenantId, Guid PlanId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, bool card = true)
    {
        await using var db = database.NewContext();
        var plan = new SubscriptionPlan($"ba-{Guid.NewGuid():N}"[..16], "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: true, Tiers, Tiers, 10m);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Şube Yarış QA", $"sube-yaris-{Guid.NewGuid():N}"[..24], "Deneme", TenantStatus.Trial);
        var main = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-15));
        if (card)
            db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenant.Id, "Slow", "user-key", "card-token", "552879******0004", null, null, null));
        db.Customers.Add(new Customer(tenant.Id, main.Id, "MÜŞTERİ BİR", "0555 111 22 33", null));
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, plan.Id);
    }

    private static BillingService NewBilling(GuzellikDbContext db, IPaymentGateway gateway) =>
        new(db, new FixedResolver(gateway), new Passthrough(), new NoopAuditLogger(), new AllowAllFeatureService(),
            new TestCurrentUser(UserRole.InstitutionOwner), NullLogger<BillingService>.Instance);

    private static BranchService NewBranches(GuzellikDbContext db, IPaymentGateway gateway) =>
        new(db, new AlwaysAllowUsageService(), NewBilling(db, gateway), new TestCurrentUser(UserRole.InstitutionOwner));

    /// <summary>
    /// ASIL İDDİA: aynı anda gelen iki onaylı şube isteği (iki sekme / çift tık) kartı YALNIZ BİR KEZ
    /// çeker. Kilit olmadan ikisi de "bekleyen ödeme yok" görüp iki çekim yapıyordu (işlem anahtarı
    /// milisaniyeli olduğundan benzersiz indeks yakalamaz).
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentBranchPurchases_ChargeExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var gateway = new SlowGateway(TimeSpan.FromMilliseconds(400));

        decimal confirmed;
        await using (var db = database.NewContext())
        {
            var quote = await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId);
            Assert.True(quote.Value!.ChargeRequired);
            Assert.True(quote.Value.CanPurchase, quote.Value.Reason);
            confirmed = quote.Value.Quote!.Total;
        }

        async Task<Result<BranchDto>> CreateAsync(string name)
        {
            await using var db = database.NewContext();
            return await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest(name, "İstanbul", false, ConfirmedChargeTRY: confirmed));
        }

        var results = await Task.WhenAll(CreateAsync("Kadıköy"), CreateAsync("Beşiktaş"));

        Assert.Equal(1, gateway.ChargeCount);
        Assert.Single(results, r => r.IsSuccess);
        Assert.Single(results, r => r.IsFailure && r.Error.Code == "BranchChargePending");

        await using var check = database.NewContext();
        Assert.Equal(2, await check.Branches.IgnoreQueryFilters().CountAsync(b => b.TenantId == seed.TenantId && !b.IsDeleted));
        var payment = await check.SubscriptionPayments.IgnoreQueryFilters().SingleAsync(p => p.TenantId == seed.TenantId);
        Assert.Equal(SubscriptionPayment.KindBranchAddon, payment.Kind);
        Assert.Equal(SubscriptionPayment.Succeeded, payment.Status);
        var invoice = await check.TenantInvoices.IgnoreQueryFilters().SingleAsync(i => i.TenantId == seed.TenantId);
        Assert.Equal(confirmed, invoice.AmountTRY);
        Assert.NotNull(SubscriptionQuote.FromJson(invoice.LinesJson));
    }

    /// <summary>
    /// KARTSIZ KURUM (canlıda ödeme kapalıyken platformun elle dönem açtığı kurum) — gerçek işlem ve
    /// satır kilidiyle: şube HEMEN AÇILMAZ, açılacak şubenin bilgisini taşıyan AÇIK fatura kesilir; ödeme
    /// satırı/çekim yok. Eşzamanlı iki farklı adlı talep iki ayrı fatura üretir (her şube kendi borcunu
    /// taşır); AYNI adlı eşzamanlı iki talep kurum kilidi sayesinde TEK fatura üretir.
    /// </summary>
    [MySqlFact]
    public async Task NoCard_BranchRequestsBecomeOpenInvoices_OnMySql()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, card: false);
        var gateway = new SlowGateway(TimeSpan.Zero);

        decimal confirmed;
        await using (var db = database.NewContext())
        {
            var quote = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
            Assert.Equal(BranchChargeMethods.Invoice, quote.ChargeMethod);
            Assert.True(quote.CanPurchase, quote.Reason);
            confirmed = quote.Quote!.Total;
        }

        async Task<Result<BranchDto>> CreateAsync(string name)
        {
            await using var db = database.NewContext();
            return await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest(name, "İstanbul", false, ConfirmedChargeTRY: confirmed));
        }

        var results = await Task.WhenAll(CreateAsync("Kadıköy"), CreateAsync("Beşiktaş"), CreateAsync("Kadıköy"));
        Assert.All(results, r => Assert.Equal("BranchAwaitingPayment", r.Error.Code));
        Assert.Equal(0, gateway.ChargeCount);

        await using var check = database.NewContext();
        Assert.Equal(1, await check.Branches.IgnoreQueryFilters().CountAsync(b => b.TenantId == seed.TenantId && !b.IsDeleted));
        Assert.False(await check.SubscriptionPayments.IgnoreQueryFilters().AnyAsync(p => p.TenantId == seed.TenantId));
        var invoices = await check.TenantInvoices.IgnoreQueryFilters().Where(i => i.TenantId == seed.TenantId).ToListAsync();
        Assert.Equal(2, invoices.Count);   // Kadıköy ×2 → tek fatura, Beşiktaş → bir fatura
        Assert.All(invoices, i =>
        {
            Assert.Equal("Sent", i.Status);
            Assert.Equal(confirmed, i.AmountTRY);
            Assert.Null(i.PaymentReference);
            Assert.NotNull(i.PendingBranchJson);
        });
        Assert.Equal(2, invoices.Select(i => i.Number).Distinct().Count());
    }

    /// <summary>
    /// İki platform yöneticisi AYNI faturayı aynı anda "Ödendi" yaparsa şube YALNIZ BİR KEZ açılır:
    /// fatura satırı kilitlenir, bekleyen şube bilgisi aynı işlemde tüketilir.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentInvoicePaid_OpensTheBranchExactlyOnce_OnMySql()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, card: false);
        var gateway = new SlowGateway(TimeSpan.Zero);

        await using (var db = database.NewContext())
        {
            var total = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.Quote!.Total;
            var requested = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: total));
            Assert.Equal("BranchAwaitingPayment", requested.Error.Code);
        }

        Guid invoiceId;
        await using (var db = database.NewContext())
            invoiceId = (await db.TenantInvoices.IgnoreQueryFilters().SingleAsync(i => i.TenantId == seed.TenantId)).Id;

        async Task<Result<GuzellikMerkezi.Application.Features.PlatformOps.TenantInvoiceDto>> MarkPaidAsync()
        {
            await using var db = database.NewContext();
            return await new PlatformOpsService(db, new NoopAuditLogger())
                .UpdateInvoiceStatusAsync(invoiceId, new GuzellikMerkezi.Application.Features.PlatformOps.UpdateInvoiceStatusRequest("Paid"));
        }

        var marks = await Task.WhenAll(MarkPaidAsync(), MarkPaidAsync(), MarkPaidAsync());
        Assert.All(marks, m => Assert.True(m.IsSuccess, m.IsFailure ? m.Error.Message : null));

        await using var check = database.NewContext();
        var branches = await check.Branches.IgnoreQueryFilters().Where(b => b.TenantId == seed.TenantId && !b.IsDeleted).ToListAsync();
        Assert.Equal(2, branches.Count);
        Assert.Single(branches, b => b.Name == "Kadıköy");
        var invoice = await check.TenantInvoices.IgnoreQueryFilters().SingleAsync(i => i.Id == invoiceId);
        Assert.Equal("Paid", invoice.Status);
        Assert.Null(invoice.PendingBranchJson);
    }

    /// <summary>
    /// Yeni/ değişen sorgular gerçek MySQL'de çevrilmeli: sayaçlar (filtre dışı + açık TenantId),
    /// teklif, özet ve platform faturalama ekranı (gruplu sayımlar).
    /// </summary>
    [MySqlFact]
    public async Task QuoteSummaryAndPlatformOverview_TranslateOnMySql()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using var db = database.NewContext();
        var counts = await BillingCountsQuery.CountAsync(db, seed.TenantId, CancellationToken.None);
        Assert.Equal(new BillingCounts(1, 1, 0), counts);

        var billing = NewBilling(db, new SlowGateway(TimeSpan.Zero));
        var quote = await billing.GetQuoteAsync(seed.TenantId, seed.PlanId, BillingPeriod.Yearly);
        Assert.Equal(12_000m, quote.Value!.Total);

        var summary = await billing.GetSummaryAsync(seed.TenantId);
        Assert.True(summary.IsSuccess, summary.IsFailure ? summary.Error.Message : null);
        Assert.Equal(1_200m, summary.Value!.NextRenewalQuote!.Total);

        var overview = await new PlatformOpsService(db, new NoopAuditLogger()).GetBillingOverviewAsync();
        Assert.True(overview.IsSuccess, overview.IsFailure ? overview.Error.Message : null);
        var row = Assert.Single(overview.Value!.Subscriptions, s => s.TenantId == seed.TenantId);
        Assert.Equal(1_000m, row.MonthlyEquivalentNet);
        Assert.True(row.HasCard);
    }

    // ───────────── Test dublörleri ─────────────

    private sealed class FixedResolver(IPaymentGateway gateway) : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(gateway, "https://panel.test")));
    }

    private sealed class Passthrough : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    /// <summary>Çekimi yavaş yapan (yarış penceresini açan), çekim sayısını sayan sağlayıcı.</summary>
    private sealed class SlowGateway(TimeSpan delay) : IPaymentGateway
    {
        private int _charges;
        public int ChargeCount => Volatile.Read(ref _charges);
        public string Provider => "Slow";

        public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default) => throw new NotSupportedException();

        public async Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _charges);
            await Task.Delay(delay, ct);
            return Result<ChargeResult>.Success(new ChargeResult(true, request.ConversationId, $"pay-{request.ConversationId}",
                request.AmountTry, null, null, "TRY", PaymentOutcome.Succeeded));
        }

        public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
            Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(false, conversationId, null, 0m, "UNKNOWN", null, "TRY", PaymentOutcome.Unresolved)));

        public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
            Task.FromResult(Result.Success());
    }
}
