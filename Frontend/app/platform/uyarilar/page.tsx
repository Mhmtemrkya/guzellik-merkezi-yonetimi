'use client'

import { Suspense, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline, { type SparkTone } from '@/components/dashboard/Sparkline'
import { UsageBar } from '@/components/dashboard/UsageBar'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { apiItems, formatTL, initialsFromName, normalizePlatformUsageSummary, normalizeTenant } from '@/lib/apiMappers'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  MessageSquare,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ApiPlatformUsageSummary, ApiTenant, PagedResult, Tenant, TenantUsage } from '@/lib/types'

type ScopeKey = 'critical' | 'high' | 'all'

const scopeMeta: Record<ScopeKey, { label: string; subtitle: string }> = {
  critical: { label: 'Kritik', subtitle: 'Kritik — limit aşmış kurumlar, acil paket yükseltme gerektirir.' },
  high: { label: 'Yüksek', subtitle: 'Yüksek — %80 ve üzeri kullanım, kısa sürede sınıra ulaşır.' },
  all: { label: 'Tüm uyarılar', subtitle: 'Tüm uyarılar — özellikle kritik ve yüksek öncelikli uyarıların birleşik görünümü.' },
}

const metricIcon: Record<string, LucideIcon> = {
  branches: Building2,
  staff: UsersRound,
  customers: Users,
  appointments: Calendar,
  sms: MessageSquare,
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
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

interface KpiDef {
  label: string
  value: ReactNode
  icon: LucideIcon
  iconCls: string
  tone: SparkTone
  variant: 'line' | 'bars'
  spark: number[]
  pill?: { text: string; cls: string }
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
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border ${kpi.iconCls}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
        </span>
        <Sparkline points={kpi.spark} tone={kpi.tone} variant={kpi.variant} dots={kpi.variant === 'line'} />
      </div>
      <div className="mt-4 armo-stat-value text-[34px] leading-none lg:text-[40px]">{kpi.value}</div>
      <div className="mt-2 text-[12px] font-semibold text-[#3b2330]">{kpi.label}</div>
      {kpi.pill && (
        <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${kpi.pill.cls}`}>
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
          {kpi.pill.text}
        </div>
      )}
    </motion.div>
  )
}

interface UyarilarData {
  usage: ApiPlatformUsageSummary
  tenants: PagedResult<ApiTenant>
}

function UyarilarPageInner() {
  const sp = useSearchParams()
  const scopeParam = sp?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'all'
  const scopeInfo = scopeMeta[scope]

  const { data, loading, error } = useApiQuery<UyarilarData>(
    async () => {
      const [usage, tenants] = await Promise.all([
        platformApi.platformUsage<ApiPlatformUsageSummary>(),
        platformApi.tenants<ApiTenant>({ page: 1, pageSize: 100 }),
      ])
      return { usage, tenants }
    },
    [],
    { initialData: null },
  )

  const summary = normalizePlatformUsageSummary(data?.usage)
  const tenantById = useMemo<Record<string, Tenant>>(() => {
    const m: Record<string, Tenant> = {}
    apiItems(data?.tenants).forEach((t, i) => {
      const n = normalizeTenant(t, i)
      m[n.id] = n
    })
    return m
  }, [data])

  const filteredTenants: TenantUsage[] = useMemo(() => {
    const base =
      scope === 'critical'
        ? summary.tenants.filter((t) => t.hasOverflow)
        : scope === 'high'
          ? summary.tenants.filter((t) => t.hasWarning && !t.hasOverflow)
          : summary.tenants.filter((t) => t.hasOverflow || t.hasWarning)
    return base.slice().sort((a, b) => Number(b.hasOverflow) - Number(a.hasOverflow) || b.maxPercent - a.maxPercent)
  }, [summary, scope])

  const withinLimit = Math.max(0, summary.totalTenants - summary.tenantsOverLimit - summary.tenantsAtWarning)

  const kpis: KpiDef[] = [
    {
      label: 'Toplam kurum',
      value: <AnimatedNumber value={summary.totalTenants} />,
      icon: Building2,
      iconCls: 'border-[#f3cdda] bg-[#fff1f6] text-[#c85776]',
      tone: 'rose',
      variant: 'line',
      spark: [4, 6, 5, 8, 7, 10, 9, 13],
    },
    {
      label: 'Limit aşmış',
      value: <AnimatedNumber value={summary.tenantsOverLimit} />,
      icon: Zap,
      iconCls: 'border-[#f3cdda] bg-[#fff1f6] text-[#c85776]',
      tone: 'rose',
      variant: 'line',
      spark: [6, 6, 7, 6, 6, 7, 6, 6],
      pill: { text: 'acil', cls: 'border-rose-200 bg-rose-50 text-rose-600' },
    },
    {
      label: 'Sınıra yakın',
      value: <AnimatedNumber value={summary.tenantsAtWarning} />,
      icon: AlertTriangle,
      iconCls: 'border-amber-200 bg-amber-50 text-amber-500',
      tone: 'amber',
      variant: 'bars',
      spark: [3, 5, 4, 7, 6, 9, 8, 12],
      pill: { text: '%80+', cls: 'border-amber-200 bg-amber-50 text-amber-600' },
    },
    {
      label: 'Limit dahilinde',
      value: <AnimatedNumber value={withinLimit} />,
      icon: CheckCircle2,
      iconCls: 'border-[#f3cdda] bg-[#fff1f6] text-[#c85776]',
      tone: 'rose',
      variant: 'line',
      spark: [7, 11, 8, 12, 9, 12, 10, 13],
    },
  ]

  const downloadReport = (): void => {
    const header = ['Kurum', 'Plan', 'Aylık (TRY)', 'Durum', 'En yüksek metrik (%)', 'Metrikler']
    const rows = filteredTenants.map((t) => {
      const metrics = t.metrics
        .map((m) => `${m.label} ${m.used}/${m.isUnlimited ? '∞' : m.limit} (${m.percent}%)`)
        .join(' | ')
      return [
        t.tenantName,
        t.planName || 'Atanmamış',
        String(Math.round(t.planMonthlyPriceTRY || 0)),
        t.hasOverflow ? 'Limit aşıldı' : 'Sınıra yakın',
        String(t.maxPercent),
        metrics,
      ]
    })
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `armonessa-uyarilar-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Topbar
        title="Sağlık & Limit Uyarıları"
        subtitle={scopeInfo.subtitle}
        breadcrumbs={['Platform', 'Uyarılar', scopeInfo.label]}
      />
      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        {/* 4 KPI */}
        <motion.section variants={gridContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </motion.section>

        {/* UYARI LİSTESİ */}
        <motion.section variants={cardVariants} initial="hidden" animate="visible" className="armo-card armo-card-luxury">
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-[#ffe0ea]/60 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-[#f1dde6] px-5 py-4">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#c85776]">{scopeInfo.label} · uyarılar</div>
                <div className="mt-1 font-display text-2xl tracking-tight text-[#3b2330]">
                  <AnimatedNumber value={filteredTenants.length} className="armonessa-text-gradient" /> kurum
                </div>
              </div>
              <button
                type="button"
                onClick={downloadReport}
                disabled={!filteredTenants.length}
                className="group inline-flex items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white/70 px-3.5 py-2 text-[12px] font-semibold text-[#a84f69] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff1f6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" /> Detaylı rapor indir
              </button>
            </div>

            <motion.div variants={gridContainer} initial="hidden" animate="visible" className="space-y-3 p-4">
              {filteredTenants.map((t) => {
                const topMetrics = t.metrics.slice(0, 3)
                const domain = tenantById[t.tenantId]?.domain
                return (
                  <motion.div key={t.tenantId} variants={rowVariants}>
                    <Link
                      href="/platform/kurumlar"
                      className="group block rounded-[18px] border border-[#f0dde5] bg-white/70 p-4 shadow-[0_14px_36px_-30px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff7fa]"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        {/* KİMLİK */}
                        <div className="flex min-w-0 items-center gap-3 lg:w-[290px] lg:shrink-0">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] border border-[#f0d5df] bg-[#fff1f6] font-display text-sm text-[#a84f69]">
                            {initialsFromName(t.tenantName)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-[#3b2330]">{t.tenantName}</span>
                              {t.hasOverflow ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[8px] font-mono tracking-widest text-rose-600">
                                  <AlertCircle className="h-2.5 w-2.5" /> LİMİT AŞILDI
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[8px] font-mono tracking-widest text-amber-600">
                                  <AlertTriangle className="h-2.5 w-2.5" /> SINIRA YAKIN
                                </span>
                              )}
                            </div>
                            <div className="mt-1 truncate text-[10px] text-[#9d7386]">
                              <span className="text-[#b08aa0]">Plan</span> · {t.planName || 'Atanmamış'}
                              {domain && <span className="text-[#b08aa0]"> · {domain}</span>}
                            </div>
                            <div className="mt-0.5 font-display text-sm tabular-nums text-[#3b2330]">
                              {t.planMonthlyPriceTRY > 0 ? formatTL(t.planMonthlyPriceTRY) : 'Özel'}{' '}
                              <span className="text-[9px] font-mono text-[#9d7386]">/ay</span>
                            </div>
                          </div>
                        </div>

                        {/* METRİKLER */}
                        <div className="flex flex-1 items-stretch gap-2">
                          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                            {topMetrics.map((m) => (
                              <UsageBar key={m.key} metric={m} icon={metricIcon[m.key]} />
                            ))}
                            <div
                              className={`flex flex-col items-center justify-center rounded-[12px] border px-2 py-2 text-center ${
                                t.hasOverflow ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
                              }`}
                            >
                              <div className={`font-display text-xl tabular-nums ${t.hasOverflow ? 'text-rose-600' : 'text-amber-600'}`}>
                                %{t.maxPercent}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest text-[#9d7386]">
                                <AlertTriangle className="h-2.5 w-2.5" /> en yüksek metrik
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="hidden h-5 w-5 shrink-0 self-center text-[#c89bac] transition-transform group-hover:translate-x-0.5 group-hover:text-[#c85776] lg:block" strokeWidth={1.6} />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}

              {!filteredTenants.length && !loading && (
                <div className="px-5 py-12 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" strokeWidth={1.3} />
                  <div className="mt-3 text-sm text-[#7c6170]">
                    {scope === 'critical'
                      ? 'Limit aşan kurum yok.'
                      : scope === 'high'
                        ? 'Sınıra yakın kurum yok.'
                        : 'Tüm kurumlar paket limitleri dahilinde.'}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </motion.section>
      </div>
    </>
  )
}

export default function UyarilarPage() {
  return (
    <Suspense fallback={null}>
      <UyarilarPageInner />
    </Suspense>
  )
}
