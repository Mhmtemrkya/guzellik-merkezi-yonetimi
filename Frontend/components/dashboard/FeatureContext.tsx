'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { adminApi } from '@/lib/apiClient'
import { normalizeTenantFeatures } from '@/lib/apiMappers'
import type { ApiTenantFeatures, FeatureKey, TenantFeatures } from '@/lib/types'
import { useAuth } from './AuthContext'

/**
 * Plan/paket özellik kapısı (entitlement).
 *
 * Tasarım ilkeleri (SaaS entitlement best practice):
 *  - Sunucu tek doğruluk kaynağıdır: özellikler her zaman /api/admin/features'tan gelir.
 *  - Client sürekli yeniden doğrular: ilk yükleme + sekme odağı + görünürlük + periyodik.
 *    Böylece plan downgrade/upgrade aynı oturumda hızla yansır.
 *  - Aksiyon anında doğrulama: korumalı bir işlem (Excel export/import gibi) çalışmadan
 *    ÖNCE `revalidateHas()` ile taze sunucu kontrolü yapılır; UI bayat olsa bile işlem reddedilir.
 */

const REVALIDATE_INTERVAL_MS = 45_000

interface FeatureContextValue {
  loading: boolean
  features: TenantFeatures | null
  has: (key: FeatureKey) => boolean
  hasAny: (...keys: FeatureKey[]) => boolean
  hasAll: (...keys: FeatureKey[]) => boolean
  /** Arka planda taze çeker (global loading'i titretmez). */
  refresh: () => Promise<void>
  /** Sunucudan taze çeker ve güncel feature setini döndürür. */
  revalidate: () => Promise<TenantFeatures | null>
  /** Aksiyon anı kesin kontrol: sunucudan taze çekip key'in izinli olup olmadığını döndürür. */
  revalidateHas: (key: FeatureKey) => Promise<boolean>
}

const FeatureContext = createContext<FeatureContextValue | null>(null)

const EMPTY_SET = new Set<FeatureKey>()

const PLATFORM_DEFAULT: TenantFeatures = {
  tenantId: '',
  planId: null,
  planKey: 'Platform',
  planName: 'Platform',
  activeFeatures: EMPTY_SET,
}

export function FeatureProvider({ children }: { children: ReactNode }) {
  const { session, isAuthenticated, user } = useAuth()
  const [features, setFeatures] = useState<TenantFeatures | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  const tenantId = session?.selectedTenantId || user?.tenantId || ''
  const isPlatformAdmin = user?.role === 'PlatformAdmin'

  // Yarış koşulu koruması: yalnızca en son isteğin sonucu state'e yazılır.
  const reqSeq = useRef(0)

  const fetchFeatures = useCallback(
    async (opts?: { background?: boolean }): Promise<TenantFeatures | null> => {
      if (!isAuthenticated) {
        setFeatures(null)
        return null
      }
      // Platform admin kurum seçmediyse kurum bağlamı yok — has() zaten true döndürür.
      if (isPlatformAdmin && !tenantId) {
        setFeatures(PLATFORM_DEFAULT)
        return PLATFORM_DEFAULT
      }
      if (!tenantId) {
        setFeatures(null)
        return null
      }

      const seq = ++reqSeq.current
      const showLoading = !opts?.background
      if (showLoading) setLoading(true)
      try {
        const resp = await adminApi.tenantFeatures<ApiTenantFeatures>(tenantId)
        const normalized = normalizeTenantFeatures(resp)
        if (reqSeq.current === seq) setFeatures(normalized)
        return normalized
      } catch {
        // Hata durumunda muhafazakar davran: hiçbir özellik aktif değil.
        const empty: TenantFeatures = {
          tenantId,
          planId: null,
          planKey: '',
          planName: '',
          activeFeatures: new Set<FeatureKey>(),
        }
        if (reqSeq.current === seq) setFeatures(empty)
        return empty
      } finally {
        if (showLoading && reqSeq.current === seq) setLoading(false)
      }
    },
    [isAuthenticated, isPlatformAdmin, tenantId],
  )

  // İlk yükleme + tenant/oturum değişimi
  useEffect(() => {
    fetchFeatures()
  }, [fetchFeatures])

  // Canlı yeniden doğrulama: sekmeye dönünce, pencere odaklanınca, periyodik.
  // Plan değişikliğini (downgrade dahil) aynı oturumda hızla yansıtır.
  useEffect(() => {
    if (!isAuthenticated) return
    if (isPlatformAdmin && !tenantId) return
    if (!tenantId) return

    const revalidateBg = () => { void fetchFeatures({ background: true }) }
    const onVisible = () => { if (document.visibilityState === 'visible') revalidateBg() }

    window.addEventListener('focus', revalidateBg)
    document.addEventListener('visibilitychange', onVisible)
    const intervalId = window.setInterval(revalidateBg, REVALIDATE_INTERVAL_MS)

    return () => {
      window.removeEventListener('focus', revalidateBg)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(intervalId)
    }
  }, [fetchFeatures, isAuthenticated, isPlatformAdmin, tenantId])

  const revalidateHas = useCallback(
    async (key: FeatureKey): Promise<boolean> => {
      if (isPlatformAdmin) return true
      const fresh = await fetchFeatures({ background: true })
      return fresh?.activeFeatures.has(key) ?? false
    },
    [isPlatformAdmin, fetchFeatures],
  )

  const value = useMemo<FeatureContextValue>(() => {
    const active = features?.activeFeatures
    const has = (key: FeatureKey) => {
      if (isPlatformAdmin) return true
      return active?.has(key) ?? false
    }
    return {
      loading,
      features,
      has,
      hasAny: (...keys: FeatureKey[]) => keys.some((k) => has(k)),
      hasAll: (...keys: FeatureKey[]) => keys.every((k) => has(k)),
      refresh: async () => { await fetchFeatures({ background: true }) },
      revalidate: () => fetchFeatures({ background: true }),
      revalidateHas,
    }
  }, [loading, features, fetchFeatures, revalidateHas, isPlatformAdmin])

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>
}

/** Boolean kısayolu — kullanıcı/feature load henüz yapılmamışsa false döner. */
export function useFeature(key: FeatureKey): boolean {
  const ctx = useContext(FeatureContext)
  return ctx?.has(key) ?? false
}

/** Tüm feature context'i — birden fazla key kontrolü, plan adı, aksiyon-anı doğrulama vs. */
export function useFeatureContext(): FeatureContextValue {
  const ctx = useContext(FeatureContext)
  if (ctx) return ctx
  return {
    loading: false,
    features: null,
    has: () => false,
    hasAny: () => false,
    hasAll: () => false,
    refresh: async () => {},
    revalidate: async () => null,
    revalidateHas: async () => false,
  }
}
