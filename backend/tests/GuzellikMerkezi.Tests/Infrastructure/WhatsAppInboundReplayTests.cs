using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

public sealed class WhatsAppInboundReplayTests
{
    private const string AppSecret = "test-only-whatsapp-app-secret";
    private const string PhoneNumberId = "meta-phone-number-42";
    private const string CustomerPhone = "905551112233";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, Substitute.For<ICurrentUser>(), null, null, TestSearchIndex.Create());

    private static WhatsAppService NewService(GuzellikDbContext db, IAppNotificationService notifications)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["WhatsApp:AppSecret"] = AppSecret }).Build();
        var billing = Substitute.For<IWhatsAppBillingService>();
        billing.ReserveAsync(Arg.Any<Guid>(), Arg.Any<WhatsAppMessageCategory>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(call => BillingDecision.Free(call.ArgAt<WhatsAppMessageCategory>(1), WhatsAppBillingSource.Quota));
        return new WhatsAppService(
            db,
            Substitute.For<IEncryptionService>(),
            Substitute.For<IHttpClientFactory>(),
            config,
            NullLogger<WhatsAppService>.Instance,
            new AllowAllFeatureService(),
            billing,
            Substitute.For<ICurrentUser>(),
            Substitute.For<IWaitlistService>(),
            notifications,
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>());
    }

    private static string Payload(string providerMessageId, string text = "ONAYLIYORUM") =>
        JsonSerializer.Serialize(new
        {
            entry = new[]
            {
                new
                {
                    changes = new[]
                    {
                        new
                        {
                            value = new
                            {
                                metadata = new { phone_number_id = PhoneNumberId },
                                messages = new[]
                                {
                                    new
                                    {
                                        from = CustomerPhone,
                                        id = providerMessageId,
                                        type = "text",
                                        text = new { body = text }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

    private static string Signature(string payload) =>
        "sha256=" + Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(AppSecret), Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    private static async Task<(Guid TenantId, Guid CustomerId)> SeedKvkkConversationAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Webhook replay test", $"wa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Replay Customer", CustomerPhone);
        var settings = new WhatsAppSettings(tenant.Id);
        settings.BindConnection(PhoneNumberId, "test-waba", CustomerPhone, WhatsAppConnectionStatus.Connected);
        db.Customers.Add(customer);
        db.WhatsAppSettings.Add(settings);
        db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenant.Id, branch.Id, null, customer.Id, WhatsAppMessageDirection.Outbound,
            CustomerPhone, "KVKK consent request", WhatsAppMessageStatus.Sent,
            templateName: "kvkk-consent", providerMessageId: "outbound-seed"));
        await db.SaveChangesAsync();
        return (tenant.Id, customer.Id);
    }

    [Fact]
    public async Task SequentialReplay_IsAcknowledgedWithoutRepeatingAnyInboundSideEffect()
    {
        var options = NewOptions();
        var seed = await SeedKvkkConversationAsync(options);
        var notifications = Substitute.For<IAppNotificationService>();
        await using var db = NewDb(options);
        var sut = NewService(db, notifications);
        var payload = Payload("wamid.replay-1");

        await sut.HandleInboundAsync(payload, Signature(payload));
        await sut.HandleInboundAsync(payload, Signature(payload));

        Assert.Single(await db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(x => x.Direction == WhatsAppMessageDirection.Inbound).ToListAsync());
        Assert.True((await db.Customers.IgnoreQueryFilters().SingleAsync(x => x.Id == seed.CustomerId)).KvkkConsent);
        Assert.Single(await db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(x => x.Direction == WhatsAppMessageDirection.Outbound && x.TemplateName == "kvkk-thanks").ToListAsync());
        await notifications.Received(1).NotifyRolesAsync(
            seed.TenantId, Arg.Any<Guid?>(), Arg.Any<IReadOnlyCollection<UserRole>>(),
            AppNotificationType.WhatsAppReply, AppNotificationSeverity.Success,
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<string?>(),
            Arg.Any<bool>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DistinctProviderMessageIds_WithIdenticalText_RemainDistinct()
    {
        var options = NewOptions();
        await SeedKvkkConversationAsync(options);
        await using var db = NewDb(options);
        var sut = NewService(db, Substitute.For<IAppNotificationService>());
        var first = Payload("wamid.distinct-1", "same text");
        var second = Payload("wamid.distinct-2", "same text");

        await sut.HandleInboundAsync(first, Signature(first));
        await sut.HandleInboundAsync(second, Signature(second));

        Assert.Equal(2, await db.WhatsAppMessages.IgnoreQueryFilters()
            .CountAsync(x => x.Direction == WhatsAppMessageDirection.Inbound));
    }

    [MySqlFact]
    public async Task ConcurrentReplay_OnSeparateConnections_ClaimsProviderMessageOnlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid customerId;
        await using (var seedDb = database.NewContext())
        {
            var tenant = new Tenant("Webhook concurrent replay", $"wa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            seedDb.Tenants.Add(tenant);
            await seedDb.SaveChangesAsync();
            var customer = new Customer(tenant.Id, branch.Id, "Replay Customer", CustomerPhone);
            customerId = customer.Id;
            var settings = new WhatsAppSettings(tenant.Id);
            settings.BindConnection(PhoneNumberId, "test-waba", CustomerPhone, WhatsAppConnectionStatus.Connected);
            seedDb.Customers.Add(customer);
            seedDb.WhatsAppSettings.Add(settings);
            seedDb.WhatsAppMessages.Add(new WhatsAppMessage(
                tenant.Id, branch.Id, null, customer.Id, WhatsAppMessageDirection.Outbound,
                CustomerPhone, "KVKK consent request", WhatsAppMessageStatus.Sent,
                templateName: "kvkk-consent", providerMessageId: "outbound-concurrent-seed"));
            await seedDb.SaveChangesAsync();
        }

        var notifications = Substitute.For<IAppNotificationService>();
        await using var firstDb = database.NewContext();
        await using var secondDb = database.NewContext();
        var firstService = NewService(firstDb, notifications);
        var secondService = NewService(secondDb, notifications);
        var payload = Payload("wamid.concurrent-replay");
        var signature = Signature(payload);
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = Task.Run(async () => { await start.Task; await firstService.HandleInboundAsync(payload, signature); });
        var second = Task.Run(async () => { await start.Task; await secondService.HandleInboundAsync(payload, signature); });
        start.SetResult();
        await Task.WhenAll(first, second);

        await using var assertDb = database.NewContext();
        Assert.Equal(1, await assertDb.WhatsAppMessages.IgnoreQueryFilters().CountAsync(x =>
            x.Direction == WhatsAppMessageDirection.Inbound &&
            x.ProviderChannelId == PhoneNumberId &&
            x.ProviderMessageId == "wamid.concurrent-replay"));
        Assert.True((await assertDb.Customers.IgnoreQueryFilters().SingleAsync(x => x.Id == customerId)).KvkkConsent);
        Assert.Equal(1, await assertDb.WhatsAppMessages.IgnoreQueryFilters().CountAsync(x =>
            x.Direction == WhatsAppMessageDirection.Outbound && x.TemplateName == "kvkk-thanks"));
    }
}
