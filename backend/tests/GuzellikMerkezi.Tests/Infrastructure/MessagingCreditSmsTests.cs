using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MESAJ KREDİSİ — SMS faturalama değişmezleri.
///
/// <para>
/// SMS, WhatsApp'la aynı cüzdandan harcar ama teslim webhook'u yoktur: rezerve → gönder →
/// kesinleştir/iade tek çağrıda kapanır. Değişmezler: (1) önce plan kotası, (2) kota bitince kredi
/// YALNIZ kurum izin verdiyse, (3) başarısız SMS'e kredi harcanmaz, (4) aynı mesaj iki kez
/// rezerve edilmez, (5) askıda kalan kredi süpürmede satırın durumuna göre kapanır.
/// </para>
/// </summary>
public sealed class MessagingCreditSmsTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static WhatsAppBillingService NewBilling(GuzellikDbContext db) =>
        new(db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    /// <summary>Plan SMS kotası, kredi taşma izni, cüzdan kredisi ve kurum tavanı verilen bir kurum.</summary>
    private static async Task<Guid> SeedAsync(
        DbContextOptions<GuzellikDbContext> options, int smsQuota, bool allowOverage, decimal walletCredits, decimal? capCredits = null)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan($"sms-{Guid.NewGuid():N}"[..16], "SMS QA", 100m, 1, 3, 100, 100, smsQuota);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("SMS QA", $"sms-qa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        tenant.AssignSubscriptionPlan(plan);
        db.Tenants.Add(tenant);
        // SMS parça başına 2 kredi, faturalama açık (bkz. PaymentTestDoubles).
        db.WhatsAppBillingSettings.Add(PaymentTestDoubles.BillingOneTryPerCredit());
        var settings = new WhatsAppSettings(tenant.Id);
        settings.UpdateBillingPreferences(marketingEnabled: false, allowWalletOverage: allowOverage, monthlySpendCapCredits: capCredits);
        db.WhatsAppSettings.Add(settings);
        if (walletCredits > 0)
        {
            var wallet = new TenantMessagingWallet(tenant.Id);
            wallet.TopUp(CreditChannel.Sms, walletCredits);
            db.TenantMessagingWallets.Add(wallet);
        }
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    /// <summary>Bildirim servisinin yaptığı gibi: satır sağlayıcıdan ÖNCE yazılır.</summary>
    private static async Task<NotificationLog> NewSmsLogAsync(GuzellikDbContext db, Guid tenantId)
    {
        var log = new NotificationLog(tenantId, null, null, null, NotificationChannel.Sms, "+905550000000",
            "Merhaba, randevunuzu hatırlatırız.", NotificationLogStatus.Queued, null, $"qa:{Guid.NewGuid():N}");
        db.NotificationLogs.Add(log);
        await db.SaveChangesAsync();
        return log;
    }

    private static async Task<TenantMessagingWallet> WalletAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        return await db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking().SingleAsync(w => w.TenantId == tenantId);
    }

    // ---------------- Parça sayımı ----------------

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(70, 1)]   // Unicode tek parça sınırı
    [InlineData(71, 2)]   // birleştirilmiş: parça başına 67
    [InlineData(134, 2)]
    [InlineData(135, 3)]
    public void SmsSegments_UsesUnicodeLimits(int length, int expectedParts)
    {
        Assert.Equal(expectedParts, SmsSegments.Count(new string('ş', length)));
    }

    // ---------------- Kota → kredi kararı ----------------

    [Fact]
    public async Task Reserve_WhenQuotaAvailable_IsFreeAndLeavesWalletUntouched()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 5, allowOverage: false, walletCredits: 100m);

        await using (var db = NewDb(options))
        {
            var log = await NewSmsLogAsync(db, tenantId);
            var decision = await NewBilling(db).ReserveSmsAsync(tenantId, log, parts: 2, live: true);

            Assert.True(decision.Allowed);
            Assert.Equal(WhatsAppBillingSource.Quota, decision.Source);
            Assert.Equal(0m, decision.Credits);
            Assert.Equal(WhatsAppBillingSource.Quota, log.BillingSource);
        }

        var wallet = await WalletAsync(options, tenantId);
        Assert.Equal(0m, wallet.SmsReservedCredits);
        Assert.Equal(100m, wallet.SmsBalanceCredits);
    }

    /// <summary>Kota bittiğinde kurum izin vermediyse kredi HARCANMAZ — sürpriz harcama freni.</summary>
    [Fact]
    public async Task Reserve_WhenQuotaExhaustedAndOverageOff_Blocks()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: false, walletCredits: 100m);

        await using var db = NewDb(options);
        var log = await NewSmsLogAsync(db, tenantId);
        var decision = await NewBilling(db).ReserveSmsAsync(tenantId, log, parts: 1, live: true);

        Assert.False(decision.Allowed);
        Assert.Contains("kota", decision.BlockReason, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(WhatsAppBillingSource.None, log.BillingSource);
    }

    /// <summary>Mutlu yol: kota bitti, izin var → parça × 2 kredi rezerve; sağlayıcı kabul edince kesinleşir.</summary>
    [Fact]
    public async Task Reserve_ThenAccepted_CapturesPartsTimesCostAndWritesLedger()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m);
        Guid logId;

        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            var log = await NewSmsLogAsync(db, tenantId);
            logId = log.Id;

            var decision = await billing.ReserveSmsAsync(tenantId, log, parts: 2, live: true);
            Assert.True(decision.Allowed);
            Assert.Equal(WhatsAppBillingSource.Wallet, decision.Source);
            Assert.Equal(4m, decision.Credits);   // 2 parça × 2 kredi

            // Rezervasyon sağlayıcıdan ÖNCE kalıcıdır.
            var reserved = await WalletAsync(options, tenantId);
            Assert.Equal(4m, reserved.SmsReservedCredits);
            Assert.Equal(96m, reserved.AvailableFor(CreditChannel.Sms));

            log.MarkSent();
            await billing.SettleSmsAsync(log, accepted: true);
        }

        var wallet = await WalletAsync(options, tenantId);
        Assert.Equal(96m, wallet.SmsBalanceCredits);
        Assert.Equal(0m, wallet.SmsReservedCredits);
        Assert.Equal(4m, wallet.SmsLifetimeSpentCredits);

        await using var check = NewDb(options);
        var saved = await check.NotificationLogs.IgnoreQueryFilters().AsNoTracking().SingleAsync(l => l.Id == logId);
        Assert.Equal(NotificationLogStatus.Sent, saved.Status);   // durum kredisiyle AYNI kayıtta yazıldı
        Assert.NotNull(saved.ChargeCapturedAtUtc);
        var capture = await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking().SingleAsync();
        Assert.Equal(WalletTransactionType.Capture, capture.Type);
        Assert.Equal(WalletUnit.Credit, capture.Unit);
        Assert.Equal(NotificationChannel.Sms, capture.Channel);
        Assert.Equal(-4m, capture.Amount);
        Assert.Equal(logId, capture.NotificationLogId);
    }

    /// <summary>Başarısız SMS'e kredi harcanmaz: rezervasyon tamamen iade edilir.</summary>
    [Fact]
    public async Task Reserve_ThenRejected_RefundsFully()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m);

        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            var log = await NewSmsLogAsync(db, tenantId);
            Assert.True((await billing.ReserveSmsAsync(tenantId, log, parts: 3, live: true)).Allowed);

            log.MarkFailed("Verimor 400");
            await billing.SettleSmsAsync(log, accepted: false);
            Assert.Equal(WhatsAppBillingSource.None, log.BillingSource);
            Assert.Equal(0m, log.ChargedCredits);
        }

        var wallet = await WalletAsync(options, tenantId);
        Assert.Equal(100m, wallet.SmsBalanceCredits);
        Assert.Equal(0m, wallet.SmsReservedCredits);
        await using var check = NewDb(options);
        Assert.Empty(await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task Reserve_WhenCreditsInsufficient_BlocksWithoutReserving()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 3m);

        await using (var db = NewDb(options))
        {
            var log = await NewSmsLogAsync(db, tenantId);
            var decision = await NewBilling(db).ReserveSmsAsync(tenantId, log, parts: 2, live: true);   // 4 kredi gerekir

            Assert.False(decision.Allowed);
            Assert.Contains("yetersiz", decision.BlockReason, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal(0m, (await WalletAsync(options, tenantId)).SmsReservedCredits);
    }

    /// <summary>Aylık tavan WhatsApp + SMS toplamına uygulanır; aşan gönderim engellenir.</summary>
    [Fact]
    public async Task Reserve_WhenMonthlyCapWouldBeExceeded_Blocks()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m, capCredits: 5m);

        await using var db = NewDb(options);
        var billing = NewBilling(db);
        Assert.True((await billing.ReserveSmsAsync(tenantId, await NewSmsLogAsync(db, tenantId), parts: 2, live: true)).Allowed);   // 4 kredi

        var second = await billing.ReserveSmsAsync(tenantId, await NewSmsLogAsync(db, tenantId), parts: 2, live: true);   // 4 + 4 > 5
        Assert.False(second.Allowed);
        Assert.Contains("tavan", second.BlockReason, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// DEVRALINAN SATIR: rezervasyonu bağlı bir satır yeniden karara girerse kredi İKİNCİ KEZ ayrılmaz
    /// (çöküş sonrası bayat gönderimi devralan tarama aynı mesaj için iki kat kredi kilitlemesin).
    /// </summary>
    [Fact]
    public async Task Reserve_WhenLogAlreadyCarriesReservation_DoesNotReserveAgain()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m);

        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            var log = await NewSmsLogAsync(db, tenantId);
            var first = await billing.ReserveSmsAsync(tenantId, log, parts: 2, live: true);
            var again = await billing.ReserveSmsAsync(tenantId, log, parts: 2, live: true);

            Assert.Equal(first.Credits, again.Credits);
        }

        Assert.Equal(4m, (await WalletAsync(options, tenantId)).SmsReservedCredits);
    }

    /// <summary>Simülasyon teslimat değildir: ne kota ne kredi düşer.</summary>
    [Fact]
    public async Task Reserve_WhenProviderNotLive_IsSimulationAndFree()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m);

        await using (var db = NewDb(options))
        {
            var log = await NewSmsLogAsync(db, tenantId);
            var decision = await NewBilling(db).ReserveSmsAsync(tenantId, log, parts: 2, live: false);
            Assert.True(decision.Allowed);
            Assert.Equal(WhatsAppBillingSource.Simulation, decision.Source);
        }

        Assert.Equal(0m, (await WalletAsync(options, tenantId)).SmsReservedCredits);
    }

    // ---------------- Süpürme ----------------

    /// <summary>
    /// Rezervasyonla sonuç arasında süreç çökerse kredi askıda kalır. Süpürme: sağlayıcının kabul
    /// ettiği (Sent) satırın kredisini kesinleştirir, gönderilemeyenin kredisini iade eder.
    /// </summary>
    [Fact]
    public async Task Sweep_CapturesSentAndRefundsUnsent()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m);
        Guid sentId, stuckId;

        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            var sent = await NewSmsLogAsync(db, tenantId);
            var stuck = await NewSmsLogAsync(db, tenantId);
            Assert.True((await billing.ReserveSmsAsync(tenantId, sent, parts: 1, live: true)).Allowed);   // 2 kredi
            Assert.True((await billing.ReserveSmsAsync(tenantId, stuck, parts: 2, live: true)).Allowed);  // 4 kredi
            sent.MarkSent();          // sağlayıcı kabul etti, kesinleşme YAZILAMADAN çöktü
            await db.SaveChangesAsync();
            sentId = sent.Id;
            stuckId = stuck.Id;
        }

        Assert.Equal(6m, (await WalletAsync(options, tenantId)).SmsReservedCredits);

        await using (var db = NewDb(options))
        {
            // Eşik geçmişe çekilir: test satırları "bayat" sayılsın.
            var settled = await NewBilling(db).SweepStaleSmsReservationsAsync(TimeSpan.FromSeconds(-5));
            Assert.Equal(2, settled);
        }

        var wallet = await WalletAsync(options, tenantId);
        Assert.Equal(0m, wallet.SmsReservedCredits);
        Assert.Equal(98m, wallet.SmsBalanceCredits);   // yalnız gönderilen 2 kredi harcandı

        await using var check = NewDb(options);
        var sentRow = await check.NotificationLogs.IgnoreQueryFilters().AsNoTracking().SingleAsync(l => l.Id == sentId);
        var stuckRow = await check.NotificationLogs.IgnoreQueryFilters().AsNoTracking().SingleAsync(l => l.Id == stuckId);
        Assert.NotNull(sentRow.ChargeCapturedAtUtc);
        Assert.Equal(WhatsAppBillingSource.None, stuckRow.BillingSource);

        // İkinci tur hiçbir şeye dokunmaz (idempotent).
        await using var again = NewDb(options);
        Assert.Equal(0, await NewBilling(again).SweepStaleSmsReservationsAsync(TimeSpan.FromSeconds(-5)));
    }
}
