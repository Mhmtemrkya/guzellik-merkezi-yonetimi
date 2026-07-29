'use client'

/**
 * Paket / Hizmet detay sekmesi. Aynı bileşen iki sekmeyi de besler (`kind`), çünkü backend
 * her ikisi için de aynı DTO'yu döndürür.
 *
 * Sorulara yanıt verir:
 *   • Hangi paket kaç kez satıldı, kaç müşteriye, ne kadar tahsil edildi, ne kadar kaldı?
 *   • KİM SATTI  → satır içi rozetler + satır açılınca personel bazlı tam kırılım
 *   • KİM YAPTI  → dönemde tamamlanan randevulardan uygulayan personel kırılımı
 */

import { useMemo, useState } from 'react'
import { Activity, Boxes, ChevronDown, Layers, Sparkles, UserCheck, Users, Wallet, XCircle } from 'lucide-react'
import { DonutChart, RankBars } from '@/components/reports/ReportCharts'
import { KpiTile, PersonChips, Pill, ReportCard, ReportTable, initials } from '@/components/reports/ReportUi'
import { kpiOpener, useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import type { CatalogItemReport, CatalogReport, CatalogTotals, ReportSlice } from '@/lib/reportTypes'

export default function CatalogTab({
  data,
  kind,
  compareLabel,
  rangeLabel,
}: {
  data: CatalogReport | null
  kind: 'package' | 'service'
  compareLabel?: string
  rangeLabel: string
}) {
  const isPackage = kind === 'package'
  const items = (isPackage ? data?.packages : data?.services) ?? []
  const totals = (isPackage ? data?.packageTotals : data?.serviceTotals) ?? emptyTotals
  const previous = (isPackage ? data?.packageTotalsPrevious : data?.serviceTotalsPrevious) ?? emptyTotals
  const categories: ReportSlice[] = (isPackage ? data?.packageCategories : data?.serviceCategories) ?? []

  const detail = useMetricDetail()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLocaleLowerCase('tr').includes(q) ||
        i.category.toLocaleLowerCase('tr').includes(q) ||
        i.sellers.some((s) => s.staffName.toLocaleLowerCase('tr').includes(q)) ||
        i.performers.some((p) => p.staffName.toLocaleLowerCase('tr').includes(q)),
    )
  }, [items, query])

  // Bu sekmenin kendi "kim sattı / kim yaptı" sıralaması — yalnız görünen kalemlerden.
  const sellerRanks = useMemo(() => aggregateSellers(items), [items])
  const performerRanks = useMemo(() => aggregatePerformers(items), [items])

  const label = isPackage ? 'Paket' : 'Hizmet'

  return (
    <div className="space-y-4">
      <section className="kpi-auto-grid grid gap-3">
        {(
          [
            { key: 'catalog.soldCount', label: `Satılan ${label}`, value: totals.soldCount, prev: previous.soldCount, icon: isPackage ? Boxes : Sparkles, tone: 'violet', hint: `${totals.customerCount} müşteriye` },
            { key: 'catalog.grossAmount', label: 'Satış Tutarı', value: totals.grossAmount, prev: previous.grossAmount, unit: 'currency', icon: Wallet, tone: 'rose', hint: `${rangeLabel} içinde satılan` },
            { key: 'catalog.collectedAmount', label: 'Tahsil Edilen', value: totals.collectedAmount, prev: previous.collectedAmount, unit: 'currency', icon: Wallet, tone: 'mint', hint: 'bu satışlara karşılık' },
            { key: 'catalog.remainingAmount', label: 'Kalan Tutar', value: totals.remainingAmount, prev: previous.remainingAmount, unit: 'currency', icon: Wallet, tone: 'gold', invert: true, hint: 'tahsil edilmemiş' },
            { key: 'catalog.sessionsInPeriod', label: 'Yapılan Seans', value: totals.sessionsInPeriod, prev: previous.sessionsInPeriod, icon: Activity, tone: 'mint', hint: 'dönemde tamamlanan randevu' },
            { key: 'catalog.sessionsRemaining', label: 'Kalan Seans', value: totals.sessionsRemaining, prev: previous.sessionsRemaining, icon: Layers, tone: 'slate', hint: `${totals.sessionsUsed}/${totals.sessionsTotal} kullanıldı` },
            { key: 'catalog.netRevenue', label: 'Prim Sonrası Net', value: totals.netRevenue, prev: previous.netRevenue, unit: 'currency', icon: Wallet, tone: 'mint', hint: `${formatTL(Math.round(totals.sessionRevenue))} ciro − ${formatTL(Math.round(totals.commissionCost))} prim` },
            { key: 'catalog.cancelledCount', label: 'İptal Edilen', value: totals.cancelledCount, prev: previous.cancelledCount, icon: XCircle, tone: 'peach', invert: true, hint: formatTL(Math.round(totals.cancelledAmount)) },
          ] as const
        ).map((k, i) => (
          <KpiTile
            key={k.key}
            index={i}
            label={k.label}
            value={k.value}
            unit={'unit' in k ? k.unit : 'count'}
            previous={k.prev}
            compareLabel={compareLabel}
            icon={k.icon}
            tone={k.tone}
            invert={'invert' in k ? k.invert : false}
            hint={k.hint}
            onOpen={kpiOpener(detail, k.key, {
              value: k.value,
              unit: 'unit' in k ? k.unit : 'count',
              previous: compareLabel ? k.prev : undefined,
              compareLabel,
              rangeLabel,
              hint: k.hint,
              invert: 'invert' in k ? k.invert : false,
            })}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <ReportCard title="Kategori Dağılımı" subtitle="Satış tutarına göre" icon={Layers}>
          <DonutChart
            slices={categories.map((c) => ({ key: c.key, label: c.label, value: c.amount }))}
            centerLabel="Toplam satış"
            format={(v) => formatTL(Math.round(v))}
          />
        </ReportCard>

        <ReportCard
          title="Kim Sattı"
          subtitle="Satış tutarına göre personel sıralaması"
          icon={UserCheck}
          onOpen={() =>
            detail.openKey('catalog.sellers', {
              rangeLabel,
              breakdown: sellerRanks.map((s) => ({
                label: s.name,
                value: formatTL(Math.round(s.amount)),
                hint: `${s.count} satış · ${s.customers} müşteri`,
              })),
            })
          }
        >
          <RankBars
            items={sellerRanks.slice(0, 8).map((s) => ({
              key: s.name,
              label: s.name,
              value: s.amount,
              hint: `${s.count} satış · ${s.customers} müşteri`,
            }))}
            format={(v) => formatTL(Math.round(v))}
            emptyText="Bu dönemde satış yok."
          />
        </ReportCard>

        <ReportCard
          title="Kim Uyguladı"
          subtitle="Dönemde yapılan seans adedine göre"
          icon={Activity}
          onOpen={() =>
            detail.openKey('catalog.performers', {
              rangeLabel,
              breakdown: performerRanks.map((p) => ({
                label: p.name,
                value: `${p.count} seans`,
                hint: `${p.customers} müşteri · ${formatTL(Math.round(p.amount))} ciro`,
              })),
            })
          }
        >
          <RankBars
            items={performerRanks.slice(0, 8).map((p) => ({
              key: p.name,
              label: p.name,
              value: p.count,
              hint: `${p.customers} müşteri · ${formatTL(Math.round(p.amount))} ciro`,
            }))}
            format={(v) => `${Math.round(v)} seans`}
            emptyText="Bu dönemde tamamlanan seans yok."
          />
        </ReportCard>
      </section>

      {/* Kârlılık: uygulama cirosundan personel primi düşülmüş net — hangi kalem gerçekten kazandırıyor. */}
      <ReportCard
        title="Kârlılık"
        subtitle="Uygulama cirosundan personel primi düşülmüş net"
        icon={Wallet}
        onOpen={() => detail.openKey('catalog.netRevenue', { rangeLabel })}
      >
        <RankBars
          items={[...items]
            .filter((i) => i.sessionRevenue > 0)
            .sort((a, b) => b.netRevenue - a.netRevenue)
            .slice(0, 10)
            .map((i) => ({
              key: i.id,
              label: i.name,
              value: i.netRevenue,
              hint: `${i.sessionsInPeriod} seans · ${formatTL(Math.round(i.sessionRevenue))} ciro − ${formatTL(Math.round(i.commissionCost))} prim`,
              color: i.netRevenue >= 0 ? 'linear-gradient(90deg,#7fc7ad,#2c7d63)' : 'linear-gradient(90deg,#e8a5a1,#b3453f)',
            }))}
          format={(v) => formatTL(Math.round(v))}
          emptyText="Bu dönemde uygulanan seans yok."
        />
      </ReportCard>

      <ReportCard
        title={`${label} Detayı`}
        subtitle={`${filtered.length} kalem · satır tıklayınca personel kırılımı açılır`}
        icon={isPackage ? Boxes : Sparkles}
        action={
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${label} ya da personel ara`}
            className="w-[190px] rounded-full border border-[#efe1e7] bg-[#fffafc] px-3 py-1.5 text-[11.5px] text-[#352432] outline-none placeholder:text-[#b09ca5] focus:border-[#e7bccb]"
          />
        }
      >
        <ReportTable<CatalogItemReport>
          rows={filtered}
          rowKey={(r) => r.id}
          expandedKey={expanded}
          onRowClick={(r) => setExpanded((cur) => (cur === r.id ? null : r.id))}
          minWidth={1080}
          emptyText={`Bu dönemde ${label.toLocaleLowerCase('tr')} satışı bulunmuyor.`}
          columns={[
            {
              key: 'name',
              header: label,
              width: '22%',
              render: (r) => (
                <span className="flex items-center gap-1.5">
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#c05277] transition-transform ${expanded === r.id ? '' : '-rotate-90'}`} strokeWidth={2} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[#2f2230]">{r.name}</span>
                    <span className="block truncate text-[10.5px] text-[#705a66]">
                      {r.category}
                      {r.subCategory ? ` / ${r.subCategory}` : ''}
                    </span>
                  </span>
                </span>
              ),
              total: () => 'TOPLAM',
            },
            { key: 'sold', header: 'Satış', align: 'right', render: (r) => r.soldCount, total: (rows) => rows.reduce((s, r) => s + r.soldCount, 0) },
            { key: 'cust', header: 'Müşteri', align: 'right', render: (r) => r.customerCount, total: (rows) => rows.reduce((s, r) => s + r.customerCount, 0) },
            {
              key: 'gross',
              header: 'Satış Tutarı',
              align: 'right',
              render: (r) => <span className="font-semibold text-[#2f2230]">{formatTL(Math.round(r.grossAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.grossAmount, 0))),
            },
            {
              key: 'collected',
              header: 'Tahsilat',
              align: 'right',
              render: (r) => <span className="text-[#20705a]">{formatTL(Math.round(r.collectedAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.collectedAmount, 0))),
            },
            {
              key: 'remaining',
              header: 'Kalan',
              align: 'right',
              render: (r) => <span className={r.remainingAmount > 0 ? 'text-[#a83a35]' : 'text-[#705a66]'}>{formatTL(Math.round(r.remainingAmount))}</span>,
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.remainingAmount, 0))),
            },
            {
              key: 'sessions',
              header: 'Seans (kul./top.)',
              align: 'right',
              render: (r) => (
                <span>
                  {r.sessionsUsed}/{r.sessionsTotal}
                  <span className="ml-1.5 font-semibold text-[#20705a]">{r.sessionsRemaining} kalan</span>
                </span>
              ),
              total: (rows) => `${rows.reduce((s, r) => s + r.sessionsUsed, 0)}/${rows.reduce((s, r) => s + r.sessionsTotal, 0)}`,
            },
            {
              key: 'done',
              header: 'Dönemde Yapılan',
              align: 'right',
              render: (r) => <span className="font-semibold text-[#6b4aa0]">{r.sessionsInPeriod}</span>,
              total: (rows) => rows.reduce((s, r) => s + r.sessionsInPeriod, 0),
            },
            {
              key: 'net',
              header: 'Prim Sonrası Net',
              align: 'right',
              render: (r) => (
                <span className={`font-semibold ${r.netRevenue >= 0 ? 'text-[#20705a]' : 'text-[#a83a35]'}`}>
                  {formatTL(Math.round(r.netRevenue))}
                </span>
              ),
              total: (rows) => formatTL(Math.round(rows.reduce((s, r) => s + r.netRevenue, 0))),
            },
            {
              key: 'sellers',
              header: 'Satan',
              width: '16%',
              render: (r) => <PersonChips people={r.sellers.map((s) => ({ name: s.staffName, count: s.soldCount, amount: s.amount }))} max={2} />,
            },
            {
              key: 'performers',
              header: 'Uygulayan',
              width: '16%',
              render: (r) => <PersonChips people={r.performers.map((p) => ({ name: p.staffName, count: p.sessionCount, amount: p.revenue }))} max={2} />,
            },
          ]}
          renderExpanded={(r) => (
            <div className="grid gap-4 md:grid-cols-2">
              <BreakdownBlock
                title="Kim sattı"
                icon={UserCheck}
                rows={r.sellers.map((s) => ({
                  name: s.staffName,
                  primary: `${s.soldCount} satış`,
                  secondary: `${s.customerCount} müşteri`,
                  amount: s.amount,
                }))}
                emptyText="Satış personeli kaydı yok."
              />
              <BreakdownBlock
                title="Kim uyguladı (dönemde)"
                icon={Activity}
                rows={r.performers.map((p) => ({
                  name: p.staffName,
                  primary: `${p.sessionCount} seans`,
                  secondary: `${p.customerCount} müşteri`,
                  amount: p.revenue,
                }))}
                emptyText="Bu dönemde tamamlanan seans yok."
              />
              {r.cancelledCount > 0 && (
                <div className="md:col-span-2">
                  <Pill tone="bad">
                    <XCircle className="h-3 w-3" /> {r.cancelledCount} iptal · {formatTL(Math.round(r.cancelledAmount))}
                  </Pill>
                </div>
              )}
            </div>
          )}
        />
      </ReportCard>
    </div>
  )
}

function BreakdownBlock({
  title,
  icon: Icon,
  rows,
  emptyText,
}: {
  title: string
  icon: typeof Users
  rows: { name: string; primary: string; secondary: string; amount: number }[]
  emptyText: string
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <div className="rounded-[14px] border border-[#f2e6eb] bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#8a7480]">
        <Icon className="h-3.5 w-3.5 text-[#c05277]" strokeWidth={1.9} /> {title}
      </div>
      {rows.length === 0 ? (
        <div className="mt-2 text-[11.5px] text-[#705a66]">{emptyText}</div>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => {
            const share = total > 0 ? Math.round((r.amount / total) * 100) : 0
            return (
              <div key={`${r.name}-${i}`}>
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[9px] font-bold text-white">
                    {initials(r.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#2f2230]">{r.name}</span>
                    <span className="block text-[10.5px] text-[#705a66]">
                      {r.primary} · {r.secondary}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[12px] font-bold text-[#2f2230]">{formatTL(Math.round(r.amount))}</span>
                    <span className="block text-[10px] font-semibold text-[#a34a62]">%{share}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#f6e3ea]">
                  <span className="block h-full rounded-full bg-[linear-gradient(90deg,#e78ba8,#c05277)]" style={{ width: `${Math.max(4, share)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PartyRank {
  name: string
  count: number
  customers: number
  amount: number
}

function aggregateSellers(items: CatalogItemReport[]): PartyRank[] {
  const map = new Map<string, PartyRank>()
  for (const item of items) {
    for (const s of item.sellers) {
      const cur = map.get(s.staffName) ?? { name: s.staffName, count: 0, customers: 0, amount: 0 }
      cur.count += s.soldCount
      cur.customers = Math.max(cur.customers, s.customerCount)
      cur.amount += s.amount
      map.set(s.staffName, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

function aggregatePerformers(items: CatalogItemReport[]): PartyRank[] {
  const map = new Map<string, PartyRank>()
  for (const item of items) {
    for (const p of item.performers) {
      const cur = map.get(p.staffName) ?? { name: p.staffName, count: 0, customers: 0, amount: 0 }
      cur.count += p.sessionCount
      cur.customers = Math.max(cur.customers, p.customerCount)
      cur.amount += p.revenue
      map.set(p.staffName, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

const emptyTotals: CatalogTotals = {
  soldCount: 0,
  customerCount: 0,
  grossAmount: 0,
  collectedAmount: 0,
  remainingAmount: 0,
  sessionsTotal: 0,
  sessionsUsed: 0,
  sessionsRemaining: 0,
  sessionsInPeriod: 0,
  sessionRevenue: 0,
  commissionCost: 0,
  netRevenue: 0,
  cancelledCount: 0,
  cancelledAmount: 0,
}
