'use client'

import { useId } from 'react'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

/**
 * Animasyonlu seans ilerleme halkası. Dolan kısım kullanılan seansı, merkez kalan seansı gösterir.
 * Seanslar bitince yeşil tik. Müşteri seans kartında her hizmet için bir halka çizilir.
 */
export default function SessionProgressRing({
  remaining,
  total,
  size = 58,
  stroke = 6,
}: {
  remaining: number
  total: number
  size?: number
  stroke?: number
}) {
  const uid = useId()
  const safeTotal = Math.max(1, total)
  const used = Math.min(safeTotal, Math.max(0, safeTotal - remaining))
  const pct = used / safeTotal
  const done = remaining <= 0
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={done ? '#34d399' : '#ee789a'} />
            <stop offset="100%" stopColor={done ? '#10b981' : '#f5abc0'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3e3ea" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#grad-${uid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {done ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 18, delay: 0.6 }}
            className="grid h-6 w-6 place-items-center rounded-full bg-emerald-50 text-emerald-600"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
          </motion.span>
        ) : (
          <div className="text-center leading-none">
            <div className="font-display text-[17px] tabular-nums text-[#c85776]">{remaining}</div>
            <div className="text-[8px] font-mono tracking-wide text-[#352432]/40">/ {total}</div>
          </div>
        )}
      </div>
    </div>
  )
}
