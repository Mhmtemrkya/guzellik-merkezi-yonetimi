'use client'

import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Lock, Sparkles, ArrowUpRight } from 'lucide-react'
import { useFeatureContext } from './FeatureContext'
import type { FeatureKey } from '@/lib/types'

interface FeatureGateProps {
  /** Tek özellik. */
  feature?: FeatureKey
  /** Bunlardan en az biri varsa açık. */
  anyOf?: FeatureKey[]
  /** Hepsi varsa açık. */
  allOf?: FeatureKey[]
  children: ReactNode
  /**
   * Kilitliyken davranış:
   *  - 'hide' (varsayılan): hiçbir şey gösterme — buton/sekme/satır gizlemek için.
   *  - 'notice': "paketinizde yok" premium bilgilendirme kartı — sayfa guard'ı için.
   */
  mode?: 'hide' | 'notice'
  /** mode='notice' için başlık. */
  title?: string
  /** mode='notice' için açıklama. */
  description?: string
  /** Kilitliyken gösterilecek tamamen özel içerik (mode'u geçersiz kılar). */
  fallback?: ReactNode
}

export function useFeatureAllowed(args: { feature?: FeatureKey; anyOf?: FeatureKey[]; allOf?: FeatureKey[] }): boolean {
  const ctx = useFeatureContext()
  if (args.feature && !ctx.has(args.feature)) return false
  if (args.anyOf && args.anyOf.length > 0 && !ctx.hasAny(...args.anyOf)) return false
  if (args.allOf && args.allOf.length > 0 && !ctx.hasAll(...args.allOf)) return false
  return true
}

export default function FeatureGate({
  feature,
  anyOf,
  allOf,
  children,
  mode = 'hide',
  title,
  description,
  fallback,
}: FeatureGateProps) {
  const allowed = useFeatureAllowed({ feature, anyOf, allOf })
  if (allowed) return <>{children}</>
  if (fallback !== undefined) return <>{fallback}</>
  if (mode === 'notice') {
    return <FeatureLockedNotice title={title} description={description} />
  }
  return null
}

export function FeatureLockedNotice({ title, description }: { title?: string; description?: string }) {
  return (
    <div className="relative flex min-h-[60vh] items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-lg overflow-hidden border border-[#efbfd0]/75 bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] p-8 text-center shadow-[0_32px_84px_-48px_rgba(150,78,104,0.58)]"
      >
        <motion.span
          aria-hidden
          animate={{ opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[#f0aac2]/18 blur-3xl"
        />
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.04]" />

        <div className="relative mx-auto grid h-14 w-14 place-items-center border border-[#efbfd0]/75 bg-white text-[#c85776] shadow-[0_0_28px_rgba(240,170,194,0.35)]">
          <Lock className="h-5 w-5 text-[#c85776]" strokeWidth={1.6} />
        </div>

        <div className="relative mt-5 inline-flex items-center gap-1.5 border border-[#efbfd0]/75 bg-[#f0aac2]/10 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.22em] text-[#c85776]">
          <Sparkles className="h-3 w-3" /> Pakete dahil değil
        </div>

        <h2 className="relative mt-3 font-display text-2xl tracking-tight text-[#352432]">
          {title || 'Bu özellik mevcut paketinizde bulunmuyor'}
        </h2>
        <p className="relative mt-2 text-[12.5px] leading-relaxed text-[#352432]/60">
          {description ||
            'Bu modülü kullanmak için kurumunuzun aboneliğini bu özelliği içeren bir pakete yükseltmeniz gerekir. Detaylar için sistem yöneticinizle iletişime geçin.'}
        </p>

        <div className="relative mt-6 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <ArrowUpRight className="h-3.5 w-3.5" /> Paket yükseltme gerektirir
        </div>
      </motion.div>
    </div>
  )
}
