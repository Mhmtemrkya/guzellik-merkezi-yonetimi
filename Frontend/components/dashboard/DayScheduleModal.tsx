'use client'

import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Plane,
  Plus,
  Scissors,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { Appointment, AppointmentStatusKey, Customer, Staff, StaffTimeOff } from '@/lib/types'

// ---------------------------------------------------------------------------
// Durum tonları (saatlik çizelge blokları için)
// ---------------------------------------------------------------------------

interface StatusStyle {
  label: string
  bar: string
  dot: string
  block: string
}

const statusStyle: Record<AppointmentStatusKey, StatusStyle> = {
  tamamlandi: { label: 'Tamamlandı', bar: 'bg-emerald-500', dot: 'bg-emerald-500', block: 'border-emerald-200 bg-emerald-50/95 hover:bg-emerald-50' },
  devam: { label: 'Onaylandı', bar: 'bg-sky-500', dot: 'bg-sky-500', block: 'border-sky-200 bg-sky-50/95 hover:bg-sky-50' },
  bekliyor: { label: 'Bekliyor', bar: 'bg-amber-400', dot: 'bg-amber-400', block: 'border-amber-200 bg-amber-50/95 hover:bg-amber-50' },
  taslak: { label: 'Taslak', bar: 'bg-indigo-400', dot: 'bg-indigo-400', block: 'border-dashed border-indigo-300 bg-indigo-50/95 hover:bg-indigo-50' },
  iptal: { label: 'İptal', bar: 'bg-rose-400', dot: 'bg-rose-400', block: 'border-rose-200 bg-rose-50/85 opacity-75 hover:opacity-95' },
}

const statusOrder: AppointmentStatusKey[] = ['tamamlandi', 'devam', 'bekliyor', 'taslak', 'iptal']

const PX_PER_HOUR = 64

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function parseMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '')
  if (!m) return 9 * 60
  return Math.min(24 * 60 - 1, Math.max(0, Number(m[1]) * 60 + Number(m[2])))
}

function minutesToLabel(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '•'
  return parts.slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR')).join('')
}

interface LaidOutAppt {
  appt: Appointment
  startMin: number
  endMin: number
  dur: number
  lane: number
  lanes: number
}

/** Çakışan randevuları yan yana şeritlere (lane) dağıtır. */
function packLanes(appts: Appointment[]): LaidOutAppt[] {
  const items = appts
    .map((appt) => {
      const startMin = parseMinutes(appt.time)
      const dur = Math.max(15, Number(appt.sure) || 30)
      return { appt, startMin, endMin: startMin + dur, dur, lane: 0, lanes: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const result: LaidOutAppt[] = []
  let cluster: typeof items = []
  let clusterEnd = -1

  const flush = (group: typeof items): void => {
    const laneEnds: number[] = []
    for (const it of group) {
      let placed = -1
      for (let i = 0; i < laneEnds.length; i++) {
        if (it.startMin >= laneEnds[i]) {
          placed = i
          laneEnds[i] = it.endMin
          break
        }
      }
      if (placed === -1) {
        placed = laneEnds.length
        laneEnds.push(it.endMin)
      }
      it.lane = placed
    }
    const lanes = Math.max(1, laneEnds.length)
    for (const it of group) result.push({ ...it, lanes })
  }

  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) {
      flush(cluster)
      cluster = []
      clusterEnd = -1
    }
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush(cluster)
  return result
}

interface ColumnDef {
  id: string | null
  name: string
  role: string
  photoUrl?: string
  appts: Appointment[]
}

// ---------------------------------------------------------------------------
// Bileşen
// ---------------------------------------------------------------------------

export interface DayScheduleModalProps {
  open: boolean
  date: string | null
  appointments: Appointment[]
  staff: Staff[]
  customers?: Record<string, Customer>
  timeOffs?: StaffTimeOff[]
  isStaffUser?: boolean
  /** İzin ekleme/kaldırma sürerken true — toggle butonları kilitlenir. */
  busy?: boolean
  onClose: () => void
  onEditAppointment?: (id: string) => void
  onCreateAt?: (info: { date: string; time?: string; staffId?: string }) => void
  /** Personeli o gün izinli yap / iznini kaldır (yalnızca yönetici). */
  onToggleLeave?: (staffId: string, date: string, currentlyOnLeave: boolean) => void
}

export default function DayScheduleModal({
  open,
  date,
  appointments,
  staff,
  customers,
  timeOffs,
  isStaffUser = false,
  busy = false,
  onClose,
  onEditAppointment,
  onCreateAt,
  onToggleLeave,
}: DayScheduleModalProps) {
  // ESC ile kapat + arka plan kaydırmasını kilitle
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  const dayAppts = useMemo(
    () => (date ? appointments.filter((a) => a.date === date) : []),
    [appointments, date],
  )

  // O gün izinli personellerin id'leri — bu personellere randevu açılamaz.
  const leaveIds = useMemo(() => {
    const s = new Set<string>()
    if (!date) return s
    for (const t of timeOffs || []) {
      if ((t.date || '').slice(0, 10) === date && t.staffMemberId) s.add(t.staffMemberId)
    }
    return s
  }, [timeOffs, date])

  // İzin yönetimi yalnızca yöneticide (personel görünümünde gizli).
  const canManageLeave = Boolean(onToggleLeave) && !isStaffUser

  // Sütunlar: küçük ekiplerde tüm aktif personel (müsaitlik görünür),
  // büyük ekiplerde yalnızca o gün randevusu olanlar + atanmamışlar.
  const columns = useMemo<ColumnDef[]>(() => {
    const activeStaff = staff.filter((s) => s.active)
    const busyIds = new Set(dayAppts.map((a) => a.staffMemberId).filter(Boolean) as string[])
    const baseStaff = activeStaff.length <= 8 ? activeStaff : activeStaff.filter((s) => busyIds.has(s.id))
    // Aktif listede olmayan ama o gün randevusu olan personelleri de ekle
    const extraIds = [...busyIds].filter((id) => !baseStaff.some((s) => s.id === id))
    const extraStaff = extraIds
      .map((id) => staff.find((s) => s.id === id))
      .filter((s): s is Staff => Boolean(s))

    const staffCols: ColumnDef[] = [...baseStaff, ...extraStaff].map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      photoUrl: s.photoUrl || undefined,
      appts: dayAppts.filter((a) => a.staffMemberId === s.id),
    }))

    const assignedIds = new Set(staffCols.map((c) => c.id))
    const unassigned = dayAppts.filter((a) => !a.staffMemberId || !assignedIds.has(a.staffMemberId))
    if (unassigned.length) {
      staffCols.push({ id: null, name: 'Atanmamış', role: 'personel atanmadı', appts: unassigned })
    }
    return staffCols
  }, [staff, dayAppts])

  // Zaman penceresi (en erken/en geç randevuya göre, en az 09–19)
  const { startHour, endHour, hours } = useMemo(() => {
    let minS = 9 * 60
    let maxE = 19 * 60
    for (const a of dayAppts) {
      const s = parseMinutes(a.time)
      const e = s + Math.max(15, Number(a.sure) || 30)
      minS = Math.min(minS, s)
      maxE = Math.max(maxE, e)
    }
    let sh = Math.max(6, Math.min(9, Math.floor(minS / 60)))
    let eh = Math.min(24, Math.max(19, Math.ceil(maxE / 60)))
    if (eh <= sh) eh = sh + 1
    return { startHour: sh, endHour: eh, hours: Array.from({ length: eh - sh }, (_, i) => sh + i) }
  }, [dayAppts])

  const gridHeight = (endHour - startHour) * PX_PER_HOUR

  // Bugünün "şimdi" çizgisi
  const todayKey = new Date().toISOString().slice(0, 10)
  const isToday = date === todayKey
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const nowTop = ((nowMin - startHour * 60) / 60) * PX_PER_HOUR
  const showNow = isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60

  const counts = useMemo(() => {
    const c: Record<AppointmentStatusKey, number> = { tamamlandi: 0, devam: 0, bekliyor: 0, taslak: 0, iptal: 0 }
    for (const a of dayAppts) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [dayAppts])

  const dateObj = date ? new Date(`${date}T00:00:00`) : null
  const titleLabel = dateObj
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj)
    : ''
  const weekdayLabel = dateObj ? new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(dateObj) : ''

  const gridTemplate = `repeat(${columns.length}, minmax(170px, 1fr))`
  const innerMinWidth = 64 + columns.length * 184

  const hourLineBg = `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2}px)`

  const handleColumnClick = (col: ColumnDef, e: React.MouseEvent<HTMLDivElement>): void => {
    if (!onCreateAt || !date) return
    if (col.id && leaveIds.has(col.id)) return // izinli personele randevu açılamaz
    if (e.target !== e.currentTarget) return // blok tıklamalarını yoksay
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const raw = startHour * 60 + (y / PX_PER_HOUR) * 60
    const snapped = Math.max(startHour * 60, Math.round(raw / 15) * 15)
    onCreateAt({ date, time: minutesToLabel(snapped), staffId: col.id ?? undefined })
  }

  return (
    <AnimatePresence>
      {open && date && (
        <motion.div
          key="day-schedule-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[#4a2335]/28 px-3 py-6 backdrop-blur-md sm:px-6"
        >
          <motion.div
            key="day-schedule-panel"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-[#ead8df]/80 bg-white/97 shadow-[0_50px_140px_-40px_rgba(120,71,88,0.6)] backdrop-blur-2xl"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0aac2] to-transparent" />
            <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#f0aac2]/16 blur-3xl" />

            {/* HEADER */}
            <div className="relative flex flex-col gap-4 border-b border-[#ead8df]/70 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] border border-[#f8d8e2] bg-gradient-to-br from-[#fff2f6] to-[#ffd9e4] text-[#c85776] shadow-[0_12px_28px_-18px_rgba(190,91,125,0.9)]">
                    <CalendarDays className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-[22px] font-bold leading-none tracking-tight text-[#241923]">{titleLabel}</h2>
                      {isToday && (
                        <span className="rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2 py-0.5 text-[10px] font-semibold text-[#c85776]">Bugün</span>
                      )}
                    </div>
                    <div className="mt-1 text-[12px] capitalize text-[#8a7480]">
                      {weekdayLabel} · saatlik personel çizelgesi
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df] bg-white/80 text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff7fa] hover:text-[#c85776]"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Özet çipleri */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-2.5 py-1 text-[11px] text-[#5d4a56]">
                    <CalendarDays className="h-3 w-3 text-[#c85776]" /> <span className="font-semibold text-[#241923]">{dayAppts.length}</span> randevu
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-2.5 py-1 text-[11px] text-[#5d4a56]">
                    <Users className="h-3 w-3 text-[#c85776]" /> <span className="font-semibold text-[#241923]">{columns.filter((c) => c.id !== null).length}</span> personel
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-2.5 py-1 text-[11px] text-[#5d4a56]">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" /> <span className="font-semibold text-[#241923]">{counts.tamamlandi}</span> tamamlandı
                  </span>
                </div>
                {/* Lejant */}
                <div className="flex flex-wrap items-center gap-3">
                  {statusOrder.map((k) => (
                    <span key={k} className="flex items-center gap-1.5 text-[10px] text-[#8a7480]">
                      <span className={`h-2 w-2 rounded-full ${statusStyle[k].dot}`} /> {statusStyle[k].label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* GÖVDE: çizelge */}
            <div className="relative flex-1 overflow-auto">
              {dayAppts.length === 0 && columns.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-[#f3d7e0] bg-[#fff4f8] text-[#c85776]">
                    <Clock className="h-6 w-6" strokeWidth={1.6} />
                  </span>
                  <div className="font-display text-lg text-[#241923]">Bu günde randevu yok</div>
                  <div className="max-w-xs text-[12px] text-[#8a7480]">Boş bir güne hızlıca randevu ekleyebilirsin.</div>
                  {onCreateAt && (
                    <button
                      type="button"
                      onClick={() => onCreateAt({ date })}
                      className="mt-1 inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5"
                    >
                      <Plus className="h-4 w-4" /> Yeni randevu
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ minWidth: innerMinWidth }}>
                  {/* Personel başlık satırı (sticky) — dikey merkezli kart: tam isim + kompakt izin ikonu */}
                  <div className="sticky top-0 z-20 flex border-b border-[#ead8df]/70 bg-gradient-to-b from-white to-[#fff9fb]/95 backdrop-blur">
                    <div className="grid w-16 shrink-0 place-items-center border-r border-[#f3e4ea] text-[#c9aeba]">
                      <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </div>
                    <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
                      {columns.map((col) => {
                        const onLeave = col.id ? leaveIds.has(col.id) : false
                        return (
                          <div
                            key={col.id ?? 'none'}
                            className={`group/hd relative flex flex-col items-center gap-1.5 border-l border-[#f3e4ea] px-2.5 py-3 text-center transition-colors first:border-l-0 ${onLeave ? 'bg-rose-50/50' : 'hover:bg-[#fff7fa]'}`}
                          >
                            {/* İzin durumu/aksiyonu — köşede kompakt (isme tüm genişlik kalsın) */}
                            {col.id && canManageLeave ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (col.id && date) onToggleLeave?.(col.id, date, onLeave)
                                }}
                                title={onLeave ? 'İzni kaldır — randevuya yeniden açılır' : 'Bu personeli bugün izinli yap'}
                                aria-label={onLeave ? 'İzni kaldır' : 'İzinli yap'}
                                className={`absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                  onLeave
                                    ? 'border-rose-200 bg-rose-100 text-rose-600 hover:bg-rose-200'
                                    : 'border-[#ead8df] bg-white/85 text-[#c2a2b0] hover:border-[#efbfd0] hover:bg-[#fff1f6] hover:text-[#c85776]'
                                }`}
                              >
                                {onLeave ? <X className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
                              </button>
                            ) : (
                              onLeave && (
                                <span
                                  title="İzinli"
                                  className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border border-rose-200 bg-rose-50 text-rose-500"
                                >
                                  <Plane className="h-3 w-3" />
                                </span>
                              )
                            )}

                            {/* Avatar */}
                            {col.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={col.photoUrl} alt={col.name} className={`h-11 w-11 shrink-0 rounded-full border-2 border-white object-cover shadow-[0_5px_14px_-6px_rgba(190,91,125,0.6)] ring-1 ring-[#efbfd0]/60 ${onLeave ? 'opacity-60 grayscale' : ''}`} />
                            ) : col.id === null ? (
                              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-dashed border-[#d8b9c5] bg-[#fff4f8] text-[#b08aa0]">
                                <UserRound className="h-5 w-5" />
                              </span>
                            ) : (
                              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] text-[13px] font-bold text-[#7f4057] shadow-[0_5px_14px_-6px_rgba(190,91,125,0.6)] ring-1 ring-[#efbfd0]/60 ${onLeave ? 'opacity-60 grayscale' : ''}`}>
                                {initialsOf(col.name)}
                              </span>
                            )}

                            {/* İsim — tam ad, en fazla 2 satır (sabit yükseklikte ortalanır) */}
                            <div className="flex min-h-[34px] w-full items-center justify-center">
                              <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-[#241923]" title={col.name}>
                                {col.name}
                              </span>
                            </div>

                            {/* Durum rozeti */}
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                                onLeave ? 'bg-rose-50 text-rose-500' : col.appts.length ? 'bg-[#fff1f6] text-[#c85776]' : 'bg-[#f4edf0] text-[#a58d99]'
                              }`}
                            >
                              {onLeave ? (
                                <>
                                  <Plane className="h-2.5 w-2.5" /> İzinli
                                </>
                              ) : col.appts.length ? (
                                `${col.appts.length} randevu`
                              ) : (
                                'boş'
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Zaman ekseni + sütunlar */}
                  <div className="relative flex" style={{ height: gridHeight }}>
                    {/* Saat ekseni — tam saat + yarım saat (daha detaylı) */}
                    <div className="relative w-16 shrink-0 border-r border-[#f3e4ea]">
                      {hours.map((h, i) => (
                        <div key={h}>
                          <div
                            className="absolute right-2 text-[10px] font-mono font-semibold tabular-nums text-[#7c6170]"
                            style={{ top: i === 0 ? 2 : i * PX_PER_HOUR - 6 }}
                          >
                            {`${String(h).padStart(2, '0')}:00`}
                          </div>
                          <div
                            className="absolute right-2 text-[8.5px] font-mono tabular-nums text-[#c2adb6]"
                            style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 - 5 }}
                          >
                            {`${String(h).padStart(2, '0')}:30`}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Sütun alanı */}
                    <div className="relative flex-1">
                      <div className="absolute inset-0" style={{ backgroundImage: hourLineBg }} aria-hidden />

                      {showNow && (
                        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }} aria-hidden>
                          <div className="relative h-px bg-rose-400/80">
                            <span className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]" />
                          </div>
                        </div>
                      )}

                      <div className="relative grid h-full" style={{ gridTemplateColumns: gridTemplate }}>
                        {columns.map((col) => {
                          const laid = packLanes(col.appts)
                          const onLeave = col.id ? leaveIds.has(col.id) : false
                          return (
                            <div
                              key={col.id ?? 'none'}
                              onClick={(e) => handleColumnClick(col, e)}
                              className={`relative border-l border-[#f3e4ea] first:border-l-0 ${onLeave ? 'cursor-not-allowed' : onCreateAt ? 'cursor-copy' : ''}`}
                              style={onLeave ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(244,63,94,0.07) 0, rgba(244,63,94,0.07) 6px, transparent 6px, transparent 12px)' } : undefined}
                              title={onLeave ? 'Bu personel bugün izinli — randevu verilemez' : onCreateAt ? 'Boş saate tıklayıp randevu ekle' : undefined}
                            >
                              {onLeave && laid.length === 0 && (
                                <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50/95 px-2 py-0.5 text-[10px] font-semibold text-rose-500">
                                    <Plane className="h-3 w-3" /> İzinli
                                  </span>
                                </div>
                              )}
                              {laid.map(({ appt, startMin, dur, lane, lanes }) => {
                                const st = statusStyle[appt.status] || statusStyle.bekliyor
                                const top = ((startMin - startHour * 60) / 60) * PX_PER_HOUR
                                const height = Math.max(26, (dur / 60) * PX_PER_HOUR)
                                const widthPct = 100 / lanes
                                const customerPhone = appt.customerPhone || (appt.customerId ? customers?.[appt.customerId]?.phone : undefined)
                                const compact = height < 46
                                return (
                                  <motion.button
                                    key={appt.id}
                                    type="button"
                                    initial={{ opacity: 0, scale: 0.96 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.2 }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onEditAppointment?.(appt.id)
                                    }}
                                    title={`${appt.time} · ${appt.musteri} · ${appt.islem}${appt.personel ? ` · ${appt.personel}` : ''}`}
                                    style={{
                                      top,
                                      height,
                                      left: `calc(${lane * widthPct}% + 2px)`,
                                      width: `calc(${widthPct}% - 4px)`,
                                    }}
                                    className={`group absolute z-[2] flex flex-col overflow-hidden rounded-[10px] border px-2 py-1 text-left shadow-[0_8px_20px_-14px_rgba(120,71,88,0.55)] transition-colors ${st.block}`}
                                  >
                                    <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${st.bar}`} />
                                    <div className={`flex items-center gap-1 pl-1 ${compact ? '' : 'mb-0.5'}`}>
                                      <Clock className="h-2.5 w-2.5 shrink-0 text-[#5d4a56]/70" />
                                      <span className="font-mono text-[10px] font-semibold tabular-nums text-[#3d2f3a]">
                                        {minutesToLabel(startMin)}
                                        {!compact && `–${minutesToLabel(startMin + dur)}`}
                                      </span>
                                    </div>
                                    <div className={`truncate pl-1 text-[12px] font-semibold leading-tight text-[#241923] ${appt.status === 'iptal' ? 'line-through' : ''}`}>
                                      {appt.musteri}
                                    </div>
                                    {!compact && (
                                      <div className="mt-0.5 flex items-center gap-1 pl-1 text-[10px] text-[#5d4a56]/85">
                                        <Scissors className="h-2.5 w-2.5 shrink-0 text-[#c85776]/70" />
                                        <span className="truncate">{appt.islem}</span>
                                      </div>
                                    )}
                                    {!compact && customerPhone && customerPhone !== 'Telefon yok' && (
                                      <div className="truncate pl-1 text-[9px] text-[#8a7480]">{customerPhone}</div>
                                    )}
                                  </motion.button>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* FOOTER */}
            {onCreateAt && (dayAppts.length > 0 || columns.length > 0) && (
              <div className="flex items-center justify-between gap-3 border-t border-[#ead8df]/70 bg-[#fff8fa]/70 px-5 py-3 sm:px-6">
                <span className="hidden text-[11px] text-[#9d7386] sm:block">
                  İpucu: bir randevuya tıklayıp düzenle, boş saate tıklayıp yeni randevu ekle{canManageLeave ? ', personel başlığından izinli yap/kaldır' : ''}.
                </span>
                <button
                  type="button"
                  onClick={() => onCreateAt({ date })}
                  className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4" /> Yeni randevu
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
