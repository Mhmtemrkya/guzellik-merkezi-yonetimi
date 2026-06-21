'use client'

import { useEffect, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import CatalogCategoryManager from '@/components/dashboard/CatalogCategoryManager'
import CampaignPanel from '@/components/dashboard/CampaignPanel'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeAccount, normalizeCampaign, normalizeCustomServiceCategory, normalizePackage, normalizeService } from '@/lib/apiMappers'
import {
  CheckCircle2, ChevronLeft, ChevronRight, FileText, Gift, Loader2, Minus, PackagePlus, PencilLine,
  PauseCircle, Plus, Search, ShoppingBag, Sparkles, Tag, Trash2, TrendingUp, Trophy, UploadCloud, Wallet, X,
} from 'lucide-react'
import type {
  ApiCampaign, ApiCustomServiceCategory, ApiCustomerAccount, ApiService, ApiServicePackage,
  CatalogStatusKey, Service, ServicePackage,
} from '@/lib/types'

type TabKey = 'all' | 'Active' | 'Passive' | 'Draft' | 'Archived'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'Active', label: 'Aktif' }, { key: 'Passive', label: 'Pasif' },
  { key: 'Draft', label: 'Taslak' }, { key: 'Archived', label: 'Arşiv' },
]
const STATUS_LABEL: Record<CatalogStatusKey, string> = { Active: 'Aktif', Passive: 'Pasif', Draft: 'Taslak', Archived: 'Arşiv' }
const STATUS_TONE: Record<CatalogStatusKey, string> = {
  Active: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Passive: 'border-slate-300/40 bg-slate-50 text-slate-600',
  Draft: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Archived: 'border-[#ead8df]/70 bg-[#fff4f8]/50 text-[#352432]/45',
}

function bucketWeekly(times: number[], n = 12): number[] {
  const now = Date.now(); const wk = 7 * 86_400_000; const start = now - n * wk; const b = Array(n).fill(0)
  for (const t of times) { if (t < start || t > now) continue; b[Math.min(n - 1, Math.floor((t - start) / wk))]++ }
  return b
}
function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const max = Math.max(1, ...values); const n = values.length
  const pts = values.map((v, i) => `${(i / Math.max(n - 1, 1)) * 100},${28 - (v / max) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-9 w-full overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={100} cy={28 - ((values[n - 1] ?? 0) / max) * 24} r="1.8" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface DraftItem { serviceDefinitionId: string; name: string; iconKey: string; duration: number; sessionCount: number; unitPrice: number }
interface Draft {
  id: string | null
  name: string
  description: string
  category: string
  iconKey: string
  salePrice: number
  priceTouched: boolean
  deposit: number
  depositTouched: boolean
  installments: number
  loyaltyPointCost: number
  status: CatalogStatusKey
  items: DraftItem[]
}

const emptyDraft = (): Draft => ({
  id: null, name: 'Yeni Paket', description: '', category: '', iconKey: '',
  salePrice: 0, priceTouched: false, deposit: 0, depositTouched: false,
  installments: 4, loyaltyPointCost: 0, status: 'Draft', items: [],
})

export default function PackageLibrary({
  tenantId, branchId, institutionName, branchLabel, canCustomServiceCat,
}: {
  tenantId?: string; branchId?: string | null; institutionName?: string; branchLabel?: string; canCustomServiceCat: boolean
}) {
  const [tab, setTab] = useState<TabKey>('all')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [priceSort, setPriceSort] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [showIconPicker, setShowIconPicker] = useState(false)

  const { data, loading, error, reload } = useApiQuery<{
    packages: ApiServicePackage[]; services: ApiService[]; cats: ApiCustomServiceCategory[]
    accounts: ApiCustomerAccount[]; campaigns: ApiCampaign[]
  }>(
    async () => {
      if (!tenantId) return { packages: [], services: [], cats: [], accounts: [], campaigns: [] }
      const [packages, services, cats, accounts, campaigns] = await Promise.all([
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
        adminApi.accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.campaigns<ApiCampaign>({ tenantId }).catch(() => []),
      ])
      return { packages: apiItems(packages), services: apiItems(services), cats: Array.isArray(cats) ? cats : [], accounts: apiItems(accounts), campaigns: Array.isArray(campaigns) ? campaigns : [] }
    },
    [tenantId],
    { initialData: { packages: [], services: [], cats: [], accounts: [], campaigns: [] } },
  )

  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const customCategories = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const campaigns = useMemo(() => (data?.campaigns || []).map((c, i) => normalizeCampaign(c, i)), [data])

  // ---- istatistikler
  const activeCount = packages.filter((p) => p.status === 'Active').length
  const draftCount = packages.filter((p) => p.status === 'Draft').length
  const avgPrice = packages.length ? Math.round(packages.reduce((a, p) => a + p.totalPrice, 0) / packages.length) : 0
  const pkgSeries = useMemo(() => bucketWeekly(packages.map((p) => new Date(p.updatedAt.split(' ')[0]?.split('.').reverse().join('-') || '').getTime()).filter((t) => !Number.isNaN(t))), [packages])

  // ---- filtre + sayfalama
  const filtered = useMemo(() => {
    let list = packages
    if (tab !== 'all') list = list.filter((p) => p.status === tab)
    if (catFilter) list = list.filter((p) => catFilter === 'Kategorisiz' ? !p.category : p.category === catFilter)
    if (q.trim()) { const t = q.trim().toLocaleLowerCase('tr'); list = list.filter((p) => p.name.toLocaleLowerCase('tr').includes(t) || p.items.some((i) => i.serviceName.toLocaleLowerCase('tr').includes(t))) }
    const sorted = [...list]
    if (priceSort === 'asc') sorted.sort((a, b) => a.totalPrice - b.totalPrice)
    else if (priceSort === 'desc') sorted.sort((a, b) => b.totalPrice - a.totalPrice)
    return sorted
  }, [packages, tab, catFilter, q, priceSort])
  useEffect(() => { setPage(1) }, [tab, catFilter, q, priceSort, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  const categorySettings = useMemo(() => {
    const m = new Map<string, { name: string; count: number; customId?: string }>()
    for (const c of customCategories) m.set(c.name, { name: c.name, count: 0, customId: c.id })
    for (const p of packages) {
      const name = p.category || 'Kategorisiz'
      const current = m.get(name) || { name, count: 0 }
      current.count++
      m.set(name, current)
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'))
  }, [packages, customCategories])
  const categories = useMemo(() => categorySettings.map((c) => c.name), [categorySettings])
  const assignableCategories = useMemo(() => {
    const names = new Set<string>()
    for (const c of customCategories) names.add(c.name)
    for (const s of services) if (s.group) names.add(s.group)
    for (const p of packages) if (p.category) names.add(p.category)
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'tr'))
  }, [customCategories, services, packages])

  // ---- taslak editörü
  const araToplam = draft.items.reduce((a, i) => a + i.unitPrice * i.sessionCount, 0)
  const indirim = Math.max(0, araToplam - draft.salePrice)
  const kalan = Math.max(0, draft.salePrice - draft.deposit)
  const toplamSeans = draft.items.reduce((a, i) => a + i.sessionCount, 0)
  const maxPkgPrice = useMemo(() => Math.max(1, ...packages.map((p) => p.totalPrice), draft.salePrice || 1), [packages, draft.salePrice])
  const tahminiKar = draft.salePrice > 0 ? Math.min(60, Math.max(30, Math.round(32 + (draft.salePrice / maxPkgPrice) * 22 - (indirim / Math.max(1, araToplam)) * 20))) : 0

  const selectPackage = (p: ServicePackage) => {
    setDraft({
      id: p.id, name: p.name, description: p.description, category: p.category,
      iconKey: p.iconKey, salePrice: p.totalPrice, priceTouched: true,
      deposit: p.depositAmount, depositTouched: true, installments: p.installmentCount, loyaltyPointCost: p.loyaltyPointCost || 0, status: p.status,
      items: p.items.map((i) => {
        const svc = serviceById.get(i.serviceDefinitionId)
        return { serviceDefinitionId: i.serviceDefinitionId, name: i.serviceName, iconKey: svc?.iconKey || '', duration: svc?.duration || 0, sessionCount: i.sessionCount, unitPrice: i.unitPrice }
      }),
    })
    setSavedMsg(''); setActionError(''); setShowIconPicker(false)
  }

  const applyAuto = (d: Draft): Draft => {
    const sub = d.items.reduce((a, i) => a + i.unitPrice * i.sessionCount, 0)
    const sale = d.priceTouched ? d.salePrice : sub
    const dep = d.depositTouched ? d.deposit : Math.round(sale * 0.25)
    return { ...d, salePrice: sale, deposit: dep }
  }

  const addService = (s: Service) => {
    setDraft((d) => applyAuto({
      ...d,
      items: d.items.some((i) => i.serviceDefinitionId === s.id)
        ? d.items.map((i) => (i.serviceDefinitionId === s.id ? { ...i, sessionCount: i.sessionCount + 1 } : i))
        // Hizmetin varsayılan seans sayısı ön-dolum gelir; pakette serbestçe düzenlenebilir.
        : [...d.items, { serviceDefinitionId: s.id, name: s.name, iconKey: s.iconKey, duration: s.duration, sessionCount: Math.max(1, s.session || 1), unitPrice: s.price }],
    }))
    setSavedMsg('')
  }
  const changeCount = (id: string, delta: number) =>
    setDraft((d) => applyAuto({ ...d, items: d.items.map((i) => (i.serviceDefinitionId === id ? { ...i, sessionCount: Math.max(1, i.sessionCount + delta) } : i)) }))
  const setCount = (id: string, count: number) =>
    setDraft((d) => applyAuto({ ...d, items: d.items.map((i) => (i.serviceDefinitionId === id ? { ...i, sessionCount: Math.max(1, Math.round(count) || 1) } : i)) }))
  const removeItem = (id: string) =>
    setDraft((d) => applyAuto({ ...d, items: d.items.filter((i) => i.serviceDefinitionId !== id) }))

  const packagePayload = (source: Draft, status: CatalogStatusKey) => ({
    branchId: branchId || null,
    name: source.name.trim(),
    description: source.description || null,
    category: source.category || null,
    iconKey: source.iconKey || suggestIcon(source.name || source.category) || null,
    totalPrice: source.salePrice,
    depositAmount: source.deposit,
    installmentCount: source.installments,
    loyaltyPointCost: source.loyaltyPointCost || null,
    isActive: status === 'Active',
    status,
    items: source.items.map((i) => ({
      serviceDefinitionId: i.serviceDefinitionId,
      sessionCount: i.sessionCount,
      unitPrice: i.unitPrice,
    })),
  })

  const save = async (status: CatalogStatusKey) => {
    setActionError(''); setSavedMsg('')
    if (!draft.name.trim()) { setActionError('Paket adı gerekli.'); return }
    if (draft.items.length === 0) { setActionError('Pakete en az bir hizmet ekle.'); return }
    setBusy(true)
    try {
      const payload = packagePayload(draft, status)
      if (draft.id) {
        await adminApi.updatePackage(draft.id, payload, tenantId)
      } else {
        const created = await adminApi.createPackage<ApiServicePackage>(payload, tenantId)
        if (created?.id) setDraft((d) => ({ ...d, id: created.id!, status }))
      }
      setDraft((d) => ({ ...d, status }))
      setSavedMsg(status === 'Active' ? 'Paket yayına alındı.' : status === 'Passive' ? 'Paket pasife alındı.' : 'Taslak kaydedildi.')
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Kaydetme başarısız.') } finally { setBusy(false) }
  }

  const changePackageCategory = async (category: string) => {
    if (category === draft.category) return
    const previousCategory = draft.category
    const next = { ...draft, category }
    setDraft(next)
    setActionError('')
    setSavedMsg('')
    if (!next.id) return

    setBusy(true)
    try {
      await adminApi.updatePackageCategory(next.id, category || null, tenantId)
      setSavedMsg(category ? `Paket “${category}” kategorisine eklendi.` : 'Paket kategorisiz olarak güncellendi.')
      await reload()
    } catch (e) {
      setDraft((current) => current.id === next.id ? { ...current, category: previousCategory } : current)
      setActionError(e instanceof Error ? e.message : 'Paket kategorisi güncellenemedi.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!draft.id) { setDraft(emptyDraft()); return }
    setBusy(true); setActionError('')
    try { await adminApi.deletePackage(draft.id, tenantId); setDraft(emptyDraft()); await reload() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Silinemedi.') } finally { setBusy(false) }
  }

  const createCategory = async (name: string) => {
    await adminApi.createServiceCategory({ name, isActive: true }, tenantId)
    await reload()
  }

  const deleteCategory = async (id: string) => {
    await adminApi.deleteServiceCategory(id, tenantId)
    await reload()
  }

  // ---- Paket Özeti
  const summary = useMemo(() => {
    const byPkg = new Map<string, number>()
    for (const a of accounts) if (a.servicePackageName) byPkg.set(a.servicePackageName, (byPkg.get(a.servicePackageName) ?? 0) + 1)
    let top = '—'; let topC = 0
    for (const [n, c] of byPkg) if (c > topC) { top = n; topC = c }
    const sold = accounts.filter((a) => a.servicePackageId).length
    const running = campaigns.filter((c) => c.isRunning).length
    const campRate = campaigns.length ? Math.round((running / campaigns.length) * 100) : 0
    return { top, avg: avgPrice, sold, campRate }
  }, [accounts, campaigns, avgPrice])

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => { const out: (number | '...')[] = []; for (let p = 1; p <= totalPages; p++) { if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) out.push(p); else if (out[out.length - 1] !== '...') out.push('...') } return out }, [page, totalPages])

  const activeServices = services.filter((s) => s.status === 'Active')

  return (
    <>
      <Topbar
        title="Paketler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Paket Yönetimi`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', 'Paketler']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setDraft(emptyDraft()); setSavedMsg(''); setActionError('') }}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
              <PackagePlus className="h-3.5 w-3.5" /> Yeni Paket
            </button>
            <ExcelTransferActions<ServicePackage>
              featureKey="excel.services" moduleName="Paketler" context={`${institutionName || 'Kurum'} · ${branchLabel || ''}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} paket`,
                columns: [
                  { key: 'name', header: 'Paket Adı', width: 28, type: 'text', accessor: (p) => p.name },
                  { key: 'sessions', header: 'Toplam Seans', width: 14, type: 'number', accessor: (p) => p.totalSessions },
                  { key: 'totalPrice', header: 'Satış Fiyatı', width: 16, type: 'currency', accessor: (p) => p.totalPrice },
                  { key: 'deposit', header: 'Peşinat', width: 14, type: 'currency', accessor: (p) => p.depositAmount },
                  { key: 'installments', header: 'Taksit', width: 10, type: 'number', accessor: (p) => p.installmentCount },
                  { key: 'status', header: 'Durum', width: 12, type: 'text', accessor: (p) => STATUS_LABEL[p.status] },
                  { key: 'items', header: 'İçerik', width: 50, type: 'text', accessor: (p) => p.items.map((i) => `${i.serviceName} (${i.sessionCount})`).join(' + ') },
                ],
                totals: { name: 'TOPLAM', totalPrice: filtered.reduce((a, p) => a + p.totalPrice, 0) },
              }}
              onImport={async (result) => {
                const first = result[0]; if (!first) return
                const byName = new Map<string, Service>()
                services.forEach((s) => byName.set(s.name.trim().toLocaleLowerCase('tr'), s))
                for (const row of first.rows) {
                  const name = String(row['Paket Adı'] || '').trim(); if (!name) continue
                  const content = String(row['İçerik'] || '').trim()
                  const items: Array<{ serviceDefinitionId: string; sessionCount: number; unitPrice: number }> = []
                  for (const part of content.split('+')) {
                    const m = part.trim().match(/^(.*?)\s*\((\d+)\)\s*$/)
                    const svc = byName.get((m ? m[1] : part).trim().toLocaleLowerCase('tr'))
                    if (svc) items.push({ serviceDefinitionId: svc.id, sessionCount: m ? Number(m[2]) : 1, unitPrice: svc.price })
                  }
                  await adminApi.createPackage({ branchId: branchId || null, name, description: null, totalPrice: Number(row['Satış Fiyatı'] || row['Toplam Tutar'] || 0), depositAmount: Number(row['Peşinat'] || 0), installmentCount: Number(row['Taksit'] || 0), isActive: String(row['Durum'] || 'Aktif').toLocaleLowerCase('tr') !== 'pasif', items }, tenantId)
                }
                await reload()
              }}
            />
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}
        {savedMsg && <div className="rounded-[12px] border border-emerald-300/30 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700"><CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />{savedMsg}</div>}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Toplam paket', value: String(packages.length), icon: ShoppingBag, stroke: '#d7839d' },
            { label: 'Aktif paket', value: String(activeCount), icon: CheckCircle2, stroke: '#3cae8d' },
            { label: 'Taslak', value: String(draftCount), icon: FileText, stroke: '#e6a14f' },
            { label: 'Ortalama paket fiyatı', value: formatTL(avgPrice), icon: Tag, stroke: '#9c70bb' },
          ].map((c) => (
            <div key={c.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><c.icon className="h-4 w-4" /></span>
              <div className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{c.label}</div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <div className="font-display text-3xl tabular-nums tracking-tight">{c.value}</div>
                <div className="w-24 shrink-0"><Sparkline values={pkgSeries} stroke={c.stroke} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* MAIN: LIBRARY + DRAFT PANEL */}
        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          {/* LIBRARY */}
          <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
            <div className="border-b border-[#ead8df]/70 px-5 py-4">
              <div className="font-display text-xl tracking-tight">Paket Kütüphanesi <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[12px] text-[#b14d6c]">{filtered.length}</span></div>
              <div className="text-[11px] text-[#352432]/45">Hazır paketleri görüntüleyin, düzenleyin ve yönetin.</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}>{t.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: paket adı…" className="w-40 rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]" />
                </div>
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                  <option value="">Kategori</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={priceSort} onChange={(e) => setPriceSort(e.target.value)} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                  <option value="">Fiyat</option><option value="asc">Artan</option><option value="desc">Azalan</option>
                </select>
              </div>
            </div>

            <div className="hidden grid-cols-[1.4fr_1.3fr_0.5fr_0.8fr_0.7fr_0.6fr_0.9fr_0.6fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
              <span>Paket</span><span>Dahil Hizmetler</span><span>Seans</span><span>Satış Fiyatı</span><span>Peşinat</span><span>Durum</span><span>Güncelleme</span><span className="text-right">İşlemler</span>
            </div>

            <div className="divide-y divide-[#f1e5ea]">
              {pageRows.map((p) => (
                <button key={p.id} type="button" onClick={() => selectPackage(p)}
                  className={`grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-[#fffafc] lg:grid-cols-[1.4fr_1.3fr_0.5fr_0.8fr_0.7fr_0.6fr_0.9fr_0.6fr] lg:items-center ${draft.id === p.id ? 'bg-[#fff1f6]/50' : ''}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><ServiceIcon iconKey={p.iconKey || suggestIcon(p.name || p.category)} className="h-5 w-5" /></span>
                    <span className="truncate text-[13px] font-medium text-[#352432]">{p.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {p.items.slice(0, 2).map((i) => (
                      <span key={i.serviceDefinitionId} className="rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-1.5 py-0.5 text-[9px] text-[#b14d6c]">{i.serviceName}</span>
                    ))}
                    {p.items.length > 2 && <span className="text-[10px] text-[#352432]/45">+{p.items.length - 2}</span>}
                    {p.items.length === 0 && <span className="text-[10px] text-[#352432]/30">—</span>}
                  </div>
                  <div className="text-[12px] tabular-nums text-[#352432]/70">{p.totalSessions}</div>
                  <div className="font-display text-[14px] tabular-nums">{formatTL(p.totalPrice)}</div>
                  <div className="text-[12px] tabular-nums text-[#352432]/60">{formatTL(p.depositAmount)}</div>
                  <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span></div>
                  <div className="text-[10px] font-mono text-[#352432]/45">{p.updatedAt || '—'}</div>
                  <div className="flex justify-end"><span className="rounded-md border border-[#ead8df]/70 bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/70">Detay</span></div>
                </button>
              ))}
              {!pageRows.length && !loading && (
                <div className="px-5 py-12 text-center text-sm text-[#352432]/45">{q || tab !== 'all' ? 'Eşleşen paket yok.' : 'Henüz paket yok. Aşağıdaki hizmetlerden seçerek ilk paketini oluştur.'}</div>
              )}
            </div>

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 px-5 py-3.5">
                <div className="text-[11px] text-[#352432]/50">Toplam {filtered.length} paket</div>
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

          {/* DRAFT PANEL */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">Seçili paket taslağı</div>
              <div className="flex items-center gap-1.5">
                {draft.id && (
                  <PackageSaleDialog
                    tenantId={tenantId}
                    presetPackageId={draft.id}
                    onDone={reload}
                    triggerLabel="Bu paketi sat"
                    triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-[#c85776]/40 bg-[#fff1f6] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]"
                  />
                )}
                <button type="button" onClick={() => setShowIconPicker((v) => !v)} title="Paket ikonu seç"
                  className="grid h-7 w-7 place-items-center rounded-md border border-[#ead8df]/70 bg-white text-[#352432]/45 hover:text-[#c85776]"><PencilLine className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[#efbfd0]/70 bg-[#fff1f6] text-[#c85776]">
                <ServiceIcon iconKey={draft.iconKey || suggestIcon(draft.name || draft.category)} className="h-5 w-5" />
              </span>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full bg-transparent font-display text-2xl tracking-tight text-[#352432] outline-none placeholder:text-[#352432]/30" placeholder="Paket adı" />
              <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase ${STATUS_TONE[draft.status]}`}>{STATUS_LABEL[draft.status]}</span>
            </div>
            <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="mt-1 w-full bg-transparent text-[12px] text-[#352432]/55 outline-none placeholder:text-[#352432]/30" placeholder="Paket açıklaması (müşteriye gösterilir)…" />

            {showIconPicker && (
              <div className="mt-3"><IconPicker value={draft.iconKey || suggestIcon(draft.name || draft.category)} onChange={(k) => { setDraft((d) => ({ ...d, iconKey: k })); setShowIconPicker(false) }} /></div>
            )}

            <div className="mt-2">
              <select value={draft.category} disabled={busy} onChange={(e) => void changePackageCategory(e.target.value)}
                className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776] disabled:opacity-60">
                <option value="">— Kategorisiz —</option>
                {assignableCategories.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <span className="ml-2 text-[9px] text-[#352432]/40">
                {draft.id ? 'Seçim otomatik kaydedilir.' : 'Paket ilk kaydedildiğinde kategori atanır.'}
              </span>
            </div>

            {/* Dahil edilen hizmetler */}
            <div className="mt-4 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Dahil edilen hizmetler</div>
              <div className="space-y-1.5">
                {draft.items.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-[#ead8df] bg-white px-3 py-4 text-center text-[11px] text-[#352432]/45">
                    Aşağıdaki hizmet kartlarından "Pakete Ekle" ile hizmet ekleyin.
                  </div>
                )}
                {draft.items.map((i) => (
                  <div key={i.serviceDefinitionId} className="flex items-center gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-2.5 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#fff1f6] text-[#c85776]"><ServiceIcon iconKey={i.iconKey || suggestIcon(i.name)} className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-[#352432]">{i.name}</div>
                      <div className="text-[10px] text-[#352432]/45">{i.duration} dk</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-[9px] border border-[#ead8df] bg-white">
                      <button type="button" onClick={() => changeCount(i.serviceDefinitionId, -1)} className="grid h-7 w-7 place-items-center text-[#352432]/55 hover:text-[#c85776]"><Minus className="h-3 w-3" /></button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={i.sessionCount}
                        onChange={(e) => setCount(i.serviceDefinitionId, Number(e.target.value))}
                        aria-label="Seans sayısı"
                        className="w-10 [appearance:textfield] border-0 bg-transparent text-center text-[12px] tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button type="button" onClick={() => changeCount(i.serviceDefinitionId, +1)} className="grid h-7 w-7 place-items-center text-[#352432]/55 hover:text-[#c85776]"><Plus className="h-3 w-3" /></button>
                    </div>
                    <div className="w-16 shrink-0 text-right font-display text-[13px] tabular-nums">{formatTL(i.unitPrice)}</div>
                    <button type="button" onClick={() => removeItem(i.serviceDefinitionId)} className="shrink-0 text-[#352432]/30 hover:text-rose-600"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Fiyat kutusu */}
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#ead8df]/65 bg-[#f1e5ea]">
              <div className="space-y-1.5 bg-white p-3">
                <Row k="Ara toplam" v={formatTL(araToplam)} />
                {indirim > 0 && <Row k="İndirim" v={`-${formatTL(indirim)}`} tone="text-rose-600" />}
                <div className="flex items-center justify-between border-t border-[#f1e5ea] pt-1.5">
                  <span className="text-[12px] font-medium text-[#352432]">Satış fiyatı</span>
                  <input type="number" min={0} value={draft.salePrice || ''} onChange={(e) => setDraft((d) => ({ ...d, salePrice: Number(e.target.value), priceTouched: true }))}
                    className="w-24 rounded-[8px] border border-[#ead8df] bg-white px-2 py-1 text-right font-display text-[15px] tabular-nums outline-none focus:border-[#c85776]" />
                </div>
              </div>
              <div className="space-y-1.5 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#352432]/55">Peşinat</span>
                  <input type="number" min={0} value={draft.deposit || ''} onChange={(e) => setDraft((d) => ({ ...d, deposit: Number(e.target.value), depositTouched: true }))}
                    className="w-20 rounded-[8px] border border-[#ead8df] bg-white px-2 py-0.5 text-right text-[12px] tabular-nums outline-none focus:border-[#c85776]" />
                </div>
                <Row k="Kalan" v={formatTL(kalan)} />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#352432]/55">Taksit</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={24} value={draft.installments} onChange={(e) => setDraft((d) => ({ ...d, installments: Math.max(0, Number(e.target.value)) }))}
                      className="w-12 rounded-[8px] border border-[#ead8df] bg-white px-1.5 py-0.5 text-right text-[12px] tabular-nums outline-none focus:border-[#c85776]" />
                    <span className="text-[11px] text-[#352432]/55">ay</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sadakat puanı ile hediye */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] border border-amber-200/70 bg-amber-50/40 px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <Gift className="h-4 w-4 text-amber-600" />
                <div>
                  <div className="text-[11px] font-medium text-[#352432]">Sadakat puanı ile hediye</div>
                  <div className="text-[10px] leading-snug text-[#352432]/45">
                    {draft.loyaltyPointCost > 0
                      ? `Adisyonda ${draft.loyaltyPointCost} puan karşılığı hediye edilebilir.`
                      : '0 = hediye edilemez. Puan girilirse adisyonda hediye seçilebilir olur.'}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft.loyaltyPointCost || ''}
                  placeholder="0"
                  onChange={(e) => setDraft((d) => ({ ...d, loyaltyPointCost: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                  className="w-20 rounded-[8px] border border-amber-200 bg-white px-2 py-1 text-right font-display text-[14px] tabular-nums text-amber-700 outline-none focus:border-amber-400"
                />
                <span className="text-[12px] font-medium text-amber-600">P</span>
              </div>
            </div>

            {/* Seans + kâr */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2.5 rounded-[12px] border border-[#f0d5e0] bg-[#fff1f6]/60 px-3 py-2.5">
                <Sparkles className="h-4 w-4 text-[#c85776]" />
                <div><div className="text-[9px] font-mono uppercase text-[#352432]/40">Toplam seans</div><div className="font-display text-xl tabular-nums">{toplamSeans}</div></div>
              </div>
              <div className="flex items-center gap-2.5 rounded-[12px] border border-[#f0d5e0] bg-[#fff1f6]/60 px-3 py-2.5">
                <TrendingUp className="h-4 w-4 text-[#c85776]" />
                <div><div className="text-[9px] font-mono uppercase text-[#352432]/40">Tahmini kâr</div><div className="font-display text-xl tabular-nums">%{tahminiKar}</div></div>
              </div>
            </div>

            {/* Aksiyonlar */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} onClick={() => save('Draft')}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[11px] font-medium text-[#352432]/70 hover:bg-[#fff4f8]/50 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Taslağı Kaydet
              </button>
              <button type="button" disabled={busy} onClick={() => save(draft.status === 'Active' ? 'Passive' : 'Active')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[11px] font-medium disabled:opacity-50 ${
                  draft.status === 'Active'
                    ? 'border border-amber-300/60 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'bg-[#c85776] text-white hover:opacity-90'
                }`}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.status === 'Active' ? <PauseCircle className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                {draft.status === 'Active' ? 'Pasife Al' : 'Yayına Al'}
              </button>
              <button type="button" disabled={busy} onClick={remove}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {draft.id ? 'Sil' : 'Temizle'}
              </button>
            </div>
          </div>
        </div>

        <CatalogCategoryManager
          title="Paket Kategori Ayarları"
          description="Paketlerde kullanılacak ortak kategorileri ekleyin, silin veya kategoriye göre filtreleyin."
          itemLabel="paket"
          categories={categorySettings}
          selectedCategory={catFilter}
          canManage={canCustomServiceCat}
          onSelect={setCatFilter}
          onCreate={createCategory}
          onDelete={deleteCategory}
        />

        {/* PAKETE EKLENECEK HİZMETLER */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="mb-1 font-display text-lg tracking-tight">Pakete Eklenecek Hizmetler</div>
          <div className="mb-3 text-[11px] text-[#352432]/45">Hizmet havuzundan seçim yaparak paketi oluşturun.</div>
          <div className="flex gap-2.5 overflow-x-auto pb-2">
            {activeServices.map((s) => {
              const inDraft = draft.items.some((i) => i.serviceDefinitionId === s.id)
              return (
                <div key={s.id} className={`w-56 shrink-0 rounded-[16px] border p-3.5 transition-colors ${inDraft ? 'border-[#c85776]/60 bg-[#fff1f6]/60' : 'border-[#ead8df]/70 bg-white'}`}>
                  <div className="flex items-start justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><ServiceIcon iconKey={s.iconKey || suggestIcon(s.name || s.group)} className="h-5 w-5" /></span>
                    {inDraft && <CheckCircle2 className="h-5 w-5 text-[#c85776]" />}
                  </div>
                  <div className="mt-2 truncate text-[13px] font-medium text-[#352432]">{s.name}</div>
                  <div className="truncate text-[10px] text-[#352432]/45">{s.group}</div>
                  <div className="mt-1 text-[10px] text-[#352432]/55">{s.duration} dk · 1 seans</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-display text-[15px] tabular-nums">{formatTL(s.price)}</span>
                    <button type="button" onClick={() => addService(s)}
                      className={`rounded-[8px] border px-2.5 py-1 text-[10px] font-medium transition-colors ${inDraft ? 'border-[#c85776]/50 bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#c85776] hover:bg-[#fff1f6]'}`}>
                      {inDraft ? 'Seçildi ✓' : '+ Pakete Ekle'}
                    </button>
                  </div>
                </div>
              )
            })}
            {activeServices.length === 0 && <div className="py-6 text-center text-sm text-[#352432]/45 w-full">Aktif hizmet yok — önce Hizmet Havuzu'ndan hizmet ekleyin.</div>}
          </div>
        </div>

        {/* PAKET ÖZETİ */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="font-display text-xl tracking-tight">Paket Özeti</div>
          <div className="text-[11px] text-[#352432]/45">Paket satış performansınızı özet olarak inceleyin.</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile icon={Trophy} tone="text-amber-600 bg-amber-50" label="En çok satan paket" value={summary.top} />
            <SummaryTile icon={Wallet} tone="text-sky-600 bg-sky-50" label="Ortalama paket tutarı" value={formatTL(summary.avg)} />
            <SummaryTile icon={ShoppingBag} tone="text-[#c85776] bg-[#fff1f6]" label="Satılan paket (cari)" value={String(summary.sold)} />
            <SummaryTile icon={Tag} tone="text-violet-600 bg-violet-50" label="Aktif kampanya oranı" value={`%${summary.campRate}`} />
          </div>
        </div>

        <CampaignPanel tenantId={tenantId} />
      </div>
    </>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[#352432]/55">{k}</span>
      <span className={`text-[13px] tabular-nums ${tone || 'text-[#352432]'}`}>{v}</span>
    </div>
  )
}

function SummaryTile({ icon: Icon, tone, label, value }: { icon: typeof Wallet; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0"><div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div><div className="truncate font-display text-lg tracking-tight text-[#352432]">{value}</div></div>
    </div>
  )
}
