'use client'

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import AppointmentEditor, { type AppointmentEditorValues } from '@/components/dashboard/AppointmentEditor'
import ManagerAppointmentInbox from '@/components/dashboard/ManagerAppointmentInbox'
import AppointmentReminderControl from '@/components/dashboard/AppointmentReminderControl'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import CustomerFormDialog, { type CustomerFormValues } from '@/components/dashboard/CustomerFormDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import AppointmentsCalendarLinkButton from '@/components/dashboard/AppointmentsCalendarLinkButton'
import ScopeBadge from '@/components/dashboard/ScopeBadge'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import DayScheduleModal from '@/components/dashboard/DayScheduleModal'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import {
  apiItems,
  dayTitle,
  formatTL,
  guidOrUndefined,
  monthLabel,
  normalizeAppointment,
  normalizeCustomer,
  normalizePackage,
  normalizeService,
  normalizeStaff,
  normalizeStaffTimeOff,
} from '@/lib/apiMappers'
import {
  Activity,
  Calendar,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  FileText,
  Mail,
  Phone,
  ShieldCheck,
  Users,
  ChevronLeft,
  ChevronRight,
  Clock,
  PenLine,
  Plus,
  StickyNote,
  Trash2,
  UserPlus,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import type {
  ApiAppointment,
  ApiCustomer,
  ApiService,
  ApiServicePackage,
  ApiStaff,
  ApiStaffTimeOff,
  Appointment,
  AppointmentLookups,
  AppointmentStatusKey,
  Customer,
  PagedResult,
  Service,
  ServicePackage,
  Staff,
} from '@/lib/types'

type ScopeKey = 'today' | 'week' | 'month' | 'pending'

interface StaffStatusFormValues {
  status?: string
  reason?: string
}

const staffStatusOptions = [
  { value: 'Confirmed', label: 'Devam' },
  { value: 'Completed', label: 'Tamamlandı' },
  { value: 'Cancelled', label: 'İptal' },
  { value: 'NoShow', label: 'Gelmedi' },
]

const scopeMeta: Record<ScopeKey, { label: string; description: string }> = {
  today: { label: 'Bugün', description: 'Sadece bugünkü randevular' },
  week: { label: 'Bu Hafta', description: 'Bu hafta içindeki randevular' },
  month: { label: 'Bu Ay', description: 'Mevcut ayın randevuları' },
  pending: { label: 'Bekleyenler', description: 'Status = Bekliyor olan tüm randevular' },
}

interface BadgeMeta {
  label: string
  icon: LucideIcon
  cls: string
  dot: string
}

const statusBadge: Record<AppointmentStatusKey, BadgeMeta> = {
  tamamlandi: { label: 'Tamamlandı', icon: CheckCircle2, cls: 'bg-[#fff4f8] text-[#2f1724]', dot: 'bg-white' },
  devam: {
    label: 'Devam',
    icon: Activity,
    cls: 'bg-[#f0aac2]/15 text-[#c85776] border border-[#efbfd0]/75',
    dot: 'bg-[#f0aac2]',
  },
  bekliyor: {
    label: 'Bekliyor',
    icon: Clock,
    cls: 'border border-[#ead8df]/70 text-[#352432]/70',
    dot: 'border border-[#fff4f8]/40',
  },
  iptal: {
    label: 'İptal',
    icon: XCircle,
    cls: 'bg-rose-400/15 text-rose-700 border border-rose-300/25',
    dot: 'bg-rose-300/70',
  },
  taslak: {
    label: 'Taslak',
    icon: Clock,
    cls: 'border border-dashed border-indigo-300/60 bg-indigo-50 text-indigo-600',
    dot: 'bg-indigo-300',
  },
}

// Alt bölüm (gün özeti + çizelge) için yumuşak durum tonları — takvim statusBadge'i kullanmaya devam eder.
interface StatusTone {
  label: string
  dot: string
  bar: string
  pill: string
}

const statusTone: Record<AppointmentStatusKey, StatusTone> = {
  tamamlandi: {
    label: 'Tamamlandı',
    dot: 'bg-emerald-500',
    bar: 'from-emerald-400 to-emerald-500',
    pill: 'border border-emerald-100 bg-emerald-50 text-emerald-700',
  },
  devam: {
    label: 'Onaylandı',
    dot: 'bg-sky-500',
    bar: 'from-sky-400 to-sky-500',
    pill: 'border border-sky-100 bg-sky-50 text-sky-700',
  },
  bekliyor: {
    label: 'Bekliyor',
    dot: 'bg-amber-400',
    bar: 'from-amber-300 to-amber-400',
    pill: 'border border-amber-100 bg-amber-50 text-amber-700',
  },
  iptal: {
    label: 'İptal',
    dot: 'bg-rose-400',
    bar: 'from-rose-300 to-rose-400',
    pill: 'border border-rose-100 bg-rose-50 text-rose-700',
  },
  taslak: {
    label: 'Taslak',
    dot: 'bg-indigo-400',
    bar: 'from-indigo-300 to-indigo-400',
    pill: 'border border-dashed border-indigo-200 bg-indigo-50 text-indigo-600',
  },
}

const statusToneOrder: AppointmentStatusKey[] = ['tamamlandi', 'devam', 'bekliyor', 'taslak', 'iptal']

const metricCardShell =
  'relative overflow-hidden rounded-[22px] border border-[#efe1e7] bg-white/94 shadow-[0_18px_50px_-34px_rgba(120,71,88,0.45)]'

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('tr-TR'))
      .join('') || '•'
  )
}

function AvatarBubble({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efd5dd] bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] text-[10px] font-semibold text-[#7f4057] shadow-[0_10px_22px_-16px_rgba(190,91,125,0.8)]">
      {initials(name)}
    </span>
  )
}

function SparkArea({ values, id }: { values: number[]; id: string }) {
  const max = Math.max(1, ...values)
  const W = 110
  const H = 52
  const pts = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * (W - 10) + 5
    const y = H - 9 - (value / max) * (H - 20)
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const
  })
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `5,${H - 5} ${line} ${W - 5},${H - 5}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[52px] w-[110px] shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef6f94" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#ef6f94" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke="#d65f83"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map(([x, y], index) => (
        <circle key={`${x}-${index}`} cx={x} cy={y} r="2" fill="#fff" stroke="#d65f83" strokeWidth="1.1" />
      ))}
    </svg>
  )
}

function MetricStat({
  icon: Icon,
  label,
  value,
  spark,
  id,
  index = 0,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  spark: number[]
  id: string
  index?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.44, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className={`${metricCardShell} p-5`}
    >
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#ffdce8]/40 blur-3xl" />
      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="grid h-10 w-10 place-items-center rounded-[13px] border border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]">
            <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
          </span>
          <div className="mt-3 text-[12px] font-medium text-[#8a7480]">{label}</div>
          <div className="mt-1 text-[28px] font-semibold leading-none tracking-tight text-[#241923] tabular-nums">
            {value}
          </div>
        </div>
        <SparkArea values={spark} id={id} />
      </div>
    </motion.div>
  )
}

interface MonthRange {
  start: Date
  end: Date
  days: number
}

function monthRange(monthDate: Date): MonthRange {
  const start = new Date(Date.UTC(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0))
  const end = new Date(Date.UTC(monthDate.getFullYear(), monthDate.getMonth() + 1, 1, 0, 0, 0))
  return { start, end, days: new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate() }
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface DashboardData {
  appointmentsResult: PagedResult<ApiAppointment>
  customersResult: PagedResult<ApiCustomer>
  staffResult: PagedResult<ApiStaff>
  servicesResult: PagedResult<ApiService>
  packagesResult: PagedResult<ApiServicePackage>
  /** Onaylanmış paket/hizmet satışı olan müşteri Id'leri — randevu yalnızca bunlara verilebilir. */
  eligibleCustomerIds: string[]
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

function RandevularPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'month'
  const scopeInfo = scopeMeta[scope]

  const today = new Date()
  const [monthDate, setMonthDate] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState<number>(today.getDate())
  const [actionError, setActionError] = useState<string>('')
  // Editor dialog state
  const [createOpen, setCreateOpen] = useState(false)
  // Hızlı menüden ?action=new ile gelindiğinde yeni randevu modalını aç
  useEffect(() => {
    if (search?.get('action') === 'new') setCreateOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  const [createDate, setCreateDate] = useState<string>('')
  const [createTime, setCreateTime] = useState<string>('')
  const [createStaffId, setCreateStaffId] = useState<string>('')
  // Takvimde bir güne tıklanınca açılan saatlik personel çizelgesi modalı
  const [scheduleDate, setScheduleDate] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null)
  // Aksiyon kutusundan "Ertele" ile gelen randevu (içinde bulunulan ay listesinde olmayabilir).
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null)
  // Hovered day for quick-add button popout
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'
  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const { performWrite } = useStaffApproval()
  const [staffActionMsg, setStaffActionMsg] = useState<string>('')
  const range = monthRange(monthDate)
  const rangeStartIso = range.start.toISOString()
  const rangeEndIso = range.end.toISOString()

  const { data, loading, error, reload } = useApiQuery<DashboardData>(
    async () => {
      const appointmentsPromise = adminApi.appointments<ApiAppointment>({
        tenantId,
        fromUtc: rangeStartIso,
        toUtc: rangeEndIso,
        page: 1,
        pageSize: 300,
      })

      // Sınırsız müşteri ölçeği: tüm müşteri listesi ÇEKİLMEZ. Satır adları/telefonları
      // randevu DTO'sundan gelir; seçiciler sunucu aramasıyla çalışır.
      if (isStaffUser) {
        const [appointmentsResult, staffResult, servicesResult] = await Promise.all([
          appointmentsPromise,
          adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 10 }),
          adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }),
        ])
        return {
          appointmentsResult,
          customersResult: { items: [] },
          staffResult,
          servicesResult,
          packagesResult: { items: [] },
          eligibleCustomerIds: [],
        }
      }

      const [appointmentsResult, staffResult, servicesResult, packagesResult] = await Promise.all([
        appointmentsPromise,
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 300 }),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 300 }).catch<PagedResult<ApiServicePackage>>(() => ({ items: [] })),
      ])
      return { appointmentsResult, customersResult: { items: [] }, staffResult, servicesResult, packagesResult, eligibleCustomerIds: [] }
    },
    [tenantId, rangeStartIso, rangeEndIso, isStaffUser],
    { initialData: null },
  )

  // Şube/ay kapsamındaki personel izinleri — çizelge modalında izinli personele randevu engellenir.
  const { data: timeOffData, reload: reloadTimeOff } = useApiQuery<ApiStaffTimeOff[]>(
    async () => {
      if (!tenantId) return []
      return adminApi
        .timeOff<ApiStaffTimeOff>({ tenantId, fromDate: isoDateOnly(range.start), toDate: isoDateOnly(range.end) })
        .catch<ApiStaffTimeOff[]>(() => [])
    },
    [tenantId, rangeStartIso, rangeEndIso],
    { initialData: [] },
  )
  const monthTimeOffs = useMemo(() => (timeOffData || []).map((t, i) => normalizeStaffTimeOff(t, i)), [timeOffData])
  const [leaveBusy, setLeaveBusy] = useState(false)

  // Çizelge modalından personeli o gün izinli yap / iznini kaldır (yalnızca yönetici).
  const handleToggleLeave = async (staffId: string, date: string, currentlyOnLeave: boolean): Promise<void> => {
    if (isStaffUser) return
    setLeaveBusy(true)
    setActionError('')
    try {
      if (currentlyOnLeave) {
        const existing = monthTimeOffs.find(
          (t) => t.staffMemberId === staffId && (t.date || '').slice(0, 10) === date,
        )
        if (existing) await adminApi.removeTimeOff(existing.id, tenantId)
      } else {
        await adminApi.addTimeOff({ staffMemberId: staffId, date, reason: null }, tenantId)
      }
      await reloadTimeOff()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'İzin güncellenemedi.')
    } finally {
      setLeaveBusy(false)
    }
  }

  const normalizedLookups: {
    customers: Record<string, Customer>
    staff: Record<string, Staff>
    services: Record<string, Service>
  } = useMemo(() => {
    const customers = Object.fromEntries(
      apiItems(data?.customersResult).map((x, i): [string, Customer] => {
        const c = normalizeCustomer(x, i)
        return [c.id, c]
      }),
    )
    const staff = Object.fromEntries(
      apiItems(data?.staffResult).map((x, i): [string, Staff] => {
        const s = normalizeStaff(x, i)
        return [s.id, s]
      }),
    )
    const services = Object.fromEntries(
      apiItems(data?.servicesResult).map((x, i): [string, Service] => {
        const s = normalizeService(x, i)
        return [s.id, s]
      }),
    )
    return { customers, staff, services }
  }, [data])

  const apiLookups: AppointmentLookups = useMemo(
    () => ({
      customers: Object.fromEntries(apiItems(data?.customersResult).map((c) => [c.id ?? '', c])),
      staff: Object.fromEntries(apiItems(data?.staffResult).map((s) => [s.id ?? '', s])),
      services: Object.fromEntries(apiItems(data?.servicesResult).map((s) => [s.id ?? '', s])),
    }),
    [data],
  )

  const appointments = useMemo<Appointment[]>(
    () => apiItems(data?.appointmentsResult).map((a, i) => normalizeAppointment(a, apiLookups, i)),
    [data, apiLookups],
  )

  const allPackages = useMemo<ServicePackage[]>(
    () => apiItems(data?.packagesResult).map((p, i) => normalizePackage(p, i)).filter((p) => p.isActive),
    [data],
  )

  const customersList: Customer[] = useMemo(() => Object.values(normalizedLookups.customers), [normalizedLookups])
  const staffList: Staff[] = useMemo(() => Object.values(normalizedLookups.staff), [normalizedLookups])
  const servicesList: Service[] = useMemo(() => Object.values(normalizedLookups.services), [normalizedLookups])
  const selfStaff = useMemo(() => {
    if (!isStaffUser) return null
    const userEmail = user?.email?.toLowerCase()
    return staffList.find((s) => s.tenantUserId === user?.userId || (userEmail && s.email?.toLowerCase() === userEmail)) || staffList[0] || null
  }, [isStaffUser, staffList, user?.email, user?.userId])
  const appointmentStaffList = useMemo(() => (isStaffUser ? (selfStaff ? [selfStaff] : []) : staffList), [isStaffUser, selfStaff, staffList])
  const canCreateAppointment = !isStaffUser || Boolean(selfStaff)
  // Bekleme listesi özelliği açıksa dolu-slot uyarısında "bekleme listesine ekle" teklifi göster.
  const waitlistEnabled = useFeature('appointments.waitlist')

  // Scope-based pre-filter
  const todayIso = isoDateOnly(today)
  const weekStart = new Date(today)
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)) // Monday
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  const scopedAppointments: Appointment[] = useMemo(() => {
    switch (scope) {
      case 'today':
        return appointments.filter((r) => r.date === todayIso)
      case 'week':
        return appointments.filter((r) => {
          const d = new Date(`${r.date}T00:00:00`)
          return d >= weekStart && d < weekEnd
        })
      case 'pending':
        return appointments.filter((r) => r.status === 'bekliyor')
      default:
        return appointments
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, scope, todayIso])

  const monthDays = Array.from({ length: range.days }, (_, i) => i + 1)
  // Bugünün ay/gün indeksi — gösterilen ay bugünü içeriyorsa highlight için kullanılır.
  const todayDate = new Date()
  const isViewingTodaysMonth =
    monthDate.getFullYear() === todayDate.getFullYear() && monthDate.getMonth() === todayDate.getMonth()
  const todayDay = isViewingTodaysMonth ? todayDate.getDate() : null

  // Bugüne dön: monthDate'i bugüne ve selectedDay'i bugüne çek
  const jumpToToday = () => {
    setMonthDate(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1))
    setSelectedDay(todayDate.getDate())
  }

  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay()
  const mondayPad = (firstDay + 6) % 7
  const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`

  // Önceki ay gün sayısı — boş weekPad yerine gerçek geçmiş ay günleri (muted gösterilir)
  const prevMonthDays = new Date(monthDate.getFullYear(), monthDate.getMonth(), 0).getDate()
  const prevPad = Array.from({ length: mondayPad }, (_, i) => prevMonthDays - mondayPad + i + 1)

  // Sonraki ay günleri — 6 satıra (42 hücre) tamamla
  const totalCells = 42
  const nextPadCount = Math.max(0, totalCells - mondayPad - range.days)
  const nextPad = Array.from({ length: nextPadCount }, (_, i) => i + 1)

  // Cell tipi — ayrım yapabilmek için
  type CalendarCell = { day: number; type: 'prev' | 'curr' | 'next' }
  const allCells: CalendarCell[] = [
    ...prevPad.map((d) => ({ day: d, type: 'prev' as const })),
    ...monthDays.map((d) => ({ day: d, type: 'curr' as const })),
    ...nextPad.map((d) => ({ day: d, type: 'next' as const })),
  ]

  const byDay: Record<number, Appointment[]> = monthDays.reduce<Record<number, Appointment[]>>((acc, day) => {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    acc[day] = appointments.filter((r) => r.date === key)
    return acc
  }, {})
  const selectedDate = `${monthKey}-${String(selectedDay).padStart(2, '0')}`
  // Takvim sadece "ay" (month) scope'unda görünür; diğer scope'lar doğrudan liste açar
  const showCalendar = scope === 'month'
  const selectedAppointments = showCalendar
    ? byDay[selectedDay] || []
    : scopedAppointments

  const listHeaderLabel =
    scope === 'today'
      ? 'Bugün'
      : scope === 'week'
        ? 'Bu hafta'
        : scope === 'pending'
          ? 'Tüm bekleyenler'
          : dayTitle(selectedDate)

  const moveMonth = (delta: number): void => {
    setMonthDate((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, 1)
      const now = new Date()
      // Eğer gidilen ay bugünün ayı ise bugünü seç, aksi halde 1'i.
      const isTargetTodayMonth =
        next.getFullYear() === now.getFullYear() && next.getMonth() === now.getMonth()
      setSelectedDay(isTargetTodayMonth ? now.getDate() : 1)
      return next
    })
  }

  const toUtcRange = (date: string, time: string, durationMinutes: number): { startUtc: string; endUtc: string } => {
    const start = new Date(`${date}T${time || '09:00'}:00`)
    const duration = Math.max(5, durationMinutes || 30)
    const end = new Date(start.getTime() + duration * 60000)
    return { startUtc: start.toISOString(), endUtc: end.toISOString() }
  }

  const appointmentPayload = (values: AppointmentEditorValues): Record<string, unknown> => {
    const service = values.serviceDefinitionId ? normalizedLookups.services[values.serviceDefinitionId] : undefined
    const utcRange = toUtcRange(values.date, values.time, values.durationMinutes || service?.duration || 30)
    return {
      branchId,
      customerId: values.customerId,
      staffMemberId: isStaffUser ? selfStaff?.id : values.staffMemberId,
      serviceDefinitionId: values.serviceDefinitionId,
      ...utcRange,
      // Randevu ciro taşımaz — satış/ödeme adisyon+cari katmanında. Tamamlanınca seans düşer.
      price: 0,
      notes: values.notes || null,
    }
  }

  const handleCreateAppointment = async (values: AppointmentEditorValues): Promise<void> => {
    if (isStaffUser && !selfStaff?.id) {
      throw new Error('Personel hesabın StaffMember kaydıyla eşleşmedi. Kurum yöneticisi personel hesabını tekrar bağlamalı.')
    }
    const payload = appointmentPayload(values)
    // Randevu doğrudan oluşturulur; personel oluşturursa backend onu "taslak" yapıp kurum
    // yöneticisi onayına düşürür — randevularda taslak görünür, onaylanınca aktif randevuya döner.
    await adminApi.createAppointment(payload, tenantId)
    if (isStaffUser) {
      setStaffActionMsg('Randevu taslak olarak oluşturuldu ve kurum yöneticisi onayına gönderildi. Onaylanınca aktif randevuya dönecek.')
      await reload()
      return
    }

    // Not: Paket satışı / cari açma artık randevu ekranında YAPILMAZ — satış adisyon akışında.
    // Randevu yalnızca müşterinin satın aldığı seansa açılır ve tamamlanınca o seanstan düşer.
    await reload()
  }

  // Slot dolu (SlotFull) → müşteriyi TAM o slot için bekleme listesine ekle.
  // Yer açılınca (iptal) müşteriye WhatsApp'tan "yer açıldı, ister misiniz?" teklifi gider.
  const handleAddToWaitlist = async (values: AppointmentEditorValues): Promise<void> => {
    const service = values.serviceDefinitionId ? normalizedLookups.services[values.serviceDefinitionId] : undefined
    const duration = values.durationMinutes || service?.duration || 30
    const { startUtc } = toUtcRange(values.date, values.time, duration)
    await adminApi.addWaitlist(
      {
        customerId: values.customerId,
        serviceDefinitionId: values.serviceDefinitionId || null,
        staffMemberId: (isStaffUser ? selfStaff?.id : values.staffMemberId) || null,
        preferredDate: values.date,
        preferredStartUtc: startUtc,
        durationMinutes: duration,
        branchId: branchId ?? null,
        note: null,
      },
      tenantId,
    )
    await reload()
  }

  // Not: Puanlama linki artık ekranda QR olarak gösterilmez — randevu Tamamlandı olunca
  // backend 24 saat geçerli linki üretip müşteriye WhatsApp'tan otomatik gönderir.

  const handleEditAppointment = async (appointmentId: string, values: AppointmentEditorValues): Promise<void> => {
    const service = values.serviceDefinitionId ? normalizedLookups.services[values.serviceDefinitionId] : undefined
    const utcRange = toUtcRange(values.date, values.time, values.durationMinutes || service?.duration || 30)
    // Düzenlemede yalnızca zamanlama + durum + not güncellenir (müşteri/hizmet/personel sabittir).
    await adminApi.rescheduleAppointment(appointmentId, utcRange, tenantId)
    await adminApi.changeAppointmentStatus(appointmentId, { status: values.status, reason: null }, tenantId)
    await adminApi.changeAppointmentNotes(appointmentId, { notes: values.notes || null }, tenantId)
    await reload()
  }

  const handleStaffStatusChange = async (appointmentId: string, values: StaffStatusFormValues): Promise<void> => {
    setActionError('')
    await adminApi.changeAppointmentStatus(
      appointmentId,
      { status: values.status || 'Confirmed', reason: values.reason || null },
      tenantId,
    )
    setStaffActionMsg('Randevu durumu güncellendi. Sadece kendi randevu kaydın üzerinde işlem yapıldı.')
    await reload()
  }

  const editingAppointment = useMemo(
    () =>
      editingId
        ? appointments.find((a) => a.id === editingId) ||
          (rescheduleAppt?.id === editingId ? rescheduleAppt : undefined)
        : undefined,
    [editingId, appointments, rescheduleAppt],
  )
  const noteEditingAppointment = useMemo(
    () => (noteEditingId ? appointments.find((a) => a.id === noteEditingId) : undefined),
    [noteEditingId, appointments],
  )

  const monthlyTotal = appointments.length
  const completed = appointments.filter((r) => r.status === 'tamamlandi').length
  const pendingCount = appointments.filter((r) => r.status === 'bekliyor').length
  const totalRevenue = appointments.reduce(
    (sum, r) => sum + (r.status === 'tamamlandi' ? Number(r.price || 0) : 0),
    0,
  )

  // Metrik kartlarındaki sparkline'lar için ay içi günlük seriler (~10 noktaya gruplanır)
  const sparkSeries = useMemo(() => {
    const days = range.days
    const total: number[] = Array(days).fill(0)
    const done: number[] = Array(days).fill(0)
    const pending: number[] = Array(days).fill(0)
    const revenue: number[] = Array(days).fill(0)
    appointments.forEach((r) => {
      const day = Number(r.date?.slice(8, 10))
      if (!day || day < 1 || day > days) return
      total[day - 1] += 1
      if (r.status === 'tamamlandi') {
        done[day - 1] += 1
        revenue[day - 1] += Number(r.price || 0)
      }
      if (r.status === 'bekliyor') pending[day - 1] += 1
    })
    const bucket = (values: number[]): number[] => {
      const size = Math.ceil(values.length / 10)
      const out: number[] = []
      for (let i = 0; i < values.length; i += size) {
        out.push(values.slice(i, i + size).reduce((sum, v) => sum + v, 0))
      }
      return out
    }
    return { total: bucket(total), done: bucket(done), pending: bucket(pending), revenue: bucket(revenue) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, range.days])

  // Hızlı müşteri kaydı — topbar'daki "Yeni Müşteri" ve randevu modalındaki buton aynı akışı kullanır.
  // Oluşan müşteri döndürülür (randevu modalı otomatik seçer); Staff onaya düştüyse null döner.
  const quickCreateCustomer = async (values: CustomerFormValues): Promise<Customer | null> => {
    const payload = {
      branchId: branchId || null, fullName: values.fullName, phone: values.phone, email: values.email || null,
      birthDate: values.birthDate || null, gender: values.gender || 'Unspecified',
      kvkkConsent: Boolean(values.kvkkConsent), notes: values.notes || null,
      photoUrl: typeof values.photoUrl === 'string' && values.photoUrl ? values.photoUrl : null,
    }
    const res = await performWrite({
      operationType: 'CreateCustomer',
      title: `Müşteri: ${String(payload.fullName || '—')}`,
      summary: String(payload.phone || ''),
      payload,
      tenantId,
      directAction: () => adminApi.createCustomer<ApiCustomer>(payload, tenantId),
    })
    if (res.submittedToApproval) {
      setStaffActionMsg(staffApprovalSuccessMessage('Müşteri ekleme'))
      await reload()
      return null
    }
    await reload()
    return res.result ? normalizeCustomer(res.result) : null
  }

  // Gün özeti kartı: durum dağılımı, toplam tutar ve yüzdelik segmentler
  const dayCounts: Record<AppointmentStatusKey, number> = {
    tamamlandi: selectedAppointments.filter((r) => r.status === 'tamamlandi').length,
    devam: selectedAppointments.filter((r) => r.status === 'devam').length,
    bekliyor: selectedAppointments.filter((r) => r.status === 'bekliyor').length,
    taslak: selectedAppointments.filter((r) => r.status === 'taslak').length,
    iptal: selectedAppointments.filter((r) => r.status === 'iptal').length,
  }
  const dayTotalAmount = selectedAppointments.reduce((sum, r) => sum + Number(r.price || 0), 0)
  const daySegments = statusToneOrder
    .map((key) => ({
      key,
      count: dayCounts[key],
      pct: selectedAppointments.length ? Math.round((dayCounts[key] / selectedAppointments.length) * 100) : 0,
      tone: statusTone[key],
    }))
    .filter((segment) => segment.count > 0)

  return (
    <>
      <Topbar
        title={isStaffUser ? 'Randevularım' : 'Randevular'}
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}${isStaffUser ? ' · sadece kendi randevuların' : ''}`}
        breadcrumbs={isStaffUser ? ['Personel', 'Randevularım', scopeInfo.label] : ['Admin', 'İşletme', 'Randevular', scopeInfo.label]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CustomerFormDialog
              mode="create"
              description="Müşteriyi buradan kaydedip sayfadan ayrılmadan randevusunu oluşturabilirsin."
              submitLabel={isStaffUser ? 'Onaya gönder' : 'Müşteri oluştur'}
              onSubmit={async (values) => {
                await quickCreateCustomer(values)
              }}
              trigger={
                <button type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white px-4 py-2 text-[12px] font-semibold text-[#c85776] transition-transform hover:-translate-y-0.5 hover:bg-[#fff4f8]">
                  <UserPlus className="h-4 w-4" strokeWidth={2.1} /> Yeni Müşteri
                </button>
              }
            />
            <PackageSaleDialog
              tenantId={tenantId}
              onDone={reload}
              triggerLabel="Paket Satışı"
              triggerClassName="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white px-4 py-2 text-[12px] font-semibold text-[#c85776] transition-transform hover:-translate-y-0.5 hover:bg-[#fff4f8]"
            />
            {canCreateAppointment && (
              <button
                type="button"
                onClick={() => {
                  setCreateDate(selectedDate)
                  setCreateOpen(true)
                }}
                className="inline-flex min-w-max items-center gap-2 rounded-[15px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5"
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
                {isStaffUser ? 'Kendi randevunu oluştur' : 'Yeni Randevu'}
              </button>
            )}
            <ExcelTransferActions<Appointment>
              compact
              featureKey="excel.appointments"
              moduleName="Randevular"
              context={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}`}
              rows={scopedAppointments}
              sheet={{
                subtitle: `${scopedAppointments.length} randevu · ${scopeInfo.label}`,
                columns: [
                  { key: 'date', header: 'Tarih', width: 14, type: 'date', accessor: (a) => a.date },
                  { key: 'time', header: 'Saat', width: 10, type: 'text', accessor: (a) => a.time },
                  { key: 'customer', header: 'Müşteri', width: 26, type: 'text', accessor: (a) => a.musteri },
                  { key: 'service', header: 'Hizmet', width: 26, type: 'text', accessor: (a) => a.islem },
                  { key: 'staff', header: 'Personel', width: 22, type: 'text', accessor: (a) => a.personel },
                  { key: 'duration', header: 'Süre (dk)', width: 12, type: 'number', accessor: (a) => Number(a.sure || 0) },
                  { key: 'status', header: 'Durum', width: 14, type: 'text', accessor: (a) => statusBadge[a.status]?.label || '' },
                  { key: 'price', header: 'Tutar', width: 16, type: 'currency', accessor: (a) => Number(a.price || 0) },
                  { key: 'notes', header: 'Not', width: 36, type: 'text', accessor: (a) => a.notes || '' },
                ],
                totals: {
                  date: 'TOPLAM',
                  duration: scopedAppointments.reduce((s, a) => s + Number(a.sure || 0), 0),
                  price: scopedAppointments.reduce((s, a) => s + Number(a.price || 0), 0),
                },
              }}
            />
            {!isStaffUser && <AppointmentsCalendarLinkButton tenantId={tenantId} />}
          </div>
        }
      />
      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScopeBadge label={scopeInfo.label} description={scopeInfo.description} />
        </div>

        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && appointments.length === 0}
          emptyMessage="Appointment API döndü ama bu ay için randevu kaydı yok."
        />

        {/* Kurum yöneticisi aksiyon kutusu: saati gelen randevular + onay bekleyen taslaklar */}
        {!isStaffUser && (
          <ManagerAppointmentInbox
            enabled={Boolean(tenantId)}
            tenantId={tenantId}
            onReschedule={(a) => {
              setRescheduleAppt(a)
              setEditingId(a.id)
            }}
            onChanged={reload}
          />
        )}
        {actionError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{actionError}</div>
        )}
        {staffActionMsg && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{staffActionMsg}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricStat
            index={0}
            id="toplam"
            label="Bu ay toplam"
            value={<AnimatedNumber value={monthlyTotal} />}
            icon={Calendar}
            spark={sparkSeries.total}
          />
          <MetricStat
            index={1}
            id="tamamlanan"
            label="Tamamlanan"
            value={<AnimatedNumber value={completed} />}
            icon={CheckCircle2}
            spark={sparkSeries.done}
          />
          <MetricStat
            index={2}
            id="bekleyen"
            label="Bekleyen"
            value={<AnimatedNumber value={pendingCount} />}
            icon={Clock}
            spark={sparkSeries.pending}
          />
          <MetricStat
            index={3}
            id="ciro"
            label="Tahmini ciro"
            value={<AnimatedNumber value={totalRevenue} format={(n) => formatTL(Math.round(n))} />}
            icon={Wallet}
            spark={sparkSeries.revenue}
          />
        </div>

        {showCalendar && (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden armo-card armo-card-luxury"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-[#f0aac2]/14 blur-3xl"
          />
          <div className="relative flex flex-col gap-3 border-b border-[#ead8df]/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-4">
              {/* Bugün date pill — sol başta stacked "Haz / 04" */}
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="hidden md:flex shrink-0 flex-col items-center justify-center border border-[#efbfd0]/75 bg-gradient-to-br from-[#3a1a2a] via-[#fff7fa] to-[#1d0d17] p-1.5 shadow-[0_8px_24px_-8px_rgba(240,170,194,0.45)]"
              >
                <div className="px-1 text-[9px] font-mono uppercase tracking-[0.22em] text-[#c85776]/70">
                  {todayDate.toLocaleString('tr-TR', { month: 'short' })}
                </div>
                <div className="relative mt-0.5 flex h-10 w-12 items-center justify-center bg-gradient-to-br from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] font-display text-xl font-semibold tabular-nums text-[#2f1724]">
                  {todayDate.getDate()}
                  <motion.span
                    aria-hidden
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/0 via-white/40 to-white/0"
                  />
                </div>
              </motion.div>
              <div>
                <div className="armo-pill !text-[9px]">
                  <span className="armo-pill-dot" />
                  Aylık çizelge
                </div>
                <motion.div
                  key={monthKey}
                  initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-2 armo-heading text-3xl lg:text-4xl capitalize"
                >
                  <span className="armo-shimmer">{monthLabel(`${monthKey}-01`)}</span>
                </motion.div>
                <div className="mt-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/55">
                  {appointments.length} randevu · {appointments.filter((r) => r.status === 'tamamlandi').length} tamamlandı
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isViewingTodaysMonth && (
                <motion.button
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ y: -1 }}
                  type="button"
                  onClick={jumpToToday}
                  className="inline-flex items-center gap-1.5 border border-[#efbfd0]/75 bg-gradient-to-r from-[#f0aac2]/12 to-[#ffd3df]/16 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776] shadow-[0_6px_16px_-6px_rgba(240,170,194,0.5)] transition-colors hover:from-[#f0aac2]/22 hover:to-[#ffd3df]/26"
                  title="Bugüne dön"
                >
                  <Calendar className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Bugün
                </motion.button>
              )}
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05, x: -1 }}
                type="button"
                onClick={() => moveMonth(-1)}
                className="grid h-9 w-9 place-items-center border border-[#ead8df]/70 bg-[#fff4f8]/[0.03] transition-colors hover:border-[#efbfd0]/75 hover:bg-[#f0aac2]/8"
                title="Önceki ay"
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05, x: 1 }}
                type="button"
                onClick={() => moveMonth(1)}
                className="grid h-9 w-9 place-items-center border border-[#ead8df]/70 bg-[#fff4f8]/[0.03] transition-colors hover:border-[#efbfd0]/75 hover:bg-[#f0aac2]/8"
                title="Sonraki ay"
              >
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </div>
          </div>
          <div className="relative grid grid-cols-7 gap-px bg-gradient-to-br from-[#f0aac2]/14 via-[#fff4f8]/8 to-[#d48aa7]/14">
            {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d, idx) => (
              <div
                key={d}
                className={`bg-gradient-to-b from-white to-[#2a1320] px-3 py-3 text-center text-[10px] font-mono uppercase tracking-[0.24em] ${
                  idx >= 5 ? 'text-[#c85776]/55' : 'text-[#352432]/55'
                }`}
              >
                {d}
              </div>
            ))}
            {allCells.map((cell, i) => {
              const { day, type } = cell
              const inCurrentMonth = type === 'curr'
              const items = inCurrentMonth ? byDay[day] || [] : []
              const isSelected = inCurrentMonth && day === selectedDay
              const isToday = inCurrentMonth && day === todayDay
              const isHovered = inCurrentMonth && day === hoverDay
              const dayKey = inCurrentMonth ? `${monthKey}-${String(day).padStart(2, '0')}` : ''
              const noteCount = items.filter((r) => r.notes && r.notes.trim().length > 0).length
              const completedCount = items.filter((r) => r.status === 'tamamlandi').length
              const hasAppointments = items.length > 0
              const weekendIdx = i % 7
              const isWeekend = weekendIdx === 5 || weekendIdx === 6
              return (
                <motion.div
                  key={`${type}-${day}-${i}`}
                  initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.32, delay: i * 0.008, ease: [0.22, 1, 0.36, 1] }}
                  onMouseEnter={() => inCurrentMonth && setHoverDay(day)}
                  onMouseLeave={() => setHoverDay(null)}
                  className={`group/day relative min-h-32 p-3 transition-all duration-300 ${
                    !inCurrentMonth
                      ? 'bg-white/30 opacity-40 hover:opacity-60'
                      : isSelected
                        ? 'bg-gradient-to-br from-[#f0aac2]/18 via-[#fff7fa] to-[#d48aa7]/12 ring-1 ring-inset ring-[#f0aac2]/70 shadow-[inset_0_0_32px_rgba(240,170,194,0.22)]'
                        : isToday
                          ? 'bg-gradient-to-br from-[#f0aac2]/10 via-[#fff7fa] to-[#fff0f5]'
                          : 'bg-white hover:bg-gradient-to-br hover:from-[#f0aac2]/6 hover:to-[#fff0f5]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (inCurrentMonth) {
                        setSelectedDay(day)
                        setScheduleDate(dayKey)
                      } else if (type === 'prev') {
                        moveMonth(-1)
                      } else {
                        moveMonth(1)
                      }
                    }}
                    className="absolute inset-0 z-0 cursor-pointer"
                    aria-label={`${day} günü için saatlik çizelgeyi aç`}
                  />
                  {/* Selected: sağ üst köşede mini ribbon */}
                  {isSelected && (
                    <motion.span
                      layoutId="cal-selected-ribbon"
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                      aria-hidden
                      className="pointer-events-none absolute -right-px -top-px z-[2] h-3 w-3 bg-gradient-to-br from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] shadow-[0_0_10px_rgba(240,170,194,0.85)]"
                    />
                  )}

                  <div className="pointer-events-none relative z-[1] flex items-center justify-between">
                    {/* Gün numarası — bugün için altın daire, seçili için solid burgundy daire, diğerleri düz sayı */}
                    {isToday ? (
                      <motion.span
                        layoutId="cal-today-circle"
                        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                        className="relative grid h-9 w-9 place-items-center font-display text-base font-bold tabular-nums text-[#2f1724]"
                      >
                        <motion.span
                          aria-hidden
                          animate={{ opacity: [0.85, 1, 0.85], scale: [1, 1.06, 1] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                          className="absolute inset-0 rounded-full bg-gradient-to-br from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] shadow-[0_0_18px_rgba(240,170,194,0.85)]"
                        />
                        <span className="relative">{day}</span>
                      </motion.span>
                    ) : isSelected ? (
                      <span className="relative grid h-9 w-9 place-items-center rounded-full border border-[#f0aac2]/65 bg-white/82 font-display text-base font-semibold tabular-nums text-[#c85776]">
                        {day}
                      </span>
                    ) : (
                      <span
                        className={`font-display text-xl leading-none tabular-nums ${
                          !inCurrentMonth
                            ? 'text-[#352432]/30'
                            : isWeekend
                              ? 'text-[#c85776]/55'
                              : 'text-[#352432]/70'
                        }`}
                      >
                        {day}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5">
                      {noteCount > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 border border-amber-300/30 bg-amber-400/10 px-1 py-0.5 text-[8px] font-mono text-amber-700"
                          title={`${noteCount} not`}
                        >
                          <StickyNote className="h-2.5 w-2.5" />
                          {noteCount}
                        </span>
                      )}
                      {hasAppointments && (
                        <motion.span
                          layoutId={`cal-day-count-${day}`}
                          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-mono font-semibold ${
                            completedCount === items.length
                              ? 'bg-emerald-400/22 text-emerald-700 ring-1 ring-emerald-300/35'
                              : items.length >= 5
                                ? 'bg-gradient-to-br from-[#f0aac2] to-[#d48aa7] text-[#2f1724] shadow-[0_0_10px_rgba(240,170,194,0.6)]'
                                : 'bg-[#f0aac2]/22 text-[#c85776] ring-1 ring-[#f0aac2]/35'
                          }`}
                          title={`${items.length} randevu · ${completedCount} tamamlandı`}
                        >
                          {items.length}
                        </motion.span>
                      )}
                    </div>
                  </div>
                  {inCurrentMonth && (
                    <>
                      <div className="relative z-[1] mt-3 space-y-1.5">
                        {items.slice(0, 3).map((r, ridx) => {
                          const b = statusBadge[r.status] || statusBadge.bekliyor
                          const hasNote = r.notes && r.notes.trim().length > 0
                          return (
                            <motion.div
                              key={r.id}
                              initial={{ opacity: 0, x: -4 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.28, delay: ridx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                              whileHover={{ x: 2 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (isStaffUser) {
                                  setNoteEditingId(r.id)
                                } else {
                                  setEditingId(r.id)
                                }
                              }}
                              className="group/apt relative cursor-pointer overflow-hidden border border-[#ead8df]/70 bg-gradient-to-r from-[#fff4f8]/[0.04] to-[#fff4f8]/[0.01] p-2 pl-3 transition-all hover:border-[#efbfd0]/75 hover:from-[#f0aac2]/12 hover:to-[#fff4f8]/[0.03] hover:shadow-[0_4px_14px_-4px_rgba(240,170,194,0.35)]"
                            >
                              {/* Status renkli sol bar */}
                              <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${b.dot}`} />
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] font-semibold tracking-wide text-[#c85776]/95">{r.time}</span>
                                <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                              </div>
                              <div className="mt-1 flex items-center gap-1 truncate text-[11px] font-medium">
                                <span className="truncate">{r.musteri}</span>
                                {r.isOnline && <span className="shrink-0 rounded-full bg-[#c85776]/12 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-[#c85776]">Online</span>}
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[9px] text-[#352432]/45">
                                <span className="truncate">{r.islem}</span>
                                {Number(r.price) > 0 && (
                                  <span className="shrink-0 font-mono tabular-nums text-[#c85776]/80">
                                    {formatTL(Number(r.price))}
                                  </span>
                                )}
                              </div>
                              {hasNote && (
                                <div className="mt-1 flex items-start gap-1 border-l border-amber-300/40 bg-amber-400/[0.06] px-1.5 py-0.5">
                                  <StickyNote className="mt-px h-2.5 w-2.5 shrink-0 text-amber-300" strokeWidth={1.6} />
                                  <span className="line-clamp-1 text-[9px] leading-tight text-amber-700/85">
                                    {r.notes}
                                  </span>
                                </div>
                              )}
                              {/* QUICK ACTIONS */}
                              <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover/apt:opacity-100">
                                {!isStaffUser && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingId(r.id)
                                    }}
                                    title="Düzenle"
                                    className="grid h-5 w-5 place-items-center border border-[#ead8df]/70 bg-white/60 text-[#352432]/70 transition-colors hover:border-[#efbfd0]/75 hover:text-[#352432]"
                                  >
                                    <PenLine className="h-2.5 w-2.5" strokeWidth={1.6} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setNoteEditingId(r.id)
                                  }}
                                  title={hasNote ? 'Notu düzenle' : 'Not ekle'}
                                  className={`grid h-5 w-5 place-items-center border bg-white/60 transition-colors ${
                                    hasNote
                                      ? 'border-amber-300/40 text-amber-700 hover:bg-amber-400/15'
                                      : 'border-[#ead8df]/70 text-[#352432]/70 hover:border-[#efbfd0]/75 hover:text-[#352432]'
                                  }`}
                                >
                                  <StickyNote className="h-2.5 w-2.5" strokeWidth={1.6} />
                                </button>
                                {!isStaffUser && (
                                  <ConfirmDialog
                                    destructive
                                    title="Randevuyu sil"
                                    description={`${r.musteri} · ${r.time} randevusu silinsin mi? Bu işlem geri alınamaz.`}
                                    confirmLabel="Sil"
                                    onConfirm={async () => {
                                      await adminApi.deleteAppointment(r.id, tenantId)
                                      await reload()
                                    }}
                                    trigger={
                                      <button
                                        type="button"
                                        onClick={(e) => e.stopPropagation()}
                                        title="Sil"
                                        className="grid h-5 w-5 place-items-center border border-rose-300/30 bg-rose-500/10 text-rose-700 transition-colors hover:bg-rose-500/25"
                                      >
                                        <XCircle className="h-2.5 w-2.5" strokeWidth={1.6} />
                                      </button>
                                    }
                                  />
                                )}
                              </div>
                            </motion.div>
                          )
                        })}
                        {items.length > 3 && (
                          <div className="text-[9px] font-mono text-[#352432]/40">+{items.length - 3} randevu</div>
                        )}
                      </div>
                      {/* QUICK ADD POPOUT */}
                      <AnimatePresence>
                        {isHovered && canCreateAppointment && (
                          <motion.button
                            initial={{ opacity: 0, scale: 0.85, y: 4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.85, y: 4 }}
                            transition={{ duration: 0.15 }}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedDay(day)
                              setCreateDate(dayKey)
                              setCreateOpen(true)
                            }}
                            className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 border border-[#efbfd0]/75 bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] px-2 py-1 text-[8px] font-mono uppercase tracking-widest text-[#2f1724] shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                          >
                            <Plus className="h-2.5 w-2.5" /> Ekle
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </motion.div>
              )
            })}
          </div>
        </motion.section>
        )}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.3fr)]">
          {/* GÜN ÖZETİ — durum dağılımı, toplam tutar ve yüzdelik segment barı */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white/94 p-6 shadow-[0_18px_50px_-34px_rgba(120,71,88,0.45)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#ffdce8]/45 blur-3xl"
            />
            <div className="relative flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]">
                <Calendar className="h-4 w-4" strokeWidth={1.7} />
              </span>
              <div className="text-[14px] font-semibold tracking-tight text-[#c85776]">{listHeaderLabel}</div>
            </div>

            <div className="relative mt-5 flex items-baseline gap-2">
              <span className="font-display text-[44px] font-bold leading-none tracking-tight text-[#241923] tabular-nums">
                <AnimatedNumber value={selectedAppointments.length} />
              </span>
              <span className="text-[18px] font-semibold text-[#241923]">randevu</span>
            </div>

            <div className="relative mt-7 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4">
              {statusToneOrder.map((key) => {
                const tone = statusTone[key]
                return (
                  <div key={key} className="sm:border-l sm:border-[#f3e4ea] sm:pl-3 sm:first:border-0 sm:first:pl-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#8a7480]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                      {tone.label}
                    </div>
                    <div className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight text-[#241923] tabular-nums">
                      <AnimatedNumber value={dayCounts[key]} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="relative mt-7 flex items-center justify-between gap-3 rounded-[16px] border border-[#f3e4ea] bg-[#fff8fa] px-4 py-3">
              <span className="flex items-center gap-2 text-[12px] font-medium text-[#8a7480]">
                <Wallet className="h-3.5 w-3.5 text-[#c85776]" strokeWidth={1.7} />
                Toplam Tutar
              </span>
              <span className="text-[20px] font-semibold tracking-tight text-[#241923] tabular-nums">
                <AnimatedNumber value={dayTotalAmount} format={(n) => formatTL(Math.round(n))} />
              </span>
            </div>

            <div className="relative mt-5 flex h-2.5 w-full gap-1">
              {daySegments.length ? (
                daySegments.map((segment) => (
                  <motion.span
                    key={segment.key}
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: 1 }}
                    transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    style={{ width: `${segment.pct}%`, transformOrigin: 'left' }}
                    className={`h-full rounded-full bg-gradient-to-r ${segment.tone.bar}`}
                  />
                ))
              ) : (
                <span className="h-full w-full rounded-full bg-[#f6ecf0]" />
              )}
            </div>

            <div className="relative mt-4 flex flex-wrap items-center gap-2">
              {daySegments.map((segment) => (
                <span
                  key={segment.key}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${segment.tone.pill}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${segment.tone.dot}`} />
                  {segment.tone.label} %{segment.pct}
                </span>
              ))}
            </div>
          </motion.div>

          {/* RANDEVU ÇİZELGESİ — zaman çizgili, avatarlı tablo */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white/94 shadow-[0_18px_50px_-34px_rgba(120,71,88,0.45)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[#ffdce8]/40 blur-3xl"
            />
            <div className="relative flex items-center justify-between gap-3 px-5 pb-4 pt-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]">
                  <Calendar className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-[#241923]">Randevu çizelgesi</h2>
                  <div className="text-[11px] text-[#8a7480]">
                    {listHeaderLabel} · {selectedAppointments.length} kayıt
                  </div>
                </div>
              </div>
            </div>
            <div className="relative overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[680px] border-separate border-spacing-0 overflow-hidden rounded-[18px] border border-[#efe1e7] text-left">
                <thead>
                  <tr className="bg-[#fff8fa] text-[11px] font-medium text-[#8a7480]">
                    <th className="px-4 py-3 font-medium">Saat</th>
                    <th className="px-4 py-3 font-medium">Müşteri</th>
                    <th className="px-4 py-3 font-medium">Hizmet</th>
                    <th className="px-4 py-3 font-medium">Uzman</th>
                    <th className="px-4 py-3 font-medium">Durum</th>
                    <th className="px-4 py-3"> </th>
                  </tr>
                </thead>
                <motion.tbody
                  variants={listContainer}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-[#f3e4ea] bg-white"
                >
                  {selectedAppointments.map((r) => {
                    const tone = statusTone[r.status] || statusTone.bekliyor
                    const hasNote = Boolean(r.notes && r.notes.trim())
                    return (
                      <motion.tr
                        key={r.id}
                        variants={listRow}
                        className="group text-[12px] text-[#3d2f3a] transition-colors hover:bg-[#fff8fa]"
                      >
                        <td className="relative px-4 py-4">
                          <span aria-hidden className="absolute left-[21px] top-0 h-full w-px bg-[#f6e3ea]" />
                          <span className="relative flex items-center gap-3">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white ${tone.dot}`} />
                            <span className="text-[13px] font-semibold tabular-nums text-[#241923]">{r.time}</span>
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="flex items-center gap-3">
                            <AvatarBubble name={r.musteri} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="block truncate text-[13px] font-semibold text-[#241923]">{r.musteri}</span>
                                {r.isOnline && <span className="shrink-0 rounded-full bg-[#c85776]/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#c85776]">Online</span>}
                              </span>
                              {r.customerPhone && (
                                <span className="mt-0.5 block text-[11px] text-[#8a7480]">{r.customerPhone}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="block text-[12.5px] font-medium text-[#3d2f3a]">{r.islem}</span>
                          <span className="mt-1 inline-flex items-center gap-1.5">
                            <span className="rounded-md border border-[#f8d8e2] bg-[#fff2f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#c85776]">
                              {r.sure} dk
                            </span>
                            {Number(r.price) > 0 && (
                              <span className="rounded-md border border-[#f3e6ce] bg-[#fffaf0] px-1.5 py-0.5 text-[10px] font-semibold text-[#b08742] tabular-nums">
                                {formatTL(Number(r.price))}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-[12px] text-[#5d4a56]">{r.personel}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                            {tone.label}
                          </span>
                          {!['Cancelled', 'Completed', 'NoShow'].includes(r.rawStatus ?? '') && (
                            <div className="mt-1.5">
                              <AppointmentReminderControl
                                appointmentId={r.id}
                                confirmation={r.customerConfirmation}
                                tenantId={tenantId}
                                onChanged={reload}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className="flex items-center justify-end gap-1">
                            {!isStaffUser && (
                              <button
                                type="button"
                                onClick={() => setEditingId(r.id)}
                                title="Düzenle"
                                className="grid h-7 w-7 place-items-center rounded-lg border border-transparent text-[#a9929d] transition-colors hover:border-[#f3c7d6] hover:bg-[#fff2f6] hover:text-[#c85776]"
                              >
                                <PenLine className="h-3.5 w-3.5" strokeWidth={1.7} />
                              </button>
                            )}
                            {isStaffUser && (
                              <AdminEditDialog
                                triggerVariant="ghost"
                                triggerLabel="Durum"
                                triggerClassName="!min-h-7 rounded-lg px-2.5 py-1 text-[10px]"
                                title={`${r.musteri} randevu durumu`}
                                description="Personel panelinden yalnızca kendi randevunun durumunu güncellersin."
                                note="Backend Staff rolünde Appointment kaydını otomatik olarak TenantUser ↔ StaffMember eşleşmesiyle scope eder."
                                submitLabel="Durumu kaydet"
                                successMessage="Randevu durumu güncellendi."
                                onSubmit={(values) => handleStaffStatusChange(r.id, values as StaffStatusFormValues)}
                                fields={[
                                  {
                                    label: 'Durum',
                                    name: 'status',
                                    type: 'select',
                                    value: r.rawStatus === 'Scheduled' ? 'Confirmed' : r.rawStatus || 'Confirmed',
                                    options: staffStatusOptions,
                                  },
                                  { label: 'Not / neden', name: 'reason', type: 'textarea', value: r.notes || '' },
                                ]}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setNoteEditingId(r.id)}
                              title={hasNote ? 'Notu düzenle' : 'Not ekle'}
                              className={`grid h-7 w-7 place-items-center rounded-lg border transition-colors ${
                                hasNote
                                  ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'
                                  : 'border-transparent text-[#a9929d] hover:border-[#f3c7d6] hover:bg-[#fff2f6] hover:text-[#c85776]'
                              }`}
                            >
                              <StickyNote className="h-3.5 w-3.5" strokeWidth={1.7} />
                            </button>
                            {!isStaffUser && (
                              <ConfirmDialog
                                destructive
                                title="Randevuyu sil"
                                description={`${r.musteri} · ${r.time} randevusu silinsin mi? Bu işlem geri alınamaz; müşteri planı etkilenir.`}
                                confirmLabel="Sil"
                                onConfirm={async () => {
                                  await adminApi.deleteAppointment(r.id, tenantId)
                                  await reload()
                                }}
                                trigger={
                                  <button
                                    type="button"
                                    title="Sil"
                                    className="grid h-7 w-7 place-items-center rounded-lg border border-transparent text-[#a9929d] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                                  </button>
                                }
                              />
                            )}
                          </span>
                        </td>
                      </motion.tr>
                    )
                  })}
                  {!selectedAppointments.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-[12px] text-[#9d7386]">
                        {scope === 'pending'
                          ? 'Bekleyen randevu yok.'
                          : scope === 'today'
                            ? 'Bugün için randevu yok.'
                            : scope === 'week'
                              ? 'Bu hafta için randevu yok.'
                              : 'Seçili günde randevu yok.'}
                      </td>
                    </tr>
                  )}
                </motion.tbody>
              </table>
            </div>
          </motion.div>
        </section>
      </div>

      {/* CREATE EDITOR (controlled — açıldığında seçili gün prefill) */}
      <AppointmentEditor
        mode="create"
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next)
          if (!next) {
            setCreateDate('')
            setCreateTime('')
            setCreateStaffId('')
          }
        }}
        customers={[]}
        serverCustomerSearch
        staff={staffList}
        services={servicesList}
        packages={allPackages}
        tenantId={tenantId}
        onQuickCreateCustomer={quickCreateCustomer}
        onAddToWaitlist={waitlistEnabled ? handleAddToWaitlist : undefined}
        initialValues={{
          date: createDate || selectedDate,
          ...(createTime ? { time: createTime } : {}),
          ...(!isStaffUser && createStaffId ? { staffMemberId: createStaffId } : {}),
        }}
        onSubmit={handleCreateAppointment}
      />

      {/* EDIT EDITOR */}
      {editingAppointment && !isStaffUser && (
        <AppointmentEditor
          mode="edit"
          open={Boolean(editingId)}
          onOpenChange={(next) => !next && setEditingId(null)}
          customers={editingAppointment.customerId ? [{ id: editingAppointment.customerId, name: editingAppointment.musteri, phone: editingAppointment.customerPhone || '' } as Customer] : []}
          staff={staffList}
          services={servicesList}
          packages={allPackages}
          customerLabel={editingAppointment.musteri}
          serviceLabel={editingAppointment.islem}
          staffLabel={editingAppointment.personel}
          initialValues={{
            customerId: editingAppointment.customerId || '',
            serviceDefinitionId: editingAppointment.serviceDefinitionId || '',
            staffMemberId: editingAppointment.staffMemberId || '',
            date: editingAppointment.date,
            time: editingAppointment.time,
            durationMinutes: editingAppointment.sure,
            price: Number(editingAppointment.price || 0),
            notes: editingAppointment.notes,
            status: editingAppointment.rawStatus || 'Scheduled',
          }}
          onSubmit={async (values) => {
            await handleEditAppointment(editingAppointment.id, values)
          }}
        />
      )}

      {/* NOTE-ONLY EDITOR */}
      {noteEditingAppointment && (
        <AppointmentEditor
          mode="edit"
          noteOnly
          open={Boolean(noteEditingId)}
          onOpenChange={(next) => !next && setNoteEditingId(null)}
          customers={noteEditingAppointment.customerId ? [{ id: noteEditingAppointment.customerId, name: noteEditingAppointment.musteri, phone: noteEditingAppointment.customerPhone || '' } as Customer] : []}
          staff={staffList}
          services={servicesList}
          packages={allPackages}
          customerLabel={noteEditingAppointment.musteri}
          initialValues={{
            customerId: noteEditingAppointment.customerId || '',
            serviceDefinitionId: noteEditingAppointment.serviceDefinitionId || '',
            staffMemberId: noteEditingAppointment.staffMemberId || '',
            date: noteEditingAppointment.date,
            time: noteEditingAppointment.time,
            durationMinutes: noteEditingAppointment.sure,
            price: Number(noteEditingAppointment.price || 0),
            notes: noteEditingAppointment.notes,
            status: noteEditingAppointment.rawStatus || 'Scheduled',
          }}
          onSubmit={async (values) => {
            await adminApi.changeAppointmentNotes(noteEditingAppointment.id, { notes: values.notes || null }, tenantId)
            await reload()
          }}
        />
      )}

      {/* GÜNLÜK SAATLİK PERSONEL ÇİZELGESİ — takvimde güne tıklanınca açılır */}
      <DayScheduleModal
        open={Boolean(scheduleDate)}
        date={scheduleDate}
        appointments={appointments}
        staff={isStaffUser && selfStaff ? [selfStaff] : staffList}
        customers={normalizedLookups.customers}
        timeOffs={monthTimeOffs}
        isStaffUser={isStaffUser}
        busy={leaveBusy}
        onToggleLeave={!isStaffUser ? handleToggleLeave : undefined}
        onClose={() => setScheduleDate(null)}
        onEditAppointment={(id) => {
          setScheduleDate(null)
          if (isStaffUser) setNoteEditingId(id)
          else setEditingId(id)
        }}
        onCreateAt={
          canCreateAppointment
            ? ({ date, time, staffId }) => {
                setScheduleDate(null)
                setCreateDate(date)
                setCreateTime(time || '')
                setCreateStaffId(staffId || '')
                setCreateOpen(true)
              }
            : undefined
        }
      />

    </>
  )
}

export default function RandevularPage() {
  return (
    <Suspense fallback={null}>
      <RandevularPageInner />
    </Suspense>
  )
}
