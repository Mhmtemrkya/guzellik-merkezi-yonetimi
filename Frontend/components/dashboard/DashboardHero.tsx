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
//
// Palet (bkz. globals.css → "Dashboard paleti"): bandın kimlik rengi #A5556E.
// ZEMİN KOYU ve HAREKETLİ (kullanıcı talebi, 11 Ağu 2026): koyu bordo taban +
// süzülen aurora lekeleri + dönen konik hale + periyodik ışık süpürmesi.
// Rakam kutuları cam yüzeydir (beyaz/10) — koyu zeminde beyaz kart fazla sert
// duruyordu; ikon rozetleri paletin dolu renkleriyle boyanır.
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
      // Dolu renk + beyaz ikon: pastel gradyan yerine kimlik rengi.
      tone: 'bg-[#A5556E] text-white shadow-[0_10px_22px_-10px_rgba(165,85,110,0.95)]',
      href: '/panel/randevular',
    },
    {
      key: 'cash',
      label: 'Bugün tahsilat',
      value: <AnimatedNumber value={revenueToday} format={(n) => formatTL(Math.round(n))} />,
      sub: 'Kasaya giren',
      icon: Wallet,
      tone: 'bg-[#1E8C60] text-white shadow-[0_10px_22px_-10px_rgba(30,140,96,0.95)]',
      href: '/panel/kasa',
    },
    {
      key: 'pending',
      label: 'Bekleyen onay',
      value: <AnimatedNumber value={pendingApprovals} />,
      sub: pendingApprovals > 0 ? 'İncelemeni bekliyor' : 'Her şey onaylı',
      icon: BellRing,
      tone: 'bg-[#F9A1B9] text-[#5A1730] shadow-[0_10px_22px_-10px_rgba(249,161,185,0.95)]',
      href: '/panel/onaylar',
    },
    {
      key: 'team',
      label: 'Aktif ekip',
      value: <AnimatedNumber value={activeStaff} />,
      sub: `${totalCustomers.toLocaleString('tr-TR')} müşteri`,
      icon: Users,
      tone: 'bg-[#8E7882] text-white shadow-[0_10px_22px_-10px_rgba(142,120,130,0.95)]',
      href: '/panel/ekip',
    },
  ]

  const shortcuts = [
    { label: 'Yeni randevu', icon: CalendarPlus, href: '/panel/randevular?action=new', primary: true },
    { label: 'Yeni müşteri', icon: UserPlus, href: '/panel/musteriler?action=new', primary: false },
    { label: 'Günlük kasa', icon: Wallet, href: '/panel/kasa', primary: false },
  ]

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[28px] border border-[#4A2032] px-5 py-5 shadow-[0_34px_80px_-42px_rgba(42,17,25,0.95)] sm:px-6 sm:py-6"
      style={{
        // Koyu taban: bordo (#A5556E) ailesinin en derin tonları + köşelerde renk sızıntısı.
        backgroundColor: '#2A1119',
        backgroundImage:
          'radial-gradient(120% 90% at 12% 0%, rgba(165,85,110,0.55), transparent 58%),' +
          'radial-gradient(90% 80% at 88% 8%, rgba(30,78,140,0.34), transparent 62%),' +
          'radial-gradient(80% 90% at 60% 110%, rgba(249,161,185,0.20), transparent 60%),' +
          'linear-gradient(135deg, #2A1119 0%, #3D1B2B 46%, #2C1420 100%)',
      }}
    >
      {/* Marka hairline — pembe → bordo → pembe (koyu zeminde parlar) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, transparent, #F9A1B9 18%, #FBC9D7 50%, #F9A1B9 82%, transparent)' }}
      />

      {/* İnce ızgara dokusu — koyu yüzeye derinlik verir, hareketi taşır. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
          maskImage: 'radial-gradient(75% 120% at 50% 0%, #000 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(75% 120% at 50% 0%, #000 20%, transparent 78%)',
        }}
      />

      {/* Yavaş dönen konik hale — bandın "canlı" durmasını sağlayan ana hareket. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -left-1/4 -top-full h-[240%] w-[150%] opacity-[0.34] blur-[70px]"
        style={{
          // Mavi payı düşük tutulur: koyu bordonun üstünde fazlası griye kaçıyor.
          background:
            'conic-gradient(from 0deg, rgba(165,85,110,0), rgba(249,161,185,0.44), rgba(30,78,140,0.20), rgba(165,85,110,0.52), rgba(165,85,110,0))',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 44, repeat: Infinity, ease: 'linear' }}
      />

      {/* Aurora lekeleri — yavaşça süzülür ve nefes alır */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#F9A1B9]/25 blur-3xl"
        animate={{ x: [0, 34, 0], y: [0, -22, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-[#A5556E]/45 blur-3xl"
        animate={{ x: [0, -28, 0], y: [0, 24, 0], scale: [1, 1.16, 1] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[#1E4E8C]/30 blur-3xl"
        animate={{ x: [0, 24, 0], y: [0, -16, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Periyodik ışık süpürmesi — camın üstünden geçen parıltı. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent)' }}
        animate={{ x: ['-140%', '420%'] }}
        transition={{ duration: 6.5, repeat: Infinity, repeatDelay: 5, ease: 'easeInOut' }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-5">
        {/* Karşılama */}
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-[#FBC9D7] backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Canlı · {clock}
            </span>
            {dateLabel && (
              <span className="text-[11.5px] font-medium text-white/80">{dateLabel}</span>
            )}
          </div>

          <h1 className="mt-2 font-display text-[26px] leading-tight tracking-tight text-white sm:text-[32px]">
            {greetingFor(hour)}
            {firstName ? (
              <>
                {', '}
                {/* Ad, koyu zeminde soldan sağa süzülen bir parıltıyla boyanır. */}
                <motion.span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: 'linear-gradient(90deg, #F9A1B9, #FFFFFF, #F9A1B9, #FBC9D7)',
                    backgroundSize: '260% 100%',
                  }}
                  animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                  transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {firstName}
                </motion.span>
              </>
            ) : ''}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-white/85">
            <Sparkles className="h-3.5 w-3.5 text-[#F9A1B9]" />
            {institutionName || 'Kurum'}
            {branchName ? <span className="text-white/55">·</span> : null}
            {branchName || ''}
          </p>

          {/* Kısayollar — ilki birincil eylem, dolu marka rengi */}
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {shortcuts.map((s) => {
              const Icon = s.icon
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-all hover:-translate-y-0.5 ${
                    s.primary
                      ? 'bg-[#F9A1B9] text-[#4A1526] shadow-[0_14px_30px_-14px_rgba(249,161,185,0.75)] hover:bg-white'
                      : 'border border-white/25 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:border-white/40'
                  }`}
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
                  className="flex h-full min-w-[132px] flex-col justify-between gap-2 rounded-[18px] border border-white/15 bg-white/[0.08] p-3 backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/[0.14]"
                >
                  <span className={`grid h-9 w-9 place-items-center rounded-[12px] ${t.tone}`}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                  </span>
                  <span>
                    <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-white/80">{t.label}</span>
                    <span className="block text-[22px] font-semibold leading-tight tracking-tight text-white tabular-nums">
                      {t.value}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-white/80">{t.sub}</span>
                  </span>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Alt şerit: küçük bir "bugün" cümlesi */}
      <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-white/20 pt-3 text-[11.5px] text-white/85">
        <TrendingUp className="h-3.5 w-3.5 text-[#F9A1B9]" />
        {appointmentsToday > 0 ? (
          <span>
            Bugün <b className="text-[#F9A1B9]">{appointmentsToday}</b> randevunun{' '}
            <b className="text-emerald-300">{completedToday}</b> tanesi tamamlandı
            {waitingToday > 0 ? <>, <b className="text-amber-300">{waitingToday}</b> tanesi sırada</> : ''}.
          </span>
        ) : (
          <span>Bugün için planlanmış randevu yok — takvimden yeni randevu ekleyebilirsin.</span>
        )}
        {pendingApprovals > 0 && (
          <Link href="/panel/onaylar" className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-300/35 bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 backdrop-blur transition-colors hover:bg-amber-400/25">
            {pendingApprovals} onay bekliyor <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </motion.section>
  )
}
