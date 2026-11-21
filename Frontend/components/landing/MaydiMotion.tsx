'use client'

import Image from 'next/image'
import { useEffect, useRef } from 'react'
import MaydiDemo from './MaydiDemo'
import styles from './MaydiMotion.module.css'

const timelineDuration = 1000

const layers: Record<string, Keyframe[]> = {
  light: [
    { offset: 0, opacity: 0.12, transform: 'scale3d(.58, .23, 1)' },
    { offset: 0.29, opacity: 0.82, transform: 'scale3d(1.03, 1.08, 1)' },
    { offset: 0.66, opacity: 0.38, transform: 'scale3d(.91, .98, 1)' },
    { offset: 1, opacity: 0.28, transform: 'scale3d(.92, 1, 1)' },
  ],
  pedestal: [
    { offset: 0, opacity: 0.15, transform: 'scale(.72)' },
    { offset: 0.26, opacity: 0.94, transform: 'scale(1.23)' },
    { offset: 0.7, opacity: 0.48, transform: 'scale(1)' },
    { offset: 1, opacity: 0.38, transform: 'scale(1)' },
  ],
  orbit: [
    { offset: 0, opacity: 0, transform: 'translate(-50%, -50%) scale(.52) rotate(-46deg)' },
    { offset: 0.18, opacity: 0.14, transform: 'translate(-50%, -50%) scale(.67) rotate(-29deg)' },
    { offset: 0.58, opacity: 0.96, transform: 'translate(-50%, -50%) scale(1.08) rotate(17deg)' },
    { offset: 1, opacity: 0.62, transform: 'translate(-50%, -50%) scale(1) rotate(32deg)' },
  ],
  mascot: [
    { offset: 0, opacity: 0.13, transform: 'translateY(49%) scale(.92) rotate(-12deg)' },
    { offset: 0.22, opacity: 0.43, transform: 'translateY(32%) scale(.94) rotate(-9deg)' },
    { offset: 0.76, opacity: 1, transform: 'translateY(-3%) scale(1.025) rotate(2deg)' },
    { offset: 1, opacity: 1, transform: 'none' },
  ],
  chat: [
    { offset: 0, transform: 'translate3d(0, 28px, 0) scale(.97)' },
    { offset: 0.43, transform: 'translate3d(0, 28px, 0) scale(.97)' },
    { offset: 1, transform: 'none' },
  ],
}

export default function MaydiMotion() {
  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const scene = sceneRef.current
    if (!stage || !scene || typeof stage.animate !== 'function') return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame: number | undefined
    let previousProgress = -1
    let animations: Animation[] = []

    const update = () => {
      frame = undefined
      const viewport = window.innerHeight
      const { top } = scene.getBoundingClientRect()
      const start = viewport * 0.94
      const end = viewport * 0.23
      const progress = Math.min(1, Math.max(0, (start - top) / (start - end)))
      if (progress === previousProgress) return

      previousProgress = progress
      for (const animation of animations) animation.currentTime = progress * timelineDuration
    }

    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update)
    }

    const stop = () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      frame = undefined
      for (const animation of animations) animation.cancel()
      animations = []
    }

    const configure = () => {
      stop()
      if (reducedMotion.matches) return

      previousProgress = -1
      for (const target of stage.querySelectorAll<HTMLElement>('[data-maydi-motion]')) {
        const keyframes = layers[target.dataset.maydiMotion ?? '']
        if (!keyframes) continue
        const animation = target.animate(keyframes, {
          duration: timelineDuration,
          easing: 'linear',
          fill: 'both',
        })
        animation.pause()
        animations.push(animation)
      }

      // Scroll supplies the playhead in both directions, with no timer while the viewport is still.
      update()
      window.addEventListener('scroll', schedule, { passive: true })
      window.addEventListener('resize', schedule)
    }

    configure()
    reducedMotion.addEventListener('change', configure)
    return () => {
      reducedMotion.removeEventListener('change', configure)
      stop()
    }
  }, [])

  return (
    <div ref={stageRef} className={styles.stage}>
      <div ref={sceneRef} className={styles.scene} aria-hidden="true">
        <Image
          src="/landing/maydi-stage.webp"
          alt=""
          className={styles.backdrop}
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
        />
        <div className={styles.light} data-maydi-motion="light" />
        <div className={styles.pedestal} data-maydi-motion="pedestal" />
        <div className={styles.orbit} data-maydi-motion="orbit">
          <span />
          <span />
          <span />
        </div>
        <div className={styles.mascot} data-maydi-motion="mascot">
          <Image src="/mascots/maydi/idle.webp" alt="" width={240} height={300} />
        </div>
      </div>
      <div className={styles.conversation} data-maydi-motion="chat">
        <MaydiDemo />
      </div>
    </div>
  )
}
