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
  Sparkles,
  User,
  XCircle,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { CustomerAccount, SaleStatusKey } from '@/lib/types'
import SaleDetailModal from '@/components/dashboard/SaleDetailModal'
import type { IdempotentWriteOptions } from '@/lib/idempotency'
import HistoricalSaleDialog, { type HistoricalCatalogOption, type HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'

/**
 * Müşteri kartındaki "Paket & Hizmet Satışları" paneli.
 *
 * Aktif, tamamlanmış (seansı biten) ve iptal edilmiş satışları tek listede gösterir; her satırda
 * satış tarihi, satan personel, seans durumu ve ödeme durumu bulunur. Satıra tıklandığında satışın
 * ayrıntı modali açılır. "Geçmiş satış ekle" ile yazılıma geçmeden önce yapılmış satışlar da
 * sisteme girilebilir — geçmiş kayıtlar listede ayrı rozetle işaretlenir.
 *
 * `variant`:
 *   - `card`  → kendi başlıklı beyaz kartını çizer (sayfa içine gömülü kullanım).
 *   - `flush` → çerçevesiz; başlık/özet dışarıdaki kabuğa (`CustomerSalesModal`) aittir, liste
 *               geniş ekranda iki sütuna açılır.
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

/** "2026-07-14T…" → "14 Tem 2026" */
export function formatSaleDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CustomerSalesPanel({
  customerName,
  accounts,
  staffOptions,
  packageOptions,
  serviceOptions,
  canManage = true,
  busy = false,
  variant = 'card',
  onCreateHistorical,
  onCancelSale,
  onRestoreSale,
  onCollectInstallment,
}: {
  customerName: string
  accounts: CustomerAccount[]
  staffOptions: { id: string; name: string }[]
  packageOptions: HistoricalCatalogOption[]
  serviceOptions: HistoricalCatalogOption[]
  canManage?: boolean
  busy?: boolean
  variant?: 'card' | 'flush'
  onCreateHistorical: (values: HistoricalSaleValues) => Promise<void>
  onCancelSale: (accountId: string, reason: string, refundedAmount: number, refundMethod: string) => Promise<void>
  onRestoreSale: (accountId: string) => Promise<void>
  onCollectInstallment?: (accountId: string, amount: number, opts: IdempotentWriteOptions) => Promise<void>
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Satış tarihine göre yeni → eski. Geçmiş kayıtlar da doğru yere oturur.
  const sorted = useMemo(
    () => [...accounts].sort((a, b) => (b.soldAtUtc || '').localeCompare(a.soldAtUtc || '')),
    [accounts],
  )
  const visible = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((a) => a.saleStatus === filter)),
    [sorted, filter],
  )
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: sorted.length, Active: 0, Completed: 0, Cancelled: 0 }
    for (const a of sorted) c[a.saleStatus]++
    return c
  }, [sorted])

  const selected = useMemo(() => sorted.find((a) => a.id === detailId) || null, [sorted, detailId])
  const flush = variant === 'flush'

  const historyButton = canManage ? (
    <button
      type="button"
      onClick={() => setHistoryOpen(true)}
      className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#efe1e7] bg-[#fffafc] font-semibold text-[#a34a62] transition-colors hover:border-[#e7bccb] hover:bg-[#fff2f6] ${
        flush ? 'px-3 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[10px]'
      }`}
    >
      <History className="h-3.5 w-3.5" /> Geçmiş satış ekle
    </button>
  ) : null

  return (
    <>
      <div className={flush ? '' : 'rounded-[18px] border border-[#f0e0e6] bg-white p-4'}>
        {/* Başlık yalnız gömülü kartta; modalda başlık zaten kabuğun üstünde duruyor. */}
        {!flush && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f7ebef] pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-[#c85776]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#c85776]">Paket & Hizmet Satışları</span>
              {sorted.length > 0 && (
                <span className="rounded-full bg-[#fff1f6] px-2 py-0.5 text-[10px] font-bold text-[#a34a62]">{sorted.length}</span>
              )}
            </div>
            {historyButton}
          </div>
        )}

        {(sorted.length > 0 || flush) && (
          <div className={`flex flex-wrap items-center justify-between gap-2 ${flush ? '' : 'mt-3'}`}>
            <div className="flex flex-wrap gap-1">
              {sorted.length > 0 && FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`cursor-pointer rounded-full font-semibold transition-colors ${flush ? 'px-3 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[10px]'} ${
                    filter === f.key ? 'bg-[#c85776] text-white' : 'border border-[#f0e0e6] bg-white text-[#705a66] hover:border-[#e7bccb] hover:text-[#a34a62]'
                  }`}
                >
                  {f.label} {counts[f.key] > 0 && <span className="opacity-70">{counts[f.key]}</span>}
                </button>
              ))}
            </div>
            {flush && historyButton}
          </div>
        )}

        {/* Geniş modalda liste iki sütuna açılır — 10+ satışlı müşteride tek sütun uzayıp gidiyordu. */}
        <div className={`mt-3 ${flush ? 'grid gap-2.5 xl:grid-cols-2' : 'space-y-2'}`}>
          {visible.length === 0 ? (
            <div className={`rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 text-center text-[12px] text-[#705a66] ${flush ? 'py-10 xl:col-span-2' : 'py-6'}`}>
              {sorted.length === 0
                ? 'Bu müşteriye ait paket veya hizmet satışı yok. Geçmiş satışları da buradan girebilirsiniz.'
                : 'Bu durumda satış yok.'}
            </div>
          ) : (
            visible.map((a) => <SaleRow key={a.id} account={a} onClick={() => setDetailId(a.id)} />)
          )}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <SaleDetailModal
            account={selected}
            customerName={customerName}
            canManage={canManage}
            busy={busy}
            onClose={() => setDetailId(null)}
            onCancelSale={onCancelSale}
            onRestoreSale={onRestoreSale}
            onCollectInstallment={onCollectInstallment}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {historyOpen && (
          <HistoricalSaleDialog
            customerName={customerName}
            staffOptions={staffOptions}
            packageOptions={packageOptions}
            serviceOptions={serviceOptions}
            busy={busy}
            onClose={() => setHistoryOpen(false)}
            onSubmit={async (values) => {
              await onCreateHistorical(values)
              setHistoryOpen(false)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function SaleRow({ account, onClick }: { account: CustomerAccount; onClick: () => void }) {
  const meta = STATUS_META[account.saleStatus]
  const StatusIcon = meta.icon
  const paidPct = account.totalAmount > 0 ? Math.min(100, Math.round((account.paidAmount / account.totalAmount) * 100)) : 100

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      className={`group flex w-full items-start gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
        account.saleStatus === 'Cancelled'
          ? 'border-[#f3dfe4] bg-[#fffafb] opacity-80 hover:opacity-100'
          : 'border-[#f0e0e6] bg-white hover:border-[#e7bccb] hover:bg-[#fffafc]'
      }`}
    >
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border ${meta.pill}`}>
        <StatusIcon className="h-3.5 w-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-[#352432]">{account.name}</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${meta.pill}`}>{meta.label}</span>
          {account.isHistorical && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-1.5 py-0.5 text-[10px] font-bold text-[#6b4aa0]">
              <Archive className="h-2.5 w-2.5" /> Geçmiş kayıt
            </span>
          )}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#705a66]">
          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3 text-[#c85776]" /> {formatSaleDate(account.soldAtUtc)}</span>
          {account.soldByStaffName && (
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-[#c85776]" /> {account.soldByStaffName}</span>
          )}
          {account.appliedByStaffName && (
            <span className="inline-flex items-center gap-1" title="Seansları uygulayan"><Sparkles className="h-3 w-3 text-[#c85776]" /> {account.appliedByStaffName}</span>
          )}
          {/* "2/4 seans" hangi sayının kalan olduğunu söylemiyordu — cevap yazılır. */}
          {account.sessionsTotal > 0 && (
            <span className="font-semibold tabular-nums text-[#4a3a44]">
              {Math.max(0, account.sessionsTotal - account.sessionsUsed)} seans kaldı
              <span className="ml-1 font-normal text-[#705a66]">({account.sessionsTotal} seanslık)</span>
            </span>
          )}
        </span>

        {account.saleStatus === 'Cancelled' && account.cancellationReason && (
          <span className="mt-1 block truncate text-[11px] text-[#b3453f]">Gerekçe: {account.cancellationReason}</span>
        )}

        {/* Ödeme durumu çubuğu */}
        <span className="mt-1.5 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#f6e3ea]">
            <span
              className={`block h-full rounded-full ${account.remainingAmount > 0.005 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
              style={{ width: `${Math.max(3, paidPct)}%` }}
            />
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-[#705a66]">
            {account.remainingAmount > 0.005 ? `${formatTL(Math.round(account.remainingAmount))} kalan` : 'Ödendi'}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-display text-[13.5px] font-bold text-[#352432]">{formatTL(Math.round(account.totalAmount))}</span>
        <ChevronRight className="h-3.5 w-3.5 text-[#c9b3bd] transition-transform group-hover:translate-x-0.5 group-hover:text-[#c85776]" />
      </span>
    </motion.button>
  )
}
