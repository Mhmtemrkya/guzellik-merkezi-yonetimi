'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck, X } from 'lucide-react'
import { setPendingApprovalHandler, type PendingApprovalInfo } from '@/lib/apiClient'

interface Notice extends PendingApprovalInfo {
  id: number
}

/**
 * Evrensel personel onay kapısı bildirimi. Personelin bir yazma işlemi taslağa (onaya) düştüğünde
 * apiClient buradaki handler'ı çağırır; sağ altta kısa süreli bir bildirim gösterilir.
 * Kök layout'a bir kez mount edilir — toast altyapısına bağımlı değildir.
 */
export default function ApprovalToast() {
  const [notices, setNotices] = useState<Notice[]>([])

  useEffect(() => {
    let counter = 0
    setPendingApprovalHandler((info) => {
      const id = ++counter
      setNotices((prev) => [...prev.slice(-2), { ...info, id }])
      window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 5000)
    })
    return () => setPendingApprovalHandler(null)
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="pointer-events-auto overflow-hidden rounded-[16px] border border-[#efbfd0]/80 bg-white/95 shadow-[0_24px_60px_-30px_rgba(150,78,104,0.7)] backdrop-blur-xl"
          >
            <div className="flex items-start gap-3 p-3.5">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]">
                <ShieldCheck className="h-4.5 w-4.5" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-[#352432]">
                  {n.title ? `${n.title} · onaya gönderildi` : 'Onaya gönderildi'}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-[#7c6170]">{n.message}</div>
              </div>
              <button
                type="button"
                onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#9d7386] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
                aria-label="Kapat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 5, ease: 'linear' }}
              className="h-0.5 origin-left bg-gradient-to-r from-[#ee789a] to-[#f5abc0]"
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
