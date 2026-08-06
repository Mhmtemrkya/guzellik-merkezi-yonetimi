using GuzellikMerkezi.Domain.Authorization;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Auth;

/// <summary>
/// <see cref="TenantUser"/> → <see cref="UserProfileDto"/> — TEK kaynak.
///
/// <para>
/// Aynı dönüşüm giriş akışında (token üretimi) ve onay replay'inde (istek sahibinin kapsamıyla
/// çalıştırma) gerekiyor. İkinci bir kopya yazmak, izin çözümlemesinin iki yerde ayrışmasına yol
/// açar: replay istek sahibinin GÜNCEL yetkisiyle çalışmak zorunda olduğundan bu ayrışma doğrudan
/// bir yetki yükseltme deliği demektir.
/// </para>
/// </summary>
public static class UserProfileFactory
{
    /// <param name="branchId">
    /// Oturumun/işlemin şube kapsamı. Personelde kullanıcının kendi şubesidir; onay replay'inde
    /// isteğin kaydedilmiş (değişmez) şubesidir.
    /// </param>
    public static UserProfileDto Build(TenantUser user, Guid? branchId) => new(
        user.Id,
        user.Email,
        user.FullName,
        user.Role,
        user.TenantId,
        branchId,
        // Staff için DB'de saklanan kişisel izinler; yönetici rollerde rol tablosundan gelen varsayılanlar.
        user.Role == UserRole.Staff ? ParseCsv(user.Permissions) : RolePermissions.NamesFor(user.Role),
        user.MustChangePassword);

    public static IReadOnlyCollection<string> ParseCsv(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? Array.Empty<string>()
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
