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

    /// <summary>Kullanıcının verilen izne sahip olup olmadığı (case-insensitive).</summary>
    bool HasPermission(string permission) =>
        !string.IsNullOrEmpty(permission)
        && Permissions.Any(p => string.Equals(p, permission, StringComparison.OrdinalIgnoreCase));
}
