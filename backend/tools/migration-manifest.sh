#!/usr/bin/env bash
# UYGULANMIŞ MIGRATION'LAR DEĞİŞMEZDİR (H15).
#
# Bir migration bir kez yayınlandıktan sonra gövdesi DEĞİŞTİRİLEMEZ. Değiştirilirse migration
# geçmişi (MigrationId) aynı kaldığı için ESKİ kurulumlar yeni SQL'i HİÇ görmez: aynı sürüm
# numarasıyla iki farklı şema/veri düzeltmesi ortaya çıkar ve fark ancak canlıda, yanlış sonuç
# üreten bir sorguda fark edilir. Düzeltme her zaman YENİ (forward-only) bir migration olmalıdır.
#
# Bu betik migration dosyalarının SHA-256 özetlerini üretir/doğrular:
#   ./migration-manifest.sh generate   → manifest'i yeniden yazar (YALNIZ yeni migration eklerken)
#   ./migration-manifest.sh verify     → mevcut manifest'le karşılaştırır (CI bunu çağırır)
#
# Yeni migration eklediğinde: `generate` çalıştır ve manifest'i commit'e dahil et.
# Mevcut bir migration'ın özeti değiştiyse `verify` HATA verir — istenen davranış budur.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/src/GuzellikMerkezi.Infrastructure/Persistence/Migrations"
MANIFEST="$ROOT/migrations.sha256"

# Designer/Snapshot dosyaları modelden ÜRETİLİR ve her yeni migration'da meşru şekilde değişir;
# değişmezlik kuralı yalnızca migration GÖVDELERİ (Up/Down) içindir.
list_files() {
  find "$MIGRATIONS" -name '*.cs' \
    ! -name '*.Designer.cs' \
    ! -name '*ModelSnapshot.cs' \
    -printf '%P\n' | sort
}

# SATIR SONU FARKLARI ÖZETİ DEĞİŞTİRMEZ.
#
# Depoda `core.autocrlf` etkinken Windows çalışma kopyasında dosyalar CRLF, Linux CI
# checkout'unda LF olur. Ham bayt özeti alınırsa manifest, üretildiği işletim sistemi dışında
# HER ZAMAN uyuşmaz — kapı kendi commit'inde bile düşer (bu gerçekten yaşandı). Özet alınmadan
# önce CR'ler atılır: karşılaştırılan şey dosyanın İÇERİĞİdir, nasıl saklandığı değil.
compute() {
  while IFS= read -r rel; do
    printf '%s  %s\n' "$(tr -d '\r' < "$MIGRATIONS/$rel" | sha256sum | cut -d' ' -f1)" "$rel"
  done < <(list_files)
}

case "${1:-verify}" in
  generate)
    compute > "$MANIFEST"
    echo "Manifest yazıldı: $MANIFEST ($(wc -l < "$MANIFEST") migration)"
    ;;
  verify)
    if [ ! -f "$MANIFEST" ]; then
      echo "HATA: $MANIFEST yok. Bir kez './migration-manifest.sh generate' çalıştırıp commit'leyin." >&2
      exit 1
    fi
    current="$(compute)"
    stored="$(cat "$MANIFEST")"
    if [ "$current" = "$stored" ]; then
      echo "Migration manifesti doğrulandı ($(printf '%s\n' "$stored" | wc -l) dosya)."
      exit 0
    fi

    echo "HATA: migration dosyaları manifest ile UYUŞMUYOR." >&2
    echo "" >&2
    echo "Yalnızca YENİ migration eklendiyse: './backend/tools/migration-manifest.sh generate' çalıştırıp" >&2
    echo "manifest'i commit'e ekleyin." >&2
    echo "" >&2
    echo "MEVCUT bir migration'ın gövdesi değiştiyse bu bir HATADIR: uygulanmış migration'lar" >&2
    echo "değiştirilemez (eski kurulumlar yeni SQL'i hiç görmez). Düzeltmeyi YENİ bir migration" >&2
    echo "olarak ekleyin." >&2
    echo "" >&2
    diff <(printf '%s\n' "$stored") <(printf '%s\n' "$current") >&2 || true
    exit 1
    ;;
  *)
    echo "Kullanım: $0 [generate|verify]" >&2
    exit 2
    ;;
esac
