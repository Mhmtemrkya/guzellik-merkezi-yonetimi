# Browser Use (Cloud) — Armonessa araç klasörü

AI destekli bulut tarayıcı otomasyonu (`browser-use-sdk` v3).

## Kurulum (yapıldı)
```bash
cd tools/browser-use
npm install
```
API anahtarı `.env` içinde: `BROWSER_USE_API_KEY=bu_...`
(SDK bu değişkeni varsayılan olarak okur. `.env` ve `node_modules` git'e gönderilmez.)

## Komutlar

**Anahtarı doğrula (ÜCRETSİZ — kredi harcamaz):**
```bash
npm run verify
```

**Bir görev çalıştır (ÜCRETLİ — bulut tarayıcı başlatır, kredi harcar):**
```bash
npm run task -- "Hacker News'teki ilk 10 başlığı listele"
npm run task -- "localhost:3000 aç ve sayfanın başlığını söyle"
```

Opsiyonel model seçimi:
```bash
# gemini-3-flash (hızlı/ucuz) · claude-sonnet-4.6 (dengeli) · claude-opus-4.7 (en güçlü)
$env:BU_MODEL="gemini-3-flash"; npm run task -- "..."
```

## Notlar
- `npm run verify` çıktısında `totalCreditsBalanceUsd: 0` görünüyorsa, görev çalıştırmadan önce
  https://cloud.browser-use.com üzerinden kredi/plan eklemen gerekebilir.
- Base URL: `https://api.browser-use.com` · Header: `X-Browser-Use-API-Key: bu_...`
- Programatik kullanım:
  ```js
  import { BrowserUse } from 'browser-use-sdk/v3'
  const client = new BrowserUse({ apiKey: process.env.BROWSER_USE_API_KEY })
  const result = await client.run('görev metni')
  console.log(result.output)
  ```
