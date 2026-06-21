'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from '@/lib/apiClient'
import { normalizeAppointment } from '@/lib/apiMappers'
import type { Appointment, AppointmentInbox } from '@/lib/types'

export interface ManagerInboxState {
  /** Saati gelmiş, sonucu bekleyen randevular (kurum yöneticisi tamamlandı/gelmedi/ertele kararı verir). */
  awaitingOutcome: Appointment[]
  /** Personelin onaya gönderdiği taslak randevular. */
  awaitingApproval: Appointment[]
  total: number
  loading: boolean
  refresh: () => Promise<void>
  complete: (id: string) => Promise<void>
  noShow: (id: string) => Promise<void>
  approve: (id: string) => Promise<void>
  reject: (id: string) => Promise<void>
}

/**
 * Kurum yöneticisi randevu aksiyon kutusu — saati gelen randevular + onay bekleyen taslaklar.
 * Belirli aralıklarla yoklar (poll); "randevu saati gelince yöneticiye bildirim düşer" davranışını sağlar.
 * tenantId verilmezse apiClient depolanan scope'tan otomatik ekler.
 */
export function useManagerInbox(opts: { enabled: boolean; tenantId?: string; pollMs?: number }): ManagerInboxState {
  const { enabled, tenantId, pollMs = 60000 } = opts
  const [awaitingOutcome, setAwaitingOutcome] = useState<Appointment[]>([])
  const [awaitingApproval, setAwaitingApproval] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setAwaitingOutcome([])
      setAwaitingApproval([])
      return
    }
    setLoading(true)
    try {
      const inbox = await adminApi.appointmentInbox<AppointmentInbox>(tenantId)
      if (!mounted.current) return
      setAwaitingOutcome((inbox?.awaitingOutcome || []).map((a, i) => normalizeAppointment(a, {}, i)))
      setAwaitingApproval((inbox?.awaitingApproval || []).map((a, i) => normalizeAppointment(a, {}, i)))
    } catch {
      if (mounted.current) {
        setAwaitingOutcome([])
        setAwaitingApproval([])
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [enabled, tenantId])

  useEffect(() => {
    mounted.current = true
    if (!enabled) return () => {}
    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [enabled, refresh, pollMs])

  const complete = useCallback(
    async (id: string) => {
      await adminApi.changeAppointmentStatus(id, { status: 'Completed', reason: null }, tenantId)
      await refresh()
    },
    [tenantId, refresh],
  )
  const noShow = useCallback(
    async (id: string) => {
      await adminApi.changeAppointmentStatus(id, { status: 'NoShow', reason: null }, tenantId)
      await refresh()
    },
    [tenantId, refresh],
  )
  const approve = useCallback(
    async (id: string) => {
      await adminApi.approveAppointment(id, tenantId)
      await refresh()
    },
    [tenantId, refresh],
  )
  const reject = useCallback(
    async (id: string) => {
      await adminApi.deleteAppointment(id, tenantId)
      await refresh()
    },
    [tenantId, refresh],
  )

  return {
    awaitingOutcome,
    awaitingApproval,
    total: awaitingOutcome.length + awaitingApproval.length,
    loading,
    refresh,
    complete,
    noShow,
    approve,
    reject,
  }
}
