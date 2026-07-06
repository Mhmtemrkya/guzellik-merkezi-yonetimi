'use client'

import { useState } from 'react'
import { Crown, Loader2 } from 'lucide-react'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'

/**
 * VIP etiketi ekle/kaldır anahtarı. `variant="chip"` başlık rozeti,
 * `variant="row"` Hızlı İşlemler listesine uyan tam genişlik satır butonudur.
 * Müşteriler sayfasındaki VIP sekmesi bu bayrağa göre filtreler.
 */
export default function CustomerVipToggle({
  customerId,
  tenantId,
  isVip,
  onChanged,
  variant = 'chip',
}: {
  customerId: string
  tenantId?: string
  isVip: boolean
  onChanged?: () => void
  variant?: 'chip' | 'row'
}) {
  const [busy, setBusy] = useState(false)
  const [pendingMsg, setPendingMsg] = useState(false)

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await adminApi.setCustomerVip(customerId, { vip: !isVip }, tenantId)
      if (isPendingApprovalResult(res)) {
        setPendingMsg(true)
        setTimeout(() => setPendingMsg(false), 3500)
      } else {
        onChanged?.()
      }
    } catch {
      /* geçici hata — rozet mevcut durumda kalır */
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#e5c46a]/50 bg-[#fdf6e3]/60 px-3 py-2.5 text-[12px] font-medium text-[#9a7420] transition-colors hover:border-[#e5c46a] hover:bg-[#fdf6e3] disabled:opacity-60"
      >
        <span className="flex items-center gap-2">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Crown className={`h-4 w-4 ${isVip ? 'fill-[#e5c46a] text-[#c9a13c]' : 'text-[#c9a13c]'}`} />
          )}
          {pendingMsg ? 'Onaya gönderildi' : isVip ? 'VIP Etiketini Kaldır' : 'VIP Yap'}
        </span>
        <span className="text-[#c9a13c]/50">→</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={isVip ? 'VIP etiketini kaldır' : 'VIP etiketi ekle'}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-60 ${
        isVip
          ? 'border-[#e5c46a]/70 bg-[#fdf6e3] text-[#9a7420] hover:bg-[#faeecb]'
          : 'border-[#ead8df] bg-white text-[#352432]/40 hover:border-[#e5c46a]/70 hover:text-[#9a7420]'
      }`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className={`h-3 w-3 ${isVip ? 'fill-[#e5c46a] text-[#c9a13c]' : ''}`} />}
      {pendingMsg ? 'Onaya gönderildi' : isVip ? 'VIP' : 'VIP yap'}
    </button>
  )
}
