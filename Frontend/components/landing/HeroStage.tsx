'use client'

import { useRef, type ReactNode } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type Variants } from 'framer-motion'

/**
 * HERO SAHNESİ — kaydırmaya bağlı 3B açılış.
 *
 * Ürün ekranı sahneye YATIK girer (perspektifte geriye devrilmiş) ve kaydırma ilerledikçe
 * doğrulup öne gelir. Amaç süs değil: ziyaretçi daha ilk saniyede paneli "masaya konulmuş"
 * gibi görür, sonra karşısına dikilir.
 *
 * Motion'un önerdiği kurulum kullanılır (bkz. motion.dev/docs/scroll):
 *   · `useScroll({ target, offset })` → hedefin görüş alanındaki ilerlemesi
 *   · `useSpring(..., { skipInitialAnimation: true })` → ilerlemeyi yumuşat; mount anında
 *     değer 0'dan zıplamasın diye ilk animasyon atlanır
 *   · `useTransform` → ilerlemeyi açı/ölçek/opaklığa çevir
 *
 * Hareket azaltma açıksa sahne düz ve sabit gösterilir.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    // Sahne ekranın altından girerken başla, üst ortaya gelince tamamla.
    offset: ['start 88%', 'start 26%'],
  })

  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    restDelta: 0.001,
    skipInitialAnimation: true,
  })

  const rotateX = useTransform(progress, [0, 1], [26, 0])
  const scale = useTransform(progress, [0, 1], [0.9, 1])
  const y = useTransform(progress, [0, 1], [56, 0])
  const opacity = useTransform(progress, [0, 0.45], [0.5, 1])
  const glow = useTransform(progress, [0, 1], [0.15, 0.5])

  if (reduced) {
    return (
      <div ref={ref} className="relative">
        {children}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative" style={{ perspective: '1400px' }}>
      {/* Sahnenin altındaki ışık — ekran doğruldukça güçlenir. */}
      <motion.div
        aria-hidden
        style={{ opacity: glow }}
        className="pointer-events-none absolute -inset-x-10 bottom-[-6%] h-40 rounded-[50%] bg-[#EF6F94]/35 blur-[70px]"
      />
      <motion.div
        style={{ rotateX, scale, y, opacity, transformOrigin: '50% 100%', willChange: 'transform' }}
      >
        {children}
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Başlığı kelime kelime açar — Motion'un variant orkestrasyonuyla.
 *
 * `delayChildren: stagger(...)` yerine `staggerChildren` kullanılır: proje Framer Motion 12
 * ile geliyor ve bu alan her iki sürümde de aynı davranır. Harf harf değil KELİME kelime:
 * Türkçede harf animasyonu okumayı bozar, kelime ritmi doğal durur.
 */
export function HeroWords({
  text,
  className = '',
  delay = 0,
}: {
  text: string
  className?: string
  delay?: number
}) {
  const reduced = useReducedMotion()
  const words = text.split(' ')

  if (reduced) return <span className={className}>{text}</span>

  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.075, delayChildren: delay } },
  }

  const word: Variants = {
    hidden: { y: '108%', opacity: 0 },
    visible: {
      y: '0%',
      opacity: 1,
      transition: { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 },
    },
  }

  return (
    <motion.span variants={container} initial="hidden" animate="visible" className={className}>
      {words.map((w, i) => (
        // Dış span maskedir: kelime alttan yükselirken satırın dışına taşmaz.
        <span key={`${w}-${i}`} className="inline-block overflow-hidden align-bottom pb-[0.08em]">
          <motion.span variants={word} className="inline-block">
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </motion.span>
  )
}
