// Açık bir bulut tarayıcı oturumunu durdurur (kredi/zaman tüketmesin diye).
// Kullanım:  npm run stop -- <sessionId>
import 'dotenv/config'
import { BrowserUse } from 'browser-use-sdk/v3'

const apiKey = process.env.BROWSER_USE_API_KEY
if (!apiKey) {
  console.error('❌ BROWSER_USE_API_KEY bulunamadı.')
  process.exit(1)
}

const sessionId = process.argv[2]
if (!sessionId) {
  console.error('Kullanım: npm run stop -- <sessionId>')
  process.exit(1)
}

const client = new BrowserUse({ apiKey })
try {
  const s = await client.browsers.stop(sessionId)
  console.log('🛑 Durduruldu:', s.id, '·', s.status)
} catch (err) {
  console.error('❌ Durdurulamadı:', err?.message || err)
  process.exit(1)
}
