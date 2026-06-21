'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AUTH_STORAGE_KEY,
  authApi,
  clearSession,
  getStoredSession,
  initials,
  roleLabels,
  setAccessToken,
  setApiScope,
  setRefreshHandler,
  setRememberMe,
  storeSession,
  userRoles,
} from '@/lib/apiClient'
import type {
  ApiLoginResponse,
  ApiLoginScopeBranch,
  ApiLoginScopeResponse,
  ApiLoginScopeTenant,
  AuthSession,
  Branch,
  Institution,
  RoleKey,
  SessionScope,
  SessionUser,
  UserRole,
} from '@/lib/types'

interface AuthContextValue {
  hydrated: boolean
  session: AuthSession | null
  user: SessionUser | null
  isAuthenticated: boolean
  authError: string
  setAuthError: (value: string) => void
  loginScope: (input: { email: string; roleKey?: RoleKey | UserRole | null }) => Promise<NormalizedScopeResponse>
  login: (input: LoginInput) => Promise<AuthSession | null>
  logout: () => Promise<void>
  refresh: () => Promise<AuthSession | null>
  setSession: (session: AuthSession | null) => void
}

interface LoginInput {
  email: string
  password: string
  roleKey: RoleKey | UserRole
  tenantId?: string | null
  branchId?: string | null
  scope?: NormalizedScopeResponse | null
  /** "Beni hatırla": true → kalıcı oturum (localStorage + otomatik yenileme), false → oturumluk. */
  remember?: boolean
}

interface NormalizedScopeResponse extends Omit<ApiLoginScopeResponse, 'tenants' | 'role'> {
  /** Sorguda rol gönderilmediyse backend'in e-postadan tespit ettiği rol; bulunamazsa null. */
  role: UserRole | string | null
  tenants: Institution[]
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeScopeBranch(branch: ApiLoginScopeBranch): Branch {
  const id = branch.branchId
  return {
    id,
    branchId: id,
    name: branch.branchName,
    branchName: branch.branchName,
    city: branch.city || 'Şube',
    isDefault: Boolean(branch.isDefault),
    staff: branch.staff || 0,
    rooms: branch.rooms || 0,
    todayAppointments: 0,
    monthlyRevenue: 0,
  }
}

function normalizeScopeTenant(tenant: ApiLoginScopeTenant | null | undefined): Institution | null {
  if (!tenant) return null
  const id = tenant.tenantId
  return {
    id,
    tenantId: id,
    name: tenant.tenantName,
    tenantName: tenant.tenantName,
    plan: tenant.plan || 'Aktif plan',
    status: tenant.status || 'active',
    branches: (tenant.branches || []).map(normalizeScopeBranch),
  }
}

function normalizeSession(
  loginResponse: ApiLoginResponse,
  extra: { scope?: SessionScope | null; selectedTenantId?: string | null; selectedBranchId?: string | null } = {},
): AuthSession {
  const apiUser = loginResponse.user
  const role = apiUser.role
  const sessionUser: SessionUser = {
    userId: apiUser.userId,
    email: apiUser.email,
    fullName: apiUser.fullName ?? null,
    role,
    roleLabel: roleLabels[role] || role || 'Kullanıcı',
    tenantId: apiUser.tenantId ?? null,
    branchId: apiUser.branchId ?? null,
    permissions: apiUser.permissions || [],
    mustChangePassword: apiUser.mustChangePassword ?? false,
    avatar: initials(apiUser.fullName || apiUser.email),
  }
  return {
    accessToken: loginResponse.accessToken,
    refreshToken: loginResponse.refreshToken,
    expiresAtUtc: loginResponse.expiresAtUtc,
    user: sessionUser,
    scope: extra.scope ?? null,
    selectedTenantId: extra.selectedTenantId ?? apiUser.tenantId ?? null,
    selectedBranchId: extra.selectedBranchId ?? apiUser.branchId ?? null,
    createdAt: new Date().toISOString(),
  }
}

function resolveRole(roleKey: RoleKey | UserRole): UserRole {
  if ((['admin', 'personel', 'platform'] as const).includes(roleKey as RoleKey)) {
    return userRoles[roleKey as RoleKey]
  }
  return roleKey as UserRole
}

/** ISO tarihi UTC ms'e çevirir; saat dilimi işareti yoksa UTC kabul eder (backend gotcha'sı). */
function parseUtcMs(value?: string | null): number {
  if (!value) return 0
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(value)
  const ms = new Date(hasTz ? value : `${value}Z`).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(null)
  const [hydrated, setHydrated] = useState<boolean>(false)
  const [authError, setAuthError] = useState<string>('')

  useEffect(() => {
    const stored = getStoredSession()
    if (stored?.accessToken) {
      setAccessToken(stored.accessToken)
      setApiScope({
        tenantId: stored.selectedTenantId || stored.user?.tenantId,
        branchId: stored.selectedBranchId || stored.user?.branchId,
      })
      setSessionState(stored)
    }
    setHydrated(true)
  }, [])

  const persist = useCallback((nextSession: AuthSession | null) => {
    setSessionState(nextSession)
    if (nextSession?.accessToken) {
      setApiScope({
        tenantId: nextSession.selectedTenantId || nextSession.user?.tenantId,
        branchId: nextSession.selectedBranchId || nextSession.user?.branchId,
      })
    }
    storeSession(nextSession)
  }, [])

  const loginScope = useCallback(
    async ({ email, roleKey }: { email: string; roleKey?: RoleKey | UserRole | null }): Promise<NormalizedScopeResponse> => {
      setAuthError('')
      const role = roleKey ? resolveRole(roleKey) : null
      const response = await authApi.loginScope(email, role)
      return {
        ...response,
        role: role ?? response?.role ?? null,
        tenants: (response?.tenants || [])
          .map(normalizeScopeTenant)
          .filter((tenant): tenant is Institution => tenant !== null),
      }
    },
    [],
  )

  const login = useCallback(
    async ({ email, password, roleKey, tenantId, branchId, scope, remember = true }: LoginInput): Promise<AuthSession | null> => {
      setAuthError('')
      // "Beni hatırla" tercihini persist'ten ÖNCE yaz; storeSession buna göre kalıcı/oturumluk seçer.
      setRememberMe(remember)
      const role = resolveRole(roleKey)
      const response = await authApi.login({ email, password, role, tenantId: tenantId || null, branchId: branchId || null })
      const matchingTenant = (scope?.tenants || []).find(
        (tenant) => tenant.id === tenantId || tenant.tenantId === tenantId,
      )
      const nextScope: SessionScope | null = matchingTenant ? { tenants: [matchingTenant] } : scope ? { tenants: scope.tenants } : null
      const nextSession = normalizeSession(response, {
        scope: nextScope,
        selectedTenantId: tenantId || response?.user?.tenantId || null,
        selectedBranchId: branchId || response?.user?.branchId || null,
      })
      persist(nextSession)
      return nextSession
    },
    [persist],
  )

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = session?.refreshToken
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // Sunucu revoke başarısız olsa bile local oturum temizlenir.
    }
    clearSession()
    setSessionState(null)
  }, [session?.refreshToken])

  // Tek-uçuş: aynı anda gelen yenileme çağrıları (proaktif zamanlayıcı + 401 tetikli) tek bir
  // refresh isteğini paylaşır; aksi halde refresh token rotasyonu çifte tetiklenip biri başarısız olur.
  const refreshingRef = useRef<Promise<AuthSession | null> | null>(null)
  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    // Refresh token'ı state yerine STORAGE'dan oku: sayfa ilk yüklenirken (hydration tamamlanmadan)
    // gelen 401'lerde React state henüz dolmamış olabilir; storage her zaman güncel kaynaktır.
    const stored = getStoredSession()
    const refreshToken = session?.refreshToken ?? stored?.refreshToken
    if (!refreshToken) return null
    if (refreshingRef.current) return refreshingRef.current
    const p = (async () => {
      try {
        const response = await authApi.refresh(refreshToken)
        const nextSession = normalizeSession(response, {
          scope: session?.scope ?? stored?.scope ?? null,
          selectedTenantId: session?.selectedTenantId ?? stored?.selectedTenantId ?? null,
          selectedBranchId: session?.selectedBranchId ?? stored?.selectedBranchId ?? null,
        })
        persist(nextSession)
        return nextSession
      } finally {
        refreshingRef.current = null
      }
    })()
    refreshingRef.current = p
    return p
  }, [persist, session])

  // apiRequest 401 alınca çağıracağı yenileme işleyicisi — her zaman en güncel refresh'i kullanır.
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])
  useEffect(() => {
    setRefreshHandler(async () => Boolean(await refreshRef.current()))
    return () => setRefreshHandler(null)
  }, [])

  // Proaktif yenileme: erişim token'ı dolmadan ~1 dk önce sessizce yenilenir. Böylece kullanıcı
  // (özellikle "beni hatırla" açıkken) token süresi dolduğu için ASLA otomatik atılmaz. Yenileme
  // başarısız olursa (refresh token bitti) sessiz kalır; sonraki istek 401'inde modal devreye girer.
  useEffect(() => {
    if (!session?.accessToken || !session.refreshToken) return
    const expMs = parseUtcMs(session.expiresAtUtc)
    const delay = expMs ? Math.max(0, expMs - Date.now() - 60_000) : 50 * 60_000
    const id = window.setTimeout(() => {
      void refreshRef.current().catch(() => {})
    }, Math.min(delay, 0x7fffffff))
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, session?.expiresAtUtc])

  // Çok sekmeli güvenlik: başka sekme oturumu yenilediğinde/çıkış yaptığında (localStorage değişir)
  // bu sekme de aynı duruma geçsin — rotasyon yarışı yüzünden yanlışlıkla çıkış yapılmasın.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key && e.key !== AUTH_STORAGE_KEY) return
      const stored = getStoredSession()
      if (stored?.accessToken) {
        setAccessToken(stored.accessToken)
        setSessionState(stored)
      } else {
        setSessionState(null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      session,
      user: session?.user || null,
      isAuthenticated: Boolean(session?.accessToken),
      authError,
      setAuthError,
      loginScope,
      login,
      logout,
      refresh,
      setSession: persist,
    }),
    [hydrated, session, authError, loginScope, login, logout, refresh, persist],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

const fallbackAuth: AuthContextValue = {
  hydrated: true,
  session: null,
  user: null,
  isAuthenticated: false,
  authError: '',
  setAuthError: () => {},
  loginScope: async () => ({ tenants: [], role: 'Staff' }),
  login: async () => null,
  logout: async () => {},
  refresh: async () => null,
  setSession: () => {},
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  return ctx ?? fallbackAuth
}
