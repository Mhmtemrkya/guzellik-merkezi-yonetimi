using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// YAZMA İSTEĞİNDEKİ HEDEF ŞUBEYİ DOĞRULAR — global query filter'ın kör noktası.
///
/// <para>
/// Global şube süzgeci OKUMAYI kapsar; INSERT'i kapsamaz. Süzgeç eklendikten sonra bile şube
/// yöneticisi gövdeye kardeş şubenin (hatta BAŞKA BİR KURUMUN) <c>BranchId</c>'sini yazıp o şubeye
/// kayıt AÇABİLİRDİ: satır yazılır, kendi listesinde görünmez, hedef şubenin kataloğunda belirir.
/// Yabancı anahtar <c>Restrict</c> olduğundan veritabanı da buna itiraz etmez (şube gerçekten vardır,
/// yalnız başka kurumundur).
/// </para>
///
/// <para>
/// KURAL: şubesi SABİT roller (şube yöneticisi, personel — <see cref="ITenantContext.BranchId"/>
/// JWT'den gelir, X-Branch-Id başlığı onlar için yok sayılır) yalnız KENDİ şubelerine kayıt açar.
/// Şube değiştirebilen roller (kurum sahibi, platform yöneticisi) herhangi bir şubeye açabilir ama
/// şubenin AYNI KURUMA ait olduğu veritabanından doğrulanır.
/// </para>
///
/// <para>
/// Kontrol, ortam durumundan bağımsız olsun diye <c>IgnoreQueryFilters</c> + açık
/// <c>TenantId</c> koşuluyla yapılır (platform yöneticisinde tenant süzgeci kapalıdır).
/// </para>
/// </summary>
internal static class BranchScopeGuard
{
    /// <summary>Şubesi sabit rol mü? (kendi şubesi dışına yazamaz)</summary>
    private static bool IsBranchBound(ICurrentUser currentUser) =>
        !currentUser.IsPlatformAdmin && currentUser.Role is not (UserRole.InstitutionOwner or UserRole.PlatformAdmin);

    /// <summary>
    /// İstekteki şubeyi doğrular ve kaydedilecek değeri döndürür. <c>Error</c> doluysa istek
    /// UYGULANMAMALIDIR (403) — çağıran hiçbir satır yazmadan çıkmalıdır.
    /// </summary>
    public static async Task<(Guid? BranchId, Error? Error)> ResolveForWriteAsync(
        GuzellikDbContext db,
        ITenantContext tenantContext,
        ICurrentUser currentUser,
        Guid tenantId,
        Guid? requestedBranchId,
        CancellationToken cancellationToken)
    {
        if (IsBranchBound(currentUser) && tenantContext.BranchId is { } ownBranchId)
        {
            // Şube gönderilmediyse KENDİ şubesine açılır (arayüz zaten kendi şubesini gönderir);
            // farklı bir şube gönderildiyse istek reddedilir.
            if (requestedBranchId is null || requestedBranchId == ownBranchId) return (ownBranchId, null);
            return (null, Error.Forbidden("Yalnızca kendi şubenize kayıt açabilirsiniz."));
        }

        if (requestedBranchId is null) return (null, null); // kurum geneli kayıt

        var belongsToTenant = await db.Branches
            .IgnoreQueryFilters()
            .AnyAsync(b => b.Id == requestedBranchId.Value && b.TenantId == tenantId && !b.IsDeleted, cancellationToken);

        return belongsToTenant
            ? (requestedBranchId, null)
            : (null, Error.Forbidden("Seçilen şube bu kuruma ait değil."));
    }
}
