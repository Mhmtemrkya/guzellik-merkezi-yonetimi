'use client'

/**
 * Hediye çeki & kupon raporu: dönemde kesilen, harcanan ve açıkta duran bakiye + çek listesi.
 * Veri stok raporuyla aynı uçtan gelir (InventoryReport), çünkü ikisi de "varlık" sayılır.
 */

import { BadgePercent, CheckCircle2, Gift, TicketX, Wallet } from 'lucide-react'
import { DonutChart, RankBars } from '@/components/reports/ReportCharts'
import { KpiTile, Pill, ReportCard, ReportTable } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { GiftCardReportRow, InventoryReport } from '@/lib/reportTypes'

export default function GiftCardsTab({ data, rangeLabel }: { data: InventoryReport | null; rangeLabel: string }) {
  const detail = useMetricDetail()
  const cards = data?.giftCards ?? []
  const byKind = new Map<string, { value: number; count: number }>()
  for (const c of cards) {
    const cur = byKind.get(c.kind) ?? { value: 0, count: 0 }
    cur.value += c.value
    cur.count += 1
    byKind.set(c.kind, cur)
  }

  const usedRatio = (data?.giftCardIssuedValue ?? 0) > 0
    ? ((data?.giftCardRedeemedValue ?? 0) / (data?.giftCardIssuedValue ?? 1)) * 100
    : 0

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'gift.issued', label: 'Kesilen Çek', value: data?.giftCardIssuedCount ?? 0, unit: 'count', icon: Gift, tone: 'rose', hint: `${rangeLabel} içinde` },
            { key: 'gift.issued', label: 'Kesilen Tutar', value: data?.giftCardIssuedValue ?? 0, unit: 'currency', icon: Wallet, tone: 'violet', hint: 'dönemde oluşturulan değer' },
            { key: 'gift.redeemed', label: 'Kullanılan', value: data?.giftCardRedeemedValue ?? 0, unit: 'currency', icon: CheckCircle2, tone: 'mint', hint: `toplam kullanım oranı %${Math.round(usedRatio)}` },
            { key: 'gift.outstanding', label: 'Açık Bakiye', value: data?.giftCardOutstanding ?? 0, unit: 'currency', icon: BadgePercent, tone: 'gold', hint: 'harcanmayı bekleyen' },
            { key: 'gift.issued', label: 'Geçerli Çek', value: data?.giftCardActiveCount ?? 0, unit: 'count', icon: CheckCircle2, tone: 'mint', hint: `${cards.length} kayıttan` },
            { key: 'gift.expired', label: 'Süresi Dolan', value: data?.giftCardExpiredCount ?? 0, unit: 'count', icon: TicketX, tone: 'peach', invert: true, hint: 'artık kullanılamaz' },
          ] as const
        ).map((k, i) => (
          <KpiTile
            key={k.label}
            index={i}
            label={k.label}
            value={k.value}
            unit={k.unit}
            icon={k.icon}
            tone={k.tone}
            invert={'invert' in k ? k.invert : false}
            hint={k.hint}
            onOpen={kpiOpener(detail, k.key, {
              value: k.value,
              unit: k.unit,
              rangeLabel,
              hint: k.hint,
              invert: 'invert' in k ? k.invert : false,
            })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Tür Dağılımı" subtitle="Toplam değere göre" icon={Gift}>
          <DonutChart
            slices={[...byKind.entries()].map(([kind, v]) => ({ key: kind, label: kind, value: v.value }))}
            centerLabel="Toplam değer"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>

        <ReportCard title="En Çok Kullanılan Çekler" subtitle="Harcanan tutara göre" icon={CheckCircle2}>
          <RankBars
            items={[...cards]
              .filter((c) => c.usedAmount > 0)
              .sort((a, b) => b.usedAmount - a.usedAmount)
              .slice(0, 8)
              .map((c) => ({
                key: c.id,
                label: c.customerName ? `${c.code} · ${c.customerName}` : c.code,
                value: c.usedAmount,
                hint: `${c.usedCount} kullanım · ${c.kind}`,
              }))}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Henüz kullanılan çek yok."
          />
        </ReportCard>
      </section>

      <ReportCard title="Hediye Çeki Listesi" subtitle={`${cards.length} kayıt`} icon={Gift}>
        <ReportTable<GiftCardReportRow>
          rows={cards}
          rowKey={(r) => r.id}
          minWidth={880}
          emptyText="Hediye çeki kaydı bulunamadı."
          columns={[
            {
              key: 'code',
              header: 'Kod',
              width: '20%',
              render: (r) => (
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] font-semibold text-[#2f2230]">{r.code}</span>
                  <span className="block truncate text-[10.5px] text-[#705a66]">{r.customerName ?? 'Genel'}</span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            { key: 'kind', header: 'Tür', render: (r) => <span className="text-[11.5px] text-[#4a3a44]">{r.kind}</span> },
            {
              key: 'value',
              header: 'Değer',
              align: 'right',
              render: (r) => <span className="font-semibold text-[#2f2230]">{formatTL(Math.round(r.value))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.value, 0))),
            },
            {
              key: 'used',
              header: 'Kullanılan',
              align: 'right',
              render: (r) => <span className="text-[#20705a]">{formatTL(Math.round(r.usedAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.usedAmount, 0))),
            },
            {
              key: 'balance',
              header: 'Kalan Bakiye',
              align: 'right',
              render: (r) => <span className="text-[#8a6320]">{formatTL(Math.round(r.balance))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.balance, 0))),
            },
            {
              key: 'uses',
              header: 'Kullanım',
              align: 'right',
              render: (r) => (
                <span className="text-[11.5px]">
                  {r.usedCount}
                  {r.maxUses > 0 ? ` / ${r.maxUses}` : ''}
                </span>
              ),
            },
            {
              key: 'validity',
              header: 'Geçerlilik',
              align: 'right',
              render: (r) =>
                r.validUntilUtc ? (
                  <span className="text-[11.5px] text-[#4a3a44]">
                    {new Date(r.validUntilUtc).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                ) : (
                  <span className="text-[11px] text-[#705a66]">Süresiz</span>
                ),
            },
            {
              key: 'status',
              header: 'Durum',
              align: 'center',
              render: (r) => {
                const expired = r.validUntilUtc ? new Date(r.validUntilUtc).getTime() <= Date.now() : false
                if (expired) return <Pill tone="bad">Süresi doldu</Pill>
                return <Pill tone={r.isActive ? 'good' : 'warn'}>{r.isActive ? 'Aktif' : 'Pasif'}</Pill>
              },
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
