'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, PenLine } from 'lucide-react'

/**
 * Parmak / tablet kalemi ile imza alanı.
 *
 * Pointer Events kullanılır (mouse + dokunmatik + kalem tek API). Canvas'ın CSS boyutu
 * responsive'dir ama çizim yüzeyi devicePixelRatio ile ölçeklenir — aksi halde tablette
 * imza bulanık çıkar. Yeniden boyutlanmada mevcut çizim korunur (görüntü yedeklenip geri basılır).
 */
export default function SignaturePad({
  onChange,
  height = 220,
  disabled = false,
}: {
  /** Her darbeden sonra güncel imza (boşsa null) — base64 PNG data-URL. */
  onChange: (dataUrl: string | null) => void
  height?: number
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  const [empty, setEmpty] = useState(true)

  const context = (): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current
    return canvas ? canvas.getContext('2d') : null
  }

  // Çizim yüzeyini kapsayıcıya göre ölçekler; mevcut imzayı kaybetmez.
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    const width = canvas.clientWidth
    if (width <= 0) return
    const snapshot = dirty.current ? canvas.toDataURL('image/png') : null

    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#2f1724'

    if (snapshot) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, width, height)
      img.src = snapshot
    }
  }, [height])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (disabled) return
    const ctx = context()
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = pointFrom(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // Tek dokunuşla nokta da bırakılabilsin (kısa imza / nokta).
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    dirty.current = true
    if (empty) setEmpty(false)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current || disabled) return
    const ctx = context()
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = (): void => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas && dirty.current) onChange(canvas.toDataURL('image/png'))
  }

  const clear = (): void => {
    const canvas = canvasRef.current
    const ctx = context()
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    dirty.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-[16px] border-2 border-dashed border-[#BE7690] bg-white">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="block w-full cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-1.5 text-[#8C4460]">
              <PenLine className="h-7 w-7" />
              <span className="text-[13px] font-medium">Parmağınız veya kalemle buraya imzalayın</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-[#74616A]">İmzanız belgeye tarih ve saat bilgisiyle birlikte işlenir.</span>
        <button
          type="button"
          onClick={clear}
          disabled={empty || disabled}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3E343A] transition-colors hover:bg-[#F7F6F6] disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" /> Temizle
        </button>
      </div>
    </div>
  )
}
