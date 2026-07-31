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

    // --- Hesap kilitleme -------------------------------------------------------------------
    // Tek savunma IP bazlı hız sınırıydı; proxy zincirinde sahte X-Forwarded-For ile aşılabildiği
    // için parola püskürtme/brute force'a karşı HESAP bazlı bir fren gerekiyor.

    /// <summary>Ardışık başarısız giriş sayısı. Başarılı girişte sıfırlanır.</summary>
    public int FailedLoginCount { get; private set; }

    /// <summary>Dolu ve gelecekteyse giriş reddedilir (doğru parolayla bile).</summary>
    public DateTime? LockedUntilUtc { get; private set; }

    /// <summary>
    /// Bu andan ÖNCE üretilmiş access token'lar geçersiz sayılır. Parola değişimi/şüpheli
    /// aktivitede ileri alınır; refresh token'lar ayrıca DB'de iptal edilir.
    /// </summary>
    public DateTime? SecurityStampUtc { get; private set; }

    public bool IsLockedOut(DateTime utcNow) => LockedUntilUtc is { } until && until > utcNow;

    /// <summary>Başarısız denemeyi işler; eşiğe ulaşınca hesabı geçici olarak kilitler.</summary>
    public void RegisterFailedLogin(DateTime utcNow, int threshold, TimeSpan lockDuration)
    {
        FailedLoginCount++;
        if (FailedLoginCount >= threshold)
        {
            LockedUntilUtc = utcNow.Add(lockDuration);
            FailedLoginCount = 0; // kilit süresi bitince temiz sayfa
        }
        Touch(utcNow);
    }

    public void ResetFailedLogins()
    {
        if (FailedLoginCount == 0 && LockedUntilUtc is null) return;
        FailedLoginCount = 0;
        LockedUntilUtc = null;
        Touch();
    }

    /// <summary>Mevcut tüm oturumları geçersiz kılar (parola değişimi, admin sıfırlama, devre dışı bırakma).</summary>
    public void InvalidateSessions(DateTime utcNow)
    {
        SecurityStampUtc = utcNow;
        Touch(utcNow);
    }

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

    /// <summary>
    /// Cihaz güvenliği açıkken bu kullanıcının tanımlayabileceği maksimum cihaz sayısı.
    /// Null = bu kullanıcı için cihaz kısıtı yok (serbest). Yalnızca Staff girişlerinde uygulanır.
    /// </summary>
    public int? MaxDeviceCount { get; private set; }

    public void SetMaxDeviceCount(int? count)
    {
        if (count is < 1 or > 10) throw new DomainException("Cihaz limiti 1-10 arasında olmalı (boş = sınırsız).");
        MaxDeviceCount = count;
        Touch();
    }

    /// <summary>
    /// Personel bazlı ekran görüntüsü izni istisnası. Null = kurum varsayılanı
    /// (Tenant.AllowStaffScreenshots) geçerli; true/false bu kullanıcı için ezer.
    /// </summary>
    public bool? AllowScreenshots { get; private set; }

    public void SetAllowScreenshots(bool? allowed)
    {
        AllowScreenshots = allowed;
        Touch();
    }

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
