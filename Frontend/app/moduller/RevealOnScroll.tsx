'use client'

import { useEffect } from 'react'

/**
 * Modül kataloğunda kaydırınca belirme (tanıtım sayfası; animate tarifi: IntersectionObserver, BİR KEZ).
 * `[data-reveal]` öğeleri görünüme girince `data-visible` alır. JS çalışmazsa ya da azaltılmış hareket açıksa
 * içerik baştan görünür: gizleme yalnız bu bileşen kökü `data-reveal-ready` ile işaretleyince devreye girer.
 */
export default function RevealOnScroll({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.setAttribute('data-visible', '')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -80px 0px' },
    )
    // Zaten ekranda olanlar gizlenip yeniden belirmesin: ilk karede görünür olanları hemen işaretle.
    const fold = window.innerHeight
    for (const el of targets) {
      if (el.getBoundingClientRect().top < fold) el.setAttribute('data-visible', '')
      else observer.observe(el)
    }
    root.setAttribute('data-reveal-ready', '')
    return () => {
      observer.disconnect()
      root.removeAttribute('data-reveal-ready')
    }
  }, [rootId])

  return null
}
