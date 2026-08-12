'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ShieldAlert, X } from 'lucide-react'
import { useRealtime, type RealtimeEvent } from '@/components/dashboard/RealtimeContext'

interface Notice {
  id: number
  kind: string
  title: string
  message: string
}

let counter = 0

/**
 * Anlık onay sonucu bildirimi. Personel adisyon kartı açıkken yönetici onayladığında
 * "onaylandı" burada belirir; ekranların verisini tazeleme işi ilgili bileşenlerde
 * (useRealtime) yapılır — bu bileşen yalnızca KULLANICIYA HABER verir.
 *
 * Bildirim kalıcılığı burada değildir: aynı olay app_notifications'a da yazılır, bu yüzden
 * kullanıcı o an ekranda olmasa bile sonucu bildirim akışında/mobilde görür.
 */
export default function RealtimeToast() {
  const [notices, setNotices] = useState<Notice[]>([])

  useRealtime(null, (event: RealtimeEvent) => {
    // Yalnız kullanıcıya söylenecek olaylar; saf "tazele" sinyalleri sessizdir.
    if (event.kind !== 'approval.approved' && event.kind !== 'approval.rejected') return
    const id = ++counter
    setNotices((prev) => [
      ...prev.slice(-2),
      {
        id,
        kind: event.kind,
        title: event.title || (event.kind === 'approval.approved' ? 'İşleminiz onaylandı' : 'İşleminiz reddedildi'),
        message: event.message || '',
      },
    ])
    window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 7000)
  })

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((n) => {
          const ok = n.kind === 'approval.approved'
          return (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className={`pointer-events-auto overflow-hidden rounded-[16px] border bg-white/95 shadow-[0_24px_60px_-30px_rgba(150,78,104,0.7)] backdrop-blur-xl ${
                ok ? 'border-emerald-200' : 'border-amber-200'
              }`}
            >
              <div className="flex items-start gap-3 p-3.5">
                <span
                  className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                  }`}
                >
                  {ok ? <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} /> : <ShieldAlert className="h-5 w-5" strokeWidth={1.8} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[#2A2027]">{n.title}</div>
                  {n.message && <div className="mt-0.5 text-[11px] leading-relaxed text-[#7c6170]">{n.message}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#9d7386] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
                  aria-label="Kapat"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
