# BeautyAsist — Store Yayın Rehberi

Bu döküman, uygulamayı **Google Play**, **App Store** ve **masaüstü imzalı installer**
olarak yayınlamak için gereken adımları toplar. Kod tarafındaki eksikler bu commit'te giderildi;
aşağıdaki adımlar **senin hesaplarına/sertifikalarına** bağlı olan kısımlardır.

> **Bildirim mimarisi hatırlatma:** Uygulama 3 katmanlı bildirim kullanır — (1) yerel+zamanlanmış
> (internetsiz/kapalı çalışır), (2) LAN yoklama (aynı ağ, arka plan), (3) **uzaktan push (FCM)**.
> Push, aşağıdaki Firebase adımları tamamlanana kadar **simülasyon modundadır** (loglanır, gönderilmez).

---

## 0. Sürüm numaraları

| Platform | Nerede | Şu an |
|---|---|---|
| Mobil (Android+iOS) | `mobile/pubspec.yaml` → `version: 1.0.0+1` | `versionName=1.0.0`, `versionCode/build=1` |
| Masaüstü | `desktop-app/src-tauri/tauri.conf.json` + `Cargo.toml` + `package.json` | `1.0.0` |

Her yeni yüklemede build numarasını artır: mobilde `1.0.0+2`, `1.0.1+3` …

---

## 1. Android (Google Play)

### 1.1 İmzalama anahtarı (ZORUNLU — bir kez)

> **DURUM (22 Eyl 2026): TAMAMLANDI.** Upload anahtarı üretildi ve doğrulandı —
> `~/beautyasist-upload.jks` (PKCS12, alias `beautyasist`, 10000 gün, 7 Şub 2054'e kadar).
> `mobile/android/key.properties` bu dosyayı **mutlak yolla** gösteriyor.
> Sertifika SHA-1: `6F:26:3C:B2:AB:8D:FB:BD:72:F2:4D:EF:E2:DE:42:31:4A:03:75:D1`
>
> Önceki `key.properties` bir **Windows yolunu** (`C:/Users/KAYA/keys/...`) gösteriyordu; macOS'ta
> `android/` altına göreli çözülüp bulunamıyor ve build `validateSigningRelease` görevinde
> **hata veriyordu**. Eski yedek: `mobile/android/key.properties.bak-*`.

Sıfırdan üretmek gerekirse (bir kez):
```bash
keytool -genkeypair -v -keystore ~/beautyasist-upload.jks -storetype PKCS12 \
  -keyalg RSA -keysize 2048 -validity 10000 -alias beautyasist \
  -dname "CN=BeautyAsist,O=BeautyAsist,L=Istanbul,C=TR"
```
Sonra `mobile/android/key.properties.example` → `mobile/android/key.properties` olarak kopyala,
değerleri gir. `storeFile` ya mutlak yol ya da `android/` klasörüne göreli olabilir.
`key.properties` ve `*.jks` **git'e girmez** (zaten `.gitignore`'da). **Şifreleri ve .jks'i güvenle sakla —
kaybedersen aynı uygulamayı bir daha güncelleyemezsin.**

> Not: Play "App Signing" kullanıyorsan bu anahtar **upload key** olur; Google dağıtım anahtarını kendi tutar (önerilir).

### 1.2 Build
```bash
cd mobile
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://api.senindomainin.com
```
Çıktı: `build/app/outputs/bundle/release/app-release.aab` → Play Console'a yükle.

- `API_BASE_URL` **canlı HTTPS** adresin olmalı. Vermezsen dev localhost'a düşer.
- Release artık gerçek keystore ile imzalı, R8/minify + kaynak temizleme açık.

### 1.3 Yerel/LAN HTTP kullanımı
Ağ politikası artık hibrit: **internet → sadece HTTPS**, **cleartext HTTP → yalnızca yerel adresler**.
Salon içi sabit IP'li HTTP sunucun varsa onu ekle:
`mobile/android/app/src/main/res/xml/network_security_config.xml` → yeni bir `<domain>` satırı
(ör. `192.168.1.100` yerine kendi IP'n). CIDR/aralık desteklenmez; her host tek tek yazılır.

### 1.4 Play Console'da hesap-tarafı gereksinimleri
- Geliştirici hesabı ($25 tek sefer), uygulama kaydı, mağaza listesi (açıklama, ekran görüntüleri, 512px ikon, 1024×500 feature grafik).
- **Gizlilik Politikası URL'si** (zorunlu).
- **Data safety** formu: uygulama kamera/fotoğraf, çalışan cihaz kimliği, (push açılırsa) FCM token toplar → forma işaretle.
- İzinlerin gerekçesi: `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` → randevu hatırlatması (tam-alarm gerekçesi Play formunda sorulur).
- Foreground service tipi `dataSync` → Play "Foreground service permissions" beyanı isteyebilir (LAN senkron gerekçesi).

---

## 2. iOS (App Store)

Kod tarafı hazır: `ITSAppUsesNonExemptEncryption=false`, push `UIBackgroundModes`, `aps-environment` entitlement.

### 2.1 Hesap-tarafı
- **Apple Developer Program** ($99/yıl).
- Xcode → Runner target → Signing & Capabilities → Team seç (otomatik imzalama).
- App Store Connect'te uygulama kaydı; bundle ID: **`com.beautyasist.app`**.
- Gizlilik politikası + App Privacy ("Nutrition label"): kamera, fotoğraf, cihaz kimliği, (push için) token.
- Kullanım açıklamaları zaten Info.plist'te (kamera/galeri).

### 2.2 Build
```bash
cd mobile
flutter build ipa --release --dart-define=API_BASE_URL=https://api.senindomainin.com
```
Sonra `build/ios/archive/*.xcarchive` → Xcode Organizer / `xcrun altool`/`Transporter` ile yükle.

### 2.3 Push (FCM) için ek
- Xcode → Runner → Signing & Capabilities → **+ Capability** → *Push Notifications* ve *Background Modes → Remote notifications*.
- Apple Developer → Keys → **APNs Auth Key (.p8)** üret → Firebase Console → Cloud Messaging → Apple app → yükle.
- `GoogleService-Info.plist`'i Runner target'ına ekle (bkz. §4).

---

## 3. Masaüstü (imzalı installer)

Tauri, Google Play/App Store'a **giremez** (onlar yalnızca mobil). Dağıtım = imzalı kurulum paketi
(Windows `.exe`/NSIS, macOS `.dmg`), kendi sitenden indirilir.

### 3.1 Build
```bash
cd desktop-app
npm install
npm run tauri build
```
Çıktı: Windows'ta `src-tauri/target/release/bundle/nsis/*.exe`, macOS'ta `.../dmg/*.dmg`.

> **Önemli mimari not:** `main` penceresi `http://localhost:3000/login` yükler — yani masaüstü uygulaması
> çalışırken **yerel web frontend'in (port 3000) ayakta olmasını** bekler. Son kullanıcıya tek-tık kurulum
> için ya frontend'i uygulamayla paketle/başlat ya da bu URL'yi canlı HTTPS adresine çevir.

### 3.2 Kod imzası (uyarısız kurulum için)
- **Windows:** OV/EV kod imzalama sertifikası → `tauri.conf.json` → `bundle.windows.certificateThumbprint`
  (sertifika Windows deposunda yüklü). `digestAlgorithm` ve `timestampUrl` zaten ayarlı.
- **macOS:** "Developer ID Application" sertifikası → `bundle.macOS.signingIdentity` + **notarization**
  (`xcrun notarytool submit ... --wait`, ardından `stapler`). İmzasız `.dmg` Gatekeeper uyarısı verir.

---

## 4. Uzaktan Push'u (FCM) aktifleştirme — ortak

1. [Firebase Console](https://console.firebase.google.com) → yeni proje.
2. **Android app** ekle (paket: `com.beautyasist.app`) → `google-services.json` indir →
   `mobile/android/app/` içine bırak (bkz. oradaki `BURAYA_google-services.json.md`).
3. **iOS app** ekle (bundle: `com.beautyasist.app`) → `GoogleService-Info.plist` indir →
   Xcode'da Runner target'ına ekle (bkz. `mobile/ios/Runner/BURAYA_GoogleService-Info.plist.md`) + §2.3 APNs.
4. **Backend:** Firebase Console → Proje ayarları → Servis hesapları → "Yeni özel anahtar oluştur" → inen JSON'u
   sunucuda güvenli bir yola koy, env ver:
   ```
   Push__Fcm__ServiceAccountPath=/etc/beautyasist/fcm-service-account.json
   ```
   (veya `GOOGLE_APPLICATION_CREDENTIALS`). Bkz. `appsettings.example.json` → `Push:Fcm`.
5. Yeniden derle/deploy. Loglarda `[FCM-SIM]` yerine gerçek gönderim görürsen aktif demektir.

> Config dosyalarının hiçbiri repoya girmemeli (`.gitignore`'a ekle: `google-services.json`,
> `GoogleService-Info.plist`, `*fcm*service-account*.json`).

---

## 5. App Store reddi (1.0/5) ve yapılan düzeltmeler — 7 Ağu 2026

Apple üç gerekçeyle reddetti. Üçü de **kodda** kapatıldı; kalan iş **canlı yapılandırma**.

| Gerekçe | Sorun | Çözüm |
|---|---|---|
| **3.2.2(v)** İş modeli | Müşteri girişi doğrulama kodunu **yalnız WhatsApp'a** gönderiyordu → "uygulama kullanıcıyı WhatsApp kullanıcılarıyla sınırlıyor" | Kod artık **SMS / e-posta / WhatsApp** kanallarından gider. Kullanıcı seçer; sadece platformda kurulu kanallar gösterilir (`GET /api/auth/customer/otp/channels`) |
| **2.1** Bilgi eksik | `admin@beautyasist.test` **yalnızca Development seed'inde** vardı; canlı API'de o hesap hiç olmadı → denetçi giremedi | `AppReview:*` ile açılan **canlı inceleme hesabı kurucusu** (kurum + yönetici + demo müşteri + örnek veri) |
| **5.1.1(v)** Gizlilik | Girişte **doğum tarihi zorunluydu** — randevu almak için gerekmiyor | Doğum tarihi kimlikten **çıkarıldı**. Kayıtta yalnızca **isteğe bağlı** (doğum günü kampanyaları için) |

### 5.1 ZORUNLU: en az bir WhatsApp-DIŞI kanal kur

> **Bu adım atlanırsa 3.2.2(v) AYNEN tekrar reddedilir.** Kod hazır ama tek kurulu kanal WhatsApp
> kalırsa kullanıcı yine WhatsApp'a mahkûmdur. Backend açılışta bunu fark eder ve
> `APP STORE 3.2.2(v) RİSKİ` diye **hata seviyesinde** loglar — yüklemeden önce logu kontrol edin.

Panelden: **Platform → Sistem Ayarları → Mesajlaşma**

- **E-posta (önerilen, en hızlı):** SMTP host/port/kullanıcı/şifre + gönderen adres → *Etkin* → **Test et**.
- **SMS (Netgsm / Twilio):** API anahtarı + gönderen başlık → *Etkin* → **Test et**.

Testin **simülasyon değil gerçek** gönderim döndürdüğünü doğrulayın: simülasyon teslimat sayılmaz,
kod hiç gitmez. Backend bunu bilerek başarısız sayar (kullanıcıyı boş kod ekranında bırakmamak için).

> **E-posta kanalının sınırı:** girişte kod, **kurumun kayıtlarındaki** adrese gider — kullanıcıya
> adres sorulmaz (yanlış adres yazılırsa sessizce kaybolurdu). Kaydında e-postası olmayan müşteri
> e-posta kanalıyla kod alamaz; bu yüzden **SMS'i de açmak** en sağlamıdır.

### 5.2 İnceleme hesabını canlıda aç

Canlı `appsettings.Production.json` (ya da ortam değişkenleri):

```jsonc
"AppReview": {
  "Enabled": true,
  "TenantName": "BeautyAsist Demo Merkezi",
  "TenantSlug": "beautyasist-app-review",
  "OwnerEmail": "review@beautyasist.app",
  "OwnerTenantId": "<kurulumdan sonra olusan demo kurum UUID'si>",
  "OwnerOtpCode": "<6 haneli sabit inceleme kodu>",
  "OwnerPassword": "<en az 8 karakter, güçlü>",
  "OwnerName": "Demo Yonetici",
  "CustomerFullName": "Demo Müşteri",
  "CustomerPhone": "+905551112233",
  "CustomerEmail": "musteri@beautyasist.test",
  "CustomerOtpCode": "424242"
}
```

Backend'i yeniden başlatın. Loglarda `MAĞAZA İNCELEME HESABI OLUŞTURULDU` görmelisiniz.

Bu kurucu **Development seeder'ından farklıdır**: parola koda gömülü değil config'ten gelir, DB
silmez, şemaya dokunmaz, yalnız kendi kurumunu oluşturur ve **idempotenttir** (tekrar çalıştırmak
güvenli — parolayı config'ten tazeler).

- Kuruma **tüm özellikleri açan plan** atanır; aksi hâlde denetçi "paketiniz izin vermiyor" (409)
  duvarına çarpar. Planlar yoksa `Database:SeedReferenceData=true` ile bir kez oluşturun.
- `CustomerPhone` + `CustomerOtpCode` dolu olduğunda **yalnız bu numara için** kod rastgele
  üretilmez/gönderilmez, **sabit** kod kullanılır — denetçi hiçbir kanaldan mesaj alamaz.
  Doğrulamanın geri kalanı (kimlik eşleşmesi, tek kullanım, 5 deneme freni) aynen işler.

### 5.3 App Store Connect → "App Review Information" alanına yazılacak metin

```
DEMO ACCOUNT (Staff / Business owner)
  Sign-in mode: "Personel / Yönetici" tab
  Username: review@beautyasist.app
  Password: <AppReview:OwnerPassword ile aynı>
  No verification code: this demo account signs in directly after the password.

DEMO ACCOUNT (Client / Consumer)
  Sign-in mode: "Müşteri" tab
  Full name: Demo Müşteri      (type exactly, with "ü" and "ş" - or copy/paste)
  Phone: +905551112233
  E-mail: musteri@beautyasist.test
  No verification code: this demo client signs in directly after "Continue".

NOTES
- The staff/business-owner demo account skips the e-mail verification step. The review-only
  shortcut is restricted to the exact configured owner e-mail, InstitutionOwner role and demo
  tenant UUID. (App builds older than 1.0.0 (9) still open the code screen; the code is printed
  on that screen: <AppReview:OwnerOtpCode ile aynı>.)
- Client verification codes are sent by E-MAIL ONLY. SMS and WhatsApp are not
  used. Sign-in: the code goes to the e-mail on the client record. Sign-up: one
  step, the code goes to the e-mail address entered (any phone number, any country).
- For the demo client above NO message is sent by any channel and the code step is
  skipped. (App builds older than 1.0.0 (12) still open the code screen; enter 424242.)
  On sign-up any e-mail works.
- Date of birth is no longer requested at sign-in. It is optional at sign-up.
```

Parolayı gerçek değerle **doldurun** — Apple 2.1'i tam olarak burada verdi.

> **Müşteri kısa yolu (14 Eki 2026):** `AppReview:CustomerPhone` numarası + kayıtlı ad eşleşince
> `/api/auth/customer/otp/request` oturumu doğrudan döner, kod ekranı açılmaz (mobil 1.0.0+12, web).
> Ad karşılaştırması aksan DUYARLIDIR: canlıdaki müşteri kaydının adı tam `Demo Müşteri` olmalı.
> Kurucu, telefon zaten kayıtlıysa adı/e-postayı GÜNCELLEMEZ — numara eskiden farklı bir adla
> açıldıysa adı panelden düzeltin.

### 5.4 İnceleme onaylandıktan SONRA

- [ ] `AppReview:Enabled` → `false`; `OwnerPassword`, `OwnerOtpCode` ve `CustomerOtpCode` temizlendi
- [ ] Backend yeniden başlatıldı (loglarda artık `MAĞAZA İNCELEME HESABI AÇIK` uyarısı YOK)
- [ ] `beautyasist-app-review` kurumu platform panelinden askıya alındı / silindi

---

## 5.5 E-posta teslimatı (Gmail'e ulaşmak için ZORUNLU)

Kayıt ve doğrulama kodları e-postayla gittiği için bu bölüm **akışın çalışması için şart**.
Aşağıdakiler canlı deploy sırasında tek tek doğrulandı; yeni bir sunucuya geçilirse tekrar gerekir.

| Kayıt | Değer | Neden |
|---|---|---|
| **SPF** | `v=spf1 ip4:31.207.81.98 -all` | Yoksa Gmail `550 5.7.26` ile reddeder |
| **DKIM** | mail sunucusunda üretilen public key | Aynı red kodu; imzasız posta "unauthenticated" sayılır |
| **DMARC** | `v=DMARC1; p=none; rua=...` | SPF/DKIM sonuçlarının raporlanması |
| **PTR / rDNS** | `31.207.81.98` → `mail.beautyasist.com` | **AÇIK:** hosting panelinden ayarlanmalı; eksikken teslimat çalışıyor ama spam puanı yüksek |
| **MX** | tek kayıt yeterli | **AÇIK:** şu an priority 5 ve 10 AYNI hedefe gidiyor; biri gereksiz |

> **Message-ID kod tarafında çözüldü.** `System.Net.Mail` bu başlığı üretmez ve Gmail başlıksız
> postayı `550 5.7.1` ile reddeder. `PlatformMessagingService.SendEmailAsync` artık gönderen alan
> adından Message-ID üretiyor — bu yüzden **gönderen adres ile alan adı uyumlu olmalı**.

### Deploy sırasında beklenen (hata olmayan) durumlar

- **Restart aralığında `connection refused`:** backend (5019) ve frontend (3000) yeniden
  başlarken kısa süre bağlantı kabul etmez. Retry ile geçer.
- **systemd'de `failed` görünen frontend restart:** kontrollü kapanışta eski proses SIGTERM (143)
  ile iner, systemd bunu geçici olarak `failed` yazar. `restart ledger 0` + `active` + web 200
  ise sorun yoktur.
- **Backend health portu 5019'dur** (5106 DEĞİL). Yanlış port probe'u "servis ölü" sanılmasına
  yol açar.

---

## 6. Yayın öncesi kontrol listesi

- [x] `mobile/android/key.properties` oluşturuldu (22 Eyl 2026) — **`.jks` ve parolayı YEDEKLE**
- [x] Android release AAB üretildi ve imzası doğrulandı (`jar verified`, CN=BeautyAsist, 69.3MB)
- [x] iOS release derlemesi geçti (`flutter build ios --release --no-codesign` → Runner.app 40.1MB)
- [x] `API_BASE_URL`: release build'de varsayılan zaten canlı HTTPS (`ApiConfig.productionBaseUrl`,
      `/health` 200 — 14 Eki 2026); `--dart-define` gerekmez
- [x] `/hesap-silme` sayfası YAZILDI (`Frontend/app/hesap-silme/page.tsx`, `legalLinks`'e eklendi,
      `next build` ile derlendiği doğrulandı) — canlıda 200 (14 Eki 2026)
- [x] **`USE_EXACT_ALARM` manifest'ten KALDIRILDI** (22 Eyl 2026). AAB içinden doğrulandı:
      `USE_EXACT_ALARM: 0`, `SCHEDULE_EXACT_ALARM: 1`. Tam alarm izni artık kullanıcı onayına bağlı;
      onay yoksa `NotificationService.schedule` `inexactAllowWhileIdle`'a düşer (hatırlatma kaybolmaz)
- [ ] Backend canlıda HTTPS + `Jwt:SigningKey`, `Encryption:MasterKeyBase64` gerçek gizli değerlerle
- [x] **E-posta kanalı canlıda açık** (`/api/auth/customer/otp/channels` → `email:true`, 14 Eki 2026) (§5.1 — 3.2.2(v))
- [ ] **`AppReview:*` dolduruldu, loglarda hesap oluştu** (§5.2 — 2.1)
- [ ] **App Store Connect "App Review Information" metni yazıldı** (§5.3 — 2.1)
- [x] Build 10 App Store Connect'e yüklendi (14 Eki 2026, iOS hedefi 13.0 → 90068 uyarısı).
      Sonraki yükleme **`1.0.0+11`**, iOS hedefi **15.0** (Nisan 2027 zorunluluğu)
- [x] **3.1.1: iOS'ta uygulama içi satın alma yönlendirmesi yok** (`StorePolicy.hidesPurchaseFlows`):
      Paketim'de fiyat / yükseltme yolu / ödeme kartı, WhatsApp'ta kontör satın alma, girişte
      "İşletmenizi kaydedin" bağlantısı gizli.
      Android aynen kalır
- [ ] **Backend `963b4db` (inceleme yöneticisi kodsuz giriş) canlıya DEPLOY edildi** — edilmezse
      denetçi yine kod ekranına takılır (2.1)
- [ ] App Review Information'daki kullanıcı adı canlıdaki `AppReview:OwnerEmail` ile BİREBİR aynı
- [x] Gizlilik politikası URL'si yayında: `https://beautyasist.com/gizlilik` (destek: `/destek`)
- [ ] Play Data safety / App Privacy formları dolduruldu — **doğum tarihi artık "zorunlu" değil**
- [ ] (Push isteniyorsa) Firebase 4 adımı + APNs anahtarı tamam, loglarda gerçek gönderim
- [ ] Masaüstü installer imzalandı (Windows sertifika / macOS notarization)
- [ ] Masaüstü `main` penceresi hedef URL'si (localhost:3000 vs canlı) netleştirildi
