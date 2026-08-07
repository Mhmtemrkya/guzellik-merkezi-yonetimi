import { defineConfig } from 'vitest/config'

// Frontend'de HİÇ test yoktu. Bu yapılandırma bilerek dar tutuldu: React bileşeni render eden
// ağır bir kurulum (jsdom + testing-library) yerine, önce SAF YARDIMCILARI koruyoruz — para
// biçimleme, UTC tarih çözümleme ve izin kontrolü gibi, hatası SESSİZ olan ve tüm ekranlara
// yayılan mantık. Bileşen testleri gerektiğinde jsdom ortamı ayrıca eklenebilir.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts'],
    environment: 'node',
    // Saat dilimine bağlı testler (UTC çözümleme) her makinede aynı sonucu vermeli.
    globals: false,
  },
})
