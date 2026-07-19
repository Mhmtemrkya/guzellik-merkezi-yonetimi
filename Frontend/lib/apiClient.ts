import type {
  ApiEnvelope,
  ApiLoginResponse,
  ApiLoginScopeResponse,
  ApiRequestOptions,
  ApiScope,
  ApiTenantAvailability,
  ApiUser,
  AuthSession,
  PagedResult,
  UserRole,
  RoleKey,
} from './types'
import { getDeviceId, getDeviceInfo, getDeviceInfoHeader } from './deviceIdentity'

const defaultApiBaseUrl = '/api/proxy'
export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL || defaultApiBaseUrl).replace(/\/$/, '')

export const AUTH_STORAGE_KEY = 'beautyasist.authSession'
export const API_SCOPE_STORAGE_KEY = 'beautyasist.apiScope'

export class ApiClientError extends Error {
  status: number
  code: string | undefined
  traceId: string | null | undefined

  constructor(message: string, status: number, code?: string, traceId?: string | null) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.traceId = traceId
  }
}

let inMemoryAccessToken: string | null = null
let inMemoryApiScope: ApiScope = { tenantId: null, branchId: null }

// Kapsam (tenant/şube) değişimini izleyen basit pub/sub — useApiQuery bunu dinleyip
// şube değişince tüm sorguları otomatik yeniden çalıştırır (şube bazlı veri filtresi için).
let scopeEpoch = 0
const scopeListeners = new Set<() => void>()
export function getApiScopeEpoch(): number {
  return scopeEpoch
}
export function subscribeApiScope(listener: () => void): () => void {
  scopeListeners.add(listener)
  return () => {
    scopeListeners.delete(listener)
  }
}
function bumpScopeEpoch(): void {
  scopeEpoch += 1
  scopeListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      /* dinleyici hatası diğerlerini engellemesin */
    }
  })
}

// Evrensel personel onay kapısı: backend, Staff yazma isteğini taslağa (PendingOperation) düşürdüğünde
// { pendingApproval: true } döner. Global bir bildirimle kullanıcıya "onaya gönderildi" mesajı gösteririz.
export interface PendingApprovalInfo {
  message: string
  title?: string
}
export function isPendingApprovalResult(value: unknown): value is PendingApprovalInfo & { pendingApproval: true } {
  return Boolean(value && typeof value === 'object' && (value as { pendingApproval?: unknown }).pendingApproval === true)
}
let pendingApprovalHandler: ((info: PendingApprovalInfo) => void) | null = null
export function setPendingApprovalHandler(handler: ((info: PendingApprovalInfo) => void) | null): void {
  pendingApprovalHandler = handler
}

// Global 401 (oturum süresi doldu / geçersiz) bildirimi — root'taki SessionExpiredModal dinler.
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}
function notifyUnauthorized(): void {
  try {
    unauthorizedHandler?.()
  } catch {
    /* bildirim hatası akışı bozmasın */
  }
}

// ---- Otomatik token yenileme ----
// AuthProvider bir yenileme işleyicisi kaydeder: refresh token ile yeni erişim token'ı alır,
// oturumu (state + storage) günceller ve başarıyı döner. apiRequest 401 alınca bunu çağırır.
let refreshHandler: (() => Promise<boolean>) | null = null
export function setRefreshHandler(handler: (() => Promise<boolean>) | null): void {
  refreshHandler = handler
}
// Eşzamanlı 401'lerde tek bir yenileme isteği atılır (refresh token rotasyonu yarışını önler).
let refreshInFlight: Promise<boolean> | null = null
function tryRefreshToken(): Promise<boolean> {
  if (!refreshHandler) return Promise.resolve(false)
  if (!refreshInFlight) {
    const p = (async () => {
      try {
        return await refreshHandler!()
      } catch {
        return false
      }
    })()
    refreshInFlight = p
    void p.finally(() => {
      if (refreshInFlight === p) refreshInFlight = null
    })
  }
  return refreshInFlight
}
function notifyPendingApproval(value: unknown): void {
  if (!isPendingApprovalResult(value)) return
  try {
    pendingApprovalHandler?.({ message: value.message || 'İşlem onaya gönderildi.', title: value.title })
  } catch {
    /* bildirim hatası akışı bozmasın */
  }
}

export function setAccessToken(token: string | null | undefined): void {
  inMemoryAccessToken = token || null
}

interface ApiScopeInput {
  tenantId?: string | null
  branchId?: string | null
  selectedTenantId?: string | null
  selectedBranchId?: string | null
}

export function setApiScope(scope: ApiScopeInput | null | undefined = {}): void {
  const next: ApiScope = {
    tenantId: scope?.tenantId || scope?.selectedTenantId || null,
    branchId: scope?.branchId || scope?.selectedBranchId || null,
  }
  const changed = inMemoryApiScope.tenantId !== next.tenantId || inMemoryApiScope.branchId !== next.branchId
  inMemoryApiScope = next
  if (typeof window !== 'undefined') {
    if (next.tenantId || next.branchId) window.localStorage.setItem(API_SCOPE_STORAGE_KEY, JSON.stringify(next))
    else window.localStorage.removeItem(API_SCOPE_STORAGE_KEY)
  }
  if (changed) bumpScopeEpoch()
}

export function clearApiScope(): void {
  setApiScope(null)
}

export function getStoredApiScope(): ApiScope | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(API_SCOPE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ApiScope) : null
  } catch {
    return null
  }
}

/**
 * "Beni hatırla" tercihi. true → oturum localStorage'da (tarayıcı kapansa da kalır, kalıcı).
 * false → sessionStorage'da (sekme/tarayıcı kapanınca silinir, oturumluk). Varsayılan true
 * (mevcut davranışla uyumlu). Her iki durumda da token süresi dolunca otomatik yenilenir.
 */
export const REMEMBER_STORAGE_KEY = 'beautyasist.rememberMe'

export function getRememberMe(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(REMEMBER_STORAGE_KEY) !== '0'
}

export function setRememberMe(remember: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(REMEMBER_STORAGE_KEY, remember ? '1' : '0')
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    // Kalıcı (localStorage) ya da oturumluk (sessionStorage) — hangisinde varsa.
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY) || window.sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

export function storeSession(session: AuthSession | null): void {
  if (typeof window === 'undefined') return
  // Oturum değişimi (giriş/çıkış) → önceki kullanıcının önbelleğini temizle.
  clearApiCache()
  if (!session) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
    setAccessToken(null)
    clearApiScope()
    return
  }
  // "Beni hatırla" işaretliyse kalıcı (localStorage), değilse oturumluk (sessionStorage) sakla;
  // ikisinin de eşzamanlı kalmaması için diğerini temizle.
  const raw = JSON.stringify(session)
  if (getRememberMe()) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, raw)
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } else {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, raw)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  }
  setAccessToken(session.accessToken)
  setApiScope({
    tenantId: session.selectedTenantId || session.user?.tenantId,
    branchId: session.selectedBranchId || session.user?.branchId,
  })
}

export function clearSession(): void {
  storeSession(null)
}

function activeToken(): string | null {
  if (inMemoryAccessToken) return inMemoryAccessToken
  const session = getStoredSession()
  if (session?.accessToken) {
    setAccessToken(session.accessToken)
    return session.accessToken
  }
  return null
}

function activeApiScope(): ApiScope {
  if (inMemoryApiScope?.tenantId || inMemoryApiScope?.branchId) return inMemoryApiScope
  const storedScope = getStoredApiScope()
  if (storedScope?.tenantId || storedScope?.branchId) {
    inMemoryApiScope = { tenantId: storedScope.tenantId || null, branchId: storedScope.branchId || null }
    return inMemoryApiScope
  }
  const session = getStoredSession()
  if (session?.selectedTenantId || session?.selectedBranchId || session?.user?.tenantId || session?.user?.branchId) {
    inMemoryApiScope = {
      tenantId: session.selectedTenantId || session.user?.tenantId || null,
      branchId: session.selectedBranchId || session.user?.branchId || null,
    }
    return inMemoryApiScope
  }
  return { tenantId: null, branchId: null }
}

type QueryValue = string | number | boolean | null | undefined
export type QueryRecord = Record<string, QueryValue>

function normalizeQuery(query: QueryRecord | undefined): string {
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const str = params.toString()
  return str ? `?${str}` : ''
}

// GET yanıt önbelleği — sayfa geçişlerinde ve aynı veriyi birden çok bileşen istediğinde gereksiz
// tekrar çekmeyi keser. Anahtar URL + kapsam (tenant/şube) içerir (farklı kapsam = farklı veri).
// Kısa TTL + her yazma (POST/PUT/PATCH/DELETE) sonrası tam temizleme ile bayatlamaz.
interface ApiCacheEntry {
  data: unknown
  ts: number
}
const GET_CACHE_TTL_MS = 30_000
const apiGetCache = new Map<string, ApiCacheEntry>()
export function clearApiCache(): void {
  apiGetCache.clear()
}

// --- Çevrimdışı okuma desteği (yalnızca masaüstü kabuğu) -------------------------------
// Başarılı GET'ler IndexedDB'ye yansıtılır; ağ hatasında son bilinen veri oradan sunulur ve
// UI'nin "çevrimdışı — son bilinen veriler" şeridi gösterebilmesi için olay yayınlanır.
export const OFFLINE_DATA_EVENT = 'beautyasist-offline-data'

function isDesktopShell(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('BeautyAsistDesktop')
}

function notifyOfflineData(ts: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OFFLINE_DATA_EVENT, { detail: { ts } }))
}

// Çevrimdışı yazma kuyruğu (outbox): yalnızca bu KRİTİK akışlar kuyruğa alınır; geri kalan
// yazmalar çevrimdışıyken hata döner (salt-okunur). Kuyruk OutboxSync ile sunucuya oynatılır.
export const OUTBOX_EVENT = 'beautyasist-outbox-changed'

export interface QueuedOfflineResult {
  queuedOffline: true
  id: string
}

/** Yanıt çevrimdışı kuyruğa alınmış "sanal başarı" mı? Sayfalar bununla ayırt edebilir. */
export function isQueuedOffline(value: unknown): value is QueuedOfflineResult {
  return Boolean(value && typeof value === 'object' && (value as QueuedOfflineResult).queuedOffline === true)
}

const OUTBOX_RULES: ReadonlyArray<{ method: string; pattern: RegExp; label: string }> = [
  { method: 'POST', pattern: /^\/api\/admin\/appointments\/?$/, label: 'Yeni randevu' },
  { method: 'PATCH', pattern: /^\/api\/admin\/appointments\/[^/]+\/(schedule|status|notes)$/, label: 'Randevu güncelleme' },
  { method: 'POST', pattern: /^\/api\/admin\/customers\/?$/, label: 'Yeni müşteri' },
  { method: 'POST', pattern: /^\/api\/admin\/adisyonlar\/?$/, label: 'Yeni adisyon' },
  { method: 'PUT', pattern: /^\/api\/admin\/adisyonlar\/[^/]+$/, label: 'Adisyon güncelleme' },
  { method: 'POST', pattern: /^\/api\/admin\/adisyonlar\/[^/]+\/items$/, label: 'Adisyon kalemi ekleme' },
  { method: 'DELETE', pattern: /^\/api\/admin\/adisyonlar\/[^/]+\/items\/[^/]+$/, label: 'Adisyon kalemi silme' },
]

function outboxRuleFor(method: string, path: string): { label: string } | null {
  return OUTBOX_RULES.find((r) => r.method === method && r.pattern.test(path)) ?? null
}

export function notifyOutboxChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT))
}

export function unwrapApiResponse<T>(payload: unknown, status = 200): T {
  if (!payload || typeof payload !== 'object') return payload as T
  const envelope = payload as Partial<ApiEnvelope<T>>
  if ('success' in envelope) {
    if (envelope.success) return envelope.data as T
    const error = envelope.error || {}
    throw new ApiClientError(error.message || 'API isteği başarısız.', status, error.code, envelope.traceId)
  }
  return payload as T
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  const token = options.token === undefined ? activeToken() : options.token
  const scope = options.scope === undefined ? activeApiScope() : options.scope
  const requestQuery: QueryRecord = { ...(options.query || {}) }

  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  // Cihaz güvenliği + log zenginleştirme: her isteğe cihaz kimliği/bilgisi eklenir
  // (backend, özellik kapalıyken bu header'ları yok sayar).
  const deviceId = getDeviceId()
  if (deviceId) {
    headers.set('X-Device-Id', deviceId)
    const deviceInfo = getDeviceInfoHeader()
    if (deviceInfo) headers.set('X-Device-Info', deviceInfo)
  }
  if (scope !== false) {
    if (scope?.tenantId) headers.set('X-Tenant-Id', scope.tenantId)
    if (scope?.branchId) headers.set('X-Branch-Id', scope.branchId)
    if (path.startsWith('/api/admin/') && !requestQuery.tenantId && scope?.tenantId) {
      requestQuery.tenantId = scope.tenantId
    }
  }

  const query = normalizeQuery(requestQuery)

  // GET önbelleği: taze kayıt varsa ağ isteği yapmadan döndür.
  const method = (options.method || 'GET').toUpperCase()
  const cacheScope = scope === false ? null : scope
  const cacheable = method === 'GET' && Boolean(token) && options.noCache !== true
  const cacheKey = cacheable ? `${path}${query}|t=${cacheScope?.tenantId ?? ''}|b=${cacheScope?.branchId ?? ''}` : ''
  if (cacheable) {
    const hit = apiGetCache.get(cacheKey)
    if (hit && Date.now() - hit.ts < GET_CACHE_TTL_MS) return hit.data as T
  }

  // Çevrimdışı anahtar: bellek önbelleğiyle aynı bileşim (yol + sorgu + tenant/şube kapsamı).
  const offlineKey = `${path}${query}|t=${cacheScope?.tenantId ?? ''}|b=${cacheScope?.branchId ?? ''}`
  const offlineEligible =
    method === 'GET' && Boolean(token) && options.noCache !== true && path.startsWith('/api/') && isDesktopShell()

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}${query}`, {
      method: options.method || 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      cache: options.cache || 'no-store',
    })
  } catch (err) {
    // Ağ hatası (sunucuya ulaşılamadı). Masaüstünde GET ise son bilinen veriyi sun.
    if (offlineEligible) {
      const { offlineGet } = await import('./offlineStore')
      const hit = await offlineGet<T>(offlineKey)
      if (hit) {
        notifyOfflineData(hit.ts)
        return hit.data
      }
    }
    // Kritik yazma akışları masaüstünde çevrimdışı kuyruğa düşer; bağlantı gelince oynatılır.
    const outboxRule =
      !options._outboxBypass && method !== 'GET' && isDesktopShell() && !(options.body instanceof FormData)
        ? outboxRuleFor(method, path)
        : null
    if (outboxRule) {
      const { outboxAdd } = await import('./offlineStore')
      const id = crypto.randomUUID()
      await outboxAdd({
        id,
        seq: Date.now(),
        path: `${path}${query}`,
        method,
        body: options.body ?? null,
        tenantId: cacheScope?.tenantId ?? null,
        branchId: cacheScope?.branchId ?? null,
        label: outboxRule.label,
        queuedAt: Date.now(),
      })
      notifyOutboxChanged()
      notifyOfflineData(Date.now())
      return { queuedOffline: true, id } as T
    }
    throw new ApiClientError(
      'Sunucuya ulaşılamıyor — internet bağlantınızı kontrol edin.',
      0,
      'NetworkOffline',
      null,
    )
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { success: false, error: { code: 'InvalidJson', message: text }, traceId: null }
    }
  }

  if (!response.ok) {
    // Token gönderildiği halde 401 (auth uçları hariç): erişim token'ı süresi dolmuş olabilir.
    // Önce refresh token ile yenilemeyi dene, başarılıysa isteği BİR kez tekrarla. Yenileme
    // de başarısızsa (refresh token bitti) oturum gerçekten kapandı → global "tekrar giriş yap" modalı.
    if (response.status === 401 && token && !path.startsWith('/api/auth/')) {
      if (!options._retry) {
        const refreshed = await tryRefreshToken()
        if (refreshed) return apiRequest<T>(path, { ...options, _retry: true })
      }
      notifyUnauthorized()
    }
    if (payload && typeof payload === 'object' && 'success' in (payload as Record<string, unknown>)) {
      unwrapApiResponse(payload, response.status)
    }
    const traceId =
      payload && typeof payload === 'object' ? ((payload as { traceId?: string | null }).traceId ?? null) : null
    throw new ApiClientError(response.statusText || 'API isteği başarısız.', response.status, 'HttpError', traceId)
  }

  const result = unwrapApiResponse<T>(payload, response.status)
  notifyPendingApproval(result)
  // Başarılı GET'i önbelleğe al; başarılı yazma sonrası tüm önbelleği temizle (taze veri için).
  if (cacheable) apiGetCache.set(cacheKey, { data: result, ts: Date.now() })
  else if (method !== 'GET') clearApiCache()
  // Masaüstü çevrimdışı deposuna yansıt (arka planda, akışı bekletmez).
  if (offlineEligible) {
    void import('./offlineStore').then((m) => m.offlinePut(offlineKey, result)).catch(() => undefined)
  }
  return result
}

export const userRoles: Record<RoleKey, UserRole> = {
  admin: 'InstitutionOwner',
  personel: 'Staff',
  platform: 'PlatformAdmin',
}

export const roleLabels: Record<UserRole, string> = {
  PlatformAdmin: 'Platform Admin',
  InstitutionOwner: 'Kurum Yöneticisi',
  BranchManager: 'Şube Yöneticisi',
  Staff: 'Personel',
}

export function initials(nameOrEmail: string | null | undefined): string {
  const text = (nameOrEmail || '').trim()
  if (!text) return 'AR'
  const cleaned = text.includes('@') ? text.split('@')[0].replace(/[._-]+/g, ' ') : text
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR')
}

// ---------------------------------------------------------------------------
// API namespaces
// ---------------------------------------------------------------------------

interface HealthStatus {
  status?: string
  [key: string]: unknown
}

export const healthApi = {
  live: (): Promise<HealthStatus> => apiRequest<HealthStatus>('/health/live', { token: null, scope: false }),
  ready: (): Promise<HealthStatus> => apiRequest<HealthStatus>('/health/ready', { token: null, scope: false }),
}

interface LoginPayload {
  email: string
  password: string
  role: UserRole | string
  tenantId?: string | null
  branchId?: string | null
}

export const authApi = {
  loginScope: (email: string, role?: UserRole | string | null): Promise<ApiLoginScopeResponse> =>
    apiRequest<ApiLoginScopeResponse>('/api/auth/login-scope', {
      method: 'POST',
      body: { email, role: role ?? null },
      token: null,
      scope: false,
    }),
  login: ({ email, password, role, tenantId, branchId }: LoginPayload): Promise<ApiLoginResponse> =>
    apiRequest<ApiLoginResponse>('/api/auth/login', {
      method: 'POST',
      // Cihaz güvenliği: personel girişleri tanımlı cihaz kimliğiyle doğrulanır.
      body: { email, password, role, tenantId, branchId, deviceId: getDeviceId(), device: getDeviceInfo() },
      token: null,
      scope: false,
    }),
  refresh: (refreshToken: string): Promise<ApiLoginResponse> =>
    apiRequest<ApiLoginResponse>('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      token: null,
      scope: false,
    }),
  logout: (refreshToken: string): Promise<unknown> =>
    apiRequest<unknown>('/api/auth/logout', { method: 'POST', body: { refreshToken } }),
  me: (): Promise<ApiUser> => apiRequest<ApiUser>('/api/auth/me'),
  changePassword: <T = unknown>(currentPassword: string, newPassword: string): Promise<T> =>
    apiRequest<T>('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
}

// Platform tenant CRUD payload — UI form değerleri dinamik dolduruluyor; payload tipi gevşek tutulur.
type PlatformPayload = Record<string, unknown>

export const platformApi = {
  tenants: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/platform/tenants/', { query: { page: 1, pageSize: 100, ...query } }),
  /** Kurumun kullanım kılavuzunu sıfırlar — tüm kullanıcı/cihazlarda kılavuz yeniden gösterilir. */
  resetTenantGuide: <T = unknown>(tenantId: string): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${tenantId}/reset-guide`, { method: 'POST' }),

  /** Platform admin: seçilen kuruma Excel'den analiz edilmiş veriyi toplu aktarır. */
  bulkImport: <T = unknown>(tenantId: string, body: AdminPayload): Promise<T> =>
    apiRequest<T>('/api/platform/import/', { method: 'POST', query: { tenantId }, body }),
  tenantAvailability: <T = ApiTenantAvailability>(query: QueryRecord = {}): Promise<T> =>
    apiRequest<T>('/api/platform/tenants/availability', { query }),
  tenant: <T = unknown>(id: string): Promise<T> => apiRequest<T>(`/api/platform/tenants/${id}`),
  createTenant: <T = unknown>(body: PlatformPayload): Promise<T> =>
    apiRequest<T>('/api/platform/tenants/', { method: 'POST', body }),
  updateTenant: <T = unknown>(id: string, body: PlatformPayload): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}`, { method: 'PUT', body }),
  deleteTenant: (id: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/platform/tenants/${id}`, { method: 'DELETE' }),
  tenantPublicProfile: <T = unknown>(id: string): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/public-profile`),
  saveTenantPublicProfile: <T = unknown>(id: string, body: PlatformPayload): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/public-profile`, { method: 'PUT', body }),
  tenantFeatured: <T = { isFeatured: boolean }>(id: string): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/featured`),
  setTenantFeatured: <T = { isFeatured: boolean }>(id: string, isFeatured: boolean): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/featured`, { method: 'PUT', body: { isFeatured } }),
  setTenantLogo: <T = unknown>(id: string, imageData: string | null): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/public-profile/logo`, { method: 'PUT', body: { imageData } }),
  tenantGallery: <T = unknown>(id: string, kind?: string): Promise<T[]> =>
    apiRequest<T[]>(`/api/platform/tenants/${id}/gallery${kind ? `?kind=${kind}` : ''}`),
  addTenantGalleryPhoto: <T = unknown>(id: string, body: PlatformPayload): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/gallery`, { method: 'POST', body }),
  deleteTenantGalleryPhoto: (id: string, photoId: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/platform/tenants/${id}/gallery/${photoId}`, { method: 'DELETE' }),
  resetTenantOwnerPassword: <T = unknown>(id: string): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/reset-owner-password`, { method: 'POST' }),
  grantAccess: <T = unknown>(id: string, body: PlatformPayload): Promise<T> =>
    apiRequest<T>(`/api/platform/tenants/${id}/access`, { method: 'POST', body }),

  // Subscription Plans (Platform)
  subscriptionPlans: <T = unknown>(): Promise<T[]> =>
    apiRequest<T[]>('/api/platform/subscription-plans/'),
  createSubscriptionPlan: <T = unknown>(body: PlatformPayload): Promise<T> =>
    apiRequest<T>('/api/platform/subscription-plans/', { method: 'POST', body }),
  updateSubscriptionPlan: <T = unknown>(id: string, body: PlatformPayload): Promise<T> =>
    apiRequest<T>(`/api/platform/subscription-plans/${id}`, { method: 'PUT', body }),
  deleteSubscriptionPlan: (id: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/platform/subscription-plans/${id}`, { method: 'DELETE' }),
  assignPlanToTenant: (planId: string, tenantId: string, billingPeriod?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/platform/subscription-plans/${planId}/assign`, { method: 'POST', body: { tenantId, billingPeriod } }),

  // Messaging (Platform geneli SMS + E-posta altyapısı)
  messagingSettings: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/messaging/settings'),
  saveMessagingSettings: <T = unknown>(body: PlatformPayload): Promise<T> =>
    apiRequest<T>('/api/platform/messaging/settings', { method: 'PUT', body }),
  testSms: <T = unknown>(target: string): Promise<T> =>
    apiRequest<T>('/api/platform/messaging/test-sms', { method: 'POST', body: { target } }),
  testEmail: <T = unknown>(target: string): Promise<T> =>
    apiRequest<T>('/api/platform/messaging/test-email', { method: 'POST', body: { target } }),

  // Platform-wide usage summary
  platformUsage: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/usage'),

  // Sistem ayarları (bölüm bazlı JSON) + kurum faturaları
  systemSettings: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/system/settings'),
  saveSystemSection: <T = unknown>(section: string, values: Record<string, unknown>, maintenanceEnabled?: boolean): Promise<T> =>
    apiRequest<T>('/api/platform/system/settings', {
      method: 'PUT',
      body: { section, json: JSON.stringify(values), maintenanceEnabled: maintenanceEnabled ?? null },
    }),
  queueStatus: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/system/queue'),
  requeueJob: <T = unknown>(id: string): Promise<T> =>
    apiRequest<T>(`/api/platform/system/queue/${id}/requeue`, { method: 'POST' }),
  invoices: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/platform/invoices/', { query }),
  createInvoice: <T = unknown>(body: PlatformPayload): Promise<T> =>
    apiRequest<T>('/api/platform/invoices/', { method: 'POST', body }),
  generateInvoices: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/invoices/generate', { method: 'POST' }),
  updateInvoiceStatus: <T = unknown>(id: string, status: string): Promise<T> =>
    apiRequest<T>(`/api/platform/invoices/${id}/status`, { method: 'PUT', body: { status } }),
  deleteInvoice: <T = unknown>(id: string): Promise<T> =>
    apiRequest<T>(`/api/platform/invoices/${id}`, { method: 'DELETE' }),

  // Feature catalog — projedeki tüm flag'lenebilir özellikler (plan formu için)
  featuresCatalog: <T = unknown>(): Promise<T> =>
    apiRequest<T>('/api/platform/features-catalog'),
}

// Admin payload tipleri — backend modeli sıkı olmadığı için DTO yerine record<string, unknown>
type AdminPayload = Record<string, unknown>

export const adminApi = {
  // Kurum yöneticisinin kendi tenant'ı — profil + finans ayarları
  currentTenant: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/', { query: { tenantId } }),
  updateCurrentTenant: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/', { method: 'PUT', query: { tenantId }, body }),

  // Paket listesi (okuma — admin de görür) + kendi tenant'ın kullanımı
  subscriptionPlans: <T = unknown>(): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/subscription-plans'),
  currentTenantUsage: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/usage', { query: { tenantId } }),
  upgradeTenantPlan: <T = unknown>(subscriptionPlanId: string, tenantId?: string, billingPeriod?: string): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/upgrade', { method: 'POST', query: { tenantId }, body: { subscriptionPlanId, billingPeriod } }),

  // Aktif paket özellik listesi — useFeature hook tarafından çekilir
  tenantFeatures: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/features', { query: { tenantId } }),

  // Audit logs — sistem aktivite günlüğü
  auditLogs: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/logs/', { query: { page: 1, pageSize: 100, ...query } }),
  auditLogsAll: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/logs/all', { query }),
  deleteAllAuditLogs: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/logs/clear', { method: 'DELETE', query: { tenantId } }),

  // Uygulama-içi bildirim feed'i (/api/notifications — onay kapısı dışı). Masaüstü native
  // bildirim yoklaması kullanır; since=önceki yanıtın serverTimeUtc'si (saat kayması güvenli).
  notificationFeed: <T = unknown>(since?: string | null, take = 30): Promise<T> =>
    apiRequest<T>('/api/notifications/feed', { query: { since: since || undefined, take }, noCache: true }),

  // Masaüstü güvenlik olayları + personel ekran görüntüsü izni
  logDesktopEvent: <T = unknown>(eventType: 'FocusLost' | 'AppClosed', detail?: string): Promise<T> =>
    apiRequest<T>('/api/admin/security/desktop-events', { method: 'POST', body: { eventType, detail } }),
  screenshotSettings: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/security/screenshots', { query: { tenantId } }),
  updateScreenshotSettings: <T = unknown>(allowStaffScreenshots: boolean, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/security/screenshots', { method: 'PUT', query: { tenantId }, body: { allowStaffScreenshots } }),
  staffScreenshotOverrides: <T = unknown>(tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/security/screenshots/staff', { query: { tenantId } }),
  updateStaffScreenshotOverride: <T = unknown>(userId: string, allow: boolean | null, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/security/screenshots/staff/${userId}`, { method: 'PUT', query: { tenantId }, body: { allow } }),

  // Cihaz güvenliği — kurum ayarı + personel cihaz listesi/limiti
  deviceControlSettings: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/devices/settings', { query: { tenantId } }),
  updateDeviceControlSettings: <T = unknown>(enabled: boolean, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/devices/settings', { method: 'PUT', query: { tenantId }, body: { enabled } }),
  myDevices: <T = unknown>(): Promise<T[]> => apiRequest<T[]>('/api/admin/devices/me'),
  userDevices: <T = unknown>(userId: string, tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>(`/api/admin/devices/users/${userId}`, { query: { tenantId } }),
  userDeviceLimit: <T = unknown>(userId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/devices/users/${userId}/limit`, { query: { tenantId } }),
  setUserDeviceLimit: <T = unknown>(userId: string, maxDeviceCount: number | null, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/devices/users/${userId}/limit`, { method: 'PUT', query: { tenantId }, body: { maxDeviceCount } }),
  updateDevice: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/devices/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteDevice: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/devices/${id}`, { method: 'DELETE', query: { tenantId } }),

  branches: <T = unknown>(tenantId?: string): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/branches/', { query: { tenantId } }),
  createBranch: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/branches/', { method: 'POST', query: { tenantId }, body }),
  updateBranch: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/branches/${id}`, { method: 'PUT', query: { tenantId }, body }),

  /** Kullanım kılavuzu sıfırlama zamanı — PageGuide yerel "görüldü" kayıtlarıyla karşılaştırır. */
  tenantGuideReset: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/guide-reset', { query: { tenantId } }),

  /** Genel Excel içeri aktarma — analiz edilmiş satırlar (customers/services/packages) toplu kaydedilir. */
  bulkImport: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/import/', { method: 'POST', query: { tenantId }, body }),

  customers: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/customers/', { query: { page: 1, pageSize: 100, ...query } }),
  /** Dashboard müşteri istatistikleri — tüm listeyi çekmeden sayaç + gün-bazlı yeni müşteri trendi. */
  customersStats: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/customers/stats', { query: { tenantId } }),
  customer: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${id}`, { query: { tenantId } }),
  createCustomer: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/customers/', { method: 'POST', query: { tenantId }, body }),
  updateCustomer: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteCustomer: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/customers/${id}`, { method: 'DELETE', query: { tenantId } }),

  /** Onaylanmış paket/hizmet satışı olan müşteri Id'leri — randevu için ön şart. */
  customersWithApprovedSales: (tenantId?: string): Promise<string[]> =>
    apiRequest<string[]>('/api/admin/customers/with-approved-sales', { query: { tenantId } }),
  /** Kalan paket seansı olan müşteri Id'leri — yeni randevu modalı yalnızca bunları listeler. */
  customersWithBookableSessions: (tenantId?: string): Promise<string[]> =>
    apiRequest<string[]>('/api/admin/customers/with-bookable-sessions', { query: { tenantId } }),

  /** Kara liste — müşteriyi al/çıkar; kara listedekiye randevu verilemez. */
  setCustomerBlacklist: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${id}/blacklist`, { method: 'POST', query: { tenantId }, body }),
  blacklistedCustomers: <T = unknown>(tenantId?: string): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/customers/blacklisted', { query: { page: 1, pageSize: 200, tenantId } }),
  /** VIP etiketi ekle/kaldır. */
  setCustomerVip: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${id}/vip`, { method: 'POST', query: { tenantId }, body }),
  vipCustomers: <T = unknown>(tenantId?: string): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/customers/vip', { query: { page: 1, pageSize: 200, tenantId } }),
  /** Pasif müşteriler — eşik (gün) kadar süredir işlemsiz; eşik + liste döner. */
  passiveCustomers: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/customers/passive', { query: { tenantId } }),
  passiveThreshold: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/customers/passive-threshold', { query: { tenantId } }),
  setPassiveThreshold: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/customers/passive-threshold', { method: 'PUT', query: { tenantId }, body }),

  /** Müşteri işlem günlüğü — önce/sonra/süreç fotoğrafları (en yeni önce). */
  treatmentPhotos: <T = unknown>(customerId: string, tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>(`/api/admin/customers/${customerId}/treatment-photos`, { query: { tenantId } }),
  addTreatmentPhoto: <T = unknown>(customerId: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${customerId}/treatment-photos`, { method: 'POST', query: { tenantId }, body }),
  deleteTreatmentPhoto: (customerId: string, id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/customers/${customerId}/treatment-photos/${id}`, { method: 'DELETE', query: { tenantId } }),

  /** Müşteri bilgi ve onay formu — müşteri başına tek (null = henüz yok). */
  consultation: <T = unknown>(customerId: string, tenantId?: string): Promise<T | null> =>
    apiRequest<T | null>(`/api/admin/customers/${customerId}/consultation`, { query: { tenantId } }),
  upsertConsultation: <T = unknown>(customerId: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/customers/${customerId}/consultation`, { method: 'PUT', query: { tenantId }, body }),
  // "Özel" bölümü — kuruma/şubeye özel işaretlenebilir seçenek kütüphanesi.
  consultationOptions: <T = unknown>(branchId?: string, tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/consultation-options', { query: { branchId, tenantId } }),
  deleteConsultationOption: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/consultation-options/${id}`, { method: 'DELETE', query: { tenantId } }),

  /** WhatsApp hatırlatma ayarları + 2 yönlü onay. */
  whatsappSettings: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/whatsapp/settings', { query: { tenantId } }),
  saveWhatsappSettings: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/whatsapp/settings', { method: 'PUT', query: { tenantId }, body }),
  sendWhatsappReminder: <T = unknown>(appointmentId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/whatsapp/reminder/${appointmentId}`, { method: 'POST', query: { tenantId }, body: {} }),
  whatsappMessages: <T = unknown>(appointmentId?: string, tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/whatsapp/messages', { query: { appointmentId, tenantId } }),
  staff: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/staff/', { query: { page: 1, pageSize: 100, ...query } }),
  createStaff: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/staff/', { method: 'POST', query: { tenantId }, body }),
  updateStaff: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/staff/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteStaff: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/staff/${id}`, { method: 'DELETE', query: { tenantId } }),
  resetStaffPassword: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/staff/${id}/reset-password`, { method: 'POST', query: { tenantId } }),
  /** Personeli başka şubeye aktarır (çok şubeli kurum). */
  transferStaffBranch: <T = unknown>(id: string, branchId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/staff/${id}/transfer-branch`, { method: 'POST', query: { tenantId }, body: { branchId } }),
  staffPermissions: <T = unknown>(): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/staff/permissions'),
  /** Randevu tamamlanınca müşteri puanlama linki (QR token) üretir. */
  issueRating: <T = unknown>(appointmentId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/ratings/issue', { method: 'POST', query: { tenantId }, body: { appointmentId } }),
  /** Public puanlama durumu — anonim, token üzerinden (auth/scope yok). */
  publicRating: <T = unknown>(token: string): Promise<T> =>
    apiRequest<T>(`/api/public/ratings/${token}`, { token: null, scope: false, noCache: true }),
  /** Public yıldız gönderimi — anonim (telefon + yıldız). */
  // Salon vitrini (public profil + galeri) — kurum yöneticisi
  publicProfile: <T = unknown>(): Promise<T> => apiRequest<T>('/api/admin/tenant/public-profile'),
  savePublicProfile: <T = unknown>(body: Record<string, unknown>): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/public-profile', { method: 'PUT', body }),
  setSalonLogo: <T = unknown>(imageData: string | null): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/public-profile/logo', { method: 'PUT', body: { imageData } }),
  galleryPhotos: <T = unknown>(kind?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/tenant/gallery', { query: kind ? { kind } : {} }),
  addGalleryPhoto: <T = unknown>(body: { kind: string; imageData: string; caption?: string | null }): Promise<T> =>
    apiRequest<T>('/api/admin/tenant/gallery', { method: 'POST', body }),
  deleteGalleryPhoto: (photoId: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/tenant/gallery/${photoId}`, { method: 'DELETE' }),

  submitRating: <T = unknown>(token: string, body: { phone: string; stars: number; salonStars?: number; comment?: string | null }): Promise<T> =>
    apiRequest<T>(`/api/public/ratings/${token}`, { method: 'POST', token: null, scope: false, body }),

  services: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/services/', { query: { page: 1, pageSize: 100, ...query } }),
  createService: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/services/', { method: 'POST', query: { tenantId }, body }),
  updateService: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/services/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteService: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/services/${id}`, { method: 'DELETE', query: { tenantId } }),

  packages: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/packages/', { query: { page: 1, pageSize: 100, ...query } }),
  createPackage: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/packages/', { method: 'POST', query: { tenantId }, body }),
  updatePackage: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/packages/${id}`, { method: 'PUT', query: { tenantId }, body }),
  updatePackageCategory: <T = unknown>(id: string, category: string | null, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/packages/${id}/category`, { method: 'PATCH', query: { tenantId }, body: { category } }),
  deletePackage: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/packages/${id}`, { method: 'DELETE', query: { tenantId } }),

  appointments: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/appointments/', { query: { page: 1, pageSize: 100, ...query } }),
  /** Kurum yöneticisi aksiyon kutusu: saati gelmiş randevular + onay bekleyen taslaklar. */
  appointmentInbox: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/appointments/inbox', { query: { tenantId } }),
  createAppointment: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/appointments/', { method: 'POST', query: { tenantId }, body }),
  /** Taslak randevuyu aktif randevuya çevirir (kurum yöneticisi onayı). */
  approveAppointment: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/appointments/${id}/approve`, { method: 'POST', query: { tenantId } }),
  rescheduleAppointment: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/appointments/${id}/schedule`, { method: 'PATCH', query: { tenantId }, body }),
  changeAppointmentStatus: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/appointments/${id}/status`, { method: 'PATCH', query: { tenantId }, body }),
  changeAppointmentNotes: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/appointments/${id}/notes`, { method: 'PATCH', query: { tenantId }, body }),
  deleteAppointment: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/appointments/${id}`, { method: 'DELETE', query: { tenantId } }),

  accounts: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/accounts/', { query: { page: 1, pageSize: 100, ...query } }),
  /** Pano "Paket Raporu": paket satışı, yapılacak seans, ay ay taksit takvimi (tek sorgu).
   *  fromUtc/toUtc verilirse rapor o dönemde satılan paketlere göre süzülür (günlük/aylık/yıllık). */
  accountReport: <T = unknown>(tenantId?: string, months = 6, fromUtc?: string, toUtc?: string): Promise<T> =>
    apiRequest<T>('/api/admin/accounts/report', { query: { tenantId, months, fromUtc, toUtc } }),
  // Müşterinin paketlerindeki hizmet-bazlı kalan seans bakiyeleri
  customerSessions: <T = unknown>(customerId: string, tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>(`/api/admin/accounts/sessions/${customerId}`, { query: { tenantId } }),
  account: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/accounts/${id}`, { query: { tenantId } }),
  createAccount: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/accounts/', { method: 'POST', query: { tenantId }, body }),
  updateAccount: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/accounts/${id}`, { method: 'PUT', query: { tenantId }, body }),
  rescheduleAccount: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/accounts/${id}/reschedule`, { method: 'PATCH', query: { tenantId }, body }),
  registerAccountPayment: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/accounts/${id}/payments`, { method: 'POST', query: { tenantId }, body }),
  deleteAccount: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/accounts/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Adisyon (onaylı cari aktarım katmanı) ----------
  adisyonlar: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/adisyonlar/', { query: { page: 1, pageSize: 100, ...query } }),
  openAdisyon: <T = unknown>(customerId: string, tenantId?: string): Promise<T | null> =>
    apiRequest<T | null>(`/api/admin/adisyonlar/open/${customerId}`, { query: { tenantId } }),
  createAdisyon: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/adisyonlar/', { method: 'POST', query: { tenantId }, body }),
  updateAdisyon: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}`, { method: 'PUT', query: { tenantId }, body }),
  addAdisyonItem: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}/items`, { method: 'POST', query: { tenantId }, body }),
  removeAdisyonItem: <T = unknown>(id: string, itemId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}/items/${itemId}`, { method: 'DELETE', query: { tenantId } }),
  applyAdisyonGiftCard: <T = unknown>(id: string, code: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}/gift-card`, { method: 'POST', query: { tenantId }, body: { code } }),
  approveAdisyon: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}/approve`, { method: 'POST', query: { tenantId } }),
  cancelAdisyon: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/adisyonlar/${id}/cancel`, { method: 'POST', query: { tenantId } }),

  // ---------- Personel primi (2B) ----------
  commissions: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/commissions/', { query }),
  commissionSummary: <T = unknown>(query: QueryRecord = {}): Promise<T> =>
    apiRequest<T>('/api/admin/commissions/summary', { query }),
  payCommission: <T = unknown>(staffMemberId: string, query: QueryRecord = {}): Promise<T> =>
    apiRequest<T>(`/api/admin/commissions/pay/${staffMemberId}`, { method: 'POST', query }),

  // ---------- Personel çizelge / izin (4A) ----------
  timeOff: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/schedule/timeoff', { query }),
  addTimeOff: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/schedule/timeoff', { method: 'POST', query: { tenantId }, body }),
  removeTimeOff: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/schedule/timeoff/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Kampanya (4C) ----------
  campaigns: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/campaigns/', { query }),
  createCampaign: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/campaigns/', { method: 'POST', query: { tenantId }, body }),
  updateCampaign: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/campaigns/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteCampaign: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/campaigns/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Hediye çeki / kupon (Faz 1.1) ----------
  giftCards: <T = unknown>(tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/gift-cards/', { query: { tenantId } }),
  validateGiftCard: <T = unknown>(code: string, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/gift-cards/validate', { query: { code, tenantId } }),
  createGiftCard: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/gift-cards/', { method: 'POST', query: { tenantId }, body }),
  redeemGiftCard: <T = unknown>(id: string, amount: number, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/gift-cards/${id}/redeem`, { method: 'POST', query: { tenantId }, body: { amount } }),
  setGiftCardActive: <T = unknown>(id: string, active: boolean, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/gift-cards/${id}/active`, { method: 'POST', query: { tenantId }, body: { active } }),
  deleteGiftCard: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/gift-cards/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Bekleme listesi (Faz 1.3) ----------
  waitlist: <T = unknown>(tenantId?: string, activeOnly?: boolean): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/waitlist/', { query: { tenantId, activeOnly } }),
  addWaitlist: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/waitlist/', { method: 'POST', query: { tenantId }, body }),
  setWaitlistStatus: <T = unknown>(id: string, status: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/waitlist/${id}/status`, { method: 'POST', query: { tenantId }, body: { status } }),
  // Manuel "Yer öner": kaydı Notified yapıp WhatsApp teklif mesajı gönderir.
  offerWaitlist: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/waitlist/${id}/offer`, { method: 'POST', query: { tenantId } }),
  // Manuel "Randevuya çevir": teklifi randevuya dönüştürür (yeni randevu id'si döner).
  bookWaitlist: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/waitlist/${id}/book`, { method: 'POST', query: { tenantId } }),
  deleteWaitlist: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/waitlist/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Gün sonu kasa kapanışı / Z raporu (Faz 1.2) ----------
  cashClosings: <T = unknown>(tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/cash/closing/', { query: { tenantId } }),
  cashClosingPreview: <T = unknown>(query: QueryRecord, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/cash/closing/preview', { query: { ...query, tenantId } }),
  createCashClosing: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/cash/closing/', { method: 'POST', query: { tenantId }, body }),
  deleteCashClosing: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/cash/closing/${id}`, { method: 'DELETE', query: { tenantId } }),

  // ---------- Sadakat / puan (4B) ----------
  loyaltyBalance: <T = unknown>(customerId: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/loyalty/${customerId}`, { query: { tenantId } }),
  adjustLoyalty: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/loyalty/adjust', { method: 'POST', query: { tenantId }, body }),

  expenses: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/expenses/', { query: { page: 1, pageSize: 100, ...query } }),
  expenseSummary: <T = unknown>(query: QueryRecord = {}): Promise<T> =>
    apiRequest<T>('/api/admin/expenses/summary', { query }),
  createExpense: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/expenses/', { method: 'POST', query: { tenantId }, body }),
  updateExpense: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/expenses/${id}`, { method: 'PUT', query: { tenantId }, body }),
  approveExpense: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/expenses/${id}/approve`, { method: 'PATCH', query: { tenantId } }),
  deleteExpense: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/expenses/${id}`, { method: 'DELETE', query: { tenantId } }),

  expenseCategories: <T = unknown>(tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/expense-categories/', { query: { tenantId } }),
  createExpenseCategory: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/expense-categories/', { method: 'POST', query: { tenantId }, body }),
  updateExpenseCategory: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/expense-categories/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteExpenseCategory: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/expense-categories/${id}`, { method: 'DELETE', query: { tenantId } }),

  cashFlow: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/cash-flow/', { query }),
  cashFlowSummary: <T = unknown>(query: QueryRecord = {}): Promise<T> =>
    apiRequest<T>('/api/admin/cash-flow/summary', { query }),

  products: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/products/', { query: { page: 1, pageSize: 200, ...query } }),
  productSummary: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/products/summary', { query: { tenantId } }),
  createProduct: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/products/', { method: 'POST', query: { tenantId }, body }),
  updateProduct: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/products/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteProduct: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/products/${id}`, { method: 'DELETE', query: { tenantId } }),
  addStockMovement: <T = unknown>(productId: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/products/${productId}/movements`, { method: 'POST', query: { tenantId }, body }),
  stockMovements: <T = unknown>(query: QueryRecord = {}): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/stock-movements/', { query: { limit: 50, ...query } }),

  // Onay kuyruğu — personel işlemleri pending'e düşer, kurum yöneticisi onaylar/reddeder
  pendingOperations: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/pending-operations/', { query: { page: 1, pageSize: 100, ...query } }),
  createPendingOperation: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/pending-operations/', { method: 'POST', query: { tenantId }, body }),
  approvePendingOperation: <T = unknown>(id: string, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/pending-operations/${id}/approve`, { method: 'PATCH', query: { tenantId } }),
  rejectPendingOperation: <T = unknown>(id: string, reason?: string | null, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/pending-operations/${id}/reject`, { method: 'PATCH', query: { tenantId }, body: { reason: reason || null } }),
  cancelPendingOperation: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/pending-operations/${id}/cancel`, { method: 'PATCH', query: { tenantId } }),

  // Notifications — SMS / WhatsApp / E-posta şablonları + gönderim logları
  notificationTemplates: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/notification-templates/', { query: { page: 1, pageSize: 100, ...query } }),
  createNotificationTemplate: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/notification-templates/', { method: 'POST', query: { tenantId }, body }),
  updateNotificationTemplate: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/notification-templates/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteNotificationTemplate: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/notification-templates/${id}`, { method: 'DELETE', query: { tenantId } }),
  sendNotification: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/notification-templates/send', { method: 'POST', query: { tenantId }, body }),
  runPaymentReminders: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/notification-templates/payment-reminders/run', { method: 'POST', query: { tenantId } }),
  notificationLogs: <T = unknown>(query: QueryRecord = {}): Promise<PagedResult<T>> =>
    apiRequest<PagedResult<T>>('/api/admin/notification-logs/', { query: { page: 1, pageSize: 100, ...query } }),
  notificationSummary: <T = unknown>(tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/notifications/summary', { query: { tenantId } }),

  serviceCategories: <T = unknown>(tenantId?: string): Promise<T[]> =>
    apiRequest<T[]>('/api/admin/service-categories/', { query: { tenantId } }),
  createServiceCategory: <T = unknown>(body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>('/api/admin/service-categories/', { method: 'POST', query: { tenantId }, body }),
  updateServiceCategory: <T = unknown>(id: string, body: AdminPayload, tenantId?: string): Promise<T> =>
    apiRequest<T>(`/api/admin/service-categories/${id}`, { method: 'PUT', query: { tenantId }, body }),
  deleteServiceCategory: (id: string, tenantId?: string): Promise<unknown> =>
    apiRequest<unknown>(`/api/admin/service-categories/${id}`, { method: 'DELETE', query: { tenantId } }),
}

export function pagedItems<T>(result: PagedResult<T> | T[] | null | undefined): T[] {
  if (Array.isArray(result)) return result
  return result?.items || []
}

/**
 * Sayfalı bir ucu total'e ulaşana kadar sayfa sayfa çekip TÜM kayıtları döndürür.
 * Büyük listelerde (ör. 12 bin müşteri) tek istekte tavana takılmamak için 1000'lik
 * sayfalarla ilerler; emniyet için en fazla 100 sayfa (100 bin kayıt) dener.
 */
export async function fetchAllPaged<T>(
  loader: (page: number, pageSize: number) => Promise<PagedResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const first = await loader(1, pageSize)
  const items = [...pagedItems(first)]
  const total = first?.total ?? first?.totalCount ?? items.length
  let page = 2
  while (items.length < total && page <= 100) {
    const next = await loader(page, pageSize)
    const batch = pagedItems(next)
    if (!batch.length) break
    items.push(...batch)
    page++
  }
  return items
}
