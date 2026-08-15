'use client'

import { useEffect, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ProductFormDialog from '@/components/dashboard/ProductFormDialog'
import ProductDetailModal from '@/components/dashboard/ProductDetailModal'
import { catalogDangerBtn, catalogPrimaryBtn } from '@/components/dashboard/CatalogKit'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { usePermission } from '@/hooks/usePermission'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeProduct, normalizeStockMovement, productCategoryLabels } from '@/lib/apiMappers'
import { localDateKey } from '@/lib/datetime'
import {
  AlertTriangle, Boxes, ChevronLeft, ChevronRight, FileUp, Layers3, Package, PackagePlus,
  PencilLine, Repeat, Search, Trash2, TrendingUp
} from 'lucide-react'
import type { ApiProduct, ApiStockMovement, Product, ProductCategoryKey, StockMovement } from '@/lib/types'

type TabKey = 'all' | 'critical' | 'sale' | 'consumable'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'critical', label: 'Kritik stok' },
  { key: 'sale', label: 'Satış ürünleri' }, { key: 'consumable', label: 'Sarf malzeme' },
]
const STATUS_LABEL = { sufficient: 'Aktif', critical: 'Kritik', out: 'Tükenen' } as const
const STATUS_TONE = {
  sufficient: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  critical: 'border-amber-300/40 bg-amber-50 text-amber-700',
  out: 'border-rose-300/40 bg-rose-50 text-rose-700',
} as const
const MOVE_LABEL: Record<string, string> = { Inbound: 'Stok Girişi', Outbound: 'Stok Çıkışı', Sale: 'Satış', Adjustment: 'Sayım', Damage: 'Fire' }
const MOVE_TONE: Record<string, string> = {
  Inbound: 'bg-emerald-50 text-emerald-700', Outbound: 'bg-rose-50 text-rose-700',
  Sale: 'bg-violet-50 text-violet-700', Adjustment: 'bg-amber-50 text-amber-700', Damage: 'bg-rose-50 text-rose-700',
}

function BarSpark({ values, tone = '#d7839d' }: { values: number[]; tone?: string }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <span key={i} className="w-[5px] rounded-t-sm" style={{ height: `${Math.max(8, (v / max) * 100)}%`, backgroundColor: tone, opacity: 0.35 + (i / values.length) * 0.65 }} />
      ))}
    </div>
  )
}
function bucketDaily(times: number[], n = 12): number[] {
  const now = Date.now(); const day = 86_400_000 * 3; const start = now - n * day; const b = Array(n).fill(0)
  for (const t of times) { if (t < start || t > now) continue; b[Math.min(n - 1, Math.floor((t - start) / day))]++ }
  return b
}

export default function ProductLibrary({
  tenantId, branchId, institutionName, branchLabel, initialTab = 'all',
}: {
  tenantId?: string; branchId?: string | null; institutionName?: string; branchLabel?: string; initialTab?: TabKey
}) {
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [q, setQ] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Künye artık sağ sütunda değil, hizmet/paket kartlarıyla aynı dilde bir modalde. */
  const [detailOpen, setDetailOpen] = useState(false)
  /** Hareket kaydedilince artar; modaldeki ürün-bazlı hareket listesini tazeler. */
  const [movementsKey, setMovementsKey] = useState(0)
  // Ürün silme ayrı yetki (Stock.Delete) — yetkisiz personelde buton görünmez.
  const canDeleteProduct = usePermission().can('Stock.Delete')
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [moveDialog, setMoveDialog] = useState<{ type: 'Inbound' | 'Outbound'; qty: number; unitCost: number; notes: string; date: string } | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const { isStaff, performWrite } = useStaffApproval()

  const { data, loading, error, reload } = useApiQuery<{ products: ApiProduct[]; movements: ApiStockMovement[] }>(
    async () => {
      if (!tenantId) return { products: [], movements: [] }
      const [products, movements] = await Promise.all([
        adminApi.products<ApiProduct>({ tenantId, page: 1, pageSize: 500 }),
        adminApi.stockMovements<ApiStockMovement>({ tenantId, limit: 300 }).catch(() => []),
      ])
      return { products: apiItems(products), movements: Array.isArray(movements) ? movements : [] }
    },
    [tenantId],
    { initialData: { products: [], movements: [] } },
  )

  const products = useMemo(() => (data?.products || []).map((p, i) => normalizeProduct(p, i)), [data])
  const movements = useMemo(() => (data?.movements || []).map((m, i) => normalizeStockMovement(m, i)), [data])
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // ---- istatistikler
  const criticalCount = products.filter((p) => p.status === 'critical').length
  const outCount = products.filter((p) => p.status === 'out').length
  const costValue = products.reduce((a, p) => a + p.stockValueCost, 0)
  const saleValue = products.reduce((a, p) => a + p.stockValueSale, 0)
  const thisMonth = new Date(); const monthPrefix = `${String(thisMonth.getMonth() + 1).padStart(2, '0')}.${thisMonth.getFullYear()}`
  const newThisMonth = products.filter((p) => p.updatedAt.includes(monthPrefix)).length
  const moveSeries = useMemo(() => bucketDaily(movements.map((m) => new Date(m.occurredAt).getTime()).filter((t) => !Number.isNaN(t))), [movements])

  // ---- filtre + sayfalama
  const filtered = useMemo(() => {
    let list = products
    if (tab === 'critical') list = list.filter((p) => p.status !== 'sufficient')
    else if (tab === 'sale') list = list.filter((p) => p.salePrice > 0)
    else if (tab === 'consumable') list = list.filter((p) => p.category === 'Consumable' || p.salePrice <= 0)
    if (catFilter) list = list.filter((p) => p.category === catFilter)
    if (statusFilter) list = list.filter((p) => p.status === statusFilter)
    if (q.trim()) { const t = q.trim().toLocaleLowerCase('tr'); list = list.filter((p) => p.name.toLocaleLowerCase('tr').includes(t) || p.barcode.includes(t)) }
    return list
  }, [products, tab, catFilter, statusFilter, q])
  useEffect(() => { setPage(1) }, [tab, catFilter, statusFilter, q, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  // SEÇİM ARTIK AÇIK BİR EYLEM: eskiden süzgeç değişince `filtered[0]`e kayıyor ve sağ panel
  // kullanıcının açmadığı bir ürünün künyesini gösteriyordu. Modal yalnız tıklanan kaydı açar.
  const sel = useMemo(() => products.find((p) => p.id === selectedId) || null, [products, selectedId])
  const openDetail = (p: Product) => { setSelectedId(p.id); setMoveDialog(null); setActionError(''); setDetailOpen(true) }

  // ---- kategori bazlı değer
  const catValues = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) m.set(p.categoryLabel, (m.get(p.categoryLabel) ?? 0) + p.stockValueCost)
    const total = Math.max(1, costValue)
    return Array.from(m.entries()).map(([name, v]) => ({ name, value: v, pct: Math.round((v / total) * 100) })).sort((a, b) => b.value - a.value)
  }, [products, costValue])

  // ---- stok özeti
  const totalUnits = products.reduce((a, p) => a + p.currentStock, 0)
  const criticalUnits = products.filter((p) => p.status === 'critical').reduce((a, p) => a + p.currentStock, 0)
  const sales30 = useMemo(() => {
    const since = Date.now() - 30 * 86_400_000
    return movements.filter((m) => (m.type === 'Sale' || m.type === 'Outbound') && new Date(m.occurredAt).getTime() >= since).reduce((a, m) => a + m.quantity, 0)
  }, [movements])
  const turnover = totalUnits > 0 ? Math.round((sales30 / totalUnits) * 10) / 10 : 0

  // ---- formlar
  type FV = Record<string, unknown>
  const productPayload = (v: FV, p?: Product): Record<string, unknown> => ({
    branchId: p?.branchId || branchId || null,
    name: v.name, category: v.category || 'SkinCare', unit: v.unit || 'adet',
    location: (v.location as string) || null,
    cost: Number(v.cost || 0), salePrice: Number(v.salePrice || 0),
    minStockLevel: Number(v.minStockLevel || 0), isActive: v.isActive !== false,
    barcode: (v.barcode as string)?.trim() || p?.barcode || null,
    imageUrl: typeof v.imageUrl === 'string' ? v.imageUrl : (p?.imageUrl ?? null),
    brand: (v.brand as string) || null,
    expiryDate: (v.expiryDate as string) || null,
    lotNumber: (v.lotNumber as string) || null,
  })

  const submitMove = async () => {
    if (!sel || !moveDialog) return
    if (moveDialog.qty <= 0) { setActionError('Miktar pozitif olmalı.'); return }
    setMoveBusy(true); setActionError('')
    try {
      // HAREKET TARİHİ kullanıcıdan gelir: mal dün girdiyse stok/maliyet raporu bugüne yazılmamalı.
      // Girilen gün YEREL yorumlanır; saat olarak günün başlangıcı alınır (ileri tarih engellenir).
      const occurredAt = moveDialog.date ? new Date(`${moveDialog.date}T00:00:00`) : new Date()
      const payload = {
        type: moveDialog.type, quantity: moveDialog.qty,
        unitCost: moveDialog.unitCost ? moveDialog.unitCost : null,
        occurredAtUtc: (Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt).toISOString(),
        reference: null, notes: moveDialog.notes || null, staffMemberId: null,
      }
      const res = await performWrite({
        operationType: 'CreateStockMovement',
        title: `Stok hareketi: ${sel.name} (${moveDialog.type})`,
        summary: `${MOVE_LABEL[moveDialog.type]} · ${moveDialog.qty}`,
        payload: { productId: sel.id, ...payload },
        tenantId,
        directAction: () => adminApi.addStockMovement(sel.id, payload, tenantId),
      })
      if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Stok hareketi'))
      setMoveDialog(null)
      setMovementsKey((k) => k + 1)
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Hareket kaydedilemedi.') } finally { setMoveBusy(false) }
  }

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => { const out: (number | '...')[] = []; for (let p = 1; p <= totalPages; p++) { if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) out.push(p); else if (out[out.length - 1] !== '...') out.push('...') } return out }, [page, totalPages])

  const stockTone = (p: Product) => (p.status === 'out' ? 'text-rose-600' : p.status === 'critical' ? 'text-amber-600' : 'text-emerald-700')

  return (
    <>
      <Topbar
        title="Stok & Ürün"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · ${TABS.find((t) => t.key === tab)?.label}`}
        breadcrumbs={['Admin', 'Genel', 'Stok & Ürün', TABS.find((t) => t.key === tab)?.label || 'Tüm Ürünler']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProductFormDialog
              mode="create"
              onSubmit={async (v) => { await adminApi.createProduct(productPayload(v as unknown as FV), tenantId); await reload() }}
              trigger={
                <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                  <PackagePlus className="h-4 w-4" strokeWidth={2.1} /> Ürün Ekle
                </button>
              }
            />
            <ExcelTransferActions<Product>
              featureKey="excel.services" moduleName="Stok" context={`${institutionName || 'Kurum'} · ${branchLabel || ''}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} ürün`,
                columns: [
                  { key: 'name', header: 'Ürün', width: 28, type: 'text', accessor: (p) => p.name },
                  { key: 'barcode', header: 'Barkod', width: 18, type: 'text', accessor: (p) => p.barcode },
                  { key: 'category', header: 'Kategori', width: 16, type: 'text', accessor: (p) => p.categoryLabel },
                  { key: 'stock', header: 'Stok', width: 10, type: 'number', accessor: (p) => p.currentStock },
                  { key: 'min', header: 'Min. Stok', width: 10, type: 'number', accessor: (p) => p.minStockLevel },
                  { key: 'cost', header: 'Maliyet', width: 14, type: 'currency', accessor: (p) => p.cost },
                  { key: 'sale', header: 'Satış Fiyatı', width: 14, type: 'currency', accessor: (p) => p.salePrice },
                  { key: 'brand', header: 'Marka', width: 16, type: 'text', accessor: (p) => p.brand },
                  { key: 'status', header: 'Durum', width: 12, type: 'text', accessor: (p) => STATUS_LABEL[p.status] },
                ],
                totals: { name: 'TOPLAM', cost: filtered.reduce((a, p) => a + p.stockValueCost, 0) },
              }}
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi: kolon adlarına
                bağlı değil (otomatik eşleme), mükerrer kaydı atlar ve tek istekte parti
                hâlinde gönderir. Eskiden burada satır başına bir API çağrısı yapan,
                başlıkları birebir tutturmayı şart koşan bir döngü vardı. */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#BE7690] bg-white px-4 py-2 text-[12px] font-semibold text-[#A5556E] transition-transform hover:-translate-y-0.5 hover:bg-[#F7F6F6]"
            >
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      <div className="relative mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6 xl:px-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && products.length === 0} emptyMessage="Ürün kaydı yok." />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}
        {actionMsg && <div className="rounded-[12px] border border-emerald-300/30 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700">{actionMsg}</div>}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Toplam ürün', value: String(products.length), sub: `↗ ${newThisMonth} yeni bu ay`, icon: Package },
            { label: 'Kritik / tükenen', value: String(criticalCount + outCount), sub: `${criticalCount} kritik · ${outCount} tükenen`, icon: AlertTriangle },
            { label: 'Stok maliyeti', value: formatTL(costValue), sub: 'Bu ay toplamı', icon: Layers3 },
            { label: 'Satış değeri (perakende)', value: formatTL(saleValue), sub: 'Tahmini perakende değer', icon: TrendingUp },
          ].map((c) => (
            <div key={c.label} className="rounded-[18px] border border-[#EAD8DF] bg-white p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#A5556E] text-white"><c.icon className="h-4 w-4" /></span>
                <BarSpark values={moveSeries} />
              </div>
              <div className="mt-2 text-[11px] font-mono uppercase tracking-widest text-[#74616A]">{c.label}</div>
              <div className="font-display text-3xl tabular-nums tracking-tight">{c.value}</div>
              <div className="mt-0.5 text-[10px] text-[#74616A]">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ANA LİSTE — tam genişlik. Künye sağ sütunda değil, satıra tıklayınca modalde açılır
            (hizmet ve paket sayfalarındaki desenin aynısı): tablo artık sıkışmıyor. */}
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white">
            <div className="border-b border-[#EAD8DF] px-5 py-4">
              <div className="font-display text-xl tracking-tight">Ürün Kütüphanesi <span className="ml-1 rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[12px] text-[#8C4460]">{filtered.length}</span></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#EAD8DF] bg-[#F7F6F6] p-1">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:bg-white'}`}>{t.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün adı, barkod…" className="w-44 rounded-[10px] border border-[#EAD8DF] bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#A5556E]" />
                </div>
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A5556E]">
                  <option value="">Kategori</option>{(Object.keys(productCategoryLabels) as ProductCategoryKey[]).map((k) => <option key={k} value={k}>{productCategoryLabels[k]}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A5556E]">
                  <option value="">Durum</option><option value="sufficient">Aktif</option><option value="critical">Kritik</option><option value="out">Tükenen</option>
                </select>
              </div>
            </div>

            <div className="hidden grid-cols-[1.6fr_0.9fr_0.65fr_0.6fr_0.6fr_0.7fr_0.6fr_0.85fr_0.5fr] gap-2 border-b border-[#EAD8DF] bg-[#F7F6F6] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#74616A] lg:grid">
              <span>Ürün</span><span>Kategori</span><span>Stok / Adet</span><span>Min. Stok</span><span>Maliyet</span><span>Satış Fiyatı</span><span>Durum</span><span>Güncelleme</span><span className="text-right">İşlem</span>
            </div>

            <div className="divide-y divide-[#F1E7EB]">
              {pageRows.map((p) => (
                <button key={p.id} type="button" onClick={() => openDetail(p)}
                  className={`grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-[#F7F6F6] lg:grid-cols-[1.6fr_0.9fr_0.65fr_0.6fr_0.6fr_0.7fr_0.6fr_0.85fr_0.5fr] lg:items-center ${sel?.id === p.id && detailOpen ? 'bg-[#F6DFE6]/60' : ''}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="h-10 w-10 shrink-0 rounded-[10px] border border-[#BE7690]/50 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#A5556E] text-white"><Package className="h-4 w-4" /></span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-[#2A2027]">{p.name}</div>
                      <div className="truncate text-[9px] font-mono text-[#74616A]">BARKOD {p.barcode || '—'}</div>
                    </div>
                  </div>
                  <div><span className="inline-flex rounded-md border border-[#EAD8DF] bg-[#F7F6F6] px-2 py-0.5 text-[10px] text-[#8C4460]">{p.categoryLabel}</span></div>
                  <div className={`font-display text-[15px] tabular-nums ${stockTone(p)}`}>{p.currentStock}</div>
                  <div className="text-[12px] tabular-nums text-[#5A4B53]">{p.minStockLevel}</div>
                  <div className="text-[12px] tabular-nums text-[#5A4B53]">{formatTL(p.cost)}</div>
                  <div className="font-display text-[13px] tabular-nums">{formatTL(p.salePrice)}</div>
                  <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span></div>
                  <div className="text-[10px] font-mono text-[#74616A]">{p.updatedAt || '—'}</div>
                  <div className="flex justify-end"><span className="grid h-7 w-7 place-items-center rounded-md border border-[#EAD8DF] bg-white text-[#74616A]"><PencilLine className="h-3.5 w-3.5" /></span></div>
                </button>
              ))}
              {!pageRows.length && !loading && <div className="px-5 py-12 text-center text-sm text-[#74616A]">Eşleşen ürün yok.</div>}
            </div>

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAD8DF] px-5 py-3.5">
                <div className="text-[11px] text-[#5A4B53]">Toplam {filtered.length} ürün</div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#EAD8DF] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]/50 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
                  {pageNumbers.map((p, i) => p === '...' ? <span key={`e${i}`} className="px-1 text-[12px] text-[#74616A]">…</span> : (
                    <button key={p} type="button" onClick={() => goPage(p)} className={`grid h-8 min-w-8 place-items-center rounded-[9px] border px-2 text-[12px] tabular-nums ${p === page ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#EAD8DF] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]/50'}`}>{p}</button>
                  ))}
                  <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#EAD8DF] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]/50 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="ml-2 rounded-[9px] border border-[#EAD8DF] bg-white px-2 py-1.5 text-[11px] text-[#5A4B53] outline-none focus:border-[#A5556E]">{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}</select>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ALT BLOKLAR */}
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_1fr]">
          {/* Son Stok Hareketleri */}
          <div className="overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white">
            <div className="border-b border-[#EAD8DF] px-5 py-3.5 font-display text-lg tracking-tight">Son Stok Hareketleri <span className="ml-1 rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[11px] text-[#8C4460]">{Math.min(8, movements.length)}</span></div>
            <div className="hidden grid-cols-[0.9fr_1.2fr_0.9fr_0.5fr_0.6fr_0.9fr] gap-2 border-b border-[#EAD8DF] bg-[#F7F6F6] px-5 py-2 text-[9px] font-mono uppercase tracking-widest text-[#74616A] sm:grid">
              <span>Tarih</span><span>Ürün</span><span>İşlem</span><span>Miktar</span><span>Stok</span><span>Kullanıcı</span>
            </div>
            <div className="divide-y divide-[#F1E7EB]">
              {movements.slice(0, 8).map((m) => {
                const prod = productById.get(m.productId)
                const inbound = m.type === 'Inbound' || m.type === 'Adjustment'
                return (
                  <div key={m.id} className="grid grid-cols-1 gap-2 px-5 py-2.5 text-[12px] sm:grid-cols-[0.9fr_1.2fr_0.9fr_0.5fr_0.6fr_0.9fr] sm:items-center">
                    <span className="font-mono text-[10px] text-[#5A4B53]">{m.date.split('-').reverse().join('.')} {m.time}</span>
                    <span className="truncate text-[#2A2027]">{m.productName || prod?.name || '—'}</span>
                    <span><span className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium ${MOVE_TONE[m.type] || 'bg-slate-50 text-slate-600'}`}>{MOVE_LABEL[m.type] || m.type}</span></span>
                    <span className={`tabular-nums ${inbound ? 'text-emerald-700' : 'text-rose-600'}`}>{inbound ? '+' : '-'}{m.quantity}</span>
                    <span className="tabular-nums text-[#5A4B53]">{prod?.currentStock ?? '—'}</span>
                    <span className="truncate text-[#5A4B53]">{m.staffName || '—'}</span>
                  </div>
                )
              })}
              {movements.length === 0 && <div className="px-5 py-8 text-center text-[12px] text-[#74616A]">Hareket kaydı yok.</div>}
            </div>
          </div>

          {/* Kategori Bazlı Stok Değeri */}
          <div className="rounded-[18px] border border-[#EAD8DF] bg-white p-5">
            <div className="mb-3 font-display text-lg tracking-tight">Kategori Bazlı Stok Değeri</div>
            <div className="space-y-2.5">
              {catValues.slice(0, 6).map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#5A4B53]">{c.name}</span><span className="tabular-nums text-[#2A2027]">{formatTL(c.value)} <span className="text-[#74616A]">%{c.pct}</span></span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
              {catValues.length === 0 && <div className="py-6 text-center text-[12px] text-[#74616A]">Veri yok.</div>}
            </div>
          </div>

          {/* Stok Özeti */}
          <div className="rounded-[18px] border border-[#EAD8DF] bg-white p-5">
            <div className="mb-3 font-display text-lg tracking-tight">Stok Özeti</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile icon={Boxes} tone="text-emerald-600 bg-emerald-50" k="Toplam Stok Adedi" v={`${Math.round(totalUnits)} adet`} />
              <Tile icon={AlertTriangle} tone="text-amber-600 bg-amber-50" k="Kritik Stok Adedi" v={`${Math.round(criticalUnits)} adet`} />
              <Tile icon={Package} tone="text-rose-600 bg-rose-50" k="Tükenen Ürün" v={`${outCount} adet`} />
              <Tile icon={Repeat} tone="text-sky-600 bg-sky-50" k="Stok Devir Hızı" v={String(turnover).replace('.', ',')} />
            </div>
          </div>
        </div>
      </div>

      {/* ---------- ÜRÜN DETAY MODALİ ---------- */}
      <ProductDetailModal
        open={detailOpen && !!sel}
        onOpenChange={(next) => { setDetailOpen(next); if (!next) { setSelectedId(null); setMoveDialog(null) } }}
        product={sel}
        tenantId={tenantId}
        movementsKey={movementsKey}
        canDelete={canDeleteProduct}
        isStaff={isStaff}
        error={actionError}
        moveDraft={moveDialog}
        moveBusy={moveBusy}
        onMoveDraftChange={(next) => { setActionError(''); setMoveDialog(next) }}
        onSubmitMove={() => void submitMove()}
        today={localDateKey(new Date())}
        renderEditTrigger={() =>
          sel ? (
            <ProductFormDialog
              key={sel.id}
              mode="edit"
              title={`${sel.name} · düzenle`}
              submitLabel="Güncelle"
              initial={{
                imageUrl: sel.imageUrl || '', name: sel.name, barcode: sel.barcode || '',
                category: sel.category, unit: sel.unit || 'adet',
                brand: sel.brand || '', location: sel.location || '',
                lotNumber: sel.lotNumber || '', expiryDate: sel.expiryDate || '',
                cost: sel.cost, salePrice: sel.salePrice, minStockLevel: sel.minStockLevel, isActive: sel.isActive,
              }}
              onSubmit={async (v) => { await adminApi.updateProduct(sel.id, productPayload(v as unknown as FV, sel), tenantId); await reload() }}
              trigger={
                <button type="button" className={catalogPrimaryBtn}>
                  <PencilLine className="h-3.5 w-3.5" /> Düzenle
                </button>
              }
            />
          ) : null
        }
        renderDeleteTrigger={() =>
          sel ? (
            <ConfirmDialog
              destructive
              title={`"${sel.name}" silinsin mi?`}
              description="Ürün pasifleştirilir. Geçmiş hareketler raporlarda kalır."
              confirmLabel="Sil"
              onConfirm={async () => {
                await adminApi.deleteProduct(sel.id, tenantId)
                setDetailOpen(false); setSelectedId(null)
                await reload()
              }}
              trigger={
                <button type="button" className={catalogDangerBtn}>
                  <Trash2 className="h-3.5 w-3.5" /> Sil
                </button>
              }
            />
          ) : null
        }
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="product"
        onDone={() => void reload()}
      />
    </>
  )
}

function Tile({ icon: Icon, tone, k, v }: { icon: typeof Boxes; tone: string; k: string; v: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0"><div className="truncate text-[9px] font-mono uppercase text-[#74616A]">{k}</div><div className="truncate font-display text-[15px] text-[#2A2027]">{v}</div></div>
    </div>
  )
}
