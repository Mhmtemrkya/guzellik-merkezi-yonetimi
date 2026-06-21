'use client'

import { motion, type Variants } from 'framer-motion'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface StatCardProps {
  label: string
  value: ReactNode
  delta?: string
  icon: LucideIcon
  index?: number
  accent?: 'rose' | 'gold' | 'copper' | 'neutral'
  className?: string
  href?: string
}

const accentGlow: Record<NonNullable<StatCardProps['accent']>, string> = {
  rose: 'from-[#ffdce8]/75 via-[#fff0f5]/55 to-transparent',
  gold: 'from-[#ffe7ef]/80 via-[#fff6f9]/58 to-transparent',
  copper: 'from-[#f3d5df]/78 via-[#fff2f6]/55 to-transparent',
  neutral: 'from-[#fff6f9]/80 via-white/70 to-transparent',
}

const iconTone: Record<NonNullable<StatCardProps['accent']>, string> = {
  rose: 'border-[#f4b9c9] bg-[#fff0f5] text-[#c85776]',
  gold: 'border-[#f0c8d5] bg-[#fff5f8] text-[#b75b74]',
  copper: 'border-[#e6bdca] bg-[#fff2f6] text-[#9d526b]',
  neutral: 'border-[#ead8df] bg-white text-[#7a5a68]',
}

const miniBarTone: Record<NonNullable<StatCardProps['accent']>, string> = {
  rose: 'from-[#ffdce8] to-[#ef6f94]',
  gold: 'from-[#fff0f5] to-[#d65f83]',
  copper: 'from-[#f2d0dc] to-[#b46b82]',
  neutral: 'from-[#f7edf2] to-[#9f8190]',
}

export const statGridContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] } },
}

const sparkBars = [32, 48, 38, 62, 76]

export default function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  index = 0,
  accent = 'gold',
  className = '',
  href,
}: StatCardProps) {
  const content = (
    <>
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-gradient-to-br ${accentGlow[accent]} blur-3xl opacity-90 transition-opacity duration-500 group-hover:opacity-100`}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#f0b8c9] to-transparent opacity-80"
      />

      <div className="relative flex items-start justify-between gap-4">
        <motion.span
          whileHover={{ scale: 1.06, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 360, damping: 20 }}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border shadow-[0_10px_24px_-18px_rgba(190,91,125,0.8)] ${iconTone[accent]}`}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.65} />
        </motion.span>
        <div className="flex h-11 items-end gap-1.5 opacity-80" aria-hidden>
          {sparkBars.map((height, barIndex) => (
            <span
              key={`${index}-${barIndex}`}
              className={`w-1.5 rounded-full bg-gradient-to-t ${miniBarTone[accent]}`}
              style={{ height: `${Math.max(18, height - index * 3 + barIndex * 2)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="relative mt-5 text-[12px] font-semibold leading-5 text-[#6a4f5c]">
        {label}
      </div>
      <div className="relative mt-1.5 armo-stat-value text-[34px] leading-none lg:text-[40px]">
        {value}
      </div>
      {delta && (
        <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1 text-[11px] font-semibold text-[#a84f69]">
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
          {delta}
        </div>
      )}
    </>
  )

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`armo-card armo-card-luxury armo-lift group p-5 lg:p-6 ${className}`}
    >
      {href ? (
        <a href={href} className="block">
          {content}
        </a>
      ) : (
        content
      )}
    </motion.div>
  )
}
