# BeautyAssist Mobile

Flutter ile geliştirilen iOS ve Android yönetim uygulamasıdır. Web panelindeki
rol, tenant, şube, yetki ve backend sözleşmelerini kullanır.

## Çalıştırma

Backend varsayılan olarak `http://localhost:5019` portunda beklenir.

```bash
flutter pub get
flutter run
```

Varsayılan API adresleri:

- Android emülatör: `http://10.0.2.2:5019`
- iOS simülatör: `http://127.0.0.1:5019`

Gerçek cihaz veya canlı ortam için adres derleme anında verilir:

```bash
flutter run --dart-define=API_BASE_URL=https://api.ornek.com
flutter build apk --dart-define=API_BASE_URL=https://api.ornek.com
flutter build ios --dart-define=API_BASE_URL=https://api.ornek.com
```

## Mimari

- `lib/core`: tema, güvenli oturum saklama, token yenileme ve HTTP istemcisi
- `lib/app`: uygulama başlangıcı ve GoRouter navigasyonu
- `lib/features`: her modül için ayrı ekran
- `lib/shared`: ortak kart, liste, durum ve arka plan bileşenleri

Yazma istekleri mevcut backend API'lerine gider. Personel rolündeki işlemler
backend onay kapısından geçmeye devam eder.
