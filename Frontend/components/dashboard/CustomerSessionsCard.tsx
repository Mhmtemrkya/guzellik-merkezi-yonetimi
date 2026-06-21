'use client'

import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiCustomerPackageSession } from '@/lib/types'
import { CheckCircle2, Layers3 } from 'lucide-react'
import { motion } from 'framer-motion'
import SessionProgressRing from './SessionProgressRing'

/**
 * Müşteriye satılan paket/hizmetlerin hizmet-bazlı seans bakiyesi — her hizmet için animasyonlu
 * ilerleme halkasıyla. Randevu "Tamamlandı" olunca backend bir seans düşer; bitince satır kapanır.
 */
export default function CustomerSessionsCard({
  customerId,
  tenantId,
  refreshKey = 0,
}: {
  customerId?: string
  tenantId?: string
  refreshKey?: number
}) {
  const { data, loading } = useApiQuery<ApiCustomerPackageSession[]>(
    () =>
      customerId
        ? adminApi.customerSessions<ApiCustomerPackageSession>(customerId, tenantId)
        : Promise.resolve([]),
    [customerId, tenantId, refreshKey],
    { initialData: [] },
  )

  const sessions = (data ?? []).filter((s) => (s.totalSessions ?? 0) > 0)
  if (!customerId || (!loading && sessions.length === 0)) return null

  const activeCount = sessions.filter((s) => (s.remainingSessions ?? 0) > 0).length
  const doneCount = sessions.length - activeCount

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/80 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <Layers3 className="h-3.5 w-3.5" /> Satılan paket / seanslar
        </div>
        {doneCount > 0 && (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
            {doneCount} tamamlandı
          </span>
        )}
      </div>
      <div className="space-y-2">
        {sessions.map((s, idx) => {
          const remaining = s.remainingSessions ?? 0
          const total = s.totalSessions ?? 0
          const used = Math.max(0, total - remaining)
          const done = remaining <= 0
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.06 }}
              className={`flex items-center gap-3 rounded-[14px] border px-3 py-2.5 ${
                done ? 'border-emerald-200/70 bg-emerald-50/50' : 'border-[#f0e0e6] bg-[#fffafb]'
              }`}
            >
              <SessionProgressRing remaining={remaining} total={total} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[#352432]">{s.serviceName}</div>
                {done ? (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> Tüm seanslar tamamlandı
                  </div>
                ) : (
                  <>
                    <div className="mt-0.5 text-[10px] font-mono uppercase tracking-wide text-[#352432]/45">
                      {used} / {total} seans kullanıldı
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-[#efbfd0]/70 bg-[#fff1f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b14d6c]">
                      {remaining} seans kaldı
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
