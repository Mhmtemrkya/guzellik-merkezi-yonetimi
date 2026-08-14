'use client'

import {
  CalendarClock,
  CreditCard,
  Layers3,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { DonutChart, HeatGrid } from '@/components/reports/ReportCharts'
import { KpiTile, ReportCard, formatValue, type ReportValueUnit } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { ReportSlice, ReportSummary } from '@/lib/reportTypes'

// Kart seti SUNUCUDAN gelir (bkz. ReportsService.BuildSummaryMetrics); buradaki tablolar yalnız
// ikon/renk eşlemesidir. Tanımsız anahtar varsayılana düşer, kart yine çizilir.
const metricIcons: Record<string, typeof Wallet> = {
  income: TrendingUp,
  expense: TrendingDown,
  openReceivable: CreditCard,
  sales: ShoppingBag,
  appointments: CalendarClock,
  activeCustomers: Users,
}

const metricTones: Record<string, 'rose' | 'mint' | 'gold' | 'violet' | 'peach' | 'slate'> = {
  income: 'mint',
  expense: 'peach',
  openReceivable: 'gold',
  sales: 'rose',
  appointments: 'slate',
  activeCustomers: 'violet',
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

  const metrics = data?.metrics ?? []
  const totalAppointments = data?.appointmentStatuses.reduce((s, x) => s + x.count, 0) ?? 0

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {/* KART İÇİ MİNİ EĞRİ (spark) VERİLMEZ: raporlar sayfasında çizgi/alan eğrisi
            gösterilmiyor (kurum tercihi) — pano kartlarındaki sparkline'lar yerinde kalır. */}
        {metrics.map((m, i) => (
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
              onOpen={kpiOpener(detail, m.key, {
                value: m.value,
                unit: m.unit as ReportValueUnit,
                previous: compareLabel ? m.previousValue : undefined,
                compareLabel,
                rangeLabel,
                hint: m.hint ?? undefined,
                invert: invertedMetrics.has(m.key),
                // Gelir kartında yöntem kırılımını, gider kartında kalem kırılımını da göster.
                breakdown:
                  m.key === 'income'
                    ? sliceRows(data?.paymentMethods ?? [])
                    : m.key === 'expense'
                      ? sliceRows(data?.expenseCategories ?? [])
                      : undefined,
              })}
            />
        ))}
      </section>

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

      {/* "Randevu Durumu" kartı KALDIRILDI (önce "Dönem Sağlığı" idi); yoğunluk haritası
          yanında dar kalıyordu, artık satırın tamamını kullanıyor. */}
      <ReportCard
        title="Randevu Yoğunluğu"
        subtitle={`Haftanın günü × saat — koyu renk daha yoğun · ${totalAppointments} randevu · ${rangeLabel}`}
        icon={CalendarClock}
        onOpen={() => detail.openKey('overview.heatmap', { rangeLabel })}
      >
        <HeatGrid cells={data?.heatmap ?? []} />
      </ReportCard>
    </div>
  )
}
