'use client'

import type { ReactNode } from 'react'
import { motion, type Variants } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// PANEL DİLİ (ortak)
// Kurum yöneticisi panelinin görsel imzası: BEYAZ yüzey, üstte marka
// hairline'i (pembe -> bordo), köşede yumuşak hale, renkli başlık bandı ve
// kartın altını boydan boya kaplayan trend şeridi.
// Renkler /panel panosuyla ORTAK paletten gelir (globals.css -> Dashboard paleti):
// #A5556E plum · #F9A1B9 pink · #1E4E8C blue · #8E7882 mauve · #F7F6F6 paper.
//
// Buradaki parçalar /panel panelinde doğmuştu ve orada YEREL tanımlı kalmaya
// devam ediyor (o sayfa 2000+ satır; taşımak gereksiz regresyon riski).
// Personel paneli aynı dili kullansın diye ortak sürüm buraya çıkarıldı;
// ileride /panel de bunlara geçebilir.
// ---------------------------------------------------------------------------

export type PanelTone = 'rose' | 'gold' | 'mint' | 'violet' | 'peach' | 'cream'

/** İkon kutusu + kısayol yüzeyleri (kenarlık · zemin · yazı). */
export const toneClasses: Record<PanelTone, string> = {
  rose: 'border-[#DFAFBF] bg-[#F6DFE6] text-[#7A3450]',
  gold: 'border-[#8FD5B4] bg-[#DFF3EA] text-[#15694A]',
  mint: 'border-[#AFC9E6] bg-[#E7F0FA] text-[#245C9E]',
  violet: 'border-[#D3A6B7] bg-[#F2DEE7] text-[#5F2A41]',
  peach: 'border-[#F6B7CA] bg-[#FDE4EB] text-[#BE3960]',
  cream: 'border-[#CBC1C6] bg-[#EFECEE] text-[#4E4048]',
}

/** İkon rozeti — dolu renk, beyaz ikon (bant açık, doygunluk rozetten gelir). */
export const toneIcon: Record<PanelTone, string> = {
  rose: 'bg-[#A5556E]',
  gold: 'bg-[#1E8C60]',
  mint: 'bg-[#3A72B0]',
  violet: 'bg-[#723550]',
  peach: 'bg-[#E4577F]',
  cream: 'bg-[#74616A]',
}

/** Kartın renkli başlık bandı. */
export const toneSurface: Record<PanelTone, string> = {
  rose: 'from-[#F9E8ED] to-[#F0D0DB]',
  gold: 'from-[#E9F6F0] to-[#CDEBDD]',
  violet: 'from-[#F3E1E9] to-[#E4C7D4]',
  mint: 'from-[#EDF4FB] to-[#D8E7F6]',
  peach: 'from-[#FDECF1] to-[#FBD1DE]',
  cream: 'from-[#F4F2F3] to-[#E4DEE1]',
}

/** Trend şeridinin çizgi rengi. */
export const toneStroke: Record<PanelTone, string> = {
  rose: '#A5556E', gold: '#1E8C60', violet: '#723550', mint: '#3A72B0', peach: '#E4577F', cream: '#74616A',
}

export const panelCardShell =
  'relative overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_22px_58px_-38px_rgba(87,39,61,0.55)] transition-shadow hover:shadow-[0_28px_66px_-34px_rgba(87,39,61,0.6)]'

export const panelListContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.08 } },
}

export const panelListRow: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

/** Kartın üst kenarındaki marka çizgisi — pembe → bordo → pembe. */
export function BrandHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
      style={{ background: 'linear-gradient(90deg, transparent, #F9A1B9 20%, #A5556E 50%, #F9A1B9 80%, transparent)' }}
    />
  )
}

/** Kartın altını boydan boya kaplayan yumuşak alan grafiği (dönemin gerçek serisi). */
export function AreaSpark({ values, tone, idSuffix = '' }: { values: number[]; tone: PanelTone; idSuffix?: string }) {
  const max = Math.max(1, ...values)
  const line = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${30 - (v / max) * 25}`)
    .join(' ')
  const stroke = toneStroke[tone]
  // Aynı sayfada birden çok kart varsa gradient id'leri çakışmamalı.
  const gid = `panel-spark-${tone}${idSuffix}`
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.30" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${line} 100,30`} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Yüzdeyi konik gradientle dolduran halka (başarı/doluluk oranı). */
export function DonutGauge({ value, label }: { value: number; label?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      className="grid h-[74px] w-[74px] place-items-center rounded-full"
      style={{ background: `conic-gradient(#1E8C60 ${percent * 3.6}deg, #DFF3EA 0deg)` }}
      aria-label={`${label || 'Oran'} ${percent}%`}
    >
      <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white text-[15px] font-semibold text-[#15694A]">
        {percent}%
      </div>
    </div>
  )
}

/** Pill biçimli dönem seçici. Anahtar tipi çağırana bırakılır. */
export function PeriodTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { key: T; label: string }[]
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none transition-colors ${
            value === option.key
              ? 'bg-[#A5556E] text-white shadow-sm'
              : 'text-[#74616A] hover:text-[#2A2027]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Panelin büyük rakam kartı: renkli başlık bandı + ikon, büyük değer, rozetler
 * ve (seri verilirse) kartın altında dönemin gerçek trendi.
 */
export function PanelMetricCard({
  icon: Icon,
  title,
  value,
  detail,
  subDetail,
  visual,
  series,
  control,
  tone = 'rose',
}: {
  icon: LucideIcon
  title: string
  value: ReactNode
  detail: ReactNode
  subDetail?: ReactNode
  /** Seri verilmediğinde rakamın yanında duran görsel (ör. başarı halkası). */
  visual?: ReactNode
  /** Verilirse kartın altına boydan boya alan grafiği çizilir. */
  series?: number[]
  control?: ReactNode
  tone?: PanelTone
}) {
  return (
    <motion.div
      variants={panelListRow}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`${panelCardShell} group flex min-h-[188px] flex-col`}
    >
      <BrandHairline />

      <div className={`relative flex min-h-[76px] items-start justify-between gap-3 bg-gradient-to-br ${toneSurface[tone]} px-5 pb-4 pt-5`}>
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/55 blur-2xl transition-transform duration-500 group-hover:scale-110" />
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] text-white shadow-[0_12px_26px_-14px_rgba(42,32,39,0.75)] transition-transform duration-300 group-hover:scale-105 ${toneIcon[tone]}`}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.85} />
        </span>
        <div className="relative flex shrink-0 flex-col items-end gap-2">{control}</div>
      </div>

      <div className="relative flex flex-1 items-end justify-between gap-3 px-5 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#74616A]">{title}</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-[#2A2027] tabular-nums">{value}</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="rounded-full bg-[#F7F6F6] px-2 py-0.5 font-medium text-[#5A4B53]">{detail}</span>
            {subDetail && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">{subDetail}</span>
            )}
          </div>
        </div>
        {/* Halka gibi büyük görseller gövdede durur — renkli bant tüm kartlarda
            aynı yükseklikte kalsın diye banda konmaz. */}
        {!series && visual && <div className="shrink-0 pb-0.5">{visual}</div>}
      </div>

      {series && series.length > 1 && (
        <div className="relative h-[52px] w-full">
          <AreaSpark values={series} tone={tone} idSuffix={`-${title.replace(/\W+/g, '')}`} />
        </div>
      )}
    </motion.div>
  )
}

/** Başlıklı içerik kartı (liste/grafik gövdeleri için). */
export function PanelSection({
  title,
  eyebrow,
  action,
  children,
  className = '',
}: {
  title: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={`${panelCardShell} ${className}`}
    >
      <BrandHairline />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#F9A1B9]/35 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          {eyebrow && <div className="text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">{eyebrow}</div>}
          <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-[#2A2027]">{title}</h2>
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </motion.section>
  )
}
