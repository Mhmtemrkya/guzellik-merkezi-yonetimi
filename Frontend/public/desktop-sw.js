/**
 * Masaüstü (Tauri) kabuğu için app-shell service worker'ı — yalnızca desktop UA'da kaydedilir.
 * Amaç: internet koptuğunda panelin KENDİSİNİN açılabilmesi (beyaz ekran yerine).
 * - /api/* isteklerine DOKUNMAZ (çevrimdışı veri apiClient'ın IndexedDB katmanında).
 * - Statik varlıklar (_next/static, görsel/font): cache-first + arka planda tazeleme.
 * - Sayfa gezinmeleri: network-first; kopunca aynı sayfanın son kopyası, o da yoksa /login.
 */
const SHELL_CACHE = 'beautyasist-shell-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|css|js)$/.test(url.pathname)
  )
}

async function cacheFirst(request) {
  const hit = await caches.match(request)
  if (hit) {
    // Arka planda tazele — bir sonraki açılış güncel olsun.
    fetch(request)
      .then((res) => {
        if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(request, res))
      })
      .catch(() => {})
    return hit
  }
  const res = await fetch(request)
  if (res && res.ok) {
    const cache = await caches.open(SHELL_CACHE)
    cache.put(request, res.clone())
  }
  return res
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request)
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    const hit = await caches.match(request)
    if (hit) return hit
    const login = await caches.match('/login')
    if (login) return login
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>BeautyAsist</title><body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;background:#fbe9f0;color:#352432"><div style="text-align:center"><h2>Bağlantı yok</h2><p>İnternet bağlantısı kurulunca sayfa otomatik yüklenecek.</p></div><script>setInterval(()=>{if(navigator.onLine)location.reload()},3000)</script></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request))
  }
})
