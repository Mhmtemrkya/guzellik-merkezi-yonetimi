using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services.Assistant;
using GuzellikMerkezi.Infrastructure.Services.Llm;
using GuzellikMerkezi.Tests.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit.Abstractions;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi yardım eşleştirmesi ölçümü — TestData/help-eval.json: katalogdaki anahtar kelimeleri bilerek TEKRARLAMAYAN,
/// gerçek kullanıcı ağzıyla yazılmış sorular + konu dışı ve güzellik/sağlık tavsiyesi soruları (beklenen "none").
/// <list type="bullet">
/// <item>Her çalıştırmada: veri seti doğrulanır ve yalnız anahtar kelime skoru raporlanır (taban: %50).</item>
/// <item>Canlı ölçüm (hedef: uygulanan akış %90+):
/// <c>MAYDI_HELP_EVAL=1 MAYDI_LLM_KEY=… dotnet test --filter AssistantHelpEvaluation --logger "console;verbosity=detailed"</c>
/// (sağlayıcı varsayılan OpenRouter; MAYDI_HELP_PROVIDER ile değişir).</item>
/// </list>
/// Not: asistanda veri soruları ve tavsiye soruları kural motorunca önce yakalanır; burada yalnız yardım katmanı ölçülür.
/// </summary>
public sealed class AssistantHelpEvaluation(ITestOutputHelper output)
{
    private sealed record Case(string Portal, string Question, string Expected);

    private static List<Case> Load(string file = "help-eval.json") =>
        JsonSerializer.Deserialize<List<Case>>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", file)),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    private static readonly string[] AllPermissions = Permissions.All.Select(p => p.Key).ToArray();

    private static UserRole RoleOf(string portal) => portal switch
    {
        AssistantPortals.Owner => UserRole.InstitutionOwner,
        AssistantPortals.Branch => UserRole.BranchManager,
        AssistantPortals.Staff => UserRole.Staff,
        _ => UserRole.Customer,
    };

    /// <summary>Tam paket + tüm izinler: ölçüm eşleştirmeyi ölçer, kapıları değil.</summary>
    private static IReadOnlyList<AssistantHelpArticle> Visible(string portal) =>
        AssistantHelpCatalog.VisibleTo(portal, RoleOf(portal), AllPermissions, activeFeatures: null, storeBuild: false);

    private static string Keyword(Case item)
    {
        var folded = AssistantText.Fold(item.Question);
        var visible = Visible(item.Portal);
        var (article, other) = AssistantHelpCatalog.Match(folded, item.Portal, visible);
        if (article is null)
        {
            var corrected = AssistantSpelling.Correct(folded);
            if (corrected.Changed) (article, other) = AssistantHelpCatalog.Match(corrected.Text, item.Portal, visible);
        }
        return article is not null && !other ? article.Id : AssistantHelpMatcher.None;
    }

    [Fact]
    public void Dataset_IsValid_AndCoversEveryPortal()
    {
        var cases = Load();
        Assert.True(cases.Count >= 60, "Ölçüm için en az 60 soru olmalı.");
        Assert.Equal(cases.Count, cases.Select(c => c.Question).Distinct().Count());
        Assert.All(AssistantPortals.All, portal => Assert.Contains(cases, c => c.Portal == portal));
        Assert.Contains(cases, c => c.Expected == AssistantHelpMatcher.None);
        foreach (var item in cases.Where(c => c.Expected != AssistantHelpMatcher.None))
        {
            var article = AssistantHelpCatalog.Articles.SingleOrDefault(a => a.Id == item.Expected);
            Assert.True(article is not null, $"Bilinmeyen makale: {item.Expected}");
            Assert.True(Visible(item.Portal).Any(a => a.Id == item.Expected), $"{item.Expected} {item.Portal} portalında görünmüyor");
        }
    }

    /// <summary>
    /// help-eval.json kataloğun eş anlamlılarını bulmak için KULLANILDI (skoru iyimserdir); help-eval-holdout.json
    /// hiçbir ayara girmedi — gerçek dünyaya yakın sayı odur. İkisi ayrı raporlanır.
    /// </summary>
    [Theory]
    [InlineData("help-eval.json")]
    [InlineData("help-eval-holdout.json")]
    public void KeywordOnly_Baseline(string file)
    {
        var cases = Load(file);
        var ok = 0;
        foreach (var item in cases)
        {
            var keyword = Keyword(item);
            if (keyword == item.Expected) ok++;
            else output.WriteLine($"✗ [{item.Portal}] {item.Question} → {keyword}; beklenen {item.Expected}");
        }
        output.WriteLine($"{file} · yalnız anahtar kelime: {ok}/{cases.Count} (%{100.0 * ok / cases.Count:F0})");
        // Anahtar kelime yalnız yedek yoldur; taban, katalogda sessiz bir bozulmayı yakalamak içindir.
        Assert.True(ok * 2 >= cases.Count, $"Anahtar kelime eşleşmesi %50'nin altına düştü: {ok}/{cases.Count}");
    }

    [Fact]
    public async Task Measure_AiMatching_Live()
    {
        if (Environment.GetEnvironmentVariable("MAYDI_HELP_EVAL") != "1") return;
        var providerName = Environment.GetEnvironmentVariable("MAYDI_HELP_PROVIDER") ?? "OpenRouter";
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"Llm:{providerName}:ApiKey"] = Environment.GetEnvironmentVariable("MAYDI_LLM_KEY"),
            ["Assistant:Help:Provider"] = providerName,
        }).Build();
        var llm = new OpenAiCompatibleLlmClient(new HttpClient(), config, new NoUsageLog(), new TestTenantContext(),
            new TestCurrentUser(role: null) { UserId = null, IsAuthenticated = false }, NullLogger<OpenAiCompatibleLlmClient>.Instance);
        var matcher = new AssistantHelpMatcher(llm, config);
        Assert.True(matcher.IsEnabled, "Sağlayıcı yapılandırılmadı (MAYDI_LLM_KEY?).");

        int keywordOk = 0, aiOk = 0, flowOk = 0;
        var cases = Load();
        var watch = System.Diagnostics.Stopwatch.StartNew();
        foreach (var item in cases)
        {
            var keyword = Keyword(item);
            var offered = Visible(item.Portal).Select(a => (a.Id, a.TitleTr)).ToList();
            var ai = await matcher.PickArticleAsync(AssistantPrivacy.Mask(item.Question, new HashSet<string>()), offered, CancellationToken.None)
                ?? AssistantHelpMatcher.None;
            // Uygulanan akış (AssistantHelpService): önce yapay zekâ; "hiçbiri" derse anahtar kelime.
            var flow = ai != AssistantHelpMatcher.None ? ai : keyword;
            keywordOk += keyword == item.Expected ? 1 : 0;
            aiOk += ai == item.Expected ? 1 : 0;
            flowOk += flow == item.Expected ? 1 : 0;
            if (flow != item.Expected || ai != item.Expected)
                output.WriteLine($"{(flow == item.Expected ? "·" : "✗")} [{item.Portal}] {item.Question} → akış {flow} (anahtar {keyword}, yz {ai}); beklenen {item.Expected}");
        }
        output.WriteLine($"Sağlayıcı: {providerName} · {cases.Count} soru · süre {watch.Elapsed.TotalSeconds:F0} sn");
        output.WriteLine($"Yalnız anahtar kelime:      {keywordOk}/{cases.Count} (%{100.0 * keywordOk / cases.Count:F0})");
        output.WriteLine($"Yalnız yapay zekâ:          {aiOk}/{cases.Count} (%{100.0 * aiOk / cases.Count:F0})");
        output.WriteLine($"Önce yapay zekâ (uygulanan): {flowOk}/{cases.Count} (%{100.0 * flowOk / cases.Count:F0})");
        Assert.True(flowOk * 10 >= cases.Count * 9, $"Hedef %90: {flowOk}/{cases.Count}");
    }

    private sealed class NoUsageLog : ILlmUsageRecorder
    {
        public Task RecordAsync(LlmUsageEntry entry, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
