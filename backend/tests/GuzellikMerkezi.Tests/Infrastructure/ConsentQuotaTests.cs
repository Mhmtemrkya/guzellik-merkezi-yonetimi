using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Consents;
using GuzellikMerkezi.Application.Features.PlatformOps;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DİJİTAL ONAM KOTASI — "sınırı geçen ÖDEMEDEN kullanamaz".
///
/// <para>
/// Kademeler küçük tutulur (2 → 250 ₺, 4 → 500 ₺): 2 evrağa kadar ücretsiz, 3–4. evrak "2 üzeri"
/// kademesini, 5. ve sonrası "4 üzeri" kademesini gerektirir. Ödenmiş kademe YALNIZ "Paid" ve bugünü
/// kapsayan faturadan okunur; açık fatura kilidi açmaz, iptal hakkı geri alır.
/// </para>
/// </summary>
public sealed class ConsentQuotaTests
{
    private static readonly PricingTier[] Tiers = [new(2, 250m), new(4, 500m)];

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static ConsentService NewConsents(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner), new AllowAllFeatureService());

    private static BillingService NewBilling(GuzellikDbContext db, ScriptedGateway gateway, bool paymentsOn = true) =>
        new(db, paymentsOn ? new FixedResolver(gateway) : new DisabledResolver(), new Passthrough(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner), NullLogger<BillingService>.Instance);

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid BranchId);

    private enum Mode { Trial, ActiveNoPeriod, Paid }

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, int signed, Mode mode = Mode.Paid, bool card = false)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan("ba-onam", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: true, [], Tiers, 10m);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Onam QA", $"onam-{Guid.NewGuid():N}"[..20], "BeautyAsist",
            mode == Mode.Trial ? TenantStatus.Trial : TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        tenant.AssignSubscriptionPlan(plan);
        if (mode == Mode.Paid)
        {
            // Aylık dönemin ortası (15 gün kaldı).
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-15));
            if (card) db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenant.Id, "Scripted", "u", "t", "552879******0004", null, null, null));
        }
        var customer = new Customer(tenant.Id, branch.Id, "Ayşe Müşteri", "+90 555 000 00 01", null);
        db.Customers.Add(customer);
        for (var i = 0; i < signed; i++)
        {
            var f = NewForm(tenant.Id, branch.Id, customer.Id);
            f.StartSession(null, DateTime.UtcNow);
            f.Sign(null, null, null, "Ayşe", null, null, DateTime.UtcNow);
            db.CustomerConsentForms.Add(f);
        }
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, customer.Id, branch.Id);
    }

    private static CustomerConsentForm NewForm(Guid tenantId, Guid branchId, Guid customerId) =>
        new(tenantId, branchId, customerId, null, null, "Lazer onamı", "Metin", null, requiresSignature: false,
            null, "Ayşe Müşteri", null, null, null, null, null);

    /// <summary>İmzaya hazır (oturumu açık) bir form ekler; oturum jetonunu döner.</summary>
    private static async Task<(Guid FormId, Guid Token)> AddPendingFormAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        var f = NewForm(seed.TenantId, seed.BranchId, seed.CustomerId);
        var token = f.StartSession("Kabin 1", DateTime.UtcNow);
        db.CustomerConsentForms.Add(f);
        await db.SaveChangesAsync();
        return (f.Id, token);
    }

    private static async Task<Result<ConsentFormDto>> SignAsync(DbContextOptions<GuzellikDbContext> options, Seed seed, Guid token)
    {
        await using var db = NewDb(options);
        return await NewConsents(db).SignAsync(seed.TenantId, token, new SignConsentFormRequest(null, null, "Ayşe"));
    }

    // ───────────── Saf kurallar ─────────────

    [Fact]
    public void Allowance_FreePartThenPaidTiers()
    {
        Assert.Equal(2, ConsentAllowance.Capacity(Tiers, paidAbove: null));
        Assert.Equal(4, ConsentAllowance.Capacity(Tiers, paidAbove: 2));
        Assert.Null(ConsentAllowance.Capacity(Tiers, paidAbove: 4));      // en üst kademe ödendi → sınırsız
        Assert.True(ConsentAllowance.CanSignAnother(Tiers, null, signed: 1));
        Assert.False(ConsentAllowance.CanSignAnother(Tiers, null, signed: 2));
        Assert.True(ConsentAllowance.CanSignAnother(Tiers, 2, signed: 3));
        Assert.False(ConsentAllowance.CanSignAnother(Tiers, 2, signed: 4));
        Assert.Null(ConsentAllowance.Capacity([], null));                   // kademe tanımı yok → sınır yok
        Assert.Null(ConsentAllowance.Capacity([new PricingTier(2, 0m)], null)); // bedelsiz kademe karşılanmış sayılır
        Assert.Equal(250m, ConsentAllowance.PaidMonthlyFee(Tiers, 2));
        Assert.Equal(0m, ConsentAllowance.PaidMonthlyFee(Tiers, null));
    }

    [Fact]
    public void UpgradeQuote_ProratesTheMonthlyDifference_AndNoPeriodIsOneMonth()
    {
        var plan = new SubscriptionPlan("p", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(true, [], Tiers, 10m);
        var now = new DateTime(2026, 11, 13, 12, 0, 0, DateTimeKind.Utc);
        var counts = new BillingCounts(1, 0, 2);

        // Dönemsiz: tam bir aylık fark (250) + KDV.
        var noPeriod = SubscriptionPricing.ConsentUpgrade(plan, null, now, null, Tiers[0], 0m, counts);
        Assert.Equal(250m, noPeriod.Subtotal);
        Assert.Equal(300m, noPeriod.Total);

        // Aylık dönem, 15 gün kaldı (dönem 30 gün): 250 / 30 × 15 = 125.
        var ends = now.AddDays(15);
        var monthly = SubscriptionPricing.ConsentUpgrade(plan, BillingPeriod.Monthly, now, ends, Tiers[0], 0m, counts);
        var periodDays = (int)Math.Round((ends - ends.AddMonths(-1)).TotalDays);
        Assert.Equal(decimal.Round(250m / periodDays * 15, 2, MidpointRounding.AwayFromZero), monthly.Subtotal);

        // Ödenmiş 2-kademesinden 4-kademesine: yalnız FARK (500 − 250).
        var diff = SubscriptionPricing.ConsentUpgrade(plan, null, now, null, Tiers[1], 250m, counts);
        Assert.Equal(250m, diff.Subtotal);
    }

    // ───────────── Kapı ─────────────

    [Fact]
    public async Task Sign_WithinFreePart_Succeeds_ThenBlocksAboveCapacity()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 1);
        var (_, second) = await AddPendingFormAsync(options, seed);
        var (thirdId, third) = await AddPendingFormAsync(options, seed);

        Assert.True((await SignAsync(options, seed, second)).IsSuccess);   // 2. evrak: ücretsiz bölümün sonu

        var blocked = await SignAsync(options, seed, third);              // 3. evrak: "2 üzeri" kademesi ödenmedi
        Assert.True(blocked.IsFailure);
        Assert.Equal("ConsentLimitReached", blocked.Error.Code);
        Assert.DoesNotContain("Paketim", blocked.Error.Message);           // iOS: satın alma çağrısı yok

        await using var check = NewDb(options);
        Assert.False((await check.CustomerConsentForms.IgnoreQueryFilters().SingleAsync(f => f.Id == thirdId)).IsSigned);
    }

    [Fact]
    public async Task StartSession_IsBlocked_WhenCapacityIsUsedUp()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2);
        Guid formId;
        await using (var db = NewDb(options))
        {
            var f = NewForm(seed.TenantId, seed.BranchId, seed.CustomerId);
            db.CustomerConsentForms.Add(f);
            await db.SaveChangesAsync();
            formId = f.Id;
        }

        await using var check = NewDb(options);
        var result = await NewConsents(check).StartSessionAsync(seed.TenantId, formId, new StartConsentSessionRequest("Kabin 1", null));
        Assert.Equal("ConsentLimitReached", result.Error.Code);
    }

    /// <summary>Silinen imzalı evrak kapasite geri kazandırmaz (ödemeden kullanmanın arka kapısı olurdu).</summary>
    [Fact]
    public async Task DeletedSignedForms_StillCount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2);
        await using (var db = NewDb(options))
        {
            var one = await db.CustomerConsentForms.IgnoreQueryFilters().FirstAsync(f => f.TenantId == seed.TenantId);
            one.SoftDelete();
            await db.SaveChangesAsync();
        }
        var (_, token) = await AddPendingFormAsync(options, seed);
        Assert.Equal("ConsentLimitReached", (await SignAsync(options, seed, token)).Error.Code);
    }

    // ───────────── Faturayla yükseltme (canlı yol: ödeme kapalı / kart yok) ─────────────

    [Fact]
    public async Task InvoiceUpgrade_OpenInvoiceDoesNotUnlock_PaidUnlocks_CancelledRelocks()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.Paid, card: false);
        var gateway = new ScriptedGateway();

        TierAllowanceDto allowance;
        await using (var db = NewDb(options))
            allowance = (await NewBilling(db, gateway).GetConsentAllowanceAsync(seed.TenantId)).Value!;
        Assert.False(allowance.Allowed);
        Assert.Equal(2, allowance.Capacity);
        Assert.Equal(2, allowance.NextTierAbove);
        Assert.Equal(BranchChargeMethods.Invoice, allowance.ChargeMethod);
        Assert.True(allowance.CanPurchase, allowance.Reason);

        TierUpgradeResultDto upgraded;
        await using (var db = NewDb(options))
            upgraded = (await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, allowance.Quote!.Total)).Value!;
        Assert.False(upgraded.Unlocked);
        Assert.Equal(0, gateway.ChargeCalls);

        // Açık (Sent) fatura KİLİDİ AÇMAZ.
        var (_, t1) = await AddPendingFormAsync(options, seed);
        Assert.Equal("ConsentLimitReached", (await SignAsync(options, seed, t1)).Error.Code);

        // Platform "Ödendi" yapınca açılır.
        Guid invoiceId;
        await using (var db = NewDb(options))
        {
            var invoice = await db.TenantInvoices.SingleAsync();
            Assert.Equal("Sent", invoice.Status);
            Assert.Equal(2, invoice.ConsentTierAbove);
            invoiceId = invoice.Id;
            Assert.True((await new PlatformOpsService(db, new NoopAuditLogger())
                .UpdateInvoiceStatusAsync(invoiceId, new UpdateInvoiceStatusRequest("Paid"))).IsSuccess);
        }
        Assert.True((await SignAsync(options, seed, t1)).IsSuccess);       // 3. evrak artık serbest

        // Fatura iptal edilirse hak geri alınır.
        await using (var db = NewDb(options))
            await new PlatformOpsService(db, new NoopAuditLogger()).UpdateInvoiceStatusAsync(invoiceId, new UpdateInvoiceStatusRequest("Cancelled"));
        var (_, t2) = await AddPendingFormAsync(options, seed);
        Assert.Equal("ConsentLimitReached", (await SignAsync(options, seed, t2)).Error.Code);
    }

    [Fact]
    public async Task InvoiceUpgrade_SecondRequest_DoesNotIssueAnotherInvoice_AndStaleAmountWritesNothing()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.Paid, card: false);
        var gateway = new ScriptedGateway();
        decimal total;
        await using (var db = NewDb(options))
            total = (await NewBilling(db, gateway).GetConsentAllowanceAsync(seed.TenantId)).Value!.Quote!.Total;

        await using (var db = NewDb(options))
        {
            var stale = await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, 1m);
            Assert.Equal("ConsentUpgradeRequired", stale.Error.Code);
            Assert.False(await db.TenantInvoices.AnyAsync());
        }

        await using (var db = NewDb(options))
            Assert.True((await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, total)).IsSuccess);
        await using (var db = NewDb(options))
        {
            var again = await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, total);
            Assert.True(again.IsFailure);
            Assert.Contains("fatura kesildi", again.Error.Message);
        }
        await using var check = NewDb(options);
        Assert.Single(await check.TenantInvoices.ToListAsync());
    }

    /// <summary>
    /// Platformun elle açtığı, DÖNEMİ OLMAYAN kurum da kilidi açabilmeli: fark AY SONUNA kadar orantılı (platformun
    /// aylık taslakları takvim ayı keser — "bir ay" sonraki ayın taslağıyla çakışıp iki kez faturalardı).
    /// </summary>
    [Fact]
    public async Task NoPeriodTenant_UpgradeRunsToTheEndOfTheCalendarMonth()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.ActiveNoPeriod);
        var gateway = new ScriptedGateway();
        await using var db = NewDb(options);
        var allowance = (await NewBilling(db, gateway).GetConsentAllowanceAsync(seed.TenantId)).Value!;
        Assert.True(allowance.CanPurchase, allowance.Reason);
        Assert.Equal(BranchChargeMethods.Invoice, allowance.ChargeMethod);
        var total = allowance.Quote!.Total;
        Assert.InRange(total, 0.01m, 300m);                                  // ≤ 250 + %20 KDV (tam ay)

        Assert.True((await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, total)).IsSuccess);
        var invoice = await db.TenantInvoices.SingleAsync();
        Assert.Equal("Sent", invoice.Status);
        Assert.Equal(SubscriptionPricing.ManualBillingPeriodEnd(DateTime.UtcNow), invoice.PeriodEndUtc);
    }

    [Fact]
    public async Task TrialTenant_CannotPurchaseAnUpgrade()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.Trial);
        await using var db = NewDb(options);
        var allowance = (await NewBilling(db, new ScriptedGateway()).GetConsentAllowanceAsync(seed.TenantId)).Value!;
        Assert.False(allowance.Allowed);
        Assert.False(allowance.CanPurchase);
    }

    // ───────────── Kartla yükseltme ─────────────

    [Fact]
    public async Task CardUpgrade_ChargesProrated_AndUnlocksImmediately()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.Paid, card: true);
        var gateway = new ScriptedGateway();

        decimal total;
        await using (var db = NewDb(options))
        {
            var allowance = (await NewBilling(db, gateway).GetConsentAllowanceAsync(seed.TenantId)).Value!;
            Assert.Equal(BranchChargeMethods.Card, allowance.ChargeMethod);
            total = allowance.Quote!.Total;
        }
        Assert.InRange(total, 100m * 1.2m, 150m * 1.2m);                   // ~yarım ay × 250

        await using (var db = NewDb(options))
        {
            var r = (await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, total)).Value!;
            Assert.True(r.Unlocked, r.Message);
        }
        Assert.Equal(1, gateway.ChargeCalls);
        Assert.Equal(total, gateway.LastChargeAmount);

        await using (var check = NewDb(options))
        {
            var payment = await check.SubscriptionPayments.SingleAsync();
            Assert.Equal(SubscriptionPayment.KindConsentUpgrade, payment.Kind);
            var invoice = await check.TenantInvoices.SingleAsync();
            Assert.Equal("Paid", invoice.Status);
            Assert.Equal(2, invoice.ConsentTierAbove);
        }
        var (_, token) = await AddPendingFormAsync(options, seed);
        Assert.True((await SignAsync(options, seed, token)).IsSuccess);
    }

    [Fact]
    public async Task CardDeclined_StaysLocked_AndIssuesNoInvoice()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 2, Mode.Paid, card: true);
        var gateway = new ScriptedGateway { ChargeOutcome = ScriptedGateway.Declined };
        await using (var db = NewDb(options))
        {
            var total = (await NewBilling(db, gateway).GetConsentAllowanceAsync(seed.TenantId)).Value!.Quote!.Total;
            Assert.True((await NewBilling(db, gateway).PurchaseConsentUpgradeAsync(seed.TenantId, total)).IsFailure);
        }
        await using (var check = NewDb(options))
            Assert.False(await check.TenantInvoices.AnyAsync());
        var (_, token) = await AddPendingFormAsync(options, seed);
        Assert.Equal("ConsentLimitReached", (await SignAsync(options, seed, token)).Error.Code);
    }

    /// <summary>Kartla yenileme faturası, ödeme anındaki evrak sayısının kademesini kaydeder.</summary>
    [Fact]
    public async Task RenewalInvoice_RecordsTheConsentTier()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, signed: 3, Mode.Paid, card: true);
        await using (var db = NewDb(options))
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Id == seed.TenantId);
            var plan = await db.SubscriptionPlans.FirstAsync();
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1).AddDays(2));
            await db.SaveChangesAsync();
        }
        var gateway = new ScriptedGateway();
        await using (var db = NewDb(options))
        {
            var outcome = await NewBilling(db, gateway).ChargeRenewalAsync(seed.TenantId);
            Assert.True(outcome.Value!.Charged, outcome.Value.Message);
        }
        await using var check = NewDb(options);
        Assert.Equal(2, (await check.TenantInvoices.SingleAsync()).ConsentTierAbove);
    }

    // ───────────── Test dublörleri ─────────────

    private sealed class FixedResolver(IPaymentGateway gateway) : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(gateway, "https://panel.test")));
    }

    private sealed class DisabledResolver : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Failure(Error.Conflict("Ödeme altyapısı kapalı.")));
    }

    private sealed class Passthrough : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    private sealed class ScriptedGateway : IPaymentGateway
    {
        public const string Succeeded = "Succeeded";
        public const string Declined = "Declined";

        public string ChargeOutcome { get; set; } = Succeeded;
        public int ChargeCalls { get; private set; }
        public decimal LastChargeAmount { get; private set; }

        public string Provider => "Scripted";

        public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default)
        {
            ChargeCalls++;
            LastChargeAmount = request.AmountTry;
            return Task.FromResult(ChargeOutcome == Succeeded
                ? Result<ChargeResult>.Success(new ChargeResult(true, request.ConversationId, $"pay-{request.ConversationId}", request.AmountTry, null, null, "TRY", PaymentOutcome.Succeeded))
                : Result<ChargeResult>.Success(new ChargeResult(false, request.ConversationId, null, 0m, "10051", "Yetersiz bakiye", "TRY", PaymentOutcome.Declined)));
        }

        public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
            Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(false, conversationId, null, 0m, "UNKNOWN", null, "TRY", PaymentOutcome.Unresolved)));

        public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
            Task.FromResult(Result.Success());
    }
}
