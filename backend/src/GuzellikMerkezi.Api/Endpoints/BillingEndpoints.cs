using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class BillingEndpoints
{
    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        // Kurumun abonelik/ödeme uçları. ABONELİK KARARI KURUM YETKİLİSİNİNDİR: personel ve şube
        // yöneticisi kart ekleyemez, paket değiştiremez, fatura göremez (finansal veri).
        var group = app.MapGroup("/api/admin/billing").WithTags("Billing").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, ICurrentUser cu, IBillingService svc, HttpContext http, CancellationToken ct) =>
        {
            if (Forbidden(cu, http) is { } denied) return denied;
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.GetSummaryAsync(t, ct)).ToHttpResult(http);
        });

        group.MapGet("/invoices", async (Guid? tenantId, ICurrentUser cu, IBillingService svc, HttpContext http, CancellationToken ct) =>
        {
            if (Forbidden(cu, http) is { } denied) return denied;
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.ListInvoicesAsync(t, ct)).ToHttpResult(http);
        });

        group.MapPost("/checkout", async (StartCheckoutPayload payload, Guid? tenantId, ICurrentUser cu, IBillingService svc, HttpContext http, CancellationToken ct) =>
        {
            if (Forbidden(cu, http) is { } denied) return denied;
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            // Dönüş adresi İSTEKTEN kurulur: ters proxy başlıkları uygulandığı için şema/host
            // burada doğrudur (ForwardedHeaders yapılandırılmış durumda).
            var callbackUrl = $"{http.Request.Scheme}://{http.Request.Host}/api/payments/callback";
            return (await svc.StartCheckoutAsync(t, payload.SubscriptionPlanId, ParsePeriod(payload.BillingPeriod), callbackUrl, ct)).ToHttpResult(http);
        });

        group.MapDelete("/card", async (Guid? tenantId, ICurrentUser cu, IBillingService svc, HttpContext http, CancellationToken ct) =>
        {
            if (Forbidden(cu, http) is { } denied) return denied;
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.RemoveCardAsync(t, ct)).ToHttpResult(http);
        });

        // --- Sağlayıcı dönüşü (public) ---
        // Kimlik doğrulaması YOK: bu isteği kullanıcının tarayıcısı ya da sağlayıcı yapar, oturum
        // taşımaz. Güvenlik, tahmin edilemez form anahtarının sağlayıcıya SORULARAK doğrulanmasına
        // dayanır — anahtarı uyduran biri "başarılı ödeme" ürettiremez.
        var callback = app.MapGroup("/api/payments").WithTags("Payments").AllowAnonymous();

        callback.MapPost("/callback", (HttpContext http, IBillingService svc, IPaymentGatewayResolver resolver, CancellationToken ct) =>
            HandleCallbackAsync(http, svc, resolver, ct));

        // Simülasyon sağlayıcısı ve yönlendirme tabanlı akışlar GET ile döner.
        callback.MapGet("/callback", (HttpContext http, IBillingService svc, IPaymentGatewayResolver resolver, CancellationToken ct) =>
            HandleCallbackAsync(http, svc, resolver, ct));

        return app;
    }

    private static async Task<IResult> HandleCallbackAsync(
        HttpContext http, IBillingService svc, IPaymentGatewayResolver resolver, CancellationToken ct)
    {
        string? token = null;
        if (http.Request.HasFormContentType)
        {
            var form = await http.Request.ReadFormAsync(ct);
            token = form["token"].ToString();
        }
        if (string.IsNullOrWhiteSpace(token)) token = http.Request.Query["token"].ToString();

        var result = await svc.CompleteCheckoutAsync(token ?? string.Empty, ct);
        var succeeded = result.IsSuccess && result.Value!.Succeeded;
        var message = result.IsSuccess ? result.Value!.Message : result.Error.Message;

        // Kullanıcıyı panele geri gönder. Dönüş adresi tanımlı değilse (ör. yerel geliştirme)
        // JSON döndür — sessizce boş sayfa göstermek hatayı gizlerdi.
        var context = await resolver.ResolveAsync(ct);
        var returnUrl = context.IsSuccess ? context.Value!.ReturnUrl : null;
        if (string.IsNullOrWhiteSpace(returnUrl))
        {
            return Results.Json(ApiResponse<object>.Ok(new { succeeded, message }, http.TraceIdentifier));
        }

        var separator = returnUrl!.Contains('?') ? '&' : '?';
        var target = $"{returnUrl}{separator}payment={(succeeded ? "success" : "failed")}" +
                     $"&message={Uri.EscapeDataString(message ?? string.Empty)}";
        return Results.Redirect(target);
    }

    /// <summary>Abonelik/ödeme yalnızca kurum yetkilisinde (ve platform yöneticisinde).</summary>
    private static IResult? Forbidden(ICurrentUser cu, HttpContext http) =>
        cu.IsPlatformAdmin || cu.Role == UserRole.InstitutionOwner
            ? null
            : Results.Json(
                ApiResponse<object>.Fail("Forbidden", "Abonelik ve ödeme işlemleri yalnızca kurum yetkilisinde.", http.TraceIdentifier),
                statusCode: StatusCodes.Status403Forbidden);

    private static BillingPeriod ParsePeriod(string? value)
        => string.Equals(value?.Trim(), "Yearly", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value?.Trim(), "Yıllık", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value?.Trim(), "Yillik", StringComparison.OrdinalIgnoreCase)
            ? BillingPeriod.Yearly
            : BillingPeriod.Monthly;

    public sealed record StartCheckoutPayload(Guid SubscriptionPlanId, string? BillingPeriod = null);
}
