using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Platform yöneticisinin Maydi özeti. Yalnız sayı ve kurum adı döner; kullanıcı ve konuşma içeriği dönmez
/// (bkz. <see cref="IAssistantStatsService"/>). Satırlar dönem başına sınırlı sayıda çekilip bellekte toplanır:
/// kurum adları şifreli kolon olduğundan SQL'de gruplanamaz ve MySql.EntityFrameworkCore yerel koleksiyonlu
/// sorguları çeviremez.
/// </summary>
public sealed class AssistantStatsService(GuzellikDbContext db, ICurrentUser currentUser, IAssistantHelpMatcher matcher) : IAssistantStatsService
{
    /// <summary>Bellekte toplanacak en fazla mesaj (koruma sınırı; aşılırsa en yeni satırlar sayılır).</summary>
    private const int MaxRows = 200_000;

    /// <summary>"Ortak" sayılmak için sorunun sorulduğu en az farklı kurum sayısı.</summary>
    private const int MinTenantsForCommonQuestion = 2;

    private static readonly HashSet<string> AnsweredOutcomes = ["answered", "how_to", "small_talk", "other_portal"];

    public async Task<Result<AssistantPlatformStatsDto>> GetPlatformStatsAsync(int days, CancellationToken cancellationToken)
    {
        if (!currentUser.IsPlatformAdmin) return Result<AssistantPlatformStatsDto>.Failure(Error.Forbidden("Bu ekran yalnız platform yöneticisine açıktır."));
        days = Math.Clamp(days, 1, 365);
        var from = DateTime.UtcNow.Date.AddDays(-(days - 1)).AddHours(-3);

        var messages = await db.AssistantMessages.AsNoTracking().IgnoreQueryFilters()
            .Where(x => x.CreatedAtUtc >= from)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new Row(x.TenantId, x.UserId, x.ConversationId, x.Sender, x.Intent, x.Outcome, x.MatchedBy, x.Feedback, x.DurationMs, x.Text, x.CreatedAtUtc))
            .Take(MaxRows)
            .ToListAsync(cancellationToken);
        var conversationPortals = await db.AssistantConversations.AsNoTracking().IgnoreQueryFilters()
            .Where(x => x.LastMessageAtUtc >= from)
            .Select(x => new { x.Id, x.Portal })
            .ToListAsync(cancellationToken);
        var portalOf = conversationPortals.ToDictionary(x => x.Id, x => x.Portal);

        var questions = messages.Where(x => x.Sender == "user").ToList();
        var replies = messages.Where(x => x.Sender == "assistant").ToList();
        var smallTalk = questions.Count(x => x.Outcome == "small_talk");
        var answered = questions.Count(x => AnsweredOutcomes.Contains(x.Outcome));
        var answerable = questions.Count - smallTalk;

        var totals = new AssistantStatsTotalsDto(
            questions.Count,
            answered,
            questions.Count(x => x.Outcome == "not_found"),
            questions.Count(x => x.Outcome == "denied"),
            questions.Count(x => x.Outcome == "advice_refused"),
            questions.Count(x => x.Outcome == "error"),
            answerable == 0 ? 0 : Math.Round(100.0 * (answered - smallTalk) / answerable, 1),
            questions.Select(x => x.UserId).Distinct().Count(),
            questions.Select(x => x.TenantId).Distinct().Count(),
            questions.Select(x => x.ConversationId).Distinct().Count(),
            replies.Count(x => x.Feedback == 1),
            replies.Count(x => x.Feedback == -1),
            replies.Count == 0 ? 0 : (int)replies.Average(x => x.DurationMs));

        static IReadOnlyList<AssistantStatsCountDto> Count<T>(IEnumerable<T> source, Func<T, string> key) =>
            source.GroupBy(key).Select(g => new AssistantStatsCountDto(g.Key, g.Count())).OrderByDescending(x => x.Count).ToList();

        var byPortal = Count(questions, x => portalOf.GetValueOrDefault(x.ConversationId, "?"));
        var byOutcome = Count(questions, x => x.Outcome);
        var byIntent = Count(questions.Where(x => x.Outcome != "small_talk"), x => x.Intent.ToString());
        var matchedBy = Count(questions.Where(x => x.Outcome is "how_to" or "other_portal" && x.MatchedBy.Length > 0), x => x.MatchedBy);

        var daily = Enumerable.Range(0, days)
            .Select(offset => DateOnly.FromDateTime(from.AddHours(3).AddDays(offset)))
            .Select(day => new AssistantStatsDayDto(day,
                questions.Count(x => DateOnly.FromDateTime(x.CreatedAtUtc.AddHours(3)) == day),
                questions.Count(x => x.Outcome == "not_found" && DateOnly.FromDateTime(x.CreatedAtUtc.AddHours(3)) == day)))
            .ToList();

        // Kurum adları: şifreli kolon, bellekte çözülür (yalnız soru gelen kurumlar).
        var tenantIds = questions.Select(x => x.TenantId).ToHashSet();
        var tenantNames = (await db.Tenants.AsNoTracking().IgnoreQueryFilters().Select(x => new { x.Id, x.Name }).ToListAsync(cancellationToken))
            .Where(x => tenantIds.Contains(x.Id))
            .ToDictionary(x => x.Id, x => x.Name);
        var feedbackByTenant = replies.Where(x => x.Feedback != null).GroupBy(x => x.TenantId)
            .ToDictionary(g => g.Key, g => (Up: g.Count(x => x.Feedback == 1), Down: g.Count(x => x.Feedback == -1)));
        var tenants = questions.GroupBy(x => x.TenantId)
            .Select(g => new AssistantStatsTenantDto(
                g.Key,
                tenantNames.GetValueOrDefault(g.Key, "—"),
                g.Count(),
                g.Count(x => x.Outcome == "not_found"),
                g.Select(x => x.UserId).Distinct().Count(),
                feedbackByTenant.GetValueOrDefault(g.Key).Up,
                feedbackByTenant.GetValueOrDefault(g.Key).Down,
                g.Max(x => x.CreatedAtUtc)))
            .OrderByDescending(x => x.Questions)
            .Take(100)
            .ToList();

        // Ortak cevaplanamayan sorular: en az iki FARKLI kurumda sorulmuş; sayı/e-posta gizli. Kuruma özgü
        // (bir müşteri adı içeren vb.) sorular bu eşiği geçemez.
        var common = questions.Where(x => x.Outcome == "not_found")
            .GroupBy(x => AssistantText.Fold(x.Text))
            .Select(g => new { Text = g.First().Text, Count = g.Count(), Tenants = g.Select(x => x.TenantId).Distinct().Count() })
            .Where(x => x.Tenants >= MinTenantsForCommonQuestion)
            .OrderByDescending(x => x.Tenants).ThenByDescending(x => x.Count)
            .Take(50)
            .Select(x => new AssistantStatsQuestionDto(AssistantPrivacy.Mask(x.Text, new HashSet<string>()), x.Count, x.Tenants))
            .ToList();

        var usage = await db.LlmUsageRecords.AsNoTracking().IgnoreQueryFilters()
            .Where(x => x.CreatedAtUtc >= from)
            .Select(x => new { x.Succeeded, x.PromptTokens, x.CompletionTokens, x.DurationMs, x.Error })
            .Take(MaxRows)
            .ToListAsync(cancellationToken);
        var llm = new AssistantStatsLlmDto(
            matcher.IsEnabled,
            usage.Count,
            usage.Count(x => !x.Succeeded),
            usage.Sum(x => (long)x.PromptTokens),
            usage.Sum(x => (long)x.CompletionTokens),
            usage.Count == 0 ? 0 : (int)usage.Average(x => x.DurationMs),
            Count(usage.Where(x => !x.Succeeded && x.Error.Length > 0), x => x.Error));

        return Result<AssistantPlatformStatsDto>.Success(new AssistantPlatformStatsDto(
            days, from, totals, byPortal, byOutcome, byIntent, matchedBy, daily, tenants, common, llm));
    }

    private sealed record Row(
        Guid TenantId, Guid UserId, Guid ConversationId, string Sender, AssistantIntent Intent, string Outcome,
        string MatchedBy, short? Feedback, int DurationMs, string Text, DateTime CreatedAtUtc);
}
