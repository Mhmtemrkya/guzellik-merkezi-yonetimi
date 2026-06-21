// Canlı bir bulut tarayıcı oturumu açar ve gerçek zamanlı izleme (liveUrl) linkini verir.
// DİKKAT: Bulut tarayıcı başlatır → kredi/maliyet harcar. Bitince `npm run stop -- <id>`.
//
// Kullanım:  npm run live
import 'dotenv/config'
import { BrowserUse } from 'browser-use-sdk/v3'

const apiKey = process.env.BROWSER_USE_API_KEY
if (!apiKey) {
  console.error('❌ BROWSER_USE_API_KEY bulunamadı. .env dosyasını kontrol et.')
  process.exit(1)
}

const client = new BrowserUse({ apiKey })

console.log('🟣 Canlı tarayıcı oturumu açılıyor...')
try {
  const session = await client.browsers.create({})
  console.log('\n✅ Tarayıcı hazır!\n')
  console.log('  Canlı izleme (tarayıcıda aç):')
  console.log('  ' + (session.liveUrl || '(liveUrl gelmedi)'))
  console.log('\n  Session ID :', session.id)
  console.log('  Durum      :', session.status)
  console.log('  Timeout    :', session.timeoutAt)
  console.log('\n  Durdurmak için:  npm run stop -- ' + session.id)
} catch (err) {
  console.error('❌ Oturum açılamadı:', err?.message || err)
  if (String(err?.message || err).match(/credit|balance|insufficient|payment|402/i)) {
    console.error('   → Kredi yetersiz olabilir. https://cloud.browser-use.com üzerinden kredi ekle.')
  }
  process.exit(1)
}
