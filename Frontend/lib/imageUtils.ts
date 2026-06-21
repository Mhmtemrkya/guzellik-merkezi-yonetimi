/**
 * Bir görsel dosyasını canvas ile en fazla `maxSize` px'e küçültüp JPEG data-URL döndürür.
 * DB'yi (LONGTEXT base64) şişirmemek için ürün/personel görsellerinde kullanılır.
 */
export function downscaleImage(file: File, maxSize: number): Promise<string> {
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
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
