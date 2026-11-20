using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services.Assistant;
using GuzellikMerkezi.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi sohbet kayıtları: 90 gün saklama, kullanıcı verisinin silinmesi; platform kayıt ekranında gerekçe zorunluluğu,
/// önce-iz kuralı, kimliğin açık gösterilmesi ve yalnız platform yöneticisi erişimi.
/// </summary>
public sealed class AssistantLogAndRetentionTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly IConfiguration Config = new ConfigurationBuilder().Build();

    private static GuzellikDbContext Db(string name) =>
        new(new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(name).Options, new TestTenantContext(isPlatformAdmin: true));

    private static (AssistantConversation Conversation, Guid UserId) AddConversation(GuzellikDbContext db, DateTime at, string question, string outcome = "answered", short? feedback = null, Guid? userId = null)
    {
        var user = userId ?? Guid.NewGuid();
        var conversation = new AssistantConversation { TenantId = Tenant, UserId = user, Portal = AssistantPortals.Customer, Title = question, CreatedAtUtc = at, LastMessageAtUtc = at };
        db.AssistantConversations.Add(conversation);
        db.AssistantMessages.Add(new AssistantMessage { TenantId = Tenant, ConversationId = conversation.Id, UserId = user, Sender = "user", Text = question, Outcome = outcome, CreatedAtUtc = at });
        db.AssistantMessages.Add(new AssistantMessage { TenantId = Tenant, ConversationId = conversation.Id, UserId = user, Sender = "assistant", Text = "cevap", Outcome = outcome, Feedback = feedback, CreatedAtUtc = at });
        return (conversation, user);
    }

    [Fact]
    public async Task Retention_DeletesOnlyOlderThan90Days()
    {
        await using var db = Db(Guid.NewGuid().ToString());
        var now = DateTime.UtcNow;
        AddConversation(db, now.AddDays(-91), "eski soru");
        var (recent, _) = AddConversation(db, now.AddDays(-89), "yeni soru");
        await db.SaveChangesAsync();

        var retention = new AssistantDataRetention(db, Config);
        Assert.Equal(90, retention.RetentionDays);
        Assert.Equal(3, await retention.PurgeExpiredAsync(now, default)); // 2 mesaj + 1 sohbet

        Assert.Equal([recent.Id], await db.AssistantConversations.Select(x => x.Id).ToListAsync());
        Assert.Equal(2, await db.AssistantMessages.CountAsync());
    }

    [Fact]
    public async Task DeleteUserData_RemovesOnlyThatUser()
    {
        await using var db = Db(Guid.NewGuid().ToString());
        var (_, deletedUser) = AddConversation(db, DateTime.UtcNow, "benim sorum");
        AddConversation(db, DateTime.UtcNow, "başkasının sorusu");
        await db.SaveChangesAsync();

        await new AssistantDataRetention(db).DeleteUserDataAsync(Tenant, deletedUser, default);

        Assert.Single(await db.AssistantConversations.ToListAsync());
        Assert.DoesNotContain(await db.AssistantMessages.ToListAsync(), x => x.UserId == deletedUser);
    }

    [Fact]
    public async Task Log_RequiresReason_WritesAccessFirst_ShowsIdentity()
    {
        var name = Guid.NewGuid().ToString();
        await using (var seed = Db(name))
        {
            seed.Customers.Add(CustomerWithId(out var customerId));
            AddConversation(seed, DateTime.UtcNow, "randevumu nasıl ertelerim", "how_to", -1, customerId);
            AddConversation(seed, DateTime.UtcNow.AddMinutes(-5), "merhaba", "small_talk");
            await seed.SaveChangesAsync();
        }

        await using var db = Db(name);
        var admin = new TestCurrentUser(UserRole.PlatformAdmin);
        var service = new AssistantLogService(db, admin, Config);

        // Gerekçesiz: reddedilir ve iz yazılmaz.
        Assert.Equal("Validation", (await service.ListAsync(new AssistantLogQuery(new AssistantLogAccess("", null)), default)).Error.Code);
        Assert.Empty(await db.AssistantAccessLogs.ToListAsync());

        var page = (await service.ListAsync(new AssistantLogQuery(new AssistantLogAccess("security", "rutin kontrol"), NegativeOnly: true), default)).Value!;
        var row = Assert.Single(page.Items);
        Assert.Equal(90, page.RetentionDays);
        Assert.Equal("Zehra Kaya", row.User!.FullName);
        Assert.Equal("zehra@ornek.com", row.User.Email);
        Assert.Equal(1, row.Negative);

        var detail = (await service.GetConversationAsync(row.ConversationId, new AssistantLogAccess("security", null), default)).Value!;
        Assert.Equal(["randevumu nasıl ertelerim", "cevap"], detail.Messages.Select(x => x.Text));

        var log = await db.AssistantAccessLogs.OrderBy(x => x.CreatedAtUtc).ToListAsync();
        Assert.Equal(["list", "view"], log.Select(x => x.Action));
        Assert.All(log, x => Assert.Equal("security", x.Reason));
        Assert.Equal("rutin kontrol", log[0].Note);
        Assert.Equal(row.ConversationId, log[1].ConversationId);
        Assert.Equal(admin.UserId, log[0].PlatformUserId);
        // İz kişisel veri taşımaz: filtre özetinde soru metni ya da e-posta yok.
        Assert.DoesNotContain("zehra", log[0].Filter ?? "");

        Assert.Equal(2, (await service.GetAccessLogAsync(30, default)).Value!.Count);
    }

    [Fact]
    public async Task Log_IsPlatformOnly()
    {
        await using var db = Db(Guid.NewGuid().ToString());
        var service = new AssistantLogService(db, new TestCurrentUser(UserRole.InstitutionOwner, Tenant), Config);
        Assert.Equal("Forbidden", (await service.ListAsync(new AssistantLogQuery(new AssistantLogAccess("security", null)), default)).Error.Code);
        Assert.Equal("Forbidden", (await service.GetAccessLogAsync(30, default)).Error.Code);
    }

    private static Customer CustomerWithId(out Guid id)
    {
        var customer = new Customer(Tenant, Guid.NewGuid(), "Zehra Kaya", "05320000099", "zehra@ornek.com");
        id = customer.Id;
        return customer;
    }
}
