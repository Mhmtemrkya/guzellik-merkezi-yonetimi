using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>OTP doğrulama isteği — kimlik alanları + SMS'teki 6 haneli kod.</summary>
public sealed record CustomerOtpVerifyRequest(string FullName, string Phone, DateOnly BirthDate, string Code);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login-scope", async (LoginScopeRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.GetLoginScopeAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("auth-login");

        group.MapPost("/login", async (LoginRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.LoginAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("auth-login");

        // Online portal müşteri girişi: ad soyad + telefon (baştaki 0 ile) + doğum tarihi eşleşmesi.
        // Şifresiz giriş brute-force'a açık olduğundan IP bazlı hız sınırına tabidir.
        group.MapPost("/customer/login", async (CustomerLoginRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.CustomerLoginAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("customer-auth");

        // OTP'li müşteri girişi (opsiyonel, daha güvenli): kimlik eşleşirse SMS ile 6 haneli kod,
        // kod doğrulanınca JWT verilir. Simülasyon modunda SMS gitmez; Development'ta kod yanıtta döner.
        group.MapPost("/customer/otp/request", async (CustomerLoginRequest request, Services.CustomerOtpService otp, HttpContext http, CancellationToken ct) =>
            (await otp.RequestAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("customer-auth");

        group.MapPost("/customer/otp/verify", async (CustomerOtpVerifyRequest request, Services.CustomerOtpService otp, HttpContext http, CancellationToken ct) =>
            (await otp.VerifyAsync(new CustomerLoginRequest(request.FullName, request.Phone, request.BirthDate), request.Code, ct)).ToHttpResult(http)).RequireRateLimiting("customer-auth");

        // Kuruma bağlı olmayan müşteri kaydı (kayıt ol) — herkese açık, kayıt sonrası otomatik giriş.
        group.MapPost("/customer/register", async (CustomerRegisterRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.CustomerRegisterAsync(request, ct)).ToHttpResult(http)).RequireRateLimiting("customer-auth");

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
