'use client'

import { useEffect, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog, { type AdminField } from '@/components/dashboard/AdminEditDialog'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeProduct, normalizeStockMovement, productCategoryLabels } from '@/lib/apiMappers'
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, Barcode as BarcodeIcon, Boxes, Cake,
  ChevronLeft, ChevronRight, Hash, ImagePlus, Layers3, Loader2, MapPin, Package, PackagePlus,
  PencilLine, Repeat, Ruler, Search, Star, Tag, Timer, ToggleRight, Trash2, TrendingUp, Truck, Wallet, X,
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
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [moveDialog, setMoveDialog] = useState<{ type: 'Inbound' | 'Outbound'; qty: number; unitCost: number; notes: string } | null>(null)
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
    if (q.trim()) { const t = q.trim().toLocaleLowerCase('tr'); list = list.filter((p) => p.name.toLocaleLowerCase('tr').includes(t) || p.barcode.includes(t) || p.sku.toLocaleLowerCase('tr').includes(t)) }
    return list
  }, [products, tab, catFilter, statusFilter, q])
  useEffect(() => { setPage(1) }, [tab, catFilter, statusFilter, q, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const sel = useMemo(() => filtered.find((p) => p.id === selectedId) || filtered[0], [filtered, selectedId])

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
  const productFields = (p?: Product): AdminField[] => [
    { label: 'Ürün görseli', name: 'imageUrl', type: 'image', value: p?.imageUrl || '', icon: ImagePlus, section: 'Tanım', fullWidth: true },
    { label: 'Ürün adı', name: 'name', value: p?.name || '', required: true, icon: Package, fullWidth: true },
    { label: 'SKU', name: 'sku', value: p?.sku || '', required: true, icon: Hash },
    { label: 'Barkod', name: 'barcode', value: p?.barcode || '', icon: BarcodeIcon, helper: 'Boş → otomatik EAN-13' },
    { label: 'Kategori', name: 'category', type: 'select', value: p?.category || 'SkinCare', options: (Object.keys(productCategoryLabels) as ProductCategoryKey[]).map((k) => ({ value: k, label: productCategoryLabels[k] })), icon: Tag },
    { label: 'Birim', name: 'unit', type: 'select', value: p?.unit || 'adet', options: ['adet', 'kutu', 'paket', 'set', 'gr', 'ml'].map((u) => ({ value: u, label: u })), icon: Ruler },
    { label: 'Marka', name: 'brand', value: p?.brand || '', icon: Star, section: 'Diğer bilgiler' },
    { label: 'Tedarikçi', name: 'supplier', value: p?.supplier || '', icon: Truck },
    { label: 'Raf / Dolap', name: 'location', value: p?.location || '', icon: MapPin },
    { label: 'Lot numarası', name: 'lotNumber', value: p?.lotNumber || '', icon: Hash },
    { label: 'Son kullanma', name: 'expiryDate', type: 'date', value: p?.expiryDate || '', icon: Cake },
    { label: 'Vergi oranı', name: 'taxRatePercent', type: 'number', value: p?.taxRatePercent ?? 20, icon: Banknote, suffix: '%' },
    { label: 'Tedarik süresi', name: 'leadTimeDays', type: 'number', value: p?.leadTimeDays ?? 0, icon: Timer, suffix: 'gün' },
    { label: 'Bekleyen giriş', name: 'pendingInbound', type: 'number', value: p?.pendingInbound ?? 0, icon: PackagePlus, helper: 'Sipariş edilen, gelmesi beklenen miktar' },
    { label: 'Maliyet', name: 'cost', type: 'number', value: p?.cost ?? 100, icon: Wallet, prefix: '₺', section: 'Fiyat & stok' },
    { label: 'Satış fiyatı', name: 'salePrice', type: 'number', value: p?.salePrice ?? 200, icon: TrendingUp, prefix: '₺' },
    ...(!p ? [{ label: 'Açılış stoğu', name: 'currentStock', type: 'number', value: 10, icon: Boxes } as AdminField] : []),
    { label: 'Minimum stok', name: 'minStockLevel', type: 'number', value: p?.minStockLevel ?? 5, icon: AlertTriangle },
    { label: 'Aktif', name: 'isActive', type: 'checkbox', value: p?.isActive ?? true, icon: ToggleRight, fullWidth: true },
  ]

  type FV = Record<string, unknown>
  const productPayload = (v: FV, p?: Product): Record<string, unknown> => ({
    branchId: p?.branchId || branchId || null,
    name: v.name, sku: v.sku, category: v.category || 'SkinCare', unit: v.unit || 'adet',
    supplier: (v.supplier as string) || null, location: (v.location as string) || null,
    cost: Number(v.cost || 0), salePrice: Number(v.salePrice || 0),
    ...(p ? {} : { currentStock: Number(v.currentStock || 0) }),
    minStockLevel: Number(v.minStockLevel || 0), isActive: v.isActive !== false,
    barcode: (v.barcode as string)?.trim() || p?.barcode || null,
    imageUrl: typeof v.imageUrl === 'string' ? v.imageUrl : (p?.imageUrl ?? null),
    brand: (v.brand as string) || null,
    taxRatePercent: v.taxRatePercent === '' || v.taxRatePercent === undefined ? null : Number(v.taxRatePercent),
    expiryDate: (v.expiryDate as string) || null,
    lotNumber: (v.lotNumber as string) || null,
    pendingInbound: Number(v.pendingInbound || 0),
    leadTimeDays: Number(v.leadTimeDays || 0),
  })

  const submitMove = async () => {
    if (!sel || !moveDialog) return
    if (moveDialog.qty <= 0) { setActionError('Miktar pozitif olmalı.'); return }
    setMoveBusy(true); setActionError('')
    try {
      const payload = {
        type: moveDialog.type, quantity: moveDialog.qty,
        unitCost: moveDialog.unitCost ? moveDialog.unitCost : null,
        occurredAtUtc: new Date().toISOString(), reference: null, notes: moveDialog.notes || null, staffMemberId: null,
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
            <AdminEditDialog
              triggerLabel="Ürün Ekle" eyebrow="Product · POST" titleIcon={PackagePlus} size="lg"
              title="Yeni ürün tanımla" submitLabel="Ürün oluştur"
              onSubmit={async (v) => { await adminApi.createProduct(productPayload(v as FV), tenantId); await reload() }}
              fields={productFields()}
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
              onImport={async (result) => {
                const first = result[0]; if (!first) return
                for (const row of first.rows) {
                  const name = String(row['Ürün'] || row['Ürün Adı'] || '').trim(); if (!name) continue
                  await adminApi.createProduct({ branchId, name, sku: String(row['SKU'] || name).trim(), category: 'SkinCare', unit: 'adet', cost: Number(row['Maliyet'] || 0), salePrice: Number(row['Satış Fiyatı'] || 0), currentStock: Number(row['Stok'] || 0), minStockLevel: Number(row['Min. Stok'] || 0), isActive: true, barcode: String(row['Barkod'] || '') || null, brand: String(row['Marka'] || '') || null }, tenantId)
                }
                await reload()
              }}
            />
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
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
            <div key={c.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><c.icon className="h-4 w-4" /></span>
                <BarSpark values={moveSeries} />
              </div>
              <div className="mt-2 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{c.label}</div>
              <div className="font-display text-3xl tabular-nums tracking-tight">{c.value}</div>
              <div className="mt-0.5 text-[10px] text-[#352432]/45">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* MAIN: TABLE + DETAIL */}
        <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
          <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
            <div className="border-b border-[#ead8df]/70 px-5 py-4">
              <div className="font-display text-xl tracking-tight">Ürün Kütüphanesi <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[12px] text-[#b14d6c]">{filtered.length}</span></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}>{t.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün adı, barkod…" className="w-44 rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]" />
                </div>
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                  <option value="">Kategori</option>{(Object.keys(productCategoryLabels) as ProductCategoryKey[]).map((k) => <option key={k} value={k}>{productCategoryLabels[k]}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                  <option value="">Durum</option><option value="sufficient">Aktif</option><option value="critical">Kritik</option><option value="out">Tükenen</option>
                </select>
              </div>
            </div>

            <div className="hidden grid-cols-[1.6fr_0.9fr_0.65fr_0.6fr_0.6fr_0.7fr_0.6fr_0.85fr_0.5fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
              <span>Ürün</span><span>Kategori</span><span>Stok / Adet</span><span>Min. Stok</span><span>Maliyet</span><span>Satış Fiyatı</span><span>Durum</span><span>Güncelleme</span><span className="text-right">İşlem</span>
            </div>

            <div className="divide-y divide-[#f1e5ea]">
              {pageRows.map((p) => (
                <button key={p.id} type="button" onClick={() => setSelectedId(p.id)}
                  className={`grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-[#fffafc] lg:grid-cols-[1.6fr_0.9fr_0.65fr_0.6fr_0.6fr_0.7fr_0.6fr_0.85fr_0.5fr] lg:items-center ${sel?.id === p.id ? 'bg-[#fff1f6]/50' : ''}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="h-10 w-10 shrink-0 rounded-[10px] border border-[#efbfd0]/50 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><Package className="h-4 w-4" /></span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-[#352432]">{p.name}</div>
                      <div className="truncate text-[9px] font-mono text-[#352432]/40">BARKOD {p.barcode || '—'}</div>
                    </div>
                  </div>
                  <div><span className="inline-flex rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-2 py-0.5 text-[10px] text-[#b14d6c]">{p.categoryLabel}</span></div>
                  <div className={`font-display text-[15px] tabular-nums ${stockTone(p)}`}>{p.currentStock}</div>
                  <div className="text-[12px] tabular-nums text-[#352432]/55">{p.minStockLevel}</div>
                  <div className="text-[12px] tabular-nums text-[#352432]/65">{formatTL(p.cost)}</div>
                  <div className="font-display text-[13px] tabular-nums">{formatTL(p.salePrice)}</div>
                  <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span></div>
                  <div className="text-[10px] font-mono text-[#352432]/45">{p.updatedAt || '—'}</div>
                  <div className="flex justify-end"><span className="grid h-7 w-7 place-items-center rounded-md border border-[#ead8df]/70 bg-white text-[#352432]/45"><PencilLine className="h-3.5 w-3.5" /></span></div>
                </button>
              ))}
              {!pageRows.length && !loading && <div className="px-5 py-12 text-center text-sm text-[#352432]/45">Eşleşen ürün yok.</div>}
            </div>

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 px-5 py-3.5">
                <div className="text-[11px] text-[#352432]/50">Toplam {filtered.length} ürün</div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
                  {pageNumbers.map((p, i) => p === '...' ? <span key={`e${i}`} className="px-1 text-[12px] text-[#352432]/35">…</span> : (
                    <button key={p} type="button" onClick={() => goPage(p)} className={`grid h-8 min-w-8 place-items-center rounded-[9px] border px-2 text-[12px] tabular-nums ${p === page ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fff4f8]/50'}`}>{p}</button>
                  ))}
                  <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="ml-2 rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[11px] text-[#352432]/65 outline-none focus:border-[#c85776]">{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}</select>
                </div>
              </div>
            )}
          </div>

          {/* DETAIL PANEL */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            {sel ? (
              <>
                <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">Seçili ürün</div>
                <div className="mt-3 flex items-start gap-3">
                  {sel.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sel.imageUrl} alt={sel.name} className="h-20 w-20 shrink-0 rounded-2xl border border-[#efbfd0]/60 object-cover" />
                  ) : (
                    <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><Package className="h-8 w-8" /></span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="truncate font-display text-2xl tracking-tight">{sel.name}</span><span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase ${STATUS_TONE[sel.status]}`}>{STATUS_LABEL[sel.status]}</span></div>
                    <div className="text-[11px] text-[#352432]/55">{sel.categoryLabel} · BARKOD {sel.barcode || '—'}</div>
                  </div>
                </div>

                <Section title="Stok Özeti">
                  <Cell k="Mevcut Stok" v={`${sel.currentStock} ${sel.unit}`} tone={stockTone(sel)} />
                  <Cell k="Min. Stok" v={`${sel.minStockLevel} ${sel.unit}`} />
                  <Cell k="Bekleyen Giriş" v={`${sel.pendingInbound} ${sel.unit}`} />
                  <Cell k="Tedarik Süresi" v={sel.leadTimeDays ? `${sel.leadTimeDays} gün` : '—'} />
                </Section>

                <Section title="Fiyat Bilgileri">
                  <Cell k="Maliyet" v={formatTL(sel.cost)} />
                  <Cell k="Satış Fiyatı" v={formatTL(sel.salePrice)} />
                  <Cell k="Kâr Marjı" v={sel.salePrice > 0 ? `%${String(sel.marginPct).replace('.', ',')}` : '—'} tone="text-emerald-700" />
                </Section>

                <Section title="Diğer Bilgiler">
                  <Cell k="Marka / Tedarikçi" v={sel.brand || sel.supplier || '—'} />
                  <Cell k="Raf / Dolap" v={sel.location || '—'} />
                  <Cell k="Son Kullanma" v={sel.expiryDate ? sel.expiryDate.split('-').reverse().join('.') : '—'} />
                  <Cell k="Lot Numarası" v={sel.lotNumber || '—'} />
                  <Cell k="Birim" v={sel.unit} />
                  <Cell k="Vergi Oranı" v={sel.taxRatePercent !== null ? `%${sel.taxRatePercent}` : '—'} />
                </Section>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <AdminEditDialog
                    triggerVariant="ghost" triggerLabel="Düzenle" eyebrow="Product · PUT" titleIcon={PencilLine} size="lg"
                    title={`${sel.name} · düzenle`} submitLabel="Güncelle"
                    onSubmit={async (v) => { await adminApi.updateProduct(sel.id, productPayload(v as FV, sel), tenantId); await reload() }}
                    fields={productFields(sel)}
                  />
                  <button type="button" onClick={() => setMoveDialog({ type: 'Inbound', qty: 1, unitCost: sel.cost, notes: '' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100">
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Stok Girişi
                  </button>
                  <button type="button" onClick={() => setMoveDialog({ type: 'Outbound', qty: 1, unitCost: 0, notes: '' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-sky-300/40 bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700 hover:bg-sky-100">
                    <ArrowUpRight className="h-3.5 w-3.5" /> Stok Çıkışı
                  </button>
                  <ConfirmDialog destructive title={`"${sel.name}" silinsin mi?`} description="Ürün pasifleştirilir. Geçmiş hareketler raporlarda kalır." confirmLabel="Sil"
                    onConfirm={async () => { await adminApi.deleteProduct(sel.id, tenantId); setSelectedId(null); await reload() }}
                    trigger={<button type="button" className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" /> Sil</button>} />
                </div>

                {moveDialog && (
                  <div className="mt-3 rounded-[14px] border border-[#ead8df] bg-[#fffafc] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#352432]">{MOVE_LABEL[moveDialog.type]} · {sel.name}</span>
                      <button type="button" onClick={() => setMoveDialog(null)} className="text-[#352432]/40 hover:text-rose-600"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[9px] font-mono uppercase text-[#352432]/45">Miktar
                        <input type="number" min={1} value={moveDialog.qty} onChange={(e) => setMoveDialog((m) => m && { ...m, qty: Number(e.target.value) })} className="mt-0.5 w-full rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[13px] text-[#352432] outline-none focus:border-[#c85776]" />
                      </label>
                      <label className="text-[9px] font-mono uppercase text-[#352432]/45">Birim maliyet (₺)
                        <input type="number" min={0} value={moveDialog.unitCost || ''} onChange={(e) => setMoveDialog((m) => m && { ...m, unitCost: Number(e.target.value) })} className="mt-0.5 w-full rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[13px] text-[#352432] outline-none focus:border-[#c85776]" />
                      </label>
                      <label className="col-span-2 text-[9px] font-mono uppercase text-[#352432]/45">Not
                        <input value={moveDialog.notes} onChange={(e) => setMoveDialog((m) => m && { ...m, notes: e.target.value })} className="mt-0.5 w-full rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[13px] text-[#352432] outline-none focus:border-[#c85776]" />
                      </label>
                    </div>
                    <button type="button" disabled={moveBusy} onClick={submitMove}
                      className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#c85776] px-3 py-2 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                      {moveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />} {isStaff ? 'Onaya gönder' : 'Hareketi kaydet'}
                    </button>
                  </div>
                )}
              </>
            ) : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Ürün seçimi yok.</div>}
          </div>
        </div>

        {/* ALT BLOKLAR */}
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_1fr]">
          {/* Son Stok Hareketleri */}
          <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
            <div className="border-b border-[#ead8df]/70 px-5 py-3.5 font-display text-lg tracking-tight">Son Stok Hareketleri <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[11px] text-[#b14d6c]">{Math.min(8, movements.length)}</span></div>
            <div className="hidden grid-cols-[0.9fr_1.2fr_0.9fr_0.5fr_0.6fr_0.9fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 sm:grid">
              <span>Tarih</span><span>Ürün</span><span>İşlem</span><span>Miktar</span><span>Stok</span><span>Kullanıcı</span>
            </div>
            <div className="divide-y divide-[#f1e5ea]">
              {movements.slice(0, 8).map((m) => {
                const prod = productById.get(m.productId)
                const inbound = m.type === 'Inbound' || m.type === 'Adjustment'
                return (
                  <div key={m.id} className="grid grid-cols-1 gap-2 px-5 py-2.5 text-[12px] sm:grid-cols-[0.9fr_1.2fr_0.9fr_0.5fr_0.6fr_0.9fr] sm:items-center">
                    <span className="font-mono text-[10px] text-[#352432]/50">{m.date.split('-').reverse().join('.')} {m.time}</span>
                    <span className="truncate text-[#352432]">{m.productName || prod?.name || '—'}</span>
                    <span><span className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium ${MOVE_TONE[m.type] || 'bg-slate-50 text-slate-600'}`}>{MOVE_LABEL[m.type] || m.type}</span></span>
                    <span className={`tabular-nums ${inbound ? 'text-emerald-700' : 'text-rose-600'}`}>{inbound ? '+' : '-'}{m.quantity}</span>
                    <span className="tabular-nums text-[#352432]/55">{prod?.currentStock ?? '—'}</span>
                    <span className="truncate text-[#352432]/55">{m.staffName || '—'}</span>
                  </div>
                )
              })}
              {movements.length === 0 && <div className="px-5 py-8 text-center text-[12px] text-[#352432]/45">Hareket kaydı yok.</div>}
            </div>
          </div>

          {/* Kategori Bazlı Stok Değeri */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            <div className="mb-3 font-display text-lg tracking-tight">Kategori Bazlı Stok Değeri</div>
            <div className="space-y-2.5">
              {catValues.slice(0, 6).map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#352432]/70">{c.name}</span><span className="tabular-nums text-[#352432]">{formatTL(c.value)} <span className="text-[#352432]/40">%{c.pct}</span></span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
              {catValues.length === 0 && <div className="py-6 text-center text-[12px] text-[#352432]/45">Veri yok.</div>}
            </div>
          </div>

          {/* Stok Özeti */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
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
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">{children}</div>
    </div>
  )
}
function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="min-w-0"><div className="text-[9px] font-mono uppercase text-[#352432]/40">{k}</div><div className={`mt-0.5 truncate text-[12.5px] font-medium ${tone || 'text-[#352432]'}`}>{v}</div></div>
}
function Tile({ icon: Icon, tone, k, v }: { icon: typeof Boxes; tone: string; k: string; v: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[12px] border border-[#ead8df]/60 bg-white px-3 py-2.5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0"><div className="truncate text-[9px] font-mono uppercase text-[#352432]/40">{k}</div><div className="truncate font-display text-[15px] text-[#352432]">{v}</div></div>
    </div>
  )
}
