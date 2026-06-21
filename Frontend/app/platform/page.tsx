'use client'

import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline from '@/components/dashboard/Sparkline'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { formatTL, normalizePlatformUsageSummary } from '@/lib/apiMappers'
import { motion, type Variants } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CreditCard,
  Crown,
  Database,
  Gem,
  Package,
  PieChart,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { ApiPlatformUsageSummary, NotificationItem, PlanUsageBreakdown } from '@/lib/types'

const gridContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] } },
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.12 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } },
}

// KPI sparkline şekilleri — her kart için hafif farklı bir trend eğrisi
const kpiSparks: number[][] = [
  [5, 9, 6, 12, 8, 15, 11, 19],
  [9, 6, 11, 8, 14, 10, 17, 21],
  [8, 9, 8, 9, 8, 9, 8, 9],
  [6, 11, 8, 13, 9, 12, 16, 11],
  [11, 8, 12, 7, 9, 8, 6, 5],
]

interface KpiDef {
  label: string
  value: ReactNode
  delta: string
  icon: LucideIcon
  spark: number[]
}

function PlatformStatCard({ kpi }: { kpi: KpiDef }) {
  const Icon = kpi.icon
  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="armo-card armo-card-luxury armo-lift group p-5 lg:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <motion.span
          whileHover={{ scale: 1.06, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 360, damping: 18 }}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-[0_14px_26px_-12px_rgba(193,78,114,0.78)] ring-1 ring-white/45 bg-[radial-gradient(circle_at_30%_24%,#f9c2d6,#e885a8_44%,#c8517a_100%)]"
        >
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} />
        </motion.span>
        <Sparkline points={kpi.spark} />
      </div>
      <div className="mt-5 text-[12px] font-semibold leading-5 text-[#6a4f5c]">{kpi.label}</div>
      <div className="mt-1.5 armo-stat-value text-[34px] leading-none lg:text-[40px]">{kpi.value}</div>
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1 text-[11px] font-semibold text-[#a84f69]">
        <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
        {kpi.delta}
      </div>
    </motion.div>
  )
}

/** Paket adına göre simge eşlemesi (crown / gem / activity). */
function planIcon(b: PlanUsageBreakdown): LucideIcon {
  const key = `${b.planKey} ${b.planName}`.toLocaleLowerCase('tr-TR')
  if (key.includes('ai') || key.includes('klinik') || key.includes('clinic')) return Activity
  if (key.includes('premium') || key.includes('pro') || key.includes('elite') || key.includes('gold')) return Gem
  if (key.includes('başlangıç') || key.includes('baslangic') || key.includes('starter') || key.includes('free')) return Crown
  return Package
}

export default function PlatformDashboard() {
  const { data, loading, error } = useApiQuery<ApiPlatformUsageSummary>(
    () => platformApi.platformUsage<ApiPlatformUsageSummary>(),
    [],
    { initialData: null },
  )

  const summary = normalizePlatformUsageSummary(data)
  const totalTenants = summary.totalTenants
  const activeTenants = summary.activeTenants
  const mrr = summary.monthlyRecurringRevenueTRY
  const coverage = totalTenants > 0 ? Math.round((activeTenants * 100) / totalTenants) : 0

  // Quota uyarıları widget verisi — limit aşan veya %80+ olan kurumlar
  const quotaIssues = summary.tenants
    .filter((t) => t.hasOverflow || t.hasWarning)
    .sort((a, b) => Number(b.hasOverflow) - Number(a.hasOverflow) || b.maxPercent - a.maxPercent)

  const notifications: NotificationItem[] = quotaIssues.slice(0, 5).map((t) => ({
    title: t.hasOverflow ? `${t.tenantName} limit aşmış` : `${t.tenantName} sınıra yakın`,
    description: `${t.planName} · maks. metrik %${t.maxPercent}`,
    meta: t.hasOverflow ? 'Kritik' : 'Uyarı',
    href: '/platform/uyarilar',
  }))

  const kpis: KpiDef[] = [
    { label: 'Toplam Kurum', value: <AnimatedNumber value={totalTenants} />, delta: `${activeTenants} aktif`, icon: Building2, spark: kpiSparks[0]! },
    { label: 'MRR', value: <AnimatedNumber value={mrr} format={(n) => formatTL(Math.round(n))} />, delta: 'aktif kurumlar × paket fiyatı', icon: TrendingUp, spark: kpiSparks[1]! },
    { label: 'Deneme', value: <AnimatedNumber value={summary.trialTenants} />, delta: 'trial sürecindeki kurum', icon: CreditCard, spark: kpiSparks[2]! },
    { label: 'Sınıra Yakın', value: <AnimatedNumber value={summary.tenantsAtWarning} />, delta: '%80+ kullanım', icon: AlertTriangle, spark: kpiSparks[3]! },
    { label: 'Limit Aşmış', value: <AnimatedNumber value={summary.tenantsOverLimit} />, delta: 'acil yükseltme gerek', icon: ShieldCheck, spark: kpiSparks[4]! },
  ]

  const summaryStats: { icon: LucideIcon; value: ReactNode; label: string }[] = [
    { icon: Building2, value: <AnimatedNumber value={totalTenants} />, label: 'Toplam Kurum' },
    { icon: Users, value: <AnimatedNumber value={summary.planBreakdown.length} />, label: 'Aktif Paket' },
    { icon: PieChart, value: <span>%<AnimatedNumber value={coverage} /></span>, label: 'Kapsam Oranı' },
    { icon: Database, value: <AnimatedNumber value={mrr} format={(n) => formatTL(Math.round(n))} />, label: 'Aylık MRR' },
  ]

  return (
    <>
      <Topbar
        title="Platform Overview"
        subtitle="Gerçek tenant kullanımı, paket dağılımı ve kontrat sağlığı"
        breadcrumbs={['Platform', 'Overview']}
        pendingCount={notifications.length}
        notifications={notifications}
      />
      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && totalTenants === 0}
          emptyMessage="Henüz hiç kurum yok. Platform Tenant API ile başla."
        />

        {/* TEK SATIR — 5 KPI */}
        <motion.div
          variants={gridContainer}
          initial="hidden"
          animate="visible"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        >
          {kpis.map((kpi) => (
            <PlatformStatCard key={kpi.label} kpi={kpi} />
          ))}
        </motion.div>

        <section className="grid gap-3 xl:grid-cols-[1fr_.55fr]">
          {/* SOL — Plan dağılımı + her planın geliri + alt özet şeridi */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="armo-card armo-card-luxury"
          >
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-[#ffdce8]/55 blur-3xl" />

              <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-[#f1dde6] px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]">
                    <Sparkles className="h-3.5 w-3.5" /> Plan dağılımı
                  </div>
                  <div className="mt-1.5 font-display text-2xl tracking-tight text-[#3b2330]">
                    <AnimatedNumber value={summary.planBreakdown.length} className="armonessa-text-gradient" /> aktif paket
                  </div>
                </div>
                <Link
                  href="/platform/planlar"
                  className="group inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-white/70 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#a84f69] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff1f6]"
                >
                  plan kataloğu
                  <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>

              <motion.div variants={listContainer} initial="hidden" animate="visible" className="divide-y divide-[#f3e1e9]">
                {summary.planBreakdown.map((b) => {
                  const share = totalTenants > 0 ? Math.round((b.tenantCount * 100) / totalTenants) : 0
                  const PlanIcon = planIcon(b)
                  return (
                    <motion.div
                      key={b.planId ?? b.planKey}
                      variants={listRow}
                      className="grid items-center gap-4 px-5 py-4 transition-colors hover:bg-[#fff7fa] md:grid-cols-12"
                    >
                      <div className="flex items-center gap-3 md:col-span-4">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f3cdda] bg-[#fff1f6] text-[#c85776]">
                          <PlanIcon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#3b2330]">{b.planName}</div>
                          <div className="mt-0.5 truncate text-[10px] font-mono uppercase tracking-widest text-[#9d7386]">
                            {b.planKey || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="md:col-span-5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[#9d7386]">
                          <span>{b.tenantCount} kurum</span>
                          <span className="text-[#a84f69]">%{share}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f6e3ea]">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${share}%` }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                            className="h-full rounded-full bg-gradient-to-r from-[#f7b6cb] to-[#ef6f94]"
                          />
                        </div>
                      </div>
                      <div className="text-right md:col-span-3">
                        <div className="font-display tabular-nums text-[#3b2330]">{formatTL(Math.round(b.monthlyRevenueTRY))}</div>
                        <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-[#9d7386]">aylık</div>
                      </div>
                    </motion.div>
                  )
                })}
                {!summary.planBreakdown.length && !loading && (
                  <div className="px-5 py-12 text-center text-sm text-[#9d7386]">Henüz pakete bağlı kurum yok.</div>
                )}
              </motion.div>

              {/* ALT ÖZET ŞERİDİ */}
              <div className="px-5 pb-5 pt-4">
                <div className="grid grid-cols-2 gap-4 rounded-[18px] border border-[#f1dde6] bg-gradient-to-br from-[#fff6fa] to-white/60 p-4 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-[#f1dde6]">
                  {summaryStats.map((s) => {
                    const Icon = s.icon
                    return (
                      <div key={s.label} className="flex items-center gap-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border border-[#f3cdda] bg-[#fff1f6] text-[#c85776]">
                          <Icon className="h-4 w-4" strokeWidth={1.6} />
                        </span>
                        <div className="min-w-0">
                          <div className="font-display text-lg leading-none text-[#3b2330] tabular-nums">{s.value}</div>
                          <div className="mt-1 truncate text-[10px] text-[#9d7386]">{s.label}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>

          {/* SAĞ — Quota uyarıları + tenant durumu + hızlı navigasyon */}
          <div className="space-y-3">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.26 }}
              className="armo-card armo-card-luxury"
            >
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#ffe0ea]/70 blur-3xl" />
                <div className="relative flex items-center justify-between border-b border-[#f1dde6] px-5 py-4">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]">
                    <AlertTriangle className="h-4 w-4" /> Quota Uyarıları
                  </div>
                  <Link
                    href="/platform/uyarilar"
                    className="text-[10px] font-mono uppercase tracking-widest text-[#9d7386] transition-colors hover:text-[#c85776]"
                  >
                    tümü →
                  </Link>
                </div>
                <div className="divide-y divide-[#f3e1e9]">
                  {quotaIssues.slice(0, 5).map((t) => (
                    <div key={t.tenantId} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[12px] font-semibold text-[#3b2330]">{t.tenantName}</div>
                        <span
                          className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${
                            t.hasOverflow
                              ? 'border-rose-200 bg-rose-50 text-rose-600'
                              : 'border-amber-200 bg-amber-50 text-amber-600'
                          }`}
                        >
                          %{t.maxPercent}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] font-mono text-[#9d7386]">{t.planName || 'Atanmamış'}</div>
                    </div>
                  ))}
                  {!quotaIssues.length && !loading && (
                    <div className="px-5 py-8 text-center text-[11px] text-[#9d7386]">
                      <BadgeCheck className="mx-auto mb-2 h-6 w-6 text-emerald-400" strokeWidth={1.3} />
                      Tüm kurumlar paket limitleri dahilinde
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.34 }}
              className="armo-card armo-card-luxury p-5"
            >
              <div className="relative">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]">
                  <Activity className="h-4 w-4" /> Tenant durumu
                </div>
                <div className="mt-4 space-y-2.5 text-sm text-[#5f4855]">
                  <Row label="Aktif" value={activeTenants} tone="emerald" />
                  <Row label="Deneme" value={summary.trialTenants} tone="amber" />
                  <Row label="Pasif / İptal" value={summary.pausedTenants} tone="rose" last />
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.42 }}
              className="armo-card armo-card-luxury p-5"
            >
              <div className="relative">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]">
                  <Users className="h-4 w-4" /> Hızlı navigasyon
                </div>
                <div className="mt-3 grid gap-2">
                  <NavLink href="/platform/kurumlar" label="Kurumlar (usage + plan)" />
                  <NavLink href="/platform/planlar" label="Plan Kataloğu (CRUD)" />
                  <NavLink href="/platform/finans" label="Plan başına gelir" />
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  )
}

function Row({
  label,
  value,
  tone,
  last = false,
}: {
  label: string
  value: number
  tone: 'emerald' | 'amber' | 'rose'
  last?: boolean
}) {
  const cls = tone === 'emerald' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className={`flex items-center justify-between ${last ? '' : 'border-b border-[#f3e1e9] pb-2.5'}`}>
      <span className="inline-flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${cls}`} /> {label}
      </span>
      <span className="font-display tabular-nums text-[#3b2330]">
        <AnimatedNumber value={value} />
      </span>
    </div>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between rounded-[14px] border border-[#f0dde5] bg-[#fff7fa]/80 px-3 py-2.5 text-[12px] text-[#5f4855] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff1f6] hover:text-[#3b2330]"
    >
      {label}
      <ArrowUpRight className="h-3.5 w-3.5 text-[#b56c82] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  )
}
