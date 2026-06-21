'use client'

import { animate, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

function format(value: number, decimals: number, separator: string): string {
  const fixed = Number(value).toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const withSep = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return decPart ? `${withSep},${decPart}` : withSep
}

interface AnimatedCounterProps {
  to: number
  duration?: number
  prefix?: string
  suffix?: string
  decimals?: number
  separator?: string
}

export default function AnimatedCounter({
  to,
  duration = 1.6,
  prefix = '',
  suffix = '',
  decimals = 0,
  separator = '.',
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const [value, setValue] = useState<number>(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v: number) => setValue(v),
    })
    return controls.stop
  }, [inView, to, duration])

  return (
    <span ref={ref}>
      {prefix}
      {format(value, decimals, separator)}
      {suffix}
    </span>
  )
}
