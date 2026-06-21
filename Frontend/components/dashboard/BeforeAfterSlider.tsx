'use client'

import { useCallback, useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

/**
 * Önce/Sonra karşılaştırma kaydırıcısı. İki katman tam boyutta üst üste durur; üstteki "önce"
 * görseli clip-path ile soldan açılır → sürükledikçe "sonra" ortaya çıkar. Görseller ölçeklenmez,
 * hizalı kalır. Fare + dokunma (pointer events) desteklenir.
 */
export default function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Önce',
  afterLabel = 'Sonra',
}: {
  beforeUrl: string
  afterUrl: string
  beforeLabel?: string
  afterLabel?: string
}) {
  const [pos, setPos] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const moveTo = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.max(0, Math.min(100, pct)))
  }, [])

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        moveTo(e.clientX)
      }}
      onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      className="group relative aspect-[4/3] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[18px] border border-[#ead8df] bg-[#1c1016] shadow-[0_24px_60px_-44px_rgba(142,63,91,0.7)]"
    >
      {/* Alt katman: SONRA (tam) */}
      <img src={afterUrl} alt={afterLabel} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      {/* Üst katman: ÖNCE (soldan clip) */}
      <img
        src={beforeUrl}
        alt={beforeLabel}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      {/* Etiketler */}
      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
        {afterLabel}
      </span>

      {/* Ayraç + tutamaç */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -translate-x-1/2 border-l-2 border-white/90" />
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-white/95 text-[#b14d6c] shadow-lg transition-transform group-active:scale-95">
          <MoveHorizontal className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}
