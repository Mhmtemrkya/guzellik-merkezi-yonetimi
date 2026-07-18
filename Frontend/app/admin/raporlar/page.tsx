'use client'

import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import StatCard, { statGridContainer } from '@/components/dashboard/StatCard'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import ComparativeReportCard from '@/components/dashboard/ComparativeReportCard'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeature, useFeatureContext } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import {
  apiItems,
  cashFlowMethodLabel,
  expenseCategoryLabels,
  formatTL,
  guidOrUndefined,
  normalizeAppointment,
  normalizeCashFlowEntry,
  normalizeCashFlowSummary,
  normalizeCustomer,
  normalizeExpense,
  normalizeService,
  normalizeStaff,
} from '@/lib/apiMappers'
import { exportToExcel, type ExcelSheetSpec } from '@/lib/excel'
import { generateReportPdf, type PdfSection, type PdfStatBlock } from '@/lib/reportPdf'
import { motion, type Variants, AnimatePresence } from 'framer-motion'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Layers3,
  Loader2,
  Minus,
  PieChart,
  Receipt,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Scissors,
  ShoppingCart,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type {
  ApiAppointment,
  ApiBusinessExpense,
  ApiCashFlowEntry,
  ApiCashFlowSummary,
  ApiCustomer,
  ApiExpenseSummary,
  ApiService,
  ApiStaff,
  AppointmentLookups,
  BusinessExpense,
  CashFlowEntry,
  CashFlowSummary,
  FeatureKey,
  PagedResult,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Period & scope definitions
// ---------------------------------------------------------------------------

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'overall'
type ScopeKey = 'finance' | 'customer' | 'staff' | 'services'

// Her rapor scope'u kendi paket özelliğine bağlıdır.
const scopeFeature: Record<ScopeKey, FeatureKey> = {
  finance: 'reports.finance',
  customer: 'reports.customer',
  staff: 'reports.staff',
  services: 'reports.services',
}

const periodMeta: Record<PeriodKey, { label: string; description: string }> = {
  daily: { label: 'Günlük', description: 'Seçili gün için detaylı rapor' },
  weekly: { label: 'Haftalık', description: 'Seçili haftanın özeti' },
  monthly: { label: 'Aylık', description: 'Seçili ay için tüm metrikler' },
  overall: { label: 'Genel', description: 'Son 12 ay genel performans' },
}

const scopeMeta: Record<ScopeKey, { label: string; description: string; icon: LucideIcon }> = {
  finance: { label: 'Finans Özet', description: 'Ciro, gider, net kâr, yöntem dağılımı', icon: Wallet },
  customer: { label: 'Müşteri Analitiği', description: 'Aktif müşteri, sıklık, KVKK', icon: Users },
  staff: { label: 'Personel Performansı', description: 'Randevu, doluluk, ciro, komisyon', icon: UserCog },
  services: { label: 'Hizmet Doluluk', description: 'En çok yapılan hizmetler, popülerlik', icon: Scissors },
}

const periodIcons: Record<PeriodKey, LucideIcon> = {
  daily: Calendar,
  weekly: Activity,
  monthly: Layers3,
  overall: History,
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

interface DateRange {
  from: Date
  to: Date
  label: string
}

function getRange(period: PeriodKey, offset: number): DateRange {
  const now = new Date()
  if (period === 'daily') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0)
    const to = new Date(d)
    to.setDate(to.getDate() + 1)
    return { from: d, to, label: new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(d) }
  }
  if (period === 'weekly') {
    // Bu haftanın pazartesi
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayOfWeek = (today.getDay() + 6) % 7 // Pzt=0
    const from = new Date(today)
    from.setDate(from.getDate() - dayOfWeek + offset * 7)
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    const fmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' })
    const endVisible = new Date(to)
    endVisible.setDate(endVisible.getDate() - 1)
    return { from, to, label: `${fmt.format(from)} — ${fmt.format(endVisible)}` }
  }
  if (period === 'monthly') {
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    return { from, to, label: new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(from) }
  }
  // overall: son 12 ay
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const from = new Date(to)
  from.setMonth(from.getMonth() - 12)
  return { from, to, label: `Son 12 ay` }
}

function periodLabelString(range: DateRange): string {
  const fmt = (d: Date): string =>
    new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
  const endVisible = new Date(range.to)
  endVisible.setDate(endVisible.getDate() - 1)
  return `${fmt(range.from)} — ${fmt(endVisible)}`
}

// ---------------------------------------------------------------------------
// Data interfaces
// ---------------------------------------------------------------------------

interface ReportData {
  appointmentsResult: PagedResult<ApiAppointment>
  appointmentsPrevResult: PagedResult<ApiAppointment>
  customersResult: PagedResult<ApiCustomer>
  staffResult: PagedResult<ApiStaff>
  servicesResult: PagedResult<ApiService>
  expenses: PagedResult<ApiBusinessExpense>
  expenseSummary: ApiExpenseSummary
  cashFlow: ApiCashFlowEntry[]
  cashFlowSummary: ApiCashFlowSummary
  cashFlowSummaryPrev: ApiCashFlowSummary
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function RaporlarPageInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'
  const routeBase = isStaffUser ? '/personel/raporlar' : '/admin/raporlar'
  const featureCtx = useFeatureContext()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'finance'
  const scopeInfo = scopeMeta[scope]

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)

  const [period, setPeriod] = useState<PeriodKey>('monthly')
  const [offset, setOffset] = useState(0)

  const range = useMemo(() => getRange(period, offset), [period, offset])
  const prevRange = useMemo(() => getRange(period, offset - 1), [period, offset])
  const periodLabel = useMemo(() => periodLabelString(range), [range])

  const goScope = (key: ScopeKey): void => router.push(`${routeBase}?scope=${key}`)

  // Paket özelliğine göre izinli scope'lar. İzinsiz scope'a direkt URL ile gelinirse
  // ilk izinli scope'a yönlendirilir; izinsiz sekme hiç gösterilmez.
  const allowedScopes = (Object.keys(scopeMeta) as ScopeKey[]).filter((k) => featureCtx.has(scopeFeature[k]))
  const scopeAllowed = featureCtx.has(scopeFeature[scope])
  useEffect(() => {
    if (featureCtx.features && !scopeAllowed && allowedScopes.length > 0) {
      router.replace(`${routeBase}?scope=${allowedScopes[0]}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureCtx.features, scope, scopeAllowed])

  const { data, loading, error, reload } = useApiQuery<ReportData>(
    async () => {
      const [appointmentsResult, appointmentsPrevResult, customersResult, staffResult, servicesResult, expenses, expenseSummary, cashFlow, cashFlowSummary, cashFlowSummaryPrev] = await Promise.all([
        adminApi.appointments<ApiAppointment>({
          tenantId,
          fromUtc: range.from.toISOString(),
          toUtc: range.to.toISOString(),
          page: 1,
          pageSize: 1000,
        }),
        adminApi
          .appointments<ApiAppointment>({
            tenantId,
            fromUtc: prevRange.from.toISOString(),
            toUtc: prevRange.to.toISOString(),
            page: 1,
            pageSize: 1000,
          })
          .catch<PagedResult<ApiAppointment>>(() => ({ items: [] })),
        fetchAllPaged<ApiCustomer>((page, pageSize) => adminApi.customers<ApiCustomer>({ tenantId, page, pageSize })).then((items) => ({ items })),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }),
        adminApi
          .expenses<ApiBusinessExpense>({
            tenantId,
            page: 1,
            pageSize: 500,
            fromUtc: range.from.toISOString(),
            toUtc: range.to.toISOString(),
          })
          .catch<PagedResult<ApiBusinessExpense>>(() => ({ items: [] })),
        adminApi
          .expenseSummary<ApiExpenseSummary>({
            tenantId,
            fromUtc: range.from.toISOString(),
            toUtc: range.to.toISOString(),
          })
          .catch<ApiExpenseSummary>(() => ({})),
        adminApi
          .cashFlow<ApiCashFlowEntry>({
            tenantId,
            fromUtc: range.from.toISOString(),
            toUtc: range.to.toISOString(),
          })
          .catch<ApiCashFlowEntry[]>(() => []),
        adminApi
          .cashFlowSummary<ApiCashFlowSummary>({
            tenantId,
            fromUtc: range.from.toISOString(),
            toUtc: range.to.toISOString(),
          })
          .catch<ApiCashFlowSummary>(() => ({})),
        adminApi
          .cashFlowSummary<ApiCashFlowSummary>({
            tenantId,
            fromUtc: prevRange.from.toISOString(),
            toUtc: prevRange.to.toISOString(),
          })
          .catch<ApiCashFlowSummary>(() => ({})),
      ])
      return { appointmentsResult, appointmentsPrevResult, customersResult, staffResult, servicesResult, expenses, expenseSummary, cashFlow, cashFlowSummary, cashFlowSummaryPrev }
    },
    [tenantId, range.from.toISOString(), range.to.toISOString(), prevRange.from.toISOString(), prevRange.to.toISOString()],
    { initialData: null },
  )

  // Lookups
  const apiLookups: AppointmentLookups = useMemo(
    () => ({
      customers: Object.fromEntries(apiItems(data?.customersResult).map((c) => [c.id ?? '', c])),
      staff: Object.fromEntries(apiItems(data?.staffResult).map((s) => [s.id ?? '', s])),
      services: Object.fromEntries(apiItems(data?.servicesResult).map((s) => [s.id ?? '', s])),
    }),
    [data],
  )

  const appointments = useMemo(
    () => apiItems(data?.appointmentsResult).map((a, i) => normalizeAppointment(a, apiLookups, i)),
    [data, apiLookups],
  )
  const customers = useMemo(() => apiItems(data?.customersResult).map((c, i) => normalizeCustomer(c, i)), [data])
  const staff = useMemo(() => apiItems(data?.staffResult).map((s, i) => normalizeStaff(s, i)), [data])
  const services = useMemo(() => apiItems(data?.servicesResult).map((s, i) => normalizeService(s, i)), [data])
  const expenses = useMemo<BusinessExpense[]>(() => apiItems(data?.expenses).map((e, i) => normalizeExpense(e, i)), [data])
  const cashFlow = useMemo<CashFlowEntry[]>(() => (data?.cashFlow || []).map((e, i) => normalizeCashFlowEntry(e, i)), [data])
  const cashFlowSummary: CashFlowSummary = useMemo(() => normalizeCashFlowSummary(data?.cashFlowSummary), [data])

  // ----- KPI -----
  const completedCount = appointments.filter((a) => a.status === 'tamamlandi').length
  const revenue = cashFlowSummary.totalIncome
  const expenseTotal = cashFlowSummary.totalExpense
  const net = cashFlowSummary.netAmount
  // Ortalama Sepet: işlem (tahsilat) başına ortalama tutar — başlıktaki ciro ile AYNI kaynaktan (tutarlı).
  const incomeCount = cashFlowSummary.incomeCount
  const avgBasket = incomeCount > 0 ? revenue / incomeCount : 0

  // ----- Önceki dönem (delta & karşılaştırma için) -----
  const prevAppointments = useMemo(
    () => apiItems(data?.appointmentsPrevResult).map((a, i) => normalizeAppointment(a, apiLookups, i)),
    [data, apiLookups],
  )
  const prevSummary: CashFlowSummary = useMemo(() => normalizeCashFlowSummary(data?.cashFlowSummaryPrev), [data])
  const prevRevenue = prevSummary.totalIncome
  const prevExpense = prevSummary.totalExpense
  const prevNet = prevSummary.netAmount
  const prevIncomeCount = prevSummary.incomeCount
  const prevAvgBasket = prevIncomeCount > 0 ? prevRevenue / prevIncomeCount : 0

  // Müşteri Başına Ciro: aktif (randevulu) müşteri başına ortalama ciro — ciro ile aynı kaynaktan.
  const distinctActive = useMemo(() => new Set(appointments.map((a) => a.customerId).filter(Boolean)).size, [appointments])
  const prevDistinctActive = useMemo(() => new Set(prevAppointments.map((a) => a.customerId).filter(Boolean)).size, [prevAppointments])
  const revenuePerCustomer = distinctActive > 0 ? revenue / distinctActive : 0
  const prevRevenuePerCustomer = prevDistinctActive > 0 ? prevRevenue / prevDistinctActive : 0

  // Yeni / tekrarlayan / iptal — bu dönem ve önceki dönem
  const buildVisitBuckets = (list: typeof appointments): { neu: number; returning: number; cancelled: number } => {
    const visits = new Map<string, number>()
    list.forEach((a) => {
      if (a.customerId) visits.set(a.customerId, (visits.get(a.customerId) || 0) + 1)
    })
    let neu = 0
    let returning = 0
    visits.forEach((v) => (v > 1 ? returning++ : neu++))
    const cancelled = list.filter((a) => a.status === 'iptal').length
    return { neu, returning, cancelled }
  }
  const curBuckets = useMemo(() => buildVisitBuckets(appointments), [appointments])
  const prevBuckets = useMemo(() => buildVisitBuckets(prevAppointments), [prevAppointments])
  const totalOps = appointments.length
  const prevTotalOps = prevAppointments.length

  // ----- Sparkline serileri (günlük) -----
  const cashSeries = useMemo(() => {
    const inc = new Map<string, number>()
    const exp = new Map<string, number>()
    cashFlow.forEach((e) => {
      const m = e.type === 'income' ? inc : exp
      m.set(e.date, (m.get(e.date) || 0) + e.amount)
    })
    const dates = Array.from(new Set([...inc.keys(), ...exp.keys()])).sort()
    return {
      income: dates.map((d) => inc.get(d) || 0),
      expense: dates.map((d) => exp.get(d) || 0),
      net: dates.map((d) => (inc.get(d) || 0) - (exp.get(d) || 0)),
    }
  }, [cashFlow])

  // Kart sparkline'ları: günlük tahsilattan türetilir (başlık cirosuyla tutarlı).
  // basket = günlük (gelir / işlem), perCustomer = günlük (gelir / benzersiz müşteri).
  const txSeries = useMemo(() => {
    const byDate = new Map<string, { income: number; count: number; customers: Set<string> }>()
    cashFlow
      .filter((e) => e.type === 'income')
      .forEach((e) => {
        const cur = byDate.get(e.date) || { income: 0, count: 0, customers: new Set<string>() }
        cur.income += e.amount
        cur.count += 1
        if (e.customerName) cur.customers.add(e.customerName)
        byDate.set(e.date, cur)
      })
    const dates = Array.from(byDate.keys()).sort()
    return {
      basket: dates.map((d) => { const x = byDate.get(d)!; return x.count > 0 ? x.income / x.count : 0 }),
      perCustomer: dates.map((d) => { const x = byDate.get(d)!; return x.customers.size > 0 ? x.income / x.customers.size : 0 }),
    }
  }, [cashFlow])

  // ----- Son işlemler (tahsilatlar) -----
  const recentTx = useMemo(
    () =>
      [...cashFlow]
        .filter((e) => e.type === 'income')
        .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || ''))
        .slice(0, 6),
    [cashFlow],
  )

  // ----- Ödeme yöntemi dağılımı (donut) -----
  const paymentSlices = useMemo(
    () =>
      cashFlowSummary.byMethod
        .filter((m) => m.incomeAmount > 0)
        .map((m) => ({ key: m.method, label: cashFlowMethodLabel(m.method), amount: m.incomeAmount, count: m.count }))
        .sort((a, b) => b.amount - a.amount),
    [cashFlowSummary],
  )

  // ----- Son güncelleme zaman damgası -----
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  useEffect(() => {
    if (data) setLastUpdated(new Date())
  }, [data])

  // ----- Customer analytics -----
  const customerVisits = useMemo(() => {
    const map = new Map<string, number>()
    appointments.forEach((a) => {
      if (a.customerId) map.set(a.customerId, (map.get(a.customerId) || 0) + 1)
    })
    return map
  }, [appointments])

  const topCustomers = useMemo(
    () =>
      customers
        .map((c) => ({ customer: c, visits: customerVisits.get(c.id) || 0 }))
        .filter((c) => c.visits > 0)
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 15),
    [customers, customerVisits],
  )

  const kvkkApproved = customers.filter((c) => c.tier === 'KVKK Onaylı').length
  const kvkkRatio = customers.length > 0 ? Math.round((kvkkApproved / customers.length) * 100) : 0

  // ----- Staff performance -----
  const staffStats = useMemo(
    () =>
      staff.map((s) => {
        const own = appointments.filter((a) => a.staffMemberId === s.id)
        const completed = own.filter((a) => a.status === 'tamamlandi')
        const staffRevenue = completed.reduce((sum, a) => sum + Number(a.price || 0), 0)
        const commission = s.commissionRate ? Math.round((staffRevenue * s.commissionRate) / 100) : 0
        return {
          staff: s,
          appointments: own.length,
          completed: completed.length,
          revenue: staffRevenue,
          commission,
          utilization: own.length > 0 ? Math.round((completed.length / own.length) * 100) : 0,
        }
      }),
    [staff, appointments],
  )
  const sortedStaffStats = useMemo(() => [...staffStats].sort((a, b) => b.revenue - a.revenue), [staffStats])

  // ----- Service stats -----
  const serviceStats = useMemo(
    () =>
      services.map((s) => {
        const own = appointments.filter((a) => a.serviceDefinitionId === s.id)
        const sRev = own.filter((a) => a.status === 'tamamlandi').reduce((sum, a) => sum + Number(a.price || 0), 0)
        return {
          service: s,
          bookings: own.length,
          completed: own.filter((a) => a.status === 'tamamlandi').length,
          revenue: sRev,
        }
      }),
    [services, appointments],
  )
  const sortedServiceStats = useMemo(
    () => [...serviceStats].sort((a, b) => b.bookings - a.bookings),
    [serviceStats],
  )

  // ----- Daily ciro for line chart -----
  const dailyCiro = useMemo(() => {
    const map = new Map<string, number>()
    cashFlow
      .filter((e) => e.type === 'income')
      .forEach((e) => {
        map.set(e.date, (map.get(e.date) || 0) + e.amount)
      })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
  }, [cashFlow])
  const maxDailyCiro = dailyCiro.reduce((max, [, v]) => Math.max(max, v), 0)

  // ===================================================
  // EXPORT — Excel & PDF
  // ===================================================

  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState('')

  // Feature gating: kurum paketinde rapor çıktısı varsa butonlar aktif (render-gate).
  const canExportExcel = useFeature('excel.reports')
  const canExportPdf = useFeature('pdf.reports')
  const featureDeniedMessage = 'Bu özellik mevcut paketinizde bulunmuyor. Kullanmak için paketinizi yükseltin.'

  const buildReportContext = (): string =>
    `${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}`

  const buildFilenameBase = (): string =>
    `${scope}-rapor-${periodMeta[period].label.toLowerCase()}`

  // ----- Excel export -----
  const handleExportExcel = async (): Promise<void> => {
    setExportingExcel(true)
    setExportError('')
    try {
      // Aksiyon anı entitlement kontrolü — sunucu kesin karar verir.
      if (!(await featureCtx.revalidateHas('excel.reports'))) {
        setExportError(featureDeniedMessage)
        return
      }
      const sheets: ExcelSheetSpec<unknown>[] = []

      if (scope === 'finance') {
        sheets.push({
          name: 'Finans Özet',
          subtitle: `${periodLabel}`,
          rows: [
            { label: 'Toplam Gelir (Tahsilat)', amount: revenue, count: cashFlowSummary.incomeCount },
            { label: 'Toplam Gider', amount: expenseTotal, count: cashFlowSummary.expenseCount },
            { label: 'Net Kâr', amount: net, count: cashFlowSummary.incomeCount + cashFlowSummary.expenseCount },
            { label: 'Ortalama Sepet', amount: avgBasket, count: incomeCount },
            { label: 'Müşteri Başına Ciro', amount: revenuePerCustomer, count: distinctActive },
          ] as Array<{ label: string; amount: number; count: number }>,
          columns: [
            { key: 'label', header: 'Kalem', width: 30, type: 'text', accessor: (r) => (r as { label: string }).label },
            { key: 'amount', header: 'Tutar', width: 18, type: 'currency', accessor: (r) => (r as { amount: number }).amount },
            { key: 'count', header: 'Adet', width: 12, type: 'number', accessor: (r) => (r as { count: number }).count },
          ],
        })

        sheets.push({
          name: 'Ödeme Yöntemi',
          subtitle: `${periodLabel}`,
          rows: cashFlowSummary.byMethod,
          columns: [
            { key: 'method', header: 'Yöntem', width: 18, type: 'text', accessor: (r) => cashFlowMethodLabel((r as typeof cashFlowSummary.byMethod[number]).method) },
            { key: 'income', header: 'Tahsilat', width: 18, type: 'currency', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).incomeAmount },
            { key: 'expense', header: 'Gider', width: 18, type: 'currency', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).expenseAmount },
            { key: 'count', header: 'İşlem', width: 12, type: 'number', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).count },
          ],
        })

        sheets.push({
          name: 'Tüm Hareketler',
          subtitle: `${cashFlow.length} işlem`,
          rows: cashFlow,
          columns: [
            { key: 'date', header: 'Tarih', width: 14, type: 'text', accessor: (r) => (r as CashFlowEntry).date },
            { key: 'time', header: 'Saat', width: 10, type: 'text', accessor: (r) => (r as CashFlowEntry).time },
            { key: 'type', header: 'Tip', width: 10, type: 'text', accessor: (r) => ((r as CashFlowEntry).type === 'income' ? 'Gelir' : 'Gider') },
            { key: 'description', header: 'Açıklama', width: 30, type: 'text', accessor: (r) => (r as CashFlowEntry).description || (r as CashFlowEntry).category },
            { key: 'customer', header: 'Müşteri/Personel', width: 22, type: 'text', accessor: (r) => (r as CashFlowEntry).customerName || (r as CashFlowEntry).staffName },
            { key: 'method', header: 'Yöntem', width: 14, type: 'text', accessor: (r) => cashFlowMethodLabel((r as CashFlowEntry).method) },
            { key: 'amount', header: 'Tutar', width: 16, type: 'currency', accessor: (r) => (r as CashFlowEntry).amount },
          ],
          totals: {
            date: 'TOPLAM',
            amount: cashFlow.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0),
          },
        })
      }

      if (scope === 'customer') {
        sheets.push({
          name: 'Müşteri Analitiği',
          subtitle: `${customers.length} müşteri · ${periodLabel}`,
          rows: topCustomers,
          columns: [
            { key: 'name', header: 'Müşteri', width: 26, type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.name },
            { key: 'phone', header: 'Telefon', width: 18, type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.phone },
            { key: 'visits', header: 'Randevu Sayısı', width: 16, type: 'number', accessor: (r) => (r as typeof topCustomers[number]).visits },
            { key: 'tier', header: 'KVKK', width: 14, type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.tier },
            { key: 'debt', header: 'Açık Borç', width: 16, type: 'currency', accessor: (r) => (r as typeof topCustomers[number]).customer.debt },
          ],
          totals: {
            name: 'TOPLAM',
            visits: topCustomers.reduce((s, c) => s + c.visits, 0),
            debt: topCustomers.reduce((s, c) => s + c.customer.debt, 0),
          },
        })
      }

      if (scope === 'staff') {
        sheets.push({
          name: 'Personel Performansı',
          subtitle: `${staff.length} personel · ${periodLabel}`,
          rows: sortedStaffStats,
          columns: [
            { key: 'name', header: 'Personel', width: 22, type: 'text', accessor: (r) => (r as typeof sortedStaffStats[number]).staff.name },
            { key: 'role', header: 'Ünvan', width: 20, type: 'text', accessor: (r) => (r as typeof sortedStaffStats[number]).staff.role },
            { key: 'appointments', header: 'Randevu', width: 12, type: 'number', accessor: (r) => (r as typeof sortedStaffStats[number]).appointments },
            { key: 'completed', header: 'Tamamlanan', width: 12, type: 'number', accessor: (r) => (r as typeof sortedStaffStats[number]).completed },
            { key: 'utilization', header: 'Doluluk (%)', width: 14, type: 'number', accessor: (r) => (r as typeof sortedStaffStats[number]).utilization },
            { key: 'revenue', header: 'Ciro', width: 16, type: 'currency', accessor: (r) => (r as typeof sortedStaffStats[number]).revenue },
            { key: 'commission', header: 'Komisyon', width: 16, type: 'currency', accessor: (r) => (r as typeof sortedStaffStats[number]).commission },
          ],
          totals: {
            name: 'TOPLAM',
            appointments: sortedStaffStats.reduce((s, x) => s + x.appointments, 0),
            completed: sortedStaffStats.reduce((s, x) => s + x.completed, 0),
            revenue: sortedStaffStats.reduce((s, x) => s + x.revenue, 0),
            commission: sortedStaffStats.reduce((s, x) => s + x.commission, 0),
          },
        })
      }

      if (scope === 'services') {
        sheets.push({
          name: 'Hizmet Performansı',
          subtitle: `${services.length} hizmet · ${periodLabel}`,
          rows: sortedServiceStats,
          columns: [
            { key: 'name', header: 'Hizmet', width: 28, type: 'text', accessor: (r) => (r as typeof sortedServiceStats[number]).service.name },
            { key: 'group', header: 'Kategori', width: 18, type: 'text', accessor: (r) => (r as typeof sortedServiceStats[number]).service.group },
            { key: 'bookings', header: 'Randevu Sayısı', width: 14, type: 'number', accessor: (r) => (r as typeof sortedServiceStats[number]).bookings },
            { key: 'completed', header: 'Tamamlanan', width: 14, type: 'number', accessor: (r) => (r as typeof sortedServiceStats[number]).completed },
            { key: 'duration', header: 'Süre (dk)', width: 12, type: 'number', accessor: (r) => (r as typeof sortedServiceStats[number]).service.duration },
            { key: 'price', header: 'Birim Fiyat', width: 14, type: 'currency', accessor: (r) => (r as typeof sortedServiceStats[number]).service.price },
            { key: 'revenue', header: 'Ciro', width: 16, type: 'currency', accessor: (r) => (r as typeof sortedServiceStats[number]).revenue },
          ],
          totals: {
            name: 'TOPLAM',
            bookings: sortedServiceStats.reduce((s, x) => s + x.bookings, 0),
            completed: sortedServiceStats.reduce((s, x) => s + x.completed, 0),
            revenue: sortedServiceStats.reduce((s, x) => s + x.revenue, 0),
          },
        })
      }

      // Gider raporu her zaman ek
      if (expenses.length > 0) {
        sheets.push({
          name: 'Giderler',
          subtitle: `${expenses.length} gider · ${periodLabel}`,
          rows: expenses,
          columns: [
            { key: 'date', header: 'Tarih', width: 14, type: 'text', accessor: (r) => (r as BusinessExpense).occurredAt.slice(0, 10) },
            { key: 'category', header: 'Kategori', width: 20, type: 'text', accessor: (r) => expenseCategoryLabels[(r as BusinessExpense).category] },
            { key: 'description', header: 'Açıklama', width: 30, type: 'text', accessor: (r) => (r as BusinessExpense).description },
            { key: 'staff', header: 'Personel', width: 20, type: 'text', accessor: (r) => (r as BusinessExpense).staffName },
            { key: 'amount', header: 'Tutar', width: 16, type: 'currency', accessor: (r) => (r as BusinessExpense).amount },
          ],
          totals: { date: 'TOPLAM', amount: expenses.reduce((s, e) => s + e.amount, 0) },
        })
      }

      await exportToExcel<unknown>(sheets, {
        filenameBase: buildFilenameBase(),
        title: `${scopeInfo.label} Raporu`,
        context: `${buildReportContext()} · ${periodLabel}`,
      })
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Excel oluşturulamadı.')
    } finally {
      setExportingExcel(false)
    }
  }

  // ----- PDF export -----
  const handleExportPdf = async (): Promise<void> => {
    setExportingPdf(true)
    setExportError('')
    try {
      // Aksiyon anı entitlement kontrolü — sunucu kesin karar verir.
      if (!(await featureCtx.revalidateHas('pdf.reports'))) {
        setExportError(featureDeniedMessage)
        return
      }
      const stats: PdfStatBlock[] = [
        { label: 'Toplam Gelir', value: formatTL(revenue), hint: `${cashFlowSummary.incomeCount} tahsilat` },
        { label: 'Toplam Gider', value: formatTL(expenseTotal), hint: `${cashFlowSummary.expenseCount} gider` },
        { label: 'Net Kâr', value: formatTL(net), hint: net >= 0 ? 'pozitif' : 'negatif' },
        { label: 'Tamamlanan', value: String(completedCount), hint: `${appointments.length} toplam randevu` },
      ]

      const sections: PdfSection<unknown>[] = []

      if (scope === 'finance') {
        sections.push({
          title: 'Ödeme Yöntemi Dağılımı',
          subtitle: `${cashFlowSummary.byMethod.length} yöntem`,
          rows: cashFlowSummary.byMethod,
          columns: [
            { header: 'Yöntem', type: 'text', accessor: (r) => cashFlowMethodLabel((r as typeof cashFlowSummary.byMethod[number]).method) },
            { header: 'Tahsilat', type: 'currency', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).incomeAmount },
            { header: 'Gider', type: 'currency', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).expenseAmount },
            { header: 'İşlem', type: 'number', accessor: (r) => (r as typeof cashFlowSummary.byMethod[number]).count },
          ],
        })

        if (cashFlow.length > 0) {
          sections.push({
            title: 'Hareketler',
            subtitle: `${cashFlow.length} kayıt`,
            rows: cashFlow.slice(0, 100),
            columns: [
              { header: 'Tarih', type: 'text', accessor: (r) => (r as CashFlowEntry).date },
              { header: 'Saat', type: 'text', accessor: (r) => (r as CashFlowEntry).time },
              { header: 'Tip', type: 'text', accessor: (r) => ((r as CashFlowEntry).type === 'income' ? 'Gelir' : 'Gider') },
              { header: 'Açıklama', type: 'text', accessor: (r) => (r as CashFlowEntry).description || (r as CashFlowEntry).category },
              { header: 'Yöntem', type: 'text', accessor: (r) => cashFlowMethodLabel((r as CashFlowEntry).method) },
              { header: 'Tutar', type: 'currency', accessor: (r) => (r as CashFlowEntry).amount },
            ],
          })
        }
      }

      if (scope === 'customer') {
        sections.push({
          title: 'En Sık Gelen Müşteriler',
          subtitle: `Toplam ${customers.length} müşteri · %${kvkkRatio} KVKK onaylı`,
          rows: topCustomers,
          columns: [
            { header: 'Müşteri', type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.name },
            { header: 'Telefon', type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.phone },
            { header: 'Randevu', type: 'number', accessor: (r) => (r as typeof topCustomers[number]).visits },
            { header: 'KVKK', type: 'text', accessor: (r) => (r as typeof topCustomers[number]).customer.tier },
            { header: 'Açık Borç', type: 'currency', accessor: (r) => (r as typeof topCustomers[number]).customer.debt },
          ],
        })
      }

      if (scope === 'staff') {
        sections.push({
          title: 'Personel Performansı',
          subtitle: `${staff.length} personel`,
          rows: sortedStaffStats,
          columns: [
            { header: 'Personel', type: 'text', accessor: (r) => (r as typeof sortedStaffStats[number]).staff.name },
            { header: 'Ünvan', type: 'text', accessor: (r) => (r as typeof sortedStaffStats[number]).staff.role },
            { header: 'Randevu', type: 'number', accessor: (r) => (r as typeof sortedStaffStats[number]).appointments },
            { header: 'Tamamlanan', type: 'number', accessor: (r) => (r as typeof sortedStaffStats[number]).completed },
            { header: 'Doluluk', type: 'percent', accessor: (r) => (r as typeof sortedStaffStats[number]).utilization },
            { header: 'Ciro', type: 'currency', accessor: (r) => (r as typeof sortedStaffStats[number]).revenue },
            { header: 'Komisyon', type: 'currency', accessor: (r) => (r as typeof sortedStaffStats[number]).commission },
          ],
        })
      }

      if (scope === 'services') {
        sections.push({
          title: 'Hizmet Doluluk & Ciro',
          subtitle: `${services.length} hizmet`,
          rows: sortedServiceStats,
          columns: [
            { header: 'Hizmet', type: 'text', accessor: (r) => (r as typeof sortedServiceStats[number]).service.name },
            { header: 'Kategori', type: 'text', accessor: (r) => (r as typeof sortedServiceStats[number]).service.group },
            { header: 'Randevu', type: 'number', accessor: (r) => (r as typeof sortedServiceStats[number]).bookings },
            { header: 'Tamamlanan', type: 'number', accessor: (r) => (r as typeof sortedServiceStats[number]).completed },
            { header: 'Birim Fiyat', type: 'currency', accessor: (r) => (r as typeof sortedServiceStats[number]).service.price },
            { header: 'Ciro', type: 'currency', accessor: (r) => (r as typeof sortedServiceStats[number]).revenue },
          ],
        })
      }

      // Gider tablosu sona ek
      if (expenses.length > 0) {
        sections.push({
          title: 'Giderler',
          subtitle: `${expenses.length} gider · ${formatTL(expenses.reduce((s, e) => s + e.amount, 0))}`,
          rows: expenses,
          columns: [
            { header: 'Tarih', type: 'text', accessor: (r) => (r as BusinessExpense).occurredAt.slice(0, 10) },
            { header: 'Kategori', type: 'text', accessor: (r) => expenseCategoryLabels[(r as BusinessExpense).category] },
            { header: 'Açıklama', type: 'text', accessor: (r) => (r as BusinessExpense).description },
            { header: 'Personel', type: 'text', accessor: (r) => (r as BusinessExpense).staffName },
            { header: 'Tutar', type: 'currency', accessor: (r) => (r as BusinessExpense).amount },
          ],
        })
      }

      generateReportPdf({
        filenameBase: buildFilenameBase(),
        title: `${scopeInfo.label} Raporu`,
        context: buildReportContext(),
        periodLabel,
        stats,
        sections,
      })
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'PDF oluşturulamadı.')
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <>
      <Topbar
        title={isStaffUser ? 'Raporlarım' : 'Raporlar'}
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}${isStaffUser ? ' · personel görünümü' : ''}`}
        breadcrumbs={isStaffUser ? ['Personel', 'Finans', 'Raporlarım', scopeInfo.label] : ['Admin', 'Finans', 'Raporlar', scopeInfo.label]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canExportExcel && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={handleExportExcel}
                disabled={exportingExcel || loading}
                className="group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden border border-[#ead8df]/70 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/72 transition-colors hover:border-emerald-300/55 hover:text-emerald-700 disabled:opacity-60"
              >
                {exportingExcel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.6} />}
                <span>Excel</span>
                <Download className="h-3 w-3 opacity-65" strokeWidth={1.6} />
              </motion.button>
            )}
            {canExportPdf && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={handleExportPdf}
                disabled={exportingPdf || loading}
                className="group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden border border-[#efbfd0]/75 bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] sm:text-[11px] disabled:opacity-70"
              >
                {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.6} />}
                <span>PDF İndir</span>
              </motion.button>
            )}
          </div>
        }
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        {/* SCOPE TABS — yalnızca pakette olan rapor türleri */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-1 border-b border-[#ead8df]/70">
          {(Object.keys(scopeMeta) as ScopeKey[]).filter((key) => featureCtx.has(scopeFeature[key])).map((key) => {
            const m = scopeMeta[key]
            const Icon = m.icon
            const isActive = key === scope
            return (
              <button
                key={key}
                type="button"
                onClick={() => goScope(key)}
                className={`group relative flex items-center gap-2 px-4 py-3 text-[11px] font-mono uppercase tracking-widest transition-colors ${
                  isActive ? 'text-[#c85776]' : 'text-[#352432]/55 hover:text-[#352432]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                {m.label}
                {isActive && <motion.span layoutId="report-tab-indicator" className="absolute -bottom-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#f0aac2] to-transparent" />}
              </button>
            )
          })}
        </motion.div>

        {/* PERIOD SELECTOR */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(periodMeta) as PeriodKey[]).map((p) => {
              const Icon = periodIcons[p]
              const active = period === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPeriod(p)
                    setOffset(0)
                  }}
                  className={`inline-flex items-center gap-1.5 border px-3 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                    active
                      ? 'border-[#efbfd0]/75 bg-[#f0aac2]/[0.08] text-[#352432]'
                      : 'border-[#ead8df]/70 bg-[#fff4f8]/[0.025] text-[#352432]/65 hover:border-[#efbfd0]/75 hover:text-[#352432]'
                  }`}
                >
                  <Icon className="h-3 w-3" strokeWidth={1.6} />
                  {periodMeta[p].label}
                </button>
              )
            })}
          </div>

          {period !== 'overall' && (
            <div className="inline-flex items-center gap-1 border border-[#ead8df]/70 bg-white/82 p-1">
              <button
                type="button"
                onClick={() => setOffset((o) => o - 1)}
                title="Önceki"
                className="grid h-7 w-7 place-items-center text-[#352432]/65 transition-colors hover:bg-[#fff4f8]/10 hover:text-[#352432]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1.5 px-3 text-[11px] font-mono uppercase tracking-widest text-[#c85776]">
                <span className="min-w-[150px] text-center">{range.label}</span>
              </div>
              <button
                type="button"
                onClick={() => setOffset((o) => o + 1)}
                disabled={offset >= 0}
                title="Sonraki"
                className="grid h-7 w-7 place-items-center text-[#352432]/65 transition-colors hover:bg-[#fff4f8]/10 hover:text-[#352432] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              {offset !== 0 && (
                <button
                  type="button"
                  onClick={() => setOffset(0)}
                  title="Bugüne dön"
                  className="ml-1 inline-flex items-center gap-1 border-l border-[#ead8df]/70 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/55 transition-colors hover:text-[#c85776]"
                >
                  <History className="h-2.5 w-2.5" />
                  Bugün
                </button>
              )}
            </div>
          )}
        </div>

        <ApiStateNotice loading={loading} error={error} />

        {exportError && (
          <div className="border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">
            {exportError}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div key={`${scope}-${period}-${offset}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
            {scope === 'finance' ? (
              <>
                {/* ===== KPI KARTLARI (5) ===== */}
                <motion.section variants={statGridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <FinanceKpiCard index={0} label="Toplam Gelir" value={revenue} prev={prevRevenue} icon={TrendingUp} accent="rose" series={cashSeries.income} format={(n) => formatTL(Math.round(n))} hint={`${cashFlowSummary.incomeCount} tahsilat`} />
                  <FinanceKpiCard index={1} label="Toplam Gider" value={expenseTotal} prev={prevExpense} icon={TrendingDown} accent="copper" series={cashSeries.expense} format={(n) => formatTL(Math.round(n))} hint={`${cashFlowSummary.expenseCount} gider`} />
                  <FinanceKpiCard index={2} label="Net Kâr" value={net} prev={prevNet} icon={Wallet} accent={net >= 0 ? 'gold' : 'copper'} series={cashSeries.net} format={(n) => formatTL(Math.round(n))} hint={net >= 0 ? 'kârda' : 'zararda'} />
                  <FinanceKpiCard index={3} label="Ortalama Sepet" value={avgBasket} prev={prevAvgBasket} icon={ShoppingCart} accent="gold" series={txSeries.basket} format={(n) => formatTL(Math.round(n))} hint={`İşlem başına ortalama tahsilat · ${incomeCount} işlem`} />
                  <FinanceKpiCard index={4} label="Müşteri Başına Ciro" value={revenuePerCustomer} prev={prevRevenuePerCustomer} icon={Users} accent="rose" series={txSeries.perCustomer} format={(n) => formatTL(Math.round(n))} hint={`Aktif müşteri başına ortalama ciro · ${distinctActive} müşteri`} />
                </motion.section>

                {/* ===== GELİR AKIŞI + SAĞ SÜTUN ===== */}
                <section className="grid gap-3 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <RevenueAreaChart
                      data={dailyCiro}
                      maxValue={maxDailyCiro}
                      rangeLabel={range.label}
                      headerRight={<PeriodDropdown period={period} onChange={(p) => { setPeriod(p); setOffset(0) }} />}
                    />
                  </div>
                  <div className="space-y-3">
                    <ComparativeReportCard
                      tenantId={tenantId}
                      fromIso={range.from.toISOString()}
                      toIso={range.to.toISOString()}
                      prevFromIso={prevRange.from.toISOString()}
                      prevToIso={prevRange.to.toISOString()}
                      currentLabel={range.label}
                      prevLabel={prevRange.label}
                    />
                    <QuickAccessCard
                      items={[
                        { icon: FileText, label: 'Detaylı Finans', onClick: () => router.push('/admin/kasa') },
                        { icon: Users, label: 'Müşteri Analizi', onClick: () => goScope('customer') },
                        { icon: UserCog, label: 'Personel Performansı', onClick: () => goScope('staff') },
                        { icon: BarChart3, label: 'Hizmet Doluluk', onClick: () => goScope('services') },
                      ]}
                    />
                  </div>
                </section>

                {/* ===== ÖDEME YÖNTEMİ + İŞLEM ÖZETİ + SON İŞLEMLER ===== */}
                <section className="grid gap-3 lg:grid-cols-3">
                  <PaymentDonut slices={paymentSlices} total={revenue} />
                  <PeriodOpsCard
                    rows={[
                      { icon: Receipt, label: 'Toplam İşlem', value: totalOps, prev: prevTotalOps, accent: 'rose' },
                      { icon: UserPlus, label: 'Yeni Müşteri', value: curBuckets.neu, prev: prevBuckets.neu, accent: 'emerald' },
                      { icon: Repeat2, label: 'Tekrarlayan Müşteri', value: curBuckets.returning, prev: prevBuckets.returning, accent: 'gold' },
                      { icon: RotateCcw, label: 'İptal / İade', value: curBuckets.cancelled, prev: prevBuckets.cancelled, accent: 'copper' },
                    ]}
                  />
                  <RecentTxCard items={recentTx} onSeeAll={() => router.push('/admin/kasa')} />
                </section>

                {/* ===== ALT BİLGİ ===== */}
                <FinanceFooter lastUpdated={lastUpdated} onRefresh={reload} loading={loading} />
              </>
            ) : (
              <>
                {/* KPI Cards */}
                <motion.section variants={statGridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    index={0}
                    label="Toplam Gelir"
                    value={<AnimatedNumber value={revenue} format={(n) => formatTL(Math.round(n))} />}
                    icon={TrendingUp}
                    accent="rose"
                    delta={`${cashFlowSummary.incomeCount} tahsilat`}
                  />
                  <StatCard
                    index={1}
                    label="Toplam Gider"
                    value={<AnimatedNumber value={expenseTotal} format={(n) => formatTL(Math.round(n))} />}
                    icon={TrendingDown}
                    accent="copper"
                    delta={`${cashFlowSummary.expenseCount} gider`}
                  />
                  <StatCard
                    index={2}
                    label="Net Kâr"
                    value={<AnimatedNumber value={net} format={(n) => formatTL(Math.round(n))} />}
                    icon={Sparkles}
                    accent={net >= 0 ? 'gold' : 'copper'}
                    delta={net >= 0 ? 'kârda' : 'zararda'}
                  />
                  <StatCard
                    index={3}
                    label="Ortalama Sepet"
                    value={<AnimatedNumber value={avgBasket} format={(n) => formatTL(Math.round(n))} />}
                    icon={Crown}
                    accent="gold"
                    delta={`${incomeCount} işlem`}
                  />
                </motion.section>

                {/* GELİR AKIŞI — SVG Area Chart */}
                <RevenueAreaChart data={dailyCiro} maxValue={maxDailyCiro} rangeLabel={range.label} />
              </>
            )}

            {scope === 'customer' && (
              <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3 lg:grid-cols-[1fr_.75fr]">
                <ReportBlock title="En sık gelen müşteriler" icon={Users}>
                  <motion.div variants={listContainer} initial="hidden" animate="visible" className="space-y-2">
                    {topCustomers.map((c, i) => (
                      <motion.div key={c.customer.id} variants={listRow} whileHover={{ x: 4 }} className="flex items-center gap-3 border border-[#ead8df]/65 bg-white/74 p-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center border border-[#efbfd0]/75 bg-white font-mono text-[10px] text-[#c85776]">
                          #{i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{c.customer.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono text-[#352432]/45">{c.customer.phone}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-lg tabular-nums">
                            <AnimatedNumber value={c.visits} />
                          </div>
                          <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">randevu</div>
                        </div>
                      </motion.div>
                    ))}
                    {!topCustomers.length && <div className="text-sm text-[#352432]/45">Bu dönemde müşteri ziyareti yok.</div>}
                  </motion.div>
                </ReportBlock>

                <ReportBlock title="KVKK durumu" icon={Crown}>
                  <div className="space-y-3">
                    <KvkkRing label="KVKK Onaylı" value={kvkkApproved} total={customers.length} color="from-emerald-400 to-emerald-300" />
                    <KvkkRing label="KVKK Bekleyen" value={customers.length - kvkkApproved} total={customers.length} color="from-amber-400 to-amber-300" />
                    <div className="border border-[#ead8df]/65 bg-white/74 p-3 text-[11px] leading-5 text-[#352432]/55">
                      Toplam <strong className="text-[#352432]/85">{customers.length}</strong> müşterinin{' '}
                      <strong className="text-emerald-700">%{kvkkRatio}</strong>'i KVKK onayı vermiş.
                    </div>
                  </div>
                </ReportBlock>
              </motion.section>
            )}

            {scope === 'staff' && (
              <ReportBlock title="Personel performansı" icon={Star}>
                <motion.div variants={listContainer} initial="hidden" animate="visible" className="divide-y divide-[#fff4f8]/8">
                  {sortedStaffStats.map((s, i) => (
                    <motion.div key={s.staff.id} variants={listRow} whileHover={{ x: 4 }} className="grid items-center gap-3 py-3 md:grid-cols-12">
                      <div className="md:col-span-1">
                        <span className="grid h-8 w-8 place-items-center border border-[#efbfd0]/75 bg-white font-mono text-[10px] text-[#c85776]">
                          #{i + 1}
                        </span>
                      </div>
                      <div className="md:col-span-3">
                        <div className="font-medium">{s.staff.name}</div>
                        <div className="mt-0.5 text-[10px] font-mono text-[#c85776]/60">{s.staff.role}</div>
                      </div>
                      <div className="md:col-span-2 text-right tabular-nums">
                        <AnimatedNumber value={s.completed} /> / {s.appointments}
                      </div>
                      <div className="md:col-span-2">
                        <div className="h-1.5 overflow-hidden bg-[#fff4f8]/10">
                          <motion.span initial={{ width: 0 }} animate={{ width: `${s.utilization}%` }} transition={{ duration: 0.8, delay: 0.05 * i }} className="block h-full bg-gradient-to-r from-emerald-400 to-emerald-300" />
                        </div>
                        <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">
                          %{s.utilization} doluluk
                        </div>
                      </div>
                      <div className="md:col-span-2 text-right font-display tabular-nums">{formatTL(s.revenue)}</div>
                      <div className="md:col-span-2 text-right font-display tabular-nums text-emerald-700">+{formatTL(s.commission)}</div>
                    </motion.div>
                  ))}
                  {!sortedStaffStats.length && <div className="px-5 py-8 text-sm text-[#352432]/45">Personel kaydı yok.</div>}
                </motion.div>
              </ReportBlock>
            )}

            {scope === 'services' && (
              <ReportBlock title="Hizmet doluluk & ciro" icon={Scissors}>
                <motion.div variants={listContainer} initial="hidden" animate="visible" className="divide-y divide-[#fff4f8]/8">
                  {sortedServiceStats.map((s, i) => {
                    const ratio = sortedServiceStats[0]!.bookings > 0 ? Math.round((s.bookings / sortedServiceStats[0]!.bookings) * 100) : 0
                    return (
                      <motion.div key={s.service.id} variants={listRow} whileHover={{ x: 4 }} className="grid items-center gap-3 py-3 md:grid-cols-12">
                        <div className="md:col-span-1">
                          <span className="grid h-8 w-8 place-items-center border border-[#efbfd0]/75 bg-white font-mono text-[10px] text-[#c85776]">
                            #{i + 1}
                          </span>
                        </div>
                        <div className="md:col-span-3">
                          <div className="font-medium">{s.service.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/60">{s.service.group}</div>
                        </div>
                        <div className="md:col-span-2 text-right tabular-nums">
                          <AnimatedNumber value={s.bookings} /> randevu
                        </div>
                        <div className="md:col-span-3">
                          <div className="h-1.5 overflow-hidden bg-[#fff4f8]/10">
                            <motion.span initial={{ width: 0 }} animate={{ width: `${ratio}%` }} transition={{ duration: 0.8, delay: 0.05 * i }} className="block h-full bg-gradient-to-r from-[#f0aac2] to-[#ffd3df]" />
                          </div>
                          <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">%{ratio} pay</div>
                        </div>
                        <div className="md:col-span-2 text-right tabular-nums text-[#352432]/65">
                          {s.service.duration} dk · {formatTL(s.service.price)}
                        </div>
                        <div className="md:col-span-1 text-right font-display tabular-nums beautyasist-text-gradient">{formatTL(s.revenue)}</div>
                      </motion.div>
                    )
                  })}
                  {!sortedServiceStats.length && <div className="px-5 py-8 text-sm text-[#352432]/45">Hizmet kaydı yok.</div>}
                </motion.div>
              </ReportBlock>
            )}

            {/* DOWNLOAD CTA — alt (paket bu özelliği içermiyorsa gizlenir) */}
            {(canExportExcel || canExportPdf) && (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}
                className={`grid gap-3 ${canExportExcel && canExportPdf ? 'sm:grid-cols-2' : ''}`}>
                {canExportExcel && (
                  <DownloadCard
                    title="Excel raporu"
                    description="Detaylı satır bazlı veri, çoklu sheet, otomatik filtreleme. Muhasebe ve BI araçları için ideal."
                    accent="emerald"
                    icon={FileSpreadsheet}
                    ctaLabel="Excel indir"
                    onClick={handleExportExcel}
                    loading={exportingExcel}
                    disabled={loading}
                  />
                )}
                {canExportPdf && (
                  <DownloadCard
                    title="PDF raporu"
                    description="Yazıcıya hazır, marka temalı şık çıktı. Müşteriye, banka veya muhasebeciye gönderim için uygun."
                    accent="rose"
                    icon={FileText}
                    ctaLabel="PDF indir"
                    onClick={handleExportPdf}
                    loading={exportingPdf}
                    disabled={loading}
                  />
                )}
              </motion.section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub components
// ---------------------------------------------------------------------------

interface RevenueAreaChartProps {
  data: Array<[string, number]>
  maxValue: number
  rangeLabel: string
  headerRight?: React.ReactNode
}

function RevenueAreaChart({ data, maxValue, rangeLabel, headerRight }: RevenueAreaChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const WIDTH = 1000
  const HEIGHT = 280
  const PADDING_LEFT = 60
  const PADDING_RIGHT = 20
  const PADDING_TOP = 20
  const PADDING_BOTTOM = 40
  const innerW = WIDTH - PADDING_LEFT - PADDING_RIGHT
  const innerH = HEIGHT - PADDING_TOP - PADDING_BOTTOM

  // Scale data
  const totalSum = data.reduce((s, [, v]) => s + v, 0)
  const avg = data.length > 0 ? totalSum / data.length : 0

  if (data.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18 }}
        className="relative overflow-hidden border border-[#ead8df]/70 bg-white/88 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)] p-6 backdrop-blur-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
              <Activity className="h-3.5 w-3.5" /> Gelir akışı
            </div>
            <div className="mt-2 font-display text-2xl tracking-tight">{rangeLabel}</div>
          </div>
          {headerRight}
        </div>
        <div className="mt-8 flex h-48 items-center justify-center text-sm text-[#352432]/45">
          Bu dönemde tahsilat yok.
        </div>
      </motion.section>
    )
  }

  // X, Y koordinatları
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0
  const yScale = (v: number): number =>
    maxValue > 0 ? PADDING_TOP + innerH - (v / maxValue) * innerH : PADDING_TOP + innerH
  const xAt = (i: number): number => PADDING_LEFT + (data.length === 1 ? innerW / 2 : i * stepX)

  // Smooth area path (Catmull-Rom benzeri basit bezier)
  const points = data.map(([, v], i) => ({ x: xAt(i), y: yScale(v) }))
  const linePath = points
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`
      const prev = points[i - 1]
      const cpx1 = prev.x + (p.x - prev.x) * 0.4
      const cpx2 = p.x - (p.x - prev.x) * 0.4
      return `C ${cpx1} ${prev.y} ${cpx2} ${p.y} ${p.x} ${p.y}`
    })
    .join(' ')
  const areaPath =
    points.length === 0
      ? ''
      : `${linePath} L ${points[points.length - 1].x} ${PADDING_TOP + innerH} L ${points[0].x} ${PADDING_TOP + innerH} Z`

  // Y ekseni gridleri (4 satır)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    y: PADDING_TOP + innerH - p * innerH,
    value: p * maxValue,
  }))

  // X ekseni etiketleri (her N günde bir)
  const labelStep = Math.max(1, Math.ceil(data.length / 8))
  const xLabels = data
    .map(([d], i) => ({ idx: i, date: d, x: xAt(i) }))
    .filter(({ idx }) => idx % labelStep === 0 || idx === data.length - 1)
    .map((l) => {
      const dt = new Date(l.date)
      const txt = !isNaN(dt.getTime())
        ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(dt)
        : l.date
      return { ...l, txt }
    })

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.18 }}
      className="armo-card armo-card-luxury p-5 sm:p-6"
    >
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-10 h-48 w-48 rounded-full bg-[#f0aac2]/14 blur-3xl" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
            <Activity className="h-3.5 w-3.5" /> Gelir akışı · {rangeLabel}
          </div>
          <div className="mt-1 font-display text-2xl tracking-tight">
            {formatTL(totalSum)} <span className="text-[12px] font-mono uppercase tracking-widest text-[#352432]/45">toplam</span>
          </div>
        </div>
        {headerRight ?? (
          <div className="grid grid-cols-3 gap-3 text-right">
            <div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">Maks</div>
              <div className="font-display text-sm tabular-nums beautyasist-text-gradient">{formatTL(Math.round(maxValue))}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">Ortalama</div>
              <div className="font-display text-sm tabular-nums">{formatTL(Math.round(avg))}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">Gün</div>
              <div className="font-display text-sm tabular-nums">{data.length}</div>
            </div>
          </div>
        )}
      </div>

      <div className="relative mt-6 overflow-hidden">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-72 w-full"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="revenueArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#F0AAC2" stopOpacity={0.6} />
              <stop offset="50%" stopColor="#F0AAC2" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#F0AAC2" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="revenueLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#FFD3DF" />
              <stop offset="100%" stopColor="#F0AAC2" />
            </linearGradient>
          </defs>

          {/* Y ekseni grid */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line
                x1={PADDING_LEFT}
                y1={g.y}
                x2={WIDTH - PADDING_RIGHT}
                y2={g.y}
                stroke="#c79bac"
                strokeOpacity={0.32}
                strokeDasharray="3 4"
              />
              <text
                x={PADDING_LEFT - 8}
                y={g.y + 4}
                textAnchor="end"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="#9d7386"
                fillOpacity={0.95}
              >
                {formatTL(Math.round(g.value))}
              </text>
            </g>
          ))}

          {/* Ortalama çizgisi (kesik) */}
          {avg > 0 && maxValue > 0 && (
            <g>
              <line
                x1={PADDING_LEFT}
                y1={yScale(avg)}
                x2={WIDTH - PADDING_RIGHT}
                y2={yScale(avg)}
                stroke="#ef9ab5"
                strokeOpacity={0.7}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
              <text
                x={WIDTH - PADDING_RIGHT - 4}
                y={yScale(avg) - 4}
                textAnchor="end"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="#c85776"
                fillOpacity={0.9}
              >
                Ort.
              </text>
            </g>
          )}

          {/* Alan dolgu */}
          <motion.path
            d={areaPath}
            fill="url(#revenueArea)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          />

          {/* Çizgi */}
          <motion.path
            d={linePath}
            fill="none"
            stroke="url(#revenueLine)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
          />

          {/* Veri noktaları + hover bölgeleri */}
          {points.map((p, i) => {
            const isHover = hoverIdx === i
            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHover ? 5 : 3}
                  fill="#FFF4F8"
                  stroke="#F0AAC2"
                  strokeWidth={isHover ? 2.5 : 1.5}
                  style={{ transition: 'r 0.15s ease, stroke-width 0.15s ease' }}
                />
                {/* Geniş hover trigger */}
                <rect
                  x={p.x - stepX / 2}
                  y={PADDING_TOP}
                  width={stepX || 20}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  style={{ cursor: 'crosshair' }}
                />
              </g>
            )
          })}

          {/* Hover dikey çizgi + tooltip */}
          {hoverIdx !== null && points[hoverIdx] && (
            <g>
              <line
                x1={points[hoverIdx].x}
                y1={PADDING_TOP}
                x2={points[hoverIdx].x}
                y2={PADDING_TOP + innerH}
                stroke="#F0AAC2"
                strokeOpacity={0.5}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            </g>
          )}

          {/* X ekseni etiketleri */}
          {xLabels.map((lbl) => (
            <text
              key={lbl.idx}
              x={lbl.x}
              y={HEIGHT - PADDING_BOTTOM + 18}
              textAnchor="middle"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fill="#9d7386"
              fillOpacity={0.92}
            >
              {lbl.txt}
            </text>
          ))}

          {/* Y ekseni dikey çizgi */}
          <line
            x1={PADDING_LEFT}
            y1={PADDING_TOP}
            x2={PADDING_LEFT}
            y2={PADDING_TOP + innerH}
            stroke="#c79bac"
            strokeOpacity={0.45}
          />
          {/* X ekseni yatay çizgi */}
          <line
            x1={PADDING_LEFT}
            y1={PADDING_TOP + innerH}
            x2={WIDTH - PADDING_RIGHT}
            y2={PADDING_TOP + innerH}
            stroke="#c79bac"
            strokeOpacity={0.45}
          />
        </svg>

        {/* HTML tooltip (SVG yerine — daha güzel görünür) */}
        {hoverIdx !== null && points[hoverIdx] && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-10 rounded-xl border border-[#efbfd0]/80 bg-white/95 px-3 py-2 text-[10px] font-mono shadow-[0_14px_34px_-16px_rgba(150,78,104,0.5)] backdrop-blur-sm"
            style={{
              left: `${(points[hoverIdx].x / WIDTH) * 100}%`,
              top: `${(points[hoverIdx].y / HEIGHT) * 100}%`,
              transform: 'translate(-50%, -120%)',
            }}
          >
            <div className="text-[#c85776]/80 uppercase tracking-widest text-[9px]">
              {new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: '2-digit', month: 'long' }).format(new Date(data[hoverIdx][0]))}
            </div>
            <div className="mt-1 font-display text-base text-[#352432] tabular-nums">
              {formatTL(data[hoverIdx][1])}
            </div>
          </motion.div>
        )}
      </div>
    </motion.section>
  )
}

function ReportBlock({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div className="armo-card armo-card-luxury p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#f0aac2]/12 blur-3xl" />
      <div className="relative flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="relative mt-4">{children}</div>
    </div>
  )
}

function KvkkRing({
  label,
  value,
  total,
  color,
}: {
  label: string
  value: number
  total: number
  color: string
}) {
  const ratio = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="border border-[#ead8df]/65 bg-white/74 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/65">{label}</span>
        <span className="font-display text-xl tabular-nums">
          <AnimatedNumber value={value} /> <span className="text-[10px] font-mono text-[#352432]/45">/ {total}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden bg-[#fff4f8]/8">
        <motion.span initial={{ width: 0 }} animate={{ width: `${ratio}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className={`block h-full bg-gradient-to-r ${color}`} />
      </div>
    </div>
  )
}

function DownloadCard({
  title,
  description,
  icon: Icon,
  accent,
  ctaLabel,
  onClick,
  loading,
  disabled,
}: {
  title: string
  description: string
  icon: LucideIcon
  accent: 'emerald' | 'rose'
  ctaLabel: string
  onClick: () => void | Promise<void>
  loading?: boolean
  disabled?: boolean
}) {
  const accentBg = accent === 'emerald' ? 'bg-emerald-400/8' : 'bg-[#f0aac2]/8'
  const accentBorder = accent === 'emerald' ? 'border-emerald-300/25 hover:border-emerald-300/55' : 'border-[#efbfd0]/75 hover:border-[#efbfd0]/75'
  const accentText = accent === 'emerald' ? 'text-emerald-700' : 'text-[#c85776]'
  const buttonBg =
    accent === 'emerald'
      ? 'border border-emerald-300/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
      : 'border border-[#efbfd0]/75 bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] text-[#2f1724]'

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className={`relative overflow-hidden border ${accentBorder} ${accentBg} p-5 transition-colors`}
    >
      <span aria-hidden className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full ${accent === 'emerald' ? 'bg-emerald-400/14' : 'bg-[#ffd3df]/14'} blur-3xl`} />
      <div className="relative flex items-start justify-between">
        <Icon className={`h-7 w-7 ${accentText}`} strokeWidth={1.5} />
        <Download className="h-3.5 w-3.5 text-[#352432]/40" />
      </div>
      <div className="relative mt-5 font-display text-2xl tracking-tight">{title}</div>
      <div className="relative mt-1 text-[12px] leading-5 text-[#352432]/55">{description}</div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className={`relative mt-5 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest transition-colors disabled:opacity-60 ${buttonBg}`}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {loading ? 'Hazırlanıyor…' : ctaLabel}
      </button>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Finans Özeti — yardımcılar & zengin bileşenler
// ---------------------------------------------------------------------------

type KpiAccent = 'rose' | 'gold' | 'copper' | 'emerald'

const kpiAccentIcon: Record<KpiAccent, string> = {
  rose: 'border-[#f4b9c9] bg-[#fff0f5] text-[#c85776]',
  gold: 'border-[#f0c8d5] bg-[#fff5f8] text-[#b75b74]',
  copper: 'border-[#e6bdca] bg-[#fff2f6] text-[#9d526b]',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-600',
}

const kpiCardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] } },
}

const donutPalette = ['#ef6f94', '#b56bd6', '#5b9fe6', '#f0a868', '#46c39a', '#9d7386']
const donutMethodColor: Record<string, string> = {
  cash: '#ef6f94',
  card: '#b56bd6',
  transfer: '#5b9fe6',
  check: '#f0a868',
  unknown: '#9d7386',
}
const donutColorFor = (key: string, i: number): string => donutMethodColor[key] ?? donutPalette[i % donutPalette.length]

/** Yüzdesel büyüme; önceki 0 ise tanımsız (yeni). */
function growthPct(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  return parts.slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR')).join('')
}

function DeltaBadge({ value, className = '' }: { value: number | null; className?: string }) {
  if (value === null) {
    return (
      <span className={`inline-flex items-center justify-center gap-1 rounded-full border border-[#ead8df] bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-[#9d7386] ${className}`}>
        yeni
      </span>
    )
  }
  const up = value > 0
  const flat = value === 0
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  const tone = flat
    ? 'border-[#ead8df] bg-white/70 text-[#9d7386]'
    : up
      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
      : 'border-rose-200 bg-rose-50 text-rose-600'
  return (
    <span className={`inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone} ${className}`}>
      <Icon className="h-3 w-3" strokeWidth={2} />%{Math.abs(value)}
    </span>
  )
}

/** Mini trend grafiği — kart köşeleri için. */
function Sparkline({ data, className = 'h-11 w-[88px]' }: { data: number[]; className?: string }) {
  const rawId = useId()
  const gid = rawId.replace(/:/g, '')
  const W = 100
  const H = 40
  const P = 3
  const series = data && data.length ? data : [0, 0]
  const max = Math.max(...series)
  const min = Math.min(...series)
  const span = max - min || 1
  const stepX = series.length > 1 ? (W - P * 2) / (series.length - 1) : 0
  const pts = series.map((v, i) => ({
    x: P + (series.length === 1 ? (W - P * 2) / 2 : i * stepX),
    y: P + (H - P * 2) * (1 - (v - min) / span),
  }))
  const line = pts
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`
      const prev = pts[i - 1]
      const cx1 = prev.x + (p.x - prev.x) * 0.4
      const cx2 = p.x - (p.x - prev.x) * 0.4
      return `C ${cx1} ${prev.y} ${cx2} ${p.y} ${p.x} ${p.y}`
    })
    .join(' ')
  const area = `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`sp-${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f9b8cb" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#f9b8cb" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-${gid})`} />
      <motion.path
        d={line}
        fill="none"
        stroke="#ef6f94"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      />
    </svg>
  )
}

function FinanceKpiCard({
  label,
  value,
  prev,
  icon: Icon,
  accent,
  series,
  format,
  hint,
}: {
  index: number
  label: string
  value: number
  prev: number
  icon: LucideIcon
  accent: KpiAccent
  series: number[]
  format: (n: number) => string
  hint?: string
}) {
  const delta = growthPct(value, prev)
  return (
    <motion.div
      variants={kpiCardVariants}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="armo-card armo-card-luxury armo-lift group p-5"
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#f0b8c9] to-transparent opacity-80" />
      <div className="relative flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border shadow-[0_10px_24px_-18px_rgba(190,91,125,0.8)] ${kpiAccentIcon[accent]}`}>
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
        </span>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#6a4f5c]">
          {label}
          {hint ? (
            <span title={hint} className="inline-flex cursor-help">
              <Info className="h-3 w-3 text-[#c9a3b2]" strokeWidth={1.8} />
            </span>
          ) : null}
        </span>
      </div>
      <div className="relative mt-3.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="armo-stat-value text-[26px] leading-none lg:text-[30px]">
            <AnimatedNumber value={value} format={format} />
          </div>
          <div className="mt-2">
            <DeltaBadge value={delta} />
          </div>
        </div>
        <Sparkline data={series} className="h-11 w-[88px] shrink-0" />
      </div>
      <div className="relative mt-3 text-[11px] text-[#9d7386]/85">
        Önceki Dönem: <span className="font-semibold text-[#7c6170]">{format(prev)}</span>
      </div>
    </motion.div>
  )
}

function PeriodDropdown({ period, onChange }: { period: PeriodKey; onChange: (p: PeriodKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-[#ead8df] bg-white/85 px-3 py-2 text-[12px] font-semibold text-[#7c6170] shadow-[0_10px_26px_-22px_rgba(150,78,104,0.5)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
      >
        {periodMeta[period].label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.8} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-40 overflow-hidden rounded-2xl border border-[#ead8df] bg-white/97 p-1 shadow-[0_24px_60px_-30px_rgba(150,78,104,0.5)] backdrop-blur-xl"
          >
            {(Object.keys(periodMeta) as PeriodKey[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onChange(p)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition-colors ${
                  p === period ? 'bg-[#fff1f6] font-semibold text-[#c85776]' : 'text-[#7c6170] hover:bg-[#fff7fa]'
                }`}
              >
                {periodMeta[p].label}
                {p === period && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function QuickAccessCard({ items }: { items: Array<{ icon: LucideIcon; label: string; onClick: () => void }> }) {
  return (
    <div className="armo-card armo-card-luxury p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#f0aac2]/12 blur-3xl" />
      <div className="relative flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
        <Sparkles className="h-3.5 w-3.5" /> Hızlı Erişim
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2.5">
        {items.map((it) => {
          const Icon = it.icon
          return (
            <motion.button
              key={it.label}
              type="button"
              onClick={it.onClick}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-[#ead8df]/70 bg-white/70 px-3 py-3.5 text-center transition-colors hover:border-[#ef9ab5] hover:bg-[#fff7fa]"
            >
              <span className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#f4b9c9] bg-[#fff0f5] text-[#c85776] transition-transform group-hover:scale-105">
                <Icon className="h-4 w-4" strokeWidth={1.7} />
              </span>
              <span className="text-[11px] font-semibold leading-tight text-[#6a4f5c]">{it.label}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function PaymentDonut({
  slices,
  total,
}: {
  slices: Array<{ key: string; label: string; amount: number; count: number }>
  total: number
}) {
  const sum = slices.reduce((s, x) => s + x.amount, 0) || 1
  const R = 60
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="armo-card armo-card-luxury p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#f0aac2]/12 blur-3xl" />
      <div className="relative flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
        <PieChart className="h-3.5 w-3.5" /> Ödeme Yöntemi Dağılımı
      </div>
      {slices.length === 0 ? (
        <div className="relative mt-6 flex h-40 items-center justify-center text-sm text-[#352432]/45">Tahsilat yok.</div>
      ) : (
        <div className="relative mt-4 flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative shrink-0">
            <svg viewBox="0 0 160 160" className="h-40 w-40 -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="#f6e3ea" strokeWidth={18} />
              {slices.map((s, i) => {
                const dash = (s.amount / sum) * C
                const el = (
                  <motion.circle
                    key={s.key}
                    cx="80"
                    cy="80"
                    r={R}
                    fill="none"
                    stroke={donutColorFor(s.key, i)}
                    strokeWidth={18}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-offset}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                  />
                )
                offset += dash
                return el
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-display text-base tabular-nums text-[#352432]">{formatTL(total)}</div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-[#9d7386]">Toplam</div>
              </div>
            </div>
          </div>
          <div className="w-full flex-1 space-y-2.5">
            {slices.map((s, i) => {
              const pct = Math.round((s.amount / sum) * 1000) / 10
              return (
                <div key={s.key} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: donutColorFor(s.key, i) }} />
                  <span className="flex-1 truncate text-[12px] font-medium text-[#4a3542]">{s.label}</span>
                  <span className="font-display text-[12px] tabular-nums text-[#352432]">{formatTL(s.amount)}</span>
                  <span className="w-12 text-right text-[11px] font-mono tabular-nums text-[#9d7386]">%{pct}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PeriodOpsCard({
  rows,
}: {
  rows: Array<{ icon: LucideIcon; label: string; value: number; prev: number; accent: KpiAccent }>
}) {
  return (
    <div className="armo-card armo-card-luxury p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#f0aac2]/12 blur-3xl" />
      <div className="relative flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
        <Activity className="h-3.5 w-3.5" /> Bu Dönemin İşlem Özeti
      </div>
      <div className="relative mt-4 space-y-2">
        {rows.map((r) => {
          const Icon = r.icon
          const delta = growthPct(r.value, r.prev)
          return (
            <div key={r.label} className="flex items-center gap-3 rounded-2xl border border-[#ead8df]/70 bg-white/70 px-3 py-2.5">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border ${kpiAccentIcon[r.accent]}`}>
                <Icon className="h-4 w-4" strokeWidth={1.7} />
              </span>
              <span className="flex-1 truncate text-[12px] font-medium text-[#4a3542]">{r.label}</span>
              <span className="font-display text-[16px] tabular-nums text-[#352432]">
                <AnimatedNumber value={r.value} />
              </span>
              <DeltaBadge value={delta} className="w-[62px]" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecentTxCard({ items, onSeeAll }: { items: CashFlowEntry[]; onSeeAll: () => void }) {
  return (
    <div className="armo-card armo-card-luxury p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#f0aac2]/12 blur-3xl" />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
          <Receipt className="h-3.5 w-3.5" /> Son İşlemler
        </div>
        <button type="button" onClick={onSeeAll} className="rounded-lg border border-[#ead8df]/70 bg-white/70 px-2 py-1 text-[10px] font-semibold text-[#c85776] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff7fa]">
          Tümünü Gör
        </button>
      </div>
      <div className="relative mt-4 space-y-1.5">
        {items.length === 0 && <div className="py-6 text-center text-sm text-[#352432]/45">Bu dönemde işlem yok.</div>}
        {items.map((e) => {
          const name = e.customerName || e.staffName || '—'
          return (
            <div key={e.id} className="flex items-center gap-3 rounded-2xl border border-transparent px-1.5 py-1.5 transition-colors hover:border-[#ead8df]/70 hover:bg-[#fff7fa]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efbfd0] bg-gradient-to-br from-[#fff3f7] to-[#f4bfd0] text-[10px] font-semibold text-[#8c415b]">
                {initialsOf(name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-[#3c2733]">{name}</div>
                <div className="truncate text-[10px] text-[#9d7386]">{e.description || e.category || 'Tahsilat'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-[12px] tabular-nums text-emerald-700">{formatTL(e.amount)}</div>
                <div className="text-[9px] font-mono text-[#9d7386]/80">
                  {e.date}
                  {e.time ? ` ${e.time}` : ''}
                </div>
              </div>
              <span className="hidden shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-600 xl:inline-flex">
                <CheckCircle2 className="h-2.5 w-2.5" /> Tamamlandı
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FinanceFooter({ lastUpdated, onRefresh, loading }: { lastUpdated: Date | null; onRefresh: () => void; loading: boolean }) {
  const label = lastUpdated
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(lastUpdated)
    : '—'
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[#ead8df]/70 pt-4 sm:flex-row">
      <div className="text-[11px] text-[#9d7386]">
        Raporlar <span className="font-semibold text-[#7c6170]">{label}</span> itibarıyla güncellenmiştir.
      </div>
      <motion.button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        whileTap={{ scale: 0.96 }}
        className="inline-flex items-center gap-2 rounded-xl border border-[#ead8df] bg-white/85 px-3.5 py-2 text-[11px] font-semibold text-[#7c6170] shadow-[0_10px_26px_-22px_rgba(150,78,104,0.5)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776] disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} /> Yenile
      </motion.button>
    </div>
  )
}

export default function RaporlarPage() {
  return (
    <Suspense fallback={null}>
      <RaporlarPageInner />
    </Suspense>
  )
}
