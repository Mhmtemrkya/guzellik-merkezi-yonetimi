# Legacy Kayıt İnceleme (salt-okunur)

Açılışta çalışan iki backfill işi, **emin olamadığı** kayıtlara bilinçli olarak dokunmaz: yanlış bağ
yazmaktansa eski davranışta bırakmak yeğdir. Geriye kalan kayıtlar bunlardır. Bu belge yalnızca
**inceleme** içindir; hiçbir veri değiştirilmemiştir ve aşağıdaki sorgular veri değiştirmez.

Kalan kayıtların **yeni işlemlere etkisi yoktur** — her ikisi de yalnızca ilgili satış/adisyon
sonradan silinir veya iptal edilirse devreye giren geri-alma yollarını ilgilendirir.

---

## A) Kesin seans bağı olmayan PackageUse

**Kaynak kod:** `DatabaseBootstrap.BackfillPackageSessionUsagesAsync`

`package_session_usages` yalnız YENİ onaylarda dolar. Backfill, eski onaylı adisyonlardaki paket
kullanımlarını kalıcı seans bağına çevirir — ama yalnızca **tek aday** varsa. Aday sayısı 0 veya
2+ ise satır atlanır.

**Etkisi:** yalnız bu adisyonun satışı iptal edilirse ters kayıt tahminî yönteme düşer. Müşterinin
aynı hizmeti içeren ikinci bir paketi varsa kredi yanlış pakete yazılabilir. Seans bakiyesi,
ciro ve stok etkilenmez.

## B) Kaynak adisyonu belirlenemeyen stok satışı

**Kaynak kod:** `DatabaseBootstrap.BackfillAdisyonSourceLinksAsync`

Bağ eskiden yalnız `Reference` metnindeydi (`ADS-…`). Bu kolon AES-GCM ve rastgele nonce ile
şifreli olduğundan SQL eşitliği hiç tutmuyordu; backfill değeri uygulama içinde çözüp adisyon
Id önekiyle eşler. Eşleşmeyen satıra dokunulmaz.

**Eşleşmeme sebebi genelde ikisinden biridir:** kaynak adisyon sonradan silinmiştir, ya da hareket
bir adisyondan değil elle stok girişinden gelmiştir.

**Etkisi:** o adisyon silinirse stok ters kaydı satış anındaki maliyeti bulamaz. Stok bakiyesinin
kendisi doğrudur.

---

## Sorgular

Canlı veritabanında çalıştırın (yalnız `SELECT` — hiçbir şey değiştirmez):

```sql
-- A) Kesin seans bağı olmayan PackageUse kalemleri
SELECT
    ai.Id            AS AdisyonItemId,
    ai.AdisyonId     AS AdisyonId,
    a.TenantId       AS KurumId,
    a.CustomerId     AS MusteriId,
    a.ApprovedAtUtc  AS OnayTarihi,
    ai.Description   AS Hizmet,
    ai.RefId         AS HizmetTanimiId,
    ai.Quantity      AS Adet,
    (SELECT COUNT(*)
       FROM customer_package_sessions s
      WHERE s.IsDeleted = 0
        AND CAST(s.TenantId AS BINARY)            = CAST(a.TenantId AS BINARY)
        AND CAST(s.CustomerId AS BINARY)          = CAST(a.CustomerId AS BINARY)
        AND CAST(s.ServiceDefinitionId AS BINARY) = CAST(ai.RefId AS BINARY)
        AND s.UsedSessions > 0)  AS AdaySeansSayisi
FROM adisyon_items ai
JOIN adisyonlar a ON CAST(a.Id AS BINARY) = CAST(ai.AdisyonId AS BINARY)
WHERE ai.IsDeleted = 0
  AND CAST(ai.Type AS BINARY) = CAST('PackageUse' AS BINARY)
  AND ai.RefId IS NOT NULL
  AND a.IsDeleted = 0
  AND CAST(a.Status AS BINARY) = CAST('Approved' AS BINARY)
  AND NOT EXISTS (SELECT 1 FROM package_session_usages u
                   WHERE CAST(u.AdisyonId AS BINARY) = CAST(ai.AdisyonId AS BINARY))
ORDER BY a.ApprovedAtUtc;
```

```sql
-- B) Kaynak adisyonu belirlenemeyen stok satışları
SELECT
    sm.Id             AS StokHareketiId,
    sm.TenantId       AS KurumId,
    sm.ProductId      AS UrunId,
    sm.Quantity       AS Miktar,
    sm.UnitCost       AS BirimMaliyet,
    sm.OccurredAtUtc  AS Tarih,
    sm.StaffMemberId  AS PersonelId,
    (SELECT COUNT(*)
       FROM adisyonlar a
      WHERE a.IsDeleted = 0
        AND CAST(a.TenantId AS BINARY) = CAST(sm.TenantId AS BINARY)
        AND CAST(a.Status AS BINARY) = CAST('Approved' AS BINARY)
        AND a.ApprovedAtUtc BETWEEN sm.OccurredAtUtc - INTERVAL 5 SECOND
                                AND sm.OccurredAtUtc + INTERVAL 5 SECOND) AS AyniAndaOnaylananFis
FROM stock_movements sm
WHERE sm.IsDeleted = 0
  AND CAST(sm.Type AS BINARY) = CAST('Sale' AS BINARY)
  AND sm.SourceAdisyonId IS NULL
ORDER BY sm.OccurredAtUtc;
```

```sql
-- C) Aynı backfill'in tahsilat tarafı (bilgi amaçlı sayaç)
SELECT COUNT(*) AS BagsizTahsilatSayisi
FROM account_payments p
WHERE p.IsDeleted = 0 AND p.SourceAdisyonId IS NULL AND p.Reference IS NOT NULL;
```

> **`CAST(... AS BINARY)` neden var:** tablolar arasında collation farkı oluşabiliyor
> (`utf8mb4_unicode_ci` ↔ `utf8mb4_0900_ai_ci`). Düz `=` karşılaştırması bu durumda
> *"Illegal mix of collations"* hatası verir — `char(36)` Guid kolonları da metin olduğu için
> join'ler dahil etkilenir. Binary karşılaştırma collation'dan bağımsızdır; Guid'ler tek
> sağlayıcı tarafından hep aynı biçimde yazıldığından sonuç birebir doğrudur.

---

## Sonuçları okuma

**A sorgusu — `AdaySeansSayisi`:**

| Değer | Anlamı | Yapılacak |
|---|---|---|
| `0` | O hizmet için kullanılmış hiçbir seans kaydı yok (paket silinmiş ya da kayıt seans takibinden eski) | Bağlanamaz; bırakın |
| `1` | Tek aday var — backfill bunu bağlamalıydı | API'yi bir kez yeniden başlatın; backfill idempotenttir, kendiliğinden bağlar |
| `2+` | Müşterinin aynı hizmeti içeren birden çok paketi var | Gerçekten belirsiz; ancak insan kararıyla çözülür |

**B sorgusu — `AyniAndaOnaylananFis`:** onayda stok hareketi ile fişin `ApprovedAtUtc` damgası
aynı andan gelir. `1` ise o fiş neredeyse kesin kaynaktır; `0` ise kaynak fiş silinmiştir ya da
hareket elle girilmiştir; `2+` ise ayırt edilemez.

---

## Karar

**Önerim: dokunmayın.** Her iki kayıt sınıfı da yalnızca ilgili kayıt sonradan silinir/iptal
edilirse devreye giren yolları etkiler; günlük işleyişte, ciroda, stok bakiyesinde ve raporlarda
karşılığı yoktur. Yanlış bağ yazmak, bağ yazmamaktan daha pahalıdır — backfill'lerin bu satırları
atlaması da bu yüzden bilinçlidir.

Yine de bağlamak isterseniz: **önce yukarıdaki sorguların çıktısını paylaşın.** Çıktı tek ve net
bir eşleşme gösteriyorsa (A'da `AdaySeansSayisi = 1`, B'de `AyniAndaOnaylananFis = 1`), o satıra
özel, Id'si sabitlenmiş bir `UPDATE` hazırlanabilir. Toplu/kör güncelleme yapılmamalıdır.
