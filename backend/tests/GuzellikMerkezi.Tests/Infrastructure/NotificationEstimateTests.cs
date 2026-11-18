using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Bildirim gönderimi ÖNCESİ tahmin + şablon metni.
///
/// <para>
/// (1) Randevu hatırlatmasında {{tarih}}/{{saat}} RANDEVUNUN kendisinden ve Türkiye saatiyle gelir —
/// eskiden gönderim anı (UTC) basılıyor, müşteriye yanlış saat gidiyordu. (2) Tahmin, gönderimin
/// karar sırasını (kota → izin → kredi) aynen izler. (3) "Tüm müşteriler" kara listeyi atlar; elle
/// seçilen kişiler ise seçildiği gibi kalır.
/// </para>
/// </summary>
public sealed class NotificationEstimateTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static NotificationService NewService(GuzellikDbContext db) =>
        new(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(),
            Substitute.For<IPlatformMessagingService>(), NotificationTestServices.WithBilling(db));

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid PlanId);

    private static async Task<Seed> SeedTenantAsync(GuzellikDbContext db, int smsQuota, bool allowOverage, decimal walletCredits, bool smsLive)
    {
        var plan = new SubscriptionPlan($"est-{Guid.NewGuid():N}"[..16], "Tahmin QA", 100m, 1, 3, 100, 100, smsQuota);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Tahmin QA", $"tahmin-qa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Nişantaşı", "İstanbul", true);
        tenant.AssignSubscriptionPlan(plan);
        db.Tenants.Add(tenant);
        db.WhatsAppBillingSettings.Add(PaymentTestDoubles.BillingOneTryPerCredit());   // SMS: 2 kredi/parça
        var settings = new WhatsAppSettings(tenant.Id);
        settings.UpdateBillingPreferences(marketingEnabled: false, allowWalletOverage: allowOverage, monthlySpendCapCredits: null);
        db.WhatsAppSettings.Add(settings);
        if (walletCredits > 0)
        {
            var wallet = new TenantMessagingWallet(tenant.Id);
            wallet.TopUp(CreditChannel.WhatsApp, walletCredits);
            wallet.TopUp(CreditChannel.Sms, walletCredits);
            db.TenantMessagingWallets.Add(wallet);
        }
        if (smsLive)
        {
            var platform = new PlatformIntegrationSettings();
            platform.UpdateSms(true, "Verimor", "ENC:test-key", "ENC:test-secret", "BEAUTY", null);
            db.PlatformIntegrationSettings.Add(platform);
        }
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, branch.Id, plan.Id);
    }

    private static NotificationTemplate SmsTemplate(Seed s, NotificationTrigger trigger, string body)
    {
        var t = new NotificationTemplate(s.TenantId, s.BranchId, "QA", NotificationChannel.Sms, trigger, body);
        t.Activate();
        return t;
    }

    [Fact]
    public async Task Reminder_RendersAppointmentDateTimeServiceAndSalon_InTurkeyTime()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var seed = await SeedTenantAsync(db, smsQuota: 10, allowOverage: false, walletCredits: 0, smsLive: false);

        var customer = new Customer(seed.TenantId, seed.BranchId, "Ayşe Yılmaz", "+90 555 000 11 22", null);
        var staff = new StaffMember(seed.TenantId, seed.BranchId, "Elif", "Uzman");
        var service = new ServiceDefinition(seed.TenantId, seed.BranchId, "Lazer", 45, 1000m);
        db.AddRange(customer, staff, service);
        var startUtc = DateTime.UtcNow.Date.AddDays(1).AddHours(11);   // TR saatiyle 14:00
        db.Appointments.Add(new Appointment(seed.TenantId, seed.BranchId, customer.Id, staff.Id, service.Id,
            startUtc, startUtc.AddMinutes(45), 1000m));
        var template = SmsTemplate(seed, NotificationTrigger.AppointmentReminder,
            "Sayın {{ad}}, {{tarih}} {{saat}} {{hizmet}} randevunuz var. {{salon}}");
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var estimate = await NewService(db).EstimateAsync(seed.TenantId,
            new SendNotificationRequest(template.Id, new[] { customer.Id }, null));

        Assert.True(estimate.IsSuccess, estimate.IsFailure ? estimate.Error.Message : null);
        var local = startUtc.AddHours(3);
        Assert.Equal($"Sayın Ayşe Yılmaz, {local:dd.MM.yyyy} 14:00 Lazer randevunuz var. Nişantaşı", estimate.Value!.SampleBody);
    }

    /// <summary>
    /// Kota 1 mesaj, kalan 2 mesaj krediden; cüzdanda yalnız 2 kredi var (1 SMS = 2 kredi):
    /// tahmin 2 mesajın gideceğini (1 kota + 1 kredi) ve kredinin yetmediğini söylemeli.
    /// </summary>
    [Fact]
    public async Task Estimate_SplitsQuotaAndCredits_AndWarnsWhenCreditsRunShort()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var seed = await SeedTenantAsync(db, smsQuota: 1, allowOverage: true, walletCredits: 2m, smsLive: true);
        for (var i = 0; i < 3; i++)
            db.Customers.Add(new Customer(seed.TenantId, seed.BranchId, $"Müşteri {i}", $"+90 555 000 00 0{i}", null));
        var template = SmsTemplate(seed, NotificationTrigger.Manual, "Merhaba {{ad}}");
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var result = await NewService(db).EstimateAsync(seed.TenantId, new SendNotificationRequest(template.Id, null, "all"));

        Assert.True(result.IsSuccess);
        var e = result.Value!;
        Assert.Equal(3, e.Recipients);
        Assert.Equal(3, e.Reachable);
        Assert.Equal(3, e.TotalSmsParts);
        Assert.Equal(1, e.QuotaCovered);
        Assert.Equal(2, e.CreditMessages);
        Assert.Equal(4m, e.CreditsNeeded);
        Assert.Equal(2, e.ExpectedToSend);
        Assert.Contains(e.Warnings, w => w.Contains("yetersiz", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Estimate_WhenSmsProviderNotLive_ExpectsNothingAndSaysSo()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var seed = await SeedTenantAsync(db, smsQuota: 10, allowOverage: false, walletCredits: 0, smsLive: false);
        db.Customers.Add(new Customer(seed.TenantId, seed.BranchId, "Tek Müşteri", "+90 555 000 00 01", null));
        var template = SmsTemplate(seed, NotificationTrigger.Manual, "Merhaba {{ad}}");
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var e = (await NewService(db).EstimateAsync(seed.TenantId, new SendNotificationRequest(template.Id, null, "all"))).Value!;

        Assert.False(e.Live);
        Assert.Equal(0, e.ExpectedToSend);
        Assert.Contains(e.Warnings, w => w.Contains("simülasyon", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task AudienceAll_SkipsBlacklisted_ButExplicitPickKeepsThem()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var seed = await SeedTenantAsync(db, smsQuota: 10, allowOverage: false, walletCredits: 0, smsLive: false);
        var regular = new Customer(seed.TenantId, seed.BranchId, "Normal Müşteri", "+90 555 000 00 01", null);
        var blocked = new Customer(seed.TenantId, seed.BranchId, "Kara Liste", "+90 555 000 00 02", null);
        blocked.Blacklist("ödeme yapmadı");
        db.Customers.AddRange(regular, blocked);
        var template = SmsTemplate(seed, NotificationTrigger.Manual, "Merhaba {{ad}}");
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var service = NewService(db);
        var all = (await service.EstimateAsync(seed.TenantId, new SendNotificationRequest(template.Id, null, "all"))).Value!;
        var picked = (await service.EstimateAsync(seed.TenantId, new SendNotificationRequest(template.Id, new[] { blocked.Id }, null))).Value!;

        Assert.Equal(1, all.Recipients);
        Assert.Equal("Normal Müşteri", all.SampleRecipientName);
        Assert.Equal(1, picked.Recipients);
        Assert.Equal("Kara Liste", picked.SampleRecipientName);
    }

    /// <summary>
    /// ELLE (anahtarsız) TOPLU SMS KOTAYI AŞINCA KREDİYE GEÇER.
    ///
    /// <para>
    /// Hata: elle gönderim satırları döngü sonunda toplu yazıldığı için kota sayımı döngü boyunca
    /// bayat kalıyor, kotası 1 olan kurum 3 kişiye gönderince ÜÇÜ de "kotadan" sayılıyordu — kota
    /// aşılıyor, kredi hiç düşmüyordu. Beklenen: 1 kotadan, 2 krediden (parça × 2 kredi), kredi
    /// kesinleşmiş ve rezervde askıda bir şey kalmamış.
    /// </para>
    /// <para>
    /// Kota 2 durumu ÇİFT SAYIMI yakalar: krediden karşılanan satırın kaydı öncekileri de yazar
    /// (Added → Unchanged). İzleyici sayımı Unchanged satırları da sayarsa yazılmış satırlar hem
    /// veritabanından hem izleyiciden sayılır ve kota erken "dolmuş" görünürdü (2 yerine 1 kotadan).
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(1, 1, 2)]
    [InlineData(2, 2, 1)]
    public async Task ManualBulkSms_PastQuota_ChargesCreditsPerMessage(int smsQuota, int expectedQuota, int expectedCharged)
    {
        var options = NewOptions();
        Guid tenantId, templateId;
        List<Guid> ids;
        await using (var db = NewDb(options))
        {
            var seed = await SeedTenantAsync(db, smsQuota: smsQuota, allowOverage: true, walletCredits: 100m, smsLive: true);
            var customers = Enumerable.Range(0, 3)
                .Select(i => new Customer(seed.TenantId, seed.BranchId, $"Kişi {i}", $"+90 555 000 00 1{i}", null))
                .ToList();
            db.Customers.AddRange(customers);
            var template = SmsTemplate(seed, NotificationTrigger.Manual, "Merhaba {{ad}}");   // 1 parça
            db.NotificationTemplates.Add(template);
            await db.SaveChangesAsync();
            tenantId = seed.TenantId;
            templateId = template.Id;
            ids = customers.Select(c => c.Id).ToList();
        }

        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "provider-1", null));

        await using (var db = NewDb(options))
        {
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(),
                messaging, NotificationTestServices.WithBilling(db));
            var result = await service.SendAsync(tenantId, new SendNotificationRequest(templateId, ids, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(3, result.Value!.Sent);
        }

        await using var check = NewDb(options);
        var logs = await check.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
            .Where(l => l.TenantId == tenantId).ToListAsync();
        Assert.Equal(3, logs.Count);
        Assert.Equal(expectedQuota, logs.Count(l => l.BillingSource == WhatsAppBillingSource.Quota));
        var charged = logs.Where(l => l.BillingSource == WhatsAppBillingSource.Wallet).ToList();
        Assert.Equal(expectedCharged, charged.Count);
        Assert.All(charged, l =>
        {
            Assert.NotNull(l.ChargeCapturedAtUtc);
            Assert.Equal(2m, l.ChargedCredits);   // 1 parça × 2 kredi
        });

        var spent = expectedCharged * 2m;
        var wallet = await check.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking().SingleAsync(w => w.TenantId == tenantId);
        // SMS yalnız SMS kredisinden düşer; WhatsApp kredisi dokunulmaz (18 Kas 2026: ayrı bakiyeler).
        Assert.Equal(100m - spent, wallet.SmsBalanceCredits);
        Assert.Equal(0m, wallet.SmsReservedCredits);
        Assert.Equal(spent, wallet.SmsLifetimeSpentCredits);
        Assert.Equal((100m, 0m), (wallet.BalanceCredits, wallet.LifetimeSpentCredits));
    }

    [Fact]
    public void PartCounter_CountsFilledTemplate_NotTheRawTemplate()
    {
        // Ad uzadıkça parça artar: şablonun ham hâli değil sağlayıcıya giden metin sayılır.
        var raw = "Merhaba {{ad}}, randevunuz yarın. İyi günler dileriz.";
        var filled = raw.Replace("{{ad}}", new string('A', 40));
        Assert.Equal(1, SmsSegments.Count(raw));
        Assert.Equal(2, SmsSegments.Count(filled));
    }
}
