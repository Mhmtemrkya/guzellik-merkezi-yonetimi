'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
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
 *
 * ERİŞİLEBİLİRLİK: panel `body`'nin çocuğu olduğu için, klavyeyle gezen kullanıcının Tab'ı
 * tetikleyiciden sonra BELGENİN SONUNA sıçrıyordu — panel görünürken içeriğine hiç uğramadan.
 * Bu yüzden panel `role="dialog"` olarak duyurulur, açılışta odak İÇERİ alınır, Tab panelin
 * içinde döner ve kapanışta odak tetikleyiciye geri verilir. Tetikleyicinin `aria-expanded` /
 * `aria-controls` bağını kuran taraf ÇAĞIRAN'dır; `id` bu yüzden dışarı verilir.
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
  id,
  label,
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
  /** Tetikleyicideki `aria-controls` ile eşleşmesi için dışarıdan verilebilir. */
  id?: string
  /** Ekran okuyucunun panele vereceği ad ("Kategori filtresi" gibi). */
  label?: string
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const autoId = useId()
  const panelId = id ?? `popover-${autoId}`
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
    let maxHeight = openUp ? spaceAbove : spaceBelow
    /*
     * KISA EKRAN (yatay telefon, açık klavye): iki yöne de yer yoksa eskiden 160px'lik bir taban
     * dayatılıyordu ve panel ekranın altından TAŞIYORDU — alttaki düğmelere hiç ulaşılamıyordu.
     * Artık ekranın verebildiği kadarını alır, gerisini kendi içinde kaydırır.
     */
    if (maxHeight < 160) maxHeight = Math.max(120, Math.min(vh - 16, Math.max(spaceAbove, spaceBelow)))
    const rawTop = openUp ? rect.top - gap - maxHeight : rect.bottom + gap
    const top = Math.max(8, Math.min(rawTop, vh - maxHeight - 8))
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

  /*
   * ODAK YÖNETİMİ. Açılışta odak panelin ilk odaklanabilir öğesine (yoksa panelin kendisine)
   * gider; Tab panelin içinde döner; kapanışta odak tetikleyiciye GERİ VERİLİR — yoksa klavye
   * kullanıcısı, panelden sonra sayfanın en başına düşer ve bulunduğu yeri kaybeder.
   */
  useEffect(() => {
    if (!open || !pos) return
    const panel = panelRef.current
    if (!panel) return
    const trigger = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    const first = focusables()[0]
    ;(first ?? panel).focus({ preventScroll: true })

    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { event.preventDefault(); return }
      const current = document.activeElement as HTMLElement | null
      const index = current ? items.indexOf(current) : -1
      const next = event.shiftKey
        ? items[(index <= 0 ? items.length : index) - 1]
        : items[index === items.length - 1 ? 0 : index + 1]
      event.preventDefault()
      next?.focus({ preventScroll: true })
    }
    panel.addEventListener('keydown', onTab)
    return () => {
      panel.removeEventListener('keydown', onTab)
      // Odağı yalnızca panel içindeyken geri al: kullanıcı başka yere tıkladıysa oradan koparma.
      if (panel.contains(document.activeElement)) {
        const back = anchorRef.current?.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])') ?? trigger
        back?.focus({ preventScroll: true })
      }
    }
    // `pos` bağımlılıkta: ilk ölçüm bitmeden panel DOM'da olmaz.
  }, [open, pos, anchorRef])

  if (!open || !pos) return null

  return (
    <ModalPortal>
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
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
