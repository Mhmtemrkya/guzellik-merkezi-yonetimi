'use client'

import { motion } from 'framer-motion'
import { useId } from 'react'

export type SparkTone = 'rose' | 'emerald' | 'amber' | 'violet'

const toneStops: Record<SparkTone, { from: string; mid: string; to: string; fill: string }> = {
  rose: { from: '#f7b6cb', mid: '#ef6f94', to: '#d65f83', fill: '#f7b6cb' },
  emerald: { from: '#a7f3d0', mid: '#34d399', to: '#10b981', fill: '#6ee7b7' },
  amber: { from: '#fcd97a', mid: '#fbbf24', to: '#f59e0b', fill: '#fde2a7' },
  violet: { from: '#ddd0fb', mid: '#a78bfa', to: '#8b5cf6', fill: '#c4b5fd' },
}

interface SparklineProps {
  points: number[]
  tone?: SparkTone
  /** 'line' (varsayılan) ince çizgi; 'bars' minik dikey bar grafiği */
  variant?: 'line' | 'bars'
  /** line varyantında her noktada işaretçi nokta gösterir */
  dots?: boolean
  width?: number
  height?: number
  className?: string
}

/** İnce, çizgi/bar tarzı sparkline — kart köşelerinde trend hissi verir. Tona göre renklenir. */
export default function Sparkline({
  points,
  tone = 'rose',
  variant = 'line',
  dots = false,
  width = 78,
  height = 32,
  className,
}: SparklineProps) {
  const uid = useId().replace(/:/g, '')
  const w = width
  const h = height
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const c = toneStops[tone]
  const cls = className ?? 'h-8 w-[78px] overflow-visible'

  if (variant === 'bars') {
    const n = points.length
    const gap = 3
    const barW = (w - gap * (n - 1)) / n
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className={cls} aria-hidden>
        <defs>
          <linearGradient id={`sb-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.mid} />
            <stop offset="100%" stopColor={c.fill} />
          </linearGradient>
        </defs>
        {points.map((p, i) => {
          const norm = (p - min) / range
          const bh = 4 + norm * (h - 7)
          const x = i * (barW + gap)
          const y = h - bh
          return (
            <motion.rect
              key={i}
              x={x}
              width={barW}
              rx={1.6}
              fill={`url(#sb-${uid})`}
              initial={{ height: 0, y: h }}
              animate={{ height: bh, y }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.15 + i * 0.05 }}
            />
          )
        })}
      </svg>
    )
  }

  const step = w / Math.max(points.length - 1, 1)
  const coords = points.map((p, i) => ({ x: i * step, y: h - 5 - ((p - min) / range) * (h - 12) }))
  const line = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cls} aria-hidden>
      <defs>
        <linearGradient id={`sl-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={c.from} />
          <stop offset="58%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.to} />
        </linearGradient>
        <linearGradient id={`sf-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.fill} stopOpacity="0.34" />
          <stop offset="100%" stopColor={c.fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sf-${uid})`} />
      <motion.path
        d={line}
        fill="none"
        stroke={`url(#sl-${uid})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
      />
      {dots &&
        coords.map((pt, i) => (
          <motion.circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={1.9}
            fill={c.mid}
            stroke="#fff"
            strokeWidth={1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.55 + i * 0.05 }}
          />
        ))}
    </svg>
  )
}
