'use client'

import { useEffect, useState } from 'react'
import { Moon, Loader2, Check, CalendarClock, Info, ChevronRight } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiPassiveCustomerList } from '@/lib/types'

/** Pasif müşteriler — eşik (gün) kadar süredir randevu/paket işlemi olmayanlar. Eşiği kurum yöneticisi belirler. */
export default function PassiveCustomersPanel({ tenantId, onSelect }: { tenantId?: string; onSelect?: (id: string) => void }) {
  const { data, loading, reload } = useApiQuery<ApiPassiveCustomerList>(
    () => adminApi.passiveCustomers<ApiPassiveCustomerList>(tenantId),
    [tenantId],
    { initialData: { thresholdDays: 60, items: [] } },
  )
  const [days, setDays] = useState(60)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (data?.thresholdDays) setDays(data.thresholdDays) }, [data?.thresholdDays])

  const save = async () => {
    setBusy(true); setSaved(false)
    try { await adminApi.setPassiveThreshold({ days: Number(days) || 60 }, tenantId); setSaved(true); await reload(); setTimeout(() => setSaved(false), 2000) }
    finally { setBusy(false) }
  }

  const items = data?.items ?? []

  return (
    <div className="space-y-4">
      {/* Eşik ayarı */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#ead8df]/70 bg-white/80 p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6b6f8e]/10 text-[#5b5f7e]"><Moon className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#352432]">Pasif müşteri eşiği</div>
            <div className="text-[11px] text-[#352432]/45">Bu kadar gündür randevu/paket işlemi olmayan müşteriler pasif sayılır</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="w-20 rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-center text-[13px] font-semibold text-[#352432] outline-none focus:border-[#c85776]" />
          <span className="text-[12px] text-[#352432]/55">gün</span>
          <button type="button" disabled={busy} onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#c85776] to-[#8e3f5b] px-3.5 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? 'Kaydedildi' : 'Kaydet'}
          </button>
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="py-8 text-center text-[12px] text-[#352432]/40">Yükleniyor…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Moon className="h-7 w-7 text-[#cdb8c1]" />
          <div className="text-[13px] font-medium text-[#352432]/60">Pasif müşteri yok</div>
          <div className="text-[11px] text-[#352432]/40">Son {data?.thresholdDays} gün içinde tüm müşterilerin işlemi var.</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 text-[11px] text-[#352432]/50">
            <Info className="h-3.5 w-3.5" /> {items.length} müşteri {data?.thresholdDays}+ gündür işlemsiz (kuruma + şubeye özel)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((p) => (
              <button key={p.id} type="button" onClick={() => p.id && onSelect?.(p.id)}
                className="group flex items-center justify-between gap-3 rounded-[14px] border border-[#f0e0e6] bg-[#fffafb] px-3 py-2.5 text-left transition hover:border-[#efbfd0] hover:bg-[#fff1f6]">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[#352432]">{p.fullName}</div>
                  <div className="text-[11px] text-[#352432]/45">{p.phone}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                    <CalendarClock className="h-3 w-3" /> {p.daysSinceActivity} gün
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#cdb8c1] transition group-hover:translate-x-0.5" />
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
