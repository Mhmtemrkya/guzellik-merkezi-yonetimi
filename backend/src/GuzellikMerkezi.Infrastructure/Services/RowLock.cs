using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// ORTAK SATIR KİLİDİ PROTOKOLÜ (<c>SELECT ... FOR UPDATE</c>).
///
/// <para>
/// Adisyon onayı, satış iptali ve iptali geri alma AYNI kaynakları (ürün stoğu, paket seansı,
/// hediye çeki, müşteri/sadakat) değiştiriyor. Kilit yalnız bir tarafta olursa "son yazan kazanır"
/// tipi kayıp güncelleme oluşur: iptal stoğu 12 yazarken eşzamanlı satış 9 yazar, doğrusu 11'dir.
/// </para>
///
/// <para>
/// DEADLOCK ÖNLEMİ: kilitler her zaman AYNI SIRAYLA alınır — önce tablo sırası
/// (<see cref="TableOrder"/>), sonra her tablo içinde Id'ye göre artan. İki işlem ters sırayla
/// kilitlemeye çalışmadığı sürece birbirini bekletir ama kilitlenmez.
/// </para>
///
/// <para>InMemory sağlayıcı (birim testleri) kilidi desteklemez; orada sessizce atlanır.</para>
/// </summary>
public static class RowLock
{
    /// <summary>Kilit sırası SABİTTİR — çağıranlar bu sırayı bozmamalıdır.</summary>
    public static readonly string[] TableOrder =
    [
        "customers",
        // Bekleme kaydı kabulü: aynı teklif iki kez kabul edilirse ikisi de "Booked öncesi"
        // durumu görüp İKİ randevu açabiliyordu.
        "waitlist_entries",
        // Randevu OLUŞTURMA slot kapasitesini personel satırında serileştirir: "önce say, sonra
        // kaydet" iki ayrı işlemdi ve eşzamanlı iki istek kapasiteyi ikisi de boş görebiliyordu.
        "staff_members",
        // Randevu durum geçişi de bu protokole katılır: durum okuması ile seans tüketimi arasında
        // başka bir istek araya girip aynı randevu için ikinci bir seans düşürebiliyordu (randevu
        // satırında concurrency token da yok). "customers"tan SONRA gelir — adisyon silme yolu
        // önce müşteriyi kilitleyip sonra randevu siliyor; ters sıra kilitlenmeye yol açardı.
        "appointments",
        "customer_accounts",
        "adisyonlar",
        "products",
        "gift_cards",
        "customer_package_sessions",
    ];

    /// <summary>Tek bir satırı kilitler; satır yoksa false döner.</summary>
    public static async Task<bool> LockRowAsync(GuzellikDbContext db, string table, Guid id, CancellationToken ct)
    {
        if (!db.Database.IsRelational()) return true;
        EnsureKnownTable(table);
#pragma warning disable EF1002 // tablo adı sabit listeden; Id parametreli.
        var rows = await db.Database
            .SqlQueryRaw<Guid>($"SELECT Id AS Value FROM `{table}` WHERE Id = {{0}} FOR UPDATE", id.ToString())
            .ToListAsync(ct);
#pragma warning restore EF1002
        return rows.Count > 0;
    }

    /// <summary>Verilen Id'leri artan sırada kilitler (tekrarlar elenir).</summary>
    public static async Task LockRowsAsync(GuzellikDbContext db, string table, IEnumerable<Guid> ids, CancellationToken ct)
    {
        if (!db.Database.IsRelational()) return;
        foreach (var id in ids.Distinct().OrderBy(x => x))
        {
            await LockRowAsync(db, table, id, ct);
        }
    }

    private static void EnsureKnownTable(string table)
    {
        if (!TableOrder.Contains(table))
            throw new ArgumentOutOfRangeException(nameof(table), table, "Kilit sırası tanımlı olmayan tablo.");
    }
}
