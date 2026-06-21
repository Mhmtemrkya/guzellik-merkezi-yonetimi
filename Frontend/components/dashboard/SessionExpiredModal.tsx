'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { clearSession, setUnauthorizedHandler } from '@/lib/apiClient'

/**
 * Global 401 modalı. Geçerli bir token'la yapılan istek 401 dönerse (oturum süresi dolmuş/geçersiz)
 * apiClient buradaki handler'ı tetikler; engelleyici bir modal çıkar ve tek aksiyon tekrar giriştir.
 * Kök layout'a bir kez mount edilir. Her kapanış yolu (buton / X / overlay) login'e götürür.
 */
export default function SessionExpiredModal() {
  const [open, setOpen] = useState(false)
  const navigatingRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigatingRef.current = false
      setOpen(true)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const goLogin = (): void => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    clearSession()
    setOpen(false)
    router.replace('/login')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) goLogin() }}>
      <DialogContent
        className="border-[#ead8df]/90 bg-white sm:max-w-[420px]"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center px-1 py-2 text-center sm:px-2">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fff1f6] text-[#c85776] shadow-[0_14px_34px_-22px_rgba(200,87,118,0.8)]">
            <ShieldCheck className="h-7 w-7" strokeWidth={1.6} />
          </span>
          <DialogTitle className="mt-4 font-display text-xl tracking-tight text-[#352432]">
            Güvenli çıkış yapıldı
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-xs text-[13px] leading-relaxed text-[#352432]/60">
            Oturumunuzun güvenliği için çıkış yapıldı. Devam etmek için lütfen tekrar giriş yapın.
          </DialogDescription>
          <button
            type="button"
            onClick={goLogin}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-3 text-[13px] font-semibold text-white shadow-[0_18px_40px_-18px_rgba(183,90,126,0.8)] transition-opacity hover:opacity-90"
          >
            <LogIn className="h-4 w-4" /> Giriş Yap
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
