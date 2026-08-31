# Denetim Bulguları — Durum Raporu

**Taban sürüm:** `96b2e42` · **Tarih:** 12 Ağustos 2026

Doğrulama: backend `dotnet build` 0 hata · `dotnet test` **443/443 geçti** · web `tsc` temiz ·
`vitest` **123/123 geçti** · `next build --webpack` başarılı · mobil `flutter analyze lib` temiz.

Web'de yapılan her değişiklik aynı turda **mobile de** uygulandı (parite kuralı).

---

## Kapatılanlar

### Tahsilat / finansal bütünlük

| # | Bulgu | Yapılan |
|---|---|---|
| 2 | Fazla ödemede arayüz–backend çelişkisi | Tutar borcu aşınca **onay kutusu** çıkar; işaretlenirse `allowOverpayment` gönderilir. 5 çağrı yerinin hepsi alanı iletiyor. Onaysız gönderim istemcide durur. (web+mobil) |
| 3 | Kayıt sürerken form resetlenip ikinci gönderim | `submittingRef` kapısı: gönderim uçuşta iken `accounts` tazelemesi formu sıfırlamıyor, `saving` düşmüyor. |
| 4 | Eşit vadede dağıtım sırası deterministik değil | Kuyruk sıralamasına **hesap kimliği + taksit no** tie-breaker'ı eklendi (web+mobil). Giriş sırası artık dağıtımı değiştirmiyor — 2 yeni test sabitliyor. |
| 5 | "Bu ayın taksitleri" açıklaması yanlış | Etiket gerçek davranışı yazıyor: *"ay sonuna kadar vadesi gelen borçlar · en eski vadeden başlar"*. |
| 6 | Web/mobil aynı seçeneği farklı anlatıyor | Mobil çipler web ile **birebir** aynı metne getirildi (açıklama satırı da eklendi). |
| 8 | Yöntem değişince peşinat 2. kez ekleniyor (200→400 ₺) | Yazılan peşinat kalemi hatırlanıyor; tekrar denemede tutar/yöntem değiştiyse **eski kalem silinip** yenisi yazılıyor. Aynıysa hiç dokunulmuyor. (web+mobil) |
| 9 | Idempotency tuzu refresh/restart'ı atlatamıyor | Tuz artık kalıcı (web `localStorage`, mobil `FlutterSecureStorage`), 12 saat TTL. **Başarıda silinir** → meşru tekrar hâlâ mümkün. Ayrıca **bilinçli kapatmada** (Vazgeç/X, sheet dispose) düşer: sunucu 4xx'i kaydettiği için tuz hiç düşmeseydi kullanıcı aynı tahsilatı TTL boyunca bir daha deneyemez, belgelenmiş "kapat-aç" kaçış kapısı kapanırdı. Kaza (yenileme/çöken sekme) tuzu korur. |
| 10 | Retry'de eski/düzenlenmiş kalem birleşmesi | 8 ve 9'un birlikte çözümü; peşinat artık ekleme değil değiştirme. |
| 22 | Aynı tarihli borçlar toplanmıyor (500/700 → 1.200) | `nextDueAmount` aynı vadede **toplanıyor** (web+mobil), testle sabitlendi. |

### Geçmiş evrak aktarımı

> Eski tarih (2015/2020) **hata değildir** — kural: `satış tarihi ≤ seans tarihi ≤ bugün`.

| # | Bulgu | Yapılan |
|---|---|---|
| 11 | Evrak içi kronoloji doğrulanmıyor | Kural backend + web + mobilde uygulanıyor; hata mesajı **hangi satırın** bozuk olduğunu söylüyor. Tarih seçicilerin alt sınırı artık satış günü. |
| 12 | Gelecek tarih sessizce clamp'leniyordu | Kullanıcının girdiği gelecek tarih artık **reddediliyor**. Clamp yalnız *türetilmiş* tarihlerde (satış + n×aralık) kaldı — orada doğru davranış. |
| 13 | Web UTC, mobil yerel gün kullanıyor | Web de yerel güne geçti; iki istemci aynı günü görüyor. |
| 14 | Başka şubenin personeli geçmiş seansa atanabiliyor | Personelin şubesi satışın şubesiyle karşılaştırılıyor. Kapı **randevu açmaya bağlı değil** — `SetAppliedBy` her hâlde yazıldığı için "seansı kim yaptı" bilgisi randevu açılmasa da raporlara giriyor. **Hard block değil**: sistem tarihsel şube ataması tutmadığı için kullanıcı "o tarihte bu şubedeydi" onayı verebiliyor (`AllowCrossBranchStaff`). |
| 15 | Aktarım tek transaction değil | `CreateHistoricalAsync` tek transaction: cari + tahsilatlar + seanslar + geçmiş randevular. Randevu adımı düşerse **para tarafı da yazılmıyor**. |
| 16 | Tarih/aralık değişince seanslar bayat kalıyor | Satırlar `dateEdited` taşıyor: türetilmiş tarihler yeniden hesaplanıyor, **elle girilen tarih asla ezilmiyor** (web+mobil). |
| 17 | "Hepsini yapan" şube doğrulamıyor | 14'teki kapı toplu seçimi de kapsıyor. |

### Muhasebe / rapor doğruluğu

| # | Bulgu | Yapılan |
|---|---|---|
| 18–19 | "Aylık Ciro" vade ayına yazıyor | **İki ayrı seri** (sizin kararınız): `Collected` = tahakkuk (vade ayı), yeni `CollectedInMonth` = tahsilat (ödemenin gerçekleştiği ay). Grafik artık **kasaya gireni** çiziyor, ipucunda "bu ayın vadesi X/Y" ayrı satır. (web+mobil) |
| 20 | Aynı response kendi içinde çelişiyor | `CollectedThisMonth` ile aylık seri **aynı kuraldan** hesaplanıyor. |
| 21 | Grace period grouped görünümlerde yok | Rozetler (tahsilat kuyruğu + taksit satırı) artık **yalnız** kanonik `overdue` bayrağını kullanıyor. ⚠️ Aylık takvim ızgarası **bilerek hariç** — aşağıya bakın. |
| 23 | Rapor hatası "veri yok" gibi görünüyor | Hata artık ayrı durum: *"Ciro raporu yüklenemedi… gerçek veriyi göstermiyor"*. (web+mobil) |

### Güvenlik / erişilebilirlik

| # | Bulgu | Yapılan |
|---|---|---|
| 26 | Allowlist yalnız host düzeyinde | Port (**yalnız 443**) ve **kullanıcı bilgisi yasağı** eklendi; SMS + ödeme aynı kapıdan geçiyor. |
| 27 | Redirect takibi güvenli değil | Iyzico/SMS/WhatsApp/FCM istemcilerinde `AllowAutoRedirect = false`. Allowlist'i atlatan 302 kaçağı kapandı. |
| 33–36, 41 | Kontrast | Ölçüm doğrulandı. Menekşe `#8E7882`→`#85717A`, yeşil `#1E8C60`→`#1D865C` (**%94–96**, gözle fark edilmez) → küçük beyaz metin **4,53 / 4,55** ile AA'yı geçiyor. Altın metin `#c99a2e`→`#937022` (**4,58**). Grafik seri renkleri değişmedi. |
| 37 | `bg-white/22` üretilmiyor | **Doğrulandı** (Tailwind 3.4 opaklık ölçeğinde 22 yok — sınıf hiç üretilmiyordu). `bg-white/20` yapıldı, 3 dosya. |
| 38 | Reduced-motion uygulanmıyor | `MotionConfig reducedMotion="user"` kök layout'ta — CSS media sorgusunun ulaşamadığı **Framer Motion** animasyonları da tercihe uyuyor. |
| 39 | Toplu personel select'inin etiketi yok | `htmlFor`/`id` ile programatik bağ kuruldu. |
| 40 | Modal dialog/focus semantiği yok | `role="dialog"` + `aria-modal` + başlık bağı + **focus trap** + odağın çağırana geri verilmesi. |
| 43–45 | nanoid (high), dompurify, uuid | `npm audit fix` uygulandı → **high bulgu kalmadı**. |

---

## Bilinçli olarak DEĞİŞTİRİLMEYENLER

**Madde 21'in bir kısmı — aylık takvim ızgarası.** Grace toleransını orada uygulamak, kodda
gerekçesi yazılı ve **testle sabitlenmiş** bir ürün kararını bozuyordu: rozet *"borç resmen
gecikti mi"* sorusunu (tolerans uygulanır), ızgara ise *"geçen ayın parası geldi mi"* sorusunu
cevaplıyor. Toleransı ızgaraya taşıyınca `buildMonthlySchedule` testi kırıldı — bu bir gözden
kaçma değil, iki farklı soru. Rozetlerdeki gerçek tutarsızlık düzeltildi, ızgaranın davranışı
korunup **neden farklı olduğu koda yazıldı**.

**Madde 33–36'da yöntem farkı.** "Yalnız metni koyulaştır" dediniz; menekşe/yeşil bantlarda bu
matematiksel olarak imkânsız: beyaz zaten en açık ton ve koyu metin **daha kötü** (`#2A2027`
→ 3,87 ve 3,73). Marka kimliğini koruyan tek yol bandı %5 koyultmaktı.

---

## Kapatılamayanlar — sizin kararınız/erişiminiz gerekiyor

| # | Konu | Neden |
|---|---|---|
| 1, 7 | "Tümü" tahsilatı atomik değil | **Toplu uç yazılmasına karar verdiniz, henüz yazılmadı.** `POST /accounts/collect-batch` (tek transaction + tek idempotency + tek pending-operation) + web/mobil geçişi ayrı bir iş kalemi. Bu tur kısmi-hata *penceresini daralttı* (3 ve 9), ama kısmi commit riski **duruyor**. |
| 24 | Mutation sonrası refresh düşerse eski aksiyonlar açık kalır | Genel bir tazeleme/geçersizleştirme deseni; tek ekran düzeltmesi değil. |
| 25 | Eski iptal snapshot'larında fiyat provenance'ı | Yalnız *eski formatlı* arşiv kayıtlarını ilgilendiriyor; canlı veriye bakmadan güvenli düzeltme yazılamaz. |
| 28 | Callback URL / proxy güven sınırı | Prod'da `ForwardedHeaders__TrustAll` kapalı. Uçtan uca güvence **dağıtım yapılandırması** (nginx/proxy zinciri) gerektiriyor. |
| 29 | Callback rate-limit çoklu replica | Replica başına limit. Dağıtık davranış ancak **çok-replica ortamda** doğrulanabilir/çözülebilir (paylaşımlı sayaç → Redis). |
| 30 | Tenant kredi/top-up checkout yetki sınırı | "Kim satın alabilir" **iş kuralı** kararı gerekiyor. |
| 31 | Iyzico Non-3DS prod akışı | **Gerçek merchant hesabı** ve canlı işlem gerekiyor. |
| 32 | Unknown/processing sonucu için recovery | 28–31 ile birlikte, canlı sağlayıcı davranışına göre tasarlanmalı. |
| 46 | exceljs → eski uuid | Yalnız `npm audit fix --force` ile çözülüyor; **exceljs'te kırıcı sürüm değişikliği** demek. Excel içe/dışa aktarma bu üründe kritik — onayınız olmadan zorlamadım. |

---

## Not

Bu turda, çalışmamla ilgisiz olarak `CustomerLedgerModal.tsx` · `lib/accountStatement.ts` ·
`reportPdf.ts` · `vitest.config.ts` · `on-muhasebe/page.tsx` üzerinde **başka bir oturuma ait**
"cari hesap ekstresi" değişiklikleri çalışma ağacında duruyordu. Onlara dokunmadım.


---

# Pentest Turu — 27 Ağustos 2026

**Taban sürüm:** `ba08aa5` · Kapsam: `BeautyAsist Pentest Raporu — 2026-08-27`

Kullanıcı talebi: **Apple'ın mağaza incelemesi için istediği madde (YÜKSEK-1) HARİÇ** tüm bulgular kapatıldı.

Doğrulama: backend `dotnet build` 0 hata · `dotnet test` **674/674 geçti (0 atlandı — gerçek MySQL ile)** ·
web `tsc` temiz · `vitest` **149/149 geçti** · `next build --webpack` başarılı · `npm audit` **0 açık**.

## Bulgu bazında durum

| Bulgu | Durum | Yapılan |
|---|---|---|
| **YÜKSEK-1** — mağaza-inceleme sabit OTP yolu | **KAPSAM DIŞI (sizin kararınız)** | Apple incelemesi için gerekli olduğundan dokunulmadı. Rapordaki not geçerli: inceleme biter bitmez eski `CustomerOtp:StoreReview*` anahtarları sunucudan kaldırılmalı. |
| **YÜKSEK-2** — BranchManager kardeş şubenin kataloğunu yönetebiliyor | **KAPATILDI** | İki kapı birden: (1) tekil **GET/PUT/DELETE** (+ paket iptal/geri-al/kategori) artık liste ile aynı kapsam sorgusundan geçiyor — `InScope(tenantId)`; (2) **INSERT** ayrıca doğrulanıyor (`BranchScopeGuard`): kapsam sorgusu okumayı süzer, INSERT'i süzmez. 14 yeni test. |
| **ORTA-1** — HSTS yok | **KAPATILDI** | Panel (`next.config.js`) + API (`UseHsts`). **Ömür 300 sn ile başlıyor**, `preload` yok. Uzatma adımları + nginx örneği `CANLI_DEPLOY_NOTLARI.md`'de. |
| **ORTA-2** — CSP script kaynaklarını kısıtlamıyor | **KAPATILDI (script tarafı)** | Nonce + `strict-dynamic` tabanlı politika (`Frontend/proxy.ts`). Ön koşul olarak kök layout `await connection()` çağırıyor. Access token taşınması yapılmadı — aşağıya bakın. |
| **ORTA-3** — exceljs → savunmasız uuid | **KAPATILDI** | `overrides: { "uuid": "$uuid" }` → transitif uuid 8.3.2 yerine kök bağımlılıktaki 14.x. `npm audit` temiz, `require('exceljs')` ve production build doğrulandı. (Eski #46 maddesi de bu turda kapandı.) |
| **DÜŞÜK-1** — `/api/auth/login-scope` doğrulayıcısı bağlı değil | **KAPATILDI** | `.ValidatesRequest<LoginScopeRequest>()` bağlandı; mesajlar Türkçeleştirildi (metin doğrudan giriş ekranında görünüyor). |
| **DÜŞÜK-2** — health uçları + trace ID anonim | **KAPATILDI** | Üç uçtan da `traceId` kaldırıldı (zarf biçimi korundu — dış uptime kontrolleri kırılmasın). `/health/ready` hata KODU (`SchemaOutOfDate`, `PaymentConfigInvalid` …) yalnız güvenilen yoklayıcıya (loopback ya da `Health:ProbeToken`) açılıyor; diğerlerine `NotReady`. **Fail-open:** token tanımsızsa uç kapanmaz, yalnız kod genelleşir. |
| **DÜŞÜK-3** — hata yanıtları proxy mimarisini açıklıyor | **KAPATILDI** | `/api`, `/api/proxy` → `{status:"ok"}`; 404 metni yol adını yankılamıyor ve "/api/proxy ile başlamalı" ipucunu vermiyor. |

## Raporda OLMAYAN, bu turda bulunan

- **Kampanyalar aynı açığın kopyasıydı.** `Campaign.BranchId` var ama hiçbir sorguda uygulanmıyordu:
  şube yöneticisi kardeş şubenin kampanyasını listeleyip değiştirebiliyor ve silebiliyordu. Hizmet/paket ile
  **aynı desenle** kapatıldı (`InScope` + create doğrulaması), testi de yazıldı.
- **Kurumlar arası `BranchId` enjeksiyonu.** Yabancı bir kurumun şube kimliğiyle katalog kaydı açılabiliyordu
  (FK `Restrict` buna izin verir — şube gerçekten vardır, yalnız başka kurumundur). Artık kurum sahibi için de
  reddediliyor.

### Aynı sınıf — bakıldı, kapatılmadı (gerekçesiyle)

`BranchId` taşıyıp global şube süzgeci **olmayan** tüm varlıklar tek tek incelendi:

| Varlık | Neden dokunulmadı |
|---|---|
| `PendingOperation` | Kapsam servis katmanında **açıkça** uygulanıyor (`OutOfBranchScope`, önceki denetimde kapatıldı). |
| `TenantUser` | Yalnız **şube süzgeçli** `StaffMember` üzerinden erişiliyor; doğrudan uç yok. |
| `AuditLog`, `NotificationLog` | Kurum düzeyinde denetim/gönderim kaydı — şubeye daraltmak kasıtlı davranışı değiştirir. |
| `NotificationTemplate` | Kurum geneli şablon; şubeye daraltmak ürün kararıdır. |
| `AppNotification` | Kullanıcı bazlı; alıcı kimliğiyle süzülüyor. |
| `AppointmentRating` | Tek kullanımlık **token** ile anonim erişilen uç; şube kapsamı anlamsız. |

## Bilinçli kararlar (eksik değil, tercih)

1. **Kurala global query filter DEĞİL, uç seviyesinde uygulandı — ölçümle.**
   İlk uygulamada kapsam `GuzellikDbContext`'e global süzgeç olarak konmuştu; daha temiz görünüyor
   ve tüm sorguları tek noktadan kapsıyordu. **Geliştirme veritabanında ölçüldü: şubesi FARKLI bir
   hizmete işaret eden 7 randevu var.** Bu referanslar üretilebiliyor çünkü kurum sahibi şube
   değiştirebiliyor ve `AppointmentService.PinnedBranchId` ona kapsam koymuyor. Global süzgeçle o
   randevular kendi şubelerinde **adı boş** görünürdü (projeksiyon `LEFT JOIN` üretiyor) — güvenlik
   kazancı olmadan görünür veri kaybı. Kural bu yüzden katalog uçlarında duruyor; kimlikle okuyan iç
   yollar (randevu/adisyon/seans/rapor) tenant geneli kaldı. Yön bir testle sabitlendi:
   `CatalogLookupById_StaysTenantWide_SoHistoricReferencesKeepResolving`.
2. **Kurum geneli (`BranchId = null`) katalog kaydına yazma şube yöneticisine AÇIK bırakıldı.**
   Rapor bunu Owner'a kapatmayı öneriyordu; uygulanmadı çünkü (a) tek şubeli ve eski kurumların **tüm**
   kataloğu `BranchId = null`'dır — kapatmak onları kilitlerdi, (b) personelin onaya düşen isteği onaylandığında
   **personelin kapsamıyla** replay edilir (`IApprovalReplayer`), yani kural onay akışını da kırardı.
   Kanıtlanan açık kardeş-şube erişimiydi ve o kapandı.
3. **Access token hâlâ Web Storage'da.** Refresh token zaten HttpOnly çerezde (`/api/proxy` katmanı).
   Access token'ı çereze taşımak; JWT claim'lerinden beslenen tüm arayüz yetki kapılarını, SignalR
   bağlantısını ve mobil/masaüstü istemcileri kapsayan ayrı bir iş kalemidir. CSP artık script
   enjeksiyonunun **çalışmasını** engellediği için zincirin ilk halkası koptu; kalan risk 60 dk ömürlü
   access token'dır.
4. **CSP `style-src 'unsafe-inline'` içeriyor.** framer-motion/gsap satır-içi `style` yazar; bulgunun
   konusu script kaynaklarıdır.

## Yayın öncesi dikkat

- **Kök layout artık `await connection()` çağırıyor** → tüm sayfalar istek anında render ediliyor
  (önceden çoğu statikti). Nonce'un ön koşulu budur; ölçüm: TTFB ~10-20 ms → ~15-30 ms.
  Statik üretimi geri açarsanız **CSP'yi de kapatmanız gerekir**, aksi hâlde beyaz ekran olur.
- `HSTS_MAX_AGE` **build zamanında** okunur (frontend). Uzatmak için yeniden build gerekir.
