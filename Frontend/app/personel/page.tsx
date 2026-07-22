'use client'

import { useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizeAppointment, normalizeStaff } from '@/lib/apiMappers'
import { motion, type Variants } from 'framer-motion'
import {
  Activity, ArrowRight, ArrowUpRight, CalendarClock, CalendarPlus, CheckCircle2, Clock, CreditCard,
  FileWarning, Layers3, MapPin, Sparkles, Star, Users, type LucideIcon,
} from 'lucide-react'
import type { ApiAppointment, ApiStaff, Appointment, AppointmentLookups, AppointmentStatusKey, PagedResult } from '@/lib/types'

interface DashboardData {
  appointmentsResult: PagedResult<ApiAppointment>
  staffResult: PagedResult<ApiStaff>
}

type Tone = 'rose' | 'gold' | 'mint' | 'violet' | 'peach' | 'cream'
const toneClasses: Record<Tone, string> = {
  rose: 'border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]',
  gold: 'border-[#f2dfbf] bg-[#fff8ea] text-[#b88938]',
  mint: 'border-[#d6ece4] bg-[#f1fbf7] text-[#39846f]',
  violet: 'border-[#eadcf5] bg-[#faf4ff] text-[#8b5aa5]',
  peach: 'border-[#f3dde0] bg-[#fff6f3] text-[#bd6476]',
  cream: 'border-[#f3e6ce] bg-[#fffaf0] text-[#b08742]',
}

const statusBadge: Record<AppointmentStatusKey, { label: string; icon: LucideIcon; cls: string }> = {
  tamamlandi: { label: 'Tamamlandı', icon: CheckCircle2, cls: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
  devam: { label: 'Devam', icon: Activity, cls: 'border-sky-100 bg-sky-50 text-sky-700' },
  bekliyor: { label: 'Bekliyor', icon: Clock, cls: 'border-amber-100 bg-amber-50 text-amber-700' },
  iptal: { label: 'İptal', icon: FileWarning, cls: 'border-rose-100 bg-rose-50 text-rose-700' },
  taslak: { label: 'Taslak', icon: Clock, cls: 'border-dashed border-indigo-200 bg-indigo-50 text-indigo-600' },
  islemde: { label: 'İşlemde', icon: Activity, cls: 'border-violet-200 bg-violet-50 text-violet-700' },
}

const cardShell =
  'relative overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white/94 shadow-[0_18px_50px_-34px_rgba(120,71,88,0.45)]'

const listContainer: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.08 } } }
const listRow: Variants = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } } }

const permissionLabels: Record<string, string> = {
  Appointments: 'Randevu işlemleri', Customers: 'Müşteri kartları', Services: 'Hizmet / seans işlemleri',
  CashRegister: 'Kasa / tahsilat', Stock: 'Stok görüntüleme', Reports: 'Kişisel performans',
  Notifications: 'Bildirimler', Logs: 'İşlem geçmişi',
}

const quickActions: { label: string; href: string; icon: LucideIcon; tone: Tone; perm?: string }[] = [
  { label: 'Randevularım', href: '/personel/randevular', icon: CalendarPlus, tone: 'rose', perm: 'Appointments' },
  { label: 'Müşterilerim', href: '/personel/musteriler', icon: Users, tone: 'peach', perm: 'Customers' },
  { label: 'Seanslarım', href: '/personel/seanslar', icon: Layers3, tone: 'cream', perm: 'Services' },
  { label: 'Günlük Kasa', href: '/personel/kasa', icon: CreditCard, tone: 'mint', perm: 'CashRegister' },
]

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR')).join('') || '•'
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

function appointmentTimeValue(item: Appointment): number {
  const base = new Date(`${item.date}T00:00:00`)
  const [hour, minute] = item.time.split(':').map((p) => Number(p))
  if (!Number.isNaN(hour)) base.setHours(hour, Number.isNaN(minute) ? 0 : minute, 0, 0)
  return base.getTime()
}

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function SectionCard({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={`${cardShell} ${className}`}
    >
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#ffdce8]/45 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          {eyebrow && <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">{eyebrow}</div>}
          <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-[#241923]">{title}</h2>
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </motion.section>
  )
}

function MetricCard({ icon: Icon, title, value, detail, tone, href, visual }: { icon: LucideIcon; title: string; value: ReactNode; detail: ReactNode; tone: Tone; href?: string; visual?: ReactNode }) {
  const inner = (
    <motion.div
      variants={listRow}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`${cardShell} group min-h-[138px] px-5 py-5`}
    >
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[#ffdce8]/38 blur-3xl" />
      <div className="relative flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${toneClasses[tone]}`}>
            <Icon className="h-[19px] w-[19px]" strokeWidth={1.65} />
          </span>
          {href ? <ArrowUpRight className="h-4 w-4 text-[#c85776]/40 transition-colors group-hover:text-[#c85776]" /> : visual}
        </div>
        <div>
          <div className="text-[13px] font-semibold leading-4 text-[#2b1e29]">{title}</div>
          <div className="mt-1.5 text-[30px] font-semibold leading-none tracking-tight text-[#1f1620] tabular-nums">{value}</div>
          <div className="mt-2.5 text-[12px] text-[#77616b]">{detail}</div>
        </div>
      </div>
    </motion.div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}

function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-28 items-end justify-between gap-1.5 px-5 pb-4">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end">
            <motion.span
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(6, (v / max) * 100)}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
              className={`w-full rounded-t-md ${v > 0 ? 'bg-gradient-to-t from-[#e0617f] to-[#f3a3bf]' : 'bg-[#f1e5ea]'}`}
            />
          </div>
          <span className="text-[9px] font-mono text-[#a5909c]">{labels[i]}</span>
          <span className="text-[10px] font-semibold tabular-nums text-[#77616b]">{v}</span>
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

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(dayStart); weekEnd.setDate(weekEnd.getDate() + 7)
  const todayKey = dayStart.toISOString().slice(0, 10)
  const dayStartIso = dayStart.toISOString()
  const weekEndIso = weekEnd.toISOString()

  const { data, loading, error } = useApiQuery<DashboardData>(
    async () => {
      const [appointmentsResult, staffResult] = await Promise.all([
        adminApi.appointments<ApiAppointment>({ tenantId, branchId, fromUtc: dayStartIso, toUtc: weekEndIso, page: 1, pageSize: 200 }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 10 }).catch(() => ({ items: [] })),
      ])
      return { appointmentsResult, staffResult }
    },
    [tenantId, branchId, dayStartIso, weekEndIso],
    { initialData: null },
  )

  const lookups: AppointmentLookups = {}
  // Personel için API zaten kendi randevularına kapsıyor (staffTenantUserId filtresi).
  const appointments = useMemo(
    () => apiItems(data?.appointmentsResult).map((a, i) => normalizeAppointment(a, lookups, i)).sort((a, b) => appointmentTimeValue(a) - appointmentTimeValue(b)),
    [data],
  )
  const me = useMemo(() => { const s = apiItems(data?.staffResult); return s.length ? normalizeStaff(s[0], 0) : null }, [data])

  const todayAppointments = appointments.filter((a) => a.date === todayKey)
  const completed = appointments.filter((a) => a.status === 'tamamlandi').length
  const cancelled = appointments.filter((a) => a.status === 'iptal').length
  const waiting = appointments.filter((a) => a.status === 'bekliyor' || a.status === 'devam').length
  const uniqueCustomers = new Set(appointments.map((a) => a.customerId).filter(Boolean)).size
  const nextAppointment = appointments.find((a) => appointmentTimeValue(a) >= Date.now())
  const resolved = completed + cancelled
  const successRate = resolved > 0 ? Math.round((completed / resolved) * 100) : 0

  // Haftalık dağılım (bugünden itibaren 7 gün)
  const weekly = useMemo(() => {
    const counts = Array(7).fill(0)
    const labels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(dayStart); d.setDate(d.getDate() + i)
      return DAY_LABELS[(d.getDay() + 6) % 7]
    })
    for (const a of appointments) {
      const d = new Date(`${a.date}T00:00:00`)
      const idx = Math.round((d.getTime() - dayStart.getTime()) / 86_400_000)
      if (idx >= 0 && idx < 7) counts[idx]++
    }
    return { counts, labels }
  }, [appointments, todayKey])

  const rating = me?.averageRating ?? null
  const readablePermissions = (user?.permissions || []).map((k) => permissionLabels[k] || k).slice(0, 8)
  const actions = quickActions.filter((a) => !a.perm || (user?.permissions || []).includes(a.perm))

  return (
    <>
      <Topbar
        title="Panelim"
        subtitle={`${user?.fullName || user?.email || 'Personel'} · ${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'atanmış şube'}`}
        breadcrumbs={['Personel', 'Panelim']}
        actions={(
          <div className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 text-[11px] font-medium text-[#7c6170]">
            <MapPin className="h-3.5 w-3.5 text-[#c85776]" /> {selectedBranch?.name || 'Atanmış şube'}
          </div>
        )}
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        {/* HERO */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`${cardShell} px-6 py-6 sm:px-8 sm:py-7`}
        >
          <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#ffdce8]/55 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -left-16 bottom-0 h-52 w-52 rounded-full bg-[#f0aac2]/18 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1.25fr_.75fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f3d9e1] bg-[#fff2f6] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]">
                <Sparkles className="h-3.5 w-3.5" /> {greeting()}
              </div>
              <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-[#241923] sm:text-4xl">
                {(user?.fullName || 'Hoş geldin').split(' ')[0]}, bugün <span className="text-[#c85776]">{todayAppointments.length}</span> randevun var.
              </h1>
              <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-[#77616b]">
                Bu panel yalnızca sana atanmış işleri gösterir. Sıradaki randevuna, haftalık programına ve kişisel performansına buradan göz at.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <Link href="/personel/randevular" className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-[#c85776] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90">
                  Randevularıma git <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <div className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3.5 text-[12px] text-[#77616b]">
                  <MapPin className="h-3.5 w-3.5 text-[#c85776]" /> {selectedBranch?.name || 'Atanmış şube'}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-[#efe1e7] bg-[#fffafc] p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70"><CalendarClock className="h-3.5 w-3.5" /> Sıradaki</div>
                <div className="mt-2 font-display text-3xl tabular-nums text-[#241923]">{nextAppointment?.time || '—'}</div>
                <div className="mt-1 truncate text-[11.5px] text-[#77616b]">{nextAppointment?.musteri || 'Planlanmış randevu yok'}</div>
              </div>
              <div className="rounded-[18px] border border-[#efe1e7] bg-[#fffafc] p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70"><Star className="h-3.5 w-3.5" /> Müşteri puanım</div>
                <div className="mt-2 flex items-center justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="h-4 w-4" style={{ fill: i <= Math.round(rating ?? 0) ? '#f4b73e' : 'transparent', color: i <= Math.round(rating ?? 0) ? '#f4b73e' : '#e3cdd6' }} />
                  ))}
                </div>
                <div className="mt-1.5 font-display text-lg text-[#241923]">{rating != null ? `${rating.toFixed(1)} / 5` : 'Yeni'}</div>
                <div className="text-[10px] text-[#77616b]">{me?.ratingCount ? `${me.ratingCount} değerlendirme` : 'henüz puan yok'}</div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* STAT CARDS */}
        <motion.div variants={listContainer} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={CalendarClock} title="Bugünkü randevum" value={<AnimatedNumber value={todayAppointments.length} />} detail="sana atanmış" tone="rose" href="/personel/randevular" />
          <MetricCard icon={Clock} title="Bekleyen işlem" value={<AnimatedNumber value={waiting} />} detail="onay / devam eden" tone="gold" href="/personel/randevular?scope=pending" />
          <MetricCard icon={CheckCircle2} title="Tamamlanan (hafta)" value={<AnimatedNumber value={completed} />} detail={`%${successRate} başarı oranı`} tone="mint" />
          <MetricCard icon={Users} title="Atanmış müşteri" value={<AnimatedNumber value={uniqueCustomers} />} detail="bu haftaki randevulardan" tone="violet" href="/personel/musteriler" />
        </motion.div>

        {/* MAIN GRID */}
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          {/* Bugünkü program */}
          <SectionCard
            eyebrow="Günlük akış"
            title="Bugünkü programım"
            action={(
              <Link href="/personel/randevular" className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-1.5 text-[11px] font-medium text-[#7c6170] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                Tümü <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          >
            <motion.div variants={listContainer} initial="hidden" animate="visible" className="divide-y divide-[#f3e7ec]">
              {todayAppointments.slice(0, 8).map((item) => {
                const badge = statusBadge[item.status]
                return (
                  <motion.div key={item.id} variants={listRow} whileHover={{ x: 3 }} transition={{ type: 'spring', stiffness: 320, damping: 24 }} className="grid items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[#fffafc] md:grid-cols-[64px_auto_1fr_auto]">
                    <div className="font-display text-lg tabular-nums text-[#241923]">{item.time}</div>
                    <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efd5dd] bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] text-[10px] font-semibold text-[#7f4057] md:grid">{initials(item.musteri)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-[#2b1e29]">{item.musteri}</div>
                      <div className="mt-0.5 truncate text-[11px] text-[#77616b]">{item.islem}</div>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${badge.cls}`}>
                      <badge.icon className="h-3 w-3" /> {badge.label}
                    </span>
                  </motion.div>
                )
              })}
              {!todayAppointments.length && !loading && (
                <div className="px-5 py-12 text-center">
                  <CalendarClock className="mx-auto h-9 w-9 text-[#c85776]/35" strokeWidth={1.3} />
                  <div className="mt-3 text-[13px] text-[#77616b]">Bugün sana atanmış randevu yok.</div>
                </div>
              )}
            </motion.div>
          </SectionCard>

          {/* Sağ sütun */}
          <div className="space-y-4">
            <SectionCard eyebrow="Bu hafta" title="Haftalık aktivite">
              <MiniBars values={weekly.counts} labels={weekly.labels} />
            </SectionCard>

            <SectionCard eyebrow="Kısayollar" title="Hızlı işlemler">
              <div className="grid grid-cols-2 gap-2.5 px-5 pb-5">
                {actions.map((a) => (
                  <Link key={a.href} href={a.href} className={`flex items-center gap-2.5 rounded-[14px] border px-3 py-3 text-[12px] font-medium transition-transform hover:-translate-y-0.5 ${toneClasses[a.tone]}`}>
                    <a.icon className="h-4 w-4 shrink-0" strokeWidth={1.7} /> {a.label}
                  </Link>
                ))}
              </div>
            </SectionCard>

            <SectionCard eyebrow="Profil" title="Yetkilerim">
              <div className="space-y-2 px-5 pb-5">
                {(readablePermissions.length ? readablePermissions : ['Profil görüntüleme']).map((label) => (
                  <div key={label} className="flex items-center gap-2 rounded-[12px] border border-[#efe1e7] bg-[#fffafc] px-3 py-2 text-[12px] text-[#5f4654]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#c85776]" /> {label}
                  </div>
                ))}
                <div className="mt-1 rounded-[12px] border border-[#f3d9e1] bg-[#fff2f6] px-3 py-2.5 text-[11px] leading-relaxed text-[#9d4a66]">
                  Şuben <span className="font-semibold text-[#b14d6c]">{selectedBranch?.name || 'atanmış şube'}</span> olarak sabit; değişiklik için kurum yöneticisine başvur.
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  )
}
