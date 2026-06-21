'use client'

import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'

type BackdropVariant = 'admin' | 'personel' | 'platform'

interface OrbConfig {
  size: string
  color: string
  position: string
  intensity: number
  duration: number
}

const variantOrbs: Record<BackdropVariant, OrbConfig[]> = {
  admin: [
    { size: 'h-[520px] w-[520px]', color: 'bg-[#ffdce8]/70', position: 'left-[-15%] top-[-18%]', intensity: 24, duration: 13 },
    { size: 'h-[500px] w-[500px]', color: 'bg-[#fff1f6]/90', position: 'right-[-14%] bottom-[-18%]', intensity: 20, duration: 15 },
    { size: 'h-[340px] w-[340px]', color: 'bg-[#f6b8cb]/36', position: 'left-[45%] top-[22%]', intensity: 16, duration: 11 },
    { size: 'h-[260px] w-[260px]', color: 'bg-[#efd8e1]/44', position: 'right-1/4 bottom-1/3', intensity: 12, duration: 17 },
  ],
  personel: [
    { size: 'h-[500px] w-[500px]', color: 'bg-[#ffdce8]/64', position: 'left-[-12%] top-[-12%]', intensity: 22, duration: 12 },
    { size: 'h-[440px] w-[440px]', color: 'bg-[#fff1f6]/84', position: 'right-[-14%] bottom-[-12%]', intensity: 24, duration: 15 },
    { size: 'h-[280px] w-[280px]', color: 'bg-white/70', position: 'right-1/4 top-1/4', intensity: 16, duration: 13 },
  ],
  platform: [
    { size: 'h-[520px] w-[520px]', color: 'bg-[#ffe6ef]/62', position: 'left-[-12%] top-[-16%]', intensity: 20, duration: 12 },
    { size: 'h-[380px] w-[380px]', color: 'bg-[#f4b9c9]/34', position: 'right-[-14%] top-1/3', intensity: 24, duration: 14 },
    { size: 'h-[420px] w-[420px]', color: 'bg-white/70', position: 'bottom-[-16%] left-1/3', intensity: 20, duration: 11 },
  ],
}

interface PanelBackdropProps {
  variant?: BackdropVariant
}

export default function PanelBackdrop({ variant = 'admin' }: PanelBackdropProps) {
  const orbs = variantOrbs[variant]
  const reducedMotion = useReducedMotion()
  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)
  const smoothX = useSpring(mouseX, { damping: 30, stiffness: 110, mass: 0.6 })
  const smoothY = useSpring(mouseY, { damping: 30, stiffness: 110, mass: 0.6 })
  const [enabled, setEnabled] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(max-width: 1024px)').matches || reducedMotion) return
    setEnabled(true)
    const onMove = (e: MouseEvent): void => {
      mouseX.set(e.clientX / window.innerWidth)
      mouseY.set(e.clientY / window.innerHeight)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [mouseX, mouseY, reducedMotion])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#fff7fa]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,220,232,0.75),transparent_34%),radial-gradient(circle_at_92%_8%,rgba(255,255,255,0.95),transparent_36%),linear-gradient(180deg,#fffafb_0%,#fff5f8_52%,#fdf0f5_100%)]" />
      {orbs.map((orb, i) => (
        <OrbLayer
          key={i}
          orb={orb}
          index={i}
          smoothX={smoothX}
          smoothY={smoothY}
          parallaxEnabled={enabled}
          reducedMotion={Boolean(reducedMotion)}
        />
      ))}

      <div className="absolute inset-0 bg-grid opacity-[0.18]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_0%,rgba(255,255,255,0.44)_82%)]" />
      <motion.span
        aria-hidden
        animate={reducedMotion ? { opacity: 0.18 } : { opacity: [0.12, 0.32, 0.12], x: ['-12%', '12%', '-12%'] }}
        transition={reducedMotion ? undefined : { duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-x-0 top-1/4 h-[200px] bg-gradient-to-r from-transparent via-[#ef6f94]/12 to-transparent blur-3xl"
      />
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#efbfd0] to-transparent"
      />
    </div>
  )
}

interface OrbLayerProps {
  orb: OrbConfig
  index: number
  smoothX: ReturnType<typeof useSpring>
  smoothY: ReturnType<typeof useSpring>
  parallaxEnabled: boolean
  reducedMotion: boolean
}

function OrbLayer({ orb, index, smoothX, smoothY, parallaxEnabled, reducedMotion }: OrbLayerProps) {
  const direction = index % 2 === 0 ? 1 : -1
  const dx = useTransform(smoothX, [0, 1], [-orb.intensity * direction, orb.intensity * direction])
  const dy = useTransform(smoothY, [0, 1], [-orb.intensity * direction, orb.intensity * direction])
  return (
    <motion.div
      style={parallaxEnabled ? { x: dx, y: dy } : undefined}
      animate={reducedMotion ? { scale: 1, opacity: 0.86 } : { scale: [1, 1.06, 1], opacity: [0.78, 0.98, 0.78] }}
      transition={reducedMotion ? undefined : { duration: orb.duration, repeat: Infinity, ease: 'easeInOut' }}
      className={`absolute ${orb.position} ${orb.size} rounded-full ${orb.color} blur-[105px]`}
    />
  )
}
