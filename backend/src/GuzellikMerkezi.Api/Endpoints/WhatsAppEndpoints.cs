using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Api.Endpoints;

public static class WhatsAppEndpoints
{
    public static IEndpointRouteBuilder MapWhatsAppEndpoints(this IEndpointRouteBuilder app)
    {
        // GÜVENLİK: mesaj geçmişi müşteri iletişimi içerir; hatırlatma/kontör işlemleri para harcar.
        var group = app.MapGroup("/api/admin/whatsapp").WithTags("WhatsApp")
            .RequireAuthorization().RequirePermission(Permissions.Notifications);

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

        // HEDİYE KARTI GÖNDERİMİ. Kart PDF'i istemcide üretilir (canvas → PDF); sunucu kartın
        // gerçekten bu kuruma ait ve geçerli olduğunu doğrular, sonra gönderimi kendi
        // kontör/kuyruk protokolünden geçirir (bkz. WhatsAppService.SendGiftCardAsync).
        group.MapPost("/gift-card", async (SendGiftCardRequest request, Guid? tenantId, ICurrentUser currentUser, IWhatsAppService service, HttpContext http, CancellationToken ct) =>
        {
            // BİLEŞİK YETKİ: grup zaten Notifications istiyor; hediye kartı MÜŞTERİYE AİT bir
            // değer belgesi olduğu için ayrıca GiftCards izni de aranır. Yalnız "bildirim
            // gönderebilen" bir personel, hediye kartı belgesi dağıtabilir olmamalı.
            if (!currentUser.IsAllowed(Permissions.GiftCards))
                return Results.Json(
                    ApiResponse<object>.Fail("Forbidden", "Hediye kartı gönderimi için hediye çeki yetkisi gerekir.", http.TraceIdentifier),
                    statusCode: StatusCodes.Status403Forbidden);

            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SendGiftCardAsync(tid, request, ct)).ToHttpResult(http);
        });

        // --- Kontör cüzdanı (kurum yöneticisi): bakiye, kullanım, ek kontör satın alma ---
        group.MapGet("/wallet", async (Guid? tenantId, ICurrentUser currentUser, IWhatsAppBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await billing.GetWalletAsync(tid, ct)).ToHttpResult(http);
        });

        group.MapGet("/wallet/transactions", async (Guid? tenantId, int? take, ICurrentUser currentUser, IWhatsAppBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await billing.GetTransactionsAsync(tid, take ?? 50, ct)).ToHttpResult(http);
        });

        // Kontör satın alma TALEBİ oluşturur (platform onayına düşer; bakiye onaysız artmaz).
        group.MapPost("/wallet/topup", async (TopUpRequest request, Guid? tenantId, ICurrentUser currentUser, IWhatsAppBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await billing.RequestPurchaseAsync(tid, request, currentUser.UserId, ct)).ToHttpResult(http);
        });

        group.MapGet("/wallet/purchases", async (Guid? tenantId, int? take, ICurrentUser currentUser, IWhatsAppBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await billing.GetTenantPurchasesAsync(tid, take ?? 20, ct)).ToHttpResult(http);
        });

        // KARTLA KONTÖR ALMA: ödeme formunu başlatır. Bakiye BURADA artmaz — yalnız sağlayıcı
        // dönüşü doğrulandığında artar (bkz. /api/payments/credit-callback).
        group.MapPost("/wallet/checkout", async (TopUpRequest request, Guid? tenantId, ICurrentUser currentUser, IWhatsAppBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (tid == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var callbackUrl = $"{http.Request.Scheme}://{http.Request.Host}/api/payments/credit-callback";
            return (await billing.StartCreditCheckoutAsync(tid, request, callbackUrl, currentUser.UserId, ct)).ToHttpResult(http);
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

        // Anonim uç: gövde SINIRSIZ okunmamalı. Meta payload'ları birkaç KB'tır; 256 KB fazlasıyla
        // yeter ve tek istekle bellek tüketmeyi engeller.
        const int MaxWebhookBodyBytes = 256 * 1024;

        hook.MapPost("/webhook", async (HttpContext http, IWhatsAppService service, CancellationToken ct) =>
        {
            // Content-Length beyanı varsa erken reddet; yoksa okurken kes.
            if (http.Request.ContentLength is > MaxWebhookBodyBytes) return Results.StatusCode(413);

            using var limited = new MemoryStream();
            var buffer = new byte[8 * 1024];
            int read;
            while ((read = await http.Request.Body.ReadAsync(buffer, ct)) > 0)
            {
                if (limited.Length + read > MaxWebhookBodyBytes) return Results.StatusCode(413);
                limited.Write(buffer, 0, read);
            }

            var body = System.Text.Encoding.UTF8.GetString(limited.ToArray());
            // GÜVENLİK: imza servis içinde app secret ile doğrulanır (fail-closed); geçersizse gövde işlenmez.
            var signature = http.Request.Headers["X-Hub-Signature-256"].FirstOrDefault();
            await service.HandleInboundAsync(body, signature, ct);
            return Results.Ok(); // Meta'ya her zaman 200 dönmeli (yoksa yeniden dener)
        }).AllowAnonymous();

        return app;
    }
}
