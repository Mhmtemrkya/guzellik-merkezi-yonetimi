'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Ban,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GripVertical,
  Hourglass,
  MessageCircle,
  Pencil,
  Percent,
  Phone,
  Plane,
  Plus,
  ReceiptText,
  Scissors,
  Search,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type { Appointment, AppointmentStatusKey, Customer, Staff, StaffTimeOff } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'

// ---------------------------------------------------------------------------
// Durum tonları (saatlik çizelge blokları için)
// ---------------------------------------------------------------------------

interface StatusStyle {
  label: string
  bar: string
  dot: string
  block: string
  chipText: string
  chipBg: string
}

const statusStyle: Record<AppointmentStatusKey, StatusStyle> = {
  tamamlandi: { label: 'Tamamlandı', bar: 'bg-emerald-500', dot: 'bg-emerald-500', block: 'border-emerald-200 bg-emerald-50/95 hover:bg-emerald-50', chipText: 'text-emerald-700', chipBg: 'bg-emerald-50 border-emerald-200' },
  devam: { label: 'Onaylandı', bar: 'bg-sky-500', dot: 'bg-sky-500', block: 'border-sky-200 bg-sky-50/95 hover:bg-sky-50', chipText: 'text-sky-700', chipBg: 'bg-sky-50 border-sky-200' },
  islemde: { label: 'İşlemde', bar: 'bg-violet-500', dot: 'bg-violet-500', block: 'border-violet-300 bg-violet-100/90 hover:bg-violet-100', chipText: 'text-violet-700', chipBg: 'bg-violet-50 border-violet-200' },
  bekliyor: { label: 'Bekliyor', bar: 'bg-amber-400', dot: 'bg-amber-400', block: 'border-amber-200 bg-amber-50/95 hover:bg-amber-50', chipText: 'text-amber-700', chipBg: 'bg-amber-50 border-amber-200' },
  taslak: { label: 'Onay Bekliyor', bar: 'bg-indigo-400', dot: 'bg-indigo-400', block: 'border-dashed border-indigo-300 bg-indigo-50/95 hover:bg-indigo-50', chipText: 'text-indigo-700', chipBg: 'bg-indigo-50 border-indigo-200' },
  iptal: { label: 'İptal', bar: 'bg-rose-400', dot: 'bg-rose-400', block: 'border-rose-200 bg-rose-50/85 opacity-75 hover:opacity-95', chipText: 'text-rose-600', chipBg: 'bg-rose-50 border-rose-200' },
}

const statusOrder: AppointmentStatusKey[] = ['islemde', 'tamamlandi', 'devam', 'bekliyor', 'taslak', 'iptal']

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

function apptDur(a: Appointment): number {
  return Math.max(15, Number(a.sure) || 30)
}

/** Telefon numarasını wa.me formatına çevirir (TR: 0/10 hane → 90…). */
function waLink(phone?: string): string | null {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = `90${d.slice(1)}`
  else if (d.length === 10) d = `90${d}`
  return `https://wa.me/${d}`
}

// Tarih matematiği YEREL bileşenlerle yapılır — `toISOString()` UTC'ye çevirip
// UTC+3'te günü bir kaydırıyordu (örn. "sonraki gün" aynı günde takılıyordu).
function parseIso(iso: string): Date {
  const [y, m, d] = (iso || '').split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayIso(): string {
  return toIso(new Date())
}
/** Bir günü `delta` gün kaydırır (yerel, UTC kaymasız). */
function shiftDayIso(iso: string, delta: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + delta)
  return toIso(d)
}
/** Bir tarihin bir gün öncesi. */
function prevDayIso(iso: string): string {
  return shiftDayIso(iso, -1)
}
/** Ayı `delta` kaydırır; gün-of-month korunur (kısa aylarda son güne sıkışır). */
function monthShiftIso(iso: string, delta: number): string {
  const d = parseIso(iso)
  const first = new Date(d.getFullYear(), d.getMonth() + delta, 1)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  first.setDate(Math.min(d.getDate(), lastDay))
  return toIso(first)
}
/** `iso`'yu içeren Pazartesi-başlangıçlı haftanın 7 günü. */
function weekDaysOf(iso: string): string[] {
  const d = parseIso(iso)
  const dow = (d.getDay() + 6) % 7 // Pzt=0 … Paz=6
  d.setDate(d.getDate() - dow)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d)
    x.setDate(d.getDate() + i)
    return toIso(x)
  })
}
/** `iso`'nun ayındaki tüm günler. */
function monthDaysOf(iso: string): string[] {
  const d = parseIso(iso)
  const y = d.getFullYear()
  const m = d.getMonth()
  const n = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: n }, (_, i) => toIso(new Date(y, m, i + 1)))
}
/** Ay ızgarası: 42 hücre (Pzt başlangıç), her biri ay-içi mi bilgisiyle. */
function monthCellsOf(iso: string): { iso: string; inMonth: boolean }[] {
  const d = parseIso(iso)
  const y = d.getFullYear()
  const m = d.getMonth()
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7
  const gridStart = new Date(y, m, 1 - startPad)
  return Array.from({ length: 42 }, (_, i) => {
    const c = new Date(gridStart)
    c.setDate(gridStart.getDate() + i)
    return { iso: toIso(c), inMonth: c.getMonth() === m }
  })
}
/** "21 – 27 Temmuz 2026" / ay-yıl aşan aralıklarda uygun kısaltma. */
function weekRangeLabel(days: string[]): string {
  if (days.length < 7) return ''
  const a = parseIso(days[0])
  const b = parseIso(days[6])
  const dOnly = new Intl.DateTimeFormat('tr-TR', { day: 'numeric' })
  const dMon = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' })
  const dMonYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
  const full = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${dOnly.format(a)} – ${full.format(b)}`
  if (a.getFullYear() === b.getFullYear()) return `${dMon.format(a)} – ${dMon.format(b)} ${b.getFullYear()}`
  return `${dMonYear.format(a)} – ${full.format(b)}`
}

export type CalView = 'day' | 'week' | 'month'

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
      const dur = apptDur(appt)
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
// KPI kartı
// ---------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  prev,
  prevLabel = 'Dün',
  delta,
  invertDelta,
  tone,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
  prev?: string
  /** Önceki dönem etiketi (Dün / Geçen hafta / Geçen ay). */
  prevLabel?: string
  /** Önceki döneme göre değişim: ok yönü işarete göre; null ise gizlenir. */
  delta?: number | null
  /** true ise azalma "iyi" (ör. İptal) — renk tersine döner. */
  invertDelta?: boolean
  tone: string
}) {
  const good = delta != null && (invertDelta ? delta < 0 : delta > 0)
  return (
    <div className="flex min-w-[150px] flex-1 items-start gap-2.5 rounded-[16px] border border-[#efe1e7] bg-white px-3.5 py-3 shadow-[0_10px_26px_-22px_rgba(200,87,118,0.5)]">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${tone}`}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-[#8a7480]">{label}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="font-display text-[19px] font-bold leading-none text-[#241923]">{value}</span>
          {delta != null && delta !== 0 && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${good ? 'text-emerald-600' : 'text-rose-500'}`}>
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(delta)}
            </span>
          )}
        </div>
        {prev && <div className="mt-0.5 truncate text-[10px] text-[#a58d99]">{prevLabel}: {prev}</div>}
      </div>
    </div>
  )
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
  /** Görüntülenen günü değiştir (üst bardaki ‹ › ile). */
  onChangeDate?: (isoDate: string) => void
  /** Taslak randevuyu onayla (yalnızca yönetici). */
  onApprove?: (id: string) => void | Promise<void>
  /** Randevuyu "Şu an işlemde" yap (müşteri koltukta) — çizelgede mor kart. */
  onStartService?: (id: string) => void | Promise<void>
  /** İşlemi bitir → Tamamlandı (seans düşer; bekleyen satış varsa cariye işlenir). */
  onComplete?: (id: string) => void | Promise<void>
  /** Randevuyu iptal et (yalnızca yönetici). */
  onCancel?: (id: string) => void | Promise<void>
  /** Seçilen randevunun müşterisinin açık adisyonunu getir (panelde ödeme/cari için). */
  loadOpenAdisyon?: (customerId: string) => Promise<{ chargeTotal: number; paymentTotal: number } | null>
  /** Müşterinin adisyon kartını modal olarak aç (kalem/satış, ödeme/peşinat, onay, silme). */
  onOpenAdisyon?: (customerId: string, customerName?: string) => void
  /** Aktif bekleme listesi (sağ ray "Bekleme Listesi" kartı). */
  waitlist?: WaitlistLite[]
  /** Sürükle-bırak ile randevu saatini (ve farklı sütuna bırakınca personelini) değiştir; süre korunur. */
  onReschedule?: (id: string, info: { date: string; time: string; durationMin: number; staffId?: string | null }) => void | Promise<void>
}

export interface WaitlistLite {
  id: string
  customerName: string
  serviceName?: string
  preferredDate?: string
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
  onChangeDate,
  onApprove,
  onStartService,
  onComplete,
  onCancel,
  loadOpenAdisyon,
  onOpenAdisyon,
  waitlist,
  onReschedule,
}: DayScheduleModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Görünüm modu: Gün (saatlik personel çizelgesi) · Hafta · Ay
  const [view, setView] = useState<CalView>('day')
  const [staffFilter, setStaffFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<AppointmentStatusKey | ''>('')
  const [search, setSearch] = useState('')
  const [chipBos, setChipBos] = useState(false)
  const [chipOnaysiz, setChipOnaysiz] = useState(false)
  const [chipVip, setChipVip] = useState(false)
  const [chipOdeme, setChipOdeme] = useState(false)
  // Seçilen randevunun açık adisyonu (panel ödeme kutusu için, on-demand yüklenir).
  const [payment, setPayment] = useState<{ chargeTotal: number; paymentTotal: number } | null | 'loading'>(null)
  // Sürükle-bırak: taşınan randevu + üzerinde gezilen sütun/konum göstergesi.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropInfo, setDropInfo] = useState<{ colKey: string; startMin: number } | null>(null)
  // Portal ile body'ye taşımak için (sidebar dahil her şeyin önünde) — SSR guard.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

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

  // Gün / görünüm değişince seçim temizle; kapanınca filtre + görünüm sıfırla
  useEffect(() => {
    setSelectedId(null)
  }, [date, view])
  useEffect(() => {
    if (!open) {
      setView('day')
      setStaffFilter('')
      setStatusFilter('')
      setSearch('')
      setChipBos(false)
      setChipOnaysiz(false)
      setChipVip(false)
      setChipOdeme(false)
    }
  }, [open])

  const dayAppts = useMemo(
    () => (date ? appointments.filter((a) => a.date === date) : []),
    [appointments, date],
  )

  // Aktif görünümün kapsadığı günler (Gün: tek gün · Hafta: 7 gün · Ay: ayın günleri)
  // ve önceki eşdeğer dönem (KPI karşılaştırması için).
  const curDays = useMemo(
    () => (!date ? [] : view === 'day' ? [date] : view === 'week' ? weekDaysOf(date) : monthDaysOf(date)),
    [date, view],
  )
  const prevDays = useMemo(
    () =>
      !date
        ? []
        : view === 'day'
          ? [prevDayIso(date)]
          : view === 'week'
            ? weekDaysOf(shiftDayIso(date, -7))
            : monthDaysOf(monthShiftIso(date, -1)),
    [date, view],
  )
  const curDaySet = useMemo(() => new Set(curDays), [curDays])
  // Görünen aralıktaki tüm randevular (hafta/ay). Gün görünümü dayAppts kullanır.
  const rangeAppts = useMemo(() => appointments.filter((a) => curDaySet.has(a.date)), [appointments, curDaySet])
  const scopeAppts = view === 'day' ? dayAppts : rangeAppts

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

  const custOf = (a: Appointment): Customer | undefined => (a.customerId ? customers?.[a.customerId] : undefined)
  // VIP: öncelikle randevu DTO'sundan (a.isVip), yoksa lookup'tan.
  const isVipAppt = (a: Appointment): boolean => Boolean(a.isVip || custOf(a)?.isVip)
  // Müşterinin cari borcu var mı? (ödeme bekliyor göstergesi + filtre)
  const hasDebt = (a: Appointment): boolean => { const c = custOf(a); return Boolean(c && c.debt > 0) }

  // Sütunlar: küçük ekiplerde tüm aktif personel (müsaitlik görünür),
  // büyük ekiplerde yalnızca o gün randevusu olanlar + atanmamışlar.
  const columns = useMemo<ColumnDef[]>(() => {
    const activeStaff = staff.filter((s) => s.active)
    const busyIds = new Set(dayAppts.map((a) => a.staffMemberId).filter(Boolean) as string[])
    const baseStaff = activeStaff.length <= 10 ? activeStaff : activeStaff.filter((s) => busyIds.has(s.id))
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

  // Personel filtresi uygulanmış görünen sütunlar
  const visibleColumns = useMemo(
    () => (staffFilter ? columns.filter((c) => c.id === staffFilter) : columns),
    [columns, staffFilter],
  )

  // Personel filtresi seçenekleri: Gün'de o günün sütunları, Hafta/Ay'da tüm aktif personel.
  const staffChoices = useMemo<{ id: string; name: string }[]>(
    () =>
      view === 'day'
        ? columns.filter((c) => c.id !== null).map((c) => ({ id: c.id as string, name: c.name }))
        : staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
    [view, columns, staff],
  )

  // Zaman penceresi (en erken/en geç randevuya göre, en az 09–19)
  const { startHour, endHour, hours } = useMemo(() => {
    let minS = 9 * 60
    let maxE = 19 * 60
    for (const a of dayAppts) {
      const s = parseMinutes(a.time)
      const e = s + apptDur(a)
      minS = Math.min(minS, s)
      maxE = Math.max(maxE, e)
    }
    const sh = Math.max(6, Math.min(9, Math.floor(minS / 60)))
    let eh = Math.min(24, Math.max(19, Math.ceil(maxE / 60)))
    if (eh <= sh) eh = sh + 1
    return { startHour: sh, endHour: eh, hours: Array.from({ length: eh - sh }, (_, i) => sh + i) }
  }, [dayAppts])

  const gridHeight = (endHour - startHour) * PX_PER_HOUR
  const workMin = (endHour - startHour) * 60

  // ---- KPI hesapları (aktif görünüm dönemine göre) ----
  const metricsForDays = useCallback(
    (days: string[]) => {
      const set = new Set(days)
      const list = appointments.filter((a) => set.has(a.date))
      return {
        randevu: list.filter((a) => a.status !== 'iptal').length,
        completed: list.filter((a) => a.status === 'tamamlandi').length,
        iptal: list.filter((a) => a.status === 'iptal').length,
        onay: list.filter((a) => a.status === 'taslak').length,
        gelir: list.filter((a) => a.status !== 'iptal').reduce((s, a) => s + (Number(a.price) || 0), 0),
        bookedMin: list.filter((a) => a.status !== 'iptal').reduce((s, a) => s + apptDur(a), 0),
      }
    },
    [appointments],
  )
  const cur = useMemo(() => metricsForDays(curDays), [metricsForDays, curDays])
  const prev = useMemo(() => metricsForDays(prevDays), [metricsForDays, prevDays])

  // Gün görünümü: boş slot + doluluk (personel kapasitesine göre).
  const workingCols = columns.filter((c) => c.id !== null && !leaveIds.has(c.id as string))
  const capMin = Math.max(1, workingCols.length * workMin)
  const slotCap = Math.max(1, workingCols.length * Math.floor(workMin / 30))
  const bookedSlots = dayAppts.filter((a) => a.status !== 'iptal').reduce((s, a) => s + Math.ceil(apptDur(a) / 30), 0)
  const bosSlot = Math.max(0, slotCap - bookedSlots)
  const occCur = Math.round(Math.min(1, cur.bookedMin / capMin) * 100)
  const occPrev = Math.round(Math.min(1, prev.bookedMin / capMin) * 100)
  // Hafta/ay görünümü: tamamlanma oranı (halkalı KPI kartı için).
  const complCur = Math.round((cur.completed / Math.max(1, cur.randevu)) * 100)
  const complPrev = Math.round((prev.completed / Math.max(1, prev.randevu)) * 100)

  // Görünüme göre etiketler + halka kartı verisi.
  const prevLabel = view === 'day' ? 'Dün' : view === 'week' ? 'Geçen hafta' : 'Geçen ay'
  const rangeLabel = view === 'day' ? 'Bugünkü' : view === 'week' ? 'Haftalık' : 'Aylık'
  const ringLabel = view === 'day' ? 'Doluluk Oranı' : 'Tamamlanma'
  const ringPct = view === 'day' ? occCur : complCur
  const ringPrevPct = view === 'day' ? occPrev : complPrev

  // Personel başına doluluk %
  const colOcc = (col: ColumnDef): number | null => {
    if (col.id === null) return null
    const b = col.appts.filter((a) => a.status !== 'iptal').reduce((s, a) => s + apptDur(a), 0)
    return Math.round(Math.min(1, b / Math.max(1, workMin)) * 100)
  }

  // Bugünün "şimdi" çizgisi (yerel tarih — UTC kaymasız)
  const todayKey = todayIso()
  const isToday = date === todayKey
  const isTodayInView = curDaySet.has(todayKey)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const nowTop = ((nowMin - startHour * 60) / 60) * PX_PER_HOUR
  const showNow = isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60

  const counts = useMemo(() => {
    const c: Record<AppointmentStatusKey, number> = { tamamlandi: 0, devam: 0, bekliyor: 0, taslak: 0, iptal: 0, islemde: 0 }
    for (const a of scopeAppts) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [scopeAppts])

  // Yaklaşan hatırlatmalar: kapsamdaki aktif randevulardan henüz hatırlatma gönderilmemiş olanlar.
  const reminders = useMemo(
    () =>
      scopeAppts
        .filter((a) => (a.status === 'devam' || a.status === 'bekliyor' || a.status === 'taslak') && !a.lastReminderAtUtc)
        .sort((a, b) => a.date.localeCompare(b.date) || parseMinutes(a.time) - parseMinutes(b.time))
        .slice(0, 6),
    [scopeAppts],
  )

  // No-show riski: bugünkü randevusu olan müşterilerin yüklü kapsamdaki geçmiş gelmedi/iptal sayısı.
  const noShowRisk = useMemo(() => {
    const score = new Map<string, { name: string; noshow: number; cancel: number }>()
    for (const a of appointments) {
      if (!a.customerId) continue
      const raw = a.rawStatus
      if (raw !== 'NoShow' && raw !== 'Cancelled') continue
      const e = score.get(a.customerId) || { name: a.musteri, noshow: 0, cancel: 0 }
      if (raw === 'NoShow') e.noshow++
      else e.cancel++
      e.name = a.musteri || e.name
      score.set(a.customerId, e)
    }
    const scopeCustIds = new Set(scopeAppts.filter((a) => a.status !== 'iptal' && a.customerId).map((a) => a.customerId as string))
    return [...score.entries()]
      .filter(([id]) => scopeCustIds.has(id))
      .map(([id, e]) => ({ id, name: e.name, noshow: e.noshow, cancel: e.cancel, weight: e.noshow * 2 + e.cancel }))
      .filter((r) => r.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
  }, [appointments, scopeAppts])

  const dateObj = date ? parseIso(date) : null
  const dayTitleLabel = dateObj
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj)
    : ''
  const weekdayLabel = dateObj ? new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(dateObj) : ''
  const monthTitleLabel = dateObj
    ? new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(dateObj)
    : ''
  // Üst bar başlığı + alt satırı görünüme göre.
  const headTitle = view === 'day' ? dayTitleLabel : view === 'week' ? weekRangeLabel(curDays) : monthTitleLabel
  const headSubtitle =
    view === 'day'
      ? `${weekdayLabel} · saatlik personel çizelgesi`
      : view === 'week'
        ? `Haftalık çizelge · ${scopeAppts.length} randevu`
        : `Aylık genel görünüm · ${scopeAppts.length} randevu`
  const badgeLabel = view === 'day' ? 'Bugün' : view === 'week' ? 'Bu hafta' : 'Bu ay'

  const gridTemplate = `repeat(${visibleColumns.length}, minmax(184px, 1fr))`
  const innerMinWidth = 64 + visibleColumns.length * 200

  const hourLineBg = `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2}px)`

  // Durum/arama/rozet filtreleri (personel hariç — o, gün görünümünde sütunla, hafta/ayda sert filtreyle uygulanır)
  const passesSoft = (a: Appointment): boolean => {
    if (statusFilter && a.status !== statusFilter) return false
    if (chipOnaysiz && a.status !== 'taslak') return false
    if (chipVip && !isVipAppt(a)) return false
    if (chipOdeme && !hasDebt(a)) return false
    const q = search.trim().toLocaleLowerCase('tr')
    if (q && !`${a.musteri} ${a.islem} ${a.personel}`.toLocaleLowerCase('tr').includes(q)) return false
    return true
  }
  // Gün görünümü: uymayan bloklar soluklaşır (chipBos ile tümü soluk = boş slotları vurgula).
  const matches = (a: Appointment): boolean => {
    if (chipBos) return false
    return passesSoft(a)
  }
  // Hafta/ay görünümü: sert filtre (personel dahil) — yalnızca uyanlar gösterilir.
  const rangeFilter = (a: Appointment): boolean => {
    if (staffFilter && a.staffMemberId !== staffFilter) return false
    return passesSoft(a)
  }
  const anyFilter =
    chipBos || chipOnaysiz || chipVip || chipOdeme || Boolean(statusFilter) || Boolean(search.trim()) || Boolean(staffFilter)
  const debtCount = scopeAppts.filter((a) => hasDebt(a)).length

  const selectedAppt = selectedId ? scopeAppts.find((a) => a.id === selectedId) || null : null

  // Seçim değişince müşterinin açık adisyonunu getir (gerçek ödeme/cari — boş lookup'a bağlı değil).
  const selectedCustomerId = selectedAppt?.customerId
  useEffect(() => {
    if (!selectedCustomerId || !loadOpenAdisyon) {
      setPayment(null)
      return
    }
    let alive = true
    setPayment('loading')
    loadOpenAdisyon(selectedCustomerId)
      .then((r) => { if (alive) setPayment(r) })
      .catch(() => { if (alive) setPayment(null) })
    return () => {
      alive = false
    }
  }, [selectedCustomerId, loadOpenAdisyon])

  const handleColumnClick = (col: ColumnDef, e: React.MouseEvent<HTMLDivElement>): void => {
    if (!onCreateAt || !date) return
    if (col.id && leaveIds.has(col.id)) return
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const raw = startHour * 60 + (y / PX_PER_HOUR) * 60
    const snapped = Math.max(startHour * 60, Math.round(raw / 15) * 15)
    onCreateAt({ date, time: minutesToLabel(snapped), staffId: col.id ?? undefined })
  }

  // Sürükle-bırak: yönetici + reschedule geri çağrısı gerekli; iptal/tamamlanan taşınamaz.
  const canDrag = Boolean(onReschedule) && !isStaffUser
  const dragAllowed = (a: Appointment): boolean => canDrag && a.status !== 'iptal' && a.status !== 'tamamlandi'

  // Bir sütun üzerindeki fare Y'sinden 15dk'ya yuvarlanmış başlangıç dakikasını hesapla.
  const snappedMinFrom = (e: React.DragEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const raw = startHour * 60 + (y / PX_PER_HOUR) * 60
    return Math.max(startHour * 60, Math.min(endHour * 60 - 15, Math.round(raw / 15) * 15))
  }

  const handleDrop = (col: ColumnDef, e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDropInfo(null)
    const id = draggingId
    setDraggingId(null)
    if (!id || !date || !onReschedule) return
    if (col.id && leaveIds.has(col.id)) return // izinli sütuna bırakma
    const moved = dayAppts.find((a) => a.id === id)
    if (!moved) return
    const startMin = snappedMinFrom(e)
    // Farklı personel sütununa bırakınca aktar (Atanmamış sütununa aktarma yok).
    const newStaffId = col.id && col.id !== moved.staffMemberId ? col.id : undefined
    const timeSame = minutesToLabel(startMin) === moved.time
    if (timeSame && !newStaffId) return // konum değişmedi
    void onReschedule(id, { date, time: minutesToLabel(startMin), durationMin: apptDur(moved), staffId: newStaffId })
  }

  const overlay = (
    <AnimatePresence>
      {open && date && (
        <motion.div
          key="day-schedule-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
          className="fixed inset-0 z-[200] flex items-stretch justify-center bg-[#4a2335]/30 p-2 backdrop-blur-md sm:p-3"
        >
          <motion.div
            key="day-schedule-panel"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-full w-full max-w-[1680px] flex-col overflow-hidden rounded-[22px] border border-[#ead8df]/80 bg-white shadow-[0_50px_140px_-40px_rgba(120,71,88,0.6)]"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-gradient-to-r from-transparent via-[#f0aac2] to-transparent" />

            {/* ===================== ÜST BAR ===================== */}
            <div className="relative z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#ead8df]/70 bg-gradient-to-b from-white to-[#fff9fb] px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#f8d8e2] bg-gradient-to-br from-[#fff2f6] to-[#ffd9e4] text-[#c85776] shadow-[0_12px_28px_-18px_rgba(190,91,125,0.9)]">
                  <CalendarDays className="h-5 w-5" strokeWidth={1.7} />
                </span>
                {onChangeDate && (
                  <button type="button" onClick={() => onChangeDate(view === 'day' ? shiftDayIso(date, -1) : view === 'week' ? shiftDayIso(date, -7) : monthShiftIso(date, -1))} className="grid h-8 w-8 place-items-center rounded-full border border-[#ead8df] bg-white text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]" aria-label={view === 'day' ? 'Önceki gün' : view === 'week' ? 'Önceki hafta' : 'Önceki ay'}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-[20px] font-bold leading-none tracking-tight text-[#241923]">{headTitle}</h2>
                    {isTodayInView && <span className="rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2 py-0.5 text-[10px] font-semibold text-[#c85776]">{badgeLabel}</span>}
                  </div>
                  <div className="mt-1 text-[11.5px] capitalize text-[#8a7480]">{headSubtitle}</div>
                </div>
                {onChangeDate && (
                  <button type="button" onClick={() => onChangeDate(view === 'day' ? shiftDayIso(date, 1) : view === 'week' ? shiftDayIso(date, 7) : monthShiftIso(date, 1))} className="grid h-8 w-8 place-items-center rounded-full border border-[#ead8df] bg-white text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]" aria-label={view === 'day' ? 'Sonraki gün' : view === 'week' ? 'Sonraki hafta' : 'Sonraki ay'}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Görünüm sekmeleri — Gün · Hafta · Ay (modal içinde geçiş yapar) */}
                <div className="flex items-center rounded-full border border-[#ead8df] bg-white p-0.5">
                  {([['day', 'Gün'], ['week', 'Hafta'], ['month', 'Ay']] as [CalView, string][]).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      aria-pressed={view === v}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${view === v ? 'bg-[#c85776] text-white shadow-[0_6px_14px_-8px_rgba(200,87,118,0.9)]' : 'text-[#9d7386] hover:text-[#c85776]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Arama */}
                <div className="relative hidden sm:block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#c85776]/60" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Müşteri, hizmet, personel…"
                    className="w-52 rounded-full border border-[#ead8df] bg-white py-1.5 pl-8 pr-3 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]"
                  />
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df] bg-white text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:bg-[#fff7fa] hover:text-[#c85776]"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ===================== KPI ŞERİDİ ===================== */}
            <div className="flex shrink-0 items-stretch gap-2.5 overflow-x-auto border-b border-[#ead8df]/70 bg-[#fffafc] px-4 py-3 sm:px-5">
              <KpiCard icon={CalendarDays} label={`${rangeLabel} Randevu`} value={String(cur.randevu)} prev={String(prev.randevu)} prevLabel={prevLabel} delta={cur.randevu - prev.randevu} tone="bg-[#fbeaf1] text-[#c85776]" />
              {view === 'day' ? (
                <KpiCard icon={CalendarClock} label="Boş Slot" value={String(bosSlot)} tone="bg-sky-50 text-sky-600" />
              ) : (
                <KpiCard icon={CheckCircle2} label="Tamamlandı" value={String(cur.completed)} prev={String(prev.completed)} prevLabel={prevLabel} delta={cur.completed - prev.completed} tone="bg-emerald-50 text-emerald-600" />
              )}
              <KpiCard icon={Hourglass} label="Bekleyen Onay" value={String(cur.onay)} prev={String(prev.onay)} prevLabel={prevLabel} delta={cur.onay - prev.onay} tone="bg-amber-50 text-amber-600" />
              <KpiCard icon={Ban} label="İptal" value={String(cur.iptal)} prev={String(prev.iptal)} prevLabel={prevLabel} delta={cur.iptal - prev.iptal} invertDelta tone="bg-rose-50 text-rose-500" />
              <KpiCard icon={Wallet} label="Gelir Tahmini" value={formatTL(cur.gelir)} prev={formatTL(prev.gelir)} prevLabel={prevLabel} tone="bg-emerald-50 text-emerald-600" />
              {/* Doluluk (gün) / Tamamlanma (hafta·ay) — halkalı */}
              <div className="flex min-w-[150px] flex-1 items-center gap-3 rounded-[16px] border border-[#efe1e7] bg-white px-3.5 py-3 shadow-[0_10px_26px_-22px_rgba(200,87,118,0.5)]">
                <div className="relative grid h-11 w-11 shrink-0 place-items-center">
                  <svg viewBox="0 0 36 36" className="h-11 w-11 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f3e4ea" strokeWidth="4" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#2f9e72" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(ringPct / 100) * 97.4} 97.4`} />
                  </svg>
                  <Percent className="absolute h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-[#8a7480]">{ringLabel}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="font-display text-[19px] font-bold leading-none text-[#241923]">%{ringPct}</span>
                    {ringPct - ringPrevPct !== 0 && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${ringPct - ringPrevPct > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {ringPct - ringPrevPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {Math.abs(ringPct - ringPrevPct)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-[#a58d99]">{prevLabel}: %{ringPrevPct}</div>
                </div>
              </div>
            </div>

            {/* ===================== FİLTRE ŞERİDİ ===================== */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#ead8df]/70 bg-white px-4 py-2.5 sm:px-5">
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]"
              >
                <option value="">Personel: Tümü</option>
                {staffChoices.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AppointmentStatusKey | '')}
                className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]"
              >
                <option value="">Durum: Tümü</option>
                {statusOrder.map((k) => (
                  <option key={k} value={k}>{statusStyle[k].label}</option>
                ))}
              </select>
              {view === 'day' && (
                <button type="button" onClick={() => setChipBos((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${chipBos ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-[#ead8df] bg-white text-[#8a7480] hover:border-[#efbfd0]'}`}>
                  <CalendarClock className="h-3.5 w-3.5" /> Sadece boş slotlar
                </button>
              )}
              <button type="button" onClick={() => setChipOnaysiz((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${chipOnaysiz ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-[#ead8df] bg-white text-[#8a7480] hover:border-[#efbfd0]'}`}>
                Onaysız {cur.onay > 0 && <span className="rounded-full bg-indigo-500 px-1.5 text-[9px] text-white">{cur.onay}</span>}
              </button>
              <button type="button" onClick={() => setChipVip((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${chipVip ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#ead8df] bg-white text-[#8a7480] hover:border-[#efbfd0]'}`}>
                <Star className="h-3.5 w-3.5" /> VIP müşteriler
              </button>
              {debtCount > 0 && (
                <button type="button" onClick={() => setChipOdeme((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${chipOdeme ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-[#ead8df] bg-white text-[#8a7480] hover:border-[#efbfd0]'}`}>
                  <Wallet className="h-3.5 w-3.5" /> Ödeme bekleyenler <span className="rounded-full bg-rose-500 px-1.5 text-[9px] text-white">{debtCount}</span>
                </button>
              )}
              {anyFilter && (
                <button type="button" onClick={() => { setStaffFilter(''); setStatusFilter(''); setSearch(''); setChipBos(false); setChipOnaysiz(false); setChipVip(false); setChipOdeme(false) }} className="ml-auto text-[11px] font-semibold text-[#c85776] hover:underline">
                  Filtreleri temizle
                </button>
              )}
            </div>

            {/* ===================== GÖVDE: takvim + detay ===================== */}
            <div className="flex min-h-0 flex-1">
              {/* Takvim */}
              <div className="relative min-w-0 flex-1 overflow-auto">
                {view === 'day' ? (
                  dayAppts.length === 0 && columns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full border border-[#f3d7e0] bg-[#fff4f8] text-[#c85776]">
                      <Clock className="h-6 w-6" strokeWidth={1.6} />
                    </span>
                    <div className="font-display text-lg text-[#241923]">Bu günde randevu yok</div>
                    <div className="max-w-xs text-[12px] text-[#8a7480]">Boş bir güne hızlıca randevu ekleyebilirsin.</div>
                    {onCreateAt && (
                      <button type="button" onClick={() => onCreateAt({ date })} className="mt-1 inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                        <Plus className="h-4 w-4" /> Yeni randevu
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ minWidth: innerMinWidth }}>
                    {/* Personel başlık satırı (sticky) — dikey merkezli kart */}
                    <div className="sticky top-0 z-20 flex border-b border-[#ead8df]/70 bg-gradient-to-b from-white to-[#fff9fb]/95 backdrop-blur">
                      <div className="grid w-16 shrink-0 place-items-center border-r border-[#f3e4ea] text-[#c9aeba]">
                        <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </div>
                      <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
                        {visibleColumns.map((col) => {
                          const onLeave = col.id ? leaveIds.has(col.id) : false
                          const occ = colOcc(col)
                          return (
                            <div key={col.id ?? 'none'} className={`group/hd relative flex flex-col items-center gap-1.5 border-l border-[#f3e4ea] px-2.5 py-3 text-center transition-colors first:border-l-0 ${onLeave ? 'bg-rose-50/50' : 'hover:bg-[#fff7fa]'}`}>
                              {col.id && canManageLeave ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => { if (col.id && date) onToggleLeave?.(col.id, date, onLeave) }}
                                  title={onLeave ? 'İzni kaldır — randevuya yeniden açılır' : 'Bu personeli bugün izinli yap'}
                                  aria-label={onLeave ? 'İzni kaldır' : 'İzinli yap'}
                                  className={`absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-50 ${onLeave ? 'border-rose-200 bg-rose-100 text-rose-600 hover:bg-rose-200' : 'border-[#ead8df] bg-white/85 text-[#c2a2b0] hover:border-[#efbfd0] hover:bg-[#fff1f6] hover:text-[#c85776]'}`}
                                >
                                  {onLeave ? <X className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
                                </button>
                              ) : (
                                onLeave && (
                                  <span title="İzinli" className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border border-rose-200 bg-rose-50 text-rose-500">
                                    <Plane className="h-3 w-3" />
                                  </span>
                                )
                              )}
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
                              <div className="flex min-h-[34px] w-full items-center justify-center">
                                <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-[#241923]" title={col.name}>{col.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {col.role && col.id !== null && (
                                  <span className="max-w-[86px] truncate rounded-full bg-[#f4edf0] px-1.5 py-0.5 text-[9px] font-medium text-[#9d8592]" title={col.role}>{col.role}</span>
                                )}
                                {occ != null && (
                                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ${occ >= 80 ? 'bg-emerald-50 text-emerald-600' : occ >= 40 ? 'bg-amber-50 text-amber-600' : 'bg-[#f4edf0] text-[#a58d99]'}`}>%{occ}</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Zaman ekseni + sütunlar */}
                    <div className="relative flex" style={{ height: gridHeight }}>
                      <div className="relative w-16 shrink-0 border-r border-[#f3e4ea]">
                        {hours.map((h, i) => (
                          <div key={h}>
                            <div className="absolute right-2 text-[10px] font-mono font-semibold tabular-nums text-[#7c6170]" style={{ top: i === 0 ? 2 : i * PX_PER_HOUR - 6 }}>
                              {`${String(h).padStart(2, '0')}:00`}
                            </div>
                            <div className="absolute right-2 text-[8.5px] font-mono tabular-nums text-[#c2adb6]" style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 - 5 }}>
                              {`${String(h).padStart(2, '0')}:30`}
                            </div>
                          </div>
                        ))}
                      </div>

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
                          {visibleColumns.map((col) => {
                            const laid = packLanes(col.appts)
                            const onLeave = col.id ? leaveIds.has(col.id) : false
                            const colKey = col.id ?? 'none'
                            return (
                              <div
                                key={colKey}
                                onClick={(e) => handleColumnClick(col, e)}
                                onDragOver={draggingId && !onLeave ? (e) => { e.preventDefault(); setDropInfo({ colKey, startMin: snappedMinFrom(e) }) } : undefined}
                                onDragLeave={draggingId ? () => setDropInfo((d) => (d?.colKey === colKey ? null : d)) : undefined}
                                onDrop={draggingId ? (e) => handleDrop(col, e) : undefined}
                                className={`relative border-l border-[#f3e4ea] first:border-l-0 ${onLeave ? 'cursor-not-allowed' : onCreateAt ? 'cursor-copy' : ''} ${draggingId && dropInfo?.colKey === colKey ? 'bg-[#fff1f6]/50' : ''}`}
                                style={onLeave ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(244,63,94,0.07) 0, rgba(244,63,94,0.07) 6px, transparent 6px, transparent 12px)' } : undefined}
                                title={onLeave ? 'Bu personel bugün izinli — randevu verilemez' : onCreateAt ? 'Boş saate tıklayıp randevu ekle' : undefined}
                              >
                                {/* Sürükle-bırak bırakma göstergesi */}
                                {draggingId && !onLeave && dropInfo?.colKey === colKey && (
                                  <div className="pointer-events-none absolute inset-x-1 z-[4]" style={{ top: ((dropInfo.startMin - startHour * 60) / 60) * PX_PER_HOUR }} aria-hidden>
                                    <div className="relative h-0.5 rounded bg-[#c85776]">
                                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#c85776]" />
                                      <span className="absolute -top-4 left-1 rounded bg-[#c85776] px-1.5 py-0.5 text-[9px] font-bold text-white">{minutesToLabel(dropInfo.startMin)}</span>
                                    </div>
                                  </div>
                                )}
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
                                  const compact = height < 46
                                  const vip = isVipAppt(appt)
                                  const debt = hasDebt(appt)
                                  const dim = anyFilter && !matches(appt)
                                  const isSel = selectedId === appt.id
                                  const canDragThis = dragAllowed(appt)
                                  const isDragging = draggingId === appt.id
                                  return (
                                    <button
                                      key={appt.id}
                                      type="button"
                                      draggable={canDragThis}
                                      onDragStart={canDragThis ? (e) => { e.stopPropagation(); setDraggingId(appt.id); setSelectedId(appt.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', appt.id) } catch { /* noop */ } } : undefined}
                                      onDragEnd={canDragThis ? () => { setDraggingId(null); setDropInfo(null) } : undefined}
                                      onClick={(e) => { e.stopPropagation(); setSelectedId(appt.id) }}
                                      title={`${appt.time} · ${appt.musteri} · ${appt.islem}${appt.personel ? ` · ${appt.personel}` : ''}${canDragThis ? ' · sürükle: saat/personel değiştir' : ''}`}
                                      style={{ top, height, left: `calc(${lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, opacity: isDragging ? 0.35 : dim ? 0.24 : 1 }}
                                      className={`group absolute z-[2] flex flex-col overflow-hidden rounded-[10px] border px-2 py-1 text-left shadow-[0_8px_20px_-14px_rgba(120,71,88,0.55)] transition-all ${st.block} ${isSel ? 'z-[3] ring-2 ring-[#c85776] ring-offset-1' : ''} ${canDragThis ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                    >
                                      <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${st.bar}`} />
                                      <div className={`flex items-center gap-1 pl-1 ${compact ? '' : 'mb-0.5'}`}>
                                        <Clock className="h-2.5 w-2.5 shrink-0 text-[#5d4a56]/70" />
                                        <span className="font-mono text-[10px] font-semibold tabular-nums text-[#3d2f3a]">
                                          {minutesToLabel(startMin)}
                                          {!compact && `–${minutesToLabel(startMin + dur)}`}
                                        </span>
                                        {(vip || debt) && (
                                          <span className="ml-auto flex shrink-0 items-center gap-0.5">
                                            {debt && <span title="Ödeme bekliyor" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                                            {vip && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />}
                                          </span>
                                        )}
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
                                      {!compact && appt.price > 0 && (
                                        <div className="truncate pl-1 text-[9.5px] font-medium text-[#8a7480]">{formatTL(appt.price)} · {dur} dk</div>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                  )
                ) : view === 'week' ? (
                  <WeekView
                    days={curDays}
                    appts={rangeAppts}
                    todayKey={todayKey}
                    filter={rangeFilter}
                    isVip={isVipAppt}
                    hasDebt={hasDebt}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onOpenDay={(iso) => { onChangeDate?.(iso); setView('day') }}
                    onCreateAt={onCreateAt}
                  />
                ) : (
                  <MonthView
                    cells={monthCellsOf(date)}
                    appts={rangeAppts}
                    todayKey={todayKey}
                    filter={rangeFilter}
                    isVip={isVipAppt}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onOpenDay={(iso) => { onChangeDate?.(iso); setView('day') }}
                    onCreateAt={onCreateAt}
                  />
                )}
              </div>

              {/* Detay paneli */}
              <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-[#ead8df]/70 bg-[#fffafc] lg:flex">
                {selectedAppt ? (
                  <DetailPanel
                    appt={selectedAppt}
                    customer={selectedAppt.customerId ? customers?.[selectedAppt.customerId] : undefined}
                    payment={payment}
                    canManage={!isStaffUser}
                    onEdit={onEditAppointment}
                    onApprove={onApprove}
                    onStartService={onStartService}
                    onComplete={onComplete}
                    onCancel={onCancel}
                    onOpenAdisyon={onOpenAdisyon}
                    onClose={() => setSelectedId(null)}
                  />
                ) : (
                  <DaySummary
                    title={view === 'day' ? 'Günün Özeti' : view === 'week' ? 'Haftanın Özeti' : 'Ayın Özeti'}
                    counts={counts}
                    total={scopeAppts.length}
                    reminders={reminders}
                    noShowRisk={noShowRisk}
                    waitlist={waitlist}
                    onSelect={setSelectedId}
                    onCreate={onCreateAt && date ? () => onCreateAt({ date }) : undefined}
                  />
                )}
              </aside>
            </div>

            {/* ===================== ALT BAR ===================== */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 bg-[#fff8fa]/80 px-4 py-2.5 sm:px-5">
              <div className="flex flex-wrap items-center gap-3">
                {statusOrder.map((k) => (
                  <span key={k} className="flex items-center gap-1.5 text-[10px] text-[#8a7480]">
                    <span className={`h-2 w-2 rounded-full ${statusStyle[k].dot}`} /> {statusStyle[k].label}
                  </span>
                ))}
                {canDrag && view === 'day' && (
                  <span className="hidden items-center gap-1.5 rounded-full border border-[#ead8df] bg-white px-2 py-0.5 text-[10px] font-medium text-[#9d7386] md:inline-flex">
                    <GripVertical className="h-3 w-3 text-[#c85776]" /> Sürükle: saat değiştir · farklı sütun = personel aktar
                  </span>
                )}
              </div>
              {onCreateAt && (
                <button type="button" onClick={() => onCreateAt({ date })} className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                  <Plus className="h-4 w-4" /> Yeni randevu
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  // Portal ile body'ye render: içerik alanının (main z-10) stacking bağlamından
  // çıkar, böylece z-[200] sidebar (z-30) dahil her şeyin önünde kalır.
  return mounted ? createPortal(overlay, document.body) : null
}

// ---------------------------------------------------------------------------
// Sağ detay paneli
// ---------------------------------------------------------------------------

function DetailPanel({
  appt,
  customer,
  payment,
  canManage,
  onEdit,
  onApprove,
  onStartService,
  onComplete,
  onCancel,
  onOpenAdisyon,
  onClose,
}: {
  appt: Appointment
  customer?: Customer
  payment?: { chargeTotal: number; paymentTotal: number } | null | 'loading'
  canManage: boolean
  onEdit?: (id: string) => void
  onApprove?: (id: string) => void | Promise<void>
  onStartService?: (id: string) => void | Promise<void>
  onComplete?: (id: string) => void | Promise<void>
  onCancel?: (id: string) => void | Promise<void>
  onOpenAdisyon?: (customerId: string, customerName?: string) => void
  onClose: () => void
}) {
  const st = statusStyle[appt.status] || statusStyle.bekliyor
  const startMin = parseMinutes(appt.time)
  const dur = apptDur(appt)
  const wa = waLink(appt.customerPhone || customer?.phone)
  // Sıralı randevu no (backend); eski kayıtlarda yoksa id'den türetilen kısa kod.
  const shortNo = appt.number != null
    ? `#RNDV-${appt.number}`
    : `#RNDV-${(appt.id.replace(/[^0-9a-fA-F]/g, '').slice(-6) || appt.id.slice(0, 6)).toUpperCase()}`
  const dateObj = new Date(`${appt.date}T00:00:00`)
  const dateLabel = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj)
  const canCancel = appt.status !== 'iptal' && appt.status !== 'tamamlandi'
  const canApprove = appt.status === 'taslak'
  // Planlanan/onaylanan randevu işleme alınabilir (müşteri koltukta → mor kart).
  const canStart = appt.status === 'bekliyor' || appt.status === 'devam'

  return (
    <div className="flex flex-col">
      {/* Panel başlığı */}
      <div className="flex items-center justify-between border-b border-[#ead8df]/70 px-4 py-3">
        <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a7480]">Randevu Detayı</span>
        <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-[#9d7386] transition-colors hover:bg-white hover:text-[#c85776]" aria-label="Detayı kapat">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${st.chipBg} ${st.chipText}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {st.label}
          </span>
          <span className="font-mono text-[10.5px] text-[#a58d99]">{shortNo}</span>
        </div>

        {/* Zaman */}
        <div className="flex items-center gap-2 rounded-[12px] border border-[#efe1e7] bg-white px-3 py-2.5">
          <Clock className="h-4 w-4 shrink-0 text-[#c85776]" />
          <div>
            <div className="text-[13px] font-bold text-[#241923]">{minutesToLabel(startMin)} – {minutesToLabel(startMin + dur)} <span className="text-[11px] font-normal text-[#8a7480]">({dur} dk)</span></div>
            <div className="text-[11px] text-[#8a7480]">{dateLabel}</div>
          </div>
          {appt.isOnline && <span className="ml-auto rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold text-sky-600">Online</span>}
        </div>

        {/* Hizmet */}
        <div className="flex items-center justify-between rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 shrink-0 text-[#c85776]" />
            <span className="text-[13px] font-semibold text-[#241923]">{appt.islem}</span>
          </div>
          {appt.price > 0 && <span className="font-display text-[15px] font-bold tabular-nums text-[#b14d6c]">{formatTL(appt.price)}</span>}
        </div>

        {/* Müşteri */}
        <div className="rounded-[12px] border border-[#efe1e7] bg-white px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] text-[12px] font-bold text-[#7f4057] shadow-[0_5px_14px_-6px_rgba(190,91,125,0.6)]">
              {initialsOf(appt.musteri)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13.5px] font-bold text-[#241923]">{appt.musteri}</span>
                {customer?.isVip && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> VIP</span>}
              </div>
              {(appt.customerPhone || customer?.phone) && (
                <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#8a7480]"><Phone className="h-3 w-3" /> {appt.customerPhone || customer?.phone}</div>
              )}
              {customer && (customer.isBlacklisted || customer.remainingSessions > 0) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {customer.isBlacklisted && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600">Kara liste</span>}
                  {customer.remainingSessions > 0 && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-600">{customer.remainingSessions} seans hakkı</span>}
                </div>
              )}
            </div>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp'tan yaz" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100">
                <MessageCircle className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        {/* Detay satırları */}
        <div className="space-y-1.5 rounded-[12px] border border-[#efe1e7] bg-white px-3 py-2.5 text-[12px]">
          <Row label="Personel" value={appt.personel || '—'} />
        </div>

        {/* Ödeme · cari — seçilen müşterinin açık adisyonundan (anlık) */}
        <div className="rounded-[12px] border border-[#efe1e7] bg-white px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8a7480]">
            <Wallet className="h-3 w-3 text-[#c85776]" /> Ödeme · Cari
          </div>
          {payment === 'loading' ? (
            <div className="py-1 text-[11.5px] text-[#a58d99]">Yükleniyor…</div>
          ) : payment ? (
            (() => {
              const kalan = Math.max(0, payment.chargeTotal - payment.paymentTotal)
              return (
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8a7480]">Ödeme Durumu</span>
                    {kalan > 0 ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">Ödeme bekliyor</span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">Ödendi</span>
                    )}
                  </div>
                  <Row label="Toplam Tutar" value={formatTL(payment.chargeTotal)} />
                  <Row label="Ödenen" value={formatTL(payment.paymentTotal)} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8a7480]">Kalan</span>
                    <span className={`font-bold tabular-nums ${kalan > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatTL(kalan)}</span>
                  </div>
                </div>
              )
            })()
          ) : (
            <div className="py-1 text-[11.5px] text-[#a58d99]">Açık adisyon yok — bekleyen ödeme görünmüyor.</div>
          )}
        </div>

        {/* Not */}
        {appt.notes && (
          <div className="rounded-[12px] border border-amber-200/60 bg-amber-50/50 px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700/80">Not</div>
            <div className="mt-0.5 text-[12px] leading-snug text-[#5d4a56]">{appt.notes}</div>
          </div>
        )}
      </div>

      {/* Aksiyonlar */}
      <div className="mt-auto space-y-2 border-t border-[#ead8df]/70 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          {onEdit && (
            <button type="button" onClick={() => onEdit(appt.id)} className="inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-semibold text-[#5d4a56] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
              <Pencil className="h-3.5 w-3.5" /> Düzenle
            </button>
          )}
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100">
              <MessageCircle className="h-3.5 w-3.5" /> Mesaj Gönder
            </a>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-semibold text-[#c9aeba]">
              <MessageCircle className="h-3.5 w-3.5" /> Mesaj
            </span>
          )}
        </div>
        {onOpenAdisyon && appt.customerId && (
          <button
            type="button"
            onClick={() => onOpenAdisyon(appt.customerId as string, appt.musteri)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[#c85776]/40 bg-[#fff1f6] px-3 py-2 text-[12px] font-semibold text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]"
          >
            <ReceiptText className="h-3.5 w-3.5" /> Adisyon / Ödeme al
          </button>
        )}
        {canManage && appt.status === 'islemde' && onComplete && (
          <button
            type="button"
            onClick={() => void onComplete(appt.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-2 text-[12px] font-semibold text-white shadow-[0_12px_22px_-15px_rgba(16,185,129,0.95)] transition-transform hover:-translate-y-0.5"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> İşlemi bitir · Tamamlandı
          </button>
        )}
        {canManage && canStart && onStartService && (
          <button
            type="button"
            onClick={() => void onStartService(appt.id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-gradient-to-r from-violet-500 to-violet-600 px-3 py-2 text-[12px] font-semibold text-white shadow-[0_12px_22px_-15px_rgba(139,92,246,0.95)] transition-transform hover:-translate-y-0.5"
          >
            <Sparkles className="h-3.5 w-3.5" /> Şu an işlemde
          </button>
        )}
        {canManage && (canApprove || canCancel) && (
          <div className="grid grid-cols-2 gap-2">
            {canApprove && onApprove && (
              <button type="button" onClick={() => void onApprove(appt.id)} className="inline-flex items-center justify-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_12px_22px_-15px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Onayla
              </button>
            )}
            {canCancel && onCancel && (
              <button type="button" onClick={() => void onCancel(appt.id)} className={`inline-flex items-center justify-center gap-1.5 rounded-[12px] border border-rose-200 bg-white px-3 py-2 text-[12px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 ${canApprove && onApprove ? '' : 'col-span-2'}`}>
                <Ban className="h-3.5 w-3.5" /> İptal Et
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#8a7480]">{label}</span>
      <span className={`font-medium ${muted ? 'text-[#c2a2b0]' : 'text-[#241923]'}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seçim yokken: günün özeti
// ---------------------------------------------------------------------------

interface ReminderRow { id: string; time: string; musteri: string; islem: string; customerConfirmation?: string }
interface RiskRow { id: string; name: string; noshow: number; cancel: number; weight: number }

function DaySummary({
  title = 'Günün Özeti',
  counts,
  total,
  reminders,
  noShowRisk,
  waitlist,
  onSelect,
  onCreate,
}: {
  title?: string
  counts: Record<AppointmentStatusKey, number>
  total: number
  reminders: ReminderRow[]
  noShowRisk: RiskRow[]
  waitlist?: WaitlistLite[]
  onSelect: (id: string) => void
  onCreate?: () => void
}) {
  const rows: { key: AppointmentStatusKey; label: string }[] = [
    { key: 'islemde', label: 'İşlemde' },
    { key: 'tamamlandi', label: 'Tamamlanan' },
    { key: 'devam', label: 'Onaylı' },
    { key: 'bekliyor', label: 'Bekleyen' },
    { key: 'taslak', label: 'Onay bekleyen' },
    { key: 'iptal', label: 'İptal' },
  ]
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {/* Günün Özeti */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#c85776]" />
          <span className="text-[13px] font-bold text-[#241923]">{title}</span>
        </div>
        <div className="rounded-[14px] border border-[#efe1e7] bg-white px-4 py-3">
          <div className="flex items-baseline justify-between border-b border-[#f3e4ea] pb-2.5">
            <span className="text-[12px] text-[#8a7480]">Toplam randevu</span>
            <span className="font-display text-[24px] font-bold text-[#241923]">{total}</span>
          </div>
          <div className="mt-2.5 space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12px] text-[#5d4a56]">
                  <span className={`h-2 w-2 rounded-full ${statusStyle[r.key].dot}`} /> {r.label}
                </span>
                <span className="font-semibold tabular-nums text-[#241923]">{counts[r.key] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bekleme Listesi */}
      {waitlist && waitlist.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-[#c85776]" />
            <span className="text-[13px] font-bold text-[#241923]">Bekleme Listesi</span>
            <span className="rounded-full bg-[#fff1f6] px-1.5 text-[10px] font-bold text-[#c85776]">{waitlist.length}</span>
          </div>
          <div className="rounded-[14px] border border-[#efe1e7] bg-white p-1.5">
            <div className="space-y-0.5">
              {waitlist.slice(0, 5).map((w, i) => (
                <div key={w.id} className="flex items-center gap-2 rounded-[9px] px-2 py-1.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#f47699] to-[#ef6088] text-[10px] font-bold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#241923]">{w.customerName}</span>
                    {w.serviceName && <span className="block truncate text-[10.5px] text-[#8a7480]">{w.serviceName}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Yaklaşan Hatırlatmalar */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          <span className="text-[13px] font-bold text-[#241923]">Yaklaşan Hatırlatmalar</span>
          {reminders.length > 0 && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-bold text-amber-600">{reminders.length}</span>}
        </div>
        <div className="rounded-[14px] border border-[#efe1e7] bg-white p-1.5">
          {reminders.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11.5px] text-[#a58d99]">Bekleyen hatırlatma yok — tümü bilgilendirilmiş.</div>
          ) : (
            <div className="space-y-0.5">
              {reminders.map((r) => (
                <button key={r.id} type="button" onClick={() => onSelect(r.id)} className="flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-[#fff7fa]">
                  <span className="w-11 shrink-0 font-mono text-[11px] font-bold tabular-nums text-[#c85776]">{r.time}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#241923]">{r.musteri}</span>
                    <span className="block truncate text-[10.5px] text-[#8a7480]">{r.islem}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${r.customerConfirmation === 'Confirmed' ? 'bg-emerald-50 text-emerald-600' : r.customerConfirmation === 'Pending' ? 'bg-amber-50 text-amber-600' : 'bg-[#f4edf0] text-[#9d8592]'}`}>
                    {r.customerConfirmation === 'Confirmed' ? 'Onaylı' : r.customerConfirmation === 'Pending' ? 'Bekliyor' : 'Gönderilecek'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* No-show Riski */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <span className="text-[13px] font-bold text-[#241923]">No-show Riski</span>
          {noShowRisk.length > 0 && <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-bold text-rose-600">{noShowRisk.length}</span>}
        </div>
        <div className="rounded-[14px] border border-[#efe1e7] bg-white p-1.5">
          {noShowRisk.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11.5px] text-[#a58d99]">Bugünkü müşterilerde geçmiş gelmedi/iptal kaydı yok.</div>
          ) : (
            <div className="space-y-0.5">
              {noShowRisk.map((r) => {
                const high = r.noshow >= 1
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-[9px] px-2 py-1.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] text-[9.5px] font-bold text-[#7f4057]">{initialsOf(r.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[#241923]">{r.name}</span>
                      <span className="block truncate text-[10.5px] text-[#8a7480]">{r.noshow > 0 && `${r.noshow} gelmedi`}{r.noshow > 0 && r.cancel > 0 && ' · '}{r.cancel > 0 && `${r.cancel} iptal`}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${high ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>{high ? 'Yüksek' : 'Orta'}</span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="px-2 pb-1 pt-1.5 text-[9.5px] leading-snug text-[#c2adb6]">Yüklü randevu kapsamındaki geçmişe göre.</div>
        </div>
      </div>

      {/* Alt CTA */}
      {onCreate && (
        <button type="button" onClick={onCreate} className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_12px_22px_-15px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
          <Plus className="h-3.5 w-3.5" /> Yeni randevu
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hafta görünümü — 7 gün × saatlik ızgara (blok tıkla → detay · başlık tıkla → gün)
// ---------------------------------------------------------------------------
function WeekView({
  days,
  appts,
  todayKey,
  filter,
  isVip,
  hasDebt,
  selectedId,
  onSelect,
  onOpenDay,
  onCreateAt,
}: {
  days: string[]
  appts: Appointment[]
  todayKey: string
  filter: (a: Appointment) => boolean
  isVip: (a: Appointment) => boolean
  hasDebt: (a: Appointment) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenDay: (iso: string) => void
  onCreateAt?: (info: { date: string; time?: string; staffId?: string }) => void
}) {
  const filtered = useMemo(() => appts.filter(filter), [appts, filter])
  const { startHour, endHour, hours } = useMemo(() => {
    let minS = 9 * 60
    let maxE = 19 * 60
    for (const a of filtered) {
      const s = parseMinutes(a.time)
      minS = Math.min(minS, s)
      maxE = Math.max(maxE, s + apptDur(a))
    }
    const sh = Math.max(6, Math.min(9, Math.floor(minS / 60)))
    let eh = Math.min(24, Math.max(19, Math.ceil(maxE / 60)))
    if (eh <= sh) eh = sh + 1
    return { startHour: sh, endHour: eh, hours: Array.from({ length: eh - sh }, (_, i) => sh + i) }
  }, [filtered])
  const gridHeight = (endHour - startHour) * PX_PER_HOUR
  const perDay = useMemo(
    () => days.map((iso) => ({ iso, laid: packLanes(filtered.filter((a) => a.date === iso)) })),
    [days, filtered],
  )

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const nowTop = ((nowMin - startHour * 60) / 60) * PX_PER_HOUR
  const showNow = days.includes(todayKey) && nowMin >= startHour * 60 && nowMin <= endHour * 60

  const wdFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' })
  const dFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' })
  const gridTemplate = 'repeat(7, minmax(116px, 1fr))'
  const innerMinWidth = 64 + 7 * 128
  const hourLineBg = `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR - 1}px, rgba(243,228,234,0.9) ${PX_PER_HOUR}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2 - 1}px, rgba(243,228,234,0.45) ${PX_PER_HOUR / 2}px)`

  const handleColClick = (iso: string, e: React.MouseEvent<HTMLDivElement>): void => {
    if (!onCreateAt || e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = startHour * 60 + ((e.clientY - rect.top) / PX_PER_HOUR) * 60
    const snapped = Math.max(startHour * 60, Math.round(raw / 15) * 15)
    onCreateAt({ date: iso, time: minutesToLabel(snapped) })
  }

  return (
    <div style={{ minWidth: innerMinWidth }}>
      {/* Gün başlıkları (sticky) */}
      <div className="sticky top-0 z-20 flex border-b border-[#ead8df]/70 bg-gradient-to-b from-white to-[#fff9fb]/95 backdrop-blur">
        <div className="grid w-16 shrink-0 place-items-center border-r border-[#f3e4ea] text-[#c9aeba]">
          <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
          {perDay.map(({ iso, laid }, i) => {
            const d = parseIso(iso)
            const isTod = iso === todayKey
            const weekend = i >= 5
            const count = laid.filter((l) => l.appt.status !== 'iptal').length
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onOpenDay(iso)}
                title={`${dFmt.format(d)} — gün görünümünü aç`}
                className={`group/hd flex flex-col items-center gap-1 border-l border-[#f3e4ea] px-2 py-2.5 text-center transition-colors first:border-l-0 ${isTod ? 'bg-[#fff1f6]' : weekend ? 'bg-[#fffafc] hover:bg-[#fff7fa]' : 'hover:bg-[#fff7fa]'}`}
              >
                <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${weekend ? 'text-[#c85776]/70' : 'text-[#9d8592]'}`}>{wdFmt.format(d)}</span>
                <span className={`grid h-8 w-8 place-items-center rounded-full font-display text-[15px] font-bold tabular-nums transition-colors ${isTod ? 'bg-[#c85776] text-white shadow-[0_6px_14px_-8px_rgba(200,87,118,0.9)]' : 'text-[#241923] group-hover/hd:bg-[#fff1f6]'}`}>{d.getDate()}</span>
                {count > 0 ? (
                  <span className="rounded-full bg-[#f0aac2]/25 px-1.5 text-[9px] font-bold text-[#c85776]">{count} randevu</span>
                ) : (
                  <span className="text-[9px] text-[#c2adb6]">—</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Zaman ekseni + 7 sütun */}
      <div className="relative flex" style={{ height: gridHeight }}>
        <div className="relative w-16 shrink-0 border-r border-[#f3e4ea]">
          {hours.map((h, i) => (
            <div key={h} className="absolute right-2 text-[10px] font-mono font-semibold tabular-nums text-[#7c6170]" style={{ top: i === 0 ? 2 : i * PX_PER_HOUR - 6 }}>
              {`${String(h).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
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
            {perDay.map(({ iso, laid }, ci) => (
              <div
                key={iso}
                onClick={(e) => handleColClick(iso, e)}
                className={`relative border-l border-[#f3e4ea] first:border-l-0 ${iso === todayKey ? 'bg-[#fff7fa]/40' : ci >= 5 ? 'bg-[#fffafc]/50' : ''} ${onCreateAt ? 'cursor-copy' : ''}`}
                title={onCreateAt ? 'Boş saate tıklayıp randevu ekle' : undefined}
              >
                {laid.map(({ appt, startMin, dur, lane, lanes }) => {
                  const st = statusStyle[appt.status] || statusStyle.bekliyor
                  const top = ((startMin - startHour * 60) / 60) * PX_PER_HOUR
                  const height = Math.max(24, (dur / 60) * PX_PER_HOUR)
                  const widthPct = 100 / lanes
                  const compact = height < 40
                  const isSel = selectedId === appt.id
                  const vip = isVip(appt)
                  const debt = hasDebt(appt)
                  return (
                    <button
                      key={appt.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelect(appt.id) }}
                      title={`${appt.time} · ${appt.musteri} · ${appt.islem}${appt.personel ? ` · ${appt.personel}` : ''}`}
                      style={{ top, height, left: `calc(${lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
                      className={`group absolute z-[2] flex flex-col overflow-hidden rounded-[9px] border px-1.5 py-1 text-left shadow-[0_8px_20px_-14px_rgba(120,71,88,0.55)] transition-all ${st.block} ${isSel ? 'z-[3] ring-2 ring-[#c85776] ring-offset-1' : ''}`}
                    >
                      <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${st.bar}`} />
                      <div className="flex items-center gap-1 pl-1">
                        <span className="font-mono text-[9.5px] font-semibold tabular-nums text-[#3d2f3a]">{minutesToLabel(startMin)}</span>
                        {(vip || debt) && (
                          <span className="ml-auto flex shrink-0 items-center gap-0.5">
                            {debt && <span title="Ödeme bekliyor" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                            {vip && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />}
                          </span>
                        )}
                      </div>
                      <div className={`truncate pl-1 text-[11px] font-semibold leading-tight text-[#241923] ${appt.status === 'iptal' ? 'line-through' : ''}`}>{appt.musteri}</div>
                      {!compact && <div className="truncate pl-1 text-[9.5px] text-[#5d4a56]/85">{appt.islem}</div>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ay görünümü — takvim ızgarası (hücre tıkla → gün · randevu tıkla → detay)
// ---------------------------------------------------------------------------
function MonthView({
  cells,
  appts,
  todayKey,
  filter,
  isVip,
  selectedId,
  onSelect,
  onOpenDay,
  onCreateAt,
}: {
  cells: { iso: string; inMonth: boolean }[]
  appts: Appointment[]
  todayKey: string
  filter: (a: Appointment) => boolean
  isVip: (a: Appointment) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenDay: (iso: string) => void
  onCreateAt?: (info: { date: string; time?: string; staffId?: string }) => void
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>()
    for (const a of appts) {
      if (!filter(a)) continue
      const list = m.get(a.date)
      if (list) list.push(a)
      else m.set(a.date, [a])
    }
    for (const list of m.values()) list.sort((x, y) => parseMinutes(x.time) - parseMinutes(y.time))
    return m
  }, [appts, filter])

  const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
  const dFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' })

  return (
    <div className="min-w-[720px]">
      {/* Haftagünü başlığı (sticky) */}
      <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-[#ead8df]/70 bg-gradient-to-b from-white to-[#fff9fb]/95 backdrop-blur">
        {weekdays.map((d, i) => (
          <div key={d} className={`px-3 py-2 text-center text-[10.5px] font-semibold uppercase tracking-wide ${i >= 5 ? 'text-[#c85776]/70' : 'text-[#9d8592]'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const d = parseIso(cell.iso)
          const list = cell.inMonth ? byDay.get(cell.iso) || [] : []
          const isTod = cell.iso === todayKey
          const weekend = i % 7 >= 5
          const completed = list.filter((a) => a.status === 'tamamlandi').length
          return (
            <div
              key={cell.iso + i}
              onClick={() => onOpenDay(cell.iso)}
              className={`group/cell relative min-h-[104px] cursor-pointer border-b border-l border-[#f3e4ea] p-2 transition-colors [&:nth-child(7n+1)]:border-l-0 ${!cell.inMonth ? 'bg-[#fdf7f9]/50 opacity-55 hover:opacity-80' : isTod ? 'bg-[#fff1f6]/70' : weekend ? 'bg-[#fffafc] hover:bg-[#fff7fa]' : 'bg-white hover:bg-[#fff7fa]'}`}
              title={cell.inMonth ? `${dFmt.format(d)} — gün görünümünü aç` : undefined}
            >
              <div className="flex items-center justify-between">
                <span className={`grid h-7 w-7 place-items-center rounded-full font-display text-[13px] font-bold tabular-nums ${isTod ? 'bg-[#c85776] text-white shadow-[0_6px_14px_-8px_rgba(200,87,118,0.9)]' : !cell.inMonth ? 'text-[#c2adb6]' : weekend ? 'text-[#c85776]/80' : 'text-[#241923]'}`}>{d.getDate()}</span>
                {list.length > 0 && (
                  <span
                    title={`${list.length} randevu · ${completed} tamamlandı`}
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ${completed === list.length ? 'bg-emerald-50 text-emerald-600' : list.length >= 5 ? 'bg-gradient-to-br from-[#f0aac2] to-[#d48aa7] text-white' : 'bg-[#f0aac2]/25 text-[#c85776]'}`}
                  >
                    {list.length}
                  </span>
                )}
              </div>
              {cell.inMonth && (
                <div className="mt-1.5 space-y-1">
                  {list.slice(0, 3).map((a) => {
                    const st = statusStyle[a.status] || statusStyle.bekliyor
                    const isSel = selectedId === a.id
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSelect(a.id) }}
                        title={`${a.time} · ${a.musteri} · ${a.islem}`}
                        className={`flex w-full items-center gap-1 overflow-hidden rounded-[7px] border px-1.5 py-0.5 text-left transition-all ${st.block} ${isSel ? 'ring-2 ring-[#c85776]' : ''}`}
                      >
                        <span aria-hidden className={`h-3 w-0.5 shrink-0 rounded ${st.bar}`} />
                        <span className="font-mono text-[9px] font-semibold tabular-nums text-[#3d2f3a]">{a.time}</span>
                        <span className={`truncate text-[10px] font-medium text-[#241923] ${a.status === 'iptal' ? 'line-through' : ''}`}>{a.musteri}</span>
                        {isVip(a) && <Star className="ml-auto h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-400" />}
                      </button>
                    )
                  })}
                  {list.length > 3 && <div className="pl-1 text-[9px] font-semibold text-[#a58d99]">+{list.length - 3} randevu</div>}
                  {list.length === 0 && onCreateAt && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCreateAt({ date: cell.iso }) }}
                      className="mt-0.5 hidden w-full items-center justify-center gap-1 rounded-[7px] border border-dashed border-[#efbfd0] py-1 text-[9px] font-semibold text-[#c85776] transition-colors hover:bg-[#fff1f6] group-hover/cell:flex"
                    >
                      <Plus className="h-2.5 w-2.5" /> Ekle
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
