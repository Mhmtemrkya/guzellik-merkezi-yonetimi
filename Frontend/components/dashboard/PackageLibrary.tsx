'use client'

import { useEffect, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { PanelPage, PanelStat } from '@/components/dashboard/PanelKit'
import BulkSelectBar, { SelectBox, useBulkSelect } from '@/components/dashboard/BulkSelectBar'
import { usePermission } from '@/hooks/usePermission'
import CatalogCategoryManager from '@/components/dashboard/CatalogCategoryManager'
import ConsentPicker from '@/components/dashboard/ConsentPicker'
import CatalogCategoryRail, { buildCatalogCategoryItems } from '@/components/dashboard/CatalogCategoryRail'
import CampaignPanel from '@/components/dashboard/CampaignPanel'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import CatalogSalesPanel from '@/components/dashboard/CatalogSalesPanel'
import type { HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import type { IdempotentWriteOptions } from '@/lib/idempotency'
import { apiItems, categoryOrderIndex, formatTL, mapCancelledSale, normalizeAccount, normalizeCampaign, normalizeCustomServiceCategory, normalizePackage, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import {
  CheckCircle2, ChevronLeft, ChevronRight, FileText, FileUp, Gift, Loader2, Minus, PackagePlus, PencilLine,
  PauseCircle, Plus, RotateCcw, Search, ShoppingBag, Sparkles, Tag, Trash2, TrendingUp, Trophy, UploadCloud,
  Wallet, X, XCircle,
} from 'lucide-react'
import type {
  ApiCampaign, ApiConsentTemplate, ApiCustomServiceCategory, ApiCustomerAccount, ApiService, ApiServicePackage, ApiStaff,
  CatalogStatusKey, Service, ServicePackage,
} from '@/lib/types'

// İKİ AYRI İPTAL KAVRAMI, karıştırılmamalı:
//  • 'Cancelled'      → paket TANIMI iptal edildi (kurum vazgeçti, gerekçesiyle).
//  • 'customerCancel' → paketin MÜŞTERİ SATIŞI iptal edildi (müşteri detayındaki gerekçeli iptal).
//    Bu ikincisi paketin durumunu değiştirmez; paket hâlâ aktif olabilir.
type TabKey = 'all' | 'Active' | 'Passive' | 'Draft' | 'Archived' | 'Cancelled' | 'customerCancel'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'Active', label: 'Aktif' }, { key: 'Passive', label: 'Pasif' },
  { key: 'Draft', label: 'Taslak' }, { key: 'Archived', label: 'Arşiv' },
  { key: 'Cancelled', label: 'İptal Ettiğimiz' }, { key: 'customerCancel', label: 'Müşteri İptali' },
]
const STATUS_LABEL: Record<CatalogStatusKey, string> = { Active: 'Aktif', Passive: 'Pasif', Draft: 'Taslak', Archived: 'Arşiv', Cancelled: 'İptal' }
const STATUS_TONE: Record<CatalogStatusKey, string> = {
  Active: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Passive: 'border-slate-300/40 bg-slate-50 text-slate-600',
  Draft: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Archived: 'border-[#EAD8DF] bg-[#F7F6F6]/50 text-[#74616A]',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-600',
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
  subCategory: string
  iconKey: string
  salePrice: number
  priceTouched: boolean
  deposit: number
  depositTouched: boolean
  installments: number
  loyaltyPointCost: number
  status: CatalogStatusKey
  /** Paket tanımı iptal edildiyse gerekçesi (müşteri satış iptalinden ayrı). */
  cancellationReason: string
  items: DraftItem[]
  /** Bu paket için zorunlu onam formları — paketi SATIN ALAN müşteride uyarı doğurur. */
  consentTemplateIds: string[]
}

const emptyDraft = (): Draft => ({
  id: null, name: 'Yeni Paket', description: '', category: '', subCategory: '', iconKey: '',
  salePrice: 0, priceTouched: false, deposit: 0, depositTouched: false,
  installments: 4, loyaltyPointCost: 0, status: 'Draft', cancellationReason: '', items: [],
  consentTemplateIds: [],
})

export default function PackageLibrary({
  tenantId, branchId, institutionName, branchLabel, canCustomServiceCat,
}: {
  tenantId?: string; branchId?: string | null; institutionName?: string; branchLabel?: string; canCustomServiceCat: boolean
}) {
  const [tab, setTab] = useState<TabKey>('all')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [q, setQ] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [catFilter, setCatFilter] = useState('')
  // Alt kategori süzgeci kategoriye BAĞLIDIR: kategori seçilince alt şeridi açılır, kategori
  // değişince alt seçim düşer.
  const [subFilter, setSubFilter] = useState('')
  const [priceSort, setPriceSort] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  // Toplu seçim: satır tıklamasıyla seç, alt çubuktan topluca sil.
  // Silme yetkisi olmayan personelde seçim hiç açılmaz.
  const { can } = usePermission()
  const canBulkDelete = can('Services.Delete')
  const bulk = useBulkSelect()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [showIconPicker, setShowIconPicker] = useState(false)
  // Pakete hizmet seçimi: arama + kategori filtresi.
  const [svcSearch, setSvcSearch] = useState('')
  const [svcCat, setSvcCat] = useState('')

  const { data, loading, error, reload } = useApiQuery<{
    packages: ApiServicePackage[]; services: ApiService[]; cats: ApiCustomServiceCategory[]
    accounts: ApiCustomerAccount[]; campaigns: ApiCampaign[]; staff: ApiStaff[]; consents: ApiConsentTemplate[]
    cancelled: unknown[]
  }>(
    async () => {
      if (!tenantId) return { packages: [], services: [], cats: [], accounts: [], campaigns: [], staff: [], consents: [], cancelled: [] }
      const [packages, services, cats, accounts, campaigns, staff, consents, cancelled] = await Promise.all([
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        // TÜM hizmetleri çek (tek sayfa 200 tavanına takılıp hizmetler eksik görünmesin).
        fetchAllPaged<ApiService>((page, size) => adminApi.services<ApiService>({ tenantId, page, pageSize: size })).catch(() => [] as ApiService[]),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
        adminApi.accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.campaigns<ApiCampaign>({ tenantId }).catch(() => []),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.consentTemplates<ApiConsentTemplate>(tenantId).catch(() => []),
        // "Müşteri İptali" sekmesi: iptal edilen satışlar canlı cari listesinde YOK, arşivde.
        adminApi.listCancelledSales<unknown[]>(undefined, tenantId).catch(() => [] as unknown[]),
      ])
      return { packages: apiItems(packages), services, cats: Array.isArray(cats) ? cats : [], accounts: apiItems(accounts), campaigns: Array.isArray(campaigns) ? campaigns : [], staff: apiItems(staff), consents: Array.isArray(consents) ? consents : [], cancelled: Array.isArray(cancelled) ? cancelled : [] }
    },
    [tenantId],
    { initialData: { packages: [], services: [], cats: [], accounts: [], campaigns: [], staff: [], consents: [], cancelled: [] } },
  )

  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const customCategories = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const campaigns = useMemo(() => (data?.campaigns || []).map((c, i) => normalizeCampaign(c, i)), [data])
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])

  // --- Satış paneli (paket kartı) -------------------------------------------------
  // Satışlar panelin kendi içinde, seçili pakete göre SUNUCUDA süzülerek çekilir
  // (doğrudan cari + adisyon satışı; bkz. CatalogSalesPanel).
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
      // Peşinat: taksit planı "toplam − peşinat"ı böler; satış tarihiyle tahsilat yazılır.
      depositAmount: values.depositAmount,
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
      // Personel satışın şubesinde çalışmıyorsa sunucu reddeder; kullanıcı modaldeki onay
      // kutusuyla "o tarihte bu şubedeydi" dediğinde geçer (bkz. AllowCrossBranchStaff).
      allowCrossBranchStaff: values.allowCrossBranchStaff,
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

  // ---- istatistikler
  const activeCount = packages.filter((p) => p.status === 'Active').length
  const draftCount = packages.filter((p) => p.status === 'Draft').length
  const avgPrice = packages.length ? Math.round(packages.reduce((a, p) => a + p.totalPrice, 0) / packages.length) : 0
  const pkgSeries = useMemo(() => bucketWeekly(packages.map((p) => new Date(p.updatedAt.split(' ')[0]?.split('.').reverse().join('-') || '').getTime()).filter((t) => !Number.isNaN(t))), [packages])

  // ---- filtre + sayfalama
  // Müşteri satışı iptal edilmiş paketlerin id'leri — "Müşteri İptali" sekmesi bunları süzer.
  // Kaynak: İPTAL ARŞİVİ (cancelled_sales). İptalde cari kaydı canlı tablodan silinip arşive
  // taşındığı için burayı `accounts` üzerinden aramak artık hiçbir şey bulmaz.
  const customerCancelledPackageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const raw of data?.cancelled || []) {
      const c = mapCancelledSale(raw)
      if (c.servicePackageId) ids.add(c.servicePackageId)
    }
    return ids
  }, [data])

  const filtered = useMemo(() => {
    let list = packages
    if (tab === 'customerCancel') list = list.filter((p) => customerCancelledPackageIds.has(p.id))
    else if (tab !== 'all') list = list.filter((p) => p.status === tab)
    if (catFilter) list = list.filter((p) => (catFilter === 'Kategorisiz' ? !p.category : p.category === catFilter))
    if (subFilter) list = list.filter((p) => (p.subCategory || '') === subFilter)
    if (q.trim()) { const t = q.trim().toLocaleLowerCase('tr'); list = list.filter((p) => p.name.toLocaleLowerCase('tr').includes(t) || p.items.some((i) => i.serviceName.toLocaleLowerCase('tr').includes(t))) }
    const sorted = [...list]
    if (priceSort === 'asc') sorted.sort((a, b) => a.totalPrice - b.totalPrice)
    else if (priceSort === 'desc') sorted.sort((a, b) => b.totalPrice - a.totalPrice)
    return sorted
  }, [packages, tab, catFilter, subFilter, q, priceSort, customerCancelledPackageIds])
  useEffect(() => { setPage(1) }, [tab, catFilter, subFilter, q, priceSort, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Kategori + alt kategori ağacı (alt kategoriler üst kategorisinin ardında, girintili çıkar).
  const categorySettings = useMemo(
    () => buildCatalogCategoryItems(
      customCategories,
      packages.map((p) => ({ category: p.category, subCategory: p.subCategory })),
    ),
    [packages, customCategories],
  )
  /** Kategori ayarları kartı yalnız ÜST kategorileri yönetir (sıralama kardeşler arasında yapılır). */
  const topCategorySettings = useMemo(() => categorySettings.filter((c) => c.kind !== 'sub'), [categorySettings])
  /**
   * Kategori kutusuna YALNIZCA üst kategoriler girer. Eskiden tüm kategori kayıtları
   * (alt kategoriler dâhil) listeleniyordu: alt kategori üst kategori gibi seçilebiliyor,
   * seçilince de pakete üst kategori olarak yazılıyordu. Hizmet tarafındaki ham kategori
   * kullanılır — normalizeService'in boş kategoriye uydurduğu "Genel Hizmet" listeye düşmesin.
   */
  const assignableCategories = useMemo(() => {
    const names = new Set<string>()
    for (const c of customCategories) if (!c.parentId) names.add(c.name)
    for (const s of data?.services || []) {
      const name = (s?.category || '').trim()
      if (name) names.add(name)
    }
    for (const p of packages) if (p.category) names.add(p.category)
    const orderOf = categoryOrderIndex(customCategories.filter((c) => !c.parentId))
    return Array.from(names).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b, 'tr'))
  }, [customCategories, data, packages])
  /**
   * Alt kategori seçenekleri ÖNCE KATEGORİ ister: kategori seçilmeden liste boştur
   * (kutu da çıkmaz, yerine "önce kategori seç" notu görünür). Seçilince yalnız o
   * kategorinin altları listelenir — tanımlı alt kategoriler + o kategoride KULLANIMDA
   * olanlar. İkincisi şart: serbest yazım kaldırılmadan önce girilmiş alt kategorilerin
   * kaydı yoktur; yalnız tanımlılar listelenirse mevcut paketin alt kategorisi seçilemez olur.
   */
  const packageSubCategoryOptions = useMemo(() => {
    if (!draft.category) return []
    const parent = customCategories.find((c) => !c.parentId && c.name === draft.category)
    const names = new Set<string>()
    if (parent) for (const c of customCategories) if (c.parentId === parent.id) names.add(c.name)
    for (const p of packages) {
      const sub = (p.subCategory || '').trim()
      if (sub && p.category === draft.category) names.add(sub)
    }
    if (draft.subCategory) names.add(draft.subCategory)
    const orderOf = categoryOrderIndex(customCategories.filter((c) => c.parentId))
    return Array.from(names).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b, 'tr'))
  }, [customCategories, packages, draft.category, draft.subCategory])

  // ---- taslak editörü
  const araToplam = draft.items.reduce((a, i) => a + i.unitPrice * i.sessionCount, 0)
  const indirim = Math.max(0, araToplam - draft.salePrice)
  const kalan = Math.max(0, draft.salePrice - draft.deposit)
  const toplamSeans = draft.items.reduce((a, i) => a + i.sessionCount, 0)
  const maxPkgPrice = useMemo(() => Math.max(1, ...packages.map((p) => p.totalPrice), draft.salePrice || 1), [packages, draft.salePrice])
  const tahminiKar = draft.salePrice > 0 ? Math.min(60, Math.max(30, Math.round(32 + (draft.salePrice / maxPkgPrice) * 22 - (indirim / Math.max(1, araToplam)) * 20))) : 0

  const selectPackage = (p: ServicePackage) => {
    setDraft({
      id: p.id, name: p.name, description: p.description, category: p.category, subCategory: p.subCategory,
      iconKey: p.iconKey, salePrice: p.totalPrice, priceTouched: true,
      deposit: p.depositAmount, depositTouched: true, installments: p.installmentCount, loyaltyPointCost: p.loyaltyPointCost || 0, status: p.status,
      cancellationReason: p.cancellationReason || '',
      consentTemplateIds: (data?.consents || []).filter((t) => (t.packageIds || []).includes(p.id)).map((t) => t.id || '').filter(Boolean),
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
    subCategory: source.subCategory || null,
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
      let savedId = draft.id
      if (draft.id) {
        await adminApi.updatePackage(draft.id, payload, tenantId)
      } else {
        const created = await adminApi.createPackage<ApiServicePackage>(payload, tenantId)
        if (created?.id) { savedId = created.id; setDraft((d) => ({ ...d, id: created.id!, status })) }
      }
      // Onam bağı paket DTO'sunda taşınmaz; şablon kaydının packageIds listesinde durur.
      if (savedId) await syncConsentLinks(savedId, draft.consentTemplateIds)
      setDraft((d) => ({ ...d, status }))
      setSavedMsg(
        status === 'Active' ? 'Paket yayına alındı.'
          : status === 'Cancelled' ? 'Paket iptal edildi; artık satış listelerinde çıkmaz.'
            : status === 'Passive' ? 'Paket pasife alındı.'
              : 'Taslak kaydedildi.',
      )
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Kaydetme başarısız.') } finally { setBusy(false) }
  }

  /**
   * Şablonların packageIds listesini paketle eşitler; yalnız DEĞİŞEN şablonlar güncellenir.
   * (Bağ paket kaydında değil şablon kaydında durduğu için güncelleme şablon ucundan yapılır.)
   */
  const syncConsentLinks = async (packageId: string, selected: string[]): Promise<void> => {
    const templates = data?.consents || []
    if (templates.length === 0 && selected.length === 0) return
    for (const t of templates) {
      if (!t.id) continue
      const linked = (t.packageIds || []).includes(packageId)
      const wanted = selected.includes(t.id)
      if (linked === wanted) continue
      const nextIds = wanted
        ? [...(t.packageIds || []), packageId]
        : (t.packageIds || []).filter((x) => x !== packageId)
      await adminApi.updateConsentTemplate(t.id, {
        title: t.title, body: t.body, checkItems: t.checkItems || [],
        requiresSignature: t.requiresSignature !== false, isActive: t.isActive !== false,
        serviceIds: t.serviceIds || [], packageIds: nextIds,
      }, tenantId)
    }
  }

  const changePackageCategory = async (category: string) => {
    if (category === draft.category) return
    const previousCategory = draft.category
    const previousSub = draft.subCategory
    // Alt kategori üst kategoriye bağlıdır: kategori değişince eski alt kategori düşer,
    // aksi halde pakete başka kategorinin altı yazılı kalırdı.
    const next = { ...draft, category, subCategory: '' }
    setDraft(next)
    setActionError('')
    setSavedMsg('')
    if (!next.id) return

    setBusy(true)
    try {
      await adminApi.updatePackageCategory(next.id, category || null, null, tenantId)
      setSavedMsg(category ? `Paket “${category}” kategorisine eklendi.` : 'Paket kategorisiz olarak güncellendi.')
      await reload()
    } catch (e) {
      setDraft((current) => current.id === next.id ? { ...current, category: previousCategory, subCategory: previousSub } : current)
      setActionError(e instanceof Error ? e.message : 'Paket kategorisi güncellenemedi.')
    } finally {
      setBusy(false)
    }
  }

  const saveSubCategory = async (subCategory: string) => {
    if (!draft.id) return
    setBusy(true); setActionError(''); setSavedMsg('')
    try {
      await adminApi.updatePackageCategory(draft.id, draft.category || null, subCategory || null, tenantId)
      setSavedMsg(subCategory ? `Alt kategori “${subCategory}” olarak güncellendi.` : 'Alt kategori kaldırıldı.')
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Alt kategori güncellenemedi.')
    } finally {
      setBusy(false)
    }
  }

  // --- Paket TANIMININ gerekçeli iptali (müşteri satış iptalinden ayrı) -------
  const cancelCatalogPackage = async () => {
    if (!draft.id) return
    const reason = cancelReason.trim()
    if (!reason) { setActionError('İptal gerekçesi yazmalısın.'); return }
    setBusy(true); setActionError(''); setSavedMsg('')
    try {
      await adminApi.cancelPackage(draft.id, reason, tenantId)
      setDraft((d) => ({ ...d, status: 'Cancelled', cancellationReason: reason }))
      setCancelOpen(false); setCancelReason('')
      setSavedMsg('Paket iptal edildi; artık satış listelerinde çıkmaz.')
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'İptal edilemedi.') } finally { setBusy(false) }
  }

  const restoreCatalogPackage = async () => {
    if (!draft.id) return
    setBusy(true); setActionError(''); setSavedMsg('')
    try {
      await adminApi.restorePackage(draft.id, tenantId)
      setDraft((d) => ({ ...d, status: 'Passive', cancellationReason: '' }))
      setSavedMsg('İptal geri alındı; paket pasif durumda. Satışa açmak için "Yayına Al".')
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Geri alınamadı.') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!draft.id) { setDraft(emptyDraft()); return }
    setBusy(true); setActionError('')
    try { await adminApi.deletePackage(draft.id, tenantId); setDraft(emptyDraft()); await reload() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Silinemedi.') } finally { setBusy(false) }
  }

  // Kategori EKLEME buradan yapılmaz — tek kaynak Kategoriler sayfasıdır (CategoryExplorer).
  const deleteCategory = async (id: string) => {
    await adminApi.deleteServiceCategory(id, tenantId)
    await reload()
  }

  const reorderCategory = async (orderedIds: string[]) => {
    await adminApi.reorderServiceCategories(orderedIds, tenantId)
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

  // Pakete eklenecek hizmet havuzu: arşivliler hariç TÜM hizmetler (aktif önce), arama + kategori süzgeci.
  const pickerPool = useMemo(
    () =>
      services
        .filter((s) => s.status !== 'Archived')
        .sort((a, b) => (a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1) || a.name.localeCompare(b.name, 'tr')),
    [services],
  )
  const pickerCategories = useMemo(() => {
    const set = new Set<string>()
    for (const s of pickerPool) if (s.group) set.add(s.group)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'))
  }, [pickerPool])
  const pickerServices = useMemo(() => {
    const t = svcSearch.trim().toLocaleLowerCase('tr')
    return pickerPool.filter(
      (s) =>
        (!svcCat || s.group === svcCat) &&
        (!t || s.name.toLocaleLowerCase('tr').includes(t) || (s.group || '').toLocaleLowerCase('tr').includes(t)),
    )
  }, [pickerPool, svcSearch, svcCat])

  return (
    <>
      <Topbar
        title="Paketler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Paket Yönetimi`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', 'Paketler']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setDraft(emptyDraft()); setSavedMsg(''); setActionError('') }}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#A5556E] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
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

      <PanelPage>
        <ApiStateNotice loading={loading} error={error} />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}
        {savedMsg && <div className="rounded-[12px] border border-emerald-300/30 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700"><CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />{savedMsg}</div>}

        {/* KPI KARTLARI — pano dili (renkli bant + beyaz gövde + alan grafiği).
            SERİ YALNIZ "toplam"da: pkgSeries paket ekleme trendidir; aktif/taslak
            sayaçlarının altına konsa o rakamların bu eğriyi izlediği sanılırdı. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PanelStat index={0} icon={ShoppingBag} tone="rose" label="Toplam paket"
            value={String(packages.length)} detail={`${filtered.length} kayıt listeleniyor`} series={pkgSeries} />
          <PanelStat index={1} icon={CheckCircle2} tone="mint" label="Aktif paket"
            value={String(activeCount)} detail={packages.length > 0 ? `${packages.length - activeCount} pasif` : 'Satışa açık'} />
          <PanelStat index={2} icon={FileText} tone="violet" label="Taslak"
            value={String(draftCount)} detail="Yayınlanmayı bekliyor" />
        </div>

        {/* MAIN: LIBRARY + DRAFT PANEL */}
        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          {/* LIBRARY */}
          <div className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white">
            <div className="border-b border-[#EAD8DF] px-5 py-4">
              <div className="font-display text-xl tracking-tight">Paket Kütüphanesi <span className="ml-1 rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[12px] text-[#8C4460]">{filtered.length}</span></div>
              <div className="text-[11px] text-[#74616A]">Hazır paketleri görüntüleyin, düzenleyin ve yönetin.</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[#EAD8DF] bg-[#F7F6F6] p-1">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:bg-white'}`}>{t.label}</button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: paket adı…" className="w-40 rounded-[10px] border border-[#EAD8DF] bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#A5556E]" />
                </div>
                <select value={priceSort} onChange={(e) => setPriceSort(e.target.value)} className="rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A5556E]">
                  <option value="">Fiyat</option><option value="asc">Artan</option><option value="desc">Azalan</option>
                </select>
              </div>
              {/* Kategori rayı — durum sekmeleriyle karışmasın diye kenarlıksız, tek satır ve
                  pay barlı. Ayrıntılı gerekçe: CatalogCategoryRail. */}
              <CatalogCategoryRail
                items={categorySettings}
                value={catFilter}
                sub={subFilter}
                onChange={(name, subName) => { setCatFilter(name); setSubFilter(subName) }}
                total={packages.length}
                itemLabel="paket"
              />
            </div>

            <div className="hidden grid-cols-[1.4fr_1.3fr_0.5fr_0.8fr_0.7fr_0.6fr_0.9fr_0.6fr] gap-2 border-b border-[#EAD8DF] bg-[#F7F6F6] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#74616A] lg:grid">
              <span>Paket</span><span>Dahil Hizmetler</span><span>Seans</span><span>Satış Fiyatı</span><span>Peşinat</span><span>Durum</span><span>Güncelleme</span><span className="text-right">İşlemler</span>
            </div>

            <div className="divide-y divide-[#F1E7EB]">
              {pageRows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    // Seçim modunda satır tıklaması detay yerine seçim yapar.
                    if (canBulkDelete && bulk.active) { bulk.toggle(p.id); return }
                    selectPackage(p)
                  }}
                  className={`grid w-full grid-cols-1 gap-2 px-5 py-3 text-left transition-colors hover:bg-[#F7F6F6] lg:grid-cols-[1.4fr_1.3fr_0.5fr_0.8fr_0.7fr_0.6fr_0.9fr_0.6fr] lg:items-center ${bulk.isSelected(p.id) ? 'bg-[#F6DFE6]' : draft.id === p.id ? 'bg-[#F6DFE6]/60' : ''}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {canBulkDelete && <SelectBox checked={bulk.isSelected(p.id)} onToggle={() => bulk.toggle(p.id)} />}
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#A5556E] text-white"><ServiceIcon iconKey={p.iconKey || suggestIcon(p.name || p.category)} className="h-5 w-5" /></span>
                    <span className="truncate text-[13px] font-medium text-[#2A2027]">{p.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {p.items.slice(0, 2).map((i) => (
                      <span key={i.serviceDefinitionId} className="rounded-md border border-[#EAD8DF] bg-[#F7F6F6] px-1.5 py-0.5 text-[9px] text-[#8C4460]">{i.serviceName}</span>
                    ))}
                    {p.items.length > 2 && <span className="text-[10px] text-[#74616A]">+{p.items.length - 2}</span>}
                    {p.items.length === 0 && <span className="text-[10px] text-[#74616A]">—</span>}
                  </div>
                  <div className="text-[12px] tabular-nums text-[#5A4B53]">{p.totalSessions}</div>
                  <div className="font-display text-[14px] tabular-nums">{formatTL(p.totalPrice)}</div>
                  <div className="text-[12px] tabular-nums text-[#5A4B53]">{formatTL(p.depositAmount)}</div>
                  <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span></div>
                  <div className="text-[10px] font-mono text-[#74616A]">{p.updatedAt || '—'}</div>
                  <div className="flex justify-end"><span className="rounded-md border border-[#EAD8DF] bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#5A4B53]">Detay</span></div>
                </button>
              ))}
              {!pageRows.length && !loading && (
                <div className="px-5 py-12 text-center text-sm text-[#74616A]">{q || tab !== 'all' ? 'Eşleşen paket yok.' : 'Henüz paket yok. Aşağıdaki hizmetlerden seçerek ilk paketini oluştur.'}</div>
              )}
            </div>

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAD8DF] px-5 py-3.5">
                <div className="text-[11px] text-[#2A2027]/50">Toplam {filtered.length} paket</div>
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

          {/* DRAFT PANEL */}
          <div className="rounded-[20px] border border-[#EAD8DF] bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#A5556E]/75">Seçili paket taslağı</div>
              <div className="flex items-center gap-1.5">
                {draft.id && (
                  <PackageSaleDialog
                    tenantId={tenantId}
                    presetPackageId={draft.id}
                    onDone={reload}
                    triggerLabel="Bu paketi sat"
                    triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-[#8C4460]/40 bg-[#F6DFE6] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#8C4460] transition-colors hover:bg-[#F6DFE6]"
                  />
                )}
                <button type="button" onClick={() => setShowIconPicker((v) => !v)} title="Paket ikonu seç"
                  className="grid h-7 w-7 place-items-center rounded-md border border-[#EAD8DF] bg-white text-[#74616A] hover:text-[#A5556E]"><PencilLine className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[#BE7690]/70 bg-[#A5556E] text-white">
                <ServiceIcon iconKey={draft.iconKey || suggestIcon(draft.name || draft.category)} className="h-5 w-5" />
              </span>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full bg-transparent font-display text-2xl tracking-tight text-[#2A2027] outline-none placeholder:text-[#74616A]" placeholder="Paket adı" />
              <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase ${STATUS_TONE[draft.status]}`}>{STATUS_LABEL[draft.status]}</span>
            </div>
            <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="mt-1 w-full bg-transparent text-[12px] text-[#5A4B53] outline-none placeholder:text-[#74616A]" placeholder="Paket açıklaması (müşteriye gösterilir)…" />

            {showIconPicker && (
              <div className="mt-3"><IconPicker value={draft.iconKey || suggestIcon(draft.name || draft.category)} onChange={(k) => { setDraft((d) => ({ ...d, iconKey: k })); setShowIconPicker(false) }} /></div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={draft.category} disabled={busy} onChange={(e) => void changePackageCategory(e.target.value)}
                className="rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A5556E] disabled:opacity-60">
                <option value="">— Kategorisiz —</option>
                {assignableCategories.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {/* Alt kategori SERBEST YAZILMAZ ve ÖNCE KATEGORİ ister: kategori seçilene kadar
                  kapalı durur, seçilince yalnız o kategorinin altları listelenir. Kutu gizlenmez,
                  kapalı gösterilir — alanın varlığı kaybolmasın. */}
              <select
                value={draft.subCategory}
                disabled={busy || packageSubCategoryOptions.length === 0}
                onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, subCategory: v })); if (draft.id) void saveSubCategory(v) }}
                className="w-44 rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#A5556E] disabled:cursor-not-allowed disabled:bg-[#F7F6F6] disabled:opacity-70"
              >
                <option value="">— Alt kategorisiz —</option>
                {packageSubCategoryOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {packageSubCategoryOptions.length === 0 && (
                <span className="text-[10px] text-[#74616A]">
                  {draft.category ? 'Bu kategorinin alt kategorisi yok.' : 'Alt kategori için önce kategori seç.'}
                </span>
              )}
              <span className="text-[9px] text-[#74616A]">
                {draft.id ? 'Seçim otomatik kaydedilir.' : 'Paket ilk kaydedildiğinde kategori atanır.'}
              </span>
            </div>

            {/* Onam formu — paketi SATIN ALAN müşteride uyarı doğurur */}
            <div className="mt-4 rounded-[14px] border border-[#EAD8DF]/65 bg-white p-3">
              <ConsentPicker
                value={draft.consentTemplateIds}
                onChange={(next) => setDraft((d) => ({ ...d, consentTemplateIds: next }))}
                tenantId={tenantId}
                label="Bu paket için onam formu istensin mi?"
                hint="Seçilen formlar, bu paketi satın alan müşteride imzalanana kadar müşteri kartı, cari, adisyon ve randevu ekranlarında uyarı olarak görünür."
              />
            </div>

            {/* Dahil edilen hizmetler */}
            <div className="mt-4 rounded-[14px] border border-[#EAD8DF]/65 bg-[#F7F6F6] p-3">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Dahil edilen hizmetler</div>
              <div className="space-y-1.5">
                {draft.items.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-[#EAD8DF] bg-white px-3 py-4 text-center text-[11px] text-[#74616A]">
                    Aşağıdaki hizmet kartlarından "Pakete Ekle" ile hizmet ekleyin.
                  </div>
                )}
                {draft.items.map((i) => (
                  <div key={i.serviceDefinitionId} className="flex items-center gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-2.5 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#A5556E] text-white"><ServiceIcon iconKey={i.iconKey || suggestIcon(i.name)} className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-[#2A2027]">{i.name}</div>
                      <div className="text-[10px] text-[#74616A]">{i.duration} dk</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-[9px] border border-[#EAD8DF] bg-white">
                      <button type="button" onClick={() => changeCount(i.serviceDefinitionId, -1)} className="grid h-7 w-7 place-items-center text-[#5A4B53] hover:text-[#A5556E]"><Minus className="h-3 w-3" /></button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={i.sessionCount}
                        onChange={(e) => setCount(i.serviceDefinitionId, Number(e.target.value))}
                        aria-label="Seans sayısı"
                        className="w-10 [appearance:textfield] border-0 bg-transparent text-center text-[12px] tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button type="button" onClick={() => changeCount(i.serviceDefinitionId, +1)} className="grid h-7 w-7 place-items-center text-[#5A4B53] hover:text-[#A5556E]"><Plus className="h-3 w-3" /></button>
                    </div>
                    <div className="w-16 shrink-0 text-right font-display text-[13px] tabular-nums">{formatTL(i.unitPrice)}</div>
                    <button type="button" onClick={() => removeItem(i.serviceDefinitionId)} className="shrink-0 text-[#74616A] hover:text-rose-600"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Fiyat kutusu */}
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#EAD8DF]/65 bg-[#f1e5ea]">
              <div className="space-y-1.5 bg-white p-3">
                <Row k="Ara toplam" v={formatTL(araToplam)} />
                {indirim > 0 && <Row k="İndirim" v={`-${formatTL(indirim)}`} tone="text-rose-600" />}
                <div className="flex items-center justify-between border-t border-[#f1e5ea] pt-1.5">
                  <span className="text-[12px] font-medium text-[#2A2027]">Satış fiyatı</span>
                  <input type="number" min={0} value={draft.salePrice || ''} onChange={(e) => setDraft((d) => ({ ...d, salePrice: Number(e.target.value), priceTouched: true }))}
                    className="w-24 rounded-[8px] border border-[#EAD8DF] bg-white px-2 py-1 text-right font-display text-[15px] tabular-nums outline-none focus:border-[#A5556E]" />
                </div>
              </div>
              <div className="space-y-1.5 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#5A4B53]">Peşinat</span>
                  <input type="number" min={0} value={draft.deposit || ''} onChange={(e) => setDraft((d) => ({ ...d, deposit: Number(e.target.value), depositTouched: true }))}
                    className="w-20 rounded-[8px] border border-[#EAD8DF] bg-white px-2 py-0.5 text-right text-[12px] tabular-nums outline-none focus:border-[#A5556E]" />
                </div>
                <Row k="Kalan" v={formatTL(kalan)} />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#5A4B53]">Taksit</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={24} value={draft.installments} onChange={(e) => setDraft((d) => ({ ...d, installments: Math.max(0, Number(e.target.value)) }))}
                      className="w-12 rounded-[8px] border border-[#EAD8DF] bg-white px-1.5 py-0.5 text-right text-[12px] tabular-nums outline-none focus:border-[#A5556E]" />
                    <span className="text-[11px] text-[#5A4B53]">ay</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sadakat puanı ile hediye */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] border border-amber-200/70 bg-amber-50/40 px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <Gift className="h-4 w-4 text-amber-600" />
                <div>
                  <div className="text-[11px] font-medium text-[#2A2027]">Sadakat puanı ile hediye</div>
                  <div className="text-[10px] leading-snug text-[#74616A]">
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
              <div className="flex items-center gap-2.5 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
                <Sparkles className="h-4 w-4 text-[#A5556E]" />
                <div><div className="text-[9px] font-mono uppercase text-[#74616A]">Toplam seans</div><div className="font-display text-xl tabular-nums">{toplamSeans}</div></div>
              </div>
              <div className="flex items-center gap-2.5 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
                <TrendingUp className="h-4 w-4 text-[#A5556E]" />
                <div><div className="text-[9px] font-mono uppercase text-[#74616A]">Tahmini kâr</div><div className="font-display text-xl tabular-nums">%{tahminiKar}</div></div>
              </div>
            </div>

            {/* Satış performansı — bu paketi kim, kime, ne zaman satmış (kayıtlı paketlerde). */}
            {draft.id && (
              <div className="mt-3">
                <CatalogSalesPanel
                  item={{ id: draft.id, name: draft.name || 'Paket', price: draft.salePrice || 0 }}
                  kind="package"
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

            {/* İptal edilmiş paketin gerekçesi — hangi paketten neden vazgeçildiği kartta görünür. */}
            {draft.status === 'Cancelled' && (
              <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50/70 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-rose-600">
                  <XCircle className="h-3.5 w-3.5" /> Paket iptal edildi
                </div>
                <div className="mt-1 text-[12px] text-[#2A2027]">{draft.cancellationReason || 'Gerekçe belirtilmemiş.'}</div>
                <div className="mt-1 text-[10px] text-[#74616A]">Bu, kurumun paketten vazgeçmesidir; müşterilerin satış iptalleriyle ilgisi yoktur.</div>
              </div>
            )}

            {/* İptal gerekçesi kutusu — "İptal Et"e basınca açılır, gerekçesiz iptal edilemez. */}
            {cancelOpen && draft.status !== 'Cancelled' && (
              <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50/60 p-3">
                <div className="text-[11px] font-medium text-rose-700">Paketi neden iptal ediyorsun?</div>
                <div className="mt-0.5 text-[10px] text-[#74616A]">
                  Paket silinmez; geçmiş satışlar ve raporlar korunur, yalnızca yeni satış listelerinden düşer.
                </div>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value.slice(0, 500))}
                  rows={2}
                  autoFocus
                  placeholder="Örn: Hizmet kapsamı değişti, yerine yeni paket açıldı."
                  className="mt-2 w-full resize-none rounded-[9px] border border-rose-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-rose-400"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button type="button" onClick={() => { setCancelOpen(false); setCancelReason('') }}
                    className="rounded-[9px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] text-[#5A4B53] hover:bg-[#F7F6F6]/50">
                    Vazgeç
                  </button>
                  <button type="button" disabled={busy || !cancelReason.trim()} onClick={cancelCatalogPackage}
                    className="inline-flex items-center gap-1.5 rounded-[9px] bg-rose-600 px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Paketi İptal Et
                  </button>
                </div>
              </div>
            )}

            {/* Aksiyonlar */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button type="button" disabled={busy} onClick={() => save('Draft')}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-2 text-[11px] font-medium text-[#5A4B53] hover:bg-[#F7F6F6]/50 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Taslağı Kaydet
              </button>
              <button type="button" disabled={busy} onClick={() => save(draft.status === 'Active' ? 'Passive' : 'Active')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[11px] font-medium disabled:opacity-50 ${
                  draft.status === 'Active'
                    ? 'border border-amber-300/60 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'bg-[#A5556E] text-white hover:opacity-90'
                }`}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.status === 'Active' ? <PauseCircle className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                {draft.status === 'Active' ? 'Pasife Al' : 'Yayına Al'}
              </button>
              {/* İptal: paket TANIMINDAN gerekçeli vazgeçme. Silmez — geçmiş satışlar ve raporlar korunur,
                  paket yalnızca satış listelerinden düşer (isActive=false) ve "İptal Ettiğimiz" sekmesinde durur.
                  Müşterinin satış iptali BAŞKA bir şeydir; o, aşağıdaki satış panelinden yapılır. */}
              <button type="button" disabled={busy || !draft.id}
                onClick={() => { if (draft.status === 'Cancelled') { void restoreCatalogPackage() } else { setActionError(''); setCancelOpen((v) => !v) } }}
                title={draft.id ? undefined : 'Önce paketi kaydet'}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 text-[11px] font-medium disabled:opacity-50 ${
                  draft.status === 'Cancelled'
                    ? 'border-emerald-300/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-rose-300/50 bg-white text-rose-600 hover:bg-rose-50'
                }`}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.status === 'Cancelled' ? <RotateCcw className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {draft.status === 'Cancelled' ? 'İptali Geri Al' : 'İptal Et'}
              </button>
              <button type="button" disabled={busy} onClick={remove}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {draft.id ? 'Sil' : 'Temizle'}
              </button>
            </div>
          </div>
        </div>


        {/* KATEGORİ SATIŞLARI — kategori rayından bir kategori seçilince, o kategorideki
            TÜM satışlar (hangi müşteri, ne aldı, kim sattı, iptal edildiyse gerekçesi)
            tek listede görünür. Geçmiş yıllara ait satışlar da buraya düşer. */}
        {catFilter && (
          <div className="rounded-[20px] border border-[#EAD8DF] bg-white p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-display text-xl tracking-tight">{catFilter} · Satışlar</div>
                <div className="text-[11px] text-[#74616A]">
                  Bu kategorideki tüm satışlar: hangi müşteri ne almış, kim satmış, iptal edildiyse gerekçesi.
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCatFilter(''); setSubFilter('') }}
                className="rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] font-medium text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
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
          title="Paket Kategori Ayarları"
          description="Kategoriye göre filtreleyin veya sırasını değiştirin. Yeni kategori Kategoriler sayfasından eklenir."
          itemLabel="paket"
          categories={topCategorySettings}
          selectedCategory={catFilter}
          canManage={canCustomServiceCat}
          onSelect={(name) => { setCatFilter(name); setSubFilter('') }}
          onDelete={deleteCategory}
          onReorder={canCustomServiceCat ? reorderCategory : undefined}
        />

        {/* PAKETE EKLENECEK HİZMETLER */}
        <div className="rounded-[20px] border border-[#EAD8DF] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-display text-lg tracking-tight">Pakete Eklenecek Hizmetler</div>
              <div className="text-[11px] text-[#74616A]">Hizmet kartına tıklayarak pakete ekleyin; seans sayısını yukarıdaki listeden ayarlayın.</div>
            </div>
            <span className="shrink-0 rounded-full border border-[#BE7690]/70 bg-[#F6DFE6] px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">
              {draft.items.length} seçili · {pickerPool.length} hizmet
            </span>
          </div>

          {/* Arama + kategori süzgeci */}
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74616A]" />
              <input
                value={svcSearch}
                onChange={(e) => setSvcSearch(e.target.value)}
                placeholder="Hizmet ara: ad veya kategori…"
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white py-2.5 pl-9 pr-9 text-[13px] outline-none transition-colors focus:border-[#A5556E]"
              />
              {svcSearch && (
                <button type="button" onClick={() => setSvcSearch('')} aria-label="Aramayı temizle"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#74616A] hover:text-[#A5556E]"><X className="h-4 w-4" /></button>
              )}
            </div>
            {pickerCategories.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <CatPill active={!svcCat} onClick={() => setSvcCat('')}>Tümü</CatPill>
                {pickerCategories.map((c) => (
                  <CatPill key={c} active={svcCat === c} onClick={() => setSvcCat(svcCat === c ? '' : c)}>{c}</CatPill>
                ))}
              </div>
            )}
          </div>

          {/* Grid — tüm hizmetler görünür (yatay kaydırma yok) */}
          {pickerPool.length === 0 ? (
            <div className="mt-4 rounded-[12px] border border-dashed border-[#EAD8DF] bg-white py-8 text-center text-sm text-[#74616A]">
              Henüz hizmet yok — önce Hizmet Havuzu&apos;ndan hizmet ekleyin.
            </div>
          ) : pickerServices.length === 0 ? (
            <div className="mt-4 rounded-[12px] border border-dashed border-[#EAD8DF] bg-white py-8 text-center text-sm text-[#74616A]">
              Aramanıza uygun hizmet bulunamadı.
            </div>
          ) : (
            <div className="mt-3 grid max-h-[420px] grid-cols-2 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
              {pickerServices.map((s) => {
                const item = draft.items.find((i) => i.serviceDefinitionId === s.id)
                const inDraft = !!item
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addService(s)}
                    title={inDraft ? `${s.name} — tekrar tıkla, seansı artır` : `${s.name} — pakete ekle`}
                    className={`group relative flex flex-col rounded-[14px] border p-3 text-left transition-all ${
                      inDraft
                        ? 'border-[#8C4460]/60 bg-[#F6DFE6] ring-1 ring-[#A5556E]/25'
                        : 'border-[#EAD8DF] bg-white hover:border-[#BE7690] hover:shadow-[0_10px_24px_-18px_rgba(200,87,118,0.6)]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#A5556E] text-white">
                        <ServiceIcon iconKey={s.iconKey || suggestIcon(s.name || s.group)} className="h-4 w-4" />
                      </span>
                      {inDraft ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#A5556E] px-2 py-0.5 text-[10px] font-semibold text-white">
                          <CheckCircle2 className="h-3 w-3" />×{item!.sessionCount}
                        </span>
                      ) : (
                        <span className="grid h-6 w-6 place-items-center rounded-full border border-[#EAD8DF] text-[#A5556E] transition-colors group-hover:border-[#8C4460] group-hover:bg-[#A5556E] group-hover:text-white">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 line-clamp-1 text-[12.5px] font-medium text-[#2A2027]">{s.name}</div>
                    <div className="flex items-center gap-1">
                      <span className="line-clamp-1 text-[10px] text-[#74616A]">{s.group || 'Genel'}</span>
                      {s.status !== 'Active' && (
                        <span className={`shrink-0 rounded border px-1 py-px text-[8px] font-mono uppercase ${STATUS_TONE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-[#2A2027]/50">{s.duration} dk</span>
                      <span className="font-display text-[13px] tabular-nums text-[#2A2027]">{formatTL(s.price)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* PAKET ÖZETİ */}
        <div className="rounded-[20px] border border-[#EAD8DF] bg-white p-5">
          <div className="font-display text-xl tracking-tight">Paket Özeti</div>
          <div className="text-[11px] text-[#74616A]">Paket satış performansınızı özet olarak inceleyin.</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryTile icon={Trophy} tone="text-amber-600 bg-amber-50" label="En çok satan paket" value={summary.top} />
            <SummaryTile icon={ShoppingBag} tone="text-[#A5556E] bg-[#F6DFE6]" label="Satılan paket (cari)" value={String(summary.sold)} />
            <SummaryTile icon={Tag} tone="text-violet-600 bg-violet-50" label="Aktif kampanya oranı" value={`%${summary.campRate}`} />
          </div>
        </div>

        <CampaignPanel tenantId={tenantId} />
      </PanelPage>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="package"
        onDone={() => void reload()}
      />
      {/* Toplu silme çubuğu — seçim yapılınca ekranın altında belirir. */}
      {canBulkDelete && (
      <BulkSelectBar
        api={bulk}
        itemLabel="paket"
        pageIds={pageRows.map((p) => p.id)}
        onDelete={(id) => adminApi.deletePackage(id, tenantId)}
        onDone={() => reload()}
      />
      )}

    </>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[#5A4B53]">{k}</span>
      <span className={`text-[13px] tabular-nums ${tone || 'text-[#2A2027]'}`}>{v}</span>
    </div>
  )
}

function CatPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-[#8C4460] bg-[#A5556E] text-white'
          : 'border-[#EAD8DF] bg-white text-[#5A4B53] hover:border-[#BE7690] hover:text-[#A5556E]'
      }`}
    >
      {children}
    </button>
  )
}

function SummaryTile({ icon: Icon, tone, label, value }: { icon: typeof Wallet; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#EAD8DF]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0"><div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">{label}</div><div className="truncate font-display text-lg tracking-tight text-[#2A2027]">{value}</div></div>
    </div>
  )
}
