using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace GuzellikMerkezi.Infrastructure.Security;

public sealed class JwtTokenService : ITokenService
{
    private readonly string _issuer;
    private readonly string _audience;
    private readonly SymmetricSecurityKey _signingKey;

    public JwtTokenService(IConfiguration configuration)
    {
        _issuer = configuration["Jwt:Issuer"] ?? "GuzellikMerkezi";
        _audience = configuration["Jwt:Audience"] ?? "GuzellikMerkezi.Client";
        var key = configuration["Jwt:SigningKey"] ?? "development-only-signing-key-change-me-min-32-bytes";
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key));
    }

    public string CreateAccessToken(UserProfileDto profile, DateTime expiresAtUtc)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, profile.UserId.ToString()),
            new(JwtRegisteredClaimNames.Email, profile.Email),
            new(ClaimTypes.NameIdentifier, profile.UserId.ToString()),
            new(ClaimTypes.Email, profile.Email),
            new(ClaimTypes.Role, profile.Role.ToString()),
            new("role", profile.Role.ToString())
        };

        if (!string.IsNullOrWhiteSpace(profile.FullName)) claims.Add(new Claim(ClaimTypes.Name, profile.FullName));
        if (profile.TenantId.HasValue) claims.Add(new Claim("tenant_id", profile.TenantId.Value.ToString()));
        if (profile.BranchId.HasValue) claims.Add(new Claim("branch_id", profile.BranchId.Value.ToString()));
        if (profile.CustomerId.HasValue) claims.Add(new Claim("customer_id", profile.CustomerId.Value.ToString()));
        foreach (var permission in profile.Permissions) claims.Add(new Claim("permission", permission));

        var credentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(_issuer, _audience, claims, expires: expiresAtUtc, signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    public string HashRefreshToken(string refreshToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken));
        return Convert.ToHexString(bytes);
    }
}
