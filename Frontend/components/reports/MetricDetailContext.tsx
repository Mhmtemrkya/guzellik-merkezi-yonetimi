'use client'

/**
 * Rapor kartlarının detay modalini tek bir yerden yönetir.
 *
 * Sağlayıcı sayfanın en üstünde bir kez render edilir; sekmeler prop geçirmeden
 * `useMetricDetail().open({...})` ile modali açar. Böylece her sekmenin kendi modal
 * durumunu taşıması gerekmez ve modal her zaman aynı görünür.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import MetricDetailModal, { type MetricDetailPayload } from '@/components/reports/MetricDetailModal'
import { getMetricInfo } from '@/lib/reportMetricInfo'
import type { ReportValueUnit } from '@/components/reports/ReportUi'

interface MetricDetailApi {
  /** Hazır yükle aç (açıklama metni çağıran tarafından verilir). */
  open: (payload: MetricDetailPayload) => void
  /**
   * Katalogdaki anahtardan aç. Anahtar tanımlı değilse hiçbir şey yapmaz —
   * bu sayede açıklaması yazılmamış kart tıklanabilir görünmez.
   */
  openKey: (key: string, extras?: Omit<MetricDetailPayload, 'info'>) => void
  /** Anahtarın açıklaması var mı (kartı tıklanabilir yapmadan önce sorulur)? */
  has: (key: string) => boolean
}

const Ctx = createContext<MetricDetailApi | null>(null)

export function MetricDetailProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<MetricDetailPayload | null>(null)

  const open = useCallback((next: MetricDetailPayload) => setPayload(next), [])

  const openKey = useCallback((key: string, extras?: Omit<MetricDetailPayload, 'info'>) => {
    const info = getMetricInfo(key)
    if (!info) return
    setPayload({ info, ...extras })
  }, [])

  const has = useCallback((key: string) => getMetricInfo(key) !== null, [])

  const api = useMemo<MetricDetailApi>(() => ({ open, openKey, has }), [open, openKey, has])

  return (
    <Ctx.Provider value={api}>
      {children}
      <MetricDetailModal payload={payload} onClose={() => setPayload(null)} />
    </Ctx.Provider>
  )
}

/** Sağlayıcı yoksa işlevsiz bir API döner — bileşenler sağlayıcı dışında da render edilebilsin. */
const noop: MetricDetailApi = { open: () => {}, openKey: () => {}, has: () => false }

export function useMetricDetail(): MetricDetailApi {
  return useContext(Ctx) ?? noop
}

/**
 * KPI kartı için standart açılış yardımcısı — kart değerini, kıyasını ve serisini modale taşır.
 * Sekmelerde tekrar eden `onOpen={() => openKey(...)}` kalıbını kısaltır.
 */
export function kpiOpener(
  api: MetricDetailApi,
  key: string,
  extras: {
    value: number
    unit?: ReportValueUnit
    previous?: number
    compareLabel?: string
    rangeLabel?: string
    hint?: string
    series?: number[]
    invert?: boolean
    breakdown?: { label: string; value: string; hint?: string }[]
  },
): (() => void) | undefined {
  if (!api.has(key)) return undefined
  return () => api.openKey(key, extras)
}
