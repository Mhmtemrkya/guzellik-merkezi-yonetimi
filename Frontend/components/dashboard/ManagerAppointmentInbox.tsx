'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellRing, CalendarClock, Check, CheckCircle2, Clock3, FileClock, UserX, X } from 'lucide-react'
import { useManagerInbox } from '@/hooks/useManagerInbox'
import { formatTL } from '@/lib/apiMappers'
import type { Appointment } from '@/lib/types'

/**
 * Kurum yöneticisi randevu aksiyon kutusu.
 *  • Saati gelmiş randevular → Tamamlandı / Gelmedi / Ertele (Tamamlandı'da paket seansı otomatik düşer)
 *  • Personelin onaya gönderdiği taslaklar → Onayla / Reddet (onayda taslak → aktif randevu)
 */
export default function ManagerAppointmentInbox({
  enabled,
  tenantId,
  onReschedule,
  onChanged,
}: {
  enabled: boolean
  tenantId?: string
  onReschedule?: (appointment: Appointment) => void
  onChanged?: () => void | Promise<unknown>
}) {
  const inbox = useManagerInbox({ enabled, tenantId })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!enabled) return null
  if (!inbox.loading && inbox.total === 0) return null

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id)
    setError('')
    try {
      await fn()
      if (onChanged) await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusyId(null)
    }
  }

  const dateLabel = (a: Appointment) => {
    const d = new Date(`${a.date}T${a.time || '00:00'}:00`)
    return Number.isNaN(d.getTime())
      ? `${a.date} ${a.time}`
      : d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) + ` · ${a.time}`
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[22px] border border-[#efbfd0]/70 bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] p-4 shadow-[0_24px_70px_-46px_rgba(150,78,104,0.6)] sm:p-5"
    >
      <motion.span
        aria-hidden
        animate={{ opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#f0aac2]/25 blur-3xl"
      />

      <div className="relative mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <motion.span
            animate={{ rotate: [0, -10, 8, -4, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 3 }}
            className="grid h-9 w-9 place-items-center rounded-full border border-[#efbfd0]/80 bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
          >
            <BellRing className="h-4 w-4" strokeWidth={1.7} />
          </motion.span>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-[0.24em] text-[#c85776]/75">Aksiyon kutusu</div>
            <h3 className="font-display text-lg leading-tight tracking-tight text-[#352432]">Bekleyen randevu kararları</h3>
          </div>
        </div>
        <span className="grid h-7 min-w-7 place-items-center rounded-full bg-[#c85776] px-2 text-[12px] font-semibold text-white tabular-nums">
          {inbox.total}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
      )}

      <div className="relative grid gap-4 lg:grid-cols-2">
        {/* SAATİ GELEN — SONUÇ BEKLEYEN */}
        {inbox.awaitingOutcome.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-[#b14d6c]/80">
              <Clock3 className="h-3.5 w-3.5" /> Saati geldi · sonucu girilmeli
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {inbox.awaitingOutcome.map((a) => (
                  <motion.li
                    key={a.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="rounded-[14px] border border-[#f0e0e6] bg-white px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-[#241923]">{a.musteri}</div>
                        <div className="truncate text-[11px] text-[#7c6170]">{a.islem}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#9d7386]">
                          <CalendarClock className="h-3 w-3" /> {dateLabel(a)} · {a.personel}
                          {Number(a.price) > 0 && <span className="tabular-nums text-[#b08742]"> · {formatTL(Number(a.price))}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => run(a.id, () => inbox.complete(a.id))}
                        className="inline-flex items-center gap-1 rounded-[9px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Tamamlandı
                      </button>
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => run(a.id, () => inbox.noShow(a.id))}
                        className="inline-flex items-center gap-1 rounded-[9px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
                      >
                        <UserX className="h-3.5 w-3.5" /> Gelmedi
                      </button>
                      {onReschedule && (
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => onReschedule(a)}
                          className="inline-flex items-center gap-1 rounded-[9px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#7c6170] transition-colors hover:bg-[#fff4f8] disabled:opacity-50"
                        >
                          <CalendarClock className="h-3.5 w-3.5" /> Ertele
                        </button>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {/* TASLAK — ONAY BEKLEYEN */}
        {inbox.awaitingApproval.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-indigo-500/80">
              <FileClock className="h-3.5 w-3.5" /> Personel önerisi · onay bekliyor
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {inbox.awaitingApproval.map((a) => (
                  <motion.li
                    key={a.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="rounded-[14px] border border-dashed border-indigo-200 bg-indigo-50/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#241923]">{a.musteri}</div>
                      <div className="truncate text-[11px] text-[#7c6170]">{a.islem}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#9d7386]">
                        <CalendarClock className="h-3 w-3" /> {dateLabel(a)} · {a.personel}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => run(a.id, () => inbox.approve(a.id))}
                        className="inline-flex items-center gap-1 rounded-[9px] bg-[#c85776] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Onayla
                      </button>
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => run(a.id, () => inbox.reject(a.id))}
                        className="inline-flex items-center gap-1 rounded-[9px] border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Reddet
                      </button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </div>
    </motion.section>
  )
}
