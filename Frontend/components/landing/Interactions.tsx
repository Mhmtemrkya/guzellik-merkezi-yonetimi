'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ==================================================================
   TANITIM SAYFASI ETKİLEŞİM KATMANI
   Hepsi ilerici zenginleştirme: script çalışmazsa içerik/eylem aynen kalır.
   ================================================================== */

/**
 * Sayfanın üstünde ince okuma ilerlemesi çubuğu.
 * Kaydırma konumunu `scroll` yerine rAF ile okur — her olayda düzen hesabı yapmaz.
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const update = () => {
      frame = 0
      const el = ref.current
      if (!el) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0
      el.style.transform = `scaleX(${p})`
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]">
      <div
        ref={ref}
        className="h-full origin-left bg-gradient-to-r from-[#EF6F94] to-[#8E3F5B]"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  )
}

/**
 * İmleci takip eden yumuşak ışık — kartın üzerinde gezinirken yüzey canlanır.
 * Konum CSS değişkenine yazılır; React yeniden render edilmez (her mousemove'da render pahalıdır).
 */
export function Spotlight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <div ref={ref} onMouseMove={onMove} className={`spotlight ${className}`}>
      {children}
    </div>
  )
}

/**
 * Mıknatıs buton: imleç yaklaştıkça butonu hafifçe kendine çeker.
 * Yalnız ince işaretleyicide (fare) çalışır — dokunmatikte anlamsız ve rahatsız edici olur.
 */
export function Magnetic({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setEnabled(
      window.matchMedia('(pointer: fine)').matches &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )
  }, [])

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    const strength = 0.28
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      // Yalnız yakın çevrede tepki ver; uzakta sayfa boyunca titreşim olmasın.
      const near = Math.abs(dx) < r.width * 1.4 && Math.abs(dy) < r.height * 2.6
      el.style.transform = near ? `translate(${dx * strength}px, ${dy * strength}px)` : 'translate(0,0)'
    }
    const reset = () => { el.style.transform = 'translate(0,0)' }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseleave', reset)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', reset)
    }
  }, [enabled])

  return (
    <span ref={ref} className={`inline-block will-change-transform transition-transform duration-200 ease-out ${className}`}>
      {children}
    </span>
  )
}

/**
 * Başlığı KELİME KELİME açar: her kelime alt maskeden yükselir.
 * Harf harf değil — Türkçede harf animasyonu okumayı bozar, kelime ritmi doğal durur.
 */
export function WordReveal({ text, className = '', delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(' ')
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden align-bottom">
          <span
            className="word-rise inline-block"
            style={{ animationDelay: `${delay + i * 70}ms` }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        </span>
      ))}
    </span>
  )
}
