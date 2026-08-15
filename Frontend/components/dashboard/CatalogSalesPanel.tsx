'use client'

import { useMemo, useState, type ReactNode } from 'react'
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
import type { IdempotentWriteOptions } from '@/lib/idempotency'
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
  historyOpen: historyOpenProp,
  onHistoryOpenChange,
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
  /**
   * "Geçmiş satış ekle" DIŞARIDAN yönetilebilir: tetikleyici artık katalog modalinin ALT
   * ÇUBUĞUNDA (Sil'in solunda) duruyor, diyalogun kendisi ise burada — çünkü kaydettikten sonra
   * listeyi tazeleyen `reload` bu panele ait. Verilmezse panel kendi iç durumunu kullanır.
   */
  historyOpen?: boolean
  onHistoryOpenChange?: (next: boolean) => void
  onCreateHistorical: (values: HistoricalSaleValues) => Promise<void>
  onCancelSale: (accountId: string, reason: string, refundedAmount: number, refundMethod: string) => Promise<void>
  onRestoreSale: (accountId: string) => Promise<void>
  onCollectInstallment?: (accountId: string, amount: number, opts: IdempotentWriteOptions) => Promise<void>
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [historyOpenLocal, setHistoryOpenLocal] = useState(false)
  const historyOpen = historyOpenProp ?? historyOpenLocal
  const setHistoryOpen = onHistoryOpenChange ?? setHistoryOpenLocal
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
      <div className="rounded-[14px] border border-[#EAD8DF]/65 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-[#A5556E]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Satış performansı</span>
            {sorted.length > 0 && (
              <span className="rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[10px] font-bold text-[#a34a62]">{sorted.length}</span>
            )}
          </div>
          {/* Tetikleyici KONTROLLÜ kullanımda burada çizilmez: katalog modallerinde alt çubuğa,
              Sil düğmesinin soluna taşındı. Panelin tek başına kullanıldığı yerlerde kalır. */}
          {canManage && kind !== 'category' && historyOpenProp === undefined && (
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
          <div className="mt-2.5 rounded-[11px] border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#74616A]">
              <UserCheck className="h-3 w-3 text-[#A5556E]" /> Kim sattı
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sellers.slice(0, 5).map((s) => {
                const share = kpi.revenue > 0 ? Math.round((s.amount / kpi.revenue) * 100) : 0
                return (
                  <span
                    key={s.name}
                    title={`${s.name} · ${s.count} satış · ${formatTL(Math.round(s.amount))}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-white px-2 py-1 text-[10px] font-semibold text-[#3E343A]"
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[7px] font-bold text-white">
                      {initials(s.name)}
                    </span>
                    {s.name}
                    <span className="text-[#a34a62]">×{s.count}</span>
                    <span className="text-[#74616A]">%{share}</span>
                  </span>
                )
              })}
              {sellers.length > 5 && <span className="self-center text-[10px] text-[#74616A]">+{sellers.length - 5}</span>}
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
                  filter === f.key ? 'bg-[#A5556E] text-white' : 'bg-[#fff5f8] text-[#74616A] hover:text-[#a34a62]'
                }`}
              >
                {f.label} {counts[f.key] > 0 && <span className="opacity-70">{counts[f.key]}</span>}
              </button>
            ))}
          </div>
        )}

        {/* SATIŞ TABLOSU. Eskiden satır içi sıkıştırılmış kartlardı: "hangi müşteriye hangi
            personel satmış" sorusu için göz her satırda farklı yerde arıyordu. Artık sabit
            sütunlar — müşteri ve satan personel aynı hizada okunur.
            "İptal" sekmesi ARŞİVDEN okunur; o satışların canlı kaydı yoktur, sütunları da
            farklıdır (iade/gerekçe), bu yüzden kendi tablosu vardır. */}
        <div className="mt-2 overflow-x-auto">
          {filter === 'Cancelled' ? (
            cancelledSales.length === 0 ? (
              <EmptyRow>İptal edilmiş satış yok.</EmptyRow>
            ) : (
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <Th>Müşteri</Th>
                    <Th>Satan personel</Th>
                    <Th>Satış · İptal</Th>
                    <Th align="right">Tutar</Th>
                    <Th align="right">Tahsil / İade</Th>
                    <Th>Gerekçe</Th>
                  </tr>
                </thead>
                <tbody>
                  {cancelledSales.map((c, i) => (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.024, 0.2) }}
                      className="bg-rose-50/40"
                    >
                      <Td>
                        <span className="block truncate font-semibold text-[#2A2027]">{c.customerName || c.name}</span>
                        <span className="block truncate text-[10.5px] text-[#74616A]">{c.name}</span>
                      </Td>
                      <Td><SellerCell name={c.soldByStaffName} /></Td>
                      <Td>
                        <span className="block tabular-nums text-[#3E343A]">{formatSaleDate(c.soldAtUtc)}</span>
                        <span className="block tabular-nums text-[10.5px] text-[#b3453f]">{formatSaleDate(c.cancelledAtUtc)}</span>
                      </Td>
                      <Td align="right"><span className="font-semibold tabular-nums text-[#2A2027]">{formatTL(Math.round(c.totalAmount))}</span></Td>
                      <Td align="right">
                        <span className="block tabular-nums text-[#2c7d63]">{formatTL(Math.round(c.collectedAmount))}</span>
                        {c.refundedAmount > 0.005 && (
                          <span className="block tabular-nums text-[10.5px] text-[#8A5A11]">iade {formatTL(Math.round(c.refundedAmount))}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="block max-w-[220px] truncate text-[#5A4B53]" title={c.cancellationReason || undefined}>
                          {c.cancellationReason || 'belirtilmemiş'}
                        </span>
                      </Td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            )
          ) : visible.length === 0 ? (
            <EmptyRow>
              {sorted.length === 0
                ? kind === 'category'
                  ? `"${item.name}" kategorisinde henüz satış yok.`
                  : `Bu ${kind === 'package' ? 'paket' : 'hizmet'} henüz satılmamış. Geçmiş satışları da buradan girebilirsiniz.`
                : 'Bu durumda satış yok.'}
            </EmptyRow>
          ) : (
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <Th>Müşteri</Th>
                  {kind === 'category' && <Th>Kayıt</Th>}
                  <Th>Satan personel</Th>
                  <Th>Tarih</Th>
                  <Th>Seans</Th>
                  <Th align="right">Tutar</Th>
                  <Th align="right">Kalan</Th>
                  <Th>Durum</Th>
                  <Th align="right" srOnly>Aç</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a, i) => (
                  <CatalogSaleRow
                    key={a.id}
                    index={i}
                    account={a}
                    showItemName={kind === 'category'}
                    onClick={() => setDetailId(a.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filter !== 'Cancelled' && filtered.length > visible.length && (
          <button
            type="button"
            onClick={() => setLimit((v) => v + VISIBLE_STEP)}
            className="mx-auto mt-2 flex w-max items-center gap-1 rounded-full border border-[#EAD8DF] bg-white px-3 py-1 text-[10px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6]"
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
                onCollectInstallment && (async (id, amount, opts) => { await onCollectInstallment(id, amount, opts); await reload() })
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
    <div className="rounded-[11px] border border-[#EAD8DF]/65 bg-[#F7F6F6] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest text-[#74616A]">
        <Icon className="h-3 w-3 text-[#A5556E]" /> {label}
      </div>
      <div className="mt-0.5 truncate font-display text-[15px] tabular-nums text-[#2A2027]">{value}</div>
      <div className="truncate text-[9px] text-[#74616A]">{sub}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Tablo parçaları — başlık şeridi yapışkan değil (panel zaten kısa), */
/* ama sütun hizası sabittir: göz aynı yerde arar.                    */
/* ---------------------------------------------------------------- */

function Th({ children, align = 'left', srOnly = false }: { children: ReactNode; align?: 'left' | 'right'; srOnly?: boolean }) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#74616A] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <td className={`border-b border-[#f4ebee] px-2.5 py-2 align-middle text-[11.5px] ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </td>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[11px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-5 text-center text-[11px] text-[#74616A]">
      {children}
    </div>
  )
}

/** Satan personel hücresi — baş harf madalyonu + ad; boşsa açıkça "belirtilmemiş". */
function SellerCell({ name }: { name?: string | null }) {
  const label = (name || '').trim()
  if (!label) return <span className="whitespace-nowrap text-[11px] text-[#74616A]">Belirtilmemiş</span>
  return (
    <span className="flex items-center gap-1.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[8px] font-bold text-white">
        {initials(label)}
      </span>
      <span className="truncate font-medium text-[#3E343A]">{label}</span>
    </span>
  )
}

function CatalogSaleRow({ account, onClick, showItemName = false, index = 0 }: { account: CustomerAccount; onClick: () => void; showItemName?: boolean; index?: number }) {
  const meta = STATUS_META[account.saleStatus]
  const StatusIcon = meta.icon
  const remainingSessions = Math.max(0, account.sessionsTotal - account.sessionsUsed)

  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.024, 0.2) }}
      onClick={onClick}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`group cursor-pointer transition-colors focus:outline-none focus-visible:bg-[#F6DFE6] ${
        account.saleStatus === 'Cancelled' ? 'bg-[#F7F6F6] hover:bg-[#f3e9ed]' : 'bg-white hover:bg-[#FDF7F9]'
      }`}
    >
      <Td>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-semibold text-[#2A2027]">{account.customerName}</span>
          {account.isHistorical && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-1.5 py-0.5 text-[10px] font-bold text-[#6b4aa0]">
              <Archive className="h-2.5 w-2.5" /> Geçmiş
            </span>
          )}
        </span>
        {/* İptal gerekçesi katalogda önemli: "hangi paket neden iptal edildi". */}
        {account.saleStatus === 'Cancelled' && (
          <span className="block truncate text-[10.5px] text-[#b3453f]" title={account.cancellationReason || undefined}>
            Gerekçe: {account.cancellationReason || 'belirtilmemiş'}
          </span>
        )}
      </Td>
      {showItemName && (
        <Td><span className="block max-w-[200px] truncate font-medium text-[#a34a62]" title={account.name}>{account.name}</span></Td>
      )}
      <Td><SellerCell name={account.soldByStaffName} /></Td>
      <Td><span className="whitespace-nowrap tabular-nums text-[#3E343A]">{formatSaleDate(account.soldAtUtc)}</span></Td>
      <Td>
        {account.sessionsTotal > 0 ? (
          // "2/4" hangi sayının kalan olduğunu söylemiyordu — cevap doğrudan yazılır.
          <span className="whitespace-nowrap font-semibold tabular-nums text-[#3E343A]">{remainingSessions} seans kaldı</span>
        ) : (
          <span className="text-[#74616A]">—</span>
        )}
      </Td>
      <Td align="right"><span className="whitespace-nowrap font-display text-[12.5px] font-bold tabular-nums text-[#2A2027]">{formatTL(Math.round(account.totalAmount))}</span></Td>
      <Td align="right">
        <span className={`whitespace-nowrap font-semibold tabular-nums ${account.remainingAmount > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}`}>
          {account.remainingAmount > 0.005 ? formatTL(Math.round(account.remainingAmount)) : 'Ödendi'}
        </span>
      </Td>
      <Td>
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.pill}`}>
          <StatusIcon className="h-3 w-3" /> {meta.label}
        </span>
      </Td>
      <Td align="right">
        <ChevronRight className="inline h-3.5 w-3.5 text-[#c9b3bd] transition-transform group-hover:translate-x-0.5 group-hover:text-[#A5556E]" />
      </Td>
    </motion.tr>
  )
}

function initials(name: string): string {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toLocaleUpperCase('tr')
}
