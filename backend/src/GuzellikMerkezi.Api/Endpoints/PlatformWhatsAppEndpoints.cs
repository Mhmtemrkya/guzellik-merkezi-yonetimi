using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Platform admin: WhatsApp merkezi yönetimi — Meta bağlantıları (kurum başına numara bağlama), kategori
/// fiyatlandırma, kontör paketleri, faturalama ayarları, kurum cüzdanı ve kontör satın alma onay kuyruğu.
/// </summary>
public static class PlatformWhatsAppEndpoints
{
    public static IEndpointRouteBuilder MapPlatformWhatsAppEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/platform/whatsapp").WithTags("Platform WhatsApp").RequireAuthorization("PlatformAdmin");

        // --- Faturalama ayarları (kur, tavan, otomatik onay) ---
        g.MapGet("/billing-settings", async (IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetBillingSettingsAsync(ct)).ToHttpResult(http));
        g.MapPut("/billing-settings", async (SaveBillingSettingsRequest req, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.SaveBillingSettingsAsync(req, ct)).ToHttpResult(http));

        // --- Kategori fiyatlandırma ---
        g.MapGet("/pricing", async (IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetPricingRulesAsync(ct)).ToHttpResult(http));
        g.MapPost("/pricing", async (SavePricingRuleRequest req, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.SavePricingRuleAsync(null, req, ct)).ToHttpResult(http));
        g.MapPut("/pricing/{id:guid}", async (Guid id, SavePricingRuleRequest req, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.SavePricingRuleAsync(id, req, ct)).ToHttpResult(http));
        g.MapDelete("/pricing/{id:guid}", async (Guid id, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.DeletePricingRuleAsync(id, ct)).ToHttpResult(http));

        // --- Kontör paketleri ---
        g.MapGet("/credit-packages", async (bool? includeInactive, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetCreditPackagesAsync(includeInactive ?? true, ct)).ToHttpResult(http));
        g.MapPost("/credit-packages", async (SaveCreditPackageRequest req, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.SaveCreditPackageAsync(null, req, ct)).ToHttpResult(http));
        g.MapPut("/credit-packages/{id:guid}", async (Guid id, SaveCreditPackageRequest req, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.SaveCreditPackageAsync(id, req, ct)).ToHttpResult(http));
        g.MapDelete("/credit-packages/{id:guid}", async (Guid id, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.DeleteCreditPackageAsync(id, ct)).ToHttpResult(http));

        // --- Meta bağlantıları (kurum başına numara) ---
        g.MapGet("/connections", async (IWhatsAppService s, HttpContext http, CancellationToken ct) =>
            (await s.GetConnectionsAsync(ct)).ToHttpResult(http));
        g.MapPost("/connections/{tenantId:guid}", async (Guid tenantId, BindWhatsAppConnectionRequest req, IWhatsAppService s, HttpContext http, CancellationToken ct) =>
            (await s.BindConnectionAsync(tenantId, req, ct)).ToHttpResult(http));
        g.MapPost("/connections/{tenantId:guid}/test", async (Guid tenantId, SendTestMessageRequest req, IWhatsAppService s, HttpContext http, CancellationToken ct) =>
            (await s.SendTestMessageAsync(tenantId, req, ct)).ToHttpResult(http));

        // --- Kurum cüzdanı yönetimi ---
        g.MapGet("/wallets/{tenantId:guid}", async (Guid tenantId, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetWalletAsync(tenantId, ct)).ToHttpResult(http));
        g.MapGet("/wallets/{tenantId:guid}/transactions", async (Guid tenantId, int? take, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetTransactionsAsync(tenantId, take ?? 100, ct)).ToHttpResult(http));
        g.MapPost("/wallets/{tenantId:guid}/adjust", async (Guid tenantId, AdjustWalletRequest req, ICurrentUser u, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.AdjustWalletAsync(tenantId, req, u.UserId, ct)).ToHttpResult(http));

        // --- Kontör satın alma onay kuyruğu ---
        g.MapGet("/purchases", async (bool? pending, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.GetPurchasesAsync(pending ?? false, ct)).ToHttpResult(http));
        g.MapPost("/purchases/{id:guid}/approve", async (Guid id, ICurrentUser u, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.ApprovePurchaseAsync(id, u.UserId, ct)).ToHttpResult(http));
        g.MapPost("/purchases/{id:guid}/reject", async (Guid id, RejectPurchaseRequest req, ICurrentUser u, IWhatsAppBillingService b, HttpContext http, CancellationToken ct) =>
            (await b.RejectPurchaseAsync(id, u.UserId, req.Note, ct)).ToHttpResult(http));

        return app;
    }
}
