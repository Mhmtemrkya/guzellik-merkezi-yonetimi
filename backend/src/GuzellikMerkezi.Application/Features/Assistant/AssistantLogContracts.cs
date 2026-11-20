using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Assistant;

/// <summary>
/// Platform yöneticisi için Maydi sohbet kayıtları (güvenlik kaydı): hangi kurumda, hangi kullanıcı, ne zaman, ne
/// konuştu. Kullanıcı kimliği AÇIK gösterilir. Her liste ve sohbet açılışı GEREKÇE ister ve erişim izine
/// (assistant_access_logs) yazılır; kuruma bildirim gitmez. Kayıtlar saklama süresi (varsayılan 90 gün) kadar tutulur.
/// </summary>
public interface IAssistantLogService
{
    Task<Result<AssistantLogPageDto>> ListAsync(AssistantLogQuery query, CancellationToken cancellationToken);
    Task<Result<AssistantLogConversationDto>> GetConversationAsync(Guid conversationId, AssistantLogAccess access, CancellationToken cancellationToken);
    Task<Result<IReadOnlyList<AssistantAccessLogDto>>> GetAccessLogAsync(int days, CancellationToken cancellationToken);
}

/// <summary>Erişim gerekçesi — izin verilen değerler <see cref="Reasons"/>.</summary>
public sealed record AssistantLogAccess(string Reason, string? Note)
{
    public static readonly IReadOnlyList<string> Reasons = ["security", "support", "complaint", "quality"];
}

/// <param name="Outcome">not_found, denied, advice_refused, error … ya da boş (hepsi).</param>
/// <param name="NegativeOnly">Yalnız 👎 alan cevabı olan sohbetler.</param>
/// <param name="Search">Kullanıcı e-postasında arama (tam ya da kısmi).</param>
public sealed record AssistantLogQuery(
    AssistantLogAccess Access,
    Guid? TenantId = null,
    int Days = 7,
    string? Outcome = null,
    bool NegativeOnly = false,
    string? Search = null,
    int Page = 1,
    int PageSize = 50);

public sealed record AssistantLogUserDto(Guid UserId, string? FullName, string Email, string Role);

public sealed record AssistantLogRowDto(
    Guid ConversationId,
    Guid TenantId,
    string TenantName,
    string? BranchName,
    AssistantLogUserDto? User,
    string Portal,
    string Title,
    int Questions,
    int NotFound,
    int Negative,
    DateTime StartedAtUtc,
    DateTime LastMessageAtUtc);

public sealed record AssistantLogPageDto(int Page, int PageSize, int Total, int RetentionDays, IReadOnlyList<AssistantLogRowDto> Items);

public sealed record AssistantLogMessageDto(
    Guid Id,
    string Sender,
    string Text,
    string Kind,
    string Intent,
    string Outcome,
    string MatchedBy,
    string? ArticleId,
    short? Feedback,
    int DurationMs,
    DateTime CreatedAtUtc);

public sealed record AssistantLogConversationDto(AssistantLogRowDto Conversation, IReadOnlyList<AssistantLogMessageDto> Messages);

public sealed record AssistantAccessLogDto(
    DateTime AtUtc,
    string PlatformUser,
    string Action,
    string Reason,
    string? Note,
    string? TenantName,
    Guid? ConversationId,
    string? Filter);
