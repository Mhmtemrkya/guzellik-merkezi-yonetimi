using System.Diagnostics;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Maydi'nin cevap akışı (SchoolAsist ile aynı mimari):
/// <list type="number">
/// <item>Kural motoru niyeti bulur. Veri soruları rol/şube/izin/paket kapılarından geçip veritabanından SAYIYLA
/// cevaplanır — yapay zekâ veri uydurmaz, veri cevabı buluta hiç gitmez.</item>
/// <item>"Nasıl yapılır" ve anlaşılmayan sorular yardım kataloğuna gider (önce yapay zekâ seçer, sonra anahtar kelime).</item>
/// <item>İkisi de yoksa Maydi bilmediğini söyler; soru "Maydi Soruları" ekranına düşer.</item>
/// <item>Güzellik/sağlık tavsiyesi verilmez, uzmana yönlendirilir; konu dışı sorular kibarca geri çevrilir.</item>
/// </list>
/// Kapılar: Assistant:Enabled (kapalıysa 404) → rol portalı (platform yöneticisi yok) → paket "ai.assistant" (yoksa 403).
/// </summary>
public sealed partial class AssistantService(
    GuzellikDbContext db,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IFeatureService features,
    IAssistantHelpService help,
    IAssistantHelpMatcher matcher,
    ICashFlowService cashFlow,
    IConfiguration configuration,
    ILogger<AssistantService> logger) : IAssistantService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);

    public const string PrivacyNoteTr =
        "Maydi sorunuzu uygulama hakkında cevaplar. Yardım için yapay zekâya yalnız soru metni gider; müşteri adı, telefon, "
        + "TC ve e-posta gönderilmeden önce gizlenir. Konsültasyon ve sağlık bilgileri hiçbir zaman gönderilmez. "
        + "Randevu, kasa gibi veri cevapları doğrudan sizin kayıtlarınızdan gelir.";
    public const string PrivacyNoteEn =
        "Maydi answers questions about the app. For help, only the question text is sent to the AI; customer names, phone numbers, "
        + "ID numbers and emails are hidden first. Consultation and health information is never sent. "
        + "Data answers such as appointments and cash come straight from your own records.";

    private bool Enabled => configuration.GetValue("Assistant:Enabled", true);

    // ── Kapılar ─────────────────────────────────────────────────────────────

    /// <summary>Başarılıysa kişinin portalı ve paket özellikleri (paket yoksa null = hepsi serbest).</summary>
    private async Task<Result<(string Portal, IReadOnlyCollection<string>? Features)>> GateAsync(CancellationToken ct)
    {
        if (!Enabled) return Result<(string, IReadOnlyCollection<string>?)>.Failure(Error.NotFound("Asistan kapalı."));
        var portal = AssistantPortals.Of(currentUser.Role);
        if (portal is null || currentUser.TenantId is not Guid tenantId || currentUser.UserId is null)
            return Result<(string, IReadOnlyCollection<string>?)>.Failure(Error.Forbidden("Maydi bu hesap türünde kullanılamaz."));
        var active = await ActiveFeaturesAsync(tenantId, ct);
        if (active is not null && !active.Contains(FeatureCatalog.AiAssistant, StringComparer.OrdinalIgnoreCase))
            return Result<(string, IReadOnlyCollection<string>?)>.Failure(Error.Forbidden("Maydi kurumunuzun paketinde açık değil."));
        return Result<(string, IReadOnlyCollection<string>?)>.Success((portal, active));
    }

    private async Task<IReadOnlyCollection<string>?> ActiveFeaturesAsync(Guid tenantId, CancellationToken ct)
    {
        var result = await features.GetTenantFeaturesAsync(tenantId, ct);
        if (result.IsFailure || result.Value is null) return Array.Empty<string>();
        return result.Value.PlanId is null ? null : result.Value.ActiveFeatures;
    }

    private static bool HasAny(IReadOnlyCollection<string>? active, IReadOnlyList<string> keys) =>
        active is null || keys.Count == 0 || keys.Any(key => active.Contains(key, StringComparer.OrdinalIgnoreCase));

    private bool Granted(string portal, string? permission) =>
        portal != AssistantPortals.Staff || permission is null
        || Permissions.IsGrantedTo(currentUser.Role, false, currentUser.Permissions, permission);

    // ── Durum, brifing, öneriler ────────────────────────────────────────────

    public async Task<Result<AssistantStatusDto>> GetStatusAsync(CancellationToken cancellationToken)
    {
        if (!Enabled) return Result<AssistantStatusDto>.Failure(Error.NotFound("Asistan kapalı."));
        var portal = AssistantPortals.Of(currentUser.Role) ?? string.Empty;
        var allowed = portal.Length > 0 && currentUser.TenantId is Guid tenantId
            && (await ActiveFeaturesAsync(tenantId, cancellationToken) is not { } active || active.Contains(FeatureCatalog.AiAssistant, StringComparer.OrdinalIgnoreCase));
        return Result<AssistantStatusDto>.Success(new AssistantStatusDto(
            true, allowed, matcher.IsEnabled, portal, AssistantText.AssistantName, matcher.DailyLimit, PrivacyNoteTr, PrivacyNoteEn));
    }

    public async Task<Result<IReadOnlyList<AssistantSuggestionDto>>> GetSuggestionsAsync(AssistantClientContext context, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<IReadOnlyList<AssistantSuggestionDto>>.Failure(gate.Error);
        var (portal, active) = gate.Value;
        return Result<IReadOnlyList<AssistantSuggestionDto>>.Success(SuggestionsFor(portal, active, context)
            .Select(item => new AssistantSuggestionDto(context.English ? item.En : item.Tr, item.Intent.ToString())).ToList());
    }

    /// <summary>Kişinin gerçekten cevap alabileceği örnek sorular; o an bakılan ekranla ilgili olanlar öne alınır.</summary>
    private List<(string Tr, string En, AssistantIntent Intent)> SuggestionsFor(string portal, IReadOnlyCollection<string>? active, AssistantClientContext context)
    {
        var list = AssistantIntentCatalog.Suggestions(portal)
            .Where(item => AssistantIntentCatalog.RuleFor(item.Intent) is not { } rule
                || (HasAny(active, rule.FeatureKeys) && Granted(portal, rule.StaffPermission)))
            .ToList();
        if (context.Route is { Length: > 1 } route)
        {
            list = list
                .OrderByDescending(item => AssistantIntentCatalog.RuleFor(item.Intent)?.Route.GetValueOrDefault(portal) is { } target
                    && route.StartsWith(target, StringComparison.Ordinal))
                .ToList();
        }
        return list;
    }

    public async Task<Result<AssistantBriefingDto>> GetBriefingAsync(AssistantClientContext context, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<AssistantBriefingDto>.Failure(gate.Error);
        var (portal, active) = gate.Value;
        var voice = await VoiceAsync(portal, context.English, cancellationToken);
        var lines = new List<string>();
        try
        {
            lines.AddRange(await BriefingLinesAsync(portal, active, voice, cancellationToken));
        }
        catch (Exception exception)
        {
            // Brifing süs; veri alınamazsa yalnız selam gösterilir.
            logger.LogWarning(exception, "Maydi brifingi hazırlanamadı.");
        }
        var suggestions = SuggestionsFor(portal, active, context).Take(4).Select(item => voice.English ? item.En : item.Tr).ToList();
        return Result<AssistantBriefingDto>.Success(new AssistantBriefingDto(voice.Greeting(LocalNow.Hour) + " " + voice.Intro(), lines, suggestions));
    }

    // ── Mesaj ───────────────────────────────────────────────────────────────

    public async Task<Result<AssistantReplyDto>> SendAsync(AssistantSendRequest request, CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<AssistantReplyDto>.Failure(gate.Error);
        var (portal, active) = gate.Value;
        var context = request.Context ?? new AssistantClientContext();
        var message = (request.Message ?? string.Empty).Trim();
        if (message.Length is < 1 or > 1000) return Result<AssistantReplyDto>.Failure(Error.Validation("Mesaj 1-1000 karakter arasında olmalıdır."));

        var userId = currentUser.UserId!.Value;
        var tenantId = currentUser.TenantId!.Value;

        // Aynı istemci mesajı (ağ tekrarı) iki kez cevaplanmaz: kayıtlı cevap döner.
        if (request.ClientMessageId is Guid clientId)
        {
            var previous = await db.AssistantMessages.AsNoTracking()
                .Where(x => x.UserId == userId && x.ClientMessageId == clientId && x.Sender == "assistant")
                .FirstOrDefaultAsync(cancellationToken);
            if (previous is not null) return Result<AssistantReplyDto>.Success(FromStored(previous));
        }

        AssistantConversation? conversation = null;
        if (request.ConversationId is Guid conversationId)
        {
            conversation = await db.AssistantConversations
                .FirstOrDefaultAsync(x => x.Id == conversationId && x.UserId == userId && !x.IsArchived, cancellationToken);
            if (conversation is null) return Result<AssistantReplyDto>.Failure(Error.NotFound("Sohbet bulunamadı."));
        }
        conversation ??= db.AssistantConversations.Add(new AssistantConversation
        {
            TenantId = tenantId, BranchId = tenantContext.BranchId, UserId = userId, Portal = portal, Title = Title(message),
        }).Entity;

        var voice = await VoiceAsync(portal, context.English, cancellationToken);
        Reply reply;
        try
        {
            reply = await AnswerAsync(message, portal, active, context, voice, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Maydi cevabı hazırlanamadı.");
            reply = new Reply("text", voice.Error(), AssistantIntent.Unknown, "error");
        }

        var now = DateTime.UtcNow;
        conversation.LastMessageAtUtc = now;
        db.AssistantMessages.Add(new AssistantMessage
        {
            TenantId = tenantId, BranchId = tenantContext.BranchId, ConversationId = conversation.Id, UserId = userId, Sender = "user",
            Text = message, Intent = reply.Intent, Outcome = reply.Outcome, MatchedBy = reply.MatchedBy, ArticleId = reply.ArticleId,
            ClientMessageId = request.ClientMessageId, CreatedAtUtc = now,
        });
        var stored = db.AssistantMessages.Add(new AssistantMessage
        {
            TenantId = tenantId, BranchId = tenantContext.BranchId, ConversationId = conversation.Id, UserId = userId, Sender = "assistant",
            Text = reply.Text, Intent = reply.Intent, Outcome = reply.Outcome, MatchedBy = reply.MatchedBy, ArticleId = reply.ArticleId,
            Kind = reply.Kind, PayloadJson = JsonSerializer.Serialize(new StoredPayload(reply.Data, reply.Actions, reply.Suggestions), Json),
            // Cevap sorudan 1 ms sonra: MySQL datetime(6) mikro saniyede yuvarlar; tik farkı kaybolup sıra karışıyordu.
            ClientMessageId = request.ClientMessageId, DurationMs = (int)watch.ElapsedMilliseconds, CreatedAtUtc = now.AddMilliseconds(1),
        }).Entity;
        await db.SaveChangesAsync(cancellationToken);
        return Result<AssistantReplyDto>.Success(ToDto(stored, conversation.Id, reply));
    }

    /// <summary>Cevabın kendisi (kalıcılıktan bağımsız) — testlerde ve tekrar cevaplamada aynı yol.</summary>
    internal sealed record Reply(
        string Kind, string Text, AssistantIntent Intent, string Outcome,
        object? Data = null, IReadOnlyList<AssistantActionDto>? ActionList = null, IReadOnlyList<string>? SuggestionList = null,
        string MatchedBy = "", string? ArticleId = null)
    {
        public IReadOnlyList<AssistantActionDto> Actions => ActionList ?? [];
        public IReadOnlyList<string> Suggestions => SuggestionList ?? [];
    }

    private async Task<Reply> AnswerAsync(string message, string portal, IReadOnlyCollection<string>? active, AssistantClientContext context, AssistantVoice voice, CancellationToken ct)
    {
        var parse = AssistantIntentResolver.Resolve(message);
        // Yazım düzeltmesi bir kişi adını anahtar kelimeye çevirdiyse ("Kasım" → "kasa") düzeltme geri alınır.
        if (parse.CorrectedTokens is { Count: > 0 } changed && await PersonWordsAsync(changed, ct) is { Count: > 0 } keep)
            parse = AssistantIntentResolver.Resolve(message, keep);

        List<string> Suggest(int count) => SuggestionsFor(portal, active, context).Take(count).Select(item => voice.English ? item.En : item.Tr).ToList();

        switch (parse.Intent)
        {
            case AssistantIntent.Greeting:
                return new Reply("text", voice.Greeting(LocalNow.Hour) + " " + voice.Intro(), parse.Intent, "small_talk", SuggestionList: Suggest(4));
            case AssistantIntent.Thanks:
                return new Reply("text", voice.Thanks(), parse.Intent, "small_talk", SuggestionList: Suggest(3));
            case AssistantIntent.SmallTalk:
                return new Reply("text", voice.Identity(), parse.Intent, "small_talk", SuggestionList: Suggest(4));
            case AssistantIntent.Help:
                return new Reply("quick_actions", voice.Help(), parse.Intent, "small_talk", SuggestionList: Suggest(8));
            case AssistantIntent.BeautyAdvice:
                return new Reply("text", voice.AdviceRefused(), parse.Intent, "advice_refused", SuggestionList: Suggest(3));
            case AssistantIntent.HowTo:
            case AssistantIntent.Unknown:
                return await HelpAsync(message, parse.Intent, context, voice, Suggest, ct);
        }

        var rule = AssistantIntentCatalog.RuleFor(parse.Intent)!;
        if (!rule.Portals.Contains(portal))
            return new Reply("text", voice.OutOfPortal() + " " + voice.Intro(), parse.Intent, "denied", SuggestionList: Suggest(4));
        if (!HasAny(active, rule.FeatureKeys))
            return new Reply("text", voice.NotInPlan(), parse.Intent, "denied", SuggestionList: Suggest(3));
        if (!Granted(portal, rule.StaffPermission))
            return new Reply("text", voice.NoPermission(), parse.Intent, "denied", SuggestionList: Suggest(3));

        var data = await DataAsync(parse.Intent, parse.Period, portal, voice, ct);
        var actions = rule.Route.TryGetValue(portal, out var route) && !(context.StoreBuild && route.StartsWith("/panel/paket", StringComparison.Ordinal))
            ? new[] { new AssistantActionDto("navigate", voice.OpenPage(), route) }
            : [];
        return new Reply("data", data.Text, parse.Intent, "answered", new { intent = parse.Intent.ToString(), items = data.Items }, actions, Suggest(3));
    }

    private async Task<Reply> HelpAsync(string message, AssistantIntent intent, AssistantClientContext context, AssistantVoice voice,
        Func<int, List<string>> suggest, CancellationToken ct)
    {
        var answer = await help.AnswerAsync(message, new AssistantHelpOptions(context.English, context.StoreBuild, context.AllowAi), ct);
        switch (answer.Outcome)
        {
            case AssistantHelpOutcome.Article when answer.Article is { } article:
                var steps = voice.English ? article.StepsEn : article.StepsTr;
                return new Reply("how_to", voice.HowTo(article), AssistantIntent.HowTo, "how_to",
                    new { id = article.Id, title = voice.English ? article.TitleEn : article.TitleTr, steps, route = answer.Route, matchedBy = answer.MatchedBy },
                    [new AssistantActionDto("navigate", voice.OpenPage(), answer.Route)], suggest(3), answer.MatchedBy, article.Id);
            case AssistantHelpOutcome.OtherPortal when answer.Article is { } other:
                // "Rehber var ama başka portalda" — cevaplanamayanlar listesine düşmez.
                return new Reply("text", voice.OtherPortal(other), AssistantIntent.HowTo, "other_portal",
                    new { otherPortal = true, id = other.Id }, null, suggest(3), answer.MatchedBy, other.Id);
            default:
                return new Reply("text", voice.NotFound(), intent, "not_found", SuggestionList: suggest(4));
        }
    }

    // ── Sohbet geçmişi ──────────────────────────────────────────────────────

    public async Task<Result<IReadOnlyList<AssistantConversationDto>>> GetConversationsAsync(CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<IReadOnlyList<AssistantConversationDto>>.Failure(gate.Error);
        var userId = currentUser.UserId!.Value;
        var rows = await db.AssistantConversations.AsNoTracking()
            .Where(x => x.UserId == userId && !x.IsArchived)
            .OrderByDescending(x => x.LastMessageAtUtc).Take(50)
            .Select(x => new AssistantConversationDto(x.Id, x.Title, x.Portal, x.CreatedAtUtc, x.LastMessageAtUtc))
            .ToListAsync(cancellationToken);
        return Result<IReadOnlyList<AssistantConversationDto>>.Success(rows);
    }

    public async Task<Result<IReadOnlyList<AssistantMessageDto>>> GetMessagesAsync(Guid conversationId, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<IReadOnlyList<AssistantMessageDto>>.Failure(gate.Error);
        var userId = currentUser.UserId!.Value;
        if (!await db.AssistantConversations.AnyAsync(x => x.Id == conversationId && x.UserId == userId && !x.IsArchived, cancellationToken))
            return Result<IReadOnlyList<AssistantMessageDto>>.Failure(Error.NotFound("Sohbet bulunamadı."));
        var rows = await db.AssistantMessages.AsNoTracking()
            .Where(x => x.ConversationId == conversationId && x.UserId == userId)
            // Eski kayıtlarda soru ile cevap aynı zamanda olabilir: eşitlikte soru önce.
            .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Sender == "assistant").Take(200)
            .Select(x => new AssistantMessageDto(x.Id, x.Sender, x.Text, x.Kind, x.Intent.ToString(), x.Outcome, x.PayloadJson, x.Feedback, x.CreatedAtUtc))
            .ToListAsync(cancellationToken);
        return Result<IReadOnlyList<AssistantMessageDto>>.Success(rows);
    }

    public async Task<Result> DeleteConversationAsync(Guid conversationId, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result.Failure(gate.Error);
        var userId = currentUser.UserId!.Value;
        var conversation = await db.AssistantConversations.FirstOrDefaultAsync(x => x.Id == conversationId && x.UserId == userId && !x.IsArchived, cancellationToken);
        if (conversation is null) return Result.Failure(Error.NotFound("Sohbet bulunamadı."));
        conversation.IsArchived = true;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SetFeedbackAsync(Guid messageId, bool helpful, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result.Failure(gate.Error);
        var userId = currentUser.UserId!.Value;
        var row = await db.AssistantMessages.FirstOrDefaultAsync(x => x.Id == messageId && x.UserId == userId && x.Sender == "assistant", cancellationToken);
        if (row is null) return Result.Failure(Error.NotFound("Mesaj bulunamadı."));
        row.Feedback = helpful ? (short)1 : (short)-1;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<AssistantUnansweredDto>>> GetUnansweredAsync(int days, CancellationToken cancellationToken)
    {
        var gate = await GateAsync(cancellationToken);
        if (gate.IsFailure) return Result<IReadOnlyList<AssistantUnansweredDto>>.Failure(gate.Error);
        if (currentUser.Role is not (UserRole.InstitutionOwner or UserRole.BranchManager))
            return Result<IReadOnlyList<AssistantUnansweredDto>>.Failure(Error.Forbidden("Bu liste yalnız yöneticilere açıktır."));
        var since = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 180));
        var tenantId = currentUser.TenantId!.Value;
        var query = db.AssistantMessages.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Sender == "user" && x.Outcome == "not_found" && x.CreatedAtUtc >= since);
        // Şube yöneticisi yalnız kendi şubesinde sorulanları görür.
        if (currentUser.Role == UserRole.BranchManager)
        {
            var branchId = tenantContext.BranchId;
            query = query.Where(x => x.BranchId == branchId);
        }
        // Portal sohbetten join ile gelir: MySql.EntityFrameworkCore yerel kimlik listesiyle Contains'i çeviremiyor.
        var rows = await (from message in query
                          join conversation in db.AssistantConversations.AsNoTracking() on message.ConversationId equals conversation.Id
                          orderby message.CreatedAtUtc descending
                          select new { message.Text, message.CreatedAtUtc, conversation.Portal })
            .Take(1000).ToListAsync(cancellationToken);
        var grouped = rows
            .GroupBy(x => AssistantText.Fold(x.Text))
            .Select(g => new AssistantUnansweredDto(g.First().Text, g.First().Portal, g.Count(), g.Max(x => x.CreatedAtUtc)))
            .OrderByDescending(x => x.Count).ThenByDescending(x => x.LastAskedAtUtc)
            .Take(200).ToList();
        return Result<IReadOnlyList<AssistantUnansweredDto>>.Success(grouped);
    }

    // ── Yardımcılar ─────────────────────────────────────────────────────────

    private static DateTime LocalNow => DateTime.UtcNow + TurkeyOffset;

    /// <summary>Türkiye gününün başlangıcı (UTC).</summary>
    private static DateTime DayStartUtc(DateTime localDay) => localDay.Date - TurkeyOffset;

    private async Task<AssistantVoice> VoiceAsync(string portal, bool english, CancellationToken ct)
    {
        string? fullName = null;
        var userId = currentUser.UserId;
        if (portal == AssistantPortals.Customer && currentUser.CustomerId is Guid customerId)
            fullName = await db.Customers.AsNoTracking().Where(x => x.Id == customerId).Select(x => x.FullName).FirstOrDefaultAsync(ct);
        else if (userId is not null)
            fullName = await db.TenantUsers.AsNoTracking().Where(x => x.Id == userId).Select(x => x.FullName).FirstOrDefaultAsync(ct);
        var first = fullName?.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return new AssistantVoice(portal, english, first);
    }

    /// <summary>Kişi adları (personel/kullanıcı) arasında geçen kelimeler — yazım düzeltmesi bunlara dokunmaz.</summary>
    private async Task<IReadOnlySet<string>> PersonWordsAsync(IReadOnlyList<string> tokens, CancellationToken ct)
    {
        var names = await db.StaffMembers.AsNoTracking().Select(x => x.FullName).ToListAsync(ct);
        var words = names.SelectMany(name => AssistantText.Fold(name).Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToHashSet(StringComparer.Ordinal);
        return tokens.Where(words.Contains).ToHashSet(StringComparer.Ordinal);
    }

    private static string Title(string message)
    {
        var clean = string.Join(' ', message.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return clean.Length <= 60 ? clean : clean[..57] + "…";
    }

    private sealed record StoredPayload(object? Data, IReadOnlyList<AssistantActionDto> Actions, IReadOnlyList<string> Suggestions);

    private static AssistantReplyDto ToDto(AssistantMessage stored, Guid conversationId, Reply reply) =>
        new(conversationId, stored.Id, reply.Kind, reply.Text, reply.Intent.ToString(), reply.Outcome, reply.Data, reply.Actions, reply.Suggestions);

    private static AssistantReplyDto FromStored(AssistantMessage stored)
    {
        var payload = JsonSerializer.Deserialize<JsonElement>(stored.PayloadJson);
        var actions = payload.TryGetProperty("actions", out var a) ? a.Deserialize<List<AssistantActionDto>>(Json) ?? [] : [];
        var suggestions = payload.TryGetProperty("suggestions", out var s) ? s.Deserialize<List<string>>(Json) ?? [] : [];
        object? data = payload.TryGetProperty("data", out var d) && d.ValueKind != JsonValueKind.Null ? d : null;
        return new AssistantReplyDto(stored.ConversationId, stored.Id, stored.Kind, stored.Text, stored.Intent.ToString(), stored.Outcome, data, actions, suggestions);
    }
}
