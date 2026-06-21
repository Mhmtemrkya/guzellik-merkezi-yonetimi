'use client'

import { animate, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  value: number
  duration?: number
  format?: (n: number) => string
  separator?: string
  decimals?: number
  className?: string
}

function defaultFormat(n: number, decimals: number, separator: string): string {
  const fixed = n.toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const withSep = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return decPart ? `${withSep},${decPart}` : withSep
}

/**
 * AnimatedNumber — counts up to `value` when scrolled into view.
 * If `format` provided, it overrides the default thousand-separator format.
 */
export default function AnimatedNumber({
  value,
  duration = 1.4,
  format,
  separator = '.',
  decimals = 0,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const inView = useInView(ref, { amount: 0.3, once: false })
  const [display, setDisplay] = useState<number>(0)
  const lastValue = useRef<number>(0)

  useEffect(() => {
    if (!inView) return
    const from = lastValue.current
    const to = value
    const controls = animate(from, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    lastValue.current = to
    return () => controls.stop()
  }, [value, duration, inView])

  const text = format ? format(display) : defaultFormat(display, decimals, separator)
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
