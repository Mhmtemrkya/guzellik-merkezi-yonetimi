/**
 * Bir görsel dosyasını canvas ile en fazla `maxSize` px'e küçültüp data-URL döndürür.
 * DB'yi (LONGTEXT base64) şişirmemek için ürün/ekip/logo görsellerinde kullanılır.
 *
 * ## Şeffaflık
 *
 * Varsayılan çıktı JPEG'dir (fotoğraflar için doğru: aynı kalitede kat kat küçük). JPEG alfa
 * kanalı taşımaz; bu yüzden çizimden ÖNCE tuval **beyaza boyanır**.
 *
 * SOMUT KUSUR: eskiden boyanmıyordu. Boş tuval "saydam siyah" (0,0,0,0) olduğu için şeffaf bir
 * PNG yüklendiğinde saydam alanlar JPEG'de **siyaha** dönüyordu — logolar neredeyse her zaman
 * şeffaf PNG olduğundan kurumun logosu vitrinde ve belgelerde siyah bir kutu olarak çıkıyordu.
 *
 * Logo gibi saydamlığın KORUNMASI gereken yerlerde `keepTransparency` açılır: görselde gerçekten
 * saydam piksel varsa çıktı PNG olur, yoksa yine JPEG (boşuna büyümesin).
 */

/** Sunucu tarafı sınırı (TenantProfileService.MaxImageDataLength) ile aynı: base64 karakter sayısı. */
export const MAX_IMAGE_DATA_LENGTH = 1_500_000

export interface DownscaleOptions {
  /**
   * Saydamlığı koru (logo). Görselde saydam piksel varsa PNG üretilir.
   * Kapalıyken (varsayılan) çıktı beyaz zeminli JPEG'dir.
   */
  keepTransparency?: boolean
  /** Base64 uzunluk tavanı. PNG bu sınırı aşarsa beyaz zeminli JPEG'e düşülür. */
  maxDataLength?: number
}

/** Tuvalde gerçekten saydam piksel var mı? (Alfa kanalını tam tarar; 512 px'te ~1 ms.) */
function hasTransparentPixel(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  if (w === 0 || h === 0) return false
  const { data } = ctx.getImageData(0, 0, w, h)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

export function downscaleImage(file: File, maxSize: number, options: DownscaleOptions = {}): Promise<string> {
  const { keepTransparency = false, maxDataLength = MAX_IMAGE_DATA_LENGTH } = options
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Lütfen bir görsel dosyası seçin.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Dosya okunamadı.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Görsel çözümlenemedi.'))
      img.onload = () => {
        // Yalnız KÜÇÜLTÜR: küçük bir görsel büyütülüp bulanıklaştırılmaz.
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas oluşturulamadı.'))
          return
        }

        if (keepTransparency) {
          ctx.drawImage(img, 0, 0, w, h)
          if (hasTransparentPixel(ctx, w, h)) {
            const png = canvas.toDataURL('image/png')
            // PNG sunucu sınırını aşarsa saydamlıktan vazgeçilir — ama SİYAHA değil beyaza.
            if (png.length <= maxDataLength) {
              resolve(png)
              return
            }
          }
          // Saydamlık yok (ya da PNG çok büyük): beyaz zemine yeniden çiz, JPEG ver.
          ctx.globalCompositeOperation = 'destination-over'
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.globalCompositeOperation = 'source-over'
          resolve(canvas.toDataURL('image/jpeg', 0.82))
          return
        }

        // JPEG yolu: ÖNCE beyaz zemin, sonra görsel. Aksi hâlde saydam alanlar siyah çıkar.
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
