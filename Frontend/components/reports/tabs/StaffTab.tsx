'use client'

/**
 * Personel performansı: randevu karnesi, uygulanan seans, satış cirosu, komisyon ve puan.
 * Karşılaştırma açıkken her satırda önceki dönem farkı da görünür.
 */

import { useMemo, useState } from 'react'
import { Activity, Award, CalendarX2, Clock, Star, TrendingUp, UserCheck, UserCog, Wallet } from 'lucide-react'
import { DonutChart, RankBars, ComparisonBars } from '@/components/reports/ReportCharts'
import { DeltaBadge, KpiTile, Pill, ReportCard, ReportTable, formatValue, initials } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { StaffReport, StaffReportRow } from '@/lib/reportTypes'

type SortKey = 'total' | 'serviceRevenue' | 'salesAmount' | 'completed' | 'rating' | 'commission'

const sortLabels: Record<SortKey, string> = {
  total: 'Toplam katkı',
  serviceRevenue: 'Uygulama cirosu',
  salesAmount: 'Satış cirosu',
  completed: 'Tamamlanan',
  rating: 'Puan',
  commission: 'Komisyon',
}

export default function StaffTab({
  data,
  compareLabel,
  rangeLabel,
}: {
  data: StaffReport | null
  compareLabel?: string
  rangeLabel: string
}) {
  const detail = useMetricDetail()
  const [sort, setSort] = useState<SortKey>('total')
  const rows = data?.rows ?? []

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      switch (sort) {
        case 'serviceRevenue':
          return b.serviceRevenue - a.serviceRevenue
        case 'salesAmount':
          return b.salesAmount - a.salesAmount
        case 'completed':
          return b.completedCount - a.completedCount
        case 'rating':
          return b.averageRating - a.averageRating || b.ratingCount - a.ratingCount
        case 'commission':
          return b.commissionEarned - a.commissionEarned
        default:
          return b.serviceRevenue + b.salesAmount - (a.serviceRevenue + a.salesAmount)
      }
    })
    return copy
  }, [rows, sort])

  const totalContribution = (data?.totalServiceRevenue ?? 0) + (data?.totalSalesAmount ?? 0)
  const previousContribution = (data?.previousTotalServiceRevenue ?? 0) + (data?.previousTotalSalesAmount ?? 0)

  const topByContribution = sorted.slice(0, 8)

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'staff.contribution', label: 'Toplam Katkı', value: totalContribution, prev: previousContribution, unit: 'currency', icon: TrendingUp, tone: 'rose', hint: 'uygulama + satış cirosu' },
            { key: 'staff.serviceRevenue', label: 'Uygulama Cirosu', value: data?.totalServiceRevenue ?? 0, prev: data?.previousTotalServiceRevenue ?? 0, unit: 'currency', icon: Activity, tone: 'mint', hint: 'tamamlanan randevular' },
            { key: 'staff.salesAmount', label: 'Satış Cirosu', value: data?.totalSalesAmount ?? 0, prev: data?.previousTotalSalesAmount ?? 0, unit: 'currency', icon: UserCheck, tone: 'violet', hint: 'personelin sattığı paket/hizmet' },
            { key: 'staff.commission', label: 'Komisyon', value: data?.totalCommission ?? 0, prev: undefined, unit: 'currency', icon: Wallet, tone: 'gold', hint: 'dönemde hak edilen prim' },
            { key: 'staff.serviceRevenue', label: 'Tamamlanan İşlem', value: data?.totalCompleted ?? 0, prev: data?.previousTotalCompleted ?? 0, unit: 'count', icon: Award, tone: 'mint', hint: `${data?.totalAppointments ?? 0} randevudan` },
            { key: 'staff.workedMinutes', label: 'Çalışılan Süre', value: data?.totalWorkedMinutes ?? 0, prev: undefined, unit: 'duration', icon: Clock, tone: 'slate', hint: 'tamamlanan randevu süreleri' },
          ] as const
        ).map((k, i) => (
          <KpiTile
            key={k.label}
            index={i}
            label={k.label}
            value={k.value}
            unit={k.unit}
            previous={k.prev}
            compareLabel={compareLabel}
            icon={k.icon}
            tone={k.tone}
            hint={k.hint}
            onOpen={kpiOpener(detail, k.key, {
              value: k.value,
              unit: k.unit,
              previous: compareLabel ? k.prev : undefined,
              compareLabel,
              rangeLabel,
              hint: k.hint,
              // Personel bazlı kırılım — hangi personel ne kadar katkı yaptı.
              breakdown: sorted.slice(0, 12).map((r) => ({
                label: r.staffName,
                value:
                  k.unit === 'currency'
                    ? formatTL(Math.round(k.key === 'staff.salesAmount' ? r.salesAmount : k.key === 'staff.commission' ? r.commissionEarned : k.key === 'staff.contribution' ? r.serviceRevenue + r.salesAmount : r.serviceRevenue))
                    : k.unit === 'duration'
                      ? formatValue(r.workedMinutes, 'duration')
                      : String(r.completedCount),
                hint: `${r.completedCount}/${r.appointmentCount} randevu · ${r.customerCount} müşteri`,
              })),
            })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ReportCard title="Ciro Payı" subtitle="Personelin toplam katkıdaki payı" icon={UserCog}>
          <DonutChart
            slices={topByContribution.map((r) => ({
              key: r.staffMemberId,
              label: r.staffName,
              value: r.serviceRevenue + r.salesAmount,
            }))}
            centerLabel="Toplam katkı"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>

        <ReportCard title="En Çok İş Bitiren" subtitle="Tamamlanan randevu adedi" icon={Activity}>
          <RankBars
            items={[...rows]
              .sort((a, b) => b.completedCount - a.completedCount)
              .slice(0, 8)
              .map((r) => ({
                key: r.staffMemberId,
                label: r.staffName,
                value: r.completedCount,
                hint: `${r.customerCount} müşteri · ${formatValue(r.workedMinutes, 'duration')}`,
              }))}
            format={(v) => `${Math.round(v)} işlem`}
            emptyText="Bu dönemde tamamlanan randevu yok."
          />
        </ReportCard>

        {/* İŞLEM SAYISININ PARASAL KARŞILIĞI — yan yana okunsun diye hemen yanında durur.
            Çok iş yapan her zaman çok ciro üretmez (ör. kısa/ucuz işlemler); iki grafiği
            karşılaştırınca bu fark görünür hâle gelir. */}
        <ReportCard title="En Çok Üreten" subtitle="Uygulama + satış cirosu" icon={Wallet}>
          <RankBars
            items={[...rows]
              .sort((a, b) => b.serviceRevenue + b.salesAmount - (a.serviceRevenue + a.salesAmount))
              .slice(0, 8)
              .map((r) => ({
                key: r.staffMemberId,
                label: r.staffName,
                value: r.serviceRevenue + r.salesAmount,
                hint: `Uygulama ${formatTL(Math.round(r.serviceRevenue))} · Satış ${formatTL(Math.round(r.salesAmount))}`,
              }))}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Bu dönemde ciro üretilmemiş."
          />
        </ReportCard>

        {compareLabel ? (
          <ReportCard title={`${rangeLabel} ↔ ${compareLabel}`} subtitle="Uygulama cirosu karşılaştırması" icon={TrendingUp}>
            <ComparisonBars
              rows={topByContribution.slice(0, 6).map((r) => ({
                key: r.staffMemberId,
                label: r.staffName,
                current: r.serviceRevenue,
                previous: r.previousServiceRevenue,
              }))}
              currentLabel={rangeLabel}
              previousLabel={compareLabel}
              format={(v) => formatTL(Math.round(v))}
            />
          </ReportCard>
        ) : (
          <ReportCard
            title="Müşteri Puanı"
            subtitle="QR ile toplanan yıldız ortalaması"
            icon={Star}
            onOpen={() =>
              detail.openKey('staff.rating', {
                rangeLabel,
                breakdown: rows
                  .filter((r) => r.ratingCount > 0)
                  .map((r) => ({ label: r.staffName, value: `${r.averageRating.toFixed(1)} ★`, hint: `${r.ratingCount} değerlendirme` })),
              })
            }
          >
            <RankBars
              items={[...rows]
                .filter((r) => r.ratingCount > 0)
                .sort((a, b) => b.averageRating - a.averageRating)
                .slice(0, 8)
                .map((r) => ({
                  key: r.staffMemberId,
                  label: r.staffName,
                  value: r.averageRating,
                  hint: `${r.ratingCount} değerlendirme`,
                }))}
              max={5}
              format={(v) => `${v.toFixed(1)} ★`}
              emptyText="Bu dönemde puan verilmemiş."
            />
          </ReportCard>
        )}
      </section>

      <ReportCard
        title="Personel Karnesi"
        subtitle={`${rows.length} personel · ${rangeLabel}`}
        icon={UserCog}
        action={
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-full border border-[#efe1e7] bg-[#fffafc] px-3 py-1.5 text-[11.5px] font-semibold text-[#4a3a44] outline-none"
          >
            {(Object.keys(sortLabels) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {sortLabels[k]}'e göre sırala
              </option>
            ))}
          </select>
        }
      >
        <ReportTable<StaffReportRow>
          rows={sorted}
          rowKey={(r) => r.staffMemberId}
          minWidth={1120}
          emptyText="Personel kaydı bulunamadı."
          columns={[
            {
              key: 'staff',
              header: 'Personel',
              width: '20%',
              render: (r, i) => (
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[9.5px] font-bold text-white">
                    {initials(r.staffName)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[#2f2230]">
                      {i === 0 && <span className="mr-1 text-[#937022]">★</span>}
                      {r.staffName}
                    </span>
                    <span className="block truncate text-[10.5px] text-[#705a66]">
                      {r.title}
                      {r.branchName ? ` · ${r.branchName}` : ''}
                    </span>
                  </span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            {
              key: 'appointments',
              header: 'Randevu',
              align: 'right',
              render: (r) => (
                <span>
                  <span className="font-semibold text-[#2f2230]">{r.completedCount}</span>
                  <span className="text-[#705a66]">/{r.appointmentCount}</span>
                </span>
              ),
              total: (rows2) => `${rows2.reduce((s, r) => s + r.completedCount, 0)}/${rows2.reduce((s, r) => s + r.appointmentCount, 0)}`,
            },
            {
              key: 'rate',
              header: 'Başarı',
              align: 'right',
              render: (r) => {
                const pct = r.appointmentCount > 0 ? Math.round((r.completedCount / r.appointmentCount) * 100) : 0
                return <Pill tone={pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad'}>%{pct}</Pill>
              },
            },
            {
              key: 'issues',
              header: 'İptal / Gelmedi',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1 text-[11.5px]">
                  <CalendarX2 className="h-3 w-3 text-[#a83a35]" strokeWidth={1.9} />
                  {r.cancelledCount} / {r.noShowCount}
                </span>
              ),
              total: (rows2) => `${rows2.reduce((s, r) => s + r.cancelledCount, 0)} / ${rows2.reduce((s, r) => s + r.noShowCount, 0)}`,
            },
            { key: 'customers', header: 'Müşteri', align: 'right', render: (r) => r.customerCount },
            {
              key: 'worked',
              header: 'Çalışma',
              align: 'right',
              render: (r) => <span className="text-[#4a3a44]">{formatValue(r.workedMinutes, 'duration')}</span>,
              total: (rows2) => formatValue(rows2.reduce((s, r) => s + r.workedMinutes, 0), 'duration'),
            },
            {
              key: 'serviceRevenue',
              header: 'Uygulama Cirosu',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[#2f2230]">{formatTL(Math.round(r.serviceRevenue))}</span>
                  <DeltaBadge current={r.serviceRevenue} previous={r.previousServiceRevenue} unit="currency" compareLabel={compareLabel} />
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.serviceRevenue, 0))),
            },
            {
              key: 'salesAmount',
              header: 'Satış Cirosu',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[#6b4aa0]">{formatTL(Math.round(r.salesAmount))}</span>
                  {r.salesCount > 0 && <span className="text-[10px] text-[#705a66]">({r.salesCount})</span>}
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.salesAmount, 0))),
            },
            {
              key: 'commission',
              header: 'Komisyon',
              align: 'right',
              render: (r) => (
                <span>
                  <span className="font-semibold text-[#20705a]">{formatTL(Math.round(r.commissionEarned))}</span>
                  {r.commissionRate > 0 && <span className="ml-1 text-[10px] text-[#705a66]">%{r.commissionRate}</span>}
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.commissionEarned, 0))),
            },
            {
              key: 'rating',
              header: 'Puan',
              align: 'right',
              render: (r) =>
                r.ratingCount > 0 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-[#96702a]">
                    <Star className="h-3 w-3 fill-current" strokeWidth={0} />
                    {r.averageRating.toFixed(1)}
                    <span className="text-[10px] font-medium text-[#705a66]">({r.ratingCount})</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-[#705a66]">—</span>
                ),
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
