using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.Assistant;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Maydi asistanı. /api/admin altında DEĞİL: personel mesajı onay kapısına (StaffApprovalGate) takılmaz — Maydi
/// hiçbir kaydı değiştirmez, yalnız okur. Kişi, rol, kurum, şube ve izin daima oturumdan gelir; istemcinin
/// gönderdiği bağlam (ekran, dil, mağaza sürümü) yetki genişletmez. Kapılar serviste: Assistant:Enabled (404),
/// rol portalı (platform yöneticisi yok, 403), paket "ai.assistant" (403).
/// </summary>
public static class AssistantEndpoints
{
    public static IEndpointRouteBuilder MapAssistantEndpoints(this IEndpointRouteBuilder app)
    {
        // İşletme paneli (sahip, şube yöneticisi, personel).
        Map(app.MapGroup("/api/assistant").WithTags("Assistant").RequireAuthorization(), managers: true);
        // Müşteri portalı: CustomerScopeMiddleware müşteri token'ını yalnız /api/customer altına bırakır; o kapı
        // gevşetilmez, Maydi müşteriye burada açılır. Aynı servis — portal rolden belirlenir.
        Map(app.MapGroup("/api/customer/assistant").WithTags("Assistant").RequireAuthorization(), managers: false);

        // Platform yöneticisi: Maydi özet ve istatistik (kişi ve konuşma içeriği yok).
        var platform = app.MapGroup("/api/platform/assistant").WithTags("Platform Assistant").RequireAuthorization("PlatformAdmin");
        platform.MapGet("/stats", async (int? days, IAssistantStatsService service, HttpContext http, CancellationToken ct) =>
            (await service.GetPlatformStatsAsync(days ?? 30, ct)).ToHttpResult(http));

        // Sohbet kayıtları (güvenlik kaydı): her çağrı gerekçe ister ve erişim izine yazılır.
        platform.MapGet("/conversations", async (string? reason, string? note, Guid? tenantId, int? days, string? outcome, bool? negative, string? search, int? page,
                IAssistantLogService service, HttpContext http, CancellationToken ct) =>
            (await service.ListAsync(new AssistantLogQuery(new AssistantLogAccess(reason ?? string.Empty, note), tenantId, days ?? 7, outcome,
                negative == true, search, page ?? 1), ct)).ToHttpResult(http));
        platform.MapGet("/conversations/{conversationId:guid}", async (Guid conversationId, string? reason, string? note,
                IAssistantLogService service, HttpContext http, CancellationToken ct) =>
            (await service.GetConversationAsync(conversationId, new AssistantLogAccess(reason ?? string.Empty, note), ct)).ToHttpResult(http));
        platform.MapGet("/access-log", async (int? days, IAssistantLogService service, HttpContext http, CancellationToken ct) =>
            (await service.GetAccessLogAsync(days ?? 30, ct)).ToHttpResult(http));
        return app;
    }

    private static void Map(RouteGroupBuilder group, bool managers)
    {

        group.MapGet("/status", async (IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetStatusAsync(ct)).ToHttpResult(http));

        group.MapGet("/briefing", async (string? route, bool? store, string? lang, bool? ai, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetBriefingAsync(Context(route, store, lang, ai), ct)).ToHttpResult(http));

        group.MapGet("/suggestions", async (string? route, bool? store, string? lang, bool? ai, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetSuggestionsAsync(Context(route, store, lang, ai), ct)).ToHttpResult(http));

        group.MapPost("/messages", async (AssistantSendRequest request, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.SendAsync(request, ct)).ToHttpResult(http))
            .RequireRateLimiting("assistant");

        group.MapGet("/conversations", async (IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetConversationsAsync(ct)).ToHttpResult(http));

        group.MapGet("/conversations/{conversationId:guid}/messages", async (Guid conversationId, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.GetMessagesAsync(conversationId, ct)).ToHttpResult(http));

        group.MapDelete("/conversations/{conversationId:guid}", async (Guid conversationId, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.DeleteConversationAsync(conversationId, ct)).ToHttpResult(http));

        group.MapPost("/messages/{messageId:guid}/feedback", async (Guid messageId, AssistantFeedbackRequest request, IAssistantService service, HttpContext http, CancellationToken ct) =>
            (await service.SetFeedbackAsync(messageId, request.Helpful, ct)).ToHttpResult(http));

        // "Maydi Soruları": cevaplanamayan sorular — rol kontrolü serviste (kurum sahibi tüm kurum, şube yöneticisi kendi şubesi).
        if (managers)
        {
            group.MapGet("/unanswered", async (int? days, IAssistantService service, HttpContext http, CancellationToken ct) =>
                (await service.GetUnansweredAsync(days ?? 30, ct)).ToHttpResult(http));
        }
    }

    private static AssistantClientContext Context(string? route, bool? store, string? lang, bool? ai) =>
        new(route is { Length: <= 200 } ? route : null, store == true, string.Equals(lang, "en", StringComparison.OrdinalIgnoreCase), ai != false);
}

public sealed record AssistantFeedbackRequest(bool Helpful);
