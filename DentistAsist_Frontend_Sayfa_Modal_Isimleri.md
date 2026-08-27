# DentistAsist — Frontend Sayfa ve Modal İsimleri (Yapım Şartnamesi)

**Tarih:** 20 Ağustos 2026 · **Alıcı:** frontend geliştirici (Kimi)
**Kaynak:** `DentistAsist_Vertikal_Plani.md` · `BeautyAsist_Urun_Plani.md`
**Amaç:** hangi sayfanın ve modalın **hangi adla** var olacağını tek yerde sabitlemek — dosya adı, rota, menü etiketi, ekranda görünen başlık.

---

## 0. Bu belge nasıl okunur

### 0.1 Temel varsayım

DentistAsist **ayrı bir kod tabanı değildir.** Mevcut BeautyAsist frontend'inin üzerine bir **dikey (vertical) katmanı**
eklenerek üretilir: rotalar ve bileşen adları aynı kalır, **ekranda görünen her metin sözlükten okunur**
(`useTerminology()`), dişe özgü sayfalar/modallar ise yeni eklenir.

**Neden rota adları Türkçe kalıp değişmiyor** (ör. `/panel/musteriler` "Hastalar" başlığını taşır):

- `/ekip/*` altındaki 12 rota `/panel/*` sayfalarının **re-export'udur**; rota adı değişirse ikisi birden kırılır.
- Kayıtlı derin linkler, `lib/guideContent.ts` kılavuz anahtarları ve `ROUTE_FEATURE_GUARDS` rota literalleriyle çalışır.
- İki dikey tek kod tabanını paylaştığı için rota çatallanması bakım maliyetini ikiye katlar.

> Ayrı kod tabanı isteniyorsa tek değişiklik şudur: §2'deki **Rota** sütunu dişe göre yeniden yazılır
> (`/panel/hastalar`, `/panel/islemler`…). Bileşen adları ve başlıklar aynen geçerlidir. Bu kararı
> koda başlamadan önce netleştirin — sonradan dönmek 12 re-export + kılavuz anahtarları demektir.

### 0.2 İşaretler

| İşaret | Anlamı |
|---|---|
| **[KOD]** | Başlık koddan birebir çıkarıldı — **değiştirmeyin**. |
| **[ÖNERİ]** | Bu belgede önerilen ad. Onaylanınca sabitlenir. |
| **[DİNAMİK]** | Başlık kaydın kendisidir (hasta adı, işlem adı, kart kodu). Sabit metin yazmayın. |
| **DEVRALINIR** | Bileşen aynen kullanılır; yalnız içindeki sabit metinler sözlüğe bağlanır. |
| **DÖNÜŞÜR** | Alan seti / sekme dizisi / davranış değişir. |
| **YENİ** | Sıfırdan yazılacak. |
| **KAPALI** | Dikey preset'inde kapalı — **kodu silmeyin**, `useFeature`/dikey kapısıyla gizleyin. |

### 0.3 Kapsam sayıları

| | Adet |
|---|---|
| Devralınan bileşen (yalnız etiket değişir) | **105** |
| Dönüşen bileşen | **27** |
| Kapatılan bileşen | **6** |
| Yeni bileşen (dişe özgü) | **7** |
| Mevcut sayfa (devralınan) | **60** |
| Yeni sayfa | **3** |
| Kapatılan sayfa | **3** |

---

## 1. ZORUNLU DESENLER — koda başlamadan önce oku

Bu bölüm belgenin en kritik kısmıdır. Aşağıdakiler tercih değil, bu kod tabanında **daha önce hata
üretmiş olduğu için kurala dönüşmüş** desenlerdir.

### 1.1 Modal yazarken

| Kural | Neden |
|---|---|
| **Her modal `ModalPortal` içinden render edilir.** | Panel yerleşiminde `<main className="relative z-10">` kendi yığınlama bağlamını kurar; portal kullanmayan modal **sidebar'ın altında** kalır. z-index artırmak çözmez. |
| **`role="dialog"` + `aria-modal` + başlık bağı + focus trap + odağın çağırana iadesi.** | Erişilebilirlik denetiminde kapatılan madde; yeni modal aynı hatayı tekrar açmasın. |
| **Footer kırpılmasına karşı:** kabuk `flex-col`, içerik `!p-0`, gövde `flex-auto` (referans: `AppointmentEditor`). | Uzun modallarda alt aksiyon çubuğu ekran dışında kalıyordu. |
| **Açılır panel/popover için `AnchoredPopover`.** | Kart kabuğu `overflow-hidden` olduğu için panel kırpılır; çözüm portal, z-index değil. |
| **Modal başlığı `DialogTitle` ile verilir.** | Focus/aria bağı buradan kurulur. |

### 1.2 Veri seçerken

| Kural | Neden |
|---|---|
| **Hasta seçimi her yerde `CustomerPicker` / `CustomerSelectField` ile.** | 12.000+ kayıt var; tam liste istemciye **hiçbir zaman** çekilmez. Sunucu taraflı arama ilk 50 eşleşmeyi getirir. |
| **Hizmet/paket seçimi `CatalogPicker` ile.** | Kategori + alt kategori + arama süzgeci hazır. |
| **Liste sayfalarında `useApiQuery` + `getAllPaged`.** | Sayfalama deseni sabit. |

### 1.3 Metin kuralları

| Kural | Doğru | Yanlış |
|---|---|---|
| Seans/adım kalanı | **"3 seans kaldı"** | "3/4" |
| Ödeme yöntemi etiketi | `paymentMethodLabel(...)` | ham `cash` / `card` |
| Adisyon kalem etiketi | `adisyonItemTypeLabel(...)` | elle yazılmış "Hizmet" |
| Okunabilirlik | en az 10px, düşük opaklıkta silik metin **yok** | `text-white/40` |
| **Dikey metni** | `const t = useTerminology()` → `t.customer` | sabit `"Müşteri"` |
| Türkçe karşılaştırma | `toLocaleLowerCase('tr')` | `toLowerCase()` (İ/I tuzağı) |

> **Dikey kuralının testi:** iş bittiğinde panel bileşenlerinde `grep -rn "Müşteri\|Seans\|Salon"`
> **sıfır** eşleşme vermeli (yalnız sözlük dosyası hariç). Yarım kalırsa menü "Hasta" derken modal
> "Müşteri" der.

### 1.4 Dosya yerleşimi

| Ne | Nereye |
|---|---|
| Panel modalı / kartı | `components/dashboard/` |
| Rapor sekmesi | `components/reports/tabs/` |
| Platform modalı | `components/platform/` |
| **Dişe özgü klinik bileşenler** | `components/dashboard/dental/` **[ÖNERİ]** |
| Sayfa | `app/panel/<rota>/page.tsx` · personel karşılığı `app/ekip/<rota>/page.tsx` (**3 satırlık re-export**) |
| Sözlük | `lib/terminology.ts` |

### 1.5 Mobil parite

Bu projede kural: **web'de eklenen her ekran aynı turda mobile de eklenir** (`mobile/lib/features/...`).
Yeni bileşen tablolarında (§4) "Mobil" sütunu bunu izler. Mobil karşılığı olmayacaksa belgede
gerekçesiyle **istisna** olarak işaretlenmelidir.

---

## 2. SAYFA İSİMLERİ

"Menü etiketi (güzellik)" sütunu **koddan çıkarılmıştır** (`app/panel/layout.tsx`, `app/ekip/layout.tsx`,
`app/platform/layout.tsx`) — dişteki karşılığın doğru üretilebilmesi için referans olarak duruyor.

### 2.1 Klinik yöneticisi paneli — `/panel`

| Rota | Dosya | Menü etiketi (güzellik) [KOD] | **Menü etiketi (DİŞ)** | Durum |
|---|---|---|---|---|
| `/panel` | `app/panel/page.tsx` | Dashboard | **Panel** [ÖNERİ] | DÖNÜŞÜR |
| `/panel/musteriler` | `app/panel/musteriler/page.tsx` | Müşteriler | **Hastalar** | DÖNÜŞÜR |
| `/panel/randevular` | `app/panel/randevular/page.tsx` | Randevular | **Randevular** | DÖNÜŞÜR |
| `/panel/paketler` | `app/panel/paketler/page.tsx` | Paket & Hizmet | **İşlem & Tedavi Planı** | DÖNÜŞÜR |
| `/imza` | `app/imza/page.tsx` | İmza Tableti | **İmza Tableti** | DEVRALINIR |
| `/panel/stok` | `app/panel/stok/page.tsx` | Stok & Ürün | **Stok & Malzeme** | DÖNÜŞÜR |
| `/panel/bekleme-listesi` | `app/panel/bekleme-listesi/page.tsx` | Bekleme Listesi | **Bekleme Listesi** | DEVRALINIR |
| `/panel/kasa` | `app/panel/kasa/page.tsx` | Günlük Kasa | **Günlük Kasa** | DEVRALINIR |
| `/panel/kasa-kapanis` | `app/panel/kasa-kapanis/page.tsx` | Kasa Kapanışı | **Kasa Kapanışı** | DEVRALINIR |
| `/panel/on-muhasebe` | `app/panel/on-muhasebe/page.tsx` | Ön Muhasebe | **Ön Muhasebe** | DEVRALINIR |
| `/panel/raporlar` | `app/panel/raporlar/page.tsx` | Raporlar | **Raporlar** | DÖNÜŞÜR |
| `/panel/onaylar` | `app/panel/onaylar/page.tsx` | Onay Bekleyenler | **Onay Bekleyenler** | DEVRALINIR |
| `/panel/personel` | `app/panel/personel/page.tsx` | Personel & Roller | **Hekim & Ekip** | DÖNÜŞÜR |
| `/panel/personel/cizelge` | `app/panel/personel/cizelge/page.tsx` | Çizelge | **Çizelge** | DÖNÜŞÜR |
| `/panel/bildirimler` | `app/panel/bildirimler/page.tsx` | Bildirimler | **Bildirimler** | DÖNÜŞÜR |
| `/panel/salon-profili` | `app/panel/salon-profili/page.tsx` | Salon Vitrini | **Klinik Bilgi Sayfası** | DÖNÜŞÜR |
| `/panel/loglar` | `app/panel/loglar/page.tsx` | Log Kayıtları | **Log Kayıtları** | DEVRALINIR |
| `/panel/ayarlar` | `app/panel/ayarlar/page.tsx` | Ayarlar | **Ayarlar** | DÖNÜŞÜR |
| `/panel/abonelik` | `app/panel/abonelik/page.tsx` | *(bugün `/panel/paket`)* | **Abonelik** | YENİDEN ADLANDIRILIR |
| `/panel/hediye-cek` | `app/panel/hediye-cek/page.tsx` | Hediye Çeki | — | **KAPALI** |
| **`/panel/tedavi-planlari`** | `app/panel/tedavi-planlari/page.tsx` | — | **Tedavi Planları** | **YENİ** |
| **`/panel/laboratuvar`** | `app/panel/laboratuvar/page.tsx` | — | **Laboratuvar** | **YENİ** |
| **`/panel/sterilizasyon`** | `app/panel/sterilizasyon/page.tsx` | — | **Sterilizasyon** | **YENİ (v2)** |

### 2.2 Sidebar alt menü etiketleri (`?scope=`)

Alt menüler rota değiştirmez, yalnız `?scope=` taşır. Etiketler sözlükten üretilir.

| Üst sayfa | Alt etiket (güzellik) [KOD] | **Alt etiket (DİŞ)** |
|---|---|---|
| Hastalar | Tüm müşteriler · KVKK onaylı · KVKK onaysız · Yeni eklenen | **Tüm hastalar · KVKK onaylı · KVKK onaysız · Yeni kayıt** |
| Hastalar | *(yok)* | **+ Kontrolü gelenler** `?scope=recall` **[YENİ]** |
| Randevular | Bugün · Bu hafta · Bu ay · Bekleyenler | **Bugün · Bu hafta · Bu ay · Bekleyenler** |
| İşlem & Tedavi Planı | Hizmet havuzu · Paketler · Kategoriler · Aktif hizmetler · Pasif hizmetler | **İşlem listesi · Tedavi planı şablonları · Kategoriler · Aktif işlemler · Pasif işlemler** |
| Stok & Malzeme | Tüm ürünler · Kritik stok · Satış ürünleri · Sarf malzeme | **Tüm malzemeler · Kritik stok · Satış ürünleri · Sarf malzeme** |
| Günlük Kasa | Bugün · Bu hafta · Gelir-Gider | *(aynı)* |
| Ön Muhasebe | Genel bakış · Adisyon · Cari hesap · Bekleyen taksitler · Geciken ödemeler · Giderler · Personel maaşları | **Genel bakış · Tedavi hesabı · Cari hesap · Bekleyen taksitler · Geciken ödemeler · Giderler · Ekip maaşları** |
| Raporlar | Finans özet · Müşteri analitiği · Personel performansı · Hizmet doluluk | **Finans özet · Hasta analitiği · Hekim performansı · İşlem doluluk** |
| Onay Bekleyenler | Bekleyenler · Onaylanmış · Reddedilmiş | *(aynı)* |
| Hekim & Ekip | Tüm personel · Aktif kadro · Pasif / izinli · Çizelge · Yetki seti | **Tüm ekip · Aktif kadro · Pasif / izinli · Çizelge · Yetki seti** |
| Bildirimler | Tümü · SMS şablonları · WhatsApp | *(aynı)* |
| Log Kayıtları | Bugün · Bu hafta · Tüm geçmiş | *(aynı)* |
| **Tedavi Planları** | — | **Teklif edildi · Kabul edildi · Uygulanıyor · Tamamlandı · Reddedildi** [ÖNERİ] |
| **Laboratuvar** | — | **Gönderildi · Beklenen · Geldi · Provada · Teslim** [ÖNERİ] |

### 2.3 Klinik ekibi paneli — `/ekip`

12 rota `/panel` sayfalarının **3 satırlık re-export'udur**; dosya içeriği `export { default } from '@/app/panel/<rota>/page'`.
**Yeni personel sayfası yazmayın** — rol farkı sayfanın içinde `useAuth().role` + izinle çözülür.

| Rota | Menü etiketi (güzellik) [KOD] | **Menü etiketi (DİŞ)** | Durum |
|---|---|---|---|
| `/ekip` | Dashboard | **Panel** [ÖNERİ] | DÖNÜŞÜR (kendi ekranı) |
| `/ekip/musteriler` | Müşterilerim | **Hastalarım** | re-export |
| `/ekip/randevular` | Randevularım | **Randevularım** | re-export |
| `/ekip/paketler` | Paket & Hizmet | **İşlem & Tedavi Planı** | re-export |
| `/ekip/seanslar` | Seanslarım | **Tedavi Seanslarım** | DÖNÜŞÜR (kendi ekranı) |
| `/ekip/stok` | Stok & Ürün | **Stok & Malzeme** | re-export |
| `/ekip/kasa` | Günlük Kasa | **Günlük Kasa** | re-export |
| `/ekip/kasa-kapanis` | Kasa Kapanışı | **Kasa Kapanışı** | re-export |
| `/ekip/on-muhasebe` | Ön Muhasebe | **Ön Muhasebe** | re-export |
| `/ekip/bekleme-listesi` | Bekleme Listesi | **Bekleme Listesi** | re-export |
| `/ekip/raporlar` | Raporlar | **Raporlar** | re-export |
| `/ekip/bildirimler` | Bildirimler | **Bildirimler** | re-export |
| `/ekip/loglar` | Loglarım | **Loglarım** | re-export |
| `/ekip/profil` | Profilim | **Profilim** | DÖNÜŞÜR (+ cihazlarım) |
| `/ekip/hediye-cek` | Hediye Çeki | — | **KAPALI** |

### 2.4 Platform paneli — `/platform`

Platform yüzeyi dikeyden **bağımsızdır**; etiketler değişmez. Tek istisna aşağıda.

| Rota | Menü etiketi [KOD] | Durum |
|---|---|---|
| `/platform` | Overview → **Genel Bakış** [ÖNERİ, bkz. §6] | DÜZELTİLİR |
| `/platform/kurumlar` | Tüm Kurumlar | DÖNÜŞÜR (+ dikey rozeti) |
| `/platform/uyarilar` | Sağlık Uyarıları | DEVRALINIR |
| `/platform/finans` | MRR & Abonelik | DEVRALINIR |
| `/platform/planlar` | Plan Kataloğu | DÖNÜŞÜR (+ dikey alanı) |
| `/platform/fatura` | Faturalama | DEVRALINIR |
| `/platform/whatsapp` | WhatsApp | DEVRALINIR |
| `/platform/aktarim` | Veri Aktarımı | DEVRALINIR |
| `/platform/sistem` | Sistem Ayarları | DEVRALINIR |

### 2.5 Herkese açık ve ara sayfalar

| Rota | Sayfa adı (DİŞ) | Durum |
|---|---|---|
| `/` | DentistAsist tanıtım sayfası | **AYRI** (dişe özgü içerik + teal tema) |
| `/moduller` | Modüller | **AYRI** (dişe göre yeniden yazılır) |
| `/login` | Giriş | DEVRALINIR |
| `/kayit` | Klinik Kaydı | DÖNÜŞÜR (metin) |
| `/change-password` | Şifre Değiştir | DEVRALINIR |
| `/odeme` | Ödeme | DEVRALINIR |
| `/randevu` | Online Randevu | DÖNÜŞÜR (randevu tipi: Muayene / Kontrol) |
| `/randevu/giris` | Hasta Girişi | DÖNÜŞÜR |
| `/salonlar` | Klinikler | **KISITLI** (yıldız/yorum yayınlanmaz) |
| `/salon/[slug]` | Klinik Sayfası | **KISITLI** |
| `/rate/[token]` | Değerlendirme | DEVRALINIR (sonuç yalnız panelde) |
| `/kvkk/[slug]` | Aydınlatma Metni | DÖNÜŞÜR (özel nitelikli veri) |
| `/imza` | İmza Tableti | DEVRALINIR |
| `/gizlilik` · `/hakkimizda` · `/mesafeli-satis-sozlesmesi` · `/teslimat-ve-iade` | Yasal sayfalar | DEVRALINIR (künye dikeyden) |
| `/hediye-kart/[slug]/[code]` | — | **KAPALI** |

---

## 3. MODAL VE BİLEŞEN İSİMLERİ — mevcut set

**Dosya adı = bileşen adı.** Yeniden adlandırma yapmayın: 138 bileşenin adı `BeautyAsist_Urun_Plani.md`
ve `DentistAsist_Vertikal_Plani.md` belgelerinde de aynı adlarla geçiyor; ad değişirse üç belge ve kod
birbirini tutmaz.

### 3.1 Dönüşen bileşenler (27)

"Görünen başlık" sütununda **[KOD]** işaretli metinler kodda birebir böyle yazıyor — çevirisi sözlüğe taşınacak,
metnin kendisi uydurulmayacak.

| Bileşen | Görünen başlık | Nereden açılır | Diş versiyonunda ne değişir |
|---|---|---|---|
| `CustomerDetailModal` | [DİNAMİK] hasta adı | Hastalar listesi satırı | **Sekme dizisi yeniden kurulur:** Genel Bakış · **Diş Şeması** · **Tedavi Planı** · Randevular · Hesap · **Anamnez** · **Görüntüler** · Onamlar. Sadakat ve Hediye çeki sekmeleri çıkar. En büyük iş. |
| `AppointmentEditor` | [DİNAMİK] `{headline}` | Randevular · çizelge · hasta kartı | Alanlar: hekim · **asistan** · **ünit** · randevu tipi · **ilgili diş(ler)** · tedavi planı adımı bağı. |
| `DayScheduleModal` | [DİNAMİK] gün · alt aksiyon **"Gün / Saat Kapat"** [KOD] | Çizelge · randevular | Satır = **ünit**; hekim rengi + ünit sütunu. Hekim bazlı görünüme geçiş düğmesi. |
| `CompleteAppointmentDialog` | **"Randevuyu tamamla"** [KOD] | Randevu satırı · günlük kart | Adım 0 onam kapısı **katılaşır**: cerrahi/implant/kanal işlemlerinde imzalı onam yoksa tamamlama **engellenir** (güzellikte yalnız uyarıydı). |
| `PackageSaleDialog` → **`TedaviPlaniDialog`** [ÖNERİ] | **"Paket Satışı" / "Hizmet Satışı" / "Ürün Satışı"**, onay adımında **"Satışı onayla"** [KOD] | Hasta kartı · randevu · katalog | **Yeniden yazılır.** Sabit seans adedi yerine **diş bazlı satır listesi**: `diş no · yüzey · işlem · hekim · tutar`. Kupon + sadakat blokları kapanır. Taksit önizlemesi mevcut altyapıdan gelir. |
| `ConsultationForm` | [ÖNERİ] **"Anamnez ve Muayene Formu"** | Hasta kartı · randevu | **Alan seti tamamen değişir:** sistemik hastalık · antikoagülan · bifosfonat · alerji (anestezi/lateks/penisilin) · hamilelik · sigara · bruksizm · endokardit profilaksisi. `SkinType`/Fitzpatrick alanı `vertical==='beauty'` koşuluna alınır. |
| `ConsultationFormModal` | [DİNAMİK] `{hasta adı}` · boşsa [ÖNERİ] **"Hasta formu"** | Randevu içinden | Yalnız etiket. |
| `ConsultationWarningBanner` | *(başlıksız şerit)* | Randevu · satış modalları | Dental kurallar: antikoagülan + cerrahi · bifosfonat + çekim/implant · hamilelik + radyografi. **Metinde "hatırlatmadır, teşhis değildir" ibaresi zorunlu.** |
| `ServiceFormDialog` | [ÖNERİ] **"Yeni İşlem" / "İşlemi Düzenle"** | İşlem listesi | Yeni alanlar: varsayılan diş yüzeyi · süre · **ünit gerekir mi** · sarf reçetesi · onam şablonu bağı. |
| `TreatmentJournal` | [ÖNERİ] **"Klinik Görüntü Arşivi"** | Hasta kartı sekmesi | Görüntü türü: **intraoral · panoramik · periapikal · bitewing · CBCT**; diş numarasıyla etiketleme. |
| `BeforeAfterSlider` | *(başlıksız)* | Görüntü arşivi | Panelde **kalır**; herkese açık sayfada **yayınlanmaz** (§6.3). |
| `AdisyonPanel` | [ÖNERİ] **"Tedavi Hesabı"** | `AdisyonModal` içinden · Ön Muhasebe · randevu | Kalem ekleme (= satış), ödeme/peşinat, onay akışı **aynen kalır**. **Kupon ve sadakat puanı blokları koşullu hâle gelir** (dikeyde kapalı). "Adisyon" sözcüğü sözlükten **"Tedavi hesabı"** olarak gelir. |
| `CustomerSessionsCard` | [ÖNERİ] **"Tedavi Adımları"** | Hasta kartı | "3 seans kaldı" → **"planın 3 adımı kaldı"**; satırda diş no. |
| `ConsentTemplatesCard` | [ÖNERİ] **"Onam Formu Şablonları"** | Ayarlar | Dişe özgü şablon seti: implant · cerrahi çekim · kanal · ortodonti · protez · beyazlatma · lokal anestezi. |
| `ConsentPicker` | *(kart içi seçici)* | İşlem/plan formu | Şablon listesi dental sete bağlanır. |
| `StaffFormDialog` | **"Yeni personel oluştur" / "Personeli düzenle"** [KOD] → [ÖNERİ] **"Yeni ekip üyesi" / "Ekip üyesini düzenle"** | Hekim & Ekip | Personel tipi (**Hekim · Asistan · Resepsiyon · Teknisyen**) · **tescil/diploma no** · branş · hakediş yüzdesi. Yetkinlik matrisi = **branş**. |
| `ProductFormDialog` | **"Yeni Ürün Tanımla" / "Ürünü Düzenle"** [KOD] → [ÖNERİ] **"Yeni Malzeme" / "Malzemeyi Düzenle"** | Stok | **Lot/seri no · son kullanma tarihi · steril mi** alanları. |
| `ProductDetailModal` | [DİNAMİK] `{malzeme adı}` | Stok kartı | Lot ve son kullanma bilgisi künyeye. |
| `ReportFilterBar` | *(filtre çubuğu)* | Raporlar | Etiketler sözlükten. |
| `GiftCardsTab` | — | Raporlar | **Kapanır** (§3.2). |
| `CreateTenantDialog` | [DİNAMİK] adım başlığı | Platform → Tüm Kurumlar | **Dikey seçimi eklenir** (Güzellik / Diş / Hukuk) — preset ve tema bundan türer. |
| `Sidebar` | *(menü)* | Her panel | `verticals?: VerticalType[]` filtresi; etiketler sözlükten. |
| `FeatureContext` | *(sağlayıcı)* | Kök | Dikey kapısı bu desenin ikizi olarak kurulur (`useTerminology`). |
| `ServiceIcons` | *(ikon kütüphanesi)* | İşlem kartları | **Diş ikon seti:** diş · kanal · implant · ortodonti · cerrahi · protez · pedodonti. |
| `KvkkConsentModal` | **"Aydınlatma Metni"** [KOD] | Hasta kartı | **Özel nitelikli sağlık verisi** açık rızası + veri ihraç/silme talebi düğmesi. |
| `KvkkSettingsCard` | [ÖNERİ] **"KVKK ve Aydınlatma"** | Ayarlar | Özel nitelikli veri metni + **saklama/imha süresi** alanı. |
| `CustomerBlacklistCard` | [ÖNERİ] **"Randevuya Gelmeyen Takibi"** | Hasta kartı | "Kara liste" kavramı yumuşatılır; **hizmet reddi gerekçesi olarak sunulmaz**, yalnız sayaç ve not. |

### 3.2 Kapatılan bileşenler (6) — **kodu silmeyin**

Dikey preset'inde `marketing.giftcards`, `loyalty.points`, `marketing.campaigns` anahtarları yok;
bileşenler `useFeature` kapısıyla hiç render edilmez.

| Bileşen | Neden kapalı |
|---|---|
| `GiftCardArtwork` | Hediye çeki diş kliniğinde kullanılmıyor. |
| `GiftCardShareModal` | " |
| `GiftCardScanModal` | " |
| `GiftCardEditModal` | " |
| `LoyaltyCard` | Sağlık hizmetinde puan/ödül mekaniği uygun değil. |
| `CampaignPanel` | İndirim kampanyası — tanıtım kısıtı (§6.3). |

> `CustomerVipToggle` de preset'te **kapalıdır**; yerine hasta kartında serbest "öncelikli hasta" notu kullanılır.

### 3.3 Aynen devralınan bileşenler

Aşağıdaki **105 bileşen dişte davranış olarak değişmez.** Yapılacak tek iş: içlerindeki sabit metinleri
`useTerminology()` üzerinden okumaya çevirmek. **Dosyayı yeniden yazmayın, kopyalamayın, adını değiştirmeyin.**

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

§3.1'deki 27 dönüşen, §3.2'deki 6 kapatılan ve buradaki 105 devralınan bileşenle birlikte mevcut
**138 bileşenin tamamı** karara bağlanmıştır.

---

## 4. YENİ BİLEŞENLER — dişe özgü

Prop imzaları mevcut kod tabanının sözleşmesine uyar: `open` / `onClose` (veya `onOpenChange`),
`customerId` · `tenantId` · `branchId`, kayıt sonrası `onSaved`. **Bu imzalardan sapmayın** — sayfalar
bu adlarla bağlayacak.

### 4.1 `Odontogram` — diş şeması 🔴

Ürünün klinik çekirdeği. **Bu bileşen olmadan DentistAsist "diş kliniği yazılımı" iddiası taşıyamaz.**

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/Odontogram.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Diş Şeması"** |
| **Nereden açılır** | `CustomerDetailModal` → "Diş Şeması" sekmesi (modal değil, sekme içeriği) |
| **Numaralandırma** | **FDI iki haneli.** Daimi: 11–18 · 21–28 · 31–38 · 41–48. Süt: 51–55 · 61–65 · 71–75 · 81–85. Sabit sayı varsaymayın; çocuk hastada 20 diş, karma dentisyonda ikisi birlikte çizilir. |
| **Yüzeyler** | Diş başına 5: **M** (mezial) · **D** (distal) · **O** (okluzal) · **B** (bukkal/vestibül) · **L** (lingual/palatinal). Ön dişlerde okluzal yerine **insizal** yazılır. |
| **Durum renkleri** | sağlam · çürük · dolgulu · kanal tedavili · kron · köprü · implant · eksik · çekilecek |
| **İki mod** | `readOnly` (hasta kartı özeti, rapor, PDF) ve düzenlenebilir (hekim) |

```ts
interface OdontogramProps {
  customerId: string
  tenantId?: string
  branchId?: string
  /** Salt-okunur: özet/rapor/PDF görünümü. Varsayılan false. */
  readOnly?: boolean
  /** Karma dentisyonda süt dişlerini de çiz. */
  showPrimaryTeeth?: boolean
  /** Bir dişe tıklanınca — üst bileşen ToothStatusPopover veya plan satırı açar. */
  onToothSelect?: (tooth: { number: number; surfaces: string[] }) => void
  /** Durum değiştiğinde (yalnız düzenlenebilir modda). */
  onSaved?: () => void
}
```

**Mobil:** salt-okunur şema (`mobile/lib/features/dental/odontogram_view.dart`); düzenleme webde kalır — **bilinçli istisna**, dokunmatik hassasiyeti diş yüzeyi seçimi için yetersiz.

### 4.2 `ToothStatusPopover` — tek dişin geçmişi 🟡

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/ToothStatusPopover.tsx` |
| **Görünen başlık** | [ÖNERİ] **"{diş no} numaralı diş"** |
| **Nereden açılır** | `Odontogram` üzerinde bir dişe tıklayınca |
| **Zorunlu** | **`AnchoredPopover` kullanılacak** — kendi konumlandırmanızı yazmayın, kart kabuğu kırpar. |

```ts
interface ToothStatusPopoverProps {
  customerId: string
  toothNumber: number
  anchorRef: React.RefObject<HTMLElement>
  open: boolean
  onClose: () => void
  onAddTreatment?: (toothNumber: number) => void
}
```

**Mobil:** alt sayfa (bottom sheet) olarak.

### 4.3 `TreatmentPlanBuilder` — tedavi planı kurucu 🔴

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/TreatmentPlanBuilder.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Tedavi Planı"** · yeni planda **"Yeni Tedavi Planı"** |
| **Nereden açılır** | `CustomerDetailModal` → "Tedavi Planı" sekmesi · `/panel/tedavi-planlari` |
| **Satır yapısı** | `diş no · yüzey(ler) · işlem · hekim · tutar · sıra` |
| **Alternatif plan** | A/B teklifi — aynı hastaya iki plan, biri kabul edilince diğeri `Rejected` |
| **Para tarafı** | Toplam ve taksit önizlemesi **mevcut altyapıdan** gelir (`NewAccountDialog` / `PaymentScheduleGrid` deseni). Yeni para mantığı yazmayın. |
| **Çıktı** | Hastaya imzalatılacak **plan PDF'i** (mevcut PDF üretimi + `SignaturePad`) |

```ts
interface TreatmentPlanBuilderProps {
  customerId: string
  customerName: string
  tenantId?: string
  branchId?: string
  /** Var olan planı düzenle; boşsa yeni plan. */
  planId?: string
  /** Odontogram'dan gelen ön seçim. */
  initialTeeth?: number[]
  onSaved?: (planId: string) => void
  onClose: () => void
}
```

**Mobil:** görüntüleme + adım tamamlama; plan kurma webde.

### 4.4 `TedaviPlaniDialog` — plan satışı (eski `PackageSaleDialog`) 🔴

`PackageSaleDialog` (1.764 satır) bu dikeyde yeniden yazılır. **Adı belgelerde `TedaviPlaniDialog` olarak geçer** —
başka ad üretmeyin.

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/TedaviPlaniDialog.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Tedavi Planı Satışı"** · onay adımında **"Satışı onayla"** [KOD, korunur] |
| **Nereden açılır** | Hasta kartı · randevu · `/panel/tedavi-planlari` |
| **Kapanan bloklar** | kupon · sadakat puanı |

### 4.5 `LabOrderDialog` — laboratuvar iş emri 🟡

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/LabOrderDialog.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Laboratuvar İş Emri"** |
| **Nereden açılır** | `/panel/laboratuvar` · hasta kartı · randevu (protez provası) |
| **Alanlar** | hasta · diş(ler) · iş türü (kron/köprü/protez/gece plağı) · laboratuvar · **renk (shade)** · gönderim tarihi · beklenen dönüş · maliyet · prova randevusu bağı |

```ts
interface LabOrderDialogProps {
  open: boolean
  onClose: () => void
  tenantId?: string
  branchId?: string
  /** Hasta kartından açılırsa ön dolu gelir. */
  customerId?: string
  /** Var olan emri düzenle. */
  orderId?: string
  onSaved?: () => void
}
```

**Mobil:** liste + durum güncelleme (`lab_orders_screen.dart`).

### 4.6 `RadiographViewer` — radyografi görüntüleyici 🟡

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/RadiographViewer.tsx` |
| **Görünen başlık** | [DİNAMİK] `{görüntü türü} · {tarih}` |
| **Nereden açılır** | `TreatmentJournal` (Klinik Görüntü Arşivi) → görsele tıklayınca |
| **Yetenek** | büyütme · kontrast/parlaklık · diş numarasıyla etiketleme. **DICOM v3'e ertelendi** — v1'de JPEG/PNG. |

```ts
interface RadiographViewerProps {
  open: boolean
  onClose: () => void
  photoId: string
  customerId: string
  onToothTagged?: (toothNumber: number) => void
}
```

### 4.7 `RecallPanel` — kontrol çağrısı 🟢

| | |
|---|---|
| **Dosya** | `components/dashboard/dental/RecallPanel.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Kontrolü Gelen Hastalar"** |
| **Nereden açılır** | Hastalar sayfası `?scope=recall` · Panel "Bugünün Kuyruğu" kartı |
| **Mantık** | Son muayeneden **6 ay** geçmiş hastalar. Mevcut `PassiveCustomersPanel` altyapısının dental hâli — sıfırdan yazmayın, eşiği ve metni değiştirin. |
| **Aksiyon** | Toplu hatırlatma gönder (WhatsApp/SMS · kota `notifications.bulk` ile kapılı) |

```ts
interface RecallPanelProps {
  tenantId?: string
  branchId?: string
  /** Gün cinsinden eşik; varsayılan 180. */
  thresholdDays?: number
  onOpenCustomer?: (customerId: string) => void
}
```

### 4.8 `PerioChart` — periodontal şema 🔴 **(v3, şimdi yazılmayacak)**

Diş başına 6 nokta cep derinliği + kanama indeksi + zaman serisi.
**v1 kapsamında değildir**; adı burada sabitlenmiştir ki ileride başka bir adla üretilmesin.

### 4.9 Yeni rapor sekmesi — `LabTab` 🟢

| | |
|---|---|
| **Dosya** | `components/reports/tabs/LabTab.tsx` |
| **Görünen başlık** | [ÖNERİ] **"Laboratuvar"** |
| **İçerik** | Dönemde gönderilen/gelen iş · lab bazlı maliyet · gecikme |
| **Kural** | Rapor kart seti **sunucudan** gelir (`ReportsService.BuildSummaryMetrics`). Kart tanımını istemcide üretmeyin. |

### 4.10 Yeni sayfaların ana bileşenleri

| Sayfa | Ana bileşen | Görünen başlık |
|---|---|---|
| `/panel/tedavi-planlari` | `TreatmentPlanQueue` [ÖNERİ] | **"Tedavi Planları"** |
| `/panel/laboratuvar` | `LabOrderBoard` [ÖNERİ] | **"Laboratuvar"** |
| `/panel/sterilizasyon` (v2) | `SterilizationLog` [ÖNERİ] | **"Sterilizasyon"** |

---

## 5. TERMİNOLOJİ SÖZLÜĞÜ — isimlerin kaynağı

Ekrandaki her ad buradan üretilir. Bileşen içine sabit metin yazmak **kural ihlalidir**.

**Dosya:** `lib/terminology.ts` · **Kullanım:** `const t = useTerminology()` → `t.customer`

| Anahtar | Güzellik | **Diş (DentistAsist)** |
|---|---|---|
| `customer` | Müşteri | **Hasta** |
| `customerPlural` | Müşteriler | **Hastalar** |
| `customerMine` | Müşterilerim | **Hastalarım** |
| `appointment` | Randevu | Randevu |
| `session` | Seans | **Tedavi seansı** |
| `sessionMine` | Seanslarım | **Tedavi Seanslarım** |
| `service` | Hizmet | **İşlem** |
| `servicePlural` | Hizmetler | **İşlemler** |
| `package` | Paket | **Tedavi planı** |
| `catalog` | Paket & Hizmet | **İşlem & Tedavi Planı** |
| `staff` | Personel | **Ekip** |
| `staffSection` | Personel & Roller | **Hekim & Ekip** |
| `staffPrimary` | Uzman | **Hekim** |
| `staffAssistant` | — | **Asistan** |
| `branch` | Şube | **Klinik** |
| `venue` | Salon | **Klinik** |
| `adisyon` | Adisyon | **Tedavi hesabı** |
| `consultationForm` | Bilgi formu | **Anamnez ve muayene formu** |
| `treatmentJournal` | Tedavi günlüğü | **Klinik görüntü arşivi** |
| `resource` | Oda / Cihaz | **Ünit** |
| `consentForm` | Onam formu | **Aydınlatılmış onam formu** |
| `commission` | Prim | **Hakediş** |
| `product` | Ürün | **Malzeme** |
| `stockSection` | Stok & Ürün | **Stok & Malzeme** |
| `showcase` | Salon Vitrini | **Klinik Bilgi Sayfası** |
| `passiveCustomer` | Pasif müşteri | **Kontrolü gecikmiş hasta** |
| `waitlist` | Bekleme listesi | Bekleme listesi |
| `loyalty` | Sadakat puanı | *(kapalı)* |
| `giftCard` | Hediye çeki | *(kapalı)* |

> **Sözlük çoğul/iyelik taşır.** "Müşterilerim → Hastalarım" gibi ekli biçimleri kod içinde string
> birleştirerek üretmeyin (`t.customer + 'lerim'` Türkçede kırılır) — ayrı anahtar açın.

---

## 6. İSİM DÜZELTMELERİ VE UYARILAR

### 6.1 Düzeltilecek mevcut adlar

| Bugün | Olması gereken | Neden |
|---|---|---|
| `/panel/paket` | **`/panel/abonelik`** | `/panel/paketler` (hizmet paketi) ile tek harf farkla iki ayrı kavram; yanlış tıklama üretiyor. Eski rotadan **kalıcı yönlendirme** bırakılır. Güncellenecek referanslar: `app/panel/ayarlar/page.tsx:482` · `components/dashboard/SubscriptionCountdown.tsx:338` · `lib/guideContent.ts:656` · `components/platform/PlatformMessagingSettings.tsx:304`. Mobil `paket_screen` aynı turda. |
| `label: 'Overview'` (`app/platform/layout.tsx:10`) | **`'Genel Bakış'`** | Üç layout'taki **tek İngilizce etiket**; diğer 80+ etiketin hepsi Türkçe. |
| `label: 'Dashboard'` (panel + ekip) | **`'Panel'`** [ÖNERİ] | Aynı tutarlılık gerekçesi. Onaya tabidir — mevcut kullanıcı alışkanlığı sebebiyle bırakılabilir. |

### 6.2 Ad çakışması riski — dikkat

| Ad | Karışmaması gereken |
|---|---|
| **Tedavi planı** (dental `TreatmentPlan`) | **Tedavi günlüğü** (`TreatmentJournal`, fotoğraf arşivi) — ikisi farklı şey |
| **Ünit** (koltuk/`Resource`) | **Birim** (ölçü) |
| **İşlem** (`ServiceDefinition`) | **İşlem** (banka/kasa hareketi) — finans ekranlarında `t.service` kullanmayın |
| **Plan** (tedavi planı) | **Plan** (abonelik paketi, `SubscriptionPlan`) — platform tarafında |

Bu dört çift için sözlükte **ayrı anahtar** açın; tek anahtarı iki bağlamda kullanmayın.

### 6.3 Yayın kısıtı — arayüzü doğrudan etkiler 🔴

> Hukuki görüş değildir; **koda geçmeden önce mevzuat teyidi alınmalıdır.** Ancak arayüz tasarımını
> etkilediği için burada duruyor.

Sağlık kuruluşlarının tanıtımı güzellik salonlarına göre çok daha dardır. Arayüz sonucu:

| Yüzey | DentistAsist'te |
|---|---|
| `/salonlar` · `/salon/[slug]` yıldız ve yorum | **Yayınlanmaz** — yalnız ad, adres, çalışma saati, online randevu |
| Önce/Sonra görselinin herkese açık paylaşımı | **Kapalı** — panelde klinik takip olarak kalır |
| Kampanya / indirim / hediye çeki | **Kapalı** |
| 5★ → Google yorumu yönlendirmesi | **Kapalı** (iç puan ölçümü kalır) |

### 6.4 KVKK — arayüzde karşılığı olan yükümlülük 🔴

Hasta anamnezi, tedavi kaydı, radyografi ve diş şeması **özel nitelikli kişisel veridir**. Arayüzde
karşılığı olan üç eksik:

1. `KvkkSettingsCard` → **özel nitelikli veri açık rıza metni** (ayrı, genel KVKK metninden farklı).
2. `KvkkSettingsCard` → **saklama ve imha süresi** alanı.
3. `KvkkConsentModal` → **veri ihraç / silme talebi** düğmesi.

**Bu üçü tamamlanmadan ürün canlıya alınmamalıdır** — odontogramdan önce gelen kapıdır.

---

## 7. İŞ SIRASI VE BİTMİŞ SAYILMA

### 7.1 Yapım sırası

| Sıra | İş | Neden bu sırada |
|---|---|---|
| 1 | `lib/terminology.ts` + `useTerminology()` + `Sidebar.verticals` + `ROUTE_VERTICAL_GUARDS` | Her şeyin bağlanacağı omurga |
| 2 | Etiket taraması (§5 sözlüğüne bağlama) | Sonraki her ekran sözlükten okur |
| 3 | Dönüşen 26 bileşen (§3.1) | Mevcut ekranlar dişe döner |
| 4 | `Odontogram` + `ToothStatusPopover` | Klinik çekirdek |
| 5 | `TreatmentPlanBuilder` + `TedaviPlaniDialog` + `/panel/tedavi-planlari` | Odontogram'a bağımlı |
| 6 | `LabOrderDialog` + `/panel/laboratuvar` + `LabTab` | Plana bağımlı |
| 7 | `RecallPanel` + `RadiographViewer` | Bağımsız, sona kalabilir |
| 8 | KVKK üçlüsü (§6.4) | **Canlı öncesi zorunlu** |
| 9 | Tema, landing, `/moduller` | Paralel yürüyebilir |

> **Ünit (koltuk) planlaması bu listede yok** — o iş ana üründe (`Resource`, BeautyAsist B1) yapılır,
> DentistAsist onu tüketir. `AppointmentEditor`'a ünit alanı eklemeden önce o işin bittiğini doğrulayın.

### 7.2 Her iş kalemi için bitmiş sayılma şartı

1. Web `tsc` temiz · `vitest` yeşil · `next build` başarılı.
2. **Mobil aynı turda** (`flutter analyze lib` temiz) — istisna işaretlenmemişse.
3. Yeni modal ise: `ModalPortal` · `role="dialog"` + focus trap · footer deseni (§1.1).
4. Yeni ekranda **sabit metin yok** — `grep -rn "Müşteri\|Seans\|Salon"` sıfır eşleşme (sözlük hariç).
5. Dikeye kapalı özellik **hem menüde hem sunucuda** kapalı — yalnız menüyü gizlemek yetmez.
6. Yeni bileşen adı bu belgedeki adla **birebir aynı** (§4). Ad değişikliği önerisi varsa **önce belge güncellenir**, sonra kod.

### 7.3 Bu belgede olmayan şeyler

- **Backend sözleşmesi:** uç adları ve yeni entity'ler `DentistAsist_Vertikal_Plani.md` §5'te.
- **Tasarım/renk:** teal-slate palet kararı alındı, token seti henüz üretilmedi.
- **v2/v3 modüller:** implant izlenebilirliği · sterilizasyon · reçete · sigorta · `PerioChart` · DICOM — adları §4.8 ve dikey planında sabit, yapımı bu turda değil.
