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
    /// Sahiplenme denemesinin sonucu.
    ///
    /// <para>
    /// ÜÇ DURUM ŞART: eskiden yalnız bool dönüyordu ve "ödeme BENİM önceki denememe ait" ile
    /// "ödeme BAŞKA deftere ait" aynı cevaba (<c>false</c>) düşüyordu. Sonuç: sahiplik yazıldıktan
    /// SONRA çöken bir yenileme, kendi bıraktığı satır yüzünden bir daha ASLA tamamlanamıyordu —
    /// abonelik sonsuza dek PENDING kalıyor, kurum ödediği hizmeti alamıyordu.
    /// </para>
    /// </summary>
    public enum ClaimOutcome
    {
        /// <summary>Sahiplik bu çağrıda alındı.</summary>
        Claimed,

        /// <summary>Ödeme ZATEN BU kayda ait — yarım kalmış işlem sürdürülüyor, devam edilebilir.</summary>
        AlreadyOwnedBySelf,

        /// <summary>Ödeme BAŞKA bir deftere/kayda ait — para hareketi YAPILMAMALIDIR.</summary>
        OwnedByAnother,
    }

    /// <summary>
    /// Ödeme kimliğini bu defter adına sahiplenir.
    ///
    /// <para>
    /// Çağıran akışın transaction'ı içinde çalışır: MySQL'de duplicate-key hatası yalnız
    /// İFADEYİ geri alır, transaction açık kalır — bu yüzden reddi işleyip commit etmeye devam
    /// edebiliriz. Hata METNİNE değil, kısıt ihlaline bakılır (bkz. <see cref="DbConstraints"/>).
    /// </para>
    /// <para>
    /// InMemory sağlayıcı benzersiz indeksi ZORLAMAZ; birim testlerinde bu koruma her zaman
    /// <see cref="ClaimOutcome.Claimed"/> döner. Eşzamanlılık ve yeniden sahiplenme davranışı
    /// yalnız gerçek MariaDB testinde doğrulanabilir.
    /// </para>
    /// </summary>
    public static async Task<ClaimOutcome> TryClaimAsync(
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
            return ClaimOutcome.Claimed;
        }
        catch (DbUpdateException ex) when (DbConstraints.IsUniqueViolation(ex))
        {
            // HEDEFLİ DETACH — ChangeTracker.Clear() DEĞİL. Clear(), dış akışın bekleyen
            // değişikliklerini de silerdi (bkz. iç içe transaction tuzağı); burada yalnız
            // reddedilen satır izlemeden çıkarılır ki sonraki SaveChanges onu tekrar denemesin.
            // Sorgudan ÖNCE yapılmalı, aksi hâlde EF aynı satırı yeniden eklemeye çalışır.
            db.Entry(claim).State = EntityState.Detached;

            // KİM SAHİPLENMİŞ? "Benim önceki denemem" ile "başka defter" AYNI ŞEY DEĞİLDİR:
            // ilki yarım kalmış bir işin devamıdır ve sürdürülmelidir.
            var existing = await db.ProviderPaymentClaims.AsNoTracking().IgnoreQueryFilters()
                .FirstOrDefaultAsync(
                    c => c.Provider == provider && c.ProviderPaymentId == providerPaymentId, ct);

            return existing is not null && existing.Ledger == ledger && existing.OwnerId == ownerId
                ? ClaimOutcome.AlreadyOwnedBySelf
                : ClaimOutcome.OwnedByAnother;
        }
    }
}
