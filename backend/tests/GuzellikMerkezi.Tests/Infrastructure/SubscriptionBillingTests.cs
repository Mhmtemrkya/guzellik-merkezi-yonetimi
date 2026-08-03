using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ABONELİK TAHSİLATININ PARA KURALLARI.
///
/// <para>
/// Üç değişmez doğrulanır: (1) abonelik yalnız tahsilat başarılı olunca açılır, (2) aynı dönem
/// ikinci kez tahsil edilmez, (3) vadeden önce yapılan yenileme kalan günleri yakmaz —
/// yeni dönem mevcut bitiş tarihinden devam eder.
/// </para>
/// </summary>
public sealed class SubscriptionBillingTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static BillingService NewService(GuzellikDbContext db) =>
        new(db, new SimulationGatewayResolver(), new PassthroughEncryption(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);

    private const string Callback = "https://api.test/api/payments/callback";

    /// <summary>
    /// Aboneliği vadesi YAKLAŞMIŞ hale getirir (2 gün kaldı). Yenileme yalnız vade penceresinde
    /// çalışır; testlerin gerçek zamanla oynaması yerine abonelik geriye tarihlenir.
    /// </summary>
    private static async Task MakeDueAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        var tenant = await db.Tenants.FirstAsync(t => t.Id == tenantId);
        var plan = await db.SubscriptionPlans.FirstAsync(p => p.Id == tenant.SubscriptionPlanId);
        tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1).AddDays(2));
        await db.SaveChangesAsync();
    }

    private static async Task<(Guid TenantId, Guid PlanId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        db.PlatformIntegrationSettings.Add(NewSimulationSettings());

        var tenant = new Tenant("Ödeme QA", $"odeme-qa-{Guid.NewGuid():N}"[..24], "Deneme", TenantStatus.Trial);
        db.Tenants.Add(tenant);

        var plan = new SubscriptionPlan("qa-pro", "Profesyonel", 1000m, 3, 10, 5000, 2000, 1000, yearlyPriceTRY: 10000m);
        db.SubscriptionPlans.Add(plan);

        await db.SaveChangesAsync();
        return (tenant.Id, plan.Id);
    }

    private static PlatformIntegrationSettings NewSimulationSettings()
    {
        var settings = new PlatformIntegrationSettings();
        settings.UpdatePayments(true, "Simulation", null, null, null, "https://panel.test/admin/paket");
        return settings;
    }

    /// <summary>Ödeme formu başlatmak TEK BAŞINA aboneliği açmamalı — para henüz alınmadı.</summary>
    [Fact]
    public async Task StartCheckout_AboneligiAcmaz()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var started = await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback);
            Assert.True(started.IsSuccess);
            Assert.Equal(1000m, started.Value!.AmountTRY);
        }

        await using var verify = NewDb(options);
        var tenant = await verify.Tenants.FirstAsync(t => t.Id == tenantId);
        Assert.Equal(TenantStatus.Trial, tenant.Status);
        Assert.Null(tenant.SubscriptionEndsAtUtc);

        var payment = await verify.SubscriptionPayments.SingleAsync();
        Assert.Equal(SubscriptionPayment.Pending, payment.Status);
    }

    /// <summary>Ödeme tamamlanınca: abonelik aktif, kart saklı, fatura ödenmiş.</summary>
    [Fact]
    public async Task CompleteCheckout_AboneligiAcarKartiSaklarFaturaKeser()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            var started = await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback);
            token = started.Value!.CheckoutToken;
        }

        await using (var db = NewDb(options))
        {
            var done = await NewService(db).CompleteCheckoutAsync(token);
            Assert.True(done.IsSuccess);
            Assert.True(done.Value!.Succeeded);
        }

        await using var verify = NewDb(options);
        var tenant = await verify.Tenants.FirstAsync(t => t.Id == tenantId);
        Assert.Equal(TenantStatus.Active, tenant.Status);
        Assert.Equal(planId, tenant.SubscriptionPlanId);
        Assert.NotNull(tenant.SubscriptionEndsAtUtc);

        var card = await verify.TenantPaymentMethods.SingleAsync();
        Assert.True(card.IsActive);
        Assert.Equal("552879******0004", card.MaskedNumber);

        var invoice = await verify.TenantInvoices.SingleAsync();
        Assert.Equal("Paid", invoice.Status);
        Assert.Equal(1000m, invoice.AmountTRY);
        // KDV DAHİL brütten türetilir: 1000 / 1.20 = 833,33 net + 166,67 KDV.
        Assert.Equal(833.33m, invoice.NetAmountTRY);
        Assert.Equal(166.67m, invoice.VatAmountTRY);

        var payment = await verify.SubscriptionPayments.SingleAsync();
        Assert.Equal(SubscriptionPayment.Succeeded, payment.Status);
        Assert.Equal(invoice.Id, payment.TenantInvoiceId);
    }

    /// <summary>Aynı form anahtarı ikinci kez işlenirse abonelik uzamamalı, ikinci fatura kesilmemeli.</summary>
    [Fact]
    public async Task CompleteCheckout_IkinciKezCagrilirsaTekrarTahsilEtmez()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            token = (await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback)).Value!.CheckoutToken;
        }

        DateTime firstEnd;
        await using (var db = NewDb(options))
        {
            await NewService(db).CompleteCheckoutAsync(token);
            firstEnd = (await db.Tenants.FirstAsync(t => t.Id == tenantId)).SubscriptionEndsAtUtc!.Value;
        }

        await using (var db = NewDb(options))
        {
            var again = await NewService(db).CompleteCheckoutAsync(token);
            Assert.True(again.IsSuccess);
            Assert.True(again.Value!.Succeeded);
        }

        await using var verify = NewDb(options);
        Assert.Equal(1, await verify.TenantInvoices.CountAsync());
        Assert.Equal(1, await verify.SubscriptionPayments.CountAsync());
        Assert.Equal(firstEnd, (await verify.Tenants.FirstAsync(t => t.Id == tenantId)).SubscriptionEndsAtUtc);
    }

    /// <summary>
    /// Vade dolmadan yapılan yenileme KALAN GÜNLERİ YAKMAMALI: yeni dönem mevcut bitiş
    /// tarihinden başlar. "Şimdi"den başlatmak, erken tahsilatta kurumun ödediği süreyi yok ederdi.
    /// </summary>
    [Fact]
    public async Task ChargeRenewal_KalanGunleriYakmaz()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            token = (await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback)).Value!.CheckoutToken;
        }
        await using (var db = NewDb(options)) await NewService(db).CompleteCheckoutAsync(token);
        await MakeDueAsync(options, tenantId);

        DateTime endBefore;
        await using (var db = NewDb(options))
        {
            endBefore = (await db.Tenants.FirstAsync(t => t.Id == tenantId)).SubscriptionEndsAtUtc!.Value;
            var renewal = await NewService(db).ChargeRenewalAsync(tenantId);
            Assert.True(renewal.IsSuccess);
            Assert.True(renewal.Value!.Charged);
        }

        await using var verify = NewDb(options);
        var endAfter = (await verify.Tenants.FirstAsync(t => t.Id == tenantId)).SubscriptionEndsAtUtc!.Value;
        Assert.Equal(endBefore.AddMonths(1), endAfter);
        Assert.Equal(2, await verify.TenantInvoices.CountAsync());
    }

    /// <summary>
    /// Yenileme başarılı olduktan hemen sonra gelen ikinci çağrı PARA ÇEKMEMELİ.
    /// (Kuyruk aynı işi yeniden deneyebilir; vade ileri kaydığı için "aynı dönem" freni tek
    /// başına yetmez — vade kontrolü şart.)
    /// </summary>
    [Fact]
    public async Task ChargeRenewal_VadeGelmedenTekrarTahsilEtmez()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            token = (await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback)).Value!.CheckoutToken;
        }
        await using (var db = NewDb(options)) await NewService(db).CompleteCheckoutAsync(token);
        await MakeDueAsync(options, tenantId);
        await using (var db = NewDb(options)) await NewService(db).ChargeRenewalAsync(tenantId);

        await using (var db = NewDb(options))
        {
            var second = await NewService(db).ChargeRenewalAsync(tenantId);
            Assert.True(second.IsSuccess);
            Assert.False(second.Value!.Charged);
        }

        await using var verify = NewDb(options);
        Assert.Equal(2, await verify.TenantInvoices.CountAsync());
        Assert.Equal(2, await verify.SubscriptionPayments.CountAsync(p => p.Status == SubscriptionPayment.Succeeded));
    }

    /// <summary>Vadesi gelmemiş abonelik için yenileme hiç tahsilat denememeli.</summary>
    [Fact]
    public async Task ChargeRenewal_VadesiGelmemisAboneligeDokunmaz()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            token = (await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback)).Value!.CheckoutToken;
        }
        await using (var db = NewDb(options)) await NewService(db).CompleteCheckoutAsync(token);

        await using (var db = NewDb(options))
        {
            var renewal = await NewService(db).ChargeRenewalAsync(tenantId);
            Assert.True(renewal.IsSuccess);
            Assert.False(renewal.Value!.Charged);
        }

        await using var verify = NewDb(options);
        Assert.Equal(1, await verify.TenantInvoices.CountAsync());
    }

    /// <summary>Kart kaldırılınca otomatik yenileme tahsilat denememeli.</summary>
    [Fact]
    public async Task KartYoksa_YenilemeTahsilatDenemez()
    {
        var options = NewOptions();
        var (tenantId, planId) = await SeedAsync(options);

        string token;
        await using (var db = NewDb(options))
        {
            token = (await NewService(db).StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback)).Value!.CheckoutToken;
        }
        await using (var db = NewDb(options)) await NewService(db).CompleteCheckoutAsync(token);
        await using (var db = NewDb(options)) await NewService(db).RemoveCardAsync(tenantId);

        await using (var db = NewDb(options))
        {
            var renewal = await NewService(db).ChargeRenewalAsync(tenantId);
            Assert.True(renewal.IsSuccess);
            Assert.False(renewal.Value!.Charged);
            Assert.Contains("kart", renewal.Value.Message, StringComparison.OrdinalIgnoreCase);
        }

        await using var verify = NewDb(options);
        Assert.Equal(1, await verify.TenantInvoices.CountAsync());
    }

    /// <summary>Ödeme altyapısı kapalıyken ödeme formu başlatılamaz.</summary>
    [Fact]
    public async Task OdemeKapaliyken_CheckoutBaslatilamaz()
    {
        var options = NewOptions();
        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Kapalı QA", $"kapali-qa-{Guid.NewGuid():N}"[..24], "Deneme", TenantStatus.Trial);
            db.Tenants.Add(tenant);
            db.SubscriptionPlans.Add(new SubscriptionPlan("qa-basic", "Başlangıç", 500m, 1, 3, 500, 300, 100));
            await db.SaveChangesAsync();
        }

        await using var svcDb = NewDb(options);
        var tenantId = (await svcDb.Tenants.FirstAsync()).Id;
        var planId = (await svcDb.SubscriptionPlans.FirstAsync()).Id;

        // Ayar satırı yok → gerçek çözücü "ödeme etkin değil" der; akış BAŞLAMAMALI.
        var service = new BillingService(svcDb, new DisabledGatewayResolver(), new PassthroughEncryption(),
            new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);
        var started = await service.StartCheckoutAsync(tenantId, planId, BillingPeriod.Monthly, Callback);
        Assert.True(started.IsFailure);
        Assert.Equal(0, await svcDb.SubscriptionPayments.CountAsync());
    }

    // ---- test ikizleri ----

    /// <summary>Şifreleme yerine kimlik dönüşümü — testte gerçek anahtar yönetimi gerekmez.</summary>
    private sealed class PassthroughEncryption : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    /// <summary>Her zaman simülasyon sağlayıcısını döner (gerçek çekim yok).</summary>
    private sealed class SimulationGatewayResolver : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(
                new PaymentGatewayContext(new SimulationPaymentGateway(), "https://panel.test/admin/paket")));
    }

    /// <summary>Ödeme altyapısı kapalı — gerçek çözücünün ayar yokken verdiği cevabın aynısı.</summary>
    private sealed class DisabledGatewayResolver : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Failure(
                Error.Conflict("Ödeme altyapısı henüz etkin değil.")));
    }
}
