'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Clock3, FileUp, FolderCog, Layers3, PencilLine, Sparkles, Tag, Wallet, Wand2, X,
} from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { PanelEmpty, PanelPage } from '@/components/dashboard/PanelKit'
import BulkSelectBar, { SelectBox, useBulkSelect } from '@/components/dashboard/BulkSelectBar'
import { usePermission } from '@/hooks/usePermission'
import CatalogCategoryManager from '@/components/dashboard/CatalogCategoryManager'
import CatalogCategoryRail, { buildCatalogCategoryItems } from '@/components/dashboard/CatalogCategoryRail'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import CatalogSalesPanel from '@/components/dashboard/CatalogSalesPanel'
import ServiceDetailModal from '@/components/dashboard/ServiceDetailModal'
import ServiceFormDialog, { type ConsentTemplateOption, type ServiceFormDialogValues } from '@/components/dashboard/ServiceFormDialog'
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
import { apiItems, formatTL, normalizeCustomServiceCategory, normalizePackage, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type {
  ApiConsentTemplate, ApiCustomServiceCategory, ApiService, ApiServicePackage, ApiStaff,
  CatalogStatusKey, Service,
} from '@/lib/types'

/* ==========================================================================
 * HİZMET KATALOĞU
 *
 * Sayfa 2026 Ağustos'unda sıfırdan kuruldu. Eski hâlin iki sorunu vardı:
 *
 * 1. **Kalabalık.** Üç KPI kartı + beş durum sekmesi aynı sayıları söylüyordu;
 *    tablonun yanında sabit bir detay paneli, altında kategori satışları,
 *    kategori ayarları ve bir "hizmet özeti" bloğu vardı. Artık: tek genel
 *    bakış kartı (sayaçlar doğrudan süzgeç), tek araç çubuğu, kart/liste
 *    ızgarası — ağır olan her şey modale taşındı.
 *
 * 2. **Uydurma rakamlar.** "Kâr marjı" fiyatın en yüksek fiyata oranından,
 *    "hazırlık süresi" süre/6'dan, "müşteri memnuniyeti" iptal oranından
 *    üretiliyordu. "Toplam rezervasyon", "son 30 gün satış" ve "uygulayan
 *    uzman" ise yalnızca ilk 500 randevunun sayımıydı — kayıt sayısı bunu
 *    aşan kurumda yanlış. HEPSİ KALDIRILDI. Bu sayfa artık yalnızca kaydın
 *    kendi alanlarını gösterir; gerçek satış verisi, sunucuda o kayda göre
 *    süzülen satış panelinden (modal › Satışlar) gelir.
 * ========================================================================== */

type StatusFilter = 'all' | CatalogStatusKey
type SortKey = 'name' | 'price-desc' | 'price-asc' | 'duration-desc' | 'duration-asc'

const SORT_LABEL: Record<SortKey, string> = {
  name: 'Ada göre (A→Z)',
  'price-desc': 'Fiyat: yüksekten',
  'price-asc': 'Fiyat: düşükten',
  'duration-desc': 'Süre: uzundan',
  'duration-asc': 'Süre: kısadan',
}

/** Hizmet + gruplama/geri yazmada kullanılan HAM kategori adı. */
type LibService = Service & { rawCategory: string }

/** Ekranda gösterilen kategori adı — kategorisi olmayan hizmet "Kategorisiz" grubundadır
 *  (normalizeService'in uydurduğu "Genel Hizmet" adı gösterilmez; ray/sayaçlarla tutarlı). */
const catLabel = (service: LibService): string => service.rawCategory || 'Kategorisiz'

export default function ServiceLibrary({
  tenantId, branchId, institutionName, branchLabel, scopeLabel, scope, canCustomServiceCat,
}: {
  tenantId?: string
  branchId?: string | null
  institutionName?: string
  branchLabel?: string
  scopeLabel?: string
  /** Sidebar alt menüsünden gelen kapsam — "aktif/pasif hizmetler" gerçekten süzer. */
  scope?: string
  canCustomServiceCat: boolean
}) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  // Alt kategori süzgeci kategoriye BAĞLIDIR: kategori seçilince alt şeridi açılır, kategori
  // değişince alt seçim düşer.
  const [subFilter, setSubFilter] = useState('')
  const [durFilter, setDurFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<CatalogView>('grid')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categorySalesOpen, setCategorySalesOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  // Toplu seçim: karta tıklamak seçim modunda seçer, alt çubuktan topluca silinir.
  // Silme yetkisi olmayan personelde seçim hiç açılmaz.
  const { can } = usePermission()
  const canBulkDelete = can('Services.Delete')
  const canManageService = can('Services.Manage')
  const bulk = useBulkSelect()

  const { data, loading, error, reload } = useApiQuery<{
    services: ApiService[]
    staff: ApiStaff[]
    cats: ApiCustomServiceCategory[]
    packages: ApiServicePackage[]
    consents: ApiConsentTemplate[]
  }>(
    async () => {
      if (!tenantId) return { services: [], staff: [], cats: [], packages: [], consents: [] }
      const [services, staff, cats, packages, consents] = await Promise.all([
        // TÜM hizmetler (tek sayfa tavanına takılıp katalog eksik görünmesin).
        fetchAllPaged<ApiService>((p, size) => adminApi.services<ApiService>({ tenantId, page: p, pageSize: size })),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.consentTemplates<ApiConsentTemplate>(tenantId).catch(() => []),
      ])
      return {
        services,
        staff: apiItems(staff),
        cats: Array.isArray(cats) ? cats : [],
        packages: apiItems(packages),
        consents: Array.isArray(consents) ? consents : [],
      }
    },
    [tenantId],
    { initialData: { services: [], staff: [], cats: [], packages: [], consents: [] } },
  )

  // rawCategory = HAM kategori adı. normalizeService boş kategoriye "Genel Hizmet" uydurur;
  // geri yazan her yol (durum değiştirme, düzenleme formu) o uydurma adı gerçek kategori olarak
  // kaydeder ve hizmet sessizce var olmayan bir kategoriye taşınırdı.
  const services = useMemo<LibService[]>(
    () => (data?.services || []).map((s, i) => ({ ...normalizeService(s, i), rawCategory: (s?.category || s?.group || '').trim() })),
    [data],
  )
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const customCategories = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])

  /* ---- sidebar kapsamı gerçekten süzer -------------------------------- */
  // Eskiden "Aktif hizmetler" / "Pasif hizmetler" bağlantıları yalnızca kırıntı
  // yolunu değiştiriyor, liste "Tümü" olarak açılıyordu.
  useEffect(() => {
    setStatus(scope === 'active' ? 'Active' : scope === 'inactive' ? 'Passive' : 'all')
    setPage(1)
  }, [scope])

  /* ---- satış paneli ---------------------------------------------------- */
  const staffOptions = useMemo(() => staff.map((s) => ({ id: s.id, name: s.name })), [staff])
  // Kategori bilgisi de taşınır: geçmiş satış modalindeki aramalı seçici süzgeç pill'lerini bundan çıkarır.
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
  const categories = useMemo(
    () => buildCatalogCategoryItems(
      customCategories,
      services.map((s) => ({ category: s.rawCategory, subCategory: s.subGroup })),
    ),
    [services, customCategories],
  )
  /** Kategori ayarları kartı yalnız ÜST kategorileri yönetir (sıralama kardeşler arasında yapılır). */
  const topCategories = useMemo(() => categories.filter((c) => c.kind !== 'sub'), [categories])

  /* ---- süzgeç + sıralama ----------------------------------------------- */
  const filtered = useMemo(() => {
    let list = services
    if (status !== 'all') list = list.filter((s) => s.status === status)
    if (catFilter) list = list.filter((s) => catLabel(s) === catFilter)
    if (subFilter) list = list.filter((s) => (s.subGroup || '') === subFilter)
    if (durFilter) {
      const [lo, hi] = durFilter.split('-').map(Number)
      list = list.filter((s) => s.duration >= lo && (!hi || s.duration <= hi))
    }
    if (q.trim()) {
      const needle = q.trim().toLocaleLowerCase('tr')
      list = list.filter((s) =>
        s.name.toLocaleLowerCase('tr').includes(needle) ||
        catLabel(s).toLocaleLowerCase('tr').includes(needle) ||
        (s.subGroup || '').toLocaleLowerCase('tr').includes(needle))
    }
    const sorted = [...list]
    if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price)
    else if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price)
    else if (sort === 'duration-desc') sorted.sort((a, b) => b.duration - a.duration)
    else if (sort === 'duration-asc') sorted.sort((a, b) => a.duration - b.duration)
    else sorted.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    return sorted
  }, [services, status, catFilter, subFilter, durFilter, q, sort])

  useEffect(() => { setPage(1) }, [status, catFilter, subFilter, durFilter, q, sort, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = useMemo(
    () => filtered.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize),
    [filtered, page, pageSize, totalPages],
  )

  /* ---- genel bakış (yalnız katalog gerçekleri) -------------------------- */
  const counts = useMemo(() => {
    const map: Record<CatalogStatusKey, number> = { Active: 0, Passive: 0, Draft: 0, Archived: 0, Cancelled: 0 }
    for (const service of services) map[service.status]++
    return map
  }, [services])

  const overviewFacts = useMemo(() => {
    if (services.length === 0) return [{ label: 'Kategori', value: '0' }]
    const durations = services.map((s) => s.duration).filter((d) => d > 0)
    const prices = services.map((s) => s.price).filter((p) => p > 0)
    const facts: { label: string; value: string }[] = [
      { label: 'Kategori', value: String(topCategories.length) },
    ]
    if (durations.length) {
      const min = Math.min(...durations)
      const max = Math.max(...durations)
      facts.push({ label: 'Süre', value: min === max ? `${min} dk` : `${min}–${max} dk` })
    }
    if (prices.length) {
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      facts.push({ label: 'Fiyat', value: min === max ? formatTL(min) : `${formatTL(min)} – ${formatTL(max)}` })
    }
    return facts
  }, [services, topCategories])

  /* ---- yazma yolları ---------------------------------------------------- */
  const buildPayload = (service: LibService, over: Record<string, unknown>) => ({
    branchId: service.branchId || branchId || null,
    name: service.name,
    // HAM kategori: `service.group` payload'a ASLA girmez (uydurma "Genel Hizmet" yazardı).
    category: service.rawCategory || null,
    subCategory: service.subGroup || null,
    durationMinutes: service.duration,
    price: service.price,
    isActive: service.status === 'Active',
    iconKey: service.iconKey || suggestIcon(service.name || service.rawCategory) || null,
    status: service.status,
    defaultSessionCount: service.session || 1,
    loyaltyPointCost: service.loyaltyPointCost || null,
    ...over,
  })

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError('')
    try { await fn(); await reload() } catch (e) { setActionError(e instanceof Error ? e.message : 'İşlem başarısız') } finally { setBusy(false) }
  }
  const setServiceStatus = (service: LibService, next: CatalogStatusKey) =>
    run(() => adminApi.updateService(service.id, buildPayload(service, { status: next, isActive: next === 'Active' }), tenantId))

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
    for (const service of data?.services || []) {
      const cat = (service?.category || '').trim()
      const sub = (service?.subCategory || '').trim()
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
  const consentTitlesOf = (serviceId: string): string[] =>
    (data?.consents || []).filter((t) => (t.serviceIds || []).includes(serviceId)).map((t) => t.title || 'Onam formu')

  /** Seçim ↔ şablon bağını eşitler; yalnız DEĞİŞEN şablonlar güncellenir. */
  const syncConsentLinks = async (serviceId: string, selected: string[]): Promise<void> => {
    for (const template of data?.consents || []) {
      if (!template.id) continue
      const linked = (template.serviceIds || []).includes(serviceId)
      const wanted = selected.includes(template.id)
      if (linked === wanted) continue
      const nextIds = wanted
        ? [...(template.serviceIds || []), serviceId]
        : (template.serviceIds || []).filter((x) => x !== serviceId)
      await adminApi.updateConsentTemplate(template.id, {
        title: template.title, body: template.body, checkItems: template.checkItems || [],
        requiresSignature: template.requiresSignature !== false, isActive: template.isActive !== false,
        serviceIds: nextIds,
      }, tenantId)
    }
  }

  const onCreate = async (values: ServiceFormDialogValues) => {
    const created = await adminApi.createService<{ id?: string }>({
      branchId: branchId || null, name: values.name, category: values.category || null,
      subCategory: values.subCategory || null, durationMinutes: values.durationMinutes, price: values.price,
      isActive: values.status === 'Active', iconKey: values.iconKey || null, status: values.status,
      defaultSessionCount: values.defaultSessionCount || 1, loyaltyPointCost: values.loyaltyPointCost || null,
    }, tenantId)
    if (created?.id && values.consentTemplateIds.length > 0) await syncConsentLinks(created.id, values.consentTemplateIds)
    await reload()
  }

  const handleDeleteCat = async (id: string) => { await adminApi.deleteServiceCategory(id, tenantId); await reload() }
  /** Form içinden "Diğer → yeni kategori": Kategoriler sayfasına gitmeden kategori açılır. */
  const handleCreateCat = async (name: string) => { await adminApi.createServiceCategory({ name, isActive: true }, tenantId); await reload() }
  const canManageCat = canCustomServiceCat && canManageService
  const handleReorderCat = async (orderedIds: string[]) => { await adminApi.reorderServiceCategories(orderedIds, tenantId); await reload() }

  const editInitial = (service: LibService): Partial<ServiceFormDialogValues> => ({
    name: service.name, category: service.rawCategory || null, subCategory: service.subGroup || null,
    durationMinutes: service.duration, price: service.price, defaultSessionCount: service.session || 1,
    loyaltyPointCost: service.loyaltyPointCost || 0, isActive: service.status === 'Active',
    iconKey: service.iconKey || '', status: service.status, consentTemplateIds: consentIdsOf(service.id),
  })

  const detail = useMemo(() => services.find((s) => s.id === detailId) || null, [services, detailId])

  const openDetail = (service: LibService) => {
    if (canBulkDelete && bulk.active) { bulk.toggle(service.id); return }
    setDetailId(service.id)
    setDetailOpen(true)
  }

  const commonFormProps = {
    customCategories,
    onDeleteCustomCategory: canCustomServiceCat ? handleDeleteCat : undefined,
    onCreateCustomCategory: canManageCat ? handleCreateCat : undefined,
    knownCategories: usedCategories,
    knownSubCategories: usedSubCategories,
    consentTemplates,
    consentTenantId: tenantId,
  }

  return (
    <>
      <Topbar
        title="Hizmetler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Hizmet Yönetimi`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', scopeLabel || 'Hizmet Havuzu']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageService && (
              <ServiceFormDialog
                {...commonFormProps}
                onSubmit={onCreate}
                trigger={
                  <button type="button" className={catalogPrimaryBtn}>
                    <Wand2 className="h-3.5 w-3.5" /> Yeni Hizmet
                  </button>
                }
              />
            )}
            <ExcelTransferActions<LibService>
              featureKey="excel.services" moduleName="Hizmetler" context={`${institutionName || 'Kurum'} · ${branchLabel || ''}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} hizmet`,
                columns: [
                  { key: 'name', header: 'Hizmet Adı', width: 30, type: 'text', accessor: (s) => s.name },
                  { key: 'group', header: 'Kategori', width: 20, type: 'text', accessor: (s) => catLabel(s) },
                  { key: 'sub', header: 'Alt Kategori', width: 18, type: 'text', accessor: (s) => s.subGroup || '' },
                  { key: 'duration', header: 'Süre (dk)', width: 12, type: 'number', accessor: (s) => s.duration },
                  { key: 'price', header: 'Fiyat', width: 16, type: 'currency', accessor: (s) => s.price },
                  { key: 'status', header: 'Durum', width: 12, type: 'text', accessor: (s) => CATALOG_STATUS_LABEL[s.status] },
                ],
                totals: { name: 'TOPLAM', price: filtered.reduce((total, s) => total + s.price, 0) },
              }}
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi: kolon adlarına
                bağlı değil (otomatik eşleme), mükerrer kaydı atlar ve tek istekte parti
                hâlinde gönderir. */}
            <button type="button" onClick={() => setImportOpen(true)} className={catalogGhostBtn}>
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      <PanelPage>
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && services.length === 0} emptyMessage="Hizmet kaydı yok." />
        {actionError && (
          <div className="rounded-[14px] border border-[#F0AFBF] bg-[#FCE7EC] px-4 py-2.5 text-[12px] font-medium text-[#A32347]">
            {actionError}
          </div>
        )}

        <CatalogOverview
          icon={Sparkles}
          eyebrow="Hizmet kataloğu"
          total={services.length}
          totalLabel="tanımlı hizmet"
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
                <X className="h-3 w-3" /> {CATALOG_STATUS_LABEL[status]} süzgecini kaldır
              </button>
            )
          }
        >
          <StatusSegments
            idPrefix="service-status"
            value={status}
            onChange={setStatus}
            options={[
              { key: 'all', label: 'Tümü', count: services.length },
              { key: 'Active', label: 'Aktif', count: counts.Active },
              { key: 'Passive', label: 'Pasif', count: counts.Passive },
              { key: 'Draft', label: 'Taslak', count: counts.Draft },
              { key: 'Archived', label: 'Arşiv', count: counts.Archived },
            ]}
          />
        </CatalogOverview>

        <CatalogToolbar>
          <CatalogSearch value={q} onChange={setQ} placeholder="Hizmet, kategori veya alt kategori ara…" />
          <select value={durFilter} onChange={(e) => setDurFilter(e.target.value)} aria-label="Süreye göre süz" className={catalogFieldCls}>
            <option value="">Tüm süreler</option>
            <option value="0-30">≤ 30 dk</option>
            <option value="31-60">31–60 dk</option>
            <option value="61-999">60 dk üzeri</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sıralama" className={catalogFieldCls}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <option key={key} value={key}>{SORT_LABEL[key]}</option>
            ))}
          </select>
          <button type="button" onClick={() => setCategoryOpen(true)} className={catalogGhostBtn}>
            <FolderCog className="h-3.5 w-3.5" /> Kategoriler
          </button>
          <CatalogViewToggle idPrefix="service" value={view} onChange={setView} />
        </CatalogToolbar>

        {/* Kategori rayı — durum sayaçlarıyla karışmasın diye kenarlıksız ve pay barlı. */}
        <div className="rounded-[18px] border border-[#EAD8DF] bg-white px-3 pb-3 pt-1">
          <CatalogCategoryRail
            items={categories}
            value={catFilter}
            sub={subFilter}
            onChange={(name, subName) => { setCatFilter(name); setSubFilter(subName) }}
            total={services.length}
            itemLabel="hizmet"
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

        {loading && services.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-[164px] animate-pulse rounded-[18px] border border-[#EAD8DF] bg-white" />
            ))}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="rounded-[20px] border border-[#EAD8DF] bg-white">
            <PanelEmpty
              icon={Layers3}
              title={services.length === 0 ? 'Henüz hizmet tanımlanmamış' : 'Süzgeçle eşleşen hizmet yok'}
              hint={
                services.length === 0
                  ? 'Sağ üstteki “Yeni Hizmet” ile ilk hizmetinizi tanımlayın; paketler bu havuzdan beslenir.'
                  : 'Arama metnini veya durum/kategori süzgecini değiştirmeyi deneyin.'
              }
            />
          </div>
        ) : (
          <>
            <CatalogGrid view={view}>
              <AnimatePresence initial={false} mode="popLayout">
                {pageRows.map((service, index) => {
                  const iconKey = service.iconKey || suggestIcon(service.name || service.rawCategory)
                  const selected = bulk.isSelected(service.id)
                  return (
                    <CatalogCardShell
                      key={service.id}
                      index={index}
                      status={service.status}
                      selected={selected}
                      onClick={() => openDetail(service)}
                    >
                      {view === 'grid' ? (
                        <div className="flex w-full flex-col gap-3 p-4 pl-5">
                          <div className="flex items-start gap-3">
                            {canBulkDelete && <SelectBox checked={selected} onToggle={() => bulk.toggle(service.id)} />}
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#A5556E] text-white transition-transform duration-300 group-hover:scale-105">
                              <ServiceIcon iconKey={iconKey} className="h-[22px] w-[22px]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              {/* İki satıra izin verilir: dar ızgarada tek satır "Buz Lazer Epil…" gibi
                                  kesiliyor ve kartın ne olduğu okunmuyordu. */}
                              <div className="line-clamp-2 text-[14px] font-semibold leading-tight text-[#2A2027]" title={service.name}>
                                {service.name}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <Chip title="Kategori">{catLabel(service)}</Chip>
                                {service.subGroup && <Chip title="Alt kategori">{service.subGroup}</Chip>}
                              </div>
                            </div>
                            <StatusPill status={service.status} />
                          </div>
                          <div className="grid grid-cols-3 gap-2 rounded-[14px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
                            <CardMeta label="Süre" value={`${service.duration} dk`} />
                            <CardMeta label="Fiyat" value={formatTL(service.price)} />
                            <CardMeta label="Seans" value={service.session === 1 ? 'Tek' : `${service.session}×`} />
                          </div>
                          {service.loyaltyPointCost > 0 && (
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#8A5A11]">
                              <Tag aria-hidden className="h-3.5 w-3.5" />
                              Sadakat puanıyla hediye edilebilir · {service.loyaltyPointCost} P
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3 pl-5">
                          {canBulkDelete && <SelectBox checked={selected} onToggle={() => bulk.toggle(service.id)} />}
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#A5556E] text-white">
                            <ServiceIcon iconKey={iconKey} className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-[160px] flex-1 truncate text-[13.5px] font-semibold text-[#2A2027]">{service.name}</span>
                          <Chip title="Kategori">{catLabel(service)}</Chip>
                          <span className="w-[70px] shrink-0 text-[12.5px] font-medium tabular-nums text-[#5A4B53]">{service.duration} dk</span>
                          <span className="w-[96px] shrink-0 text-right text-[13.5px] font-semibold tabular-nums text-[#2A2027]">{formatTL(service.price)}</span>
                          <StatusPill status={service.status} />
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
              itemLabel="hizmet"
            />
          </>
        )}
      </PanelPage>

      {/* ---------- DETAY MODALİ ---------- */}
      <ServiceDetailModal
        open={detailOpen && !!detail}
        onOpenChange={(next) => { setDetailOpen(next); if (!next) setDetailId(null) }}
        service={
          detail
            ? {
                id: detail.id, name: detail.name, rawCategory: detail.rawCategory, subGroup: detail.subGroup,
                duration: detail.duration, price: detail.price, session: detail.session,
                loyaltyPointCost: detail.loyaltyPointCost, status: detail.status, iconKey: detail.iconKey,
              }
            : null
        }
        staff={staff}
        packages={packages}
        consentTitles={detail ? consentTitlesOf(detail.id) : []}
        busy={busy}
        canManage={canManageService}
        canDelete={canBulkDelete}
        onStatus={(next) => { if (detail) void setServiceStatus(detail, next) }}
        onDelete={() => {
          if (!detail) return
          if (!window.confirm(`“${detail.name}” hizmeti silinsin mi?`)) return
          void run(async () => {
            await adminApi.deleteService(detail.id, tenantId)
            setDetailOpen(false); setDetailId(null)
          })
        }}
        renderSellTrigger={() =>
          detail ? (
            <PackageSaleDialog
              tenantId={tenantId}
              presetService={{ id: detail.id, name: detail.name, price: detail.price }}
              onDone={reload}
              triggerLabel="Bu hizmeti sat"
              triggerClassName={catalogGhostBtn}
            />
          ) : null
        }
        renderEditTrigger={() =>
          detail ? (
            <ServiceFormDialog
              key={detail.id}
              mode="edit"
              {...commonFormProps}
              title={`${detail.name} · düzenle`}
              submitLabel="Hizmeti güncelle"
              initialValues={editInitial(detail)}
              onSubmit={async (values) => {
                await adminApi.updateService(detail.id, {
                  branchId: detail.branchId || branchId || null, name: values.name,
                  category: values.category || null, subCategory: values.subCategory || null,
                  durationMinutes: values.durationMinutes, price: values.price,
                  isActive: values.status === 'Active', iconKey: values.iconKey || null, status: values.status,
                  defaultSessionCount: values.defaultSessionCount || 1, loyaltyPointCost: values.loyaltyPointCost || null,
                }, tenantId)
                await syncConsentLinks(detail.id, values.consentTemplateIds)
                await reload()
              }}
              trigger={
                <button type="button" className={catalogPrimaryBtn}>
                  <PencilLine className="h-3.5 w-3.5" /> Düzenle
                </button>
              }
            />
          ) : null
        }
        renderSales={() =>
          detail ? (
            <CatalogSalesPanel
              item={{ id: detail.id, name: detail.name, price: detail.price }}
              kind="service"
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
        title="Hizmet kategorileri"
        subtitle="Kategoriye göre süzün, sırasını değiştirin veya kaldırın. Yeni kategori Kategoriler sayfasından eklenir."
        width={1000}
        height={720}
      >
        <div className="p-4 sm:p-5">
          <CatalogCategoryManager
            title="Hizmet Kategori Ayarları"
            description="Kategori seçilince liste süzülür. Sıralama, kataloğun her yerindeki kategori sırasını belirler."
            itemLabel="hizmet"
            categories={topCategories}
            selectedCategory={catFilter}
            canManage={canCustomServiceCat}
            onSelect={(name) => { setCatFilter(name); setSubFilter(''); setCategoryOpen(false) }}
            onDelete={handleDeleteCat}
            onReorder={canCustomServiceCat ? handleReorderCat : undefined}
          />
        </div>
      </CatalogModal>

      {/* ---------- KATEGORİ SATIŞLARI ---------- */}
      {/* Kategorideki TÜM satışlar: hangi müşteri ne almış, kim satmış, iptal edildiyse gerekçesi. */}
      <CatalogModal
        open={categorySalesOpen && !!catFilter}
        onOpenChange={setCategorySalesOpen}
        icon={Clock3}
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

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} entityType="service" onDone={() => void reload()} />

      {/* Toplu silme çubuğu — seçim yapılınca ekranın altında belirir. */}
      {canBulkDelete && (
        <BulkSelectBar
          api={bulk}
          itemLabel="hizmet"
          pageIds={pageRows.map((service) => service.id)}
          onDelete={(id) => adminApi.deleteService(id, tenantId)}
          onDone={() => reload()}
        />
      )}
    </>
  )
}
