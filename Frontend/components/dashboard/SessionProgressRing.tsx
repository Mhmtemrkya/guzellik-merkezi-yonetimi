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
            className="grid place-items-center rounded-full bg-emerald-50 text-emerald-600"
            style={{ width: size * 0.42, height: size * 0.42 }}
          >
            <Check style={{ width: size * 0.26, height: size * 0.26 }} strokeWidth={2.6} />
          </motion.span>
        ) : (
          /* Punto halka boyuna göre ölçeklenir: kompakt ızgarada (44px) sabit 17px taşıyordu. */
          <div className="text-center leading-none">
            <div className="font-display tabular-nums text-[#c85776]" style={{ fontSize: Math.max(12, size * 0.3) }}>{remaining}</div>
            <div className="tracking-wide text-[#705a66]" style={{ fontSize: Math.max(9, size * 0.17) }}>/ {total}</div>
          </div>
        )}
      </div>
    </div>
  )
}
