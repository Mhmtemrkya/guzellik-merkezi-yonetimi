using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class TenantUser : Entity
{
    private TenantUser() { }

    internal TenantUser(Guid tenantId, string email, UserRole role, Guid? branchId, string? fullName)
    {
        TenantId = tenantId;
        Email = NormalizeEmail(email);
        Role = role;
        BranchId = branchId;
        FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();
    }

    public Guid TenantId { get; private set; }
    public Tenant? Tenant { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public string Email { get; private set; } = string.Empty;
    public string? FullName { get; private set; }
    public string PasswordHash { get; private set; } = string.Empty;
    public UserRole Role { get; private set; }
    public bool IsActive { get; private set; } = true;
    public DateTime? LastLoginUtc { get; private set; }

    /// <summary>
    /// İlk giriş veya admin tarafından şifre sıfırlama sonrası true. True ise login yapılır
    /// ama kullanıcı şifresini değiştirmeden başka işlem yapamaz.
    /// </summary>
    public bool MustChangePassword { get; private set; }

    /// <summary>
    /// Personel için sayfa bazlı izinler (CSV format: "Customers,Appointments,Stock").
    /// PlatformAdmin / InstitutionOwner için göz ardı edilir (tüm yetkiler).
    /// </summary>
    public string? Permissions { get; private set; }

    public ICollection<RefreshToken> RefreshTokens { get; private set; } = new List<RefreshToken>();

    public void ChangeScope(UserRole role, Guid? branchId)
    {
        Role = role;
        BranchId = branchId;
        Touch();
    }

    public void Rename(string? fullName)
    {
        FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();
        Touch();
    }

    public void SetPasswordHash(string passwordHash)
    {
        if (string.IsNullOrWhiteSpace(passwordHash)) throw new DomainException("Parola hash boş olamaz.");
        PasswordHash = passwordHash;
        Touch();
    }

    /// <summary>
    /// Admin tarafından personel oluşturulduğunda kullanılır. MustChangePassword=true,
    /// kullanıcı ilk girişten sonra mecburen şifresini değiştirir.
    /// </summary>
    public void SetTemporaryPassword(string passwordHash)
    {
        SetPasswordHash(passwordHash);
        MustChangePassword = true;
        Touch();
    }

    /// <summary>
    /// Kullanıcının kendi yeni şifresini set ederken çağrılır. MustChangePassword=false yapar.
    /// </summary>
    public void ConfirmOwnPassword(string passwordHash)
    {
        SetPasswordHash(passwordHash);
        MustChangePassword = false;
        Touch();
    }

    /// <summary>
    /// İzinleri tek bir CSV stringi olarak set eder. Yetkilerin keyleri Permission.* sabitlerinden gelmeli.
    /// Null veya boş geçerse "yetki yok" anlamına gelir.
    /// </summary>
    public void SetPermissions(IEnumerable<string>? keys)
    {
        if (keys is null) { Permissions = null; Touch(); return; }
        var distinct = keys.Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        Permissions = distinct.Length == 0 ? null : string.Join(',', distinct);
        Touch();
    }

    public void RecordLogin(DateTime utcNow)
    {
        LastLoginUtc = utcNow;
        Touch(utcNow);
    }

    public void Disable()
    {
        IsActive = false;
        Touch();
    }

    public static string NormalizeEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email)) throw new DomainException("E-posta boş olamaz.");
        return email.Trim().ToLowerInvariant();
    }
}
