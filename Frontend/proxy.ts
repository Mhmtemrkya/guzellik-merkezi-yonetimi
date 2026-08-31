import { NextResponse, type NextRequest } from 'next/server'

/**
 * İÇERİK GÜVENLİĞİ POLİTİKASI (CSP) — SCRIPT KAYNAKLARI ARTIK KISITLI.
 *
 * PENTEST BULGUSU ORTA-2: politika yalnız `frame-ancestors / object-src / base-uri / form-action`
 * içeriyordu; `script-src` HİÇ YOKTU. Yani aynı origin'de çalışacak herhangi bir script (gelecekteki
 * bir DOM XSS, ele geçirilmiş bir bağımlılık, zararlı bir tarayıcı eklentisi enjeksiyonu) hiçbir
 * engelle karşılaşmadan çalışabilir ve panel access token'ını (Web Storage'da duruyor) okuyup dışarı
 * gönderebilirdi. Refresh token zaten HttpOnly çerezde (bkz. /api/proxy) — eksik halka buydu.
 *
 * NEDEN NONCE + strict-dynamic (statik başlık değil):
 * Next.js App Router her sayfaya kendi satır-içi başlatma/flight script'lerini basar. Nonce'suz
 * `script-src 'self'` uygulamayı beyaz ekrana düşürür; `'unsafe-inline'` ise politikayı anlamsız
 * kılar (saldırganın enjekte ettiği satır-içi script de çalışır). Tek gerçek çözüm istek başına
 * üretilen nonce'tur: Next, isteğin CSP başlığındaki nonce'u okuyup KENDİ script'lerine ekler.
 * `'strict-dynamic'` ise güvenilen script'in DOM'a eklediği script'leri kapsar — ödeme sağlayıcısının
 * `formContent` içinden yeniden oluşturduğumuz <script> düğümleri (bkz. CheckoutClient) bu sayede
 * çalışmaya devam eder.
 *
 * STİL: `style-src 'unsafe-inline'` bilinçli. framer-motion/gsap animasyonları satır-içi `style`
 * özniteliği yazar; bulgunun konusu script kaynaklarıdır, stil enjeksiyonu değil.
 *
 * KADEMELİ AÇIŞ: `CSP_REPORT_ONLY=true` ile politika uygulanmadan yalnız raporlanır
 * (Content-Security-Policy-Report-Only). Yeni bir üçüncü taraf script eklenirken önce bunu açıp
 * konsoldaki ihlalleri toplamak, sonra kapatmak doğru sıradır.
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/** Politika uygulanmadan yalnız raporlansın mı? (varsayılan: HAYIR — uygulanır) */
const REPORT_ONLY = process.env.CSP_REPORT_ONLY === 'true'

/** Ortam değişkenindeki adresten origin çıkarır (yol/sorgu atılır); geçersizse null. */
function toOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** Verilen http(s) origin'inin ws(s) karşılığı — SignalR aynı adrese WebSocket açar. */
function toWebSocketOrigin(origin: string): string | null {
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}`
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}`
  return null
}

function buildConnectSources(): string[] {
  const sources = new Set<string>(["'self'"])

  // SignalR hub'ı ve (varsa) doğrudan API adresi proxy'den GEÇMEZ; açıkça izinli olmalı.
  for (const raw of [
    process.env.NEXT_PUBLIC_REALTIME_URL,
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL,
    process.env.NEXT_PUBLIC_PUBLIC_WEB_URL,
  ]) {
    const origin = toOrigin(raw)
    if (!origin) continue
    sources.add(origin)
    const ws = toWebSocketOrigin(origin)
    if (ws) sources.add(ws)
  }

  if (!IS_PRODUCTION) {
    // Geliştirme: HMR soketi + yerel backend.
    sources.add('ws:')
    sources.add('http://localhost:5019')
  }

  return [...sources]
}

function buildCsp(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Güvenilen script'in DOM'a eklediği script'ler (ödeme sağlayıcısı formu) çalışabilsin.
    "'strict-dynamic'",
    // strict-dynamic'i ANLAMAYAN eski tarayıcılar için yedek liste (destekleyen tarayıcı bunu yok sayar).
    'https:',
    // Geliştirme derleyicisi eval kullanır; production build'de gerekmez.
    ...(IS_PRODUCTION ? [] : ["'unsafe-eval'"]),
  ]

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    // Animasyon kütüphaneleri satır-içi style yazar (bilinçli taviz — bkz. dosya başı not).
    // fonts.googleapis: globals.css'in İLK satırı Google Fonts'u @import eder. Headless Chrome ile
    // ölçüldü: bu iki origin olmadan politika yazı tipini bloklar ve panel varsayılan fonta düşer.
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
    // Tanıtım videosu + oluşturulan PDF/Excel önizlemeleri blob: URL kullanır.
    ['media-src', ["'self'", 'data:', 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['connect-src', buildConnectSources()],
    // 3D Secure doğrulaması sağlayıcının sayfasını iframe'e alır.
    ['frame-src', ["'self'", 'https:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]

  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`)
  if (IS_PRODUCTION) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

// DOSYA ADI: Next.js 16'da `middleware.ts` KULLANIMDAN KALDIRILDI, adı `proxy.ts` oldu
// (export adı da `proxy`). Davranış aynıdır; eski adla yazılırsa uyarı üretir.
export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)

  // Next.js nonce'u İSTEK başlığındaki CSP'den okur ve kendi <script> etiketlerine ekler;
  // bu iki satır olmadan uygulamanın kendi script'leri politikaya takılır.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', csp)

  // HSTS burada DEĞİL, next.config.js headers() içinde verilir: middleware /api ve statik
  // dosyalarda çalışmaz, başlık ise tüm yanıtlarda bulunmalıdır.
  return response
}

export const config = {
  matcher: [
    /*
     * CSP yalnız BELGE yanıtlarına gerekir. Dışarıda bırakılanlar:
     *  - /api/*  → backend proxy'si (route handler); araya girmek gereksiz gecikme ve risk.
     *  - _next/static, _next/image, favicon, statik dosya uzantıları → gövdesi HTML değil.
     *    (`.js` de dışarıda: /desktop-sw.js gibi public dosyalara CSP basmak service worker'ın
     *    kendi bağlamına politika taşır — gereksiz ve kırılgan.)
     */
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|txt|xml|json|js|css|map|webmanifest)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
