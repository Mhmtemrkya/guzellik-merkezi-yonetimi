'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizeAppointment, normalizeStaff, normalizeStaffTimeOff } from '@/lib/apiMappers'
import type { ApiAppointment, ApiStaff, ApiStaffTimeOff, AppointmentStatusKey } from '@/lib/types'
import {
  CalendarCheck2, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, ImagePlus,
  Lock, Plane, Umbrella, UserRound, Users, X,
} from 'lucide-react'

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const WEEKDAYS_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

type ViewKey = 'day' | 'week' | 'month'

/** Durum → görsel kimliği (Stitch çizelge paleti). */
const STATUS_META: Record<AppointmentStatusKey, { bar: string; label: string; pillBg: string; pillText: string }> = {
  tamamlandi: { bar: '#2f9e72', label: 'Tamamlandı', pillBg: 'rgba(47,158,114,.12)', pillText: '#23805c' },
  devam: { bar: '#3b82f6', label: 'Devam', pillBg: 'rgba(59,130,246,.12)', pillText: '#2563eb' },
  bekliyor: { bar: '#b88938', label: 'Bekliyor', pillBg: 'rgba(184,137,56,.16)', pillText: '#946d23' },
  taslak: { bar: '#8b6fc9', label: 'Taslak', pillBg: 'rgba(139,111,201,.16)', pillText: '#6d51b0' },
  iptal: { bar: '#d1556f', label: 'İptal', pillBg: 'rgba(209,85,111,.12)', pillText: '#c23e5e' },
  islemde: { bar: '#8b5cf6', label: 'İşlemde', pillBg: 'rgba(139,92,246,.16)', pillText: '#7c3aed' },
}

/** Yerel takvim günü anahtarı (YYYY-MM-DD) — normalizeAppointment.date (localDateKey) ile hizalı. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Görseli ≤256px'e küçültüp JPEG data-URL döndürür. */
function downscaleImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Dosya okunamadı.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Görsel çözümlenemedi.'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas oluşturulamadı.'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export default function StaffSchedulePage() {
  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const canSchedule = useFeature('staff.schedule')

  const [view, setView] = useState<ViewKey>('day')
  const [cursor, setCursor] = useState<Date>(() => localMidnight(new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const todayKey = dayKey(new Date())

  // Haftanın günleri (Pazartesi başlangıç, cursor'un haftası).
  const weekDays = useMemo<Date[]>(() => {
    const dow = cursor.getDay()
    const offsetToMonday = (dow + 6) % 7
    const monday = new Date(cursor)
    monday.setDate(cursor.getDate() - offsetToMonday)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
  }, [cursor])

  // Ay aralığı (cursor'un ayı)
  const monthInfo = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    return { first, last }
  }, [cursor])

  const rangeFrom = view === 'day' ? cursor : view === 'week' ? weekDays[0] : monthInfo.first
  const rangeTo = view === 'day' ? cursor : view === 'week' ? weekDays[6] : monthInfo.last
  const fromIso = new Date(rangeFrom.getFullYear(), rangeFrom.getMonth(), rangeFrom.getDate(), 0, 0, 0, 0).toISOString()
  const toIso = new Date(rangeTo.getFullYear(), rangeTo.getMonth(), rangeTo.getDate(), 23, 59, 59, 999).toISOString()

  const { data, reload } = useApiQuery<{ staff: ApiStaff[]; appts: ApiAppointment[]; timeoff: ApiStaffTimeOff[] }>(
    async () => {
      if (!tenantId || !canSchedule) return { staff: [], appts: [], timeoff: [] }
      const [staff, appts, timeoff] = await Promise.all([
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, fromUtc: fromIso, toUtc: toIso, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.timeOff<ApiStaffTimeOff>({ tenantId, fromDate: dayKey(rangeFrom), toDate: dayKey(rangeTo) }).catch(() => []),
      ])
      return { staff: apiItems(staff), appts: apiItems(appts), timeoff: Array.isArray(timeoff) ? timeoff : [] }
    },
    [tenantId, canSchedule, fromIso, toIso],
    { initialData: { staff: [], appts: [], timeoff: [] } },
  )

  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)).filter((s) => s.active), [data])
  const appointments = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const timeOffs = useMemo(() => (data?.timeoff || []).map((t, i) => normalizeStaffTimeOff(t, i)), [data])

  // Indeksler: staffId|date → randevular (saate göre sıralı); staffId|date → izinId
  const apptIndex = useMemo(() => {
    const map = new Map<string, typeof appointments>()
    for (const a of appointments) {
      if (!a.staffMemberId) continue
      const k = `${a.staffMemberId}|${a.date}`
      const arr = map.get(k) ?? []
      arr.push(a)
      map.set(k, arr)
    }
    for (const arr of map.values()) arr.sort((x, y) => x.time.localeCompare(y.time))
    return map
  }, [appointments])

  const timeOffIndex = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of timeOffs) map.set(`${t.staffMemberId}|${t.date}`, t.id)
    return map
  }, [timeOffs])

  // Üst metrikler (görünüme göre doluluk)
  const stats = useMemo(() => {
    const planned = appointments.filter((a) => a.status !== 'iptal').length
    let occupancy = 0
    if (view === 'day') {
      const k = dayKey(cursor)
      const busyStaff = staff.filter((s) => (apptIndex.get(`${s.id}|${k}`)?.length ?? 0) > 0).length
      occupancy = staff.length ? Math.round((busyStaff / staff.length) * 100) : 0
    } else if (view === 'week') {
      const keys = weekDays.map((d) => dayKey(d))
      let filled = 0
      for (const s of staff) for (const k of keys) if ((apptIndex.get(`${s.id}|${k}`)?.length ?? 0) > 0) filled++
      occupancy = staff.length ? Math.round((filled / (staff.length * 7)) * 100) : 0
    } else {
      const byDay = new Set(appointments.filter((a) => a.status !== 'iptal').map((a) => a.date))
      const days = monthInfo.last.getDate()
      occupancy = Math.round((byDay.size / days) * 100)
    }
    return { planned, occupancy, leaves: timeOffs.length, staffCount: staff.length }
  }, [appointments, staff, apptIndex, timeOffs, view, cursor, weekDays, monthInfo])

  if (!canSchedule) {
    return (
      <>
        <Topbar title="Personel Çizelgesi" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'Personel', 'Çizelge']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl">Personel Çizelgesi</div>
          <p className="mt-2 text-[13px] text-[#352432]/55">
            Bu özellik paketinizde yok. Çizelge, personel fotoğrafı ve izin yönetimi için planınızı yükseltin.
          </p>
        </div>
      </>
    )
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem başarısız')
    } finally {
      setBusy(false)
    }
  }

  const toggleLeave = (staffId: string, date: string) => {
    const existing = timeOffIndex.get(`${staffId}|${date}`)
    if (existing) return run(() => adminApi.removeTimeOff(existing, tenantId))
    return run(() => adminApi.addTimeOff({ staffMemberId: staffId, date, reason: null }, tenantId))
  }

  const uploadPhoto = async (s: (typeof staff)[number], file: File) => {
    if (!file.type.startsWith('image/')) { setError('Lütfen görsel seçin.'); return }
    const dataUrl = await downscaleImage(file, 256)
    await run(() =>
      adminApi.updateStaff(s.id, {
        fullName: s.name, title: s.role, phone: s.phone || null, specialties: s.dept || null,
        commissionRate: s.commissionRate ?? null, isActive: s.active, permissions: s.permissions, photoUrl: dataUrl,
      }, tenantId),
    )
  }

  const shift = (dir: 1 | -1) => setCursor((c) => {
    const n = new Date(c)
    if (view === 'day') n.setDate(c.getDate() + dir)
    else if (view === 'week') n.setDate(c.getDate() + dir * 7)
    else n.setMonth(c.getMonth() + dir)
    return n
  })
  const shiftMonth = (dir: 1 | -1) => setCursor((c) => {
    const n = new Date(c)
    n.setMonth(c.getMonth() + dir)
    return n
  })
  const goToday = () => setCursor(localMidnight(new Date()))
  const jumpToDay = (d: Date) => { setCursor(localMidnight(d)); setView('day') }

  const periodLabel = view === 'day'
    ? `${cursor.getDate()} ${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === 'week'
      ? `${weekDays[0].getDate()} ${MONTHS[weekDays[0].getMonth()]} – ${weekDays[6].getDate()} ${MONTHS[weekDays[6].getMonth()]}`
      : `${MONTHS[monthInfo.first.getMonth()]} ${monthInfo.first.getFullYear()}`
  const periodSub = view === 'day' ? WEEKDAYS_FULL[(cursor.getDay() + 6) % 7] : view === 'week' ? `${weekDays[0].getFullYear()} · Hafta görünümü` : 'Ay görünümü'

  const STAT_CARDS: Array<{ icon: typeof CalendarDays; label: string; value: string; tone: string }> = [
    { icon: CalendarCheck2, label: 'Doluluk', value: `%${stats.occupancy}`, tone: '#c85776' },
    { icon: CalendarDays, label: 'Planlı Randevu', value: String(stats.planned), tone: '#b88938' },
    { icon: Umbrella, label: 'İzinli', value: String(stats.leaves), tone: '#5aa9e6' },
    { icon: Users, label: 'Aktif Personel', value: String(stats.staffCount), tone: '#2f9e72' },
  ]

  return (
    <>
      <Topbar
        title="Personel Çizelgesi"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'Personel', 'Çizelge']}
      />

      <div className="space-y-4">
        {/* Kontrol barı */}
        <div className="flex flex-col gap-3 rounded-[20px] border border-[#ead8df]/70 bg-white/92 px-4 py-3 shadow-[0_18px_40px_-30px_rgba(200,87,118,0.45)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="grid h-9 w-9 place-items-center rounded-[11px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8] hover:text-[#c85776]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[190px] text-center">
              <div className="font-display text-lg leading-tight tracking-tight text-[#3b2330]">{periodLabel}</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#c85776]/70">{periodSub}</div>
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              className="grid h-9 w-9 place-items-center rounded-[11px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8] hover:text-[#c85776]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="ml-1 rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[11px] font-medium text-[#352432]/65 transition-colors hover:bg-[#fff4f8] hover:text-[#c85776]"
            >
              Bugün
            </button>
          </div>

          <div className="flex items-center gap-1 self-start rounded-[12px] border border-[#ead8df] bg-[#f7ecf1]/70 p-1 md:self-auto">
            {([['day', 'Günlük', CalendarDays], ['week', 'Haftalık', CalendarRange], ['month', 'Aylık', CalendarCheck2]] as const).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`flex items-center gap-1.5 rounded-[9px] px-3.5 py-1.5 text-[12px] font-medium transition-all ${
                  view === v
                    ? 'bg-gradient-to-r from-[#f47699] to-[#ef6088] text-white shadow-[0_8px_18px_-10px_rgba(200,87,118,0.8)]'
                    : 'text-[#352432]/55 hover:text-[#c85776]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Özet kartları */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STAT_CARDS.map((c) => (
            <div key={c.label} className="relative overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white p-4 shadow-[0_4px_10px_-6px_rgba(0,0,0,0.06)]">
              <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-gradient-to-br from-[#e9a6bf]/15 to-transparent" />
              <div className="grid h-9 w-9 place-items-center rounded-[11px]" style={{ backgroundColor: `${c.tone}14`, color: c.tone }}>
                <c.icon className="h-[18px] w-[18px]" />
              </div>
              <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[#352432]/45">{c.label}</div>
              <div className="font-display text-2xl text-[#3b2330]">{c.value}</div>
            </div>
          ))}
        </div>

        {error && <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}

        {/* Görünümler */}
        {view === 'month' ? (
          <MonthGrid monthInfo={monthInfo} appointments={appointments} timeOffs={timeOffs} todayKey={todayKey} onPickDay={jumpToDay} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
            <div>
              {view === 'day' ? (
                <DayAgenda
                  dayKeyStr={dayKey(cursor)}
                  staff={staff}
                  appointments={appointments}
                  timeOffIndex={timeOffIndex}
                  busy={busy}
                  onToggleLeave={toggleLeave}
                  onUploadPhoto={uploadPhoto}
                />
              ) : (
                <WeekGrid
                  weekDays={weekDays}
                  staff={staff}
                  apptIndex={apptIndex}
                  timeOffIndex={timeOffIndex}
                  busy={busy}
                  todayKey={todayKey}
                  onToggleLeave={toggleLeave}
                  onUploadPhoto={uploadPhoto}
                  onPickDay={jumpToDay}
                />
              )}
            </div>
            <SidePanel
              view={view}
              cursor={cursor}
              appointments={appointments}
              timeOffs={timeOffs}
              staff={staff}
              apptIndex={apptIndex}
              weekDays={weekDays}
              occupancy={stats.occupancy}
              todayKey={todayKey}
              onShiftMonth={shiftMonth}
              onPickDay={jumpToDay}
            />
          </div>
        )}

        {/* Lejant */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-[14px] border border-[#ead8df]/70 bg-white/86 px-4 py-2.5 text-[11px] text-[#352432]/60">
          {[['#2f9e72', 'Tamamlandı'], ['#3b82f6', 'Devam'], ['#b88938', 'Bekliyor'], ['#8b6fc9', 'Taslak'], ['#5aa9e6', 'İzinli'], ['#d1556f', 'İptal']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} /> {l}</span>
          ))}
        </div>
      </div>
    </>
  )
}

type StaffItem = ReturnType<typeof normalizeStaff>
type ApptItem = ReturnType<typeof normalizeAppointment>

function StaffAvatar({ s, onUpload, busy, size = 40 }: { s: StaffItem; onUpload: (s: StaffItem, f: File) => void; busy: boolean; size?: number }) {
  return (
    <label
      title="Fotoğraf yükle"
      style={{ width: size, height: size }}
      className={`relative grid shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#ead8df] bg-[#fff4f8]/60 ${busy ? 'opacity-60' : ''}`}
    >
      {s.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.photoUrl} alt={s.name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-display text-[11px] text-[#8e3f5b]">{s.name.slice(0, 2).toUpperCase()}</span>
      )}
      <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity hover:opacity-100">
        <ImagePlus className="h-3.5 w-3.5 text-white" />
      </span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(s, f)
          e.target.value = ''
        }}
      />
    </label>
  )
}

/** Saat ekseni + personel sütunları + zamana göre konumlanmış randevu kartları. */
function DayAgenda({
  dayKeyStr, staff, appointments, timeOffIndex, busy, onToggleLeave, onUploadPhoto,
}: {
  dayKeyStr: string
  staff: StaffItem[]
  appointments: ApptItem[]
  timeOffIndex: Map<string, string>
  busy: boolean
  onToggleLeave: (staffId: string, date: string) => void
  onUploadPhoto: (s: StaffItem, f: File) => void
}) {
  const HOUR = 64
  const HEADER = 66

  const dayAppts = useMemo(() => appointments.filter((a) => a.date === dayKeyStr), [appointments, dayKeyStr])
  const byStaff = useMemo(() => {
    const m = new Map<string, ApptItem[]>()
    for (const a of dayAppts) {
      const k = a.staffMemberId || '__none__'
      const arr = m.get(k) ?? []
      arr.push(a)
      m.set(k, arr)
    }
    for (const arr of m.values()) arr.sort((x, y) => x.time.localeCompare(y.time))
    return m
  }, [dayAppts])

  // Sütunlar: aktif personel + (varsa) atanmamış randevular için ek sütun
  const columns = useMemo(() => {
    const cols: Array<{ id: string; staff?: StaffItem }> = staff.map((s) => ({ id: s.id, staff: s }))
    if ((byStaff.get('__none__')?.length ?? 0) > 0) cols.push({ id: '__none__' })
    return cols
  }, [staff, byStaff])

  // Saat aralığı: 09–20 varsayılan, randevulara göre genişler.
  const { startH, endH, hours } = useMemo(() => {
    let s = 9
    let e = 20
    for (const a of dayAppts) {
      const m = hhmmToMin(a.time)
      s = Math.min(s, Math.floor(m / 60))
      e = Math.max(e, Math.ceil((m + (a.sure || 30)) / 60))
    }
    s = Math.max(6, Math.min(s, 9))
    e = Math.min(23, Math.max(e, 20))
    const hrs: number[] = []
    for (let h = s; h <= e; h++) hrs.push(h)
    return { startH: s, endH: e, hours: hrs }
  }, [dayAppts])

  const colH = (endH - startH) * HOUR

  if (staff.length === 0) {
    return <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/86 px-5 py-12 text-center text-sm text-[#352432]/45">Aktif personel yok.</div>
  }

  return (
    <div className="overflow-x-auto rounded-[20px] border border-[#ead8df]/70 bg-white/92 shadow-[0_18px_40px_-30px_rgba(200,87,118,0.45)]">
      <div className="flex" style={{ minWidth: 80 + columns.length * 150 }}>
        {/* Zaman ekseni */}
        <div className="relative w-14 shrink-0 border-r border-[#ead8df]/60">
          <div style={{ height: HEADER }} className="grid place-items-center text-[#c85776]/50"><Clock className="h-4 w-4" /></div>
          <div className="relative" style={{ height: colH }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute left-0 right-0 text-center text-[10px] font-medium tabular-nums text-[#352432]/45" style={{ top: i * HOUR - 7 }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {/* Personel sütunları */}
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(150px, 1fr))` }}>
          {columns.map((col) => {
            const appts = byStaff.get(col.id) ?? []
            const leaveId = col.staff ? timeOffIndex.get(`${col.staff.id}|${dayKeyStr}`) : undefined
            return (
              <div key={col.id} className="border-l border-[#ead8df]/50 first:border-l-0">
                {/* Sütun başlığı */}
                <div className="flex items-center gap-2 border-b border-[#ead8df]/60 bg-[#f7ecf1]/40 px-2.5" style={{ height: HEADER }}>
                  {col.staff ? (
                    <>
                      <StaffAvatar s={col.staff} onUpload={onUploadPhoto} busy={busy} size={36} />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-[#3b2330]">{col.staff.name}</div>
                        <div className="truncate text-[9px] font-medium uppercase tracking-wide text-[#c85776]/60">{col.staff.role}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0e7ec] text-[#705a66]"><UserRound className="h-4 w-4" /></span>
                      <div className="text-[12px] font-semibold text-[#705a66]">Atanmamış</div>
                    </>
                  )}
                  {col.staff && (
                    <button
                      type="button"
                      disabled={busy}
                      title={leaveId ? 'İzni kaldır' : 'İzinli işaretle'}
                      onClick={() => onToggleLeave(col.staff!.id, dayKeyStr)}
                      className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10px] transition-colors ${
                        leaveId ? 'border-rose-300 bg-rose-100 text-rose-600' : 'border-[#ead8df] bg-white text-[#352432]/35 hover:text-[#c85776]'
                      }`}
                    >
                      {leaveId ? <X className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
                    </button>
                  )}
                </div>

                {/* Sütun gövdesi */}
                <div className={`relative ${leaveId ? 'bg-[repeating-linear-gradient(45deg,#eef4fb,#eef4fb_10px,#fff_10px,#fff_20px)]' : ''}`} style={{ height: colH }}>
                  {hours.map((_, i) => (
                    <div key={i} className="absolute left-0 right-0 border-t border-dashed border-[#ead8df]/45" style={{ top: i * HOUR }} />
                  ))}
                  {leaveId ? (
                    <div className="absolute inset-x-2 top-3 flex items-center justify-center gap-1.5 rounded-[10px] border border-[#bdd9f2] bg-white/80 py-2 text-[11px] font-medium text-[#3e86c0]">
                      <Umbrella className="h-3.5 w-3.5" /> Tüm gün izinli
                    </div>
                  ) : appts.length === 0 ? (
                    <div className="absolute inset-0 grid place-items-center text-[10px] text-[#352432]/25">—</div>
                  ) : (
                    appts.map((a) => {
                      const meta = STATUS_META[a.status]
                      const startMin = hhmmToMin(a.time)
                      const top = ((startMin - startH * 60) / 60) * HOUR
                      const h = Math.max(34, ((a.sure || 30) / 60) * HOUR - 4)
                      const endLabel = a.sure ? minToHHMM(startMin + a.sure) : ''
                      return (
                        <div
                          key={a.id}
                          title={`${a.musteri} · ${a.islem} · ${a.personel}`}
                          className="absolute left-1.5 right-1.5 overflow-hidden rounded-[10px] border border-[#ead8df]/60 bg-[#fdf5f8] pl-2 pr-1.5 py-1.5 shadow-[0_4px_10px_-6px_rgba(200,87,118,0.4)] transition-shadow hover:shadow-[0_10px_22px_-12px_rgba(200,87,118,0.6)]"
                          style={{ top: Math.max(0, top), height: h, borderLeftWidth: 4, borderLeftColor: meta.bar }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-bold tabular-nums text-[#3b2330]">{a.time}{endLabel && <span className="font-medium text-[#352432]/45"> – {endLabel}</span>}</span>
                            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide" style={{ backgroundColor: meta.pillBg, color: meta.pillText }}>{meta.label}</span>
                          </div>
                          {h > 44 && (
                            <>
                              <div className="mt-0.5 truncate text-[12px] font-semibold leading-tight text-[#241923]">{a.musteri}</div>
                              <div className="truncate text-[10px] font-medium leading-tight text-[#c85776]">{a.islem}</div>
                            </>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeekGrid({
  weekDays, staff, apptIndex, timeOffIndex, busy, todayKey, onToggleLeave, onUploadPhoto, onPickDay,
}: {
  weekDays: Date[]
  staff: StaffItem[]
  apptIndex: Map<string, ApptItem[]>
  timeOffIndex: Map<string, string>
  busy: boolean
  todayKey: string
  onToggleLeave: (staffId: string, date: string) => void
  onUploadPhoto: (s: StaffItem, f: File) => void
  onPickDay: (d: Date) => void
}) {
  if (staff.length === 0) {
    return <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/86 px-5 py-12 text-center text-sm text-[#352432]/45">Aktif personel yok.</div>
  }
  return (
    <div className="overflow-x-auto rounded-[20px] border border-[#ead8df]/70 bg-white/92 shadow-[0_18px_40px_-30px_rgba(200,87,118,0.45)]">
      <div className="min-w-[720px]">
        {/* Personel başlıkları */}
        <div className="grid border-b border-[#ead8df]/70 bg-[#f7ecf1]/40" style={{ gridTemplateColumns: `92px repeat(${staff.length}, minmax(150px, 1fr))` }}>
          <div className="px-3 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[#352432]/40">Gün</div>
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border-l border-[#ead8df]/50 px-3 py-2.5">
              <StaffAvatar s={s} onUpload={onUploadPhoto} busy={busy} size={36} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[#3b2330]">{s.name}</div>
                <div className="truncate text-[9px] font-medium uppercase tracking-wide text-[#c85776]/55">{s.role}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Günler */}
        {weekDays.map((d, di) => {
          const key = dayKey(d)
          const isToday = key === todayKey
          return (
            <div
              key={key}
              className="grid border-b border-[#ead8df]/40 last:border-b-0"
              style={{ gridTemplateColumns: `92px repeat(${staff.length}, minmax(150px, 1fr))` }}
            >
              <button
                type="button"
                onClick={() => onPickDay(d)}
                title="Bu günü aç"
                className={`px-3 py-3 text-left transition-colors hover:bg-[#fff1f6] ${isToday ? 'bg-[#fff1f6]/70' : ''}`}
              >
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#c85776]/70">{WEEKDAYS[di]}</div>
                <div className="font-display text-lg leading-none text-[#3b2330]">{d.getDate()}</div>
              </button>
              {staff.map((s) => {
                const cellKey = `${s.id}|${key}`
                const appts = apptIndex.get(cellKey) ?? []
                const leaveId = timeOffIndex.get(cellKey)
                return (
                  <div key={s.id} className={`relative min-h-[74px] border-l border-[#ead8df]/40 p-1.5 ${leaveId ? 'bg-[repeating-linear-gradient(45deg,#eef4fb,#eef4fb_8px,#fff_8px,#fff_16px)]' : ''}`}>
                    <button
                      type="button"
                      disabled={busy}
                      title={leaveId ? 'İzni kaldır' : 'İzinli işaretle'}
                      onClick={() => onToggleLeave(s.id, key)}
                      className={`absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-md border text-[10px] transition-colors ${
                        leaveId ? 'border-rose-300 bg-rose-100 text-rose-600' : 'border-[#ead8df] bg-white/70 text-[#352432]/30 hover:text-[#c85776]'
                      }`}
                    >
                      {leaveId ? <X className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
                    </button>
                    {leaveId ? (
                      <div className="flex h-full items-center justify-center text-[10px] font-medium uppercase tracking-widest text-[#3e86c0]/70">İzinli</div>
                    ) : appts.length === 0 ? (
                      <div className="h-full" />
                    ) : (
                      <div className="space-y-1 pr-5">
                        {appts.slice(0, 3).map((a) => {
                          const meta = STATUS_META[a.status]
                          return (
                            <div key={a.id} className="rounded-[8px] bg-[#fdf5f8] px-1.5 py-1" style={{ borderLeft: `3px solid ${meta.bar}` }}>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] font-bold tabular-nums text-[#352432]/60">{a.time}</span>
                                <span className="truncate text-[10px] font-semibold text-[#241923]">{a.musteri}</span>
                              </div>
                              <div className="truncate text-[9px] font-medium text-[#c85776]/80">{a.islem}</div>
                            </div>
                          )
                        })}
                        {appts.length > 3 && <div className="pl-1 text-[9px] font-medium text-[#352432]/40">+{appts.length - 3} randevu</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthGrid({
  monthInfo, appointments, timeOffs, todayKey, onPickDay,
}: {
  monthInfo: { first: Date; last: Date }
  appointments: ApptItem[]
  timeOffs: ReturnType<typeof normalizeStaffTimeOff>[]
  todayKey: string
  onPickDay: (d: Date) => void
}) {
  const apptByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of appointments) if (a.status !== 'iptal') m.set(a.date, (m.get(a.date) ?? 0) + 1)
    return m
  }, [appointments])
  const leaveByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of timeOffs) m.set(t.date, (m.get(t.date) ?? 0) + 1)
    return m
  }, [timeOffs])
  const maxCount = Math.max(1, ...apptByDay.values())

  const cells = useMemo<(Date | null)[]>(() => {
    const first = monthInfo.first
    const startDow = (first.getDay() + 6) % 7
    const daysInMonth = monthInfo.last.getDate()
    const arr: (Date | null)[] = Array.from({ length: startDow }, () => null)
    for (let day = 1; day <= daysInMonth; day++) arr.push(new Date(first.getFullYear(), first.getMonth(), day))
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [monthInfo])

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_18px_40px_-30px_rgba(200,87,118,0.45)]">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-[#352432]/40">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="min-h-[92px] rounded-[12px] bg-[#fff4f8]/20" />
          const key = dayKey(d)
          const count = apptByDay.get(key) ?? 0
          const leaves = leaveByDay.get(key) ?? 0
          const isToday = key === todayKey
          const intensity = count / maxCount
          return (
            <motion.button
              key={key}
              type="button"
              whileHover={{ y: -3 }}
              onClick={() => onPickDay(d)}
              className={`min-h-[92px] rounded-[12px] border p-2 text-left transition-colors ${isToday ? 'border-[#c85776]/50 bg-[#fff1f6]/70' : 'border-[#ead8df]/60 bg-white hover:border-[#efbfd0]'}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-display text-base leading-none ${isToday ? 'text-[#c85776]' : 'text-[#3b2330]'}`}>{d.getDate()}</span>
                {leaves > 0 && <Plane className="h-3 w-3 text-[#5aa9e6]" />}
              </div>
              {count > 0 ? (
                <>
                  <div className="mt-2 flex items-center gap-1 text-[11px]">
                    <CalendarDays className="h-3 w-3 text-[#c85776]" />
                    <AnimatedNumber value={count} className="font-display tabular-nums beautyasist-text-gradient" />
                    <span className="text-[9px] text-[#352432]/40">randevu</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#f3c2d2] to-[#e0617f]" style={{ width: `${Math.max(12, intensity * 100)}%` }} />
                  </div>
                </>
              ) : (
                <div className="mt-3 text-[10px] text-[#352432]/25">—</div>
              )}
              {leaves > 0 && <div className="mt-1 text-[9px] font-medium text-[#5aa9e6]">{leaves} izinli</div>}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

/** Sağ kenar: mini takvim + günün/haftanın özeti + personel yükü. */
function SidePanel({
  view, cursor, appointments, timeOffs, staff, apptIndex, weekDays, occupancy, todayKey, onShiftMonth, onPickDay,
}: {
  view: ViewKey
  cursor: Date
  appointments: ApptItem[]
  timeOffs: ReturnType<typeof normalizeStaffTimeOff>[]
  staff: StaffItem[]
  apptIndex: Map<string, ApptItem[]>
  weekDays: Date[]
  occupancy: number
  todayKey: string
  onShiftMonth: (dir: 1 | -1) => void
  onPickDay: (d: Date) => void
}) {
  const cursorKey = dayKey(cursor)

  // Durum dağılımı (görünümdeki randevular)
  const breakdown = useMemo(() => {
    const b = { tamamlandi: 0, devam: 0, bekliyor: 0, taslak: 0 }
    for (const a of appointments) if (a.status in b) (b as Record<string, number>)[a.status]++
    return b
  }, [appointments])

  // Personel yükü (görünümün tüm günleri)
  const dayKeys = view === 'day' ? [cursorKey] : weekDays.map((d) => dayKey(d))
  const load = staff.map((s) => {
    let total = 0
    let activeDays = 0
    for (const k of dayKeys) {
      const n = apptIndex.get(`${s.id}|${k}`)?.length ?? 0
      total += n
      if (n > 0) activeDays++
    }
    return { s, total, pct: dayKeys.length ? Math.round((activeDays / dayKeys.length) * 100) : 0 }
  }).sort((a, b) => b.total - a.total)

  const summaryTitle = view === 'day' ? 'Günün Özeti' : 'Haftanın Özeti'

  return (
    <div className="space-y-4">
      <MiniCalendar cursor={cursor} appointments={appointments} timeOffs={timeOffs} todayKey={todayKey} onShiftMonth={onShiftMonth} onPickDay={onPickDay} />

      <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_4px_10px_-6px_rgba(0,0,0,0.06)]">
        <div className="font-display text-[15px] text-[#3b2330]">{summaryTitle}</div>
        <div className="relative mx-auto mt-3 grid h-28 w-28 place-items-center rounded-full" style={{ background: `conic-gradient(#ef6088 0% ${occupancy}%, #f7ecf1 ${occupancy}% 100%)` }}>
          <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-white text-center">
            <div>
              <div className="font-display text-xl leading-none text-[#3b2330]">%{occupancy}</div>
              <div className="text-[8px] font-medium uppercase tracking-wide text-[#352432]/45">doluluk</div>
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2 text-[12px]">
          {([['tamamlandi', '#2f9e72', 'Tamamlanan'], ['devam', '#3b82f6', 'Devam eden'], ['bekliyor', '#b88938', 'Bekleyen'], ['taslak', '#8b6fc9', 'Taslak']] as const).map(([k, c, l]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[#4a3a44]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} /> {l}</span>
              <span className="font-semibold text-[#3b2330]">{breakdown[k]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_4px_10px_-6px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#3b2330]"><Users className="h-4 w-4 text-[#c85776]" /> Personel Yükü</div>
        <div className="mt-3 space-y-2.5">
          {load.map(({ s, total, pct }) => (
            <div key={s.id} className="flex items-center gap-2.5">
              {s.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.photoUrl} alt={s.name} className="h-8 w-8 shrink-0 rounded-full border border-[#efbfd0]/50 object-cover" />
              ) : (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fbd2dc] text-[9px] font-display text-[#8e3f5b]">{s.name.slice(0, 2).toUpperCase()}</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-medium text-[#352432]">{s.name}</span>
                  <span className="text-[#352432]/45">{total} randevu</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, pct)}%`, backgroundColor: pct >= 70 ? '#e0617f' : pct >= 30 ? '#e6a14f' : '#3cae8d' }} />
                </div>
              </div>
            </div>
          ))}
          {staff.length === 0 && <div className="py-4 text-center text-[11px] text-[#352432]/40">Aktif personel yok.</div>}
        </div>
      </div>
    </div>
  )
}

function MiniCalendar({
  cursor, appointments, timeOffs, todayKey, onShiftMonth, onPickDay,
}: {
  cursor: Date
  appointments: ApptItem[]
  timeOffs: ReturnType<typeof normalizeStaffTimeOff>[]
  todayKey: string
  onShiftMonth: (dir: 1 | -1) => void
  onPickDay: (d: Date) => void
}) {
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const cursorKey = dayKey(cursor)

  const apptDays = useMemo(() => new Set(appointments.filter((a) => a.status !== 'iptal').map((a) => a.date)), [appointments])
  const leaveDays = useMemo(() => new Set(timeOffs.map((t) => t.date)), [timeOffs])

  const cells = useMemo<(Date | null)[]>(() => {
    const first = new Date(y, m, 1)
    const startDow = (first.getDay() + 6) % 7
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const arr: (Date | null)[] = Array.from({ length: startDow }, () => null)
    for (let day = 1; day <= daysInMonth; day++) arr.push(new Date(y, m, day))
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [y, m])

  return (
    <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_4px_10px_-6px_rgba(0,0,0,0.06)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-[15px] text-[#3b2330]">{MONTHS[m]} {y}</div>
        <div className="flex gap-1">
          <button type="button" onClick={() => onShiftMonth(-1)} className="grid h-7 w-7 place-items-center rounded-md text-[#352432]/50 hover:bg-[#fff4f8] hover:text-[#c85776]"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => onShiftMonth(1)} className="grid h-7 w-7 place-items-center rounded-md text-[#352432]/50 hover:bg-[#fff4f8] hover:text-[#c85776]"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-medium uppercase tracking-wide text-[#352432]/40">
        {WEEKDAYS.map((w) => <div key={w}>{w[0]}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 text-center text-[12px]">
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} />
          const key = dayKey(d)
          const isToday = key === todayKey
          const isSel = key === cursorKey
          const hasAppt = apptDays.has(key)
          const hasLeave = leaveDays.has(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(d)}
              className={`relative grid h-8 place-items-center rounded-md transition-colors ${
                isSel ? 'bg-gradient-to-r from-[#f47699] to-[#ef6088] font-semibold text-white shadow-[0_8px_16px_-8px_rgba(200,87,118,0.8)]'
                  : isToday ? 'bg-[#fff1f6] font-semibold text-[#c85776]' : 'text-[#4a3a44] hover:bg-[#fff4f8]'
              }`}
            >
              {d.getDate()}
              {!isSel && (hasAppt || hasLeave) && (
                <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" style={{ backgroundColor: hasLeave && !hasAppt ? '#5aa9e6' : '#c85776' }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
