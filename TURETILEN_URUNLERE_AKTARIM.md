# BeautyAsist → Türetilen Ürünlere Aktarım Rehberi

> **Amaç:** BeautyAsist kaynak üründür. DentistAsist ve ileride türetilecek DoctorAsist gibi ürünler aynı kod
> tabanından üretildi. Bu belge, BeautyAsist'te yapılan işleri türetilen ürünlerde **aynı kurallarla** yeniden
> yapabilmek için tutulur. Yalnız ne değiştiğini değil, **neden** öyle yapıldığını ve hangi tuzaklara düşüldüğünü
> de anlatır.
>
> **Bu sürümün kapsamı:** 12–14 Kasım 2026 işleri (paket 1–6, §4) ve **17–18 Kasım 2026 Maydanoz entegrasyonu**
> (paket 7–17, §12). Yeni bir Asist'i Maydanoz'a bağlamanın üründen bağımsız reçetesi Maydanoz deposunda:
> `C:\Users\KAYA\Desktop\Projelerim\Maydanozasist Web\ASIST_ENTEGRASYONU.md` §0.
>
> **Durum (14 Kas 2026):**
> - BeautyAsist'te kod bitti ve doğrulandı: backend 885/885 test, web `tsc` + vitest 152/152, `flutter analyze` temiz,
>   yerelde uçtan uca denendi.
> - **Commit yapılmadı, canlıya çıkmadı.**
> - Türetilen ürünlerin hiçbirine henüz aktarılmadı (bkz. §10).

## İçindekiler

1. [Karar bekleyen iki konu](#1-karar-bekleyen-iki-konu)
2. [Paketler bir bakışta](#2-paketler-bir-bakışta)
3. [Kullanıcının kararları (iş kuralları)](#3-kullanıcının-kararları-iş-kuralları)
4. [Paket ayrıntıları](#4-paket-ayrıntıları)
5. [Sınırların son hâli](#5-sınırların-son-hâli)
6. [Türetilen ürüne aktarım yöntemi](#6-türetilen-ürüne-aktarım-yöntemi)
7. [DentistAsist'e özel farklar](#7-dentistasiste-özel-farklar)
8. [Canlıya çıkış (her ürün için)](#8-canlıya-çıkış-her-ürün-için)
9. [Dosya envanteri](#9-dosya-envanteri)
10. [Aktarım durumu ve belge günlüğü](#10-aktarım-durumu-ve-belge-günlüğü)
11. [Bu rehberde ayrıntılanmamış önceki işler](#11-bu-rehberde-ayrıntılanmamış-önceki-işler)
12. [Maydanoz entegrasyonu paketleri (17–18 Kas 2026)](#12-maydanoz-entegrasyonu-paketleri-1718-kas-2026)

---

## 1. Karar bekleyen iki konu

Bu iki konuda kullanıcının yanıtı bekleniyor. Türetilen ürüne aktarmadan önce BeautyAsist'teki **son kararı**
kontrol edin; aşağıdaki "şu anki kod" kesinleşmiş değildir.

| Konu | Şu anki kod | Alternatif |
|---|---|---|
| Kartsız kurumda yeni şube | Fatura kesilir, şube **ödenince** açılır | Eski davranış: hemen aç, sonra tahsil et |
| Deneme süresindeki kurum | 10.000 müşteri/onamı geçemez, kademe satın alamaz (12 bin müşterili salonun Excel aktarımı 10.000'de durur) | Denemede sınırı kaldırmak ya da kademe satışını açmak |

---

## 2. Paketler bir bakışta

| # | Paket | Tarih | Migration | Ne değişti |
|---|---|---|---|---|
| 1 | Mesaj kredisi + SMS faturalama | 12 Kas | `20261112142931_MessagingCreditsAndSms` | ₺ kontör yerine mesaj kredisi; SMS ücretlendirme; Bildirimler sayfası yeniden |
| 2 | Kurumun kendi SMS hesabı | 13 Kas | `20261112223305_TenantSmsConnections` | Verimor/Netgsm bağlantısını platform kurar, kurum yalnız görür |
| 3 | Şube başı fiyatlama | 13 Kas | `20261113130700_PerBranchPricing` | Fiyatlar KDV hariç, şube × fiyat, kademeler, orantılı şube ücreti, tek fiyat motoru |
| 4 | Tek paket | 13 Kas | `20261113171114_SingleSubscriptionPlan` | Eski beş paket silindi, tüm kurumlar tek pakete taşındı |
| 5 | Onam kademe hakkı | 13–14 Kas | `20261113211308_ConsentTierEntitlement` | 10.000 imzalı onamdan sonra ödemeden imza yok |
| 6 | Müşteri kademesi + ödenince şube | 14 Kas | `20261113224133_CustomerTierAndBranchOnPayment` | 10.000 müşteriden sonra ödemeden ekleme yok; kartsız şube ödenince açılır |

**Bağımlılık:**
- **3 → 4 → 5 → 6 zincirdir.** 5 ve 6, 3'ün fiyat motorunu (`SubscriptionPricing`) kullanır; 6, 5'in kademe hakkı
  altyapısını (`TierEntitlementQuery`) müşteri boyutuna genişletir.
- **1 ve 2 fiyatlamadan bağımsızdır.** 2, 1'in SMS ücretlendirmesine "kurumun kendi hesabı" (`OwnAccount`) kaynağını ekler.
- Migration sırası, zaman damgası sırasıdır.

---

## 3. Kullanıcının kararları (iş kuralları)

Tırnak içindekiler kullanıcının kendi sözleri.

> **Rakamlar ürün kararıdır.** Türetilen üründe fiyatı, kademeleri ve kredi maliyetlerini kopyalamadan önce ürün
> sahibine teyit ettirin.

**Abonelik**
- **Tek paket:** aylık 1.000 ₺ + KDV, yıllık 10.000 ₺ + KDV, **şube başına**. Tüm özellikler dahil, limitler sınırsız.
  Kullanıcı: "diğer paketleri kaldır tek paket olacak dedim ya".
- **Müşteri kademesi** (aylık, + KDV, eşiğin üzeri): >10.000 kayıtta +250 ₺, >15.000'de +500 ₺, >20.000'de +1.000 ₺.
  Kademeler birikmez: aşılan en yüksek kademe uygulanır.
- **İmzalı dijital onam:** müşteriyle aynı kademeler, 10.000'e kadar ücretsiz.
- **Yıllık ödemede** kademe ücreti = aylık kademe × 10.
- **Dönem ortasında açılan şube:** kalan gün kadar orantılı ücretlenir.

**Sınırlar** (en önemli kural)
- "Onam kısmında eminsin demi sınırları geçtikten sonra ödeme yapmadan kullanamasın bu çok önemli"
- "Bu müşteri sayısında da geçerli değil mi tüm limitlerde böyle olmalı"
- **Sonuç:** sınırı geçen kurum, ödeme yapmadan sınır üstü kullanım yapamaz.

**Mesajlaşma**
- 1 kredi = 1 WhatsApp hatırlatma.
- Kredi maliyeti: Utility 1, Authentication 1, Marketing 6, Service 0, SMS parça başına 2 kredi. Değerler platform
  panelinden değiştirilebilir.
- Bağlantı kurulumu: "WhatsApp ve SMS bağlama kısımları platform kullanıcısında olsun, güzellik merkezlerine bu
  şekilde olmaz"

**Salon vitrini:** toplam 15 görsel (vitrin ve hizmet galerisi birlikte).

---

## 4. Paket ayrıntıları

Her paket aynı sırayla anlatılır: Kural · Şema · Backend · Web · Mobil · Testler · Tuzaklar · Canlı.

### Paket 1 — Mesaj kredisi + SMS faturalama (12 Kas 2026)

**Kural**
- ₺ kontör cüzdanı **mesaj kredisine** dönüştü; WhatsApp ve SMS aynı cüzdandan harcar.
- Paket kotaları aynen kalır. Kota bitince ve `AllowWalletOverage` açıksa krediden harcanır.
- **SMS kapsamı:**
  - otomatik bildirim şablonları;
  - linkli tek yönlü mesajlar: puanlama linki, bekleme listesi "randevu oluştu", KVKK linki, hediye çeki kodu.
- **Kapsam dışı:** yanıt bekleyen akışlar ve WhatsApp'tan SMS'e yedekleme.
- OTP/kayıt SMS'leri platform maliyetidir; kurumdan kredi düşmez.

**Şema**
- `wallet_transactions`:
  - `AmountTry→Amount`, `BalanceAfterTry→BalanceAfter`, `ReservedAfterTry→ReservedAfter` — **RENAME**, veri korunur;
  - yeni kolonlar `Unit`, `Channel`, `NotificationLogId`.
- `tenant_messaging_wallets`: `BalanceCredits`, `ReservedCredits`, `LifetimeTopUpCredits`, `LifetimeSpentCredits`.
- `whatsapp_settings`: `MonthlySpendCapCredits`, `RatingLinkChannel`, `WaitlistActivatedChannel`, `KvkkChannel`.
- `whatsapp_billing_settings`: `CreditUnitPriceTry`, `DefaultMonthlySpendCapCredits`, `LowBalanceThresholdCredits`,
  `SmsCreditsPerPart`.
- Diğer tablolar:
  - `whatsapp_pricing_rules.CreditCost`
  - `whatsapp_messages.ChargedCredits`
  - `whatsapp_credit_purchases.GrantsCredits`
  - `whatsapp_credit_packages.GrantsCredits`
  - `subscription_plans.DefaultSpendCapCredits`
- `notification_logs`: `BillingSource`, `ChargedCredits`, `SmsParts`, `ChargeCapturedAtUtc`, `Purpose`, ayrıca
  `(BillingSource, ChargeCapturedAtUtc)` indeksi.
- **Veri dönüşümü** (migration içinde SQL):
  - Kur = canlıdaki aktif Utility kuralının `SellPriceTry` değeri.
  - Mesaj ücretleri `ROUND(₺/kur, 4)` ile, paket ve satın alma hakları `CEIL(₺/kur)` ile krediye çevrilir.
  - Paket adlarında "Kontör" → "Kredi"; cüzdan bakiye ve rezervleri krediye çevrilir.
  - Eski `*Try` kolonları **donmuş geçmiş** olarak kalır; yeni para kaydı `*Credits` kolonlarındadır.

**Backend**
- `NotificationService`:
  - SMS ücreti burada hesaplanır, `PlatformMessagingService`'te değil.
  - Rezervasyon `NotificationLog` üzerindedir (`AttachCharge`, `MarkChargeCaptured`, `ClearCharge`).
  - Yakalanmamış rezervasyonu `WhatsAppReservationSweepBackgroundService` 2 saat sonra süpürür.
- Yeni dosyalar:
  - `ICustomerSmsService` / `CustomerSmsService`: linkli tek yönlü SMS'ler, `NotificationService.SendSystemSmsAsync`
    üzerinden.
  - `PlatformMessaging/SmsSegments.cs`: parça sayımı.
  - `Api/Endpoints/SmsEndpoints.cs`.
- Uçlar:
  - `POST /api/admin/sms/gift-card`.
  - `POST /api/admin/notification-templates/estimate`: gönderim tahmini. `StaffApprovalGateMiddleware` bu ucu
    **tam yol** eşleşmesiyle salt-okunur sayar; önek eşleşmesi değil, yani `/send` kapıda kalır.
  - `/api/admin/sms` uçları `Notifications.Send` işlem iznine tabidir.
- **Paket kapıları sunucuda:** SMS `notifications.sms` özelliğini, kitle gönderimi (CustomerIds yoksa)
  `notifications.bulk` özelliğini ister. Önceden bu kapı yalnız web arayüzündeydi.
- Kanal tercihleri: `WhatsAppSettings.{RatingLink,WaitlistActivated,Kvkk}Channel`.
- Düzeltilen eski hatalar:
  - SMS/e-posta hatırlatmada `{{tarih}}`/`{{saat}}` "şimdi"yi basıyordu; artık randevu saatini (UTC+3) basıyor.
  - `{{hizmet}}` ve `{{salon}}` değişkenleri eklendi.
  - "Tüm müşteriler" gönderimi kara listedekileri atlıyor.
  - Web eşleyicisinde `SessionRenewal` tetikleyicisi `Manual`'a düşüyordu.

**Web**
- `app/panel/bildirimler/page.tsx` yeniden yazıldı:
  - **Mesaj gönder:** tümü / müşteri seç / doğum günü; sunucu tahmini; iki adımlı onay.
  - **Şablon oluşturucu:** hazır metin, imlece değişken ekleme, canlı önizleme, SMS parça/kredi sayacı.
  - **Hazır otomasyonlar:** kanal seçimli, SMS öncelikli, emojisiz.
- Yeni: `components/dashboard/notifications/{messageKit.ts, TemplateComposerDialog.tsx, SendMessageDialog.tsx}`.
- Güncellenenler:
  - `WhatsAppWalletCard.tsx` ("Mesaj Kredisi");
  - `WhatsAppSettingsCard.tsx` (kanal seçimi, kredi tavanı);
  - `GiftCardShareModal.tsx` + `app/panel/hediye-cek/page.tsx` (hediye çeki SMS'i);
  - `app/platform/whatsapp/page.tsx` (kredi ayarları);
  - `PlanFormDialog.tsx` (kredi tavanı);
  - "kontör" → "kredi" metinleri: `AppointmentReminderControl.tsx`, `app/kayit`, `app/destek`.

**Mobil**
- Yeni: `features/notifications/{message_kit, template_composer_sheet, send_message_sheet}.dart`.
- `notifications_screen.dart` yeniden yazıldı.
- `whatsapp/whatsapp_screen.dart`: kredi ve kanal tercihleri.
- `gift_cards/gift_card_share_sheet.dart`: SMS ile gönderim.

**Testler**
- Yeni: `MessagingCreditSmsTests` (10), `NotificationEstimateTests` (6), `WhatsAppSettingsSpendCapTests` (3),
  yardımcı sınıf `NotificationTestServices`.
- Güncellenen: `BalanceRaceMySqlTests`, `NotificationUnknownOutcomeMySqlTests`, `WhatsAppCreditCheckoutTests`,
  `AuditRoundNineTests`, `AuditRoundSevenPhase4Tests`.

**Tuzaklar**
1. **Toplu SMS kota sayımı.** Anahtarsız elle toplu SMS'te kota sayımı yalnız veritabanındaki satırları sayarsa,
   aynı istekteki mesajlar kotayı aşar ve hiç kredi düşmez. Çözüm: ChangeTracker'daki bekleyen Quota satırları da
   sayılır (`PendingQuotaSmsInTracker`; test `ManualBulkSms_PastQuota_ChargesCreditsPerMessage`).
2. **Eski mobil sürümün null değeri.** Mağazadaki eski sürüm harcama tavanını `monthlySpendCapTry` adıyla gönderir;
   yeni alan null gelir ve tavan **silinirdi**. Çözüm: boş tavan yalnız `SpendCapUnit: "Credits"` gönderen istemciden
   gelirse "kaldır" sayılır. Genel kural: yeni bir DTO alanında eski istemcinin null'unu "sil" diye okuma.
3. **Kanal varsayılanı.** Kanal tercih kolonlarında `HasDefaultValue` yok; CLR varsayılanı `Sms` tuzağı.
4. **Zaman damgası.** Ücret metotları `Touch()` çağırmaz; `UpdatedAtUtc` "sağlayıcıya gidildi" damgasıdır.
5. **Eski paket varsayılanları.** Eski notlardaki "SMS Profesyonel ve üstünde, toplu gönderim Premium ve üstünde"
   varsayılanı paket 4 ile geçersiz kaldı: tek pakette ikisi de var.

**Canlı:** migration MariaDB'ye elle uygulanır. Hedef tabloya takma adlı `UPDATE` yazılmadı, çünkü canlı MariaDB
`UPDATE t AS x` biçimini reddediyor.

### Paket 2 — Kurumun kendi SMS hesabı (13 Kas 2026)

**Kural:** bağlantıyı platform (BeautyAsist ekibi) kurar; kurum yalnız durumu görür.
- **Etkin bağlantı** = açık + test SMS'iyle doğrulanmış.
- Kimlik bilgisi değişince doğrulama sıfırlanır. Doğrulanmış bir bağlantının başarısız yeniden testi doğrulamayı silmez.
- Kurumun kendi hesabından (`OwnAccount`) giden SMS'te kota ve kredi düşmez. Hangi yoldan gidileceği satırdaki karardan
  okunur; bağlantı kalkarsa platform hesabına **düşülmez**.
- OTP ve kayıt SMS'leri her zaman platform hesabından gider.
- Paketinde SMS olmayan kurum için bağlama ve test 409 döner; platform listesinde "pakette SMS yok" rozeti görünür.
- Bağlantıyı kaldırmak gerçek silmedir.
- Kullanıcı adı ve parola şifreli saklanır; parola yanıtta hiç dönmez.

**Şema:** yeni `tenant_sms_connections` tablosu ve `IX_tenant_sms_connections_TenantId` indeksi. Kolonlar:
- `TenantId`, `Provider` (`Verimor` | `Netgsm`)
- `Username`, `Password` (şifreli), `UsernameHint`, `Sender`
- `Enabled`, `VerifiedAtUtc`, `LastTestAtUtc`, `LastError`

**Backend**
- `Domain/Entities/TenantSmsConnection.cs`, `ITenantSmsConnectionService` / `TenantSmsConnectionService`.
- Platform uçları:
  - `GET /api/platform/whatsapp/sms-connections`
  - `PUT /…/{tenantId}`
  - `POST /…/{tenantId}/test`
  - `DELETE /…/{tenantId}`
- Kurum ucu: yalnız `GET /api/admin/sms/connection` (`canManage=false`); yazma ucu yok.
- Meta onaylı WhatsApp şablon adları da platforma taşındı:
  - `BindWhatsAppConnectionRequest` 6 alan taşır (null = koru, "" = temizle); `UpdateTemplateBindings` altısını
    birden yazar.
  - Tek eşleyici `ToConnectionDto` kullanılır.
  - Kurumun `SaveWhatsAppSettingsRequest`'inden şablon alanları çıkarıldı; eski mobil gönderse de yok sayılır.

**Web**
- Yeni `SmsConnectionCard.tsx`: kurum ekranı, salt-okunur. Teknik ara durumlar yerine "kurulum sürüyor" yazar.
  Ayarlar sayfasında durur.
- Yeni `SmsConnectionForm.tsx`: platform penceresi.
- `app/platform/whatsapp/page.tsx?tab=sms`: "SMS Bağlantıları" sekmesi.
- `app/platform/layout.tsx`: menü linki.

**Mobil:** kurum kartı `whatsapp_screen.dart` içinde ve salt-okunur. Platform tarafındaki bağlama mobilde yok; bu
bilinçli bir parite kararı.

**Testler:** `TenantSmsConnectionTests` (20), `WhatsAppTemplateOwnershipTests` (3).

**Canlı**
- `Messaging:ServerOutboundIp` ayarlanmalı; bağlama penceresi bu IP'yi gösterir. Verimor OİM'de izinli IP yoksa 401 döner.
- Netgsm'in Türkçe karakter parametresi doğrulanmadı.
- Gerçek sağlayıcıyla başarılı gönderim henüz denenmedi.

### Paket 3 — Şube başı fiyatlama (13 Kas 2026)

**Kural**
- Fiyatlar **KDV HARİÇ**; tahsilat = net + %20 KDV.
- **Tutar** = şube sayısı × birim fiyat + aşılan en yüksek müşteri kademesi + aşılan en yüksek onam kademesi.
  Kademeler birikmez. Yıllıkta kademe ücreti = aylık × `YearlyTierMultiplier` (10).
- Dönem ortası yeni şube **orantılı** ücretlenir. İki yol vardır (`BranchChargeQuoteDto.ChargeMethod`):
  - **Card:** ödeme açık ve kayıtlı kart var → karttan çekilir, şube hemen açılır.
  - **Invoice:** kart yok ya da ödeme altyapısı kapalı → açık fatura kesilir. Paket 6'dan beri şube ödenince açılır.
- İstek `confirmedChargeTRY` taşımazsa ya da tutar değiştiyse 409 `BranchChargeRequired` döner; ücret asla sessiz
  çekilmez.
- Sonucu belirsiz bir kart ödemesi varsa 409 `BranchChargePending` döner ve ikinci çekim yapılmaz.
- Platform yöneticisinin açtığı şube ücretsizdir.
- Kart reddi ya da belirsizliği fatura yoluna **düşmez**.
- Salon vitrini toplam **15 görsel** gösterir (vitrin ve hizmet galerisi birlikte).
- **Invoice yolunun nedeni:** canlıda `PaymentsEnabled=0` ve platform ücretli dönemi elle açıyor. Yalnız kart yolu
  olsaydı tek pakete geçen her kurumun "Şube ekle" düğmesi 409'la kilitlenirdi.

**Şema**
- `subscription_plans`: `ChargePerBranch`, `CustomerTiersJson`, `ConsentTiersJson`, `YearlyTierMultiplier`.
- `subscription_payments`:
  - `Kind`: `Subscription` / `BranchAddon` / `ConsentUpgrade` / `CustomerUpgrade`;
  - `BreakdownJson`, `PayloadJson`;
  - `(TenantId, Kind, Status)` indeksi.
- `tenant_invoices`: `QuotedNetTRY`, `QuotedVatTRY`, `LinesJson`.
- **Veri:** plan fiyatları `ROUND(fiyat / 1.2, 2)` ile KDV dahilden hariçe çevrilir. Brüt tahsilat aynı kalır (sapma
  en çok 1 kuruş). Geçmiş ödeme ve fatura satırları değişmez.

**Backend**
- Yeni `Domain/Billing/SubscriptionPricing.cs` — **tek fiyat motoru.** Checkout, yenileme, şube ücreti, platform özeti
  ve faturalar aynı teklifi kullanır. İçerdikleri:
  - `PricingTier` (Normalize / Parse / Serialize / Applicable), `QuoteLine`;
  - `SubscriptionQuote`: JSON anlık görüntü; geçmiş fatura sonradan yeniden hesaplanmaz;
  - `BillingCounts`, `TierDimension`, `TierAllowance`;
  - `SubscriptionPricing.{Quote, ProrateBranch, TierUpgrade, ManualBillingPeriodEnd, MonthlyEquivalentNet}`;
  - `DefaultVatRate = 0.20`.
- Diğer yeni dosyalar:
  - `BillingCountsQuery.cs`: sayaçlar.
  - `BillingService.Branches.cs`: `GetBranchChargeQuoteAsync`, `PurchaseBranchAsync`, `ResolvePendingBranchChargesAsync`
    ve `ChargeAddonWithStoredCardAsync`. Bu sonuncusu tüm ek ücretlerin tek kart yoludur; yeni bir ücret türü
    eklenecekse buraya tür eklenir, yol çatallanmaz.
  - `PlatformBillingOverview.cs`.
- Uçlar:
  - `GET /api/admin/billing/quote`, `GET /api/admin/billing/branch-quote`.
  - Şube oluşturma (`POST /api/admin/branches/`) ücret yolundan geçer.
  - Platform: `GET /api/platform/invoices/overview`, `POST /api/platform/invoices/resolve-pending`.
- `SubscriptionRenewalBackgroundService` en az 2 dakikadır bekleyen şube ödemelerini sağlayıcıya sorup sonuçlandırır.
  Yenileme denemeleri yalnız `Kind == Subscription` olan ödemelere bakar.
- Vitrin: `TenantProfileService.MaxPhotosPerSalon = 15`. `PublicSalonService` vitrinde ilk 15 görseli gösterir, önce
  slider görsellerini.

**Web**
- `lib/plans.ts`: `PublicPricingTier`, `chargePerBranch`, kademeler, `vatRate`, `tierLabels`, `vatRateOf`,
  `DEFAULT_VAT_RATE`. Ayrıca `lib/landingPlans.ts`.
- `app/page.tsx` (vitrin fiyat kartı): "+ KDV" ve "Şube başına" etiketleri, kademe satırları; tek paket varsa ızgara
  ortalanır.
- `components/checkout/CheckoutClient.tsx`: sunucu teklifi ve KDV dökümü.
- `PlanFormDialog.tsx`: şube başı anahtarı ve kademe editörü. Ayrıca `app/platform/planlar/page.tsx`.
- `app/platform/fatura/page.tsx`: genel bakış (MRR, bu ayın tahsilatı, açık alacak, 30 günlük yenilemeler) ve kalem
  dökümü.
- `app/panel/ayarlar/page.tsx`: şube ekle → teklif → onay.
- `app/panel/salon-profili/page.tsx`: 15 görsel sınırı.
- `lib/apiMappers.ts`, `lib/guideContent.ts`.
- `lib/apiClient.ts`: `billingQuote`, `branchChargeQuote`, `createBranch(body, tenantId, key)`, `billingOverview`,
  `resolvePendingCharges`.
- `lib/moneyWriteIdempotency.test.ts`: kapıya `adminApi.createBranch(` eklendi.

**Mobil**
- `branches/branches_screen.dart`: ortak `createBranchWithCharge`. Şubeler ve Ayarlar ekranı aynı yoldan geçer:
  teklif onayı + idempotency. iOS'ta `StorePolicy.hidesPurchaseFlows` açıksa ücretli şube engellenir.
- `settings/settings_screen.dart`.
- `plans/plans_screen.dart`: "KDV hariç" etiketleri. Mobil plan kaydı, göndermediği şube/kademe alanlarını sunucuda korur.
- `paket/paket_screen.dart`.

**Testler**
- Yeni: `Domain/SubscriptionPricingTests` (12), `PerBranchBillingTests` (16), `PerBranchBillingMySqlTests` (4).
- Güncellenen: `SubscriptionBillingTests`, `PaymentSafetyRoundThreeTests`, `PaymentTestDoubles`, `TenantSignupTests`.

**Tuzaklar**
1. **Şube açmak para yazar; idempotency zorunlu.**
   - İstemci tuzu kesin yanıtta (2xx/4xx) yeniler, ağ hatası ya da 5xx'te korur.
   - Middleware 4xx'i de saklar; aksi hâlde "ödeme doğrulanıyor" 409'u sonsuza dek oynatılırdı.
2. **Bekleyen kart ödemesi** kart ve fatura yolunu birlikte durdurur.
3. **Kuruşlu tutar.** Tutarlar kuruşlu gösterilir (₺580,64). `formatTL` yuvarlar; fatura ve tahsilat tutarında kullanmayın.
4. **Yerelde ücretli akış.** Denemek için iki satır gerekir: `platform_integration_settings` (PaymentProvider=Simulation,
   PaymentsEnabled=1) ve `tenant_payment_methods` içinde bir Simulation satırı. Yerel DB'de normalde ikisi de yoktur;
   denemeden sonra silin.

**Canlı:** fiyatlar KDV hariçe döndüğü için **backend ve web birlikte** çıkmalı. Aksi hâlde eski arayüz net fiyatı brüt sanır.

### Paket 4 — Tek paket (13 Kas 2026)

**Kural:** satışta yalnız tek paket var (fiyatlar §3'te). Eski paketleri "pasife al" diye rapora bırakmak yanlıştı;
açık talimat eksiksiz uygulandı.

**Migration** (yalnız veri):
1. Tek paket yoksa eklenir; silinmiş ya da pasifse canlandırılır.
2. Kurumların eski paket bağı ve kaldırılacak paketlerin durumu `plan_consolidation_backup_20261113` yedek tablosuna
   yazılır.
3. **Tüm** kurumlar (paketsizler dahil) tek pakete taşınır.
4. Diğer paketler yumuşak silinir; geçmiş ödeme/fatura bağları ve `PlanKey` benzersizliği korunur.

- **Geri alma:** Down yedekten geri yükler (yerelde Up → Down → Up doğrulandı). Yedek tablo karşılaştırmaları açık
  `COLLATE utf8mb4_unicode_ci` taşır.
- **Fiyat etkisi:** taşınan kurumun yürüyen dönemi değişmez; **bir sonraki yenilemede** tek paketin fiyatıyla öder.

**Backend**
- `DatabaseBootstrap.SinglePlanKey = "BeautyAsist"`. Seed yalnız tek paketi ekler; eskileri geri getirmemek için
  varlığı `IgnoreQueryFilters` ile kontrol eder.
- Tek paketi varsayılan yapan yerler:
  - `TenantSignupService`: deneme paketi varsayılanı (`TrialPlanKey` yoksa tek paket).
  - `AppReviewAccountSeeder.PreferredPlanKey`.
  - `Tenant.Plan` varsayılanı ve `DevelopmentDataSeeder`.
- `SubscriptionPlanService` / `SubscriptionPlanEndpoints` / `SubscriptionPlanDtos`:
  - pasif ya da silinmiş pakete checkout 409 döner ("Pasif pakete geçilemez");
  - bağlı kurumu olan paket silinemez (409);
  - kartla yenileme planı `IsActive` süzgeci olmadan yükler.
- `FeatureCatalog` yorumu: yeni bir özellik, mevcut kurulumda pakete panelden ya da bir veri migration'ıyla eklenir;
  seed var olan paketi değiştirmez.
- Platform panelden yine ek paket eklenebilir. Migration tek seferliktir; açılışta zorlama yoktur.

**Web:** katalog yüklenemezse yedek liste `['BeautyAsist']` olur: `CreateTenantDialog.tsx`, `app/platform/kurumlar/page.tsx`,
`app/platform/sistem/page.tsx`. `lib/apiMappers.ts` son çare liste fiyatlarını tutar.

**Mobil:** `paket_screen.dart` "Üst paketler" listesini özellik kümesi ve limit kapsamasıyla seçer, vitrin sırasıyla
değil. Web karşılığı `isUpgradeOf`, mobilde `_isUpgradeOf`.

### Paket 5 — Onam kademe hakkı (13–14 Kas 2026)

**Kural:** 10.000 imzalı onama kadar ücretsiz. Sonrasında, sıradaki kademenin bedeli **ödenmeden** yeni imza alınamaz.
- **Sayaç akış sayacıdır:** imzalanan her evrak sayılır, silinmiş olsa da.
- **Tek doğruluk kaynağı:** bugünü kapsayan `Paid` faturalardaki en yüksek `TenantInvoice.ConsentTierAbove`.
  - Açık (Sent) fatura kilidi açmaz.
  - Fatura iptal edilirse hak geri alınır.
- Kartlı checkout, yenileme ve platform dönem taslakları, ödeme anındaki sayının kademesini faturaya yazar. Yenileme
  faturası **yeni dönemi** kapsar, bugünü değil.
- **Mesaj nötrdür;** satın alma çağrısı içermez (iOS App Store 3.1.1). İstemci makine kodunu görür ve yükseltme yolunu
  yalnız satın almaya izin verilen yüzeyde gösterir.
- Randevu tamamlamadaki onam kontrolü **yumuşak** kalır, engellemez.

**Şema:** `tenant_invoices.ConsentTierAbove` (int, null olabilir).

**Backend**
- Yeni `ConsentEntitlementQuery.cs`: `TierEntitlementQuery.EvaluateAsync(db, tenantId, TierDimension, nowUtc)`,
  `PaidTierAboveAsync`, `LimitMessage`. Eski ad `ConsentEntitlementQuery` bir sarmalayıcı olarak duruyor.
- Kapılar:
  - `ConsentService.StartSessionAsync`: ön kontrol.
  - `ConsentService.SignAsync`: önce `tenants`, sonra form satır kilidi.
- Yeni `BillingService.Consent.cs`: `GetTierAllowanceAsync`, `PurchaseTierUpgradeAsync` (müşteri ve onam ortak),
  `UpgradeRequired`.
  - Kart varsa `ChargeAddonWithStoredCardAsync` (Kind `ConsentUpgrade`) çekim yapar ve Paid fatura yazar.
  - Kart yoksa açık fatura kesilir; platform "Ödendi" yapınca kademe açılır.
  - Aynı kademe için ikinci istek yeni fatura kesmez ("fatura kesildi" yanıtı).
- Uçlar: `GET /api/admin/billing/consent-allowance` ve `POST /api/admin/billing/consent-upgrade` (gövde
  `{ confirmedChargeTRY }`, `Idempotency-Key` zorunlu).
- Hata kodları (409): `ConsentLimitReached`, `ConsentUpgradeRequired` (tutar onaylanmadı ya da değişti).
- Kademeyi faturaya yazan yerler:
  - `BillingService.cs`: kartlı checkout ve yenileme;
  - `PlatformOpsService.cs`: dönem taslakları;
  - `BillingService.Branches.cs`.

**Web**
- `app/panel/paket/page.tsx`: `TierAllowanceCard`.
- `ConsentCenterModal.tsx`: sınır dolunca Paketim ipucu.
- `lib/apiClient.ts`: `consentAllowance`, `purchaseConsentUpgrade(confirmedChargeTRY, tenantId, idempotencyKey)`.
  Kapıya `adminApi.purchaseConsentUpgrade(` eklendi.
- `lib/types.ts`.

**Mobil**
- `consent/consent_center_sheet.dart`: ipucu yalnız `!StorePolicy.hidesPurchaseFlows` iken gösterilir.
- `paket/paket_screen.dart`: `_tierCard`, `_upgradeTier`.

**Testler:** `ConsentQuotaTests` (12), `ConsentQuotaMySqlTests` (1 — sınırda eşzamanlı imza).

### Paket 6 — Müşteri kademesi + ödenince açılan şube (14 Kas 2026)

**Kural:** "tüm limitlerde böyle olmalı" sözü gereği müşteri sayısı ve şube de "ödemeden kullanılamaz" kapsamına alındı.

**Müşteri sayısı**
- 10.000'e kadar ücretsiz. Sonrasında ödenmiş kademe olmadan yeni müşteri eklenemez: 409 `CustomerLimitReached`,
  nötr mesaj.
- **Sayaç stok sayacıdır:** silinen müşteri sayaçtan düşer. Onam sayacı ise akış sayacıdır (paket 5).
- Tek doğruluk kaynağı: Paid faturalardaki en yüksek `CustomerTierAbove`. Paket 5 ile aynı kod kullanılır.
- **Sistem kurumu** (`bireysel-musteriler`) muaftır. Muaf olmasaydı platform genelinde online kayıt kilitlenirdi.
- **Kapı** `UsageService.CheckLimitAsync(Customers)` içindedir ve `TierEntitlementQuery`'ye sorar. Çağıranlar:
  - `CustomerService.CreateAsync`: `tenants` satır kilidiyle. Personelin onaya gönderdiği kayıt, onaydaki
    `ApprovalDispatcher` replay'inde de denetlenir.
  - `DataImportService`: sığan satırlar alınır, kalanı raporlanır. Kota tamamen doluysa yalnız müşteri satırları
    atlanır; aynı dosyadaki hizmet/ürün/personel yine aktarılır.
  - `CustomerPortalService.ResolveTenantCustomerAsync`: online randevu yolu. Salonda gölge müşteri açılmaz; salon
    müşterisine nötr mesaj gösterilir: "Bu salon şu an yeni online kayıt alamıyor. Lütfen randevu için salonu arayın."
- `AuthService.CustomerRegisterAsync` içinde de bir **savunma kapısı** var. Kayıt bugün yalnız muaf sistem kurumuna
  yazıldığı için bu kapı hep geçer; asıl salon kapısı portal servisindedir. Kayıt bir gün doğrudan salona yazılırsa
  kapı hazır durur (mesaj `TierEntitlementQuery.PublicCustomerLimitMessage`).
- Yükseltme uçları:
  - `GET /api/admin/billing/customer-allowance`, `POST /api/admin/billing/customer-upgrade`;
  - kartla ödemede Kind `CustomerUpgrade`;
  - hata kodu `CustomerUpgradeRequired`.
- Deneme süresindeki kurum sınırı geçemez ve kademe satın alamaz. Bu konu **karar bekliyor** (§1).

**Şube**
- **Kartsız ya da ödeme kapalıyken** şube artık hemen açılmaz:
  - açılacak şubenin bilgisi `TenantInvoice.PendingBranchJson` alanına yazılır (`AwaitBranch`) ve açık fatura kesilir;
  - istek 409 `BranchAwaitingPayment` döner. Bu bir hata değildir; istemci **bilgi** olarak gösterir.
- **Platform faturayı "Ödendi" yapınca** (`PlatformOpsService.UpdateInvoiceStatusAsync`):
  - `tenant_invoices` satır kilidi altında `TakePendingBranch()` şubeyi açar ve alanı tüketir;
  - iki kez "Ödendi" yapmak ya da Ödendi → Gönderildi → Ödendi gidip gelmek ikinci şube açmaz;
  - `RowLock` kilit sırasına `tenant_invoices` en sona eklendi.
- Aynı adla bekleyen talep ikinci fatura kesmez; mesaj bekleyen talebin adını kullanır.
- **Elle faturalanan kurum** (Aktif ama abonelik dönemi tanımsız):
  - Eskiden şube ücretsiz açılıyordu.
  - Artık şube ve kademe yükseltmesi `SubscriptionPricing.ManualBillingPeriodEnd` tarihine (sonraki takvim ayının 1'i,
    UTC) kadar orantılı açık faturayla açılır.
  - Platformun `GenerateCurrentPeriodInvoicesAsync` taslakları takvim ayı keser ve o ayın faturası olan kurumu atlar;
    böylece aynı günler iki kez faturalanmaz.
  - Bu kurumda kart yolu yok.
- Deneme kurumu şubede ücretsiz kalır.

**Şema:** `tenant_invoices.CustomerTierAbove` (int, null olabilir) ve `tenant_invoices.PendingBranchJson` (metin,
null olabilir).

**Backend**
- Müşteri kapısı: `UsageService.cs`, `CustomerService.cs`, `DataImportService.cs`, `CustomerPortalService.cs`,
  `AuthService.cs` (savunma kapısı).
- Şube ve fatura:
  - `BranchService.cs`;
  - `BillingService.Branches.cs`: `EvaluateBranchChargeAsync`, `RequestBranchWithInvoiceAsync`, `ReadBranchPayload`;
  - `BillingService.Consent.cs`, `PlatformOpsService.cs`, `RowLock.cs`.
- Model ve hata: `TenantInvoice.cs` (`CoverCustomerTier`, `AwaitBranch`, `TakePendingBranch`), `Error.cs`,
  `ResultExtensions.cs` (409 eşlemesi), `BranchDtos.cs`.

**Web**
- `app/panel/paket/page.tsx`:
  - `TIER_TEXT` ve müşteri + onam için ortak `TierAllowanceCard`;
  - `handleTierUpgrade(kind)`, tür başına ayrı idempotency tuzu;
  - `withTierCapacity`: kullanım ödenmiş kapasiteye göre gösterilir ("3 / 3 · %100");
  - fatura satırında `notes` açıklaması.
- `CustomerFormDialog.tsx`: sınır dolunca Paketim ipucu.
- `app/panel/ayarlar/page.tsx`: "Şube, ödeme alındığında açılır" metni, "X faturayı onayla" düğmesi, `branchNotice`
  bilgi bandı.
- `app/platform/fatura/page.tsx`:
  - "Şube ödeme bekliyor" çipi;
  - bekleyen şube ve kademe kutuları;
  - "Ödendi" mesajında açılan şubenin adı;
  - "Müşteri kademesi" ödeme türü.
- `lib/types.ts`: `TierAllowance`, `TierUpgradeResult`, `PlatformInvoice.customerTierAbove`, `pendingBranchName`.
- `lib/apiClient.ts`: `customerAllowance`, `purchaseCustomerUpgrade`. Kapıya `adminApi.purchaseCustomerUpgrade(` eklendi.

**Mobil**
- `paket/paket_screen.dart`: müşteri izni; `_tierTexts` (iOS'ta nötr kilit metni); `_withTierCapacity`.
- `branches/branches_screen.dart`: `BranchAwaitingPayment` gelince "Şube talebi alındı" bilgi diyaloğu.
- `customers/customers_screen.dart`: `postNewCustomer`, sınır dolunca Paketim ipucu (iOS'ta gösterilmez).
- `appointments/appointment_form.dart`: randevudan hızlı müşteri ekleme aynı yoldan geçer.

**Testler**
- Yeni: `CustomerQuotaTests` (10), `CustomerQuotaMySqlTests` (1 — sınırda eşzamanlı ekleme, yalnız biri başarılı).
- Güncellenen:
  - `PerBranchBillingTests` / `PerBranchBillingMySqlTests`: ödenince açılma, aynı adla talep, eşzamanlı "Ödendi" tek
    şube açar;
  - `ConsentQuotaTests.NoPeriodTenant_UpgradeRunsToTheEndOfTheCalendarMonth`.

**Bilinen sınırlar**
- **İptal edilen şube faturası.** Açılmış şubenin faturası sonradan iptal edilirse şube kapanmaz (şube silme özelliği
  yok). Kademe hakkı ise iptalde geri alınır.
- **Eşzamanlı istekler.** Excel aktarımı ve online randevuda aynı anda gelen isteklerde 1–2 kayıtlık aşım olabilir.
  Panelden eklemede aşım olmaz.
- **App Store inceleme hesabı.** Bu hesap da "Aktif, dönemsiz" olduğu için iOS'ta ücretli şube açamaz. Gerekirse şubeyi
  platform açar; platformun açtığı şube ücretsizdir. Slug'a özel muafiyet bilinçli olarak yok.

---

## 5. Sınırların son hâli

| Sınır | Ödemeden aşılır mı? | Nasıl açılır |
|---|---|---|
| Kayıtlı müşteri | Hayır (10.000 ücretsiz) | Paketim → kademe: kart varsa hemen, yoksa fatura "Ödendi" olunca |
| İmzalı dijital onam | Hayır (10.000 ücretsiz) | Aynı yol |
| Şube | Hayır | Kart varsa karttan çekim, hemen açılır; yoksa fatura "Ödendi" olunca |
| SMS / WhatsApp | Kredi ile | Paket kotası + mesaj kredisi cüzdanı |
| E-posta | Ayda 10.000 sert sınır | Satın alma yolu yok |
| Personel / randevu | Sınırsız | — |

---

## 6. Türetilen ürüne aktarım yöntemi

### 6.1 Kaynak

- **Kaynak çalışma ağacıdır.** BeautyAsist'te commit yapılmadığı için değişiklikleri şöyle alın:
  `git diff 690f5c9 -- <dosya>` ve izlenmeyen yeni dosyalar (`git status --short | grep '^??'`). Paket başına dosya
  listesi §9'da. BeautyAsist'te commit edilince paket başına commit hash'lerini bu belgeye ekleyin.
- **Kod düz yama olarak uygulanmaz.** Türetilen üründe ad alanları, sözlük ve bazı özellikler farklıdır. Her paketi
  buradaki kural ve dosya listesiyle elle taşıyın; BeautyAsist dosyasını referans olarak açık tutun.
- **Paket sırasına uyun (1 → 6).** Önce backend ve testler, sonra web, sonra mobil. Her web değişikliği aynı turda
  mobile de taşınır.

### 6.2 Ad eşlemesi

| BeautyAsist | DentistAsist | Yeni ürün (ör. DoctorAsist) |
|---|---|---|
| Ad alanı `GuzellikMerkezi.*` | `DentistAsist.*` | `<Ürün>.*` |
| `GuzellikDbContext` | `DentistAsistDbContext` | `<Ürün>DbContext` |
| Paket anahtarı/adı `BeautyAsist` | ürün kararı (ör. `DentistAsist`) | ürün kararı |
| Test ortam değişkeni `GUZELLIK_TEST_MYSQL` | `DENTISTASIST_TEST_MYSQL` | — |
| Portlar: web 3000 / API 5019 | 3100 / 5119 | — |
| Yerel DB `guzellik_merkezi_dev` | `dentistasist_dev` | — |
| Sözlük: müşteri / salon | hasta / klinik | ürüne göre |
| Sistem kurumu `bireysel-musteriler` | yok (hasta portalı yok) | portal varsa gerekir |

### 6.3 Migration'lar — dosya kopyalanmaz

1. **Model değişikliklerini taşıyın.** Entity ve yapılandırma değişikliklerini türetilen ürüne geçirin.
2. **Migration'ı ürünün kendi modelinden üretin.** Aynı adı kullanın, ör. `dotnet ef migrations add MessagingCreditsAndSms`.
   - Çalışan API DLL'leri kilitler; önce API'yi durdurun.
   - `.Designer.cs` ve snapshot, türetilen ürünün modelini taşımalıdır. BeautyAsist'in Designer dosyası kopyalanırsa
     model farkı bozulur.
3. **Üretilen dosyayı denetleyin.**
   - `MessagingCreditsAndSms`: `wallet_transactions` tablosundaki üç kolon **RENAME** olmalıdır (§4, paket 1). EF
     Drop + Add üretirse cüzdan defteri silinir; elle `RenameColumn`'a çevirin.
   - Başka bir `RenameColumn` çıkarsa tek tek bakın. EF kolonları konum benzerliğinden yanlış eşleştirebilir;
     DentistAsist'te `UsedIsotretinoin → UsesBisphosphonate` olayı yaşandı. Anlamı farklı kolonlar DROP + ADD olmalıdır.
   - Veri SQL'lerini BeautyAsist dosyalarından elle ekleyin; EF bunları üretmez: paket 1'in kredi dönüşümü, paket 3'ün
     fiyat ÷ 1,2 dönüşümü, paket 4'ün tek paket konsolidasyonu.
4. **MariaDB kurallarına uyun.**
   - `UPDATE` hedef tablosuna takma ad verilmez.
   - Yedek tablo karşılaştırmaları açık `COLLATE` taşır.
   - `SET` ile tanımlanan değişkenler `COLLATE utf8mb4_unicode_ci` ister.
5. **Manifesti güncelleyin.** `backend/tools/migration-manifest.sh generate` → `backend/migrations.sha256` (CI `verify`
   çalıştırır). Uygulanmış bir migration'ın gövdesi bir daha değiştirilmez; düzeltme her zaman yeni bir migration'dır.
6. **Design-time fabrika çakışması.** BeautyAsist'te `dotnet-ef` iki design-time fabrikası yüzünden çakıştı;
   `GuzellikDbContextFactory` geçici olarak devre dışı bırakılarak üretildi. Türetilen üründe de görülebilir.

### 6.4 Ürüne özel sabitler — kopyalamadan önce değiştirin

- **Paket anahtarı ve adı `'BeautyAsist'`.** Geçtiği yerler:
  - `SingleSubscriptionPlan` migration SQL'i (birden çok yerde);
  - `DatabaseBootstrap.SinglePlanKey`, `Tenant.Plan` varsayılanı;
  - web yedek listeleri: `CreateTenantDialog`, `platform/kurumlar`, `platform/sistem`, `apiMappers`;
  - paket açıklaması "Tüm özellikler dahil · şube başına ücretlendirme".
- **`AllFeatures`** (tek paketin özellik listesi, migration içinde):
  - türetilen ürünün `FeatureCatalog`'undan üretin;
  - kapalı özellikleri eklemeyin (DentistAsist'te hediye çeki, kampanya, sadakat);
  - ürüne özgü özellikleri ekleyin.
- **Fiyat ve kotalar** (hepsi ürün kararı):
  - fiyatlar 1.000 / 10.000, yıllık çarpan 10, `Tiers` JSON;
  - kota sayıları: SMS 2.500, WhatsApp 1.500, e-posta 10.000.
- **Kredi ayarları:** kredi maliyetleri, `CreditUnitPriceTry` (0,15), `SmsCreditsPerPart` (2), düşük bakiye eşiği (350),
  varsayılan aylık tavan (3.500).
- **Metinler** sözlüğe göre çevrilir: nötr müşteri mesajı ("Bu klinik şu an …"), Paketim kart başlıkları ("Kayıtlı Hasta"),
  hata mesajları. Türkçe ekler ünlü uyumuyla değişir: müşteriler → hastalar, müşterinin → hastanın. Düz bul-değiştir
  yanlış ek üretir.

### 6.5 Doğrulama

- **Backend tam takım.** `dotnet test`; MySQL testleri için `<ÜRÜN>_TEST_MYSQL` ortam değişkeni ve seri çalıştırma
  ayarı (`--settings serial.runsettings`):
  ```xml
  <RunSettings><xUnit><ParallelizeTestCollections>false</ParallelizeTestCollections><MaxParallelThreads>1</MaxParallelThreads></xUnit></RunSettings>
  ```
  - BeautyAsist'te tam takım yaklaşık 16 dakika sürer, 885 test.
  - Bağlantı dizesi ve parolalar bilerek bu belgede yok; ürünün yerel çalıştırma notlarına bakın.
  - **Ad alanı çakışması:** `<Ürün>.Tests.Application` ile `<Ürün>.Application.Features.PlatformOps` çakışır;
    testlerde tam nitelikli ad kullanın.
- **Web.** `npx tsc --noEmit` ve `npx vitest run`. `moneyWriteIdempotency.test.ts` ham metni tarar; çağrılar
  `adminApi.X(` biçiminde ve tip argümanı olmadan yazılmalıdır.
- **Mobil.** `flutter analyze` Türkçe karakterli yolda çöker; ASCII bir kopyada çalıştırın (BeautyAsist'te
  `robocopy mobile\lib C:\src\armonessa_mobile\lib /MIR`).
- **Uçtan uca senaryolar.** Planın kademe eşiklerini geçici olarak küçültün (ör. 2 / 4), sonra geri alın:
  1. Sınırda yeni müşteri → 409 `CustomerLimitReached`. Kademe faturası iste → Sent kilidi açmaz → Paid açar.
  2. Aynı akış imzalı onam için.
  3. Kota doluyken Excel aktarımı → müşteri satırları atlanır, diğer satırlar aktarılır.
  4. Kartsız kurum şube ister → fatura kesilir, şube açılmaz. Aynı adla tekrar → ikinci fatura yok. Platform
     "Ödendi" → şube bir kez açılır.
  5. Elle faturalanan kurumda şube → fatura dönemi ay sonunda biter.
  6. Kota üstü toplu SMS → mesaj başına kredi düşer.
  7. Eski istemci `monthlySpendCapTry` gönderir → tavan silinmez.
  8. iOS'ta fiyat ya da satın alma görünmez; kilit mesajı nötrdür.

---

## 7. DentistAsist'e özel farklar

14 Kas 2026'da ölçüldü; konum `C:\Users\KAYA\Desktop\DentistAsist`.

**Durum**
- Son commit `fb16cc0` (10 Eki 2026); çalışma ağacı temiz.
- Son migration `20260918210212_AddSupportTickets` (toplam 100 migration).
- Bu belgedeki paketlerin **hiçbiri yok**: `SubscriptionPricing`, `TierEntitlementQuery`, `ChargeAddonWithStoredCardAsync`
  bulunmadı.

**Var olan ön koşullar**
- Fatura ve ödeme: `TenantInvoice`, `SubscriptionPayment`, `TenantPaymentMethod` + iyzico, `PaymentsEnabled`.
- Idempotency: `Idempotency-Key` ve `moneyWriteIdempotency` kapısı.
- Sınır ve içe aktarma: `UsageService`, `DataImportService`.
- Onam: `ConsentService.StartSessionAsync` / `SignAsync` (tablet imza).
- Mesajlaşma: `TenantMessagingWallet` + `WhatsAppCreditPackage` (kontör).
- Diğer: `AppReviewAccountSeeder`, `SubscriptionRenewalBackgroundService`, `TenantSignupService`.

**Eksik olanlar — ilgili kısım uyarlanır ya da atlanır**

| DentistAsist'te eksik | Etkisi |
|---|---|
| Hasta portalı (`CustomerPortalService` yok, `DropPatientPortalLeftovers`) | Paket 6'nın online kayıt kapısı, nötr portal mesajı ve sistem kurumu muafiyeti **uygulanmaz** (`bireysel-musteriler` kurumu da yok) |
| Hediye çeki kapalı (uçları kayıtlı değil, GiftCard* web bileşenleri silindi) | Paket 1'deki hediye çeki SMS'i **aktarılmaz**: `/api/admin/sms/gift-card`, `GiftCardShareModal`, `gift_card_share_sheet` |
| Mobilde `StorePolicy` yok | iOS'ta satın alma gizleme (`hidesPurchaseFlows`) yok. Ürün App Store'a çıkacaksa **önce StorePolicy taşınmalı**, yoksa iOS'ta fiyat/satın alma görünür (App Store 3.1.1) |
| Kampanya ve sadakat kapalı | Tek paketin `AllFeatures` listesine `marketing.giftcards`, `marketing.campaigns`, `loyalty.points` konmaz |

**Diğer uyarılar**
- **Sözlük.** "Müşteri kademesi" türetilen üründe "hasta kademesi" olur. Paketim, hata mesajları ve fatura açıklamaları
  sözlüğe göre yazılır.
- **Paket sözcüğü.** DentistAsist'te "Paket" hem tedavi planı hem abonelik paketi anlamına gelir. Abonelik paketini
  anlatan metinlerde karışıklık yaratmayın.
- **Kapsam dışı kalan işler.** BeautyAsist'te Eylül–Kasım arasında yapılıp DentistAsist'e geçmemiş başka işler de
  olabilir; bu belge yalnız 12–14 Kasım paketlerini kapsar. Bir ön koşul eksik çıkarsa önce o işi taşıyın.

---

## 8. Canlıya çıkış (her ürün için)

1. **Kilitlenecek kurumları önceden sorgulayın.** Eski faturaların hiçbiri kademe bilgisi taşımaz. Bu yüzden 10.000 ve
   üstü müşterisi ya da imzalı onamı olan her kurum, dağıtım anında yeni kayıt/imza ekleyemez hâle gelir (kasıtlı):
   ```sql
   SELECT t.Name, t.Slug, t.Status,
          (SELECT COUNT(*) FROM customers c WHERE c.TenantId = t.Id AND c.IsDeleted = 0) AS musteri,
          (SELECT COUNT(*) FROM customer_consent_forms f WHERE f.TenantId = t.Id AND f.SignedAtUtc IS NOT NULL) AS imzali_onam
   FROM tenants t
   WHERE t.IsDeleted = 0 AND t.Slug <> 'bireysel-musteriler'
   HAVING musteri >= 10000 OR imzali_onam >= 10000
   ORDER BY musteri DESC;
   ```
   **Kilidi açmanın iki yolu var:**
   - Kurum sahibi web ya da Android Paketim'den kademe faturası ister, platform faturayı "Ödendi" yapar.
   - Elle faturalanan kurumda bu ayın faturası henüz kesilmediyse "Dönem taslaklarını üret", kademeyi içeren taslağı
     oluşturur.

   Serbest "Fatura taslağı" kademe **açmaz**.
2. **Migration'ları sırayla ve elle uygulayın.** Canlı MariaDB'de otomatik migration yok:
   `MessagingCreditsAndSms` → `TenantSmsConnections` → `PerBranchPricing` → `SingleSubscriptionPlan` →
   `ConsentTierEntitlement` → `CustomerTierAndBranchOnPayment`.
3. **Backend ve web birlikte çıkmalı.** Fiyatlar KDV hariç olduğundan eski arayüz yanlış tutar gösterir.
4. **`Messaging:ServerOutboundIp` ayarlanmalı** (paket 2).
5. **Paket 4'ü almayan ürün için:** elle düzenlenmiş paketleri kontrol edin. `MaxMonthlySmsCount <> 0` olup
   özelliklerinde `notifications.sms` olmayan paket SMS'i kaybeder (paket 1'in sunucu kapısı).

---

## 9. Dosya envanteri

Köşeli parantez içindeki sayılar paket numarasıdır; bir dosya birden çok pakete hizmet edebilir. Yollar BeautyAsist
deposuna göredir.

### Backend — Domain (`backend/src/GuzellikMerkezi.Domain/`)
- `Billing/SubscriptionPricing.cs` **(yeni)** [3, 5, 6]
- `Entities/TenantInvoice.cs` [3, 5, 6] · `Entities/SubscriptionPayment.cs` [3, 5, 6]
- `Entities/SubscriptionPlan.cs` [1, 3] · `Entities/Tenant.cs` [4] · `FeatureCatalog.cs` [4]
- `Entities/TenantSmsConnection.cs` **(yeni)** [2]
- `Entities/NotificationLog.cs`, `TenantMessagingWallet.cs`, `WalletTransaction.cs`, `WhatsAppBillingSettings.cs`,
  `WhatsAppCreditPackage.cs`, `WhatsAppCreditPurchase.cs`, `WhatsAppMessage.cs`, `WhatsAppPricingRule.cs`,
  `WhatsAppSettings.cs`, `Enums/WhatsAppEnums.cs` (`WalletUnit`) [1]

### Backend — Application (`backend/src/GuzellikMerkezi.Application/`)
- `Common/Error.cs` [3, 5, 6] · `Features/Billing/IBillingService.cs` [3, 5, 6] · `Features/Branches/BranchDtos.cs` [3, 6]
- `Features/Notifications/INotificationService.cs`, `NotificationDtos.cs`, `ICustomerSmsService.cs` **(yeni)** [1]
- `Features/Notifications/ITenantSmsConnectionService.cs` **(yeni)** [2]
- `Features/PlatformMessaging/IPlatformMessagingService.cs`, `PlatformMessagingDtos.cs`, `SmsSegments.cs` **(yeni)** [1]
- `Features/PlatformOps/IPlatformOpsService.cs` [3, 6] · `Features/SubscriptionPlans/SubscriptionPlanDtos.cs` [3, 4]
- `Features/WhatsApp/IWhatsAppBillingService.cs`, `WhatsAppBillingDtos.cs`, `WhatsAppDtos.cs` [1, 2]

### Backend — Infrastructure (`backend/src/GuzellikMerkezi.Infrastructure/`)
- `Services/BillingService.cs` [3, 4, 5, 6] · `BillingService.Branches.cs` **(yeni)** [3, 6] ·
  `BillingService.Consent.cs` **(yeni)** [5, 6]
- `Services/BillingCountsQuery.cs` **(yeni)** [3] · `ConsentEntitlementQuery.cs` **(yeni)** [5, 6] ·
  `PlatformBillingOverview.cs` **(yeni)** [3]
- `Services/PlatformOpsService.cs` [3, 5, 6] · `RowLock.cs` [6] · `BranchService.cs` [3, 6] · `ConsentService.cs` [5]
- `Services/UsageService.cs`, `CustomerService.cs`, `DataImportService.cs`, `CustomerPortalService.cs`, `AuthService.cs` [6]
- `Services/NotificationService.cs`, `PlatformMessagingService.cs`, `WhatsAppBillingService.cs`, `CustomerSmsService.cs`
  **(yeni)** [1] · `WhatsAppService.cs` [1, 2]
- `Services/TenantSmsConnectionService.cs` **(yeni)** [2]
- `Services/SubscriptionPlanService.cs` [3, 4] · `TenantSignupService.cs` [4] · `TenantProfileService.cs`,
  `PublicSalonService.cs` [3 — vitrin 15 görsel]
- `Background/DurableJobHandlers.cs` [1] · `DependencyInjection.cs` [1, 2]
- `Persistence/DatabaseBootstrap.cs` [4] · `Persistence/GuzellikDbContext.cs` [1, 2, 3]
- `Persistence/Migrations/`: 6 migration (§2) + `GuzellikDbContextModelSnapshot.cs` · `backend/migrations.sha256`

### Backend — Api (`backend/src/GuzellikMerkezi.Api/`)
- `Endpoints/BillingEndpoints.cs` [3, 5, 6] · `PlatformOpsEndpoints.cs` [3] · `SubscriptionPlanEndpoints.cs` [3, 4]
- `Endpoints/NotificationEndpoints.cs` [1] · `PlatformWhatsAppEndpoints.cs` [2] · `SmsEndpoints.cs` **(yeni)** [1, 2]
- `Extensions/ResultExtensions.cs` [3, 5, 6] · `Middleware/StaffApprovalGateMiddleware.cs` [1, 2] · `Program.cs` [1]
- `Background/SubscriptionRenewalBackgroundService.cs` [3] · `Background/WhatsAppReservationSweepBackgroundService.cs` [1]
- `Development/DevelopmentDataSeeder.cs` [4] · `Setup/AppReviewAccountSeeder.cs` [4]

### Backend — Testler (`backend/tests/GuzellikMerkezi.Tests/`)
- **Yeni testler:**
  - `Domain/SubscriptionPricingTests.cs` (12) [3]
  - `Infrastructure/PerBranchBillingTests.cs` (16), `PerBranchBillingMySqlTests.cs` (4) [3, 6]
  - `Infrastructure/ConsentQuotaTests.cs` (12), `ConsentQuotaMySqlTests.cs` (1) [5, 6]
  - `Infrastructure/CustomerQuotaTests.cs` (10), `CustomerQuotaMySqlTests.cs` (1) [6]
  - `Infrastructure/MessagingCreditSmsTests.cs` (10), `NotificationEstimateTests.cs` (6),
    `WhatsAppSettingsSpendCapTests.cs` (3), `NotificationTestServices.cs` [1]
  - `Infrastructure/TenantSmsConnectionTests.cs` (20), `WhatsAppTemplateOwnershipTests.cs` (3) [2]
- **Güncellenen testler:**
  - `AuditRoundNineTests.cs`, `AuditRoundSevenPhase4Tests.cs`, `BalanceRaceMySqlTests.cs`,
    `NotificationUnknownOutcomeMySqlTests.cs`, `WhatsAppCreditCheckoutTests.cs` [1]
  - `PaymentSafetyRoundThreeTests.cs`, `PaymentTestDoubles.cs`, `SubscriptionBillingTests.cs`, `TenantSignupTests.cs`
    [3, 4]

### Web (`Frontend/`)
- `lib/apiClient.ts`, `lib/types.ts` [tüm paketler] · `lib/moneyWriteIdempotency.test.ts` [3, 5, 6]
- `app/panel/bildirimler/page.tsx` [1] · `components/dashboard/notifications/{messageKit.ts, TemplateComposerDialog.tsx,
  SendMessageDialog.tsx}` **(yeni)** [1]
- `components/dashboard/WhatsAppWalletCard.tsx`, `WhatsAppSettingsCard.tsx`, `AppointmentReminderControl.tsx`,
  `GiftCardShareModal.tsx`, `app/panel/hediye-cek/page.tsx`, `app/kayit/page.tsx`, `app/destek/page.tsx` [1]
- `app/platform/whatsapp/page.tsx` [1, 2] · `app/platform/layout.tsx` [2] · `components/dashboard/SmsConnectionCard.tsx`,
  `SmsConnectionForm.tsx` **(yeni)** [2]
- `lib/plans.ts`, `lib/landingPlans.ts`, `app/page.tsx`, `components/checkout/CheckoutClient.tsx`,
  `app/platform/planlar/page.tsx`, `app/panel/salon-profili/page.tsx`, `lib/guideContent.ts` [3] ·
  `components/dashboard/PlanFormDialog.tsx` [1, 3]
- `components/dashboard/CreateTenantDialog.tsx`, `app/platform/kurumlar/page.tsx`, `app/platform/sistem/page.tsx` [4] ·
  `lib/apiMappers.ts` [1, 3, 4]
- `app/panel/paket/page.tsx` [3, 5, 6] · `app/panel/ayarlar/page.tsx` [2, 3, 6] · `app/platform/fatura/page.tsx` [3, 5, 6]
- `components/dashboard/ConsentCenterModal.tsx` [5] · `components/dashboard/CustomerFormDialog.tsx` [6]

### Mobil (`mobile/lib/features/`)
- `notifications/{message_kit, template_composer_sheet, send_message_sheet}.dart` **(yeni)** + `notifications_screen.dart` [1]
- `whatsapp/whatsapp_screen.dart` [1, 2] · `gift_cards/gift_card_share_sheet.dart` [1]
- `branches/branches_screen.dart` [3, 6] · `settings/settings_screen.dart` [3] · `plans/plans_screen.dart` [3]
- `paket/paket_screen.dart` [3, 4, 5, 6] · `consent/consent_center_sheet.dart` [5]
- `customers/customers_screen.dart`, `appointments/appointment_form.dart` [6]
- Araç: `mobile/analysis_options.yaml` (analyze `build/`, `android/`, `ios/`, `windows/` klasörlerini dışarıda bırakır),
  `mobile/pubspec.lock`

---

## 10. Aktarım durumu ve belge günlüğü

### Aktarım durumu

| Paket | DentistAsist | Sonraki ürün |
|---|---|---|
| 1 — Mesaj kredisi + SMS | Aktarılmadı | — |
| 2 — Kendi SMS hesabı | Aktarılmadı | — |
| 3 — Şube başı fiyatlama | Aktarılmadı | — |
| 4 — Tek paket | Aktarılmadı (paket adı ürün kararı) | — |
| 5 — Onam kademe hakkı | Aktarılmadı | — |
| 6 — Müşteri kademesi + ödenince şube | Aktarılmadı (portal kısmı yok) | — |
| 7 — İmzalı bağlayıcı | Aktarılmadı | — |
| 8 — Ödeme Maydanoz'da | Aktarılmadı | — |
| 9 — Kayıt ve giriş Maydanoz'da | Aktarılmadı | — |
| 10 — Platform köprüsü | Aktarılmadı | — |
| 11 — Şube/kademe ücret uyarısı + şık e-postalar | Aktarılmadı | — |
| 12 — Havale / EFT | Aktarılmadı | — |
| 13 — SMS / WhatsApp kredisi ayrı | Aktarılmadı | — |
| 14 — Hesap kredisi bağlayıcısı | Aktarılmadı | — |
| 15 — Otomatik ödeme hazırlığı | Aktarılmadı | — |
| 16 — Şube silme | Aktarılmadı | — |
| 17 — Kalıcı kurum silme bağlayıcısı | Aktarılmadı | — |
| 18 — Maydanoz'a oturumlu geçiş + kredi yalnız yetkili | Aktarılmadı | — |
| 19 — Köprü 2. dilim (destek, kurum profili, veritabanı, aylık değer) | Aktarılmadı | — |
| 20 — WhatsApp yanıtları Chatwoot köprüsüyle | Aktarılmadı (ürünün numarası Chatwoot'taysa gerekir) | — |

Bir paket aktarılınca bu tabloyu tarih ve commit ile güncelleyin.

### Belge günlüğü

- **14 Kas 2026:** ilk sürüm; paket 1–6 (12–14 Kasım işleri).
- **18 Kas 2026:** paket 7–17 (Maydanoz entegrasyonu, §12) eklendi; reçetenin Maydanoz tarafı `ASIST_ENTEGRASYONU.md` §0.
- **18 Kas 2026 (akşam):** paket 18 (panelden Maydanoz'a oturumlu geçiş; Maydanoz'da mesaj kredisi yalnız kurum yetkilisi).
- **19 Kas 2026:** paket 19 (Maydanoz admin paneli Asist verisini okur: destek, kurum profili, veritabanı izleme, aylık değer).
- **20 Kas 2026:** paket 20 (WhatsApp müşteri yanıtları Chatwoot webhook'undan; teslim durumu/kontör kararı açık).
- BeautyAsist'te yeni bir iş bitince buraya yeni bir paket olarak ekleyin. Her pakete kural, şema, dosyalar, testler,
  tuzaklar ve canlı notlarını yazın.

---

## 11. Bu rehberde ayrıntılanmamış önceki işler

DentistAsist 20–21 Ağustos 2026'da BeautyAsist'ten ayrıldı. Ayrılıştan sonra BeautyAsist'e giren aşağıdaki 50 commit bu
rehberde **ayrıntılandırılmadı**. Hangisinin türetilen ürüne zaten aktarıldığı bilinmiyor. Her biri **"aktarılıp
aktarılmadığı kontrol edilmeli"** durumunda; "eksik" demek değildir.

Listeyi yeniden üretmek için BeautyAsist deposunda:

```
git log --since=2026-08-20 --format="%h %ad %s" --date=short
```

Ayrıntısı için `git show <commit>` kullanın.

**Bilinen ipuçları**
- **Zaten aktarılmış görünenler.** DentistAsist'te destek talepleri ve hesap silme işinin karşılığı görünüyor:
  DentistAsist commit `c64caa1` ve migration'lar `20260918125006_AddAccountDeletionRequests`,
  `20260918210212_AddSupportTickets`.
- **Aktarılmayacaklar.** "Surum 1.0.0+NN" commit'leri BeautyAsist'in mağaza sürüm numaralarıdır. İkon ve kurumsal
  e-posta commit'leri markaya özgüdür.
- **Yalnız App Store'a çıkılacaksa gerekenler.** App Store maddelerine (3.1.1, 3.2.2(v), 5.1.1(v)) ve App Review
  hesabına bağlı commit'ler. DentistAsist'te mobil `StorePolicy` yok.
- **DentistAsist'te uygulanmayanlar.** Müşteri portalına ait commit'ler; DentistAsist'te hasta portalı yok.
- **Ön koşul olabilecekler.** Paket 2'de Verimor sağlayıcısı ve onaylı WhatsApp şablon bağlama kullanılır; bunlar
  `efa16ab` ve `e288462` commit'lerinden gelir.

| Commit | Tarih | Başlık | Not |
|---|---|---|---|
| `690f5c9` | 2026-10-30 | Masaustu: yalniz isletme paneli + Mac App Store surumu | Masaüstü uygulaması varsa |
| `2f26729` | 2026-10-19 | Girissiz salon vitrini (App Store 5.1.1(v)); surum 1.0.0+20 | App Store |
| `24f9bc6` | 2026-10-14 | Surum 1.0.0+19 (10-18 yalniz TestFlight ici yuklendi) | Sürüm — aktarılmaz |
| `99937e2` | 2026-10-14 | Surum 1.0.0+18 (17 de yalniz TestFlight ici yuklendi) | Sürüm — aktarılmaz |
| `2bf6a04` | 2026-10-14 | Surum 1.0.0+17 (App Store'a gonderilebilir yukleme; 16 yalniz TestFlight ici yuklenmisti) | Sürüm — aktarılmaz |
| `fc394de` | 2026-10-14 | Musteri portali: silinen randevular gorunuyor ve slot tutuyordu | Portal |
| `65476db` | 2026-10-14 | Musteri portali: randevu iptalinde siyah ekran duzeltildi | Portal |
| `35f9f19` | 2026-10-14 | iOS: deneme/abonelik bitince satin almaya cagri gosterilmiyor (3.1.1) | App Store |
| `16e21f1` | 2026-10-14 | Inceleme kurucusu: numara baska kurumda kayitliysa ikinci kopya tutulmuyor | App Store |
| `803df29` | 2026-10-14 | Musteri girisi: Turkce soyadlar eslesmiyordu (YILMAZ/MUSTERİ) | Portal girişi |
| `8ee0a8c` | 2026-10-14 | Demo musteri adi Turkce karaktersiz: Demo Musteri | App Store |
| `69320f1` | 2026-10-14 | Yonetici panosu bos acilmasi duzeltildi (aurora Stack sinirsiz yukseklik) | |
| `fd16da4` | 2026-10-14 | iOS uygulama ikonu: krem zemin kaldirildi, pembe plaka kenardan kenara | Marka — aktarılmaz |
| `a412cff` | 2026-10-14 | App Review demo musterisinde giris kodu adimi kaldirildi | App Store |
| `ab9af3e` | 2026-10-14 | iOS'ta uygulama ici satin alma yonlendirmesi kaldirildi (App Store 3.1.1) | App Store |
| `963b4db` | 2026-10-14 | App Review demo yoneticisinde kod adimi kaldirildi | App Store |
| `dcca4cf` | 2026-09-23 | Merge fix/otp-kanal-metni-gercek-duruma-baglandi through 1e38269 | Birleştirme commit'i |
| `1e38269` | 2026-09-23 | Clarify demo verification and email delivery for App Review | App Store |
| `b4d23ab` | 2026-09-23 | Musteri dogrulama kodu yalniz e-posta (App Store 3.2.2(v)/2.1, 23 Eyl) | App Store / portal |
| `e68b18a` | 2026-09-22 | Store yayin blokerleri: hesap silme sayfasi ve tam alarm izni | |
| `3b61dc5` | 2026-09-21 | OTP kanal vaadi gercek duruma baglandi (web mobil esitlendi) | |
| `599f67b` | 2026-09-21 | fix(auth): hide app review OTP from production response | App Store |
| `d6fc924` | 2026-09-21 | App Review panel OTP teslimat engelini gider | App Store |
| `61e1b87` | 2026-09-20 | AppReview:Enabled iki ayri omru tasiyordu - hesap kurulumu ayristirildi | App Store |
| `f3af3f0` | 2026-09-19 | Magaza inceleme kisayolu ve OTP tuketimi (denetim turu 4) | |
| `17682c1` | 2026-09-19 | Uretim bagimlilik aciklari kapatildi (fflate, postcss-selector-parser) | |
| `e4650b7` | 2026-09-18 | Ust cubugun dolu dugmesi: ton ve metin | Landing |
| `4c56c1a` | 2026-09-18 | Landing ust cubugu duzenlendi | Landing |
| `0a59469` | 2026-09-18 | Kurumsal e-posta adresi degisikligi | Marka — aktarılmaz |
| `4b58bf8` | 2026-09-18 | Destek sayfasi footer duzeltmesi | |
| `78b5a2d` | 2026-09-18 | Deploy blocker turu: kanitsiz silme, cift bildirim, bagimlilik aciklari | |
| `4be27c5` | 2026-09-18 | Deploy blocker: kurum silme yarisi + mobil gecikme tarihi | |
| `a824fa3` | 2026-09-18 | Destek e-postasinda Turkce kacis: ortak HtmlEscape | |
| `fc42d1c` | 2026-09-18 | Testler: kayit bayragi, hesap silme ve destek talepleri | DentistAsist'te karşılığı görünüyor |
| `394586d` | 2026-09-18 | Mobil destek ekrani (web-mobil parite) | DentistAsist'te karşılığı görünüyor |
| `cc23a8d` | 2026-09-18 | Destek talepleri: landing formu + takip kodu + platform kuyrugu | DentistAsist'te karşılığı görünüyor (`c64caa1`) |
| `ac9be45` | 2026-09-18 | Hesabimi sil: kurum (bekleme sureli) + musteri (aninda anonimlestirme) | DentistAsist'te karşılığı görünüyor (`c64caa1`) |
| `61bd8d1` | 2026-09-18 | Kayit + sifre sifirlama: telefon adimi bayraga baglandi, e-posta tek faktor | |
| `24e1cd9` | 2026-08-31 | WhatsApp: iki eszamanlilik acigi kapatildi (denetim blocker'lari) | |
| `e4aab8c` | 2026-08-31 | Guvenlik basliklari: HSTS + CSP nonce (proxy.ts) | |
| `53e36e8` | 2026-08-31 | Pentest turu (27 Agu 2026): sube kapsami, readiness sizintisi, auth sikilastirma | |
| `e288462` | 2026-08-31 | WhatsApp: onayli sablon baglama + otomatik randevu hatirlatmasi | Paket 2 için ön koşul olabilir |
| `ba08aa5` | 2026-08-27 | Dogrulama kodu e-postasi markali sablona tasindi | |
| `fe6c6a9` | 2026-08-27 | Sinematik landing + /moduller + /odeme satin alma akisi | Landing |
| `b216851` | 2026-08-26 | Kurum kayit taslagi da depoya tasindi; nesne kilitleri kaldirildi | |
| `a109f22` | 2026-08-26 | OTP/challenge durumu process disina tasindi (Redis destegi) | |
| `4cefe90` | 2026-08-26 | Mukerrer musteri e-postasi engellendi + mobil parite | |
| `2c26b8c` | 2026-08-26 | Musteri girisinde e-posta kimlik dogrulayici oldu | Portal girişi |
| `5bae556` | 2026-08-26 | Panel 2FA dogrulamasinda refresh token HttpOnly cereze tasinsin | |
| `efa16ab` | 2026-08-26 | Verimor SMS saglayicisi (varsayilan) eklendi | Paket 1–2 için ön koşul olabilir |

---

## 12. Maydanoz entegrasyonu paketleri (17–18 Kas 2026)

> **Bütün resim Maydanoz deposunda:** `C:\Users\KAYA\Desktop\Projelerim\Maydanozasist Web\ASIST_ENTEGRASYONU.md` §0
> ("Yeni bir Asist bağlama reçetesi"). Maydanoz tarafı Asist'ten bağımsızdır: yeni Asist bağlayıcı sözleşmesini
> uyguladığında ödeme sayfası, kayıt, giriş, Hesabım, kredi, havale, otomatik ödeme, kurum silme ve platform paneli
> kod değişmeden çalışır. Bu bölüm yalnız **Asist (BeautyAsist) tarafını** paket paket anlatır; türetilen ürüne
> (DentistAsist, DoctorAsist) aynen aktarılacak olan budur.
>
> Durum (18 Kas 2026): paket 7–17 BeautyAsist'te bitti, test edildi ve canlıda. Paket 18 bitti ve test edildi; yayını
> kullanıcı onayı bekliyor (migration elle). Hiçbiri türetilen ürüne aktarılmadı (§10).

### Kullanıcının kararları (sözleriyle)

- "Ödeme kısmı maydanozasistin web sitesinde olacak … platform@beautyasist hesabında olan her kısım maydanozasistin
  panelinden de yönetilebilecek" (17 Kas). Gizli anahtarlar dahil; yazılır, geri okunmaz.
- "Maydanozasistten ödemeler olacak, beautyasistte değil; maydanozasistte yönlendirme yapacaksın" (17 Kas).
  → Asist ödeme ALMAZ. Tutarı Asist hesaplar (şube başı + kademeler + KDV), Maydanoz tahsil eder ve "ödendi" bildirir.
- "Kayıt olma sayfasını Maydanoz'a taşıyalım … her asistin kayıt ol sayfası olacak, demo talep et deyince kayıt sayfasına
  gidecek … vergi levhası, kimlik görseli, ticaret odası kaydı gibi belgeleri de yüklesin … admin panelinden onaylayınca
  hesap oluşacak … satın alma sayfasına bilgileri direkt çekersin, giriş yap kısmı Maydanoz'da da olacak" (18 Kas).
- "Mesaj kredisi kısmını Maydanoz ile satın almaya bağla; şube eklerken ve limitleri aşarken ücret mesajı çıksın
  ('ücretinize bu kadar yansıyacak'); EFT/havale seçeneği; aylık satın almalarda otomatik ödeme; demo talep et'te yalnız
  yayındaki Asist'ler; yeni e-postaları kod doğrulama mailindeki gibi şık yap" (18 Kas).
- "SMS ayrı, WhatsApp ayrı kredi al kısmı olsun … fiyatları farklı olabilir, farklı kredi yiyebilirler" (18 Kas).
- "Mobilde de web'e yönlendirebilirsin, webten alır" (18 Kas) — iOS mağaza kuralı (3.1.1) gereği iOS'ta fiyat yok.
- "Şube silme kısmı yok, onu da ekle; silerse fiyat ona göre güncellenecek" (18 Kas).
- "Platform kısmında hem Maydanoz'da hem BeautyAsist'te kalıcı kurum silme olsun ki DB şişmesin" (18 Kas).
- "BeautyAsist'te kredi kısmında satın al dediğinde Maydanoz'un satın alma kısmına gittiğinde form boş oluyor çünkü
  Maydanoz'da giriş yapmamış olabiliyor; boşa satın alma olur, buna dikkat etmek lazım" (18 Kas) → paket 18.

### Paketler bir bakışta

| # | Paket | Commit | Migration | Ne değişti |
|---|---|---|---|---|
| 7 | İmzalı bağlayıcı | `24254f9`, `a051911` | `20261117080226_ConnectorNonces` | `/api/connector/v1` (HMAC, ±5 dk, tek kullanımlık nonce); kişisel verisiz kurum aynası |
| 8 | Ödeme Maydanoz'da | `ff75158`, `8cb5299`, `8eb8d16` | `20261117120352_ExternalCheckouts`, `20261117134059_ExternalCheckoutInvoice` | Sağlayıcı "Maydanoz"; ödeme kaydı + yönlendirme; mevcut paketi / açık faturayı öde |
| 9 | Kayıt ve giriş Maydanoz'da | `62c464a`, `bf71776`, `5725edf` | — | Public kayıt kapandı; başvuru doğrulama/onay, hesap girişi, Hesabım teklifi ve satın alma uçları |
| 10 | Platform köprüsü | `4fb3a3e` | — | Platform ayarları Maydanoz panelinden (`platform.manage`, izin listeli) |
| 11 | Şube/kademe ücret uyarısı + şık e-postalar | `42d7623` | — | Şube ekleme penceresi (ücret etkisi), müşteri/onam kademe uyarısı, `NoticeEmailTemplate` |
| 12 | Havale / EFT | `7c04ebd` | — | Ödeme kaydı havale süresince 7 gün açık; mesaj kredisi Maydanoz'da ödenir |
| 13 | SMS / WhatsApp kredisi ayrı | `f4f7b72`, `2c78f54` | `20261118171319_SplitSmsWhatsAppCredits` | Ayrı bakiye, paket kanalı, SMS birim fiyatı, kanal başına düzeltme |
| 14 | Hesap kredisi bağlayıcısı | `f5b8320` | — | Maydanoz Hesabım için kredi bakiyesi + paketler + kredi ödemesi |
| 15 | Otomatik ödeme hazırlığı | `7e1d1ac` | — | Ödeme kaydı dönemini söyler; Maydanoz'dayken kartlı yenileme hiçbir şey çekmez |
| 16 | Şube silme | `1179279` | — | Kayıtlar seçilen şubeye aktarılır, şube kaldırılır; fiyat sonraki ödemede düşer |
| 17 | Kalıcı kurum silme (bağlayıcı) | `dcae6a2` | — | `tenants.delete` + kurum adı aynen |
| 18 | Maydanoz'a oturumlu geçiş + kredi yalnız yetkili | `777b04e` | `20261118201808_MaydanozHandoffs` | Yönlendirmede tek kullanımlık `#giris=` jetonu, `POST /accounts/handoff`; Maydanoz yolunda kredi yalnız kurum yetkilisi |
| 19 | Köprü 2. dilim: destek, kurum profili, veritabanı izleme, aylık değer | `9322454` | — | Destek kuyruğu + kurumlar (yalnız profil yazma) + `/system/database[/schema]` köprüde; bağlayıcı kurum satırında `monthlyNetTRY/monthlyGrossTRY/periodGrossTRY` |

**Bağımlılık:** 7 → 8 → (9, 12, 14, 15); 10 ve 17 yalnız 7'ye bağlı; 13 → 14; 11 ve 16 bağımsız (3'ün fiyat motorunu
kullanır); 18 → 8 + 9 (ödeme yönlendirmesi ve Maydanoz Hesabım oturumu); 19 → 7 + 10 (bağlayıcı ve platform köprüsü). Maydanoz tarafı Asist'ten SONRA yayına alınır (Maydanoz'un yeni kodu Asist'in yeni uçlarını çağırır).

### Paket 7 — İmzalı bağlayıcı (17 Kas)

- **Kural:** Maydanoz ile Asist yalnız imzalı bağlayıcıyla konuşur; Maydanoz'a PlatformAdmin oturumu verilmez.
- **Sözleşme:** başlıklar `X-Asist-Key`, `X-Asist-Timestamp` (unix sn), `X-Asist-Nonce`, `X-Asist-Signature`; kanonik metin
  `METHOD\npathAndQuery\ntimestamp\nnonce\nsha256hex(body)`, HMAC-SHA256 küçük harf hex; ±5 dk; nonce benzersiz
  (KeyId, Nonce). Yanıt zarfı `{ success, data | error{code,message} }`. İki projede ortak test vektörü:
  HMAC("k", …) = `ab074ae6…a6a9`.
- **Ayar:** `Connector__Keys__<keyId>__Secret` (≥32) + `Connector__Keys__<keyId>__Scopes` (boşlukla ya da `*`). Anahtar yoksa
  grup 404. Beauty'de keyId = `maydanoz`.
- **Dosyalar:** `Application/Features/Connector/ConnectorSignature.cs`, `Api/Middleware/ConnectorAuthMiddleware.cs`,
  `Api/Endpoints/ConnectorEndpoints.cs` (`.Scope("…")`), `Domain/Entities/ConnectorNonce.cs`,
  `Infrastructure/Services/ConnectorQueries.cs` (`ConnectorTenantDto`: kişisel veri YOK).
- **Testler:** `ConnectorAuthTests`, `ConnectorQueriesTests`.
- **Tuzak:** nonce temizliği ham SQL + LIMIT (MariaDB `ExecuteDelete`'i reddeder).

### Paket 8 — Ödeme Maydanoz'da (17 Kas)

- **Kural:** "ödemeler Maydanoz'dan olacak". Çekme modeli: Asist ödeme kaydı açar, kurumu
  `https://maydanozasist.com/odeme/asist/<asist>/<ref>` adresine yönlendirir; Maydanoz kaydı imzalı okur, tahsil eder,
  `POST /checkouts/{ref}/paid` ile bildirir. Bildirim gelmeden "alındı" sayılmaz; tutar/kur tutmazsa red; tekrar idempotent.
- **Şema:** `external_checkouts` (PublicRef 32 hex, ConversationId, Kind = Subscription | Credit | Invoice, TenantId,
  AmountTRY, Description, CallbackUrl, Status, ExpiresAtUtc, InvoiceId, ProviderPaymentId, PaidAmountTRY…). Ömür 24 saat.
- **Dosyalar:** `Infrastructure/Payments/MaydanozPaymentGateway.cs` (+ `PaymentGatewayResolver` izin listesi),
  `Domain/Entities/ExternalCheckout.cs`, `Application/Features/Connector/ConnectorCheckouts.cs`,
  `Infrastructure/Services/ConnectorCheckouts.cs`, `InvoicePaymentService.cs` + `InvoiceBranches.cs` (açık fatura öde →
  bekleyen şubeyi açar), `BillingService.cs` (erken ödemede yeni dönem mevcut bitişten başlar), web `app/panel/paket`,
  mobil `paket_screen.dart`.
- **Ayar:** `Payments__Maydanoz__SiteUrl=https://maydanozasist.com`, `Payments__CallbackBaseUrl`; DB
  `platform_integration_settings`: PaymentProvider=Maydanoz, PaymentsEnabled=1, PaymentsReturnUrl.
- **Testler:** `MaydanozCheckoutTests`.
- **Tuzaklar:** tek paket olduğundan "Mevcut paketiniz" ödeme başlatmıyordu → "Aboneliği başlat / Dönemi şimdi öde";
  paket ekranında "kartını kaydet, otomatik yenilenir" metni Maydanoz'dayken gösterilmez.

### Paket 9 — Kayıt ve giriş Maydanoz'da (18 Kas)

- **Kural:** belgeli başvuru Maydanoz'da; Maydanoz yöneticisi onaylayınca Asist'te deneme kurumu açılır (14 gün, sayaç ilk
  panel girişinde başlar); giriş ve satın alma Maydanoz'da; süresi dolmuş kurum da girebilir (satın almak için).
- **Uçlar:** `applications/readiness` (tenants.read), `applications/verify/start|email|phone|resend`, `approve`, `notify`,
  `accounts/login`, `login/verify`, `password-reset/request|complete`, `accounts/{tenantId}/checkout` (checkouts.write),
  `accounts/{tenantId}` (tenants.read). Kod/alındı/onay e-postalarını Asist gönderir (Maydanoz'da SMTP yok).
- **Dosyalar:** `Api/Services/ConnectorAccountService.cs`, `Application/Features/Connector/ConnectorApplications.cs`,
  `Infrastructure/Services/TenantSignupService.Application.cs`, `Api/Endpoints/TenantSignupEndpoints.cs` (public kayıt
  `TenantSignup:PublicEnabled` kapalı → 410), web `app/kayit` (→ maydanozasist.com/kayit/<asist>), `app/login`
  ("Paketi maydanozasist.com'dan satın al"), mobil giriş metni.
- **Testler:** `ConnectorAccountServiceTests`, `TenantSignupTests`.
- **Tuzaklar:** kod e-postasında kayıt bağlantısı yok (yeni sekmede boş form açıyordu); onaylanmamış hesap açan anonim satın
  alma (`/signups`) KALDIRILDI.

### Paket 10 — Platform köprüsü (18 Kas)

- **Kural:** platform panelinin her bölümü Maydanoz'dan; gizliler yazılır, okunmaz.
- **Mimari:** `Api/Middleware/PlatformBridgeMiddleware.cs` YÖNLENDİRMEDEN ÖNCE çalışır: imzalı
  `/api/connector/v1/platform/<yol>` → `/api/platform/<yol>`, etkin ilk PlatformAdmin kimliğiyle; `app.UseRouting()`
  köprünün hemen ardından. Kapsam `platform.manage`. İzin listesi (yöntem + tam yol) HEM burada HEM Maydanoz
  `AsistPlatformService.Allowed`'da — yeni uç ikisine de eklenir. Yazmalar gövdesiz denetim kaydına.
- **Testler:** `PlatformBridgeTests` (izin listesi, kurum listesi/silme köprüde YOK).
- **Tuzak:** `PUT /messaging/settings` TAM DEĞİŞTİRME (boş sağlayıcı Simulation'a döner) → Maydanoz gövdeyi okunan
  değerlerin tamamından kurar. İlk canlı kayıt kullanıcıyla ve DB yedeğiyle.

### Paket 11 — Şube/kademe ücret uyarısı + şık e-postalar (18 Kas)

- **Kural:** "şube eklerken ve limitleri aşarken ücretinize bu kadar yansıyacak mesajı" — deneme dahil.
- **Dosyalar:** `IBillingService` → `BranchImpactDto` (şube başı birim, bugünkü/sonraki aylık-yıllık teklif, dönem),
  `TierAllowanceDto.Impact` (`TierImpactDto`), `BillingService.Branches.cs`, `BillingService.Consent.cs`; web
  `BranchCreateModal.tsx`, `TierFeeNotice.tsx`, `lib/tierFee.ts`, `lib/branchInvoice.ts`, `CustomerFormDialog`,
  `ConsentCenterModal`, `ImportDialog` (aktarımda `CustomersOverCapacity`); mobil `branch_fee.dart`, `shared/tier_fee.dart`.
  E-posta: `Application/Common/NoticeEmailTemplate.cs` (doğrulama maili görünümü; görsel/SVG yok).
- **Testler:** `PerBranchBillingTests`, `CustomerQuotaTests`, `NoticeEmailTemplateTests`, web `tierFee.test.ts`,
  `branchInvoice.test.ts`, mobil `branch_fee_test.dart`, `tier_fee_test.dart`.
- **Tuzak:** pencere açılırken "varsayılan şube" HER ZAMAN kapalı başlar (veri gelmeden yanlış varsayılan olmasın).

### Paket 12 — Havale / EFT (18 Kas)

- **Kural:** ödeme sayfasında kart ya da havale. Havale seçilince Asist kaydı 7 gün açık kalır; Maydanoz yöneticisi
  "Havale geldi" deyince kayıt yeniden okunur ve kartla ödemedeki bildirim yolu işler.
- **Dosyalar:** `ExternalCheckout.TransferLifetime` + `AwaitTransfer()` (uzatır, kısaltmaz), `ConnectorCheckouts.AwaitTransferAsync`
  (yalnız "pending"), uç `POST /checkouts/{ref}/transfer` (checkouts.write); web kredi kartı `payOnMaydanoz`.
- **Testler:** `MaydanozCheckoutTests` (havale açık tutar, geç bildirim yine işler, süresi geçmiş kayıt reddi).

### Paket 13 — SMS / WhatsApp kredisi ayrı (18 Kas)

- **Kural:** iki ayrı bakiye, ayrı paketler, ayrı birim fiyat; biri diğerinde harcanmaz. Mevcut bakiye WhatsApp'ta kalır,
  SMS 0'dan başlar (canlıda 0 cüzdan vardı); platform kanal başına düzeltebilir.
- **Şema:** `CreditChannel { WhatsApp = 0, Sms = 1 }` (DB'de metin, varsayılan WhatsApp); `tenant_messaging_wallets`
  `Sms*` alanları; paket/satın alma `Channel`; `whatsapp_billing_settings.SmsCreditUnitPriceTry` (migration mevcut
  `CreditUnitPriceTry` ile tohumlar). Cüzdan işlemleri (TopUp/TryReserve/Capture/Refund/Adjust) kanalı ZORUNLU alır.
  Aylık harcama tavanı kanal başına.
- **Geriye uyum:** kanalsız istek = WhatsApp; `SmsCreditUnitPriceTry` / paket `Channel` null = korunur.
- **Dosyalar:** `Domain/Enums/CreditChannel.cs`, `TenantMessagingWallet.cs`, `WhatsAppCreditPackage.cs`,
  `WhatsAppCreditPurchase.cs`, `WhatsAppBillingSettings.cs`, `WhatsAppBillingService.cs`, `WhatsAppBillingDtos.cs`; web
  `WhatsAppWalletCard.tsx` (kanal sekmeleri), `app/platform/whatsapp` (SMS fiyatı, paket kanalı, bakiye düzeltme kartı),
  `panel/bildirimler` (iki bakiye); mobil `whatsapp_screen.dart`.
- **Testler:** `CreditChannelSplitTests`, `MessagingCreditSmsTests`, `BalanceRaceMySqlTests`, `NotificationEstimateTests`.

### Paket 14 — Hesap kredisi bağlayıcısı (18 Kas)

- **Uçlar:** `GET /accounts/{tenantId}/credits` (tenants.read) → `{ whatsApp, sms }` her biri `{ available, unitPriceKurus,
  packages[] }`; `POST /accounts/{tenantId}/credit-checkout` (checkouts.write) `{ channel, packageId | credits, returnUrl }`
  → ödeme kaydı. İptal/askıdaki kurum NotFound.
- **Dosya:** `Api/Services/ConnectorAccountService.cs` (ctor'a `IWhatsAppBillingService`). **Test:** `ConnectorAccountServiceTests`.

### Paket 15 — Otomatik ödeme hazırlığı (18 Kas)

- **Kural:** otomatik ödeme Maydanoz'da kayıtlı kart talimatıyla yapılır; Asist hiçbir şey çekmez.
- **Değişiklik:** `GET /checkouts/{ref}` yanıtına `period` (yalnız abonelik DÖNEMİ ödemesinde monthly | yearly; şube/kademe
  farkı, kredi, fatura boş). `BillingService.ChargeRenewalAsync` sağlayıcı Maydanoz ise satır yazmadan döner.
- **Test:** `MaydanozCheckoutTests` (dönem, eski kart satırıyla bile çekim yok).

### Paket 16 — Şube silme (18 Kas)

- **Kural:** kayıtlar SİLİNMEZ; seçilen şubeye aktarılır; şube yumuşak silinir; fiyat silinmemiş şubelerden hesaplandığı
  için sonraki ödemede düşer (ödenmiş dönem iade edilmez). Varsayılan ve tek şube silinemez.
- **Dosyalar:** `Infrastructure/Persistence/BranchMerge.cs` (BranchId kolonu olan HER tablo EF modelinden; yumuşak
  silinmişler dahil; `audit_logs` hariç; MySQL'de ham SQL, InMemory'de izleyici), `BranchService.DeletePreviewAsync/
  DeleteAsync`, `BillingService.GetBranchRemovalImpactAsync` (`BranchImpactDto.CurrentYearly`), uçlar
  `GET /api/admin/branches/{id}/delete-preview`, `DELETE /api/admin/branches/{id}?targetBranchId=` (BranchWrite); web
  `BranchDeleteModal.tsx`, `lib/branchRemoval.ts`; mobil `showBranchDeleteSheet` (iOS'ta fiyat yok).
- **Testler:** `BranchDeleteTests` (+ gerçek MySQL `BranchDeleteMySqlTests`), web `branchRemoval.test.ts`, mobil
  `branch_removal_test.dart`.
- **Tuzak:** seçili şube silinirse istemci hedef şubeye geçer; oturum yenilenene kadar personel boş liste görebilir.

### Paket 17 — Kalıcı kurum silme bağlayıcısı (18 Kas)

- **Uç:** `POST /api/connector/v1/tenants/{id}/purge` (`tenants.delete`), gövde `{ confirmName }` = kurum adı AYNEN; silme
  platform panelindeki "Kalıcı sil" ile aynı yoldan (`TenantService.DeleteAsync` → `TenantPurge`, tek transaction, model
  türetimli tablo listesi, `audit_logs` korunur).
- **Dosyalar:** `Api/Services/ConnectorTenantPurge.cs`, `TenantPurge.cs` (InMemory yolu sayım döner ve
  `HardDeleteEnabled` ile gerçekten siler). **Test:** `ConnectorTenantPurgeTests`.
- **Bilinçli karar:** ayar köprüsüne (`platform.manage`) kurum listesi/silme EKLENMEDİ; yıkıcı yetki ayrı kapsamla verilir.

### Paket 18 — Maydanoz'a oturumlu geçiş + kredi yalnız kurum yetkilisi (18 Kas)

- **Sorun:** panelde "Satın al" Maydanoz ödeme sayfasını açıyordu; tarayıcıda Maydanoz oturumu yoksa form BOŞ geliyordu
  ve ödeme kimin hesabına yapıldığı belirsizdi.
- **Kural (iki taraf):**
  - Maydanoz ödemeyi YALNIZ kaydın kurumuna ait Hesabım oturumuyla açar (kart, havale, havale iptali; Maydanoz sunucusu
    zorlar). Oturum yoksa giriş kapısı (girişten sonra ödemeye dönülür); başka kurumun oturumunda uyarı + çıkış.
  - Panel, Maydanoz'a yönlendirirken **kurum yetkilisine** tek kullanımlık geçiş jetonu ekler:
    `https://maydanozasist.com/odeme/asist/beauty/<ref>#giris=<jeton>`. Jeton adresin PARÇA kısmında (sunucu günlüklerine
    ve Referer'a girmez); 32 rastgele bayt base64url (43 karakter); DB'de YALNIZ SHA-256 hex; kurum + kullanıcı + ödeme
    kaydına bağlı; ömür 10 dk; tek kullanımlık. Personel, şube müdürü ve platform yöneticisi jeton ALMAZ.
  - Maydanoz jetonu `POST /api/connector/v1/accounts/handoff` (checkouts.write) `{ token }` ile bozdurur → `{ tenantId,
    userId, email, fullName, tenantName, tenantCode, reference }`; `reference` sayfadaki kayıtla aynı olmalı; Maydanoz 2
    saatlik oturum açar. Bozdururken Asist kimliği DB'den YENİDEN doğrular: kullanıcı hâlâ etkin kurum yetkilisi, aynı
    kurum, kurum iptal / askıda değil.
  - Maydanoz ödeme yolundayken mesaj kredisi alımı YALNIZ kurum yetkilisine (öteki rollere 403 "Mesaj kredisi kurum
    yetkilisinin hesabıyla maydanozasist.com'dan alınır…"; web ve mobilde satın alma yerine bu not). Diğer sağlayıcılarda
    (iyzico doğrudan, simülasyon) eski davranış sürer. Kural YALNIZ panelde oturum açmış kullanıcıya uygulanır
    (`_currentUser.IsAuthenticated`): Maydanoz Hesabım'ın kredi alımı bağlayıcıdan (`accounts/{id}/credit-checkout`)
    kullanıcısız gelir ve takılmamalı — kuralın ilk hâli (`777b04e`) bu yolu 403 ile kesiyordu.
- **Şema:** `maydanoz_handoffs` (Id, TokenHash varchar(64) UNIQUE, TenantId, UserId, CheckoutRef varchar(32),
  CreatedAtUtc, ExpiresAtUtc INDEX, ConsumedAtUtc). Migration `20261118201808_MaydanozHandoffs`. Bir günden eski satırlar
  her yeni jetonda ham SQL `DELETE … LIMIT 200` ile silinir (kurum silmede de model türetimli listeyle gider).
- **Dosyalar:**
  - `Domain/Entities/MaydanozHandoff.cs` (`Lifetime` 10 dk, `TryConsume`); `GuzellikDbContext` (DbSet + yapılandırma).
  - `Api/Services/MaydanozHandoffService.cs`: `AttachAsync(started, user, tenantId)` ödeme başlatan ucun sonucuna jeton
    ekler — yalnız başarı + yönlendirme adresi + adres `Payments:Maydanoz:SiteUrl` köküyle aynı şema/köken ve sorgusuz /
    parçasız `/odeme/asist/<asist>/<32 hex>` (`ReferenceOf`) + kayıt bu kurumun + kullanıcı etkin kurum yetkilisi (Id ya da
    e-postayla; çoklu kurum yetkilisi e-postayla eşlenir, `TenantTextHelper.NormalizeEmail`).
  - Sarılan uçlar: `BillingEndpoints` (`POST /checkout`, `POST /invoices/{id}/pay`), `WhatsAppEndpoints`
    (`POST /wallet/checkout`) → `(await handoffs.AttachAsync(await svc.X(...), cu, t, ct)).ToHttpResult(http)`;
    `Program.cs` `AddScoped<MaydanozHandoffService>()`.
  - `Api/Services/ConnectorAccountService.cs` `HandoffAsync` + `ConnectorEndpoints` (`accounts/handoff`, checkouts.write).
  - `WhatsAppBillingService.StartCreditCheckoutAsync`: ağ geçidi `MaydanozPaymentGateway` ise yetkili kontrolü.
  - Web `components/dashboard/WhatsAppWalletCard.tsx` (yetkili değilse not; dipnot "sayfa giriş yapılmış açılır");
    mobil `features/whatsapp/whatsapp_screen.dart` (`_canBuy`).
- **Tek kullanım:** MySQL'de koşullu ham SQL `UPDATE maydanoz_handoffs SET ConsumedAtUtc=@now WHERE Id=@id AND
  ConsumedAtUtc IS NULL AND ExpiresAtUtc > @now` (etkilenen satır 1 değilse "süresi doldu"); InMemory'de `TryConsume`.
  Eşzamanlı iki bozdurmadan yalnız biri kazanır (MySQL testiyle kanıtlı).
- **Testler:** `MaydanozHandoffTests` (yetkiliye jeton + tek kullanım; öteki roller / siteler / kurumlar / başarısız
  sonuçta jeton yok + `ReferenceOf`; çoklu kurum yetkilisi; bozdurmada bozuk / bilinmeyen / süresi dolmuş / yetkili olmayan
  / askıdaki kurum reddi), `MaydanozHandoffMySqlTests` (gerçek MySQL: eşzamanlı tek kazanan, süresi geçmiş tüketilmez, eski
  satır temizliği), `MaydanozCheckoutTests.CreditCheckout_OnMaydanoz_IsForTheInstitutionOwnerOnly` ve
  `CreditCheckout_FromMaydanozAccountConnector_IsNotBlockedByThePanelOwnerRule` (GERÇEK kredi servisiyle bağlayıcı yolu).
- **Tuzaklar:** jeton SORGU dizgisine konmaz; jeton yalnız kurum yetkilisine (Maydanoz Hesabım'ı yalnız yetkilinin
  hesabıdır); yeni bir ödeme başlatan uç eklenirse o da `AttachAsync` ile sarılmalı (yoksa form yine boş gelir); servis
  katmanına rol kuralı koyarken bağlayıcı yolunu unutma — bağlayıcı isteği kullanıcısızdır (rol boş) ve bağlayıcı testleri
  servisleri taklit ettiği için böyle bir gerileme yalnız gerçek servisle yazılmış testte görünür.
- **Canlı:** migration elle (`--migrate-only`); env değişikliği yok (`checkouts.write` zaten var). Önce Asist, sonra
  Maydanoz: eski Maydanoz `#giris` parçasını yok sayar; ters sırada yeni Maydanoz, panelden gelen kurumdan elle giriş ister.

### Paket 19 — Köprü 2. dilim: destek, kurum profili, veritabanı izleme, aylık değer (19 Kas)

- **Kullanıcının sözleri:** "BeautyAsist'in destek kısmına gelen mesajları Maydanoz'un admin panelinde destek kısmına çek
  — çok önemli"; "müşteriler sayfasında ilgili Asist'e göre veri çek, kurum adını tıklayınca düzenleme yapılabilsin";
  "veritabanları kısmı dinamik olsun — gerçek DB olacak, SQLite değil"; "aylık değeri BeautyAsist göndersin".
- **Köprü izin listesi** (`PlatformBridgeMiddleware.Allowed`, Maydanoz `AsistPlatformService`'teki liste DEĞİL —
  Maydanoz bu uçları kendi türlü istemcisiyle çağırır, `AsistBridge`):
  - `GET /support` (sorgu: `scope`, `search`, `page`, `pageSize`), `GET /support/summary`, `GET /support/{id}`,
    `POST /support/{id}/reply`, `PUT /support/{id}` (durum/öncelik; `assignedToUserId` null = dokunma).
  - `GET /tenants` (`page`, `pageSize` ≤ 1000), `GET /tenants/{id}`, `PUT /tenants/{id}/profile` — YENİ uç,
    `UpdateTenantProfileRequest` (paket/dönem/durum alanı YOK). Tam güncelleme (`PUT /tenants/{id}`) köprüde KAPALI:
    dönemsiz istek denemeyi sıfırlayabiliyor.
  - `GET /system/database` ve `GET /system/database/schema` — YENİ uçlar, `IDatabaseMonitor` (`DatabaseMonitor`).
- **Veritabanı izleme (`Infrastructure/Services/DatabaseMonitor.cs`):** SALT OKUNUR, satır verisi YOK. Sürüm,
  `SHOW GLOBAL STATUS` birikimli sayaçları (oranı okuyan taraf iki ölçümün farkından hesaplar), `@@max_connections`,
  `information_schema` tablo boyutları (`UPDATE_TIME` sunucu yerel saatinden UTC'ye), performance_schema tablo G/Ç'si
  (yetki yoksa null), şema (kolon/indeks/dış anahtar/`SHOW CREATE TABLE`), `/proc` sunucu yükü, yedek klasörlerinden
  YALNIZ dosya adı/zamanı/boyutu (`DatabaseMonitor:BackupDirectories`, varsayılan gece yedeği + `../backups`).
  MySQL 8'de `information_schema_stats_expiry` oturumda 0 yapılır (MariaDB'de değişken yok, hata yutulur).
- **Aylık değer:** `ConnectorTenantDto` → `monthlyNetTRY`, `monthlyGrossTRY`, `periodGrossTRY` —
  `SubscriptionPricing.MonthlyEquivalent(plan, period, counts)` (platform MRR'ıyla aynı motor; yıllıkta ÷ 12; fiyatlı
  paketi olmayan kurumda null). Sayaçlar `BillingCountsQuery.CountManyAsync` ile tek turda.
- **Testler:** `PlatformBridgeTests.SupportTenantAndDatabaseRoutes_PassThrough` (Türkçe harfli sorgu dizesi aynen),
  izin listesi reddleri (tam güncelleme, silme, kurum erişimi), `ConnectorQueriesTests` (alan listesi + aylık değer),
  `DatabaseMonitorMySqlTests` (GERÇEK MySQL: sayaçlar, tablolar, şema, yedek klasörü; bellek içi sağlayıcıda "ölçülmedi").
- **Tuzaklar:** yeni bağlayıcı alanı eklerken `ConnectorQueriesTests`'teki alan listesi bilerek kırılır (kişisel veri
  sızmasın); yedek klasörü root'a aitse (700) uygulama listeleyemez → ekran "okunamıyor" der, uydurmaz.
- **Canlı:** yalnız backend (`9322454`, migration ve env değişikliği yok; `platform.manage` kapsamı yeterli).

### Paket 20 — WhatsApp yanıtları Chatwoot köprüsüyle (20 Kas)

- **Kullanıcının kararı:** müşteri yanıtları "chatwoot tan okuyacak şekilde yapalım". Meta webhook'u canlı destek için
  Chatwoot'ta kalır; BeautyAsist yanıtları Chatwoot'un hesap webhook'undan (`message_created`) okur.
- **Kural:** Chatwoot olayı, Meta'dan gelmiş gibi AYNI yoldan işlenir (`WhatsAppService.ProcessInboundMessageAsync`):
  tekilleştirme, 24 saat penceresi ve niyet (EVET/HAYIR/ERTELE, KVKK ONAYLIYORUM, bekleme EVET) aynıdır.
  - Kurum, gelen kutusu kimliğinden bulunur. Sıra: `inbox.id` → `conversation.inbox_id` → `inbox_id`, eşleşme
    `WhatsAppSettings.ChatwootInboxId` ile yapılır.
  - Telefon önce `conversation.contact_inbox.source_id` alanından (wa_id) okunur, yoksa `sender.phone_number` alanından.
  - Tekilleştirme anahtarı `source_id` (wamid), yoksa `cw:{id}`. Meta webhook'u ileride BeautyAsist'e de gelirse aynı
    yanıt iki kez işlenmez.
  - Yalnız `message_created` + gelen (`incoming`/0) + özel değil + metin + `Channel::Whatsapp` işlenir. Gerisi 200 alır,
    yok sayılır.
- **Kimlik (iki yol, aynı platform anahtarı):** `POST /api/whatsapp/chatwoot` için `X-Chatwoot-Signature` =
  `sha256=` + HMAC-SHA256(anahtar, `"{X-Chatwoot-Timestamp}.{ham gövde}"`), damga en çok 5 dk. İmzasız Chatwoot
  sürümü için `POST /api/whatsapp/chatwoot/{anahtar}` (sabit zamanlı karşılaştırma). Anahtar yoksa fail-closed.
  Yanıt kodları: 401 kimlik yok; 200 işlendi ya da yok sayıldı; 413 gövde 256 KB üstü.
- **Şema:** migration `20261119212259_ChatwootBridge`. `whatsapp_settings.ChatwootInboxId` (int null) ve
  `platform_integration_settings.ChatwootWebhookSecretEncrypted` (longtext, AES-GCM şifreli).
- **Ayar kuralları:**
  - Anahtar yalnız yazılır; DTO yalnız `HasChatwootWebhookSecret` döner. Boş kayıt mevcut anahtarı KORUR, böylece
    Maydanoz köprüsünün tam değiştirmeli kaydı anahtarı silemez.
  - Bağlama isteğinde `ChatwootInboxId`: null = koru, 0 = kaldır. Başka kurumdaki gelen kutusu 409 Conflict döner.
  - Web'deki "Üret" düğmesi `crypto.getRandomValues` ile 32 bayt base64url anahtar üretir.
- **Dosyalar:**
  - `Infrastructure/Services/ChatwootWebhook.cs` (saf `IsAuthorized` + `Parse`)
  - `WhatsAppService.HandleChatwootInboundAsync`, `IWhatsAppService`
  - `WhatsAppEndpoints.cs` (`ReadLimitedBodyAsync` Meta ucuyla ortak)
  - `WhatsAppSettings.SetChatwootInbox`, `PlatformIntegrationSettings.UpdateChatwootBridge`
  - DTO'lar, `PlatformMessagingService`
  - Web: `app/platform/whatsapp/page.tsx` (bağlama penceresi), `components/platform/PlatformMessagingSettings.tsx`,
    `lib/types.ts`
  - Mobil: değişiklik yok. Platform anahtarları ve bağlantı bağlama mobilde zaten yok (App Secret gibi).
- **Testler:** `ChatwootBridgeTests` (24).
  - İmza, damga ve adres anahtarı; ayrıştırma çeşitleri.
  - GERÇEK MySQL: EVET randevuyu onaylar; tekrar teslim bir kez işlenir; KVKK ONAYLIYORUM; adres anahtarı yolu;
    kimliksiz istek ve anahtarsız kurulum hiçbir satır yazmaz; bilinmeyen gelen kutusu yok sayılır; bağlama
    koru/kaldır/çakışma.
  - Anahtar yalnız yazılır.
- **Tuzak — teslim durumu gelmez:** BeautyAsist'in gönderdiği mesajların `delivered/read/failed` bildirimleri Chatwoot'ta
  kalır. Kontörden düşülen mesajlar `SweepStaleReservationsAsync` ile 48 saatte iade edilir, yani kurum fiilen ödemez.
  Karar bekliyor (`WHATSAPP_AKTIVASYON.md` §8.2): (A) numaraya Meta webhook override + BeautyAsist'ten Chatwoot'a ham
  iletim, ya da (B) Chatwoot modunda Meta'nın kabul ettiği mesaj kesin ücretlenir.
- **Canlı:** backend + web, migration elle (önce yedek). Sonra Chatwoot webhook'u açılır, anahtar BeautyAsist'e girilir
  ve gelen kutusu kuruma bağlanır.

### Ürüne göre değişenler (aktarmadan önce)

- Maydanoz'daki Asist kodu (`beauty` → ör. `doctor`, `dentist`): ödeme sayfası adresi (`MaydanozPaymentGateway.AsistCode`),
  web `/kayit` yönlendirmesi, giriş sayfası metni.
- Bağlayıcı anahtar kimliği ve kapsamları (env), `Payments__Maydanoz__SiteUrl`.
- Fiyatlar, kademeler, kredi birim fiyatları (ürün sahibine teyit ettir).
- E-posta ve arayüz metinlerinde "salon/müşteri" kelimeleri (ünlü uyumu; DentistAsist'te "klinik/hasta").

### Canlıya çıkış (Asist tarafı)

DB yedeği → (yedekten prova DB'de `--migrate-only`) → canlı `--migrate-only` → backend çevir + `/health/ready` (olmazsa
geri) → web sunucuda derlenir, `.next/cache/fetch-cache` boşaltılır, çevrilir → env: `Connector__Keys__maydanoz__Scopes`
gereken kapsamları içermeli (`plans.read tenants.read checkouts.read checkouts.write platform.manage tenants.delete`).
Mobil (Android/iOS) mağaza yayını ayrıca kullanıcı tarafından yapılır.
