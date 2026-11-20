using System.Text.Json;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services.Assistant;
using GuzellikMerkezi.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Platform Maydi istatistikleri: yalnız platform yöneticisi; sayılar doğru; kişi ve konuşma içeriği yok —
/// cevaplanamayan sorulardan yalnız en az iki farklı kurumda sorulanlar (sayı gizli) görünür.
/// </summary>
public sealed class AssistantStatsServiceTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private sealed class NoAi : IAssistantHelpMatcher
    {
        public bool IsEnabled => false;
        public int DailyLimit => 30;
        public Task<string?> PickArticleAsync(string maskedQuestion, IReadOnlyList<(string Id, string Title)> articles, CancellationToken cancellationToken) => Task.FromResult<string?>(null);
    }

    private static async Task<GuzellikDbContext> SeedAsync()
    {
        var db = new GuzellikDbContext(new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options,
            new TestTenantContext(isPlatformAdmin: true));
        var (userA, userA2, userB) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var convA = new AssistantConversation { TenantId = TenantA, UserId = userA, Portal = AssistantPortals.Owner };
        var convA2 = new AssistantConversation { TenantId = TenantA, UserId = userA2, Portal = AssistantPortals.Staff };
        var convB = new AssistantConversation { TenantId = TenantB, UserId = userB, Portal = AssistantPortals.Owner };
        db.AssistantConversations.AddRange(convA, convA2, convB);

        void Ask(AssistantConversation c, string text, string outcome, AssistantIntent intent, short? feedback = null, string matchedBy = "")
        {
            db.AssistantMessages.Add(new AssistantMessage { TenantId = c.TenantId, ConversationId = c.Id, UserId = c.UserId, Sender = "user", Text = text, Outcome = outcome, Intent = intent, MatchedBy = matchedBy });
            db.AssistantMessages.Add(new AssistantMessage { TenantId = c.TenantId, ConversationId = c.Id, UserId = c.UserId, Sender = "assistant", Text = "cevap", Outcome = outcome, Intent = intent, Feedback = feedback, DurationMs = 100, MatchedBy = matchedBy });
        }
        Ask(convA, "bugün kaç randevu var", "answered", AssistantIntent.AppointmentsToday, 1);
        Ask(convA, "merhaba", "small_talk", AssistantIntent.Greeting);
        Ask(convA2, "kasa nasıl kapatılır", "how_to", AssistantIntent.HowTo, -1, "rule");
        // Ortak soru: iki kurumda; telefon numarası gizlenmeli.
        Ask(convA, "fatura 0532 123 45 67 nasıl yazdırılır", "not_found", AssistantIntent.Unknown);
        Ask(convB, "Fatura 0532 123 45 67 nasıl yazdırılır", "not_found", AssistantIntent.Unknown);
        // Kuruma özgü soru (müşteri adı içeriyor): yalnız bir kurumda → listelenmemeli.
        Ask(convB, "Ayşe Yılmaz neden gelmedi", "not_found", AssistantIntent.Unknown);
        db.LlmUsageRecords.Add(new LlmUsageRecord { TenantId = TenantA, Feature = "assistant.help", Succeeded = true, PromptTokens = 120, CompletionTokens = 4, DurationMs = 800 });
        db.LlmUsageRecords.Add(new LlmUsageRecord { TenantId = TenantB, Feature = "assistant.help", Succeeded = false, Error = "http_429", DurationMs = 200 });
        await db.SaveChangesAsync();
        return db;
    }

    [Fact]
    public async Task OnlyPlatformAdmin()
    {
        await using var db = await SeedAsync();
        var result = await new AssistantStatsService(db, new TestCurrentUser(UserRole.InstitutionOwner, TenantA), new NoAi()).GetPlatformStatsAsync(30, default);
        Assert.Equal("Forbidden", result.Error.Code);
    }

    [Fact]
    public async Task Counts_AreCorrect_AndNoPersonalContentLeaks()
    {
        await using var db = await SeedAsync();
        var stats = (await new AssistantStatsService(db, new TestCurrentUser(UserRole.PlatformAdmin), new NoAi()).GetPlatformStatsAsync(30, default)).Value!;

        Assert.Equal(6, stats.Totals.Questions);
        Assert.Equal(3, stats.Totals.NotFound);
        Assert.Equal(3, stats.Totals.ActiveUsers);
        Assert.Equal(2, stats.Totals.ActiveTenants);
        Assert.Equal(1, stats.Totals.FeedbackUp);
        Assert.Equal(1, stats.Totals.FeedbackDown);
        // Sohbet orana katılmaz: 5 cevaplanabilir sorudan 2'si cevaplandı.
        Assert.Equal(40.0, stats.Totals.AnswerRate);
        Assert.Contains(stats.ByPortal, x => x.Key == AssistantPortals.Staff && x.Count == 1);
        Assert.Equal([new AssistantStatsCountDto("rule", 1)], stats.HelpMatchedBy);

        var common = Assert.Single(stats.CommonUnanswered);
        Assert.Equal(2, common.Tenants);
        Assert.DoesNotContain("0532", common.Question);
        Assert.Contains("[sayı]", common.Question);

        var tenantA = stats.Tenants.Single(x => x.TenantId == TenantA);
        Assert.Equal(4, tenantA.Questions);
        Assert.Equal(2, tenantA.ActiveUsers);

        Assert.Equal(2, stats.Llm.Calls);
        Assert.Equal(1, stats.Llm.Failed);
        Assert.Equal([new AssistantStatsCountDto("http_429", 1)], stats.Llm.Errors);

        // Cevapta kullanıcı kimliği ve kuruma özgü soru metni hiçbir yerde yok.
        var json = JsonSerializer.Serialize(stats);
        Assert.DoesNotContain("Ayşe", json);
        Assert.DoesNotContain("userId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("bugün kaç randevu", json);
    }
}
