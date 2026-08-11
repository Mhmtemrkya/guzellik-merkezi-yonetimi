'use client'

/**
 * Raporlar sayfasının ortak arayüz parçaları: KPI kartı, bölüm kartı, tablo, rozet.
 * Grafikler ayrı dosyada (ReportCharts.tsx) — burada yalnız çerçeve ve tipografi var.
 */

import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Info, Minus, type LucideIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { BrandHairline, panelCardShell } from '@/components/dashboard/PanelKit'
import { formatTL } from '@/lib/apiMappers'
import { MiniSpark } from '@/components/reports/ReportCharts'

const countFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })

export type ReportValueUnit = 'currency' | 'count' | 'percent' | 'duration'

export function formatValue(value: number, unit: ReportValueUnit): string {
  switch (unit) {
    case 'currency':
      return formatTL(Math.round(value))
    case 'percent':
      return `%${Math.round(value)}`
    case 'duration': {
      const hours = Math.floor(value / 60)
      const minutes = Math.round(value % 60)
      return hours > 0 ? `${hours} sa ${minutes} dk` : `${minutes} dk`
    }
    default:
      return countFmt.format(Math.round(value))
  }
}

// ---------------------------------------------------------------------------
// DeltaBadge — dönem ↔ karşılaştırma farkı
// ---------------------------------------------------------------------------

export function DeltaBadge({
  current,
  previous,
  unit = 'count',
  compareLabel,
  /** Gider gibi düşmesi iyi olan metriklerde renkler ters çevrilir. */
  invert = false,
}: {
  current: number
  previous: number
  unit?: ReportValueUnit
  compareLabel?: string
  invert?: boolean
}) {
  if (!compareLabel) return null
  const diff = current - previous
  const pct = previous === 0 ? null : (diff / Math.abs(previous)) * 100
  const positive = invert ? diff < 0 : diff > 0
  const neutral = Math.abs(diff) < 0.005
  const Icon = neutral ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight
  const tone = neutral
    ? 'border-[#e8dbe1] bg-[#faf5f7] text-[#705a66]'
    : positive
      ? 'border-[#cfe8dd] bg-[#f2fbf7] text-[#20705a]'
      : 'border-[#f2c4c4] bg-[#fff4f4] text-[#a83a35]'

  return (
    <span
      title={`${compareLabel}: ${formatValue(previous, unit)}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
      {pct === null ? formatValue(Math.abs(diff), unit) : `%${Math.abs(Math.round(pct))}`}
    </span>
  )
}

// ---------------------------------------------------------------------------
// KpiTile
// ---------------------------------------------------------------------------

export function KpiTile({
  label,
  value,
  unit = 'count',
  previous,
  compareLabel,
  hint,
  icon: Icon,
  tone = 'rose',
  spark,
  invert = false,
  index = 0,
  onOpen,
}: {
  label: string
  value: number
  unit?: ReportValueUnit
  previous?: number
  compareLabel?: string
  hint?: string
  icon: LucideIcon
  tone?: keyof typeof toneStyles
  spark?: number[]
  invert?: boolean
  index?: number
  /** Verilirse kart tıklanabilir olur ve detay modalini açar. */
  onOpen?: () => void
}) {
  const style = toneStyles[tone]
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.035, 0.3), ease: [0.22, 1, 0.36, 1] }}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen()
              }
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      /* PANEL KART DİLİ: beyaz yüzey + DOLU ikon rozeti. Açık tint zeminler (bg-[#fff0f5]
         gibi) paletten çıkarıldı — soluk görünüyor ve panodaki kartlarla aynı dili konuşmuyordu. */
      className={`${panelCardShell} group relative p-4 ${
        onOpen ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BE7690]' : ''
      }`}
    >
      <BrandHairline />
      <div className="relative flex items-start justify-between gap-2">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)] ${style.icon}`}>
          <Icon className="h-4 w-4" strokeWidth={1.85} />
        </span>
        {previous !== undefined && (
          <DeltaBadge current={value} previous={previous} unit={unit} compareLabel={compareLabel} invert={invert} />
        )}
      </div>

      <div className="relative mt-3 text-[11.5px] font-semibold text-[#5A4B53]">{label}</div>
      <div className="relative mt-1 armo-stat-value text-[24px] leading-none sm:text-[27px]">
        <AnimatedNumber value={value} format={(n) => formatValue(n, unit)} />
      </div>
      {hint && <div className="relative mt-1.5 text-[10.5px] text-[#74616A]">{hint}</div>}

      {spark && spark.length > 1 && (
        <div className="relative mt-2 -mx-1 opacity-90">
          <MiniSpark values={spark} color={style.spark} height={30} />
        </div>
      )}

      {onOpen && (
        <span className="pointer-events-none absolute bottom-2.5 right-3 inline-flex items-center gap-1 text-[9.5px] font-semibold text-[#a3576f] opacity-0 transition-opacity group-hover:opacity-100">
          <Info className="h-3 w-3" strokeWidth={2} /> detay
        </span>
      )}
    </motion.div>
  )
}

/* İkon rozetleri paletin DOLU rengiyle (pano diliyle aynı); spark rengi grafik paletinden.
   YEŞİL para rengidir → mint yalnız parasal kartlarda kullanılmalı. */
const toneStyles = {
  rose: { icon: 'bg-[#A5556E] text-white', spark: '#A5556E' },
  mint: { icon: 'bg-[#1E8C60] text-white', spark: '#1E8C60' },
  gold: { icon: 'bg-[#C99A2E] text-white', spark: '#c99a2e' },
  violet: { icon: 'bg-[#8E7882] text-white', spark: '#7b52ba' },
  peach: { icon: 'bg-[#F9A1B9] text-[#5A1730]', spark: '#E4577F' },
  slate: { icon: 'bg-[#1E4E8C] text-white', spark: '#1E4E8C' },
} as const

// ---------------------------------------------------------------------------
// ReportCard — başlıklı bölüm kabuğu
// ---------------------------------------------------------------------------

export function ReportCard({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = '',
  padded = true,
  onOpen,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
  /** Verilirse başlıkta (i) düğmesi çıkar ve detay/açıklama modalini açar. */
  onOpen?: () => void
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      /* PANEL KART DİLİ (bkz. PanelKit → panelCardShell): raporlar da panonun beyaz yüzeyli,
         marka hairline'lı kart dilini kullanır. Tek yerden değişince bütün rapor sekmeleri
         (genel bakış, karşılaştırma, katalog, personel, şube, müşteri, stok) birlikte döner. */
      className={`${panelCardShell} ${className}`}
    >
      <BrandHairline />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#F9A1B9]/25 blur-3xl" />
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-[#EAD8DF] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-[#A5556E] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate font-display text-[14.5px] font-semibold text-[#2A2027]">
              {title}
              {onOpen && (
                <button
                  type="button"
                  onClick={onOpen}
                  title="Bu kart nedir?"
                  aria-label={`${title} — açıklama`}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[#E4DEE0] bg-white text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                >
                  <Info className="h-3 w-3" strokeWidth={2.2} />
                </button>
              )}
            </h3>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-[#74616A]">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className={`relative ${padded ? 'p-4 sm:p-5' : ''}`}>{children}</div>
    </motion.section>
  )
}

// ---------------------------------------------------------------------------
// ReportTable — yatay kaydırmalı, toplam satırlı basit tablo
// ---------------------------------------------------------------------------

export interface ReportTableColumn<T> {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  width?: string
  render: (row: T, index: number) => ReactNode
  /** Toplam satırındaki hücre; verilmezse boş bırakılır. */
  total?: (rows: T[]) => ReactNode
}

export function ReportTable<T>({
  rows,
  columns,
  rowKey,
  emptyText = 'Kayıt bulunamadı.',
  minWidth = 760,
  onRowClick,
  renderExpanded,
  expandedKey,
}: {
  rows: T[]
  columns: ReportTableColumn<T>[]
  rowKey: (row: T, index: number) => string
  emptyText?: string
  minWidth?: number
  onRowClick?: (row: T) => void
  renderExpanded?: (row: T) => ReactNode
  expandedKey?: string | null
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-8 text-center text-[12px] text-[#705a66]">
        {emptyText}
      </div>
    )
  }

  const hasTotals = columns.some((c) => c.total)

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-[#f2e6eb]">
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width }}
                className={`whitespace-nowrap px-2 py-2 text-[10.5px] font-bold uppercase tracking-wide text-[#8a7480] ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f7edf1]">
          {rows.map((row, i) => {
            const key = rowKey(row, i)
            const expanded = expandedKey === key
            return (
              <Fragment key={key}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-[#fff6f9]' : 'hover:bg-[#fffafc]'} ${
                    expanded ? 'bg-[#fff2f6]' : ''
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-2 py-2.5 text-[12px] text-[#4a3a44] ${
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpanded && (
                  <tr className="bg-[#fffafc]">
                    <td colSpan={columns.length} className="px-2 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="border-t-2 border-[#efd9e2] bg-[#fff6f9]">
              {columns.map((c) => (
                <td
                  key={`t-${c.key}`}
                  className={`px-2 py-2.5 text-[12px] font-bold text-[#2f2230] ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
                  {c.total ? c.total(rows) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

export function PersonChips({
  people,
  emptyText = '—',
  max = 3,
}: {
  people: { name: string; count: number; amount?: number }[]
  emptyText?: string
  max?: number
}) {
  if (people.length === 0) return <span className="text-[11px] text-[#705a66]">{emptyText}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {people.slice(0, max).map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          title={p.amount !== undefined ? `${p.name} · ${p.count} · ${formatTL(Math.round(p.amount))}` : `${p.name} · ${p.count}`}
          className="inline-flex items-center gap-1 rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2 py-0.5 text-[10.5px] font-semibold text-[#a34a62]"
        >
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#c05277] text-[8px] font-bold text-white">
            {initials(p.name)}
          </span>
          <span className="max-w-[110px] truncate">{p.name}</span>
          <span className="text-[#705a66]">×{p.count}</span>
        </span>
      ))}
      {people.length > max && <span className="text-[10.5px] font-semibold text-[#705a66]">+{people.length - max}</span>}
    </span>
  )
}

/** "Ayşe Yılmaz" → "AY" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr')
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('tr')
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const styles = {
    neutral: 'border-[#efe1e7] bg-[#fff8fa] text-[#705a66]',
    good: 'border-[#cfe8dd] bg-[#f2fbf7] text-[#20705a]',
    bad: 'border-[#f2c4c4] bg-[#fff4f4] text-[#a83a35]',
    warn: 'border-[#f0e0bd] bg-[#fffaef] text-[#8a6320]',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${styles[tone]}`}>{children}</span>
}
