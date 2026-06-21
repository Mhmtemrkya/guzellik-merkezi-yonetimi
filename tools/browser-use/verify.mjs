// API anahtarını ÜCRETSİZ doğrular — browser task çalıştırmaz, kredi harcamaz.
// Kullanım:  npm run verify   (veya: node verify.mjs)
import 'dotenv/config'
import { BrowserUse } from 'browser-use-sdk/v3'

const apiKey = process.env.BROWSER_USE_API_KEY
if (!apiKey) {
  console.error('❌ BROWSER_USE_API_KEY bulunamadı. .env dosyasını kontrol et.')
  process.exit(1)
}

const client = new BrowserUse({ apiKey })

try {
  const account = await client.billing.account()
  console.log('✅ API anahtarı geçerli. Hesap bilgisi:')
  console.log(JSON.stringify(account, null, 2))
} catch (err) {
  console.error('❌ Doğrulama başarısız:', err?.message || err)
  process.exit(1)
}
