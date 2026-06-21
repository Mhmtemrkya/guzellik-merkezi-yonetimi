'use client'

import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { formatTL, normalizeCashFlowSummary } from '@/lib/apiMappers'
import type { ApiCashFlowSummary } from '@/lib/types'
import { ArrowDownRight, ArrowUpRight, GitCompareArrows, Minus } from 'lucide-react'

function growth(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null // önceki 0 → oran tanımsız
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[10px] font-mono text-[#352432]/40">yeni</span>
  const up = value > 0
  const flat = value === 0
  const cls = flat ? 'text-[#352432]/45' : up ? 'text-emerald-600' : 'text-rose-600'
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-mono tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" />%{Math.abs(value)}
    </span>
  )
}

/**
 * Karşılaştırmalı finans raporu (3B) — bu dönem vs önceki dönem gelir/gider/net + büyüme oranı.
 */
export default function ComparativeReportCard({
  tenantId,
  fromIso,
  toIso,
  prevFromIso,
  prevToIso,
  currentLabel,
  prevLabel,
}: {
  tenantId?: string
  fromIso: string
  toIso: string
  prevFromIso: string
  prevToIso: string
  currentLabel: string
  prevLabel: string
}) {
  const { data, loading } = useApiQuery<{ cur: ApiCashFlowSummary; prev: ApiCashFlowSummary }>(
    async () => {
      if (!tenantId) return { cur: {} as ApiCashFlowSummary, prev: {} as ApiCashFlowSummary }
      const [cur, prev] = await Promise.all([
        adminApi.cashFlowSummary<ApiCashFlowSummary>({ tenantId, fromUtc: fromIso, toUtc: toIso }).catch(() => ({} as ApiCashFlowSummary)),
        adminApi.cashFlowSummary<ApiCashFlowSummary>({ tenantId, fromUtc: prevFromIso, toUtc: prevToIso }).catch(() => ({} as ApiCashFlowSummary)),
      ])
      return { cur, prev }
    },
    [tenantId, fromIso, toIso, prevFromIso, prevToIso],
    { initialData: { cur: {} as ApiCashFlowSummary, prev: {} as ApiCashFlowSummary } },
  )

  const cur = normalizeCashFlowSummary(data?.cur)
  const prev = normalizeCashFlowSummary(data?.prev)

  const rows: Array<{ label: string; cur: number; prev: number; tone: string }> = [
    { label: 'Gelir', cur: cur.totalIncome, prev: prev.totalIncome, tone: 'text-emerald-700' },
    { label: 'Gider', cur: cur.totalExpense, prev: prev.totalExpense, tone: 'text-rose-700' },
    { label: 'Net', cur: cur.netAmount, prev: prev.netAmount, tone: 'text-[#352432]' },
  ]

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/86 p-5 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)] lg:col-span-2">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <GitCompareArrows className="h-4 w-4" /> Dönem karşılaştırması
        </div>
        <div className="text-right text-[10px] font-mono uppercase tracking-wide text-[#352432]/45">
          {currentLabel} <span className="text-[#352432]/25">vs</span> {prevLabel}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[#ead8df]/65">
        <div className="grid grid-cols-4 gap-px bg-[#fff1f6]/72 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">
          <div className="bg-white px-3 py-2">Kalem</div>
          <div className="bg-white px-3 py-2 text-right">Bu dönem</div>
          <div className="bg-white px-3 py-2 text-right">Önceki</div>
          <div className="bg-white px-3 py-2 text-right">Büyüme</div>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-4 gap-px bg-[#fff1f6]/72 text-[13px]">
            <div className="bg-white px-3 py-2.5 font-medium text-[#352432]/80">{r.label}</div>
            <div className={`bg-white px-3 py-2.5 text-right font-display tabular-nums ${r.tone}`}>{loading ? '…' : formatTL(r.cur)}</div>
            <div className="bg-white px-3 py-2.5 text-right font-mono tabular-nums text-[#352432]/45">{loading ? '…' : formatTL(r.prev)}</div>
            <div className="bg-white px-3 py-2.5 text-right"><GrowthBadge value={growth(r.cur, r.prev)} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
