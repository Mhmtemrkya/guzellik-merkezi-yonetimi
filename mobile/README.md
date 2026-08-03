# BeautyAsist Mobile

Flutter ile geliştirilen iOS ve Android yönetim uygulamasıdır. Web panelindeki
rol, tenant, şube, yetki ve backend sözleşmelerini kullanır.

## Çalıştırma

Backend varsayılan olarak `http://localhost:5019` portunda beklenir.

```bash
flutter pub get
flutter run
```

API adresi TEK yerden çözülür: `lib/core/network/api_config.dart` (hem `ApiClient` hem arka plan
bildirim yoklayıcısı onu kullanır — ayrı kopyalar tutulursa biri güncellenip diğeri unutulur).

Öncelik sırası: `--dart-define=API_BASE_URL=...` > release varsayılanı > yerel geliştirme.

| Derleme | Adres |
| --- | --- |
| debug/profile, Android emülatör | `http://10.0.2.2:5019` |
| debug/profile, iOS simülatör | `http://127.0.0.1:5019` |
| **release (APK/IPA)** | **`https://maydanozasist.beautyasist.com`** — canlı backend |

Yani telefona yüklenecek APK için ek parametre gerekmez:

```bash
flutter build apk --release
```

Başka bir sunucuya bağlamak için derleme anında ez:

```bash
flutter run   --dart-define=API_BASE_URL=https://baska.sunucu
flutter build apk --release --dart-define=API_BASE_URL=https://baska.sunucu
```

> CORS mobil için geçerli DEĞİLDİR: tarayıcıya özgü bir mekanizmadır, native Android/iOS istemcisi
> `Origin` başlığı göndermez ve preflight yapmaz. CORS yalnız web panelini ve Flutter **Web**
> derlemesini ilgilendirir.

## Mimari

- `lib/core`: tema, güvenli oturum saklama, token yenileme ve HTTP istemcisi
- `lib/app`: uygulama başlangıcı ve GoRouter navigasyonu
- `lib/features`: her modül için ayrı ekran
- `lib/shared`: ortak kart, liste, durum ve arka plan bileşenleri

Yazma istekleri mevcut backend API'lerine gider. Personel rolündeki işlemler
backend onay kapısından geçmeye devam eder.
