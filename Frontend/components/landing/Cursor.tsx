'use client'

import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useEffect, useState } from 'react'

export default function Cursor() {
  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const sx = useSpring(x, { damping: 22, stiffness: 320, mass: 0.4 })
  const sy = useSpring(y, { damping: 22, stiffness: 320, mass: 0.4 })
  const [label, setLabel] = useState<string>('')
  const [hover, setHover] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(max-width: 1024px)').matches) return
    document.body.classList.add('cursor-hidden')

    const onMove = (e: MouseEvent): void => {
      x.set(e.clientX)
      y.set(e.clientY)
      const target = e.target as HTMLElement | null
      const interactive = target?.closest('[data-cursor], a, button, input, textarea, [role="button"]') as
        | HTMLElement
        | null
      const lbl = interactive?.dataset?.cursor || ''
      setLabel(lbl)
      setHover(Boolean(interactive))
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.body.classList.remove('cursor-hidden')
    }
  }, [x, y])

  return (
    <>
      <motion.div
        className="cursor-dot pointer-events-none fixed left-0 top-0 z-[120] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff4f8] mix-blend-difference"
        style={{ x: sx, y: sy }}
      />
      <motion.div
        className="cursor-ring pointer-events-none fixed left-0 top-0 z-[119] flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#f0aac2]/65 bg-[#160b12]/22 text-[9px] font-bold uppercase tracking-[0.2em] text-[#ffd3df] backdrop-blur-sm"
        style={{ x: sx, y: sy, scale: hover ? 1.6 : 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 180 }}
      >
        {label && <span className="whitespace-nowrap px-2">{label}</span>}
      </motion.div>
    </>
  )
}
