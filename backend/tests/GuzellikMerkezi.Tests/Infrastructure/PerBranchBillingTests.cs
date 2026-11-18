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
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ŞUBE BAŞINA FİYATLAMA — tahsilat, yenileme ve dönem ortası şube ücreti.
///
/// <para>
/// (1) Checkout ve yenileme tutarı fiyatlama motorundan gelir (şube × birim + kademeler + KDV) ve
/// dökümü ödemeye/faturaya ANLIK GÖRÜNTÜ olarak yazılır. (2) Ücretli dönemde yeni şube orantılı
/// ücretle HEMEN çekilir — ama yalnız kullanıcının onayladığı tutarla; onaysız istek ve tutar
/// değişikliği 409 alır, çekim yapılmaz. (3) Platform yöneticisi kurumun kartından çekim yaptırmaz.
/// (4) Sonucu belirsiz çekimde şube açılmaz ve ikinci çekim yapılmaz; sonradan doğrulanan ödeme
/// şubeyi ödemedeki bilgiden açar. (5) Şube ödemesi aboneliği UZATMAZ ve dönem yenilemesini atlatmaz.
/// </para>
/// </summary>
public sealed class PerBranchBillingTests
{
    private static readonly PricingTier[] Tiers = [new(10_000, 250m), new(15_000, 500m), new(20_000, 1_000m)];

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static BillingService NewBilling(GuzellikDbContext db, ScriptedGateway gateway, UserRole role = UserRole.InstitutionOwner,
        bool paymentsOn = true) =>
        new(db, paymentsOn ? new FixedResolver(gateway) : new DisabledResolver(), new Passthrough(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(role), NullLogger<BillingService>.Instance);

    private static BranchService NewBranches(GuzellikDbContext db, ScriptedGateway gateway, UserRole role = UserRole.InstitutionOwner,
        bool paymentsOn = true) =>
        new(db, new AlwaysAllowUsageService(), NewBilling(db, gateway, role, paymentsOn), new TestCurrentUser(role));

    private sealed record Seed(Guid TenantId, Guid PlanId);

    /// <param name="paid">true = ücretli aylık dönem ortasında (15 gün kaldı); false = deneme.</param>
    /// <param name="card">Ücretli dönemde kayıtlı kart eklensin mi? (false = platformun elle açtığı dönem)</param>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, bool paid, int customers = 0,
        BillingPeriod period = BillingPeriod.Monthly, bool card = true)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan("ba-qa", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: true, Tiers, Tiers, 10m);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Şube QA", $"sube-qa-{Guid.NewGuid():N}"[..20], "Deneme", TenantStatus.Trial);
        var main = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        if (paid)
        {
            // Dönem: 15 gün önce başladı (aylık) → yaklaşık yarım dönem kaldı.
            tenant.StartSubscription(plan, period, DateTime.UtcNow.AddDays(-15));
            if (card)
                db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenant.Id, "Scripted", "user-key", "card-token", "552879******0004", null, null, null));
        }
        for (var i = 0; i < customers; i++)
            db.Customers.Add(new Customer(tenant.Id, main.Id, $"Müşteri {i}", $"+90 555 {i:0000000}", null));
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, plan.Id);
    }

    // ───────────── Checkout / yenileme tutarı ─────────────

    [Fact]
    public async Task Renewal_ChargesBranchesTimesUnit_PlusVat_AndSnapshotsLines()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        await using (var db = NewDb(options))
        {
            // İkinci şube (platformdan, ücretsiz) + yenileme vadesine getir.
            var tenant = await db.Tenants.Include(t => t.Branches).FirstAsync(t => t.Id == seed.TenantId);
            db.Branches.Add(tenant.AddBranch("Kadıköy", "İstanbul"));
            var plan = await db.SubscriptionPlans.FirstAsync();
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1).AddDays(2));
            await db.SaveChangesAsync();
        }

        var gateway = new ScriptedGateway();
        await using (var db = NewDb(options))
        {
            var outcome = await NewBilling(db, gateway).ChargeRenewalAsync(seed.TenantId);
            Assert.True(outcome.IsSuccess, outcome.IsFailure ? outcome.Error.Message : null);
            Assert.True(outcome.Value!.Charged, outcome.Value.Message);
        }

        Assert.Equal(2_400m, gateway.LastChargeAmount);   // 2 şube × 1.000 + %20 KDV
        await using var check = NewDb(options);
        var invoice = await check.TenantInvoices.SingleAsync();
        Assert.Equal(2_400m, invoice.AmountTRY);
        Assert.Equal(2_000m, invoice.NetAmountTRY);
        Assert.Equal(400m, invoice.VatAmountTRY);
        var lines = SubscriptionQuote.FromJson(invoice.LinesJson)!.Lines;
        Assert.Equal(2m, lines.Single().Quantity);
    }

    // ───────────── Dönem ortası şube ─────────────

    [Fact]
    public async Task OwnerWithoutConfirmedAmount_Gets409_AndNothingIsCharged()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false));

        Assert.True(result.IsFailure);
        Assert.Equal("BranchChargeRequired", result.Error.Code);
        Assert.Equal(0, gateway.ChargeCalls);
        Assert.Equal(1, await db.Branches.CountAsync(b => b.TenantId == seed.TenantId));
        Assert.False(await db.SubscriptionPayments.AnyAsync());
    }

    [Fact]
    public async Task OwnerWithStaleAmount_Gets409_AndNothingIsCharged()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: 1m));

        Assert.Equal("BranchChargeRequired", result.Error.Code);
        Assert.Equal(0, gateway.ChargeCalls);
    }

    [Fact]
    public async Task OwnerWithConfirmedAmount_ChargesProrated_OpensBranch_DoesNotExtendSubscription()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway();

        decimal confirmed;
        DateTime? endsBefore;
        await using (var db = NewDb(options))
        {
            var quote = await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId);
            Assert.True(quote.Value!.ChargeRequired);
            Assert.True(quote.Value.CanPurchase, quote.Value.Reason);
            confirmed = quote.Value.Quote!.Total;
            endsBefore = (await db.Tenants.AsNoTracking().FirstAsync(t => t.Id == seed.TenantId)).SubscriptionEndsAtUtc;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: confirmed));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal("Kadıköy", result.Value!.Name);
        }

        Assert.Equal(1, gateway.ChargeCalls);
        Assert.Equal(confirmed, gateway.LastChargeAmount);
        Assert.InRange(confirmed, 500m * 1.2m, 600m * 1.2m);   // ~yarım ay: 15–16 gün / 30–31 gün

        await using var check = NewDb(options);
        Assert.Equal(2, await check.Branches.CountAsync(b => b.TenantId == seed.TenantId));
        var payment = await check.SubscriptionPayments.SingleAsync();
        Assert.Equal(SubscriptionPayment.KindBranchAddon, payment.Kind);
        Assert.Equal(SubscriptionPayment.Succeeded, payment.Status);
        var invoice = await check.TenantInvoices.SingleAsync();
        Assert.Equal(confirmed, invoice.AmountTRY);
        Assert.Equal("branch-prorated", SubscriptionQuote.FromJson(invoice.LinesJson)!.Lines.Single().Code);
        // Şube ödemesi aboneliği UZATMAZ.
        Assert.Equal(endsBefore, (await check.Tenants.AsNoTracking().FirstAsync(t => t.Id == seed.TenantId)).SubscriptionEndsAtUtc);
    }

    /// <summary>Platform yöneticisinin açtığı şube kurumun kartından çekim yaptırmaz.</summary>
    [Fact]
    public async Task PlatformAdmin_CreatesBranch_WithoutCharging()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var result = await NewBranches(db, gateway, UserRole.PlatformAdmin).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(0, gateway.ChargeCalls);
        Assert.False(await db.SubscriptionPayments.AnyAsync());
    }

    /// <summary>Deneme süresinde şube ücretsizdir; ilk ödemede şube sayısı zaten faturalanır.</summary>
    [Fact]
    public async Task TrialTenant_CreatesBranch_WithoutCharging()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: false);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var quote = await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId);
        Assert.False(quote.Value!.ChargeRequired);
        var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(0, gateway.ChargeCalls);
    }

    /// <summary>
    /// ÜCRET ETKİSİ (18 Kas 2026): şube eklerken "ücretinize bu kadar yansıyacak" — denemede de. Tutarları sunucu
    /// hesaplar: şube başı birim (KDV hariç) ve bir şube daha eklenince aylık / yıllık toplam (KDV dahil).
    /// </summary>
    [Fact]
    public async Task Quote_TellsTheFeeImpact_EvenDuringTrial()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: false);
        await using (var setup = NewDb(options))
        {
            var tenant = await setup.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == seed.TenantId);
            tenant.AssignSubscriptionPlan(await setup.SubscriptionPlans.SingleAsync(p => p.Id == seed.PlanId));
            await setup.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        var trial = (await NewBilling(db, new ScriptedGateway()).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
        Assert.False(trial.ChargeRequired);
        var impact = trial.Impact!;
        Assert.Equal((true, 1, 1_000m, 10_000m, 0.20m, (string?)null), (impact.Trial, impact.Branches, impact.UnitMonthly, impact.UnitYearly, impact.VatRate, impact.Period));
        Assert.Equal((1_200m, 2_400m, 24_000m), (impact.CurrentMonthly.Total, impact.NextMonthly.Total, impact.NextYearly.Total));
        Assert.Equal(2, impact.NextMonthly.Branches);
    }

    [Fact]
    public async Task Quote_FeeImpact_ForAPaidTenant_AndNoneWithoutPerBranchPricing()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, period: BillingPeriod.Yearly);
        await using (var db = NewDb(options))
        {
            var paid = (await NewBilling(db, new ScriptedGateway()).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
            Assert.True(paid.ChargeRequired);
            Assert.Equal((false, "yearly", 24_000m), (paid.Impact!.Trial, paid.Impact.Period, paid.Impact.NextYearly.Total));
        }

        await using (var change = NewDb(options))
        {
            var plan = await change.SubscriptionPlans.SingleAsync(p => p.Id == seed.PlanId);
            plan.SetPricingModel(chargePerBranch: false, Tiers, Tiers, 10m);
            await change.SaveChangesAsync();
        }

        await using var check = NewDb(options);
        Assert.Null((await NewBilling(check, new ScriptedGateway()).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.Impact);
    }

    /// <summary>
    /// "Faturayı öde" düğmesi yalnız fatura maydanozasist.com'da ödenebiliyorsa: sağlayıcı Maydanoz. Başka sağlayıcıda ya da
    /// ödeme kapalıyken fatura platformca tahsil edilir (ödeme ucu 409 döner) — düğme gösterilmez.
    /// </summary>
    [Fact]
    public async Task Quote_SaysWhetherTheBranchInvoiceCanBePaidOnline()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: false);
        await using var db = NewDb(options);

        var maydanoz = new BillingService(db, new FixedResolver(new GuzellikMerkezi.Infrastructure.Payments.MaydanozPaymentGateway(db, "https://maydanoz.test/")),
            new Passthrough(), new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);
        var online = (await maydanoz.GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
        Assert.Equal((BranchChargeMethods.Invoice, true), (online.ChargeMethod, online.InvoicePayOnline));

        Assert.False((await NewBilling(db, new ScriptedGateway()).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.InvoicePayOnline);
        Assert.False((await NewBilling(db, new ScriptedGateway(), paymentsOn: false).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.InvoicePayOnline);
    }

    /// <summary>
    /// SONUCU BELİRSİZ ÇEKİM: şube açılmaz, ikinci istek ikinci çekimi YAPMAZ; sağlayıcı sonradan
    /// "başarılı" deyince şube ödemedeki bilgiden açılır ve fatura kesilir.
    /// </summary>
    [Fact]
    public async Task UnknownOutcome_NoBranch_NoSecondCharge_ThenResolverOpensBranch()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway { ChargeOutcome = ScriptedGateway.Unresolved };

        decimal confirmed;
        await using (var db = NewDb(options))
            confirmed = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.Quote!.Total;

        await using (var db = NewDb(options))
        {
            var first = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: confirmed));
            Assert.Equal("BranchChargePending", first.Error.Code);
        }
        await using (var db = NewDb(options))
        {
            // Yanıtı kaybolan çekim beklerken ikinci deneme: sağlayıcı hâlâ "bilmiyorum" → çekim YOK.
            var second = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: confirmed));
            Assert.Equal("BranchChargePending", second.Error.Code);
        }
        Assert.Equal(1, gateway.ChargeCalls);

        await using (var db = NewDb(options))
            Assert.Equal(1, await db.Branches.CountAsync(b => b.TenantId == seed.TenantId));

        // Sağlayıcı artık "başarılı" diyor → arka plan taraması şubeyi açar.
        gateway.RetrieveSucceeds = true;
        await using (var db = NewDb(options))
        {
            var pending = await db.SubscriptionPayments.SingleAsync();
            Assert.Equal(SubscriptionPayment.Pending, pending.Status);
            pending.GetType().GetProperty(nameof(Entity.CreatedAtUtc))!.SetValue(pending, DateTime.UtcNow.AddMinutes(-5));
            await db.SaveChangesAsync();
            var opened = await NewBilling(db, gateway).ResolvePendingBranchChargesAsync();
            Assert.Equal(1, opened);
        }

        await using var check = NewDb(options);
        Assert.Equal(2, await check.Branches.CountAsync(b => b.TenantId == seed.TenantId));
        Assert.True(await check.Branches.AnyAsync(b => b.TenantId == seed.TenantId && b.Name == "Kadıköy"));
        Assert.Equal(SubscriptionPayment.Succeeded, (await check.SubscriptionPayments.SingleAsync()).Status);
        Assert.Single(await check.TenantInvoices.ToListAsync());
    }

    /// <summary>Şube ödemesi dönemin "zaten ödendi" kontrolünü tetiklemez: yenileme yine tahsil eder.</summary>
    [Fact]
    public async Task BranchPayment_DoesNotCountAsPeriodRenewal()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true);
        var gateway = new ScriptedGateway();

        await using (var db = NewDb(options))
        {
            var confirmed = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.Quote!.Total;
            Assert.True((await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: confirmed))).IsSuccess);
        }
        await using (var db = NewDb(options))
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Id == seed.TenantId);
            var plan = await db.SubscriptionPlans.FirstAsync();
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1).AddDays(2));
            await db.SaveChangesAsync();
            var outcome = await NewBilling(db, gateway).ChargeRenewalAsync(seed.TenantId);
            Assert.True(outcome.Value!.Charged, outcome.Value.Message);
        }
        Assert.Equal(2_400m, gateway.LastChargeAmount);   // yenileme: 2 şube
    }

    // ───────────── Kartsız kurum: şube + AÇIK fatura ─────────────

    /// <summary>
    /// CANLI DURUM: ödeme altyapısı kapalı, platform ücretli dönemi elle açmış, kart yok. Şube
    /// ENGELLENMEZ — orantılı tutar için açık (Sent) fatura şubeyle birlikte kesilir; çekim ve ödeme
    /// kaydı OLMAZ, abonelik uzamaz.
    /// </summary>
    [Fact]
    public async Task NoCard_BranchWaitsForPayment_ThenOpensOnceWhenInvoicePaid()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: false);
        var gateway = new ScriptedGateway();

        decimal confirmed;
        DateTime? endsBefore;
        await using (var db = NewDb(options))
        {
            var quote = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
            Assert.True(quote.ChargeRequired);
            Assert.True(quote.CanPurchase, quote.Reason);
            Assert.Equal(BranchChargeMethods.Invoice, quote.ChargeMethod);
            Assert.Null(quote.CardMasked);
            confirmed = quote.Quote!.Total;
            endsBefore = (await db.Tenants.AsNoTracking().FirstAsync(t => t.Id == seed.TenantId)).SubscriptionEndsAtUtc;
        }

        // Talep: şube AÇILMAZ, ödeme bekleyen açık fatura kesilir (hata değil — "ödeme bekleniyor").
        await using (var db = NewDb(options))
        {
            var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: confirmed));
            Assert.Equal("BranchAwaitingPayment", result.Error.Code);
        }

        Assert.Equal(0, gateway.ChargeCalls);
        Guid invoiceId;
        await using (var check = NewDb(options))
        {
            Assert.Equal(1, await check.Branches.CountAsync(b => b.TenantId == seed.TenantId));   // henüz açılmadı
            Assert.False(await check.SubscriptionPayments.AnyAsync());
            var invoice = await check.TenantInvoices.SingleAsync();
            Assert.Equal("Sent", invoice.Status);
            Assert.Equal(confirmed, invoice.AmountTRY);
            Assert.Null(invoice.PaymentReference);      // platformda "Elle" kaynaklı → durumu oradan yönetilir
            Assert.NotNull(invoice.PendingBranchJson);
            Assert.Equal("branch-prorated", SubscriptionQuote.FromJson(invoice.LinesJson)!.Lines.Single().Code);
            Assert.Equal(endsBefore, (await check.Tenants.AsNoTracking().FirstAsync(t => t.Id == seed.TenantId)).SubscriptionEndsAtUtc);
            invoiceId = invoice.Id;
        }

        // Platform "Ödendi" → şube açılır; Ödendi→Gönderildi→Ödendi gidip gelmesi İKİNCİ şube açmaz.
        foreach (var status in new[] { "Paid", "Sent", "Paid" })
        {
            await using var db = NewDb(options);
            Assert.True((await new PlatformOpsService(db, new NoopAuditLogger())
                .UpdateInvoiceStatusAsync(invoiceId, new GuzellikMerkezi.Application.Features.PlatformOps.UpdateInvoiceStatusRequest(status))).IsSuccess);
        }
        await using (var check = NewDb(options))
        {
            Assert.Equal(2, await check.Branches.CountAsync(b => b.TenantId == seed.TenantId));
            Assert.True(await check.Branches.AnyAsync(b => b.TenantId == seed.TenantId && b.Name == "Kadıköy"));
            Assert.Null((await check.TenantInvoices.SingleAsync()).PendingBranchJson);
        }
    }

    /// <summary>
    /// ELLE FATURALANAN kurum (Aktif, dönemsiz — platform takvim ayına göre aylık taslak keser): şube artık ücretsiz
    /// ve hemen açılmıyor. AY SONUNA kadar orantılı açık fatura kesilir (sonraki ayın taslağıyla çakışmaz), şube
    /// ödenince açılır. Kayıtlı kart olsa da kart yolu yok: kart çekimi aboneliğin dönemine bağlıdır.
    /// </summary>
    [Fact]
    public async Task ManualBillingTenant_BranchIsInvoicedToMonthEnd_AndWaitsForPayment()
    {
        var options = NewOptions();
        Guid tenantId;
        await using (var db = NewDb(options))
        {
            var plan = new SubscriptionPlan("ba-elle", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
            plan.SetPricingModel(chargePerBranch: true, Tiers, Tiers, 10m);
            db.SubscriptionPlans.Add(plan);
            var tenant = new Tenant("Elle QA", $"elle-qa-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Active);
            tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            tenant.AssignSubscriptionPlan(plan);
            db.TenantPaymentMethods.Add(new TenantPaymentMethod(tenant.Id, "Scripted", "user-key", "card-token", "552879******0004", null, null, null));
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
        }
        var gateway = new ScriptedGateway();
        var monthEnd = SubscriptionPricing.ManualBillingPeriodEnd(DateTime.UtcNow);

        await using (var db = NewDb(options))
        {
            var quote = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(tenantId)).Value!;
            Assert.True(quote.ChargeRequired);
            Assert.True(quote.CanPurchase, quote.Reason);
            Assert.Equal(BranchChargeMethods.Invoice, quote.ChargeMethod);
            Assert.InRange(quote.Quote!.Total, 0.01m, 1_200m);              // ay sonuna kadar (≤ tam ay + KDV)

            var result = await NewBranches(db, gateway).CreateAsync(tenantId,
                new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: quote.Quote.Total));
            Assert.Equal("BranchAwaitingPayment", result.Error.Code);
        }

        Assert.Equal(0, gateway.ChargeCalls);
        await using var check = NewDb(options);
        Assert.Equal(1, await check.Branches.CountAsync(b => b.TenantId == tenantId));
        var invoice = await check.TenantInvoices.SingleAsync();
        Assert.Equal("Sent", invoice.Status);
        Assert.Equal(monthEnd, invoice.PeriodEndUtc);                         // sonraki ayın taslağıyla çakışmaz
        Assert.NotNull(invoice.PendingBranchJson);
    }

    /// <summary>Aynı adla ödeme bekleyen talep varken pencereyi kapatıp açmak ikinci fatura kesmez.</summary>
    [Fact]
    public async Task NoCard_SameNameRequest_ReturnsTheExistingInvoice()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: false);
        var gateway = new ScriptedGateway();
        await using var db = NewDb(options);
        var total = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!.Quote!.Total;

        var first = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: total));
        var second = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("kadıköy ", "İstanbul", false, ConfirmedChargeTRY: total));

        Assert.Equal("BranchAwaitingPayment", first.Error.Code);
        Assert.Equal("BranchAwaitingPayment", second.Error.Code);
        Assert.Contains("zaten kesildi", second.Error.Message);
        Assert.Single(await db.TenantInvoices.ToListAsync());
    }

    [Fact]
    public async Task NoCard_WithoutOrStaleConfirmation_Gets409_InvoiceWording_AndWritesNothing()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: false);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var missing = await NewBranches(db, gateway).CreateAsync(seed.TenantId, new UpsertBranchRequest("Kadıköy", "İstanbul", false));
        Assert.Equal("BranchChargeRequired", missing.Error.Code);
        Assert.Contains("fatura", missing.Error.Message);
        Assert.DoesNotContain("kartınızdan", missing.Error.Message);

        var stale = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
            new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: 1m));
        Assert.Equal("BranchChargeRequired", stale.Error.Code);

        Assert.Equal(1, await db.Branches.CountAsync(b => b.TenantId == seed.TenantId));
        Assert.False(await db.TenantInvoices.AnyAsync());
        Assert.Equal(0, gateway.ChargeCalls);
    }

    /// <summary>Kart kayıtlı olsa da ödeme altyapısı KAPALIYSA çekim denenmez; açık fatura kesilir, şube ödenince açılır.</summary>
    [Fact]
    public async Task PaymentsDisabled_WithCardOnFile_UsesInvoice_NeverCharges()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: true);
        var gateway = new ScriptedGateway();

        await using var db = NewDb(options);
        var quote = (await NewBilling(db, gateway, paymentsOn: false).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
        Assert.Equal(BranchChargeMethods.Invoice, quote.ChargeMethod);
        var result = await NewBranches(db, gateway, paymentsOn: false).CreateAsync(seed.TenantId,
            new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: quote.Quote!.Total));

        Assert.Equal("BranchAwaitingPayment", result.Error.Code);
        Assert.Equal(0, gateway.ChargeCalls);
        Assert.Equal("Sent", (await db.TenantInvoices.SingleAsync()).Status);
        Assert.Equal(1, await db.Branches.CountAsync(b => b.TenantId == seed.TenantId));
    }

    /// <summary>
    /// Sonucu bilinmeyen KART ödemesi beklerken kart kaldırılsa / ödeme kapansa bile fatura kesilmez:
    /// aynı şube için hem çekim hem fatura borcu doğabilirdi.
    /// </summary>
    [Fact]
    public async Task PendingCardPayment_BlocksInvoicePath()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: false);
        var gateway = new ScriptedGateway();
        await using (var db = NewDb(options))
        {
            var pending = new SubscriptionPayment(seed.TenantId, seed.PlanId, BillingPeriod.Monthly, 580.64m, "Scripted",
                $"brn-{seed.TenantId:N}-pending", attemptNumber: 1);
            pending.MarkAsBranchAddon("{\"name\":\"Kadıköy\",\"city\":\"İstanbul\",\"isDefault\":false}");
            db.SubscriptionPayments.Add(pending);
            await db.SaveChangesAsync();
        }

        await using var check = NewDb(options);
        var quote = (await NewBilling(check, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
        Assert.False(quote.CanPurchase);
        var result = await NewBranches(check, gateway).CreateAsync(seed.TenantId,
            new UpsertBranchRequest("Moda", "İstanbul", false, ConfirmedChargeTRY: quote.Quote!.Total));

        Assert.Equal("BranchChargePending", result.Error.Code);
        Assert.False(await check.TenantInvoices.AnyAsync());
        Assert.Equal(1, await check.Branches.CountAsync(b => b.TenantId == seed.TenantId));
    }

    /// <summary>Kart REDDİ fatura yoluna düşmez: şube açılmaz, fatura kesilmez.</summary>
    [Fact]
    public async Task CardDeclined_DoesNotFallBackToInvoice()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: true, card: true);
        var gateway = new ScriptedGateway { ChargeOutcome = ScriptedGateway.Declined };

        await using var db = NewDb(options);
        var quote = (await NewBilling(db, gateway).GetBranchChargeQuoteAsync(seed.TenantId)).Value!;
        Assert.Equal(BranchChargeMethods.Card, quote.ChargeMethod);
        var result = await NewBranches(db, gateway).CreateAsync(seed.TenantId,
            new UpsertBranchRequest("Kadıköy", "İstanbul", false, ConfirmedChargeTRY: quote.Quote!.Total));

        Assert.True(result.IsFailure);
        Assert.Equal(1, gateway.ChargeCalls);
        Assert.False(await db.TenantInvoices.AnyAsync());
        Assert.Equal(1, await db.Branches.CountAsync(b => b.TenantId == seed.TenantId));
        Assert.Equal(SubscriptionPayment.Failed, (await db.SubscriptionPayments.SingleAsync()).Status);
    }

    [Fact]
    public async Task Quote_UsesCustomerTier_AboveThreshold()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, paid: false, customers: 3);
        await using var db = NewDb(options);
        // Eşik düşürülerek kademe sınanır (10.001 müşteri yerine 2 üzeri).
        var plan = await db.SubscriptionPlans.FirstAsync();
        plan.SetPricingModel(true, [new PricingTier(2, 250m)], [], 10m);
        await db.SaveChangesAsync();

        var monthly = (await NewBilling(db, new ScriptedGateway()).GetQuoteAsync(seed.TenantId, seed.PlanId, BillingPeriod.Monthly)).Value!;
        var yearly = (await NewBilling(db, new ScriptedGateway()).GetQuoteAsync(seed.TenantId, seed.PlanId, BillingPeriod.Yearly)).Value!;
        Assert.Equal(1_250m, monthly.Subtotal);
        Assert.Equal(10_000m + 2_500m, yearly.Subtotal);
        Assert.Equal(3, monthly.Customers);
    }

    // ───────────── Test dublörleri ─────────────

    private sealed class FixedResolver(IPaymentGateway gateway) : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(gateway, "https://panel.test")));
    }

    /// <summary>Ödeme altyapısı kapalı (canlının bugünkü yapılandırması).</summary>
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

    /// <summary>Çekim sonucunu senaryoya göre veren sağlayıcı; sorgu yolu ayrıca ayarlanır.</summary>
    private sealed class ScriptedGateway : IPaymentGateway
    {
        public const string Succeeded = "Succeeded";
        public const string Unresolved = "Unresolved";
        public const string Declined = "Declined";

        public string ChargeOutcome { get; set; } = Succeeded;
        public bool RetrieveSucceeds { get; set; }
        public int ChargeCalls { get; private set; }
        public decimal LastChargeAmount { get; private set; }
        private readonly Dictionary<string, decimal> _charged = new();

        public string Provider => "Scripted";

        public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default)
        {
            ChargeCalls++;
            LastChargeAmount = request.AmountTry;
            _charged[request.ConversationId] = request.AmountTry;
            return Task.FromResult(ChargeOutcome switch
            {
                Succeeded => Result<ChargeResult>.Success(new ChargeResult(true, request.ConversationId, $"pay-{request.ConversationId}", request.AmountTry, null, null, "TRY", PaymentOutcome.Succeeded)),
                Declined => Result<ChargeResult>.Success(new ChargeResult(false, request.ConversationId, null, 0m, "10051", "Yetersiz bakiye", "TRY", PaymentOutcome.Declined)),
                _ => Result<ChargeResult>.Success(new ChargeResult(false, request.ConversationId, null, 0m, "TIMEOUT", "Zaman aşımı", "TRY", PaymentOutcome.Unresolved)),
            });
        }

        public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
            Task.FromResult(RetrieveSucceeds && _charged.TryGetValue(conversationId, out var amount)
                ? Result<ChargeResult>.Success(new ChargeResult(true, conversationId, $"pay-{conversationId}", amount, null, null, "TRY", PaymentOutcome.Succeeded))
                : Result<ChargeResult>.Success(new ChargeResult(false, conversationId, null, 0m, "UNKNOWN", "Bilinmiyor", "TRY", PaymentOutcome.Unresolved)));

        public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
            Task.FromResult(Result.Success());
    }
}
