'use client'

import { useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import BulkSelectBar, { SelectBox, useBulkSelect } from '@/components/dashboard/BulkSelectBar'
import { usePermission } from '@/hooks/usePermission'
import CatalogCategoryManager from '@/components/dashboard/CatalogCategoryManager'
import CatalogCategoryRail, { buildCatalogCategoryItems } from '@/components/dashboard/CatalogCategoryRail'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import CatalogSalesPanel from '@/components/dashboard/CatalogSalesPanel'
import type { HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'
import ServiceFormDialog, { type ConsentTemplateOption, type ServiceFormDialogValues } from '@/components/dashboard/ServiceFormDialog'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { IdempotentWriteOptions } from '@/lib/idempotency'
import { apiItems, formatTL, normalizeAccount, normalizeAppointment, normalizeCustomServiceCategory, normalizePackage, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import { motion } from 'framer-motion'
import {
  CheckCircle2, ChevronLeft, ChevronRight, Clock, Clock3, FileUp, Layers3, PauseCircle,
  PencilLine, Search, Sparkles, Star, TrendingUp, Trophy, UploadCloud, UserCheck, Users, Wand2,
} from 'lucide-react'
import type { ApiAppointment, ApiConsentTemplate, ApiCustomServiceCategory, ApiCustomerAccount, ApiService, ApiServicePackage, ApiStaff, CatalogStatusKey, Service } from '@/lib/types'

type TabKey = 'all' | 'Active' | 'Passive' | 'Draft' | 'Archived'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'Active', label: 'Aktif' }, { key: 'Passive', label: 'Pasif' },
  { key: 'Draft', label: 'Taslak' }, { key: 'Archived', label: 'Arşiv' },
]
// Cancelled şu an yalnızca paket kataloğunda kullanılıyor; hizmetlerde sekme yok ama
// rozet eşlemesi eksik kalmasın (aynı CatalogStatus enum'u paylaşılıyor).
const STATUS_LABEL: Record<CatalogStatusKey, string> = { Active: 'Aktif', Passive: 'Pasif', Draft: 'Taslak', Archived: 'Arşiv', Cancelled: 'İptal' }
const STATUS_TONE: Record<CatalogStatusKey, string> = {
  Active: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Passive: 'border-slate-300/40 bg-slate-50 text-slate-600',
  Draft: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Archived: 'border-[#ead8df]/70 bg-[#fff4f8]/50 text-[#352432]/45',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-600',
}

const AVATAR_COLORS = ['from-[#f3a3bf] to-[#ffd9e6]', 'from-[#9c70bb] to-[#e3cdf2]', 'from-[#5aa9e6] to-[#cfe7fb]', 'from-[#54c1a0] to-[#cdeee2]', 'from-[#e6a14f] to-[#fbe6cb]']
function avatarColor(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }
function initials(name: string): string { const p = (name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase() }

function StaffAvatar({ name, photo, className = 'h-7 w-7' }: { name: string; photo?: string; className?: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt={name} className={`${className} shrink-0 rounded-full border border-[#efbfd0]/50 object-cover`} />
  ) : (
    <span className={`grid ${className} shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(name)} text-[9px] font-display text-[#3a1a2a]`}>{initials(name)}</span>
  )
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

interface ServiceStats { last30: number; total: number; revenue: number; rating: number; staffIds: string[] }

/** Hizmet + gruplama/geri yazmada kullanılan HAM kategori adı. */
type LibService = Service & { rawCategory: string }

/** Ekranda gösterilen kategori adı — kategorisi olmayan hizmet "Kategorisiz" grubundadır
 *  (normalizeService'in uydurduğu "Genel Hizmet" adı gösterilmez; ray/sayaçlarla tutarlı). */
const catLabel = (s: LibService): string => s.rawCategory || 'Kategorisiz'

export default function ServiceLibrary({
  tenantId, branchId, institutionName, branchLabel, scopeLabel, canCustomServiceCat,
}: {
  tenantId?: string; branchId?: string | null; institutionName?: string; branchLabel?: string; scopeLabel?: string; canCustomServiceCat: boolean
}) {
  const [tab, setTab] = useState<TabKey>('all')
  const [q, setQ] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [catFilter, setCatFilter] = useState('')
  // Alt kategori süzgeci kategoriye BAĞLIDIR: kategori seçilince alt şeridi açılır, kategori
  // değişince alt seçim düşer.
  const [subFilter, setSubFilter] = useState('')
  const [durFilter, setDurFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Toplu seçim: satır tıklamasıyla seç, alt çubuktan topluca sil.
  // Silme yetkisi olmayan personelde seçim hiç açılmaz.
  const { can } = usePermission()
  const canBulkDelete = can('Services.Delete')
  const bulk = useBulkSelect()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useApiQuery<{ services: ApiService[]; staff: ApiStaff[]; appts: ApiAppointment[]; accounts: ApiCustomerAccount[]; cats: ApiCustomServiceCategory[]; packages: ApiServicePackage[]; consents: ApiConsentTemplate[] }>(
    async () => {
      if (!tenantId) return { services: [], staff: [], appts: [], accounts: [], cats: [], packages: [], consents: [] }
      const [services, staff, appts, accounts, cats, packages, consents] = await Promise.all([
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.consentTemplates<ApiConsentTemplate>(tenantId).catch(() => []),
      ])
      return { services: apiItems(services), staff: apiItems(staff), appts: apiItems(appts), accounts: apiItems(accounts), cats: Array.isArray(cats) ? cats : [], packages: apiItems(packages), consents: Array.isArray(consents) ? consents : [] }
    },
    [tenantId],
    { initialData: { services: [], staff: [], appts: [], accounts: [], cats: [], packages: [], consents: [] } },
  )

  // rawCategory = HAM kategori adı. normalizeService boş kategoriye "Genel Hizmet" uydurur;
  // geri yazan her yol (durum değiştirme, düzenleme formu) o uydurma adı gerçek kategori olarak
  // kaydeder ve hizmet sessizce var olmayan bir kategoriye taşınırdı.
  const services = useMemo<LibService[]>(
    () => (data?.services || []).map((s, i) => ({ ...normalizeService(s, i), rawCategory: (s?.category || s?.group || '').trim() })),
    [data],
  )
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const appts = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const customCategories = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])

  // --- Satış paneli (hizmet kartı) ------------------------------------------------
  // Satışlar panelin kendi içinde, seçili hizmete göre SUNUCUDA süzülerek çekilir
  // (bkz. CatalogSalesPanel) — burada tüm cari listesi tutulmaz.
  const staffOptions = useMemo(() => staff.map((s) => ({ id: s.id, name: s.name })), [staff])
  // Kategori bilgisi de taşınır: geçmiş satış modalindeki aramalı seçici süzgeç pill'lerini bundan çıkarır.
  const packageOptions = useMemo(() => packages.map((p) => ({ id: p.id, name: p.name, price: p.totalPrice, cat: p.category, sub: p.subCategory, meta: `${formatTL(p.totalPrice)} · ${p.totalSessions} seans` })), [packages])
  const serviceOptions = useMemo(() => services.map((s) => ({ id: s.id, name: s.name, price: s.price, cat: s.group, sub: s.subGroup, meta: formatTL(s.price) })), [services])

  const [salesBusy, setSalesBusy] = useState(false)
  const runSaleAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setSalesBusy(true)
    try { await fn(); await reload() } finally { setSalesBusy(false) }
  }
  const handleCreateHistoricalSale = (values: HistoricalSaleValues): Promise<void> =>
    runSaleAction(() => adminApi.createHistoricalSale({
      customerId: values.customerId,
      name: values.name,
      soldAtUtc: values.soldAt,
      totalAmount: values.totalAmount,
      paidAmount: values.paidAmount,
      soldByStaffMemberId: values.soldByStaffMemberId,
      servicePackageId: values.servicePackageId,
      serviceDefinitionId: values.serviceDefinitionId,
      sessionsTotal: values.sessionsTotal,
      sessionsUsed: values.sessionsUsed,
      installmentCount: values.installmentCount,
      firstDueDate: values.firstDueDate,
      // Ödeme geçmişi (peşin / kaçıncı aya kadar ödendi) — geçmiş cariye de tarihleriyle düşsün.
      paidInstallmentCount: values.paidInstallmentCount,
      paymentMethod: values.paymentMethod,
      // Seansı kim yaptı + yapılan seanslar randevu geçmişine işlensin mi.
      appliedByStaffMemberId: values.appliedByStaffMemberId,
      createSessionAppointments: values.createSessionAppointments,
      sessionIntervalDays: values.sessionIntervalDays,
      // Seans seans tarih/personel (opsiyonel) — verilmezse sunucu eşit aralık + tek personele düşer.
      sessions: values.sessions,
      notes: values.notes,
      branchId: branchId ?? null,
    }, tenantId))
  const handleCancelSale = (accountId: string, reason: string, refundedAmount = 0, refundMethod = 'cash'): Promise<void> =>
    runSaleAction(() => adminApi.cancelSale(accountId, reason || null, refundedAmount, tenantId, refundMethod))
  const handleRestoreSale = (accountId: string): Promise<void> =>
    runSaleAction(() => adminApi.restoreSale(accountId, tenantId))
  // opts: SaleDetailModal'ın ürettiği çift-tıklama freni — damga da anahtar da ORADAN gelir,
  // burada `new Date()` üretilirse ikinci tıklamanın gövdesi değişir ve oynatma yerine 409 olur.
  const handleCollectInstallment = (accountId: string, amount: number, opts: IdempotentWriteOptions): Promise<void> =>
    runSaleAction(() => adminApi.registerAccountPayment(accountId, {
      amount, method: 'cash', reference: null, occurredAtUtc: opts.occurredAtUtc,
    }, tenantId, opts.idempotencyKey))

  const statsByService = useMemo(() => {
    const m = new Map<string, ServiceStats>()
    for (const s of services) m.set(s.id, { last30: 0, total: 0, revenue: 0, rating: 0, staffIds: [] })
    const staffSet = new Map<string, Set<string>>()
    let completed = 0; let cancelled = 0
    const since30 = Date.now() - 30 * 86_400_000
    for (const a of appts) {
      if (!a.serviceDefinitionId) continue
      const e = m.get(a.serviceDefinitionId); if (!e) continue
      e.total++
      if (new Date(a.date).getTime() >= since30) e.last30++
      if (a.status === 'tamamlandi') { e.revenue += Number(a.price || 0); completed++ } else if (a.status === 'iptal') cancelled++
      if (a.staffMemberId) { const set = staffSet.get(a.serviceDefinitionId) ?? new Set(); set.add(a.staffMemberId); staffSet.set(a.serviceDefinitionId, set) }
    }
    const globalRate = completed + cancelled > 0 ? completed / (completed + cancelled) : 1
    for (const [id, e] of m) { e.staffIds = Array.from(staffSet.get(id) ?? []); e.rating = Math.round((4.2 + globalRate * 0.8) * 10) / 10 }
    return m
  }, [services, appts])

  const maxPrice = useMemo(() => Math.max(1, ...services.map((s) => s.price)), [services])
  const marginOf = (s: Service) => Math.min(60, Math.max(35, Math.round(35 + (s.price / maxPrice) * 25)))
  const prepOf = (s: Service) => Math.max(5, Math.round(s.duration / 6 / 5) * 5)

  // Kategori + alt kategori ağacı (alt kategoriler üst kategorisinin ardında, girintili çıkar).
  const categories = useMemo(
    () => buildCatalogCategoryItems(
      customCategories,
      services.map((s) => ({ category: s.rawCategory, subCategory: s.subGroup })),
    ),
    [services, customCategories],
  )
  /** Kategori ayarları kartı yalnız ÜST kategorileri yönetir (sıralama kardeşler arasında yapılır). */
  const topCategories = useMemo(() => categories.filter((c) => c.kind !== 'sub'), [categories])

  const filtered = useMemo(() => {
    let list = services
    if (tab !== 'all') list = list.filter((s) => s.status === tab)
    if (catFilter) list = list.filter((s) => catLabel(s) === catFilter)
    if (subFilter) list = list.filter((s) => (s.subGroup || '') === subFilter)
    if (durFilter) { const [lo, hi] = durFilter.split('-').map(Number); list = list.filter((s) => s.duration >= lo && (!hi || s.duration <= hi)) }
    if (q.trim()) { const t = q.trim().toLocaleLowerCase('tr'); list = list.filter((s) => s.name.toLocaleLowerCase('tr').includes(t) || catLabel(s).toLocaleLowerCase('tr').includes(t) || (s.subGroup || '').toLocaleLowerCase('tr').includes(t)) }
    return list
  }, [services, tab, catFilter, subFilter, durFilter, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const selected = useMemo(() => filtered.find((s) => s.id === selectedId) || filtered[0], [filtered, selectedId])

  const activeCount = services.filter((s) => s.status === 'Active').length
  const passiveCount = services.filter((s) => s.status !== 'Active').length
  const apptSeries = useMemo(() => bucketWeekly(appts.map((a) => new Date(a.date).getTime()).filter((t) => !Number.isNaN(t))), [appts])

  const buildPayload = (s: LibService, over: Record<string, unknown>) => ({
    branchId: s.branchId || branchId || null, name: s.name, category: s.rawCategory || null, subCategory: s.subGroup || null,
    durationMinutes: s.duration, price: s.price, isActive: s.status === 'Active',
    iconKey: s.iconKey || suggestIcon(s.name || s.group) || null, status: s.status,
    defaultSessionCount: s.session || 1, loyaltyPointCost: s.loyaltyPointCost || null, ...over,
  })

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError('')
    try { await fn(); await reload() } catch (e) { setActionError(e instanceof Error ? e.message : 'İşlem başarısız') } finally { setBusy(false) }
  }
  const setStatus = (s: LibService, status: CatalogStatusKey) => run(() => adminApi.updateService(s.id, buildPayload(s, { status, isActive: status === 'Active' }), tenantId))

  const onCreate = async (values: ServiceFormDialogValues) => {
    const created = await adminApi.createService<{ id?: string }>({ branchId: branchId || null, name: values.name, category: values.category || null, subCategory: values.subCategory || null, durationMinutes: values.durationMinutes, price: values.price, isActive: values.status === 'Active', iconKey: values.iconKey || null, status: values.status, defaultSessionCount: values.defaultSessionCount || 1, loyaltyPointCost: values.loyaltyPointCost || null }, tenantId)
    if (created?.id && values.consentTemplateIds.length > 0) await syncConsentLinks(created.id, values.consentTemplateIds)
    await reload()
  }
  /**
   * Form kategori kutuları HAM veriden beslenir: normalizeService kategorisi boş hizmete
   * "Genel Hizmet" adını uydurur; o uydurma ad seçenek listesine düşerse kullanıcı gerçekte
   * var olmayan bir kategoriyi seçebilir hâle gelir.
   */
  const usedCategories = useMemo(
    () => Array.from(new Set((data?.services || []).map((s) => (s?.category || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'tr')),
    [data],
  )
  /** Kategori adı → o kategoride kullanılan alt kategori adları (kaydı olmayanlar da seçilebilsin diye). */
  const usedSubCategories = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of data?.services || []) {
      const cat = (s?.category || '').trim()
      const sub = (s?.subCategory || '').trim()
      if (!cat || !sub) continue
      if (!map[cat]) map[cat] = []
      if (!map[cat].includes(sub)) map[cat].push(sub)
    }
    for (const key of Object.keys(map)) map[key].sort((a, b) => a.localeCompare(b, 'tr'))
    return map
  }, [data])

  /**
   * Onam formu bağı hizmet DTO'sunda taşınmaz; şablon kaydında (serviceIds) durur.
   * Bu yüzden formdaki seçim, ilgili şablonların serviceIds listesine yazılır/çıkarılır.
   */
  const consentTemplates = useMemo<ConsentTemplateOption[]>(
    () => (data?.consents || [])
      .filter((t) => t.isActive !== false)
      .map((t) => ({ id: t.id || '', title: t.title || 'Onam formu', requiresSignature: t.requiresSignature !== false }))
      .filter((t) => t.id),
    [data],
  )
  const consentIdsOf = (serviceId: string): string[] =>
    (data?.consents || []).filter((t) => (t.serviceIds || []).includes(serviceId)).map((t) => t.id || '').filter(Boolean)

  /** Seçim ↔ şablon bağını eşitler; yalnız DEĞİŞEN şablonlar güncellenir. */
  const syncConsentLinks = async (serviceId: string, selected: string[]): Promise<void> => {
    for (const t of data?.consents || []) {
      if (!t.id) continue
      const linked = (t.serviceIds || []).includes(serviceId)
      const wanted = selected.includes(t.id)
      if (linked === wanted) continue
      const nextIds = wanted
        ? [...(t.serviceIds || []), serviceId]
        : (t.serviceIds || []).filter((x) => x !== serviceId)
      await adminApi.updateConsentTemplate(t.id, {
        title: t.title, body: t.body, checkItems: t.checkItems || [],
        requiresSignature: t.requiresSignature !== false, isActive: t.isActive !== false,
        serviceIds: nextIds,
      }, tenantId)
    }
  }

  const handleDeleteCat = async (id: string) => { await adminApi.deleteServiceCategory(id, tenantId); await reload() }
  /** Form içinden "Diğer → yeni kategori": Kategoriler sayfasına gitmeden kategori açılır. */
  const handleCreateCat = async (name: string) => { await adminApi.createServiceCategory({ name, isActive: true }, tenantId); await reload() }
  const canManageCat = canCustomServiceCat && can('Services.Manage')
  const handleReorderCat = async (orderedIds: string[]) => { await adminApi.reorderServiceCategories(orderedIds, tenantId); await reload() }

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => { const out: (number | '...')[] = []; for (let p = 1; p <= totalPages; p++) { if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) out.push(p); else if (out[out.length - 1] !== '...') out.push('...') } return out }, [page, totalPages])

  const sel = selected
  const selStats = sel ? statsByService.get(sel.id) : undefined
  const summary = useMemo(() => {
    let topName = '—'; let topCount = 0
    for (const s of services) { const c = statsByService.get(s.id)?.total ?? 0; if (c > topCount) { topCount = c; topName = s.name } }
    const avgDur = services.length ? Math.round(services.reduce((a, s) => a + s.duration, 0) / services.length) : 0
    const since30 = Date.now() - 30 * 86_400_000
    const soldThisMonth = appts.filter((a) => new Date(a.date).getTime() >= since30).length
    const activeStaff = staff.filter((s) => s.active).length
    const performing = new Set(appts.map((a) => a.staffMemberId).filter(Boolean)).size
    const activeRate = activeStaff ? Math.round((performing / activeStaff) * 100) : 0
    return { topName, avgDur, soldThisMonth, activeRate }
  }, [services, appts, staff, statsByService])

  const editInitial = (s: LibService): Partial<ServiceFormDialogValues> => ({ name: s.name, category: s.rawCategory || null, subCategory: s.subGroup || null, durationMinutes: s.duration, price: s.price, defaultSessionCount: s.session || 1, loyaltyPointCost: s.loyaltyPointCost || 0, isActive: s.status === 'Active', iconKey: s.iconKey || '', status: s.status, consentTemplateIds: consentIdsOf(s.id) })

  return (
    <>
      <Topbar
        title="Hizmetler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Hizmet Yönetimi`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', scopeLabel || 'Hizmet Havuzu']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ServiceFormDialog
              customCategories={customCategories}
              onDeleteCustomCategory={canCustomServiceCat ? handleDeleteCat : undefined}
              onCreateCustomCategory={canManageCat ? handleCreateCat : undefined}
              knownCategories={usedCategories}
              knownSubCategories={usedSubCategories}
              consentTemplates={consentTemplates}
              consentTenantId={tenantId}
              onSubmit={onCreate}
              trigger={
                <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
                  <Wand2 className="h-3.5 w-3.5" /> Yeni Hizmet
                </button>
              }
            />
            <ExcelTransferActions<LibService>
              featureKey="excel.services" moduleName="Hizmetler" context={`${institutionName || 'Kurum'} · ${branchLabel || ''}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} hizmet`,
                columns: [
                  { key: 'name', header: 'Hizmet Adı', width: 30, type: 'text', accessor: (s) => s.name },
                  { key: 'group', header: 'Kategori', width: 20, type: 'text', accessor: (s) => catLabel(s) },
                  { key: 'duration', header: 'Süre (dk)', width: 12, type: 'number', accessor: (s) => s.duration },
                  { key: 'price', header: 'Fiyat', width: 16, type: 'currency', accessor: (s) => s.price },
                  { key: 'status', header: 'Durum', width: 12, type: 'text', accessor: (s) => STATUS_LABEL[s.status] },
                ],
                totals: { name: 'TOPLAM', price: filtered.reduce((a, s) => a + s.price, 0) },
              }}
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi: kolon adlarına
                bağlı değil (otomatik eşleme), mükerrer kaydı atlar ve tek istekte parti
                hâlinde gönderir. Eskiden burada satır başına bir API çağrısı yapan,
                başlıkları birebir tutturmayı şart koşan bir döngü vardı. */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white px-4 py-2 text-[12px] font-semibold text-[#c85776] transition-transform hover:-translate-y-0.5 hover:bg-[#fff4f8]"
            >
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && services.length === 0} emptyMessage="Hizmet kaydı yok." />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: 'Toplam hizmet', value: String(services.length), icon: Layers3, stroke: '#d7839d' },
            { label: 'Aktif hizmet', value: String(activeCount), icon: CheckCircle2, stroke: '#3cae8d' },
            { label: 'Pasif hizmet', value: String(passiveCount), icon: Clock3, stroke: '#e0617f' },
          ].map((c) => (
            <div key={c.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><c.icon className="h-4 w-4" /></span>
              <div className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{c.label}</div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <div className="font-display text-3xl tabular-nums tracking-tight">{c.value}</div>
                <div className="w-24 shrink-0"><Sparkline values={apptSeries} stroke={c.stroke} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* MAIN: TABLE + DETAIL */}
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
            <div className="border-b border-[#ead8df]/70 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-display text-xl tracking-tight">Hizmet Kütüphanesi <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[12px] text-[#b14d6c]">{filtered.length}</span></div>
                  <div className="text-[11px] text-[#352432]/45">Hizmetleri görüntüleyin, düzenleyin ve yönetin.</div>
                </div>
              </div>
              {/* tabs */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => { setTab(t.key); setPage(1) }}
                      className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}>{t.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Hizmet ara…" className="w-40 rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]" />
                </div>
                <select value={durFilter} onChange={(e) => { setDurFilter(e.target.value); setPage(1) }} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                  <option value="">Süre</option><option value="0-30">≤30 dk</option><option value="31-60">31–60 dk</option><option value="61-999">60+ dk</option>
                </select>
              </div>
              {/* Kategori rayı — durum sekmeleriyle karışmasın diye kenarlıksız, tek satır ve
                  pay barlı. Ayrıntılı gerekçe: CatalogCategoryRail. */}
              <CatalogCategoryRail
                items={categories}
                value={catFilter}
                sub={subFilter}
                onChange={(name, subName) => { setCatFilter(name); setSubFilter(subName); setPage(1) }}
                total={services.length}
                itemLabel="hizmet"
              />
            </div>

            <div className="hidden grid-cols-[1.5fr_1fr_0.6fr_0.7fr_1fr_0.7fr_0.6fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
              <span>Hizmet</span><span>Kategori</span><span>Süre</span><span>Fiyat</span><span>Uygulayan Uzman</span><span>Durum</span><span className="text-right">İşlemler</span>
            </div>

            <div className="divide-y divide-[#f1e5ea]">
              {pageRows.map((s) => {
                const st = statsByService.get(s.id)
                const perfStaff = (st?.staffIds || []).map((id) => staffById.get(id)).filter(Boolean).slice(0, 3)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      // Seçim modunda satır tıklaması detay yerine seçim yapar.
                      if (canBulkDelete && bulk.active) { bulk.toggle(s.id); return }
                      setSelectedId(s.id)
                    }}
                    className={`grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-[#fffafc] lg:grid-cols-[1.5fr_1fr_0.6fr_0.7fr_1fr_0.7fr_0.6fr] lg:items-center ${bulk.isSelected(s.id) ? 'bg-[#fff1f6]' : sel?.id === s.id ? 'bg-[#fff1f6]/50' : ''}`}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {canBulkDelete && <SelectBox checked={bulk.isSelected(s.id)} onToggle={() => bulk.toggle(s.id)} />}
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><ServiceIcon iconKey={s.iconKey || suggestIcon(s.name || s.group)} className="h-5 w-5" /></span>
                      <span className="truncate text-[13px] font-medium text-[#352432]">{s.name}</span>
                    </div>
                    <div><span className="inline-flex rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-2 py-0.5 text-[10px] text-[#b14d6c]">{catLabel(s)}</span></div>
                    <div className="text-[12px] text-[#352432]/65">{s.duration} dk</div>
                    <div className="font-display text-[14px] tabular-nums">{formatTL(s.price)}</div>
                    <div className="flex items-center">
                      {perfStaff.length === 0 ? <span className="text-[10px] text-[#352432]/30">—</span> : (
                        <div className="flex -space-x-2">
                          {perfStaff.map((p) => p && <StaffAvatar key={p.id} name={p.name} photo={p.photoUrl} />)}
                          {(st?.staffIds.length || 0) > 3 && <span className="grid h-7 w-7 place-items-center rounded-full border border-[#efbfd0]/50 bg-white text-[9px] font-mono text-[#c85776]">+{(st!.staffIds.length) - 3}</span>}
                        </div>
                      )}
                    </div>
                    <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${STATUS_TONE[s.status]}`}>{STATUS_LABEL[s.status]}</span></div>
                    <div className="flex justify-end"><span className="rounded-md border border-[#ead8df]/70 bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/70">Detay</span></div>
                  </button>
                )
              })}
              {!pageRows.length && <div className="px-5 py-12 text-center text-sm text-[#352432]/45">{q || tab !== 'all' ? 'Eşleşen hizmet yok.' : 'Hizmet kaydı yok.'}</div>}
            </div>

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 px-5 py-3.5">
                <div className="text-[11px] text-[#352432]/50">{(page - 1) * pageSize + 1} – {Math.min(page * pageSize, filtered.length)} / {filtered.length} kayıt</div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
                  {pageNumbers.map((p, i) => p === '...' ? <span key={`e${i}`} className="px-1 text-[12px] text-[#352432]/35">…</span> : (
                    <button key={p} type="button" onClick={() => goPage(p)} className={`grid h-8 min-w-8 place-items-center rounded-[9px] border px-2 text-[12px] tabular-nums ${p === page ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fff4f8]/50'}`}>{p}</button>
                  ))}
                  <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="ml-2 rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[11px] text-[#352432]/65 outline-none focus:border-[#c85776]">{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}</select>
                </div>
              </div>
            )}
          </div>

          {/* DETAIL PANEL */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            {sel ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">Seçili hizmet detayı</div>
                  <div className="flex items-center gap-1.5">
                  <PackageSaleDialog
                    tenantId={tenantId}
                    presetService={{ id: sel.id, name: sel.name, price: sel.price }}
                    onDone={reload}
                    triggerLabel="Bu hizmeti sat"
                    triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-[#c85776]/40 bg-[#fff1f6] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]"
                  />
                  <ServiceFormDialog mode="edit" customCategories={customCategories}
                    onDeleteCustomCategory={canCustomServiceCat ? handleDeleteCat : undefined}
                    onCreateCustomCategory={canManageCat ? handleCreateCat : undefined}
                    knownCategories={usedCategories}
                    knownSubCategories={usedSubCategories}
                    consentTemplates={consentTemplates}
                    consentTenantId={tenantId}
                    title={`${sel.name} · düzenle`} submitLabel="Hizmeti güncelle" initialValues={editInitial(sel)}
                    onSubmit={async (v) => { await adminApi.updateService(sel.id, { branchId: sel.branchId || branchId || null, name: v.name, category: v.category || null, subCategory: v.subCategory || null, durationMinutes: v.durationMinutes, price: v.price, isActive: v.status === 'Active', iconKey: v.iconKey || null, status: v.status, defaultSessionCount: v.defaultSessionCount || 1, loyaltyPointCost: v.loyaltyPointCost || null }, tenantId); await syncConsentLinks(sel.id, v.consentTemplateIds); await reload() }}
                    trigger={<button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-[#ead8df]/70 bg-white text-[#352432]/45 hover:text-[#c85776]"><PencilLine className="h-3.5 w-3.5" /></button>} />
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#efbfd0]/75 bg-[#fff1f6] text-[#c85776]"><ServiceIcon iconKey={sel.iconKey || suggestIcon(sel.name || sel.group)} className="h-6 w-6" /></span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="truncate font-display text-2xl tracking-tight">{sel.name}</span><span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase ${STATUS_TONE[sel.status]}`}>{STATUS_LABEL[sel.status]}</span></div>
                    <div className="text-[12px] text-[#352432]/55">{catLabel(sel)} hizmeti · {sel.duration} dk</div>
                  </div>
                </div>

                <div className="mt-4 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Hizmet bilgileri</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[['Kategori', catLabel(sel)], ['Süre', `${sel.duration} dk`], ['Fiyat', formatTL(sel.price)], ['Hazırlık', `${prepOf(sel)} dk`]].map(([k, v]) => (
                      <div key={k}><div className="text-[9px] font-mono uppercase text-[#352432]/40">{k}</div><div className="mt-0.5 truncate text-[13px] font-medium text-[#352432]">{v}</div></div>
                    ))}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Uygun personel</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(selStats?.staffIds || []).map((id) => staffById.get(id)).filter(Boolean).slice(0, 6).map((p) => p && (
                      <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#ead8df]/70 bg-white px-2 py-1 text-[11px] text-[#352432]/75"><StaffAvatar name={p.name} photo={p.photoUrl} className="h-5 w-5" /> {p.name}</span>
                    ))}
                    {(!selStats || selStats.staffIds.length === 0) && <span className="text-[11px] text-[#352432]/40">Henüz bu hizmeti uygulayan personel kaydı yok.</span>}
                  </div>
                </div>

                <div className="mt-4 rounded-[14px] border border-[#ead8df]/65 bg-white p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Kullanım özeti (Son 30 gün)</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Mini label="Son 30 gün satış" value={String(selStats?.last30 ?? 0)} />
                    <Mini label="Toplam gelir" value={formatTL(selStats?.revenue ?? 0)} />
                    <Mini label="Müşteri memnuniyeti" value={`${(selStats?.rating ?? 5).toFixed(1)}/5`} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 rounded-[10px] border border-[#f0d5e0] bg-[#fff1f6]/60 px-3 py-2"><Star className="h-4 w-4 text-[#c85776]" /><div><div className="text-[9px] font-mono uppercase text-[#352432]/40">Toplam rezervasyon</div><div className="font-display text-lg">{selStats?.total ?? 0}</div></div></div>
                    <div className="flex items-center gap-2 rounded-[10px] border border-emerald-200/60 bg-emerald-50/60 px-3 py-2"><TrendingUp className="h-4 w-4 text-emerald-600" /><div><div className="text-[9px] font-mono uppercase text-[#352432]/40">Kâr marjı</div><div className="font-display text-lg text-emerald-700">%{marginOf(sel)}</div></div></div>
                  </div>
                </div>

                {/* Satış performansı — bu hizmeti kim, kime, ne zaman satmış. */}
                <div className="mt-3">
                  <CatalogSalesPanel
                    item={{ id: sel.id, name: sel.name, price: sel.price }}
                    kind="service"
                    tenantId={tenantId}
                    staffOptions={staffOptions}
                    packageOptions={packageOptions}
                    serviceOptions={serviceOptions}
                    busy={salesBusy}
                    onCreateHistorical={handleCreateHistoricalSale}
                    onCancelSale={handleCancelSale}
                    onRestoreSale={handleRestoreSale}
                    onCollectInstallment={handleCollectInstallment}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button type="button" disabled={busy} onClick={() => setStatus(sel, 'Draft')} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[11px] font-medium text-[#352432]/70 hover:bg-[#fff4f8]/50 disabled:opacity-50"><UploadCloud className="h-3.5 w-3.5" /> Taslağa Al</button>
                  {sel.status === 'Active' ? (
                    <button type="button" disabled={busy} onClick={() => setStatus(sel, 'Passive')} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"><PauseCircle className="h-3.5 w-3.5" /> Pasife Al</button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setStatus(sel, 'Active')} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[#c85776] px-3 py-2 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Yayına Al</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => setStatus(sel, 'Archived')} className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">Arşivle</button>
                </div>
              </>
            ) : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Hizmet seçimi yok.</div>}
          </div>
        </div>


        {/* KATEGORİ SATIŞLARI — kategori rayından bir kategori seçilince, o kategorideki
            TÜM satışlar (hangi müşteri, ne aldı, kim sattı, iptal edildiyse gerekçesi)
            tek listede görünür. Geçmiş yıllara ait satışlar da buraya düşer. */}
        {catFilter && (
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-display text-xl tracking-tight">{catFilter} · Satışlar</div>
                <div className="text-[11px] text-[#352432]/45">
                  Bu kategorideki tüm satışlar: hangi müşteri ne almış, kim satmış, iptal edildiyse gerekçesi.
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCatFilter(''); setSubFilter('') }}
                className="rounded-[10px] border border-[#ead8df] bg-white px-3 py-1.5 text-[11px] font-medium text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
              >
                Kategori filtresini kaldır
              </button>
            </div>
            <CatalogSalesPanel
              item={{ id: catFilter, name: catFilter, price: 0 }}
              kind="category"
              tenantId={tenantId}
              staffOptions={staffOptions}
              packageOptions={packageOptions}
              serviceOptions={serviceOptions}
              busy={salesBusy}
              onCreateHistorical={handleCreateHistoricalSale}
              onCancelSale={handleCancelSale}
              onRestoreSale={handleRestoreSale}
              onCollectInstallment={handleCollectInstallment}
            />
          </div>
        )}

        <CatalogCategoryManager
          title="Hizmet Kategori Ayarları"
          description="Kategoriye göre filtreleyin veya sırasını değiştirin. Yeni kategori Kategoriler sayfasından eklenir."
          itemLabel="hizmet"
          categories={topCategories}
          selectedCategory={catFilter}
          canManage={canCustomServiceCat}
          onSelect={(name) => { setCatFilter(name); setSubFilter(''); setPage(1) }}
          onDelete={handleDeleteCat}
          onReorder={canCustomServiceCat ? handleReorderCat : undefined}
        />

        {/* HİZMET ÖZETİ */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="font-display text-xl tracking-tight">Hizmet Özeti</div>
          <div className="text-[11px] text-[#352432]/45">Hizmet performansınızı özet olarak inceleyin.</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryTile icon={Trophy} tone="text-amber-600 bg-amber-50" label="En çok tercih edilen" value={summary.topName} />
            <SummaryTile icon={Sparkles} tone="text-[#c85776] bg-[#fff1f6]" label="Bu ay satılan hizmet" value={String(summary.soldThisMonth)} />
            <SummaryTile icon={UserCheck} tone="text-emerald-600 bg-emerald-50" label="Aktif uzman oranı" value={`%${summary.activeRate}`} />
          </div>
        </div>
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="service"
        onDone={() => void reload()}
      />
      {/* Toplu silme çubuğu — seçim yapılınca ekranın altında belirir. */}
      {canBulkDelete && (
      <BulkSelectBar
        api={bulk}
        itemLabel="hizmet"
        pageIds={pageRows.map((s) => s.id)}
        onDelete={(id) => adminApi.deleteService(id, tenantId)}
        onDone={() => reload()}
      />
      )}

    </>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[10px] border border-[#ead8df]/65 bg-[#fffafc] p-2 text-center"><div className="truncate font-display text-[14px] text-[#352432]">{value}</div><div className="text-[8px] font-mono uppercase tracking-wide text-[#352432]/40">{label}</div></div>
}
function SummaryTile({ icon: Icon, tone, label, value }: { icon: typeof Clock; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0"><div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div><div className="truncate font-display text-lg tracking-tight text-[#352432]">{value}</div></div>
    </div>
  )
}
