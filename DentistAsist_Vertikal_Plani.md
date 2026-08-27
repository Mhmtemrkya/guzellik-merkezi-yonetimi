# DentistAsist — Diş Kliniği Dikeyine Dönüşüm Planı

**Tarih:** 20 Ağustos 2026 · **Kaynak ürün:** BeautyAsist (bkz. `BeautyAsist_Urun_Plani.md`)
**İlke:** Backend çekirdeği korunur; frontend terminoloji + görünürlük katmanıyla dönüştürülür; **klinik çekirdek (diş şeması + tedavi planı) yeni backend işidir.**
**Kardeş belge:** `Avukat_Vertikal_Plani.docx` (LexAsist) — aynı dikey altyapısını paylaşır.

---

## 0. Strateji özeti ve konumlandırma

### 0.1 Ne aynen taşınır (ücretsiz kazanç)

BeautyAsist'in çekirdeği bir diş kliniğine **birebir** uyar ve bugün çalışıyor:

| Mevcut yetenek | Diş kliniğindeki karşılığı | Durum |
|---|---|---|
| Cari + taksit + tahsilat dağıtımı | Taksitli tedavi (implant, ortodonti 12–24 ay) | Aynen |
| Adisyon | Hasta tedavi hesabı | Aynen |
| Onam formu şablonu + tablet imza + imzalı PDF | **Aydınlatılmış onam** — diş hekimliğinde işlem başına yasal zorunluluk | Aynen — **en değerli hazır parça** |
| `CustomerTreatmentPhoto` (Önce/Sonra) | Ağız içi klinik fotoğraf + radyografi arşivi | Aynen (etiket değişir) |
| Konsültasyon/anamnez + kontrendikasyon uyarısı | Dental anamnez (sistemik hastalık, antikoagülan, bifosfonat, alerji) | Alan seti değişir |
| Prim/komisyon | Hekim hakediş yüzdesi — sektörün standart çalışma modeli | Aynen |
| Bekleme listesi + otomatik teklif | İptal olan koltuğu doldurma | Aynen |
| Çizelge + izin + mesai | Hekim mesaisi | Aynen |
| Stok + hareket | Sarf (kompozit, anestezi, frez, eldiven) — dişte **daha kritik** | Aynen + lot takibi |
| WhatsApp/SMS hatırlatma | Randevu + kontrol çağrısı (recall) | Aynen |
| Şube kapsamı | Çok şubeli klinik zinciri | Aynen |
| Onay/taslak akışı | Asistanın işlemi hekim onayına düşer | Aynen |
| Raporlar (9 sekme) | Aynı | Aynen |

### 0.2 Ne yeni yazılmalı (klinik çekirdek)

Bu üçü olmadan ürün **"diş kliniği yönetim yazılımı" iddiası taşıyamaz**:

1. **Odontogram (diş şeması)** — FDI iki haneli numaralandırma, diş yüzeyi bazlı durum.
2. **Diş bazlı tedavi planı** — teklif → onay → çok seanslı uygulama.
3. **Ünit (koltuk) planlaması** — randevu kaynağı hekimden ayrı bir kaynaktır.

3. madde zaten BeautyAsist'in B fazındaki **`Resource` (oda/cihaz)** işidir. Yani dikey, ana ürünün
yol haritasındaki bir işi paylaşır — **önce orada yapılır, burada tüketilir.**

### 0.3 Konumlandırma — v1 ne diyebilir, ne diyemez

> **v1 iddiası:** "Diş kliniği **randevu, hasta ve ön muhasebe** yönetimi — taksitli tedavi takibi,
> aydınlatılmış onam, hekim hakedişi ve klinik ajandası."
>
> **v1'in söyleyemeyeceği:** "Diş hekimliği klinik yazılımı" / "hasta kayıt ve tedavi takip sistemi".
> Odontogram ve diş bazlı tedavi planı gelmeden bu iddia **satış sonrası iade sebebi** olur; hekim
> ilk demoda diş şemasını sorar.

### 0.4 Marka ve palet

- **Ad:** DentistAsist · yazım tek kelime, tek "s" (BeautyAsist deseni).
- **Palet:** klinik teal/mint (`#0E7C7B` ailesi) + slate/antrasit; bordo (`#6C243C`) **güzellikte kalır**,
  hukukta lacivert. Renk üç dikeyi birbirinden ayıran ilk sinyaldir.
- **İkon seti:** `ServiceIcons.tsx` güzellik temalıdır (makas, fırça...). Diş için ayrı set: diş, kanal,
  implant, ortodonti, cerrahi, protez, pedodonti.

---

## 1. Terminoloji sözlüğü

Bu tablo `lib/terminology.ts`'in içeriğidir; tüm arayüz metni buradan okunur.

| Anahtar | Güzellik (mevcut) | Diş (DentistAsist) |
|---|---|---|
| `customer` | Müşteri / Danışan | **Hasta** |
| `customerPlural` | Müşteriler | Hastalar |
| `appointment` | Randevu | Randevu |
| `session` | Seans | **Tedavi seansı** |
| `service` | Hizmet | **İşlem** (tedavi kalemi) |
| `package` | Paket | **Tedavi planı** |
| `staff` | Personel | **Hekim / Klinik personeli** |
| `staffPrimary` | Uzman | **Hekim** |
| `staffAssistant` | — | **Asistan** (yeni rol boyutu) |
| `branch` | Şube | **Klinik** |
| `venue` | Salon | **Klinik / Muayenehane** |
| `adisyon` | Adisyon | **Tedavi hesabı** |
| `consultationForm` | Konsültasyon / Bilgi formu | **Anamnez ve muayene formu** |
| `treatmentJournal` | Tedavi günlüğü (Önce/Sonra) | **Klinik görüntü arşivi** (foto + radyografi) |
| `resource` | Oda / Cihaz | **Ünit (koltuk)** |
| `consentForm` | Onam formu | **Aydınlatılmış onam formu** |
| `catalog` | Katalog | **İşlem listesi** |
| `commission` | Prim | **Hakediş** |
| `waitlist` | Bekleme listesi | Bekleme listesi |
| `passiveCustomer` | Pasif müşteri | **Kontrolü gecikmiş hasta** (recall) |
| `loyalty` | Sadakat puanı | *(kapalı)* |
| `giftCard` | Hediye çeki | *(kapalı)* |
| `showcase` | Salon vitrini | **Klinik bilgi sayfası** *(kısıtlı — §7)* |

> **Türkçe tuzağı:** sözlük değerleri arama/sıralamada `toLocaleLowerCase('tr')` ile karşılaştırılır
> (İ/I). Sidebar araması bunu zaten yapıyor; yeni yüzeyler de yapmalı.

---

## 2. Dikey altyapısı — teknik omurga

Bu bölüm hem DentistAsist hem LexAsist için **ortak** kurulur; iki dikey aynı anahtarları kullanır.

| Katman | Ne eklenir |
|---|---|
| **Backend** | `Tenant.VerticalType` enum kolonu (`Beauty` · `Dental` · `Law` · `Clinic`) + migration. `TenantDto` ve `/api/admin/tenant` yanıtına eklenir. `CreateTenantDialog` ve `/kayit` akışına dikey seçimi. |
| **Özellik preset'i** | Dikey başına varsayılan `SubscriptionPlan.Features` seti. Kapatılanlar (`marketing.giftcards`, `loyalty.points`) plandan çıkarılır — **kod silinmez**, yalnız kapatılır. |
| **Frontend sözlük** | `lib/terminology.ts` + `useTerminology()` hook'u (`FeatureContext` ile birebir aynı desen: tenant'tan gelir, provider'da tutulur, sunucu doğrular). |
| **Menü görünürlüğü** | `SidebarNavItem`'a `verticals?: VerticalType[]`. `featureKeys` ile **aynı filtre hattı**. |
| **Rota kapısı** | `ROUTE_VERTICAL_GUARDS` — gizlenen sayfaya doğrudan URL ile de girilemez (mevcut `ROUTE_FEATURE_GUARDS` ikizi). |
| **Tema** | `globals.css` değişkenleri dikeyden; logo/isim tenant'tan. |
| **Şablon seed'leri** | Bildirim/WhatsApp şablonları ve onam şablonları dişe özgü metinlerle. |
| **Mobil** | Aynı sözlük `mobile/lib/core/terminology.dart`; `AppShell` menüsü aynı filtreyi uygular. |

**Kritik kural:** sunucu, dikeye kapalı bir özelliğin ucunu da kapatır (`IsFeatureAllowedAsync` deseni,
409). Yalnız menüyü gizlemek yeterli değildir — bugünkü paket gating'de bu doğru kurulmuş, dikey de
aynı hattı kullanmalı.

---

## 3. Sayfa bazlı plan

Karar sözlüğü: **KALIR · DEĞİŞİR · YENİ · KAPALI** (dikey preset'inde kapatılır, kod silinmez).

### 3.1 Kurum (klinik) yöneticisi paneli

| Sayfa (rota) | Karar | Diş versiyonu — ne değişir | Mobil |
|---|---|---|---|
| `/panel` Dashboard | DEĞİŞİR | KPI'lar: "Bugünkü randevu" kalır · "Bugünkü ciro" kalır · **"Bekleyen tedavi planı"** · **"Laboratuvardan gelecek iş"** · **"Kontrolü gecikmiş hasta"** eklenir. Paket satışı kartı → **kabul edilen tedavi planı tutarı**. | Aynı |
| `/panel/musteriler` → **Hastalar** | DEĞİŞİR | Liste sütunları: hasta no · ad · telefon · **son muayene** · **açık tedavi planı** · bakiye. Sekmeler: Tümü · KVKK onaylı · **Kontrolü gelenler (recall)** · Yeni. "Kara liste" → **"Randevuya gelmeyen"** sayacı (tıbbi hizmet reddi hassastır, etiket yumuşatılır). | Aynı |
| `/panel/randevular` | DEĞİŞİR | Randevuya **iki personel** boyutu gelir: hekim + asistan. **Ünit (koltuk)** sütunu zorunlu hâle gelir. Randevu tipi: Muayene · Tedavi · Kontrol · Acil · **Protez provası**. | Aynı |
| `/panel/personel/cizelge` | DEĞİŞİR | Ajanda **ünit bazlı** görünüm kazanır (satır = ünit, sütun = saat). Hekim bazlı görünüm korunur; ikisi arasında geçiş. | Aynı |
| `/panel/paketler` → **İşlem Listesi & Tedavi Planları** | DEĞİŞİR | "Hizmet" → **İşlem**; kategoriler dişe göre: Teşhis/Muayene · Koruyucu · Restoratif (dolgu) · Endodonti (kanal) · Periodontoloji · Cerrahi/Çekim · İmplantoloji · Protez · Ortodonti · Pedodonti · Estetik. Her işleme **varsayılan diş yüzeyi** ve **süre** alanı. | Aynı |
| `/panel/stok` | DEĞİŞİR | **Lot/seri no + son kullanma tarihi** alanları eklenir (implant ve steril malzemede izlenebilirlik gerekliliği). Sarf reçetesi dişte kritik: bir dolgunun kompozit + anestezi + eldiven tüketimi. | Aynı |
| `/panel/on-muhasebe` | KALIR | Terminoloji dışında değişmez. Taksitli tedavi bu ekranın **en güçlü olduğu yer**. | Aynı |
| `/panel/kasa`, `/panel/kasa-kapanis` | KALIR | — | Aynı |
| `/panel/raporlar` | DEĞİŞİR | Sekmeler: Genel · **İşlem** (Katalog yerine) · **Hekim** (Personel yerine) · Klinikler · Hastalar · Stok · Karşılaştırma. GiftCards sekmesi **kapalı**. **Yeni: Laboratuvar** sekmesi (dış maliyet). | Aynı |
| `/panel/onaylar` | KALIR | Asistan → hekim onayı akışı aynı. | Aynı |
| `/panel/personel` → **Hekim & Ekip** | DEĞİŞİR | Personel tipi: **Hekim · Asistan · Resepsiyon · Teknisyen**. Hekimde **diploma/uzmanlık ve tescil no** alanı. Hakediş yüzdesi hekim bazlı. Yetkinlik matrisi burada **branş** olur (endodonti, ortodonti...). | Aynı |
| `/panel/bekleme-listesi` | KALIR | İptal olan koltuğu doldurma — dişte değeri yüksek. | Aynı |
| `/panel/bildirimler` | DEĞİŞİR | Şablonlar dişe göre: randevu hatırlatma · **6 ay kontrol çağrısı** · **protez provası hatırlatması** · tedavi sonrası bakım talimatı. | Aynı |
| `/panel/loglar` | KALIR | Sağlık verisinde denetim izi **daha önemli** — kapatılmaz. | Aynı |
| `/panel/ayarlar` | DEĞİŞİR | KVKK kartı: **özel nitelikli veri** açık rıza metni (§7.2). Onam şablonları dişe özgü seed'lerle gelir. | Aynı |
| `/panel/abonelik` | KALIR | (BeautyAsist'te `/panel/paket`ten yeniden adlandırılıyor.) | Aynı |
| `/panel/hediye-cek` | **KAPALI** | `marketing.giftcards` dikey preset'inde yok. Kod durur. | Kapalı |
| `/panel/salon-profili` → **Klinik Bilgi Sayfası** | DEĞİŞİR | §7.1'deki reklam kısıtı nedeniyle **pazarlama vitrini değil bilgi sayfası**: adres, çalışma saati, hekim kadrosu, iletişim, online randevu. Kampanya/indirim ve hasta yorumu **yayınlanmaz**. | Yok (parite açığı devralınır) |
| **YENİ — `/panel/tedavi-planlari`** | **YENİ** | Klinik geneli plan kuyruğu: teklif edildi · kabul edildi · uygulanıyor · tamamlandı · reddedildi. Kabul oranı klinik yönetiminin ana metriği. | Eklenir |
| **YENİ — `/panel/laboratuvar`** | **YENİ** | Dış laboratuvara giden işler: hasta · diş · iş türü (kron/köprü/protez) · lab · gönderim · beklenen dönüş · prova randevusu · maliyet. | Eklenir |
| **YENİ — `/panel/sterilizasyon`** *(v2)* | **YENİ** | Otoklav döngü kaydı, alet seti barkodu, hangi hastada hangi set kullanıldı. Denetimde istenir. | v2 |

### 3.2 Personel (klinik ekibi) paneli — `/ekip`

| Rota | Karar | Ne değişir |
|---|---|---|
| `/ekip` | DEĞİŞİR | Hekim panosu: bugünkü hastaları, kendi hakedişi, **kendi bekleyen tedavi planları**. |
| `/ekip/seanslar` | DEĞİŞİR | "Seanslarım" → **"Tedavi seanslarım"**; satırda diş numarası görünür. |
| `/ekip/profil` | KALIR | + kendi cihazlarım (ana üründen devralınır). |
| Re-export'lar | KALIR | Desen korunur; dikey filtresi menüde uygulanır. |
| `/ekip/hediye-cek` | **KAPALI** | — |

### 3.3 Platform paneli

| Rota | Karar | Ne değişir |
|---|---|---|
| `/platform/kurumlar` | DEĞİŞİR | Kurum kartında **dikey rozeti** (Güzellik / Diş / Hukuk). Filtre eklenir. |
| `/platform/planlar` | DEĞİŞİR | Plan tanımına **dikey** alanı: "Diş — Başlangıç / Klinik / Zincir". Özellik listesi dikeye göre süzülür. |
| Diğerleri | KALIR | Platform yüzeyi dikeyden bağımsızdır. |

### 3.4 Herkese açık yüzeyler

| Rota | Karar | Ne değişir |
|---|---|---|
| `/` landing | **AYRI** | Diş için ayrı landing (ayrı alan adı/tema). Sinematik yapı yeniden kullanılır, içerik ve görsel değişir. |
| `/moduller` | **AYRI** | Modül anlatımı dişe göre yazılır. |
| `/randevu`, `/randevu/giris` | DEĞİŞİR | Online randevu **muayene/kontrol** ile sınırlanır; tedavi randevusu hekim planına bağlıdır (hasta kendi kanal tedavisini planlayamaz). Randevu tipi seçimi eklenir. |
| `/salonlar`, `/salon/[slug]` | **KISITLI** | Dizin sayfası yalnız **bilgi**: klinik adı, adres, çalışma saati, online randevu. **Yıldız/yorum ve önce-sonra görseli yayınlanmaz** (§7.1). |
| `/rate/[token]` | DEĞİŞİR | Puanlama **iç kalite ölçümü** olarak kalır; sonuç panelde görünür, **vitrinde yayınlanmaz**. |
| `/imza` | KALIR | Tablet imza istasyonu — aydınlatılmış onam için birebir. |
| `/kvkk/[slug]` | DEĞİŞİR | Metin **özel nitelikli sağlık verisi** açık rızasını içerir. |
| `/hediye-kart/...` | **KAPALI** | — |
| `/odeme`, `/kayit`, yasal 4 sayfa | KALIR | Künye dikeye göre. |

---

## 4. Modal / dialog bazlı plan

138 bileşenin dikeydeki karşılığı. Tabloda yalnız **değişen veya kapanan** bileşenler ayrıntılıdır;
listelenmemiş her bileşen **KALIR (yalnız etiket sözlükten gelir)**.

### 4.1 Değişen bileşenler

| Bileşen | Karar | Diş versiyonu |
|---|---|---|
| `CustomerDetailModal` | **DEĞİŞİR (en büyük iş)** | Sekmeler: Genel Bakış · **Diş Şeması (odontogram)** · **Tedavi Planı** · Randevular · Hesap · **Anamnez** · **Görüntüler (foto + radyografi)** · Onamlar. "Sadakat" ve "Hediye çeki" sekmeleri kapanır. |
| `ConsultationForm` | **DEĞİŞİR (alan seti)** | Dental anamnez: sistemik hastalık (diyabet, hipertansiyon, kalp kapak), **antikoagülan/kan sulandırıcı**, **bifosfonat** kullanımı (ONJ riski), alerji (lokal anestezi, lateks, penisilin), hamilelik/emzirme, sigara, bruksizm, **endokardit profilaksisi gereği**. `SkinType`/Fitzpatrick alanı **kaldırılır** (`vertical==='beauty'` koşuluna alınır). |
| `ConsultationWarningBanner` | DEĞİŞİR | Kontrendikasyon motoru dental kurallarla beslenir: antikoagülan + cerrahi işlem → uyarı; bifosfonat + çekim/implant → uyarı; hamilelik + radyografi → uyarı. **Klinik karar desteği değil, hatırlatmadır** — metin bunu açıkça söyler. |
| `AppointmentEditor` | DEĞİŞİR | Alanlar: hekim · **asistan** · **ünit** · randevu tipi · **ilgili diş(ler)** · tedavi planı adımı bağı. |
| `DayScheduleModal` | DEĞİŞİR | Ünit bazlı satırlar; hekim rengi + ünit sütunu. |
| `CompleteAppointmentDialog` | DEĞİŞİR | Adım 0 onam kapısı **daha katı**: cerrahi/implant/kanal işlemlerinde imzalı onam yoksa tamamlama **engellenir** (güzellikte uyarıydı). Tamamlamada **odontogram güncellemesi** ve **sarf düşümü** aynı atomik uçta. |
| `PackageSaleDialog` → **TedaviPlaniDialog** | **DEĞİŞİR (yeniden yazılır)** | Paket = sabit seans adedi; tedavi planı = **diş bazlı satır listesi**. Yeni gövde: satır başına `diş no · yüzey · işlem · hekim · tutar`. Toplam + taksit planı mevcut altyapıdan gelir. Kupon/sadakat blokları kapanır. |
| `ServiceFormDialog` | DEĞİŞİR | İşleme: varsayılan diş yüzeyi, süre, **ünit gerekir mi**, sarf reçetesi, onam şablonu bağı. |
| `TreatmentJournal` | DEĞİŞİR | Görüntü türü: **intraoral foto · panoramik · periapikal · bitewing · CBCT**. Diş numarasıyla etiketlenir. Önce/Sonra kaydırıcısı kalır (klinik takip için değerli). |
| `CustomerSessionsCard` | DEĞİŞİR | "3 seans kaldı" → **"planın 3 adımı kaldı"**; satırda diş no. |
| `ConsentTemplatesCard` / `ConsentPicker` | DEĞİŞİR | Dişe özgü şablon seti seed'lenir: implant · cerrahi çekim · kanal tedavisi · ortodonti · protez · beyazlatma · lokal anestezi. |
| `StaffFormDialog` | DEĞİŞİR | Personel tipi (Hekim/Asistan/Resepsiyon/Teknisyen) · **tescil/diploma no** · branş · hakediş yüzdesi. |
| `ProductFormDialog` / `ProductDetailModal` | DEĞİŞİR | **Lot/seri no**, son kullanma tarihi, steril mi. |
| `ReportFilterBar` + rapor sekmeleri | DEĞİŞİR | Etiketler sözlükten; `GiftCardsTab` kapanır, **`LabTab`** eklenir. |
| `CreateTenantDialog` | DEĞİŞİR | **Dikey seçimi** eklenir (Güzellik / Diş / Hukuk) — preset ve tema bundan türer. |
| `Sidebar` | DEĞİŞİR | `verticals?: VerticalType[]` filtresi. |
| `ServiceIcons` | DEĞİŞİR | Diş ikon seti. |
| `KvkkConsentModal` / `KvkkSettingsCard` | DEĞİŞİR | Özel nitelikli veri açık rıza metni. |

### 4.2 Kapanan bileşenler (kod silinmez, preset'te kapalı)

| Bileşen | Neden |
|---|---|
| `GiftCardArtwork`, `GiftCardShareModal`, `GiftCardScanModal`, `GiftCardEditModal`, `GiftCardsTab` | Hediye çeki diş kliniğinde kullanılmıyor; sağlık hizmetinde promosyon aracı olarak kullanımı ayrıca kısıtlı (§7.1). |
| `LoyaltyCard` | Sağlık hizmetinde puan/ödül mekaniği uygun değil. |
| `CampaignPanel` | İndirim kampanyası — §7.1 kısıtı. |
| `CustomerVipToggle` | Etiket kalabilir ama pazarlama tonu arındırılır; öneri: **kapalı**, yerine "öncelikli hasta" notu. |
| `CustomerBlacklistCard` | Kavram olarak kalır ama **"randevuya gelmeyen"** sayacına dönüşür; hizmet reddi gerekçesi olarak sunulmaz. |
| `BeforeAfterSlider` (vitrin tarafı) | Panelde **kalır** (klinik takip); herkese açık sayfada **yayınlanmaz**. |

### 4.3 Yeni bileşenler (dişe özgü)

| Bileşen | Ne yapar | Efor |
|---|---|---|
| **`Odontogram`** | FDI numaralı 32 daimi + 20 süt dişi; diş başına 5 yüzey (M·D·O·B·L); durum boyama: sağlam · çürük · dolgulu · kanal · kron · köprü · implant · eksik · çekilecek. Tıklanınca işlem ekleme. Salt-okunur ve düzenlenebilir iki mod. | 🔴 |
| **`ToothStatusPopover`** | Tek dişin geçmişi: hangi tarihte hangi işlem, hangi hekim, hangi radyografi. | 🟡 |
| **`TreatmentPlanBuilder`** | Diş bazlı satırlardan plan kurar; alternatif planlar (A/B teklifi), toplam, taksit önizlemesi, hastaya imzalatılacak plan PDF'i. | 🔴 |
| **`LabOrderDialog`** | Laboratuvar iş emri: diş/işlem, lab seçimi, gönderim–dönüş tarihi, renk (shade), maliyet, prova randevusu bağı. | 🟡 |
| **`RadiographViewer`** | Görüntüyü büyütme/kontrast; diş numarasıyla etiketleme. (DICOM v3.) | 🟡 |
| **`PerioChart`** *(v3)* | Diş başına 6 nokta cep derinliği + kanama indeksi. | 🔴 |
| **`RecallPanel`** | Kontrolü geleni listeler (son muayeneden 6 ay), toplu hatırlatma gönderir. Pasif müşteri altyapısının dental hâli. | 🟢 |
| **`TreatmentPlanQueue`** | `/panel/tedavi-planlari` sayfasının ana bileşeni: klinik geneli plan kuyruğu (teklif · kabul · uygulanıyor · tamamlandı · reddedildi). | 🟡 |
| **`LabOrderBoard`** | `/panel/laboratuvar` sayfasının ana bileşeni: gönderilen/beklenen/gelen iş panosu. | 🟡 |
| **`SterilizationLog`** *(v2)* | `/panel/sterilizasyon` sayfasının ana bileşeni: otoklav döngü kaydı + set–hasta eşleşmesi. | 🟡 |
| **`TedaviPlaniDialog`** | `PackageSaleDialog`'un dental karşılığı — diş bazlı satır listesiyle plan satışı (§4.1'de ayrıca geçer). | 🔴 |

### 4.4 KALIR — yalnız etiket sözlükten gelir

Aşağıdaki **105 bileşen** dikeyde **davranış olarak değişmez**; içlerindeki sabit metinler `useTerminology()` üzerinden okunmaya çevrilir, kod mantığına dokunulmaz. §4.1–4.3'te adı geçen 33 bileşenle birlikte panel/rapor/platform bileşenlerinin **tamamı (138)** karara bağlanmıştır.

| | | | |
|---|---|---|---|
| `AccountDetailModal` | `AccountStatementSheet` | `AdisyonModal` | `AdisyonReceiptModal` |
| `AdminEditDialog` | `AnchoredPopover` | `AnimatedNumber` | `ApiStateNotice` |
| `AppointmentHelpDialog` | `AppointmentReminderControl` | `AppointmentsCalendarLinkButton` | `ApprovalToast` |
| `AuthContext` | `AutomationStatusPanel` | `BarcodeScanField` | `BranchContext` |
| `BranchSwitcher` | `BranchesTab` | `BulkSelectBar` | `CancelledSalesModal` |
| `CariSalesWorkspace` | `CatalogCategoryManager` | `CatalogCategoryRail` | `CatalogKit` |
| `CatalogPicker` | `CatalogSalesPanel` | `CatalogTab` | `CategoryExplorer` |
| `CheckoutClient` | `CollectionDialog` | `ComingSoon` | `CommissionPanel` |
| `CompareTab` | `ConfirmDialog` | `ConsentCenterModal` | `ConsentSaleNotice` |
| `ConsentWarningBanner` | `ConsultationFormModal` | `CustomerFormDialog` | `CustomerHistoryPanel` |
| `CustomerLedgerModal` | `CustomerOperationsJournal` | `CustomerPicker` | `CustomerReviewsCard` |
| `CustomerSalesModal` | `CustomerSalesPanel` | `CustomersTab` | `DailyAdisyonModal` |
| `DashboardHero` | `ExcelTransferActions` | `ExpenseFormDialog` | `FeatureGate` |
| `FeatureLockedCard` | `HistoricalSaleDialog` | `ImportDialog` | `InventoryTab` |
| `ManagerAppointmentInbox` | `MetricDetailContext` | `MetricDetailModal` | `MissingBackendModule` |
| `ModalPortal` | `NewAccountDialog` | `OverviewTab` | `PackageEditorModal` |
| `PackageLibrary` | `PackageReportBreakdown` | `PageGuide` | `PanelBackdrop` |
| `PanelKit` | `PassiveCustomersPanel` | `PaymentScheduleGrid` | `PlanFormDialog` |
| `PlatformMessagingSettings` | `ProductLibrary` | `QuickMenu` | `RatingQrModal` |
| `RealtimeContext` | `RealtimeToast` | `ReducedMotionProvider` | `ReportCharts` |
| `ReportUi` | `RouteGuard` | `SalaryPaymentDialog` | `SaleDetailModal` |
| `ScopeBadge` | `SecuritySettingsCard` | `ServiceDetailModal` | `ServiceLibrary` |
| `SessionExpiredModal` | `SessionProgressRing` | `SignaturePad` | `Sparkline` |
| `StaffCalendarLinkButton` | `StaffDeviceDialog` | `StaffTab` | `StaffWorkingHoursDialog` |
| `StatCard` | `SubscriptionCountdown` | `TenantCredentialsDialog` | `TenantFeaturedToggle` |
| `TenantGalleryDialog` | `Topbar` | `UsageBar` | `WhatsAppSettingsCard` |
| `WhatsAppWalletCard` |  |  |  |

> Etiket taraması bu listeye göre yapılır (Adım 3). Bir bileşende sabit metin kalırsa dikey yarım
> görünür: menü "Hasta" derken modal "Müşteri" der. Tarama bittiğinde `grep -rn "Müşteri\|Seans\|Salon"` panel bileşenlerinde
> **sıfır** eşleşme vermelidir (sözlük dosyası hariç).

---

## 5. Backend bazlı plan

### 5.1 Mevcut uçlar — dikeydeki karar

| Endpoint dosyası | Karar | Ne değişir |
|---|---|---|
| `CustomerEndpoints` (19) | DEĞİŞİR | `Customer` → hasta; `PatientNo` (klinik içi sıra no) alanı. Anamnez bağı. |
| `AppointmentEndpoints` (13) | DEĞİŞİR | `AssistantStaffId`, `ResourceId` (ünit), `AppointmentType`, `TreatmentPlanStepId` alanları. Çakışma kontrolü **hekim + ünit** iki boyutlu olur. |
| `ServiceDefinitionEndpoints` (5) | DEĞİŞİR | `DefaultToothSurfaces`, `RequiresResource`, `ConsentTemplateId`. |
| `ServicePackageEndpoints` (8) | **DEVRALINIR → TedaviPlani** | Paket kavramı diş planına evrilir; mevcut uçlar plan CRUD'una temel olur (kalem listesi zaten var, **diş/yüzey boyutu eklenir**). |
| `ConsentEndpoints` (16) | KALIR | Aynen — dikeyin en hazır parçası. |
| `ConsultationEndpoints` (4) | DEĞİŞİR | Alan seti dikey konfigürasyonundan; `SkinType` alanı beauty'ye kilitlenir. |
| `TreatmentPhotoEndpoints` (3) | DEĞİŞİR | `Kind` genişler (intraoral · panoramik · periapikal · bitewing · CBCT) + `ToothNumber`. |
| `StockEndpoints` (8) | DEĞİŞİR | `LotNumber`, `ExpiryDate`, `IsSterile`. |
| `StaffEndpoints` (8) | DEĞİŞİR | `StaffType`, `LicenseNumber`, `Specialty`. |
| `CustomerAccountEndpoints`, `AdisyonEndpoints`, `ExpenseEndpoints`, `CashFlow/CashClosing`, `CommissionEndpoints` | KALIR | Para tarafı aynen çalışır. |
| `WaitlistEndpoints`, `ScheduleEndpoints`, `NotificationEndpoints`, `WhatsAppEndpoints` | KALIR | — |
| `ReportsEndpoints` (7) | DEĞİŞİR | `GET /lab` eklenir; kart seti dikey etiketleriyle. |
| `GiftCardEndpoints` (9), `LoyaltyEndpoints` (2), `CampaignEndpoints` (4) | **KAPALI** | Preset'te yok; uçlar 409 döner. |
| `PublicSalonEndpoints` (7) | DEĞİŞİR | Yorum ve galeri uçları dikeyde kapalı; bilgi uçları açık (§7.1). |
| `RatingEndpoints` (4) | DEĞİŞİR | Puan **iç** kalır; `/reviews` public ucu dikeyde kapalı. |
| `TenantEndpoints` (27) | DEĞİŞİR | `VerticalType` + tema alanları. |
| Diğer platform/auth/health uçları | KALIR | — |

### 5.2 Yeni entity'ler — dişe özgü veri modeli

| # | Entity | Alanlar | Faz |
|---|---|---|---|
| 1 | `Tenant.VerticalType` | enum: Beauty·Dental·Law·Clinic | **v1** |
| 2 | `Resource` | Name, Type(Unit·Room·Device), BranchId, IsActive | **v1** (ana üründen) |
| 3 | `ToothRecord` | CustomerId, **ToothNumber (FDI: 11–48 daimi, 51–85 süt)**, Status, IsPrimaryTooth, UpdatedAtUtc | **v1** |
| 4 | `ToothSurfaceRecord` | ToothRecordId, Surface(M·D·O·B·L), Condition, Note | **v1** |
| 5 | `TreatmentPlan` | CustomerId, Status(Draft·Proposed·Accepted·InProgress·Completed·Rejected), TotalAmount, ProposedByStaffId, AcceptedAtUtc, **AlternativeOfPlanId** | **v1** |
| 6 | `TreatmentPlanItem` | PlanId, ToothNumber?, Surfaces?, ServiceDefinitionId, StaffId?, Amount, Sequence, Status, **AppointmentId?** | **v1** |
| 7 | `StaffMember.StaffType/LicenseNumber/Specialty` | Hekim/asistan ayrımı | **v1** |
| 8 | `Appointment.AssistantStaffId/ResourceId/AppointmentType/TreatmentPlanItemId` | | **v1** |
| 9 | `CustomerTreatmentPhoto.ToothNumber` + `Kind` genişlemesi | Radyografi arşivi | **v1** |
| 10 | `LabOrder` | CustomerId, ToothNumbers, LabName, WorkType, Shade, SentAtUtc, DueAtUtc, ReceivedAtUtc, Cost, TryInAppointmentId?, Status | **v1** |
| 11 | `Product.LotNumber/ExpiryDate/IsSterile` | İzlenebilirlik | **v1** |
| 12 | `ImplantRecord` | CustomerId, ToothNumber, Brand, LotNumber, Diameter, Length, PlacedAtUtc, WarrantyUntilUtc | **v2** |
| 13 | `SterilizationCycle` + `InstrumentSet` | Otoklav döngüsü, set–hasta eşleşmesi | **v2** |
| 14 | `Prescription` + `PrescriptionLine` | Reçete (e-reçete entegrasyonu ayrı) | **v2** |
| 15 | `InsurancePolicy` + `InsuranceClaim` | Anlaşmalı özel sigorta faturalama | **v2** 🔌 |
| 16 | `PerioChartEntry` | Diş başına 6 nokta cep derinliği + kanama | **v3** |

**Migration kuralları (ana üründen devralınır):** her madde ayrı migration · şifreli alan `longtext`/`varchar(512)` ·
sentinel varsayılan tarih kolonu eklenmez (backfill planı olmadan eski kayıtlar raporlardan düşer) ·
snapshot tabloları etkileniyorsa üç yer birden güncellenir.

### 5.3 Odontogram veri modeli — tasarım notu

Diş şeması bir **çizim değil, sorgulanabilir kayıttır**. İki yaygın hata:

1. **JSON blob olarak saklamak.** "13 numaralı dişe kaç dolgu yapıldı", "bu klinikte en çok hangi diş
   çekiliyor" sorularına cevap veremez ve rapora giremez. → `ToothRecord` + `ToothSurfaceRecord` ilişkisel kalır.
2. **Anlık durumu tarihsiz tutmak.** Diş şeması **zaman içinde değişir**; "2024'te dolguydu, 2026'da kanal oldu"
   bilgisi klinik ve hukuki olarak gereklidir. → Durum değişimi `ToothRecord` üzerine yazılırken **`AuditLog`'a
   ayrıca düşer**; işlem–diş bağı `TreatmentPlanItem.ToothNumber` üzerinden kalıcıdır.

Süt dişi/daimi geçişi (pedodonti) `IsPrimaryTooth` ile ayrılır; çocuk hastada şema 20 dişle çizilir,
karma dentisyonda ikisi birlikte gösterilir.

---

## 6. Mevzuat, etik ve veri güvenliği uyarıları

> Bu bölüm hukuki görüş değildir; **ürün kararı alınmadan önce avukat/mevzuat teyidi alınmalıdır.**
> Buradaki maddeler, diş dikeyinde güzellik dikeyinden **farklı davranmayı gerektiren** noktaları işaretler.

### 6.1 Sağlık hizmetinde tanıtım kısıtı 🔴

Türkiye'de sağlık kuruluşlarının tanıtım ve reklamı, güzellik salonlarına göre **çok daha dar** bir çerçevededir;
hasta yorumu/teşekkür paylaşımı ve önce–sonra görselleriyle yapılan tanıtım tartışmalı ya da yasaktır.
Ürün tarafındaki sonucu:

| BeautyAsist özelliği | DentistAsist'te |
|---|---|
| Salon vitrini + yıldız + yorum yayını | **Bilgi sayfasına indirgenir** — yorum ve yıldız yayınlanmaz |
| Önce/Sonra görselinin herkese açık paylaşımı | **Kapalı** — panelde klinik takip olarak kalır |
| İndirim kampanyası / hediye çeki | **Kapalı** |
| 5★ → Google yorumu yönlendirmesi | **Kapalı** (iç puan ölçümü kalır) |

Bu, özellik kaybı değil **dikey uyumudur**; ürünü satarken avantaja çevrilir ("mevzuata uygun tanıtım modu").

### 6.2 KVKK — sağlık verisi özel niteliklidir 🔴

Hasta anamnezi, tedavi kaydı, radyografi ve diş şeması **özel nitelikli kişisel veridir**; güzellik
dikeyindeki müşteri verisinden **daha ağır** koruma ve **ayrı açık rıza** gerektirir. Mevcut altyapının
karşıladıkları ve eksikleri:

| Gereklilik | Durum |
|---|---|
| Alan bazlı şifreleme (AES-GCM) + blind index arama | ✅ Var |
| Denetim izi (`AuditLog`) | ✅ Var |
| Rol/izin + iki seviyeli yetki | ✅ Var |
| Cihaz kontrolü, oturum güvenliği, 2FA | ✅ Var |
| **Özel nitelikli veri için ayrı açık rıza metni** | ❌ Eklenecek (`KvkkSettingsCard` şablonu) |
| **Saklama süresi ve imha politikası** | ❌ Eklenecek — hasta dosyası saklama süresi güzellikten farklıdır |
| **Veri ihraç/silme talebi akışı** | ❌ Ana üründe de eksik (BeautyAsist §3.1 · E2) |
| Erişim kaydının hasta bazlı raporlanabilmesi | ⚠️ `AuditLog` var, hasta bazlı görünüm yok |

**Karar:** DentistAsist v1, KVKK maddeleri (açık rıza metni + saklama politikası) tamamlanmadan
canlıya alınmamalıdır. Bu, odontogramdan bile önce gelen bir kapıdır.

### 6.3 Klinik karar desteği sınırı

`ConsultationWarningBanner`'ın dental kuralları (antikoagülan, bifosfonat, hamilelik + radyografi)
**hatırlatmadır, teşhis değildir**. Arayüz metni bunu açıkça yazmalı; aksi hâlde tıbbi cihaz yazılımı
sınıflandırmasına yaklaşan bir iddia doğar.

---

## 7. Kapatılacaklar — dikey preset'i

`SubscriptionPlan.Features` içinden **çıkarılan** anahtarlar (kod silinmez):

| Anahtar | Neden |
|---|---|
| `marketing.giftcards` | Diş kliniğinde kullanılmıyor + §6.1 |
| `loyalty.points` | Sağlık hizmetinde puan/ödül uygun değil |
| `marketing.campaigns` | §6.1 tanıtım kısıtı |
| `clinical.beforeafter` **(public yayın kısmı)** | Panelde açık, vitrinde kapalı — anahtar ikiye ayrılır: `clinical.photos` (açık) / `showcase.photos` (kapalı) |

**Kapatılan otomasyonlar:** Tamamlandı → 24 saat sonra değerlendirme WhatsApp'ı · QR yıldız daveti ·
vitrin yayını · doğum günü indirim mesajı (kutlama mesajı kalabilir, **indirim** içeremez).

**Açık kalan ve dişte daha da değerlenenler:** bekleme listesi otomasyonu · randevu hatırlatma ·
**kontrol (recall) çağrısı** · vadesi geçen taksit hatırlatması · onam formu imza istasyonu.

---

## 8. Teknik uygulama planı

### Adım 1 — Dikey altyapısı (1–2 gün) 🟢
`Tenant.VerticalType` + migration · `TenantDto`/`/admin/tenant` · `CreateTenantDialog` ve `/kayit`'ta dikey seçimi ·
`lib/terminology.ts` + `useTerminology()` · mobil `terminology.dart`.
**Bu adım LexAsist ile ortaktır — bir kez yapılır, iki dikey kullanır.**

### Adım 2 — Menü ve rota görünürlüğü (1 gün) 🟢
`SidebarNavItem.verticals` · `ROUTE_VERTICAL_GUARDS` · sunucu tarafında dikey kapılı uçlar (409) ·
mobil `AppShell` menü filtresi.

### Adım 3 — Etiket taraması (2–4 gün) 🟡
~700 sabit "müşteri/salon/seans" geçişi (74 dosya). Öncelik: panel sayfaları + modallar → mobil →
online portal → landing. Mekanik değişim: sabit metin → `t.customer`. Landing/pazarlama sayfaları
dikey başına ayrı kalır.

### Adım 4 — Modal içerik varyantları (3–4 gün) 🟡
`ConsultationForm` alan seti dikeyden · `CustomerDetailModal` sekme dizisi dikeyden ·
`PackageSaleDialog`/`AdisyonPanel`'de kupon+sadakat blokları koşullu · `ServiceIcons` diş seti.

### Adım 5 — Ünit (kaynak) planlaması (ana üründen) 🔴
`Resource` + randevu çakışma kontrolü + çizelge sütunu. **BeautyAsist B1 ile aynı iş** — orada yapılır,
burada tüketilir. Dikey bu işi tekrarlamaz.

### Adım 6 — Odontogram (1,5–2 hafta) 🔴
`ToothRecord` + `ToothSurfaceRecord` + FDI numaralandırma · `Odontogram` bileşeni (web) ·
`ToothStatusPopover` · mobil salt-okunur şema (düzenleme webde) · `AuditLog` bağı.

### Adım 7 — Tedavi planı (1–1,5 hafta) 🔴
`TreatmentPlan` + `TreatmentPlanItem` · `TreatmentPlanBuilder` · plan → adisyon/cari bağı
(**mevcut taksit altyapısı aynen kullanılır**) · plan PDF'i + imza · `/panel/tedavi-planlari` kuyruğu.

### Adım 8 — Laboratuvar takibi (3–4 gün) 🟡
`LabOrder` + `/panel/laboratuvar` + `LabOrderDialog` + prova randevusu bağı + rapor sekmesi.

### Adım 9 — KVKK ve onam seti (3–4 gün) 🟡
Özel nitelikli veri açık rıza metni · saklama/imha politikası alanı · dişe özgü onam şablonları seed'i ·
hasta bazlı erişim kaydı görünümü.

### Adım 10 — Tema, marka, landing (3–5 gün) 🟡
Teal/slate palet · DentistAsist logo · ayrı landing + `/moduller` içeriği · bildirim/WhatsApp şablon seed'leri.

---

## 9. v2 / v3 yol haritası

| Faz | İş | Efor | Not |
|---|---|---|---|
| v2 | **İmplant izlenebilirliği + garanti takibi** | 🟡 | Marka/lot/çap/boy; garanti bitişinde hatırlatma |
| v2 | **Sterilizasyon takibi** | 🟡 | Otoklav döngüsü + set–hasta eşleşmesi; denetimde istenir |
| v2 | **Reçete** | 🟡 | Önce klinik içi reçete; e-Reçete entegrasyonu 🔌 |
| v2 | **Anlaşmalı sigorta faturalama** | 🔴🔌 | Poliçe + hak ediş + fatura; özel sigorta şirketi başına format |
| v2 | **Ortodonti takip modülü** | 🟡 | Aylık kontrol serisi, tel/plak, tedavi süresi projeksiyonu |
| v3 | **Periodontal chart** | 🔴 | 6 nokta cep derinliği + kanama indeksi + zaman serisi |
| v3 | **DICOM/CBCT görüntüleyici** | 🔴 | Radyografi cihazıyla entegrasyon 🔌 |
| v3 | **MEDULA / e-Nabız** | 🔴🔌 | Kamu tarafı; özel klinik için düşük öncelik |
| v3 | Hasta mobil uygulaması (kendi tedavi planını görme) | 🟡 | Mevcut müşteri portalı üstüne |

---

## 10. İş sırası ve kaba efor

| Sıra | Adım | Süre | Bağımlılık |
|---|---|---|---|
| 1 | Dikey altyapısı (1–2) | ~3 gün | — |
| 2 | Etiket taraması (3) | 2–4 gün | 1 |
| 3 | Modal varyantları (4) | 3–4 gün | 2 |
| 4 | **Ünit planlaması (5)** | — | **BeautyAsist B1'de yapılır** |
| 5 | **Odontogram (6)** | 1,5–2 hafta | 3 |
| 6 | **Tedavi planı (7)** | 1–1,5 hafta | 5 |
| 7 | Laboratuvar (8) | 3–4 gün | 6 |
| 8 | KVKK & onam (9) | 3–4 gün | 1 — **canlı öncesi zorunlu** |
| 9 | Tema/marka/landing (10) | 3–5 gün | paralel |

**v1 toplamı:** ~6–8 hafta (ünit planlaması ana üründe tamamlanmış varsayımıyla).

### Ön koşul

BeautyAsist'in **A fazı (bakım borcu) ve B1 (kaynak planlaması) tamamlanmadan bu dikey başlatılmamalıdır.**
Gerekçe: dikey katmanı `CustomerDetailModal` (1.523), `AppointmentEditor` (1.891), `PackageSaleDialog` (1.764)
ve `DayScheduleModal` (2.501) dosyalarına dokunur. Bu dosyalar bölünmeden dikeyleştirilirse aynı devasa
dosyalar iki üründe birden çatallanır ve her hata iki kez düzeltilir.

### Bitmiş sayılma şartı (ana üründen devralınır)

1. Backend build + test yeşil (yeni davranış için yeni test).
2. Web `tsc` + `vitest` + `next build` temiz.
3. **Mobil aynı turda** (`flutter analyze lib` temiz).
4. Şema değiştiyse: yeni migration + manifest + canlı uygulama notu.
5. Dikey kapısı **hem menüde hem sunucuda** kapalı (yalnız menü gizlemek yeterli değil).
