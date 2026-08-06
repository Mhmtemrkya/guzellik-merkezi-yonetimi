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
        // EN BAŞTA: onay sahiplenme kilidi. Onaylanan işlem (HTTP replay) AYRI bir bağlantıda
        // çalışıp aşağıdaki tabloların hepsine dokunabilir; bu satır her zaman ilk kilitlenir ki
        // sıra bozulmasın. İki yönetici aynı anda onaylarsa biri bekler, sonra "zaten karara
        // bağlanmış" görür — operasyon iki kez uygulanmaz.
        "pending_operations",
        // Kurum satırı: kuruma özel KATALOG yazımlarını (kategori adı gibi) serileştirir.
        // Ad AES-GCM ile rastgele nonce'la şifrelendiği için DB'de benzersiz indeks aynı düz
        // metni yakalayamaz; uygulama kontrolü de iki eşzamanlı istekte ikisini birden geçirir.
        // En başta durur — bu yolu kullanan servisler başka kilit almaz, sıra çakışmaz.
        "tenants",
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
        // Gider iptali: "iptal edilmiş mi?" kontrolü ile ters kaydın yazılması arasında başka bir
        // istek araya girip İKİNCİ bir ters kayıt üretebiliyordu (defter, giderin tutarı kadar
        // eksiye kayardı). Zincirin SONUNDA durur: bu yolu kullanan servis başka kilit almaz,
        // dolayısıyla mevcut sıraları bozmaz.
        "business_expenses",
        // Abonelik tahsilatı: ödeme dönüşü hem tarayıcıdan hem webhook'tan AYNI ANDA gelebiliyor.
        // İkisi de satırı "Pending" görüp aboneliği uzatıyor, iki fatura üretiyordu. Kilit kazananı
        // seçer; bekleyen taraf satırı tazeleyip "zaten alınmıştı" cevabını verir. Zincirin sonunda
        // durur — faturalama servisi başka satır kilidi almaz, mevcut sıraları bozmaz.
        "subscription_payments",
        // Kontör cüzdanı: bakiye/rezerve BİR TOPLAM olduğu için stok ve hediye çeki ile AYNI
        // sınıftadır; ikisi kilitliyken bu tablo listede bile yoktu. Rezerve etme "kullanılabilir
        // bakiye yeter mi?" diye okuyup sonra yazıyor: iki eşzamanlı gönderim aynı bakiyeyi görüp
        // ikisi de rezerve edebiliyor (bakiyeden fazla taahhüt), teslim/iade yolları da birbirinin
        // yazdığını ezebiliyordu. Zincirin sonunda durur — bu yolu kullanan servis başka satır
        // kilidi almaz, mevcut sıraları bozmaz.
        "tenant_messaging_wallets",
        // Tek kullanımlık imza oturumu: jetonun "kullanılmış mı?" kontrolü ile imzanın yazılması
        // arasında başka bir istek araya girip AYNI jetonla ikinci kez imzalayabiliyordu.
        "customer_consent_forms",
        // Değerlendirme jetonu: aynı gerekçe (tek kullanımlık, kontrol ile yazma ayrı adımlar).
        "appointment_ratings",
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
