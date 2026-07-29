'use client'

/**
 * Stok & Ürün raporu: dönemde satılan ürün, maliyeti, kârı; sarf ve fire; anlık stok değeri
 * ve kritik seviyedeki ürünler.
 */

import { AlertTriangle, ArrowDownToLine, Boxes, PackageX, ShoppingBag, TrendingUp, Warehouse } from 'lucide-react'
import { DonutChart, RankBars, TrendChart } from '@/components/reports/ReportCharts'
import { KpiTile, Pill, ReportCard, ReportTable } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { InventoryReport, ProductReportRow } from '@/lib/reportTypes'

const qtyFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

export default function InventoryTab({
  data,
  compareLabel,
  rangeLabel,
}: {
  data: InventoryReport | null
  compareLabel?: string
  rangeLabel: string
}) {
  const detail = useMetricDetail()
  const series = data?.series ?? []
  const products = data?.products ?? []
  const sold = products.filter((p) => p.soldQuantity > 0)
  const critical = products.filter((p) => p.isCritical)
  const margin = (data?.soldAmount ?? 0) > 0 ? ((data?.soldProfit ?? 0) / (data?.soldAmount ?? 1)) * 100 : 0

  const productRows = (pick: (p: (typeof products)[number]) => number, currency = true) =>
    [...products]
      .filter((p) => pick(p) !== 0)
      .sort((a, b) => pick(b) - pick(a))
      .slice(0, 15)
      .map((p) => ({
        label: p.name,
        value: currency ? formatTL(Math.round(pick(p))) : qtyFmt.format(pick(p)),
        hint: `${p.category}${p.brand ? ` · ${p.brand}` : ''}`,
      }))

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'inventory.soldAmount', label: 'Ürün Satışı', value: data?.soldAmount ?? 0, prev: data?.previousSoldAmount ?? 0, unit: 'currency', icon: ShoppingBag, tone: 'rose', hint: `${qtyFmt.format(data?.soldQuantity ?? 0)} adet`, rows: productRows((p) => p.soldAmount) },
            { key: 'inventory.soldProfit', label: 'Satış Kârı', value: data?.soldProfit ?? 0, prev: data?.previousSoldProfit ?? 0, unit: 'currency', icon: TrendingUp, tone: 'mint', hint: `%${Math.round(margin)} marj`, rows: productRows((p) => p.profit) },
            { key: 'inventory.soldAmount', label: 'Satılan Maliyet', value: data?.soldCost ?? 0, prev: undefined, unit: 'currency', icon: ArrowDownToLine, tone: 'peach', invert: true, hint: 'satılan ürünlerin maliyeti', rows: productRows((p) => p.costAmount) },
            { key: 'inventory.purchased', label: 'Alım Tutarı', value: data?.purchasedAmount ?? 0, prev: undefined, unit: 'currency', icon: Boxes, tone: 'slate', hint: 'dönemde stoğa giren', rows: undefined },
            { key: 'inventory.stockValue', label: 'Stok Değeri', value: data?.stockValueAtCost ?? 0, prev: undefined, unit: 'currency', icon: Warehouse, tone: 'violet', hint: `satışta ${formatTL(Math.round(data?.stockValueAtSale ?? 0))}`, rows: productRows((p) => p.stockValue) },
            { key: 'inventory.critical', label: 'Kritik Stok', value: data?.criticalCount ?? 0, prev: undefined, unit: 'count', icon: AlertTriangle, tone: 'gold', invert: true, hint: `${data?.outOfStockCount ?? 0} tükendi`, rows: critical.map((p) => ({ label: p.name, value: `${qtyFmt.format(p.currentStock)} / min ${qtyFmt.format(p.minStockLevel)}`, hint: p.category })) },
            { key: 'inventory.used', label: 'Sarf / Fire', value: (data?.usedQuantity ?? 0) + (data?.damagedQuantity ?? 0), prev: undefined, unit: 'count', icon: PackageX, tone: 'peach', invert: true, hint: `${qtyFmt.format(data?.usedQuantity ?? 0)} sarf · ${qtyFmt.format(data?.damagedQuantity ?? 0)} fire`, rows: productRows((p) => p.usedQuantity, false) },
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
              breakdown: k.rows ? [...k.rows] : undefined,
            })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ReportCard title="Ürün Satışı & Alımı" subtitle={rangeLabel} icon={ShoppingBag}>
          <TrendChart
            labels={series.map((p) => p.label)}
            series={[
              { key: 'sale', label: 'Satış', color: '#2c7d63', values: series.map((p) => p.income) },
              { key: 'buy', label: 'Alım maliyeti', color: '#b3453f', values: series.map((p) => p.expense) },
            ]}
            height={250}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Bu dönemde stok hareketi yok."
          />
        </ReportCard>

        <ReportCard title="Kategori Payı" subtitle="Satış tutarına göre" icon={Boxes}>
          <DonutChart
            slices={(data?.categories ?? []).filter((c) => c.amount > 0).map((c) => ({ key: c.key, label: c.label, value: c.amount }))}
            centerLabel="Ürün satışı"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="En Çok Satan Ürünler" subtitle="Dönem satış tutarı" icon={TrendingUp}>
          <RankBars
            items={sold
              .slice(0, 8)
              .map((p) => ({
                key: p.productId,
                label: p.name,
                value: p.soldAmount,
                hint: `${qtyFmt.format(p.soldQuantity)} adet · ${formatTL(Math.round(p.profit))} kâr`,
              }))}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Bu dönemde ürün satışı yok."
          />
        </ReportCard>

        <ReportCard title="Stok Uyarıları" subtitle={`${critical.length} ürün kritik seviyede`} icon={AlertTriangle}>
          {critical.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#cfe8dd] bg-[#f2fbf7] px-4 py-6 text-center text-[12px] text-[#20705a]">
              Tüm ürünler yeterli seviyede.
            </div>
          ) : (
            <div className="space-y-2">
              {critical.slice(0, 10).map((p) => (
                <div key={p.productId} className="flex items-center justify-between gap-3 rounded-[12px] border border-[#f6d6c4] bg-[#fff6f0] px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-[#2f2230]">{p.name}</span>
                    <span className="block truncate text-[10.5px] text-[#705a66]">
                      {p.category}
                      {p.brand ? ` · ${p.brand}` : ''}
                    </span>
                  </span>
                  <Pill tone={p.currentStock <= 0 ? 'bad' : 'warn'}>
                    {qtyFmt.format(p.currentStock)} / {qtyFmt.format(p.minStockLevel)}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </ReportCard>
      </section>

      <ReportCard title="Ürün Tablosu" subtitle={`${products.length} ürün`} icon={Warehouse}>
        <ReportTable<ProductReportRow>
          rows={products}
          rowKey={(r) => r.productId}
          minWidth={980}
          emptyText="Ürün kaydı bulunamadı."
          columns={[
            {
              key: 'name',
              header: 'Ürün',
              width: '26%',
              render: (r) => (
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#2f2230]">{r.name}</span>
                  <span className="block truncate text-[10.5px] text-[#705a66]">
                    {r.category}
                    {r.brand ? ` · ${r.brand}` : ''}
                  </span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            { key: 'qty', header: 'Satılan', align: 'right', render: (r) => qtyFmt.format(r.soldQuantity), total: (rows) => qtyFmt.format(rows.reduce((s, r) => s + r.soldQuantity, 0)) },
            {
              key: 'amount',
              header: 'Satış Tutarı',
              align: 'right',
              render: (r) => <span className="font-semibold text-[#2f2230]">{formatTL(Math.round(r.soldAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.soldAmount, 0))),
            },
            {
              key: 'cost',
              header: 'Maliyet',
              align: 'right',
              render: (r) => <span className="text-[#a83a35]">{formatTL(Math.round(r.costAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.costAmount, 0))),
            },
            {
              key: 'profit',
              header: 'Kâr',
              align: 'right',
              render: (r) => <span className={`font-semibold ${r.profit >= 0 ? 'text-[#20705a]' : 'text-[#a83a35]'}`}>{formatTL(Math.round(r.profit))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.profit, 0))),
            },
            { key: 'used', header: 'Sarf / Fire', align: 'right', render: (r) => qtyFmt.format(r.usedQuantity) },
            {
              key: 'stock',
              header: 'Stok',
              align: 'right',
              render: (r) => (
                <span className={r.isCritical ? 'font-semibold text-[#a83a35]' : 'text-[#4a3a44]'}>
                  {qtyFmt.format(r.currentStock)}
                  <span className="ml-1 text-[10px] text-[#705a66]">/ min {qtyFmt.format(r.minStockLevel)}</span>
                </span>
              ),
            },
            {
              key: 'value',
              header: 'Stok Değeri',
              align: 'right',
              render: (r) => formatTL(Math.round(r.stockValue)),
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.stockValue, 0))),
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
