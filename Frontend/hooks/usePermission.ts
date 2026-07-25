'use client'

import { useCallback, useMemo } from 'react'
import { useAuth } from '@/components/dashboard/AuthContext'

/**
 * İki seviyeli personel yetkisi — backend `Permissions.IsActionAllowed` (Domain/Permissions.cs)
 * kuralının birebir istemci kopyası. Yalnızca Staff rolü kısıtlanır; kurum sahibi / şube yöneticisi /
 * platform admin her zaman tam yetkilidir.
 *
 * Geriye uyumluluk kuralı (backend ile aynı): işlem anahtarı doğrudan verilmemişse, personelin
 * SAYFA izni varsa ve o sayfaya ait HİÇBİR işlem anahtarı atanmamışsa (eski format kayıt) izinli
 * sayılır. En az bir işlem anahtarı atanmışsa yönetici bilinçli kısıtlamış demektir → reddedilir.
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
  const granted = useMemo(() => (user?.permissions ?? []).map((p) => p.toLowerCase()), [user?.permissions])

  const hasPage = useCallback(
    (pageKey: string): boolean => {
      if (!isStaff) return true
      return granted.includes(pageKey.toLowerCase())
    },
    [isStaff, granted],
  )

  const can = useCallback(
    (actionKey: string): boolean => {
      if (!isStaff) return true
      if (!actionKey) return true
      const key = actionKey.toLowerCase()
      if (granted.includes(key)) return true

      const dot = key.indexOf('.')
      if (dot <= 0) return false
      const pageKey = key.slice(0, dot)
      if (!granted.includes(pageKey)) return false
      // Eski format: sayfa izni var ama sayfanın hiçbir işlem anahtarı atanmamış → tam yetkili say.
      return !granted.some((p) => p.startsWith(`${pageKey}.`))
    },
    [isStaff, granted],
  )

  return { isStaff, hasPage, can }
}
