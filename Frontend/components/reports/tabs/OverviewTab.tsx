'use client'

import {
  Activity,
  BarChart3,
  CalendarClock,
  CreditCard,
  Layers3,
  PieChart,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { DonutChart, HeatGrid, RadialGauge, TrendChart, type TrendSeries } from '@/components/reports/ReportCharts'
import { KpiTile, ReportCard, formatValue, type ReportValueUnit } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { ReportSlice, ReportSummary } from '@/lib/reportTypes'

const metricIcons: Record<string, typeof Wallet> = {
  income: TrendingUp,
  expense: TrendingDown,
  net: Wallet,
  margin: PieChart,
  sales: ShoppingBag,
  appointments: CalendarClock,
  completed: Activity,
  occupancy: BarChart3,
  activeCustomers: Users,
  newCustomers: UserPlus,
  avgTicket: Receipt,
  revenuePerCustomer: CreditCard,
}

const metricTones: Record<string, 'rose' | 'mint' | 'gold' | 'violet' | 'peach' | 'slate'> = {
  income: 'mint',
  expense: 'peach',
  net: 'gold',
  margin: 'violet',
  sales: 'rose',
  appointments: 'slate',
  completed: 'mint',
  occupancy: 'violet',
  activeCustomers: 'rose',
  newCustomers: 'mint',
  avgTicket: 'gold',
  revenuePerCustomer: 'rose',
}

/** Gideri düşürmek iyidir — delta rozeti bu metriklerde ters renklenir. */
const invertedMetrics = new Set(['expense'])

export default function OverviewTab({
  data,
  compareLabel,
  rangeLabel,
}: {
  data: ReportSummary | null
  compareLabel?: string
  rangeLabel: string
}) {
  const detail = useMetricDetail()
  const series = data?.series ?? []
  const compareSeries = data?.compareSeries ?? []
  const labels = series.map((p) => p.label)

  /** Dağılım kartlarını modalde kırılım listesi olarak göstermek için. */
  const sliceRows = (slices: ReportSlice[], unit: 'currency' | 'count' = 'currency') => {
    const total = slices.reduce((s, x) => s + (unit === 'currency' ? x.amount : x.count), 0)
    return slices.map((s) => {
      const v = unit === 'currency' ? s.amount : s.count
      return {
        label: s.label,
        value: formatValue(v, unit),
        hint: total > 0 ? `%${Math.round((v / total) * 100)} · ${s.count} işlem` : `${s.count} işlem`,
      }
    })
  }

  const sparkFor = (pick: (p: (typeof series)[number]) => number): number[] => series.map(pick)

  const trendSeries: TrendSeries[] = [
    { key: 'income', label: 'Gelir', color: '#2c7d63', values: series.map((p) => p.income) },
    { key: 'expense', label: 'Gider', color: '#b3453f', values: series.map((p) => p.expense) },
    { key: 'net', label: 'Net Kâr', color: '#c85776', values: series.map((p) => p.net), filled: false },
  ]
  if (compareLabel && compareSeries.length > 0) {
    // Kıyas serisi farklı uzunlukta olabilir (ör. şubat ↔ mart) — grafiğe hizalamak için kırpılır.
    const aligned = labels.map((_, i) => compareSeries[i]?.income ?? 0)
    trendSeries.push({ key: 'compare', label: `${compareLabel} geliri`, color: '#7b52ba', values: aligned, dashed: true, filled: false })
  }

  const metrics = data?.metrics ?? []
  const completionMetric = metrics.find((m) => m.key === 'occupancy')
  const marginMetric = metrics.find((m) => m.key === 'margin')
  const totalAppointments = data?.appointmentStatuses.reduce((s, x) => s + x.count, 0) ?? 0

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {metrics.map((m, i) => {
          const spark =
            m.key === 'income'
              ? sparkFor((p) => p.income)
              : m.key === 'expense'
                ? sparkFor((p) => p.expense)
                : m.key === 'net'
                  ? sparkFor((p) => p.net)
                  : m.key === 'sales'
                    ? sparkFor((p) => p.sales)
                    : m.key === 'appointments'
                      ? sparkFor((p) => p.appointments)
                      : undefined
          return (
            <KpiTile
              key={m.key}
              index={i}
              label={m.label}
              value={m.value}
              unit={m.unit as ReportValueUnit}
              previous={m.previousValue}
              compareLabel={compareLabel}
              hint={m.hint ?? undefined}
              icon={metricIcons[m.key] ?? Layers3}
              tone={metricTones[m.key] ?? 'rose'}
              invert={invertedMetrics.has(m.key)}
              spark={spark}
              onOpen={kpiOpener(detail, m.key, {
                value: m.value,
                unit: m.unit as ReportValueUnit,
                previous: compareLabel ? m.previousValue : undefined,
                compareLabel,
                rangeLabel,
                hint: m.hint ?? undefined,
                invert: invertedMetrics.has(m.key),
                series: spark,
                // Gelir kartında yöntem kırılımını, gider kartında kalem kırılımını da göster.
                breakdown:
                  m.key === 'income'
                    ? sliceRows(data?.paymentMethods ?? [])
                    : m.key === 'expense'
                      ? sliceRows(data?.expenseCategories ?? [])
                      : undefined,
              })}
            />
          )
        })}
      </section>

      <ReportCard
        title="Gelir · Gider · Net Kâr"
        subtitle={compareLabel ? `${rangeLabel} — kesikli çizgi ${compareLabel}` : rangeLabel}
        icon={Activity}
      >
        <TrendChart labels={labels} series={trendSeries} height={280} format={(v) => formatTL(Math.round(v))} />
      </ReportCard>

      <section className="grid gap-4 lg:grid-cols-3">
        <ReportCard
          title="Ödeme Yöntemi"
          subtitle="Tahsilatın dağılımı"
          icon={CreditCard}
          onOpen={() =>
            detail.openKey('overview.paymentMethods', {
              rangeLabel,
              breakdown: sliceRows(data?.paymentMethods ?? []),
            })
          }
        >
          <DonutChart
            slices={(data?.paymentMethods ?? []).map((s) => ({ key: s.key, label: s.label, value: s.amount }))}
            centerLabel="Toplam tahsilat"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>

        <ReportCard
          title="Gider Kalemleri"
          subtitle="Nereye harcandı"
          icon={Receipt}
          onOpen={() =>
            detail.openKey('overview.expenseCategories', {
              rangeLabel,
              breakdown: sliceRows(data?.expenseCategories ?? []),
            })
          }
        >
          <DonutChart
            slices={(data?.expenseCategories ?? []).map((s) => ({ key: s.key, label: s.label, value: s.amount }))}
            centerLabel="Toplam gider"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>

        <ReportCard
          title="Ciro Kaynağı"
          subtitle="Hizmet · paket · ürün payı"
          icon={ShoppingBag}
          onOpen={() =>
            detail.openKey('overview.revenueSources', {
              rangeLabel,
              breakdown: sliceRows(data?.revenueSources ?? []),
            })
          }
        >
          <DonutChart
            slices={(data?.revenueSources ?? []).map((s) => ({ key: s.key, label: s.label, value: s.amount }))}
            centerLabel="Adisyon cirosu"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ReportCard
          title="Randevu Yoğunluğu"
          subtitle="Haftanın günü × saat — koyu renk daha yoğun"
          icon={CalendarClock}
          onOpen={() => detail.openKey('overview.heatmap', { rangeLabel })}
        >
          <HeatGrid cells={data?.heatmap ?? []} />
        </ReportCard>

        <ReportCard title="Dönem Sağlığı" subtitle="Tamamlanma ve kârlılık oranları" icon={BarChart3}>
          <div className="flex flex-wrap items-start justify-around gap-4">
            <RadialGauge
              value={completionMetric?.value ?? 0}
              label="Tamamlanma oranı"
              hint={`${totalAppointments} randevu`}
              color="#2c7d63"
            />
            <RadialGauge
              value={Math.max(0, marginMetric?.value ?? 0)}
              label="Kâr marjı"
              hint={marginMetric && marginMetric.value < 0 ? 'zararda' : 'gelire oranla net'}
              color={(marginMetric?.value ?? 0) >= 0 ? '#c99a2e' : '#b3453f'}
            />
          </div>

          <div className="mt-4 space-y-2 border-t border-[#f2e6eb] pt-3">
            {(data?.appointmentStatuses ?? []).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="text-[#4a3a44]">{s.label}</span>
                <span className="font-bold text-[#2f2230]">
                  {s.count}
                  <span className="ml-1.5 font-medium text-[#705a66]">
                    ({totalAppointments > 0 ? Math.round((s.count / totalAppointments) * 100) : 0}%)
                  </span>
                </span>
              </div>
            ))}
            {(data?.appointmentStatuses.length ?? 0) === 0 && (
              <div className="text-[11.5px] text-[#705a66]">Bu dönemde randevu kaydı yok.</div>
            )}
          </div>
        </ReportCard>
      </section>
    </div>
  )
}
