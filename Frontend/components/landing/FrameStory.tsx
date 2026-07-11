'use client'

import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'framer-motion'
import {
  ArrowDown,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CreditCard,
  Layers3,
  Receipt,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const FRAME_COUNT = 1872
const frameSrc = (index: number): string => `/frames/ornek/frame_${String(index).padStart(4, '0')}.jpg`

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface ChapterStat {
  v: string
  l: string
  s: string
}

interface ChapterPanelRow {
  label: string
  value: string
  highlight?: boolean
}

interface ChapterPanel {
  title?: string
  caption?: string
  rows?: ChapterPanelRow[]
  items?: string[]
}

interface ChapterHud {
  title: string
  rows: ChapterPanelRow[]
}

interface Chapter {
  k: string
  range: [number, number]
  eyebrow: string
  title: string
  accent?: string
  body: string
  icon: LucideIcon
  role?: string
  stats?: ChapterStat[]
  panel?: ChapterPanel
  hud?: ChapterHud
  metric?: string
  metricLabel?: string
}

const chapters: Chapter[] = [
  {
    k: '01',
    range: [1, 180],
    eyebrow: 'Güzellik Merkezi Yönetim Sistemi',
    title: 'Excel’i bırakın.',
    accent: 'Güzellik merkezini tek panelden yönetin.',
    body: 'Paket, seans, taksit, randevu ve ön muhasebe — Excel’de kaybolan tüm operasyonu sinematik tek panelde yönetin.',
    icon: Sparkles,
    role: 'hero',
    stats: [
      { v: '9', l: 'modül', s: 'tek panel' },
      { v: '1872', l: 'kare', s: '62 sn sahne' },
      { v: '7/24', l: 'bulut', s: 'web · tablet' },
      { v: '4', l: 'plan', s: '+ kurumsal' },
    ],
  },
  {
    k: '02',
    range: [181, 360],
    eyebrow: 'Problem',
    title: 'Borç karışır, seans unutulur.',
    accent: 'Sistem dengeyi kurar.',
    body: 'Excel büyüdükçe kontrolden çıkar. Yazılım, kayıpları otomatik kapatır.',
    metric: '0',
    metricLabel: 'Kayıp tahsilat',
    icon: ShieldCheck,
    hud: {
      title: 'Excel’in maliyeti',
      rows: [
        { label: 'Geciken ödeme', value: '↘ önle' },
        { label: 'Unutulan seans', value: '↘ önle' },
        { label: 'Karışan taksit', value: '↘ önle' },
      ],
    },
  },
  {
    k: '03',
    range: [361, 540],
    eyebrow: 'Müşteri Kartı',
    title: 'Bir müşteri,',
    accent: '360° tek ekranda.',
    body: 'Paketler, toplam satış, ödenen, kalan borç, geciken ödeme, ödeme geçmişi, kalan seanslar, randevular ve notlar — hepsi bir kartta.',
    metric: '360°',
    metricLabel: 'Müşteri profili',
    icon: UsersRound,
    hud: {
      title: 'Selin Aksoy · Aktif',
      rows: [
        { label: 'Toplam paket', value: '₺50.000' },
        { label: 'Ödenen', value: '₺25.000' },
        { label: 'Kalan borç', value: '₺25.000', highlight: true },
        { label: 'Kalan seans', value: '7 / 14' },
      ],
    },
  },
  {
    k: '04',
    range: [541, 720],
    eyebrow: 'Paket & Seans',
    title: 'Her hizmet için',
    accent: 'ayrı seans, ayrı takip.',
    body: 'Lazer 8 seans, cilt bakımı 4 seans, tüy sarartma 2 seans. Toplam, kullanılan ve kalan otomatik düşer.',
    metric: '14',
    metricLabel: 'Seans · 3 hizmet',
    icon: Layers3,
    hud: {
      title: 'Lazer + Cilt Bakımı paketi',
      rows: [
        { label: 'Lazer epilasyon', value: '3 / 8 kalan' },
        { label: 'Cilt bakımı', value: '2 / 4 kalan' },
        { label: 'Tüy sarartma', value: '1 / 2 kalan' },
        { label: 'Durum', value: 'Aktif', highlight: true },
      ],
    },
  },
  {
    k: '05',
    range: [721, 920],
    eyebrow: 'Esnek Tahsilat',
    title: 'Düzensiz ödeme?',
    accent: 'Sistem yeniden planlar.',
    body: '50.000 TL paket → 20.000 + 5.000 → kalan 25.000 TL otomatik yeni plana bölünür. Eski ödemeler asla silinmez.',
    metric: '₺25.000',
    metricLabel: 'Kalan borç · 5 taksit ↻',
    icon: CreditCard,
    hud: {
      title: 'Ödeme planı · 50.000 TL',
      rows: [
        { label: '1. ödeme', value: '₺20.000 ✓' },
        { label: '2. ödeme', value: '₺5.000 ✓' },
        { label: 'Toplam ödenen', value: '₺25.000' },
        { label: 'Yeni plan', value: '5 taksit ↻', highlight: true },
      ],
    },
  },
  {
    k: '06',
    range: [921, 1120],
    eyebrow: 'Randevu',
    title: 'Müşteri, personel, oda —',
    accent: 'tek takvim, çakışmasız.',
    body: 'Bekliyor, Geldi, Tamamlandı, Ertelendi, İptal, Gelmedi. Tamamlanan randevu paketten seansı otomatik düşer.',
    metric: '18',
    metricLabel: 'Bugün · 3 personel',
    icon: CalendarDays,
    hud: {
      title: 'Bugün · 16 Şubat',
      rows: [
        { label: '10:00 · Lazer', value: 'Tamamlandı ✓' },
        { label: '11:30 · Cilt bakımı', value: 'Geldi' },
        { label: '14:00 · Sarartma', value: 'Bekliyor' },
        { label: '16:30 · Lazer', value: 'Bekliyor' },
      ],
    },
  },
  {
    k: '07',
    range: [1121, 1320],
    eyebrow: 'Personel',
    title: 'Personel başına',
    accent: 'işlem, prim ve doluluk.',
    body: 'Her hizmet için ayrı personel, süre ve performans. Aylık prim raporu yöneticinin elinde.',
    metric: '10',
    metricLabel: 'Kullanıcı · Profesyonel',
    icon: BarChart3,
    hud: {
      title: 'Personel · Şubat',
      rows: [
        { label: 'Aylin · Lazer', value: '46 işlem' },
        { label: 'Esra · Cilt bakımı', value: '32 işlem' },
        { label: 'Beyza · Sarartma', value: '18 işlem' },
        { label: 'Toplam prim', value: '₺14.250', highlight: true },
      ],
    },
  },
  {
    k: '08',
    range: [1321, 1520],
    eyebrow: 'Kasa & Ön Muhasebe',
    title: 'Nakit, kart, havale —',
    accent: 'canlı kasa kapanışı.',
    body: 'Tahsilat, gider, geciken ödeme ve net kasa farkı yöneticinin önünde. Müşteri bazlı cari her zaman doğru.',
    metric: '₺25.700',
    metricLabel: 'Günlük net kasa',
    icon: WalletCards,
    hud: {
      title: 'Bugün · kasa kapanışı',
      rows: [
        { label: 'Nakit', value: '₺8.400' },
        { label: 'Kart', value: '₺12.100' },
        { label: 'Havale / EFT', value: '₺5.200' },
        { label: 'Net kasa', value: '₺25.700', highlight: true },
      ],
    },
  },
  {
    k: '09',
    range: [1521, 1872],
    eyebrow: 'Raporlama',
    title: 'Aylık tahsilat, alacak,',
    accent: 'büyüme — tek cockpit.',
    body: 'PDF / Excel raporlar, en çok satan paket, geciken alacak ve büyüme grafikleri. Yönetici tek bakışta karar verir.',
    metric: '+24%',
    metricLabel: 'Aylık tahsilat artışı',
    icon: Receipt,
    hud: {
      title: 'Aylık özet · Şubat',
      rows: [
        { label: 'Tahsilat', value: '₺428.000' },
        { label: 'Açık alacak', value: '₺96.500' },
        { label: 'Geciken', value: '₺12.200' },
        { label: 'Büyüme', value: '+24% ↑', highlight: true },
      ],
    },
  },
]

function frameToChapterIndex(frame: number): number {
  for (let i = 0; i < chapters.length; i += 1) {
    const range = chapters[i]?.range
    if (!range) continue
    const [from, to] = range
    if (frame >= from && frame <= to) return i
  }
  return chapters.length - 1
}

/**
 * Returns true on lg+ (>=1024px) — desktop Apple-style sequence only runs here.
 * SSR-safe: starts as false, flips on first client effect tick.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

/**
 * Apple-style canvas image sequence.
 * - Pre-decoded Image objects are kept in a ref array so each frame swap is a
 *   single `drawImage()` call — no DOM mount/unmount, no decode flash, no
 *   "black for a frame" while the browser fetches.
 * - Returns:
 *   - canvasRef → attach to <canvas>
 *   - drawFrame(i) → call on every scroll tick
 *   - lastDrawnRef → bookkeeping so we never re-draw the same frame
 */
function useCanvasSequence(enabled: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<HTMLImageElement[]>([])
  const lastDrawnRef = useRef<number>(0)
  const dprRef = useRef<number>(1)

  const drawCover = (img: HTMLImageElement | undefined): boolean => {
    const canvas = canvasRef.current
    if (!canvas || !img || !img.complete) return false
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    if (cw === 0 || ch === 0) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const iw = img.naturalWidth
    const ih = img.naturalHeight
    const canvasRatio = cw / ch
    const imageRatio = iw / ih
    let sx, sy, sw, sh
    if (imageRatio > canvasRatio) {
      sh = ih
      sw = ih * canvasRatio
      sx = (iw - sw) / 2
      sy = 0
    } else {
      sw = iw
      sh = iw / canvasRatio
      sx = 0
      sy = (ih - sh) / 2
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch)
    return true
  }

  const drawFrame = (i: number): void => {
    if (i === lastDrawnRef.current) return
    const img = imagesRef.current[i]
    if (img && img.complete && img.naturalWidth) {
      if (drawCover(img)) lastDrawnRef.current = i
      return
    }
    // Fallback — keep the previously drawn frame visible while we fetch the new
    // one, never flash to black. Try a nearby loaded frame so the difference is
    // tiny but the canvas isn't blank on first paint.
    for (let d = 1; d < 60; d += 1) {
      const before = imagesRef.current[i - d]
      if (before && before.complete && before.naturalWidth) {
        drawCover(before)
        return
      }
      const after = imagesRef.current[i + d]
      if (after && after.complete && after.naturalWidth) {
        drawCover(after)
        return
      }
    }
  }

  // Size canvas to its CSS box with DPR for crisp render
  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      dprRef.current = dpr
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Redraw whatever frame we last painted (or frame 1) with the new size
      const img = imagesRef.current[lastDrawnRef.current || 1]
      if (img && img.complete) drawCover(img)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [enabled])

  // Pre-decode every frame into the ref array. First batch synchronously so the
  // hero opens on a real image, the rest in time-spaced batches so the network
  // doesn't choke during scroll. Mobile/tablet (<lg) skips the whole sequence —
  // the static mobile story uses a handful of representative <img> tags instead.
  useEffect(() => {
    if (!enabled) return
    const loadOne = (i: number): void => {
      if (imagesRef.current[i]) return
      const img = new Image()
      img.decoding = 'async'
      img.src = frameSrc(i)
      imagesRef.current[i] = img
      img.onload = () => {
        // First successful frame? Paint it immediately so the initial canvas is
        // not blank while the rest of the batches are still decoding.
        if (i <= 4 && lastDrawnRef.current === 0) drawCover(img)
      }
    }
    for (let i = 1; i <= 90; i += 1) loadOne(i)
    const timers: number[] = []
    for (let start = 91; start <= FRAME_COUNT; start += 140) {
      const t = window.setTimeout(
        () => {
          for (let i = start; i <= Math.min(FRAME_COUNT, start + 139); i += 1) loadOne(i)
        },
        500 + (start - 90) * 4,
      )
      timers.push(t)
    }
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [enabled])

  return { canvasRef, drawFrame }
}

interface ChapterRenderProps {
  chapter: Chapter
  isActive: boolean
}

interface IndexedChapterRenderProps extends ChapterRenderProps {
  index: number
}

/* ---------------- HERO chapter — only renders for chapter 01 ---------------- */
function HeroChapter({ chapter, isActive }: ChapterRenderProps) {
  return (
    <motion.div
      key={`hero-${chapter.k}`}
      animate={{
        opacity: isActive ? 1 : 0,
        y: isActive ? 0 : 24,
        filter: isActive ? 'blur(0px)' : 'blur(10px)',
      }}
      transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute inset-0 z-20 mx-auto flex max-w-5xl flex-col items-center justify-center px-5 text-center pt-24 sm:px-8 lg:px-16 ${
        isActive ? '' : 'pointer-events-none'
      }`}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.6 }}
        className="eyebrow mb-6 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-4 py-1.5 text-[#ffd3df] backdrop-blur-xl"
      >
        <Sparkles className="h-3 w-3" />
        {chapter.eyebrow}
      </motion.div>

      <h1 className="hero-title text-[clamp(2.6rem,6.6vw,7rem)] text-[#fff4f8]">
        <motion.span
          initial={{ opacity: 0, y: 22, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.2, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="block"
        >
          {chapter.title}
        </motion.span>
        <motion.span
          initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.55, duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          className="serif-italic block beautyassist-text-gradient"
        >
          {chapter.accent}
        </motion.span>
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.05, duration: 0.65 }}
        className="mx-auto mt-7 max-w-xl text-[15px] leading-relaxed text-[#fff4f8]/78 sm:text-base"
      >
        {chapter.body}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.18, duration: 0.65 }}
        className="mt-8 flex flex-wrap items-center justify-center gap-3"
      >
        <a
          href="/login"
          className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-7 py-3.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2f1724] shadow-[0_24px_80px_rgba(240,170,194,0.35)]"
          data-cursor="DEMO"
        >
          Demo Paneline Gir
          <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
        <a
          href="#modules"
          className="inline-flex items-center gap-3 rounded-full border border-[#fff4f8]/18 bg-[#160b12]/45 px-7 py-3.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#fff4f8]/85 backdrop-blur-xl transition hover:bg-[#fff4f8]/8"
          data-cursor="MODÜL"
        >
          Modülleri gör
          <ArrowDown className="h-4 w-4" />
        </a>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.35, duration: 0.7 }}
        className="mt-12 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {chapter.stats?.map((s: ChapterStat, i: number) => (
          <motion.div
            key={s.l}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4 + i * 0.06, duration: 0.55 }}
            className="glass rounded-2xl p-4 text-left"
          >
            <div className="beautyassist-text-gradient font-display text-3xl leading-none">{s.v}</div>
            <div className="eyebrow mt-1 text-[#fff4f8]/52">{s.l}</div>
            <div className="text-[11px] text-[#fff4f8]/72">{s.s}</div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}

/* ---------------- Default story chapter (02 → 09) ---------------- */
function StoryBlock({ chapter, isActive }: ChapterRenderProps) {
  return (
    <motion.div
      key={`story-${chapter.k}`}
      animate={{
        opacity: isActive ? 1 : 0,
        y: isActive ? 0 : 24,
        filter: isActive ? 'blur(0px)' : 'blur(10px)',
      }}
      transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
      className={`flex max-w-[560px] flex-col ${isActive ? '' : 'pointer-events-none'}`}
    >
      <motion.span
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="eyebrow mb-4 inline-flex items-center gap-2 self-start rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-3 py-1.5 text-[#ffd3df] backdrop-blur-xl"
      >
        <span className="font-mono">{chapter.k}</span>
        <span className="text-[#fff4f8]/40">·</span>
        {chapter.eyebrow}
      </motion.span>

      <h2 className="hero-title text-[clamp(2rem,3.4vw,3.6rem)] text-[#fff4f8]" aria-label={`${chapter.title} ${chapter.accent}`}>
        <span>{chapter.title}</span>{' '}
        <span className="serif-italic beautyassist-text-gradient">{chapter.accent}</span>
      </h2>

      <p className="mt-5 max-w-md text-[14px] leading-relaxed text-[#fff4f8]/76 sm:text-[15px]">{chapter.body}</p>

      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6 inline-flex w-fit flex-col rounded-2xl border border-[#f0aac2]/22 bg-[#160b12]/55 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.32)] backdrop-blur-2xl"
      >
        <span className="beautyassist-text-gradient font-display text-3xl leading-none">{chapter.metric}</span>
        <span className="eyebrow mt-1 text-[9px] tracking-[0.2em] text-[#fff4f8]/55">{chapter.metricLabel}</span>
      </motion.div>
    </motion.div>
  )
}

function HudCard({ chapter, isActive }: ChapterRenderProps) {
  const Icon = chapter.icon
  if (!chapter.hud) return null
  return (
    <motion.div
      key={`hud-${chapter.k}`}
      animate={{
        opacity: isActive ? 1 : 0,
        y: isActive ? 0 : 18,
        scale: isActive ? 1 : 0.96,
      }}
      transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
      className={`w-[300px] max-w-[88vw] ${isActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
    >
      <div className="glass-strong rounded-2xl p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow flex items-center gap-2 text-[#ffd3df]/85">
            <Icon className="h-3 w-3 text-[#f0aac2]" />
            {chapter.eyebrow}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#f0aac2]">live</span>
        </div>
        <div className="mb-3 font-display text-[15px] tracking-tight text-[#fff4f8]">{chapter.hud.title}</div>
        <div className="space-y-2">
          {chapter.hud.rows.map((row: ChapterPanelRow, idx: number) => (
            <motion.div
              key={`${chapter.k}-${idx}`}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 + idx * 0.07, duration: 0.45 }}
              className={`flex items-center justify-between rounded-xl border border-[#fff4f8]/8 px-3 py-2 text-[12px] ${
                row.highlight
                  ? 'bg-gradient-to-r from-[#f0aac2]/22 via-[#ffd3df]/12 to-transparent text-[#fff4f8]'
                  : 'bg-[#fff4f8]/[0.03] text-[#fff4f8]/76'
              }`}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#fff4f8]/55">{row.label}</span>
              <span className={`font-display ${row.highlight ? 'text-[#ffd3df]' : ''}`}>{row.value}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.18em] text-[#fff4f8]/45">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#f0aac2]" />
          senkronize · gerçek zamanlı
        </div>
      </div>
    </motion.div>
  )
}

/* ---------------- Mobile / tablet (<lg) hero — normal flow ---------------- */
function HeroChapterMobile({ chapter }: { chapter: Chapter }) {
  const Icon = chapter.icon
  return (
    <section className="relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden">
      {/* Hero backdrop — single static frame, prioritized */}
      <img
        src={frameSrc(1)}
        alt="Güzellik merkezi yönetim paneli — kapak görseli"
        fetchPriority="high"
        decoding="async"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#160b12]/55 via-[#160b12]/72 to-[#160b12]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(22,11,18,0.7)_100%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid" />

      <div className="relative mx-auto w-full max-w-2xl px-5 pb-16 pt-28 text-center sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="eyebrow mb-5 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-4 py-1.5 text-[#ffd3df] backdrop-blur-xl"
        >
          <Icon className="h-3 w-3" />
          {chapter.eyebrow}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="hero-title text-[clamp(2.2rem,8.5vw,3.6rem)] text-[#fff4f8]"
        >
          {chapter.title}
          <br />
          <span className="serif-italic beautyassist-text-gradient">{chapter.accent}</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.18 }}
          className="mx-auto mt-5 max-w-md text-base leading-relaxed text-[#fff4f8]/80"
        >
          {chapter.body}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.28 }}
          className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center"
        >
          <a
            href="/login"
            className="group inline-flex min-h-[48px] items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-7 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2f1724] shadow-[0_18px_55px_rgba(240,170,194,0.32)]"
          >
            Demo Paneline Gir
            <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <a
            href="#modules"
            className="inline-flex min-h-[48px] items-center justify-center gap-3 rounded-full border border-[#fff4f8]/18 bg-[#160b12]/60 px-7 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#fff4f8]/85 backdrop-blur-xl"
          >
            Modülleri gör
            <ArrowDown className="h-4 w-4" />
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65, delay: 0.4 }}
          className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {chapter.stats?.map((s: ChapterStat) => (
            <div key={s.l} className="glass rounded-2xl p-4 text-left">
              <div className="beautyassist-text-gradient font-display text-2xl leading-none">{s.v}</div>
              <div className="eyebrow mt-1 text-[#fff4f8]/52">{s.l}</div>
              <div className="text-[11px] text-[#fff4f8]/72">{s.s}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------- Mobile / tablet (<lg) chapter card ---------------- */
function ChapterCardMobile({ chapter, index }: { chapter: Chapter; index: number }) {
  const midFrame = Math.round((chapter.range[0] + chapter.range[1]) / 2)
  const Icon = chapter.icon
  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-3xl border border-[#f0aac2]/22 bg-[#160b12]/55 shadow-[0_30px_80px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={frameSrc(midFrame)}
          alt={`${chapter.eyebrow} — ${chapter.title} ${chapter.accent}`}
          loading={index < 1 ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#160b12] via-[#160b12]/45 to-transparent" />
        <span className="eyebrow absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/40 bg-[#160b12]/65 px-3 py-1.5 text-[#ffd3df] backdrop-blur-xl">
          <Icon className="h-3 w-3 text-[#f0aac2]" />
          <span className="font-mono">{chapter.k}</span>
          <span className="text-[#fff4f8]/40">·</span>
          {chapter.eyebrow}
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <h3 className="hero-title text-[clamp(1.5rem,6vw,2.1rem)] text-[#fff4f8]">
          {chapter.title}{' '}
          <span className="serif-italic beautyassist-text-gradient">{chapter.accent}</span>
        </h3>

        <p className="mt-3 text-[15px] leading-relaxed text-[#fff4f8]/78">{chapter.body}</p>

        {chapter.metric && (
          <div className="mt-5 inline-flex w-fit flex-col rounded-2xl border border-[#f0aac2]/22 bg-[#160b12]/55 px-4 py-3">
            <span className="beautyassist-text-gradient font-display text-[26px] leading-none">{chapter.metric}</span>
            <span className="eyebrow mt-1 text-[9px] tracking-[0.2em] text-[#fff4f8]/55">{chapter.metricLabel}</span>
          </div>
        )}

        {chapter.hud && (
          <div className="mt-5 rounded-2xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="eyebrow flex items-center gap-2 text-[#ffd3df]/85">
                <Icon className="h-3 w-3 text-[#f0aac2]" />
                {chapter.eyebrow}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#f0aac2]">live</span>
            </div>
            <div className="mb-3 font-display text-[14px] tracking-tight text-[#fff4f8]">{chapter.hud.title}</div>
            <div className="space-y-2">
              {chapter.hud.rows.map((row: ChapterPanelRow, idx: number) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between gap-3 rounded-xl border border-[#fff4f8]/8 px-3 py-2 text-[12px] ${
                    row.highlight
                      ? 'bg-gradient-to-r from-[#f0aac2]/22 via-[#ffd3df]/12 to-transparent text-[#fff4f8]'
                      : 'bg-[#fff4f8]/[0.03] text-[#fff4f8]/76'
                  }`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#fff4f8]/55">{row.label}</span>
                  <span className={`font-display text-right ${row.highlight ? 'text-[#ffd3df]' : ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#fff4f8]/45">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#f0aac2]" />
              senkronize · gerçek zamanlı
            </div>
          </div>
        )}
      </div>
    </motion.article>
  )
}

/* ---------------- Mobile / tablet wrapper ---------------- */
function FrameStoryMobile() {
  const hero = chapters.find((c) => c.role === 'hero')
  const rest = chapters.filter((c) => c.role !== 'hero')
  if (!hero) return null
  return (
    <div className="relative lg:hidden">
      <HeroChapterMobile chapter={hero} />
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 aurora-soft" />
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative mx-auto max-w-2xl space-y-10 px-5 pb-24 pt-16 sm:px-8">
          {rest.map((c, i) => (
            <ChapterCardMobile key={c.k} chapter={c} index={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function FrameStory() {
  const sectionRef = useRef(null)
  const isDesktop = useIsDesktop()
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  const smoothed = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.6 })
  const [frame, setFrame] = useState(1)
  const [activeIndex, setActiveIndex] = useState(0)
  const { canvasRef, drawFrame } = useCanvasSequence(isDesktop)

  useMotionValueEvent(smoothed, 'change', (v) => {
    if (!isDesktop) return
    const clamped = Math.min(0.9999, Math.max(0, v))
    const nextFrame = Math.min(FRAME_COUNT, Math.max(1, Math.floor(clamped * FRAME_COUNT) + 1))
    setFrame(nextFrame)
    setActiveIndex(frameToChapterIndex(nextFrame))
    drawFrame(nextFrame)
  })

  const bgScale = useTransform(smoothed, [0, 0.5, 1], [1.04, 1.0, 1.06])
  const overlay = useTransform(smoothed, [0, 0.04, 0.2, 0.6, 1], [0.65, 0.6, 0.5, 0.4, 0.5])

  const active = chapters[activeIndex]
  const isHero = active.role === 'hero'

  return (
    <section ref={sectionRef} id="story" className="relative bg-[#160b12] lg:min-h-[6000vh]">
      {/* DESKTOP (lg+) — Apple-style sticky canvas frame sequence */}
      <div className="sticky top-0 hidden h-screen overflow-hidden lg:block">
        {/* Frame layer — single <canvas> driven by pre-decoded Image array.
            No remount per frame, no flash between frames. */}
        <motion.canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ scale: bgScale }}
          aria-label={`Özlem Özge Güzellik Merkezi · sahne ${frame}`}
        />
        <motion.div style={{ opacity: overlay }} className="absolute inset-0 bg-[#160b12]" />

        {/* Vignette — keeps everything readable */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(22,11,18,0.55)_100%)]" />
        {/* Left gradient (only on story chapters where text is on the left) */}
        {!isHero && (
          <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#160b12]/85 via-[#160b12]/35 to-transparent" />
        )}
        {/* Center top fade for hero text */}
        {isHero && (
          <div className="absolute inset-x-0 top-0 h-3/4 bg-gradient-to-b from-[#160b12]/70 via-[#160b12]/35 to-transparent" />
        )}

        <div className="pointer-events-none absolute inset-0 bg-grid" />

        {/* Hero chapter — absolute layer, fades in/out with the others */}
        {chapters.map((c) =>
          c.role === 'hero' ? (
            <HeroChapter key={`hero-${c.k}`} chapter={c} isActive={c.k === active.k} />
          ) : null,
        )}

        {/* Story chapters share one stable grid. All chapters render in parallel
            and crossfade via opacity / blur — no AnimatePresence mount/unmount,
            so the hero → story boundary stays cinematic and smooth. */}
        <div
          className={`relative z-20 grid h-full grid-cols-1 items-center gap-10 px-5 pt-24 sm:px-10 lg:grid-cols-[1fr_auto] lg:gap-16 lg:px-16 xl:px-24 ${
            isHero ? 'pointer-events-none' : ''
          }`}
        >
          <div className="relative lg:max-w-[600px]">
            {chapters.map((c) =>
              c.role === 'hero' ? null : (
                <div key={`story-wrap-${c.k}`} className={c.k === active.k ? 'relative' : 'pointer-events-none absolute inset-0'}>
                  <StoryBlock chapter={c} isActive={c.k === active.k} />
                </div>
              ),
            )}
          </div>
          <div className="relative hidden lg:block">
            {chapters.map((c) =>
              c.role === 'hero' || !c.hud ? null : (
                <div key={`hud-wrap-${c.k}`} className={c.k === active.k ? 'relative' : 'pointer-events-none absolute inset-0'}>
                  <HudCard chapter={c} isActive={c.k === active.k} />
                </div>
              ),
            )}
          </div>
        </div>

        {/* Top-right tiny frame counter */}
        <div className="pointer-events-none absolute right-6 top-6 z-30 hidden items-center gap-2 rounded-full border border-[#fff4f8]/10 bg-[#160b12]/45 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#fff4f8]/55 backdrop-blur-xl sm:flex">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#f0aac2]" />
          <span>{String(frame).padStart(4, '0')} / {FRAME_COUNT}</span>
        </div>

        {/* Hero scroll cue (only first chapter) */}
        {isHero && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.7, duration: 1 }}
            className="pointer-events-none absolute bottom-8 left-1/2 z-30 -translate-x-1/2"
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              className="flex flex-col items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[#fff4f8]/52"
            >
              <span className="font-mono">scroll</span>
              <span className="grid h-9 w-9 place-items-center rounded-full border border-[#fff4f8]/22">
                <ArrowDown className="h-3.5 w-3.5" />
              </span>
            </motion.div>
          </motion.div>
        )}
      </div>

      {/* MOBILE / TABLET (<lg) — premium normal-flow story */}
      <FrameStoryMobile />
    </section>
  )
}
