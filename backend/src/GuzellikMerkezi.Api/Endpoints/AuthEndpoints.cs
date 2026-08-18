using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// OTP kod isteği — kimlik alanları + akış (giriş / kayıt) + kodun gideceği kanal.
/// </summary>
/// <remarks>
/// <paramref name="BirthDate"/> KABUL EDİLİR AMA KULLANILMAZ. Doğum tarihi kimlikten çıkarıldı
/// (App Store 5.1.1(v)); alan yalnızca mağazada inceleme bekleyen eski istemciler (1.0/5) hâlâ
/// gönderdiği için duruyor — backend önce yayına alınırsa o sürüm kırılmasın. Kayıt akışında
/// verilirse müşteri profiline yazılır.
/// </remarks>
public sealed record CustomerOtpRequestBody(
    string FullName,
    string Phone,
    DateOnly? BirthDate = null,
    Services.CustomerOtpPurpose Purpose = Services.CustomerOtpPurpose.Login,
    Services.CustomerOtpChannel Channel = Services.CustomerOtpChannel.Auto,
    string? Email = null);

/// <summary>
/// OTP doğrulama isteği — kimlik alanları + gelen 6 haneli kod.
/// Kayıt akışında ayrıca cinsiyet/e-posta/doğum tarihi taşınır (kod doğrulanınca hesap açılır).
/// </summary>
public sealed record CustomerOtpVerifyRequest(
    string FullName,
    string Phone,
    string Code,
    DateOnly? BirthDate = null,
    Services.CustomerOtpPurpose Purpose = Services.CustomerOtpPurpose.Login,
    GuzellikMerkezi.Domain.Enums.Gender Gender = GuzellikMerkezi.Domain.Enums.Gender.Unspecified,
    string? Email = null,
    /// <summary>KVKK aydınlatma metnine açık rıza — kayıt akışında ZORUNLU (bkz. CustomerRegisterRequest).</summary>
    bool KvkkConsent = false);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login-scope", async (LoginScopeRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.GetLoginScopeAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("auth-login");

        group.MapPost("/login", async (LoginRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.LoginAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("auth-login");

        // --- Müşteri portalı kimlik doğrulaması: TEK KAPI = OTP ------------------------------
        // Doğrudan token üreten eski uçlar KAPATILDI. Ad + telefon + doğum tarihi bilinen bir
        // müşterinin hesabı OTP'siz ele geçirilebiliyordu; kayıt ucu ise mevcut müşteriyi yalnız
        // telefon + doğum tarihiyle eşleyip onun adına token veriyordu. 410 Gone: istemci eski
        // sürümdeyse kullanıcıya "güncelleyin" diyebilsin diye sessizce 404 dönülmüyor.
        static IResult OtpRequired() => Results.Json(
            new { success = false, error = new { code = "OtpRequired", message = "Girişte telefon doğrulaması zorunlu. Uygulamayı güncelleyin." } },
            statusCode: StatusCodes.Status410Gone);

        group.MapPost("/customer/login", OtpRequired).RequireRateLimiting("customer-auth");
        group.MapPost("/customer/register", OtpRequired).RequireRateLimiting("customer-auth");

        // Hangi kanallardan kod gönderilebilir? İstemci yalnız çalışan seçenekleri göstersin diye
        // AÇIK bir uç: dönen bilgi platform yapılandırmasıdır, kimlikle ilgisi yoktur (sızıntı değil).
        //
        // KOVA AYRIMI: bu uç giriş ekranı her açıldığında çağrılır. "customer-auth" kovasında
        // (5 dakikada 10 istek) olsaydı, ekranlar arasında gezinen kullanıcı kendi GİRİŞ DENEME
        // bütçesini tüketip 429'a düşerdi. Salt-okunur ve ucuz olduğu için genel gezinme kovası.
        group.MapGet("/customer/otp/channels", async (Services.CustomerOtpService otp, HttpContext http, CancellationToken ct) =>
        {
            var channels = await otp.GetAvailableChannelsAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new
            {
                whatsApp = channels.WhatsApp,
                sms = channels.Sms,
                email = channels.Email,
            }, http.TraceIdentifier));
        }).RequireRateLimiting("public-browse");

        // Adım 1: kimlik eşleşirse (kayıtta her hâlükârda) seçilen kanaldan 6 haneli kod gider.
        // Simülasyon modunda gerçek gönderim yapılmaz; Development'ta kod yanıtta döner.
        group.MapPost("/customer/otp/request", async (CustomerOtpRequestBody request, Services.CustomerOtpService otp, HttpContext http, CancellationToken ct) =>
            (await otp.RequestAsync(
                new CustomerLoginRequest(request.FullName, request.Phone),
                request.Email,
                request.Purpose,
                request.Channel, ct)).ToHttpResult(http)).RequireRateLimiting("customer-auth");

        // Adım 2: kod doğruysa giriş yapılır ya da (kayıt akışında) hesap açılıp giriş yapılır.
        group.MapPost("/customer/otp/verify", async (CustomerOtpVerifyRequest request, Services.CustomerOtpService otp, HttpContext http, CancellationToken ct) =>
        {
            var identity = new CustomerLoginRequest(request.FullName, request.Phone);
            var registration = request.Purpose == Services.CustomerOtpPurpose.Register
                ? new CustomerRegisterRequest(request.FullName, request.Phone, request.BirthDate, request.Gender, request.Email, request.KvkkConsent)
                : null;
            return (await otp.VerifyAsync(identity, request.Code, request.Purpose, registration, ct)).ToHttpResult(http);
        }).RequireRateLimiting("customer-auth");

        group.MapPost("/refresh", async (RefreshTokenRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.RefreshAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/logout", async (RefreshTokenRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.LogoutAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/change-password", async (ChangePasswordRequest request, ICurrentUser currentUser, IAuthService service, HttpContext http, CancellationToken ct) =>
        {
            if (!currentUser.UserId.HasValue) return EndpointHelpers.MissingTenant(http);
            return (await service.ChangePasswordAsync(currentUser.UserId.Value, request, ct)).ToHttpResult(http);
        }).RequireAuthorization();

        group.MapGet("/me", (ICurrentUser currentUser, HttpContext http) => Results.Ok(ApiResponse<object>.Ok(new
        {
            currentUser.UserId,
            currentUser.Email,
            Role = currentUser.Role?.ToString(),
            currentUser.TenantId,
            currentUser.BranchId,
            currentUser.IsPlatformAdmin
        }, http.TraceIdentifier))).RequireAuthorization();

        return app;
    }
}
