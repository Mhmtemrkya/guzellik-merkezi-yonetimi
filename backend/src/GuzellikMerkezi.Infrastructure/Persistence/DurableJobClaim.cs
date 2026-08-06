using GuzellikMerkezi.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// KALICI İŞ KUYRUĞUNDA "TAM BİR KEZ" SAHİPLENME (H8).
///
/// <para>
/// SOMUT AÇIK: iki tüketici yolu da (DB poller + RabbitMQ) işi "oku → belleğe al → Processing yaz"
/// biçiminde alıyordu. İki worker aynı Pending satırı okuyup ikisi de Processing yazabiliyor, ikisi
/// de handler'ı çalıştırıyordu. Handler'lar DIŞ DÜNYAYA yazıyor (WhatsApp mesajı, push bildirimi,
/// KVKK isteği, bekleme listesi teklifi) — dolayısıyla çift çalışma müşteriye çift mesaj demekti.
/// </para>
///
/// <para>
/// ÇÖZÜM: sahiplenme artık KOŞULLU TEK BİR UPDATE'tir. Satırı kim güncelleyebildiyse iş onundur;
/// kaybeden 0 satır etkiler ve işe hiç dokunmaz. Ek olarak her sahiplenme benzersiz bir JETON yazar
/// (<see cref="BackgroundJob.LockToken"/>): tamamlama/başarısızlık yazmaları da jetona koşullanır,
/// böylece kilidi dolmuş bir worker sonradan bitirip yeni sahibin durumunu EZEMEZ.
/// </para>
///
/// <para>
/// UZUN İŞLER: <see cref="HeartbeatAsync"/> kilidi periyodik uzatır. Aksi hâlde 5 dakikayı aşan bir
/// iş (yavaş Meta/SMTP çağrısı) çalışırken "bayat" sayılıp ikinci kez alınırdı.
/// </para>
///
/// <para>
/// HAM SQL: <c>ExecuteUpdateAsync</c> DEĞİL — sağlayıcının ürettiği takma adlı UPDATE'i MariaDB
/// reddediyor (aynı tuzak: <see cref="BackgroundJobMaintenance"/>). Takma adsız biçim iki sunucuda
/// da geçerlidir. İlişkisel olmayan sağlayıcıda (InMemory testleri) izleyici üzerinden çalışır;
/// orada eşzamanlılık yoktur, doğruluk değişmez.
/// </para>
/// </summary>
public static class DurableJobClaim
{
    /// <summary>Sahiplenilebilir satırın koşulu: sırası gelmiş Pending ya da kilidi DOLMUŞ Processing.</summary>
    private const string ClaimablePredicate =
        "((`Status` = 'Pending' AND `NextAttemptUtc` <= {2}) " +
        " OR (`Status` = 'Processing' AND `LockedUntilUtc` IS NOT NULL AND `LockedUntilUtc` < {2}))";

    private const string ClaimSql =
        "UPDATE `background_jobs` SET `Status` = 'Processing', `LockedUntilUtc` = {0}, `LockToken` = {1}, " +
        "`UpdatedAtUtc` = {2} WHERE `Id` = {3} AND `IsDeleted` = 0 AND " + ClaimablePredicate;

    /// <summary>
    /// İşi ATOMİK olarak sahiplenir. Kazandıysa true — yalnız o zaman handler çalıştırılmalıdır.
    /// </summary>
    public static async Task<bool> TryClaimAsync(
        GuzellikDbContext db, BackgroundJob job, string lockToken, TimeSpan lockDuration, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (!db.Database.IsRelational())
        {
            // InMemory: koşulu bellekte uygula (tek süreç, yarış yok).
            var claimable = (job.Status == "Pending" && job.NextAttemptUtc <= now)
                            || (job.Status == "Processing" && job.LockedUntilUtc is { } until && until < now);
            if (!claimable) return false;
            job.MarkProcessing(lockDuration, lockToken);
            await db.SaveChangesAsync(ct);
            return true;
        }

        var affected = await db.Database.ExecuteSqlRawAsync(
            ClaimSql,
            new object[] { now.Add(lockDuration), lockToken, now, job.Id.ToString() }, ct);
        if (affected == 0) return false;

        // İzleyicideki nesne SQL'i görmez; yeni durumu okuyup senkronla (sonraki yazmalar doğru olsun).
        await db.Entry(job).ReloadAsync(ct);
        return true;
    }

    /// <summary>
    /// Kilidi uzatır — uzun süren iş çalışırken "bayat" sayılıp ikinci kez alınmasın.
    /// false → sahiplenmeyi KAYBETTİK (başka worker aldı): işe devam edilmemeli.
    /// </summary>
    public static async Task<bool> HeartbeatAsync(
        GuzellikDbContext db, Guid jobId, string lockToken, TimeSpan lockDuration, CancellationToken ct)
    {
        if (!db.Database.IsRelational()) return true;
        var now = DateTime.UtcNow;
        var affected = await db.Database.ExecuteSqlRawAsync(
            "UPDATE `background_jobs` SET `LockedUntilUtc` = {0}, `UpdatedAtUtc` = {1} " +
            "WHERE `Id` = {2} AND `LockToken` = {3} AND `Status` = 'Processing'",
            new object[] { now.Add(lockDuration), now, jobId.ToString(), lockToken }, ct);
        return affected > 0;
    }

    /// <summary>
    /// Sonucu YALNIZ hâlâ sahibiysek yazar. false → kilit başkasına geçmiş; sonuç yazılmaz ve
    /// çağıran bunu loglar. Sessizce yazmak, yeni sahibin çalışmasını görünmez kılardı.
    /// </summary>
    public static async Task<bool> TryCompleteAsync(
        GuzellikDbContext db, BackgroundJob job, string lockToken, bool succeeded, string? error, CancellationToken ct)
    {
        if (!db.Database.IsRelational())
        {
            if (succeeded) job.MarkSucceeded();
            else job.MarkFailedAttempt(error ?? "Bilinmeyen hata");
            await db.SaveChangesAsync(ct);
            return true;
        }

        // Sahiplik KİLİT ALTINDA doğrulanır: kontrol ile yazma arasına başka worker giremesin.
        await using var tx = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

#pragma warning disable EF1002 // tablo adı sabit; parametreler bağlı.
        var owned = await db.Database.SqlQueryRaw<Guid>(
                "SELECT Id AS Value FROM `background_jobs` WHERE `Id` = {0} AND `LockToken` = {1} FOR UPDATE",
                job.Id.ToString(), lockToken)
            .ToListAsync(ct);
#pragma warning restore EF1002
        if (owned.Count == 0) return false;

        // Durum geçişini domain kuralı hesaplasın (backoff, deneme sayacı, dead-letter eşiği).
        await db.Entry(job).ReloadAsync(ct);
        if (succeeded) job.MarkSucceeded();
        else job.MarkFailedAttempt(error ?? "Bilinmeyen hata");
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return true;
    }
}
