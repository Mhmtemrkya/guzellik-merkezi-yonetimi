'use client'

import { useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiCustomerPackageSession } from '@/lib/types'
import { CheckCircle2, ChevronDown, Layers3, Search, X } from 'lucide-react'
import { motion } from 'framer-motion'
import SessionProgressRing from './SessionProgressRing'

/**
 * Müşteriye satılan paket/hizmetlerin hizmet-bazlı seans bakiyesi.
 *
 * DERLİ TOPLU YERLEŞİM: paket sayısı arttıkça alt alta uzayan iri satırlar kartı boğuyordu.
 * Artık üstte tek satır özet (kalan/kullanılan/toplam), altında ızgara hâlinde kompakt kutucuklar
 * var; BİTEN seanslar varsayılan olarak katlanır ("N tamamlandı" düğmesiyle açılır) ve 8'den fazla
 * hizmet olduğunda arama kutusu çıkar. Müşteri kartı ve cari detay modali aynı bileşeni kullanır.
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

  const [showDone, setShowDone] = useState(false)
  const [q, setQ] = useState('')

  const rawSessions = useMemo(() => (data ?? []).filter((s) => (s.totalSessions ?? 0) > 0), [data])

  /**
   * HİZMETE GÖRE GRUPLAMA — asıl kalabalık sebebi buydu: her paket kalemi ayrı bir seans
   * kaydı açtığı için "Cilt Bakımı 0/1" satırı yan yana 5 kez görünüyordu. Aynı hizmetin tüm
   * paketleri tek kutucukta toplanır, kaç paketten geldiği rozetle belirtilir.
   */
  const grouped = useMemo(() => {
    const map = new Map<string, ServiceGroup>()
    for (const s of rawSessions) {
      const key = s.serviceDefinitionId || s.serviceName || s.id || ''
      const cur = map.get(key) ?? { key, name: s.serviceName || 'Hizmet', total: 0, remaining: 0, bundles: 0 }
      cur.total += s.totalSessions ?? 0
      cur.remaining += Math.max(0, s.remainingSessions ?? 0)
      cur.bundles += 1
      map.set(key, cur)
    }
    return [...map.values()]
  }, [rawSessions])

  const { active, done, totals } = useMemo(() => {
    const act: ServiceGroup[] = []
    const fin: ServiceGroup[] = []
    let remaining = 0
    let total = 0
    for (const g of grouped) {
      remaining += g.remaining
      total += g.total
      if (g.remaining > 0) act.push(g); else fin.push(g)
    }
    // Bitmeye en yakın hizmet üstte: personelin ilk soracağı "kaç seans kaldı" bu.
    act.sort((x, y) => x.remaining - y.remaining)
    return { active: act, done: fin, totals: { remaining, total, used: Math.max(0, total - remaining) } }
  }, [grouped])

  const filter = (list: ServiceGroup[]): ServiceGroup[] => {
    const t = q.trim().toLocaleLowerCase('tr')
    if (!t) return list
    return list.filter((g) => g.name.toLocaleLowerCase('tr').includes(t))
  }
  const visibleActive = filter(active)
  const visibleDone = filter(done)

  if (!customerId || (!loading && rawSessions.length === 0)) return null

  return (
    <div className="rounded-[18px] border border-[#ead8df] bg-white p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      {/* Özet şeridi */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#c85776]">
          <Layers3 className="h-3.5 w-3.5" /> Satılan Paket / Seanslar
          <span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[10.5px] tabular-nums text-[#a34a62]">{grouped.length} hizmet</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-0.5 text-[11px] font-bold text-[#a34a62]">
            {totals.remaining} seans kaldı
          </span>
          <span className="rounded-full border border-[#ead8df] bg-[#fffafc] px-2.5 py-0.5 text-[11px] font-semibold text-[#4a3a44]">
            {totals.used}/{totals.total} kullanıldı
          </span>
        </div>
      </div>

      {/* Toplam ilerleme — tek bakışta paket tüketimi */}
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#f4e7ec]">
        <span
          className="block h-full rounded-full bg-[linear-gradient(90deg,#ee789a,#c05277)]"
          style={{ width: `${totals.total > 0 ? Math.max(2, Math.round((totals.used / totals.total) * 100)) : 0}%` }}
        />
      </div>

      {/* Çok hizmet varsa arama — 15 paketli müşteride göz taraması bitiyordu */}
      {grouped.length > 8 && (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#705a66]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hizmet ara…"
            className="w-full rounded-[10px] border border-[#ead8df] bg-[#fffafc] py-1.5 pl-8 pr-8 text-[12.5px] text-[#352432] outline-none transition-colors focus:border-[#c85776] placeholder:text-[#9d8590]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Aramayı temizle"
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[#705a66] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Aktif seanslar — kompakt ızgara */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {visibleActive.map((g, idx) => (
          <SessionTile key={g.key} group={g} idx={idx} />
        ))}
        {visibleActive.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[11.5px] text-[#705a66] sm:col-span-2 2xl:col-span-3">
            {q ? 'Aramayla eşleşen açık seans yok.' : 'Açık seans kalmadı — tüm paketler tamamlandı.'}
          </div>
        )}
      </div>

      {/* Tamamlananlar katlanır: liste kalabalığının asıl sebebi bunlardı */}
      {done.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[12px] border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {done.length} hizmetin seansları tamamlandı
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showDone ? 'rotate-180' : ''}`} />
          </button>
          {showDone && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {visibleDone.map((g, idx) => <SessionTile key={g.key} group={g} idx={idx} />)}
              {visibleDone.length === 0 && (
                <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[11.5px] text-[#705a66] sm:col-span-2 2xl:col-span-3">
                  Aramayla eşleşen tamamlanmış seans yok.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Aynı hizmetin tüm paketlerinden toplanan seans bakiyesi. */
interface ServiceGroup {
  key: string
  name: string
  total: number
  remaining: number
  /** Bu hizmete seans veren satış/paket kaydı sayısı. */
  bundles: number
}

/** Tek hizmetin seans kutucuğu — halka + ad + kalan/kullanılan. */
function SessionTile({ group, idx }: { group: ServiceGroup; idx: number }) {
  const { remaining, total } = group
  const used = Math.max(0, total - remaining)
  const done = remaining <= 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(idx, 8) * 0.04 }}
      className={`flex items-center gap-2.5 rounded-[13px] border px-2.5 py-2 ${
        done ? 'border-emerald-200 bg-emerald-50/50' : 'border-[#f0e0e6] bg-[#fffafb]'
      }`}
    >
      <SessionProgressRing remaining={remaining} total={total} size={44} stroke={5} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-[#352432]" title={group.name}>{group.name}</span>
          {group.bundles > 1 && (
            <span className="shrink-0 rounded-md border border-[#ead8df] bg-white px-1 py-0.5 text-[10px] font-bold text-[#705a66]" title="Bu hizmete seans veren satış sayısı">
              ×{group.bundles}
            </span>
          )}
        </div>
        {done ? (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Tamamlandı
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#705a66]">
            <span className="tabular-nums">{used}/{total} kullanıldı</span>
            <span className="rounded-md bg-[#fff1f6] px-1.5 py-0.5 font-bold tabular-nums text-[#a34a62]">{remaining} kaldı</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}
