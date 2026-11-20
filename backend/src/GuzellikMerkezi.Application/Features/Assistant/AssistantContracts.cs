using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Assistant;

/// <summary>
/// Maydi asistanı. Kişi her zaman oturumdan (rol, kurum, şube, personel izni) belirlenir; istemciden gelen
/// bağlam yalnız ekran ipucu, dil ve mağaza sürümü bilgisidir — yetki genişletmez.
/// </summary>
public interface IAssistantService
{
    Task<Result<AssistantStatusDto>> GetStatusAsync(CancellationToken cancellationToken);
    Task<Result<AssistantBriefingDto>> GetBriefingAsync(AssistantClientContext context, CancellationToken cancellationToken);
    Task<Result<IReadOnlyList<AssistantSuggestionDto>>> GetSuggestionsAsync(AssistantClientContext context, CancellationToken cancellationToken);
    Task<Result<AssistantReplyDto>> SendAsync(AssistantSendRequest request, CancellationToken cancellationToken);
    Task<Result<IReadOnlyList<AssistantConversationDto>>> GetConversationsAsync(CancellationToken cancellationToken);
    Task<Result<IReadOnlyList<AssistantMessageDto>>> GetMessagesAsync(Guid conversationId, CancellationToken cancellationToken);
    Task<Result> DeleteConversationAsync(Guid conversationId, CancellationToken cancellationToken);
    Task<Result> SetFeedbackAsync(Guid messageId, bool helpful, CancellationToken cancellationToken);
    /// <summary>"Maydi Soruları": cevaplanamayan sorular — yalnız kurum sahibi (tüm kurum) ve şube yöneticisi (kendi şubesi).</summary>
    Task<Result<IReadOnlyList<AssistantUnansweredDto>>> GetUnansweredAsync(int days, CancellationToken cancellationToken);
}

/// <param name="Route">Kullanıcının o an baktığı sayfa (ör. /panel/kasa) — öneri sırası için ipucu.</param>
/// <param name="StoreBuild">App Store / Mac App Store istemcisi: satın alma yüzeyleri gösterilmez (3.1.1).</param>
/// <param name="English">Cevap dili.</param>
/// <param name="AllowAi">Kullanıcı yapay zekâ (bulut) onayını verdi mi. false: soru buluta HİÇ gönderilmez; Maydi kural
/// motoru ve anahtar kelimeyle cevaplar (App Store 5.1.2(i) — üçüncü taraf yapay zekâya veri paylaşımı açık onay ister).</param>
public sealed record AssistantClientContext(string? Route = null, bool StoreBuild = false, bool English = false, bool AllowAi = true);

public sealed record AssistantSendRequest(Guid? ConversationId, string Message, Guid? ClientMessageId, AssistantClientContext? Context);

public sealed record AssistantActionDto(string Type, string Label, string? Route);

/// <param name="Kind">text, how_to, data, quick_actions.</param>
/// <param name="Outcome">answered, how_to, other_portal, not_found, denied, advice_refused, small_talk.</param>
/// <param name="Data">Karta özel veri (makale adımları, liste satırları); türü Kind'e göre.</param>
public sealed record AssistantReplyDto(
    Guid ConversationId,
    Guid MessageId,
    string Kind,
    string Text,
    string Intent,
    string Outcome,
    object? Data,
    IReadOnlyList<AssistantActionDto> Actions,
    IReadOnlyList<string> Suggestions);

/// <param name="FeatureAllowed">Kurumun paketinde "ai.assistant" var mı (yoksa istemci girişi göstermez).</param>
/// <param name="AiEnabled">Yapay zekâ ile makale seçimi açık mı (anahtar yoksa kural + anahtar kelimeyle çalışır).</param>
public sealed record AssistantStatusDto(
    bool Enabled,
    bool FeatureAllowed,
    bool AiEnabled,
    string Portal,
    string Name,
    int DailyLimit,
    string PrivacyNoteTr,
    string PrivacyNoteEn);

public sealed record AssistantBriefingDto(string Greeting, IReadOnlyList<string> Lines, IReadOnlyList<string> Suggestions);

public sealed record AssistantSuggestionDto(string Text, string Intent);

public sealed record AssistantConversationDto(Guid Id, string Title, string Portal, DateTime CreatedAtUtc, DateTime LastMessageAtUtc);

public sealed record AssistantMessageDto(
    Guid Id,
    string Sender,
    string Text,
    string Kind,
    string Intent,
    string Outcome,
    string PayloadJson,
    short? Feedback,
    DateTime CreatedAtUtc);

/// <param name="Question">Kullanıcının sorduğu metin (kurumun kendi veritabanından; buluta gönderilmez).</param>
/// <param name="Count">Aynı (katlanmış) sorunun kaç kez sorulduğu.</param>
public sealed record AssistantUnansweredDto(string Question, string Portal, int Count, DateTime LastAskedAtUtc);
