// Browser Use Cloud — doğal dil ile bir AI tarayıcı görevi çalıştırır.
// DİKKAT: Gerçek bir bulut tarayıcı oturumu başlatır → kredi/maliyet harcar.
//
// Kullanım:
//   npm run task -- "Hacker News'teki ilk 10 başlığı listele"
//   node run.mjs "google.com aç ve sayfa başlığını söyle"
//
// Opsiyonel model:  BU_MODEL=gemini-3-flash npm run task -- "..."
//   (gemini-3-flash hızlı/ucuz · claude-sonnet-4.6 dengeli · claude-opus-4.7 en güçlü)
import 'dotenv/config'
import { BrowserUse } from 'browser-use-sdk/v3'

const apiKey = process.env.BROWSER_USE_API_KEY
if (!apiKey) {
  console.error('❌ BROWSER_USE_API_KEY bulunamadı. .env dosyasını kontrol et.')
  process.exit(1)
}

const task = process.argv.slice(2).join(' ').trim() || 'List the top 10 posts on Hacker News'
const model = process.env.BU_MODEL // ör: gemini-3-flash, claude-sonnet-4.6, claude-opus-4.7

const client = new BrowserUse({ apiKey })

console.log('🟣 Görev başlatılıyor:', task)
if (model) console.log('   model:', model)
console.log('   (bulut tarayıcı çalışıyor, birkaç dakika sürebilir...)')

try {
  const result = await client.run(task, model ? { model } : undefined)
  console.log('\n================ SONUÇ ================\n')
  console.log(result?.output ?? '(çıktı yok)')
  if (result?.sessionId) console.log('\nSession:', result.sessionId)
} catch (err) {
  console.error('❌ Görev başarısız:', err?.message || err)
  process.exit(1)
}
