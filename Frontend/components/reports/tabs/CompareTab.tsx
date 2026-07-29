'use client'

/**
 * KARŞILAŞTIRMA sekmesi — serbest seçilmiş 2–5 dönemi yan yana koyar.
 * "Bu yıl ↔ 5 yıl önce" gibi uzun aralıklı kıyaslar için tasarlandı; sayfanın üstündeki
 * dönem/kıyas çubuğuna bağlı DEĞİLDİR, kendi dönem kurucusu vardır.
 *
 *  1. Dönem kurucu : yıl çipleri (son 8 yıl), hızlı kalıplar ("Son 5 yıl", "Bu yıl ↔ 5 yıl önce"),
 *                    her dönem için serbest tarih aralığı ve etiket.
 *  2. Kıyas tablosu : satır = metrik, kolon = dönem; temel döneme göre yüzde fark.
 *  3. Grafikler     : dönemler üst üste binen eğri, gruplu barlar, dönem başına dağılım.
 */

import { useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarRange,
  GitCompareArrows,
  Layers,
  Plus,
  Sparkles,
  Trophy,
  UserCog,
  X,
} from 'lucide-react'
import { ComparisonBars, RankBars, TrendChart, paletteAt, type TrendSeries } from '@/components/reports/ReportCharts'
import { Pill, ReportCard, formatValue, type ReportValueUnit } from '@/components/reports/ReportUi'
import { useMetricDetail } from '@/components/reports/MetricDetailContext'
import { formatTL } from '@/lib/apiMappers'
import { describeRange, fromDateInput, toDateInput, type DateRange } from '@/lib/reportRanges'
import type { CompareReport, ComparePeriod } from '@/lib/reportTypes'

/** Kurucudaki tek dönem: serbest aralık + kullanıcı etiketi. */
export interface CompareSlot {
  id: string
  label: string
  range: DateRange
}

export const MAX_COMPARE_SLOTS = 5

/** Bir takvim yılı için hazır slot. */
export function yearSlot(year: number): CompareSlot {
  return {
    id: `y${year}-${Math.random().toString(36).slice(2, 7)}`,
    label: String(year),
    range: { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) },
  }
}

/** Sekmenin varsayılanı: bu yıl ↔ geçen yıl. */
export function defaultCompareSlots(): CompareSlot[] {
  const y = new Date().getFullYear()
  return [yearSlot(y), yearSlot(y - 1)]
}

export default function CompareTab({
  data,
  slots,
  onSlotsChange,
  loading,
}: {
  data: CompareReport | null
  slots: CompareSlot[]
  onSlotsChange: (next: CompareSlot[]) => void
  loading: boolean
}) {
  const detail = useMetricDetail()
  const [editing, setEditing] = useState<string | null>(null)
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 8 }, (_, i) => thisYear - i)

  const periods = data?.periods ?? []
  const baseline = periods.find((p) => p.isBaseline) ?? periods[0] ?? null

  const setSlot = (id: string, patch: Partial<CompareSlot>): void =>
    onSlotsChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const addSlot = (slot: CompareSlot): void => {
    if (slots.length >= MAX_COMPARE_SLOTS) return
    onSlotsChange([...slots, slot])
  }

  const removeSlot = (id: string): void => {
    if (slots.length <= 2) return // kıyas için en az iki dönem şart
    onSlotsChange(slots.filter((s) => s.id !== id))
  }

  const usedYears = new Set(slots.map((s) => s.label))

  // Metrik satırları temel dönemden alınır; diğer dönemler aynı sırayı taşır.
  const metricRows = useMemo(() => {
    if (!baseline) return []
    return baseline.metrics.map((m, i) => ({
      key: m.key,
      label: m.label,
      unit: m.unit as ReportValueUnit,
      values: periods.map((p) => p.metrics[i]?.value ?? 0),
    }))
  }, [baseline, periods])

  const trendSeries: TrendSeries[] = periods.map((p, i) => ({
    key: p.key,
    label: p.label,
    color: paletteAt(i),
    values: p.series.map((s) => s.income),
    filled: i === 0,
    dashed: i > 0,
  }))

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- dönem kurucu --- */}
      <ReportCard
        title="Karşılaştırılacak Dönemler"
        subtitle={`${slots.length} dönem · ilk dönem "temel" kabul edilir, farklar ona göre hesaplanır`}
        icon={GitCompareArrows}
        onOpen={() =>
          detail.openKey('compare.builder', {
            breakdown: periods.map((p) => ({
              label: p.label + (p.isBaseline ? ' (temel)' : ''),
              value: formatTL(Math.round(metricValue(p, 'net'))),
              hint: `${p.dayCount} gün · ${formatTL(Math.round(metricValue(p, 'income')))} gelir`,
            })),
          })
        }
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSlotsChange([thisYear, thisYear - 5].map(yearSlot))}
              className="rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-3 py-1.5 text-[11px] font-semibold text-[#6b4aa0] transition-colors hover:border-[#c4aee8]"
            >
              Bu yıl ↔ 5 yıl önce
            </button>
            <button
              type="button"
              onClick={() => onSlotsChange(Array.from({ length: 5 }, (_, i) => yearSlot(thisYear - i)))}
              className="rounded-full border border-[#efe1e7] bg-[#fff8fa] px-3 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:border-[#e7bccb]"
            >
              Son 5 yıl
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {slots.map((slot, i) => (
              <div
                key={slot.id}
                className="min-w-[212px] flex-1 rounded-[14px] border bg-white p-3"
                style={{ borderColor: i === 0 ? '#c85776' : '#efe1e7' }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: paletteAt(i) }}
                  />
                  <input
                    value={slot.label}
                    onChange={(e) => setSlot(slot.id, { label: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-[#2f2230] outline-none"
                  />
                  {i === 0 ? (
                    <Pill tone="good">Temel</Pill>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      title="Dönemi kaldır"
                      className="grid h-5 w-5 place-items-center rounded-full text-[#705a66] transition-colors hover:bg-[#fff2f6] hover:text-[#a83a35]"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEditing(editing === slot.id ? null : slot.id)}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-[10px] border border-[#f2e6eb] bg-[#fffafc] px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-[#705a66] transition-colors hover:border-[#e7bccb]"
                >
                  <CalendarRange className="h-3 w-3 shrink-0 text-[#c05277]" strokeWidth={1.9} />
                  <span className="truncate">{describeRange(slot.range)}</span>
                </button>

                {editing === slot.id && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-[10px] border border-[#efe1e7] bg-[#fffafc] px-2 py-1.5">
                    <input
                      type="date"
                      value={toDateInput(slot.range.from)}
                      onChange={(e) => {
                        const d = fromDateInput(e.target.value)
                        if (d) setSlot(slot.id, { range: { ...slot.range, from: d } })
                      }}
                      className="w-full bg-transparent text-[11px] font-semibold text-[#4a3a44] outline-none"
                    />
                    <span className="text-[10px] text-[#a3576f]">→</span>
                    <input
                      type="date"
                      value={toDateInput(slot.range.to)}
                      onChange={(e) => {
                        const d = fromDateInput(e.target.value)
                        if (d) setSlot(slot.id, { range: { ...slot.range, to: d } })
                      }}
                      className="w-full bg-transparent text-[11px] font-semibold text-[#4a3a44] outline-none"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Hızlı yıl ekleme */}
          {slots.length < MAX_COMPARE_SLOTS && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#f2e6eb] pt-3">
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[#8a7480]">
                <Plus className="h-3 w-3" strokeWidth={2.4} /> Yıl ekle
              </span>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  disabled={usedYears.has(String(y))}
                  onClick={() => addSlot(yearSlot(y))}
                  className="rounded-full border border-[#efe1e7] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4a3a44] transition-colors hover:border-[#e7bccb] hover:text-[#c05277] disabled:opacity-35 disabled:hover:border-[#efe1e7] disabled:hover:text-[#4a3a44]"
                >
                  {y}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const now = new Date()
                  addSlot({
                    id: `c-${Math.random().toString(36).slice(2, 8)}`,
                    label: 'Özel dönem',
                    range: { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) },
                  })
                }}
                className="rounded-full border border-dashed border-[#e0d3f2] bg-[#faf6ff] px-2.5 py-1 text-[11px] font-semibold text-[#6b4aa0] transition-colors hover:border-[#c4aee8]"
              >
                Özel aralık
              </button>
            </div>
          )}
        </div>
      </ReportCard>

      {periods.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-10 text-center text-[12px] text-[#705a66]">
          {loading ? 'Dönemler hesaplanıyor…' : 'Karşılaştırma verisi yok.'}
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------ kıyas tablosu --- */}
          <ReportCard
            title="Metrik Karşılaştırması"
            subtitle={`Temel dönem: ${baseline?.label ?? '—'} · yüzdeler temele göre`}
            icon={BarChart3}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left" style={{ minWidth: 220 + periods.length * 160 }}>
                <thead>
                  <tr className="border-b border-[#f2e6eb]">
                    <th className="px-2 py-2 text-[10.5px] font-bold uppercase tracking-wide text-[#8a7480]">Metrik</th>
                    {periods.map((p, i) => (
                      <th key={p.key} className="px-2 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteAt(i) }} />
                          <span className="text-[11.5px] font-bold text-[#2f2230]">{p.label}</span>
                          {p.isBaseline && <span className="text-[9.5px] font-semibold text-[#20705a]">temel</span>}
                        </span>
                        <span className="mt-0.5 block text-[9.5px] font-medium text-[#705a66]">{p.dayCount} gün</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f7edf1]">
                  {metricRows.map((row) => (
                    <tr key={row.key} className="hover:bg-[#fffafc]">
                      <td className="px-2 py-2.5 text-[12px] font-semibold text-[#2f2230]">{row.label}</td>
                      {row.values.map((value, i) => {
                        const base = row.values[0]
                        const diff = value - base
                        const pct = base === 0 ? null : (diff / Math.abs(base)) * 100
                        return (
                          <td key={`${row.key}-${i}`} className="px-2 py-2.5 text-right">
                            <span className="block text-[12.5px] font-bold text-[#2f2230]">
                              {formatValue(value, row.unit)}
                            </span>
                            {i > 0 && (
                              <span
                                className={`mt-0.5 block text-[10.5px] font-bold ${
                                  Math.abs(diff) < 0.005
                                    ? 'text-[#705a66]'
                                    : diff > 0
                                      ? 'text-[#20705a]'
                                      : 'text-[#a83a35]'
                                }`}
                              >
                                {Math.abs(diff) < 0.005
                                  ? '—'
                                  : `${diff > 0 ? '▲' : '▼'} ${pct === null ? formatValue(Math.abs(diff), row.unit) : `%${Math.abs(Math.round(pct))}`}`}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportCard>

          {/* --------------------------------------------------------- grafikler --- */}
          <ReportCard
            title="Gelir Eğrileri (üst üste)"
            subtitle={`Ortak eksen · ${data?.granularity === 'month' ? 'aylık' : data?.granularity === 'week' ? 'haftalık' : 'günlük'} kova`}
            icon={Layers}
          >
            <TrendChart
              labels={data?.axisLabels ?? []}
              series={trendSeries}
              height={300}
              format={(v) => formatTL(Math.round(v))}
              emptyText="Seçili dönemlerde tahsilat yok."
            />
          </ReportCard>

          <section className="grid gap-4 lg:grid-cols-2">
            <ReportCard title="Net Kâr" subtitle="Dönem bazında" icon={Trophy}>
              <RankBars
                items={periods.map((p, i) => ({
                  key: p.key,
                  label: p.label,
                  value: metricValue(p, 'net'),
                  color: metricValue(p, 'net') >= 0 ? `linear-gradient(90deg, ${paletteAt(i)}aa, ${paletteAt(i)})` : 'linear-gradient(90deg,#e8a5a1,#b3453f)',
                  hint: `${formatTL(Math.round(metricValue(p, 'income')))} gelir · ${formatTL(Math.round(metricValue(p, 'expense')))} gider · %${Math.round(metricValue(p, 'margin'))} marj`,
                }))}
                format={(v) => formatTL(Math.round(v))}
              />
            </ReportCard>

            <ReportCard title="Gelir ↔ Satış" subtitle="Tahsilat ve satış tutarı yan yana" icon={GitCompareArrows}>
              <ComparisonBars
                rows={periods.map((p) => ({
                  key: p.key,
                  label: p.label,
                  current: metricValue(p, 'income'),
                  previous: metricValue(p, 'sales'),
                }))}
                currentLabel="Tahsilat"
                previousLabel="Satış tutarı"
                format={(v) => formatTL(Math.round(v))}
              />
            </ReportCard>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ReportCard title="Dönemlerin En Çok Uygulanan Hizmetleri" icon={Sparkles}>
              <div className="space-y-4">
                {periods.map((p, i) => (
                  <div key={`svc-${p.key}`}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteAt(i) }} />
                      <span className="text-[11.5px] font-bold text-[#2f2230]">{p.label}</span>
                    </div>
                    <RankBars
                      items={p.topServices.slice(0, 4).map((s) => ({
                        key: `${p.key}-${s.key}`,
                        label: s.label,
                        value: s.count,
                        hint: formatTL(Math.round(s.amount)),
                      }))}
                      format={(v) => `${Math.round(v)} seans`}
                      emptyText="Bu dönemde uygulanan seans yok."
                    />
                  </div>
                ))}
              </div>
            </ReportCard>

            <ReportCard title="Dönemlerin En Çok İş Bitiren Personeli" icon={UserCog}>
              <div className="space-y-4">
                {periods.map((p, i) => (
                  <div key={`stf-${p.key}`}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteAt(i) }} />
                      <span className="text-[11.5px] font-bold text-[#2f2230]">{p.label}</span>
                    </div>
                    <RankBars
                      items={p.topStaff.slice(0, 4).map((s) => ({
                        key: `${p.key}-${s.key}`,
                        label: s.label,
                        value: s.count,
                        hint: formatTL(Math.round(s.amount)),
                      }))}
                      format={(v) => `${Math.round(v)} işlem`}
                      emptyText="Bu dönemde tamamlanan işlem yok."
                    />
                  </div>
                ))}
              </div>
            </ReportCard>
          </section>
        </>
      )}
    </div>
  )
}

function metricValue(period: ComparePeriod, key: string): number {
  return period.metrics.find((m) => m.key === key)?.value ?? 0
}
