using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Api.Endpoints;

public static class WhatsAppEndpoints
{
    public static IEndpointRouteBuilder MapWhatsAppEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/whatsapp").WithTags("WhatsApp").RequireAuthorization();

        group.MapGet("/settings", async (Guid? tenantId, ICurrentUser currentUser, IWhatsAppService service, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetSettingsAsync(tid, ct)).ToHttpResult(http);
        });

        group.MapPut("/settings", async (SaveWhatsAppSettingsRequest request, Guid? tenantId, ICurrentUser currentUser, IWhatsAppService service, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SaveSettingsAsync(tid, request, ct)).ToHttpResult(http);
        });

        group.MapGet("/messages", async (Guid? appointmentId, Guid? tenantId, ICurrentUser currentUser, IWhatsAppService service, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RecentMessagesAsync(tid, appointmentId, ct)).ToHttpResult(http);
        });

        group.MapPost("/reminder/{appointmentId:guid}", async (Guid appointmentId, Guid? tenantId, ICurrentUser currentUser, IWhatsAppService service, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SendReminderAsync(tid, appointmentId, ct)).ToHttpResult(http);
        });

        // --- Webhook (anonim; Meta çağırır, /api/admin dışında → onay kapısı/auth uygulanmaz) ---
        var hook = app.MapGroup("/api/whatsapp").WithTags("WhatsApp");

        hook.MapGet("/webhook", async (HttpContext http, IWhatsAppService service, CancellationToken ct) =>
        {
            var mode = http.Request.Query["hub.mode"].ToString();
            var token = http.Request.Query["hub.verify_token"].ToString();
            var challenge = http.Request.Query["hub.challenge"].ToString();
            var result = await service.VerifyWebhookAsync(mode, token, challenge, ct);
            return result is null ? Results.StatusCode(403) : Results.Text(result);
        }).AllowAnonymous();

        hook.MapPost("/webhook", async (HttpContext http, IWhatsAppService service, CancellationToken ct) =>
        {
            using var reader = new StreamReader(http.Request.Body);
            var body = await reader.ReadToEndAsync(ct);
            await service.HandleInboundAsync(body, ct);
            return Results.Ok(); // Meta'ya her zaman 200 dönmeli (yoksa yeniden dener)
        }).AllowAnonymous();

        return app;
    }
}
