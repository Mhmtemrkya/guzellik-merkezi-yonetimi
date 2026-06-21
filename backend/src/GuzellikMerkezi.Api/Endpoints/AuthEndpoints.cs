using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;

namespace GuzellikMerkezi.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login-scope", async (LoginScopeRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.GetLoginScopeAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/login", async (LoginRequest request, IAuthService service, HttpContext http, CancellationToken ct) =>
            (await service.LoginAsync(request, ct)).ToHttpResult(http));

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
