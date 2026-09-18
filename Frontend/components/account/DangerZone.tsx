'use client'

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * TEHLİKELİ İŞLEM KABUĞU — geri alınamaz işlemlerin ortak çerçevesi.
 *
 * <p>
 * Ayrı bir kabuk olmasının sebebi görsel değil DAVRANIŞSALDIR: bu blok ayarların geri kalanından
 * ayrı durur, kendi rengini taşır ve hiçbir zaman "kaydet" akışının parçası olmaz. Silme
 * düğmesini sıradan ayarların arasına koymak, kaydet refleksiyle basılmasına davetiye çıkarırdı.
 * </p>
 */
export default function DangerZone({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-rose-200/[0.85] bg-gradient-to-br from-rose-50/[0.70] via-white to-white shadow-[0_18px_50px_-40px_rgba(190,40,80,0.55)]">
      <header className="flex items-start gap-3 border-b border-rose-200/[0.70] bg-rose-50/[0.55] px-5 py-4">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-200 bg-white text-rose-600">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-rose-900">{title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-rose-800/[0.80]">{description}</p>
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

export const dangerLabelCls =
  'mb-1.5 block text-[10px] font-mono uppercase tracking-[0.2em] text-rose-900/[0.60]'

export const dangerFieldCls =
  'min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3.5 text-[13px] text-[#352432] outline-none transition-colors placeholder:text-[#352432]/[0.30] focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.10)]'
