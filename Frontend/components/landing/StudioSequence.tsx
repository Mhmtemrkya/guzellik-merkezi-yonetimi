'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, CalendarDays, UsersRound, WalletCards } from 'lucide-react'
import StudioPreview, { type StudioView } from './StudioPreview'
import styles from './StudioSequence.module.css'

const timelineLength = 1000

const layers: Record<string, Keyframe[]> = {
  room: [
    { transform: 'scale(1.12) translateX(-3%)' },
    { transform: 'scale(1.02) translateX(0%)' },
  ],
  evening: [
    { opacity: .1 },
    { offset: .43, opacity: .28 },
    { opacity: .95 },
  ],
  guide: [
    { opacity: .14, transform: 'translate(-50%, -50%) scale(.68) rotate(-12deg)' },
    { offset: .3, opacity: .86, transform: 'translate(-50%, -50%) scale(1.04) rotate(0deg)' },
    { opacity: .4, transform: 'translate(-50%, -50%) scale(1.19) rotate(12deg)' },
  ],
  panel: [
    { transform: 'perspective(1050px) translateY(12%) rotateX(35deg) rotateZ(-6deg) scale(.82)', easing: 'cubic-bezier(.23, 1, .32, 1)' },
    { offset: .32, transform: 'perspective(1050px) translateY(0) rotateX(0deg) rotateZ(0deg) scale(1)' },
    { offset: .68, transform: 'perspective(1050px) translateY(0) rotateX(0deg) rotateZ(0deg) scale(1)' },
    { transform: 'perspective(1050px) translateY(-1%) rotateX(0deg) rotateZ(0deg) scale(1)' },
  ],
  calendar: [
    { opacity: .25, transform: 'translate(-36px, 26px) rotate(-22deg) scale(.88)' },
    { offset: .2, opacity: 1, transform: 'translate(0, 0) rotate(-7deg) scale(1)' },
    { offset: .36, opacity: .85, transform: 'translate(3px, -3px) rotate(-4deg) scale(1)' },
    { offset: .51, opacity: 0, transform: 'translate(17px, -27px) rotate(11deg) scale(.92)' },
    { opacity: 0, transform: 'translate(17px, -27px) rotate(11deg) scale(.92)' },
  ],
  people: [
    { opacity: 0, transform: 'translate(24px, 21px) rotate(17deg) scale(.9)' },
    { offset: .33, opacity: 0, transform: 'translate(24px, 21px) rotate(17deg) scale(.9)' },
    { offset: .55, opacity: 1, transform: 'translate(0, 0) rotate(7deg) scale(1)' },
    { offset: .72, opacity: .83, transform: 'translate(-2px, -4px) rotate(5deg) scale(1)' },
    { offset: .84, opacity: 0, transform: 'translate(-19px, -24px) rotate(-9deg) scale(.92)' },
    { opacity: 0, transform: 'translate(-19px, -24px) rotate(-9deg) scale(.92)' },
  ],
  wallet: [
    { opacity: 0, transform: 'translate(-29px, 35px) rotate(-15deg) scale(.9)' },
    { offset: .68, opacity: 0, transform: 'translate(-29px, 35px) rotate(-15deg) scale(.9)' },
    { offset: .9, opacity: 1, transform: 'translate(0, 0) rotate(-6deg) scale(1)' },
    { opacity: 1, transform: 'translate(1px, -5px) rotate(-4deg) scale(1)' },
  ],
  progress: [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
}

function viewAt(progress: number): StudioView {
  if (progress >= .69) return 'kasa'
  if (progress >= .36) return 'danisan'
  return 'randevu'
}

export default function StudioSequence({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const [scrollView, setScrollView] = useState<StudioView>('randevu')
  const [manualView, setManualView] = useState<StudioView | null>(null)
  const view = manualView ?? scrollView

  useEffect(() => {
    const track = trackRef.current
    const pin = pinRef.current
    if (!track || !pin || typeof pin.animate !== 'function') return

    const preference = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-height: 510px)')
    let animations: Animation[] = []
    let frame: number | null = null
    let previousProgress = -1
    let previousView: StudioView = 'randevu'

    const update = () => {
      frame = null
      const top = Number.parseFloat(getComputedStyle(pin).top)
      const travel = track.offsetHeight - pin.offsetHeight
      const progress = travel > 0
        ? Math.min(1, Math.max(0, (top - track.getBoundingClientRect().top) / travel))
        : 0
      if (progress === previousProgress) return

      for (const animation of animations) animation.currentTime = progress * timelineLength

      const nextView = viewAt(progress)
      if (nextView !== previousView) {
        previousView = nextView
        setScrollView(nextView)
      }
      previousProgress = progress
    }

    const schedule = () => {
      if (animations.length && frame === null) frame = window.requestAnimationFrame(update)
    }

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
      for (const animation of animations) animation.cancel()
      animations = []
      delete track.dataset.scrub
    }

    const applyPreference = () => {
      stop()
      previousProgress = -1
      previousView = 'randevu'
      setScrollView('randevu')
      if (!preference.matches) return

      track.dataset.scrub = 'true'
      for (const [name, keyframes] of Object.entries(layers)) {
        const element = pin.querySelector('[data-studio-layer="' + name + '"]')
        if (!element) continue
        const animation = element.animate(keyframes, { duration: timelineLength, fill: 'both' })
        animation.pause()
        animations.push(animation)
      }
      update()
    }

    applyPreference()
    preference.addEventListener('change', applyPreference)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      stop()
      preference.removeEventListener('change', applyPreference)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return (
    <div className={styles.sequence}>
      <div className={styles.copy}>{children}</div>
      <div ref={trackRef} className={styles.track} data-studio-sequence="" data-studio-phase={view}>
        <div ref={pinRef} className={styles.pin} data-studio-pin="">
          <div className={styles.stage}>
            <div className={styles.room} data-studio-layer="room" aria-hidden="true" />
            <div className={styles.evening} data-studio-layer="evening" aria-hidden="true" />
            <div className={styles.guide} data-studio-layer="guide" aria-hidden="true" />
            <div className={styles.art} aria-hidden="true">
              <div className={styles.calendar} data-studio-layer="calendar"><CalendarDays size={30} strokeWidth={1.55} /></div>
              <div className={styles.people} data-studio-layer="people"><UsersRound size={30} strokeWidth={1.55} /></div>
              <div className={styles.wallet} data-studio-layer="wallet"><WalletCards size={30} strokeWidth={1.55} /></div>
            </div>
            <div
              className={styles.panel}
              data-studio-panel=""
              data-studio-layer="panel"
              onFocusCapture={() => setManualView(view)}
            >
              <StudioPreview value={view} onValueChange={setManualView} />
            </div>
            <div className={styles.cue} aria-hidden="true">
              <span><ArrowDown size={14} /> Kaydırarak keşfedin</span>
              <div className={styles.meter}><i data-studio-layer="progress" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
