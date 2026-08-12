import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Frontend'de HİÇ test yoktu. Bu yapılandırma bilerek dar tutuldu: React bileşeni render eden
// ağır bir kurulum (jsdom + testing-library) yerine, önce SAF YARDIMCILARI koruyoruz — para
// biçimleme, UTC tarih çözümleme ve izin kontrolü gibi, hatası SESSİZ olan ve tüm ekranlara
// yayılan mantık. Bileşen testleri gerektiğinde jsdom ortamı ayrıca eklenebilir.
export default defineConfig({
  // `@/...` yol takma adı tsconfig'te tanımlı; Vitest onu okumaz. Alias olmadan bir lib dosyası
  // başka bir lib dosyasından DEĞER (tip değil) içeri aldığında test "Cannot find package" ile
  // düşer — tip importları transform'da silindiği için sorun uzun süre görünmemişti.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts'],
    environment: 'node',
    // Saat dilimine bağlı testler (UTC çözümleme) her makinede aynı sonucu vermeli.
    globals: false,
  },
})
