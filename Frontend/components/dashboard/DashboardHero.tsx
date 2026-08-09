'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowUpRight, BellRing, CalendarPlus, CalendarRange, Sparkles, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { formatTL } from '@/lib/apiMappers'

// ---------------------------------------------------------------------------
// DASHBOARD HERO
// Panelin ilk ekranı: kime, hangi salonda, hangi gün olduğunu söyleyen canlı bir
// karşılama bandı + günün dört kritik rakamı + tek tıklık kısayollar.
// Marka dili korunur (krem/gül/altın); ağır koyu blok yerine ışıklı aurora.
// ---------------------------------------------------------------------------

interface Props {
  userName?: string | null
  institutionName?: string | null
  branchName?: string | null
  appointmentsToday: number
  completedToday: number
  waitingToday: number
  revenueToday: number
  pendingApprovals: number
  activeStaff: number
  totalCustomers: number
}

const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function greetingFor(hour: number): string {
  if (hour < 6) return 'İyi geceler'
  if (hour < 12) return 'Günaydın'
  if (hour < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

export default function DashboardHero({
  userName, institutionName, branchName,
  appointmentsToday, completedToday, waitingToday, revenueToday,
  pendingApprovals, activeStaff, totalCustomers,
}: Props) {
  const [now, setNow] = useState<Date | null>(null)

  // Saat yalnız istemcide işler (SSR/CSR uyumsuzluğu olmasın diye ilk render'da boş).
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const firstName = useMemo(() => (userName || '').trim().split(/\s+/)[0] || '', [userName])
  const hour = now?.getHours() ?? 9
  const clock = now ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : '—'
  const dateLabel = now ? `${now.getDate()} ${MONTHS_TR[now.getMonth()]} ${now.getFullYear()} · ${DAYS_TR[now.getDay()]}` : ''

  const tiles = [
    {
      key: 'appt',
      label: 'Bugünkü randevu',
      value: <AnimatedNumber value={appointmentsToday} />,
      sub: appointmentsToday > 0 ? `${completedToday} tamamlandı · ${waitingToday} bekliyor` : 'Bugün randevu yok',
      icon: CalendarRange,
      tone: 'from-[#ffe3ec] to-[#ffd0e0] text-[#a63e5f]',
      href: '/panel/randevular',
    },
    {
      key: 'cash',
      label: 'Bugün tahsilat',
      value: <AnimatedNumber value={revenueToday} format={(n) => formatTL(Math.round(n))} />,
      sub: 'Kasaya giren',
      icon: Wallet,
      tone: 'from-[#e6f7ee] to-[#d1f0e0] text-[#2f7d54]',
      href: '/panel/kasa',
    },
    {
      key: 'pending',
      label: 'Bekleyen onay',
      value: <AnimatedNumber value={pendingApprovals} />,
      sub: pendingApprovals > 0 ? 'İncelemeni bekliyor' : 'Her şey onaylı',
      icon: BellRing,
      tone: 'from-[#fff2dc] to-[#ffe6bd] text-[#a3701f]',
      href: '/panel/onaylar',
    },
    {
      key: 'team',
      label: 'Aktif ekip',
      value: <AnimatedNumber value={activeStaff} />,
      sub: `${totalCustomers.toLocaleString('tr-TR')} müşteri`,
      icon: Users,
      tone: 'from-[#efe7ff] to-[#e0d3ff] text-[#6b45c0]',
      href: '/panel/ekip',
    },
  ]

  const shortcuts = [
    { label: 'Yeni randevu', icon: CalendarPlus, href: '/panel/randevular?action=new' },
    { label: 'Yeni müşteri', icon: UserPlus, href: '/panel/musteriler?action=new' },
    { label: 'Günlük kasa', icon: Wallet, href: '/panel/kasa' },
  ]

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[28px] border border-[#f3dde5] bg-gradient-to-br from-[#fffafc] via-[#fff2f7] to-[#ffe9f2] px-5 py-5 shadow-[0_26px_70px_-46px_rgba(120,71,88,0.55)] sm:px-6 sm:py-6"
    >
      {/* Altın hairline */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 18%, #d9a441 50%, #ffd3df 82%, transparent)' }}
      />
      {/* Aurora lekeleri — yavaşça süzülür */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#ffc9dd]/55 blur-3xl"
        animate={{ x: [0, 26, 0], y: [0, -18, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-[#e3d4ff]/45 blur-3xl"
        animate={{ x: [0, -22, 0], y: [0, 20, 0] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[#ffe6c2]/45 blur-3xl"
        animate={{ x: [0, 18, 0], y: [0, -12, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-5">
        {/* Karşılama */}
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f0d9e2] bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[#a3576f] backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Canlı · {clock}
            </span>
            {dateLabel && (
              <span className="text-[11.5px] font-medium text-[#8a7480]">{dateLabel}</span>
            )}
          </div>

          <h1 className="mt-2 font-display text-[26px] leading-tight tracking-tight text-[#2b1e29] sm:text-[32px]">
            {greetingFor(hour)}
            {firstName ? <>, <span className="bg-gradient-to-r from-[#c85776] to-[#8e3f5b] bg-clip-text text-transparent">{firstName}</span></> : ''}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#705a66]">
            <Sparkles className="h-3.5 w-3.5 text-[#d9a441]" />
            {institutionName || 'Kurum'}
            {branchName ? <span className="text-[#c9b3bd]">·</span> : null}
            {branchName || ''}
          </p>

          {/* Kısayollar */}
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {shortcuts.map((s) => {
              const Icon = s.icon
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-[#f0d9e2] bg-white/85 px-3 py-1.5 text-[11.5px] font-semibold text-[#a3576f] shadow-[0_10px_24px_-18px_rgba(120,71,88,0.7)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[#e78ba8] hover:bg-white"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                  <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              )
            })}
          </div>
        </div>

        {/* Günün dört rakamı */}
        <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:grid-cols-4">
          {tiles.map((t, i) => {
            const Icon = t.icon
            return (
              <motion.div
                key={t.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -3 }}
              >
                <Link
                  href={t.href}
                  className="flex h-full min-w-[132px] flex-col justify-between gap-2 rounded-[18px] border border-white/70 bg-white/80 p-3 shadow-[0_16px_38px_-30px_rgba(120,71,88,0.85)] backdrop-blur-md transition-colors hover:border-[#f0d9e2] hover:bg-white"
                >
                  <span className={`grid h-9 w-9 place-items-center rounded-[12px] bg-gradient-to-br ${t.tone}`}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </span>
                  <span>
                    <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-[#8a7480]">{t.label}</span>
                    <span className="block text-[22px] font-semibold leading-tight tracking-tight text-[#1f1620] tabular-nums">
                      {t.value}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-[#705a66]">{t.sub}</span>
                  </span>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Alt şerit: küçük bir "bugün" cümlesi */}
      <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-[#f3dde5] pt-3 text-[11.5px] text-[#705a66]">
        <TrendingUp className="h-3.5 w-3.5 text-[#c85776]" />
        {appointmentsToday > 0 ? (
          <span>
            Bugün <b className="text-[#4a3a44]">{appointmentsToday}</b> randevunun{' '}
            <b className="text-emerald-700">{completedToday}</b> tanesi tamamlandı
            {waitingToday > 0 ? <>, <b className="text-amber-700">{waitingToday}</b> tanesi sırada</> : ''}.
          </span>
        ) : (
          <span>Bugün için planlanmış randevu yok — takvimden yeni randevu ekleyebilirsin.</span>
        )}
        {pendingApprovals > 0 && (
          <Link href="/panel/onaylar" className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">
            {pendingApprovals} onay bekliyor <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </motion.section>
  )
}
