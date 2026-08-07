'use client'

import { useCallback, useMemo } from 'react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { hasActionAccess, hasPageAccess, normalizePermissions } from '@/lib/permissions'

/**
 * İki seviyeli personel yetkisi — backend `Permissions.IsActionAllowed` (Domain/Permissions.cs)
 * kuralının istemci karşılığı. Yalnızca Staff rolü kısıtlanır; kurum sahibi / şube yöneticisi /
 * platform admin her zaman tam yetkilidir.
 *
 * KARAR BU DOSYADA DEĞİL: kural `lib/permissions.ts` içinde saf fonksiyonlar olarak durur ve
 * testlenir. Aynı iş kuralı backend + frontend'de iki kez yazıldığı için sapmaya açıktır; hook'un
 * içine gömülü hâlde test edilemiyordu (React bağlamı gerekiyordu) ve sessizce kayabilirdi.
 *
 * NOT: Butonu gizlemek güvenlik sınırı DEĞİLDİR — backend endpoint filtresi + onay kapısı asıl
 * korumadır. Buradaki amaç personelin yapamayacağı işlemi hiç görmemesi.
 */
export function usePermission(): {
  isStaff: boolean
  /** Sayfa izni (ör. "Waitlist"). */
  hasPage: (pageKey: string) => boolean
  /** İşlem izni (ör. "Customers.Delete"). */
  can: (actionKey: string) => boolean
} {
  const { user } = useAuth()
  const isStaff = user?.role === 'Staff'
  const granted = useMemo(() => normalizePermissions(user?.permissions), [user?.permissions])

  const hasPage = useCallback(
    (pageKey: string): boolean => hasPageAccess(isStaff, granted, pageKey),
    [isStaff, granted],
  )

  const can = useCallback(
    (actionKey: string): boolean => hasActionAccess(isStaff, granted, actionKey),
    [isStaff, granted],
  )

  return { isStaff, hasPage, can }
}
