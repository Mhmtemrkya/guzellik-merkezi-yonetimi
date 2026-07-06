using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class RefreshToken : Entity
{
    private RefreshToken() { }

    public RefreshToken(Guid tenantUserId, string tokenHash, DateTime expiresAtUtc)
    {
        if (string.IsNullOrWhiteSpace(tokenHash)) throw new DomainException("Refresh token hash boş olamaz.");
        TenantUserId = tenantUserId;
        TokenHash = tokenHash;
        ExpiresAtUtc = expiresAtUtc;
    }

    /// <summary>Online portal müşterisi için refresh token (TenantUser yerine Customer'a bağlanır).</summary>
    public static RefreshToken ForCustomer(Guid customerId, string tokenHash, DateTime expiresAtUtc)
    {
        if (string.IsNullOrWhiteSpace(tokenHash)) throw new DomainException("Refresh token hash boş olamaz.");
        return new RefreshToken
        {
            CustomerId = customerId,
            TokenHash = tokenHash,
            ExpiresAtUtc = expiresAtUtc
        };
    }

    public Guid? TenantUserId { get; private set; }
    public TenantUser? TenantUser { get; private set; }
    public Guid? CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }
    public string? ReplacedByTokenHash { get; private set; }

    public bool IsActive(DateTime utcNow) => RevokedAtUtc is null && ExpiresAtUtc > utcNow;

    public void Revoke(DateTime utcNow, string? replacedByTokenHash = null)
    {
        RevokedAtUtc = utcNow;
        ReplacedByTokenHash = string.IsNullOrWhiteSpace(replacedByTokenHash) ? null : replacedByTokenHash;
        Touch(utcNow);
    }
}
