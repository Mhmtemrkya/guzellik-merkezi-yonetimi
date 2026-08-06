using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Abstractions;

public interface ICurrentUser
{
    Guid? UserId { get; }
    string? Email { get; }
    UserRole? Role { get; }
    Guid? TenantId { get; }
    Guid? BranchId { get; }
    /// <summary>Online portal müşterisi ise müşteri kimliği (JWT "customer_id" claim'i); aksi halde null.</summary>
    Guid? CustomerId { get; }
    bool IsAuthenticated { get; }
    bool IsPlatformAdmin { get; }
    /// <summary>İsteğin geldiği IP adresi (audit log için).</summary>
    string? IpAddress { get; }

    /// <summary>İstemcinin kalıcı cihaz kimliği (X-Device-Id header). Cihaz güvenliği + log zenginleştirme için.</summary>
    string? DeviceId { get; }

    /// <summary>İstemcinin beyan ettiği cihaz/ağ bilgisi JSON'u (X-Device-Info header, base64 UTF-8 JSON).</summary>
    string? DeviceInfoJson { get; }

    /// <summary>Personelin sayfa izinleri (JWT "permission" claim'lerinden). Yönetici rollerde anlamsızdır (tam erişim).</summary>
    IReadOnlyCollection<string> Permissions { get; }

    /// <summary>
    /// HAM izin listesi kontrolü (case-insensitive) — ROL SEMANTİĞİ YOKTUR. Yönetici rollerde izin
    /// listesi boş olduğundan bu metot onlar için daima false döner; yetki kararı için
    /// <see cref="IsAllowed"/> kullanın.
    /// </summary>
    bool HasPermission(string permission) =>
        !string.IsNullOrEmpty(permission)
        && Permissions.Any(p => string.Equals(p, permission, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// YETKİ KARARI — rol modeli + izin listesi birlikte (bkz. <see cref="GuzellikMerkezi.Domain.Permissions.IsGrantedTo"/>).
    /// Çağrı yerleri "hangi izin" der; "hangi rol" kararı tek yerde durur. Payload'a bağlı bileşik
    /// kontroller (ör. istek satış içeriyorsa adisyon izni de iste) bunu kullanmalıdır — aksi hâlde
    /// kural yalnız bir rol için uygulanır ve diğer roller sessizce atlar.
    /// </summary>
    bool IsAllowed(string permissionKey) =>
        GuzellikMerkezi.Domain.Permissions.IsGrantedTo(Role, IsPlatformAdmin, Permissions, permissionKey);
}
