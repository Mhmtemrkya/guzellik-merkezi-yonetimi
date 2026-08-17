import { readFileSync } from 'node:fs'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

// SADECE geliştirme fallback'i — production'da localhost'a düşmek backend'i yanlış adrese yönlendirir.
const DEFAULT_BACKEND_API_BASE_URL = 'http://localhost:5019'

interface RouteParams {
  path?: string[]
}

interface RouteContext {
  params: RouteParams | Promise<RouteParams>
}

function normalizeBaseUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return url.replace(/\/$/, '')
}

function detectWslGatewayBackendUrl(): string | null {
  try {
    const routeTable = readFileSync('/proc/net/route', 'utf8')
    const defaultRoute = routeTable
      .split('\n')
      .slice(1)
      .find((line) => line.trim().split(/\s+/)[1] === '00000000')
    const gatewayHex = defaultRoute?.trim().split(/\s+/)[2]
    if (!gatewayHex || gatewayHex === '00000000') return null
    const octets = gatewayHex.match(/../g)?.reverse().map((part) => Number.parseInt(part, 16))
    if (!octets || octets.some((value) => Number.isNaN(value))) return null
    return `http://${octets.join('.')}:5019`
  } catch {
    return null
  }
}

// Backend adres çözümü:
//  - Production: YALNIZCA açıkça verilen env (BACKEND_API_BASE_URL / NEXT_PUBLIC_BACKEND_API_BASE_URL).
//    localhost varsayılanı veya WSL gateway tahmini YAPILMAZ → iç adresler dışarı sızmaz, yanlış hedefe gidilmez.
//  - Development: yukarıdakiler + localhost varsayılanı + WSL gateway fallback (yerel kolaylık).
const BACKEND_API_BASE_URLS: string[] = Array.from(
  new Set(
    (IS_PRODUCTION
      ? [
          normalizeBaseUrl(process.env.BACKEND_API_BASE_URL),
          normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL),
        ]
      : [
          normalizeBaseUrl(process.env.BACKEND_API_BASE_URL),
          normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL),
          normalizeBaseUrl(DEFAULT_BACKEND_API_BASE_URL),
          normalizeBaseUrl(detectWslGatewayBackendUrl()),
        ]
    ).filter((value): value is string => Boolean(value)),
  ),
)

// İzinli origin listesi — credential'lı CORS'ta '*' KULLANILMAZ; yalnızca listedeki origin yansıtılır.
const ALLOWED_ORIGINS: string[] = (process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean)

const hopByHopHeaders = new Set<string>([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** İstek origin'i izinliyse onu döndürür; değilse null (CORS header'ı set edilmez). */
function resolveAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const normalized = origin.replace(/\/$/, '')
  if (ALLOWED_ORIGINS.includes(normalized)) return origin
  // Geliştirmede allowlist hiç tanımlı değilse yerel kolaylık için origin yansıtılır (production'da ASLA).
  if (!IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) return origin
  return null
}

function withCors(response: NextResponse, request: NextRequest): NextResponse {
  // Yanıt origin'e göre değiştiğinden cache zehirlenmesini önlemek için Vary: Origin.
  response.headers.set('Vary', 'Origin')

  const allowOrigin = resolveAllowedOrigin(request)
  if (allowOrigin) {
    // '*' + credentials kombinasyonu yerine tek, doğrulanmış origin yansıtılır.
    response.headers.set('Access-Control-Allow-Origin', allowOrigin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id, X-Branch-Id')
  return response
}

/**
 * İstemcinin GÖNDEREBİLECEĞİ ve backend'in "gerçek istemci IP'si" olarak güvendiği başlıklar.
 *
 * Backend loopback proxy'yi güvenilir sayıp `X-Forwarded-For` değerini `RemoteIpAddress` yapıyor;
 * rate-limit bölümlemesi ve audit/imza kaydı yalnız bu IP'ye bakıyor. Bu başlıklar olduğu gibi
 * iletilirse istemci her istekte farklı bir IP uydurarak hız sınırını etkisiz kılabilir ve denetim
 * kaydını kirletebilir. Gerçek istemci IP'sini yalnız bu proxy (ve önündeki edge) belirlemelidir.
 */
const untrustedForwardingHeaders = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  // Bölümleme anahtarını YALNIZ bu proxy belirler; istemcinin gönderdiği asla iletilmez.
  // (Sabit aşağıda tanımlı — burada düz metin, çünkü bu blok modül başında değerlendiriliyor.)
  'x-client-partition',
])

/**
 * Bu proxy'nin ÖNÜNDE, gelen `X-Forwarded-For` başlığını KENDİ belirlediği istemci IP'siyle
 * EZEN bir edge (nginx/IIS/LB) varsa `TRUSTED_EDGE_PROXY=true` yapın: o zaman değer güvenilirdir
 * ve backend'e taşınır. Kapalıyken (varsayılan) başlıklar silinir; backend tüm istekleri proxy
 * IP'siyle görür — hız sınırı daralır ama SAHTELENEMEZ. Yanlış tarafta hata yapmak yerine
 * fail-closed davranılır.
 *
 * nginx örneği (append DEĞİL, overwrite):
 *   proxy_set_header X-Forwarded-For $remote_addr;
 */
const trustEdgeForwardedHeaders = process.env.TRUSTED_EDGE_PROXY === 'true'

function copyRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (hopByHopHeaders.has(normalizedKey) || normalizedKey === 'host') return
    if (!trustEdgeForwardedHeaders && untrustedForwardingHeaders.has(normalizedKey)) return
    headers.set(key, value)
  })
  return headers
}

/**
 * Bu tarayıcının bölümleme anahtarını okur; yoksa üretir. `issued` dolu dönerse yanıtla birlikte
 * çerez yazılmalıdır (yalnız ilk istekte).
 */
function resolveClientPartition(request: NextRequest): { value: string; issued: string | null } {
  const existing =
    request.cookies.get(CLIENT_PARTITION_COOKIE)?.value ??
    request.cookies.get(CLIENT_PARTITION_COOKIE.replace('__Host-', ''))?.value
  // Çerez içeriği istemci tarafından değiştirilebilir (HttpOnly yazmayı engeller, ama kullanıcı
  // tarayıcı araçlarıyla silebilir) → biçimi doğrula, uydurma uzun değerler kova şişirmesin.
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return { value: existing, issued: null }
  const fresh = crypto.randomUUID().replace(/-/g, '')
  return { value: fresh, issued: fresh }
}

function copyResponseHeaders(upstreamResponse: Response): Headers {
  const headers = new Headers()
  upstreamResponse.headers.forEach((value, key) => {
    if (hopByHopHeaders.has(key.toLowerCase())) return
    headers.set(key, value)
  })
  return headers
}

async function resolvePath(params: RouteParams | Promise<RouteParams> | undefined): Promise<string> {
  const resolvedParams = params && typeof (params as Promise<RouteParams>).then === 'function'
    ? await (params as Promise<RouteParams>)
    : (params as RouteParams | undefined)
  const pathParts = resolvedParams?.path || []
  return `/${pathParts.join('/')}`
}

/**
 * REFRESH TOKEN TARAYICI DEPOLAMASINDA TUTULMAZ.
 *
 * Access + refresh token'lar localStorage/sessionStorage'a yazılıyordu; herhangi bir DOM XSS,
 * zararlı bir eklenti ya da aynı origin'de çalışan ele geçirilmiş bir script uzun ömürlü refresh
 * token'ı okuyup kalıcı hesap erişimi elde edebilirdi.
 *
 * Çözüm bu proxy katmanında: backend yanıtındaki `refreshToken` gövdeden ÇIKARILIR ve HttpOnly
 * çereze yazılır; yenileme/çıkış isteklerinde gövdeye çerezden geri konur. Tarayıcıdaki JavaScript
 * refresh token'ı hiç görmez. Backend sözleşmesi değişmez → mobil/masaüstü istemciler etkilenmez.
 */
/**
 * HIZ SINIRI BÖLÜMLEME ÇEREZİ.
 *
 * Bu proxy istemcinin `X-Forwarded-For` başlığını varsayılan olarak SİLER (sahte IP ile sınırı
 * aşmasın diye). Sonuç olarak backend herkesi tek bir IP'de (proxy) görüyor ve TEK bir istemci
 * login/OTP kotasını doldurup SİTENİN TAMAMINI 429'a düşürebiliyordu. Burada tarayıcı başına
 * sahtelenemez bir anahtar üretilir: HttpOnly çerezde tutulur, backend'e `X-Client-Partition`
 * olarak ÜZERİNE YAZILARAK gider (istemcinin gönderdiği değer asla iletilmez).
 *
 * Bu bir kimlik değildir, yalnızca kova ayracıdır; çerezi silen yeni bir kova alır — tıpkı IP
 * değiştirmek gibi. Bu yüzden backend'de IP tabanlı kaba sınır da yerinde kalır.
 */
const CLIENT_PARTITION_COOKIE = '__Host-ba-cid'
const CLIENT_PARTITION_HEADER = 'x-client-partition'
const CLIENT_PARTITION_MAX_AGE = 60 * 60 * 24 * 365

const REFRESH_COOKIE = '__Host-ba-refresh'
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 gün (müşteri portalı refresh ömrü)

/** Bu uçların yanıtındaki refreshToken çereze taşınır. */
const TOKEN_ISSUING_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/customer/otp/verify',
  // Self-servis kurum kaydının son adımı da oturum döndürür; refresh token'ı aynı HttpOnly
  // çereze taşınmalı. Listede olmasaydı token tarayıcı depolamasında kalır ve XSS'e açılırdı.
  '/api/public/signup/verify-phone',
])

/** Bu uçlara giden istekte gövdedeki refreshToken çerezden doldurulur. */
const TOKEN_CONSUMING_PATHS = new Set(['/api/auth/refresh', '/api/auth/logout'])

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') || '').toLowerCase().includes('application/json')
}

/** Yenileme/çıkış isteğine çerezdeki refresh token'ı enjekte eder (istemci artık göndermiyor). */
async function injectRefreshTokenFromCookie(request: NextRequest, body: ArrayBuffer | undefined): Promise<ArrayBuffer | undefined> {
  // HTTPS'te __Host- önekli, yerel HTTP'de öneksiz yazılır (Secure zorunluluğu) — ikisine de bak.
  const cookieValue =
    request.cookies.get(REFRESH_COOKIE)?.value ??
    request.cookies.get(REFRESH_COOKIE.replace('__Host-', ''))?.value
  if (!cookieValue || !body) return body
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>
    // İstemci açıkça bir token gönderdiyse (eski sürüm) ona dokunma.
    if (typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0) return body
    parsed.refreshToken = cookieValue
    return new TextEncoder().encode(JSON.stringify(parsed)).buffer as ArrayBuffer
  } catch {
    return body
  }
}

/** Yanıttaki refreshToken'ı çereze taşır ve gövdeden siler. */
async function moveRefreshTokenToCookie(
  upstreamResponse: Response,
  responseBody: ArrayBuffer,
): Promise<{ body: ArrayBuffer; refreshToken: string | null }> {
  if (!isJson(upstreamResponse) || !upstreamResponse.ok) return { body: responseBody, refreshToken: null }
  try {
    const envelope = JSON.parse(new TextDecoder().decode(responseBody)) as {
      data?: { refreshToken?: unknown } | null
    }
    const token = envelope?.data?.refreshToken
    if (typeof token !== 'string' || token.length === 0) return { body: responseBody, refreshToken: null }
    envelope.data!.refreshToken = ''
    return {
      body: new TextEncoder().encode(JSON.stringify(envelope)).buffer as ArrayBuffer,
      refreshToken: token,
    }
  } catch {
    return { body: responseBody, refreshToken: null }
  }
}

async function proxyToBackend(request: NextRequest, route: string): Promise<NextResponse> {
  const upstreamPath = route.startsWith('/proxy/') ? route.replace(/^\/proxy/, '') : route
  const sourceUrl = new URL(request.url)
  const method = request.method.toUpperCase()
  let body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()
  const headers = copyRequestHeaders(request)

  // Hız sınırı kovası: backend tüm istemcileri proxy IP'sinde birleştirmesin (bkz. sabitin notu).
  const partition = resolveClientPartition(request)
  headers.set(CLIENT_PARTITION_HEADER, partition.value)

  if (TOKEN_CONSUMING_PATHS.has(upstreamPath)) {
    body = await injectRefreshTokenFromCookie(request, body)
    if (body) headers.set('content-length', String(body.byteLength))
  }

  if (BACKEND_API_BASE_URLS.length === 0) {
    // Production'da BACKEND_API_BASE_URL set edilmemiş → iç adres tahmini yapmaz, hiçbir adres sızdırmayız.
    return withCors(
      NextResponse.json(
        {
          success: false,
          error: { code: 'BackendNotConfigured', message: 'Backend API yapılandırılmamış.' },
          traceId: null,
        },
        { status: 502 },
      ),
      request,
    )
  }

  const errors: string[] = []
  for (const backendBaseUrl of BACKEND_API_BASE_URLS) {
    const targetUrl = `${backendBaseUrl}${upstreamPath}${sourceUrl.search}`
    try {
      const upstreamResponse = await fetch(targetUrl, {
        method,
        headers,
        body,
        cache: 'no-store',
      })

      let responseBody = await upstreamResponse.arrayBuffer()
      let issuedRefreshToken: string | null = null
      if (TOKEN_ISSUING_PATHS.has(upstreamPath)) {
        const moved = await moveRefreshTokenToCookie(upstreamResponse, responseBody)
        responseBody = moved.body
        issuedRefreshToken = moved.refreshToken
      }

      const responseHeaders = copyResponseHeaders(upstreamResponse)
      if (issuedRefreshToken) responseHeaders.set('content-length', String(responseBody.byteLength))

      const response = new NextResponse(responseBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })

      // Bölümleme çerezi ilk istekte yazılır. HttpOnly: sayfa betiği okuyup değiştiremez;
      // SameSite=Lax: normal gezinmede taşınır. Kimlik taşımaz, yalnız kova ayracıdır.
      if (partition.issued) {
        const partitionSecure = sourceUrl.protocol === 'https:'
        response.cookies.set({
          name: partitionSecure ? CLIENT_PARTITION_COOKIE : CLIENT_PARTITION_COOKIE.replace('__Host-', ''),
          value: partition.issued,
          httpOnly: true,
          secure: partitionSecure,
          sameSite: 'lax',
          path: '/',
          maxAge: CLIENT_PARTITION_MAX_AGE,
        })
      }

      if (issuedRefreshToken) {
        // __Host- öneki: Secure + Path=/ + Domain yok zorunlu. HTTP'de (yerel geliştirme) tarayıcı
        // Secure çerezi yazmaz → orada önek düşürülür, canlıda (HTTPS) tam korumayla yazılır.
        const secure = sourceUrl.protocol === 'https:'
        response.cookies.set({
          name: secure ? REFRESH_COOKIE : REFRESH_COOKIE.replace('__Host-', ''),
          value: issuedRefreshToken,
          httpOnly: true,
          secure,
          sameSite: 'strict',
          path: '/',
          maxAge: REFRESH_COOKIE_MAX_AGE,
        })
      }
      if (upstreamPath === '/api/auth/logout') {
        response.cookies.delete(REFRESH_COOKIE)
        response.cookies.delete(REFRESH_COOKIE.replace('__Host-', ''))
      }

      // Backend iç adresini SADECE development'ta debug header'ı olarak göster — production'da sızdırma.
      if (!IS_PRODUCTION) response.headers.set('X-BeautyAsist-Backend', backendBaseUrl)
      return withCors(response, request)
    } catch (error) {
      errors.push(`${backendBaseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Hata yanıtında backend adres listesi DÖNDÜRÜLMEZ; ayrıntı yalnızca sunucu loglarına yazılır.
  console.error('[proxy] Backend API erişilemedi:', errors.join(' | '))
  return withCors(
    NextResponse.json(
      {
        success: false,
        error: { code: 'BackendProxyUnavailable', message: 'Backend API’ye şu anda ulaşılamıyor.' },
        traceId: null,
      },
      { status: 502 },
    ),
    request,
  )
}

async function handleRoute(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const route = await resolvePath(context?.params)

  if (request.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 204 }), request)
  }

  if (route === '/' || route === '/root') {
    return withCors(NextResponse.json({ message: 'BeautyAsist API proxy' }), request)
  }

  if (route === '/proxy') {
    return withCors(NextResponse.json({ message: 'Backend proxy hazır' }), request)
  }

  if (route.startsWith('/proxy/')) {
    return proxyToBackend(request, route)
  }

  return withCors(
    NextResponse.json(
      {
        success: false,
        error: {
          code: 'RouteNotFound',
          message: `Route ${route} bulunamadı. Backend istekleri /api/proxy ile başlamalı.`,
        },
        traceId: null,
      },
      { status: 404 },
    ),
    request,
  )
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const PATCH = handleRoute
export const DELETE = handleRoute
export const OPTIONS = handleRoute
