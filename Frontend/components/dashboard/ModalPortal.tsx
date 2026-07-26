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
