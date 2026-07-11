# Buraya `GoogleService-Info.plist` koyun (iOS push)

Firebase Console → Proje ayarları → iOS uygulaması ekle
(bundle ID: **`com.beautyassist.app`**) → `GoogleService-Info.plist` indir →
Xcode'da **Runner** hedefine ekleyin (sürükle-bırak, "Copy items if needed" + Runner target işaretli).

Ek olarak iOS push için (bkz. `STORE_YAYIN_REHBERI.md`):
- Apple Developer → Keys → **APNs Auth Key (.p8)** üretin.
- Firebase Console → Cloud Messaging → Apple app config → APNs anahtarını yükleyin.
- Runner hedefinde **Push Notifications** ve **Background Modes → Remote notifications** capability'lerini açın
  (entitlement `aps-environment` ve Info.plist `UIBackgroundModes` zaten hazır).
