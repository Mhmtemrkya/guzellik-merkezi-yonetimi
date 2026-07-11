'use client'

import { Suspense, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline, { type SparkTone } from '@/components/dashboard/Sparkline'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { formatTL, normalizeFeatureCatalog, normalizePlatformUsageSummary, normalizeSubscriptionPlan } from '@/lib/apiMappers'
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Package,
  Share2,
  Star,
  Target,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { motion, type Variants } from 'framer-motion'
import type { ApiFeatureCatalog, ApiPlatformUsageSummary, ApiSubscriptionPlan, SubscriptionPlan } from '@/lib/types'

type ScopeKey = 'overview' | 'plans'

const scopeMeta: Record<ScopeKey, { label: string }> = {
  overview: { label: 'Genel görünüm' },
  plans: { label: 'Plan bazlı gelir' },
}

const gridContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] } },
}
const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } },
}

function limitDisplay(n: number): string {
  return n < 0 ? '∞' : n.toLocaleString('tr-TR')
}

function planIcon(name: string): LucideIcon {
  const key = name.toLocaleLowerCase('tr-TR')
  if (key.includes('ai') || key.includes('klinik')) return Target
  if (key.includes('premium')) return Star
  if (key.includes('enterprise') || key.includes('özel')) return Building2
  return Package
}

interface KpiDef {
  label: string
  value: ReactNode
  delta: string
  icon: LucideIcon
  tone: SparkTone
  variant: 'line' | 'bars'
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
      <div className="flex items-stretch justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#f3cdda] bg-[#fff1f6] text-[#c85776]">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-[#6a4f5c]">{kpi.label}</div>
          <div className="mt-1 armo-stat-value text-[26px] leading-none lg:text-[32px]">{kpi.value}</div>
          <div className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1 text-[11px] font-semibold text-[#a84f69]">
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
            {kpi.delta}
          </div>
        </div>
        <div className="hidden flex-1 items-end justify-end sm:flex">
          <Sparkline points={kpi.spark} tone={kpi.tone} variant={kpi.variant} width={170} height={88} className="h-[88px] w-full max-w-[190px] overflow-visible" />
        </div>
      </div>
    </motion.div>
  )
}

function PlanCatalogCard({
  plan,
  bestSeller,
  featureLabelMap,
  spark,
}: {
  plan: SubscriptionPlan
  bestSeller: boolean
  featureLabelMap: Map<string, string>
  spark: number[]
}) {
  const Icon = planIcon(plan.name)
  const revenue = plan.monthlyPriceTRY * plan.tenantCount
  const visibleFeatures = plan.features.slice(0, 2)
  const remaining = Math.max(0, plan.features.length - visibleFeatures.length)
  const isCustom = plan.monthlyPriceTRY === 0
  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`armo-card armo-card-luxury armo-lift group relative flex h-full flex-col overflow-hidden ${bestSeller ? 'ring-1 ring-[#ef9ab5]' : ''}`}
    >
      {/* EN ÇOK SATILAN — entegre üst şerit (madalya + etiket + kurum) */}
      {bestSeller && (
        <div className="relative z-10 flex items-center justify-between gap-2 bg-gradient-to-r from-[#f43f5e] via-[#ec4f7e] to-[#d65f83] px-4 py-2">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
            <img src="/best-seller-badge.png" alt="" className="h-8 w-auto -my-1 drop-shadow-[0_4px_8px_rgba(120,20,40,0.4)]" />
            En çok satılan
          </span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-semibold text-white">{plan.tenantCount} kurum</span>
        </div>
      )}

      <div className="relative z-10 flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#c85776]">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.7} /> {plan.planKey || '—'}
          </span>
          {!bestSeller && (
            <span className="rounded-full border border-[#f0dde5] bg-[#fff7fa] px-2 py-0.5 text-[9px] font-mono text-[#9d7386]">{plan.tenantCount} kurum</span>
          )}
        </div>

        <div className="mt-3 font-display text-lg tracking-tight text-[#3b2330]">{plan.name}</div>
        <div className="mt-1">
          {isCustom ? (
            <span className="font-display text-xl beautyassist-text-gradient">Özel fiyatlandırma</span>
          ) : (
            <span className="font-display text-2xl tabular-nums beautyassist-text-gradient">
              {formatTL(plan.monthlyPriceTRY)} <span className="text-[11px] font-mono text-[#9d7386]">/ay</span>
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#f0dde5] bg-[#fff7fa]/70 px-2 py-1.5 text-[10px] text-[#5f4855]">
            <Building2 className="h-3 w-3 text-[#c85776]" /> {limitDisplay(plan.maxBranches)} şube
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#f0dde5] bg-[#fff7fa]/70 px-2 py-1.5 text-[10px] text-[#5f4855]">
            <Users className="h-3 w-3 text-[#c85776]" /> {limitDisplay(plan.maxCustomers)} müşteri
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {visibleFeatures.map((f) => (
            <span key={f} className="rounded-full border border-[#f3cdda] bg-[#fff1f6] px-2 py-0.5 text-[9px] font-medium text-[#a84f69]">
              {featureLabelMap.get(f) || f}
            </span>
          ))}
          {remaining > 0 && (
            <span className="rounded-full border border-[#efbfd0] bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-[#c85776]">+{remaining}</span>
          )}
          {!plan.features.length && <span className="text-[10px] text-[#b08aa0]">özellik atanmamış</span>}
        </div>

        <div className="mt-auto flex items-end justify-between border-t border-[#f3e1e9] pt-3">
          <div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-[#9d7386]">Aylık gelir</div>
            <div className="mt-0.5 font-display text-base tabular-nums text-[#3b2330]">{formatTL(Math.round(revenue))}</div>
          </div>
          <Sparkline points={spark} tone="rose" width={66} height={26} className="h-7 w-[66px] overflow-visible" />
        </div>
      </div>
    </motion.div>
  )
}

interface FinansData {
  usage: ApiPlatformUsageSummary
  plans: ApiSubscriptionPlan[]
  catalog: ApiFeatureCatalog
}

function FinansPageInner() {
  const sp = useSearchParams()
  const scopeParam = sp?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'overview'
  const scopeInfo = scopeMeta[scope]

  const { data, loading, error } = useApiQuery<FinansData>(
    async () => {
      const [usage, plans, catalog] = await Promise.all([
        platformApi.platformUsage<ApiPlatformUsageSummary>(),
        platformApi.subscriptionPlans<ApiSubscriptionPlan>(),
        platformApi.featuresCatalog<ApiFeatureCatalog>(),
      ])
      return { usage, plans, catalog }
    },
    [],
    { initialData: null },
  )

  const usage = normalizePlatformUsageSummary(data?.usage)
  const plans: SubscriptionPlan[] = useMemo(() => (data?.plans ?? []).map((p, i) => normalizeSubscriptionPlan(p, i)), [data])
  const featureLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    normalizeFeatureCatalog(data?.catalog).forEach((f) => map.set(f.key, f.name))
    return map
  }, [data])

  const totalMrr = usage.monthlyRecurringRevenueTRY
  const arr = totalMrr * 12
  const arpu = usage.activeTenants > 0 ? totalMrr / usage.activeTenants : 0
  const conversion = usage.totalTenants > 0 ? Math.round((usage.activeTenants * 100) / usage.totalTenants) : 0

  const breakdown = usage.planBreakdown.slice().sort((a, b) => b.monthlyRevenueTRY - a.monthlyRevenueTRY)

  const catalogPlans = plans
    .filter((p) => p.isActive)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || (a.monthlyPriceTRY || Infinity) - (b.monthlyPriceTRY || Infinity))
  const sortedByTenants = [...catalogPlans].sort((a, b) => b.tenantCount - a.tenantCount)
  const bestSellerId = (sortedByTenants[0]?.tenantCount ?? 0) > 0 ? sortedByTenants[0]!.id : null

  const kpis: KpiDef[] = [
    { label: 'MRR', value: <AnimatedNumber value={totalMrr} format={(n) => formatTL(Math.round(n))} />, delta: `${usage.activeTenants} aktif abonelik`, icon: TrendingUp, tone: 'rose', variant: 'line', spark: [3, 5, 4, 7, 6, 9, 8, 11, 10, 14, 13, 17] },
    { label: 'ARR (yıllık)', value: <AnimatedNumber value={arr} format={(n) => formatTL(Math.round(n))} />, delta: 'MRR × 12 yıllık', icon: Wallet, tone: 'rose', variant: 'line', spark: [2, 4, 3, 6, 8, 7, 10, 12, 11, 15, 18, 21] },
    { label: 'ARPU', value: <AnimatedNumber value={arpu} format={(n) => formatTL(Math.round(n))} />, delta: 'kurum başına ortalama', icon: Share2, tone: 'rose', variant: 'line', spark: [5, 6, 5, 8, 7, 9, 8, 10, 12, 11, 13, 15] },
    { label: 'Aktif dönüşüm', value: `%${conversion}`, delta: `${usage.trialTenants} deneme`, icon: Target, tone: 'rose', variant: 'bars', spark: [3, 5, 4, 7, 6, 9, 8, 12, 11, 14, 16, 19] },
  ]

  return (
    <>
      <Topbar
        title="MRR & Abonelik"
        subtitle={`Plan kataloğu canlı gelir ve dağılım analizi · ${scopeInfo.label}`}
        breadcrumbs={['Platform', 'Finans', scopeInfo.label]}
      />
      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        {/* 4 KPI */}
        <motion.section variants={gridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </motion.section>

        {/* PLAN BAŞINA GELİR */}
        <motion.section variants={cardVariants} initial="hidden" animate="visible" className="armo-card armo-card-luxury">
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-[#ffe0ea]/60 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-[#f1dde6] px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]">
                  <Package className="h-3.5 w-3.5" /> Plan başına gelir
                </div>
                <div className="mt-1 font-display text-2xl tracking-tight text-[#3b2330]">
                  <AnimatedNumber value={breakdown.length} className="beautyassist-text-gradient" /> paket aktif
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  title="Anlık veri — tarih aralığı filtresi yakında"
                  className="hidden items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white/70 px-3 py-2 text-[11px] font-medium text-[#9d7386] sm:inline-flex"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-[#c85776]" /> Son 30 gün
                </span>
                <Link
                  href="/platform/planlar"
                  className="group inline-flex items-center gap-1.5 rounded-[12px] border border-[#efbfd0] bg-white/70 px-3.5 py-2 text-[11px] font-mono uppercase tracking-widest text-[#a84f69] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff1f6]"
                >
                  Kataloğu yönet <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>

            {/* sütun başlıkları */}
            <div className="hidden grid-cols-12 gap-4 px-5 pb-2 pt-3 text-[9px] font-mono uppercase tracking-widest text-[#9d7386] md:grid">
              <div className="col-span-5">Plan</div>
              <div className="col-span-4 text-center">Gelir katkısı</div>
              <div className="col-span-3 text-right">Aylık gelir</div>
            </div>

            <motion.div variants={gridContainer} initial="hidden" animate="visible" className="divide-y divide-[#f3e1e9]">
              {breakdown.map((b) => {
                const share = totalMrr > 0 ? Math.round((b.monthlyRevenueTRY * 100) / totalMrr) : 0
                return (
                  <motion.div key={b.planId ?? b.planKey} variants={rowVariants}>
                    <Link href="/platform/planlar" className="group block px-5 py-4 transition-colors hover:bg-[#fff7fa]">
                      <div className="grid items-center gap-4 md:grid-cols-12">
                        <div className="md:col-span-5">
                          <div className="text-sm font-semibold text-[#3b2330]">{b.planName}</div>
                          <div className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-[#9d7386]">
                            {b.planKey || '—'} · {b.tenantCount} kurum
                          </div>
                        </div>
                        <div className="flex md:col-span-4 md:justify-center">
                          <span className="inline-flex items-center rounded-full border border-[#f3cdda] bg-[#fff1f6] px-3 py-1 text-[12px] font-semibold text-[#c85776] tabular-nums">
                            %{share}
                          </span>
                        </div>
                        <div className="flex items-center justify-between md:col-span-3 md:justify-end md:gap-3">
                          <div className="text-right">
                            <div className="font-display text-base tabular-nums beautyassist-text-gradient">{formatTL(Math.round(b.monthlyRevenueTRY))}</div>
                            <div className="text-[9px] font-mono uppercase tracking-widest text-[#9d7386]">%{share} MRR payı</div>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#c89bac] transition-transform group-hover:translate-x-0.5 group-hover:text-[#c85776]" strokeWidth={1.7} />
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#f6e3ea] md:max-w-[62%]">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${share}%` }}
                          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                          className="h-full rounded-full bg-gradient-to-r from-[#f7b6cb] to-[#ef6f94]"
                        />
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
              {!breakdown.length && !loading && (
                <div className="px-5 py-10 text-center text-[12px] text-[#9d7386]">Henüz pakete bağlı kurum yok.</div>
              )}
            </motion.div>

            <div className="flex items-center justify-center gap-2 border-t border-[#f1dde6] px-5 py-3 text-center text-[11px] text-[#7c6170]">
              <Package className="h-3.5 w-3.5 text-[#c85776]" />
              Toplam MRR: <span className="font-display tabular-nums text-[#c85776]">{formatTL(Math.round(totalMrr))}</span>
              <span className="text-[#c89bac]">·</span> {breakdown.length} aktif paket
              <span className="text-[#c89bac]">·</span> {usage.totalTenants} kurum
            </div>
          </div>
        </motion.section>

        {/* PLAN KATALOĞU KARTLARI */}
        <motion.section variants={gridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {catalogPlans.map((p, i) => (
            <PlanCatalogCard
              key={p.id}
              plan={p}
              bestSeller={p.id === bestSellerId}
              featureLabelMap={featureLabelMap}
              spark={p.tenantCount > 0 ? [4, 6, 5, 8, 7, 10, 9, 12] : [6, 5, 6, 5, 6, 5, 6, 5].map((n) => n + (i % 2))}
            />
          ))}
          {!catalogPlans.length && !loading && (
            <div className="col-span-full rounded-[18px] border border-[#f0dde5] bg-white/60 p-12 text-center text-sm text-[#9d7386]">
              Henüz aktif paket yok.
            </div>
          )}
        </motion.section>
      </div>
    </>
  )
}

export default function FinansPage() {
  return (
    <Suspense fallback={null}>
      <FinansPageInner />
    </Suspense>
  )
}
