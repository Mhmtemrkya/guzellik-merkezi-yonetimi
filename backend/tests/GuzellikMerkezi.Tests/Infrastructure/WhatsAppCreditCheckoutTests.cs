using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KARTLA KONTÖR ALMA — para değişmezleri.
///
/// <para>
/// Kontör cüzdanı, aboneliğin yanına ikinci bir para defteri koydu. Aynı sınıf hatalar geçerlidir:
/// bakiye yalnız tahsilat doğrulandığında artmalı, aynı dönüş iki kez yüklememeli ve bir sağlayıcı
/// ödemesi iki deftere birden sayılmamalıdır. Bu son madde en sinsisi: her defter yalnız KENDİ
/// tablosuna bakarsa kontrol kâğıt üstünde vardır ama delik açıktır.
/// </para>
/// </summary>
public sealed class WhatsAppCreditCheckoutTests
{
    private const string Callback = "https://panel.test/api/payments/credit-callback";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static WhatsAppBillingService NewService(GuzellikDbContext db) =>
        new(db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static async Task<Guid> SeedTenantAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Kontör QA", $"kontor-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        // Ücretlendirme AÇIK olmalı: kapalıyken cüzdan yolu hiç çalışmaz ve test hiçbir şey ölçmez.
        db.WhatsAppBillingSettings.Add(new WhatsAppBillingSettings());
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    /// <summary>Simülasyon sağlayıcısının verdiği (imzalı) form anahtarını üretir.</summary>
    private static async Task<string> SimulationTokenAsync(string conversationId, decimal amountTry)
    {
        var gateway = new SimulationPaymentGateway(PaymentTestDoubles.SigningSecret);
        var init = await gateway.InitCheckoutAsync(new CheckoutInitRequest(
            conversationId, amountTry, "test", "buyer", "Ad", "Soyad", "a@b.c", "0555", "1", "Adres", "İstanbul",
            "127.0.0.1", Callback));
        return init.Value!.CheckoutToken;
    }

    private static async Task<(Guid PurchaseId, string ConversationId)> StartAsync(
        DbContextOptions<GuzellikDbContext> options, Guid tenantId, decimal amount)
    {
        await using var db = NewDb(options);
        var started = await NewService(db).StartCreditCheckoutAsync(
            tenantId, new TopUpRequest(null, amount), Callback, null);
        Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);

        var purchase = await db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync();
        // Form başlatmak ÖDEME DEĞİLDİR: talep beklemede açılır, bakiye artmaz.
        Assert.Equal(CreditPurchaseStatus.Pending, purchase.Status);
        return (purchase.Id, purchase.ConversationId!);
    }

    private static async Task<decimal> BalanceAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        var wallet = await db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(w => w.TenantId == tenantId);
        return wallet?.BalanceTry ?? 0m;
    }

    /// <summary>Mutlu yol: tahsilat doğrulanınca bakiye tam olarak yüklenen kadar artar.</summary>
    [Fact]
    public async Task Complete_WhenPaymentSucceeds_CreditsWalletOnce()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);
        var (_, conversationId) = await StartAsync(options, tenantId, 250m);

        Assert.Equal(0m, await BalanceAsync(options, tenantId));

        await using (var db = NewDb(options))
        {
            var done = await NewService(db).CompleteCreditCheckoutAsync(await SimulationTokenAsync(conversationId, 250m));
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
            Assert.True(done.Value!.Succeeded, done.Value.Message);
            Assert.Equal(250m, done.Value.GrantedTry);
        }

        Assert.Equal(250m, await BalanceAsync(options, tenantId));

        await using (var check = NewDb(options))
        {
            var purchase = await check.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync();
            Assert.Equal(CreditPurchaseStatus.Approved, purchase.Status);
            Assert.False(string.IsNullOrWhiteSpace(purchase.ProviderPaymentId));
            // Defter kaydı da tam olarak bir kez yazılmalı (rapor bunu sayıyor).
            Assert.Single(await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Type == WalletTransactionType.TopUp).ToListAsync());
        }
    }

    /// <summary>
    /// AYNI DÖNÜŞ İKİ KEZ: kullanıcı dönüş sayfasını yenilerse bakiye ikinci kez artmamalı.
    /// (Eşzamanlı hâli satır kilidine bağlıdır ve gerçek veritabanı ister — bkz. MySQL testi.)
    /// </summary>
    [Fact]
    public async Task Complete_CalledTwice_CreditsWalletOnlyOnce()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);
        var (_, conversationId) = await StartAsync(options, tenantId, 100m);
        var token = await SimulationTokenAsync(conversationId, 100m);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CompleteCreditCheckoutAsync(token)).Value!.Succeeded);

        await using (var db = NewDb(options))
        {
            var second = await NewService(db).CompleteCreditCheckoutAsync(token);
            // İkinci çağrı da "başarılı" der (kullanıcıya hata göstermek yanlış olurdu) ama yüklemez.
            Assert.True(second.Value!.Succeeded);
            Assert.Equal("Ödeme zaten alınmıştı.", second.Value.Message);
        }

        Assert.Equal(100m, await BalanceAsync(options, tenantId));
    }

    /// <summary>
    /// TUTAR UYUŞMAZLIĞI: 1 TL'lik geçerli imzalı bir dönüş, 500 TL'lik talebi kapatmamalı.
    /// Bakiyeye DOKUNULMAZ ve talep onaylanmaz.
    /// </summary>
    [Fact]
    public async Task Complete_WhenAmountMismatches_LeavesWalletUntouched()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);
        var (_, conversationId) = await StartAsync(options, tenantId, 500m);

        // Aynı işlem anahtarı, YANLIŞ tutar — imza geçerli, değişmez ihlali burada.
        var token = await SimulationTokenAsync(conversationId, 1m);

        await using (var db = NewDb(options))
        {
            var done = await NewService(db).CompleteCreditCheckoutAsync(token);
            Assert.True(done.IsSuccess);
            Assert.False(done.Value!.Succeeded);
            Assert.Contains("tutarı uyuşmuyor", done.Value.Message, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal(0m, await BalanceAsync(options, tenantId));

        await using (var check = NewDb(options))
        {
            var purchase = await check.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync();
            Assert.Equal(CreditPurchaseStatus.Failed, purchase.Status);
            Assert.Empty(await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking().ToListAsync());
        }
    }

    /// <summary>
    /// ÇAPRAZ TABLO TEKRAR OYNATMA — bu dosyanın varlık sebebi.
    ///
    /// <para>
    /// Bir abonelik ödemesinde tüketilmiş sağlayıcı ödeme kimliği kontör yüklemesine SAYILAMAZ.
    /// Kontrol yalnız kendi tablosuna bakarsa (ilk hâli öyleydi) bu senaryo sessizce geçer ve aynı
    /// para hem aboneliğe hem kontöre yazılırdı.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Complete_WhenProviderPaymentIdBelongsToSubscription_IsRejected()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);
        var (_, conversationId) = await StartAsync(options, tenantId, 300m);

        // Simülasyon sağlayıcısı bu işlem için "sim-pay-{conversationId}" ödeme kimliği döner;
        // aynı kimliği ÖNCE bir abonelik tahsilatına yazıyoruz.
        await using (var db = NewDb(options))
        {
            var subscription = new SubscriptionPayment(
                tenantId, null, BillingPeriod.Monthly, 300m, "Simulation", $"chk-{Guid.NewGuid():N}", 1);
            subscription.MarkSucceeded($"sim-pay-{conversationId}", DateTime.UtcNow);
            db.SubscriptionPayments.Add(subscription);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var done = await NewService(db).CompleteCreditCheckoutAsync(await SimulationTokenAsync(conversationId, 300m));
            Assert.True(done.IsSuccess);
            Assert.False(done.Value!.Succeeded);
            Assert.Contains("abonelik", done.Value.Message, StringComparison.OrdinalIgnoreCase);
        }

        // Para taşınmadı ve talep açık bırakılmadı.
        Assert.Equal(0m, await BalanceAsync(options, tenantId));
        await using (var check = NewDb(options))
            Assert.Equal(CreditPurchaseStatus.Failed,
                (await check.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync()).Status);
    }

    /// <summary>Ters yön: kontörde tüketilmiş ödeme kimliği ABONELİĞE de sayılamaz.</summary>
    [Fact]
    public async Task SubscriptionCallback_WhenProviderPaymentIdBelongsToCredit_IsRejected()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);
        var (_, conversationId) = await StartAsync(options, tenantId, 300m);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CompleteCreditCheckoutAsync(await SimulationTokenAsync(conversationId, 300m))).Value!.Succeeded);

        // Aynı sağlayıcı ödemesiyle bir abonelik dönüşü denenir.
        await using (var db = NewDb(options))
        {
            var plan = new SubscriptionPlan("qa-basic", "Başlangıç", 300m, 1, 3, 500, 300, 100);
            db.SubscriptionPlans.Add(plan);
            var subConversation = $"chk-{tenantId:N}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
            db.SubscriptionPayments.Add(new SubscriptionPayment(
                tenantId, plan.Id, BillingPeriod.Monthly, 300m, "Simulation", subConversation, 1));
            await db.SaveChangesAsync();

            var billing = new BillingService(db, new PaymentTestDoubles.SimulationResolver(), new PassthroughEncryption(),
                new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
                NullLogger<BillingService>.Instance);

            // Kontörün tükettiği ödeme kimliğini üretecek anahtar: aynı conversationId.
            var stolen = await SimulationTokenAsync(conversationId, 300m);
            var done = await billing.CompleteCheckoutAsync(stolen);

            // Dönüş, abonelik kaydıyla eşleşmediği için zaten kabul edilmemeli; kabul edilse bile
            // çapraz tablo kontrolü ikinci bir kapı olarak durur. İkisinden hangisi devreye girerse
            // girsin, ABONELİK BAŞLAMAMALIDIR.
            var activated = await db.Tenants.AsNoTracking().AnyAsync(t => t.Id == tenantId && t.SubscriptionEndsAtUtc != null);
            Assert.False(activated, "Kontöre ait ödeme kimliğiyle abonelik başlatıldı.");
            Assert.True(done.IsFailure || !done.Value!.Succeeded);
        }
    }

    /// <summary>Ödeme altyapısı kapalıyken form açılmamalı ve ortada bekleyen talep kalmamalı.</summary>
    [Fact]
    public async Task Start_WhenGatewayDisabled_DoesNotCreatePurchase()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);

        await using var db = NewDb(options);
        var service = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance,
            new PaymentTestDoubles.DisabledResolver(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

        var started = await service.StartCreditCheckoutAsync(tenantId, new TopUpRequest(null, 100m), Callback, null);
        Assert.True(started.IsFailure);
        Assert.Empty(await db.WhatsAppCreditPurchases.IgnoreQueryFilters().ToListAsync());
    }

    /// <summary>Şifreleme yerine kimlik dönüşümü — testte gerçek anahtar yönetimi gerekmez.</summary>
    private sealed class PassthroughEncryption : GuzellikMerkezi.Application.Abstractions.IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }
}
