#!/bin/zsh
# Mac App Store derlemesi. Doğrudan dağıtılan dmg (`npx tauri build`) bundan etkilenmez.
#
#   scripts/build-appstore.sh test
#       Apple Development ile imzalı, sandbox'lı .app — bu Mac'te açıp denemek için.
#   BUILD=1 scripts/build-appstore.sh release <Mac_App_Store.provisionprofile>
#       Apple Distribution ile imzalı .app + Mac Installer ile imzalı .pkg → Transporter ile yüklenir.
#
# Gereken (yalnız release): developer.apple.com'da com.beautyasist.desktop App ID'si, bu App ID için
# "Mac App Store Connect" provisioning profile ve "Mac Installer Distribution" sertifikası.
set -euo pipefail

ROOT=${0:a:h:h}
OUT=${ROOT:h}/output/desktop
BUNDLE=$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/macos/BeautyAsist.app
mode=${1:-}

identity() { # $1: kimlik adındaki önek, $2: find-identity politikası
  # (Apple Development adında takım kodu değil kişisel kimlik yer alır; önek yeterli.)
  local -a policy=(); [[ -n ${2:-} ]] && policy=(-p $2)
  security find-identity -v $policy | grep -o "\"$1[^\"]*\"" | head -1 | tr -d '"'
}

cd $ROOT
# CFBundleVersion: her App Store yüklemesinde artmalı (aynı sürüm reddedilir). BUILD=2 ... ile ver.
configs=(--config src-tauri/tauri.appstore.conf.json
         --config "{\"bundle\":{\"macOS\":{\"bundleVersion\":\"${BUILD:-1}\"}}}")

case $mode in
  test)
    export APPLE_SIGNING_IDENTITY=$(identity "Apple Development" codesigning)
    configs+=(--config '{"bundle":{"macOS":{"entitlements":"appstore/Entitlements.dev.plist"}}}')
    ;;
  release)
    profile=${2:?provisioning profile yolu gerekli}
    [[ -f $profile ]] || { echo "Profil bulunamadı: $profile"; exit 1 }
    profile=${profile:a}
    export APPLE_SIGNING_IDENTITY=$(identity "Apple Distribution" codesigning)
    installer=$(identity "3rd Party Mac Developer Installer") || true
    [[ -n $installer ]] || installer=$(identity "Mac Installer Distribution") || true
    [[ -n $installer ]] || { echo "Mac Installer Distribution sertifikası Keychain'de yok"; exit 1 }
    configs+=(--config "{\"bundle\":{\"macOS\":{\"files\":{\"embedded.provisionprofile\":\"$profile\"}}}}")
    ;;
  *)
    echo "Kullanım: $0 test | release <profil.provisionprofile>"; exit 1 ;;
esac

[[ -n ${APPLE_SIGNING_IDENTITY:-} ]] || { echo "İmza kimliği Keychain'de bulunamadı"; exit 1 }
# Store sürümü kendi kendini güncellemez; notarization da Store'da gerekmez.
unset TAURI_SIGNING_PRIVATE_KEY APPLE_ID APPLE_PASSWORD APPLE_API_KEY

npx tauri build --target universal-apple-darwin --bundles app --features appstore $configs

codesign --verify --deep --strict $BUNDLE
codesign -d --entitlements - $BUNDLE 2>/dev/null | grep -q app-sandbox || { echo "Sandbox yetkisi imzada yok"; exit 1 }

if [[ $mode == release ]]; then
  version=$(plutil -extract CFBundleShortVersionString raw $BUNDLE/Contents/Info.plist)
  mkdir -p $OUT
  pkg=$OUT/BeautyAsist_${version}_MacAppStore.pkg
  productbuild --component $BUNDLE /Applications --sign "$installer" $pkg
  pkgutil --check-signature $pkg | head -3
  echo "Hazır: $pkg"
else
  echo "Hazır: $BUNDLE"
fi
