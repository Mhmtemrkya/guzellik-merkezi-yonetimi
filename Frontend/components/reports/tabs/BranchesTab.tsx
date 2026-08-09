'use client'

/**
 * Şube karşılaştırması: her şubenin geliri, gideri, NET KÂRI, satışı, açık alacağı,
 * randevusu ve müşterisi yan yana. Karşılaştırma dönemi açıkken önceki dönemle de kıyaslanır.
 *
 * Not: Kurum yöneticisi için bu sekme üst menüdeki şube seçiminden bağımsız olarak TÜM şubeleri
 * gösterir — aksi hâlde "karşılaştırma" tek satıra düşerdi. Şube müdürü/ekip yalnız kendi
 * şubesini görür (backend `scopedToSingleBranch` ile bildirir).
 */

import { Building2, CalendarClock, Info, Percent, TrendingDown, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react'
import { ComparisonBars, DonutChart, RankBars, TrendChart, paletteAt } from '@/components/reports/ReportCharts'
import { DeltaBadge, KpiTile, Pill, ReportCard, ReportTable } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { BranchReport, BranchReportRow } from '@/lib/reportTypes'

export default function BranchesTab({
  data,
  compareLabel,
  rangeLabel,
}: {
  data: BranchReport | null
  compareLabel?: string
  rangeLabel: string
}) {
  const detail = useMetricDetail()
  const rows = data?.rows ?? []
  const hasCompare = Boolean(compareLabel)

  /** Şube bazlı kırılım — her KPI modalinde hangi şubenin ne kadar payı olduğunu gösterir. */
  const branchRows = (pick: (r: BranchReportRow) => number, currency = true) =>
    [...rows]
      .sort((a, b) => pick(b) - pick(a))
      .map((r) => ({
        label: r.branchName,
        value: currency ? formatTL(Math.round(pick(r))) : String(Math.round(pick(r))),
        hint: `${r.city} · ${r.staffCount} personel · ${r.completedCount}/${r.appointmentCount} randevu`,
      }))

  // Şubelerin zaman serileri aynı kova anahtarlarını paylaşır; birleşik eksen için hepsini topla.
  const allKeys = Array.from(new Set(rows.flatMap((r) => r.series.map((p) => p.key)))).sort()
  const labelByKey = new Map<string, string>()
  rows.forEach((r) => r.series.forEach((p) => labelByKey.set(p.key, p.label)))
  const netSeries = rows.slice(0, 6).map((r, i) => {
    const byKey = new Map(r.series.map((p) => [p.key, p]))
    return {
      key: r.branchId,
      label: r.branchName,
      color: paletteAt(i),
      values: allKeys.map((k) => byKey.get(k)?.net ?? 0),
      filled: false,
    }
  })

  return (
    <div className="space-y-4">
      {data?.scopedToSingleBranch && (
        <div className="flex items-start gap-2 rounded-[14px] border border-[#f0e0bd] bg-[#fffaef] px-3 py-2.5 text-[11.5px] text-[#8a6320]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>
            Yetkiniz yalnızca kendi şubenizi kapsıyor; karşılaştırma tek şube üzerinden gösteriliyor.
            Tüm şubeleri kıyaslamak kurum yöneticisi yetkisi gerektirir.
          </span>
        </div>
      )}

      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'branch.income', label: 'Toplam Gelir', value: data?.totalIncome ?? 0, prev: data?.previousTotalIncome ?? 0, unit: 'currency', icon: TrendingUp, tone: 'mint', hint: `${rows.length} şube`, pick: (r: BranchReportRow) => r.income },
            { key: 'branch.expense', label: 'Toplam Gider', value: data?.totalExpense ?? 0, prev: data?.previousTotalExpense ?? 0, unit: 'currency', icon: TrendingDown, tone: 'peach', invert: true, hint: 'tüm şubeler', pick: (r: BranchReportRow) => r.expense },
            { key: 'branch.net', label: 'Toplam Net Kâr', value: data?.totalNet ?? 0, prev: data?.previousTotalNet ?? 0, unit: 'currency', icon: Wallet, tone: 'gold', hint: (data?.totalNet ?? 0) >= 0 ? 'kârda' : 'zararda', pick: (r: BranchReportRow) => r.net },
            { key: 'sales', label: 'Satış Tutarı', value: rows.reduce((s, r) => s + r.salesAmount, 0), prev: undefined, unit: 'currency', icon: Building2, tone: 'rose', hint: 'dönemde yapılan satış', pick: (r: BranchReportRow) => r.salesAmount },
            { key: 'branch.receivable', label: 'Açık Alacak', value: rows.reduce((s, r) => s + r.receivable, 0), prev: undefined, unit: 'currency', icon: Percent, tone: 'violet', hint: 'tahsil edilmemiş taksit', pick: (r: BranchReportRow) => r.receivable },
            { key: 'appointments', label: 'Randevu', value: rows.reduce((s, r) => s + r.appointmentCount, 0), prev: undefined, unit: 'count', icon: CalendarClock, tone: 'slate', hint: `${rows.reduce((s, r) => s + r.completedCount, 0)} tamamlandı`, pick: (r: BranchReportRow) => r.appointmentCount },
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
              breakdown: branchRows(k.pick, k.unit === 'currency'),
            })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <ReportCard title="Şube Net Kâr Eğrisi" subtitle={rangeLabel} icon={TrendingUp}>
          <TrendChart
            labels={allKeys.map((k) => labelByKey.get(k) ?? k)}
            series={netSeries}
            height={260}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Bu dönemde şube hareketi yok."
          />
        </ReportCard>

        <ReportCard title="Gelir Payı" subtitle="Şubelerin ciro içindeki ağırlığı" icon={Building2}>
          <DonutChart
            slices={rows.map((r) => ({ key: r.branchId, label: r.branchName, value: r.income }))}
            centerLabel="Toplam gelir"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Net Kâr Sıralaması" subtitle="Gelir − gider" icon={Wallet}>
          <RankBars
            items={[...rows]
              .sort((a, b) => b.net - a.net)
              .map((r) => ({
                key: r.branchId,
                label: r.branchName,
                value: r.net,
                hint: `${formatTL(Math.round(r.income))} gelir · ${formatTL(Math.round(r.expense))} gider · %${Math.round(r.profitMargin)} marj`,
                color: r.net >= 0 ? 'linear-gradient(90deg,#7fc7ad,#2c7d63)' : 'linear-gradient(90deg,#e8a5a1,#b3453f)',
              }))}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Şube kaydı yok."
          />
        </ReportCard>

        <ReportCard
          title={hasCompare ? `${rangeLabel} ↔ ${compareLabel}` : 'Şube Verimliliği'}
          subtitle={hasCompare ? 'Net kâr karşılaştırması' : 'Randevu başına ortalama tahsilat'}
          icon={Percent}
        >
          {hasCompare ? (
            <ComparisonBars
              rows={rows.map((r) => ({ key: r.branchId, label: r.branchName, current: r.net, previous: r.previousNet }))}
              currentLabel={rangeLabel}
              previousLabel={compareLabel!}
              format={(v) => formatTL(Math.round(v))}
            />
          ) : (
            <RankBars
              items={rows.map((r) => ({
                key: r.branchId,
                label: r.branchName,
                value: r.averageTicket,
                hint: `${r.completedCount} tamamlanan · ${r.customerCount} müşteri · ${r.staffCount} personel`,
              }))}
              format={(v) => formatTL(Math.round(v))}
              emptyText="Şube kaydı yok."
            />
          )}
        </ReportCard>
      </section>

      <ReportCard
        title="Şube Karşılaştırma Tablosu"
        subtitle={rangeLabel}
        icon={Building2}
        onOpen={() => detail.openKey('branch.scope', { rangeLabel })}
      >
        <ReportTable<BranchReportRow>
          rows={rows}
          rowKey={(r) => r.branchId}
          minWidth={1120}
          emptyText="Şube kaydı bulunamadı."
          columns={[
            {
              key: 'branch',
              header: 'Şube',
              width: '18%',
              render: (r) => (
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#2f2230]">{r.branchName}</span>
                  <span className="block truncate text-[10.5px] text-[#705a66]">
                    {r.city} · {r.staffCount} personel
                  </span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            {
              key: 'income',
              header: 'Gelir',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold text-[#20705a]">{formatTL(Math.round(r.income))}</span>
                  <DeltaBadge current={r.income} previous={r.previousIncome} unit="currency" compareLabel={compareLabel} />
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.income, 0))),
            },
            {
              key: 'expense',
              header: 'Gider',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[#a83a35]">{formatTL(Math.round(r.expense))}</span>
                  <DeltaBadge current={r.expense} previous={r.previousExpense} unit="currency" compareLabel={compareLabel} invert />
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.expense, 0))),
            },
            {
              key: 'net',
              header: 'Net Kâr',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`font-bold ${r.net >= 0 ? 'text-[#20705a]' : 'text-[#a83a35]'}`}>{formatTL(Math.round(r.net))}</span>
                  <DeltaBadge current={r.net} previous={r.previousNet} unit="currency" compareLabel={compareLabel} />
                </span>
              ),
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.net, 0))),
            },
            {
              key: 'margin',
              header: 'Marj',
              align: 'right',
              render: (r) => <Pill tone={r.profitMargin >= 25 ? 'good' : r.profitMargin >= 0 ? 'warn' : 'bad'}>%{Math.round(r.profitMargin)}</Pill>,
            },
            {
              key: 'sales',
              header: 'Satış',
              align: 'right',
              render: (r) => <span className="text-[#6b4aa0]">{formatTL(Math.round(r.salesAmount))}</span>,
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.salesAmount, 0))),
            },
            {
              key: 'receivable',
              header: 'Açık Alacak',
              align: 'right',
              render: (r) => <span className={r.receivable > 0 ? 'text-[#8a6320]' : 'text-[#705a66]'}>{formatTL(Math.round(r.receivable))}</span>,
              total: (rows2) => formatTL(Math.round(rows2.reduce((s, r) => s + r.receivable, 0))),
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
              key: 'customers',
              header: 'Müşteri',
              align: 'right',
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-[#c05277]" strokeWidth={1.9} />
                  {r.customerCount}
                  {r.newCustomerCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#20705a]">
                      <UserPlus className="h-2.5 w-2.5" strokeWidth={2.2} />
                      {r.newCustomerCount}
                    </span>
                  )}
                </span>
              ),
              total: (rows2) => rows2.reduce((s, r) => s + r.customerCount, 0),
            },
            {
              key: 'ticket',
              header: 'Ort. Sepet',
              align: 'right',
              render: (r) => formatTL(Math.round(r.averageTicket)),
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
