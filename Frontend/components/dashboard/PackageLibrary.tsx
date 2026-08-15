'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown, FileUp, FolderCog, Layers3, PackagePlus, ShoppingBag, Tag, Wallet, X,
} from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { PanelEmpty, PanelPage } from '@/components/dashboard/PanelKit'
import BulkSelectBar, { SelectBox, useBulkSelect } from '@/components/dashboard/BulkSelectBar'
import { usePermission } from '@/hooks/usePermission'
import { useFeature } from '@/components/dashboard/FeatureContext'
import CatalogCategoryManager from '@/components/dashboard/CatalogCategoryManager'
import CatalogCategoryRail, { buildCatalogCategoryItems } from '@/components/dashboard/CatalogCategoryRail'
import CampaignPanel from '@/components/dashboard/CampaignPanel'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import CatalogSalesPanel from '@/components/dashboard/CatalogSalesPanel'
import PackageEditorModal, {
  emptyPackageDraft, type CatalogService, type PackageDraft,
} from '@/components/dashboard/PackageEditorModal'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import {
  CATALOG_STATUS_LABEL, CardMeta, CatalogCardShell, CatalogGrid, CatalogModal, CatalogOverview,
  CatalogPager, CatalogSearch, CatalogToolbar, CatalogViewToggle, Chip, StatusPill, StatusSegments,
  catalogFieldCls, catalogGhostBtn, catalogPrimaryBtn, type CatalogView,
} from '@/components/dashboard/CatalogKit'
import type { HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import type { IdempotentWriteOptions } from '@/lib/idempotency'
import {
  apiItems, categoryOrderIndex, formatTL, mapCancelledSale, normalizeCustomServiceCategory,
  normalizePackage, normalizeService, normalizeStaff,
} from '@/lib/apiMappers'
import type {
  ApiConsentTemplate, ApiCustomServiceCategory, ApiService, ApiServicePackage, ApiStaff,
  CatalogStatusKey, ServicePackage,
} from '@/lib/types'

/* ==========================================================================
 * PAKET KATALOĞU
 *
 * 2026 Ağustos'unda sıfırdan kuruldu. Eski sayfada paketi kurmak üç ayrı yere
 * dağılmıştı: sağdaki taslak paneli, sayfanın en altındaki "pakete eklenecek
 * hizmetler" ızgarası ve arada kalan kategori blokları. Bir hizmet eklemek için
 * ekranın altına inip yukarı dönmek gerekiyordu; kategori kutusu kendi kendine
 * kaydediyor, gerisi "Taslağı Kaydet" bekliyordu.
 *
 * Yeni akış: liste + kart ızgarası burada, paketi kurmanın TAMAMI tek modalde
 * (PackageEditorModal). Ayrıca eski "Tahmini kâr %" göstergesi kaldırıldı —
 * fiyat/enbüyük-fiyat oranından uydurulmuş bir sayıydı. "Satılan paket (cari)"
 * ve "aktif kampanya oranı" özetleri de ilk 500 cari kaydından türetildiği için
 * kaldırıldı; gerçek satış verisi paket modalindeki Satışlar sekmesindedir.
 *
 * İKİ AYRI İPTAL KAVRAMI, karıştırılmamalı:
 *  • 'Cancelled'      → paket TANIMI iptal edildi (kurum vazgeçti, gerekçesiyle).
 *  • 'customerCancel' → paketin MÜŞTERİ SATIŞI iptal edildi. Bu paketin durumunu
 *    değiştirmez; paket hâlâ aktif olabilir.
 * ========================================================================== */

type StatusFilter = 'all' | CatalogStatusKey | 'customerCancel'
type SortKey = 'name' | 'price-desc' | 'price-asc' | 'sessions-desc' | 'updated'

const SORT_LABEL: Record<SortKey, string> = {
  name: 'Ada göre (A→Z)',
  'price-desc': 'Fiyat: yüksekten',
  'price-asc': 'Fiyat: düşükten',
  'sessions-desc': 'Seans: çoktan',
  updated: 'Son güncellenen',
}

export default function PackageLibrary({
  tenantId, branchId, institutionName, branchLabel, canCustomServiceCat,
}: {
  tenantId?: string
  branchId?: string | null
  institutionName?: string
  branchLabel?: string
  canCustomServiceCat: boolean
}) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  // Alt kategori süzgeci kategoriye BAĞLIDIR: kategori seçilince alt şeridi açılır.
  const [subFilter, setSubFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<CatalogView>('grid')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)

  const [editorDraft, setEditorDraft] = useState<PackageDraft>(emptyPackageDraft)
  const [editorOpen, setEditorOpen] = useState(false)
  /** "Geçmiş satış ekle" alt çubuktan tetiklenir, diyalog satış panelinde açılır. */
  const [historyOpen, setHistoryOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categorySalesOpen, setCategorySalesOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [campaignsOpen, setCampaignsOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const { can } = usePermission()
  const canBulkDelete = can('Services.Delete')
  const canManageService = can('Services.Manage')
  const canCampaigns = useFeature('marketing.campaigns')
  const bulk = useBulkSelect()

  const { data, loading, error, reload } = useApiQuery<{
    packages: ApiServicePackage[]
    services: ApiService[]
    cats: ApiCustomServiceCategory[]
    staff: ApiStaff[]
    consents: ApiConsentTemplate[]
    cancelled: unknown[]
  }>(
    async () => {
      if (!tenantId) return { packages: [], services: [], cats: [], staff: [], consents: [], cancelled: [] }
      const [packages, services, cats, staff, consents, cancelled] = await Promise.all([
        fetchAllPaged<ApiServicePackage>((p, size) => adminApi.packages<ApiServicePackage>({ tenantId, page: p, pageSize: size })),
        // TÜM hizmetleri çek (tek sayfa tavanına takılıp havuz eksik görünmesin).
        fetchAllPaged<ApiService>((p, size) => adminApi.services<ApiService>({ tenantId, page: p, pageSize: size })),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.consentTemplates<ApiConsentTemplate>(tenantId).catch(() => []),
        // "Müşteri İptali" sekmesi: iptal edilen satışlar canlı cari listesinde YOK, arşivde.
        adminApi.listCancelledSales<unknown[]>(undefined, tenantId).catch(() => [] as unknown[]),
      ])
      return {
        packages,
        services,
        cats: Array.isArray(cats) ? cats : [],
        staff: apiItems(staff),
        consents: Array.isArray(consents) ? consents : [],
        cancelled: Array.isArray(cancelled) ? cancelled : [],
      }
    },
    [tenantId],
    { initialData: { packages: [], services: [], cats: [], staff: [], consents: [], cancelled: [] } },
  )

  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  // rawCategory = HAM kategori adı. normalizeService boş kategoriye "Genel Hizmet" uydurur;
  // o uydurma ad hizmet havuzunun kategori süzgecine ve satış seçicisine düşerse kullanıcı
  // gerçekte var olmayan bir kategoriyi görür/seçer.
  const services = useMemo<CatalogService[]>(
    () => (data?.services || []).map((s, i) => ({ ...normalizeService(s, i), rawCategory: (s?.category || '').trim() })),
    [data],
  )
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const customCategories = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])

  /* ---- satış paneli ---------------------------------------------------- */
  const staffOptions = useMemo(() => staff.map((s) => ({ id: s.id, name: s.name })), [staff])
  const packageOptions = useMemo(
    () => packages.map((p) => ({ id: p.id, name: p.name, price: p.totalPrice, cat: p.category, sub: p.subCategory, meta: `${formatTL(p.totalPrice)} · ${p.totalSessions} seans` })),
    [packages],
  )
  const serviceOptions = useMemo(
    () => services.map((s) => ({ id: s.id, name: s.name, price: s.price, cat: s.rawCategory, sub: s.subGroup, meta: formatTL(s.price) })),
    [services],
  )

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

  const salesPanelProps = {
    tenantId,
    staffOptions,
    packageOptions,
    serviceOptions,
    busy: salesBusy,
    onCreateHistorical: handleCreateHistoricalSale,
    onCancelSale: handleCancelSale,
    onRestoreSale: handleRestoreSale,
    onCollectInstallment: handleCollectInstallment,
  }

  /* ---- kategoriler ----------------------------------------------------- */
  const categorySettings = useMemo(
    () => buildCatalogCategoryItems(
      customCategories,
      packages.map((p) => ({ category: p.category, subCategory: p.subCategory })),
    ),
    [packages, customCategories],
  )
  const topCategorySettings = useMemo(() => categorySettings.filter((c) => c.kind !== 'sub'), [categorySettings])

  /**
   * Kategori kutusuna YALNIZCA üst kategoriler girer (alt kategori üst gibi seçilemesin).
   * Hizmet tarafında HAM kategori kullanılır — normalizeService'in boş kategoriye uydurduğu
   * "Genel Hizmet" listeye düşmesin.
   */
  const assignableCategories = useMemo(() => {
    const names = new Set<string>()
    for (const category of customCategories) if (!category.parentId) names.add(category.name)
    for (const service of data?.services || []) {
      const name = (service?.category || '').trim()
      if (name) names.add(name)
    }
    for (const pkg of packages) if (pkg.category) names.add(pkg.category)
    const orderOf = categoryOrderIndex(customCategories.filter((c) => !c.parentId))
    return Array.from(names).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b, 'tr'))
  }, [customCategories, data, packages])

  /**
   * Alt kategori seçenekleri ÖNCE KATEGORİ ister. Tanımlı alt kategoriler + o kategoride
   * KULLANIMDA olanlar listelenir; ikincisi şart, çünkü serbest yazım kaldırılmadan önce
   * girilmiş alt kategorilerin kaydı yoktur ve yalnız tanımlılar listelenirse mevcut paketin
   * alt kategorisi seçilemez olurdu.
   */
  const subCategoriesFor = useCallback(
    (category: string): string[] => {
      if (!category) return []
      const parent = customCategories.find((c) => !c.parentId && c.name === category)
      const names = new Set<string>()
      if (parent) for (const child of customCategories) if (child.parentId === parent.id) names.add(child.name)
      for (const pkg of packages) {
        const sub = (pkg.subCategory || '').trim()
        if (sub && pkg.category === category) names.add(sub)
      }
      const orderOf = categoryOrderIndex(customCategories.filter((c) => c.parentId))
      return Array.from(names).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b, 'tr'))
    },
    [customCategories, packages],
  )

  /* ---- süzgeç + sıralama ----------------------------------------------- */
  // Müşteri satışı iptal edilmiş paketlerin id'leri. Kaynak: İPTAL ARŞİVİ (cancelled_sales).
  // İptalde cari kaydı canlı tablodan silinip arşive taşındığı için burayı canlı cari listesi
  // üzerinden aramak hiçbir şey bulmaz.
  const customerCancelledPackageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const raw of data?.cancelled || []) {
      const sale = mapCancelledSale(raw)
      if (sale.servicePackageId) ids.add(sale.servicePackageId)
    }
    return ids
  }, [data])

  const filtered = useMemo(() => {
    let list = packages
    if (status === 'customerCancel') list = list.filter((p) => customerCancelledPackageIds.has(p.id))
    else if (status !== 'all') list = list.filter((p) => p.status === status)
    if (catFilter) list = list.filter((p) => (catFilter === 'Kategorisiz' ? !p.category : p.category === catFilter))
    if (subFilter) list = list.filter((p) => (p.subCategory || '') === subFilter)
    if (q.trim()) {
      const needle = q.trim().toLocaleLowerCase('tr')
      list = list.filter((p) =>
        p.name.toLocaleLowerCase('tr').includes(needle) ||
        (p.category || '').toLocaleLowerCase('tr').includes(needle) ||
        p.items.some((item) => item.serviceName.toLocaleLowerCase('tr').includes(needle)))
    }
    const sorted = [...list]
    if (sort === 'price-desc') sorted.sort((a, b) => b.totalPrice - a.totalPrice)
    else if (sort === 'price-asc') sorted.sort((a, b) => a.totalPrice - b.totalPrice)
    else if (sort === 'sessions-desc') sorted.sort((a, b) => b.totalSessions - a.totalSessions)
    else if (sort === 'updated') sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    else sorted.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    return sorted
  }, [packages, status, catFilter, subFilter, q, sort, customerCancelledPackageIds])

  useEffect(() => { setPage(1) }, [status, catFilter, subFilter, q, sort, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = useMemo(
    () => filtered.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize),
    [filtered, page, pageSize, totalPages],
  )

  // Kampanya bölümü panodan `#kampanyalar` bağlantısıyla açılır. Sayfa istemcide çizildiği
  // için tarayıcı çapaya KENDİLİĞİNDEN kaydırmaz (bağlantı tıklandığında hedef henüz yoktur):
  // bölümü hem açıyor hem görünür alana getiriyoruz.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#kampanyalar') return
    setCampaignsOpen(true)
    const timer = window.setTimeout(
      () => document.getElementById('kampanyalar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      400,
    )
    return () => window.clearTimeout(timer)
  }, [])

  /* ---- genel bakış (yalnız katalog gerçekleri) -------------------------- */
  const counts = useMemo(() => {
    const map: Record<CatalogStatusKey, number> = { Active: 0, Passive: 0, Draft: 0, Archived: 0, Cancelled: 0 }
    for (const pkg of packages) map[pkg.status]++
    return map
  }, [packages])

  const overviewFacts = useMemo(() => {
    const facts: { label: string; value: string }[] = [{ label: 'Kategori', value: String(topCategorySettings.length) }]
    if (packages.length === 0) return facts
    const prices = packages.map((p) => p.totalPrice).filter((price) => price > 0)
    const sessions = packages.map((p) => p.totalSessions).filter((count) => count > 0)
    if (prices.length) {
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      facts.push({ label: 'Fiyat', value: min === max ? formatTL(min) : `${formatTL(min)} – ${formatTL(max)}` })
    }
    if (sessions.length) {
      const min = Math.min(...sessions)
      const max = Math.max(...sessions)
      facts.push({ label: 'Seans', value: min === max ? `${min}` : `${min}–${max}` })
    }
    return facts
  }, [packages, topCategorySettings])

  /* ---- onam bağı -------------------------------------------------------- */
  /**
   * Şablonların packageIds listesini paketle eşitler; yalnız DEĞİŞEN şablonlar güncellenir.
   * (Bağ paket kaydında değil şablon kaydında durduğu için güncelleme şablon ucundan yapılır.)
   */
  const syncConsentLinks = async (packageId: string, selected: string[]): Promise<void> => {
    const templates = data?.consents || []
    if (templates.length === 0 && selected.length === 0) return
    for (const template of templates) {
      if (!template.id) continue
      const linked = (template.packageIds || []).includes(packageId)
      const wanted = selected.includes(template.id)
      if (linked === wanted) continue
      const nextIds = wanted
        ? [...(template.packageIds || []), packageId]
        : (template.packageIds || []).filter((x) => x !== packageId)
      await adminApi.updateConsentTemplate(template.id, {
        title: template.title, body: template.body, checkItems: template.checkItems || [],
        requiresSignature: template.requiresSignature !== false, isActive: template.isActive !== false,
        serviceIds: template.serviceIds || [], packageIds: nextIds,
      }, tenantId)
    }
  }

  /* ---- yazma yolları ---------------------------------------------------- */
  const packagePayload = (draft: PackageDraft, nextStatus: CatalogStatusKey) => ({
    branchId: branchId || null,
    name: draft.name.trim(),
    description: draft.description || null,
    // Kategori artık ayrı bir uçla kendi kendine kaydedilmiyor; ana PUT gövdesiyle gider.
    category: draft.category || null,
    subCategory: draft.subCategory || null,
    iconKey: draft.iconKey || suggestIcon(draft.name || draft.category) || null,
    totalPrice: draft.salePrice,
    depositAmount: draft.deposit,
    installmentCount: draft.installments,
    loyaltyPointCost: draft.loyaltyPointCost || null,
    isActive: nextStatus === 'Active',
    status: nextStatus,
    items: draft.items.map((item) => ({
      serviceDefinitionId: item.serviceDefinitionId,
      sessionCount: item.sessionCount,
      unitPrice: item.unitPrice,
    })),
  })

  const savePackage = async (draft: PackageDraft, nextStatus: CatalogStatusKey): Promise<string | null> => {
    setBusy(true); setActionError(''); setNotice('')
    try {
      const payload = packagePayload(draft, nextStatus)
      let savedId = draft.id
      if (draft.id) {
        await adminApi.updatePackage(draft.id, payload, tenantId)
      } else {
        const created = await adminApi.createPackage<ApiServicePackage>(payload, tenantId)
        if (created?.id) savedId = created.id
      }
      // Onam bağı paket DTO'sunda taşınmaz; şablon kaydının packageIds listesinde durur.
      if (savedId) await syncConsentLinks(savedId, draft.consentTemplateIds)
      setNotice(
        nextStatus === 'Active' ? 'Paket yayına alındı.'
          : nextStatus === 'Passive' ? 'Paket pasife alındı.'
            : 'Taslak kaydedildi.',
      )
      await reload()
      return savedId
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Kaydetme başarısız.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const cancelCatalogPackage = async (draft: PackageDraft, reason: string): Promise<void> => {
    if (!draft.id) return
    setBusy(true); setActionError(''); setNotice('')
    try {
      await adminApi.cancelPackage(draft.id, reason, tenantId)
      setNotice('Paket iptal edildi; artık satış listelerinde çıkmaz.')
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'İptal edilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const restoreCatalogPackage = async (draft: PackageDraft): Promise<void> => {
    if (!draft.id) return
    setBusy(true); setActionError(''); setNotice('')
    try {
      await adminApi.restorePackage(draft.id, tenantId)
      setNotice('İptal geri alındı; paket pasif durumda. Satışa açmak için “Yayına al”.')
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Geri alınamadı.')
    } finally {
      setBusy(false)
    }
  }

  const deletePackage = async (draft: PackageDraft): Promise<void> => {
    if (!draft.id) return
    if (!window.confirm(`“${draft.name || 'Paket'}” tanımı silinsin mi?`)) return
    setBusy(true); setActionError(''); setNotice('')
    try {
      await adminApi.deletePackage(draft.id, tenantId)
      setEditorOpen(false)
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  // Kategori EKLEME buradan yapılmaz — tek kaynak Kategoriler sayfasıdır (CategoryExplorer).
  const deleteCategory = async (id: string) => { await adminApi.deleteServiceCategory(id, tenantId); await reload() }
  const reorderCategory = async (orderedIds: string[]) => { await adminApi.reorderServiceCategories(orderedIds, tenantId); await reload() }

  /* ---- düzenleyici ------------------------------------------------------ */
  const draftFromPackage = (pkg: ServicePackage): PackageDraft => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    category: pkg.category,
    subCategory: pkg.subCategory,
    iconKey: pkg.iconKey,
    salePrice: pkg.totalPrice,
    priceTouched: true,
    deposit: pkg.depositAmount,
    depositTouched: true,
    installments: pkg.installmentCount,
    loyaltyPointCost: pkg.loyaltyPointCost || 0,
    status: pkg.status,
    cancellationReason: pkg.cancellationReason || '',
    consentTemplateIds: (data?.consents || [])
      .filter((template) => (template.packageIds || []).includes(pkg.id))
      .map((template) => template.id || '')
      .filter(Boolean),
    items: pkg.items.map((item) => {
      const service = serviceById.get(item.serviceDefinitionId)
      return {
        serviceDefinitionId: item.serviceDefinitionId,
        name: item.serviceName,
        iconKey: service?.iconKey || '',
        duration: service?.duration || 0,
        sessionCount: item.sessionCount,
        unitPrice: item.unitPrice,
      }
    }),
  })

  const openEditor = (draft: PackageDraft) => {
    setActionError(''); setNotice('')
    setEditorDraft(draft)
    setEditorOpen(true)
  }
  const openPackage = (pkg: ServicePackage) => {
    if (canBulkDelete && bulk.active) { bulk.toggle(pkg.id); return }
    openEditor(draftFromPackage(pkg))
  }

  return (
    <>
      <Topbar
        title="Paketler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Paket Yönetimi`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', 'Paketler']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageService && (
              <button type="button" onClick={() => openEditor(emptyPackageDraft())} className={catalogPrimaryBtn}>
                <PackagePlus className="h-3.5 w-3.5" /> Yeni Paket
              </button>
            )}
            <ExcelTransferActions<ServicePackage>
              featureKey="excel.services" moduleName="Paketler" context={`${institutionName || 'Kurum'} · ${branchLabel || ''}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} paket`,
                columns: [
                  { key: 'name', header: 'Paket Adı', width: 28, type: 'text', accessor: (p) => p.name },
                  { key: 'category', header: 'Kategori', width: 18, type: 'text', accessor: (p) => p.category || 'Kategorisiz' },
                  { key: 'sessions', header: 'Toplam Seans', width: 14, type: 'number', accessor: (p) => p.totalSessions },
                  { key: 'totalPrice', header: 'Satış Fiyatı', width: 16, type: 'currency', accessor: (p) => p.totalPrice },
                  { key: 'deposit', header: 'Peşinat', width: 14, type: 'currency', accessor: (p) => p.depositAmount },
                  { key: 'installments', header: 'Taksit', width: 10, type: 'number', accessor: (p) => p.installmentCount },
                  { key: 'status', header: 'Durum', width: 12, type: 'text', accessor: (p) => CATALOG_STATUS_LABEL[p.status] },
                  { key: 'items', header: 'İçerik', width: 50, type: 'text', accessor: (p) => p.items.map((i) => `${i.serviceName} (${i.sessionCount})`).join(' + ') },
                ],
                totals: { name: 'TOPLAM', totalPrice: filtered.reduce((total, p) => total + p.totalPrice, 0) },
              }}
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi: kolon adlarına
                bağlı değil (otomatik eşleme) ve mükerrer kaydı atlar. */}
            <button type="button" onClick={() => setImportOpen(true)} className={catalogGhostBtn}>
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      <PanelPage>
        <ApiStateNotice loading={loading} error={error} />
        <AnimatePresence initial={false}>
          {actionError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="rounded-[14px] border border-[#F0AFBF] bg-[#FCE7EC] px-4 py-2.5 text-[12px] font-medium text-[#A32347]"
            >
              {actionError}
            </motion.div>
          )}
        </AnimatePresence>

        <CatalogOverview
          icon={ShoppingBag}
          eyebrow="Paket kataloğu"
          total={packages.length}
          totalLabel="tanımlı paket"
          facts={overviewFacts}
          segmentTitle="Katalog durumu"
          segmentHint="Bir duruma dokunun, liste anında süzülsün."
          segmentAside={
            status === 'all' ? (
              <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1 text-[11px] font-semibold text-[#5A4B53]">
                {filtered.length} kayıt listeleniyor
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setStatus('all')}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#BE7690] bg-[#F6DFE6] px-2.5 py-1 text-[11px] font-semibold text-[#8C4460] transition-colors hover:bg-[#F2CFDC]"
              >
                <X className="h-3 w-3" />
                {status === 'customerCancel' ? 'Müşteri iptali' : CATALOG_STATUS_LABEL[status]} süzgecini kaldır
              </button>
            )
          }
        >
          <StatusSegments
            idPrefix="package-status"
            value={status}
            onChange={setStatus}
            options={[
              { key: 'all', label: 'Tümü', count: packages.length },
              { key: 'Active', label: 'Aktif', count: counts.Active },
              { key: 'Passive', label: 'Pasif', count: counts.Passive },
              { key: 'Draft', label: 'Taslak', count: counts.Draft },
              { key: 'Archived', label: 'Arşiv', count: counts.Archived },
              { key: 'Cancelled', label: 'İptal ettiğimiz', count: counts.Cancelled },
              { key: 'customerCancel', label: 'Müşteri iptali', count: packages.filter((p) => customerCancelledPackageIds.has(p.id)).length },
            ]}
          />
        </CatalogOverview>

        <CatalogToolbar>
          <CatalogSearch value={q} onChange={setQ} placeholder="Paket adı, kategori veya içindeki hizmet…" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sıralama" className={catalogFieldCls}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <option key={key} value={key}>{SORT_LABEL[key]}</option>
            ))}
          </select>
          <button type="button" onClick={() => setCategoryOpen(true)} className={catalogGhostBtn}>
            <FolderCog className="h-3.5 w-3.5" /> Kategoriler
          </button>
          <CatalogViewToggle idPrefix="package" value={view} onChange={setView} />
        </CatalogToolbar>

        <div className="rounded-[18px] border border-[#EAD8DF] bg-white px-3 pb-3 pt-1">
          <CatalogCategoryRail
            items={categorySettings}
            value={catFilter}
            sub={subFilter}
            onChange={(name, subName) => { setCatFilter(name); setSubFilter(subName) }}
            total={packages.length}
            itemLabel="paket"
          />
          <AnimatePresence initial={false}>
            {catFilter && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-2 pt-2.5">
                  <button type="button" onClick={() => setCategorySalesOpen(true)} className={catalogGhostBtn}>
                    <Wallet className="h-3.5 w-3.5" /> “{catFilter}” satışları
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCatFilter(''); setSubFilter('') }}
                    className="text-[11.5px] font-semibold text-[#74616A] underline-offset-2 transition-colors hover:text-[#A5556E] hover:underline"
                  >
                    Kategori süzgecini kaldır
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {loading && packages.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-[188px] animate-pulse rounded-[18px] border border-[#EAD8DF] bg-white" />
            ))}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="rounded-[20px] border border-[#EAD8DF] bg-white">
            <PanelEmpty
              icon={ShoppingBag}
              title={packages.length === 0 ? 'Henüz paket yok' : 'Süzgeçle eşleşen paket yok'}
              hint={
                packages.length === 0
                  ? 'Sağ üstteki “Yeni Paket” ile başlayın: hizmet havuzundan hizmet seçin, fiyat ve peşinat otomatik hesaplansın.'
                  : status === 'customerCancel'
                    ? 'Bu sekmede yalnızca müşteri satışı iptal edilen paketler listelenir.'
                    : 'Arama metnini veya durum/kategori süzgecini değiştirmeyi deneyin.'
              }
              action={
                packages.length === 0 && canManageService ? (
                  <button type="button" onClick={() => openEditor(emptyPackageDraft())} className={catalogPrimaryBtn}>
                    <PackagePlus className="h-3.5 w-3.5" /> İlk paketi oluştur
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <CatalogGrid view={view}>
              <AnimatePresence initial={false} mode="popLayout">
                {pageRows.map((pkg, index) => {
                  const iconKey = pkg.iconKey || suggestIcon(pkg.name || pkg.category)
                  const selected = bulk.isSelected(pkg.id)
                  const subtotal = pkg.items.reduce((total, item) => total + item.unitPrice * item.sessionCount, 0)
                  const discount = Math.max(0, subtotal - pkg.totalPrice)
                  return (
                    <CatalogCardShell
                      key={pkg.id}
                      index={index}
                      status={pkg.status}
                      selected={selected}
                      onClick={() => openPackage(pkg)}
                    >
                      {view === 'grid' ? (
                        <div className="flex w-full flex-col gap-3 p-4 pl-5">
                          <div className="flex items-start gap-3">
                            {canBulkDelete && <SelectBox checked={selected} onToggle={() => bulk.toggle(pkg.id)} />}
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#A5556E] text-white transition-transform duration-300 group-hover:scale-105">
                              <ServiceIcon iconKey={iconKey} className="h-[22px] w-[22px]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              {/* İki satıra izin verilir: dar ızgarada uzun paket adları tek satırda kesiliyordu. */}
                              <div className="line-clamp-2 text-[14px] font-semibold leading-tight text-[#2A2027]" title={pkg.name}>
                                {pkg.name}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <Chip title="Kategori">{pkg.category || 'Kategorisiz'}</Chip>
                                {pkg.subCategory && <Chip title="Alt kategori">{pkg.subCategory}</Chip>}
                              </div>
                            </div>
                            <StatusPill status={pkg.status} />
                          </div>

                          <div className="flex flex-wrap items-center gap-1">
                            {pkg.items.slice(0, 3).map((item) => (
                              <Chip key={item.serviceDefinitionId} title={`${item.serviceName} · ${item.sessionCount} seans`}>
                                {item.serviceName} ×{item.sessionCount}
                              </Chip>
                            ))}
                            {pkg.items.length > 3 && <Chip>+{pkg.items.length - 3} hizmet</Chip>}
                            {pkg.items.length === 0 && (
                              <span className="text-[11px] font-medium text-[#705a66]">Henüz hizmet eklenmemiş</span>
                            )}
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-[14px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
                            <CardMeta label="Seans" value={pkg.totalSessions} />
                            <CardMeta label="Satış" value={formatTL(pkg.totalPrice)} />
                            <CardMeta
                              label="Peşinat"
                              value={pkg.depositAmount > 0 ? formatTL(pkg.depositAmount) : '—'}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {discount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#8ED6B4] bg-[#DFF3EA] px-2 py-0.5 text-[10.5px] font-semibold text-[#15694A]">
                                <Tag aria-hidden className="h-3 w-3" />
                                Ara toplamdan {formatTL(discount)} indirimli
                              </span>
                            ) : (
                              <span className="text-[10.5px] font-medium text-[#74616A]">
                                {pkg.installmentCount > 0 ? `${pkg.installmentCount} ay taksit` : 'Taksitsiz'}
                              </span>
                            )}
                            {pkg.updatedAt && (
                              <span className="text-[10.5px] font-medium text-[#74616A]">{pkg.updatedAt}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3 pl-5">
                          {canBulkDelete && <SelectBox checked={selected} onToggle={() => bulk.toggle(pkg.id)} />}
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#A5556E] text-white">
                            <ServiceIcon iconKey={iconKey} className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-[150px] flex-1 truncate text-[13.5px] font-semibold text-[#2A2027]">{pkg.name}</span>
                          <span className="hidden min-w-[150px] flex-1 flex-wrap items-center gap-1 lg:flex">
                            {pkg.items.slice(0, 2).map((item) => (
                              <Chip key={item.serviceDefinitionId}>{item.serviceName} ×{item.sessionCount}</Chip>
                            ))}
                            {pkg.items.length > 2 && <Chip>+{pkg.items.length - 2}</Chip>}
                          </span>
                          <span className="w-[74px] shrink-0 text-[12.5px] font-medium tabular-nums text-[#5A4B53]">{pkg.totalSessions} seans</span>
                          <span className="w-[96px] shrink-0 text-right text-[13.5px] font-semibold tabular-nums text-[#2A2027]">{formatTL(pkg.totalPrice)}</span>
                          <StatusPill status={pkg.status} />
                        </div>
                      )}
                    </CatalogCardShell>
                  )
                })}
              </AnimatePresence>
            </CatalogGrid>

            <CatalogPager
              page={Math.min(page, totalPages)}
              pageSize={pageSize}
              total={filtered.length}
              onPage={setPage}
              onPageSize={setPageSize}
              itemLabel="paket"
            />
          </>
        )}

        {/* KAMPANYALAR — panodan `#kampanyalar` ile derin bağlantı verilir; hash ile
            gelindiğinde kendiliğinden açılır ve görünür alana kayar.
            Paketinde kampanya olmayan kurumda CampaignPanel zaten null döndüğü için
            başlığı da göstermiyoruz — açılınca boş kutu çıkmasın. */}
        {canCampaigns && (
        <section id="kampanyalar" className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white">
          <button
            type="button"
            onClick={() => setCampaignsOpen((open) => !open)}
            aria-expanded={campaignsOpen}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#FDF7F9]"
          >
            <span className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#A5556E] text-white">
                <Tag className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold tracking-tight text-[#2A2027]">Kampanyalar</span>
                <span className="block text-[11.5px] font-medium text-[#705a66]">
                  Paket ve hizmetlere dönemsel indirim tanımlayın.
                </span>
              </span>
            </span>
            <motion.span animate={{ rotate: campaignsOpen ? 180 : 0 }} transition={{ duration: 0.25 }}>
              <ChevronDown className="h-4 w-4 text-[#74616A]" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {campaignsOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-[#EAD8DF] p-4 sm:p-5">
                  <CampaignPanel tenantId={tenantId} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        )}
      </PanelPage>

      {/* ---------- PAKET DÜZENLEYİCİ ---------- */}
      <PackageEditorModal
        open={editorOpen}
        onOpenChange={(next) => { setEditorOpen(next); if (!next) { setActionError(''); setNotice(''); setHistoryOpen(false) } }}
        initialDraft={editorDraft}
        services={services}
        assignableCategories={assignableCategories}
        subCategoriesFor={subCategoriesFor}
        tenantId={tenantId}
        busy={busy}
        error={actionError}
        notice={notice}
        canManage={canManageService}
        canDelete={canBulkDelete}
        onSave={savePackage}
        onCancelPackage={cancelCatalogPackage}
        onRestorePackage={restoreCatalogPackage}
        onDelete={deletePackage}
        renderSellTrigger={(draft) =>
          draft.id ? (
            <PackageSaleDialog
              tenantId={tenantId}
              presetPackageId={draft.id}
              onDone={reload}
              triggerLabel="Bu paketi sat"
              triggerClassName={catalogGhostBtn}
            />
          ) : null
        }
        onAddHistoricalSale={canManageService ? () => setHistoryOpen(true) : undefined}
        renderSales={(draft) =>
          draft.id ? (
            <CatalogSalesPanel
              item={{ id: draft.id, name: draft.name || 'Paket', price: draft.salePrice || 0 }}
              kind="package"
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
              {...salesPanelProps}
            />
          ) : null
        }
      />

      {/* ---------- KATEGORİ AYARLARI ---------- */}
      <CatalogModal
        open={categoryOpen}
        onOpenChange={setCategoryOpen}
        icon={FolderCog}
        eyebrow="Katalog düzeni"
        title="Paket kategorileri"
        subtitle="Kategoriye göre süzün, sırasını değiştirin veya kaldırın. Yeni kategori Kategoriler sayfasından eklenir."
        width={1000}
        height={720}
      >
        <div className="p-4 sm:p-5">
          <CatalogCategoryManager
            title="Paket Kategori Ayarları"
            description="Kategori seçilince liste süzülür. Sıralama, kataloğun her yerindeki kategori sırasını belirler."
            itemLabel="paket"
            categories={topCategorySettings}
            selectedCategory={catFilter}
            canManage={canCustomServiceCat}
            onSelect={(name) => { setCatFilter(name); setSubFilter(''); setCategoryOpen(false) }}
            onDelete={deleteCategory}
            onReorder={canCustomServiceCat ? reorderCategory : undefined}
          />
        </div>
      </CatalogModal>

      {/* ---------- KATEGORİ SATIŞLARI ---------- */}
      <CatalogModal
        open={categorySalesOpen && !!catFilter}
        onOpenChange={setCategorySalesOpen}
        icon={Layers3}
        eyebrow="Kategori satışları"
        title={catFilter || 'Kategori'}
        subtitle="Bu kategorideki tüm satışlar — geçmiş yıllara ait kayıtlar dâhil."
        width={1180}
        height={880}
      >
        <div className="p-4 sm:p-5">
          {catFilter && (
            <CatalogSalesPanel item={{ id: catFilter, name: catFilter, price: 0 }} kind="category" {...salesPanelProps} />
          )}
        </div>
      </CatalogModal>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} entityType="package" onDone={() => void reload()} />

      {/* Toplu silme çubuğu — seçim yapılınca ekranın altında belirir. */}
      {canBulkDelete && (
        <BulkSelectBar
          api={bulk}
          itemLabel="paket"
          pageIds={pageRows.map((pkg) => pkg.id)}
          onDelete={(id) => adminApi.deletePackage(id, tenantId)}
          onDone={() => reload()}
        />
      )}
    </>
  )
}
