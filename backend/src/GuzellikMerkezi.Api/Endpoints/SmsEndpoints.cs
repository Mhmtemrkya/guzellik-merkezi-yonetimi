using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Elle tetiklenen tek yönlü SMS'ler. Otomatik olanlar (puanlama linki, bekleme listesi, KVKK) iş
/// kuyruğundan, kurumun kanal tercihine göre gider; burada yalnız kullanıcının düğmeyle gönderdikleri var.
/// </summary>
public static class SmsEndpoints
{
    public static IEndpointRouteBuilder MapSmsEndpoints(this IEndpointRouteBuilder app)
    {
        // GÜVENLİK: SMS gönderimi kurumun kotasından/mesaj kredisinden harcar — WhatsApp uçlarıyla aynı sayfa izni.
        var group = app.MapGroup("/api/admin/sms").WithTags("SMS")
            .RequireAuthorization().RequirePermission(Permissions.Notifications);

        // HEDİYE ÇEKİ KODU SMS'LE. WhatsApp'taki PDF gönderimiyle aynı doğrulamalar (kart kapsamda ve
        // geçerli; müşteriye bağlıysa yalnız onun numarası) CustomerSmsService'tedir.
        group.MapPost("/gift-card", async (SendGiftCardSmsRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerSmsService service, HttpContext http, CancellationToken ct) =>
        {
            // BİLEŞİK YETKİ (WhatsApp ucuyla aynı gerekçe): hediye çeki müşteriye ait bir değer
            // belgesidir; yalnız "bildirim gönderebilen" personel onu dağıtabilir olmamalı.
            if (!currentUser.IsAllowed(Permissions.GiftCards))
                return Results.Json(
                    ApiResponse<object>.Fail("Forbidden", "Hediye kartı gönderimi için hediye çeki yetkisi gerekir.", http.TraceIdentifier),
                    statusCode: StatusCodes.Status403Forbidden);

            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SendGiftCardAsync(tid, request, ct)).ToHttpResult(http);
        });

        // ---- KURUMUN KENDİ SMS HESABI — kurum yalnız DURUMU görür ----
        //
        // Bağlantıyı BeautyAsist (platform yöneticisi) kurar: /api/platform/whatsapp/sms-connections.
        // Burada yazma ucu YOK — kurum sahibinin API parolası / IP izni / başlık işleriyle uğraşmaması
        // için (WhatsApp bağlantısıyla aynı model). Parola hiç dönmez, kullanıcı adı yalnız son 4 hanesiyle.
        group.MapGet("/connection", async (Guid? tenantId, ICurrentUser currentUser, ITenantSmsConnectionService service, HttpContext http, CancellationToken ct) =>
        {
            var tid = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return tid == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(tid, canManage: false, ct)).ToHttpResult(http);
        });

        return app;
    }
}
