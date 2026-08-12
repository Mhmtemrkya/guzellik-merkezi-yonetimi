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
  rose: 'border-[#8C4460] bg-[#A5556E] text-white',
  gold: 'border-[#15694A] bg-[#1E8C60] text-white',
  mint: 'border-[#17406F] bg-[#1E4E8C] text-white',
  violet: 'border-[#74616A] bg-[#8E7882] text-white',
  peach: 'border-[#E4577F] bg-[#F9A1B9] text-[#5A1730]',
  cream: 'border-[#CBC1C6] bg-[#F7F6F6] text-[#3E343A]',
}

/** Bant üstündeki yazı ve ikon rozeti (açık renklerde mürekkep koyudur). */
export const toneOnBand: Record<PanelTone, string> = {
  rose: 'text-white',
  gold: 'text-white',
  mint: 'text-white',
  violet: 'text-white',
  peach: 'text-[#5A1730]',
  cream: 'text-[#3E343A]',
}

export const toneChip: Record<PanelTone, string> = {
  rose: 'bg-white/20 text-white',
  gold: 'bg-white/20 text-white',
  mint: 'bg-white/20 text-white',
  violet: 'bg-white/22 text-white',
  peach: 'bg-white/45 text-[#5A1730]',
  cream: 'bg-[#8E7882] text-white',
}

/** Kartın renkli başlık bandı. */
export const toneSurface: Record<PanelTone, string> = {
  rose: 'bg-[#A5556E]',
  gold: 'bg-[#1E8C60]',
  violet: 'bg-[#8E7882]',
  mint: 'bg-[#1E4E8C]',
  peach: 'bg-[#F9A1B9]',
  cream: 'bg-[#F7F6F6]',
}

/** Trend şeridinin çizgi rengi. */
export const toneStroke: Record<PanelTone, string> = {
  rose: '#A5556E', gold: '#1E8C60', violet: '#8E7882', mint: '#1E4E8C', peach: '#E4577F', cream: '#8E7882',
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

      <div className={`relative flex min-h-[76px] items-start justify-between gap-3 ${toneSurface[tone]} ${toneOnBand[tone]} px-5 pb-4 pt-5`}>
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/20 blur-2xl transition-transform duration-500 group-hover:scale-110" />
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] shadow-[0_12px_26px_-14px_rgba(42,32,39,0.75)] transition-transform duration-300 group-hover:scale-105 ${toneChip[tone]}`}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
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

// ---------------------------------------------------------------------------
// SAYFA İSKELETİ VE ORTAK KONTROLLER
//
// Aşağıdakiler panel sayfaları tek tek bu dile geçirilirken eklendi. Amaç, her sayfada
// yeniden yazılan üç şeyi tek yerde toplamak: gövde genişliği, form alanı stili ve
// "kayıt yok / yükleniyor" görünümleri. Aynı stringi 15 sayfada tutmak, birinde yapılan
// okunabilirlik düzeltmesinin diğerlerine geçmemesini üretiyordu.
// ---------------------------------------------------------------------------

/** Form alanı ve seçicilerin ortak stili (input/select/textarea). */
export const panelField =
  'rounded-[12px] border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-2 text-[12px] text-[#2A2027] outline-none transition-colors placeholder:text-[#74616A] focus:border-[#A5556E] focus:bg-white'

/** Birincil eylem düğmesi. */
export const panelPrimaryBtn =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-[#A5556E] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(87,39,61,0.95)] transition-all hover:-translate-y-0.5 hover:bg-[#8C4460] disabled:opacity-60 disabled:hover:translate-y-0'

/** İkincil (çerçeveli) düğme. */
export const panelGhostBtn =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] border border-[#EAD8DF] bg-white px-4 py-2 text-[12px] font-semibold text-[#8C4460] transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6]'

/**
 * Sayfa gövdesi — genişlik sınırı ve kenar boşluğu tek yerde.
 * 14" MacBook hedefi: `max-w-[1600px]` sayesinde 27"da satır sonsuza uzamaz (uzun satır göz
 * takibini bozuyordu), 14"da kenar boşluğu ince kalır.
 */
export function PanelPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6 xl:px-8 ${className}`}>
      {children}
    </div>
  )
}

/**
 * Sekme çipleri — seçili dolgu `layoutId` ile kayar.
 *
 * `idPrefix` ZORUNLU: aynı ekranda iki çip grubu varsa ortak bir layoutId dolguyu gruplar
 * arasında uçurur (sidebar yeniden tasarımında birebir bu tuzağa düşülmüştü).
 */
export function PanelTabs<T extends string>({
  value,
  onChange,
  options,
  idPrefix,
}: {
  value: T
  onChange: (next: T) => void
  options: { key: T; label: string; count?: number }[]
  idPrefix: string
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className="relative shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
        >
          {value === option.key && (
            <motion.span
              aria-hidden
              layoutId={`${idPrefix}-tab-pill`}
              className="absolute inset-0 rounded-full bg-[#A5556E] shadow-[0_8px_18px_-12px_rgba(87,39,61,0.9)]"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className={`relative ${value === option.key ? 'text-white' : 'text-[#74616A] hover:text-[#2A2027]'}`}>
            {option.label}
            {option.count !== undefined && (
              <span className={`ml-1 tabular-nums ${value === option.key ? 'text-white/80' : 'text-[#8E7882]'}`}>
                {option.count}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Listelerin ortak "kayıt yok" görünümü. */
export function PanelEmpty({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F7F6F6] text-[#A5556E]">
        <Icon className="h-5 w-5" />
      </span>
      <div className="mt-3 text-[13px] font-semibold text-[#2A2027]">{title}</div>
      {hint && <div className="mt-1 max-w-[46ch] text-[11px] text-[#74616A]">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** Yükleniyor iskeleti — ilk açılışta boş ekran yerine satır siluetleri. */
export function PanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[#F1E7EB]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[#F1E7EB]" />
          <span className="h-3.5 flex-1 animate-pulse rounded-full bg-[#F1E7EB]" />
          <span className="hidden h-3.5 w-24 animate-pulse rounded-full bg-[#F1E7EB] lg:block" />
        </div>
      ))}
    </div>
  )
}

/**
 * KOMPAKT KPI KARTI — liste sayfalarının üstündeki sayaçlar.
 *
 * `PanelMetricCard`'dan farkı: kendi giriş animasyonu vardır (variant'lı bir ebeveyn
 * gerektirmez) ve gövdesi tek rakam + tek rozetle sınırlıdır. Pano ve müşteriler
 * sayfasındaki sayaç kartlarının ortak hâli.
 *
 * `series` YALNIZ o rakamın gerçek serisi olduğunda verilmelidir: alakasız bir eğri,
 * rakamın o eğriyi izlediği izlenimini yaratır (panoda bu hata bir kez yapılmıştı).
 */
export function PanelStat({
  icon: Icon,
  tone,
  label,
  value,
  detail,
  series,
  danger,
  index = 0,
}: {
  icon: LucideIcon
  tone: PanelTone
  label: string
  value: string
  detail?: string
  series?: number[]
  danger?: boolean
  index?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className={`${panelCardShell} group flex flex-col`}
    >
      <BrandHairline />
      <div className={`relative flex items-center gap-2.5 ${toneSurface[tone]} ${toneOnBand[tone]} px-4 py-3`}>
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/20 blur-2xl transition-transform duration-500 group-hover:scale-125" />
        <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[12px] shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)] transition-transform duration-300 group-hover:scale-105 ${toneChip[tone]}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        <span className="relative min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase leading-tight tracking-[0.1em]">
          {label}
        </span>
      </div>
      <div className="relative flex-1 px-4 pb-3.5 pt-3">
        <div className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${danger ? 'text-[#B23252]' : 'text-[#2A2027]'}`}>
          {value}
        </div>
        {detail && (
          <div className="mt-2 inline-block max-w-full truncate rounded-full bg-[#F7F6F6] px-2 py-0.5 text-[10.5px] font-medium text-[#5A4B53]">
            {detail}
          </div>
        )}
      </div>
      {series && series.length > 1 && (
        <div className="relative h-[46px] w-full">
          <AreaSpark values={series} tone={tone} idSuffix={label} />
        </div>
      )}
    </motion.div>
  )
}
