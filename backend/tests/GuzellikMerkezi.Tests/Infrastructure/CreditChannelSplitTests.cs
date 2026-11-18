using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SMS VE WHATSAPP KREDİSİ AYRI (kullanıcı kararı 18 Kas 2026: "SMS ayrı, WhatsApp ayrı kredi; fiyatları farklı olabilir,
/// farklı kredi yiyebilirler"). Değişmezler: bir kanalın kredisi diğerinde harcanmaz; satın alma / düzeltme doğru kanala
/// yüklenir; paket dışı SMS kredisi SMS birim fiyatıyla fiyatlanır; tam gövde PUT'ta alanı göndermeyen eski istemci SMS
/// fiyatını sıfırlamaz; eski istek (kanalsız) WhatsApp sayılır.
/// </summary>
public sealed class CreditChannelSplitTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static WhatsAppBillingService NewBilling(GuzellikDbContext db) =>
        new(db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static async Task<Guid> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Kanal QA", $"kanal-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        var billing = PaymentTestDoubles.BillingOneTryPerCredit();
        billing.Update(true, false, 40m, 50m, null, autoApproveTopUps: false, smsCreditsPerPart: 1m, creditUnitPriceTry: 0.15m, smsCreditUnitPriceTry: 0.40m);
        db.WhatsAppBillingSettings.Add(billing);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    [Fact]
    public void Wallet_channels_are_independent()
    {
        var wallet = new TenantMessagingWallet(Guid.NewGuid());
        wallet.TopUp(CreditChannel.WhatsApp, 100m);
        wallet.TopUp(CreditChannel.Sms, 10m);
        Assert.Equal((100m, 10m), (wallet.AvailableFor(CreditChannel.WhatsApp), wallet.AvailableFor(CreditChannel.Sms)));

        Assert.False(wallet.TryReserve(CreditChannel.Sms, 11m));            // SMS, WhatsApp kredisinden harcayamaz
        Assert.True(wallet.TryReserve(CreditChannel.Sms, 4m));
        Assert.True(wallet.TryReserve(CreditChannel.Sms, 0m));              // ücretsiz
        wallet.Capture(CreditChannel.Sms, 3m);
        wallet.Refund(CreditChannel.Sms, 1m);
        wallet.Capture(CreditChannel.Sms, 0m);
        wallet.Refund(CreditChannel.Sms, 0m);
        Assert.Equal((7m, 0m, 3m, 10m), (wallet.SmsBalanceCredits, wallet.SmsReservedCredits, wallet.SmsLifetimeSpentCredits, wallet.SmsLifetimeTopUpCredits));
        Assert.Equal((100m, 0m, 0m, 100m), (wallet.BalanceCredits, wallet.ReservedCredits, wallet.LifetimeSpentCredits, wallet.LifetimeTopUpCredits));

        wallet.Adjust(CreditChannel.Sms, -50m);                            // eksiye düşmez
        wallet.Adjust(CreditChannel.WhatsApp, 5m);
        Assert.Equal((0m, 105m, 105m), (wallet.SmsBalanceCredits, wallet.BalanceCredits, wallet.LifetimeTopUpFor(CreditChannel.WhatsApp)));
        Assert.Throws<DomainException>(() => wallet.TopUp(CreditChannel.Sms, 0m));
        Assert.Equal("SMS kredisi", CreditChannel.Sms.Label());
        Assert.Equal(NotificationChannel.WhatsApp, CreditChannel.WhatsApp.ToNotificationChannel());
    }

    [Fact]
    public async Task Purchases_and_adjustments_land_on_their_own_channel()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);
        Guid smsPackage;
        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            var created = await billing.SaveCreditPackageAsync(null, new SaveCreditPackageRequest("SMS 1000", null, 300m, 1000m, 1, true, CreditChannel.Sms));
            Assert.Equal(CreditChannel.Sms, created.Value!.Channel);
            smsPackage = created.Value.Id;
            var legacy = await billing.SaveCreditPackageAsync(null, new SaveCreditPackageRequest("WA 500", null, 75m, 500m, 2, true));
            Assert.Equal(CreditChannel.WhatsApp, legacy.Value!.Channel);   // kanalsız eski istemci → WhatsApp
            // Güncellemede kanal gönderilmezse korunur.
            var renamed = await billing.SaveCreditPackageAsync(smsPackage, new SaveCreditPackageRequest("SMS 1000+", null, 300m, 1000m, 1, true));
            Assert.Equal(CreditChannel.Sms, renamed.Value!.Channel);
        }

        await using (var db = NewDb(options))
        {
            var billing = NewBilling(db);
            // Paket dışı SMS kredisi SMS birim fiyatıyla (0,40) fiyatlanır.
            var custom = await billing.RequestPurchaseAsync(tenantId, new TopUpRequest(null, 100m, CreditChannel.Sms), null);
            Assert.Equal((40m, CreditChannel.Sms), (custom.Value!.PriceTry, custom.Value.Channel));
            var legacyCustom = await billing.RequestPurchaseAsync(tenantId, new TopUpRequest(null, 100m), null);
            Assert.Equal((15m, CreditChannel.WhatsApp), (legacyCustom.Value!.PriceTry, legacyCustom.Value.Channel));
            // Paket başka kanala aitse yükleme yapılmaz.
            Assert.Equal("Validation", (await billing.RequestPurchaseAsync(tenantId, new TopUpRequest(smsPackage, null, CreditChannel.WhatsApp), null)).Error.Code);

            var packaged = await billing.RequestPurchaseAsync(tenantId, new TopUpRequest(smsPackage, null), null);
            Assert.True((await billing.ApprovePurchaseAsync(packaged.Value!.Id, null)).IsSuccess);
            Assert.True((await billing.AdjustWalletAsync(tenantId, new AdjustWalletRequest(25m, null, CreditChannel.WhatsApp), null)).IsSuccess);
            Assert.True((await billing.AdjustWalletAsync(tenantId, new AdjustWalletRequest(5m, "Hediye"), null)).IsSuccess);
        }

        await using var check = NewDb(options);
        var wallet = await check.TenantMessagingWallets.IgnoreQueryFilters().SingleAsync(w => w.TenantId == tenantId);
        Assert.Equal((1000m, 30m), (wallet.SmsBalanceCredits, wallet.BalanceCredits));
        var ledger = await check.WalletTransactions.IgnoreQueryFilters().Where(t => t.TenantId == tenantId).ToListAsync();
        Assert.Equal((1, 2), (ledger.Count(t => t.Channel == NotificationChannel.Sms), ledger.Count(t => t.Channel == NotificationChannel.WhatsApp)));
        Assert.Equal(1000m, ledger.Single(t => t.Channel == NotificationChannel.Sms).BalanceAfter);   // satır kendi kanalının bakiyesini yazar

        var dto = (await NewBilling(check).GetWalletAsync(tenantId)).Value!;
        Assert.Equal((1000m, 1000m, 30m, 0.40m, 0.15m), (dto.SmsBalanceCredits, dto.SmsAvailableCredits, dto.AvailableCredits, dto.SmsCreditUnitPriceTry, dto.CreditUnitPriceTry));
        Assert.Equal(1000, dto.EstimatedSmsMessages);    // 1 kredi / parça
        Assert.False(dto.SmsIsLowBalance);
        Assert.Equal(1000, dto.CreditPackages.Single(p => p.Channel == CreditChannel.Sms).EstimatedUtilityMessages);
    }

    [Fact]
    public async Task An_old_client_without_the_sms_price_keeps_it()
    {
        var options = NewOptions();
        await SeedAsync(options);
        await using var db = NewDb(options);
        var billing = NewBilling(db);
        var saved = await billing.SaveBillingSettingsAsync(new SaveBillingSettingsRequest(true, false, 41m, 50m, null, false, 1m, 0.20m));
        Assert.Equal((0.20m, 0.40m), (saved.Value!.CreditUnitPriceTry, saved.Value.SmsCreditUnitPriceTry));
        var changed = await billing.SaveBillingSettingsAsync(new SaveBillingSettingsRequest(true, false, 41m, 50m, null, false, 1m, 0.20m, 0.55m));
        Assert.Equal(0.55m, changed.Value!.SmsCreditUnitPriceTry);
        Assert.Throws<DomainException>(() => new WhatsAppBillingSettings().Update(true, false, 40m, 0m, null, false, 1m, 0.1m, 0m));
    }
}
