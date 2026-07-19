using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Personel kategori yetkisi: Specialties (virgüllü kategori/hizmet adları) doluysa
/// personel yalnızca o kategorilerdeki (veya adı listede olan) hizmetlere randevu alabilir.
/// Boş liste = kısıt yok. Randevu üreten TÜM yollar (admin, online portal, bekleme listesi)
/// bu kontrolden geçer.
/// </summary>
public static class StaffSkill
{
    /// <summary>Yetkisizse Türkçe engel mesajı, yetkiliyse null döner.</summary>
    public static async Task<string?> BlockReasonAsync(
        GuzellikDbContext db, Guid tenantId, Guid staffMemberId, Guid serviceDefinitionId, CancellationToken ct)
    {
        var staff = await db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == staffMemberId)
            .Select(s => new { s.FullName, s.Specialties })
            .FirstOrDefaultAsync(ct);
        if (staff is null || string.IsNullOrWhiteSpace(staff.Specialties)) return null;

        var service = await db.ServiceDefinitions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == serviceDefinitionId)
            .Select(s => new { s.Name, s.Category })
            .FirstOrDefaultAsync(ct);
        if (service is null) return null;

        var allowed = staff.Specialties
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.ToLowerInvariant())
            .ToHashSet();
        var category = (service.Category ?? string.Empty).Trim().ToLowerInvariant();
        var name = (service.Name ?? string.Empty).Trim().ToLowerInvariant();
        if ((category.Length > 0 && allowed.Contains(category)) || (name.Length > 0 && allowed.Contains(name))) return null;

        return $"{staff.FullName}, \"{service.Name}\" hizmetinin kategorisinde yetkili değil. Personel kartından kategori yetkisi verin ya da farklı personel seçin.";
    }
}
