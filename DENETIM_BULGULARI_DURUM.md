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
