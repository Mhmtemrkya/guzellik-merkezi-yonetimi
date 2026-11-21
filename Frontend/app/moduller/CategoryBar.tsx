'use client'

import { useEffect, useState } from 'react'
import styles from './ModulesPage.module.css'

type Item = { id: string; title: string; count: number; tone: string }

/**
 * Modül kategorileri için yapışkan çubuk. Kaydırınca bulunulan bölüm vurgulanır (durum gösterimi).
 * Bağlantılar düz `#` çapalarıdır: JS olmadan da çalışır; vurgu yalnız ek bilgidir.
 */
export default function CategoryBar({ items }: { items: Item[] }) {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const sections = items
      .map(item => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return

    const inBand = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id)
          else inBand.delete(entry.target.id)
        }
        const current = sections.find(section => inBand.has(section.id))
        if (current) {
          setActive(current.id)
          return
        }
        // Şeritte bölüm yoksa: ilk bölümün üstündeysek (katalog başı) vurgu kalkar; bölümler arasındaysak son vurgu kalır.
        if (sections[0].getBoundingClientRect().top > window.innerHeight * 0.4) setActive(null)
      },
      // Ekranın orta şeridine giren bölüm etkin sayılır.
      { rootMargin: '-40% 0px -55% 0px' },
    )
    sections.forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [items])

  return (
    <nav className={styles.categoryBar} aria-label="Modül kategorileri">
      <ul>
        {items.map(item => (
          <li key={item.id} data-tone={item.tone}>
            <a href={`#${item.id}`} aria-current={active === item.id ? 'true' : undefined}>
              <span className={styles.toneDot} aria-hidden="true" />
              {item.title}
              <span className={styles.count}>{item.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
