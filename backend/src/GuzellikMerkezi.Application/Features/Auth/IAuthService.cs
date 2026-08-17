using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Auth;

public interface IAuthService
{
    Task<Result<LoginScopeResponse>> GetLoginScopeAsync(LoginScopeRequest request, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    /// <summary>Online portal müşteri girişi (ad soyad + telefon eşleşmesi; kanıt = doğrulama kodu).</summary>
    Task<Result<LoginResponse>> CustomerLoginAsync(CustomerLoginRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kuruma bağlı olmayan müşteri kaydı (kayıt ol) + otomatik giriş.
    /// </summary>
    /// <param name="phoneVerified">
    /// Doğrulama kodu TELEFONA (WhatsApp/SMS) gidip doğrulandıysa true. Yalnızca bu durumda mevcut
    /// bir kayıt telefonla sahiplenilebilir.
    /// </param>
    /// <param name="verifiedEmail">
    /// Doğrulama kodu E-POSTAYA gidip doğrulandıysa o adres. Telefon kanıtlanmadığı için mevcut kayıt
    /// yalnızca <b>e-postası bu adres olan</b> kayıtla eşleştirilebilir (bkz. uygulama notu).
    /// </param>
    Task<Result<LoginResponse>> CustomerRegisterAsync(CustomerRegisterRequest request, bool phoneVerified = false, string? verifiedEmail = null, CancellationToken cancellationToken = default);
    Task<Result<LoginResponse>> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result> LogoutAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task<Result<UserProfileDto>> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken = default);
}
