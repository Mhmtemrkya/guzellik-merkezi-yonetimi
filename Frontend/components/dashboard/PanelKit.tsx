'use client'

import type { ReactNode } from 'react'
import { motion, type Variants } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// PANEL DİLİ (ortak)
// Kurum yöneticisi panelinin görsel imzası: krem-beyaz yüzey, üstte altın
// hairline, köşede yumuşak gül halesi, renkli başlık bandı ve kartın altını
// boydan boya kaplayan trend şeridi.
//
// Buradaki parçalar /admin panelinde doğmuştu ve orada YEREL tanımlı kalmaya
// devam ediyor (o sayfa 2000+ satır; taşımak gereksiz regresyon riski).
// Personel paneli aynı dili kullansın diye ortak sürüm buraya çıkarıldı;
// ileride /admin de bunlara geçebilir.
// ---------------------------------------------------------------------------

export type PanelTone = 'rose' | 'gold' | 'mint' | 'violet' | 'peach' | 'cream'

/** İkon kutusu + kısayol yüzeyleri (kenarlık · zemin · yazı). */
export const toneClasses: Record<PanelTone, string> = {
  rose: 'border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]',
  gold: 'border-[#f2dfbf] bg-[#fff8ea] text-[#b88938]',
  mint: 'border-[#d6ece4] bg-[#f1fbf7] text-[#39846f]',
  violet: 'border-[#eadcf5] bg-[#faf4ff] text-[#8b5aa5]',
  peach: 'border-[#f3dde0] bg-[#fff6f3] text-[#bd6476]',
  cream: 'border-[#d9e8f6] bg-[#f3f9ff] text-[#3a7ca8]',
}

/** Kartın renkli başlık bandı. */
export const toneSurface: Record<PanelTone, string> = {
  rose: 'from-[#fff1f6] to-[#ffe0eb]',
  gold: 'from-[#fff8ea] to-[#ffedcd]',
  violet: 'from-[#f6f1ff] to-[#eae0ff]',
  mint: 'from-[#eefaf3] to-[#daf2e6]',
  peach: 'from-[#fff4ee] to-[#ffe4d5]',
  cream: 'from-[#f3f9ff] to-[#ddecfb]',
}

/** Trend şeridinin çizgi rengi. */
export const toneStroke: Record<PanelTone, string> = {
  rose: '#c85776', gold: '#c79a45', violet: '#7c5cbf', mint: '#2f9d6b', peach: '#d97845', cream: '#3a7ca8',
}

export const panelCardShell =
  'relative overflow-hidden rounded-[24px] border border-[#f3dde5] bg-gradient-to-br from-white via-white to-[#fffafc] shadow-[0_22px_58px_-38px_rgba(120,71,88,0.5)] transition-shadow hover:shadow-[0_28px_66px_-34px_rgba(120,71,88,0.55)]'

export const panelListContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.08 } },
}

export const panelListRow: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

/** Kartın üst kenarındaki altın çizgi — marka imzası. */
export function GoldHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
      style={{ background: 'linear-gradient(90deg, transparent, rgba(201,164,92,0.55), transparent)' }}
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
      style={{ background: `conic-gradient(#78bf93 ${percent * 3.6}deg, #edf7f1 0deg)` }}
      aria-label={`${label || 'Oran'} ${percent}%`}
    >
      <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white text-[15px] font-semibold text-[#2f6f53]">
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
    <div className="inline-flex shrink-0 items-center rounded-full border border-[#efe1e7] bg-[#fff8fa] p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none transition-colors ${
            value === option.key
              ? 'bg-gradient-to-r from-[#f7c6d5] to-[#f3aec3] text-[#7a2f4a] shadow-sm'
              : 'text-[#9a8590] hover:text-[#7a6570]'
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
      <GoldHairline />

      <div className={`relative flex min-h-[76px] items-start justify-between gap-3 bg-gradient-to-br ${toneSurface[tone]} px-5 pb-4 pt-5`}>
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/45 blur-2xl transition-transform duration-500 group-hover:scale-110" />
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-white/85 shadow-[0_12px_26px_-18px_rgba(120,71,88,0.9)] transition-transform duration-300 group-hover:scale-105 ${toneClasses[tone]}`}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.65} />
        </span>
        <div className="relative flex shrink-0 flex-col items-end gap-2">{control}</div>
      </div>

      <div className="relative flex flex-1 items-end justify-between gap-3 px-5 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#8a7480]">{title}</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-[#1f1620] tabular-nums">{value}</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="rounded-full bg-[#fff4f8] px-2 py-0.5 font-medium text-[#77616b]">{detail}</span>
            {subDetail && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{subDetail}</span>
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
      <GoldHairline />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#ffdce8]/45 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          {eyebrow && <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">{eyebrow}</div>}
          <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-[#241923]">{title}</h2>
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </motion.section>
  )
}
