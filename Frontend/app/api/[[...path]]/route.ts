import { readFileSync } from 'node:fs'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

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

const BACKEND_API_BASE_URLS: string[] = Array.from(
  new Set(
    [
      normalizeBaseUrl(process.env.BACKEND_API_BASE_URL),
      normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL),
      normalizeBaseUrl(DEFAULT_BACKEND_API_BASE_URL),
      normalizeBaseUrl(detectWslGatewayBackendUrl()),
    ].filter((value): value is string => Boolean(value)),
  ),
)

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

function withCors(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id, X-Branch-Id')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
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
      response.headers.set('X-Armonessa-Backend', backendBaseUrl)
      return withCors(response)
    } catch (error) {
      errors.push(`${backendBaseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return withCors(
    NextResponse.json(
      {
        success: false,
        error: {
          code: 'BackendProxyUnavailable',
          message: `Backend API erişilemedi. Denenen adresler: ${BACKEND_API_BASE_URLS.join(', ')}`,
          detail: errors.join(' | '),
        },
        traceId: null,
      },
      { status: 502 },
    ),
  )
}

async function handleRoute(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const route = await resolvePath(context?.params)

  if (request.method === 'OPTIONS') {
    return withCors(new NextResponse(null, { status: 200 }))
  }

  if (route === '/' || route === '/root') {
    return withCors(NextResponse.json({ message: 'Armonessa API proxy', backends: BACKEND_API_BASE_URLS }))
  }

  if (route === '/proxy') {
    return withCors(NextResponse.json({ message: 'Backend proxy hazır', backends: BACKEND_API_BASE_URLS }))
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
  )
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const PATCH = handleRoute
export const DELETE = handleRoute
export const OPTIONS = handleRoute
