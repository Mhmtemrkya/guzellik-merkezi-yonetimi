using GuzellikMerkezi.Application.Features.Auth;

namespace GuzellikMerkezi.Application.Abstractions;

public interface ITokenService
{
    /// <param name="extraClaims">
    /// İsteğe bağlı ek claim'ler. Onay replay'i istek sahibinin kapsamıyla çalışan KISA ÖMÜRLÜ bir
    /// token üretirken buraya <c>replay_of</c> koyar; personel onay kapısı bu claim'i görünce isteği
    /// yeniden taslağa almaz (aksi hâlde onaylanan istek sonsuz döngüye girerdi).
    /// </param>
    string CreateAccessToken(UserProfileDto profile, DateTime expiresAtUtc, IReadOnlyDictionary<string, string>? extraClaims = null);
    string CreateRefreshToken();
    string HashRefreshToken(string refreshToken);
}
