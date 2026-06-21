using GuzellikMerkezi.Application.Features.Auth;

namespace GuzellikMerkezi.Application.Abstractions;

public interface ITokenService
{
    string CreateAccessToken(UserProfileDto profile, DateTime expiresAtUtc);
    string CreateRefreshToken();
    string HashRefreshToken(string refreshToken);
}
