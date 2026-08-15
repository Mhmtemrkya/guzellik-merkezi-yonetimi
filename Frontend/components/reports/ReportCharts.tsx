'use client'

/**
 * Raporlar sayfasının görselleştirme kiti — hepsi bağımlılıksız, tek dosyada SVG.
 *
 *  TrendChart      · çok serili canlı alan/çizgi grafiği (karşılaştırma serisi kesikli)
 *  DonutChart      · dairesel dağılım, ortada toplam, tıklanabilir açıklama
 *  RadialGauge     · tek oranı gösteren halka
 *  RankBars        · sıralı yatay bar listesi (animasyonlu dolum)
 *  ComparisonBars  · dönem ↔ karşılaştırma dönemi ikili bar
 *  MiniSpark       · KPI kartındaki minik eğri
 *  HeatGrid        · gün × saat yoğunluk ızgarası
 *
 * Okunabilirlik kuralı: metinler düşük opaklıkta değil, koyu tonlarda (#4a3a44 / #705a66).
 */

import { useId, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

// ---------------------------------------------------------------------------
// Palet — marka renkleri (burgundy + gül + rose gold + nane/menekşe vurguları)
// ---------------------------------------------------------------------------

export const chartPalette = [
  '#c85776',
  '#7b52ba',
  '#2c7d63',
  '#c99a2e',
  '#4a7fb5',
  '#b3453f',
  '#8a6d3b',
  '#5d8a7b',
  '#a3576f',
  '#6b4aa0',
] as const

export function paletteAt(index: number): string {
  return chartPalette[index % chartPalette.length]
}

const trFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })

function short(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}B`
  return trFmt.format(Math.round(value))
}

// ===========================================================================
// TrendChart
// ===========================================================================

export interface TrendSeries {
  key: string
  label: string
  color: string
  values: number[]
  /** Karşılaştırma serisi kesikli ve soluk çizilir, alanı doldurulmaz. */
  dashed?: boolean
  /** Alanı gradient ile doldur (yalnız ana seriler için). */
  filled?: boolean
}

export interface TrendChartProps {
  labels: string[]
  series: TrendSeries[]
  height?: number
  /** Değer biçimlendirici (₺ / adet). */
  format?: (value: number) => string
  emptyText?: string
}

export function TrendChart({ labels, series, height = 260, format = short, emptyText = 'Bu dönemde veri yok.' }: TrendChartProps) {
  const gradientId = useId().replace(/[:]/g, '')
  const [hover, setHover] = useState<number | null>(null)

  const visible = series.filter((s) => s.values.length > 0)
  const maxValue = useMemo(() => {
    let max = 0
    let min = 0
    for (const s of visible) {
      for (const v of s.values) {
        if (v > max) max = v
        if (v < min) min = v
      }
    }
    return { max: max === 0 && min === 0 ? 1 : max, min }
  }, [visible])

  if (labels.length === 0 || visible.length === 0) {
    return (
      <div className="grid h-48 place-items-center rounded-[16px] border border-dashed border-[#efe1e7] bg-[#fffafc] text-[12px] text-[#705a66]">
        {emptyText}
      </div>
    )
  }

  const W = 1000
  const H = height
  const PAD = { left: 56, right: 16, top: 16, bottom: 30 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const span = maxValue.max - Math.min(0, maxValue.min)
  const yOf = (v: number): number => PAD.top + innerH - ((v - Math.min(0, maxValue.min)) / (span || 1)) * innerH
  const xOf = (i: number): number => PAD.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW)

  const pathOf = (values: number[]): string =>
    values
      .map((v, i) => {
        const x = xOf(i)
        const y = yOf(v)
        if (i === 0) return `M ${x} ${y}`
        const px = xOf(i - 1)
        const py = yOf(values[i - 1])
        return `C ${px + (x - px) * 0.42} ${py} ${x - (x - px) * 0.42} ${y} ${x} ${y}`
      })
      .join(' ')

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.min(0, maxValue.min) + p * (span || 1))
  const labelStep = Math.max(1, Math.ceil(labels.length / 9))
  const zeroY = yOf(0)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
        <defs>
          {visible.map((s, i) => (
            <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {gridValues.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="#e3ccd6" strokeDasharray="3 5" strokeWidth={1} />
            <text x={PAD.left - 8} y={yOf(v) + 4} textAnchor="end" fontSize={11} fill="#705a66" fontFamily="ui-monospace, monospace">
              {format(v)}
            </text>
          </g>
        ))}

        {maxValue.min < 0 && (
          <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#b3453f" strokeWidth={1.2} strokeOpacity={0.55} />
        )}

        {visible.map((s, i) => (
          <g key={s.key}>
            {s.filled !== false && !s.dashed && (
              <motion.path
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                d={`${pathOf(s.values)} L ${xOf(s.values.length - 1)} ${yOf(Math.min(0, maxValue.min))} L ${xOf(0)} ${yOf(Math.min(0, maxValue.min))} Z`}
                fill={`url(#${gradientId}-${i})`}
              />
            )}
            <motion.path
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              d={pathOf(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 2 : 2.6}
              strokeDasharray={s.dashed ? '7 6' : undefined}
              strokeOpacity={s.dashed ? 0.72 : 1}
              strokeLinecap="round"
            />
          </g>
        ))}

        {hover !== null && (
          <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#c85776" strokeWidth={1.2} strokeDasharray="4 4" />
        )}
        {hover !== null &&
          visible.map((s) => (
            <circle key={`dot-${s.key}`} cx={xOf(hover)} cy={yOf(s.values[hover] ?? 0)} r={4.5} fill="#fff" stroke={s.color} strokeWidth={2.4} />
          ))}

        {labels.map((_, i) =>
          i % labelStep === 0 || i === labels.length - 1 ? (
            <text key={`x-${i}`} x={xOf(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#705a66" fontFamily="ui-monospace, monospace">
              {labels[i]}
            </text>
          ) : null,
        )}

        {labels.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={xOf(i) - innerW / Math.max(1, labels.length) / 2}
            y={PAD.top}
            width={Math.max(6, innerW / Math.max(1, labels.length))}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-[12px] border border-[#efe1e7] bg-white/97 px-3 py-2 shadow-[0_18px_40px_-24px_rgba(150,78,104,0.5)]">
          <div className="text-[11px] font-semibold text-[#2f2230]">{labels[hover]}</div>
          <div className="mt-1 space-y-0.5">
            {visible.map((s) => (
              <div key={`tip-${s.key}`} className="flex items-center gap-2 text-[11px] text-[#4a3a44]">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
                <span className="min-w-[92px]">{s.label}</span>
                <span className="font-semibold text-[#2f2230]">{format(s.values[hover] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {visible.map((s) => (
          <span key={`lg-${s.key}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4a3a44]">
            <span
              className="inline-block h-2.5 w-4 rounded-full"
              style={{ background: s.dashed ? `repeating-linear-gradient(90deg, ${s.color} 0 5px, transparent 5px 9px)` : s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// DonutChart
// ===========================================================================

export interface DonutSlice {
  key: string
  label: string
  value: number
  color?: string
}

export function DonutChart({
  slices,
  total,
  centerLabel,
  format = (v) => trFmt.format(Math.round(v)),
  size = 190,
  thickness = 26,
}: {
  slices: DonutSlice[]
  total?: number
  centerLabel?: string
  format?: (value: number) => string
  size?: number
  thickness?: number
}) {
  const [active, setActive] = useState<string | null>(null)
  const sum = total ?? slices.reduce((s, x) => s + x.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius

  if (slices.length === 0 || sum <= 0) {
    return (
      <div className="grid h-40 place-items-center rounded-[16px] border border-dashed border-[#efe1e7] bg-[#fffafc] text-[12px] text-[#705a66]">
        Bu dönemde veri yok.
      </div>
    )
  }

  let offset = 0
  const arcs = slices.map((s, i) => {
    const fraction = s.value / sum
    const arc = { ...s, color: s.color ?? paletteAt(i), fraction, dash: fraction * circumference, offset }
    offset += fraction * circumference
    return arc
  })

  const focused = arcs.find((a) => a.key === active) ?? null

  return (
    <div className="flex flex-wrap items-center justify-center gap-5 sm:flex-nowrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f6e3ea" strokeWidth={thickness} />
          {arcs.map((a) => (
            <motion.circle
              key={a.key}
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${a.dash} ${circumference - a.dash}` }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={a.color}
              strokeWidth={active === a.key ? thickness + 5 : thickness}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
              opacity={active && active !== a.key ? 0.32 : 1}
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
              style={{ transition: 'stroke-width .2s ease, opacity .2s ease', cursor: 'pointer' }}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-display text-[19px] font-bold leading-none text-[#2f2230]">
              {format(focused ? focused.value : sum)}
            </div>
            <div className="mt-1 max-w-[110px] text-[10px] font-semibold text-[#705a66]">
              {focused ? focused.label : centerLabel ?? 'Toplam'}
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-[150px] flex-1 space-y-1.5">
        {arcs.map((a) => (
          <button
            key={`lg-${a.key}`}
            type="button"
            onMouseEnter={() => setActive(a.key)}
            onMouseLeave={() => setActive(null)}
            className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors ${
              active === a.key ? 'bg-[#fff2f6]' : 'hover:bg-[#fffafc]'
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[#4a3a44]">{a.label}</span>
            <span className="shrink-0 text-[11.5px] font-bold text-[#2f2230]">{format(a.value)}</span>
            <span className="w-[38px] shrink-0 text-right text-[10.5px] font-semibold text-[#a34a62]">
              %{Math.round(a.fraction * 100)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// RadialGauge
// ===========================================================================

export function RadialGauge({
  value,
  label,
  hint,
  color = '#c85776',
  size = 132,
}: {
  /** 0–100 arası oran. */
  value: number
  label: string
  hint?: string
  color?: string
  size?: number
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const thickness = 12
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f6e3ea" strokeWidth={thickness} />
          <motion.circle
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${dash} ${circumference - dash}` }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-[20px] font-bold text-[#2f2230]">%{Math.round(clamped)}</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-[11.5px] font-semibold text-[#4a3a44]">{label}</div>
        {hint && <div className="mt-0.5 text-[10.5px] text-[#705a66]">{hint}</div>}
      </div>
    </div>
  )
}

// ===========================================================================
// RankBars
// ===========================================================================

export interface RankBarItem {
  key: string
  label: string
  value: number
  hint?: string
  color?: string
}

export function RankBars({
  items,
  format = (v) => trFmt.format(Math.round(v)),
  max,
  emptyText = 'Kayıt yok.',
}: {
  items: RankBarItem[]
  format?: (value: number) => string
  max?: number
  emptyText?: string
}) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.abs(i.value)))
  if (items.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-6 text-center text-[12px] text-[#705a66]">
        {emptyText}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.key} className="group">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#fff2f6] text-[10px] font-bold text-[#a34a62]">
                {i + 1}
              </span>
              <span className="truncate text-[12px] font-medium text-[#2f2230]">{item.label}</span>
            </span>
            <span className="shrink-0 text-[12px] font-bold text-[#2f2230]">{format(item.value)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#f6e3ea]">
            <motion.span
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(3, (Math.abs(item.value) / top) * 100)}%` }}
              transition={{ duration: 0.7, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              className="block h-full rounded-full"
              style={{ background: item.color ?? `linear-gradient(90deg, ${paletteAt(i)}aa, ${paletteAt(i)})` }}
            />
          </div>
          {item.hint && <div className="mt-1 text-[10.5px] text-[#705a66]">{item.hint}</div>}
        </div>
      ))}
    </div>
  )
}

// ===========================================================================
// ComparisonBars — dönem ↔ karşılaştırma dönemi
// ===========================================================================

export function ComparisonBars({
  rows,
  currentLabel,
  previousLabel,
  format = (v) => trFmt.format(Math.round(v)),
}: {
  rows: { key: string; label: string; current: number; previous: number }[]
  currentLabel: string
  previousLabel: string
  format?: (value: number) => string
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.current), Math.abs(r.previous)]))
  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-6 text-center text-[12px] text-[#705a66]">
        Karşılaştırılacak veri yok.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-[#4a3a44]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-full bg-[#c85776]" /> {currentLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-full bg-[#d9b8c5]" /> {previousLabel}
        </span>
      </div>
      {rows.map((row, i) => {
        const change = row.previous === 0 ? null : ((row.current - row.previous) / Math.abs(row.previous)) * 100
        return (
          <div key={row.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] font-medium text-[#2f2230]">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-[12px] font-bold text-[#2f2230]">{format(row.current)}</span>
                {change !== null && (
                  <span className={`text-[10.5px] font-bold ${change >= 0 ? 'text-[#2c7d63]' : 'text-[#b3453f]'}`}>
                    {change >= 0 ? '▲' : '▼'} %{Math.abs(Math.round(change))}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f6e3ea]">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, (Math.abs(row.current) / max) * 100)}%` }}
                  transition={{ duration: 0.7, delay: i * 0.04 }}
                  className="block h-full rounded-full bg-[linear-gradient(90deg,#e78ba8,#c85776)]"
                />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#f9eef2]">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, (Math.abs(row.previous) / max) * 100)}%` }}
                  transition={{ duration: 0.7, delay: i * 0.04 + 0.08 }}
                  className="block h-full rounded-full bg-[#d9b8c5]"
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===========================================================================
// MiniSpark
// ===========================================================================

export function MiniSpark({ values, color = '#c85776', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/[:]/g, '')
  if (values.length < 2) return <div style={{ height }} />
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const W = 100
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: height - ((v - min) / span) * height,
  }))
  const d = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L ${W} ${height} L 0 ${height} Z`} fill={`url(#spark-${id})`} />
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8 }}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// ===========================================================================
// HeatGrid — haftanın günü × saat
// ===========================================================================

const trDays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

/**
 * Gün × saat yoğunluk ızgarası.
 *
 * Hücrelerin İÇİNDE RAKAM VAR: renk yalnızca "daha yoğun / daha az yoğun" diyordu, "kaç randevu"
 * ancak fareyle üzerine gelince (ve dokunmatikte hiç) okunabiliyordu. Sıfırlar boş bırakılır —
 * 90 küsur "0" yazmak ızgarayı gürültüye çeviriyor, dolu saatler kayboluyordu.
 *
 * KONTRAST TERS DÖNER: zemin şeffaflığı 0.18 → 1.0 arasında gezindiği için tek bir mürekkep rengi
 * yetmez; koyu hücrede beyaz, açık hücrede koyu yazılır (asgari punto 10px).
 */
export function HeatGrid({ cells }: { cells: { dayOfWeek: number; hour: number; count: number }[] }) {
  const { map, max, hours, dayTotals, peakKey } = useMemo(() => {
    const m = new Map<string, number>()
    const totals = Array(7).fill(0) as number[]
    let mx = 0
    let peak = ''
    let minHour = 23
    let maxHour = 8
    for (const c of cells) {
      const key = `${c.dayOfWeek}-${c.hour}`
      m.set(key, c.count)
      if (c.dayOfWeek >= 0 && c.dayOfWeek < 7) totals[c.dayOfWeek] += c.count
      if (c.count > mx) { mx = c.count; peak = key }
      if (c.hour < minHour) minHour = c.hour
      if (c.hour > maxHour) maxHour = c.hour
    }
    const from = Math.min(minHour, 8)
    const to = Math.max(maxHour, 20)
    return {
      map: m,
      max: mx || 1,
      hours: Array.from({ length: to - from + 1 }, (_, i) => from + i),
      dayTotals: totals,
      peakKey: peak,
    }
  }, [cells])

  if (cells.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-6 text-center text-[12px] text-[#705a66]">
        Bu dönemde randevu yok.
      </div>
    )
  }

  const maxDayTotal = Math.max(1, ...dayTotals)

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        {/* Saat başlığı */}
        <div className="flex gap-[3px] pb-1 pl-10 pr-[58px]">
          {hours.map((h) => (
            <div key={h} className="flex-1 text-center text-[10px] font-semibold tabular-nums text-[#705a66]">
              {h}
            </div>
          ))}
        </div>

        {trDays.map((day, di) => (
          <div key={day} className="mt-[3px] flex items-center gap-[3px]">
            <div className="w-10 shrink-0 text-[11px] font-semibold text-[#4a3a44]">{day}</div>
            {hours.map((h, hi) => {
              const key = `${di}-${h}`
              const count = map.get(key) ?? 0
              const intensity = count / max
              // 0.55 üstü zemin koyudur; mürekkep beyaza döner (aksi hâlde yazı kayboluyor).
              const dark = intensity > 0.55
              return (
                <motion.div
                  key={key}
                  title={`${day} ${h}:00 · ${count} randevu`}
                  initial={{ opacity: 0, scale: 0.72 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.32,
                    ease: [0.22, 1, 0.36, 1],
                    delay: Math.min((di * 3 + hi) * 0.006, 0.34),
                  }}
                  whileHover={{ scale: 1.14, zIndex: 2 }}
                  className={`relative grid h-7 flex-1 place-items-center rounded-[5px] text-[10.5px] font-bold tabular-nums ${
                    key === peakKey && count > 0 ? 'ring-2 ring-[#7b2c46] ring-offset-1 ring-offset-white' : ''
                  }`}
                  style={{
                    background: count === 0 ? '#f9eef2' : `rgba(200, 87, 118, ${0.18 + intensity * 0.82})`,
                    color: dark ? '#ffffff' : '#5a2338',
                  }}
                >
                  {/* Sıfır YAZILMAZ: boş kutu zaten "randevu yok" demektir. */}
                  {count > 0 ? count : ''}
                </motion.div>
              )
            })}
            {/* Gün toplamı — "hangi gün daha dolu" sorusu satırın sonunda cevaplanır. */}
            <div className="flex w-[55px] shrink-0 items-center gap-1.5 pl-1.5">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f9eef2]">
                <motion.span
                  className="block h-full rounded-full bg-[#c85776]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round((dayTotals[di] / maxDayTotal) * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 + di * 0.04 }}
                />
              </span>
              <span className="w-5 text-right text-[10.5px] font-semibold tabular-nums text-[#4a3a44]">{dayTotals[di]}</span>
            </div>
          </div>
        ))}

        {/* Ölçek — rakamlar hücrede, renk yine de "ne kadar yoğun"u anlatıyor. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f6e6ec] pt-2.5">
          {/* TOPLAM BURADA YAZILMAZ: kartın alt başlığı zaten dönemin randevu adedini BAŞKA bir
              kaynaktan yazıyor. İki rakamı yan yana koymak, kutulara girmeyen bir randevu
              (saatsiz kayıt, aralık dışı saat) olduğunda kartı kendi kendisiyle çelişik
              gösterirdi. Burada yalnız ızgaranın kendi ölçeği durur. */}
          <span className="text-[11px] font-semibold text-[#4a3a44]">
            En yoğun kutu <span className="tabular-nums text-[#c85776]">{max}</span> randevu
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-[#705a66]">
            az
            {[0.18, 0.4, 0.6, 0.8, 1].map((a) => (
              <span key={a} className="h-3 w-5 rounded-[3px]" style={{ background: `rgba(200, 87, 118, ${a})` }} />
            ))}
            çok
          </span>
        </div>
      </div>
    </div>
  )
}
