'use client'

/**
 * RAPORLAR
 *
 * Tek sayfada 8 sekme: Genel Bakış · Paketler · Hizmetler · Personel · Şubeler · Müşteriler ·
 * Stok & Ürün · Hediye Çeki.
 *
 * Ortak filtre çubuğu tüm sekmeleri sürükler:
 *   • Dönem  : günlük / haftalık / aylık / yıllık / özel tarih aralığı (ör. 1 Tem – 2 Eyl)
 *   • Kıyas  : önceki dönem, geçen yıl, 2 yıl önce ya da tamamen özel bir aralık
 * Her metrik dönem değeriyle birlikte kıyas değerini de taşır; kartlarda yüzde farkı rozeti çıkar.
 *
 * Veri, sekme başına ayrı uçtan gelir (`/api/admin/reports/*`) ve yalnızca aktif sekme için
 * çekilir — sayfa açılışında altı sorgu birden atılmaz.
 */

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Boxes,
  Building2,
  Download,
  FileSpreadsheet,
  FileText,
  Gift,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Sparkles,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature, useFeatureContext } from '@/components/dashboard/FeatureContext'
import ReportFilterBar, { type ReportFilterState } from '@/components/reports/ReportFilterBar'
import { MetricDetailProvider } from '@/components/reports/MetricDetailContext'
import CompareTab, { defaultCompareSlots, type CompareSlot } from '@/components/reports/tabs/CompareTab'
import OverviewTab from '@/components/reports/tabs/OverviewTab'
import CatalogTab from '@/components/reports/tabs/CatalogTab'
import StaffTab from '@/components/reports/tabs/StaffTab'
import BranchesTab from '@/components/reports/tabs/BranchesTab'
import CustomersTab from '@/components/reports/tabs/CustomersTab'
import InventoryTab from '@/components/reports/tabs/InventoryTab'
import GiftCardsTab from '@/components/reports/tabs/GiftCardsTab'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { guidOrUndefined } from '@/lib/apiMappers'
import { exportToExcel } from '@/lib/excel'
import { generateReportPdf } from '@/lib/reportPdf'
import { buildExcelSheets, buildPdfSections, buildPdfStats, type ExportContext, type ReportTabKey } from '@/lib/reportExports'
import {
  resolveCompare,
  resolvePeriod,
  suggestGranularity,
  type CompareMode,
  type DateRange,
  type PeriodPreset,
} from '@/lib/reportRanges'
import type {
  BranchReport,
  CatalogReport,
  CompareReport,
  CustomerReport,
  InventoryReport,
  ReportSummary,
  StaffReport,
} from '@/lib/reportTypes'
import type { FeatureKey } from '@/lib/types'

// ---------------------------------------------------------------------------
// Sekme tanımları
// ---------------------------------------------------------------------------

interface TabMeta {
  label: string
  icon: LucideIcon
  feature: FeatureKey
  /** Sekmenin ihtiyaç duyduğu uç. */
  source: 'summary' | 'compare' | 'catalog' | 'staff' | 'branches' | 'customers' | 'inventory'
}

const tabs: Record<ReportTabKey, TabMeta> = {
  overview: { label: 'Genel Bakış', icon: BarChart3, feature: 'reports.finance', source: 'summary' },
  compare: { label: 'Karşılaştırma', icon: GitCompareArrows, feature: 'reports.finance', source: 'compare' },
  packages: { label: 'Paketler', icon: Boxes, feature: 'reports.services', source: 'catalog' },
  services: { label: 'Hizmetler', icon: Sparkles, feature: 'reports.services', source: 'catalog' },
  staff: { label: 'Personel', icon: UserCog, feature: 'reports.staff', source: 'staff' },
  branches: { label: 'Şubeler', icon: Building2, feature: 'reports.finance', source: 'branches' },
  customers: { label: 'Müşteriler', icon: Users, feature: 'reports.customer', source: 'customers' },
  inventory: { label: 'Stok & Ürün', icon: Warehouse, feature: 'reports.finance', source: 'inventory' },
  giftcards: { label: 'Hediye Çeki', icon: Gift, feature: 'reports.finance', source: 'inventory' },
}

const tabOrder: ReportTabKey[] = ['overview', 'compare', 'packages', 'services', 'staff', 'branches', 'customers', 'inventory', 'giftcards']

/** Eski `?scope=` bağlantıları çalışmaya devam etsin. */
const legacyScopeMap: Record<string, ReportTabKey> = {
  finance: 'overview',
  customer: 'customers',
  staff: 'staff',
  services: 'services',
}

// ---------------------------------------------------------------------------

function RaporlarPageInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'
  const routeBase = isStaffUser ? '/personel/raporlar' : '/admin/raporlar'

  const featureCtx = useFeatureContext()
  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)

  // --- sekme -----------------------------------------------------------------
  const raw = search?.get('tab') ?? search?.get('scope') ?? ''
  const requested = (raw in tabs ? raw : legacyScopeMap[raw]) as ReportTabKey | undefined
  const allowed = tabOrder.filter((k) => featureCtx.has(tabs[k].feature))
  const tab: ReportTabKey = requested && allowed.includes(requested) ? requested : (allowed[0] ?? 'overview')
  const meta = tabs[tab]

  const goTab = (key: ReportTabKey): void => router.push(`${routeBase}?tab=${key}`)

  // --- dönem -----------------------------------------------------------------
  const today = new Date()
  const [filters, setFilters] = useState<ReportFilterState>(() => ({
    preset: 'monthly' as PeriodPreset,
    offset: 0,
    custom: {
      from: new Date(today.getFullYear(), today.getMonth(), 1),
      to: new Date(today.getFullYear(), today.getMonth() + 1, 1),
    } as DateRange,
    compareMode: 'previous' as CompareMode,
    compareCustom: {
      from: new Date(today.getFullYear() - 1, today.getMonth(), 1),
      to: new Date(today.getFullYear() - 1, today.getMonth() + 1, 1),
    } as DateRange,
  }))

  const range = useMemo(
    () => resolvePeriod(filters.preset, filters.offset, filters.custom),
    [filters.preset, filters.offset, filters.custom],
  )
  const compare = useMemo(
    () => resolveCompare(filters.compareMode, range, filters.preset, filters.offset, filters.compareCustom),
    [filters.compareMode, filters.preset, filters.offset, filters.compareCustom, range],
  )

  // --- Karşılaştırma sekmesi kendi dönemlerini taşır (üst filtre çubuğuna bağlı değildir) ---
  const [compareSlots, setCompareSlots] = useState<CompareSlot[]>(defaultCompareSlots)
  const comparePeriods = useMemo(
    () => compareSlots.map((s) => `${s.range.from.toISOString()}~${s.range.to.toISOString()}~${s.label}`),
    [compareSlots],
  )
  // Kova genişliği TEMEL dönemden türetilir; tüm dönemler aynı kovayı kullanır ki eğriler binişsin.
  const compareGranularity = useMemo(
    () => (compareSlots[0] ? suggestGranularity(compareSlots[0].range) : 'month'),
    [compareSlots],
  )

  const granularity = suggestGranularity(range)
  const query = useMemo(
    () => ({
      tenantId,
      fromUtc: range.from.toISOString(),
      toUtc: range.to.toISOString(),
      compareFromUtc: compare?.from.toISOString(),
      compareToUtc: compare?.to.toISOString(),
      granularity,
    }),
    [tenantId, range.from, range.to, compare, granularity],
  )
  const queryKey = JSON.stringify(query)

  // --- veri (yalnız aktif sekmenin ucu çağrılır) ------------------------------
  // DİKKAT: `enabled` bayrağı bağımlılık listesine de girmeli. useApiQuery'nin effect'i
  // yalnız deps'e bakar; bayrak false→true olduğunda deps değişmezse sekme boş kalırdı.
  const on = (source: TabMeta['source']): boolean => meta.source === source
  const summaryQ = useApiQuery<ReportSummary>(
    () => adminApi.reportSummary<ReportSummary>(query),
    [queryKey, on('summary')],
    { initialData: null, enabled: on('summary') },
  )
  const catalogQ = useApiQuery<CatalogReport>(
    () => adminApi.reportCatalog<CatalogReport>(query),
    [queryKey, on('catalog')],
    { initialData: null, enabled: on('catalog') },
  )
  const staffQ = useApiQuery<StaffReport>(
    () => adminApi.reportStaff<StaffReport>(query),
    [queryKey, on('staff')],
    { initialData: null, enabled: on('staff') },
  )
  const branchesQ = useApiQuery<BranchReport>(
    () => adminApi.reportBranches<BranchReport>(query),
    [queryKey, on('branches')],
    { initialData: null, enabled: on('branches') },
  )
  const customersQ = useApiQuery<CustomerReport>(
    () => adminApi.reportCustomers<CustomerReport>(query),
    [queryKey, on('customers')],
    { initialData: null, enabled: on('customers') },
  )
  const inventoryQ = useApiQuery<InventoryReport>(
    () => adminApi.reportInventory<InventoryReport>(query),
    [queryKey, on('inventory')],
    { initialData: null, enabled: on('inventory') },
  )
  const compareQ = useApiQuery<CompareReport>(
    () => adminApi.reportCompare<CompareReport>(comparePeriods, { tenantId, granularity: compareGranularity }),
    [tenantId, comparePeriods.join('|'), compareGranularity, on('compare')],
    { initialData: null, enabled: on('compare') },
  )

  const active = {
    summary: summaryQ,
    compare: compareQ,
    catalog: catalogQ,
    staff: staffQ,
    branches: branchesQ,
    customers: customersQ,
    inventory: inventoryQ,
  }[meta.source]

  // --- çıktı -----------------------------------------------------------------
  const canExportExcel = useFeature('excel.reports')
  const canExportPdf = useFeature('pdf.reports')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const [exportError, setExportError] = useState('')

  const exportContext = (): ExportContext => ({
    tab,
    // Karşılaştırma sekmesi kendi dönemlerini taşır; başlıkta onlar yazar.
    rangeLabel: tab === 'compare' ? compareSlots.map((s) => s.label).join(' ↔ ') : range.label,
    compareLabel: tab === 'compare' ? undefined : compare?.label,
    compareReport: compareQ.data,
    summary: summaryQ.data,
    catalog: catalogQ.data,
    staff: staffQ.data,
    branches: branchesQ.data,
    customers: customersQ.data,
    inventory: inventoryQ.data,
  })

  const contextLine = `${selectedInstitution?.name || 'Kurum'} · ${
    tab === 'branches' ? 'Tüm şubeler' : selectedBranch?.name || 'Tüm şubeler'
  } · ${meta.label}`

  const handleExcel = async (): Promise<void> => {
    setExporting('excel')
    setExportError('')
    try {
      if (!(await featureCtx.revalidateHas('excel.reports'))) {
        setExportError('Bu özellik mevcut paketinizde bulunmuyor. Kullanmak için paketinizi yükseltin.')
        return
      }
      const sheets = buildExcelSheets(exportContext())
      if (sheets.length === 0) {
        setExportError('Bu sekmede dışa aktarılacak veri yok.')
        return
      }
      await exportToExcel<unknown>(sheets, {
        filenameBase: `${tab}-raporu`,
        title: `${meta.label} Raporu`,
        context: `${contextLine} · ${range.label}${compare ? ` · kıyas: ${compare.label}` : ''}`,
      })
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Excel oluşturulamadı.')
    } finally {
      setExporting(null)
    }
  }

  const handlePdf = async (): Promise<void> => {
    setExporting('pdf')
    setExportError('')
    try {
      if (!(await featureCtx.revalidateHas('pdf.reports'))) {
        setExportError('Bu özellik mevcut paketinizde bulunmuyor. Kullanmak için paketinizi yükseltin.')
        return
      }
      const ctx = exportContext()
      const sections = buildPdfSections(ctx)
      if (sections.length === 0) {
        setExportError('Bu sekmede dışa aktarılacak veri yok.')
        return
      }
      generateReportPdf({
        filenameBase: `${tab}-raporu`,
        title: `${meta.label} Raporu`,
        context: contextLine,
        periodLabel: compare ? `${range.label}  ·  kıyas: ${compare.label}` : range.label,
        stats: buildPdfStats(ctx),
        sections,
      })
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'PDF oluşturulamadı.')
    } finally {
      setExporting(null)
    }
  }

  // Yenile + Excel + PDF; hem filtre çubuğunda hem karşılaştırma şeridinde aynı düğmeler.
  const exportButtons = (
    <>
      <button
        type="button"
        onClick={() => void active.reload()}
        disabled={active.loading}
        title="Yenile"
        className="grid h-8 w-8 place-items-center rounded-full border border-[#efe1e7] bg-white text-[#705a66] transition-colors hover:border-[#e7bccb] hover:text-[#c05277] disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${active.loading ? 'animate-spin' : ''}`} strokeWidth={1.9} />
      </button>
      {canExportExcel && (
        <button
          type="button"
          onClick={handleExcel}
          disabled={exporting !== null || active.loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#cfe8dd] bg-[#f2fbf7] px-3 py-1.5 text-[11.5px] font-semibold text-[#20705a] transition-colors hover:border-[#8fd0b6] disabled:opacity-60"
        >
          {exporting === 'excel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.8} />}
          Excel
        </button>
      )}
      {canExportPdf && (
        <button
          type="button"
          onClick={handlePdf}
          disabled={exporting !== null || active.loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[linear-gradient(90deg,#fff4f8,#ffd3df)] px-3 py-1.5 text-[11.5px] font-semibold text-[#8e3f5b] transition-colors hover:border-[#e78ba8] disabled:opacity-60"
        >
          {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
          PDF
          <Download className="h-3 w-3 opacity-70" strokeWidth={1.8} />
        </button>
      )}
    </>
  )

  // --- render ----------------------------------------------------------------
  return (
    <>
      <Topbar
        title={isStaffUser ? 'Raporlarım' : 'Raporlar'}
        subtitle={`${contextLine}${isStaffUser ? ' · personel görünümü' : ''}`}
        breadcrumbs={isStaffUser ? ['Personel', 'Finans', 'Raporlarım', meta.label] : ['Admin', 'Finans', 'Raporlar', meta.label]}
      />

      <div className="relative space-y-4 p-4 sm:p-6 lg:p-8">
        {/* SEKMELER */}
        <motion.nav
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap gap-1 border-b border-[#ead8df]"
        >
          {allowed.map((key) => {
            const t = tabs[key]
            const Icon = t.icon
            const isActive = key === tab
            return (
              <button
                key={key}
                type="button"
                onClick={() => goTab(key)}
                className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[11.5px] font-semibold transition-colors sm:px-4 ${
                  isActive ? 'text-[#c05277]' : 'text-[#705a66] hover:text-[#352432]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t.label}
                {isActive && (
                  <motion.span
                    layoutId="reports-tab-underline"
                    className="absolute -bottom-px left-2 right-2 h-[2px] rounded-full bg-[linear-gradient(90deg,transparent,#e78ba8,#c05277,#e78ba8,transparent)]"
                  />
                )}
              </button>
            )
          })}
          {allowed.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-[#705a66]">
              Rapor modülleri mevcut paketinizde bulunmuyor. Kullanmak için paketinizi yükseltin.
            </div>
          )}
        </motion.nav>

        {/* FİLTRE ÇUBUĞU + ÇIKTI
            Karşılaştırma sekmesinde dönem/kıyas seçicileri gizlenir — o sekme kendi dönem
            kurucusunu kullanır; iki farklı dönem kaynağı aynı anda görünürse kafa karıştırır. */}
        {tab === 'compare' ? (
          <div className="armo-card armo-card-luxury sticky top-2 z-30 flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-2.5 py-1 text-[10.5px] font-semibold text-[#6b4aa0]">
              <GitCompareArrows className="h-3 w-3" strokeWidth={1.9} />
              Dönemleri aşağıdaki kartlardan seçin — 2 ile 5 dönem karşılaştırılabilir
            </span>
            <div className="flex flex-wrap items-center gap-2">{exportButtons}</div>
          </div>
        ) : (
        <ReportFilterBar
          state={filters}
          onChange={setFilters}
          range={range}
          compare={compare}
          right={exportButtons}
        />
        )}

        <ApiStateNotice loading={active.loading} error={active.error} />

        {exportError && (
          <div className="rounded-[12px] border border-[#f2c4c4] bg-[#fff4f4] px-3 py-2 text-[11.5px] font-semibold text-[#a83a35]">
            {exportError}
          </div>
        )}

        {/* İÇERİK */}
        <AnimatePresence mode="wait">
          <motion.div
            // Karşılaştırma sekmesi kendi dönemlerini kullandığı için ortak queryKey'e bağlı değil;
            // aksi hâlde üstteki dönem değişince gereksiz yeniden animasyon tetiklenirdi.
            key={tab === 'compare' ? 'compare' : `${tab}-${queryKey}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            className={active.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}
          >
            {tab === 'overview' && <OverviewTab data={summaryQ.data} compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'compare' && (
              <CompareTab data={compareQ.data} slots={compareSlots} onSlotsChange={setCompareSlots} loading={compareQ.loading} />
            )}
            {tab === 'packages' && <CatalogTab data={catalogQ.data} kind="package" compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'services' && <CatalogTab data={catalogQ.data} kind="service" compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'staff' && <StaffTab data={staffQ.data} compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'branches' && <BranchesTab data={branchesQ.data} compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'customers' && <CustomersTab data={customersQ.data} compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'inventory' && <InventoryTab data={inventoryQ.data} compareLabel={compare?.label} rangeLabel={range.label} />}
            {tab === 'giftcards' && <GiftCardsTab data={inventoryQ.data} rangeLabel={range.label} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

export default function RaporlarPage() {
  return (
    <Suspense fallback={null}>
      {/* Kart detay modali tüm sekmeler için tek yerden yönetilir. */}
      <MetricDetailProvider>
        <RaporlarPageInner />
      </MetricDetailProvider>
    </Suspense>
  )
}
