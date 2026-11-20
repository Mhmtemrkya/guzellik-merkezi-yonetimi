using System.Text.Json.Nodes;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
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
/// Maydi yardım akışı: yapay zekâya maskeli soru ve yalnız görülebilen makaleler gider, kapalı/hiçbiri/sınır
/// dolu durumda anahtar kelimeye düşülür, yazım düzeltmesi son çaredir, rol/paket/izin/mağaza kapıları uygulanır.
/// </summary>
public sealed class AssistantHelpServiceTests : IDisposable
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid Branch = Guid.NewGuid();
    private readonly DbContextOptions<GuzellikDbContext> options =
        new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
    private readonly ISearchIndexService searchIndex = TestSearchIndex.Create();
    private readonly GuzellikDbContext db;

    public AssistantHelpServiceTests()
    {
        db = new GuzellikDbContext(options, new TestTenantContext(Tenant, Branch), new TestCurrentUser(UserRole.InstitutionOwner, Tenant), null, null, searchIndex);
        db.Customers.Add(new Customer(Tenant, Branch, "Ayşe Yılmaz", "05321234567"));
        db.Customers.Add(new Customer(Tenant, Branch, "Mustafa Kaya", "05329876543"));
        db.StaffMembers.Add(new StaffMember(Tenant, Branch, "Zeynep Arslan", "Estetisyen"));
        // Arama (blind) indeksi yalnız SaveChangesAsync'te üretilir (bkz. GuzellikDbContext.ApplySearchIndex).
        db.SaveChangesAsync().GetAwaiter().GetResult();
    }

    public void Dispose() => db.Dispose();

    private sealed class FakeMatcher(string? pick, bool enabled = true, int limit = 30) : IAssistantHelpMatcher
    {
        public List<(string Question, IReadOnlyList<(string Id, string Title)> Articles)> Calls { get; } = [];
        public bool IsEnabled => enabled;
        public int DailyLimit => limit;
        public Task<string?> PickArticleAsync(string maskedQuestion, IReadOnlyList<(string Id, string Title)> articles, CancellationToken cancellationToken)
        {
            Calls.Add((maskedQuestion, articles));
            return Task.FromResult(pick);
        }
    }

    /// <summary>features null = paket yok (hepsi serbest).</summary>
    private sealed class FakeFeatures(IReadOnlyCollection<string>? features) : IFeatureService
    {
        public Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => Task.FromResult(features?.Contains(featureKey) ?? true);
        public Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => HasFeatureAsync(tenantId, featureKey, ct);
        public Task<Result<TenantFeaturesDto>> GetTenantFeaturesAsync(Guid tenantId, CancellationToken ct = default) =>
            Task.FromResult(Result<TenantFeaturesDto>.Success(new TenantFeaturesDto(tenantId, features is null ? null : Guid.NewGuid(), "x", "x", features ?? [])));
        public FeatureCatalogDto GetCatalog() => new(Array.Empty<FeatureCatalogItem>());
        public void InvalidateTenant(Guid tenantId) { }
    }

    private AssistantHelpService Service(FakeMatcher matcher, ICurrentUser? user = null, IReadOnlyCollection<string>? features = null) =>
        new(db, user ?? new TestCurrentUser(UserRole.InstitutionOwner, Tenant), new FakeFeatures(features), searchIndex, matcher);

    [Fact]
    public async Task Ai_GetsMaskedQuestion_AndOnlyVisibleArticles()
    {
        var matcher = new FakeMatcher("appointment-create");
        var answer = await Service(matcher).AnswerAsync("Maydi, Ayşe Yılmaz'a 0532 123 45 67 numarasından nasıl randevu açarım? Zeynep yapsın", new(), CancellationToken.None);

        Assert.Equal(AssistantHelpOutcome.Article, answer.Outcome);
        Assert.Equal("appointment-create", answer.Article!.Id);
        Assert.Equal("ai", answer.MatchedBy);
        Assert.Equal("/panel/randevular", answer.Route);

        var (question, offered) = Assert.Single(matcher.Calls);
        Assert.Equal("[ad] [ad] [sayı] numarasından nasıl randevu açarım? [ad] yapsın", question);
        Assert.DoesNotContain("Ayşe", question);
        Assert.DoesNotContain("Maydi", question);
        // Kurum sahibine müşteri portalı makalesi sunulmaz.
        Assert.DoesNotContain(offered, item => item.Id == "customer-book");
        Assert.Contains(offered, item => item.Id == "subscription");
    }

    [Fact]
    public async Task AppWords_AreNotMaskedAsNames()
    {
        // "Mustafa" bir müşteri; blind index ön-eki "must" "müşteri" ile çakışsa da kelime gizlenmemeli.
        var matcher = new FakeMatcher(null);
        await Service(matcher).AnswerAsync("müşteri kartında seanslar nerede", new(), CancellationToken.None);
        Assert.Equal("müşteri kartında seanslar nerede", Assert.Single(matcher.Calls).Question);
    }

    [Fact]
    public async Task AiSaysNone_FallsBackToKeywords()
    {
        var answer = await Service(new FakeMatcher(null)).AnswerAsync("gün sonu kasa kapanışı nasıl yapılır", new(), CancellationToken.None);
        Assert.Equal("cash-closing", answer.Article!.Id);
        Assert.Equal("rule", answer.MatchedBy);
    }

    [Fact]
    public async Task AiDisabled_IsNeverCalled_AndKeywordsStillWork()
    {
        var matcher = new FakeMatcher("logs", enabled: false);
        var answer = await Service(matcher).AnswerAsync("toplu sms nasıl gönderilir", new(), CancellationToken.None);
        Assert.Empty(matcher.Calls);
        Assert.Equal("bulk-message", answer.Article!.Id);
    }

    [Fact]
    public async Task DailyLimit_StopsAiCalls()
    {
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, Tenant);
        for (var i = 0; i < 2; i++)
            db.LlmUsageRecords.Add(new LlmUsageRecord { TenantId = Tenant, UserId = owner.UserId, Feature = AssistantHelpMatcher.Feature, CreatedAtUtc = DateTime.UtcNow });
        // Dünün kaydı sayılmaz.
        db.LlmUsageRecords.Add(new LlmUsageRecord { TenantId = Tenant, UserId = owner.UserId, Feature = AssistantHelpMatcher.Feature, CreatedAtUtc = DateTime.UtcNow.AddDays(-2) });
        await db.SaveChangesAsync();

        var full = new FakeMatcher("logs", limit: 2);
        await Service(full, owner).AnswerAsync("kim ne yaptı", new(), CancellationToken.None);
        Assert.Empty(full.Calls);

        var room = new FakeMatcher("logs", limit: 3);
        await Service(room, owner).AnswerAsync("kim ne yaptı", new(), CancellationToken.None);
        Assert.Single(room.Calls);
    }

    [Fact]
    public async Task AiPickOutsideVisibleArticles_IsIgnored()
    {
        // Personelin kasa izni yok; yapay zekâ yine de kasa makalesini seçse kabul edilmez.
        var staff = new TestCurrentUser(UserRole.Staff, Tenant, Branch, Permissions.Appointments);
        var answer = await Service(new FakeMatcher("cash-collect"), staff).AnswerAsync("ödeme nasıl alırım", new(), CancellationToken.None);
        Assert.NotEqual("cash-collect", answer.Article?.Id);
    }

    [Fact]
    public async Task Staff_GetsStaffRoutes_AndOtherPortalHintForManagerScreens()
    {
        var staff = new TestCurrentUser(UserRole.Staff, Tenant, Branch, Permissions.Appointments, Permissions.Customers);

        var own = await Service(new FakeMatcher(null), staff).AnswerAsync("yeni randevu nasıl eklenir", new(), CancellationToken.None);
        Assert.Equal("/ekip/randevular", own.Route);

        var other = await Service(new FakeMatcher(null), staff).AnswerAsync("personel nasıl eklenir", new(), CancellationToken.None);
        Assert.Equal(AssistantHelpOutcome.OtherPortal, other.Outcome);
        Assert.Equal("staff-add", other.Article!.Id);
        Assert.Null(other.Route);
    }

    [Fact]
    public async Task PlanWithoutFeature_HidesArticle_EvenForOwner()
    {
        var matcher = new FakeMatcher(null);
        var answer = await Service(matcher, features: [FeatureCatalog.AuditLogs]).AnswerAsync("bekleme listesine nasıl eklerim", new(), CancellationToken.None);

        Assert.Equal(AssistantHelpOutcome.NotFound, answer.Outcome);
        Assert.DoesNotContain(Assert.Single(matcher.Calls).Articles, item => item.Id == "waitlist");
    }

    [Fact]
    public async Task StoreBuild_NeverOffersSubscription()
    {
        var matcher = new FakeMatcher("subscription");
        var answer = await Service(matcher).AnswerAsync("paketimi nereden görürüm", new(StoreBuild: true), CancellationToken.None);

        Assert.DoesNotContain(Assert.Single(matcher.Calls).Articles, item => item.Id == "subscription");
        Assert.NotEqual("subscription", answer.Article?.Id);
    }

    [Fact]
    public async Task Typo_IsRescuedBySpelling()
    {
        var answer = await Service(new FakeMatcher(null, enabled: false)).AnswerAsync("randvu nasıl oluşturulur", new(), CancellationToken.None);
        Assert.Equal("appointment-create", answer.Article!.Id);
        Assert.Equal("rule_spelling", answer.MatchedBy);
    }

    [Fact]
    public async Task Customer_SeesOnlyPortalArticles()
    {
        var customer = new TestCurrentUser(UserRole.Customer, Tenant);
        var matcher = new FakeMatcher(null);
        var answer = await Service(matcher, customer).AnswerAsync("randevumu nasıl ertelerim", new(), CancellationToken.None);

        Assert.Equal("customer-my-appointments", answer.Article!.Id);
        Assert.Equal("/randevu", answer.Route);
        Assert.All(Assert.Single(matcher.Calls).Articles, item => Assert.StartsWith("customer-", item.Id));
    }

    [Fact]
    public async Task PlatformAdmin_HasNoPortal()
    {
        var answer = await Service(new FakeMatcher("logs"), new TestCurrentUser(UserRole.PlatformAdmin)).AnswerAsync("log nerede", new(), CancellationToken.None);
        Assert.Equal(AssistantHelpOutcome.NoPortal, answer.Outcome);
    }

    [Fact]
    public async Task Matcher_LocksAnswerToArticleIds_AndRejectsAdvice()
    {
        var llm = new CapturingLlm("""{"makale":"logs"}""");
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Assistant:Help:Provider"] = "OpenRouter" }).Build();
        var matcher = new AssistantHelpMatcher(llm, config);

        Assert.True(matcher.IsEnabled);
        Assert.Equal(30, matcher.DailyLimit);
        Assert.Equal("logs", await matcher.PickArticleAsync("kim sildi", [("logs", "Log kayıtları"), ("stock", "Stok")], CancellationToken.None));

        var request = Assert.Single(llm.Requests);
        Assert.Equal("assistant.help", request.Feature);
        var schema = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(request.JsonSchema))!;
        Assert.Equal(["logs", "stock", "none"], schema["properties"]!["makale"]!["enum"]!.AsArray().Select(x => (string?)x));
        Assert.Contains("tavsiyesi", request.Messages[0].Text);

        // Liste dışı ya da "none" cevap kabul edilmez.
        Assert.Null(await new AssistantHelpMatcher(new CapturingLlm("""{"makale":"hack"}"""), config).PickArticleAsync("x", [("logs", "Log")], CancellationToken.None));
        Assert.Null(await new AssistantHelpMatcher(new CapturingLlm("""{"makale":"none"}"""), config).PickArticleAsync("x", [("logs", "Log")], CancellationToken.None));
    }

    [Fact]
    public void Matcher_IsOff_WhenAssistantDisabled_OrNoKey()
    {
        var off = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Assistant:Enabled"] = "false" }).Build();
        Assert.False(new AssistantHelpMatcher(new CapturingLlm("{}"), off).IsEnabled);
        Assert.False(new AssistantHelpMatcher(new CapturingLlm("{}", configured: false), new ConfigurationBuilder().Build()).IsEnabled);
    }

    private sealed class CapturingLlm(string content, bool configured = true) : ILlmClient
    {
        public List<LlmRequest> Requests { get; } = [];
        public bool IsConfigured(string provider) => configured;
        public string ModelFor(string provider, bool vision = false) => "m";
        public Task<LlmResult> CompleteAsync(LlmRequest request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(new LlmResult { Succeeded = true, Content = content, FinishReason = "stop" });
        }
    }
}
