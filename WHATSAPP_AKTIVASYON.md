# WhatsApp Altyapısı — Canlıya Alma Listesi

> 31 Ağu 2026. Kod tarafı büyük ölçüde hazır; sistem şu an **simülasyon** modunda çalışıyor.
> Bu dosya "aktif etmek için ne lazım" sorusunun tam cevabıdır. Meta onayları **gün** sürdüğü için
> 2. bölümü hemen başlatın, 4. ve 5. bölüm paralel ilerleyebilir.

---

## 0. Şu an neden "aktif değil"?

Gönderim yolu `WhatsAppService.ResolveSendContextAsync` (`backend/src/GuzellikMerkezi.Infrastructure/Services/WhatsAppService.cs:572`)
üzerinden geçiyor. Bu metot **canlı bağlantı bulamazsa** `Offline` dönüyor ve `DispatchAsync`
simülasyona düşüyor: log satırı yazılır, `sim-xxxx` sahte mesaj id'si üretilir, **müşteriye hiçbir şey gitmez**
(`WhatsAppService.cs:723-729`). Ekranda "gönderildi" görünür — bu yüzden sorun sessizdir.

Canlı olmak için aşağıdaki **7 halkanın hepsi** gerekli. Her biri tek tek doğrulanabilir:

| # | Halka | Nerede | Kırıksa ne olur |
|---|-------|--------|-----------------|
| 1 | `PlatformIntegrationSettings.WhatsAppEnabled = true` **ve** sistem token'ı kayıtlı | Platform → Sistem Ayarları → Mesajlaşma | Her kurum sessizce simülasyona düşer |
| 2 | Kurumun `WhatsAppSettings.ConnectionStatus = Connected` + `PhoneNumberId` dolu | Platform → WhatsApp → Bağlantılar | O kurum simülasyonda kalır |
| 3 | Kurumun paketinde `notifications.whatsapp` özelliği açık | Platform → Paketler | Gönderim 409 ile reddedilir ("paketinizde yok") |
| 4 | `WhatsAppBillingService.ReserveAsync` izin veriyor (kota/kontör/tavan) | Kurum → Ayarlar → WhatsApp + Kontör | Gönderim engellenir, sebep kullanıcıya yazılır |
| 5 | App Secret tanımlı (platform ayarı **veya** `WhatsApp__AppSecret`) | Platform → Sistem Ayarları / env | Webhook **fail-closed**: gelen yanıt işlenmez, `delivered` gelmez → 48 saatte tüm rezervasyonlar iade edilir |
| 6 | Verify token Meta'daki `hub.verify_token` ile birebir aynı | Platform → Sistem Ayarları | Meta webhook'u hiç kaydedemez (403) |
| 7 | `WhatsApp:PublicBaseUrl` public HTTPS adres | env / appsettings | Panelde gösterilen webhook adresi `localhost` çıkar |

---

## 1. ÖNCE KARAR: numara kimin Business Manager'ında olacak?

Sistem **Tech Provider modeline** göre yazılmış: **tek** platform sistem token'ı, **her kurumun kendi**
`phone_number_id`'si ile gönderim yapar (`ResolveSendContextAsync`: önce kuruma özel token, yoksa platform token'ı).

Bu şu demek: **salonun WhatsApp numarası bizim Business Manager'ımızın altında olmalı.**

İki seçenek var, biri seçilmeden Meta'da tıklamaya başlamayın:

- **(A) Önerilen — bizim BM'imiz:** salonun numarası bizim Business Manager'a eklenir/taşınır. Tek token,
  tek fatura, tek App Secret. Kurum hiçbir teknik ayar görmez.
- **(B) Kurumun kendi WABA'sı varsa:** Platform → WhatsApp → Bağlantılar ekranındaki **"Kuruma özel token"**
  alanına o kurumun kendi kalıcı token'ı girilir (`AccessTokenOverride`). Fatura o kuruma gider,
  webhook yine bizim adresimize bağlanmalı (App Secret o kurumun App'inden gelir → **aynı sunucuda iki farklı
  App Secret'i doğrulayamayız**, bu yüzden karma model önerilmez).

> Aynı `phone_number_id` iki kuruma bağlanamaz — webhook'ta tenant çözümü buna dayanır (`WhatsAppService.cs:158-163`).

---

## 2. Meta tarafı (sizin yapacaklarınız — en uzun süren kısım)

Sırasıyla:

1. **Meta Business Manager** hesabı + **iş doğrulaması (Business Verification)** — vergi levhası/ticaret sicil
   belgesi ile. Onaylanmadan günlük gönderim limiti çok düşük kalır.
2. **WhatsApp Business Account (WABA)** oluştur.
3. **Numara ekle.** Kritik: o numara **kişisel WhatsApp'ta kayıtlı olmamalı** (varsa önce hesabı silin, 24-48 saat bekleyin).
   Doğrulama SMS/arama ile yapılır.
4. **Display name (görünen işletme adı) onayı** — Meta ayrıca onaylar, reddedilirse mesaj gönderilemez.
5. **Meta App** oluştur → WhatsApp ürününü ekle → **App'i "Live" moda al** (Development modda yalnızca test
   numaralarına gider).
6. **System User + kalıcı token:** Business Settings → Users → System Users → yeni sistem kullanıcısı →
   **Generate Token**, izinler: `whatsapp_business_messaging` + `whatsapp_business_management`.
   ⚠️ Geçici (24 saatlik) test token'ı **kullanmayın**, gece yarısı gönderim durur.
7. **App Secret:** App Dashboard → Settings → Basic → App Secret.
8. **Webhook:** App Dashboard → WhatsApp → Configuration →
   - Callback URL: `https://<panel-domaini>/api/whatsapp/webhook`
   - Verify Token: kendi belirlediğiniz gizli dizi (panele de aynısı girilecek)
   - **Abone olunacak alanlar: `messages` (zorunlu) + `message_template_status_update` (önerilir)**
   - `messages` alanı işaretlenmezse: müşteri "EVET/İPTAL" yazdığında hiçbir şey olmaz **ve** teslim
     bildirimi gelmediği için rezerve kontör 48 saatte iade edilir.
9. **Şablonları oluştur** (bkz. bölüm 3) — onay 1 saat ile 2 gün arası sürer.

### Bana/panele girilecek bilgiler (bunları toplayın)

| Bilgi | Nereden | Nereye girilecek |
|-------|---------|------------------|
| `PHONE_NUMBER_ID` | WhatsApp → API Setup | Platform → WhatsApp → Bağlantılar (kurum bazlı) |
| `WABA_ID` | WhatsApp → API Setup | Aynı ekran |
| Görünen numara (+90…) | — | Aynı ekran (yalnız gösterim) |
| Kalıcı **Access Token** | System User | Platform → Sistem Ayarları → Mesajlaşma → WhatsApp |
| **App Secret** | App Settings → Basic | Aynı ekran |
| **Verify Token** | siz belirlersiniz | Aynı ekran + Meta webhook formu |

---

## 3. Şablon sözleşmesi (parametre SIRASI şart)

Meta kuralı: **müşteri son 24 saat içinde size yazmadıysa serbest metin iletilmez**, yalnızca önceden
onaylanmış şablon geçer. Gerçek hayatta giden mesajların neredeyse tamamı bu durumdadır — yani
**şablonlar olmadan sistem canlıda çalışmaz.**

Şablonları Meta panelinde oluştururken gövdedeki `{{n}}` sırası aşağıdakiyle **birebir** aynı olmalı;
farklı parametre sayısıyla onaylanan şablon gönderimde hata verir.

| Amaç | Şablon adı (öneri) | Kategori | Parametreler | Bugün kodda bağlı mı? |
|------|--------------------|----------|--------------|------------------------|
| KVKK açık rıza | `kvkk_consent` | Utility | `{{1}}`=ad, `{{2}}`=kurum, `{{3}}`=metin linki | ✅ Evet (`KvkkTemplateName`) |
| **Randevu hatırlatma** | `randevu_hatirlatma` | Utility | `{{1}}`=ad, `{{2}}`=tarih, `{{3}}`=saat, `{{4}}`=hizmet, `{{5}}`=kurum | ✅ Evet (`ReminderTemplateName` — 31 Ağu 2026'da bağlandı) |
| Bekleme listesi teklifi | `bekleme_teklif` | Utility | `{{1}}`=ad, `{{2}}`=tarih, `{{3}}`=saat, `{{4}}`=hizmet, `{{5}}`=kurum | ✅ Evet (`WaitlistOfferTemplateName`) |
| Bekleme → randevu açıldı | `bekleme_onay` | Utility | aynı | ✅ Evet (`WaitlistActivatedTemplateName`) |
| Değerlendirme linki | `degerlendirme` | Utility | `{{1}}`=ad, `{{2}}`=kurum, `{{3}}`=link | ✅ Evet (`RatingTemplateName`) |
| Hediye kartı (PDF ekli) | `hediye_karti` | **Marketing** | `{{1}}`=ad, `{{2}}`=kurum + **document header** | ❌ Hayır (pencere kapalıysa bilerek engelleniyor) |

> **Boş parametre göndermeyin.** Meta boş `{{n}}` değerini, satır sonu/sekme içeren değeri ve 4'ten fazla
> ardışık boşluğu reddeder. Kod tarafında `TemplateParam` yardımcısı boşlukları teke indirip boş değerleri
> yer tutucuyla dolduruyor — yine de şablon metnini buna göre kurun.

⚠️ **Şablonda "Hızlı Yanıt (Quick Reply)" düğmesi KULLANMAYIN.** Webhook yalnızca `type == "text"` mesajlarını
işliyor (`WhatsAppService.cs:829-830`); düğmeye basınca gelen `button` tipi yanıt **hiç işlenmez**, randevu
onaylanmaz. Müşteriden "EVET / HAYIR / ERTELE" yazmasını isteyen düz metin şablonu kullanın
(veya bkz. Eksik C).

---

## 4. Panel + ortam ayarları (sırayla, her adım doğrulanabilir)

### 4.1 Ortam değişkenleri (canlı sunucu)

```
WhatsApp__AppSecret        = <Meta App Secret>            # panelden de girilebilir; ikisinden biri ŞART
WhatsApp__PublicBaseUrl    = https://<api-domaini>        # webhook adresi buradan üretilir
App__PublicBaseUrl         = https://<panel-domaini>      # KVKK mesajındaki "metnin tamamı" linki
Frontend__PublicBaseUrl    = https://<panel-domaini>      # değerlendirme (yıldız) linki
```

Tanımsızsa: App Secret yoksa webhook **hiçbir isteği işlemez**; `App__PublicBaseUrl` yoksa KVKK mesajına link
konmaz (PDF yine gider); `WhatsApp__PublicBaseUrl` yoksa panelde `http://localhost:5019/...` gösterilir.

### 4.2 Platform → Sistem Ayarları → Mesajlaşma Altyapısı → WhatsApp

- [ ] **Aktif** anahtarını aç
- [ ] Access Token (sistem kullanıcısı, kalıcı)
- [ ] Platform Phone Number ID (OTP/2FA mesajları buradan gider)
- [ ] WABA ID
- [ ] App Secret
- [ ] Webhook Verify Token
- [ ] **Test WhatsApp** düğmesiyle kendi numaranıza deneme gönderin

### 4.3 Platform → WhatsApp → Bağlantılar (her kurum için)

- [ ] Kurumu seç → `phone_number_id`, WABA id, görünen numara gir
- [ ] Durum: **Bağlı (Connected)** — `Enabled` bu seçimden türetilir, ayrıca bir yerde açmanız gerekmez
- [ ] Aynı ekrandaki **Bağlantı testi** ile gerçek numaraya deneme at (aşağıdaki uyarıya dikkat)

### 4.4 Platform → Paketler

- [ ] Kurumun paketinde **`notifications.whatsapp`** özelliği işaretli olmalı
- [ ] `MaxMonthlyWhatsAppUtility` — boş bırakılırsa **500/ay** varsayılan uygulanır (hatırlatma/KVKK bu kovadan)
- [ ] `MaxMonthlyWhatsAppMarketing` — **varsayılan 0**. Hediye kartı Marketing kategorisindedir;
      bu kota 0 iken kurum ayrıca **"Kampanya mesajları"nı açmalı + kontör yüklemeli**, yoksa gönderim engellenir.
      (Bu, canlıda kesin gelecek "neden hediye kartı gitmiyor" sorusunun cevabıdır.)

### 4.5 Kurum → Ayarlar → WhatsApp (kurum yöneticisi)

- [ ] Hatırlatma şablon **metni** (serbest metin, 24 saat penceresi açıkken kullanılır)
- [ ] Meta'da onaylanan **şablon adları** + dil kodu (`tr`)
- [ ] Kampanya mesajları (Marketing) — hediye kartı gönderilecekse **açık**
- [ ] Kontör taşması + aylık harcama tavanı (₺) — sürpriz fatura freni

---

## 5. Kod tarafında eksikler

### ✅ Eksik A — ÇÖZÜLDÜ (31 Ağu 2026): randevu hatırlatması artık onaylı şablon kullanıyor

**Sorun neydi:** `SendReminderAsync` → `DispatchAsync(...)` çağrısı `templateFallback` vermiyordu.
`WhatsAppSettings.ReminderTemplateName` alanı veritabanında vardı, kurum ayarları ekranında
düzenlenebiliyordu (`WhatsAppSettingsCard.tsx:197`), ama **gönderim yolunda hiçbir yerde okunmuyordu** —
yalnız kaydedilip DTO'da geri dönüyordu. Sonuç: 24 saat penceresi kapalıyken hatırlatma serbest metin
olarak gidiyor, Meta `131047 Re-engagement message` ile reddediyordu.

**Yapılan** (`WhatsAppService.SendReminderAsync`):
- Pencere kapalıysa `ReminderTemplateName` + `TemplateLanguageCode` ile onaylı şablona geçiliyor;
  parametreler bölüm 3'teki sırayla (ad / tarih / saat / hizmet / kurum) gönderiliyor.
- Şablon **tanımlı değilken** pencere kapalıysa gönderim, Meta'nın ham hata metni yerine anlaşılır bir
  sebeple engelleniyor (`requireTemplateOutsideWindow: true`) — kontör de boşuna rezerve edilmiyor.
- Yeni `TemplateParam` yardımcısı: satır sonu/sekme temizliği, ardışık boşluk sadeleştirmesi, boş
  parametre yerine yer tutucu. KVKK şablonundaki link parametresine de uygulandı
  (`App:PublicBaseUrl` tanımsızken boş parametre gidiyordu → Meta reddederdi).
- **Web "Hatırlat" düğmesi artık sunucunun SEBEBİNİ gösteriyor** (`AppointmentReminderControl.tsx`):
  önceden her hata genel "Gönderilemedi"ye yuvarlanıyordu; kurulum sırasında kullanıcının çözebileceği
  tek bilgi (şablon yok / kota doldu / kontör yetersiz) ekrana hiç ulaşmıyordu. Mobil zaten sebebi
  gösteriyordu — parite sağlandı.

Backend derleniyor (0 hata), WhatsApp testleri **14/14 geçiyor**, frontend `typecheck` temiz.

### ✅ Eksik A2 — ÇÖZÜLDÜ (31 Ağu 2026): bekleme listesi + değerlendirme şablonları

`waitlist-offer`, `waitlist-activated`, `rating-link` yolları da artık pencere kapalıyken onaylı
şablona geçiyor. `WhatsAppSettings`'e üç alan eklendi (`WaitlistOfferTemplateName`,
`WaitlistActivatedTemplateName`, `RatingTemplateName`), kurum ayarları ekranına (web + mobil) girildi.

⚠️ **Migration `20260831064756_WhatsAppWaitlistRatingTemplates` canlıda UYGULANMALI** —
`whatsapp_settings` tablosuna üç nullable `varchar(128)` kolonu ekler, mevcut veriyi değiştirmez.
Uygulanmazsa WhatsApp ayarları uçları eksik kolon nedeniyle **500** verir.

Bu üç yolda gönderim, şablon tanımlı değilken **bilerek engellenmez**: denenir, Meta reddederse mesaj
listesinde sebebiyle birlikte **Başarısız** satırı kalır ve kalıcı iş kuyruğu dead-letter'a düşürür.
(Hatırlatmada tersi tercih edildi: kullanıcı ekranda beklediği için anlaşılır sebeple engellenir.)

### ✅ Eksik B — ÇÖZÜLDÜ (31 Ağu 2026): otomatik randevu hatırlatması gerçekten gidiyor

**Sorun neydi:** `NotificationService` gönderim switch'inde yalnız SMS ve e-posta gerçekten
gönderiliyordu; WhatsApp kanalı `default` dalına düşüp **gönderilmeden "gönderildi" sayılıyordu**.
Kanalı WhatsApp seçip otomatik hatırlatma kuran kurum, geçmişte "Gönderildi" görüyor, müşteriye hiçbir
şey ulaşmıyordu.

**Yapılan:**
- `NotificationDispatchBackgroundService`: kanalı WhatsApp olan **randevu hatırlatma** şablonu varsa,
  yaklaşan randevular (24 saat, `LastReminderAtUtc == null`, durumu Planlandı/Onaylandı) `SendReminderAsync`
  ile gönderilir. Böylece onaylı şablon, kontör rezervasyonu **ve 2 yönlü onay akışı** (müşteri EVET
  yazınca randevu onaylanır) otomatik hatırlatmada da çalışır. Tekilleştirme `LastReminderAtUtc` ile;
  tek taramada en fazla 100 mesaj.
- `IWhatsAppService.SendNotificationAsync`: diğer tetikleyiciler (doğum günü, ödeme, geri kazanım,
  seans yenileme, elle kampanya) artık gerçekten WhatsApp'tan gider. **Kategori otomatik**: hatırlatma ve
  ödeme = Utility; kalanlar = Marketing (kurumun "Kampanya mesajları" iznini ve kontörünü gerektirir).
  Bunlar serbest metindir — 24 saat penceresi kapalıysa Meta reddeder ve sebep bildirim geçmişine yazılır.
- **Simülasyon artık "gönderildi" sayılmaz** (SMS/e-posta ile aynı kural).

### ✅ Eksik C2 — ÇÖZÜLDÜ (31 Ağu 2026): iki eşzamanlılık açığı (denetim bulgusu)

Denetim, canlıya geçmeden iki KRİTİK yarış koşulu buldu; ikisi de kapatıldı ve gerçek veritabanı
testleriyle doğrulandı (düzeltme devre dışı bırakılınca testler kırmızıya döndü — kanıtlandı).

**1. Zamanlayıcı mükerrer hatırlatma.** Arka plan taraması randevuları `LastReminderAtUtc IS NULL`
ile seçip damgayı gönderim BAŞARILI olduktan SONRA vuruyordu. İki API örneği (ya da iki tarama turu)
aynı randevuyu aynı anda "damgasız" görüp ikisi de gönderiyordu → müşteriye çift mesaj, kontör iki
kez rezerve. `DispatchAsync` içindeki "önceki deneme sürüyor mu?" kontrolü SELECT+INSERT olduğu için
bu yarışı kapatmıyordu.
→ Yeni `SendAutomaticReminderAsync`: gönderimden ÖNCE tek atomik
`UPDATE … SET LastReminderAtUtc=@now WHERE … AND LastReminderAtUtc IS NULL`. Etkilenen satır 0 ise
yarış kaybedilmiştir ve **sağlayıcıya hiç gidilmez**. Sağlayıcıya hiç ulaşılamadıysa (paket/kota/
kontör kapısı, telefon yok) sahiplenme geri bırakılır ki kota açıldığında yeniden denensin.
**Elle "Hatırlat" kısıtlanmadı** — randevu ertelenince yönetici bilerek tekrar gönderebilmeli.

**2. Webhook tekrar teslimi.** Meta, 200 alamadığını sandığı webhook'u TEKRAR gönderir. Mesaj
kimliği (`wamid`) saklanmadığı için aynı yanıt ikinci kez işleniyor, randevu iptali / KVKK onayı /
bekleme teklifi gibi domain yan etkileri tekrarlanıyordu.
→ `wamid` + `phone_number_id` artık saklanıyor ve **veritabanı benzersiz indeksi** ikinci teslimi
eliyor. Satır, her türlü yan etkiden ÖNCE atomik olarak yazılır; ihlal "zaten işlendi" demektir ve
Meta'ya başarı döner. Aynı metni taşıyan FARKLI mesajlar ayrı kalır (gövdeye göre tekilleştirme yok).

Ayrıca `EmailMask.Mask` imzası `[NotNullIfNotNull]` ile düzeltildi: Release build'i durduran CS8604
uyarısı `!` ile bastırılmak yerine gerçek sözleşme yazıldı.

Doğrulama: Release `--warnaserror` **0 uyarı / 0 hata**, tam backend suite **681/681 geçti
(0 atlandı, gerçek veritabanı zorunlu modda)**, migration manifesti 86 dosya.

Bilinen kenar durum (bloke değil): `SendNotificationAsync` yolunda mükerrer koruması anahtarı
`("notification", müşteri)` çiftidir. Aynı müşteriye 30 dakika içinde **iki farklı** bildirim şablonu
gider ve ilki `Queued` takılı kalırsa ikincisi "önceki denemenin sonucu bilinmiyor" diyerek engellenir.
Sonuç sessiz kayıp değil, sebebi yazan bir kayıttır; şablon başına ayrı anahtar gerekirse
`DispatchAsync` çağrısındaki `templateName` şablon kimliğiyle zenginleştirilmeli.

### 🟡 Eksik C — Quick Reply düğmeli yanıtlar işlenmiyor

Webhook yalnız `type == "text"` mesajlarını okuyor. Şablona "Evet/Hayır" düğmesi koyulursa müşteri yanıtı
kaybolur. Ya şablonlarda düğme kullanılmaz (bölüm 3'teki uyarı), ya da webhook'a `button` / `interactive`
tipi eklenir.

---

## 6. Doğrulama sırası (canlıya geçtikten sonra)

1. **Webhook kaydı:** Meta'da "Verify and Save" → yeşil. Kırmızıysa verify token ya da HTTPS erişimi hatalı.
2. **⚠️ Test etmeden önce 24 saat penceresini açın:** test edeceğiniz telefondan işletme numarasına
   herhangi bir mesaj yazın. Bağlantı testi **serbest metin** gönderir (`SendTestMessageAsync`), pencere
   kapalıysa bağlantı doğru olsa bile "gönderilemedi" der.
3. **Bağlantı testi:** Platform → WhatsApp → Bağlantılar → Test. Mesaj gelmeli.
4. **Gelen yanıt:** test numarasından "EVET" yazın → Kurum → Ayarlar → WhatsApp → Mesajlar listesinde
   **Inbound** satırı görünmeli. Görünmüyorsa App Secret ya da `messages` aboneliği eksiktir.
5. **Teslim durumu:** giden mesajın durumu `Sent` → `Delivered` olmalı. Olmuyorsa webhook status
   bildirimleri gelmiyor demektir → 48 saat sonra kontör iade edilir, gönderimler "ücretsiz" görünür.
6. **Uçtan uca:** bir randevuya "Hatırlat" bas → müşteri "EVET" yazsın → randevu **Onaylandı** olmalı,
   yöneticiye uygulama içi bildirim düşmeli.
7. **Kontör:** Kurum → Ayarlar → Kontör kartında bakiye/kullanım artmalı.

---

## 7. Canlı sonrası izleme

- `whatsapp_messages` tablosunda `Status = Queued` kalan satırlar = sonucu bilinmeyen deneme; 30 dakika
  boyunca aynı mesaj tekrar gönderilmez (mükerrer koruması).
- `WhatsAppReservationSweepBackgroundService` 48 saatte teslim edilmeyen rezervasyonları iade eder.
- Kalıcı iş kuyruğu (`background_jobs`) dead-letter satırları Platform → Sistem sayfasında görünür.
- Meta fatura kategorileri: Utility ≈ ₺0,04 · Marketing ≈ ₺0,52 (fiyatlar `WhatsAppPricingRule` tablosunda,
  koda gömülü değil — 1 Eki 2026 zammı için ileri tarihli satır eklenebilir).
