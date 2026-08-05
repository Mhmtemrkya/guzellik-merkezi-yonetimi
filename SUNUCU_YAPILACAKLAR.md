# Sunucuda Yapılacaklar

Denetim bulgularının **sunucu tarafına düşen** kısmı. Kod tarafı ayrı; burada yalnızca makinede
yapılacak işler var.

> **Ön koşul:** 2–6 arası maddeler yeni sürüm deploy edildikten sonra anlamlıdır. Madde 1 (nginx)
> deploy'dan bağımsız ve tek başına güvenli — hemen yapılabilir.

---

## 1. Nginx: gerçek istemci IP'si

**Sorun:** Rate-limit'ler IP başına tasarlandı ama backend herkesi frontend'in IP'si olarak görüyor.
Bu yüzden limitler fiilen **site geneline** uygulanıyor:

| Politika | Limit | Şu anki fiili etki |
|---|---|---|
| Müşteri auth / OTP | 10 istek / 5 dk | tüm site ortak |
| Personel auth | 15 istek / 5 dk | tüm site ortak |
| Public gezinme | 60 istek / dk | tüm site ortak |

OTP girişi 2 istek harcadığı için (request + verify) aynı pencerede 5 müşteri giriş yapınca
altıncısı 429 alabiliyor.

**Yapılacak** — site config'inde `proxy_pass` bloğu:

```nginx
# DİKKAT: $proxy_add_x_forwarded_for DEĞİL. O, istemcinin gönderdiği başlığa EKLER;
# istemci kendi IP'sini uydurup limiti atlayabilir. $remote_addr başlığı EZER.
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
```

```bash
nginx -t && systemctl reload nginx
```

## 2. Frontend env: `TRUSTED_EDGE_PROXY`

Next proxy'si (`app/api/[[...path]]/route.ts`) varsayılan olarak **tüm** forwarding başlıklarını
siler — spoof edilebilir olduğu için doğru davranış. Önünde başlığı EZEN bir edge varsa güvenilir
sayılabilir.

```bash
# /etc/beautyasist/frontend.env  (ya da systemd unit Environment=)
TRUSTED_EDGE_PROXY=true
```

```bash
systemctl restart beautyasist-frontend
```

> **Sıra önemli:** Madde 1 yapılmadan bunu açmayın. Nginx başlığı ezmiyorsa istemci kendi IP'sini
> uydurabilir ve rate-limit tamamen atlanır — şu ankinden daha kötü olur.

## 3. Backend env

```bash
# /etc/beautyasist/backend.env
ForwardedHeaders__ForwardLimit=1
```

Zaten kod varsayılanı 1; zincir "istemci → nginx → Next → backend(loopback)" olduğu için doğru
değer bu. `ForwardedHeaders__TrustAll` **açılmamalı** (loopback güveni yeterli).

Ayrıca kontrol edin: **`Calendar__AllowLegacyTokens` tanımlı OLMAMALI.** Yeni kodda varsayılan
`false`. Dosyada `true` olarak duruyorsa **silin** — yoksa iptal/rotasyon eski URL'leri öldürmez.

```bash
grep -i calendar /etc/beautyasist/backend.env || echo "tanimli degil - dogru"
```

## 4. Takvim abonelikleri kırılacak — önceden duyurun

Eski (sunucu sırrından türetilmiş) takvim token'ları artık **reddediliyor**. Bu bilinçli: o
token'lar iptal edilemiyordu, süresi yoktu ve sızarsa sonsuza kadar geçerliydi.

**Etki:** Google/Apple/Outlook'a eklenmiş mevcut abonelikler veri çekmeyi durdurur.
**Çözüm:** Kullanıcı panelden **Takvim Aboneliği → Bağlantı oluştur** ile yeni link alır.

Canlıda aktif DB token'ı **0** olduğu için pratikte kimse etkilenmiyor olabilir; yine de
yöneticilere bir satır bilgi geçmek iyi olur.

## 5. Onaysız giderler artık raporlarda görünmeyecek

Personelin girdiği ve **yönetici onayı bekleyen** giderler kasa/kâr-zarar/şube/aylık raporlardan
çıkarıldı (daha önce gerçekleşmiş gider gibi sayılıyorlardı).

Canlıda **3 kayıt / 10.200 TL** bu durumda. Deploy sonrası gider toplamı bu kadar **düşecek** —
bu bir hata değil, düzeltmenin kendisi. Yönetici bunları **Giderler** sayfasından onaylarsa
raporlara geri girerler.

```sql
-- Hangi kayıtlar bekliyor:
SELECT Id, Category, Amount, OccurredAtUtc, StaffMemberId
FROM business_expenses
WHERE IsDeleted = 0 AND IsApproved = 0
ORDER BY OccurredAtUtc;
```

## 6. Migration: iki adet

### 6a. `20260801082854_ConcurrencyIndexesAndUsageUniqueness`

Üç şey yapar:

- `account_payments.SourceAdisyonId` ve `stock_movements.SourceAdisyonId` üzerine indeks (silme/ters
  kayıt bu kolonlardan arıyordu; indekssiz tam tablo taraması transaction ve kilit süresini uzatıyor).
- `package_session_usages` üzerine **(TenantId, AdisyonItemId, CustomerPackageSessionId) UNIQUE** —
  eşzamanlı açılış backfill'i mükerrer kullanım satırı ekleyip aynı seansı iki kez kredileyemesin.
- Unique index'ten ÖNCE mükerrer satırları temizler (en eskisi kalır), yoksa migration yarıda kalırdı.

Kontrol (uygulamadan önce, mükerrer var mı):

```sql
SELECT TenantId, AdisyonItemId, CustomerPackageSessionId, COUNT(*) AS n
FROM package_session_usages
GROUP BY TenantId, AdisyonItemId, CustomerPackageSessionId
HAVING n > 1;
```

Boş dönerse temizlik adımı zaten no-op olur. Uygulama açılışta migration'ı kendi çalıştırır;
elle uygulamak isterseniz `CANLI_DEPLOY_NOTLARI.md`'deki yordamı izleyin.

### 6b. `AppointmentSourceSessionLink`

`appointments` tablosuna nullable `SourceCustomerPackageSessionId` ekler. Randevunun hangi paket
seansından geldiğini kesin olarak taşır; satış iptali artık hangi randevuların kapanacağını tahmin
etmek yerine bu bağa bakar.

**Mevcut satırlar `NULL` kalır ve eski (sezgisel) davranışı sürdürür** — deploy anında hiçbir
randevu etkilenmez. Bağ yalnızca bundan sonra oluşturulan/tamamlanan randevularda dolar.

## 7. Canlıdaki 250 TL taksit-plan drift'i

Mevcut cariye yeni adisyon borcu eklenirken taksit planı senkronlanmıyordu; **yeni** satışlarda
düzeldi ama canlıdaki 1 kayıt drift'li kalır (cari 8.750 ↔ plan 8.500).

Drift'li carileri bulun:

```sql
-- Tablo adı account_installments'tır (installments DEĞİL — eski sürümde yanlış yazılmıştı).
SELECT a.Id, a.TenantId, a.TotalAmount, a.DepositAmount,
       COALESCE(SUM(i.Amount), 0) AS PlanToplami,
       COUNT(i.Id)                AS AktifTaksit,
       (a.TotalAmount - a.DepositAmount) - COALESCE(SUM(i.Amount), 0) AS Fark
FROM customer_accounts a
LEFT JOIN account_installments i
       ON i.CustomerAccountId = a.Id
      AND i.IsDeleted = 0
      AND i.Status <> 'Cancelled'
WHERE a.IsDeleted = 0 AND a.CancelledAtUtc IS NULL
GROUP BY a.Id, a.TenantId, a.TotalAmount, a.DepositAmount
HAVING ABS(Fark) > 0.01;
```

**Onarım SQL ile YAPILMAZ.** İki desteklenen yol var:

1. Panelden ilgili carinin **Yeniden Planla** işlemi — plan mevcut toplam üzerinden yeniden kurulur.
2. **Hedefli açılış bakımı** (taksit kimliklerini/vadelerini KORUR): yukarıdaki sorgunun verdiği
   `Id`, `TenantId`, tutarlar ve `AktifTaksit` değerleri `Maintenance:RepairInstallmentPlan*`
   ayarlarına yazılır — adım adım akış `CANLI_DEPLOY_NOTLARI.md` → "Taksit planı sapma bakımı".
   Beklenen değerlerden biri bile tutmazsa açılış durur, veri değişmez.

Elle `account_installments` satırı yazmak tahsilat dağıtımını bozar.

## 8. Deploy ve doğrulama

```bash
sudo /usr/local/sbin/deploy-beautyasist

curl -fsS https://beautyasist.com/api/proxy/health
systemctl is-active beautyasist-frontend
systemctl is-active beautyasist-backend
```

Deploy sonrası ek kontroller:

```bash
# Kuyruk temizliği artık çalışıyor mu (MariaDB uyumlu DELETE)?
# Bir saat içinde eski başarılı işler erimeli, hata logu kesilmeli.
journalctl -u beautyasist-backend --since "2 hours ago" | grep -i "background_jobs\|kuyruk" | tail
```

```sql
-- Temizlenemeyen eski iş sayısı zamanla 0'a inmeli:
SELECT COUNT(*) FROM background_jobs
WHERE Status = 'Succeeded' AND CompletedAtUtc < UTC_TIMESTAMP() - INTERVAL 7 DAY;
```

Rate-limit doğrulaması (madde 1+2 sonrası): iki farklı ağdan (ör. ofis + mobil veri) arka arkaya
giriş denemesi yapın — biri limite takılırken diğeri etkilenmemeli.

## 9. Salt-okunur veri incelemesi (opsiyonel)

`LEGACY_KAYIT_INCELEME.md` içindeki sorgular. Hiçbir şey değiştirmez; çıktıyı paylaşırsanız
kalan legacy kayıtlar için ne yapılacağına birlikte karar veririz.

---

## Davranış değişiklikleri — kullanıcıya yansıyanlar

- **Parola değişimi artık ANINDA etkili.** Eskiden refresh token iptal ediliyor ama eldeki access
  token 60 dakikaya kadar çalışmaya devam ediyordu. Artık damgadan (`SecurityStampUtc`) eski
  üretilmiş access token'lar reddediliyor. Damga en fazla **30 saniyelik** önbellekle okunur, yani
  parola değişimi en geç 30 sn içinde tüm cihazlarda oturumu düşürür. Kullanıcı yeniden giriş yapar.
  Deploy anında kimse atılmaz: `iat` alanı olmayan (eski) token'lar kabul edilmeye devam eder,
  süreleri dolunca doğal olarak yenilenirler.

- **Satış iptali artık doğru randevuyu kapatıyor.** Randevu, dayandığı paket seansını taşıyor;
  müşterinin aynı hizmeti içeren iki paketi varsa yalnızca iptal edilen satışın randevusu kapanır.
  Deploy öncesi oluşturulmuş randevularda bağ boş olduğu için eski sezgisel davranış sürer.
