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

function copyRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (hopByHopHeaders.has(normalizedKey) || normalizedKey === 'host') return
    headers.set(key, value)
  })
  return headers
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

async function proxyToBackend(request: NextRequest, route: string): Promise<NextResponse> {
  const upstreamPath = route.startsWith('/proxy/') ? route.replace(/^\/proxy/, '') : route
  const sourceUrl = new URL(request.url)
  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()
  const headers = copyRequestHeaders(request)

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

      const responseBody = await upstreamResponse.arrayBuffer()
      const response = new NextResponse(responseBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: copyResponseHeaders(upstreamResponse),
      })
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
