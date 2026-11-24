using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Yardım akışı (SchoolAsist Maydi ile aynı sıra):
/// <list type="number">
/// <item>Yapay zekâ açıksa, sınır dolmadıysa: soru MASKELENİR, yalnız kişinin görebildiği makaleler sunulur.
/// Ölçümde yapay zekâ anahtar kelimeden çok daha isabetliydi ve anahtar kelimenin yanlış yakaladığı sorular
/// yapay zekâya hiç ulaşmıyordu; bu yüzden ÖNCE yapay zekâ.</item>
/// <item>"Hiçbiri" / kapalı / sınır dolu / ulaşılamadı → anahtar kelime eşleşmesi.</item>
/// <item>O da tutmazsa yazım düzeltmesiyle anahtar kelime (kişi adları korunur).</item>
/// </list>
/// Adımlar her zaman elle yazılmış katalogdan gelir; yapay zekâ yalnız makaleyi seçer.
/// </summary>
public sealed class AssistantHelpService(
    GuzellikDbContext db,
    ICurrentUser currentUser,
    IFeatureService features,
    ISearchIndexService searchIndex,
    IAssistantHelpMatcher matcher) : IAssistantHelpService
{
    /// <summary>Ad doğrulamasında kelime başına bakılan en fazla aday müşteri (blind index ön-eki yaklaşıktır).</summary>
    private const int MaxNameCandidates = 25;

    public async Task<AssistantHelpAnswer> AnswerAsync(string question, AssistantHelpOptions options, CancellationToken cancellationToken)
    {
        var portal = AssistantPortals.Of(currentUser.Role);
        if (portal is null || currentUser.TenantId is not Guid tenantId) return AssistantHelpAnswer.None(string.Empty, AssistantHelpOutcome.NoPortal);

        var query = AssistantText.WithoutName((question ?? string.Empty).Trim());
        if (query.Length == 0) return AssistantHelpAnswer.None(portal);

        var activeFeatures = await ActiveFeaturesAsync(tenantId, cancellationToken);
        var visible = AssistantHelpCatalog.VisibleTo(portal, currentUser.Role, currentUser.Permissions, activeFeatures, options.StoreBuild);
        if (visible.Count == 0) return AssistantHelpAnswer.None(portal);

        IReadOnlySet<string>? nameWords = null;
        if (options.AllowAi && matcher.IsEnabled && await UnderDailyLimitAsync(cancellationToken))
        {
            nameWords = await PersonNameWordsAsync(query, cancellationToken);
            var masked = AssistantPrivacy.Mask(query, nameWords);
            var choices = options.DataChoices ?? [];
            // Yalnız soruya en yakın seçenekler gider (≈25): makale ve veri niyetleri ayrı ayrı sıralanıp birleştirilir.
            var foldedQuery = AssistantText.Fold(query);
            var rankedArticles = AssistantHelpCatalog.RankForPrompt(foldedQuery, visible).Take(MaxPromptArticles);
            var rankedData = RankChoices(foldedQuery, choices).Take(MaxPromptData);
            var list = rankedData.Select(choice => (choice.Id, "VERİ: " + choice.Description))
                .Concat(rankedArticles.Select(item => (item.Id, options.English ? item.TitleEn : item.TitleTr)))
                .ToList();
            var picked = await matcher.PickArticleAsync(masked, list, cancellationToken);
            if (picked is not null && choices.FirstOrDefault(choice => choice.Id == picked) is { } data)
                return new AssistantHelpAnswer(AssistantHelpOutcome.Data, portal, null, "ai", null, data.Intent);
            if (picked is not null && visible.FirstOrDefault(item => item.Id == picked) is { } aiArticle)
                return Found(portal, aiArticle, "ai");
        }

        var folded = AssistantText.Fold(query);
        var (article, otherPortal) = AssistantHelpCatalog.Match(folded, portal, visible);
        var matchedBy = "rule";
        if (article is null)
        {
            nameWords ??= await PersonNameWordsAsync(query, cancellationToken);
            var corrected = AssistantSpelling.Correct(folded, nameWords);
            if (corrected.Changed)
            {
                (article, otherPortal) = AssistantHelpCatalog.Match(corrected.Text, portal, visible);
                matchedBy = "rule_spelling";
            }
        }

        if (article is null) return AssistantHelpAnswer.None(portal);
        return otherPortal
            ? new AssistantHelpAnswer(AssistantHelpOutcome.OtherPortal, portal, article, matchedBy, null)
            : Found(portal, article, matchedBy);
    }

    private const int MaxPromptArticles = 15;
    private const int MaxPromptData = 10;

    /// <summary>Veri niyetlerini tarif kelimelerinin soruyla örtüşmesine göre sıralar (eşitlikte katalog sırası).</summary>
    private static IEnumerable<AssistantDataChoice> RankChoices(string foldedQuery, IReadOnlyList<AssistantDataChoice> choices)
    {
        var words = foldedQuery.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length >= 4).Select(w => w.Length > 5 ? w[..5] : w).ToArray();
        return choices.Select((choice, index) =>
            {
                var bag = AssistantText.Fold(choice.Description).Split([' ', ',', '(', ')', '/', ':', ';'], StringSplitOptions.RemoveEmptyEntries);
                return (choice, index, score: words.Count(w => bag.Any(b => b.StartsWith(w, StringComparison.Ordinal))));
            })
            .OrderByDescending(x => x.score).ThenBy(x => x.index).Select(x => x.choice);
    }

    private static AssistantHelpAnswer Found(string portal, AssistantHelpArticle article, string matchedBy) =>
        new(AssistantHelpOutcome.Article, portal, article, matchedBy, article.Routes[portal]);

    /// <summary>Paket yoksa null (hepsi serbest — IFeatureService.IsFeatureAllowedAsync ile aynı kural).</summary>
    private async Task<IReadOnlyCollection<string>?> ActiveFeaturesAsync(Guid tenantId, CancellationToken ct)
    {
        var result = await features.GetTenantFeaturesAsync(tenantId, ct);
        if (result.IsFailure || result.Value is null) return Array.Empty<string>();
        return result.Value.PlanId is null ? null : result.Value.ActiveFeatures;
    }

    private async Task<bool> UnderDailyLimitAsync(CancellationToken ct)
    {
        if (matcher.DailyLimit <= 0 || currentUser.UserId is not Guid userId) return false;
        // Türkiye günü (UTC+3, yaz saati yok).
        var dayStartUtc = DateTime.UtcNow.AddHours(3).Date.AddHours(-3);
        var used = await db.LlmUsageRecords.AsNoTracking()
            .CountAsync(item => item.UserId == userId && item.Feature == AssistantHelpMatcher.Feature && item.CreatedAtUtc >= dayStartUtc, ct);
        return used < matcher.DailyLimit;
    }

    /// <summary>
    /// Sorudaki kelimelerden kurumdaki bir personelin ya da müşterinin adı olanlar (katlanmış).
    /// Personel az olduğundan adlar çözülüp karşılaştırılır; müşteri adları şifreli olduğundan blind index
    /// yalnız ADAY daraltır (4 harflik ön-ek), kesin eşleşme çözülmüş adla bellekte doğrulanır —
    /// böylece "müşteri" kelimesi "Mustafa" yüzünden gizlenmez.
    /// </summary>
    private async Task<IReadOnlySet<string>> PersonNameWordsAsync(string query, CancellationToken ct)
    {
        var words = AssistantPrivacy.CandidateWords(query);
        var found = new HashSet<string>(StringComparer.Ordinal);
        if (words.Count == 0) return found;

        static IEnumerable<string> NameWords(string? fullName) =>
            AssistantText.Fold(fullName).Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var staffNames = await db.StaffMembers.AsNoTracking().Select(x => x.FullName).ToListAsync(ct);
        var userNames = await db.TenantUsers.AsNoTracking().Where(x => x.FullName != null).Select(x => x.FullName!).ToListAsync(ct);
        var staffWords = staffNames.Concat(userNames).SelectMany(NameWords).ToHashSet(StringComparer.Ordinal);
        foreach (var word in words) if (staffWords.Contains(word)) found.Add(word);

        // Uygulama sözcükleri ("randevu", "müşteri") ad sayılmaz: hem gereksiz sorguyu hem yanlış gizlemeyi önler.
        foreach (var word in words.Where(word => word.Length >= 2 && !found.Contains(word) && !AssistantSpelling.IsVocabularyWord(word)))
        {
            var keys = searchIndex.BuildLookupKeys(word);
            if (keys.Count == 0) continue;
            var candidates = db.Customers.AsNoTracking().Where(x => x.SearchIndex != null);
            foreach (var key in keys) candidates = candidates.Where(x => x.SearchIndex!.Contains(key));
            var names = await candidates.Select(x => x.FullName).Take(MaxNameCandidates).ToListAsync(ct);
            if (names.Any(name => NameWords(name).Contains(word))) found.Add(word);
        }
        return found;
    }
}
