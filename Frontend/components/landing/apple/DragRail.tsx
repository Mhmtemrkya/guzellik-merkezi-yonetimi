'use client'

import { animate } from 'framer-motion'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SPRING_THROW, projectMomentum } from './springs'

/**
 * SÜRÜKLENEN RAY — parmağın gittiği yere giden yatay şerit.
 *
 * TEMEL YEREL KAYDIRMADIR (`overflow-x: auto` + scroll-snap). Bunun iki nedeni var:
 *   · JavaScript çalışmasa da şerit kaydırılabilir kalır; hiçbir kart erişilemez olmaz.
 *   · Dokunmatikte 1:1 takip, momentum ve lastik kenar zaten İŞLETİM SİSTEMİNDEN gelir;
 *     onu JS ile taklit etmek her zaman daha kötü olur.
 *
 * ÜSTÜNE eklenen katman yalnız İNCE İŞARETÇİ (fare) içindir — farede yerel yatay kaydırma
 * yoktur, dolayısıyla Apple'ın jest sözleşmesi burada elle kurulur:
 *   · 1:1 TAKİP — içerik parmağa yapışır, yakalandığı noktadaki fark korunur.
 *   · HIZ GEÇİŞİ — bırakma anındaki hız, yayın BAŞLANGIÇ HIZI olarak devredilir; sürükleme
 *     ile animasyon arasında dikiş görünmez.
 *   · MOMENTUM İZDÜŞÜMÜ — bırakılan yere değil, hızın TAŞIYACAĞI yere en yakın karta oturur.
 *     Küçük bir fiske büyük bir sonuç üretir.
 *   · Sınırda yerel kaydırma zaten kelepçelenir; lastik his dokunmatikte OS'tan gelir.
 *
 * Hareket azaltma açıkken yay yerine anında konumlanır.
 */
export default function DragRail({
  children,
  label,
  className = '',
}: {
  children: ReactNode
  /** Ekran okuyucu için şeridin ne olduğu. */
  label: string
  className?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [fine, setFine] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const drag = useRef<{
    pointerId: number
    startX: number
    startScroll: number
    samples: { x: number; t: number }[]
  } | null>(null)

  useEffect(() => {
    setFine(window.matchMedia('(pointer: fine)').matches)
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  const syncEdges = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    syncEdges()
    const el = scroller.current
    if (!el) return
    el.addEventListener('scroll', syncEdges, { passive: true })
    window.addEventListener('resize', syncEdges)
    return () => {
      el.removeEventListener('scroll', syncEdges)
      window.removeEventListener('resize', syncEdges)
    }
  }, [syncEdges])

  /** Verilen konuma en yakın kart başlangıcı. */
  const snapTarget = (el: HTMLElement, desired: number) => {
    const items = Array.from(el.children[0]?.children ?? []) as HTMLElement[]
    if (items.length === 0) return desired
    const railLeft = el.getBoundingClientRect().left + el.scrollLeft
    let best = desired
    let bestDist = Infinity
    for (const item of items) {
      const offset = item.getBoundingClientRect().left + el.scrollLeft - railLeft
      const dist = Math.abs(offset - desired)
      if (dist < bestDist) {
        bestDist = dist
        best = offset
      }
    }
    return best
  }

  const glide = (el: HTMLElement, to: number, velocity: number) => {
    const max = el.scrollWidth - el.clientWidth
    const target = Math.max(0, Math.min(max, to))
    if (reduced) {
      el.scrollLeft = target
      return
    }
    // Hız DEVREDİLİR: yay, parmağın bıraktığı hızla başlar — dikiş görünmez.
    animate(el.scrollLeft, target, {
      ...SPRING_THROW,
      velocity,
      onUpdate: (v) => {
        el.scrollLeft = v
      },
    })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!fine || e.button !== 0) return
    const el = scroller.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      samples: [{ x: e.clientX, t: performance.now() }],
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = scroller.current
    if (!d || !el || e.pointerId !== d.pointerId) return
    // 1:1 takip — içerik parmakla birlikte gider.
    el.scrollLeft = d.startScroll - (e.clientX - d.startX)
    d.samples.push({ x: e.clientX, t: performance.now() })
    // Yalnız son birkaç örnek tutulur; hız ANLIK olmalı, sürüklemenin ortalaması değil.
    if (d.samples.length > 6) d.samples.shift()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = scroller.current
    drag.current = null
    if (!d || !el || e.pointerId !== d.pointerId) return

    const first = d.samples[0]
    const last = d.samples[d.samples.length - 1]
    const dt = Math.max(1, last.t - first.t)
    // px/sn cinsinden bırakma hızı. Kaydırma yönü işaretçinin TERSİDİR.
    const pointerVelocity = ((last.x - first.x) / dt) * 1000
    const scrollVelocity = -pointerVelocity

    const projected = el.scrollLeft + projectMomentum(scrollVelocity)
    glide(el, snapTarget(el, projected), scrollVelocity)
  }

  /** Klavye ve düğmeler için bir ekran ilerlet. */
  const step = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    glide(el, snapTarget(el, el.scrollLeft + dir * el.clientWidth * 0.8), 0)
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={scroller}
        role="group"
        aria-label={label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        className={`no-scrollbar snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#EF6F94] ${
          fine ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {children}
      </div>

      {/* Kenar düğmeleri — fare ve klavye için; dokunmatikte parmak zaten yeterli. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between lg:flex">
        <RailButton dir="left" show={canLeft} onClick={() => step(-1)} />
        <RailButton dir="right" show={canRight} onClick={() => step(1)} />
      </div>
    </div>
  )
}

function RailButton({ dir, show, onClick }: { dir: 'left' | 'right'; show: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === 'left' ? 'Geri kaydır' : 'İleri kaydır'}
      tabIndex={show ? 0 : -1}
      className={`material-light pointer-events-auto grid h-11 w-11 place-items-center rounded-full text-[#4A3A44] transition-opacity duration-300 ${
        dir === 'left' ? '-translate-x-5' : 'translate-x-5'
      } ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      {dir === 'left' ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  )
}
