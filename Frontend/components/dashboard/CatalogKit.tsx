'use client'

import { forwardRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, LayoutGrid, Rows3, Search, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { BrandHairline } from '@/components/dashboard/PanelKit'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import type { CatalogStatusKey } from '@/lib/types'

/* ==========================================================================
 * KATALOG DİLİ — Hizmetler ve Paketler sayfalarının ORTAK kabuğu.
 *
 * Neden ortak: iki sayfa aynı işi yapıyor (bir katalog kaydını listele, süz,
 * aç, düzenle) ama daha önce her biri kendi sekmelerini, kendi KPI kartlarını,
 * kendi tablo başlıklarını ve kendi detay panelini ayrı ayrı yazıyordu. Aynı
 * ekranda "Tümü" iki kez, durum bilgisi üç ayrı yerde görünüyordu.
 *
 * Bu kitin üç kuralı var:
 *
 * 1. **Sayaç = süzgeç.** Durum sayaçları ayrı KPI kartı DEĞİL; doğrudan
 *    tıklanabilir süzgeçtir. Böylece "3 kart + 5 sekme" yerine tek şerit kalır.
 * 2. **Ağır içerik modale gider.** Detay, düzenleme, satış geçmişi ve kategori
 *    ayarları sayfayı uzatmaz; kart tıklanınca modalde açılır.
 * 3. **Uydurma sayı yok.** Bu kit yalnız gösterim yapar; hesap eden taraf
 *    (sayfa) yalnızca GERÇEK veriyi geçirir. Tahmini kâr / kapsamı kesilmiş
 *    listeden türetilmiş "toplam rezervasyon" gibi rakamlar kaldırıldı.
 *
 * Renkler pano paletinden gelir (#A5556E plum · #F7F6F6 paper · #74616A mürekkep).
 * Durum renkleri paletin dışındadır — yeşil/amber/kırmızı ayrımı bilinçli korunur.
 * ========================================================================== */

export const CATALOG_STATUS_LABEL: Record<CatalogStatusKey, string> = {
  Active: 'Aktif',
  Passive: 'Pasif',
  Draft: 'Taslak',
  Archived: 'Arşiv',
  Cancelled: 'İptal',
}

export const CATALOG_STATUS_TONE: Record<CatalogStatusKey, string> = {
  Active: 'border-[#8ED6B4] bg-[#DFF3EA] text-[#15694A]',
  Passive: 'border-[#CBC1C6] bg-[#F7F6F6] text-[#4a3a44]',
  Draft: 'border-[#EFC98B] bg-[#FDF3E2] text-[#8A5A11]',
  Archived: 'border-[#D9CED3] bg-[#F1EDEF] text-[#5A4B53]',
  Cancelled: 'border-[#F0AFBF] bg-[#FCE7EC] text-[#A32347]',
}

/** Kart kenarındaki ince durum şeridi (rozet okunmadan da durum ayırt edilsin). */
export const CATALOG_STATUS_BAR: Record<CatalogStatusKey, string> = {
  Active: 'bg-[#1E8C60]',
  Passive: 'bg-[#8E7882]',
  Draft: 'bg-[#D9932B]',
  Archived: 'bg-[#CBC1C6]',
  Cancelled: 'bg-[#C8365C]',
}

export function StatusPill({ status, className = '' }: { status: CatalogStatusKey; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10px] font-semibold leading-none ${CATALOG_STATUS_TONE[status]} ${className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {CATALOG_STATUS_LABEL[status]}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* GENEL BAKIŞ — büyük rakam + tıklanabilir durum sayaçları            */
/* ------------------------------------------------------------------ */

export interface CatalogSegment<T extends string> {
  key: T
  label: string
  count: number
}

/**
 * Durum sayaçları. Sayaç ve süzgeç TEK nesnedir — seçili olan dolgu `layoutId`
 * ile kayar. `idPrefix` zorunlu: aynı ekranda iki grup olursa dolgu gruplar
 * arasında uçar (sidebar yeniden tasarımında bu tuzağa bir kez düşülmüştü).
 */
export function StatusSegments<T extends string>({
  value,
  onChange,
  options,
  idPrefix,
}: {
  value: T
  onChange: (next: T) => void
  options: CatalogSegment<T>[]
  idPrefix: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const active = value === option.key
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className={`relative shrink-0 rounded-[14px] border px-3 py-2 transition-colors ${
              active ? 'border-[#8C4460]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690] hover:bg-[#FDF7F9]'
            }`}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={`${idPrefix}-segment-fill`}
                className="absolute inset-0 rounded-[14px] bg-[#A5556E] shadow-[0_12px_24px_-16px_rgba(87,39,61,0.95)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-baseline gap-1.5 whitespace-nowrap">
              <span className={`text-[16px] font-semibold leading-none tabular-nums ${active ? 'text-white' : 'text-[#2A2027]'}`}>
                {option.count}
              </span>
              <span className={`text-[11px] font-semibold leading-none ${active ? 'text-white' : 'text-[#5A4B53]'}`}>
                {option.label}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Sayfanın tepesindeki tek kart: solda marka bandı üzerinde toplam rakam ve
 * katalog gerçekleri, sağda durum sayaçları. Eskiden burada üç ayrı KPI kartı
 * + ayrı bir sekme şeridi vardı; ikisi de aynı bilgiyi söylüyordu.
 */
export function CatalogOverview({
  icon: Icon,
  eyebrow,
  total,
  totalLabel,
  facts,
  segmentTitle,
  segmentHint,
  segmentAside,
  children,
}: {
  icon: LucideIcon
  eyebrow: string
  total: number
  totalLabel: string
  /** Yalnızca kataloğun KENDİ gerçekleri (tanımlı kayıtlardan doğrudan okunur). */
  facts: { label: string; value: string }[]
  /** Sayaç şeridinin başlığı — sağ yarının ne işe yaradığını tek bakışta söyler. */
  segmentTitle: string
  segmentHint: string
  /** Başlığın sağındaki isteğe bağlı rozet/eylem (ör. "süzgeci temizle"). */
  segmentAside?: ReactNode
  children: ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_24px_60px_-40px_rgba(87,39,61,0.6)]"
    >
      <BrandHairline />
      <div className="grid lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
        {/* Marka bandı — dolu renk (tint değil), üzerindeki yazı beyaz. */}
        <div className="relative overflow-hidden bg-[#A5556E] px-5 py-5 text-white">
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-white/25 blur-3xl"
            animate={{ x: [0, 30, 0], y: [0, 20, 0], opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-[#F9A1B9]/45 blur-3xl"
            animate={{ x: [0, -22, 0], y: [0, -16, 0], opacity: [0.25, 0.5, 0.25] }}
            transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative flex items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-white/20 shadow-[0_12px_26px_-14px_rgba(42,32,39,0.75)]">
              <Icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/90">{eyebrow}</span>
          </div>
          <div className="relative mt-4 flex items-end gap-2">
            <AnimatedNumber value={total} className="text-[46px] font-semibold leading-none tracking-tight tabular-nums" />
            <span className="pb-1.5 text-[12px] font-medium text-white/85">{totalLabel}</span>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <span
                key={fact.label}
                className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium text-white"
                title={fact.label}
              >
                <span className="text-white/85">{fact.label}:</span> {fact.value}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center gap-3 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-[#F6DFE6] text-[#8C4460]">
                <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="font-display text-[14.5px] font-bold leading-tight tracking-tight text-[#2A2027]">
                  {segmentTitle}
                </div>
                <div className="text-[11.5px] font-medium leading-snug text-[#705a66]">{segmentHint}</div>
              </div>
            </div>
            {segmentAside}
          </div>
          {children}
        </div>
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/* ARAÇ ÇUBUĞU                                                         */
/* ------------------------------------------------------------------ */

export const catalogFieldCls =
  'h-9 rounded-[11px] border border-[#EAD8DF] bg-white px-2.5 text-[12px] font-medium text-[#2A2027] outline-none transition-colors hover:border-[#BE7690] focus:border-[#A5556E]'

export function CatalogToolbar({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#EAD8DF] bg-white px-3 py-2.5 shadow-[0_18px_40px_-36px_rgba(87,39,61,0.55)]"
    >
      {children}
    </motion.div>
  )
}

export function CatalogSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative min-w-[190px] flex-1">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74616A]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[11px] border border-[#EAD8DF] bg-white pl-9 pr-9 text-[12.5px] text-[#2A2027] outline-none transition-colors placeholder:text-[#74616A] hover:border-[#BE7690] focus:border-[#A5556E]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Aramayı temizle"
          className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[#74616A] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export type CatalogView = 'grid' | 'list'

export function CatalogViewToggle({
  value,
  onChange,
  idPrefix,
}: {
  value: CatalogView
  onChange: (next: CatalogView) => void
  idPrefix: string
}) {
  const options: { key: CatalogView; label: string; icon: LucideIcon }[] = [
    { key: 'grid', label: 'Kart görünümü', icon: LayoutGrid },
    { key: 'list', label: 'Liste görünümü', icon: Rows3 },
  ]
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[11px] border border-[#EAD8DF] bg-[#F7F6F6] p-0.5">
      {options.map((option) => {
        const active = value === option.key
        const Icon = option.icon
        return (
          <button
            key={option.key}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className="relative grid h-8 w-9 place-items-center rounded-[9px]"
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={`${idPrefix}-view-fill`}
                className="absolute inset-0 rounded-[9px] bg-white shadow-[0_6px_14px_-10px_rgba(87,39,61,0.8)]"
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            <Icon className={`relative h-4 w-4 ${active ? 'text-[#A5556E]' : 'text-[#74616A]'}`} strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* KART IZGARASI                                                       */
/* ------------------------------------------------------------------ */

export function CatalogGrid({ view, children }: { view: CatalogView; children: ReactNode }) {
  return (
    <motion.div
      layout
      className={
        view === 'grid'
          ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
          : 'flex flex-col gap-2'
      }
    >
      {children}
    </motion.div>
  )
}

/**
 * Kart kabuğu — giriş/çıkış animasyonu, hover kalkması ve seçim halkası burada.
 * İçeriği çağıran sayfa çizer (hizmet ve paket kartlarının gövdeleri farklı).
 *
 * `forwardRef` ZORUNLU: `AnimatePresence mode="popLayout"` çıkan kartı düzenden
 * çıkarmak için çocuğuna ref bağlar; ref iletmeyen bir bileşende React uyarı verir
 * ve çıkış animasyonu düzeni bozar.
 */
export const CatalogCardShell = forwardRef<
  HTMLDivElement,
  {
    index?: number
    status: CatalogStatusKey
    selected?: boolean
    onClick: () => void
    children: ReactNode
    className?: string
  }
>(function CatalogCardShell({ index = 0, status, selected, onClick, children, className = '' }, ref) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.026, 0.22) }}
      whileHover={{ y: -3 }}
      className={`group relative overflow-hidden rounded-[18px] border bg-white shadow-[0_16px_38px_-34px_rgba(87,39,61,0.55)] transition-[border-color,box-shadow] hover:shadow-[0_22px_46px_-30px_rgba(87,39,61,0.6)] ${
        selected ? 'border-[#8C4460] ring-2 ring-[#A5556E]/25' : 'border-[#EAD8DF] hover:border-[#BE7690]'
      } ${className}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${CATALOG_STATUS_BAR[status]}`} />
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A5556E]/45"
      >
        {children}
      </button>
    </motion.div>
  )
})

/** Kart içindeki küçük etiketli değer. */
export function CardMeta({ label, value, tone = 'text-[#2A2027]' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#74616A]">{label}</div>
      <div className={`mt-0.5 truncate text-[13px] font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

/** Kart üzerindeki nötr etiket (kategori, içerik parçası…). */
export function Chip({ children, title, tone }: { children: ReactNode; title?: string; tone?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full shrink-0 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
        tone || 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]'
      }`}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* SAYFALAMA                                                           */
/* ------------------------------------------------------------------ */

export function CatalogPager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  itemLabel,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (next: number) => void
  onPageSize: (next: number) => void
  itemLabel: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const numbers: (number | '…')[] = []
  for (let candidate = 1; candidate <= totalPages; candidate++) {
    if (candidate === 1 || candidate === totalPages || (candidate >= page - 1 && candidate <= page + 1)) numbers.push(candidate)
    else if (numbers[numbers.length - 1] !== '…') numbers.push('…')
  }
  const go = (next: number) => onPage(Math.min(totalPages, Math.max(1, next)))

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#EAD8DF] bg-white px-4 py-2.5">
      <div className="text-[11.5px] font-medium text-[#5A4B53]">
        {total === 0 ? `0 ${itemLabel}` : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total} ${itemLabel}`}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Önceki sayfa"
          className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#EAD8DF] bg-white text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {numbers.map((entry, position) =>
          entry === '…' ? (
            <span key={`gap-${position}`} className="px-1 text-[12px] text-[#74616A]">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => go(entry)}
              className={`grid h-8 min-w-8 place-items-center rounded-[10px] border px-2 text-[12px] font-semibold tabular-nums transition-colors ${
                entry === page
                  ? 'border-[#8C4460] bg-[#A5556E] text-white'
                  : 'border-[#EAD8DF] bg-white text-[#5A4B53] hover:border-[#BE7690] hover:text-[#A5556E]'
              }`}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          aria-label="Sonraki sayfa"
          className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#EAD8DF] bg-white text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <select
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          aria-label="Sayfa başına kayıt"
          className={`ml-1 ${catalogFieldCls}`}
        >
          {[12, 24, 48, 96].map((size) => (
            <option key={size} value={size}>
              {size} / sayfa
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* MODAL KABUĞU                                                        */
/* ------------------------------------------------------------------ */

/**
 * Katalog modallerinin ortak çerçevesi.
 *
 * YAPI ZORUNLU (bkz. modal footer kırpılma tuzağı): `DialogContent` flex sütun +
 * `!p-0`, gövde `flex-auto overflow-y-auto`, başlık ve alt çubuk `shrink-0`.
 * Aksi hâlde uzun içerikte alt çubuk ekranın dışında kalır.
 *
 * OKUNABİLİRLİK: modal `document.body`'ye portal'lanır, `.theme-surface`
 * kapsamındaki merkezi düzeltme buraya UYGULANMAZ — burada opaklıklı mürekkep
 * ve 10px altı punto kullanılmaz.
 */
export function CatalogModal({
  open,
  onOpenChange,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  badge,
  headerExtra,
  tabs,
  footer,
  children,
  width = 1180,
  height = 900,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  icon: LucideIcon
  eyebrow: string
  title: string
  subtitle: string
  badge?: ReactNode
  headerExtra?: ReactNode
  tabs?: ReactNode
  footer?: ReactNode
  children: ReactNode
  width?: number
  height?: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: `min(96vw, ${width}px)`, height: `min(93dvh, ${height}px)`, maxHeight: '93dvh' }}
      >
        <header className="relative shrink-0 overflow-hidden bg-[#A5556E] px-5 py-4 text-white sm:px-6">
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-white/20 blur-3xl"
            animate={{ x: [0, -24, 0], opacity: [0.3, 0.55, 0.3] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-white/20 shadow-[0_12px_26px_-14px_rgba(42,32,39,0.75)]">
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/85">{eyebrow}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate font-display text-[21px] font-bold leading-tight tracking-tight text-white">
                    {title}
                  </DialogTitle>
                  {badge}
                </div>
                <DialogDescription className="mt-1 text-[12px] leading-snug text-white/85">{subtitle}</DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerExtra}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Kapat"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {tabs && <div className="shrink-0 border-b border-[#EAD8DF] bg-white px-4 py-2 sm:px-6">{tabs}</div>}

        <div className="flex-auto overflow-y-auto bg-[#FBFAFA]">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-[#EAD8DF] bg-white px-4 py-3 sm:px-6">{footer}</footer>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Modal içi sekme şeridi — seçili dolgu `layoutId` ile kayar. */
export function ModalTabs<T extends string>({
  value,
  onChange,
  options,
  idPrefix,
}: {
  value: T
  onChange: (next: T) => void
  options: { key: T; label: string; icon?: LucideIcon; count?: number }[]
  idPrefix: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const active = value === option.key
        const Icon = option.icon
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className="relative rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={`${idPrefix}-modal-tab`}
                className="absolute inset-0 rounded-full bg-[#F6DFE6]"
                transition={{ type: 'spring', stiffness: 440, damping: 36 }}
              />
            )}
            <span className={`relative inline-flex items-center gap-1.5 ${active ? 'text-[#8C4460]' : 'text-[#5A4B53] hover:text-[#2A2027]'}`}>
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
              {option.label}
              {option.count !== undefined && (
                <span className={`tabular-nums ${active ? 'text-[#A5556E]' : 'text-[#74616A]'}`}>{option.count}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Modal gövdesindeki başlıklı bölüm. */
export function ModalSection({
  title,
  hint,
  action,
  children,
  className = '',
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-[18px] border border-[#EAD8DF] bg-white p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-[#2A2027]">{title}</h3>
          {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-[#705a66]">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Etiketli tek gerçek (katalog kaydından doğrudan okunur). */
export function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-[13px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#74616A]">{label}</div>
      <div className={`mt-1 truncate text-[15px] font-semibold tabular-nums ${tone || 'text-[#2A2027]'}`}>{value}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DÜĞMELER                                                            */
/* ------------------------------------------------------------------ */

export const catalogPrimaryBtn =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] bg-[#A5556E] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-18px_rgba(87,39,61,0.95)] transition-all hover:-translate-y-0.5 hover:bg-[#8C4460] disabled:opacity-55 disabled:hover:translate-y-0'

export const catalogGhostBtn =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[#EAD8DF] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#5A4B53] transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-55 disabled:hover:translate-y-0'

/** "Geçmiş satış ekle" — ne birincil ne tehlikeli: kendi menekşe tonu (arşiv işi). */
export const catalogHistoryBtn =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[#e0d3f2] bg-[#faf6ff] px-3.5 py-2 text-[12px] font-semibold text-[#6b4aa0] transition-all hover:-translate-y-0.5 hover:bg-[#f2ebff] disabled:opacity-55 disabled:hover:translate-y-0'

export const catalogDangerBtn =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3.5 py-2 text-[12px] font-semibold text-[#A32347] transition-all hover:-translate-y-0.5 hover:bg-[#F9D7DF] disabled:opacity-55 disabled:hover:translate-y-0'
