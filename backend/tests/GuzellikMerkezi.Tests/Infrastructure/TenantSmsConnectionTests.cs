using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
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
/// KURUMUN KENDİ SMS HESABI (Verimor / Netgsm).
///
/// <para>
/// Bağlantı açık ve doğrulanmışsa kurumun müşteri SMS'leri o hesaptan gider: kota ve mesaj kredisi
/// DÜŞMEZ, platform hattı hiç çağrılmaz. Yol, rezervasyonda satıra yazılan karardan okunur — bağlantı
/// gönderimden hemen önce kaldırılırsa mesaj başarısız yazılır, platforma (krediye) DÜŞÜLMEZ.
/// Doğrulanmamış bağlantı hiçbir şeyi değiştirmez. Hesap bilgisi arka plan işlerinde (kurum kapsamı
/// yokken) ve başka kurum kapsamında da doğru çözülür. Parola hiçbir yanıtta dönmez; personelin
/// isteği onay taslağına (parolasıyla) düşmez.
/// </para>
/// </summary>
public sealed class TenantSmsConnectionTests
{
    private const string Secret = "s3cr3t-api-parola";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ITenantContext? scope = null) =>
        new(options, scope, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid TemplateId, List<Guid> CustomerIds);

    /// <param name="connection">null = bağlantı yok; "active" = açık + doğrulanmış; "unverified" = kayıtlı ama test edilmemiş.</param>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, int smsQuota, bool allowOverage,
        decimal walletCredits, bool platformLive, string? connection, int customers = 1)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan($"own-{Guid.NewGuid():N}"[..16], "Kendi SMS QA", 100m, 1, 3, 100, 100, smsQuota);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Kendi SMS QA", $"own-sms-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        tenant.AssignSubscriptionPlan(plan);
        db.Tenants.Add(tenant);
        db.WhatsAppBillingSettings.Add(PaymentTestDoubles.BillingOneTryPerCredit());   // SMS: 2 kredi/parça
        var settings = new WhatsAppSettings(tenant.Id);
        settings.UpdateBillingPreferences(marketingEnabled: false, allowWalletOverage: allowOverage, monthlySpendCapCredits: null);
        db.WhatsAppSettings.Add(settings);
        if (walletCredits > 0)
        {
            var wallet = new TenantMessagingWallet(tenant.Id);
            wallet.TopUp(walletCredits);
            db.TenantMessagingWallets.Add(wallet);
        }
        if (platformLive)
        {
            var platform = new PlatformIntegrationSettings();
            platform.UpdateSms(true, "Verimor", "ENC:test-key", "ENC:test-secret", "BEAUTY", null);
            db.PlatformIntegrationSettings.Add(platform);
        }
        if (connection is not null)
        {
            var c = new TenantSmsConnection(tenant.Id, "Verimor", "908501234567", Secret, "SALONUM", enabled: true);
            if (connection == "active") c.RecordTest(true, null, DateTime.UtcNow);
            db.TenantSmsConnections.Add(c);
        }

        var people = Enumerable.Range(0, customers)
            .Select(i => new Customer(tenant.Id, branch.Id, $"Kişi {i}", $"+90 555 000 00 2{i}", null))
            .ToList();
        db.Customers.AddRange(people);
        var template = new NotificationTemplate(tenant.Id, branch.Id, "QA", NotificationChannel.Sms, NotificationTrigger.Manual, "Merhaba {{ad}}");
        template.Activate();
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, branch.Id, template.Id, people.Select(p => p.Id).ToList());
    }

    private static IPlatformMessagingService AcceptingMessaging()
    {
        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "platform-1", null));
        messaging.SendSmsWithAccountAsync(Arg.Any<SmsAccountCredentials>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "own-1", null));
        return messaging;
    }

    private static async Task<List<NotificationLog>> LogsAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        return await db.NotificationLogs.IgnoreQueryFilters().AsNoTracking().Where(l => l.TenantId == tenantId).ToListAsync();
    }

    private static async Task<TenantMessagingWallet?> WalletAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        return await db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(w => w.TenantId == tenantId);
    }

    // ───────────── Gönderim yolu ─────────────

    [Fact]
    public async Task ActiveOwnAccount_SendsThroughSalonAccount_WithoutQuotaOrCredits_EvenWhenPlatformIsSimulated()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 1, allowOverage: true, walletCredits: 100m, platformLive: false, connection: "active", customers: 3);
        var messaging = AcceptingMessaging();

        await using (var db = NewDb(options))
        {
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging, NotificationTestServices.WithBilling(db));
            var result = await service.SendAsync(seed.TenantId, new SendNotificationRequest(seed.TemplateId, seed.CustomerIds, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(3, result.Value!.Sent);
        }

        var logs = await LogsAsync(options, seed.TenantId);
        Assert.Equal(3, logs.Count);
        Assert.All(logs, l =>
        {
            Assert.Equal(WhatsAppBillingSource.OwnAccount, l.BillingSource);
            Assert.Equal(0m, l.ChargedCredits);
            Assert.Equal(NotificationLogStatus.Sent, l.Status);
        });
        var wallet = await WalletAsync(options, seed.TenantId);
        Assert.Equal(100m, wallet!.BalanceCredits);
        Assert.Equal(0m, wallet.ReservedCredits);

        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.Received(3).SendSmsWithAccountAsync(
            Arg.Is<SmsAccountCredentials>(a => a != null && a.Provider == "Verimor" && a.Sender == "SALONUM" && a.Password == Secret && a.Username == "908501234567"),
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Kotası dolmuş, kredi taşması kapalı kurum kendi hesabıyla yine gönderebilir.</summary>
    [Fact]
    public async Task ActiveOwnAccount_QuotaExhaustedAndOverageOff_IsNotBlocked()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 0, allowOverage: false, walletCredits: 0m, platformLive: true, connection: "active");
        var messaging = AcceptingMessaging();

        await using (var db = NewDb(options))
        {
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging, NotificationTestServices.WithBilling(db));
            var result = await service.SendAsync(seed.TenantId, new SendNotificationRequest(seed.TemplateId, seed.CustomerIds, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(1, result.Value!.Sent);
        }

        var log = Assert.Single(await LogsAsync(options, seed.TenantId));
        Assert.Equal(WhatsAppBillingSource.OwnAccount, log.BillingSource);
        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Kayıtlı ama test SMS'iyle doğrulanmamış hesap hiçbir şeyi değiştirmez: platform yolu sürer.</summary>
    [Fact]
    public async Task UnverifiedConnection_KeepsPlatformRoute()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 1, allowOverage: true, walletCredits: 100m, platformLive: true, connection: "unverified");
        var messaging = AcceptingMessaging();

        await using (var db = NewDb(options))
        {
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging, NotificationTestServices.WithBilling(db));
            var result = await service.SendAsync(seed.TenantId, new SendNotificationRequest(seed.TemplateId, seed.CustomerIds, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        var log = Assert.Single(await LogsAsync(options, seed.TenantId));
        Assert.Equal(WhatsAppBillingSource.Quota, log.BillingSource);
        await messaging.Received(1).SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendSmsWithAccountAsync(Arg.Any<SmsAccountCredentials>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// PLATFORMA DÜŞÜLMEZ: rezervasyon "kendi hesap" kararını verdikten sonra bağlantı kapatılırsa mesaj
    /// başarısız yazılır. Platformdan gönderilseydi kurum haberi olmadan krediden öderdi.
    /// </summary>
    [Fact]
    public async Task ConnectionDisabledAfterRoutingDecision_FailsWithoutPlatformFallback()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 5, allowOverage: true, walletCredits: 100m, platformLive: true, connection: "active");
        var messaging = AcceptingMessaging();

        await using (var db = NewDb(options))
        {
            var sp = NotificationTestServices.WithBilling(db);
            // Yol kararı (kısa ömürlü önbellek) "kendi hesap" der…
            Assert.True(await sp.GetRequiredService<IWhatsAppBillingService>().IsOwnSmsAccountActiveAsync(seed.TenantId));
            // …ama gönderimden önce kurum bağlantıyı kapatır.
            var row = await db.TenantSmsConnections.IgnoreQueryFilters().SingleAsync(c => c.TenantId == seed.TenantId);
            row.Update("Verimor", null, null, "SALONUM", enabled: false);
            await db.SaveChangesAsync();

            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging, sp);
            var result = await service.SendAsync(seed.TenantId, new SendNotificationRequest(seed.TemplateId, seed.CustomerIds, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(0, result.Value!.Sent);
            Assert.Equal(1, result.Value.Failed);
        }

        var log = Assert.Single(await LogsAsync(options, seed.TenantId));
        Assert.Equal(WhatsAppBillingSource.OwnAccount, log.BillingSource);
        Assert.Equal(NotificationLogStatus.Failed, log.Status);
        Assert.Equal(NotificationService.OwnSmsAccountGoneError, log.ErrorMessage);
        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        var wallet = await WalletAsync(options, seed.TenantId);
        Assert.Equal(100m, wallet!.BalanceCredits);
    }

    /// <summary>
    /// Bağlantıdan ÖNCE krediden rezerve edilmiş (askıda kalmış) satır devralındığında kararı değişmez:
    /// kredisi zaten ayrılmıştır, platformdan gider ve kredisi sonuçlandırılır.
    /// </summary>
    [Fact]
    public async Task StaleWalletReservation_TakenOverAfterConnecting_StaysOnPlatform()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 0, allowOverage: true, walletCredits: 100m, platformLive: true, connection: "active");

        await using var db = NewDb(options);
        var billing = NotificationTestServices.WithBilling(db).GetRequiredService<IWhatsAppBillingService>();
        var log = new NotificationLog(seed.TenantId, seed.BranchId, seed.TemplateId, seed.CustomerIds[0], NotificationChannel.Sms,
            "+905550000020", "Merhaba", NotificationLogStatus.Queued, null, "stale-key");
        log.AttachCharge(WhatsAppBillingSource.Wallet, 2m, 1);

        var decision = await billing.ReserveSmsAsync(seed.TenantId, log, 1, live: true);

        Assert.True(decision.Allowed);
        Assert.Equal(WhatsAppBillingSource.Wallet, decision.Source);
        Assert.Equal(2m, decision.Credits);
        Assert.Equal(WhatsAppBillingSource.Wallet, log.BillingSource);
    }

    [Fact]
    public async Task SystemSms_GoesThroughOwnAccount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 0, allowOverage: false, walletCredits: 0m, platformLive: false, connection: "active");
        var messaging = AcceptingMessaging();

        SystemSmsOutcome outcome;
        await using (var db = NewDb(options))
        {
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging, NotificationTestServices.WithBilling(db));
            outcome = await service.SendSystemSmsAsync(new SystemSmsRequest(seed.TenantId, seed.BranchId, seed.CustomerIds[0],
                "+905550000020", "Bizi değerlendirin: https://ornek.test/r/1", "RatingLink", "rating:1"));
        }

        Assert.Equal(SystemSmsStatus.Sent, outcome.Status);
        Assert.Equal(0m, outcome.ChargedCredits);
        var log = Assert.Single(await LogsAsync(options, seed.TenantId));
        Assert.Equal(WhatsAppBillingSource.OwnAccount, log.BillingSource);
        await messaging.Received(1).SendSmsWithAccountAsync(Arg.Any<SmsAccountCredentials>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Estimate_WithOwnAccount_IsLiveAndCostsNoCredits()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 0, allowOverage: false, walletCredits: 0m, platformLive: false, connection: "active", customers: 2);

        await using var db = NewDb(options);
        var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(),
            Substitute.For<IPlatformMessagingService>(), NotificationTestServices.WithBilling(db));
        var estimate = await service.EstimateAsync(seed.TenantId, new SendNotificationRequest(seed.TemplateId, seed.CustomerIds, null));

        Assert.True(estimate.IsSuccess, estimate.IsFailure ? estimate.Error.Message : null);
        Assert.True(estimate.Value!.OwnAccount);
        Assert.True(estimate.Value.Live);
        Assert.Equal(2, estimate.Value.ExpectedToSend);
        Assert.Equal(0m, estimate.Value.CreditsNeeded);
    }

    // ───────────── Kapsam (arka plan işleri / başka kurum kapsamı) ─────────────

    /// <summary>
    /// Otomatik hatırlatmalar kurum kapsamı olmadan, kapsamlı istekler başka bir kurumun filtresiyle
    /// çalışabilir. Bağlantı her durumda bulunmalı; aksi hâlde SMS sessizce platformdan (krediden) giderdi.
    /// </summary>
    [Fact]
    public async Task ActiveConnection_IsFound_UnderAnotherTenantsScope()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, smsQuota: 0, allowOverage: false, walletCredits: 0m, platformLive: false, connection: "active");

        await using var db = NewDb(options, new TestTenantContext(Guid.NewGuid()));
        // Önkoşul: filtre gerçekten devrede (filtreli sorgu satırı göremez).
        Assert.False(await db.TenantSmsConnections.AnyAsync());

        var billing = NotificationTestServices.WithBilling(db).GetRequiredService<IWhatsAppBillingService>();
        Assert.True(await billing.IsOwnSmsAccountActiveAsync(seed.TenantId));
        var creds = await NewConnectionService(db).ResolveActiveAsync(seed.TenantId);
        Assert.NotNull(creds);
        Assert.Equal("SALONUM", creds!.Sender);
    }

    // ───────────── Bağlantı yönetimi ─────────────

    private static TenantSmsConnectionService NewConnectionService(GuzellikDbContext db, IPlatformMessagingService? messaging = null,
        GuzellikMerkezi.Application.Features.Features.IFeatureService? features = null) =>
        new(db, messaging ?? Substitute.For<IPlatformMessagingService>(), features ?? new AllowAllFeatureService(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                [TenantSmsConnectionService.ServerIpConfigKey] = "203.0.113.10",
            }).Build(),
            NullLogger<TenantSmsConnectionService>.Instance);

    /// <summary>
    /// Paketinde SMS olmayan kurum bağlayamaz/test edemez — bağlasaydı "Bağlı" görür ama her gönderim
    /// paket kapısında reddedilirdi. Karar sunucuda: hem web hem mobil aynı 409'u alır.
    /// </summary>
    [Fact]
    public async Task PlanWithoutSmsFeature_CannotConnectOrTest()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "unverified");
        var messaging = AcceptingMessaging();
        var noSms = Substitute.For<GuzellikMerkezi.Application.Features.Features.IFeatureService>();
        noSms.IsFeatureAllowedAsync(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(ci => ci.ArgAt<string>(1) != FeatureCatalog.NotificationsSms);
        await using var db = NewDb(options);

        var save = await NewConnectionService(db, messaging, noSms).SaveAsync(seed.TenantId,
            new SaveSmsConnectionRequest("Verimor", "908501234567", Secret, "SALONUM"));
        var test = await NewConnectionService(db, messaging, noSms).TestAsync(seed.TenantId, new TestSmsConnectionRequest("05551234567"));
        var dto = (await NewConnectionService(db, messaging, noSms).GetAsync(seed.TenantId, canManage: true)).Value!;

        Assert.True(save.IsFailure);
        Assert.Equal("Conflict", save.Error.Code);
        Assert.True(test.IsFailure);
        Assert.Equal("Conflict", test.Error.Code);
        Assert.False(dto.SmsFeatureAllowed);
        await messaging.DidNotReceive().SendSmsWithAccountAsync(Arg.Any<SmsAccountCredentials>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Yanlış ya da silinmiş kurum kimliği yetim (sahipsiz) kimlik bilgisi satırı üretmez.</summary>
    [Fact]
    public async Task Save_UnknownTenant_ReturnsNotFound_AndWritesNothing()
    {
        var options = NewOptions();
        await SeedAsync(options, 0, false, 0m, false, connection: null);
        await using var db = NewDb(options);

        var result = await NewConnectionService(db).SaveAsync(Guid.NewGuid(),
            new SaveSmsConnectionRequest("Verimor", "908501234567", Secret, "SALONUM"));

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.False(await db.TenantSmsConnections.IgnoreQueryFilters().AnyAsync());
    }

    /// <summary>
    /// Platform listesi: HER kurum (bağlantısı olmayan dahil), paketinin SMS içerip içermediği ve
    /// bağlantı durumu. Parola dönmez; kurum telefonu test için önerilir (yalnız platforma).
    /// </summary>
    [Fact]
    public async Task List_ReturnsEveryTenant_WithConnectionAndPlanSmsFlag()
    {
        var options = NewOptions();
        var connected = await SeedAsync(options, 0, false, 0m, false, connection: "active");
        var bare = await SeedAsync(options, 0, false, 0m, false, connection: null);
        await using (var db = NewDb(options))
        {
            // İkinci kurumun paketinde SMS yok.
            var plan = await db.Tenants.IgnoreQueryFilters().Where(t => t.Id == bare.TenantId).Select(t => t.SubscriptionPlan).SingleAsync();
            plan!.SetFeatures("notifications.email");
            await db.SaveChangesAsync();
            // Bağlı kurumun paketi SMS içerir.
            var connectedPlan = await db.Tenants.IgnoreQueryFilters().Where(t => t.Id == connected.TenantId).Select(t => t.SubscriptionPlan).SingleAsync();
            connectedPlan!.SetFeatures("notifications.sms,notifications.bulk");
            await db.SaveChangesAsync();
        }

        await using var read = NewDb(options);
        var list = (await NewConnectionService(read).ListAsync()).Value!;
        var json = JsonSerializer.Serialize(list);

        var a = Assert.Single(list, x => x.TenantId == connected.TenantId);
        Assert.Equal("Connected", a.Connection.Status);
        Assert.True(a.Connection.Active);
        Assert.True(a.Connection.CanManage);
        Assert.Equal("SALONUM", a.Connection.Sender);
        Assert.True(a.Connection.SmsFeatureAllowed);
        var b = Assert.Single(list, x => x.TenantId == bare.TenantId);
        Assert.Equal("NotConnected", b.Connection.Status);
        Assert.False(b.Connection.SmsFeatureAllowed);
        Assert.DoesNotContain(Secret, json);
    }

    [Fact]
    public async Task Save_FirstConnection_RequiresUsernameAndPassword()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: null);
        await using var db = NewDb(options);

        var noPassword = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Verimor", "908501234567", null, "SALONUM"));
        Assert.True(noPassword.IsFailure);
        var noUser = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Netgsm", null, Secret, "SALONUM"));
        Assert.True(noUser.IsFailure);
        var twilio = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Twilio", "x", Secret, "SALONUM"));
        Assert.True(twilio.IsFailure);
        Assert.False(await db.TenantSmsConnections.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Save_BlankPasswordKeepsSecretAndVerification_ChangedPasswordResetsIt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "active");

        await using (var db = NewDb(options))
        {
            // Aynı bilgiler, parola boş (istemci kayıtlı parolayı bilmez) → doğrulama korunur.
            var same = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Verimor", null, "", "SALONUM", true));
            Assert.True(same.IsSuccess, same.IsFailure ? same.Error.Message : null);
            Assert.True(same.Value!.Active);
            Assert.Equal("Connected", same.Value.Status);
        }
        await using (var db = NewDb(options))
        {
            var row = await db.TenantSmsConnections.IgnoreQueryFilters().AsNoTracking().SingleAsync(c => c.TenantId == seed.TenantId);
            Assert.Equal(Secret, row.Password);
            Assert.NotNull(row.VerifiedAtUtc);
        }

        await using (var db = NewDb(options))
        {
            // Yeni parola = yeni hesap kanıtı gerekir → doğrulama sıfırlanır, gönderim platforma döner.
            var changed = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Verimor", null, "yeni-parola", "SALONUM", true));
            Assert.True(changed.IsSuccess);
            Assert.False(changed.Value!.Active);
            Assert.Equal("PendingTest", changed.Value.Status);
        }
    }

    [Fact]
    public async Task Test_Success_VerifiesConnection_AndCooldownBlocksImmediateRetest()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "unverified");
        var messaging = AcceptingMessaging();

        await using (var db = NewDb(options))
        {
            var first = await NewConnectionService(db, messaging).TestAsync(seed.TenantId, new TestSmsConnectionRequest("0555 123 45 67"));
            Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);
            Assert.True(first.Value!.Sent);
            Assert.True(first.Value.Connection.Active);
            Assert.Equal("Connected", first.Value.Connection.Status);

            var second = await NewConnectionService(db, messaging).TestAsync(seed.TenantId, new TestSmsConnectionRequest("0555 123 45 67"));
            Assert.True(second.IsFailure);
            Assert.Equal("Conflict", second.Error.Code);
        }

        await messaging.Received(1).SendSmsWithAccountAsync(
            Arg.Is<SmsAccountCredentials>(a => a != null && a.Password == Secret), "05551234567", TenantSmsConnectionService.TestMessage, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Test_RejectsNonMobileNumber_WithoutSending()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "unverified");
        var messaging = AcceptingMessaging();
        await using var db = NewDb(options);

        var result = await NewConnectionService(db, messaging).TestAsync(seed.TenantId, new TestSmsConnectionRequest("0212 123 45 67"));

        Assert.True(result.IsFailure);
        await messaging.DidNotReceive().SendSmsWithAccountAsync(Arg.Any<SmsAccountCredentials>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Bilgiler aynıyken başarısız bir yeniden test (bakiye, IP izni) doğrulamayı SİLMEZ.</summary>
    [Fact]
    public void FailedRetest_KeepsVerification_ButRecordsError()
    {
        var c = new TenantSmsConnection(Guid.NewGuid(), "netgsm", "8501234567", Secret, "SALONUM", enabled: true);
        Assert.Equal("Netgsm", c.Provider);
        c.RecordTest(true, null, DateTime.UtcNow);
        c.RecordTest(false, "Netgsm hata kodu: 40", DateTime.UtcNow);

        Assert.True(c.IsActive);
        Assert.Equal("Netgsm hata kodu: 40", c.LastError);
        Assert.Throws<DomainException>(() => TenantSmsConnection.CanonicalProvider("Twilio"));
    }

    [Fact]
    public async Task Get_NeverReturnsPassword_AndMasksUsername()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "active");
        await using var db = NewDb(options);

        var dto = (await NewConnectionService(db).GetAsync(seed.TenantId, canManage: false)).Value!;
        var json = JsonSerializer.Serialize(dto);

        Assert.DoesNotContain(Secret, json);
        Assert.DoesNotContain("908501234567", json);
        Assert.True(dto.HasPassword);
        Assert.Equal("•••• 4567", dto.UsernameHint);
        Assert.False(dto.CanManage);
        Assert.Null(dto.SuggestedTestPhone);   // yalnız yönetebilen kullanıcıya
        Assert.Equal("203.0.113.10", dto.ServerIp);
    }

    [Fact]
    public async Task Disconnect_HardDeletesRow_AndAllowsReconnect()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, 0, false, 0m, false, connection: "active");

        await using (var db = NewDb(options))
        {
            var removed = await NewConnectionService(db).DisconnectAsync(seed.TenantId);
            Assert.True(removed.IsSuccess);
            Assert.Equal("NotConnected", removed.Value!.Status);
        }
        await using (var db = NewDb(options))
        {
            // Silinmiş (soft) satır da kalmamalı: şifreli kimlik bilgisi tabloda yaşamasın.
            Assert.False(await db.TenantSmsConnections.IgnoreQueryFilters().AnyAsync(c => c.TenantId == seed.TenantId));
            var again = await NewConnectionService(db).SaveAsync(seed.TenantId, new SaveSmsConnectionRequest("Netgsm", "8501234567", Secret, "SALONUM"));
            Assert.True(again.IsSuccess, again.IsFailure ? again.Error.Message : null);
            Assert.Equal("PendingTest", again.Value!.Status);
        }
    }

    // ───────────── Onay kapısı ─────────────

    private static DefaultHttpContext StaffRequest(string path, string method, string body)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        http.Request.Path = path;
        http.Request.ContentType = "application/json";
        var bytes = Encoding.UTF8.GetBytes(body);
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Response.Body = new MemoryStream();
        return http;
    }

    /// <summary>Personelin hediye çeki SMS'i onay kapısından geçer (taslağa düşer).</summary>
    [Fact]
    public async Task StaffGiftCardSms_IsStillGated()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = 0;
        var gate = new StaffApprovalGateMiddleware(_ => { reached++; return Task.CompletedTask; });
        var pendingOps = Substitute.For<IPendingOperationService>();
        pendingOps.CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(), Arg.Any<string>(),
                Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>())
            .Returns(Result<PendingOperationDto>.Failure(Error.Validation("stub")));
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Notifications, Permissions.NotificationsSend, Permissions.GiftCards);
        var http = StaffRequest("/api/admin/sms/gift-card", "POST", "{}");

        await gate.InvokeAsync(http, staff, new TestTenantContext(tenantId), pendingOps);

        Assert.Equal(0, reached);
        await pendingOps.ReceivedWithAnyArgs(1).CreateAsync(default, default, default, default!, default!, default);
    }

    /// <summary>SMS uçları WhatsApp'la aynı işlem iznine tabidir: gönderme izni olmayan personel 403 alır.</summary>
    [Fact]
    public async Task StaffWithoutSendPermission_CannotUseSmsEndpoints()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = 0;
        var gate = new StaffApprovalGateMiddleware(_ => { reached++; return Task.CompletedTask; });
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Notifications, Permissions.NotificationsTemplates);
        var http = StaffRequest("/api/admin/sms/gift-card", "POST", "{}");

        await gate.InvokeAsync(http, staff, new TestTenantContext(tenantId), Substitute.For<IPendingOperationService>());

        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(0, reached);
    }
}
