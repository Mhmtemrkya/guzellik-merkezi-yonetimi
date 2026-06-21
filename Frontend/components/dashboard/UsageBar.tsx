'use client'

import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import type { UsageMetric } from '@/lib/types'

/**
 * Tek metrik için kullanım barı. Renk eşiklerine göre kademeli:
 *  - %0-79  : rose-pink (normal)
 *  - %80-99 : amber (uyarı)
 *  - %100+  : rose-red (limit dolu/aşmış)
 */
export function UsageBar({
  metric,
  icon: Icon,
  compact = false,
}: {
  metric: UsageMetric
  icon?: LucideIcon
  compact?: boolean
}) {
  const { used, limit, percent, isUnlimited, isOver, isWarning, label } = metric

  const trackTone = isOver
    ? 'bg-rose-400/12 border-rose-300/30'
    : isWarning
      ? 'bg-amber-400/10 border-amber-300/25'
      : 'bg-[#fff4f8]/[0.04] border-[#ead8df]/70'
  const barTone = isOver
    ? 'bg-gradient-to-r from-rose-400 to-rose-300'
    : isWarning
      ? 'bg-gradient-to-r from-amber-400 to-amber-300'
      : 'bg-gradient-to-r from-[#f0aac2] to-[#ffd3df]'
  const textTone = isOver ? 'text-rose-700' : isWarning ? 'text-amber-700' : 'text-[#c85776]'

  return (
    <div className={`border ${trackTone} ${compact ? 'px-2.5 py-2' : 'p-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/55">
          {Icon && <Icon className="h-3 w-3" strokeWidth={1.6} />}
          {label}
        </div>
        <div className={`font-mono text-[10px] tabular-nums ${textTone}`}>
          {isUnlimited ? `${used.toLocaleString('tr-TR')} / ∞` : `${used.toLocaleString('tr-TR')} / ${limit.toLocaleString('tr-TR')}`}
        </div>
      </div>
      <div className={`relative mt-1.5 h-1.5 overflow-hidden bg-white/82 ${isUnlimited ? 'opacity-40' : ''}`}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${isUnlimited ? 10 : Math.min(percent, 100)}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className={`h-full ${barTone}`}
        />
      </div>
      {!compact && (
        <div className="mt-1 text-right text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">
          {isUnlimited ? 'sınırsız' : `${percent}%`}
          {isOver && <span className="ml-1 text-rose-700">· aşıldı</span>}
          {isWarning && <span className="ml-1 text-amber-700">· sınıra yakın</span>}
        </div>
      )}
    </div>
  )
}
