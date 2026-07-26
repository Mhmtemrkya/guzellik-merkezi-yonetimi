'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Modalı <body>'ye taşır.
 *
 * NEDEN GEREKLİ: panel yerleşiminde `<main className="relative z-10">` kendi yığınlama
 * bağlamını (stacking context) açar; sidebar ise `main`'in KARDEŞİ ve `z-30`. Bu yüzden
 * `main` içinde açılan bir modal `z-[100]` bile olsa sidebar'ın ALTINDA kalır — modalın sol
 * tarafı menünün arkasında kaybolur. Portal ile modal `body`'nin doğrudan çocuğu olur ve
 * z-index'i gerçekten geçerli olur.
 *
 * Sunucuda render edilmez (createPortal tarayıcı gerektirir); ilk paint'ten sonra bağlanır.
 *
 * KATMAN ÖLÇEĞİ (tek kaynak — yeni modal eklerken buraya bak):
 *   0–70   panel iskeleti: PanelBackdrop 0 · main 10 · sidebar 30 · mobil çekmece/QuickMenu 70
 *   120    müşteri detay modali (CustomerDetailModal)
 *   130    satış detay modali (SaleDetailModal) — müşteri modalinin içinden açılır
 *   135    geçmiş satış modali (HistoricalSaleDialog)
 *   140    gün çizelgesi tam ekran (DayScheduleModal)
 *   145    sayfa seviyesi elle yazılmış modaller (içeri aktarma, cihaz, takvim linki)
 *   150    Radix Dialog / Sheet / Drawer — yukarıdakilerin İÇİNDEN açılabildiği için üstte
 *   155    barkod kamerası (ürün formunun içinden açılır)
 *   160    AlertDialog (onay) — dialog'un da üstünde
 *   200    Select / Popover / Dropdown / Tooltip / Topbar açılırları — her zaman en üstte
 *   290    PageGuide (kılavuz turu) — her şeyin üstü
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
