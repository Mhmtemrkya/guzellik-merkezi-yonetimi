'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { SPRING_PRESS } from './springs'

/** Bileşen DIŞINDA bir kez üretilir: her render'da yeniden üretmek React'e her seferinde
 *  farklı bir bileşen türü gösterir ve ağacı baştan kurdurur. */
const MotionLink = motion.create(Link)

/**
 * BUTON — Apple'ın dokunma sözleşmesi.
 *
 * 1) GERİ BİLDİRİM BASINCA VERİLİR, bırakınca değil. `click` beklemek ölü hissettirir;
 *    doğrudanlık hissi tam burada kazanılır ya da kaybedilir.
 * 2) HAREKET KESİLEBİLİR. Ölçek bir YAY ile sürülür; yay her zaman o anki EKRAN
 *    değerinden başlar, bu yüzden kullanıcı basıp bırakıp yeniden bastığında sıçrama olmaz.
 *    (Sabit süreli bir `transition` bunu yapamaz.)
 * 3) HİSTEREZİS. İşaretçi basılıyken ~10px'ten fazla uzaklaşırsa basış İPTAL olur ve buton
 *    yerine döner; geri gelirse yeniden basılı sayılır. Yanlışlıkla basmaktan çıkış yolu.
 * 4) `setPointerCapture` ile parmak butonun dışına çıksa da izlenir; aksi hâlde buton
 *    basılı kalmış gibi takılır.
 * 5) Hareket azaltma açıkken ölçek hiç değişmez — geri bildirim renk/gölge ile kalır.
 *
 * KIVAM: `bounce: 0` (kritik sönüm). Bir butonun aşması yanlıştır; aşma yalnız kullanıcının
 * kendisi momentum verdiği hareketlere aittir (bkz. springs.ts).
 */

type Tone = 'primary' | 'glass-dark' | 'glass-light' | 'plain'

const TONE: Record<Tone, string> = {
  primary:
    'bg-[#EF6F94] text-white shadow-[0_20px_44px_-18px_rgba(239,111,148,0.95)] hover:shadow-[0_28px_56px_-16px_rgba(239,111,148,1)]',
  'glass-dark': 'material-dark on-material text-white',
  'glass-light': 'material-light on-material text-[#4A3A44]',
  plain: 'text-[#4A3A44] hover:text-[#EF6F94]',
}

export default function PressButton({
  href,
  children,
  tone = 'primary',
  className = '',
  onClick,
  ariaLabel,
}: {
  /** Verilirse bağlantı, verilmezse düğme olarak render edilir. */
  href?: string
  children: ReactNode
  tone?: Tone
  className?: string
  onClick?: () => void
  ariaLabel?: string
}) {
  const reduced = useReducedMotion()
  const [pressed, setPressed] = useState(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const down = useCallback((e: React.PointerEvent<HTMLElement>) => {
    origin.current = { x: e.clientX, y: e.clientY }
    // Parmak/işaretçi öğenin dışına çıksa bile olayları almaya devam et.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setPressed(true)
  }, [])

  const move = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const start = origin.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    // 10px'lik eşik: küçük titremeler basışı bozmaz, gerçek uzaklaşma iptal eder.
    setPressed(Math.hypot(dx, dy) < 10)
  }, [])

  const up = useCallback(() => {
    origin.current = null
    setPressed(false)
  }, [])

  const motionProps = {
    animate: { scale: reduced ? 1 : pressed ? 0.96 : 1 },
    transition: SPRING_PRESS,
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
    onLostPointerCapture: up,
    // Basılıyken renk de bir tık koyulur: hareket azaltma açıkken tek geri bildirim budur.
    style: { filter: pressed ? 'brightness(0.94)' : 'brightness(1)' },
  } as const

  const base =
    'inline-flex select-none items-center justify-center gap-2 rounded-full transition-[filter,box-shadow] duration-200 ' +
    TONE[tone]

  if (href) {
    // Sayfa içi çapa gerçek bir gezinme değildir; Next yönlendiricisinden geçirilmez.
    if (href.startsWith('#')) {
      return (
        <motion.a href={href} aria-label={ariaLabel} className={`${base} ${className}`} {...motionProps}>
          {children}
        </motion.a>
      )
    }
    return (
      <MotionLink href={href} aria-label={ariaLabel} className={`${base} ${className}`} {...motionProps}>
        {children}
      </MotionLink>
    )
  }

  return (
    <motion.button type="button" onClick={onClick} aria-label={ariaLabel} className={`${base} ${className}`} {...motionProps}>
      {children}
    </motion.button>
  )
}
