'use client'

import { ChevronsDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import styles from './ScrollHint.module.css'

/**
 * "Lütfen kaydırın" işareti (kullanıcı isteği 23 Kas 2026: "scroll'lu yerlere kaydırın ibaresi koy, fare ile").
 * `data-scroll-hint` ile işaretlenmiş kaydırma izleri ekrana sabitlenip ilerlerken alt ortada belirir; izin ilk yarısı geçilince
 * ya da iz kaydırmalı değilse (azaltılmış hareket, kısa ekran → iz ekrandan kısa) görünmez. Tek işaret, bütün izler için.
 */
const SHOW_UNTIL = 0.55

export default function ScrollHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      // Azaltılmış harekette sahneler kaydırmayla oynamaz (düz düzen): işaret gerekmez.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setVisible(false)
        return
      }
      const vh = window.innerHeight
      let show = false
      document.querySelectorAll<HTMLElement>('[data-scroll-hint]').forEach((el) => {
        const rect = el.getBoundingClientRect()
        // Kaydırmalı iz ekrandan belirgin biçimde uzundur; değilse (düz düzen) işaret gerekmez.
        if (rect.height < vh * 1.2) return
        const start = vh * 0.3
        if (rect.top > start || rect.bottom < vh) return
        const progress = (start - rect.top) / Math.max(1, rect.height - vh + start)
        if (progress < SHOW_UNTIL) show = true
      })
      setVisible(show)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return (
    <div className={styles.hint} data-visible={visible || undefined} aria-hidden="true">
      <span className={styles.mouse}><i /></span>
      <ChevronsDown className={styles.touch} size={18} strokeWidth={2.2} />
      Lütfen kaydırın
    </div>
  )
}
