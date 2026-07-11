'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, type Variants } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import CreateTenantDialog, { type CreateTenantFormValues, type CreateTenantPlanOption } from '@/components/dashboard/CreateTenantDialog'
import TenantCredentialsDialog from '@/components/dashboard/TenantCredentialsDialog'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline, { type SparkTone } from '@/components/dashboard/Sparkline'
import { UsageBar } from '@/components/dashboard/UsageBar'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { apiItems, formatTL, initialsFromName, normalizePlatformUsageSummary, normalizeSubscriptionPlan, normalizeTenant, tenantStatusKey } from '@/lib/apiMappers'
import {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Filter,
  Gem,
  KeyRound,
  Landmark,
  Mail,
  Package,
  PauseCircle,
  PenLine,
  Phone,
  Receipt,
  Search,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ApiPlatformUsageSummary, ApiSubscriptionPlan, ApiTenant, ApiTenantCredentials, ApiTenantWithCredentials, NotificationItem, PagedResult, SubscriptionPlan, Tenant, TenantUsage } from '@/lib/types'

const PAGE_SIZE = 10

const gridContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] } },
}

type StatusFilter = 'all' | 'active' | 'trial' | 'paused'

function normalizeScope(s: string | null | undefined): StatusFilter {
  return s === 'active' || s === 'trial' || s === 'paused' ? s : 'all'
}

const filterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'active', label: 'Aktif' },
  { value: 'trial', label: 'Deneme' },
  { value: 'paused', label: 'Askıda' },
]

/** Paket adına göre simge eşlemesi — Overview ile tutarlı. */
function planIcon(name: string): LucideIcon {
  const key = name.toLocaleLowerCase('tr-TR')
  if (key.includes('ai') || key.includes('klinik') || key.includes('clinic')) return Activity
  if (key.includes('premium') || key.includes('pro') || key.includes('elite') || key.includes('gold')) return Gem
  if (key.includes('başlangıç') || key.includes('baslangic') || key.includes('starter') || key.includes('free')) return Crown
  return Package
}

function Status({ status }: { status: string }) {
  const key = tenantStatusKey(status)
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'AKTİF', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
    trial: { label: 'DENEME', cls: 'border-amber-200 bg-amber-50 text-amber-600' },
    paused: { label: 'ASKIDA', cls: 'border-rose-200 bg-rose-50 text-rose-600' },
  }
  const m = map[key] ?? map.active!
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-mono tracking-widest ${m.cls}`}>{m.label}</span>
  )
}

type PeriodTone = 'ok' | 'warn' | 'expired' | 'muted'

/** Kurumun dönem (deneme/aylık/yıllık) etiketini ve kalan süre/bitiş detayını hesaplar. */
function periodInfo(t: Tenant): { label: string; detail: string; tone: PeriodTone } {
  const now = Date.now()
  const daysTo = (iso: string) => Math.ceil((new Date(iso).getTime() - now) / 86_400_000)

  // Deneme: trial durumu veya henüz ücretli döneme geçmemiş trial bitişi olan kurum.
  if (t.status === 'trial' || (t.trialEndsAt && !t.subscriptionPeriod)) {
    if (!t.trialEndsAt) return { label: 'Deneme', detail: 'Girişte başlar', tone: 'muted' }
    const d = daysTo(t.trialEndsAt)
    return { label: 'Deneme', detail: d <= 0 ? 'Süresi doldu' : `${d} gün kaldı`, tone: d <= 0 ? 'expired' : d <= 3 ? 'warn' : 'ok' }
  }

  // Ücretli abonelik (aylık/yıllık).
  if (t.subscriptionPeriod) {
    const label = t.subscriptionPeriod === 'Yearly' ? 'Yıllık' : 'Aylık'
    if (!t.subscriptionEndsAt) return { label, detail: 'Süresiz', tone: 'muted' }
    const d = daysTo(t.subscriptionEndsAt)
    const endStr = new Date(t.subscriptionEndsAt).toLocaleDateString('tr-TR')
    if (d <= 0) return { label, detail: 'Süresi doldu', tone: 'expired' }
    return { label, detail: `${endStr} · ${d} gün`, tone: d <= 14 ? 'warn' : 'ok' }
  }

  return { label: 'Süresiz', detail: '', tone: 'muted' }
}

const periodToneCls: Record<PeriodTone, { badge: string; detail: string }> = {
  ok: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-600', detail: 'text-[#9d7386]' },
  warn: { badge: 'border-amber-200 bg-amber-50 text-amber-600', detail: 'text-amber-600' },
  expired: { badge: 'border-rose-200 bg-rose-50 text-rose-600', detail: 'text-rose-500' },
  muted: { badge: 'border-[#ead8df] bg-[#fff7fa] text-[#9d7386]', detail: 'text-[#b08aa0]' },
}

function PeriodCell({ tenant }: { tenant: Tenant }) {
  const info = periodInfo(tenant)
  const cls = periodToneCls[info.tone]
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8.5px] font-mono tracking-widest ${cls.badge}`}>
        <CalendarClock className="h-2.5 w-2.5" strokeWidth={1.7} /> {info.label.toLocaleUpperCase('tr-TR')}
      </span>
      {info.detail && <span className={`text-[9px] ${cls.detail}`}>{info.detail}</span>}
    </div>
  )
}

/** Düzenleme modalındaki "Dönem" alanının ön-seçimi: kurumun mevcut durumuna göre. */
function currentPeriodValue(t: Tenant): string {
  if (t.status === 'trial' || (t.trialEndsAt && !t.subscriptionPeriod)) return 'Trial'
  if (t.subscriptionPeriod === 'Monthly') return 'Monthly'
  // Yıllık veya dönemsiz/süresiz → varsayılan Yıllık.
  return 'Yearly'
}

/** Dönem alanının yardımcı metni: mevcut dönem + bitiş ve değiştirme uyarısı. */
function periodHelperText(t: Tenant): string {
  const info = periodInfo(t)
  const base = info.detail ? `Mevcut: ${info.label} · ${info.detail}.` : `Mevcut: ${info.label}.`
  return `${base} Paket veya dönemi değiştirirsen abonelik yeniden başlar (bitiş tarihi yenilenir).`
}

interface KpiDef {
  label: string
  sublabel: string
  value: ReactNode
  icon: LucideIcon
  tone: SparkTone
  spark: number[]
}

function KpiCard({ kpi }: { kpi: KpiDef }) {
  const Icon = kpi.icon
  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="armo-card armo-card-luxury armo-lift group p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#f3cdda] bg-[#fff1f6] text-[#c85776]">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
        </span>
        <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#b08aa0]">canlı</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="armo-stat-value text-[34px] leading-none lg:text-[38px]">{kpi.value}</div>
        <Sparkline points={kpi.spark} tone={kpi.tone} />
      </div>
      <div className="mt-3 text-[12px] font-semibold tracking-wide text-[#3b2330]">{kpi.label}</div>
      <div className="mt-0.5 text-[11px] text-[#9d7386]">{kpi.sublabel}</div>
    </motion.div>
  )
}

interface UpdateTenantFormValues {
  name?: string
  plan?: string
  billingPeriod?: string
  status?: string
  domain?: string
  ownerName?: string
  phone?: string
  email?: string
  taxNumber?: string
  taxOffice?: string
  legalName?: string
}

interface KurumlarData {
  tenants: PagedResult<ApiTenant>
  usage: ApiPlatformUsageSummary
  plans: ApiSubscriptionPlan[]
}

export default function PlatformKurumlarPage() {
  const searchParams = useSearchParams()
  const [q, setQ] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => normalizeScope(searchParams?.get('scope')))
  const [filterOpen, setFilterOpen] = useState<boolean>(false)
  const [page, setPage] = useState<number>(1)
  const [ownerCredentials, setOwnerCredentials] = useState<ApiTenantCredentials | null>(null)
  const [resetCredentials, setResetCredentials] = useState<ApiTenantCredentials | null>(null)

  // Sidebar alt linkleri (?scope=active/trial/paused) filtreyi senkronlar
  useEffect(() => {
    setStatusFilter(normalizeScope(searchParams?.get('scope')))
  }, [searchParams])

  const { data, loading, error, reload } = useApiQuery<KurumlarData>(
    async () => {
      const [tenants, usage, plans] = await Promise.all([
        platformApi.tenants<ApiTenant>({ search: q || undefined, page: 1, pageSize: 100 }),
        platformApi.platformUsage<ApiPlatformUsageSummary>(),
        platformApi.subscriptionPlans<ApiSubscriptionPlan>(),
      ])
      return { tenants, usage, plans }
    },
    [q],
    { initialData: null },
  )

  const tenants: Tenant[] = apiItems(data?.tenants).map((tenant, index) => normalizeTenant(tenant, index))
  const usageSummary = normalizePlatformUsageSummary(data?.usage)
  const usageByTenant = useMemo<Record<string, TenantUsage>>(() => {
    const map: Record<string, TenantUsage> = {}
    for (const u of usageSummary.tenants) map[u.tenantId] = u
    return map
  }, [usageSummary])
  const plansList: SubscriptionPlan[] = (data?.plans ?? []).map((p, i) => normalizeSubscriptionPlan(p, i))
  const planOptions = plansList.filter((p) => p.isActive).map((p) => ({ value: p.name, label: `${p.name} · ${p.monthlyPriceTRY === 0 ? 'Özel' : formatTL(p.monthlyPriceTRY)}` }))
  const plans = planOptions.length ? planOptions.map((o) => o.value) : ['Başlangıç', 'Profesyonel', 'Premium', 'AI Klinik', 'Enterprise']
  // Kurum oluşturma diyaloğu için dönem-bazlı tutar gösterebilsin diye aylık/yıllık fiyatlı plan listesi.
  const createPlanOptions: CreateTenantPlanOption[] = plansList
    .filter((p) => p.isActive)
    .map((p) => ({ name: p.name, monthlyPriceTRY: p.monthlyPriceTRY, yearlyPriceTRY: p.yearlyPriceTRY }))

  const activeCount = tenants.filter((t) => t.status === 'active').length
  const trialCount = tenants.filter((t) => t.status === 'trial').length
  const pausedCount = tenants.filter((t) => t.status === 'paused').length
  const totalCustomers = tenants.reduce((s, t) => s + Number(t.customers || 0), 0)

  const kpis: KpiDef[] = [
    { label: 'AKTİF KURUM', sublabel: 'Tüm sistemde aktif kurumlar', value: <AnimatedNumber value={activeCount} />, icon: Building2, tone: 'emerald', spark: [5, 8, 6, 10, 9, 13, 11, 16] },
    { label: 'DENEME', sublabel: 'Deneme sürecindeki kurumlar', value: <AnimatedNumber value={trialCount} />, icon: AlarmClock, tone: 'amber', spark: [6, 7, 6, 8, 7, 9, 12, 14] },
    { label: 'ASKIDA', sublabel: 'Askıda bekleyen kurumlar', value: <AnimatedNumber value={pausedCount} />, icon: PauseCircle, tone: 'violet', spark: [8, 7, 9, 7, 8, 6, 7, 9] },
    { label: 'TOPLAM MÜŞTERİ', sublabel: 'Tüm kurumların toplam müşterisi', value: <AnimatedNumber value={totalCustomers} format={(n) => Math.round(n).toLocaleString('tr-TR')} />, icon: Users, tone: 'rose', spark: [7, 11, 8, 12, 9, 13, 10, 14] },
  ]

  const filtered = statusFilter === 'all' ? tenants : tenants.filter((t) => t.status === statusFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeStart = filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length)

  useEffect(() => {
    setPage(1)
  }, [statusFilter, q])

  const tenantNotifications: NotificationItem[] = tenants
    .filter((t) => t.status !== 'active')
    .map((t) => ({
      title: t.status === 'paused' ? `${t.name} askıda` : `${t.name} deneme sürecinde`,
      description: `${t.plan} planı · ${t.branchCount || t.branches.length} şube`,
      meta: t.status === 'paused' ? 'Kritik' : 'Takip',
      href: '/platform/kurumlar',
    }))

  const tenantStatusToApi = (status: string | undefined): string => {
    if (status === 'trial') return 'Trial'
    if (status === 'paused') return 'Suspended'
    if (status === 'cancelled') return 'Cancelled'
    if (status === 'Active' || status === 'Trial' || status === 'Suspended' || status === 'Cancelled') return status
    return 'Active'
  }
  const createTenantPayload = (values: CreateTenantFormValues): Record<string, unknown> => ({
    name: values.name,
    slug: values.slug,
    plan: values.plan,
    billingPeriod: values.billingPeriod || 'Yearly',
    domain: values.domain || null,
    ownerName: values.ownerName || null,
    ownerEmail: values.ownerEmail || null,
    initialPassword: values.initialPassword || null,
    defaultBranchName: values.defaultBranchName || null,
    defaultBranchCity: values.defaultBranchCity || null,
    phone: values.phone || null,
    email: values.email || null,
  })
  const updateTenantPayload = (values: UpdateTenantFormValues): Record<string, unknown> => ({
    name: values.name,
    plan: values.plan,
    billingPeriod: values.billingPeriod || null,
    status: tenantStatusToApi(values.status),
    domain: values.domain || null,
    ownerName: values.ownerName || null,
    phone: values.phone || null,
    email: values.email || null,
    taxNumber: values.taxNumber || null,
    taxOffice: values.taxOffice || null,
    legalName: values.legalName || null,
  })

  const activeFilterLabel = filterOptions.find((o) => o.value === statusFilter)?.label ?? 'Tümü'

  return (
    <>
      <Topbar
        title="Tüm Kurumlar"
        subtitle="Tenant oluşturma, plan, domain, durum ve limit yönetimi · gerçek Tenant API"
        breadcrumbs={['Platform', 'Kurumlar']}
        pendingCount={tenantNotifications.length}
        notifications={tenantNotifications}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && tenants.length === 0}
          emptyMessage="Platform Tenant API döndü ama kurum kaydı yok."
        />

        {/* 4 KPI */}
        <motion.div variants={gridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </motion.div>

        {/* TENANT LİSTESİ */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="armo-card armo-card-luxury"
        >
          <div className="relative">
            <div className="flex flex-col gap-3 border-b border-[#f1dde6] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]">Tenant listesi</div>
                <div className="mt-1 font-display text-2xl tracking-tight text-[#3b2330]">
                  <AnimatedNumber value={tenants.length} className="beautyassist-text-gradient" /> kurum yönetimi
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b08aa0]" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Kurum ara..."
                    className="min-h-10 w-full rounded-[12px] border border-[#ead8df] bg-white/80 pl-9 pr-3 text-sm text-[#3b2330] outline-none transition-colors placeholder:text-[#b08aa0] focus:border-[#ef9ab5]"
                  />
                </label>

                {/* Durum filtresi */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setFilterOpen((v) => !v)}
                    aria-label="Duruma göre filtrele"
                    className={`relative grid min-h-10 w-10 place-items-center rounded-[12px] border bg-white/80 transition-colors ${
                      statusFilter !== 'all'
                        ? 'border-[#ef9ab5] text-[#c85776]'
                        : 'border-[#ead8df] text-[#9d7386] hover:border-[#ef9ab5] hover:text-[#c85776]'
                    }`}
                  >
                    <Filter className="h-4 w-4" strokeWidth={1.7} />
                    {statusFilter !== 'all' && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#ef6f94]" />}
                  </button>
                  {filterOpen && (
                    <>
                      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setFilterOpen(false)} />
                      <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-44 overflow-hidden rounded-[14px] border border-[#ead8df] bg-white/97 p-1.5 shadow-[0_24px_60px_-30px_rgba(150,78,104,0.5)] backdrop-blur-xl">
                        <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-[#b08aa0]">Duruma göre</div>
                        {filterOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setStatusFilter(opt.value)
                              setFilterOpen(false)
                            }}
                            className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[12px] transition-colors ${
                              statusFilter === opt.value ? 'bg-[#fff1f6] font-semibold text-[#c85776]' : 'text-[#5f4855] hover:bg-[#fff7fa]'
                            }`}
                          >
                            {opt.label}
                            {statusFilter === opt.value && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <CreateTenantDialog
                  plans={createPlanOptions}
                  onCreate={async (values) => {
                    const res = await platformApi.createTenant<ApiTenantWithCredentials>(createTenantPayload(values))
                    await reload()
                    return res
                  }}
                  onCredentials={(creds) => setOwnerCredentials(creds)}
                />
              </div>
            </div>

            {/* Aktif filtre rozeti */}
            {statusFilter !== 'all' && (
              <div className="flex items-center gap-2 border-b border-[#f1dde6] px-5 py-2.5 text-[11px] text-[#7c6170]">
                <span className="font-mono uppercase tracking-widest text-[#b08aa0]">Filtre:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-0.5 font-semibold text-[#c85776]">
                  {activeFilterLabel}
                  <button type="button" onClick={() => setStatusFilter('all')} className="text-[#c85776]/70 transition-colors hover:text-[#c85776]" aria-label="Filtreyi temizle">
                    ×
                  </button>
                </span>
                <span className="text-[#9d7386]">{filtered.length} sonuç</span>
              </div>
            )}

            <div className="overflow-hidden md:overflow-x-auto">
              <div className="md:min-w-[1040px]">
                <div className="hidden grid-cols-12 gap-4 border-b border-[#f1dde6] bg-[#fff7fa]/60 px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#9d7386] md:grid">
                  <div className="col-span-3">Kurum</div>
                  <div className="col-span-2">Plan · Dönem</div>
                  <div className="col-span-4">Kullanım</div>
                  <div className="col-span-1">Durum</div>
                  <div className="col-span-2 text-right">İşlem</div>
                </div>
                <div className="divide-y divide-[#f3e1e9]">
                  {pageItems.map((t) => {
                    const u = usageByTenant[t.id]
                    const topMetrics = u?.metrics.slice(0, 3) ?? []
                    const planMrr = u?.planMonthlyPriceTRY ?? t.subscriptionPlanMonthlyPriceTRY ?? t.mrr
                    const planName = t.subscriptionPlanName || t.plan
                    const PlanIcon = planIcon(planName)
                    return (
                      <div key={t.id} className="grid gap-4 px-4 py-4 text-xs transition-colors hover:bg-[#fff7fa] md:grid-cols-12 md:items-center md:px-5">
                        {/* KURUM */}
                        <div className="flex min-w-0 items-center gap-3 md:col-span-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[#f0d5df] bg-[#fff1f6] font-display text-xs text-[#a84f69]">
                            {initialsFromName(t.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#3b2330] md:truncate">{t.name}</div>
                            <div className="text-[10px] text-[#9d7386] md:truncate">
                              {t.branchCount || t.branches.length} şube · {t.domain}
                            </div>
                            {(t.phone || t.email) && (
                              <div className="mt-0.5 flex items-center gap-2 text-[9px] text-[#b08aa0] md:truncate">
                                {t.phone && (
                                  <span className="inline-flex items-center gap-1">
                                    <Phone className="h-2.5 w-2.5" /> {t.phone}
                                  </span>
                                )}
                                {t.email && (
                                  <span className="inline-flex min-w-0 items-center gap-1 md:truncate">
                                    <Mail className="h-2.5 w-2.5 shrink-0" /> <span className="md:truncate">{t.email}</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* PLAN / MRR */}
                        <div className="min-w-0 md:col-span-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f3cdda] bg-[#fff1f6] px-2 py-0.5 text-[9px] font-mono tracking-widest text-[#c85776]">
                            <PlanIcon className="h-3 w-3" strokeWidth={1.7} /> {planName.toLocaleUpperCase('tr-TR')}
                          </span>
                          <div className="mt-1.5 font-display text-sm tabular-nums text-[#3b2330]">
                            {planMrr === 0 ? 'Özel' : formatTL(planMrr)} <span className="text-[9px] font-mono text-[#9d7386]">/ay</span>
                          </div>
                          <PeriodCell tenant={t} />
                        </div>

                        {/* KULLANIM */}
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 md:col-span-4">
                          {topMetrics.map((m) => (
                            <UsageBar key={m.key} metric={m} compact />
                          ))}
                          {!topMetrics.length && (
                            <div className="col-span-full text-[10px] font-mono uppercase tracking-widest text-[#b08aa0]">paket atanmamış</div>
                          )}
                        </div>

                        {/* DURUM */}
                        <div className="md:col-span-1">
                          <Status status={t.status} />
                        </div>

                        {/* İŞLEM */}
                        <div className="md:col-span-2">
                          <div className="grid grid-cols-2 gap-1.5">
                            <AdminEditDialog
                              triggerVariant="ghost"
                              triggerIcon={PenLine}
                              triggerLabel="DÜZENLE"
                              triggerClassName="!w-full !rounded-[11px] !px-2 !py-2 !text-[9px] hover:!bg-[#fff1f6]"
                              title={`${t.name} kurum profili`}
                              description="Tenant API kaydı."
                              note="PUT /api/platform/tenants/{id} çalışır, ardından liste yenilenir."
                              submitLabel="Kurumu güncelle"
                              onSubmit={async (values) => {
                                await platformApi.updateTenant(t.id, updateTenantPayload(values as UpdateTenantFormValues))
                                await reload()
                              }}
                              fields={[
                                { label: 'Kurum adı', name: 'name', value: t.name },
                                { label: 'Plan', name: 'plan', type: 'select', value: t.plan, options: plans },
                                {
                                  label: 'Dönem',
                                  name: 'billingPeriod',
                                  type: 'select',
                                  value: currentPeriodValue(t),
                                  options: [
                                    { value: 'Trial', label: 'Deneme (14 Gün)' },
                                    { value: 'Monthly', label: 'Aylık' },
                                    { value: 'Yearly', label: 'Yıllık' },
                                  ],
                                  icon: CalendarClock,
                                  helper: periodHelperText(t),
                                },
                                { label: 'Domain', name: 'domain', value: t.domain },
                                { label: 'Yetkili adı', name: 'ownerName', value: t.owner },
                                { label: 'Yasal işletme adı', name: 'legalName', value: t.legalName, icon: Landmark, fullWidth: true, helper: 'Ticari unvan — faturalarda görünür' },
                                { label: 'İletişim telefonu', name: 'phone', value: t.phone, icon: Phone, placeholder: '+90 312 123 45 67', section: 'İletişim & fatura' },
                                { label: 'E-posta', name: 'email', type: 'email', value: t.email, icon: Mail, placeholder: 'info@kurum.com.tr' },
                                { label: 'Vergi numarası', name: 'taxNumber', value: t.taxNumber, icon: Receipt },
                                { label: 'Vergi dairesi', name: 'taxOffice', value: t.taxOffice, icon: Landmark },
                                {
                                  label: 'Durum',
                                  name: 'status',
                                  type: 'select',
                                  value: tenantStatusToApi(t.status),
                                  options: [
                                    { value: 'Active', label: 'Aktif' },
                                    { value: 'Trial', label: 'Deneme' },
                                    { value: 'Suspended', label: 'Askıda' },
                                    { value: 'Cancelled', label: 'İptal' },
                                  ],
                                  helper: 'Askıya alma / iptal için kullanın. Aktif/Deneme dönemi yukarıdaki "Dönem" alanı belirler.',
                                },
                              ]}
                            />
                            <AdminEditDialog
                              triggerVariant="ghost"
                              triggerIcon={ArrowLeftRight}
                              triggerLabel="PLAN DEĞİŞTİR"
                              triggerClassName="!w-full !rounded-[11px] !px-2 !py-2 !text-[9px] hover:!bg-[#fff1f6]"
                              title={`${t.name} · paket / dönem`}
                              description="Kurum hemen yeni paketin limitlerine geçer ve abonelik dönemi yeniden başlar (bitiş = bugün + seçilen dönem). Süre dolunca kurum pasife düşer. Mevcut kullanım yeni limiti aşıyorsa quota uyarısı oluşur."
                              submitLabel="Paketi uygula"
                              onSubmit={async (values) => {
                                const v = values as Record<string, unknown>
                                const planId = String(v.subscriptionPlanId || '')
                                if (!planId) throw new Error('Paket seçilmedi.')
                                const period = String(v.billingPeriod || 'Yearly')
                                await platformApi.assignPlanToTenant(planId, t.id, period)
                                await reload()
                              }}
                              fields={[
                                {
                                  label: 'Yeni paket',
                                  name: 'subscriptionPlanId',
                                  type: 'select',
                                  value: t.subscriptionPlanId || (plansList[0]?.id ?? ''),
                                  options: plansList
                                    .filter((p) => p.isActive)
                                    .map((p) => ({
                                      value: p.id,
                                      label: `${p.name} · ${p.monthlyPriceTRY === 0 ? 'Özel' : formatTL(p.monthlyPriceTRY)} /ay`,
                                    })),
                                  icon: Package,
                                  fullWidth: true,
                                  helper: 'Aktif paketler arasından seç',
                                },
                                {
                                  label: 'Dönem',
                                  name: 'billingPeriod',
                                  type: 'select',
                                  value: t.subscriptionPeriod === 'Monthly' ? 'Monthly' : 'Yearly',
                                  options: [
                                    { value: 'Yearly', label: 'Yıllık' },
                                    { value: 'Monthly', label: 'Aylık' },
                                  ],
                                  icon: CalendarClock,
                                  fullWidth: true,
                                  helper: 'Abonelik bitişi bu döneme göre hesaplanır (yıllık = +1 yıl, aylık = +1 ay).',
                                },
                              ]}
                            />
                            <ConfirmDialog
                              icon={KeyRound}
                              title={`${t.name} · yetkili şifresi sıfırlansın mı?`}
                              description={`${t.owner} için yeni geçici şifre üretilir, aktif oturumları kapanır ve ilk girişte şifresini değiştirmesi zorunlu olur. Geçici şifre yalnızca bir kez gösterilir.`}
                              confirmLabel="Şifreyi sıfırla"
                              cancelLabel="Vazgeç"
                              onConfirm={async () => {
                                const creds = await platformApi.resetTenantOwnerPassword<ApiTenantCredentials>(t.id)
                                setResetCredentials(creds)
                              }}
                              trigger={
                                <button
                                  type="button"
                                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white/70 px-2 py-2 text-[9px] font-mono tracking-widest text-[#7c6170] transition-colors hover:border-[#efbfd0] hover:bg-[#fff1f6] hover:text-[#3b2330]"
                                >
                                  <KeyRound className="h-3 w-3" /> ŞİFRE SIFIRLA
                                </button>
                              }
                            />
                            <ConfirmDialog
                              destructive
                              icon={Trash2}
                              title={`${t.name} silinsin mi?`}
                              description={`Kurum iptal edilir ve listeden kaldırılır; ${t.branchCount || t.branches.length} şube ve tüm verileri pasife alınır. Bu işlemi yalnızca gerçekten gerekiyorsa yap.`}
                              confirmLabel="Kurumu sil"
                              cancelLabel="Vazgeç"
                              onConfirm={async () => {
                                await platformApi.deleteTenant(t.id)
                                await reload()
                              }}
                              trigger={
                                <button
                                  type="button"
                                  aria-label={`${t.name} kurumunu sil`}
                                  className="grid w-full place-items-center rounded-[11px] border border-rose-200 bg-rose-50 px-2 py-2 text-rose-500 transition-colors hover:border-rose-300 hover:bg-rose-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              }
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {!pageItems.length && !loading && (
                    <div className="px-5 py-12 text-center text-sm text-[#9d7386]">
                      {statusFilter === 'all' && !q ? 'Henüz kurum kaydı yok.' : 'Bu kritere uyan kurum bulunamadı.'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer / sayfalama */}
            <div className="flex flex-col gap-3 border-t border-[#f1dde6] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[11px] text-[#9d7386]">
                {rangeStart} - {rangeEnd} / {filtered.length} kurum
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#ead8df] bg-white/70 text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Önceki sayfa"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="grid h-8 min-w-8 place-items-center rounded-[10px] border border-[#efbfd0] bg-[#fff1f6] px-2 text-[12px] font-semibold text-[#c85776] tabular-nums">
                  {safePage}
                </span>
                <span className="text-[11px] text-[#b08aa0]">/ {totalPages}</span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#ead8df] bg-white/70 text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Sonraki sayfa"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <TenantCredentialsDialog credentials={ownerCredentials} onClose={() => setOwnerCredentials(null)} />

      <TenantCredentialsDialog
        credentials={resetCredentials}
        onClose={() => setResetCredentials(null)}
        kicker="Şifre sıfırlandı"
        title="Yeni yetkili giriş bilgileri"
        description="Yeni geçici şifre üretildi; yetkilinin aktif oturumları kapatıldı. Bu bilgiler yalnızca bir kez gösterilir."
      />
    </>
  )
}
