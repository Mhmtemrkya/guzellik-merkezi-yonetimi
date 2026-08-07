using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Dış ödeme sahipliğinin ATOMİK alınması — bkz. <see cref="ProviderPaymentClaim"/>.
/// </summary>
internal static class ProviderPaymentClaims
{
    /// <summary>
    /// Ödeme kimliğini bu defter adına sahiplenir. <c>false</c> dönerse ödeme BAŞKA bir deftere
    /// (ya da aynı defterde başka bir kayda) aittir ve para hareketi YAPILMAMALIDIR.
    ///
    /// <para>
    /// Çağıran akışın transaction'ı içinde çalışır: MySQL'de duplicate-key hatası yalnız
    /// İFADEYİ geri alır, transaction açık kalır — bu yüzden reddi işleyip commit etmeye devam
    /// edebiliriz. Hata METNİNE değil, kısıt ihlaline bakılır (bkz. <see cref="DbConstraints"/>).
    /// </para>
    /// <para>
    /// InMemory sağlayıcı benzersiz indeksi ZORLAMAZ; birim testlerinde bu koruma her zaman
    /// "başarılı" döner. Eşzamanlılık davranışı yalnız gerçek MariaDB testinde doğrulanabilir.
    /// </para>
    /// </summary>
    public static async Task<bool> TryClaimAsync(
        GuzellikDbContext db,
        string provider,
        string providerPaymentId,
        string ledger,
        Guid ownerId,
        Guid tenantId,
        CancellationToken ct)
    {
        var claim = new ProviderPaymentClaim(provider, providerPaymentId, ledger, ownerId, tenantId);
        db.ProviderPaymentClaims.Add(claim);
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex) when (DbConstraints.IsUniqueViolation(ex))
        {
            // HEDEFLİ DETACH — ChangeTracker.Clear() DEĞİL. Clear(), dış akışın bekleyen
            // değişikliklerini de silerdi (bkz. iç içe transaction tuzağı); burada yalnız
            // reddedilen satır izlemeden çıkarılır ki sonraki SaveChanges onu tekrar denemesin.
            db.Entry(claim).State = EntityState.Detached;
            return false;
        }
    }
}
