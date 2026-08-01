'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import SubscriptionCountdown from '@/components/dashboard/SubscriptionCountdown'
import DashboardHero from '@/components/dashboard/DashboardHero'
import PackageReportBreakdown from '@/components/dashboard/PackageReportBreakdown'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileWarning,
  MoreHorizontal,
  Package,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
  UserPlus,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import {
  apiItems,
  formatTL,
  guidOrUndefined,
  normalizeAccountReport,
  normalizeAppointment,
  normalizeCashFlowEntry,
  normalizeCashFlowSummary,
  normalizeCustomer,
  normalizePendingOperation,
  normalizeProduct,
  normalizeService,
  normalizeStaff,
} from '@/lib/apiMappers'
import CustomerReviewsCard from '@/components/dashboard/CustomerReviewsCard'
import type {
  AccountMonthlyInstallment,
  ApiAccountReport,
  ApiAppointment,
  ApiCashFlowEntry,
  ApiCashFlowSummary,
  ApiCustomer,
  ApiPassiveCustomerList,
  ApiPendingOperation,
  ApiProduct,
  ApiService,
  ApiServicePackage,
  ApiServiceReport,
  ApiStaff,
  AppointmentLookups,
  AppointmentStatusKey,
  CashFlowEntry,
  PagedResult,
  Product,
} from '@/lib/types'

interface ApiCustomerStats {
  total?: number
  birthdayThisMonth?: number
  kvkkPending?: number
  blacklisted?: number
  newByDay?: Array<{ date?: string; count?: number }>
}

interface DashboardData {
  appointmentsResult: PagedResult<ApiAppointment>
  customersStats: ApiCustomerStats
  staffResult: PagedResult<ApiStaff>
  servicesResult: PagedResult<ApiService>
  productsResult: PagedResult<ApiProduct>
  cashSummary: ApiCashFlowSummary
  cashEntries: ApiCashFlowEntry[]
  periodCashEntries: ApiCashFlowEntry[]
  pendingResult: PagedResult<ApiPendingOperation>
  passiveResult: ApiPassiveCustomerList
  reportResult: ApiAccountReport
  packagesResult: PagedResult<ApiServicePackage>
}

interface StatusBadgeMeta {
  label: string
  icon: LucideIcon
  cls: string
}

interface WeeklyRevenuePoint {
  label: string
  value: number
}

interface QuickAction {
  label: string
  href: string
  icon: LucideIcon
  tone: 'rose' | 'gold' | 'mint' | 'violet' | 'peach' | 'cream'
}

const statusBadge: Record<AppointmentStatusKey, StatusBadgeMeta> = {
  tamamlandi: {
    label: 'Tamamlandı',
    icon: CheckCircle2,
    cls: 'border border-emerald-100 bg-emerald-50 text-emerald-700',
  },
  devam: {
    label: 'Devam',
    icon: Activity,
    cls: 'border border-sky-100 bg-sky-50 text-sky-700',
  },
  bekliyor: {
    label: 'Bekliyor',
    icon: Clock,
    cls: 'border border-amber-100 bg-amber-50 text-amber-700',
  },
  iptal: {
    label: 'İptal',
    icon: FileWarning,
    cls: 'border border-rose-100 bg-rose-50 text-rose-700',
  },
  taslak: {
    label: 'Taslak',
    icon: Clock,
    cls: 'border border-dashed border-indigo-200 bg-indigo-50 text-indigo-600',
  },
  islemde: {
    label: 'İşlemde',
    icon: Activity,
    cls: 'border border-violet-200 bg-violet-50 text-violet-700',
  },
}

const quickActions: QuickAction[] = [
  { label: 'Yeni Randevu\nOluştur', href: '/admin/randevular', icon: CalendarPlus, tone: 'rose' },
  { label: 'Müşteri\nEkle', href: '/admin/musteriler', icon: UserPlus, tone: 'peach' },
  { label: 'Paket Satışı\nYap', href: '/admin/paketler', icon: ShoppingBag, tone: 'cream' },
  { label: 'Ödeme\nAl', href: '/admin/on-muhasebe?scope=accounts', icon: CreditCard, tone: 'mint' },
  { label: 'Stok Çıkışı\nYap', href: '/admin/stok', icon: Boxes, tone: 'violet' },
  { label: 'Kampanya\nOluştur', href: '/admin/paketler?scope=packages#kampanyalar', icon: Tag, tone: 'gold' },
]

const toneClasses: Record<QuickAction['tone'], string> = {
  rose: 'border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]',
  gold: 'border-[#f2dfbf] bg-[#fff8ea] text-[#b88938]',
  mint: 'border-[#d6ece4] bg-[#f1fbf7] text-[#39846f]',
  violet: 'border-[#eadcf5] bg-[#faf4ff] text-[#8b5aa5]',
  peach: 'border-[#f3dde0] bg-[#fff6f3] text-[#bd6476]',
  cream: 'border-[#d9e8f6] bg-[#f3f9ff] text-[#3a7ca8]',
}

type RangePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

const MONTHS_TR_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const MONTHS_TR_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

// CashFlow/Customer tarihleri yerel YYYY-MM-DD; karşılaştırma string olarak güvenli.
function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

interface PeriodWindow {
  startKey: string
  endKey: string
  label: string
}

// Seçilen döneme göre [başlangıç, bitiş) anahtarları ve kartlarda gösterilecek etiket.
function periodWindow(period: RangePeriod, base: Date): PeriodWindow {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (period === 'weekly') {
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    const label =
      start.getMonth() === today.getMonth()
        ? `${start.getDate()}–${today.getDate()} ${MONTHS_TR_SHORT[today.getMonth()]}`
        : `${start.getDate()} ${MONTHS_TR_SHORT[start.getMonth()]} – ${today.getDate()} ${MONTHS_TR_SHORT[today.getMonth()]}`
    return { startKey: dateKeyOf(start), endKey: dateKeyOf(tomorrow), label }
  }
  if (period === 'monthly') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { startKey: dateKeyOf(start), endKey: dateKeyOf(tomorrow), label: `${MONTHS_TR_LONG[today.getMonth()]} ${today.getFullYear()}` }
  }
  if (period === 'yearly') {
    const start = new Date(today.getFullYear(), 0, 1)
    return { startKey: dateKeyOf(start), endKey: dateKeyOf(tomorrow), label: `${today.getFullYear()}` }
  }
  return { startKey: dateKeyOf(today), endKey: dateKeyOf(tomorrow), label: `Bugün · ${today.getDate()} ${MONTHS_TR_SHORT[today.getMonth()]}` }
}

// Kart içi mini grafik için döneme uygun kova [startKey, endKey) listesi.
// Son kova güncel dönemi (karttaki büyük rakamı) temsil eder.
function buildPeriodBuckets(period: RangePeriod, base: Date): { startKey: string; endKey: string }[] {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const buckets: { startKey: string; endKey: string }[] = []

  if (period === 'daily') {
    // Son 7 gün — her gün bir nokta.
    for (let i = 6; i >= 0; i -= 1) {
      const start = new Date(today)
      start.setDate(start.getDate() - i)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      buckets.push({ startKey: dateKeyOf(start), endKey: dateKeyOf(end) })
    }
    return buckets
  }
  if (period === 'weekly') {
    // Son 8 hafta — her 7 günlük pencere bir nokta.
    for (let i = 7; i >= 0; i -= 1) {
      const end = new Date(tomorrow)
      end.setDate(end.getDate() - i * 7)
      const start = new Date(end)
      start.setDate(start.getDate() - 7)
      buckets.push({ startKey: dateKeyOf(start), endKey: dateKeyOf(end) })
    }
    return buckets
  }
  if (period === 'monthly') {
    // Son 6 ay — her ay bir nokta.
    for (let i = 5; i >= 0; i -= 1) {
      const start = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
      buckets.push({ startKey: dateKeyOf(start), endKey: dateKeyOf(end) })
    }
    return buckets
  }
  // yearly → içinde bulunulan yılın 12 ayı.
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(today.getFullYear(), month, 1)
    const end = new Date(today.getFullYear(), month + 1, 1)
    buckets.push({ startKey: dateKeyOf(start), endKey: dateKeyOf(end) })
  }
  return buckets
}

// Randevu görünümü için TAM takvim dönemi (mobil seçiciyle aynı semantik): bu hafta (Pzt–Paz),
// bu ay, bu yıl — gelecekteki randevuları da kapsar (gelir penceresinden farkı budur).
function appointmentRange(period: RangePeriod, base: Date): { from: Date; to: Date; label: string } {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  if (period === 'weekly') {
    const mondayOffset = (today.getDay() + 6) % 7
    const start = new Date(today)
    start.setDate(today.getDate() - mondayOffset)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    const last = new Date(end)
    last.setDate(end.getDate() - 1)
    const label =
      start.getMonth() === last.getMonth()
        ? `${start.getDate()}–${last.getDate()} ${MONTHS_TR_SHORT[last.getMonth()]}`
        : `${start.getDate()} ${MONTHS_TR_SHORT[start.getMonth()]} – ${last.getDate()} ${MONTHS_TR_SHORT[last.getMonth()]}`
    return { from: start, to: end, label }
  }
  if (period === 'monthly') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return { from: start, to: end, label: `${MONTHS_TR_LONG[today.getMonth()]} ${today.getFullYear()}` }
  }
  if (period === 'yearly') {
    const start = new Date(today.getFullYear(), 0, 1)
    const end = new Date(today.getFullYear() + 1, 0, 1)
    return { from: start, to: end, label: `${today.getFullYear()}` }
  }
  const end = new Date(today)
  end.setDate(today.getDate() + 1)
  return { from: today, to: end, label: `Bugün · ${today.getDate()} ${MONTHS_TR_SHORT[today.getMonth()]}` }
}

const FULL_PERIOD_OPTIONS: { key: RangePeriod; label: string }[] = [
  { key: 'daily', label: 'Gün' },
  { key: 'weekly', label: 'Hafta' },
  { key: 'monthly', label: 'Ay' },
  { key: 'yearly', label: 'Yıl' },
]

const CHART_PERIOD_OPTIONS: { key: RangePeriod; label: string }[] = [
  { key: 'weekly', label: 'Hafta' },
  { key: 'monthly', label: 'Ay' },
  { key: 'yearly', label: 'Yıl' },
]

const PACKAGE_PERIOD_OPTIONS: { key: RangePeriod; label: string }[] = [
  { key: 'daily', label: 'Günlük' },
  { key: 'monthly', label: 'Aylık' },
  { key: 'yearly', label: 'Yıllık' },
]

interface CategoryOption { name: string; subs: string[]; count: number }

/**
 * Kategori (+ varsa alt kategori) süzgeci. Ham <select> yerine panelin diliyle uyumlu açılır panel:
 * seçili kategori tetikleyicide rozetlenir, alt kategoriler seçimden sonra çip olarak açılır.
 * Paket ve Hizmet blokları aynı bileşeni kendi listesiyle kullanır (ikisi birbirine karışmaz).
 */
function CategoryFilter({
  icon: Icon,
  options,
  value,
  subValue,
  onChange,
  onSubChange,
  allLabel = 'Tüm kategoriler',
}: {
  icon: LucideIcon
  options: CategoryOption[]
  value: string
  subValue: string
  onChange: (value: string) => void
  onSubChange: (value: string) => void
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc) }
  }, [open])

  const active = Boolean(value)
  const subs = options.find((o) => o.name === value)?.subs ?? []
  const totalCount = options.reduce((sum, o) => sum + o.count, 0)

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[11px] font-semibold leading-none transition-colors ${
          active
            ? 'border-[#f0c2d2] bg-gradient-to-r from-[#f7c6d5] to-[#f3aec3] text-[#7a2f4a] shadow-sm'
            : 'border-[#efe1e7] bg-white text-[#705a66] hover:border-[#e7c7d4] hover:bg-[#fff8fa]'
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{active ? value : allLabel}</span>
        {active && subValue && <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-[1px] text-[10px]">{subValue}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 z-30 mt-1.5 w-60 overflow-hidden rounded-[14px] border border-[#efe1e7] bg-white shadow-[0_24px_50px_-28px_rgba(120,71,88,0.55)]"
          >
            <div className="max-h-64 overflow-y-auto p-1.5">
              <button
                type="button"
                onClick={() => { onChange(''); onSubChange(''); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  !active ? 'bg-[#fff1f6] font-semibold text-[#a34a62]' : 'text-[#4a3a44] hover:bg-[#fff8fa]'
                }`}
              >
                <span>{allLabel}</span>
                <span className="text-[10px] text-[#705a66]">{totalCount}</span>
              </button>
              {options.length === 0 && (
                <div className="px-2.5 py-3 text-center text-[11px] text-[#705a66]">Kategori tanımlı değil.</div>
              )}
              {options.map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => { onChange(o.name); onSubChange(''); if (o.subs.length === 0) setOpen(false) }}
                  className={`flex w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    value === o.name ? 'bg-[#fff1f6] font-semibold text-[#a34a62]' : 'text-[#4a3a44] hover:bg-[#fff8fa]'
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="shrink-0 text-[10px] text-[#705a66]">{o.count}</span>
                </button>
              ))}
            </div>

            {/* Alt kategoriler yalnızca seçili kategorinin altı varsa görünür. */}
            {subs.length > 0 && (
              <div className="border-t border-[#f3e6ec] bg-[#fffafc] p-2">
                <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#705a66]">Alt kategori</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => { onSubChange(''); setOpen(false) }}
                    className={`rounded-full border px-2 py-[3px] text-[10px] font-medium transition-colors ${
                      !subValue ? 'border-[#e7a9c0] bg-[#fff1f6] text-[#a34a62]' : 'border-[#efe1e7] bg-white text-[#705a66] hover:bg-[#fff8fa]'
                    }`}
                  >
                    Tümü
                  </button>
                  {subs.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { onSubChange(s); setOpen(false) }}
                      className={`rounded-full border px-2 py-[3px] text-[10px] font-medium transition-colors ${
                        subValue === s ? 'border-[#e7a9c0] bg-[#fff1f6] text-[#a34a62]' : 'border-[#efe1e7] bg-white text-[#705a66] hover:bg-[#fff8fa]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PeriodTabs({
  value,
  onChange,
  options,
}: {
  value: RangePeriod
  onChange: (value: RangePeriod) => void
  options: { key: RangePeriod; label: string }[]
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-[#efe1e7] bg-[#fff8fa] p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none transition-colors ${
            value === option.key
              ? 'bg-gradient-to-r from-[#f7c6d5] to-[#f3aec3] text-[#7a2f4a] shadow-sm'
              : 'text-[#9a8590] hover:text-[#7a6570]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.08 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

// Panelin ortak kart dili: hero ile aynı — krem-beyaz yüzey, üstte altın hairline,
// köşede yumuşak gül halesi ve hover'da hafif yükselme.
const cardShell =
  'relative overflow-hidden rounded-[24px] border border-[#f3dde5] bg-gradient-to-br from-white via-white to-[#fffafc] shadow-[0_22px_58px_-38px_rgba(120,71,88,0.5)] transition-shadow hover:shadow-[0_28px_66px_-34px_rgba(120,71,88,0.55)]'

/** Kartın üst kenarındaki altın çizgi — marka imzası. */
function GoldHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
      style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #d9a441 50%, #ffd3df 80%, transparent)' }}
    />
  )
}

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

function SectionCard({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={`${cardShell} ${className}`}
    >
      <GoldHairline />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#ffdce8]/45 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[#241923]">
          <span aria-hidden className="h-4 w-[3px] rounded-full bg-gradient-to-b from-[#e0617f] to-[#8e3f5b]" />
          {title}
        </h2>
        {action}
      </div>
      <div className="relative">{children}</div>
    </motion.section>
  )
}

function AvatarBubble({ name, size = 'md', photoUrl }: { name: string; size?: 'sm' | 'md'; photoUrl?: string }) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[9px]' : 'h-8 w-8 text-[10px]'
  if (photoUrl) {
    return (
      <span className={`${dim} shrink-0 overflow-hidden rounded-full border border-[#efd5dd] shadow-[0_10px_22px_-16px_rgba(190,91,125,0.8)]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      </span>
    )
  }
  return (
    <span
      className={`${dim} grid shrink-0 place-items-center rounded-full border border-[#efd5dd] bg-gradient-to-br from-[#fff5f8] via-[#f8d6e1] to-[#f2b9ca] font-semibold text-[#7f4057] shadow-[0_10px_22px_-16px_rgba(190,91,125,0.8)]`}
    >
      {initials(name)}
    </span>
  )
}

function MiniSparkline({ values = [10, 20, 16, 28, 24, 36] }: { values?: number[] }) {
  const max = Math.max(1, ...values)
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 68 + 2
      const y = 34 - (value / max) * 24
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox="0 0 74 38" className="h-10 w-[82px]" aria-hidden>
      <polyline points={points} fill="none" stroke="#b9658b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {points.split(' ').map((point, index, arr) => {
        const [cx, cy] = point.split(',')
        const isLast = index === arr.length - 1
        return (
          <circle
            key={`${point}-${index}`}
            cx={cx}
            cy={cy}
            r={isLast ? '2.6' : '1.8'}
            fill={isLast ? '#b9658b' : '#fff'}
            stroke="#b9658b"
            strokeWidth="1"
          />
        )
      })}
    </svg>
  )
}

function MiniBars({ values = [28, 44, 36, 54, 68, 82] }: { values?: number[] }) {
  const max = Math.max(1, ...values)
  const lastIndex = values.length - 1
  return (
    <div className="flex h-14 w-[88px] items-end gap-[3px]" aria-hidden>
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={`min-w-[2px] flex-1 rounded-full bg-gradient-to-t ${
            index === lastIndex ? 'from-[#e3b86c] to-[#c79a45]' : 'from-[#f3e3c6] to-[#e0c486]'
          }`}
          style={{ height: `${Math.max(4, (value / max) * 54)}px` }}
        />
      ))}
    </div>
  )
}

/** Kart tonuna göre başlık bandı yüzeyi ve grafik rengi. */
const toneSurface: Record<QuickAction['tone'], string> = {
  rose: 'from-[#fff1f6] to-[#ffe0eb]',
  gold: 'from-[#fff8ea] to-[#ffedcd]',
  violet: 'from-[#f6f1ff] to-[#eae0ff]',
  mint: 'from-[#eefaf3] to-[#daf2e6]',
  peach: 'from-[#fff4ee] to-[#ffe4d5]',
  cream: 'from-[#f3f9ff] to-[#ddecfb]',
}
const toneStroke: Record<QuickAction['tone'], string> = {
  rose: '#c85776', gold: '#c79a45', violet: '#7c5cbf', mint: '#2f9d6b', peach: '#d97845', cream: '#3a7ca8',
}

/** Kartın altını boydan boya kaplayan yumuşak alan grafiği (dönemin gerçek serisi). */
function AreaSpark({ values, tone }: { values: number[]; tone: QuickAction['tone'] }) {
  const max = Math.max(1, ...values)
  const line = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${30 - (v / max) * 25}`)
    .join(' ')
  const stroke = toneStroke[tone]
  const gid = `spark-${tone}`
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.30" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${line} 100,30`} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DonutGauge({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, value))
  return (
    <div
      className="grid h-[74px] w-[74px] place-items-center rounded-full"
      style={{ background: `conic-gradient(#78bf93 ${percent * 3.6}deg, #edf7f1 0deg)` }}
      aria-label={`Doluluk oranı ${percent}%`}
    >
      <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white text-[15px] font-semibold text-[#2f6f53]">
        {percent}%
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  title,
  value,
  detail,
  subDetail,
  visual,
  series,
  control,
  tone = 'rose',
}: {
  icon: LucideIcon
  title: string
  value: ReactNode
  detail: ReactNode
  subDetail?: ReactNode
  /** Seri verilmediğinde başlık bandında gösterilen küçük görsel (ör. doluluk halkası). */
  visual?: ReactNode
  /** Verilirse kartın altına boydan boya alan grafiği çizilir. */
  series?: number[]
  control?: ReactNode
  tone?: QuickAction['tone']
}) {
  return (
    <motion.div
      variants={listRow}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`${cardShell} group flex min-h-[188px] flex-col`}
    >
      <GoldHairline />

      {/* Renkli başlık bandı: ikon + dönem kontrolü */}
      <div className={`relative flex min-h-[76px] items-start justify-between gap-3 bg-gradient-to-br ${toneSurface[tone]} px-5 pb-4 pt-5`}>
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/45 blur-2xl transition-transform duration-500 group-hover:scale-110" />
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-white/85 shadow-[0_12px_26px_-18px_rgba(120,71,88,0.9)] transition-transform duration-300 group-hover:scale-105 ${toneClasses[tone]}`}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.65} />
        </span>
        <div className="relative flex shrink-0 flex-col items-end gap-2">{control}</div>
      </div>

      {/* Gövde: başlık · büyük rakam · rozetler */}
      <div className="relative flex flex-1 items-end justify-between gap-3 px-5 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#8a7480]">{title}</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-[#1f1620] tabular-nums">
            {value}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="rounded-full bg-[#fff4f8] px-2 py-0.5 font-medium text-[#77616b]">{detail}</span>
            {subDetail && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{subDetail}</span>
            )}
          </div>
        </div>
        {/* Halka gibi büyük görseller gövdede, rakamın yanında durur — renkli bant
            tüm kartlarda aynı yükseklikte kalsın diye banda konmaz. */}
        {!series && visual && <div className="shrink-0 pb-0.5">{visual}</div>}
      </div>

      {/* Alt şerit: dönemin gerçek trendi */}
      {series && series.length > 1 && (
        <div className="relative h-[52px] w-full">
          <AreaSpark values={series} tone={tone} />
        </div>
      )}
    </motion.div>
  )
}

// Eksen için "yuvarlak" bir tavan değeri seç (örn. 42→50, 42000→50000).
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  const norm = value / pow
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * pow
}

function axisLabel(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return `${Math.round(value)}`
}

function RevenueChart({
  data,
  granularity = 'gün',
  periodLabel = 'Bu hafta',
}: {
  data: WeeklyRevenuePoint[]
  granularity?: string
  periodLabel?: string
}) {
  const n = Math.max(data.length, 1)
  const rawMax = Math.max(0, ...data.map((point) => point.value))
  const hasData = rawMax > 0
  // Çizgi, çubuklar ve eksen artık AYNI ölçeği kullanıyor (önceden eksen 0-50k sabitti).
  const niceMax = hasData ? Math.max(5, niceCeil(rawMax)) : 100
  const peakIndex = hasData ? data.reduce((bi, p, i) => (p.value > data[bi].value ? i : bi), 0) : -1
  const peak = peakIndex >= 0 ? data[peakIndex] : { label: 'Bugün', value: 0 }
  const total = data.reduce((sum, p) => sum + p.value, 0)

  // Çubuk merkezlerinin altına denk gelmesi için x = (i+0.5)/n.
  const linePoints = data
    .map((point, index) => {
      const x = ((index + 0.5) / n) * 100
      const y = 100 - (point.value / niceMax) * 100
      return `${x},${y}`
    })
    .join(' ')

  const ticks = [0, 1, 2, 3, 4, 5] // üstten alta; değer = niceMax*(1 - i/5)

  return (
    <div className="px-5 pb-5">
      <div className="relative mt-1 rounded-[18px] bg-gradient-to-b from-white to-[#fff8fa] px-4 pb-3 pt-7">
        {/* Tepe değer balonu — zirve çubuğunun üstünde */}
        {hasData && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2b2630] px-2 py-1 text-[10px] font-semibold text-white shadow-lg"
            style={{ left: `calc(3rem + (100% - 3rem - 1rem) * ${(peakIndex + 0.5) / n})` }}
          >
            {formatTL(Math.round(peak.value))}
          </div>
        )}

        {/* Çizim alanı */}
        <div className="relative h-[168px]">
          {/* Yatay ızgara + dinamik eksen etiketleri */}
          {ticks.map((i) => (
            <div
              key={i}
              className="absolute left-0 right-0 flex -translate-y-1/2 items-center gap-2"
              style={{ top: `${(i / 5) * 100}%` }}
              aria-hidden
            >
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-[#a5909c]">{axisLabel(niceMax * (1 - i / 5))}</span>
              <span className="h-px flex-1 bg-[#f1e5ea]" />
            </div>
          ))}

          {/* Çubuklar — 0 çizgisine sabitli, gerçek orana göre yükseklik */}
          <div className="absolute inset-y-0 left-12 right-0 flex items-end justify-between gap-1.5">
            {data.map((point, i) => {
              const isPeak = i === peakIndex
              return (
                <div key={point.label} className="flex h-full flex-1 items-end justify-center">
                  <div
                    className={`w-full max-w-[30px] rounded-t-lg transition-[height] duration-500 ${
                      isPeak ? 'bg-gradient-to-t from-[#f3a3bf] to-[#ffd9e6]' : 'bg-gradient-to-t from-[#ffe7ef] to-[#fff5f9]'
                    }`}
                    style={{ height: `${(point.value / niceMax) * 100}%` }}
                  />
                </div>
              )
            })}
          </div>

          {/* Çizgi + noktalar — çubuklarla aynı bölge */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-y-0 left-12 right-0 h-full w-[calc(100%-3rem)] overflow-visible"
            aria-hidden
          >
            <polyline points={linePoints} fill="none" stroke="#d7839d" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            {data.map((point, i) => {
              const cx = ((i + 0.5) / n) * 100
              const cy = 100 - (point.value / niceMax) * 100
              return <circle key={point.label} cx={cx} cy={cy} r="1.6" fill="#fff" stroke="#d7839d" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            })}
          </svg>
        </div>

        {/* Gün etiketleri — çubuklarla hizalı */}
        <div className="mt-2 flex gap-1.5 pl-12">
          {data.map((point) => (
            <span key={point.label} className="flex-1 text-center text-[10px] text-[#7d6a72]">{point.label}</span>
          ))}
        </div>
      </div>

      {/* Lejant / açıklama — ne neyi gösteriyor */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border border-[#f1e3e9] bg-[#fffafc] px-3.5 py-2.5 text-[11px] text-[#7d6a72]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px] bg-gradient-to-t from-[#f3a3bf] to-[#ffd9e6]" />
          Çubuk: {granularity} başına toplam gelir (tahsilat)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[#d7839d]" />
          Çizgi: gelir trendi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[#a5909c]">↕</span>
          Dikey eksen: {granularity} başına ciro (₺)
        </span>
      </div>

      <div data-guide="dash-insights" className="mt-3 grid gap-3 sm:grid-cols-3">
        <InsightTile title={`En yoğun ${granularity}`} value={hasData ? peak.label : 'Veri bekleniyor'} sub={formatTL(Math.round(peak.value))} />
        <InsightTile title="En çok çalışan personel" value="Performans API" sub="Randevu bazlı" medal />
        <InsightTile title="Toplam gelir" value={formatTL(Math.round(total))} sub={periodLabel} pie />
      </div>
    </div>
  )
}

function InsightTile({ title, value, sub, medal, pie }: { title: string; value: string; sub: string; medal?: boolean; pie?: boolean }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="group relative overflow-hidden rounded-[18px] border border-[#f3dde5] bg-gradient-to-br from-white to-[#fffafc] p-3.5 shadow-[0_16px_40px_-32px_rgba(120,71,88,0.55)]"
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-[#ffdce8]/40 blur-2xl transition-transform duration-500 group-hover:scale-125" />
      <div className="relative text-[9.5px] font-semibold uppercase tracking-wide text-[#8a7480]">{title}</div>
      <div className="relative mt-1.5 truncate text-[15px] font-semibold leading-tight text-[#1f1620]">{value}</div>
      <div className="relative mt-1.5 inline-block rounded-full bg-[#fff4f8] px-2 py-0.5 text-[10.5px] font-semibold text-[#a3576f]">{sub}</div>
      {medal && (
        <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#f7d774] to-[#d9a441] text-white shadow-[0_10px_20px_-14px_rgba(120,71,88,0.9)]">
          <Star className="h-4 w-4" fill="currentColor" strokeWidth={1.4} />
        </span>
      )}
      {pie && (
        <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-[conic-gradient(#9c70bb_0_70%,#f0e1f7_70%)]">
          <span className="h-4 w-4 rounded-full bg-white" />
        </span>
      )}
    </motion.div>
  )
}

function stockTone(product: Product): string {
  if (product.status === 'out') return 'text-[#c05266]'
  if (product.status === 'critical') return 'text-[#b88938]'
  return 'text-[#8a7480]'
}

// Taksit çubuğu etiketleri için kısa biçim (5375 → "5,4B"); tam değer title'da gösterilir.
function formatTLShort(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn`
  if (absolute >= 1000) return `${(value / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} B`
  return Math.round(value).toLocaleString('tr-TR')
}

function formatChartCurrency(value: number): string {
  return `₺${formatTLShort(value)}`
}

function ReportKpi({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  danger,
}: {
  icon: LucideIcon
  tone: QuickAction['tone']
  label: string
  value: string
  hint: string
  danger?: boolean
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`group relative flex flex-col overflow-hidden rounded-[18px] border ${
        danger ? 'border-rose-200' : 'border-[#f3dde5]'
      } bg-white shadow-[0_16px_40px_-32px_rgba(120,71,88,0.55)] transition-shadow hover:shadow-[0_22px_46px_-30px_rgba(120,71,88,0.6)]`}
    >
      {/* Tonlu üst bant */}
      <div className={`relative flex items-center gap-2 bg-gradient-to-br ${toneSurface[tone]} px-3 py-2.5`}>
        <span aria-hidden className="pointer-events-none absolute -right-5 -top-6 h-16 w-16 rounded-full bg-white/50 blur-xl transition-transform duration-500 group-hover:scale-125" />
        <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-white/85 shadow-[0_10px_20px_-16px_rgba(120,71,88,0.9)] ${toneClasses[tone]}`}>
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <span className="relative text-[10px] font-semibold uppercase leading-tight tracking-wide text-[#7a6470]">{label}</span>
      </div>
      {/* Rakam + ipucu */}
      <div className="px-3 pb-3 pt-2.5">
        <div className={`text-[22px] font-semibold leading-none tabular-nums tracking-tight ${danger ? 'text-[#c0506a]' : 'text-[#1f1620]'}`}>
          {value}
        </div>
        <div className="mt-1.5 inline-block rounded-full bg-[#fff4f8] px-2 py-0.5 text-[10px] font-medium text-[#77616b]">{hint}</div>
      </div>
    </motion.div>
  )
}

interface InstallmentChartPoint extends AccountMonthlyInstallment {
  key: string
  axisLabel: string
  isNext: boolean
  collectionRate: number
}

interface InstallmentAxisTickProps {
  x?: number
  y?: number
  payload?: { value?: string }
}

function InstallmentAxisTick({ x = 0, y = 0, payload }: InstallmentAxisTickProps) {
  const [month = '', year = '', state = ''] = String(payload?.value ?? '').split('|')
  const emphasized = state === 'current' || state === 'next'
  const fill = state === 'next' ? '#c05277' : state === 'current' ? '#553442' : '#7d6a72'

  return (
    <g transform={`translate(${x},${y})`}>
      {emphasized && (
        <rect
          x={-24}
          y={8}
          width={48}
          height={23}
          rx={11.5}
          fill={state === 'next' ? '#fff0f5' : '#f6eef1'}
          stroke={state === 'next' ? '#f2b2c8' : '#e6d8de'}
        />
      )}
      <text x={0} y={23} textAnchor="middle" fill={fill} fontSize={11} fontWeight={emphasized ? 700 : 600}>
        {month}
      </text>
      <text x={0} y={44} textAnchor="middle" fill="#ad98a2" fontSize={9.5} fontWeight={500}>
        {year}
      </text>
    </g>
  )
}

function InstallmentTooltip({ active, payload }: TooltipProps<number, string>) {
  const point = payload?.[0]?.payload as InstallmentChartPoint | undefined
  if (!active || !point) return null

  return (
    <div className="min-w-[210px] rounded-[16px] border border-[#eadde3] bg-white/[0.98] p-3.5 shadow-[0_18px_48px_-18px_rgba(91,47,66,0.38)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-[#2b1e29]">
            {point.label} {point.year}
          </div>
          <div className="mt-0.5 text-[10px] text-[#9a8590]">Aylık ödeme özeti</div>
        </div>
        <span className="rounded-full bg-[#f7f1f3] px-2 py-1 text-[10px] font-bold tabular-nums text-[#725966]">
          %{Math.round(point.collectionRate)}
        </span>
      </div>
      <div className="mt-3 space-y-2 border-t border-[#f2e7eb] pt-3">
        <div className="flex items-center justify-between gap-5 text-[11px]">
          <span className="flex items-center gap-2 text-[#7d6a72]">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#d8b46d]" />
            Tahsil edildi
          </span>
          <b className="tabular-nums text-[#3a2b33]">{formatTL(Math.round(point.collected))}</b>
        </div>
        <div className="flex items-center justify-between gap-5 text-[11px]">
          <span className="flex items-center gap-2 text-[#7d6a72]">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#ed8eaf]" />
            Alınacak
          </span>
          <b className="tabular-nums text-[#c05277]">{formatTL(Math.round(point.remaining))}</b>
        </div>
        <div className="flex items-center justify-between gap-5 border-t border-dashed border-[#eadde3] pt-2 text-[11px]">
          <span className="font-medium text-[#7d6a72]">Toplam vade</span>
          <b className="tabular-nums text-[#2b1e29]">{formatTL(Math.round(point.due))}</b>
        </div>
      </div>
    </div>
  )
}

function InstallmentSummary({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'rose' | 'gold' | 'neutral'
}) {
  const toneClass = {
    rose: 'bg-[#fff0f5] text-[#bd4e73] ring-[#f5ccda]',
    gold: 'bg-[#fff8e9] text-[#9b712d] ring-[#f1dfb9]',
    neutral: 'bg-[#f7f2f4] text-[#644a57] ring-[#e9dce2]',
  }[tone]

  return (
    <div className="min-w-0 rounded-[15px] border border-[#eee2e7] bg-white px-3.5 py-3 shadow-[0_10px_24px_-22px_rgba(93,48,66,0.5)]">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a8590]">
        <span className={`h-2 w-2 rounded-full ring-4 ${toneClass}`} />
        {label}
      </div>
      <div className="mt-2 truncate text-[16px] font-bold tabular-nums tracking-tight text-[#2b1e29]">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-[#a08b95]">{detail}</div>
    </div>
  )
}

function InstallmentCalendar({ months, period }: { months: AccountMonthlyInstallment[]; period: RangePeriod }) {
  const now = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1
  const nextY = curM === 12 ? curY + 1 : curY
  const nextMo = curM === 12 ? 1 : curM + 1
  const isYearly = period === 'yearly'
  const VISIBLE = isYearly ? 12 : 6
  // Takvim geçmiş ayları da içerir; "bu ay" index ile değil yıl/ay eşleşmesiyle bulunur.
  const currentIndex = useMemo(() => {
    const i = months.findIndex((m) => m.year === curY && m.month === curM)
    return i >= 0 ? i : 0
  }, [months, curY, curM])
  // Varsayılan pencere: yıllık → yılın Ocak ayı; aylık → 1 geçmiş + bu ay + gelecek görünsün.
  const defaultStart = useMemo(() => {
    if (isYearly) {
      const jan = months.findIndex((m) => m.year === curY && m.month === 1)
      return Math.max(0, jan >= 0 ? jan : currentIndex)
    }
    return Math.max(0, currentIndex - 1)
  }, [isYearly, months, curY, currentIndex])
  const maxOffset = Math.max(0, months.length - VISIBLE)
  const [start, setStart] = useState(0)
  useEffect(() => {
    setStart(Math.min(defaultStart, maxOffset))
  }, [defaultStart, maxOffset])
  const visible = months.slice(start, start + VISIBLE)
  const chartData: InstallmentChartPoint[] = visible.map((month) => {
    const isCurrent = month.year === curY && month.month === curM
    const isNextMonth = month.year === nextY && month.month === nextMo
    const state = isCurrent ? 'current' : isNextMonth ? 'next' : 'default'
    return {
      ...month,
      key: `${month.year}-${month.month}`,
      axisLabel: `${month.label}|${month.year}|${state}`,
      isNext: isNextMonth,
      collectionRate: month.due > 0 ? Math.min(100, (month.collected / month.due) * 100) : 0,
    }
  })
  const windowDue = visible.reduce((sum, month) => sum + month.due, 0)
  const windowCollected = visible.reduce((sum, month) => sum + month.collected, 0)
  const windowRemaining = visible.reduce((sum, month) => sum + month.remaining, 0)
  const windowCollectionRate = windowDue > 0 ? Math.min(100, (windowCollected / windowDue) * 100) : 0
  const nextMonth = months.find((m) => m.year === nextY && m.month === nextMo) ?? null
  const hasAny = months.some((month) => month.due > 0 || month.collected > 0 || month.remaining > 0)
  const canPrev = start > 0
  const canNext = start + VISIBLE < months.length
  const rangeLabel =
    visible.length === 0
      ? '—'
      : visible.length === 1
        ? `${visible[0].label} ${visible[0].year}`
        : `${visible[0].label} ${visible[0].year} – ${visible[visible.length - 1].label} ${visible[visible.length - 1].year}`

  return (
    <div data-guide="dash-taksit" className="relative overflow-hidden rounded-[22px] border border-[#eadde3] bg-[linear-gradient(145deg,#ffffff_0%,#fff9fb_54%,#fffdf9_100%)] p-4 shadow-[0_22px_55px_-42px_rgba(105,55,75,0.65)] sm:p-5">
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-[#f9dbe6]/35 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[11px] border border-[#f0d9e2] bg-[#fff1f6] text-[#c05277]">
              <BarChart3 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <div className="text-[13px] font-bold tracking-[-0.01em] text-[#2b1e29]">Aylık Taksit Performansı</div>
              <div className="mt-0.5 text-[10.5px] text-[#9a8590]">{rangeLabel} · tahsilat ve kalan alacak dağılımı</div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="mr-1 hidden rounded-full border border-[#eadde3] bg-white/80 px-3 py-1.5 text-[10px] font-semibold text-[#806b75] md:inline">
            {isYearly ? `${curY} yılı` : `${VISIBLE} aylık görünüm`}
          </span>
          <button
            type="button"
            aria-label="Önceki aylar"
            disabled={!canPrev}
            onClick={() => setStart(Math.max(0, start - VISIBLE))}
            className="grid h-9 w-9 place-items-center rounded-full border border-[#eadde3] bg-white text-[#a34a62] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#e7bfd0] hover:bg-[#fff1f6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Sonraki aylar"
            disabled={!canNext}
            onClick={() => setStart(Math.min(maxOffset, start + VISIBLE))}
            className="grid h-9 w-9 place-items-center rounded-full border border-[#eadde3] bg-white text-[#a34a62] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#e7bfd0] hover:bg-[#fff1f6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative mt-4 grid gap-2.5 sm:grid-cols-3">
        <InstallmentSummary
          label="Dönem tahsilatı"
          value={formatTL(Math.round(windowCollected))}
          detail={`${visible.length} aylık toplam`}
          tone="gold"
        />
        <InstallmentSummary
          label="Kalan alacak"
          value={formatTL(Math.round(windowRemaining))}
          detail={nextMonth ? `Gelecek ay ${formatTL(Math.round(nextMonth.remaining))}` : 'Planlanmış alacak'}
          tone="rose"
        />
        <InstallmentSummary
          label="Tahsilat oranı"
          value={`%${Math.round(windowCollectionRate)}`}
          detail={`${formatTL(Math.round(windowDue))} toplam vade`}
          tone="neutral"
        />
      </div>

      {hasAny ? (
        <>
          <div className="relative mt-3 overflow-x-auto rounded-[18px] border border-[#eee3e7] bg-white/75 px-1 pb-1 pt-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:px-3">
            <div className="h-[280px] min-w-[560px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 26, right: 10, left: -10, bottom: 26 }} barCategoryGap="42%">
                  <defs>
                    <linearGradient id="installmentCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f3dcae" />
                      <stop offset="55%" stopColor="#e0bd76" />
                      <stop offset="100%" stopColor="#c69b45" />
                    </linearGradient>
                    <linearGradient id="installmentRemaining" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffd0e0" />
                      <stop offset="55%" stopColor="#f39cbb" />
                      <stop offset="100%" stopColor="#d9648e" />
                    </linearGradient>
                    <linearGradient id="installmentNext" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffc3d7" />
                      <stop offset="100%" stopColor="#d95d88" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#f7ecf1" strokeDasharray="2 8" strokeWidth={1} />
                  <XAxis
                    dataKey="axisLabel"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    height={58}
                    tick={<InstallmentAxisTick />}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={58}
                    tick={{ fill: '#a18d96', fontSize: 9.5, fontWeight: 500 }}
                    tickFormatter={(value: number) => formatChartCurrency(value)}
                  />
                  <Tooltip
                    content={<InstallmentTooltip />}
                    cursor={{ fill: '#fff2f6', opacity: 0.9, radius: 14 }}
                    wrapperStyle={{ outline: 'none' }}
                  />
                  <Bar
                    dataKey="collected"
                    name="Tahsil edildi"
                    stackId="installments"
                    fill="url(#installmentCollected)"
                    maxBarSize={34}
                    radius={[0, 0, 10, 10]}
                    animationDuration={850}
                    animationEasing="ease-out"
                  >
                    {chartData.map((point) => (
                      <Cell key={`collected-${point.key}`} fill="url(#installmentCollected)" />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="remaining"
                    name="Alınacak"
                    stackId="installments"
                    fill="url(#installmentRemaining)"
                    maxBarSize={34}
                    radius={[12, 12, 0, 0]}
                    animationDuration={850}
                    animationEasing="ease-out"
                  >
                    {chartData.map((point) => (
                      <Cell
                        key={`remaining-${point.key}`}
                        fill={point.isNext ? 'url(#installmentNext)' : 'url(#installmentRemaining)'}
                        stroke={point.isNext ? '#cc4e79' : 'transparent'}
                        strokeWidth={point.isNext ? 1.25 : 0}
                      />
                    ))}
                    <LabelList
                      dataKey="remaining"
                      position="top"
                      fill="#806b75"
                      fontSize={10}
                      fontWeight={700}
                      formatter={(value: ReactNode) =>
                        typeof value === 'number' && value > 0 ? formatTLShort(value) : ''
                      }
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute left-[70px] top-[18px] text-[9px] font-semibold uppercase tracking-[0.12em] text-[#b09ca5]">
              Tutar
            </div>
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[10px] text-[#8a7480]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-b from-[#f6b3ca] to-[#df769b]" /> Alınacak
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-b from-[#ebce92] to-[#cda34e]" /> Tahsil edildi
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-5 rounded-full border border-[#e6d8de] bg-[#f6eef1] px-2 text-[9px] font-bold leading-[18px] text-[#553442]">Ay</span> Bu ay
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-5 rounded-full border border-[#f2b2c8] bg-[#fff0f5] px-2 text-[9px] font-bold leading-[18px] text-[#c05277]">Ay</span> Gelecek ay
            </span>
            <span className="ml-auto hidden text-[#aa959f] sm:inline">Ayrıntı için sütunların üzerine gelin</span>
          </div>
        </>
      ) : (
        <div className="relative mt-4 flex min-h-[150px] flex-col items-center justify-center rounded-[18px] border border-dashed border-[#e7d8de] bg-white/60 px-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#edf8f2] text-[#4b8a68]">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-[#4f3c46]">Planlanmış taksit bulunmuyor</div>
          <div className="mt-1 text-[10.5px] text-[#9a8590]">Önümüzdeki dönemde tahsil edilecek bir ödeme görünmüyor.</div>
        </div>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  const { selectedBranch, selectedInstitutionId, selectedInstitution } = useBranch()
  const { user } = useAuth()
  const tenantId = guidOrUndefined(selectedInstitutionId)

  // Kart ve grafik dönem seçimleri (günlük/haftalık/aylık/yıllık).
  const [revenuePeriod, setRevenuePeriod] = useState<RangePeriod>('daily')
  const [customerPeriod, setCustomerPeriod] = useState<RangePeriod>('weekly')
  const [chartRange, setChartRange] = useState<RangePeriod>('weekly')
  // Paket Raporu KPI kartları dönem filtresi (günlük/aylık/yıllık) — varsayılan aylık.
  const [packagePeriod, setPackagePeriod] = useState<RangePeriod>('monthly')
  // Paket Raporu kategori süzgeci — dönem çipiyle BİRLİKTE çalışır ('' = tüm kategoriler).
  const [packageCategory, setPackageCategory] = useState('')
  const [packageSubCategory, setPackageSubCategory] = useState('')
  // Hizmet Raporu kendi dönemi ve kendi (hizmet) kategorisiyle çalışır — paketle karışmaz.
  const [servicePeriod, setServicePeriod] = useState<RangePeriod>('monthly')
  const [serviceCategory, setServiceCategory] = useState('')
  const [serviceSubCategory, setServiceSubCategory] = useState('')
  // Satış Detayı > Kategori Kırılımı kendi dönemine sahiptir (KPI'ları ve taksit grafiğini etkilemez).
  const [categoryPeriod, setCategoryPeriod] = useState<RangePeriod>('monthly')
  // Global randevu dönemi (üst seçici): randevu kartı + akış tablosunu sürükler. Diğer kartlar kendi sekmesini korur.
  const [globalPeriod, setGlobalPeriod] = useState<RangePeriod>('daily')

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const weekStart = new Date(dayStart)
  weekStart.setDate(weekStart.getDate() - 6)
  // Dönem filtreleri (ay/yıl) için tüm yıl boyunca tahsilat verisi çekiliyor.
  const yearStart = new Date(dayStart.getFullYear(), 0, 1)
  const dayStartIso = dayStart.toISOString()
  const dayEndIso = dayEnd.toISOString()
  const weekStartIso = weekStart.toISOString()
  const yearStartIso = yearStart.toISOString()
  // Üst seçicinin sürüklediği randevu penceresi (tam takvim dönemi).
  const apptRange = appointmentRange(globalPeriod, dayStart)
  const apptFromIso = apptRange.from.toISOString()
  const apptToIso = apptRange.to.toISOString()

  const { data, loading, error } = useApiQuery<DashboardData>(
    async () => {
      const [
        appointmentsResult,
        customersStats,
        staffResult,
        servicesResult,
        productsResult,
        cashSummary,
        cashEntries,
        periodCashEntries,
        pendingResult,
        passiveResult,
        reportResult,
        packagesResult,
      ] = await Promise.all([
        adminApi.appointments<ApiAppointment>({
          tenantId,
          fromUtc: apptFromIso,
          toUtc: apptToIso,
          page: 1,
          pageSize: 200,
        }),
        // Sınırsız müşteri ölçeği: liste yerine sunucuda hesaplanan istatistik.
        adminApi.customersStats<ApiCustomerStats>(tenantId).catch<ApiCustomerStats>(() => ({})),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 100 }),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 100 }),
        adminApi.products<ApiProduct>({ tenantId, page: 1, pageSize: 100 }),
        adminApi.cashFlowSummary<ApiCashFlowSummary>({ tenantId, fromUtc: dayStartIso, toUtc: dayEndIso }),
        adminApi.cashFlow<ApiCashFlowEntry>({ tenantId, fromUtc: dayStartIso, toUtc: dayEndIso, page: 1, pageSize: 50 }),
        adminApi.cashFlow<ApiCashFlowEntry>({ tenantId, fromUtc: yearStartIso, toUtc: dayEndIso, page: 1, pageSize: 2000 }),
        adminApi.pendingOperations<ApiPendingOperation>({ tenantId, status: 'Pending', page: 1, pageSize: 10 }),
        adminApi.passiveCustomers<ApiPassiveCustomerList>(tenantId).catch(() => ({ items: [], thresholdDays: 0 })),
        adminApi.accountReport<ApiAccountReport>(tenantId, 6).catch(() => ({} as ApiAccountReport)),
        // Paket Raporu kategori süzgecinin seçenekleri paketlerin kendi kategorilerinden türetilir
        // (boş kategori gösterilmesin diye katalog listesi yerine gerçek paketler kullanılır).
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
      ])
      return {
        appointmentsResult,
        customersStats,
        staffResult,
        servicesResult,
        productsResult,
        cashSummary,
        cashEntries,
        periodCashEntries,
        pendingResult,
        passiveResult,
        reportResult,
        packagesResult,
      }
    },
    [tenantId, apptFromIso, apptToIso, dayStartIso, dayEndIso, yearStartIso],
    { initialData: null },
  )

  // Paket Raporu dönem penceresi: yerel sınırlar ISO'ya çevrilir (CreatedAtUtc ile doğru karşılaştırılır).
  const packageWindowLabel = periodWindow(packagePeriod, dayStart).label
  const pkgToday = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate())
  const pkgToDate = new Date(pkgToday)
  pkgToDate.setDate(pkgToDate.getDate() + 1)
  const pkgFromDate =
    packagePeriod === 'daily'
      ? pkgToday
      : packagePeriod === 'yearly'
        ? new Date(pkgToday.getFullYear(), 0, 1)
        : new Date(pkgToday.getFullYear(), pkgToday.getMonth(), 1)
  const pkgFromIso = pkgFromDate.toISOString()
  const pkgToIso = pkgToDate.toISOString()

  // Paket Raporu kartları için döneme göre süzülmüş ayrı rapor (Tahsilat Oranı + takvim genel kalır).
  // Kategori seçiliyse aynı sorguya eklenir → dönem + kategori birlikte uygulanır.
  const { data: packageReportData, loading: packageLoading } = useApiQuery<ApiAccountReport>(
    () => adminApi
      .accountReport<ApiAccountReport>(tenantId, 6, pkgFromIso, pkgToIso, packageCategory || undefined, packageSubCategory || undefined)
      .catch(() => ({}) as ApiAccountReport),
    [tenantId, pkgFromIso, pkgToIso, packageCategory, packageSubCategory],
    { initialData: null },
  )

  // Yalnız kategori kırılımı için ayrı pencere (Gün/Hafta/Ay/Yıl) — kendi rapor sorgusu.
  const catWindow = periodWindow(categoryPeriod, dayStart)
  const catFromIso = new Date(`${catWindow.startKey}T00:00:00`).toISOString()
  const catToIso = new Date(`${catWindow.endKey}T00:00:00`).toISOString()
  const { data: categoryReportData, loading: categoryLoading } = useApiQuery<ApiAccountReport>(
    () => adminApi
      .accountReport<ApiAccountReport>(tenantId, 6, catFromIso, catToIso, packageCategory || undefined, packageSubCategory || undefined)
      .catch(() => ({}) as ApiAccountReport),
    [tenantId, catFromIso, catToIso, packageCategory, packageSubCategory],
    { initialData: null },
  )

  // --- Hizmet Raporu: paket raporundan TAMAMEN AYRI (kendi dönemi + kendi kategorisi) ---------
  const svcWindow = periodWindow(servicePeriod, dayStart)
  const svcFromIso = new Date(`${svcWindow.startKey}T00:00:00`).toISOString()
  const svcToIso = new Date(`${svcWindow.endKey}T00:00:00`).toISOString()
  const { data: serviceReportData, loading: serviceReportLoading } = useApiQuery<ApiServiceReport>(
    () => adminApi
      .serviceReport<ApiServiceReport>(tenantId, svcFromIso, svcToIso, serviceCategory || undefined, serviceSubCategory || undefined)
      .catch(() => ({}) as ApiServiceReport),
    [tenantId, svcFromIso, svcToIso, serviceCategory, serviceSubCategory],
    { initialData: null },
  )
  const serviceReport = {
    serviceSalesCount: Number(serviceReportData?.serviceSalesCount ?? 0),
    activeSoldServiceCount: Number(serviceReportData?.activeSoldServiceCount ?? 0),
    cancelledSoldServiceCount: Number(serviceReportData?.cancelledSoldServiceCount ?? 0),
    sessionsTotal: Number(serviceReportData?.sessionsTotal ?? 0),
    sessionsUsed: Number(serviceReportData?.sessionsUsed ?? 0),
    sessionsRemaining: Number(serviceReportData?.sessionsRemaining ?? 0),
    revenue: Number(serviceReportData?.revenue ?? 0),
  }
  // Hizmet kategorileri: hizmetlerin kendi kategori/alt kategorileri (paketinkiyle karışmaz).
  const serviceCategoryOptions = useMemo<CategoryOption[]>(() => {
    const map = new Map<string, { subs: Set<string>; count: number }>()
    for (const s of apiItems(data?.servicesResult)) {
      const cat = (s.category || '').trim()
      if (!cat) continue
      if (!map.has(cat)) map.set(cat, { subs: new Set(), count: 0 })
      const entry = map.get(cat)!
      entry.count += 1
      const sub = (s.subCategory || '').trim()
      if (sub) entry.subs.add(sub)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
      .map(([name, v]) => ({ name, count: v.count, subs: [...v.subs].sort((a, b) => a.localeCompare(b, 'tr')) }))
  }, [data])

  // Kategori süzgecinin seçenekleri: paketlerin kendi kategori/alt kategorileri.
  // Alt kategori kutusu yalnızca seçili kategorinin alt kategorisi VARSA görünür.
  const packageCategoryOptions = useMemo<CategoryOption[]>(() => {
    const map = new Map<string, { subs: Set<string>; count: number }>()
    for (const p of apiItems(data?.packagesResult)) {
      const cat = (p.category || '').trim()
      if (!cat) continue
      if (!map.has(cat)) map.set(cat, { subs: new Set(), count: 0 })
      const entry = map.get(cat)!
      entry.count += 1
      const sub = (p.subCategory || '').trim()
      if (sub) entry.subs.add(sub)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
      .map(([name, v]) => ({ name, count: v.count, subs: [...v.subs].sort((a, b) => a.localeCompare(b, 'tr')) }))
  }, [data])

  const customerStats = data?.customersStats || {}
  // Gün → yeni müşteri sayısı (sunucudan gruplu gelir; liste çekilmez).
  const newCustomersByDay = useMemo(() => {
    const map: Record<string, number> = {}
    for (const row of data?.customersStats?.newByDay || []) {
      if (row.date) map[row.date] = row.count || 0
    }
    return map
  }, [data])
  const staff = apiItems(data?.staffResult).map((s, i) => normalizeStaff(s, i))
  const services = apiItems(data?.servicesResult).map((s, i) => normalizeService(s, i))
  const products = apiItems(data?.productsResult).map((p, i) => normalizeProduct(p, i))
  const lookups: AppointmentLookups = {
    staff: Object.fromEntries(apiItems(data?.staffResult).map((s) => [s.id ?? '', s])),
    services: Object.fromEntries(apiItems(data?.servicesResult).map((s) => [s.id ?? '', s])),
  }
  const appointments = apiItems(data?.appointmentsResult).map((a, i) => normalizeAppointment(a, lookups, i))
  const appointmentsTotal = data?.appointmentsResult?.total ?? appointments.length
  const completed = appointments.filter((r) => r.status === 'tamamlandi').length
  const waiting = appointments.filter((r) => r.status === 'bekliyor').length
  const activeStaff = staff.filter((p) => p.active).length
  const cashSummary = normalizeCashFlowSummary(data?.cashSummary)
  const cashEntries = (data?.cashEntries ?? []).map((e, i) => normalizeCashFlowEntry(e, i)).slice(0, 6)
  const periodCashEntries = (data?.periodCashEntries ?? []).map((e, i) => normalizeCashFlowEntry(e, i))
  const todayRevenue = cashSummary.totalIncome || appointments.reduce((sum, r) => sum + (r.status === 'tamamlandi' ? Number(r.price || 0) : 0), 0)
  const pendingItems = apiItems(data?.pendingResult).map((p, i) => normalizePendingOperation(p, i))
  const pendingCount = data?.pendingResult?.total ?? pendingItems.length
  const criticalProducts = products.filter((product) => product.status !== 'sufficient')

  // [startKey, endKey) penceresindeki tahsilat (income) toplamı.
  const sumIncomeBetween = (startKey: string, endKey: string): number =>
    periodCashEntries
      .filter((entry: CashFlowEntry) => entry.type === 'income' && entry.date >= startKey && entry.date < endKey)
      .reduce((sum, entry) => sum + entry.amount, 0)

  // [startKey, endKey) içinde kaydı oluşturulan (yeni) müşteri sayısı — sunucu gruplu veriden.
  const countNewCustomersBetween = (startKey: string, endKey: string): number =>
    Object.entries(newCustomersByDay)
      .filter(([key]) => key >= startKey && key < endKey)
      .reduce((sum, [, count]) => sum + count, 0)

  const revenueWindow = periodWindow(revenuePeriod, dayStart)
  const customerWindow = periodWindow(customerPeriod, dayStart)
  const revenueValue =
    revenuePeriod === 'daily'
      ? sumIncomeBetween(revenueWindow.startKey, revenueWindow.endKey) || todayRevenue
      : sumIncomeBetween(revenueWindow.startKey, revenueWindow.endKey)
  const newCustomersValue = countNewCustomersBetween(customerWindow.startKey, customerWindow.endKey)

  // Kart içi mini grafikler: seçilen döneme göre GERÇEK trend serisi (son bölüm = karttaki büyük rakam).
  const revenueSparkline = buildPeriodBuckets(revenuePeriod, dayStart).map((bucket) => sumIncomeBetween(bucket.startKey, bucket.endKey))
  const customerSparkline = buildPeriodBuckets(customerPeriod, dayStart).map((bucket) => countNewCustomersBetween(bucket.startKey, bucket.endKey))

  // Bugünkü randevuların gün içi saat dilimlerine dağılımı (mini grafik).
  const appointmentSparkline = (() => {
    const slots: [number, number][] = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 22]]
    return slots.map(([from, to]) =>
      appointments.filter((appointment) => {
        const hour = parseInt((appointment.time || '').slice(0, 2), 10)
        return !Number.isNaN(hour) && hour >= from && hour < to
      }).length,
    )
  })()

  const weeklyRevenue = useMemo<WeeklyRevenuePoint[]>(() => {
    const formatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' })
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + index)
      // normalizeCashFlowEntry.date YEREL bileşenlerle üretiliyor; eşleşme için aynı formatı kullan
      // (toISOString UTC'ye çevirip günü kaydırıyordu → grafik boş kalıyordu).
      const key = dateKeyOf(date)
      const value = periodCashEntries
        .filter((entry: CashFlowEntry) => entry.date === key && entry.type === 'income')
        .reduce((sum, entry) => sum + entry.amount, 0)
      return { label: formatter.format(date).replace('.', ''), value }
    })
  }, [weekStartIso, periodCashEntries])

  // Grafik filtresi: Hafta (7 gün) / Ay (haftalık kova) / Yıl (12 ay).
  const chartData = useMemo<WeeklyRevenuePoint[]>(() => {
    if (chartRange === 'yearly') {
      const year = dayStart.getFullYear()
      return MONTHS_TR_SHORT.map((label, monthIndex) => {
        const startKey = dateKeyOf(new Date(year, monthIndex, 1))
        const endKey = dateKeyOf(new Date(year, monthIndex + 1, 1))
        const value = periodCashEntries
          .filter((entry: CashFlowEntry) => entry.type === 'income' && entry.date >= startKey && entry.date < endKey)
          .reduce((sum, entry) => sum + entry.amount, 0)
        return { label, value }
      })
    }
    if (chartRange === 'monthly') {
      const year = dayStart.getFullYear()
      const month = dayStart.getMonth()
      const daysInMonth = new Date(year, month + 1, 0).getDate()
      const buckets: WeeklyRevenuePoint[] = []
      for (let day = 1; day <= daysInMonth; day += 7) {
        const last = Math.min(day + 6, daysInMonth)
        const startKey = dateKeyOf(new Date(year, month, day))
        const endKey = dateKeyOf(new Date(year, month, last + 1))
        const value = periodCashEntries
          .filter((entry: CashFlowEntry) => entry.type === 'income' && entry.date >= startKey && entry.date < endKey)
          .reduce((sum, entry) => sum + entry.amount, 0)
        buckets.push({ label: `${day}-${last}`, value })
      }
      return buckets
    }
    return weeklyRevenue
  }, [chartRange, periodCashEntries, weeklyRevenue, dayStartIso])

  const chartGranularity = chartRange === 'yearly' ? 'ay' : chartRange === 'monthly' ? 'hafta' : 'gün'
  const chartPeriodLabel = chartRange === 'yearly' ? 'Bu yıl' : chartRange === 'monthly' ? 'Bu ay' : 'Bu hafta'

  const performanceRows = useMemo(() => {
    return staff.slice(0, 3).map((person, index) => {
      const rows = appointments.filter((appointment) => appointment.personel === person.name)
      const revenue = rows.reduce((sum, appointment) => sum + Number(appointment.price || 0), 0)
      const fallbackScore = Math.max(4.6, 5 - index * 0.1)
      const score = person.performanceScore ? Math.min(5, Math.max(0, person.performanceScore / 20)) : fallbackScore
      return { person, count: rows.length || person.sessionsThisMonth || 0, revenue, score }
    })
  }, [appointments, staff])

  const report = normalizeAccountReport(data?.reportResult)
  const reportMonths = report.monthlyInstallments
  // Dönem filtreli paket raporu (KPI kartları); henüz yüklenmediyse genel rapora düş.
  const packageReport = normalizeAccountReport(packageReportData ?? data?.reportResult)
  const categoryReport = normalizeAccountReport(categoryReportData ?? packageReportData ?? data?.reportResult)

  // Bekleyen tahsilat: toplam alacağın (tahsil + kalan) ne kadarı hâlâ borç olarak bekliyor (gauge kartı).
  const collectionBase = report.totalCollected + report.totalReceivable
  const debtRate = collectionBase > 0 ? Math.round((report.totalReceivable / collectionBase) * 100) : 0

  const passiveCustomers = data?.passiveResult?.items ?? []
  const passiveThresholdDays = data?.passiveResult?.thresholdDays ?? 0
  const birthdayThisMonth = customerStats.birthdayThisMonth ?? 0
  const kvkkPending = customerStats.kvkkPending ?? 0
  const blacklisted = customerStats.blacklisted ?? 0

  const followUps = [
    {
      title: passiveThresholdDays > 0 ? `${passiveThresholdDays}+ gündür gelmeyen müşteriler` : 'Uzun süredir gelmeyen müşteriler',
      count: passiveCustomers.length,
      icon: Clock,
      tone: 'violet' as const,
      href: '/admin/musteriler?scope=passive',
    },
    {
      title: 'Bu ay doğum günü olan müşteriler',
      count: birthdayThisMonth,
      icon: Sparkles,
      tone: 'rose' as const,
      href: '/admin/musteriler',
    },
    {
      title: 'KVKK onaysız müşteriler',
      count: kvkkPending,
      icon: ShieldCheck,
      tone: 'gold' as const,
      href: '/admin/musteriler?scope=kvkk-pending',
    },
    {
      title: 'Kara listedeki müşteriler',
      count: blacklisted,
      icon: FileWarning,
      tone: 'peach' as const,
      href: '/admin/musteriler?scope=blacklist',
    },
  ]

  return (
    <>
      <Topbar
        compact
        title="Dashboard"
        breadcrumbs={['Admin', 'Dashboard']}
        pendingCount={pendingCount}
        notifications={pendingItems.slice(0, 4).map((item) => ({
          title: item.title,
          description: `${item.requestedByName} · ${item.requestedAtFormatted}`,
          meta: 'Onay',
          href: '/admin/onaylar',
        }))}
      />

      <div className="relative space-y-5 px-4 pb-8 pt-4 sm:px-6 lg:px-6 xl:px-7">
        {/* Karşılama bandı — günün nabzı ilk ekranda okunur. */}
        <DashboardHero
          userName={user?.fullName || user?.email}
          institutionName={selectedInstitution?.name}
          branchName={selectedBranch?.name}
          appointmentsToday={appointmentsTotal}
          completedToday={completed}
          waitingToday={waiting}
          revenueToday={todayRevenue}
          pendingApprovals={pendingCount}
          activeStaff={activeStaff}
          totalCustomers={customerStats.total ?? 0}
        />

        <div data-guide="dash-abonelik"><SubscriptionCountdown tenantId={tenantId} /></div>

        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && !appointments.length && !(customerStats.total ?? 0) && !staff.length && !services.length}
          emptyMessage="Backend bağlantısı çalıştı fakat bu tenant için henüz kayıt yok."
        />

        <div data-guide="dash-donem" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#efe1e7] bg-white/85 px-4 py-3 shadow-[0_14px_40px_-32px_rgba(120,71,88,0.5)]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#f8d8e2] bg-[#fff2f6] text-[#c85776]">
              <Calendar className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <div>
              <div className="text-[12.5px] font-semibold leading-4 text-[#2b1e29]">Randevu Dönemi</div>
              <div className="text-[11px] text-[#8a7480]">{apptRange.label}</div>
            </div>
          </div>
          <PeriodTabs value={globalPeriod} onChange={setGlobalPeriod} options={FULL_PERIOD_OPTIONS} />
        </div>

        <motion.div variants={listContainer} initial="hidden" animate="visible" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Calendar}
            title={globalPeriod === 'daily' ? 'Bugünkü Randevular' : 'Randevular'}
            value={<AnimatedNumber value={appointmentsTotal} />}
            detail={<><b className="font-semibold text-[#2f2430]">{completed}</b> Tamamlandı</>}
            subDetail={<>{waiting} Beklemede</>}
            series={appointmentSparkline}
            tone="rose"
          />
          <MetricCard
            icon={Wallet}
            title="Genel Ciro"
            value={<AnimatedNumber value={revenueValue} format={(n) => formatTL(Math.round(n))} />}
            detail={revenueWindow.label}
            series={revenueSparkline}
            control={<PeriodTabs value={revenuePeriod} onChange={setRevenuePeriod} options={FULL_PERIOD_OPTIONS} />}
            tone="gold"
          />
          <MetricCard
            icon={ShieldCheck}
            title="Yeni Müşteriler"
            value={<AnimatedNumber value={newCustomersValue} />}
            detail={customerWindow.label}
            series={customerSparkline}
            control={<PeriodTabs value={customerPeriod} onChange={setCustomerPeriod} options={FULL_PERIOD_OPTIONS} />}
            tone="violet"
          />
          <MetricCard
            icon={CreditCard}
            title="Bekleyen Tahsilat"
            value={`%${debtRate}`}
            detail={<>Kalan borç {formatTL(Math.round(report.totalReceivable))}</>}
            subDetail={<>{formatTL(Math.round(report.totalCollected))} tahsil edildi</>}
            visual={<DonutGauge value={debtRate} />}
            control={
              <span className="inline-flex shrink-0 items-center rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2 py-[3px] text-[10px] font-semibold text-[#9a8590]">
                Cari hesaplar
              </span>
            }
            tone="mint"
          />
        </motion.div>

        {/* min-w-0: xl altında ızgara tek kolona düşer ve track içeriğe göre boyutlanır. İçeride
            auto-fit kullanan kart ızgaraları buna yaslanıp kapsayıcıyı taşırıyordu (mobilde sağ
            taraf kırpılıyordu). min-w-0 track'in daralmasına izin verir. */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.92fr)]">
          <div className="min-w-0 space-y-5">
            <SectionCard
              title={globalPeriod === 'daily' ? 'Bugünkü Randevu Akışı' : 'Randevu Akışı'}
              action={
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1.5 rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2.5 py-1 text-[10px] font-semibold text-[#9a8590] sm:inline-flex">
                    <Calendar className="h-3 w-3" strokeWidth={1.8} />
                    {apptRange.label}
                  </span>
                  <Link href="/admin/randevular" className="hidden items-center gap-1 text-[12px] font-semibold text-[#d66d8a] hover:text-[#a34a62] sm:flex">
                    Tüm randevuları görüntüle <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              }
            >
              <motion.div variants={listContainer} initial="hidden" animate="visible" className="px-4 pb-4">
                {/* Zaman çizelgesi: solda saat, ortada müşteri+işlem, sağda uzman ve durum. */}
                <div className="relative space-y-2">
                  {appointments.length > 0 && (
                    <span aria-hidden className="pointer-events-none absolute bottom-3 left-[54px] top-3 w-px bg-gradient-to-b from-[#f7dbe5] via-[#f3dde5] to-transparent" />
                  )}
                  {appointments.slice(0, 5).map((appointment) => {
                    const badge = statusBadge[appointment.status] || statusBadge.bekliyor
                    return (
                      <motion.div
                        key={appointment.id}
                        variants={listRow}
                        whileHover={{ x: 3 }}
                        className="group relative flex items-center gap-3 rounded-[18px] border border-[#f3dde5] bg-white/90 px-3 py-2.5 transition-colors hover:border-[#efbfd0] hover:bg-[#fffafc]"
                      >
                        {/* Saat rozeti */}
                        <span className="relative z-[1] grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#fff1f6] to-[#ffe0eb] text-[12px] font-bold tabular-nums text-[#a63e5f] ring-1 ring-white">
                          {appointment.time || '—'}
                        </span>

                        {/* Müşteri + işlem */}
                        <span className="flex min-w-0 flex-1 items-center gap-2.5">
                          <AvatarBubble name={appointment.musteri} size="md" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-[#2b1e29]">{appointment.musteri}</span>
                            <span className="block truncate text-[11.5px] text-[#77616b]">{appointment.islem}</span>
                          </span>
                        </span>

                        {/* Uzman */}
                        <span className="hidden min-w-0 items-center gap-2 sm:flex">
                          <AvatarBubble name={appointment.personel} size="sm" />
                          <span className="truncate text-[11.5px] font-medium text-[#5d4a56]">{appointment.personel}</span>
                        </span>

                        {/* Durum */}
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>

                        <Link
                          href="/admin/randevular"
                          aria-label="Randevulara git"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#c9b3bd] opacity-0 transition-opacity hover:bg-[#fff1f6] hover:text-[#a63e5f] group-hover:opacity-100"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </motion.div>
                    )
                  })}
                  {!appointments.length && (
                    <div className="rounded-[18px] border border-dashed border-[#f3dde5] bg-[#fffafc] px-4 py-10 text-center">
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]">
                        <Calendar className="h-6 w-6" strokeWidth={1.6} />
                      </span>
                      <p className="mt-2 text-[12.5px] text-[#77616b]">
                        {globalPeriod === 'daily' ? 'Bugün için randevu kaydı yok.' : 'Seçili dönemde randevu kaydı yok.'}
                      </p>
                      <Link
                        href="/admin/randevular?action=new"
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)]"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" /> Randevu oluştur
                      </Link>
                    </div>
                  )}
                </div>
                {appointments.length > 0 && (
                  <Link href="/admin/randevular" className="mx-auto mt-4 flex w-max items-center gap-1 text-[12px] font-semibold text-[#d66d8a] hover:text-[#a34a62]">
                    Tüm randevuları görüntüle <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </motion.div>
            </SectionCard>

            <SectionCard
              title="Paket Raporu"
              action={
                <div className="flex items-center gap-2">
                  <PeriodTabs value={packagePeriod} onChange={setPackagePeriod} options={PACKAGE_PERIOD_OPTIONS} />
                  <Link href="/admin/on-muhasebe" className="hidden items-center gap-1 text-[12px] font-semibold text-[#d66d8a] hover:text-[#a34a62] sm:inline-flex">
                    Ön muhasebe <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              }
            >
              <div className="space-y-4 px-5 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2.5 py-1 text-[10px] font-semibold text-[#9a8590]">
                    <Calendar className="h-3 w-3" strokeWidth={1.8} />
                    {packageWindowLabel} · {selectedBranch?.name || 'Tüm şubeler'}
                    {packageCategory && ` · ${packageCategory}${packageSubCategory ? ` / ${packageSubCategory}` : ''}`}
                  </span>
                  {/* Kategori süzgeci: dönem çipiyle BİRLİKTE çalışır, aşağıdaki kartları daraltır. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryFilter
                      icon={Boxes}
                      options={packageCategoryOptions}
                      value={packageCategory}
                      subValue={packageSubCategory}
                      onChange={setPackageCategory}
                      onSubChange={setPackageSubCategory}
                    />
                    <span className="text-[10px] text-[#b09ca5]">Dönemde satılan paketler</span>
                  </div>
                </div>
                {/* .kpi-auto-grid: kolon sayısı kapsayıcıya göre belirlenir (bkz. globals.css). */}
                <div className={`kpi-auto-grid grid gap-3 transition-opacity ${packageLoading ? 'opacity-60' : 'opacity-100'}`}>
                  {/* Kartlar KATALOĞU değil SATIŞI sayar; hepsi dönem + kategori süzgecine uyar. */}
                  <ReportKpi icon={Boxes} tone="violet" label="Toplam Paket" value={String(packageReport.packageSalesCount)} hint={packageReport.customersWithPackages > 0 ? `${packageReport.customersWithPackages} müşteriye` : 'Dönem paket adedi'} />
                  <ReportKpi
                    icon={Package}
                    tone="violet"
                    label="Aktif Paket"
                    value={String(packageReport.activeSoldPackageCount)}
                    hint={
                      packageReport.packageSalesCount > 0
                        ? `${Math.max(0, packageReport.packageSalesCount - packageReport.activeSoldPackageCount)} tamamlandı`
                        : 'Seansı devam eden'
                    }
                  />
                  <ReportKpi
                    icon={XCircle}
                    tone="peach"
                    label="İptal Edilen Paket"
                    value={String(packageReport.cancelledSoldPackageCount)}
                    hint="Satılıp iptal edilen"
                    danger={packageReport.cancelledSoldPackageCount > 0}
                  />
                  <ReportKpi icon={Activity} tone="mint" label="Kalan Seans" value={String(packageReport.sessionsRemaining)} hint={`${packageReport.sessionsUsed}/${packageReport.sessionsTotal} kullanıldı`} />
                  <ReportKpi icon={Wallet} tone="rose" label="Toplam Kalan Taksit" value={formatTL(Math.round(packageReport.totalReceivable))} hint="Kalan taksit miktarı" />
                  <ReportKpi icon={CheckCircle2} tone="gold" label="Toplam Tahsil Edilen" value={formatTL(Math.round(packageReport.totalCollected))} hint="Toplanan taksit" />
                  <ReportKpi icon={FileWarning} tone="peach" label="Vadesi Geçmiş" value={formatTL(Math.round(packageReport.overdueAmount))} hint="Gecikmiş tahsilat" danger={packageReport.overdueAmount > 0} />
                </div>

                <InstallmentCalendar months={reportMonths} period={packagePeriod} />

                {/* HİZMET RAPORU — paket raporundan TAMAMEN AYRI blok. Kendi dönemi ve kendi
                    (hizmet) kategorisi vardır; yukarıdaki paket seçimlerinden etkilenmez. */}
                <div className="rounded-[16px] border border-[#efe1e7] bg-[#fffafc]/60 p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-[9px] border border-[#d6ece4] bg-[#f1fbf7] text-[#39846f]">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-[#4a3a44]">Hizmet Raporu</div>
                        <div className="text-[10px] text-[#705a66]">
                          {svcWindow.label}
                          {serviceCategory && ` · ${serviceCategory}${serviceSubCategory ? ` / ${serviceSubCategory}` : ''}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CategoryFilter
                        icon={Tag}
                        options={serviceCategoryOptions}
                        value={serviceCategory}
                        subValue={serviceSubCategory}
                        onChange={setServiceCategory}
                        onSubChange={setServiceSubCategory}
                      />
                      <PeriodTabs value={servicePeriod} onChange={setServicePeriod} options={FULL_PERIOD_OPTIONS} />
                    </div>
                  </div>
                  {/* Paket ızgarasıyla aynı kural (bkz. globals.css .kpi-auto-grid). */}
                  <div className={`kpi-auto-grid grid gap-3 transition-opacity ${serviceReportLoading ? 'opacity-60' : 'opacity-100'}`}>
                    {/* Paket bloğuyla aynı mantık: kartlar SATIŞI sayar, dönem + kategoriye uyar. */}
                    <ReportKpi icon={Tag} tone="mint" label="Toplam Hizmet" value={String(serviceReport.serviceSalesCount)} hint="Dönem hizmet adedi" />
                    <ReportKpi
                      icon={Activity}
                      tone="mint"
                      label="Aktif Hizmet"
                      value={String(serviceReport.activeSoldServiceCount)}
                      hint={
                        serviceReport.serviceSalesCount > 0
                          ? `${Math.max(0, serviceReport.serviceSalesCount - serviceReport.activeSoldServiceCount)} tamamlandı`
                          : 'Seansı devam eden'
                      }
                    />
                    <ReportKpi
                      icon={XCircle}
                      tone="peach"
                      label="İptal Edilen Hizmet"
                      value={String(serviceReport.cancelledSoldServiceCount)}
                      hint="Satılıp iptal edilen"
                      danger={serviceReport.cancelledSoldServiceCount > 0}
                    />
                    <ReportKpi icon={Sparkles} tone="violet" label="Kalan Seans" value={String(serviceReport.sessionsRemaining)} hint={`${serviceReport.sessionsUsed}/${serviceReport.sessionsTotal} kullanıldı`} />
                    <ReportKpi icon={Wallet} tone="gold" label="Hizmet Cirosu" value={formatTL(Math.round(serviceReport.revenue))} hint="Dönemde satılan hizmet" />
                  </div>
                </div>

                {/* Kategori → hizmet ve müşteri bazlı taksit/ödeme/seans kırılımı (dönem filtresine uyar). */}
                <PackageReportBreakdown
                  categories={categoryReport.categories}
                  customers={packageReport.customers}
                  loading={packageLoading || categoryLoading}
                  periodLabel={catWindow.label}
                  periodTabs={<PeriodTabs value={categoryPeriod} onChange={setCategoryPeriod} options={FULL_PERIOD_OPTIONS} />}
                />
              </div>
            </SectionCard>

            <div className="grid gap-5 lg:grid-cols-[1.32fr_0.88fr]">
              <SectionCard
                title="Gelir Analizi"
                action={<PeriodTabs value={chartRange} onChange={setChartRange} options={CHART_PERIOD_OPTIONS} />}
              >
                <div data-guide="dash-gelir"><RevenueChart data={chartData} granularity={chartGranularity} periodLabel={chartPeriodLabel} /></div>
              </SectionCard>

              <SectionCard
                title="Takip Edilmesi Gereken Müşteriler"
                action={
                  <Link href="/admin/musteriler" className="text-[12px] font-semibold text-[#d66d8a] hover:text-[#a34a62]">
                    Tümü <ChevronRight className="inline h-3.5 w-3.5" />
                  </Link>
                }
              >
                <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2">
                  {followUps.map((item, idx) => {
                    const Icon = item.icon
                    const urgent = item.count > 0
                    return (
                      <motion.div
                        key={item.title}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                        whileHover={{ y: -2 }}
                      >
                        <Link
                          href={item.href}
                          className={`group relative flex h-full items-center gap-3 overflow-hidden rounded-[18px] border p-3 transition-shadow hover:shadow-[0_20px_38px_-28px_rgba(150,78,104,0.55)] ${
                            urgent ? toneClasses[item.tone] : 'border-[#f3dde5] bg-white/90 text-[#8a7480]'
                          }`}
                        >
                          <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/45 blur-xl transition-transform duration-500 group-hover:scale-125" />
                          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-white/85 shadow-[0_10px_22px_-16px_rgba(120,71,88,0.9)]">
                            <Icon className="h-[18px] w-[18px]" strokeWidth={1.55} />
                          </span>
                          <span className="relative min-w-0 flex-1">
                            <span className="block text-[22px] font-semibold leading-none tabular-nums">{item.count}</span>
                            <span className="mt-1 block text-[11px] font-medium leading-snug opacity-90">{item.title}</span>
                          </span>
                          <ArrowUpRight className="relative h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="space-y-5">
            <SectionCard title="Hızlı İşlemler">
              <div className="grid grid-cols-2 gap-4 px-5 pb-5 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                {quickActions.map((action, idx) => {
                  const Icon = action.icon
                  return (
                    <motion.div
                      key={action.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={{ y: -3 }}
                    >
                      <Link
                        href={action.href}
                        className={`${toneClasses[action.tone]} group relative flex min-h-[96px] flex-col justify-between overflow-hidden rounded-[18px] border p-3 transition-shadow hover:shadow-[0_20px_38px_-26px_rgba(150,78,104,0.6)]`}
                      >
                        <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/45 blur-xl transition-transform duration-500 group-hover:scale-125" />
                        <span className="relative grid h-10 w-10 place-items-center rounded-[13px] bg-white/80 shadow-[0_10px_22px_-16px_rgba(120,71,88,0.9)] transition-transform duration-300 group-hover:scale-105">
                          <Icon className="h-[19px] w-[19px]" strokeWidth={1.6} />
                        </span>
                        <span className="relative flex items-end justify-between gap-2">
                          <span className="whitespace-pre-line text-[12px] font-semibold leading-4">{action.label}</span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                      </Link>
                    </motion.div>
                  )
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Personel Performansı"
              action={<Star className="h-5 w-5 text-[#d8ad55]" fill="currentColor" strokeWidth={1.3} />}
            >
              <div className="space-y-2 px-4 pb-5">
                {(() => {
                  const topRevenue = Math.max(1, ...performanceRows.map((r) => r.revenue))
                  const medals = ['from-[#f7d774] to-[#d9a441]', 'from-[#e3e3e8] to-[#b9bcc6]', 'from-[#eec59a] to-[#c98b53]']
                  return performanceRows.map((row, idx) => (
                    <motion.div
                      key={row.person.id}
                      variants={listRow}
                      initial="hidden"
                      animate="visible"
                      whileHover={{ x: 3 }}
                      className="group rounded-[18px] border border-[#f3dde5] bg-white/90 px-3 py-2.5 transition-colors hover:border-[#efbfd0] hover:bg-[#fffafc]"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(120,71,88,0.9)] ${
                            idx < 3 ? `bg-gradient-to-br ${medals[idx]}` : 'bg-[#e9d9e0] text-[#7f4057]'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <AvatarBubble name={row.person.name} size="md" photoUrl={row.person.photoUrl || undefined} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[#2b1e29]">{row.person.name}</span>
                          <span className="block text-[11px] text-[#77616b]">{row.count} randevu</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13.5px] font-semibold tabular-nums text-[#a63e5f]">{formatTL(Math.round(row.revenue))}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#fff7e6] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#a3701f]">
                            {row.score.toFixed(1)} <Star className="h-3 w-3" fill="currentColor" strokeWidth={1.2} />
                          </span>
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
                        <motion.span
                          className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(4, Math.round((row.revenue / topRevenue) * 100))}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </motion.div>
                  ))
                })()}
                {!performanceRows.length && (
                  <div className="rounded-[18px] border border-dashed border-[#f3dde5] bg-[#fffafc] py-8 text-center text-[12px] text-[#77616b]">
                    Personel performans verisi bekleniyor.
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Stok Uyarıları"
              action={
                <Link href="/admin/stok" className="text-[12px] font-semibold text-[#d66d8a] hover:text-[#a34a62]">
                  Tümünü görüntüle <ArrowUpRight className="inline h-3.5 w-3.5" />
                </Link>
              }
            >
              <div className="space-y-2 px-4 pb-5">
                {criticalProducts.slice(0, 4).map((product) => {
                  const out = product.status === 'out'
                  return (
                    <Link
                      key={product.id}
                      href="/admin/stok"
                      className={`group flex items-center gap-3 rounded-[18px] border px-3 py-2.5 transition-colors ${
                        out ? 'border-rose-200 bg-rose-50/60 hover:bg-rose-50' : 'border-amber-200/70 bg-amber-50/50 hover:bg-amber-50'
                      }`}
                    >
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-white/85 shadow-[0_10px_22px_-16px_rgba(120,71,88,0.9)] ${stockTone(product)}`}>
                        <FileWarning className="h-[18px] w-[18px]" strokeWidth={1.6} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-[#2b1e29]">{product.name}</span>
                        <span className={`mt-0.5 block text-[11px] font-semibold ${stockTone(product)}`}>
                          {out ? 'Tükendi — sipariş ver' : `${product.currentStock} ${product.unit} kaldı`}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[9.5px] font-bold ${out ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {out ? 'KRİTİK' : 'AZALDI'}
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-[#c9b3bd] opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  )
                })}
                {!criticalProducts.length && (
                  <div className="flex items-center justify-center gap-2 rounded-[18px] border border-dashed border-emerald-200 bg-emerald-50/50 py-6 text-[12px] font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Kritik stok uyarısı yok — her ürün yeterli.
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Salona ve personele gelen müşteri yorumları. Aynı yorumlar herkese açık
                vitrinde de görünür; ORADA müşteri adı maskelidir, burada açıktır. */}
            <CustomerReviewsCard tenantId={tenantId} />
          </div>
        </div>
      </div>
    </>
  )
}
