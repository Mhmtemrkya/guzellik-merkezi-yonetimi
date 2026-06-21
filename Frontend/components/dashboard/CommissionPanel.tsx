'use client'

import { useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { formatTL } from '@/lib/apiMappers'
import type { ApiCommissionSummary } from '@/lib/types'
import { BadgePercent, Wallet } from 'lucide-react'

/**
 * Personel primi özeti (2B). Adisyon onaylandığında personele atanmış charge kalemleri için
 * otomatik prim tahakkuk eder; burada kazanılan/ödenen/bekleyen görünür ve "Prim öde" ile kapanır.
 */
export default function CommissionPanel({ tenantId }: { tenantId?: string }) {
  const canCommission = useFeature('staff.commission')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const { data, loading, reload } = useApiQuery<ApiCommissionSummary>(
    () => (canCommission ? adminApi.commissionSummary<ApiCommissionSummary>({ tenantId }) : Promise.resolve({} as ApiCommissionSummary)),
    [tenantId, canCommission],
    { initialData: {} as ApiCommissionSummary },
  )

  if (!canCommission) return null

  const byStaff = (data?.byStaff ?? []).filter((s) => (s.count ?? 0) > 0)
  const pay = async (staffMemberId: string) => {
    setBusy(staffMemberId)
    setError('')
    try {
      await adminApi.payCommission(staffMemberId, { tenantId })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prim ödenemedi')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-5 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <BadgePercent className="h-4 w-4" /> Personel primleri
        </div>
        <div className="flex gap-3 text-right">
          <div>
            <div className="font-display text-lg tabular-nums text-[#352432]">{formatTL(Number(data?.earnedTotal ?? 0))}</div>
            <div className="text-[8px] font-mono uppercase text-[#352432]/40">kazanılan</div>
          </div>
          <div>
            <div className="font-display text-lg tabular-nums text-amber-700">{formatTL(Number(data?.unpaidTotal ?? 0))}</div>
            <div className="text-[8px] font-mono uppercase text-[#352432]/40">bekleyen</div>
          </div>
        </div>
      </div>

      {error && <div className="mb-2 rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>}

      <div className="space-y-1.5">
        {!loading && byStaff.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[12px] text-[#352432]/45">
            Henüz prim yok. Adisyon onaylandığında personele atanmış kalemler buraya düşer.
          </div>
        )}
        {byStaff.map((s) => (
          <div key={s.staffMemberId} className="flex items-center justify-between gap-3 rounded-[14px] border border-[#f0e0e6] bg-white px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[#352432]">{s.staffName || 'Personel'}</div>
              <div className="text-[10px] font-mono text-[#352432]/45">
                {s.count} kalem · ödenen {formatTL(Number(s.paidTotal ?? 0))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-display text-base tabular-nums text-amber-700">{formatTL(Number(s.unpaidTotal ?? 0))}</div>
                <div className="text-[8px] font-mono uppercase text-[#352432]/40">bekleyen</div>
              </div>
              <button
                type="button"
                disabled={busy === s.staffMemberId || Number(s.unpaidTotal ?? 0) <= 0}
                onClick={() => s.staffMemberId && pay(s.staffMemberId)}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Wallet className="h-3.5 w-3.5" /> Prim öde
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
