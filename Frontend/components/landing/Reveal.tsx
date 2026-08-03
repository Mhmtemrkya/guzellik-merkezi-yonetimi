'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/** Sarmalayıcı olarak kullanılabilecek etiketler (liste öğesi gerektiğinde `li`). */
type RevealTag = 'div' | 'li' | 'section' | 'article'

/**
 * Kaydırmayla ortaya çıkma sarmalayıcısı.
 *
 * İLERİCİ ZENGİNLEŞTİRME: gizleme CSS'i yalnız `<html class="landing-js">` varken uygulanır ve o
 * sınıfı bu bileşen ekler. Script hiç çalışmazsa içerik olduğu gibi görünür kalır — animasyon
 * kütüphanesi devreye girmediğinde bölümlerin opacity:0'da takılıp sayfanın boş görünmesi
 * sorunu bu yüzden yaşanmaz.
 */
export default function Reveal({
  children,
  as = 'div',
  delay = 0,
  className = '',
}: {
  children: ReactNode
  as?: RevealTag
  /** Sıralı görünme için gecikme (ms). Kart ızgaralarında 60–90ms aralık iyi sonuç verir. */
  delay?: number
  className?: string
}) {
  // Tek bir ref tipiyle çalışmak için etiket `div` gibi ele alınır; DOM API'leri aynıdır.
  const Tag = as as 'div'
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('landing-js')
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // IntersectionObserver yoksa (çok eski tarayıcı) içeriği hemen göster.
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target) // bir kez görünür, geri gizlenmez
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  )
}
