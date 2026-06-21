'use client'

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useRef, type ReactNode } from 'react'

interface TiltCardProps {
  children: ReactNode
  className?: string
  intensity?: number
  glare?: boolean
}

export default function TiltCard({ children, className = '', intensity = 12, glare = true }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)
  const smx = useSpring(mx, { damping: 18, stiffness: 220 })
  const smy = useSpring(my, { damping: 18, stiffness: 220 })

  const rotateY = useTransform(smx, [0, 1], [-intensity, intensity])
  const rotateX = useTransform(smy, [0, 1], [intensity, -intensity])
  const glareX = useTransform(smx, [0, 1], ['0%', '100%'])
  const glareY = useTransform(smy, [0, 1], ['0%', '100%'])
  const glareBackground = useTransform(
    [glareX, glareY],
    ([px, py]) =>
      `radial-gradient(420px circle at ${px as string} ${py as string}, rgba(255,244,248,0.22), transparent 55%)`,
  )

  const handleMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width)
    my.set((e.clientY - r.top) / r.height)
  }
  const reset = (): void => {
    mx.set(0.5)
    my.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ rotateY, rotateX, transformStyle: 'preserve-3d', transformPerspective: 1200 }}
      className={`relative ${className}`}
    >
      <div style={{ transform: 'translateZ(40px)' }} className="relative h-full w-full">
        {children}
      </div>
      {glare && (
        <motion.div
          aria-hidden
          style={{ background: glareBackground }}
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
        />
      )}
    </motion.div>
  )
}
