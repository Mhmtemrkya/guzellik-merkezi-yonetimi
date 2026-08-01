'use client'

/**
 * Müşteri analitiği: kim geldi, kim döndü, kim kayboldu; yaş/cinsiyet dağılımı, en çok harcayanlar.
 */

import { CalendarHeart, Crown, HeartCrack, Repeat2, ShieldCheck, UserPlus, Users, Wallet } from 'lucide-react'
import { DonutChart, RadialGauge, RankBars, TrendChart } from '@/components/reports/ReportCharts'
import { KpiTile, Pill, ReportCard, ReportTable } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { CustomerReport, CustomerReportRow } from '@/lib/reportTypes'

export default function CustomersTab({
  data,
  compareLabel,
  rangeLabel,
}: {
  data: CustomerReport | null
  compareLabel?: string
  rangeLabel: string
}) {
  const detail = useMetricDetail()
  const series = data?.series ?? []
  const kvkkRatio = (data?.totalCustomers ?? 0) > 0 ? ((data?.kvkkApproved ?? 0) / (data?.totalCustomers ?? 1)) * 100 : 0

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'customer.total', label: 'Toplam Müşteri', value: data?.totalCustomers ?? 0, prev: undefined, unit: 'count', icon: Users, tone: 'rose', hint: 'kurum kayıtlı' },
            { key: 'newCustomers', label: 'Yeni Müşteri', value: data?.newCustomers ?? 0, prev: data?.previousNewCustomers ?? 0, unit: 'count', icon: UserPlus, tone: 'mint', hint: `${rangeLabel} içinde eklenen` },
            { key: 'activeCustomers', label: 'Aktif Müşteri', value: data?.activeCustomers ?? 0, prev: data?.previousActiveCustomers ?? 0, unit: 'count', icon: CalendarHeart, tone: 'violet', hint: 'dönemde randevusu olan' },
            { key: 'customer.returning', label: 'Tekrar Gelen', value: data?.returningCustomers ?? 0, prev: undefined, unit: 'count', icon: Repeat2, tone: 'gold', hint: `${data?.oneTimeCustomers ?? 0} tek seferlik` },
            { key: 'customer.spent', label: 'Dönem Harcaması', value: data?.totalSpent ?? 0, prev: data?.previousTotalSpent ?? 0, unit: 'currency', icon: Wallet, tone: 'mint', hint: `kişi başı ${formatTL(Math.round(data?.averageSpent ?? 0))}` },
            { key: 'customer.debt', label: 'Açık Borç', value: data?.totalDebt ?? 0, prev: undefined, unit: 'currency', icon: Wallet, tone: 'peach', invert: true, hint: 'tahsil edilmemiş taksit' },
            { key: 'customer.total', label: 'VIP Müşteri', value: data?.vipCount ?? 0, prev: undefined, unit: 'count', icon: Crown, tone: 'gold', hint: `${data?.blacklistedCount ?? 0} kara listede` },
            { key: 'customer.lost', label: 'Kayıp Müşteri', value: data?.lostCustomers ?? 0, prev: undefined, unit: 'count', icon: HeartCrack, tone: 'peach', invert: true, hint: '180 gündür gelmeyen' },
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
            invert={'invert' in k ? k.invert : false}
            hint={k.hint}
            onOpen={kpiOpener(detail, k.key, {
              value: k.value,
              unit: k.unit,
              previous: compareLabel ? k.prev : undefined,
              compareLabel,
              rangeLabel,
              hint: k.hint,
              invert: 'invert' in k ? k.invert : false,
            })}
          />
        ))}
      </section>

      <ReportCard title="Müşteri Hareketi" subtitle={`${rangeLabel} · yeni kayıt, randevu ve tahsilat`} icon={Users}>
        <TrendChart
          labels={series.map((p) => p.label)}
          series={[
            { key: 'spent', label: 'Tahsilat', color: '#2c7d63', values: series.map((p) => p.income) },
            { key: 'appt', label: 'Randevu', color: '#c85776', values: series.map((p) => p.appointments), filled: false },
            { key: 'new', label: 'Yeni müşteri', color: '#7b52ba', values: series.map((p) => p.newCustomers), filled: false },
          ]}
          height={250}
          format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}B` : `${Math.round(v)}`)}
        />
      </ReportCard>

      <section className="grid gap-4 lg:grid-cols-4">
        <ReportCard title="Yaş Dağılımı" icon={Users}>
          <DonutChart
            slices={(data?.ageSegments ?? []).map((s) => ({ key: s.key, label: s.label, value: s.count }))}
            centerLabel="Doğum tarihi bilinen"
            format={(v) => `${Math.round(v)} kişi`}
            size={160}
            thickness={22}
          />
        </ReportCard>

        <ReportCard title="Cinsiyet" icon={Users}>
          <DonutChart
            slices={(data?.genderSlices ?? []).map((s) => ({ key: s.key, label: s.label, value: s.count }))}
            centerLabel="Toplam"
            format={(v) => `${Math.round(v)} kişi`}
            size={160}
            thickness={22}
          />
        </ReportCard>

        <ReportCard title="Ziyaret Sıklığı" subtitle="Dönem içi randevu adedi" icon={Repeat2}>
          <RankBars
            items={(data?.visitFrequency ?? []).map((s) => ({ key: s.key, label: s.label, value: s.count }))}
            format={(v) => `${Math.round(v)} kişi`}
            emptyText="Bu dönemde ziyaret yok."
          />
        </ReportCard>

        <ReportCard
          title="Sadakat & KVKK"
          icon={ShieldCheck}
          onOpen={() => detail.openKey('customer.retention', { rangeLabel })}
        >
          <div className="flex flex-wrap items-start justify-around gap-3">
            <RadialGauge value={data?.retentionRate ?? 0} label="Tekrar gelme" hint="aktif müşteriye oranla" color="#7b52ba" size={116} />
            <RadialGauge value={kvkkRatio} label="KVKK onaylı" hint={`${data?.kvkkApproved ?? 0} müşteri`} color="#2c7d63" size={116} />
          </div>
        </ReportCard>
      </section>

      <ReportCard title="En Çok Harcayan Müşteriler" subtitle={`${(data?.topCustomers ?? []).length} müşteri · ${rangeLabel}`} icon={Crown}>
        <ReportTable<CustomerReportRow>
          rows={data?.topCustomers ?? []}
          rowKey={(r) => r.customerId}
          minWidth={860}
          emptyText="Bu dönemde işlem gören müşteri yok."
          columns={[
            {
              key: 'name',
              header: 'Müşteri',
              width: '28%',
              render: (r, i) => (
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#fff2f6] text-[9.5px] font-bold text-[#a34a62]">{i + 1}</span>
                    <span className="truncate font-semibold text-[#2f2230]">{r.fullName}</span>
                    {r.isVip && <Crown className="h-3 w-3 shrink-0 text-[#c99a2e]" strokeWidth={2} />}
                  </span>
                  <span className="mt-0.5 block truncate pl-6.5 text-[10.5px] text-[#705a66]">{r.phone}</span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            { key: 'branch', header: 'Şube', render: (r) => <span className="text-[11.5px] text-[#705a66]">{r.branchName ?? '—'}</span> },
            { key: 'visits', header: 'Ziyaret', align: 'right', render: (r) => r.visitCount, total: (rows) => rows.reduce((s, r) => s + r.visitCount, 0) },
            {
              key: 'spent',
              header: 'Harcama',
              align: 'right',
              render: (r) => <span className="font-semibold text-[#2f2230]">{formatTL(Math.round(r.spent))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.spent, 0))),
            },
            {
              key: 'last',
              header: 'Son Ziyaret',
              align: 'right',
              render: (r) =>
                r.lastVisitUtc ? (
                  <span className="text-[11.5px] text-[#4a3a44]">
                    {new Date(r.lastVisitUtc).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                ) : (
                  <span className="text-[11px] text-[#705a66]">—</span>
                ),
            },
            {
              key: 'kvkk',
              header: 'KVKK',
              align: 'center',
              render: (r) => <Pill tone={r.kvkkConsent ? 'good' : 'warn'}>{r.kvkkConsent ? 'Onaylı' : 'Onaysız'}</Pill>,
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
