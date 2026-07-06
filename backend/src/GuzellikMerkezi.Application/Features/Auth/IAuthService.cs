using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Auth;

public interface IAuthService
{
    Task<Result<LoginScopeResponse>> GetLoginScopeAsync(LoginScopeRequest request, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    /// <summary>Online portal müşteri girişi (ad soyad + telefon + doğum tarihi eşleşmesi).</summary>
    Task<Result<LoginResponse>> CustomerLoginAsync(CustomerLoginRequest request, CancellationToken cancellationToken = default);
    /// <summary>Kuruma bağlı olmayan müşteri kaydı (kayıt ol) + otomatik giriş.</summary>
    Task<Result<LoginResponse>> CustomerRegisterAsync(CustomerRegisterRequest request, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result> LogoutAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result<UserProfileDto>> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken = default);
}
