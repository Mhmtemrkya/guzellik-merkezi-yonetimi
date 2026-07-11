'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Crown,
  CreditCard,
  HelpCircle,
  Layers3,
  PackageCheck,
  Phone,
  ReceiptText,
  Rocket,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

gsap.registerPlugin(ScrollTrigger)

const FRAME_COUNT = 1872
const frameSrc = (index: number): string => `/frames/ornek/frame_${String(index).padStart(4, '0')}.jpg`

interface StoryStat {
  value: string
  label: string
  hint: string
}

interface StoryHudRow {
  label: string
  value: string
  highlight?: boolean
}

interface StoryChapter {
  key: string
  range: [number, number]
  label: string
  title: string
  accent: string
  body: string
  metric: string
  metricLabel: string
  icon: LucideIcon
  stats?: StoryStat[]
  hud: {
    title: string
    rows: StoryHudRow[]
  }
}

const storyChapters: StoryChapter[] = [
  {
    key: '01',
    range: [1, 180],
    label: 'Güzellik merkezi yönetimi',
    title: 'Excel dağınıklığı biter.',
    accent: 'Salon tek panelden akar.',
    body: 'Paket, seans, taksit, randevu ve ön muhasebe aynı pudra-beyaz arayüzde birleşir.',
    metric: '9',
    metricLabel: 'modül tek akışta',
    icon: Sparkles,
    stats: [
      { value: '1872', label: 'scroll karesi', hint: 'video hissi' },
      { value: '360°', label: 'danışan kartı', hint: 'borç ve seans' },
      { value: '7/24', label: 'bulut panel', hint: 'web ve tablet' },
    ],
    hud: {
      title: 'Canlı operasyon özeti',
      rows: [
        { label: 'Bugünkü randevu', value: '28' },
        { label: 'Günlük ciro', value: '₺42.500', highlight: true },
        { label: 'Açık alacak', value: '₺18.200' },
      ],
    },
  },
  {
    key: '02',
    range: [181, 360],
    label: 'Problem',
    title: 'Borç karışır, seans unutulur.',
    accent: 'Sistem dengeyi kurar.',
    body: 'Excel büyüdükçe tahsilat, seans hakkı ve randevu durumu birbirinden kopar. Panel bu kopukluğu kapatır.',
    metric: '0',
    metricLabel: 'kayıp tahsilat hedefi',
    icon: ShieldCheck,
    hud: {
      title: 'Excel risklerini kapatır',
      rows: [
        { label: 'Geciken ödeme', value: 'uyarıya düşer' },
        { label: 'Unutulan seans', value: 'otomatik azalır' },
        { label: 'Karışan taksit', value: 'yeniden planlanır', highlight: true },
      ],
    },
  },
  {
    key: '03',
    range: [361, 540],
    label: 'Danışan kartı',
    title: 'Bir danışan profili,',
    accent: '360° tek ekranda.',
    body: 'Paketler, toplam satış, ödenen, kalan borç, ödeme geçmişi, kalan seanslar, randevular ve notlar aynı kartta görünür.',
    metric: '360°',
    metricLabel: 'danışan profili',
    icon: UsersRound,
    hud: {
      title: 'Selin Aksoy, aktif müşteri',
      rows: [
        { label: 'Toplam paket', value: '₺50.000' },
        { label: 'Ödenen', value: '₺25.000' },
        { label: 'Kalan borç', value: '₺25.000', highlight: true },
        { label: 'Kalan seans', value: '7 / 14' },
      ],
    },
  },
  {
    key: '04',
    range: [541, 720],
    label: 'Paket ve seans',
    title: 'Her hizmet için ayrı seans,',
    accent: 'ayrı takip.',
    body: 'Lazer 8 seans, cilt bakımı 4 seans, tüy sarartma 2 seans. Kullanılan ve kalan haklar otomatik güncellenir.',
    metric: '14',
    metricLabel: 'seans ve 3 hizmet',
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
    key: '05',
    range: [721, 920],
    label: 'Esnek tahsilat',
    title: 'Düzensiz ödeme gelirse,',
    accent: 'plan bozulmaz.',
    body: '50.000 TL paket için 20.000 TL ve 5.000 TL ödeme alındığında kalan borç yeni taksit planına bağlanır.',
    metric: '₺25.000',
    metricLabel: 'kalan borç',
    icon: CreditCard,
    hud: {
      title: 'Ödeme planı, 50.000 TL',
      rows: [
        { label: '1. ödeme', value: '₺20.000 alındı' },
        { label: '2. ödeme', value: '₺5.000 alındı' },
        { label: 'Toplam ödenen', value: '₺25.000' },
        { label: 'Yeni plan', value: '5 taksit', highlight: true },
      ],
    },
  },
  {
    key: '06',
    range: [921, 1120],
    label: 'Randevu',
    title: 'Müşteri, personel ve oda,',
    accent: 'çakışmasız takvimde.',
    body: 'Bekliyor, Geldi, Tamamlandı, Ertelendi, İptal ve Gelmedi durumları seans ve kasa akışına bağlı çalışır.',
    metric: '18',
    metricLabel: 'bugünkü randevu',
    icon: CalendarDays,
    hud: {
      title: 'Bugün, 16 Şubat',
      rows: [
        { label: '10:00 Lazer', value: 'Tamamlandı' },
        { label: '11:30 Cilt bakımı', value: 'Geldi', highlight: true },
        { label: '14:00 Sarartma', value: 'Bekliyor' },
        { label: '16:30 Lazer', value: 'Bekliyor' },
      ],
    },
  },
  {
    key: '07',
    range: [1121, 1320],
    label: 'Personel',
    title: 'Personel başına işlem,',
    accent: 'prim ve doluluk.',
    body: 'Her hizmet için uzman, süre, randevu yoğunluğu ve prim verisi aylık rapora dönüşür.',
    metric: '10',
    metricLabel: 'kullanıcı ve yetki',
    icon: BarChart3,
    hud: {
      title: 'Personel performansı',
      rows: [
        { label: 'Aylin, lazer', value: '46 işlem' },
        { label: 'Esra, cilt bakımı', value: '32 işlem' },
        { label: 'Beyza, sarartma', value: '18 işlem' },
        { label: 'Toplam prim', value: '₺14.250', highlight: true },
      ],
    },
  },
  {
    key: '08',
    range: [1321, 1520],
    label: 'Kasa ve ön muhasebe',
    title: 'Nakit, kart ve havale,',
    accent: 'canlı kasada kapanır.',
    body: 'Tahsilat, gider, geciken ödeme ve net kasa farkı gün sonunda tek yönetici ekranında okunur.',
    metric: '₺25.700',
    metricLabel: 'günlük net kasa',
    icon: WalletCards,
    hud: {
      title: 'Bugünkü kasa kapanışı',
      rows: [
        { label: 'Nakit', value: '₺8.400' },
        { label: 'Kart', value: '₺12.100' },
        { label: 'Havale / EFT', value: '₺5.200' },
        { label: 'Net kasa', value: '₺25.700', highlight: true },
      ],
    },
  },
  {
    key: '09',
    range: [1521, 1872],
    label: 'Raporlama',
    title: 'Tahsilat, alacak ve büyüme,',
    accent: 'tek cockpitte.',
    body: 'PDF ve Excel raporları, en çok satan paketler, geciken alacaklar ve büyüme grafikleri yöneticiyi hızlandırır.',
    metric: '+24%',
    metricLabel: 'aylık tahsilat artışı',
    icon: ReceiptText,
    hud: {
      title: 'Aylık yönetici özeti',
      rows: [
        { label: 'Tahsilat', value: '₺428.000' },
        { label: 'Açık alacak', value: '₺96.500' },
        { label: 'Geciken', value: '₺12.200' },
        { label: 'Büyüme', value: '+24%', highlight: true },
      ],
    },
  },
]

function frameToChapterIndex(frame: number): number {
  for (let i = 0; i < storyChapters.length; i += 1) {
    const [from, to] = storyChapters[i].range
    if (frame >= from && frame <= to) return i
  }
  return storyChapters.length - 1
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}

function useCanvasSequence(enabled: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<HTMLImageElement[]>([])
  const lastDrawnRef = useRef(0)

  const drawCover = (img: HTMLImageElement | undefined): boolean => {
    const canvas = canvasRef.current
    if (!canvas || !img || !img.complete || !img.naturalWidth) return false
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return false
    const context = canvas.getContext('2d')
    if (!context) return false

    const imageRatio = img.naturalWidth / img.naturalHeight
    const canvasRatio = width / height
    let sourceX = 0
    let sourceY = 0
    let sourceWidth = img.naturalWidth
    let sourceHeight = img.naturalHeight

    if (imageRatio > canvasRatio) {
      sourceHeight = img.naturalHeight
      sourceWidth = img.naturalHeight * canvasRatio
      sourceX = (img.naturalWidth - sourceWidth) / 2
    } else {
      sourceWidth = img.naturalWidth
      sourceHeight = img.naturalWidth / canvasRatio
      sourceY = (img.naturalHeight - sourceHeight) / 2
    }

    context.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
    return true
  }

  const drawFrame = (index: number): void => {
    if (index === lastDrawnRef.current) return
    const img = imagesRef.current[index]
    if (drawCover(img)) {
      lastDrawnRef.current = index
      return
    }

    for (let distance = 1; distance < 56; distance += 1) {
      if (drawCover(imagesRef.current[index - distance]) || drawCover(imagesRef.current[index + distance])) return
    }
  }

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawCover(imagesRef.current[lastDrawnRef.current || 1])
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const loadOne = (index: number): void => {
      if (imagesRef.current[index]) return
      const img = new Image()
      img.decoding = 'async'
      img.src = frameSrc(index)
      imagesRef.current[index] = img
      img.onload = () => {
        if (index <= 4 && lastDrawnRef.current === 0 && drawCover(img)) lastDrawnRef.current = index
      }
    }

    for (let index = 1; index <= 96; index += 1) loadOne(index)
    const timers: number[] = []
    for (let start = 97; start <= FRAME_COUNT; start += 144) {
      const timer = window.setTimeout(() => {
        for (let index = start; index <= Math.min(FRAME_COUNT, start + 143); index += 1) loadOne(index)
      }, 420 + (start - 96) * 3)
      timers.push(timer)
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [enabled])

  return { canvasRef, drawFrame }
}

export function LandingGsapReveals() {
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined') return

    const ctx = gsap.context(() => {
      // Navbar giriş animasyonu (mount anında, opacity flicker olmadan kayma)
      gsap.from('header[data-landing-nav]', { y: -22, duration: 0.75, ease: 'power3.out' })
      // Yalnızca kayma — opacity ANİMASYONU YOK. (gsap.from ile opacity:0 verilince
      // Strict Mode çift-mount / yarıda kesilme durumunda öğeler opacity 0'da takılıp
      // butonlar "görünmez" kalıyordu. Öğeler her zaman görünür, sadece hafifçe kayar.)
      gsap.from('header[data-landing-nav] [data-nav-item]', {
        y: -10,
        duration: 0.5,
        stagger: 0.06,
        delay: 0.12,
        ease: 'power2.out',
        clearProps: 'transform',
      })

      const sections = gsap.utils.toArray<HTMLElement>('#moduller, #akis, #fiyat, #sss, #demo, footer')
      sections.forEach((section) => {
        gsap.fromTo(
          section,
          { autoAlpha: 0, y: 48, filter: 'blur(12px)' },
          {
            autoAlpha: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: section,
              start: 'top 82%',
              toggleActions: 'play none none reverse',
            },
          },
        )
      })

      // Bölüm başlıkları için ekstra vurgu
      const headings = gsap.utils.toArray<HTMLElement>('#moduller h2, #akis h2, #fiyat h2, #sss h2, #demo h2')
      headings.forEach((heading) => {
        gsap.fromTo(
          heading,
          { autoAlpha: 0, y: 26, letterSpacing: '-0.02em' },
          {
            autoAlpha: 1,
            y: 0,
            letterSpacing: '-0.055em',
            duration: 0.9,
            ease: 'power4.out',
            scrollTrigger: { trigger: heading, start: 'top 86%', toggleActions: 'play none none reverse' },
          },
        )
      })

      const cards = gsap.utils.toArray<HTMLElement>('#moduller article, #akis article, #fiyat article, #sss article')
      cards.forEach((card, i) => {
        gsap.fromTo(
          card,
          { autoAlpha: 0, y: 34, scale: 0.97, rotateX: 6 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            rotateX: 0,
            duration: 0.7,
            ease: 'power3.out',
            delay: (i % 3) * 0.06,
            scrollTrigger: {
              trigger: card,
              start: 'top 88%',
              toggleActions: 'play none none reverse',
            },
          },
        )
      })

      ScrollTrigger.refresh()
    })

    return () => ctx.revert()
  }, [reducedMotion])

  return null
}

function StoryHud({ chapter }: { chapter: StoryChapter }) {
  const Icon = chapter.icon
  return (
    <div className="rounded-[30px] border border-white/85 bg-white/82 p-5 shadow-[0_28px_90px_-48px_rgba(142,63,91,0.82)] backdrop-blur-2xl ring-1 ring-[#ffe3ec]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[12px] font-bold text-[#251923]">{chapter.hud.title}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b58295]">canlı özet</div>
          </div>
        </div>
        <span className="rounded-full bg-[#fff0f5] px-3 py-1 text-[10px] font-bold text-[#c85776] ring-1 ring-[#ffd3df]">{chapter.key}</span>
      </div>
      <div className="space-y-2.5">
        {chapter.hud.rows.map((row) => (
          <div
            key={`${chapter.key}-${row.label}`}
            className={`flex items-center justify-between gap-4 rounded-2xl border px-3.5 py-3 text-[12px] ${
              row.highlight
                ? 'border-[#efbfd0] bg-gradient-to-r from-[#ffe7ef] to-white text-[#8e3f5b]'
                : 'border-[#f0e0e6] bg-[#fffafb] text-[#6f5968]'
            }`}
          >
            <span className="font-semibold">{row.label}</span>
            <span className="font-display text-[14px] text-[#251923]">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StoryCopy({ chapter, active }: { chapter: StoryChapter; active: boolean }) {
  const isHero = chapter.key === '01'
  const TitleTag = isHero ? 'h1' : 'h2'

  return (
    <motion.div
      aria-hidden={!active}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 18, filter: active ? 'blur(0px)' : 'blur(8px)' }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className={active ? 'relative gsap-hero-entry' : 'pointer-events-none absolute inset-0'}
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0] bg-white/78 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b] shadow-[0_16px_46px_-34px_rgba(142,63,91,0.64)] backdrop-blur-xl">
        {isHero ? 'Premium güzellik merkezi yönetimi' : chapter.label}
      </div>
      <TitleTag className="mt-5 max-w-2xl font-display text-[clamp(2.45rem,5vw,5.55rem)] leading-[0.94] tracking-[-0.06em] text-[#251923]">
        {isHero ? 'Güzellik merkeziniz için zarif, hızlı ve tek panel.' : chapter.title} {!isHero && <span className="beautyassist-text-gradient">{chapter.accent}</span>}
      </TitleTag>
      <p className="mt-5 max-w-xl text-[16px] leading-8 text-[#6f5968]">
        {isHero ? 'Danışan, randevu, paket, seans, taksit, kasa ve personel akışını frame-scroll ürün hikayesiyle yönetin.' : chapter.body}
      </p>

      {isHero ? (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="/login" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-7 text-[14px] font-bold text-white shadow-[0_22px_50px_-22px_rgba(200,87,118,0.92)] transition hover:-translate-y-0.5">
              Paneli Deneyin <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#fiyat" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-[#ead8df] bg-white/80 px-7 text-[14px] font-bold text-[#6f4153] shadow-[0_16px_42px_-30px_rgba(142,63,91,0.62)] transition hover:border-[#ef9ab5] hover:text-[#c85776]">
              Paketleri Gör
            </a>
          </div>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {(chapter.stats ?? []).map((stat) => (
              <div key={stat.label} className="rounded-[24px] border border-white/85 bg-white/76 p-4 shadow-[0_18px_56px_-42px_rgba(142,63,91,0.72)] backdrop-blur-xl">
                <div className="font-display text-[28px] leading-none text-[#c85776]">{stat.value}</div>
                <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#6f4153]">{stat.label}</div>
                <div className="mt-1 text-[12px] text-[#9b7b8d]">{stat.hint}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-7 inline-flex items-end gap-3 rounded-[26px] border border-white/85 bg-white/78 px-5 py-4 shadow-[0_20px_60px_-44px_rgba(142,63,91,0.72)] backdrop-blur-xl">
          <span className="font-display text-[42px] leading-none text-[#c85776]">{chapter.metric}</span>
          <span className="pb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9b7b8d]">{chapter.metricLabel}</span>
        </div>
      )}
    </motion.div>
  )
}

function MobileStoryCard({ chapter, index }: { chapter: StoryChapter; index: number }) {
  const Icon = chapter.icon
  const frame = Math.min(FRAME_COUNT, Math.max(1, chapter.range[0] + 18))

  return (
    <motion.article
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.22 }}
      transition={{ duration: 0.62, delay: Math.min(index * 0.04, 0.18) }}
      className="overflow-hidden rounded-[30px] border border-[#ead8df]/80 bg-white/84 shadow-[0_24px_74px_-48px_rgba(142,63,91,0.76)] backdrop-blur-xl"
    >
      <div className="relative h-52 overflow-hidden bg-[#fff0f5]">
        <img src={frameSrc(frame)} alt={`${chapter.label} sahnesi`} className="h-full w-full object-cover opacity-55 saturate-[0.8]" loading="lazy" decoding="async" />
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-[#fff0f5]/20" />
        <span className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-2xl bg-white/82 text-[#d65f83] ring-1 ring-[#ffd3df] backdrop-blur-xl">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b65f7b]">{chapter.key} / {chapter.label}</div>
        <h3 className="mt-3 font-display text-[28px] leading-tight tracking-[-0.05em] text-[#251923]">
          {chapter.title} <span className="text-[#c85776]">{chapter.accent}</span>
        </h3>
        <p className="mt-3 text-[14px] leading-7 text-[#755d6d]">{chapter.body}</p>
        <StoryHud chapter={chapter} />
      </div>
    </motion.article>
  )
}

export function LightFrameStory() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const isDesktop = useIsDesktop()
  const reducedMotion = useReducedMotion()
  const canvasEnabled = isDesktop && !reducedMotion
  const { canvasRef, drawFrame } = useCanvasSequence(canvasEnabled)
  const frameRef = useRef(1)
  const activeRef = useRef(0)
  const [frame, setFrame] = useState(1)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeChapter = storyChapters[activeIndex]

  useEffect(() => {
    if (!canvasEnabled || !sectionRef.current || !stageRef.current) return
    const section = sectionRef.current
    const stage = stageRef.current

    drawFrame(1)
    const ctx = gsap.context(() => {
      gsap.fromTo(
        stage,
        { autoAlpha: 0, scale: 1.025, clipPath: 'inset(0% 0% 8% 0%)' },
        { autoAlpha: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.05, ease: 'power3.out' },
      )

      gsap.fromTo(
        '.gsap-hero-entry',
        { autoAlpha: 0, y: 28, filter: 'blur(10px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.9, stagger: 0.08, delay: 0.12, ease: 'power3.out' },
      )

      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom bottom',
        pin: stage,
        pinSpacing: false,
        scrub: 0.65,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const nextFrame = Math.min(FRAME_COUNT, Math.max(1, Math.floor(self.progress * (FRAME_COUNT - 1)) + 1))
          drawFrame(nextFrame)

          if (Math.abs(nextFrame - frameRef.current) > 8 || nextFrame === 1 || nextFrame === FRAME_COUNT) {
            frameRef.current = nextFrame
            setFrame(nextFrame)
          }

          const nextActive = frameToChapterIndex(nextFrame)
          if (nextActive !== activeRef.current) {
            activeRef.current = nextActive
            setActiveIndex(nextActive)
          }

          if (progressRef.current) {
            gsap.set(progressRef.current, { scaleX: self.progress })
          }
        },
      })
    }, section)

    return () => ctx.revert()
  }, [canvasEnabled])

  return (
    <section ref={sectionRef} id="hikaye" className="relative min-h-[100dvh] bg-[#fff7fa] lg:min-h-[5600vh]">
      <div ref={stageRef} className="gsap-frame-stage relative hidden min-h-[100dvh] overflow-hidden lg:block">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full scale-[1.03] opacity-[0.92] saturate-[0.96] contrast-[0.98]"
          aria-label={`Güzellik merkezi scroll video karesi ${frame}`}
        />
        {/* Soldaki metnin okunması için sol taraf daha opak; sağda frameler net görünür */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,247,250,0.94)_0%,rgba(255,247,250,0.66)_42%,rgba(255,247,250,0.18)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(180deg,transparent_0%,rgba(255,247,250,0.55)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_24%,rgba(255,220,232,0.7),transparent_36%),radial-gradient(circle_at_80%_84%,rgba(255,240,245,0.5),transparent_40%)]" />
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="absolute inset-x-0 top-0 z-20 h-1 origin-left bg-gradient-to-r from-[#d65f83] via-[#ef8cad] to-[#ffd3df]" ref={progressRef} style={{ transform: 'scaleX(0)' }} />

        <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-7xl grid-cols-[minmax(0,1.03fr)_410px] items-center gap-12 px-8 pt-24 xl:px-6">
          <div className="relative min-h-[460px]">
            {storyChapters.map((chapter) => (
              <StoryCopy key={chapter.key} chapter={chapter} active={chapter.key === activeChapter.key} />
            ))}
          </div>
          <div className="relative min-h-[420px]">
            {storyChapters.map((chapter) => (
              <motion.div
                key={`hud-${chapter.key}`}
                animate={{ opacity: chapter.key === activeChapter.key ? 1 : 0, y: chapter.key === activeChapter.key ? 0 : 18, scale: chapter.key === activeChapter.key ? 1 : 0.96 }}
                transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
                className={chapter.key === activeChapter.key ? 'relative gsap-hero-entry' : 'pointer-events-none absolute inset-0'}
              >
                <StoryHud chapter={chapter} />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/85 bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b65f7b] shadow-[0_16px_50px_-34px_rgba(142,63,91,0.62)] backdrop-blur-xl">
          <span>{activeChapter.key}</span>
          <span className="h-px w-10 bg-[#efbfd0]" />
          <span>{activeChapter.label}</span>
        </div>
      </div>

      <div className="lg:hidden">
        <div className="px-4 pb-10 pt-28 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b]">Premium güzellik merkezi yönetimi</div>
            <h1 className="font-display text-[clamp(2.45rem,10vw,4.2rem)] leading-[0.95] tracking-[-0.055em] text-[#251923]">Frame-scroll hero, yeni pudra arayüzle başladı.</h1>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-[#755d6d]">Masaüstünde 1872 karelik scroll video akışı ilk ekrandan başlar. Mobilde aynı hikaye okunabilir kartlara dönüşür.</p>
          </div>
          <div className="mx-auto mt-10 max-w-2xl space-y-5">
            {storyChapters.map((chapter, index) => (
              <MobileStoryCard key={chapter.key} chapter={chapter} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

interface Plan {
  name: string
  monthly: number
  yearly: number
  tag: string
  icon: LucideIcon
  highlight?: boolean
  features: string[]
}

const plans: Plan[] = [
  {
    name: 'Başlangıç',
    monthly: 799,
    yearly: 7990,
    tag: 'Excel’den çıkış',
    icon: ShieldCheck,
    features: [
      '1 şube',
      '3 kullanıcı / personel',
      '500 müşteri kaydı',
      'Hizmet ve paket oluşturma',
      'Paket satışı',
      'Taksit ve ödeme takibi',
      'Kalan borç takibi',
      'Seans takibi',
      'Randevu takvimi',
      'Günlük kasa',
      'Excel dışa aktarma',
    ],
  },
  {
    name: 'Profesyonel',
    monthly: 1499,
    yearly: 14990,
    tag: 'En çok tercih edilen',
    icon: Crown,
    highlight: true,
    features: [
      '10 kullanıcı / personel',
      'Sınırsız müşteri ve paket',
      'Esnek taksit yönetimi',
      'Düzensiz ödeme takibi',
      'Kalan borç yeniden taksitlendirme',
      'Cari hesap takibi',
      'Geciken ödeme raporu',
      'Personel bazlı randevu',
      'Personel prim raporu',
      'PDF / Excel rapor çıktısı',
      'Manuel WhatsApp hatırlatma',
    ],
  },
  {
    name: 'Premium',
    monthly: 2990,
    yearly: 29990,
    tag: 'Çok şube, 25 kullanıcı',
    icon: Rocket,
    features: [
      'Çoklu şube desteği',
      '25 kullanıcı / personel',
      'Gelişmiş cari hesap',
      'Gelişmiş kasa raporları',
      'Personel performans raporları',
      'Personel prim yönetimi',
      'Stok ve ürün takibi',
      'Gelişmiş gelir-gider',
      'Geciken ödeme bildirimleri',
      'Yönetici dashboard',
      'Muhasebeci raporu',
      'Öncelikli teknik destek',
    ],
  },
  {
    name: 'AI Klinik',
    monthly: 4990,
    yearly: 49900,
    tag: 'AI otomasyon, çok şube',
    icon: Sparkles,
    features: [
      '75 kullanıcı / personel',
      '25 şube ve 75.000 müşteri limiti',
      'AI müşteri segmentasyonu',
      'Kampanya ve sadakat önerileri',
      'WhatsApp botu ile otomatik hatırlatma',
      'Akıllı seans yenileme uyarıları',
      'Doluluk ve gelir tahmini',
      'Gelişmiş rapor exportları',
      'API, webhook ve denetim logu',
      '7/24 öncelikli destek',
    ],
  },
]

const addons = [
  { title: 'Standart Kurulum', price: '3.000 - 5.000 TL', body: 'Firma hesabı, kullanıcılar, temel ayarlar, örnek paketler ve online eğitim.' },
  { title: 'Excel Veri Aktarımı', price: '5.000 - 15.000 TL', body: 'Mevcut müşteri, borç, paket ve seans kayıtlarının sisteme aktarılması.' },
  { title: 'Yerinde Eğitim', price: '10.000 TL+', body: 'İşletme personeline yüz yüze kullanım eğitimi.' },
  { title: 'Özel Geliştirme', price: 'Proje bazlı', body: 'Özel rapor, modül, entegrasyon veya marka bazlı istekler.' },
]

function formatPrice(value: number) {
  return value.toLocaleString('tr-TR')
}

export function LightPricing() {
  const [yearly, setYearly] = useState(false)

  return (
    <section id="fiyat" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#fffafb_0%,#fff0f5_100%)]" />
      <div className="absolute right-[-12%] top-12 h-[540px] w-[540px] rounded-full bg-[#ffdce8]/58 blur-3xl" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b] shadow-[0_14px_40px_-34px_rgba(142,63,91,0.62)]">
            <Crown className="h-3.5 w-3.5" /> SaaS paketleri, KDV hariç
          </div>
          <h2 className="font-display text-[clamp(2.4rem,5vw,5.2rem)] leading-[0.96] tracking-[-0.06em] text-[#251923]">Eski paket yapısı korundu, satın alma alanı premiumlaştı.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-8 text-[#755d6d]">Başlangıçtan AI Klinik planına kadar tüm paketler yeni renk ve font sistemiyle açık, okunur ve karşılaştırılabilir.</p>
          <div className="mt-7 inline-flex rounded-full border border-[#ead8df] bg-white/78 p-1 shadow-[0_18px_54px_-40px_rgba(142,63,91,0.72)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setYearly(false)}
              className={`rounded-full px-5 py-2.5 text-[12px] font-bold transition ${!yearly ? 'bg-[#ee789a] text-white shadow-[0_12px_30px_-18px_rgba(200,87,118,0.82)]' : 'text-[#8d7180] hover:text-[#c85776]'}`}
            >
              Aylık
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              className={`rounded-full px-5 py-2.5 text-[12px] font-bold transition ${yearly ? 'bg-[#ee789a] text-white shadow-[0_12px_30px_-18px_rgba(200,87,118,0.82)]' : 'text-[#8d7180] hover:text-[#c85776]'}`}
            >
              Yıllık, yaklaşık %17 indirim
            </button>
          </div>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan, index) => {
            const Icon = plan.icon
            const price = yearly ? plan.yearly : plan.monthly
            const suffix = yearly ? 'TL / yıl' : 'TL / ay'
            return (
              <motion.article
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.22 }}
                transition={{ duration: 0.62, delay: index * 0.06 }}
                className={`relative flex h-full flex-col rounded-[32px] border p-6 shadow-[0_28px_82px_-52px_rgba(142,63,91,0.76)] transition hover:-translate-y-1 ${
                  plan.highlight
                    ? 'border-[#ef9ab5] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffe7ef] ring-2 ring-[#ffd3df]'
                    : 'border-[#ead8df]/80 bg-white/84 backdrop-blur-xl'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute right-5 top-5 rounded-full bg-[#ee789a] px-3 py-1 text-[10px] font-bold text-white shadow-[0_10px_24px_-14px_rgba(200,87,118,0.9)]">Önerilen</div>
                )}
                <div className="mb-6 flex items-center gap-3 pr-20">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-[23px] text-[#251923]">{plan.name}</h3>
                    <p className="text-[11px] font-semibold text-[#9b7b8d]">{plan.tag}</p>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <span className="font-display text-[44px] leading-none text-[#c85776]">{formatPrice(price)}</span>
                  <span className="pb-1 text-[13px] font-semibold text-[#8d7180]">{suffix}</span>
                </div>
                <p className="mt-2 text-[12px] font-semibold text-[#a18494]">{yearly ? `Aylık yaklaşık ${formatPrice(Math.round(plan.yearly / 12))} TL` : `Yıllık ${formatPrice(plan.yearly)} TL`}</p>
                <a href="/login" className={`mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-bold transition ${plan.highlight ? 'bg-[#ee789a] text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)]' : 'border border-[#ead8df] bg-white text-[#6f4153] hover:border-[#ef9ab5] hover:text-[#c85776]'}`}>
                  Demo ile başla <ArrowUpRight className="h-4 w-4" />
                </a>
                <div className="mt-6 space-y-2.5">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex gap-2.5 text-[13px] leading-6 text-[#5d4652]">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#d65f83]" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </motion.article>
            )
          })}
        </div>

        <div className="mt-8 rounded-[34px] border border-[#ead8df]/80 bg-white/76 p-6 shadow-[0_28px_82px_-52px_rgba(142,63,91,0.76)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#fff0f5] px-3 py-1 text-[11px] font-bold text-[#b65f7b] ring-1 ring-[#ffd3df]">
                <Phone className="h-3.5 w-3.5" /> Kurumsal / Özel Paket
              </div>
              <h3 className="font-display text-[30px] tracking-[-0.05em] text-[#251923]">Markaya özel panel, özel modül ve kaynak kod opsiyonu.</h3>
              <p className="mt-2 text-[14px] leading-7 text-[#755d6d]">Özel domain, özel raporlar, gelişmiş yetkilendirme, eğitim ve danışmanlık teklif ile belirlenir.</p>
            </div>
            <a href="/login" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-6 text-[13px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)]">
              Teklif al <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {addons.map((addon) => (
              <div key={addon.title} className="rounded-[24px] border border-[#f0e0e6] bg-[#fffafb] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#b65f7b]">{addon.title}</div>
                <div className="mt-2 font-display text-[21px] text-[#251923]">{addon.price}</div>
                <p className="mt-2 text-[13px] leading-6 text-[#755d6d]">{addon.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const faqItems = [
  {
    q: 'Excel’den geçiş zor mu? Verilerimizi nasıl aktarırsınız?',
    a: 'Excel veri aktarımı ek hizmet olarak kurgulanır. Mevcut müşteri, borç, paket, taksit ve seans kayıtları sisteme aktarılır. Kurulumda firma hesabı, kullanıcılar, hizmetler ve örnek paketler hazır teslim edilir.',
  },
  {
    q: 'Düzensiz ödeme yapan müşteri olursa ne olur?',
    a: 'Sistem her tahsilatı geçmişe işler ve kalan borcu otomatik hesaplar. İsterseniz kalan borcu yeniden taksitlendirebilirsiniz. Eski ödemeler silinmez.',
  },
  {
    q: 'Bir paket içinde birden fazla hizmet ve farklı seans sayısı olabilir mi?',
    a: 'Evet. Örnek olarak 8 seans lazer, 4 seans cilt bakımı ve 2 seans tüy sarartma aynı pakette ayrı ayrı takip edilir. Toplam, kullanılan ve kalan seans otomatik güncellenir.',
  },
  {
    q: 'Randevu tamamlandığında seans otomatik düşer mi?',
    a: 'Evet. Randevu Tamamlandı durumuna geçtiğinde ilgili paketin ilgili hizmet seansı düşer. Bekliyor, Geldi, Tamamlandı, Ertelendi, İptal ve Gelmedi durumları kullanılabilir.',
  },
  {
    q: 'Personel bazlı yetki ve prim raporu var mı?',
    a: 'Profesyonel ve Premium paketlerde personel bazlı randevu yönetimi, performans ve prim raporları bulunur. Premium pakette gelişmiş yetkilendirme ve yönetici dashboard’u eklenir.',
  },
  {
    q: 'Çok şubeli yönetim destekleniyor mu?',
    a: 'Çoklu şube desteği Premium pakette gelir. Kurumsal pakette markaya özel domain, özel kurulum, kaynak kod devri ve özel modüller opsiyonu sunulur.',
  },
  {
    q: 'E-fatura ve mobil uygulama var mı?',
    a: 'İlk odak paket, taksit, ödeme, seans ve randevu akışını kusursuz çalıştırmaktır. E-fatura ve mobil uygulama sonraki sürüm yol haritasında değerlendirilebilir.',
  },
]

export function LightFaq() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section id="sss" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#fff0f5_0%,#fffafb_100%)]" />
      <div className="relative mx-auto max-w-4xl">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b] shadow-[0_14px_40px_-34px_rgba(142,63,91,0.62)]">
            <HelpCircle className="h-3.5 w-3.5" /> Sık sorulanlar
          </div>
          <h2 className="font-display text-[clamp(2.35rem,5vw,4.7rem)] leading-[0.96] tracking-[-0.055em] text-[#251923]">Eski SSS içeriği, yeni premium kart diliyle.</h2>
        </div>
        <div className="space-y-3">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index
            return (
              <article key={item.q} className={`overflow-hidden rounded-[28px] border transition ${isOpen ? 'border-[#ef9ab5] bg-white shadow-[0_24px_72px_-46px_rgba(142,63,91,0.74)]' : 'border-[#ead8df]/80 bg-white/76 hover:border-[#efbfd0]'}`}>
                <button type="button" onClick={() => setOpenIndex(isOpen ? -1 : index)} className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left sm:px-6">
                  <span className="font-display text-[17px] leading-6 text-[#251923]">{item.q}</span>
                  <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.32 }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff0f5] text-[#c85776] ring-1 ring-[#ffd3df]">
                    <ChevronDown className="h-4 w-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
                      <p className="px-5 pb-5 text-[14px] leading-7 text-[#755d6d] sm:px-6">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const ctaKpis = [
  { icon: WalletCards, label: 'Günlük kasa', value: '₺25.700' },
  { icon: UsersRound, label: 'Aktif danışan', value: '412' },
  { icon: PackageCheck, label: 'Satılan paket', value: '18' },
  { icon: CalendarCheck, label: 'Bugünkü randevu', value: '14' },
]

export function LightFinalCta() {
  return (
    <section id="demo" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[#fff0f5]" />
      <div className="absolute left-1/2 top-1/2 h-[620px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffdce8]/70 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-8 rounded-[42px] border border-white/85 bg-white/76 p-6 shadow-[0_38px_130px_-70px_rgba(142,63,91,0.82)] backdrop-blur-2xl lg:grid-cols-[0.92fr_1.08fr] lg:p-10">
        <div className="flex flex-col justify-center">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b]">
            <WandSparkles className="h-3.5 w-3.5" /> Demo paneli
          </div>
          <h2 className="font-display text-[clamp(2.35rem,5vw,5rem)] leading-[0.95] tracking-[-0.06em] text-[#251923]">Eski landing’in tüm satış gücü, yeni arayüz kalitesiyle birleşti.</h2>
          <p className="mt-5 max-w-xl text-[16px] leading-8 text-[#755d6d]">Scroll video, bilgi kartları, modül akışı, paketler, ek hizmetler ve SSS artık aynı pudra-beyaz premium dilde çalışıyor.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="/login" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-7 text-[14px] font-bold text-white shadow-[0_22px_50px_-22px_rgba(200,87,118,0.92)] transition hover:-translate-y-0.5">
              Demo Paneline Geç <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#fiyat" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-[#ead8df] bg-white/78 px-7 text-[14px] font-bold text-[#6f4153] shadow-[0_16px_42px_-30px_rgba(142,63,91,0.62)] transition hover:border-[#ef9ab5] hover:text-[#c85776]">
              Paketleri İncele
            </a>
          </div>
        </div>
        <div className="rounded-[34px] border border-[#ead8df]/80 bg-[#fffafb] p-4 shadow-[0_26px_82px_-54px_rgba(142,63,91,0.76)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b65f7b]">Demo önizleme</div>
              <div className="mt-1 font-display text-[24px] text-[#251923]">Bugünkü yönetici özeti</div>
            </div>
            <span className="rounded-full bg-[#fff0f5] px-3 py-1 text-[11px] font-bold text-[#c85776] ring-1 ring-[#ffd3df]">Canlı</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {ctaKpis.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="rounded-[24px] border border-[#f0e0e6] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-display text-[26px] text-[#c85776]">{item.value}</span>
                  </div>
                  <div className="mt-3 text-[12px] font-semibold text-[#6f5968]">{item.label}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 rounded-[24px] bg-gradient-to-r from-[#fff0f5] to-white p-4 ring-1 ring-[#f0dfe7]">
            <div className="flex items-center gap-2 text-[13px] font-bold text-[#6f4153]"><CircleDollarSign className="h-4.5 w-4.5 text-[#d65f83]" /> Tahsilat, randevu ve seans aynı anda güncellenir.</div>
            <p className="mt-2 text-[13px] leading-6 text-[#856a7a]">KAYA’nın istediği eski ürün anlatımı korundu. Sadece görsel dil referans dashboard kalitesine yükseltildi.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
