# Buraya `google-services.json` koyun (Android push)

Firebase Console → Proje ayarları → "Uygulamalarınız" → Android uygulaması ekle
(paket adı: **`com.beautyassist.app`**) → `google-services.json` indir →
**bu klasöre** (`mobile/android/app/`) bırakın.

- Dosya varlığında `build.gradle.kts` otomatik `com.google.gms.google-services` eklentisini uygular.
- Dosya YOKken build normal devam eder; push kapalı, uygulama yerel+LAN bildirimleriyle çalışır.
- `google-services.json` gizli sayılmaz ama repoya koymayın (proje ID'si sızar); `.gitignore`'a ekleyin.

Ayrıntı: kök dizindeki `STORE_YAYIN_REHBERI.md`.
