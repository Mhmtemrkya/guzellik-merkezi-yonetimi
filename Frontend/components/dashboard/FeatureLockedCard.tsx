'use client'

import { Lock, Sparkles } from 'lucide-react'

/** Paket dahilinde olmayan özellikler için kilitli/upsell kartı (kuruma özelliği tanıtır). */
export default function FeatureLockedCard({ title, message }: { title: string; message?: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-[#e6c9d4] bg-gradient-to-br from-[#fffafb] to-[#fff1f6]/50 p-4">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/60">
        <Lock className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="mt-2 text-[12px] leading-5 text-[#352432]/55">
        {message ?? 'Bu özellik mevcut paketinizde yok.'}
      </div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#efbfd0] bg-white/70 px-2 py-1 text-[10.5px] font-semibold text-[#b14d6c]">
        <Sparkles className="h-3 w-3" /> Üst pakete geçerek kullanılabilir
      </div>
    </div>
  )
}
