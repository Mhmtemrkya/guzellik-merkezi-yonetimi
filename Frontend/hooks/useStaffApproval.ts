'use client'

import { useCallback } from 'react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { isPendingApprovalResult } from '@/lib/apiClient'
import type { PendingOperationTypeKey } from '@/lib/types'

/**
 * Personel (Staff) yazma işlemlerini onaya yönlendirme yardımcı kancası.
 *
 * Artık yönlendirme BACKEND'deki evrensel onay kapısında yapılır: Staff'ın tüm /api/admin yazma
 * istekleri otomatik olarak PendingOperation'a (taslak) düşer ve { pendingApproval: true } döner.
 * Bu yüzden burada her rol için doğrudan gerçek işlemi çağırırız; sonuç "onaya düştü" mü diye bakarız.
 *
 * @returns isStaff — UI tarafında "Onaya gönder" / "Kaydet" gibi etiket değiştirmek için.
 */
export function useStaffApproval() {
  const { user } = useAuth()
  const isStaff = user?.role === 'Staff'

  const performWrite = useCallback(async <T,>(opts: {
    // Geriye dönük uyum için imza korunur; operationType/title/payload artık backend kapısı tarafından üretilir.
    operationType?: PendingOperationTypeKey
    title?: string
    summary?: string
    payload?: Record<string, unknown>
    tenantId?: string
    directAction: () => Promise<T>
  }): Promise<{ submittedToApproval: boolean; result?: T }> => {
    const result = await opts.directAction()
    return { submittedToApproval: isPendingApprovalResult(result), result }
  }, [])

  return { isStaff, performWrite }
}

/** Staff'in işlem yaptığı sırada gösterilecek standart Türkçe mesaj. */
export function staffApprovalSuccessMessage(action: string): string {
  return `İşlem onaya gönderildi: "${action}". Kurum yöneticisi onayladığında geçerli olacak.`
}
