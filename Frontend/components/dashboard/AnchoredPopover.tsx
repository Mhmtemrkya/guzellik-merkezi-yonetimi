'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import ModalPortal from '@/components/dashboard/ModalPortal'

/**
 * Bir tetikleyiciye tutturulmuş açılır panel — <body>'ye portal'lanır.
 *
 * NEDEN PORTAL, NEDEN SADECE Z-INDEX DEĞİL: pano kartlarının kabuğu (`cardShell`)
 * `overflow-hidden` taşır — marka çizgisi ve köşedeki bulanık leke kartın dışına taşmasın diye.
 * Kartın İÇİNDE `absolute` açılan bir menü, kartın alt kenarını geçtiği anda KIRPILIR; z-index
 * ne verilirse verilsin kırpılmayı aşamaz, çünkü `overflow` yığınlama sırasından bağımsızdır.
 * Üstüne bir de kartlar `motion.section` (transform/opacity) olduğu için kendi yığınlama
 * bağlamlarını açar ve içerideki `z-30` dış dünyada hiçbir şey ifade etmez.
 *
 * Panel `body`'nin çocuğu olunca ikisi de ortadan kalkar: kırpacak ata yok, yığınlama bağlamı
 * en üstte. Katman 200 = "Select / Popover / Dropdown" şeridi (bkz. ModalPortal katman ölçeği).
 *
 * Konum her açılışta ve kaydırma/boyut değişiminde tetikleyicinin gerçek ekran koordinatından
 * yeniden hesaplanır; alta sığmıyorsa panel yukarı açılır.
 */
export default function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  children,
  width = 240,
  align = 'right',
  gap = 6,
  className = '',
}: {
  open: boolean
  /** Panelin tutturulacağı tetikleyici (düğme ya da onu saran kutu). */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  /** İstenen genişlik; ekrana sığmazsa daraltılır. */
  width?: number
  align?: 'left' | 'right'
  gap?: number
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(width, vw - 16)
    // Yatayda ekran dışına taşma yok: sağa hizalı panel dar ekranda sola kayar.
    const rawLeft = align === 'right' ? rect.right - w : rect.left
    const left = Math.max(8, Math.min(rawLeft, vw - w - 8))
    const spaceBelow = vh - rect.bottom - gap - 8
    const spaceAbove = rect.top - gap - 8
    // Altta yer dar VE üstte daha genişse yukarı aç (sayfa sonundaki kartlarda kritik).
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, openUp ? spaceAbove : spaceBelow)
    const top = openUp ? Math.max(8, rect.top - gap - maxHeight) : rect.bottom + gap
    setPos({ top, left, width: w, maxHeight })
  }, [anchorRef, width, align, gap])

  useEffect(() => {
    if (!open) { setPos(null); return }
    measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onReflow = (): void => measure()
    // `true`: iç kaydırma kapsayıcıları da yakalanmalı, yoksa panel tetikleyiciden kopar.
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open, measure])

  /*
   * DIŞARI TIKLAMA BURADA YÖNETİLİR. Panel artık tetikleyicinin DOM alt ağacında değil; çağıran
   * taraf "kutumun dışına tıklandı mı" diye baksaydı, panelin İÇİNE her tıklamada kapanırdı.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || !pos) return null

  return (
    <ModalPortal>
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: pos.width,
          maxHeight: pos.maxHeight,
          zIndex: 200,
        }}
        className={`overflow-y-auto overscroll-contain rounded-[14px] border border-[#E4DEE0] bg-white shadow-[0_24px_50px_-28px_rgba(87,39,61,0.6)] ${className}`}
      >
        {children}
      </div>
    </ModalPortal>
  )
}
