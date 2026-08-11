'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizeAppointment, normalizeStaff } from '@/lib/apiMappers'
import {
  DonutGauge, BrandHairline, PanelMetricCard, PanelSection, PeriodTabs,
  panelCardShell, panelListContainer, panelListRow, toneClasses, toneStroke, type PanelTone,
} from '@/components/dashboard/PanelKit'
import { motion } from 'framer-motion'
import {
  Activity, ArrowRight, CalendarClock, CalendarPlus, CheckCircle2, Clock, CreditCard,
  FileWarning, Layers3, MapPin, Scissors, Sparkles, Star, Sunrise, Users, type LucideIcon,
} from 'lucide-react'
import type { ApiAppointment, ApiStaff, Appointment, AppointmentLookups, AppointmentStatusKey, PagedResult } from '@/lib/types'

// ---------------------------------------------------------------------------
// PERSONEL PANELİ
// Kurum yöneticisi panelinin görsel diliyle (PanelKit) kurulur; VERİ KAPSAMI
// farklıdır: yalnızca personele ATANMIŞ işler. İşletme geneli ciro, kasa,
// kadro ve müşteri havuzu burada YER ALMAZ — o uçlar personele 403 döner.
// ---------------------------------------------------------------------------

interface DashboardData {
  periodResult: PagedResult<ApiAppointment>
  upcomingResult: PagedResult<ApiAppointment>
  staffResult: PagedResult<ApiStaff>
}

type PeriodKey = 'today' | 'week' | 'month'

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Bugün' },
  { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Ay' },
]

const PERIOD_LABEL: Record<PeriodKey, string> = { today: 'bugün', week: 'bu hafta', month: 'bu ay' }

const statusBadge: Record<AppointmentStatusKey, { label: string; icon: LucideIcon; cls: string }> = {
  tamamlandi: { label: 'Tamamlandı', icon: CheckCircle2, cls: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
  devam: { label: 'Devam', icon: Activity, cls: 'border-sky-100 bg-sky-50 text-sky-700' },
  bekliyor: { label: 'Bekliyor', icon: Clock, cls: 'border-amber-100 bg-amber-50 text-amber-700' },
  iptal: { label: 'İptal', icon: FileWarning, cls: 'border-rose-100 bg-rose-50 text-rose-700' },
  taslak: { label: 'Taslak', icon: Clock, cls: 'border-dashed border-indigo-200 bg-indigo-50 text-indigo-600' },
  islemde: { label: 'İşlemde', icon: Activity, cls: 'border-violet-200 bg-violet-50 text-violet-700' },
}

const permissionLabels: Record<string, string> = {
  Appointments: 'Randevu işlemleri', Customers: 'Müşteri kartları', Services: 'Hizmet / seans işlemleri',
  CashRegister: 'Kasa / tahsilat', Stock: 'Stok görüntüleme', Reports: 'Kişisel performans',
  Notifications: 'Bildirimler', Logs: 'İşlem geçmişi',
}

const quickActions: { label: string; href: string; icon: LucideIcon; tone: PanelTone; perm?: string }[] = [
  { label: 'Randevularım', href: '/ekip/randevular', icon: CalendarPlus, tone: 'rose', perm: 'Appointments' },
  { label: 'Müşterilerim', href: '/ekip/musteriler', icon: Users, tone: 'peach', perm: 'Customers' },
  { label: 'Seanslarım', href: '/ekip/seanslar', icon: Layers3, tone: 'cream', perm: 'Services' },
  { label: 'Günlük Kasa', href: '/ekip/kasa', icon: CreditCard, tone: 'mint', perm: 'CashRegister' },
]

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function pad2(v: number): string { return String(v).padStart(2, '0') }
function dateKey(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR')).join('') || '•'
}

function greeting(hour: number): string {
  if (hour < 6) return 'İyi geceler'
  if (hour < 12) return 'Günaydın'
  if (hour < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

function appointmentTimeValue(item: Appointment): number {
  const base = new Date(`${item.date}T00:00:00`)
  const [hour, minute] = item.time.split(':').map((p) => Number(p))
  if (!Number.isNaN(hour)) base.setHours(hour, Number.isNaN(minute) ? 0 : minute, 0, 0)
  return base.getTime()
}

/**
 * Seçili dönemin penceresi + grafik kovaları.
 * Bugün → saat dilimleri, hafta → 7 gün, ay → ayın günleri.
 */
function periodWindow(period: PeriodKey, base: Date): { from: Date; to: Date; buckets: { key: string; label: string }[] } {
  const start = new Date(base); start.setHours(0, 0, 0, 0)

  if (period === 'today') {
    const to = new Date(start); to.setDate(to.getDate() + 1)
    // Salon saatleri: 08:00–21:00 arası iki saatlik dilimler.
    const buckets = [8, 10, 12, 14, 16, 18, 20].map((h) => ({ key: `h${h}`, label: `${pad2(h)}` }))
    return { from: start, to, buckets }
  }

  if (period === 'week') {
    const day = (start.getDay() + 6) % 7 // Pazartesi = 0
    const from = new Date(start); from.setDate(from.getDate() - day)
    const to = new Date(from); to.setDate(to.getDate() + 7)
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(from); d.setDate(d.getDate() + i)
      return { key: dateKey(d), label: DAY_LABELS[i] }
    })
    return { from, to, buckets }
  }

  const from = new Date(start.getFullYear(), start.getMonth(), 1)
  const to = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(from); d.setDate(d.getDate() + i)
    // Ay uzun: her günü etiketlemek yerine 5'in katları yazılır.
    return { key: dateKey(d), label: (i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '' }
  })
  return { from, to, buckets }
}

/** Randevunun hangi kovaya düştüğü (bugün → saat, diğer → gün). */
function bucketKeyOf(item: Appointment, period: PeriodKey): string {
  if (period !== 'today') return item.date
  const hour = Number(item.time.split(':')[0])
  if (Number.isNaN(hour)) return 'h8'
  const slot = Math.min(20, Math.max(8, hour - ((hour - 8) % 2)))
  return `h${slot}`
}

/**
 * Dönem performansı: kovalara göre toplam randevu (çubuk) ve tamamlanan (çizgi).
 * Yöneticideki gelir grafiğinin personel karşılığı — para değil, iş hacmi gösterir.
 */
function PerformanceChart({
  buckets, total, done, emptyLabel,
}: {
  buckets: { key: string; label: string }[]
  total: number[]
  done: number[]
  emptyLabel: string
}) {
  const max = Math.max(1, ...total)
  const hasAny = total.some((v) => v > 0)
  const step = 100 / Math.max(buckets.length, 1)
  const linePoints = done
    .map((v, i) => `${step * i + step / 2},${100 - (v / max) * 100}`)
    .join(' ')

  if (!hasAny) {
    return (
      <div className="px-5 pb-8 pt-4 text-center">
        <Activity className="mx-auto h-9 w-9 text-[#A5556E]/30" strokeWidth={1.3} />
        <div className="mt-3 text-[12.5px] text-[#5A4B53]">{emptyLabel}</div>
      </div>
    )
  }

  return (
    <div className="px-5 pb-5">
      <div className="relative h-[188px] w-full">
        {/* Yatay ızgara + eksen */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {[max, Math.round(max / 2), 0].map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-[9px] tabular-nums text-[#8E7882]">{v}</span>
              <span className="h-px flex-1 bg-[#EFEAEC]" />
            </div>
          ))}
        </div>

        {/* Çubuklar */}
        <div className="absolute inset-0 flex items-end gap-[3px] pl-8">
          {total.map((v, i) => (
            <div key={buckets[i].key} className="flex h-full flex-1 items-end">
              <motion.span
                initial={{ height: 0 }}
                animate={{ height: `${(v / max) * 100}%` }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: i * 0.02 }}
                className={`w-full rounded-t-[4px] ${v > 0 ? 'bg-gradient-to-t from-[#EBC3CF] to-[#F6DFE6]' : 'bg-transparent'}`}
              />
            </div>
          ))}
        </div>

        {/* Tamamlanan çizgisi — çubuklarla aynı bölgede */}
        <svg className="absolute inset-0 ml-8 h-full w-[calc(100%-2rem)]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline
            points={linePoints}
            fill="none"
            stroke={toneStroke.mint}
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Gün/saat etiketleri */}
      <div className="mt-1.5 flex gap-[3px] pl-8">
        {buckets.map((b) => (
          <span key={b.key} className="flex-1 truncate text-center text-[9px] font-mono text-[#74616A]">{b.label}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-4 border-t border-[#EFEAEC] pt-2.5 text-[10.5px] text-[#5A4B53]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-gradient-to-t from-[#EBC3CF] to-[#F6DFE6]" /> Randevu
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded-full" style={{ background: toneStroke.mint }} /> Tamamlanan
        </span>
      </div>
    </div>
  )
}

/** En çok uygulanan işlemler — yatay oran çubukları. */
function ServiceBreakdown({ rows }: { rows: { name: string; count: number }[] }) {
  if (!rows.length) {
    return (
      <div className="px-5 pb-8 pt-2 text-center">
        <Scissors className="mx-auto h-8 w-8 text-[#A5556E]/30" strokeWidth={1.3} />
        <div className="mt-2.5 text-[12.5px] text-[#5A4B53]">Bu dönemde tamamlanmış işlem yok.</div>
      </div>
    )
  }
  const max = Math.max(...rows.map((r) => r.count))
  return (
    <div className="space-y-2.5 px-5 pb-5">
      {rows.map((r, i) => (
        <div key={r.name}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[11.5px]">
            <span className="truncate text-[#3E343A]">{r.name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[#5A4B53]">{r.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#EFEAEC]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.count / max) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.05 }}
              className="h-full rounded-full bg-gradient-to-r from-[#A5556E] to-[#F9A1B9]"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PersonelDashboard() {
  const { user } = useAuth()
  const { selectedInstitutionId, selectedBranchId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranchId)

  const [period, setPeriod] = useState<PeriodKey>('week')

  // Saat/tarih yalnız istemcide işler: sunucu render'ı farklı bir saat üretirse
  // hydration uyuşmazlığı olur (yönetici panelindeki hero ile aynı çözüm).
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const today = new Date()
  const todayKey = dateKey(today)
  const { from, to, buckets } = useMemo(() => periodWindow(period, new Date()), [period, todayKey])

  // Yaklaşanlar dönemden bağımsızdır: kullanıcı "Ay"a baksa da sıradaki iş bugünden sonrasıdır.
  const upcomingFrom = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [todayKey])
  const upcomingTo = useMemo(() => { const d = new Date(upcomingFrom); d.setDate(d.getDate() + 14); return d }, [upcomingFrom])

  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const upFromIso = upcomingFrom.toISOString()
  const upToIso = upcomingTo.toISOString()

  const { data, loading, error } = useApiQuery<DashboardData>(
    async () => {
      const [periodResult, upcomingResult, staffResult] = await Promise.all([
        adminApi.appointments<ApiAppointment>({ tenantId, branchId, fromUtc: fromIso, toUtc: toIso, page: 1, pageSize: 400 }),
        adminApi.appointments<ApiAppointment>({ tenantId, branchId, fromUtc: upFromIso, toUtc: upToIso, page: 1, pageSize: 200 }),
        // Personel için API kendi kaydına kapsar; ilk kayıt = ben.
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 10 }).catch(() => ({ items: [] })),
      ])
      return { periodResult, upcomingResult, staffResult }
    },
    [tenantId, branchId, fromIso, toIso, upFromIso, upToIso],
    { initialData: null },
  )

  const lookups: AppointmentLookups = {}
  // Backend randevuları zaten personelin kendi kapsamına süzüyor (staffTenantUserId).
  const periodAppts = useMemo(
    () => apiItems(data?.periodResult).map((a, i) => normalizeAppointment(a, lookups, i)).sort((a, b) => appointmentTimeValue(a) - appointmentTimeValue(b)),
    [data],
  )
  const upcomingAppts = useMemo(
    () => apiItems(data?.upcomingResult).map((a, i) => normalizeAppointment(a, lookups, i)).sort((a, b) => appointmentTimeValue(a) - appointmentTimeValue(b)),
    [data],
  )
  const me = useMemo(() => { const s = apiItems(data?.staffResult); return s.length ? normalizeStaff(s[0], 0) : null }, [data])

  // --- dönem metrikleri ---
  const completed = periodAppts.filter((a) => a.status === 'tamamlandi').length
  const cancelled = periodAppts.filter((a) => a.status === 'iptal').length
  const waiting = periodAppts.filter((a) => a.status === 'bekliyor' || a.status === 'devam' || a.status === 'islemde').length
  const uniqueCustomers = new Set(periodAppts.map((a) => a.customerId).filter(Boolean)).size
  // Tamamlanan seansların toplam süresi — iptal/gelmedi bunu etkilemez (bkz. KPI kartı).
  const workedMinutes = periodAppts
    .filter((a) => a.status === 'tamamlandi')
    .reduce((sum, a) => sum + Math.max(0, a.sure ?? 0), 0)

  // --- grafik serileri ---
  const { totalSeries, doneSeries } = useMemo(() => {
    const index = new Map(buckets.map((b, i) => [b.key, i]))
    const totals = Array(buckets.length).fill(0)
    const dones = Array(buckets.length).fill(0)
    for (const a of periodAppts) {
      const i = index.get(bucketKeyOf(a, period))
      if (i === undefined) continue
      totals[i]++
      if (a.status === 'tamamlandi') dones[i]++
    }
    return { totalSeries: totals, doneSeries: dones }
  }, [periodAppts, buckets, period])

  // --- bugünkü akış + yaklaşanlar ---
  const todayAppointments = useMemo(() => upcomingAppts.filter((a) => a.date === todayKey), [upcomingAppts, todayKey])
  const nextAppointment = useMemo(() => upcomingAppts.find((a) => appointmentTimeValue(a) >= Date.now()), [upcomingAppts])
  const laterAppointments = useMemo(
    () => upcomingAppts.filter((a) => a.date > todayKey && a.status !== 'iptal').slice(0, 6),
    [upcomingAppts, todayKey],
  )

  // --- en çok uygulanan işlemler (dönem) ---
  const serviceRows = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of periodAppts) {
      if (a.status !== 'tamamlandi') continue
      const name = (a.islem || 'Hizmet').trim()
      m.set(name, (m.get(name) ?? 0) + 1)
    }
    return Array.from(m, ([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count).slice(0, 6)
  }, [periodAppts])

  const rating = me?.averageRating ?? null
  const readablePermissions = (user?.permissions || []).map((k) => permissionLabels[k] || k).slice(0, 8)
  const actions = quickActions.filter((a) => !a.perm || (user?.permissions || []).includes(a.perm))
  const periodTabs = <PeriodTabs value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />

  return (
    <>
      <Topbar
        title="Panelim"
        subtitle={`${user?.fullName || user?.email || 'Personel'} · ${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'atanmış şube'}`}
        breadcrumbs={['Personel', 'Panelim']}
        actions={(
          <div className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-3 text-[11px] font-medium text-[#5A4B53]">
            <MapPin className="h-3.5 w-3.5 text-[#A5556E]" /> {selectedBranch?.name || 'Atanmış şube'}
          </div>
        )}
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        {/* HERO — kime, nerede, bugün ne var */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`${panelCardShell} px-6 py-6 sm:px-8 sm:py-7`}
        >
          <BrandHairline />
          <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#F9A1B9]/55 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -left-16 bottom-0 h-52 w-52 rounded-full bg-[#F9A1B9]/18 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1.25fr_.75fr] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#E3C6D1] bg-[#F6DFE6] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-[#A5556E]">
                  <Sparkles className="h-3.5 w-3.5" /> {greeting(now?.getHours() ?? 9)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E4DEE0] bg-white px-3 py-1 text-[10.5px] text-[#74616A]">
                  <Sunrise className="h-3.5 w-3.5 text-[#1E4E8C]" />
                  {now ? `${now.getDate()} ${MONTHS_TR[now.getMonth()]} ${now.getFullYear()}` : '—'}
                  {now && <span className="font-semibold text-[#A5556E]">{pad2(now.getHours())}:{pad2(now.getMinutes())}</span>}
                </span>
              </div>
              <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-[#2A2027] sm:text-4xl">
                {(user?.fullName || 'Hoş geldin').split(' ')[0]}, bugün <span className="text-[#A5556E]">{todayAppointments.length}</span> randevun var.
              </h1>
              <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-[#5A4B53]">
                Bu panel yalnızca sana atanmış işleri gösterir. Sıradaki randevuna, dönem performansına ve
                kişisel puanına buradan göz at.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <Link href="/ekip/randevular" className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-[#A5556E] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90">
                  Randevularıma git <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <div className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] text-[#5A4B53]">
                  <MapPin className="h-3.5 w-3.5 text-[#A5556E]" /> {selectedBranch?.name || 'Atanmış şube'}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-[#E4DEE0] bg-[#F7F6F6] p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/70"><CalendarClock className="h-3.5 w-3.5" /> Sıradaki</div>
                <div className="mt-2 font-display text-3xl tabular-nums text-[#2A2027]">{nextAppointment?.time || '—'}</div>
                <div className="mt-1 truncate text-[11.5px] text-[#5A4B53]">{nextAppointment?.musteri || 'Planlanmış randevu yok'}</div>
              </div>
              <div className="rounded-[18px] border border-[#E4DEE0] bg-[#F7F6F6] p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/70"><Star className="h-3.5 w-3.5" /> Müşteri puanım</div>
                <div className="mt-2 flex items-center justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="h-4 w-4" style={{ fill: i <= Math.round(rating ?? 0) ? '#1E4E8C' : 'transparent', color: i <= Math.round(rating ?? 0) ? '#1E4E8C' : '#E3C6D1' }} />
                  ))}
                </div>
                <div className="mt-1.5 font-display text-lg text-[#2A2027]">{rating != null ? `${rating.toFixed(1)} / 5` : 'Yeni'}</div>
                <div className="text-[10px] text-[#5A4B53]">{me?.ratingCount ? `${me.ratingCount} değerlendirme` : 'henüz puan yok'}</div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* KPI — dönem seçimi ilk kartın bandında durur, hepsi aynı döneme bakar */}
        <motion.div variants={panelListContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PanelMetricCard
            icon={CalendarClock}
            tone="rose"
            title="Randevum"
            value={<AnimatedNumber value={periodAppts.length} />}
            detail={`${PERIOD_LABEL[period]} atanmış`}
            subDetail={waiting > 0 ? `${waiting} bekleyen` : undefined}
            series={totalSeries}
            control={periodTabs}
          />
          <PanelMetricCard
            icon={CheckCircle2}
            tone="mint"
            title="Tamamladığım"
            value={<AnimatedNumber value={completed} />}
            detail={`${PERIOD_LABEL[period]} biten seans`}
            series={doneSeries}
          />
          {/* "Başarı oranım" [tamamlanan / (tamamlanan + iptal)] KALDIRILDI: müşterinin gelmemesi
              ya da randevuyu iptal etmesi personelin performansı değil, ama oran onu personelin
              hanesine yazıyordu. Yerine, tamamen personelin kendi işine bağlı olan çalışma hacmi. */}
          <PanelMetricCard
            icon={Activity}
            tone="gold"
            title="Hizmet saatim"
            value={`${Math.round(workedMinutes / 60)} sa`}
            detail={`${PERIOD_LABEL[period]} tamamlanan seans süresi`}
            subDetail={completed > 0 ? `${completed} seans` : undefined}
          />
          <PanelMetricCard
            icon={Users}
            tone="violet"
            title="Müşterim"
            value={<AnimatedNumber value={uniqueCustomers} />}
            detail={`${PERIOD_LABEL[period]} hizmet verilen`}
            subDetail={cancelled > 0 ? `${cancelled} iptal` : undefined}
          />
        </motion.div>

        {/* ANA IZGARA */}
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <PanelSection
              eyebrow="Performans"
              title={period === 'today' ? 'Bugünün saat dağılımı' : period === 'week' ? 'Bu haftanın dağılımı' : 'Bu ayın dağılımı'}
              action={periodTabs}
            >
              <PerformanceChart
                buckets={buckets}
                total={totalSeries}
                done={doneSeries}
                emptyLabel={`${PERIOD_LABEL[period].charAt(0).toLocaleUpperCase('tr-TR')}${PERIOD_LABEL[period].slice(1)} sana atanmış randevu yok.`}
              />
            </PanelSection>

            <PanelSection
              eyebrow="Günlük akış"
              title="Bugünkü programım"
              action={(
                <Link href="/ekip/randevular" className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] font-medium text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]">
                  Tümü <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            >
              <motion.div variants={panelListContainer} initial="hidden" animate="visible" className="divide-y divide-[#EFEAEC]">
                {todayAppointments.slice(0, 8).map((item) => {
                  const badge = statusBadge[item.status]
                  return (
                    <motion.div key={item.id} variants={panelListRow} whileHover={{ x: 3 }} transition={{ type: 'spring', stiffness: 320, damping: 24 }} className="grid items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[#F7F6F6] md:grid-cols-[64px_auto_1fr_auto]">
                      <div className="font-display text-lg tabular-nums text-[#2A2027]">{item.time}</div>
                      <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-[#E3C6D1] bg-gradient-to-br from-[#FDE4EB] via-[#F6C9D6] to-[#EDAFC1] text-[10px] font-semibold text-[#7A3450] md:grid">{initials(item.musteri)}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium text-[#2A2027]">{item.musteri}</div>
                        <div className="mt-0.5 truncate text-[11px] text-[#5A4B53]">{item.islem}</div>
                      </div>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${badge.cls}`}>
                        <badge.icon className="h-3 w-3" /> {badge.label}
                      </span>
                    </motion.div>
                  )
                })}
                {!todayAppointments.length && !loading && (
                  <div className="px-5 py-12 text-center">
                    <CalendarClock className="mx-auto h-9 w-9 text-[#A5556E]/35" strokeWidth={1.3} />
                    <div className="mt-3 text-[13px] text-[#5A4B53]">Bugün sana atanmış randevu yok.</div>
                  </div>
                )}
              </motion.div>
            </PanelSection>
          </div>

          {/* SAĞ SÜTUN */}
          <div className="space-y-4">
            <PanelSection eyebrow="Sıradakiler" title="Yaklaşan randevularım">
              <div className="divide-y divide-[#EFEAEC]">
                {laterAppointments.map((item) => {
                  const d = new Date(`${item.date}T00:00:00`)
                  return (
                    <Link key={item.id} href="/ekip/randevular" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[#F7F6F6]">
                      <div className="w-11 shrink-0 rounded-[10px] border border-[#E4DEE0] bg-[#F7F6F6] py-1 text-center">
                        <div className="text-[13px] font-semibold leading-none text-[#2A2027]">{d.getDate()}</div>
                        <div className="mt-0.5 text-[9px] uppercase text-[#74616A]">{MONTHS_TR[d.getMonth()].slice(0, 3)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-[#2A2027]">{item.musteri}</div>
                        <div className="truncate text-[11px] text-[#5A4B53]">{item.islem}</div>
                      </div>
                      <span className="shrink-0 font-display text-[13px] tabular-nums text-[#A5556E]">{item.time}</span>
                    </Link>
                  )
                })}
                {!laterAppointments.length && !loading && (
                  <div className="px-5 py-8 text-center text-[12.5px] text-[#5A4B53]">
                    Önümüzdeki 14 günde planlanmış randevun yok.
                  </div>
                )}
              </div>
            </PanelSection>

            <PanelSection eyebrow="Uzmanlık" title="En çok yaptığım işlemler">
              <ServiceBreakdown rows={serviceRows} />
            </PanelSection>

            <PanelSection eyebrow="Kısayollar" title="Hızlı işlemler">
              <div className="grid grid-cols-2 gap-2.5 px-5 pb-5">
                {actions.map((a) => (
                  <Link key={a.href} href={a.href} className={`flex items-center gap-2.5 rounded-[14px] border px-3 py-3 text-[12px] font-medium transition-transform hover:-translate-y-0.5 ${toneClasses[a.tone]}`}>
                    <a.icon className="h-4 w-4 shrink-0" strokeWidth={1.7} /> {a.label}
                  </Link>
                ))}
              </div>
            </PanelSection>

            <PanelSection eyebrow="Profil" title="Yetkilerim">
              <div className="space-y-2 px-5 pb-5">
                {(readablePermissions.length ? readablePermissions : ['Profil görüntüleme']).map((label) => (
                  <div key={label} className="flex items-center gap-2 rounded-[12px] border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-2 text-[12px] text-[#4E4048]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> {label}
                  </div>
                ))}
                <div className="mt-1 rounded-[12px] border border-[#E3C6D1] bg-[#F6DFE6] px-3 py-2.5 text-[11px] leading-relaxed text-[#8C4460]">
                  Şuben <span className="font-semibold text-[#8C4460]">{selectedBranch?.name || 'atanmış şube'}</span> olarak sabit; değişiklik için kurum yöneticisine başvur.
                </div>
              </div>
            </PanelSection>
          </div>
        </div>
      </div>
    </>
  )
}
