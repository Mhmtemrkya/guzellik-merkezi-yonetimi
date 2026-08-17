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
```bash
keytool -genkey -v -keystore ~/beautyasist-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias beautyasist
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
  "OwnerPassword": "<en az 8 karakter, güçlü>",
  "OwnerName": "Demo Yonetici",
  "CustomerFullName": "Demo Musteri",
  "CustomerPhone": "+90 5XX XXX XX XX",
  "CustomerEmail": "review.customer@beautyasist.app",
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

DEMO ACCOUNT (Client / Consumer)
  Sign-in mode: "Müşteri" tab
  Full name: Demo Musteri
  Phone: +90 5XX XXX XX XX
  Verification code: 424242   (fixed code for this review account)

NOTES
- The verification code can be delivered by SMS, e-mail or WhatsApp; the user
  chooses the channel on the sign-in screen. WhatsApp is optional, never required.
- For the demo client account above, the code is fixed (424242) because the
  reviewer cannot receive real messages. Enter it directly in the code field.
- Date of birth is no longer requested at sign-in. It is optional at sign-up.
```

`+90 5XX XXX XX XX` ve parolayı gerçek değerlerle **doldurun** — Apple 2.1'i tam olarak burada verdi.

### 5.4 İnceleme onaylandıktan SONRA

- [ ] `AppReview:Enabled` → `false`, `OwnerPassword` ve `CustomerOtpCode` temizlendi
- [ ] Backend yeniden başlatıldı (loglarda artık `MAĞAZA İNCELEME HESABI AÇIK` uyarısı YOK)
- [ ] `beautyasist-app-review` kurumu platform panelinden askıya alındı / silindi

---

## 6. Yayın öncesi kontrol listesi

- [ ] `mobile/android/key.properties` oluşturuldu, `.jks` yedeklendi
- [ ] `API_BASE_URL` canlı HTTPS'e ayarlı build alındı (Android AAB + iOS IPA)
- [ ] Backend canlıda HTTPS + `Jwt:SigningKey`, `Encryption:MasterKeyBase64` gerçek gizli değerlerle
- [ ] **SMS ya da e-posta kanalı canlıda kurulu ve GERÇEK gönderim test edildi** (§5.1 — 3.2.2(v))
- [ ] **`AppReview:*` dolduruldu, loglarda hesap oluştu** (§5.2 — 2.1)
- [ ] **App Store Connect "App Review Information" metni yazıldı** (§5.3 — 2.1)
- [ ] Build numarası artırıldı (`pubspec.yaml` → `1.0.0+6`; Apple aynı numarayı kabul etmez)
- [ ] Gizlilik politikası URL'si yayında (Play + App Store)
- [ ] Play Data safety / App Privacy formları dolduruldu — **doğum tarihi artık "zorunlu" değil**
- [ ] (Push isteniyorsa) Firebase 4 adımı + APNs anahtarı tamam, loglarda gerçek gönderim
- [ ] Masaüstü installer imzalandı (Windows sertifika / macOS notarization)
- [ ] Masaüstü `main` penceresi hedef URL'si (localhost:3000 vs canlı) netleştirildi
