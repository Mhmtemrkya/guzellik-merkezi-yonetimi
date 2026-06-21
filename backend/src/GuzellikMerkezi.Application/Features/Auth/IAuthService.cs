using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Auth;

public interface IAuthService
{
    Task<Result<LoginScopeResponse>> GetLoginScopeAsync(LoginScopeRequest request, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result> LogoutAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result<UserProfileDto>> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken = default);
}
