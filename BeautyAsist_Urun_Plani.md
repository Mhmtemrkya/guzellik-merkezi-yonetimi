# BeautyAsist — Sayfa ve Modal Bazlı Ürün Planı

**Tarih:** 20 Ağustos 2026 · **Kapsam:** web paneli (kurum · personel · platform) + backend uçları + mobil parite
**Yöntem:** rota rota, bileşen bileşen kod okunarak çıkarıldı. Satır sayıları ve bileşen/uç bağları ölçümdür, tahmin değil.

---

## 0. Yöntem ve karar sözlüğü

Bu belge üç soruyu her yüzey için ayrı ayrı cevaplar: **ne var**, **ne değişir**, **ne eklenir/çıkar**.
Karar sütunundaki etiketler tek anlamlıdır:

| Etiket | Anlamı |
|---|---|
| **KALIR** | Bugünkü hâli doğru; bu turda dokunulmaz. |
| **DEĞİŞİR** | İşlev korunur, içerik/yerleşim/alan seti değişir. |
| **BÖLÜNÜR** | Dosya/ekran tek başına taşıyamayacak kadar büyümüş; parçalanır. |
| **BİRLEŞİR** | Aynı işi yapan iki yüzey tek yüzeye iner. |
| **TAŞINIR** | İşlev doğru ama yeri yanlış; başka sayfaya/menüye gider. |
| **SİLİNİR** | Ölü kod / karşılığı kalmamış yüzey. |
| **EKLENİR** | Bugün hiç yok. |

**Değişmeyen mimari kurallar** (plandaki her madde bunlara uyar):

- Şema değişikliği = **yeni EF migration**. Ham SQL bootstrap yok.
- Operasyonel veri `X-Branch-Id` + EF global query filter ile şubeye süzülür.
- Personel yazmaları `StaffApprovalGate` ile taslağa düşer; onayda HttpReplay ile uygulanır.
- DTO alanı eklerken **hem `ToDto` hem explicit `.Select` projeksiyonları** güncellenir.
- Paket gating: `IsFeatureAllowedAsync` (409) + frontend `FeatureGate`/`useFeature`.
- **Web'de yapılan her değişiklik aynı turda mobile de uygulanır** (parite kuralı).

---

## 1. Envanter — sistem bugün ne?

| Ölçüm | Değer |
|---|---|
| Next.js sayfası (`page.tsx`) | **67** (11'i `/ekip` re-export'u) |
| Panel/rapor/platform bileşeni | **138** dosya (bunun ~60'ı modal/dialog/sheet) |
| Backend endpoint dosyası | **48** |
| HTTP ucu (Map*) | **~370** |
| Domain entity | **68** |
| Paket özellik anahtarı (`FeatureCatalog`) | **43** |
| Mobil (Flutter) ekranı | **47** |
| En büyük 5 sayfa | randevular 2.354 · dashboard 2.687 · on-muhasebe 1.755 · musteriler 1.376 · personel 1.370 |
| En büyük 5 bileşen | DayScheduleModal 2.501 · AppointmentEditor 1.891 · PackageSaleDialog 1.764 · CustomerDetailModal 1.523 · CollectionDialog 1.091 |

Ürün bugün şunları uçtan uca yapıyor: çok kiracılı kurum yönetimi, şube kapsamı, randevu + onay/taslak akışı,
adisyon, cari/taksit dağıtımı, iptal arşivi, prim, çizelge/izin, stok, hediye çeki, bekleme listesi otomasyonu,
WhatsApp 2 yönlü hatırlatma, platform SMS/e-posta, onam formu + tablet imza, konsültasyon/anamnez, tedavi günlüğü,
9 sekmeli rapor, salon vitrini + online randevu portalı, iyzico abonelik tahsilatı, self-servis kurum kaydı, 2FA.

---

## 2. Rota haritası (tam liste)

### 2.1 Kurum yöneticisi paneli — `/panel`

| Rota | Satır | Karar | Mobil karşılığı |
|---|---|---|---|
| `/panel` (Dashboard) | 2.687 | **BÖLÜNÜR** | `dashboard_screen` 🟡 |
| `/panel/musteriler` | 1.376 | DEĞİŞİR | `customers_screen` 🟢 |
| `/panel/randevular` | 2.354 | **BÖLÜNÜR** | `appointments_screen` 🟢 |
| `/panel/paketler` | 75 (kabuk) | KALIR | `packages/services_screen` 🟢 |
| `/panel/stok` | 38 (kabuk) | DEĞİŞİR | `stock_screen` 🟢 |
| `/panel/hediye-cek` | 927 | KALIR | `gift_cards_screen` 🟢 |
| `/panel/bekleme-listesi` | 632 | KALIR | `waitlist_screen` 🟢 |
| `/panel/kasa` | 617 | DEĞİŞİR | `cash_screen` 🟢 |
| `/panel/kasa-kapanis` | 436 | KALIR | `cash_closing_screen` 🟡 |
| `/panel/on-muhasebe` | 1.755 | **BÖLÜNÜR** | `on_muhasebe_screen` 🟢 |
| `/panel/raporlar` | 467 + 8 sekme | DEĞİŞİR | `reports_screen` 🟡 |
| `/panel/onaylar` | 583 | KALIR | `approvals_screen` 🟢 |
| `/panel/personel` | 1.370 | DEĞİŞİR | `staff_screen` 🟢 |
| `/panel/personel/cizelge` | 951 | KALIR | `schedule_screen` 🟢 |
| `/panel/bildirimler` | 675 | DEĞİŞİR | `notifications_screen` 🟢 |
| `/panel/salon-profili` | 475 | KALIR | **YOK — parite açığı** |
| `/panel/loglar` | 782 | KALIR | `logs_screen` 🟢 |
| `/panel/ayarlar` | 567 | DEĞİŞİR | `settings_screen` 🟢 |
| `/panel/paket` (abonelik) | 620 | **YENİDEN ADLANDIRILIR** | `paket_screen` 🟢 |

### 2.2 Personel paneli — `/ekip`

| Rota | Satır | Karar | Not |
|---|---|---|---|
| `/ekip` | 590 | KALIR | Personele özgü pano (kendi randevusu, puanı, primi) |
| `/ekip/profil` | 129 | DEĞİŞİR | Cihaz listesi + oturum sonlandırma eklenir |
| `/ekip/seanslar` | 287 | KALIR | Personele özgü seans görünümü |
| `/ekip/musteriler` | 3 | KALIR | `/panel/musteriler` re-export'u |
| `/ekip/randevular` | 3 | KALIR | `/panel/randevular` re-export'u |
| `/ekip/paketler` | 3 | KALIR | `/panel/paketler` re-export'u |
| `/ekip/stok` | 3 | KALIR | `/panel/stok` re-export'u |
| `/ekip/kasa` | 3 | KALIR | `/panel/kasa` re-export'u |
| `/ekip/kasa-kapanis` | 3 | KALIR | `/panel/kasa-kapanis` re-export'u |
| `/ekip/on-muhasebe` | 3 | KALIR | `/panel/on-muhasebe` re-export'u |
| `/ekip/bekleme-listesi` | 3 | KALIR | `/panel/bekleme-listesi` re-export'u |
| `/ekip/hediye-cek` | 3 | KALIR | `/panel/hediye-cek` re-export'u |
| `/ekip/bildirimler` | 3 | KALIR | `/panel/bildirimler` re-export'u |
| `/ekip/loglar` | 3 | KALIR | `/panel/loglar` re-export'u |
| `/ekip/raporlar` | 3 | KALIR | `/panel/raporlar` re-export'u |

> **Re-export deseni bilinçlidir ve korunur:** 12 rotanın hepsi `/panel` sayfasının aynısını dışa vurur;
> rol farkı `useAuth().role` + izin matrisiyle (`permissionKey` · `Sayfa.Aksiyon`) sayfanın **içinde** yapılır.
> Personel için ayrı sayfa yazmak parite bozar — bu yüzden 12 rotanın kararı da **KALIR**.

> Not: `/ekip` yüzeyi izin matrisiyle (`permissionKey` + `Sayfa.Aksiyon`) kapılıdır; aynı dosyanın iki rolde
> farklı davranması `useAuth().role` üzerinden yapılır. Bu yüzden "personel için ayrı sayfa yazma" **yasak** —
> parite bozulur.

### 2.3 Platform paneli — `/platform`

| Rota | Satır | Karar | Ne yapar |
|---|---|---|---|
| `/platform` | 400 | KALIR | Genel KPI + sparkline |
| `/platform/kurumlar` | 811 | DEĞİŞİR | Kurum CRUD, erişim, kimlik bilgisi PDF, vitrin galerisi |
| `/platform/planlar` | 380 | DEĞİŞİR | Abonelik planı + 43 özellik anahtarı ataması |
| `/platform/fatura` | 403 | KALIR | `TenantInvoice` üretimi/durumu |
| `/platform/finans` | 376 | KALIR | Platform geliri, tahsilat |
| `/platform/uyarilar` | 345 | KALIR | Kota/limit uyarıları |
| `/platform/sistem` | 479 | DEĞİŞİR | SMTP/SMS/ödeme ayarları + kalıcı iş kuyruğu |
| `/platform/whatsapp` | 651 | KALIR | Meta bağlantısı, kontör cüzdanı, fiyat kuralları |
| `/platform/aktarim` | 417 | KALIR | Kolon-agnostik Excel toplu aktarım |

### 2.4 Herkese açık ve ara yüzeyler

| Rota | Satır | Karar | Not |
|---|---|---|---|
| `/` (landing) | 741 | KALIR | Sinematik tek-çekim + apple katmanı; eski `landing/*` seti zaten silinmiş |
| `/moduller` | 355 | KALIR | Paket/yetki tanıtım sayfası |
| `/odeme` | 27 + `CheckoutClient` 422 | KALIR | Sepet → iyzico; **kart alanları iyzico'nun, kendi formumuz yok** |
| `/kayit` | 939 | KALIR | Self-servis kurum kaydı, e-posta + telefon çift doğrulama |
| `/login` | 1.243 | **BÖLÜNÜR** | Rol seçimi + kurum kapsamı + 2FA tek dosyada |
| `/change-password` | 393 | KALIR | |
| `/randevu`, `/randevu/giris` | 926 + 642 | DEĞİŞİR | Online müşteri portalı; kapora tahsilatı eksik |
| `/salonlar`, `/salon/[slug]` | 435 + 955 | KALIR | Anonim vitrin + yorumlar |
| `/rate/[token]` | 307 | DEĞİŞİR | Puanlama sayfası; link randevu tamamlanınca **otomatik** gönderilir (§8.1) |
| `/hediye-kart/[slug]/[code]` | 163 | KALIR | QR hedefi |
| `/kvkk/[slug]` | 89 | KALIR | Kuruma özel aydınlatma metni |
| `/imza` | 411 | KALIR | Tablet imza istasyonu |
| `/gizlilik`, `/hakkimizda`, `/mesafeli-satis-sozlesmesi`, `/teslimat-ve-iade` | 144/106/205/139 | KALIR | iyzico yasal sayfa şartı |

---

## 3. Sayfa bazlı plan

Efor işaretleri: 🟢 düşük (≤1 gün) · 🟡 orta (2–4 gün) · 🔴 yüksek (1 hafta+) · 🔌 dış entegrasyon/sözleşme gerekir.

### 3.1 Kurum yöneticisi paneli

#### `/panel` — Dashboard · 2.687 satır · **BÖLÜNÜR**

**Bugün ne var:** `DashboardHero`, `SubscriptionCountdown` (canlı abonelik sayacı), KPI kartları + `AnimatedNumber`, `PackageReportBreakdown` (paket raporu kırılımı), `CustomerReviewsCard`, `AnchoredPopover`, `CatalogPicker`. Beslendiği uçlar: `accountReport`, `appointments`, `cashFlow`, `cashFlowSummary`, `customersStats`, `packages`, `passiveCustomers`, `pendingOperations`, `products`, `services`, `staff` — **tek sayfada 11 ayrı sorgu.**

| | |
|---|---|
| **Sorun** | 2.687 satırlık tek dosya; paket raporu bloğu Raporlar sayfasındaki `CatalogTab` ile aynı işi iki yerde yapıyor (çift bakım riski, §8.3). 11 paralel sorgu ilk boyamayı geciktiriyor. |
| **BÖLÜNÜR** | `components/dashboard/home/` altına: `HeroBand` · `KpiRow` · `TodayQueue` · `RevenueStrip` · `ReviewsStrip`. Sayfa yalnız kompozisyon kalır (~250 satır). |
| **EKLENİR** | **"Bugünün Kuyruğu" kartı** — tek yerde: imza bekleyen onam formu · onay bekleyen personel işlemi · bugün vadesi gelen taksit · bugün doğum günü olan müşteri · kritik stok. Her satır ilgili ekrana derin link. Bugün bu beş bilgi beş ayrı sayfada duruyor. |
| **TAŞINIR** | `PackageReportBreakdown` → `/panel/raporlar` (Katalog sekmesi). Dashboard'da yalnız özet satırı kalır. |
| **Backend** | Yeni uç: `GET /api/admin/dashboard/today` — beş kuyruğu tek yanıtta döner (11 sorgu → 3). Mevcut servislerin üstünde toplayıcı; yeni tablo yok. |
| **Mobil** | `dashboard_screen`'e aynı kuyruk kartı. |
| **Efor** | 🟡 |

#### `/panel/musteriler` — 1.376 satır · DEĞİŞİR

**Bugün ne var:** `CustomerFormDialog`, `CustomerDetailModal`, `PackageSaleDialog`, `HistoricalSaleDialog`, `ImportDialog`, `ExcelTransferActions`, `BulkSelectBar`, `CustomerSalesPanel`, `PassiveCustomersPanel`, `GiftCardScanModal`, `AppointmentEditor`, `SaleDetailModal`. Sunucu taraflı arama, KVKK toplu talep, kara liste, VIP, geçmiş satış aktarımı.

| | |
|---|---|
| **EKLENİR — Müşteri birleştirme (merge)** | Aynı kişi iki kez kaydolduğunda bugün **hiçbir çıkış yok**; silmek cari/randevu geçmişini götürüyor. `POST /api/admin/customers/{id}/merge {targetId}` — randevu, cari, seans, adisyon, sadakat, onam, foto hedefe taşınır; kaynak soft-delete + `MergedIntoId`. Blind index çakışmasında (aynı telefon) listede "olası kopya" rozeti. 🟡 |
| **EKLENİR — RFM segmenti** | Şampiyon / Sadık / Riskli / Kayıp sekmesi. Pasif müşteri tespiti zaten var; skoru olasılığa çevirmek yeterli. Segment → toplu WhatsApp kampanyası. 🟡 |
| **EKLENİR — Toplu mesaj** | `BulkSelectBar`'a "Seçilenlere mesaj" (şablon + kanal). Kota `notifications.bulk` ile zaten kapılı. 🟢 |
| **DEĞİŞİR** | Sekmeler `?scope=` ile geliyor (all / kvkk / kvkk-pending / recent). Buraya `segment` ve `duplicates` eklenir. |
| **Backend** | `customers/merge`, `customers/segments`, `customers/duplicates` (üçü de yeni). |
| **Mobil** | Merge + segment sekmesi `customers_screen`'e. |
| **Efor** | 🟡 |

#### `/panel/randevular` — 2.354 satır · **BÖLÜNÜR**

**Bugün ne var:** 20 bileşen — `AppointmentEditor` (1.891), `DayScheduleModal` (2.501), `ManagerAppointmentInbox`, `CompleteAppointmentDialog`, `AdisyonModal`, `DailyAdisyonModal`, `CollectionDialog`, `AppointmentReminderControl`, `AppointmentsCalendarLinkButton`, `PackageSaleDialog`, `CustomerFormDialog`. 19 ayrı `adminApi` çağrısı.

| | |
|---|---|
| **BÖLÜNÜR** | Sayfa üç görünüme ayrılır: `AppointmentListView` · `AppointmentCalendarView` · `AppointmentInboxView`. Ortak durum `useAppointmentsController()` hook'una çıkar. `DayScheduleModal` da kendi içinde bölünür (üst çubuk / ızgara / sürükle-bırak katmanı). |
| **EKLENİR — Kaynak (oda/cihaz) planlama** | Bugün yalnız **personel** çakışması kontrol ediliyor. Paylaşılan lazer/kavitasyon cihazı iki randevuya aynı anda verilebiliyor. `Resource(Name, Type, BranchId)` + `ServiceDefinition.RequiredResourceId` + çizelgede kaynak sütunu. **Piyasa standardı; en büyük tek eksik.** 🔴 |
| **EKLENİR — Seans serisi otomatik planlama** | 8 seanslık paket satılınca "haftada 1, salı 14:00" kuralıyla seansları tek tıkla yaymak. Bugün 8 randevu tek tek açılıyor. 🟡 |
| **İSTEĞE BAĞLI — Elle puanlama linki** | Puanlama linki tamamlamada **otomatik** gidiyor (§8.1), yetenek eksik değil. Eksik olan yalnız **elle tetik**: WhatsApp'ı olmayan müşteri için linki ekranda gösterme. Mobilde var (`appointment_detail_sheet.dart:1064`), webde yok. Değeri düşük; Faz A'ya alınmadı. 🟢 |
| **Backend** | `Resource` entity + migration; `AppointmentService` çakışma kontrolüne kaynak boyutu; `POST /appointments/series`. |
| **Mobil** | Kaynak seçimi + seri planlama `appointments_screen`'e. |
| **Efor** | 🔴 |

#### `/panel/paketler` — 75 satır kabuk · KALIR (bir taşıma ile)

**Bugün ne var:** `CategoryExplorer` (946) · `PackageLibrary` (947) · `ServiceLibrary` (813) · ortak `CatalogKit` (700). Paket iptali (gerekçeli) ve `CatalogSalesPanel` (kart bazlı satış performansı) burada.

| | |
|---|---|
| **TAŞINIR — Kampanyalar** | `CampaignPanel` bugün `PackageLibrary`'nin **içine gömülü** (satır 837) ve sidebar'da girişi yok. `marketing.campaigns` özelliğini satın alan kurum onu bulamıyor. Ya kendi rotası (`/panel/kampanyalar`) ya da Paket & Hizmet altında görünür bir alt sekme. 🟢 |
| **EKLENİR** | Hizmet → **sarf reçetesi** sekmesi (bkz. `/panel/stok`). |
| **Efor** | 🟢 |

#### `/panel/stok` — 38 satır kabuk · DEĞİŞİR

**Bugün ne var:** `ProductLibrary` (478), `ProductDetailModal` (506), `ProductFormDialog` + `BarcodeScanField`, stok hareketi.

| | |
|---|---|
| **EKLENİR — Hizmet/sarf reçetesi + otomatik düşüm** | `ServiceConsumable(ServiceDefinitionId, ProductId, Quantity)`. Randevu "Tamamlandı" olunca sarf otomatik düşer. Bugün sarf elle düşülüyor → envanter ve hizmet kârı gerçek değil. 🟡 |
| **EKLENİR — Tedarikçi & satın alma** | `Supplier` + `PurchaseOrder`; stok girişi tedarikçi carisine bağlanır. Gider tarafı bugün serbest metin. 🟡 |
| **Backend** | İki yeni entity + düşüm kancası mevcut **atomik `/complete` ucunun içinde** (ayrı çağrı değil — idempotency korunur). |
| **Efor** | 🟡 |

#### `/panel/kasa` — 617 satır · DEĞİŞİR

**Bugün ne var:** `CollectionDialog`, `ExpenseFormDialog`, gelir-gider akışı, `registerAccountPayment`.

| | |
|---|---|
| **EKLENİR — Çoklu kasa/banka hesabı** | `CashAccount(Name, Type[Cash·Bank·POS], BranchId)` + hesaplar arası transfer. Bugün tek kasa varsayımı var; POS/banka/nakit ayrımı raporda yapılamıyor. 🟡 |
| **EKLENİR** | Gün içi kasa için "devir" satırı (dünkü kapanış → bugünkü açılış otomatik). 🟢 |
| **Efor** | 🟡 |

#### `/panel/on-muhasebe` — 1.755 satır · **BÖLÜNÜR**

**Bugün ne var:** 21 bileşen. `CustomerLedgerModal` (551, tam sayfa defter), `AccountDetailModal` (528), `AccountStatementSheet` (355, çift taraflı ekstre + PDF), `CariSalesWorkspace`, `CollectionDialog` (1.091), `AdisyonModal`/`AdisyonPanel` (913), `DailyAdisyonModal`, `AdisyonReceiptModal`, `CancelledSalesModal` (iptal arşivi), `NewAccountDialog`, `SalaryPaymentDialog`, `ExpenseFormDialog`, `PaymentScheduleGrid`.

| | |
|---|---|
| **BÖLÜNÜR** | Sayfa bugün altı işi taşıyor: cari tablosu · adisyon · tahsilat · gider · maaş · iptal arşivi. Sekme başına bir dosya (`sections/CariSection.tsx` vb.); sayfa yalnız sekme kabuğu kalır. Davranış değişmez. |
| **EKLENİR — KDV / vergi özeti** | Dönemsel KDV matrahı + hesaplanan/indirilecek KDV. Muhasebeciye giden ilk çıktı; bugün Excel'e elde çıkarılıyor. 🟢 |
| **EKLENİR — e-Fatura / e-Arşiv** | Entegratör üzerinden fatura kesimi. **🔌 sözleşme + anahtar gerekir**; anahtar gelene kadar simülasyon modunda geliştirilir (WhatsApp/SMS'teki desen). 🔴🔌 |
| **KORUNUR (dokunma)** | Peşinat **plan alanıdır**; taksitler sabit plan, tahsilatlar vade sırasıyla dağıtılır. Bu semantik testlerle sabitlenmiştir. İptal = **taşıma** (canlı satır silinir, snapshot `cancelled_sales`e gider). |
| **Efor** | 🟡 (bölme) + 🔴🔌 (e-fatura) |

#### `/panel/raporlar` — 467 satır + 8 sekme · DEĞİŞİR

**Bugün ne var:** `ReportFilterBar`, `MetricDetailModal`, `ReportCharts` (710, bağımsız SVG kiti) ve sekmeler: Overview · Catalog · Staff · Branches · Customers · Inventory · GiftCards · Compare. Kart seti **sunucudan** gelir (`ReportsService.BuildSummaryMetrics`) — tek tanım.

| | |
|---|---|
| **EKLENİR — Vergi/KDV sekmesi** | Ön Muhasebe'deki KDV özetinin rapor tarafı. 🟢 |
| **EKLENİR — Zamanlanmış rapor** | "Her ayın 1'i 08:00 e-posta" — `MonthlyReportBackgroundService` zaten var, kullanıcı tarafı yok. 🟢 |
| **DEĞİŞİR** | `PackageReportBreakdown` dashboard'dan buraya taşınır (Katalog sekmesi altına). |
| **KORUNUR** | Kart seti değişikliği **üç yerde birden** yapılır (sunucu tanımı · sekme eşlemesi · mobil). Satış ekseni (`OpenReceivable`/`TotalPaid`) ile taksit ekseni (`TotalReceivable`/`TotalCollected`) karıştırılmaz. |
| **Efor** | 🟢 |

#### `/panel/personel` — 1.370 satır · DEĞİŞİR

**Bugün ne var:** `StaffFormDialog` (917), `TenantCredentialsDialog`, `CommissionPanel`, `StaffDeviceDialog`, `StaffWorkingHoursDialog`, `StaffCalendarLinkButton`, şube transferi, şifre sıfırlama, iki seviyeli yetki (`Sayfa.Aksiyon`), yıldız/performans.

| | |
|---|---|
| **EKLENİR — Yetkinlik matrisi** | `StaffServiceSkill(StaffId, ServiceDefinitionId)`. Randevu atamada "bu hizmeti yapabilen personel" filtresi. Bugün herkes her hizmete atanabiliyor. 🟡 |
| **EKLENİR — Bordro / hakediş kapanışı** | `PayrollPeriod` + `PayrollLine(Base, Commission, Advance, Deduction, Net)`. Prim hesabı hazır; eksik olan dönem kapanışı ve tek ekran. 🟡 |
| **EKLENİR — Vardiya giriş/çıkış** | QR veya panelden "mesaiye başla/bitir"; çizelgeyle karşılaştırma. 🟡 |
| **KORUNUR** | Personel telefon/e-posta maskeleme (`PhoneMask` + `ICurrentUser`) — yeni DTO eklerken maskeleme de eklenir. |
| **Efor** | 🟡 |

#### `/panel/personel/cizelge` — 951 satır · KALIR

Günlük/haftalık/aylık ajanda, Gün Kapat (saat aralığı), izin. **KRİTİK:** yerel-tarih modeli (UTC değil) — bu sayfada tarih işlemi yaparken kural bozulmaz. Kaynak (oda/cihaz) planlaması gelirse çizelgeye **kaynak sütunu** eklenir; o iş `/panel/randevular` kalemine bağlıdır.

#### `/panel/bildirimler` — 675 satır · DEĞİŞİR

**Bugün ne var:** şablon CRUD, gönderim, `AutomationStatusPanel`, ödeme hatırlatmalarını çalıştır, `notificationSummary`.

| | |
|---|---|
| **KARAR BEKLİYOR (yeni iş değil)** | WhatsApp bugün **kurum bazlı** (`WhatsAppSettings`), SMS/e-posta **platformda** (`PlatformIntegrationSettings`). Tutarsızlık bilinçli olarak **ertelendi** (16 Haz 2026); planı `whatsappsmsmailneolacak.md`'de duruyor. Bu belge işi yeniden açmaz, yalnız açık kalemi işaretler. |
| **EKLENİR** | Şablon **önizleme + test gönderimi** (kendi numarama). Bugün şablon canlıya çıkmadan denenemiyor. 🟢 |
| **Efor** | 🟢 |

#### `/panel/salon-profili` — 475 satır · KALIR

Vitrin profili, logo, galeri, KVKK metni, yayına alma. **Mobil karşılığı yok — parite açığı** (§8.2).

#### `/panel/ayarlar` — 567 satır · DEĞİŞİR

**Bugün ne var:** kurum bilgisi, şube CRUD, `WhatsAppSettingsCard`, `WhatsAppWalletCard`, `SecuritySettingsCard`, `KvkkSettingsCard`, `ConsentTemplatesCard`, `UsageBar` (kota), abonelik kartı.

| | |
|---|---|
| **EKLENİR — Marka/tema özelleştirme** | Kuruma özel logo + birincil renk. Altyapı hazır (vitrin logosu, `globals.css` değişkenleri). 🟡 |
| **EKLENİR — KVKK veri hakları** | "Müşterimin verilerini dışa aktar / sil" akışı. Aydınlatma metni ve onay var; **talep karşılama** yok — KVKK'nın asıl yükümlülüğü bu. 🟡 |
| **DEĞİŞİR** | Sayfa 7 kart taşıyor; sekmelenir (Kurum · Şubeler · Mesajlaşma · Güvenlik · KVKK & Onam · Abonelik). 🟢 |
| **Efor** | 🟡 |

#### `/panel/paket` — 620 satır · **YENİDEN ADLANDIRILIR → `/panel/abonelik`**

Bu sayfa **abonelik satın alma** sayfasıdır (`billingSummary`, `startBillingCheckout`, `upgradeTenantPlan`, `removeBillingCard`). Komşusu `/panel/paketler` ise **hizmet paketi** kataloğudur. İki rota tek harf farkla tamamen farklı iki kavramı taşıyor; yanlış tıklama ve destek çağrısı üretiyor.

- Yeni rota `/panel/abonelik`; eski rotadan kalıcı yönlendirme bırakılır.
- Güncellenecek referanslar: `app/panel/ayarlar/page.tsx:482` · `components/dashboard/SubscriptionCountdown.tsx:338` · `lib/guideContent.ts:656` · platform ödeme `returnUrl` varsayılanı (`PlatformMessagingSettings.tsx:304`).
- Mobil `paket_screen` aynı turda yeniden adlandırılır. **Efor:** 🟢

### 3.2 Personel paneli — `/ekip`

| Rota | Karar | Ne değişir |
|---|---|---|
| `/ekip` (pano) | KALIR | Kendi randevusu, yıldız ortalaması, primi. `/panel` kuyruk kartının personel varyantı eklenebilir. 🟢 |
| `/ekip/profil` | DEĞİŞİR | **Kendi cihazlarım** listesi + "bu cihazdan çık" (`StaffDevice` verisi var, personel yüzeyi yok). 🟢 |
| `/ekip/seanslar` | KALIR | Seans yazımı "3 seans kaldı" biçiminde kalır (oran yalnız başlıklı rapor sütunlarında). |
| Re-export'lar (11 rota) | KALIR | Yeni personel sayfası **yazılmaz**; `/panel` sayfası rol + izinle davranır. |

### 3.3 Platform paneli — `/platform`

| Rota | Karar | Ne değişir |
|---|---|---|
| `/platform/kurumlar` | DEĞİŞİR | Kurum kartına **sağlık rozeti** (son giriş, aktif kullanıcı, 7 günlük randevu hacmi) — churn erken uyarısı. Bugün platform kurumun ölmekte olduğunu göremiyor. 🟡 |
| `/platform/planlar` | DEĞİŞİR | 43 özellik anahtarı düz liste hâlinde; kategorilere ayrılır + "plan farkı" karşılaştırma sütunu. 🟢 |
| `/platform/sistem` | DEĞİŞİR | Kalıcı iş kuyruğu (`background_jobs`) görünümüne dead-letter yeniden deneme + filtre. Uçlar var (`/queue`, `/queue/{id}/requeue`), yüzey zayıf. 🟢 |
| `/platform/fatura`, `/finans`, `/uyarilar`, `/whatsapp`, `/aktarim`, `/platform` | KALIR | — |
| **EKLENİR — `/platform/destek`** | Kurum adına oturum açma (impersonation) **denetim kaydıyla**. Bugün destek için şifre sıfırlanıyor; iz bırakmıyor ve kurumun parolasını bozuyor. 🟡 |

### 3.4 Herkese açık yüzeyler

| Rota | Karar | Ne değişir |
|---|---|---|
| `/login` (1.243 satır) | **BÖLÜNÜR** | Rol seçimi · kurum kapsamı · parola · 2FA adımları ayrı bileşenlere. Davranış değişmez. 🟢 |
| `/randevu` (online portal) | DEĞİŞİR | **Kapora/ön ödeme** eklenir (iyzico hattı kurulu) → no-show düşer. Bugün 3-randevu limiti ve NoShow sayacı var ama para yok. 🟡🔌 |
| `/rate/[token]` | DEĞİŞİR | 5★ verene Google/Instagram yorum yönlendirmesi. 🟢 |
| `/salon/[slug]`, `/salonlar` | KALIR | Anonim vitrin + yorum + KVKK. |
| `/`, `/moduller`, `/odeme`, `/kayit` | KALIR | Yakın zamanda elden geçti; bu turda dokunulmaz. |
| Yasal 4 sayfa | KALIR | iyzico kriteri; künye `lib/legal/company.ts`'ten gelir. |

---

## 4. Modal / dialog / panel bazlı plan

**138 bileşenin tamamı** aşağıda. Hiçbiri atlanmadı; "KALIR" bir karardır, ihmal değildir.
Satır sayıları ölçümdür.

### 4.1 Randevu ve çizelge

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `AppointmentEditor` | 1.891 | **BÖLÜNÜR** | Sistemin ikinci en büyük dosyası. İçinde: müşteri seçimi, seans/satış bağı, personel, saat, not, konsültasyon uyarısı, yardım. Adım bileşenlerine ayrılır; **altın kural** (randevu seanstan açılır, seans satıştan doğar) korunur. Kaynak (oda/cihaz) seçimi buraya girer. |
| `DayScheduleModal` | 2.501 | **BÖLÜNÜR** | Sistemin en büyük dosyası. Tam ekran takvim: KPI, filtre, sürükle-bırak, VIP. Üç katmana ayrılır (başlık/filtre · ızgara · etkileşim). Davranış değişmez. |
| `CompleteAppointmentDialog` | 427 | DEĞİŞİR | Adım 0 onam kapısı kalır. Sarf reçetesi düşümü bu akışın **sunucu** tarafına girer (puanlama işi gibi, `/complete` içinde). İsteğe bağlı: elle puanlama linki gösterimi. |
| `ManagerAppointmentInbox` | 225 | KALIR | Saati gelmiş randevu → Tamamlandı / Gelmedi / Ertele. |
| `AppointmentHelpDialog` | 231 | KALIR | "Altın kural" kılavuzu. Kaynak planlaması gelince bir madde eklenir. |
| `AppointmentReminderControl` | 65 | KALIR | WhatsApp onay rozeti + Hatırlat. |
| `AppointmentsCalendarLinkButton` | 131 | KALIR | Kurum geneli ICS aboneliği. |
| `StaffCalendarLinkButton` | 138 | KALIR | Personel ICS aboneliği. |
| `RatingQrModal` | 126 | **SİLİNİR** | Elle QR akışının kalıntısı. Puanlama linki artık tamamlamada **otomatik** gönderiliyor (§8.1), bu modal hiçbir yerden çağrılmıyor. Silinmesi bir yetenek kaybetmez. |

### 4.2 Müşteri

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `CustomerDetailModal` | 1.523 | **BÖLÜNÜR** | Sekmeli müşteri kartı. Sekme başına dosya; "Genel Bakış" grafiği + hızlı işlemler kalır. **Birleştirme (merge)** aksiyonu buraya eklenir. |
| `CustomerFormDialog` | 464 | DEĞİŞİR | Kayıt sırasında **olası kopya uyarısı** (aynı telefon blind index'te varsa). |
| `CustomerPicker` | 230 | KALIR | Sunucu taraflı arama (12 bin+ müşteride zorunlu). Yeni müşteri seçimi gereken her yeni yüzey bunu kullanır. |
| `CustomerHistoryPanel` | 508 | KALIR | Seans/işlem geçmişi; paket kaynaklı seans `sourceSessionId` ile ayrılır. |
| `CustomerSalesPanel` | 277 | KALIR | Aktif/tamamlanmış/iptal satışlar. |
| `CustomerSalesModal` | 220 | KALIR | Satış listesinin tam ekran hâli. |
| `SaleDetailModal` | 565 | KALIR | Satış künyesi + satan personel + seans dökümü. |
| `CustomerSessionsCard` | 222 | KALIR | Hizmet bazlı seans bakiyesi. "3 seans kaldı" yazımı korunur. |
| `SessionProgressRing` | 75 | KALIR | Seans ilerleme halkası. |
| `CustomerOperationsJournal` | 297 | KALIR | İşlem defteri; etiketler ortak çeviriciden. |
| `CustomerBlacklistCard` | 78 | KALIR | Kara liste (randevu 409). |
| `CustomerVipToggle` | 83 | KALIR | VIP rozeti. |
| `CustomerReviewsCard` | 149 | KALIR | Pano yorum kartı. |
| `PassiveCustomersPanel` | 87 | DEĞİŞİR | RFM segmentine giriş noktası olur (Riskli/Kayıp buradan beslenir). |
| `LoyaltyCard` | 89 | KALIR | Sadakat puanı; `loyalty.points` ile kapılı. |
| `KvkkConsentModal` | 120 | DEĞİŞİR | Aydınlatma + onay var; **veri ihraç/silme talebi** düğmesi eklenir. |

### 4.3 Satış · adisyon · cari · tahsilat

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `CollectionDialog` | 1.091 | KALIR | Tek "Tahsilat Al" modalı (iki modal birleştirilmişti — geri bölünmez). Fazla ödeme onayı, kalıcı idempotency tuzu, tie-breaker sıralaması **testlerle sabit**. |
| `AdisyonPanel` | 913 | KALIR | Kalem ekleme = satış, ödeme/peşinat, sadakat, onay, silme. |
| `AdisyonModal` | 139 | KALIR | `AdisyonPanel`'in modal kabuğu. |
| `AdisyonReceiptModal` | 194 | KALIR | Kapanmış adisyonun okunur fişi. |
| `DailyAdisyonModal` | 375 | KALIR | Günlük kart görünümü. |
| `CustomerLedgerModal` | 551 | KALIR | Müşterinin bütün satışları tek defterde. |
| `AccountDetailModal` | 528 | KALIR | Özet · Taksit Planı · Ekstre · Seans & Sadakat. |
| `AccountStatementSheet` | 355 | KALIR | Çift taraflı ekstre + PDF. |
| `CariSalesWorkspace` | 199 | KALIR | Müşteri bazlı satış çalışma alanı. |
| `PaymentScheduleGrid` | 220 | KALIR | Taksit **tarih listesi** (aylık ızgara bilinçli olarak kaldırılmıştı — geri gelmez). |
| `NewAccountDialog` | 312 | KALIR | Taksit planı canlı önizlemeli yeni cari. |
| `PackageSaleDialog` | 1.764 | **BÖLÜNÜR** | Üçüncü en büyük dosya. Paket/hizmet satışı + peşinat + taksit + onam uyarısı + kupon. Adımlara ayrılır. |
| `HistoricalSaleDialog` | 1.035 | KALIR | Geçmiş evrak aktarımı; kronoloji kuralı (`satış ≤ seans ≤ bugün`) korunur. |
| `CancelledSalesModal` | 277 | KALIR | İptal arşivi (`cancelled_sales`). |
| `ExpenseFormDialog` | 468 | DEĞİŞİR | Çoklu kasa geldiğinde "hangi kasadan" alanı eklenir. |
| `SalaryPaymentDialog` | 268 | DEĞİŞİR | Bordro dönemi gelince "dönem kapanışından üret" seçeneği. |
| `CommissionPanel` | 95 | DEĞİŞİR | Bordroya bağlanır (prim → hakediş satırı). |
| `CheckoutClient` | 422 | KALIR | **Kart alanları iyzico'nun; kendi form alanımızı yazmak yasak.** |

### 4.4 Katalog — hizmet · paket · ürün · kategori

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `CatalogKit` | 700 | KALIR | Hizmet + Paket sayfalarının ortak dili; sayaç = süzgeç. |
| `ServiceLibrary` | 813 | DEĞİŞİR | **Sarf reçetesi** sekmesi eklenir. |
| `PackageLibrary` | 947 | DEĞİŞİR | İçindeki `CampaignPanel` **dışarı taşınır** (§3.1). |
| `ProductLibrary` | 478 | DEĞİŞİR | Tedarikçi alanı + satın alma girişi. |
| `CategoryExplorer` | 946 | KALIR | Gerçek + türetilmiş kategori ayrımı korunur. |
| `CatalogCategoryManager` | 204 | KALIR | Kategori ekleme tek kaynak (Kategoriler sayfası). |
| `CatalogCategoryRail` | 427 | KALIR | Kategori/alt kategori şeridi. |
| `CatalogPicker` | 174 | KALIR | Kategori + arama ile kaynak seçici. |
| `CatalogSalesPanel` | 542 | KALIR | Katalog kartında satış performansı. |
| `ServiceFormDialog` | 606 | DEĞİŞİR | Gerekli **kaynak (oda/cihaz)** ve **sarf reçetesi** alanları eklenir. |
| `ServiceDetailModal` | 359 | DEĞİŞİR | Reçete + kaynak bilgisi künyeye. |
| `PackageEditorModal` | 810 | KALIR | Paket düzenleyici. (Eski PUT 500 hatası **15 Ağu 2026'da kapandı** — canlı doğrulandı.) |
| `ProductFormDialog` | 355 | KALIR | Barkod okuyucu bağlı. |
| `ProductDetailModal` | 506 | KALIR | Ürün künyesi + hareket. |
| `BarcodeScanField` | 219 | KALIR | İki yol (donanım okuyucu + kamera). |
| `ServiceIcons` | 228 | **DİKEYE BAĞLANIR** | Güzellik temalı SVG kütüphanesi. DentistAsist'te ayrı set gerekir (bkz. dikey planı). |
| `CampaignPanel` | 210 | **TAŞINIR** | Sidebar'da girişi olmayan gizli modül. |
| `PackageReportBreakdown` | 492 | **TAŞINIR** | Dashboard → Raporlar/Katalog. |

### 4.5 Klinik — onam · konsültasyon · tedavi günlüğü

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `ConsentCenterModal` | 510 | KALIR | Onam merkezi; imza yoklaması. |
| `ConsentTemplatesCard` | 479 | KALIR | Şablon yönetimi (Ayarlar). |
| `ConsentPicker` | 285 | KALIR | Hizmet/pakete form bağlama. |
| `ConsentSaleNotice` | 67 | KALIR | Satışı engellemez, bilgilendirir. |
| `ConsentWarningBanner` | 113 | KALIR | Eksik onam uyarısı (sessiz). |
| `SignaturePad` | 147 | KALIR | Pointer Events; tablet/kalem/fare tek API. |
| `ConsultationForm` | 394 | **DİKEYE BAĞLANIR** | Anamnez. Alan seti (Fitzpatrick/cilt tipi) **güzelliğe özgü** — dikey konfigürasyonuna çıkarılır. |
| `ConsultationFormModal` | 72 | KALIR | Randevu içinden form doldurma. |
| `ConsultationWarningBanner` | 126 | KALIR | Kontrendikasyon uyarısı. |
| `TreatmentJournal` | 322 | KALIR | Önce/Sonra fotoğraf günlüğü. |
| `BeforeAfterSlider` | 75 | KALIR | Karşılaştırma kaydırıcısı. |

### 4.6 Hediye çeki ve kupon

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `GiftCardArtwork` | 384 | KALIR | Canvas kart görseli. |
| `GiftCardShareModal` | 365 | KALIR | PNG + WhatsApp paylaşımı. |
| `GiftCardScanModal` | 281 | KALIR | QR ile müşteriye bağlama. |
| `GiftCardEditModal` | 266 | KALIR | Kod/tür/değer **değiştirilemez** kuralı korunur. |

### 4.7 Personel · yetki · güvenlik

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `StaffFormDialog` | 917 | DEĞİŞİR | **Yetkinlik matrisi** sekmesi (hangi hizmeti yapabilir). |
| `StaffWorkingHoursDialog` | 231 | KALIR | Haftalık mesai; tek zorlama noktası `WorkingHoursGuard`. |
| `StaffDeviceDialog` | 251 | KALIR | Cihaz güvenliği (`security.devicecontrol`). |
| `TenantCredentialsDialog` | 268 | KALIR | Kimlik bilgisi kartı/PDF (çoklu yönetici). |
| `SecuritySettingsCard` | 143 | KALIR | Ekran görüntüsü izni. |
| `KvkkSettingsCard` | 145 | KALIR | Aydınlatma metni düzenleme. |
| `SessionExpiredModal` | 62 | KALIR | Global 401 kapısı. |
| `RouteGuard` | 70 | KALIR | Rota yetki kapısı. |
| `ApprovalToast` | 73 | KALIR | Personel yazması taslağa düştü bildirimi. |
| `ConfirmDialog` | 163 | KALIR | Gerekçe zorunlu varyantı korunur. |

### 4.8 Bildirim · otomasyon · anlık

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `AutomationStatusPanel` | 69 | KALIR | Tetikleyici bazlı otomasyon durumu. |
| `WhatsAppSettingsCard` | 245 | **KARAR BEKLİYOR** | Platforma taşıma ertelendi; bu turda dokunulmaz. |
| `WhatsAppWalletCard` | 238 | KALIR | Kontör cüzdanı; havale yolu korunur. |
| `RealtimeContext` | 221 | KALIR | SignalR; olay veri taşımaz, "konu değişti" der. |
| `RealtimeToast` | 88 | KALIR | Onay sonucu anlık bildirimi. |

### 4.9 Rapor bileşenleri

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `ReportCharts` | 710 | KALIR | Bağımsız SVG kiti. |
| `ReportUi` | 410 | KALIR | KPI kartı, bölüm, tablo, rozet. |
| `ReportFilterBar` | 221 | DEĞİŞİR | Şube çoklu seçimi + kaydedilmiş filtre. 🟢 |
| `MetricDetailModal` | 220 | KALIR | KPI detay modali. |
| `MetricDetailContext` | 81 | KALIR | Tek yerden modal yönetimi. |
| `OverviewTab` | 176 | KALIR | Kart seti sunucudan gelir. |
| `CatalogTab` | 434 | DEĞİŞİR | `PackageReportBreakdown` buraya taşınır. |
| `StaffTab` | 422 | DEĞİŞİR | Bordro geldiğinde hakediş sütunu. |
| `BranchesTab` | 251 | KALIR | Şube karşılaştırması. |
| `CustomersTab` | 165 | DEĞİŞİR | RFM segment dağılımı eklenir. |
| `InventoryTab` | 204 | DEĞİŞİR | Sarf/fire, reçete gelince gerçekleşir. |
| `GiftCardsTab` | 171 | KALIR | Çek/kupon raporu. |
| `CompareTab` | 418 | KALIR | 2–5 dönem yan yana. |
| **EKLENİR — `TaxTab`** | — | **EKLENİR** | KDV matrahı + hesaplanan/indirilecek. 🟢 |

### 4.10 Platform modalları

| Bileşen | Satır | Karar | Ne değişir |
|---|---|---|---|
| `CreateTenantDialog` | 1.009 | KALIR | Kurum + çoklu yönetici + dönem seçimi. **Dikey (VerticalType) seçimi buraya eklenecek** (bkz. dikey planı). |
| `PlanFormDialog` | 571 | DEĞİŞİR | 43 özellik anahtarı kategorilenir. |
| `TenantGalleryDialog` | 192 | KALIR | Vitrin görselleri. |
| `TenantFeaturedToggle` | 65 | KALIR | Öne çıkan salon. |
| `PlatformMessagingSettings` | 327 | KALIR | SMTP/SMS/ödeme ayarları. |
| `AdminEditDialog` | 1.081 | KALIR | Genel amaçlı düzenleme diyaloğu (10+ sayfada ortak). |
| `ImportDialog` | 547 | KALIR | Kolon-agnostik Excel aktarımı. |
| `ExcelTransferActions` | 789 | KALIR | Dışa aktarma veri setleri. |

### 4.11 Kabuk · bağlam · altyapı bileşenleri (modal değil, ama plana dahil)

| Bileşen | Satır | Karar | Not |
|---|---|---|---|
| `Sidebar` | 1.079 | **DİKEYE BAĞLANIR** | `verticals?: VerticalType[]` alanı buraya eklenecek (dikey planının 2. adımı). |
| `Topbar` | 786 | KALIR | Arama, şube, bildirim, kılavuz. |
| `PanelKit` | 465 | KALIR | Panelin görsel dili. |
| `QuickMenu` | 492 | KALIR | Hızlı işlem kataloğu. |
| `PageGuide` | 423 | KALIR | Kullanıcı bazlı kılavuz + kurum bazlı sıfırlama. |
| `DashboardHero` | 310 | **BÖLÜNÜR** | Pano bölünmesinin parçası. |
| `SubscriptionCountdown` | 369 | DEĞİŞİR | `/panel/abonelik` yeniden adlandırması. |
| `BranchContext` | 244 | KALIR | Şube kapsamı + scope-epoch. |
| `BranchSwitcher` | 132 | KALIR | — |
| `AuthContext` | 381 | KALIR | Beni hatırla + proaktif/reaktif yenileme. |
| `FeatureContext` | 177 | **DİKEYE BAĞLANIR** | Dikey kapısı bu desenin ikizi olarak kurulur. |
| `FeatureGate` | 97 | KALIR | — |
| `FeatureLockedCard` | 20 | KALIR | Upsell kartı. |
| `UsageBar` | 64 | KALIR | Kota barı. |
| `ModalPortal` | 40 | KALIR | `main z-10` yığınlama tuzağının çözümü — **yeni her modal bunu kullanır**. |
| `AnchoredPopover` | 194 | KALIR | Kart kabuğu kırpmasının çözümü (z-index değil portal). |
| `PanelBackdrop` | 112 | KALIR | — |
| `BulkSelectBar` | 282 | DEĞİŞİR | "Seçilenlere mesaj" eylemi eklenir. |
| `ScopeBadge` | 48 | KALIR | Aktif `?scope=` rozeti. |
| `ApiStateNotice` | 96 | KALIR | Hata/boş durum ayrımı. |
| `StatCard` | 122 | KALIR | — |
| `AnimatedNumber` | 58 | KALIR | — |
| `Sparkline` | 127 | KALIR | — |
| `ReducedMotionProvider` | 21 | KALIR | `prefers-reduced-motion` tüm uygulamada. |
| `CustomerPicker`/`CatalogPicker` | — | KALIR | (§4.2/§4.4'te listelendi) |

### 4.12 Ölü bileşenler — **SİLİNİR**

| Bileşen | Satır | Kanıt |
|---|---|---|
| `ComingSoon` | 41 | Hiçbir dosyadan import edilmiyor. |
| `MissingBackendModule` | 122 | Hiçbir dosyadan import edilmiyor. |
| `RatingQrModal` | 126 | Hiçbir dosyadan import edilmiyor; işlevini **otomatik puanlama işi** devraldı (§8.1). |

> Tarama yöntemi: her bileşen adı `app/` + `components/` altında kendi dosyası hariç arandı; sıfır eşleşen üç dosya yukarıdadır.

---

## 5. Backend bazlı plan

48 endpoint dosyası, ~370 uç. Aşağıda **her dosya** için karar var.

### 5.1 Mevcut uç grupları

| Endpoint dosyası | Uç | Karar | Ne değişir |
|---|---|---|---|
| `AppointmentEndpoints` | 13 | DEĞİŞİR | `POST /series` (seans serisi), kaynak çakışma kontrolü. `/complete` **atomik** kalır; sarf düşümü onun içine girer. |
| `CustomerEndpoints` | 19 | DEĞİŞİR | `POST /{id}/merge`, `GET /duplicates`, `GET /segments`. |
| `CustomerAccountEndpoints` | 14 | KALIR | Cari/taksit/iptal-arşiv semantiği testlerle sabit. |
| `AdisyonEndpoints` | 12 | KALIR | — |
| `ServiceDefinitionEndpoints` | 5 | DEĞİŞİR | `ServiceConsumable` alt kaynağı + `RequiredResourceId`. |
| `ServicePackageEndpoints` | 8 | KALIR | İptal/geri alma ayrı uçlar. |
| `StockEndpoints` | 8 | DEĞİŞİR | Tedarikçi + satın alma; otomatik düşüm hareketi `Consumption` türüyle yazılır. |
| `ExpenseEndpoints` | 9 | DEĞİŞİR | `CashAccountId` alanı. |
| `CashFlowEndpoints` | 3 | DEĞİŞİR | Kasa bazlı kırılım. |
| `CashClosingEndpoints` | 4 | DEĞİŞİR | Kasa başına kapanış. |
| `CommissionEndpoints` | 3 | DEĞİŞİR | Bordro dönemine bağlanır. |
| `StaffEndpoints` | 8 | DEĞİŞİR | `StaffServiceSkill` CRUD; vardiya giriş/çıkış. |
| `ScheduleEndpoints` | 7 | DEĞİŞİR | Kaynak takvimi. |
| `ReportsEndpoints` | 7 | DEĞİŞİR | `GET /tax` (KDV); kart seti tek tanım (`BuildSummaryMetrics`) korunur. |
| `NotificationEndpoints` | 9 | DEĞİŞİR | `POST /templates/{id}/preview` (test gönderimi). |
| `WhatsAppEndpoints` | 12 | **KARAR BEKLİYOR** | Platforma taşıma ertelendi. |
| `ConsentEndpoints` | 16 | KALIR | Onam + tek kullanımlık imza oturumu. |
| `ConsultationEndpoints` | 4 | **DİKEYE BAĞLANIR** | Alan seti dikeyden gelecek. |
| `TreatmentPhotoEndpoints` | 3 | KALIR | — |
| `GiftCardEndpoints` | 9 | KALIR | Defter (`GiftCardLedger`) tek kaynak. |
| `WaitlistEndpoints` | 7 | KALIR | Offer-first otomasyon. |
| `CampaignEndpoints` | 4 | KALIR | Yüzeyi taşınır, ucu değişmez. |
| `LoyaltyEndpoints` | 2 | KALIR | — |
| `RatingEndpoints` | 4 | KALIR | `/issue` hem uçtan hem **kalıcı iş kuyruğundan** (`whatsapp.rating-link`) çağrılıyor; idempotent. |
| `CustomerPortalEndpoints` | 10 | DEĞİŞİR | Kapora/ön ödeme adımı. |
| `PublicSalonEndpoints` | 7 | KALIR | — |
| `AuthEndpoints` | 12 | KALIR | 2FA + OTP çoklu kanal. |
| `SecurityEndpoints` | 5 | KALIR | — |
| `DeviceEndpoints` | 8 | DEĞİŞİR | Personelin **kendi** cihaz listesi için `GET /me` yüzeyi `/ekip/profil`e bağlanır. |
| `TenantEndpoints` | 27 | DEĞİŞİR | `VerticalType` alanı (dikey planı) + marka/tema alanları. |
| `TenantSignupEndpoints` | 5 | KALIR | Çift doğrulamalı self-servis kayıt. |
| `SubscriptionPlanEndpoints` | 11 | KALIR | — |
| `BillingEndpoints` | 8 | KALIR | iyzico + saklı kart. |
| `PlatformOpsEndpoints` | 9 | DEĞİŞİR | Dead-letter filtre/aksiyon. |
| `PlatformWhatsAppEndpoints` | 20 | KALIR | — |
| `PlatformMessagingEndpoints` | 5 | KALIR | — |
| `FeatureEndpoints` | 2 | DEĞİŞİR | Katalog kategorileriyle döner. |
| `ImportEndpoints` | 2 | KALIR | — |
| `AuditLogEndpoints` | 3 | KALIR | — |
| `PendingOperationEndpoints` | 7 | KALIR | Sahiplenme + kalp atışı korunur. |
| `AppNotificationEndpoints` | 5 | KALIR | — |
| `CalendarFeedEndpoints` | 8 | KALIR | — |
| `BranchEndpoints` / `CustomServiceCategoryEndpoints` / `CustomExpenseCategoryEndpoints` | 4/5/4 | KALIR | — |
| `HealthEndpoints` | 3 | KALIR | `/health/ready` şema paritesine bakar — **deploy kapısı budur**. |
| **YENİ — `DashboardEndpoints`** | — | **EKLENİR** | `GET /api/admin/dashboard/today` (beş kuyruk tek yanıt). |
| **YENİ — `ResourceEndpoints`** | — | **EKLENİR** | Oda/cihaz CRUD + müsaitlik. |
| **YENİ — `PayrollEndpoints`** | — | **EKLENİR** | Dönem aç/kapat, hakediş satırı. |
| **YENİ — `SupplierEndpoints`** | — | **EKLENİR** | Tedarikçi + satın alma. |

### 5.2 Yeni entity'ler ve migration sırası

| # | Entity | Amaç | Bağımlılık |
|---|---|---|---|
| 1 | `Resource(Name, Type, BranchId, IsActive)` | Oda/cihaz/ünite planlaması | — |
| 2 | `ServiceDefinition.RequiredResourceId` | Hizmet → kaynak bağı | 1 |
| 3 | `ServiceConsumable(ServiceId, ProductId, Quantity)` | Sarf reçetesi | — |
| 4 | `StaffServiceSkill(StaffId, ServiceId)` | Yetkinlik matrisi | — |
| 5 | `CashAccount(Name, Type, BranchId)` + `Expense.CashAccountId` + `Payment.CashAccountId` | Çoklu kasa | — |
| 6 | `Supplier` + `PurchaseOrder` + `PurchaseOrderLine` | Satın alma | 5 |
| 7 | `PayrollPeriod` + `PayrollLine` | Bordro | — |
| 8 | `Customer.MergedIntoId` | Müşteri birleştirme | — |
| 9 | `Tenant.VerticalType` | Dikey altyapısı | — (dikey planı) |

**Kurallar:** her madde ayrı migration; şifreli alan eklenirse kolon `longtext`/`varchar(512)` (dar VARCHAR canlıda veri kaybı); sentinel varsayılan tarih kolonu eklemek eski kayıtları raporlardan siler — **backfill planı olmadan kolon eklenmez**; snapshot tablosu (`cancelled_sales`, `archived_sale_payments`) etkileniyorsa **üç yer birden** güncellenir.

---

## 6. SİLİNECEKLER — kesin liste

| # | Ne | Neden | Risk |
|---|---|---|---|
| 1 | `components/dashboard/ComingSoon.tsx` | Sıfır import | Yok |
| 2 | `components/dashboard/MissingBackendModule.tsx` | Sıfır import | Yok |
| 3 | `.mcp.json.bak-20260819111448` | Yedek dosyası depoda | Yok |
| 4 | `~9` (0 byte, kök dizin) | Kaza eseri oluşmuş dosya | Yok |
| 5 | `app/panel/paket` rotası | `/panel/abonelik`e taşınır | Kalıcı yönlendirme bırakılır |
| 6 | `Frontend/components/landing/*` eski seti | **Zaten silinmiş** (git status); `landing/apple/*` yerini aldı | Yok — belge kayıt için |

**Silinmeyecek ama silinmiş sanılanlar:** `CampaignPanel` (taşınacak), `PackageReportBreakdown` (taşınacak).

**Hiçbir sayfa silinmiyor.** 67 rotanın tamamının bir işlevi var; sorun silinecek sayfa değil, **bölünecek sayfa** (5 adet) ve **yanlış adlandırılmış sayfa** (1 adet).

---

## 7. EKLENECEKLER — fazlı yol haritası

> Faz 1 (hediye çeki · kasa kapanışı · bekleme listesi · vadesi geçen hatırlatma) ve
> Faz 4.1 (yaşam döngüsü pazarlama) **tamamlandı**; burada tekrar açılmıyor.

### Faz A — Bakım borcu ve keşfedilebilirlik (1 hafta) 🟢

| # | İş | Efor |
|---|---|---|
| A1 | 5 büyük sayfanın bölünmesi (dashboard · randevular · on-muhasebe · login · CustomerDetailModal) | 🟡 |
| A2 | `/panel/paket` → `/panel/abonelik` yeniden adlandırma + 4 referans | 🟢 |
| A3 | Kampanya modülünün menüye çıkarılması | 🟢 |
| A4 | 3 ölü bileşenin silinmesi (`ComingSoon` · `MissingBackendModule` · `RatingQrModal`) | 🟢 |
| A5 | Ayarlar sayfasının sekmelenmesi | 🟢 |

### Faz B — Operasyonel derinlik (2–3 hafta) 🟡🔴

| # | İş | Efor |
|---|---|---|
| B1 | **Kaynak (oda/cihaz) planlaması** — çakışma kontrolü + çizelge sütunu | 🔴 |
| B2 | Sarf reçetesi + otomatik stok düşümü | 🟡 |
| B3 | Personel yetkinlik matrisi | 🟡 |
| B4 | Seans serisi otomatik planlama | 🟡 |
| B5 | Müşteri birleştirme (merge) | 🟡 |

### Faz C — Finans derinliği (2 hafta) 🟡

| # | İş | Efor |
|---|---|---|
| C1 | Çoklu kasa/banka + transfer | 🟡 |
| C2 | KDV özeti + rapor sekmesi | 🟢 |
| C3 | Bordro / hakediş kapanışı | 🟡 |
| C4 | Tedarikçi & satın alma | 🟡 |

### Faz D — Gelir ve pazarlama (2 hafta) 🟡🔌

| # | İş | Efor |
|---|---|---|
| D1 | Online portalda **kapora/ön ödeme** | 🟡🔌 |
| D2 | RFM segmentasyon + toplu mesaj | 🟡 |
| D3 | 5★ → Google/Instagram yönlendirmesi | 🟢 |
| D4 | Üyelik/abonelik modeli (müşteri tarafı) | 🔴 |

### Faz E — Kurumsal / uyum (2–3 hafta) 🔴🔌

| # | İş | Efor |
|---|---|---|
| E1 | e-Fatura / e-Arşiv (entegratör) | 🔴🔌 |
| E2 | KVKK veri ihraç/silme talebi akışı | 🟡 |
| E3 | Marka/tema özelleştirme | 🟡 |
| E4 | Platform: kurum sağlık rozeti + destek impersonation | 🟡 |
| E5 | Public API / webhook | 🟡 |

### Faz F — Dikey genişleme

`Tenant.VerticalType` altyapısı + terminoloji sözlüğü → **DentistAsist** (ayrı belge) ve mevcut **LexAsist/Avukat** planı aynı altyapıyı paylaşır. Bu faz, A–C fazlarının bakım borcunu kapatmadan başlatılmamalıdır; aksi hâlde 5 devasa dosya iki dikeyde birden çatallanır.

---

## 8. Açık bulgular ve teknik borç

### 8.1 Puanlama akışı — ölü kalıntı, **regresyon değil** 🟢

Yüzeysel bakışta web bir yetenek kaybetmiş görünüyor: `lib/apiClient.ts:990`'daki `issueRating` bağını
**hiçbir web yüzeyi çağırmıyor** ve `RatingQrModal.tsx` hiçbir yerden import edilmiyor. Mobil ise elle
link üretiyor (`appointment_detail_sheet.dart:1064`).

**Kod okunduğunda tablo tersine dönüyor.** Randevu tamamlanınca `AppointmentService.cs:1540` — ana
işlemin **içinde**, outbox satırı olarak — `whatsapp.rating-link` işini kuyruğa yazıyor;
`RatingLinkJobHandler` (`DurableJobHandlers.cs:133`) token'ı idempotent üretip müşteriye WhatsApp'tan
gönderiyor. Yani **puanlama linki her istemcide, web dahil, otomatik gidiyor.** `RatingQrModal` eski
**elle** QR akışının kalıntısıdır; otomatik iş onun yerini almıştır.

| | |
|---|---|
| **Sonuç** | Parite regresyonu **yok**. `RatingQrModal` ve `issueRating` bağı ölü kalıntı → **silinir** (§4.12). |
| **Kalan küçük fark** | Mobilde linki ekranda gösteren **elle tetik** var, webde yok. WhatsApp'ı olmayan müşteri için işe yarar; değeri düşük, Faz A'ya alınmadı. |
| **Dikkat** | `issueRating` bağı silinirken **uç silinmez** — `POST /rating/issue` hem elle tetiğin hem kuyruk işinin girişidir. |

### 8.2 Mobil parite açığı — salon vitrini 🟡

`/panel/salon-profili` (475 satır: profil, logo, galeri, KVKK metni, yayın anahtarı) mobilde **yok**.
Parite kuralı gereği ya mobile eklenir ya da belgede bilinçli istisna olarak işaretlenir. Öneri: mobile
sadeleştirilmiş hâli (yayın anahtarı + galeri) eklenir; metin düzenleme webde kalır.

### 8.3 Çift bakım noktaları 🟡

| Nerede | Ne | Çözüm |
|---|---|---|
| Dashboard `PackageReportBreakdown` ↔ Raporlar `CatalogTab` | Aynı kırılım iki yerde | Taşıma (§3.1) |
| Rapor kart seti | Sunucu tanımı · sekme eşlemesi · mobil — **üç yer** | Kural belgelenmiş; ihlal edilmemeli |
| Snapshot tabloları | `cancelled_sales` / `archived_sale_payments` kolon paritesi | Kolon eklerken üç yer birden |

### 8.4 Bilinçli kararlar — **yeniden açılmayacak**

| Konu | Karar | Tarih |
|---|---|---|
| WhatsApp altyapısının platforma taşınması | **Ertelendi** — plan `whatsappsmsmailneolacak.md`'de | 16 Haz 2026 |
| Aylık takvim ızgarasında grace period | **Bilinçli hariç** — rozet ile ızgara farklı soruyu cevaplar; testle sabit | 12 Ağu 2026 |
| Taksit aylık ızgarası | **Kaldırıldı** — tarih listesi + işlem seçici | — |
| Panoda eğri grafik | **Yasak** (raporlarda serbest) | — |
| Peşinat = plan alanı | Muhasebe bütünlüğü kuralı | — |
| Paket PUT 500 hatası | **Çözüldü**, canlı doğrulandı | 15 Ağu 2026 |

### 8.5 Kalan denetim kalemleri (kod dışı)

- **Deploy betiği**: migration hâlâ üretilmiş SQL ile uygulanıyor → `--migrate-only` kapısına geçilmeli. `/health/ready` şema paritesine baktığı için yanlış sıralamada örnek zaten 503 döner, ama betik düzeltilmeden deploy riski sürer.
- **Nginx gerçek istemci IP'si**: rate-limit'ler bugün fiilen site geneline uygulanıyor.
- Bu iki madde `SUNUCU_YAPILACAKLAR.md`'de ayrıntılı; ürün planının kapsamı dışında ama **B fazından önce** kapatılmalı.

---

## 9. İş sırası ve kaba efor

| Faz | İçerik | Süre | Ön koşul |
|---|---|---|---|
| **A** | Bakım borcu + keşfedilebilirlik | ~1 hafta | — |
| **Sunucu** | Deploy betiği + nginx IP | ~0,5 gün | Sunucu erişimi |
| **B** | Kaynak planlama · sarf reçetesi · yetkinlik · seri · merge | 2–3 hafta | A |
| **C** | Finans derinliği | ~2 hafta | B2 (reçete → maliyet) |
| **D** | Gelir/pazarlama | ~2 hafta | iyzico hattı (kurulu) |
| **E** | Kurumsal/uyum | 2–3 hafta | 🔌 entegratör sözleşmesi |
| **F** | Dikey genişleme (DentistAsist) | ayrı belge | **A–C tamamlanmış olmalı** |

**Toplam:** dış entegrasyon beklemeleri hariç ~9–11 hafta tek geliştirici temposuyla.

### Her iş kaleminin bitmiş sayılma şartı

1. Backend `dotnet build` 0 hata + `dotnet test` yeşil (yeni davranış için **yeni test**).
2. Web `tsc` temiz + `vitest` yeşil + `next build` başarılı.
3. **Mobil aynı turda** (`flutter analyze lib` temiz) — parite kuralı.
4. Şema değiştiyse: yeni migration + manifest güncel + canlı uygulama notu `CANLI_DEPLOY_NOTLARI.md`'ye.
5. Yeni modal ise: `ModalPortal` kullanımı, `role="dialog"` + focus trap, footer kırpılma deseni (`flex-col` + `!p-0` + `flex-auto` gövde).
