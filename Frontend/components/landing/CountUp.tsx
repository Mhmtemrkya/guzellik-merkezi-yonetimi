'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Görünür olunca hedef sayıya yükselen sayaç.
 *
 * Son değer BAŞLANGIÇ durumudur: script çalışmazsa ya da hareket azaltma açıksa doğru rakam
 * doğrudan görünür. Sayaç yalnızca bir kez, öğe ekrana girdiğinde çalışır.
 */
export default function CountUp({
  value,
  prefix = '',
  suffix = '',
  duration = 1400,
}: {
  value: number
  prefix?: string
  suffix?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()

        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration)
          // easeOutCubic: hızlı başlar, hedefe yumuşak oturur.
          const eased = 1 - Math.pow(1 - p, 3)
          setShown(Math.round(value * eased))
          if (p < 1) frame = requestAnimationFrame(tick)
        }
        setShown(0)
        frame = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value, duration])

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {shown.toLocaleString('tr-TR')}
      {suffix}
    </span>
  )
}
