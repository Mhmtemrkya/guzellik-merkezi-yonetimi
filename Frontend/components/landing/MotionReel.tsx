'use client'

import Image from 'next/image'
import { CalendarDays, ChartNoAxesCombined, MessageCircle, WalletCards, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styles from './MotionReel.module.css'

type Note = { title: string; text: string; icon: LucideIcon; tone: string }

/** Soldaki bilgi kartları: videodaki sırayla (randevu → kasa → rapor → WhatsApp yanıtı). */
const notes: Note[] = [
  { title: 'Randevular tek takvimde', text: 'Online randevu, bekleme listesi ve hatırlatmalar aynı ekranda.', icon: CalendarDays, tone: 'pink' },
  { title: 'Kasa anlık', text: 'Tahsilat, adisyon ve gün sonu kapanışı tek yerden.', icon: WalletCards, tone: 'green' },
  { title: 'Raporlar hazır', text: 'Hizmet, personel ve gelir raporları; Excel ve PDF çıktısı.', icon: ChartNoAxesCombined, tone: 'blue' },
  { title: 'WhatsApp ile onay', text: 'Müşteri hatırlatmaya “Evet” yazar, randevu kendiliğinden onaylanır.', icon: MessageCircle, tone: 'mint' },
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Kaydırma ilerlemesindeki aşamalar (0–1). */
const OPEN_END = 0.24 // daire tam ekrana bu noktada ulaşır
const PLAY_START = 0.18 // video bu noktadan…
const PLAY_END = 0.96 // …buraya kadar baştan sona sarılır
const NOTES_START = 0.26
const NOTES_END = 0.94

/**
 * Hero ile sonraki bölüm arasındaki hareketli grafik sahnesi (22 Kas 2026; örnek: vibr.studio).
 * Sahne ekrandan uzundur ve içerik yapışkandır. Kaydırdıkça: video alt ortadaki bir daireden açılıp tam ekrana büyür,
 * video kaydırmayla ileri/geri sarılır (kendiliğinden oynamaz), solda bilgi kartları sırayla belirir; sahne bitince
 * sayfa devam eder. Hareket azaltma açıksa sarma ve açılış yoktur: görsel tam açık, kartlar liste hâlinde görünür.
 */
export default function MotionReel() {
  const section = useRef<HTMLElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const intro = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [motion, setMotion] = useState(false)
  const [active, setActive] = useState(-1)
  // Video kaynağı ekrana göre (kullanıcı isteği 23 Kas 2026: 4K). Fiziksel piksel genişliği 2600'ü aşan geniş ekranlar
  // 3840×2160'ı, telefon ve tablet 1920×1080'i indirir. Kaynak: tools/maydi-reel (Remotion).
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const physical = Math.max(window.screen.width, window.screen.height) * (window.devicePixelRatio || 1)
    setSrc(physical > 2600 && window.innerWidth >= 1024 ? '/landing/reel-scrub-4k.mp4' : '/landing/reel-scrub-1080.mp4')
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotion(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!motion) return
    const root = section.current
    const el = video.current
    if (!root || !el) return

    let raf = 0
    let target = 0
    let shown = -2

    const render = () => {
      raf = 0
      const rect = root.getBoundingClientRect()
      const travel = Math.max(1, rect.height - window.innerHeight)
      const p = clamp01(-rect.top / travel)

      // Daire: alt ortadan tam ekrana (yarıçap ekran köşegenini kaplayacak kadar büyür).
      const open = easeInOut(clamp01(p / OPEN_END))
      if (frame.current) frame.current.style.clipPath = `circle(${(7 + open * 143).toFixed(2)}% at 50% 100%)`
      if (intro.current) {
        const fade = clamp01(p / (OPEN_END * 0.8))
        intro.current.style.opacity = String(1 - fade)
        intro.current.style.transform = `translateY(${(-fade * 40).toFixed(1)}px)`
      }

      // Video: kaydırma oranına göre sar.
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 12
      target = clamp01((p - PLAY_START) / (PLAY_END - PLAY_START)) * (duration - 0.05)
      if (el.readyState >= 1 && Math.abs(el.currentTime - target) > 1 / 30) el.currentTime = target

      // Bilgi kartları: aralığı eşit dilimlere böl.
      const n = clamp01((p - NOTES_START) / (NOTES_END - NOTES_START))
      const index = p < NOTES_START || p > NOTES_END ? -1 : Math.min(notes.length - 1, Math.floor(n * notes.length))
      if (index !== shown) {
        shown = index
        setActive(index)
      }
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render)
    }

    el.pause()
    el.addEventListener('loadedmetadata', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('loadedmetadata', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [motion, src])

  return (
    <section ref={section} className={styles.reel} data-motion={motion || undefined} aria-labelledby="reel-title">
      <div className={styles.sticky}>
        <div ref={intro} className={styles.intro}>
          <p className={styles.eyebrow}><span /> BeautyAsist’te bir gün</p>
          <h2 id="reel-title" className={styles.title}>Randevu, kasa ve raporlar <span>Maydi ile tek ekranda.</span></h2>
        </div>

        <div ref={frame} className={styles.frame}>
          <Image src="/landing/reel-scrub-poster.jpg" alt="" fill sizes="100vw" className={styles.media} />
          {motion && src && (
            <video ref={video} key={src} className={styles.media} muted playsInline preload="auto" aria-hidden="true">
              <source src={src} type="video/mp4" />
            </video>
          )}

          <ol className={styles.notes}>
            {notes.map(({ title, text, icon: Icon, tone }, index) => (
              <li key={title} data-tone={tone} data-active={!motion || index === active || undefined} aria-hidden={motion && index !== active ? true : undefined}>
                <span className={styles.noteIcon} aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
                <span>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
