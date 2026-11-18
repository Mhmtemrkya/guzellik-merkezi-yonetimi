using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.TenantSignup;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// SELF-SERVİS KURUM KAYDI uçları — anonim, IP bazlı hız sınırlı.
///
/// <para>
/// Akış üç adımdır (bkz. <see cref="ITenantSignupService"/>): bilgiler + e-posta kodu →
/// e-posta doğrulama + telefon kodu → telefon doğrulama + KURUM OLUŞUR.
/// </para>
///
/// <para>
/// <b>Neden kendi hız sınırı kovası var?</b> Bu uçlar e-posta ve SMS gönderiyor — yani her istek
/// PARA harcıyor. "customer-auth" kovasına eklemek, müşteri girişiyle bütçeyi paylaştırıp iki
/// akışın birbirini kilitlemesine yol açardı.
/// </para>
/// </summary>
public static class TenantSignupEndpoints
{
    /// <summary>Kurum kaydının yeni adresi (Maydanoz'daki BeautyAsist başvurusu).</summary>
    public const string PublicSignupMovedTo = "https://maydanozasist.com/kayit/beauty";

    public static IEndpointRouteBuilder MapTenantSignupEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/public/signup")
            .WithTags("TenantSignup")
            .RequireRateLimiting("tenant-signup")
            .AddEndpointFilter(async (context, next) =>
            {
                // KAYIT MAYDANOZ'A TAŞINDI (18 Kas 2026): kurum maydanozasist.com/kayit/beauty'de belgeleriyle
                // başvurur, hesap Maydanoz onayıyla açılır. Onaysız kurum açan bu yol varsayılan olarak KAPALI.
                var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
                return config.GetValue("TenantSignup:PublicEnabled", false)
                    ? await next(context)
                    : Results.Json(new
                    {
                        success = false,
                        error = new { code = "signup.moved", message = "Kayıt maydanozasist.com üzerinden yapılıyor." },
                        movedTo = PublicSignupMovedTo,
                    }, statusCode: StatusCodes.Status410Gone);
            });

        // Kayıt alınabilir mi? (E-posta + telefon kanalı kurulu mu?) Dönen bilgi platform
        // yapılandırmasıdır; kimlikle ilgisi yoktur. Form gösterilmeden önce sorulur ki kullanıcı
        // 3 adım doldurup son adımda duvara çarpmasın.
        group.MapGet("/readiness", async (ITenantSignupService service, HttpContext http, CancellationToken ct) =>
            (await service.GetReadinessAsync(ct)).ToHttpResult(http))
            .RequireRateLimiting("public-browse");

        group.MapPost("/start", async (TenantSignupStartRequest request, ITenantSignupService service, HttpContext http, CancellationToken ct) =>
            (await service.StartAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/verify-email", async (TenantSignupVerifyEmailRequest request, ITenantSignupService service, HttpContext http, CancellationToken ct) =>
            (await service.VerifyEmailAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/verify-phone", async (TenantSignupVerifyPhoneRequest request, ITenantSignupService service, HttpContext http, CancellationToken ct) =>
            (await service.VerifyPhoneAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/resend", async (TenantSignupResendRequest request, ITenantSignupService service, HttpContext http, CancellationToken ct) =>
            (await service.ResendAsync(request.SignupId, ct)).ToHttpResult(http));

        return app;
    }
}

public sealed record TenantSignupResendRequest(string SignupId);
