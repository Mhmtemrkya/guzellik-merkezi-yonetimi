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
import { CalendarDays, ChevronLeft, ChevronRight, ImagePlus, Lock, Plane, UserRound, X } from 'lucide-react'

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

const STATUS_DOT: Record<AppointmentStatusKey, string> = {
  tamamlandi: 'bg-emerald-500',
  devam: 'bg-sky-500',
  bekliyor: 'bg-amber-500',
  taslak: 'bg-indigo-400',
  iptal: 'bg-rose-400',
}
const STATUS_CELL: Record<AppointmentStatusKey, string> = {
  tamamlandi: 'border-emerald-300/40 bg-emerald-50',
  devam: 'border-sky-300/40 bg-sky-50',
  bekliyor: 'border-amber-300/40 bg-amber-50',
  taslak: 'border-dashed border-indigo-300/50 bg-indigo-50',
  iptal: 'border-rose-300/40 bg-rose-50 opacity-70',
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
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

  const [view, setView] = useState<'week' | 'month'>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Haftanın günleri (Pazartesi başlangıç, UTC hizalı — appointment.date ile tutarlı).
  const weekDays = useMemo<Date[]>(() => {
    const todayKey = new Date().toISOString().slice(0, 10)
    const d0 = new Date(`${todayKey}T00:00:00Z`)
    const dow = d0.getUTCDay()
    const offsetToMonday = (dow + 6) % 7
    const monday = new Date(d0)
    monday.setUTCDate(d0.getUTCDate() - offsetToMonday + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setUTCDate(monday.getUTCDate() + i)
      return d
    })
  }, [weekOffset])

  // Ay aralığı
  const monthInfo = useMemo(() => {
    const now = new Date()
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1))
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
    return { first, last }
  }, [monthOffset])

  const rangeFrom = view === 'week' ? weekDays[0] : monthInfo.first
  const rangeTo = view === 'week' ? weekDays[6] : monthInfo.last
  const fromIso = rangeFrom ? new Date(`${dayKey(rangeFrom)}T00:00:00Z`).toISOString() : ''
  const toIso = rangeTo ? new Date(`${dayKey(rangeTo)}T23:59:59Z`).toISOString() : ''

  const { data, reload } = useApiQuery<{ staff: ApiStaff[]; appts: ApiAppointment[]; timeoff: ApiStaffTimeOff[] }>(
    async () => {
      if (!tenantId || !canSchedule || !fromIso) return { staff: [], appts: [], timeoff: [] }
      const [staff, appts, timeoff] = await Promise.all([
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, fromUtc: fromIso, toUtc: toIso, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.timeOff<ApiStaffTimeOff>({ tenantId, fromDate: dayKey(rangeFrom!), toDate: dayKey(rangeTo!) }).catch(() => []),
      ])
      return { staff: apiItems(staff), appts: apiItems(appts), timeoff: Array.isArray(timeoff) ? timeoff : [] }
    },
    [tenantId, canSchedule, fromIso, toIso],
    { initialData: { staff: [], appts: [], timeoff: [] } },
  )

  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)).filter((s) => s.active), [data])
  const appointments = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const timeOffs = useMemo(() => (data?.timeoff || []).map((t, i) => normalizeStaffTimeOff(t, i)), [data])

  // Indeksler: staffId+date → randevular; staffId+date → izin
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
    const map = new Map<string, string>() // staffId|date → timeOffId
    for (const t of timeOffs) map.set(`${t.staffMemberId}|${t.date}`, t.id)
    return map
  }, [timeOffs])

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

  const periodLabel = view === 'week'
    ? `${rangeFrom!.getUTCDate()} ${MONTHS[rangeFrom!.getUTCMonth()]} – ${rangeTo!.getUTCDate()} ${MONTHS[rangeTo!.getUTCMonth()]}`
    : `${MONTHS[monthInfo.first.getUTCMonth()]} ${monthInfo.first.getUTCFullYear()}`

  return (
    <>
      <Topbar
        title="Personel Çizelgesi"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'Personel', 'Çizelge']}
      />

      <div className="space-y-4">
        {/* Kontroller */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#ead8df]/70 bg-white/86 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (view === 'week' ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1))}
              className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/60"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[180px] text-center font-display text-lg tracking-tight">{periodLabel}</div>
            <button
              type="button"
              onClick={() => (view === 'week' ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1))}
              className="grid h-8 w-8 place-items-center rounded-[10px] border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]/60"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => (view === 'week' ? setWeekOffset(0) : setMonthOffset(0))}
              className="ml-1 rounded-[10px] border border-[#ead8df] bg-white px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide text-[#352432]/55 hover:bg-[#fff4f8]/60"
            >
              Bugün
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-0.5">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-[8px] px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide transition-colors ${
                  view === v ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'
                }`}
              >
                {v === 'week' ? 'Haftalık' : 'Aylık'}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}

        {/* Lejant + hafta sayaçları (mockup) */}
        {view === 'week' && (() => {
          const planned = appointments.filter((a) => a.status !== 'iptal').length
          const byDay = new Map<string, number>()
          for (const a of appointments) byDay.set(a.date, (byDay.get(a.date) ?? 0) + 1)
          const busyDays = Array.from(byDay.values()).filter((c) => c >= 2).length || (planned > 0 ? 1 : 0)
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#352432]/60">
                {[['#3cae8d', 'Müsait'], ['#e6a14f', 'Randevu'], ['#5aa9e6', 'İzinli'], ['#e0617f', 'Yoğun Gün']].map(([c, l]) => (
                  <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} /> {l}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {[[String(staff.length), 'personel'], [String(planned), 'planlı randevu'], [String(busyDays), 'yoğun gün']].map(([v, l]) => (
                  <span key={l} className="rounded-[12px] border border-[#ead8df]/70 bg-white px-3 py-1.5 text-[11px] text-[#352432]/65"><span className="font-display text-[14px] text-[#c85776]">{v}</span> {l}</span>
                ))}
              </div>
            </div>
          )
        })()}

        {view === 'week' ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
              <WeekGrid
                weekDays={weekDays}
                staff={staff}
                apptIndex={apptIndex}
                timeOffIndex={timeOffIndex}
                busy={busy}
                onToggleLeave={toggleLeave}
                onUploadPhoto={uploadPhoto}
              />
              <WeekSidebar weekDays={weekDays} staff={staff} apptIndex={apptIndex} appointments={appointments} />
            </div>

            {/* Planlama ipuçları */}
            <div className="grid gap-3 rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['📅', 'Planlama İpucu', 'Çalışma saatlerini hızlıca ekleyin veya randevuları sürükleyip bırakın.'],
                ['➕', 'Hızlı Ekle', 'Boş alana tıklayarak yeni randevu ekleyin.'],
                ['✈️', 'İzin İşaretle', 'Hücredeki uçak ikonuyla günü izinli yapın; o gün çizgili görünür.'],
                ['📋', 'Aylık Görünüm', 'Sağ üstten aylık görünüme geçip yoğunluğu tek bakışta görün.'],
              ].map(([e, t, d]) => (
                <div key={t} className="flex items-start gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[15px]">{e}</span>
                  <div><div className="text-[12px] font-medium text-[#352432]">{t}</div><div className="text-[10px] leading-relaxed text-[#352432]/50">{d}</div></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <MonthGrid monthInfo={monthInfo} appointments={appointments} timeOffs={timeOffs} />
        )}
      </div>
    </>
  )
}

function WeekSidebar({
  weekDays, staff, apptIndex, appointments,
}: {
  weekDays: Date[]
  staff: StaffItem[]
  apptIndex: Map<string, ApptItem[]>
  appointments: ApptItem[]
}) {
  const dayKeys = weekDays.map((d) => d.toISOString().slice(0, 10))
  const slots = Math.max(1, staff.length * 7)
  let filled = 0
  const dayFill = dayKeys.map((k) => {
    let f = 0
    for (const s of staff) if ((apptIndex.get(`${s.id}|${k}`)?.length ?? 0) > 0) f++
    filled += f
    return staff.length ? Math.round((f / staff.length) * 100) : 0
  })
  const occupancy = Math.round((filled / slots) * 100)
  const planned = appointments.filter((a) => a.status !== 'iptal').length
  const maxFill = Math.max(1, ...dayFill)

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-4">
        <div className="flex items-center gap-2 text-[12px] font-medium text-[#352432]">📅 Haftalık Özet</div>
        <div className="mt-3 space-y-2 text-[12px]">
          <div className="flex items-center justify-between"><span className="text-[#352432]/55">Toplam çalışma günü</span><span className="font-medium">7 gün</span></div>
          <div className="flex items-center justify-between"><span className="text-[#352432]/55">Planlı randevu</span><span className="font-medium">{planned}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#352432]/55">Doluluk oranı</span><span className="font-medium text-[#c85776]">%{occupancy}</span></div>
        </div>
        <div className="relative mx-auto mt-4 grid h-28 w-28 place-items-center rounded-full" style={{ background: `conic-gradient(#e0617f 0% ${occupancy}%, #f7e9ee ${occupancy}% 100%)` }}>
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-center">
            <div><div className="font-display text-xl leading-none">{occupancy}%</div><div className="text-[8px] font-mono uppercase text-[#352432]/45">doluluk</div></div>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-[10px] text-[#352432]/45">Günlere göre doluluk</div>
          <div className="mt-1.5 flex h-12 items-end justify-between gap-1.5">
            {dayFill.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className={`w-full rounded-t-sm ${v === maxFill && v > 0 ? 'bg-[#e0617f]' : 'bg-[#f3c2d2]'}`} style={{ height: `${Math.max(10, (v / Math.max(1, maxFill)) * 100)}%` }} />
                <span className="text-[7px] font-mono uppercase text-[#352432]/40">{WEEKDAYS[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-4">
        <div className="flex items-center gap-2 text-[12px] font-medium text-[#352432]">👥 Personel Müsaitlik</div>
        <div className="mt-3 space-y-2.5">
          {staff.map((s) => {
            let busyDays = 0
            for (const k of dayKeys) if ((apptIndex.get(`${s.id}|${k}`)?.length ?? 0) > 0) busyDays++
            const pct = Math.round((busyDays / 7) * 100)
            return (
              <div key={s.id} className="flex items-center gap-2.5">
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.photoUrl} alt={s.name} className="h-8 w-8 shrink-0 rounded-full border border-[#efbfd0]/50 object-cover" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fbd2dc] text-[9px] font-display text-[#8e3f5b]">{s.name.slice(0, 2).toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-[11px]"><span className="truncate font-medium text-[#352432]">{s.name}</span><span className="text-[#352432]/45">{busyDays} / 7 gün dolu</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]"><span className={`block h-full rounded-full ${pct >= 70 ? 'bg-[#e0617f]' : pct >= 30 ? 'bg-[#e6a14f]' : 'bg-[#3cae8d]'}`} style={{ width: `${Math.max(4, pct)}%` }} /></div>
                </div>
                <span className="shrink-0 text-[10px] font-medium text-[#352432]/55">%{pct}</span>
              </div>
            )
          })}
          {staff.length === 0 && <div className="py-4 text-center text-[11px] text-[#352432]/40">Aktif personel yok.</div>}
        </div>
      </div>
    </div>
  )
}

type StaffItem = ReturnType<typeof normalizeStaff>
type ApptItem = ReturnType<typeof normalizeAppointment>

function StaffAvatar({ s, onUpload, busy }: { s: StaffItem; onUpload: (s: StaffItem, f: File) => void; busy: boolean }) {
  return (
    <label
      title="Fotoğraf yükle"
      className={`relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#ead8df] bg-[#fff4f8]/60 ${busy ? 'opacity-60' : ''}`}
    >
      {s.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.photoUrl} alt={s.name} className="h-full w-full object-cover" />
      ) : (
        <UserRound className="h-4 w-4 text-[#c85776]/50" />
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

function WeekGrid({
  weekDays,
  staff,
  apptIndex,
  timeOffIndex,
  busy,
  onToggleLeave,
  onUploadPhoto,
}: {
  weekDays: Date[]
  staff: StaffItem[]
  apptIndex: Map<string, ApptItem[]>
  timeOffIndex: Map<string, string>
  busy: boolean
  onToggleLeave: (staffId: string, date: string) => void
  onUploadPhoto: (s: StaffItem, f: File) => void
}) {
  if (staff.length === 0) {
    return <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 px-5 py-10 text-center text-sm text-[#352432]/45">Aktif personel yok.</div>
  }
  return (
    <div className="overflow-x-auto rounded-[18px] border border-[#ead8df]/70 bg-white/86">
      <div className="min-w-[680px]">
        {/* Personel başlıkları */}
        <div className="grid border-b border-[#ead8df]/70" style={{ gridTemplateColumns: `90px repeat(${staff.length}, minmax(150px, 1fr))` }}>
          <div className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Gün</div>
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border-l border-[#ead8df]/50 px-3 py-2.5">
              <StaffAvatar s={s} onUpload={onUploadPhoto} busy={busy} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-[#352432]">{s.name}</div>
                <div className="truncate text-[9px] font-mono uppercase tracking-wide text-[#c85776]/55">{s.role}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Günler */}
        {weekDays.map((d, di) => {
          const key = d.toISOString().slice(0, 10)
          const isToday = key === new Date().toISOString().slice(0, 10)
          return (
            <div
              key={key}
              className="grid border-b border-[#ead8df]/40 last:border-b-0"
              style={{ gridTemplateColumns: `90px repeat(${staff.length}, minmax(150px, 1fr))` }}
            >
              <div className={`px-3 py-3 ${isToday ? 'bg-[#fff1f6]/70' : ''}`}>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">{WEEKDAYS[di]}</div>
                <div className="font-display text-lg leading-none">{d.getUTCDate()}</div>
              </div>
              {staff.map((s) => {
                const cellKey = `${s.id}|${key}`
                const appts = apptIndex.get(cellKey) ?? []
                const leaveId = timeOffIndex.get(cellKey)
                return (
                  <div key={s.id} className={`relative min-h-[68px] border-l border-[#ead8df]/40 p-1.5 ${leaveId ? 'bg-[repeating-linear-gradient(45deg,#f7e9ee,#f7e9ee_6px,#fff_6px,#fff_12px)]' : ''}`}>
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
                      <div className="flex h-full items-center justify-center text-[10px] font-mono uppercase tracking-widest text-rose-500/70">İzinli</div>
                    ) : appts.length === 0 ? (
                      <div className="h-full" />
                    ) : (
                      <div className="space-y-1 pr-5">
                        {appts.map((a) => (
                          <div key={a.id} className={`flex items-center gap-1.5 rounded-[8px] border px-1.5 py-1 text-[10px] ${STATUS_CELL[a.status]}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[a.status]}`} />
                            <span className="font-mono tabular-nums text-[#352432]/70">{a.time}</span>
                            <span className="truncate text-[#352432]">{a.musteri}</span>
                          </div>
                        ))}
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
  monthInfo,
  appointments,
  timeOffs,
}: {
  monthInfo: { first: Date; last: Date }
  appointments: ApptItem[]
  timeOffs: ReturnType<typeof normalizeStaffTimeOff>[]
}) {
  const apptByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of appointments) m.set(a.date, (m.get(a.date) ?? 0) + 1)
    return m
  }, [appointments])
  const leaveByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of timeOffs) m.set(t.date, (m.get(t.date) ?? 0) + 1)
    return m
  }, [timeOffs])

  // Ay takvimi (Pazartesi başlangıç)
  const cells = useMemo<(Date | null)[]>(() => {
    const first = monthInfo.first
    const startDow = (first.getUTCDay() + 6) % 7
    const daysInMonth = monthInfo.last.getUTCDate()
    const arr: (Date | null)[] = Array.from({ length: startDow }, () => null)
    for (let day = 1; day <= daysInMonth; day++) {
      arr.push(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)))
    }
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [monthInfo])

  return (
    <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="min-h-[78px] rounded-[10px] bg-[#fff4f8]/20" />
          const key = d.toISOString().slice(0, 10)
          const count = apptByDay.get(key) ?? 0
          const leaves = leaveByDay.get(key) ?? 0
          const isToday = key === new Date().toISOString().slice(0, 10)
          return (
            <motion.div
              key={key}
              whileHover={{ y: -2 }}
              className={`min-h-[78px] rounded-[10px] border p-2 ${isToday ? 'border-[#c85776]/50 bg-[#fff1f6]/60' : 'border-[#ead8df]/60 bg-white'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-base leading-none">{d.getUTCDate()}</span>
                {leaves > 0 && <Plane className="h-3 w-3 text-rose-400" />}
              </div>
              {count > 0 && (
                <div className="mt-2 flex items-center gap-1 text-[11px]">
                  <CalendarDays className="h-3 w-3 text-[#c85776]" />
                  <AnimatedNumber value={count} className="font-display tabular-nums armonessa-text-gradient" />
                  <span className="text-[9px] text-[#352432]/40">randevu</span>
                </div>
              )}
              {leaves > 0 && <div className="mt-1 text-[9px] font-mono text-rose-500/70">{leaves} izinli</div>}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
