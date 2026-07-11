'use client'

import { useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import type { ApiLoyaltyBalance } from '@/lib/types'
import { Gift, Minus, Plus, Sparkles } from 'lucide-react'

/**
 * Müşteri sadakat puanı (4B). Adisyon onaylanınca tahsilata göre otomatik puan kazanılır;
 * burada bakiye + geçmiş görünür, manuel +/- puan eklenebilir. loyalty.points ile kapılı.
 */
export default function LoyaltyCard({ customerId, tenantId }: { customerId?: string; tenantId?: string }) {
  const canLoyalty = useFeature('loyalty.points')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState(50)

  const { data, reload } = useApiQuery<ApiLoyaltyBalance>(
    () => (customerId && canLoyalty ? adminApi.loyaltyBalance<ApiLoyaltyBalance>(customerId, tenantId) : Promise.resolve({} as ApiLoyaltyBalance)),
    [customerId, tenantId, canLoyalty],
    { initialData: {} as ApiLoyaltyBalance },
  )

  if (!canLoyalty || !customerId) return null

  const balance = Number(data?.balance ?? 0)
  const history = (data?.history ?? []).slice(0, 5)

  const adjust = async (points: number) => {
    setBusy(true)
    setError('')
    try {
      await adminApi.adjustLoyalty({ customerId, points, description: null }, tenantId)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Puan güncellenemedi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-gradient-to-br from-white/90 to-[#fff1f6]/70 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <Gift className="h-3.5 w-3.5" /> Sadakat puanı
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-[#d99a3a]" />
          <span className="font-display text-2xl tabular-nums beautyassist-text-gradient">{balance}</span>
          <span className="text-[10px] font-mono text-[#352432]/40">puan</span>
        </div>
      </div>

      {error && <div className="mt-2 rounded-[10px] border border-rose-300/40 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={amount || ''}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-20 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
        />
        <button type="button" disabled={busy || amount <= 0} onClick={() => adjust(Math.abs(amount))} className="inline-flex items-center gap-1 rounded-[10px] border border-emerald-300/40 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Ekle
        </button>
        <button type="button" disabled={busy || amount <= 0 || balance < amount} onClick={() => adjust(-Math.abs(amount))} className="inline-flex items-center gap-1 rounded-[10px] border border-rose-300/40 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40">
          <Minus className="h-3.5 w-3.5" /> Kullan
        </button>
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-1">
          {history.map((h, i) => (
            <div key={h.id || i} className="flex items-center justify-between rounded-[10px] border border-[#f0e0e6] bg-white/70 px-2.5 py-1.5 text-[11px]">
              <span className="truncate text-[#352432]/65">{h.description || h.sourceType}</span>
              <span className={`shrink-0 font-mono tabular-nums ${Number(h.points) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {Number(h.points) >= 0 ? '+' : ''}{h.points}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
