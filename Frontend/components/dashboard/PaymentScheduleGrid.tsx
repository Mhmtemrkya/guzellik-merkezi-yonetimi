'use client'

import { useEffect, useMemo, useRef } from 'react'
import { formatTL } from '@/lib/apiMappers'
import type { MonthCell } from '@/lib/accountGrouping'

/**
 * AYLIK TAKSİT TAKVİMİ — Excel'deki "aylık ödeme ızgarası"nın panel karşılığı.
 *
 * GERÇEK TABLO: üstte AY SÜTUNLARI (yıl üst başlıkta gruplanır), altında satırlar —
 * Planlanan · Tahsil edilen · Kalan · Durum. Muhasebeci Excel'de neye bakıyorsa aynısı:
 * bir ayın sütununu aşağı okuyunca o ayın tüm hikâyesi çıkar.
 *
 * Hücre rengi durumu söyler: yeşil ödendi · amber kısmi · kırmızı gecikmiş · nötr bekleyen.
 * RENK TEK BAŞINA ANLAM TAŞIMAZ: durum satırında yazı da var (renk körlüğü + s/b çıktı).
 * İlk sütun (satır başlıkları) yapışkandır; yatay kaydırırken hangi satıra baktığın kaybolmasın.
 */

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

const CELL: Record<MonthCell['status'], { bg: string; ink: string; label: string; mark: string }> = {
  paid: { bg: 'bg-emerald-50', ink: 'text-emerald-800', label: 'Ödendi', mark: '✓' },
  partial: { bg: 'bg-amber-50', ink: 'text-amber-900', label: 'Kısmi', mark: '◐' },
  overdue: { bg: 'bg-rose-50', ink: 'text-rose-800', label: 'Gecikmiş', mark: '!' },
  upcoming: { bg: 'bg-white', ink: 'text-[#4a3a44]', label: 'Bekleyen', mark: '·' },
  none: { bg: 'bg-[#fcfafb]', ink: 'text-[#a3908f]', label: '—', mark: '' },
}

/** Sütun genişliği — 12 ay ekrana sığsın ama tutarlar (₺12.345) kırpılmasın. */
const COL = 'min-w-[92px]'

export default function PaymentScheduleGrid({
  cells,
  todayKey,
}: {
  cells: MonthCell[]
  /** `YYYY-MM` — "bugün" sütununu vurgulamak ve oraya kaydırmak için. */
  todayKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const todayRef = useRef<HTMLTableCellElement | null>(null)

  // Açılışta "bugün" sütununa kaydır: 24 aylık planda kullanıcı her seferinde elle sürüklüyordu.
  useEffect(() => {
    const box = scrollRef.current
    const target = todayRef.current
    if (!box || !target) return
    box.scrollLeft = Math.max(0, target.offsetLeft - box.clientWidth / 2 + target.clientWidth / 2)
  }, [cells, todayKey])

  const totals = useMemo(() => ({
    due: cells.reduce((s, c) => s + c.due, 0),
    paid: cells.reduce((s, c) => s + c.paid, 0),
    remaining: cells.reduce((s, c) => s + c.remaining, 0),
    overdue: cells.filter((c) => c.status === 'overdue').reduce((s, c) => s + c.remaining, 0),
  }), [cells])

  /** Yıl üst başlığı: aynı yılın ayları tek hücrede birleşir (Excel'deki yıl bandı). */
  const yearSpans = useMemo(() => {
    const out: { year: number; span: number }[] = []
    for (const c of cells) {
      const last = out[out.length - 1]
      if (last && last.year === c.year) last.span += 1
      else out.push({ year: c.year, span: 1 })
    }
    return out
  }, [cells])

  if (cells.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-8 text-center text-[12px] text-[#705a66]">
        Bu müşteride taksit planı yok — satışlar peşin.
      </div>
    )
  }

  return (
    <div>
      {/* Özet şeridi — KAPSAM AÇIKÇA YAZILI: bu rakamlar YALNIZ taksitleri sayar. Peşinat ve
          peşin satışlar taksit satırı üretmediğinden buraya girmez; üstteki "Tahsil Edilen"
          KPI'ı ise müşterinin TÜM tahsilatıdır (etiketsiz bırakılınca çelişki sanılıyordu). */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <SummaryChip label="Taksit planı" value={totals.due} tone="text-[#4a3a44] border-[#ead8df] bg-white" />
        <SummaryChip label="Taksitlerden tahsil" value={totals.paid} tone="text-emerald-800 border-emerald-200 bg-emerald-50" />
        <SummaryChip label="Kalan taksit" value={totals.remaining} tone="text-[#a3576f] border-[#efbfd0] bg-[#fff4f8]" />
        {totals.overdue > 0.005 && (
          <SummaryChip label="Gecikmiş" value={totals.overdue} tone="text-rose-800 border-rose-200 bg-rose-50" />
        )}
        <span className="ml-auto hidden items-center gap-2 text-[10px] text-[#705a66] sm:flex">
          <Legend swatch="bg-emerald-100 border-emerald-300" text="Ödendi" />
          <Legend swatch="bg-amber-100 border-amber-300" text="Kısmi" />
          <Legend swatch="bg-rose-100 border-rose-300" text="Gecikmiş" />
          <Legend swatch="bg-white border-[#e3d2da]" text="Bekleyen" />
        </span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-[12px] border border-[#ead8df]">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            {/* Yıl bandı — 24 aylık planda "Oca" hangi yılın ocağı sorusu ortaya çıkıyordu. */}
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-2.5 py-1 text-left text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
                Yıl
              </th>
              {yearSpans.map((y) => (
                <th
                  key={y.year}
                  colSpan={y.span}
                  className="border-b border-r border-[#f0dce5] bg-[#fff7fa] px-2 py-1 text-center text-[10px] font-bold text-[#a3576f]"
                >
                  {y.year}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-2.5 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
                Ay
              </th>
              {cells.map((c) => {
                const isToday = c.key === todayKey
                return (
                  <th
                    key={c.key}
                    ref={isToday ? todayRef : undefined}
                    className={`${COL} border-b border-r border-[#f0dce5] px-2 py-1.5 text-center text-[11px] font-bold ${
                      isToday ? 'bg-[#c85776] text-white' : 'bg-[#fff7fa] text-[#352432]'
                    }`}
                  >
                    {MONTHS_SHORT[c.month - 1]}
                    {isToday && <span className="ml-1 text-[8.5px] font-black">BU AY</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <Row
              label="Planlanan"
              cells={cells}
              todayKey={todayKey}
              render={(c) => (c.due > 0 ? formatTL(Math.round(c.due)) : '—')}
              tone="text-[#4a3a44]"
            />
            <Row
              label="Tahsil edilen"
              cells={cells}
              todayKey={todayKey}
              render={(c) => (c.due > 0 ? formatTL(Math.round(c.paid)) : '—')}
              tone="text-emerald-700"
            />
            <Row
              label="Kalan"
              cells={cells}
              todayKey={todayKey}
              render={(c) => (c.due > 0 ? formatTL(Math.round(c.remaining)) : '—')}
              tone="text-[#a3576f]"
              bold
            />
            {/* DURUM satırı rengin yazıyla karşılığıdır — renk körlüğü ve s/b çıktı için şart. */}
            <tr>
              <td className="sticky left-0 z-10 border-r border-[#f0dce5] bg-[#fff7fa] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#a3576f]">
                Durum
              </td>
              {cells.map((c) => {
                const s = CELL[c.status]
                return (
                  <td
                    key={c.key}
                    title={`${MONTHS_SHORT[c.month - 1]} ${c.year} · ${s.label}`}
                    className={`${COL} border-r border-[#f0dce5] px-2 py-1.5 text-center text-[10px] font-bold ${s.bg} ${s.ink} ${
                      c.key === todayKey ? 'ring-1 ring-inset ring-[#c85776]' : ''
                    }`}
                  >
                    {s.mark && <span className="mr-0.5">{s.mark}</span>}
                    {s.label}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Tutar satırı — hücre zemini o ayın durumunu, yazı tutarı verir. */
function Row({
  label,
  cells,
  todayKey,
  render,
  tone,
  bold,
}: {
  label: string
  cells: MonthCell[]
  todayKey: string
  render: (c: MonthCell) => string
  tone: string
  bold?: boolean
}) {
  return (
    <tr>
      <td className="sticky left-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#a3576f]">
        {label}
      </td>
      {cells.map((c) => {
        const s = CELL[c.status]
        return (
          <td
            key={c.key}
            className={`${COL} border-b border-r border-[#f0dce5] px-2 py-1.5 text-right tabular-nums ${s.bg} ${
              c.due > 0 ? tone : 'text-[#c9b3bd]'
            } ${bold && c.due > 0 ? 'font-bold' : ''} ${c.key === todayKey ? 'ring-1 ring-inset ring-[#c85776]' : ''}`}
          >
            {render(c)}
          </td>
        )
      })}
    </tr>
  )
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${tone}`}>
      {label}
      <b className="font-display text-[12px] tabular-nums">{formatTL(Math.round(value))}</b>
    </span>
  )
}

function Legend({ swatch, text }: { swatch: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-[3px] border ${swatch}`} />
      {text}
    </span>
  )
}
