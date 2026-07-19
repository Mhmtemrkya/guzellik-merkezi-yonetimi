'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { formatTL } from '@/lib/apiMappers'

interface ApiProfitReport {
  months?: Array<{ month?: string; income?: number; expense?: number; net?: number }>
  totalIncome?: number
  totalExpense?: number
  totalNet?: number
  services?: Array<{ serviceName?: string; completedCount?: number; revenue?: number; commissionCost?: number; net?: number }>
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' })
}

/**
 * Kâr raporu — aylık gelir/gider/net kırılımı + hizmet kârlılığı (personel primi düşülmüş).
 * Veri sunucuda hesaplanır (/cash-flow/profit-report); sınırsız kayıt ölçeğinde çalışır.
 */
export default function ProfitReportCard({ tenantId }: { tenantId?: string }) {
  const [months, setMonths] = useState(6)
  const { data, loading, error } = useApiQuery<ApiProfitReport>(
    async () => (tenantId ? adminApi.profitReport<ApiProfitReport>(tenantId, months) : {}),
    [tenantId, months],
    { initialData: null },
  )

  const rows = useMemo(() => data?.months || [], [data])
  const services = useMemo(() => (data?.services || []).slice(0, 8), [data])
  const maxAbs = useMemo(
    () => Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.income || 0), Math.abs(r.expense || 0)))),
    [rows],
  )
  const net = data?.totalNet ?? 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
          <PiggyBank className="h-3.5 w-3.5" /> Kâr Raporu
          <span className="normal-case tracking-normal text-[#352432]/40">· tahsilat − işletme gideri</span>
        </div>
        <div className="inline-flex overflow-hidden rounded-[10px] border border-[#ead8df]">
          {[3, 6, 12].map((m) => (
            <button key={m} type="button" onClick={() => setMonths(m)}
              className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${months === m ? 'bg-[#fff1f6] text-[#c85776]' : 'bg-white text-[#9d7386] hover:text-[#c85776]'}`}>
              {m} Ay
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid h-44 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#c85776]" /></div>
      ) : error ? (
        <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
      ) : (
        <>
          {/* Özet kartları */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/60"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Toplam Gelir</div>
              <div className="mt-1.5 font-display text-2xl tabular-nums text-[#241923]">{formatTL(data?.totalIncome || 0)}</div>
            </div>
            <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/60"><TrendingDown className="h-3.5 w-3.5 text-rose-500" /> Toplam Gider</div>
              <div className="mt-1.5 font-display text-2xl tabular-nums text-[#241923]">{formatTL(data?.totalExpense || 0)}</div>
            </div>
            <div className={`rounded-[14px] border p-3.5 ${net >= 0 ? 'border-emerald-200/70 bg-emerald-50/50' : 'border-rose-200/70 bg-rose-50/50'}`}>
              <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/60"><Wallet className="h-3.5 w-3.5 text-[#b88938]" /> Net Kâr</div>
              <div className={`mt-1.5 font-display text-2xl tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatTL(net)}</div>
            </div>
          </div>

          {/* Aylık çubuklar */}
          <div className="mt-5 space-y-2.5">
            {rows.map((r) => (
              <div key={r.month} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[11px] font-semibold text-[#352432]/70">{monthLabel(r.month || '')}</span>
                <div className="flex-1 space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-[#f4f8f5]">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: `${((r.income || 0) / maxAbs) * 100}%` }} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#faf3f4]">
                    <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-300" style={{ width: `${((r.expense || 0) / maxAbs) * 100}%` }} />
                  </div>
                </div>
                <span className={`w-28 shrink-0 text-right font-display text-[13px] tabular-nums ${(r.net || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formatTL(r.net || 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-1 text-[10px] text-[#352432]/45">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Gelir</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Gider</span>
              <span>Sağda: aylık net</span>
            </div>
          </div>

          {/* Hizmet kârlılığı */}
          {services.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">Hizmet Kârlılığı (prim düşülmüş)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[#ead8df]/60 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">
                      <th className="py-2 pr-2 font-medium">Hizmet</th>
                      <th className="py-2 pr-2 text-right font-medium">Seans</th>
                      <th className="py-2 pr-2 text-right font-medium">Ciro</th>
                      <th className="py-2 pr-2 text-right font-medium">Prim</th>
                      <th className="py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1e5ea]">
                    {services.map((s) => (
                      <tr key={s.serviceName}>
                        <td className="py-2 pr-2 font-medium text-[#241923]">{s.serviceName}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-[#352432]/70">{s.completedCount}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatTL(s.revenue || 0)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-rose-600/80">−{formatTL(s.commissionCost || 0)}</td>
                        <td className="py-2 text-right font-display tabular-nums text-emerald-700">{formatTL(s.net || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </motion.section>
  )
}
