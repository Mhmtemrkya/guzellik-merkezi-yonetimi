using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.DataImport;
using GuzellikMerkezi.Application.Features.PlatformOps;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MÜŞTERİ KOTASI — "sınırı geçen ÖDEMEDEN kullanamaz" (onam kotasıyla AYNI kural).
///
/// <para>
/// Kademeler küçük tutulur (2 → 250 ₺, 4 → 500 ₺): 2 müşteriye kadar ücretsiz, 3–4. müşteri "2 üzeri"
/// kademesini, 5. ve sonrası "4 üzeri" kademesini gerektirir. Ödenmiş kademe YALNIZ "Paid" ve bugünü
/// kapsayan faturadan okunur; açık fatura kilidi açmaz. Onamdan farkı: sayaç STOKTUR — silinen müşteri
/// yer açar (KVKK silmesi sayacı düşürebilmeli).
/// </para>
/// </summary>
public sealed class CustomerQuotaTests
{
    private static readonly PricingTier[] Tiers = [new(2, 250m), new(4, 500m)];

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static readonly ISearchIndexService Search = TestSearchIndex.Create();

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, Search);

    /// <summary>Gerçek kullanım servisi — kapı onun içinde; plansız kurumda fail-closed (canlı davranışı).</summary>
    private static UsageService NewUsage(GuzellikDbContext db) =>
        new(db, new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Features:FailOpenWhenNoPlan"] = "false" })
            .Build());

    private static CustomerService NewCustomers(GuzellikDbContext db) =>
        new(db, NewUsage(db), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), Search, new CapturingJobQueue());

    private static BillingService NewBilling(GuzellikDbContext db, ScriptedGateway gateway, bool paymentsOn = true) =>
        new(db, paymentsOn ? new FixedResolver(gateway) : new DisabledResolver(), new Passthrough(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner), NullLogger<BillingService>.Instance);

    private sealed record Seed(Guid TenantId, Guid BranchId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, int customers,
        bool paid = true, bool card = false, string? slug = null)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan("ba-musteri", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: true, Tiers, [], 10m);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Müşteri QA", slug ?? $"musteri-{Guid.NewGuid():N}"[..20], "BeautyAsist",
            paid ? TenantStatus.Active : TenantStatus.Trial);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        tenant.AssignSubscriptionPlan(plan);
        if (paid)
        {
            // Aylık dönemin ortası (15 gün kaldı).
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-15));
            if (card) db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenant.Id, "Scripted", "u", "t", "552879******0004", null, null, null));
        }
        for (var i = 0; i < customers; i++)
            db.Customers.Add(new Customer(tenant.Id, branch.Id, $"MÜŞTERİ {i + 1}", $"0555 100 00 {i + 10:00}", null));
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, branch.Id);
    }

    private static int _phone;

    private static UpsertCustomerRequest NewCustomer(Seed seed) =>
        new(seed.BranchId, "Yeni Müşteri", $"0532 {Interlocked.Increment(ref _phone) % 1000:000} 44 55", null, null, Gender.Female, true, null);

    private static async Task<Result<CustomerDto>> CreateAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        return await NewCustomers(db).CreateAsync(seed.TenantId, NewCustomer(seed));
    }

    private static async Task<int> CountAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        return await db.Customers.IgnoreQueryFilters().CountAsync(c => c.TenantId == seed.TenantId && !c.IsDeleted);
    }

    // ───────────── Kapı ─────────────

    [Fact]
    public async Task Create_WithinFreePart_Succeeds_ThenBlocksAboveCapacity()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 1);

        Assert.True((await CreateAsync(options, seed)).IsSuccess);          // 2. müşteri: ücretsiz bölümün sonu

        var blocked = await CreateAsync(options, seed);                      // 3. müşteri: "2 üzeri" ödenmedi
        Assert.Equal("CustomerLimitReached", blocked.Error.Code);
        Assert.DoesNotContain("Paketim", blocked.Error.Message);             // iOS: satın alma çağrısı yok
        Assert.Equal(2, await CountAsync(options, seed));
    }

    /// <summary>Müşteri sayacı STOKTUR: silinen müşteri yer açar (onamdan farkı — orada silinen evrak sayılır).</summary>
    [Fact]
    public async Task DeletedCustomer_FreesCapacity()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2);
        Assert.Equal("CustomerLimitReached", (await CreateAsync(options, seed)).Error.Code);

        await using (var db = NewDb(options))
        {
            var one = await db.Customers.IgnoreQueryFilters().FirstAsync(c => c.TenantId == seed.TenantId);
            one.SoftDelete();
            await db.SaveChangesAsync();
        }
        Assert.True((await CreateAsync(options, seed)).IsSuccess);
    }

    /// <summary>
    /// SİSTEM KURUMU (pazaryeri "bireysel müşteriler") abone değildir; kademeye girseydi platform genelinde
    /// online kayıt kilitlenirdi.
    /// </summary>
    [Fact]
    public async Task SystemTenant_IsExempt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 3, slug: SystemTenant.IndividualSlug);
        Assert.True((await CreateAsync(options, seed)).IsSuccess);
    }

    /// <summary>Deneme süresi de sınırın üstüne çıkamaz (satın alma yok); ücretsiz bölüm içinde serbest.</summary>
    [Fact]
    public async Task TrialTenant_IsBlockedAboveFreePart_AndCannotPurchase()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2, paid: false);
        Assert.Equal("CustomerLimitReached", (await CreateAsync(options, seed)).Error.Code);

        await using var db = NewDb(options);
        var allowance = (await NewBilling(db, new ScriptedGateway()).GetTierAllowanceAsync(seed.TenantId, TierDimension.Customers)).Value!;
        Assert.False(allowance.Allowed);
        Assert.False(allowance.CanPurchase);
        Assert.Equal("Customers", allowance.Dimension);
    }

    // ───────────── Excel içe aktarma ─────────────

    [Fact]
    public async Task Import_IsCappedAtThePaidCapacity_AndReportsTheRest()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 1);

        BulkImportResultDto result;
        await using (var db = NewDb(options))
        {
            var rows = Enumerable.Range(0, 4)
                .Select(i => new ImportCustomerRow($"Aktarılan {i}", $"0533 200 00 {i + 10:00}", null, null, Gender.Female, null))
                .ToArray();
            result = (await new DataImportService(db, NewUsage(db), new NoopAuditLogger())
                .ImportAsync(seed.TenantId, new BulkImportRequest(seed.BranchId, rows))).Value!;
        }

        Assert.Equal(1, result.CustomersCreated);                            // kapasite 2, mevcut 1
        Assert.Equal(3, result.Failed);
        Assert.Contains("sınırına ulaşıldı", result.Errors.First());
        Assert.Equal(2, await CountAsync(options, seed));
    }

    /// <summary>
    /// Kapasite DOLUYKEN müşteri satırları atlanıp raporlanır; aynı dosyadaki hizmetler yine aktarılır
    /// (tüm isteği reddetmek onları da kaybettirirdi).
    /// </summary>
    [Fact]
    public async Task Import_WhenAlreadyFull_SkipsCustomers_ButImportsTheRest()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2);
        await using var db = NewDb(options);
        var rows = new[] { new ImportCustomerRow("Aktarılan", "0533 200 00 99", null, null, Gender.Female, null) };
        var services = new[] { new ImportServiceRow("Cilt Bakımı", null, 60, 500m, null) };
        var result = (await new DataImportService(db, NewUsage(db), new NoopAuditLogger())
            .ImportAsync(seed.TenantId, new BulkImportRequest(seed.BranchId, rows, services))).Value!;

        Assert.Equal(0, result.CustomersCreated);
        Assert.Equal(1, result.Failed);
        Assert.Contains("sınırına ulaşıldı", result.Errors.First());
        Assert.Equal(1, result.ServicesCreated);
        Assert.Equal(2, await CountAsync(options, seed));
    }

    // ───────────── Faturayla yükseltme (canlı yol: ödeme kapalı / kart yok) ─────────────

    [Fact]
    public async Task InvoiceUpgrade_OpenInvoiceDoesNotUnlock_PaidUnlocks()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2, card: false);
        var gateway = new ScriptedGateway();

        TierAllowanceDto allowance;
        await using (var db = NewDb(options))
            allowance = (await NewBilling(db, gateway).GetTierAllowanceAsync(seed.TenantId, TierDimension.Customers)).Value!;
        Assert.False(allowance.Allowed);
        Assert.Equal(2, allowance.Count);
        Assert.Equal(2, allowance.Capacity);
        Assert.Equal(2, allowance.NextTierAbove);
        Assert.Equal(BranchChargeMethods.Invoice, allowance.ChargeMethod);
        Assert.True(allowance.CanPurchase, allowance.Reason);

        await using (var db = NewDb(options))
        {
            var stale = await NewBilling(db, gateway).PurchaseTierUpgradeAsync(seed.TenantId, TierDimension.Customers, 1m);
            Assert.Equal("CustomerUpgradeRequired", stale.Error.Code);
            Assert.False(await db.TenantInvoices.AnyAsync());
        }

        await using (var db = NewDb(options))
        {
            var upgraded = (await NewBilling(db, gateway).PurchaseTierUpgradeAsync(seed.TenantId, TierDimension.Customers, allowance.Quote!.Total)).Value!;
            Assert.False(upgraded.Unlocked);
        }
        Assert.Equal(0, gateway.ChargeCalls);

        // Açık (Sent) fatura KİLİDİ AÇMAZ; ikinci talep ikinci fatura kesmez.
        Assert.Equal("CustomerLimitReached", (await CreateAsync(options, seed)).Error.Code);
        await using (var db = NewDb(options))
        {
            var again = await NewBilling(db, gateway).PurchaseTierUpgradeAsync(seed.TenantId, TierDimension.Customers, allowance.Quote!.Total);
            Assert.Contains("fatura kesildi", again.Error.Message);
        }

        // Platform "Ödendi" yapınca açılır — onam kademesine DOKUNMADAN.
        await using (var db = NewDb(options))
        {
            var invoice = await db.TenantInvoices.SingleAsync();
            Assert.Equal("Sent", invoice.Status);
            Assert.Equal(2, invoice.CustomerTierAbove);
            Assert.Null(invoice.ConsentTierAbove);
            Assert.True((await new PlatformOpsService(db, new NoopAuditLogger())
                .UpdateInvoiceStatusAsync(invoice.Id, new UpdateInvoiceStatusRequest("Paid"))).IsSuccess);
        }
        Assert.True((await CreateAsync(options, seed)).IsSuccess);           // 3. müşteri
        Assert.True((await CreateAsync(options, seed)).IsSuccess);           // 4. müşteri
        Assert.Equal("CustomerLimitReached", (await CreateAsync(options, seed)).Error.Code);   // "4 üzeri" ödenmedi
    }

    // ───────────── Kartla yükseltme ─────────────

    [Fact]
    public async Task CardUpgrade_ChargesProrated_AndUnlocksImmediately()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2, card: true);
        var gateway = new ScriptedGateway();

        decimal total;
        await using (var db = NewDb(options))
        {
            var allowance = (await NewBilling(db, gateway).GetTierAllowanceAsync(seed.TenantId, TierDimension.Customers)).Value!;
            Assert.Equal(BranchChargeMethods.Card, allowance.ChargeMethod);
            total = allowance.Quote!.Total;
        }
        Assert.InRange(total, 100m * 1.2m, 150m * 1.2m);                   // ~yarım ay × 250

        await using (var db = NewDb(options))
        {
            var r = (await NewBilling(db, gateway).PurchaseTierUpgradeAsync(seed.TenantId, TierDimension.Customers, total)).Value!;
            Assert.True(r.Unlocked, r.Message);
        }
        Assert.Equal(1, gateway.ChargeCalls);
        Assert.Equal(total, gateway.LastChargeAmount);

        await using (var check = NewDb(options))
        {
            var payment = await check.SubscriptionPayments.SingleAsync();
            Assert.Equal(SubscriptionPayment.KindCustomerUpgrade, payment.Kind);
            var invoice = await check.TenantInvoices.SingleAsync();
            Assert.Equal("Paid", invoice.Status);
            Assert.Equal(2, invoice.CustomerTierAbove);
            Assert.Null(invoice.ConsentTierAbove);
        }
        Assert.True((await CreateAsync(options, seed)).IsSuccess);
    }

    [Fact]
    public async Task CardDeclined_StaysLocked_AndIssuesNoInvoice()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 2, card: true);
        var gateway = new ScriptedGateway { ChargeOutcome = ScriptedGateway.Declined };
        await using (var db = NewDb(options))
        {
            var total = (await NewBilling(db, gateway).GetTierAllowanceAsync(seed.TenantId, TierDimension.Customers)).Value!.Quote!.Total;
            Assert.True((await NewBilling(db, gateway).PurchaseTierUpgradeAsync(seed.TenantId, TierDimension.Customers, total)).IsFailure);
        }
        await using (var check = NewDb(options))
            Assert.False(await check.TenantInvoices.AnyAsync());
        Assert.Equal("CustomerLimitReached", (await CreateAsync(options, seed)).Error.Code);
    }

    /// <summary>Kartla yenileme faturası, ödeme anındaki müşteri sayısının kademesini kaydeder (hak ondan okunur).</summary>
    [Fact]
    public async Task RenewalInvoice_RecordsTheCustomerTier()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, customers: 3, card: true);
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
        var invoice = await check.TenantInvoices.SingleAsync();
        Assert.Equal(2, invoice.CustomerTierAbove);
        Assert.Null(invoice.ConsentTierAbove);

        // Yenileme faturası YENİ dönemi kapsar: o dönem başladığında 4. müşteri ("2 üzeri" içinde) serbesttir.
        var inNewPeriod = await TierEntitlementQuery.EvaluateAsync(check, seed.TenantId, TierDimension.Customers,
            invoice.PeriodStartUtc.AddMinutes(1), CancellationToken.None);
        Assert.True(inNewPeriod.Allowed);
        Assert.Equal(4, inNewPeriod.Capacity);
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
