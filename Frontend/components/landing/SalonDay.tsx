'use client'

import Image from 'next/image'
import { ArrowDown, CalendarDays, ClipboardCheck, Layers3, WalletCards } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styles from './SalonDay.module.css'

const scenes = [
  {
    name: 'Randevu', time: '09:00', title: 'İlk randevuya hazır.', image: 'resepsiyon', icon: CalendarDays,
    text: 'Sabah ajandasını açın. Hangi uzmanın, hangi odada ve saat kaçta randevusu olduğunu tek bakışta görün.',
  },
  {
    name: 'Danışan', time: '11:30', title: 'Danışanınız kapıda.', image: 'tedavi-odasi', icon: ClipboardCheck,
    text: 'Önceki ziyaretleri ve danışan notlarını kartından açın. Gerekli onamı seans başlamadan kayda alın.',
  },
  {
    name: 'Seans', time: '15:00', title: 'Bir seans tamamlandı.', image: 'tablet', icon: Layers3,
    text: 'Uygulanan hizmeti işaretleyin, paket kullanımını kaydedin ve kalan seansları danışan kartından takip edin.',
  },
  {
    name: 'Kasa', time: '19:00', title: 'Günün hesabı hazır.', image: 'studio-nightfall', icon: WalletCards,
    text: 'Nakit, kart ve havaleyi ayrı ayrı görün. Gün sonu raporuyla kapanışı yapın.',
  },
] as const

const stops = [0, .29, .61, .9]
const fadeBefore = .075
const fadeAfter = .025
const duration = 1000

function photoFrames(index: number): Keyframe[] {
  const scale = { transform: 'scale(1.05) translateX(1%)' }
  const settle = { transform: 'scale(1) translateX(0)' }
  if (index === 0) return [{ ...scale, opacity: 1 }, { ...settle, offset: .4, opacity: 1 }]

  const cut = stops[index]
  return [
    { ...scale, opacity: 0, offset: 0 },
    { ...scale, opacity: 0, offset: cut - fadeBefore },
    { opacity: 1, offset: cut + fadeAfter, transform: 'scale(1.025) translateX(.4%)' },
    { ...settle, opacity: 1, offset: Math.min(1, cut + .18) },
  ]
}

function StoryCopy({ index }: { index: number }) {
  const scene = scenes[index]
  const Icon = scene.icon
  return (
    <>
      <p className={styles.sceneTag}><Icon size={16} aria-hidden="true" />{scene.name}</p>
      <h3>{scene.title}</h3>
      <p className={styles.sceneText}>{scene.text}</p>
    </>
  )
}

export default function SalonDay() {
  const trackRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const track = trackRef.current
    const screen = screenRef.current
    if (!track || !screen || typeof screen.animate !== 'function') return

    const preference = matchMedia('(prefers-reduced-motion: no-preference) and (min-height: 510px)')
    let animations: Animation[] = []
    let frame = 0
    let lastProgress = -1
    let lastScene = 0

    const update = () => {
      frame = 0
      const top = parseFloat(getComputedStyle(screen).top)
      const travel = track.offsetHeight - screen.offsetHeight
      if (!Number.isFinite(top) || travel <= 0) return
      const progress = Math.min(1, Math.max(0, (top - track.getBoundingClientRect().top) / travel))
      if (progress === lastProgress) return
      lastProgress = progress
      for (const animation of animations) animation.currentTime = progress * duration

      const index = stops.findLastIndex(stop => stop + (fadeAfter - fadeBefore) / 2 <= progress)
      if (index !== lastScene) {
        lastScene = index
        setActive(index)
      }
    }

    const schedule = () => {
      if (animations.length && !frame) frame = requestAnimationFrame(update)
    }

    const configure = () => {
      for (const animation of animations) animation.cancel()
      animations = []
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      delete track.dataset.motion
      if (!preference.matches) return

      track.dataset.motion = 'true'
      lastProgress = -1
      const animate = (element: Element, frames: Keyframe[]) => {
        const animation = element.animate(frames, { duration, fill: 'both' })
        animation.pause()
        animations.push(animation)
      }
      screen.querySelectorAll('[data-day-photo]').forEach((element, index) => animate(element, photoFrames(index)))
      const bar = screen.querySelector('[data-day-bar]')
      if (bar) animate(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }])
      update()
    }

    configure()
    preference.addEventListener('change', configure)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      preference.removeEventListener('change', configure)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
      for (const animation of animations) animation.cancel()
      delete track.dataset.motion
    }
  }, [])

  function jumpTo(index: number) {
    const track = trackRef.current
    const screen = screenRef.current
    if (!track || !screen) return
    const screenTop = parseFloat(getComputedStyle(screen).top)
    const travel = track.offsetHeight - screen.offsetHeight
    // Jump beyond the crossfade so a direct selection leaves a settled photograph on screen.
    const progress = index === 0 ? 0 : stops[index] + fadeAfter
    const start = window.scrollY + track.getBoundingClientRect().top - screenTop
    window.scrollTo({ top: Math.ceil(start + travel * progress) })
  }

  return (
    <section id="bir-gun-sahne" className={styles.day} aria-labelledby="salon-day-heading">
      <header className={styles.intro}>
        <div>
          <p className={styles.label}>Bir gün, dört sahne</p>
          <h2 id="salon-day-heading">Bir salonun günü.</h2>
        </div>
        <p>Kapıyı açtığınız andan kasayı kapatana kadar BeautyAsist’in nerede devreye girdiğini görün.</p>
      </header>
      <div ref={trackRef} className={styles.track} data-salon-day="">
        <div ref={screenRef} className={styles.screen} data-salon-day-pin="" data-salon-day-scene={active + 1}>
          <div className={styles.photos} aria-hidden="true">
            {scenes.map(scene => (
              <div key={scene.time} className={styles.photo} data-day-photo="">
                <Image src={'/landing/' + scene.image + '.webp'} alt="" fill sizes="100vw" />
              </div>
            ))}
          </div>
          <div className={styles.content}>
            <p className={styles.clock} aria-hidden="true"><time>{scenes[active].time}</time></p>
            <div className={styles.speech}>
              <StoryCopy index={active} />
            </div>
          </div>
          <div className={styles.timeline}>
            <div className={styles.timelineTop}>
              <p><ArrowDown size={14} aria-hidden="true" /> Kaydırarak takip edin</p>
              <div className={styles.bar} aria-hidden="true"><span data-day-bar="" /></div>
            </div>
            <ol aria-label="Salonda günün aşamaları">
              {scenes.map((scene, index) => (
                <li key={scene.time}>
                  <button type="button" onClick={() => jumpTo(index)} aria-current={index === active ? 'step' : undefined}>
                    <time>{scene.time}</time><span>{scene.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <ol className={styles.staticList} aria-label="Salonda günün aşamaları">
          {scenes.map((scene, index) => (
            <li key={scene.time}>
              <div className={styles.staticPhoto}>
                <Image src={'/landing/' + scene.image + '.webp'} alt="" fill sizes="(max-width: 680px) 100vw, 50vw" />
              </div>
              <div className={styles.staticCopy}>
                <time>{scene.time}</time>
                <StoryCopy index={index} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
