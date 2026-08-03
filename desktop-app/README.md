# BeautyAsist Masaüstü

Paneli (`https://beautyasist.com`) tam ekran açan Tauri v2 kabuğu: markalı açılış ekranı,
sistem tepsisi, ekran görüntüsü koruması ve **otomatik güncelleme**.

## Otomatik güncelleme nasıl çalışıyor?

Kullanıcı artık her sürümde `setup.exe` / `.dmg` indirip elle kurmuyor:

1. Uygulama açılır, açılış (splash) ekranı gelir.
2. Splash, GitHub Release'deki `latest.json` dosyasına bakar.
3. Yeni sürüm varsa **"Yeni sürüm hazır"** modalı çıkar (mevcut sürüm → yeni sürüm + değişiklik notları).
4. **Şimdi Güncelle** → indirme çubuğu → kurulum → uygulama yeniden başlar.
   **Daha Sonra** → panel normal şekilde açılır, bir sonraki açılışta yine sorulur.

Tasarım notları:

- Kontrol **yerel splash sayfasında** yapılır. Uzak panel penceresine güncelleyici/işlem yetkisi
  verilmez (`capabilities/remote-panel.json` yalnız kapatma + bildirim izni taşır).
- Rust tarafında bir **güncelleme kapısı** var (`lib.rs`): kontrol bitene kadar ana pencere
  gösterilmez, böylece kullanıcı yarım kalan bir işe başlayıp kurulumun yeniden başlatmasıyla
  kesilmez. Splash yanıt vermezse (çevrimdışı, hata) kapı **10 saniyede** kendiliğinden açılır —
  uygulama açılışta asılı kalmaz.
- Tepside sessiz açılışta (`--hidden`, otomatik başlatma) güncelleme sorulmaz.

## Yeni sürüm yayınlama

```bash
# 1) Sürümü yükselt — İKİSİ DE aynı olmalı
#    desktop-app/src-tauri/tauri.conf.json  -> "version"
#    desktop-app/src-tauri/Cargo.toml       -> version
git commit -am "Masaustu v1.1.0"

# 2) Etiketi at — workflow'u bu tetikler
git tag desktop-v1.1.0
git push origin main --tags
```

`.github/workflows/desktop-release.yml` Windows + macOS paketlerini üretir, imzalar ve
`latest.json` ile birlikte GitHub Release'e yükler. Kurulu uygulamalar bir sonraki açılışta
güncellemeyi görür.

> Sürüm numarası yükseltilmezse güncelleme **görünmez** — updater sürüm karşılaştırması yapar.

## Gerekli depo secret'ları

`Settings → Secrets and variables → Actions`:

| Secret | İçerik |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | İmza özel anahtarının içeriği (`~/.tauri/beautyasist_updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Anahtar parolası (parolasız üretildiyse boş) |

Public karşılığı `tauri.conf.json → plugins.updater.pubkey` içinde ve depoya commit'lidir.

> **ÖZEL ANAHTARI KAYBETME.** Kaybolursa yayınlanmış uygulamalar bir daha güncellenemez;
> tüm kullanıcılara elle yeni kurulum dağıtmak gerekir. Yedeğini parola yöneticisinde tut.

## Yerel derleme

```bash
npm install
npm run tauri build
```

`createUpdaterArtifacts` açık olduğu için yerel derleme de imza ister:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/beautyasist_updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build
```

Çıktılar: `src-tauri/target/release/bundle/` (`nsis/*.exe`, `dmg/*.dmg`) + her paketin `.sig` dosyası.

## macOS notu

Uygulama Apple ile imzalanmadığı sürece **ilk kurulumda** Gatekeeper uyarısı çıkar
(Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de Aç"). Otomatik güncelleme bundan
etkilenmez; sorunsuz bir ilk kurulum için Apple Developer sertifikası + notarization gerekir.
