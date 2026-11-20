using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Assistant;

/// <summary>
/// Platform yöneticisi için Maydi özet ve istatistikleri. KİŞİ ve KONUŞMA İÇERİĞİ DÖNMEZ: kullanıcı adı/kimliği yok,
/// sohbet metni yok. Tek istisna "ortak cevaplanamayan sorular": yalnız EN AZ İKİ FARKLI kurumda sorulmuş (yani
/// kuruma/kişiye özgü olmayan) sorular, sayı/e-posta gizlenerek listelenir — katalogda hangi makalenin eksik
/// olduğunu görmek için.
/// </summary>
public interface IAssistantStatsService
{
    Task<Result<AssistantPlatformStatsDto>> GetPlatformStatsAsync(int days, CancellationToken cancellationToken);
}

public sealed record AssistantPlatformStatsDto(
    int Days,
    DateTime FromUtc,
    AssistantStatsTotalsDto Totals,
    IReadOnlyList<AssistantStatsCountDto> ByPortal,
    IReadOnlyList<AssistantStatsCountDto> ByOutcome,
    IReadOnlyList<AssistantStatsCountDto> ByIntent,
    IReadOnlyList<AssistantStatsCountDto> HelpMatchedBy,
    IReadOnlyList<AssistantStatsDayDto> Daily,
    IReadOnlyList<AssistantStatsTenantDto> Tenants,
    IReadOnlyList<AssistantStatsQuestionDto> CommonUnanswered,
    AssistantStatsLlmDto Llm);

/// <param name="Questions">Kullanıcı mesajı sayısı.</param>
/// <param name="Answered">Cevaplanan (veri, nasıl yapılır, sohbet, başka portal yönlendirmesi).</param>
/// <param name="AnswerRate">Cevaplanan / (soru − sohbet) — sohbet mesajları orana katılmaz.</param>
public sealed record AssistantStatsTotalsDto(
    int Questions,
    int Answered,
    int NotFound,
    int Denied,
    int AdviceRefused,
    int Errors,
    double AnswerRate,
    int ActiveUsers,
    int ActiveTenants,
    int Conversations,
    int FeedbackUp,
    int FeedbackDown,
    int AverageResponseMs);

public sealed record AssistantStatsCountDto(string Key, int Count);

public sealed record AssistantStatsDayDto(DateOnly Date, int Questions, int NotFound);

/// <param name="TenantName">Kurum adı (kişi değil).</param>
public sealed record AssistantStatsTenantDto(
    Guid TenantId,
    string TenantName,
    int Questions,
    int NotFound,
    int ActiveUsers,
    int FeedbackUp,
    int FeedbackDown,
    DateTime LastActivityUtc);

/// <param name="Tenants">Bu soruyu soran farklı kurum sayısı (en az 2).</param>
public sealed record AssistantStatsQuestionDto(string Question, int Count, int Tenants);

/// <param name="Configured">Yapay zekâ sağlayıcısı (anahtar) tanımlı mı.</param>
public sealed record AssistantStatsLlmDto(
    bool Configured,
    int Calls,
    int Failed,
    long PromptTokens,
    long CompletionTokens,
    int AverageDurationMs,
    IReadOnlyList<AssistantStatsCountDto> Errors);
