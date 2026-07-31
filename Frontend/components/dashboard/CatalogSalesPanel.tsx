'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  History,
  Package,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, mapCancelledSale, normalizeAccount } from '@/lib/apiMappers'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiCustomerAccount, CustomerAccount, SaleStatusKey } from '@/lib/types'
import SaleDetailModal from '@/components/dashboard/SaleDetailModal'
import HistoricalSaleDialog, { type HistoricalCatalogOption, type HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'
import { formatSaleDate } from '@/components/dashboard/CustomerSalesPanel'

/**
 * Katalog (hizmet / paket) kartındaki SATIŞ PANELİ.
 *
 * Müşteri kartındaki satış paneli "bu müşteri ne aldı?" sorusunu cevaplar; buradaki panel aynı
 * veriye kataloğun gözünden bakar: "bu paket/hizmet kime, ne zaman, kim tarafından satıldı?".
 * Ciro, kalan tahsilat, seans doluluğu ve personel bazlı satış payı tek bakışta görünür;
 * satıra tıklanınca satışın tam ayrıntısı (taksitler dahil) açılır.
 *
 * "Geçmiş satış ekle" burada da vardır — yazılıma yeni geçen kurum, bu paketi geçmişte aldığı
 * müşterileri kataloğun içinden tek tek işleyebilir (müşteri modal içinde aranır).
 */

const STATUS_META: Record<SaleStatusKey, { label: string; pill: string; icon: typeof Package }> = {
  Active: { label: 'Devam ediyor', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: Package },
  Completed: { label: 'Tamamlandı', pill: 'border-sky-200 bg-sky-50 text-sky-700', icon: CheckCircle2 },
  Cancelled: { label: 'İptal', pill: 'border-rose-200 bg-rose-50 text-rose-600', icon: XCircle },
}

type FilterKey = 'all' | 'Active' | 'Completed' | 'Cancelled'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'Active', label: 'Devam eden' },
  { key: 'Completed', label: 'Biten' },
  { key: 'Cancelled', label: 'İptal' },
]

const VISIBLE_STEP = 6

export default function CatalogSalesPanel({
  item,
  kind,
  tenantId,
  staffOptions,
  packageOptions,
  serviceOptions,
  canManage = true,
  busy = false,
  onCreateHistorical,
  onCancelSale,
  onRestoreSale,
  onCollectInstallment,
}: {
  /** Panelin bağlı olduğu katalog kaydı. kind='category' iken id = kategori adıdır. */
  item: { id: string; name: string; price: number }
  kind: 'service' | 'package' | 'category'
  tenantId?: string
  staffOptions: { id: string; name: string }[]
  packageOptions: HistoricalCatalogOption[]
  serviceOptions: HistoricalCatalogOption[]
  canManage?: boolean
  busy?: boolean
  onCreateHistorical: (values: HistoricalSaleValues) => Promise<void>
  onCancelSale: (accountId: string, reason: string, refundedAmount: number, refundMethod: string) => Promise<void>
  onRestoreSale: (accountId: string) => Promise<void>
  onCollectInstallment?: (accountId: string, amount: number) => Promise<void>
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [limit, setLimit] = useState(VISIBLE_STEP)

  // ÖLÇEK: satışlar sunucuda bu katalog kaydına göre süzülür — tüm cari listesi indirilmez.
  // Seans/kalem/durum zenginleştirmesi de yalnızca bu süzülmüş sayfada yapılır.
  const { data, reload } = useApiQuery<ApiCustomerAccount[]>(
    async () => {
      if (!tenantId || !item.id) return []
      const res = await adminApi.accounts<ApiCustomerAccount>({
        tenantId,
        page: 1,
        pageSize: 200,
        ...(kind === 'service'
          ? { serviceDefinitionId: item.id }
          : kind === 'package'
            ? { servicePackageId: item.id }
            : { category: item.id }),
      })
      return apiItems(res)
    },
    [tenantId, item.id, kind],
    { initialData: [] },
  )
  const accounts = useMemo(() => (data || []).map((a, i) => normalizeAccount(a, i)), [data])

  // İPTAL EDİLENLER AYRI KAYNAKTAN GELİR: iptalde cari kaydı canlı tablolardan silinip
  // cancelled_sales arşivine taşınır, bu yüzden yukarıdaki satış sorgusunda hiç görünmezler.
  const { data: cancelledRaw, reload: reloadCancelled } = useApiQuery<unknown[]>(
    async () => {
      if (!tenantId || !item.id || kind !== 'package') return []
      const res = await adminApi.listCancelledSales<unknown[]>({ servicePackageId: item.id }, tenantId)
      return Array.isArray(res) ? res : []
    },
    [tenantId, item.id, kind],
    { initialData: [] },
  )
  const cancelledSales = useMemo(() => (cancelledRaw || []).map(mapCancelledSale), [cancelledRaw])

  const reloadAll = async (): Promise<void> => { await reload(); await reloadCancelled() }

  const sorted = useMemo(
    () => [...accounts].sort((a, b) => (b.soldAtUtc || '').localeCompare(a.soldAtUtc || '')),
    [accounts],
  )

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: sorted.length, Active: 0, Completed: 0, Cancelled: cancelledSales.length }
    for (const a of sorted) c[a.saleStatus]++
    return c
  }, [sorted, cancelledSales])

  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((a) => a.saleStatus === filter)),
    [sorted, filter],
  )
  const visible = filter === 'Cancelled' ? [] : filtered.slice(0, limit)

  // KPI: iptal edilen satışlar ciroya sayılmaz (geri alınmış işlem).
  const kpi = useMemo(() => {
    const live = sorted.filter((a) => a.saleStatus !== 'Cancelled')
    const revenue = live.reduce((s, a) => s + a.totalAmount, 0)
    const remaining = live.reduce((s, a) => s + a.remainingAmount, 0)
    const sessionsTotal = live.reduce((s, a) => s + a.sessionsTotal, 0)
    const sessionsUsed = live.reduce((s, a) => s + a.sessionsUsed, 0)
    const customers = new Set(live.map((a) => a.customerId)).size
    return { count: live.length, revenue, remaining, sessionsTotal, sessionsUsed, customers }
  }, [sorted])

  /** "Kim sattı" — personel bazlı adet/ciro payı (iptaller hariç). */
  const sellers = useMemo(() => {
    const map = new Map<string, { name: string; count: number; amount: number }>()
    for (const a of sorted) {
      if (a.saleStatus === 'Cancelled') continue
      const name = a.soldByStaffName || 'Belirtilmemiş'
      const cur = map.get(name) ?? { name, count: 0, amount: 0 }
      cur.count++
      cur.amount += a.totalAmount
      map.set(name, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.count - a.count)
  }, [sorted])

  return (
    <>
      <div className="rounded-[14px] border border-[#ead8df]/65 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-[#c85776]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">Satış performansı</span>
            {sorted.length > 0 && (
              <span className="rounded-full bg-[#fff1f6] px-2 py-0.5 text-[10px] font-bold text-[#a34a62]">{sorted.length}</span>
            )}
          </div>
          {canManage && kind !== 'category' && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#e0d3f2] bg-[#faf6ff] px-2.5 py-1 text-[10px] font-semibold text-[#6b4aa0] transition-colors hover:bg-[#f2ebff]"
            >
              <History className="h-3 w-3" /> Geçmiş satış ekle
            </button>
          )}
        </div>

        {/* KPI şeridi */}
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi icon={Package} label="Satış" value={String(kpi.count)} sub={`${kpi.customers} müşteri`} />
          <Kpi icon={Wallet} label="Ciro" value={formatTL(Math.round(kpi.revenue))} sub={kpi.remaining > 0.005 ? `${formatTL(Math.round(kpi.remaining))} kalan` : 'Tahsil edildi'} />
          <Kpi
            icon={CalendarClock}
            label="Seans"
            value={kpi.sessionsTotal > 0 ? `${kpi.sessionsUsed}/${kpi.sessionsTotal}` : '—'}
            sub={kpi.sessionsTotal > 0 ? `${kpi.sessionsTotal - kpi.sessionsUsed} kalan` : 'Seanssız'}
          />
          <Kpi icon={Users} label="Ortalama" value={kpi.count > 0 ? formatTL(Math.round(kpi.revenue / kpi.count)) : '—'} sub="satış başına" />
        </div>

        {/* Kim sattı */}
        {sellers.length > 0 && (
          <div className="mt-2.5 rounded-[11px] border border-[#f2e6eb] bg-[#fffafc] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">
              <UserCheck className="h-3 w-3 text-[#c85776]" /> Kim sattı
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sellers.slice(0, 5).map((s) => {
                const share = kpi.revenue > 0 ? Math.round((s.amount / kpi.revenue) * 100) : 0
                return (
                  <span
                    key={s.name}
                    title={`${s.name} · ${s.count} satış · ${formatTL(Math.round(s.amount))}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#ead8df] bg-white px-2 py-1 text-[10px] font-semibold text-[#4a3a44]"
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[7px] font-bold text-white">
                      {initials(s.name)}
                    </span>
                    {s.name}
                    <span className="text-[#a34a62]">×{s.count}</span>
                    <span className="text-[#705a66]">%{share}</span>
                  </span>
                )
              })}
              {sellers.length > 5 && <span className="self-center text-[10px] text-[#705a66]">+{sellers.length - 5}</span>}
            </div>
          </div>
        )}

        {/* Filtreler */}
        {sorted.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => { setFilter(f.key); setLimit(VISIBLE_STEP) }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  filter === f.key ? 'bg-[#c85776] text-white' : 'bg-[#fff5f8] text-[#705a66] hover:text-[#a34a62]'
                }`}
              >
                {f.label} {counts[f.key] > 0 && <span className="opacity-70">{counts[f.key]}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Satış listesi. "İptal" sekmesi arşivden okunur — o satışların canlı kaydı yoktur. */}
        <div className="mt-2 space-y-1.5">
          {filter === 'Cancelled' ? (
            cancelledSales.length === 0 ? (
              <div className="rounded-[11px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-5 text-center text-[11px] text-[#705a66]">
                İptal edilmiş satış yok.
              </div>
            ) : (
              cancelledSales.map((c) => (
                <div key={c.id} className="rounded-[11px] border border-rose-100 bg-rose-50/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-[#352432]">{c.customerName || c.name}</div>
                      <div className="truncate text-[10.5px] text-[#705a66]">
                        {c.cancellationReason || 'gerekçe belirtilmemiş'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[12.5px] font-bold tabular-nums text-[#352432]">{formatTL(c.totalAmount)}</div>
                      <div className="text-[10px] text-[#705a66]">
                        tahsil {formatTL(c.collectedAmount)}{c.refundedAmount > 0.005 ? ` · iade ${formatTL(c.refundedAmount)}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )
          ) : visible.length === 0 ? (
            <div className="rounded-[11px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-5 text-center text-[11px] text-[#705a66]">
              {sorted.length === 0
                ? kind === 'category'
                  ? `"${item.name}" kategorisinde henüz satış yok.`
                  : `Bu ${kind === 'package' ? 'paket' : 'hizmet'} henüz satılmamış. Geçmiş satışları da buradan girebilirsiniz.`
                : 'Bu durumda satış yok.'}
            </div>
          ) : (
            visible.map((a) => <CatalogSaleRow key={a.id} account={a} showItemName={kind === 'category'} onClick={() => setDetailId(a.id)} />)
          )}
        </div>

        {filter !== 'Cancelled' && filtered.length > visible.length && (
          <button
            type="button"
            onClick={() => setLimit((v) => v + VISIBLE_STEP)}
            className="mx-auto mt-2 flex w-max items-center gap-1 rounded-full border border-[#ead8df] bg-white px-3 py-1 text-[10px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6]"
          >
            {filtered.length - visible.length} satış daha
          </button>
        )}
      </div>

      <AnimatePresence>
        {detailId && (() => {
          const acc = sorted.find((a) => a.id === detailId)
          if (!acc) return null
          return (
            <SaleDetailModal
              account={acc}
              customerName={acc.customerName}
              canManage={canManage}
              busy={busy}
              onClose={() => setDetailId(null)}
              onCancelSale={async (id, reason, refunded, method) => { await onCancelSale(id, reason, refunded, method); setDetailId(null); await reloadAll() }}
              onRestoreSale={async (id) => { await onRestoreSale(id); await reloadAll() }}
              onCollectInstallment={
                onCollectInstallment && (async (id, amount) => { await onCollectInstallment(id, amount); await reload() })
              }
            />
          )
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {/* Geçmiş satış girişi tek bir katalog kaydına bağlıdır; kategori görünümünde açılmaz. */}
        {historyOpen && kind !== 'category' && (
          <HistoricalSaleDialog
            customerName={item.name}
            needsCustomer
            tenantId={tenantId}
            preset={{ kind, id: item.id, name: item.name, price: item.price }}
            staffOptions={staffOptions}
            packageOptions={packageOptions}
            serviceOptions={serviceOptions}
            busy={busy}
            onClose={() => setHistoryOpen(false)}
            onSubmit={async (values) => {
              await onCreateHistorical(values)
              await reload()
              setHistoryOpen(false)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof Package; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[11px] border border-[#ead8df]/65 bg-[#fffafc] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest text-[#352432]/40">
        <Icon className="h-3 w-3 text-[#c85776]" /> {label}
      </div>
      <div className="mt-0.5 truncate font-display text-[15px] tabular-nums text-[#352432]">{value}</div>
      <div className="truncate text-[9px] text-[#705a66]">{sub}</div>
    </div>
  )
}

function CatalogSaleRow({ account, onClick, showItemName = false }: { account: CustomerAccount; onClick: () => void; showItemName?: boolean }) {
  const meta = STATUS_META[account.saleStatus]
  const StatusIcon = meta.icon

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      className={`group flex w-full items-center gap-2 rounded-[11px] border px-2.5 py-2 text-left transition-colors ${
        account.saleStatus === 'Cancelled'
          ? 'border-[#f3dfe4] bg-[#fffafb] opacity-80 hover:opacity-100'
          : 'border-[#f0e0e6] bg-white hover:border-[#e7bccb] hover:bg-[#fffafc]'
      }`}
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-[8px] border ${meta.pill}`}>
        <StatusIcon className="h-3 w-3" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1">
          <span className="truncate text-[12px] font-semibold text-[#352432]">{account.customerName}</span>
          {account.isHistorical && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-1.5 py-0.5 text-[8px] font-bold text-[#6b4aa0]">
              <Archive className="h-2 w-2" /> Geçmiş
            </span>
          )}
        </span>
        {showItemName && (
          <span className="mt-0.5 block truncate text-[10.5px] font-medium text-[#a34a62]">{account.name}</span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-[#705a66]">
          <span>{formatSaleDate(account.soldAtUtc)}</span>
          <span className="text-[#c9b3bd]">·</span>
          <span>{account.soldByStaffName || 'Satan belirtilmemiş'}</span>
          {account.sessionsTotal > 0 && (
            <>
              <span className="text-[#c9b3bd]">·</span>
              <span className="font-semibold text-[#4a3a44]">{account.sessionsUsed}/{account.sessionsTotal} seans</span>
            </>
          )}
        </span>
        {/* İptal gerekçesi listede de görünür — katalogda "hangi paket neden iptal edildi" sorusu. */}
        {account.saleStatus === 'Cancelled' && (
          <span className="mt-0.5 block truncate text-[9.5px] italic text-[#b3453f]">
            Gerekçe: {account.cancellationReason || 'belirtilmemiş'}
          </span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="font-display text-[12.5px] font-bold text-[#352432]">{formatTL(Math.round(account.totalAmount))}</span>
        <span className={`text-[9px] font-semibold ${account.remainingAmount > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}`}>
          {account.remainingAmount > 0.005 ? `${formatTL(Math.round(account.remainingAmount))} kalan` : 'Ödendi'}
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#c9b3bd] transition-transform group-hover:translate-x-0.5 group-hover:text-[#c85776]" />
    </motion.button>
  )
}

function initials(name: string): string {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toLocaleUpperCase('tr')
}
