using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// KALICI İŞ KUYRUĞU TABLOSUNUN BAKIMI.
///
/// <para>
/// HAM SQL — <c>ExecuteDeleteAsync</c> DEĞİL: EF sağlayıcısı tek tablolu silmeyi
/// <c>DELETE FROM background_jobs AS b WHERE …</c> olarak üretiyor. Takma adlı bu biçimi yalnız
/// MySQL 8 kabul eder; MariaDB sözdizimi hatasıyla reddeder. Sonuç canlıda şuydu: kuyruk sorunsuz
/// çalışıyor ama temizlik hiç yapılamıyor, tablo büyüyor ve saatte bir hata logu düşüyordu.
/// Takma adsız biçim iki sunucuda da geçerlidir; silinen satır kümesi aynıdır.
/// </para>
///
/// <para>
/// Silme PARTİLİDİR: temizlik uzun süre hiç çalışamamış olabileceğinden tablo birikmiş olabilir ve
/// tek dev DELETE satırları uzun süre kilitlerdi. Bir turda bitmeyen kalan, bir sonraki turda alınır.
/// </para>
///
/// <para>Bu kod Api yerine burada durur ki gerçek MySQL/MariaDB üzerinde test edilebilsin.</para>
/// </summary>
public static class BackgroundJobMaintenance
{
    /// <summary>Tek DELETE'te silinecek en fazla satır — <see cref="PurgeSql"/> ile aynı olmalıdır.</summary>
    public const int BatchSize = 500;

    /// <summary>
    /// <c>{0}</c> = kesim tarihi (parametre olarak gider). Sabit metin — SQL enjeksiyonu yok.
    /// Yalnız <c>Succeeded</c> silinir: <c>Failed</c> satırları dead-letter olarak incelenmek üzere kalır.
    /// </summary>
    private const string PurgeSql =
        "DELETE FROM `background_jobs` WHERE `Status` = 'Succeeded' " +
        "AND `CompletedAtUtc` IS NOT NULL AND `CompletedAtUtc` < {0} AND `IsDeleted` = 0 LIMIT 500";

    /// <summary>
    /// <paramref name="cutoffUtc"/> tarihinden önce tamamlanmış BAŞARILI işleri siler;
    /// silinen toplam satır sayısını döner. İlişkisel olmayan sağlayıcıda (InMemory) no-op.
    /// </summary>
    public static async Task<int> PurgeSucceededAsync(
        GuzellikDbContext db, DateTime cutoffUtc, int maxBatches, CancellationToken ct = default)
    {
        if (!db.Database.IsRelational()) return 0;

        var total = 0;
        for (var batch = 0; batch < maxBatches; batch++)
        {
            var removed = await db.Database.ExecuteSqlRawAsync(PurgeSql, new object[] { cutoffUtc }, ct);
            total += removed;
            if (removed == 0) break;
        }
        return total;
    }
}
