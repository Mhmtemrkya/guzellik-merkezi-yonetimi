'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import SubscriptionCountdown from '@/components/dashboard/SubscriptionCountdown'
import DashboardHero from '@/components/dashboard/DashboardHero'
import PackageReportBreakdown, { type BreakdownItemSelection } from '@/components/dashboard/PackageReportBreakdown'
import AnchoredPopover from '@/components/dashboard/AnchoredPopover'
import type { PickerItem } from '@/components/dashboard/CatalogPicker'
import { motion, type Variants } from 'framer-motion'
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
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Calendar,
  CalendarRange,
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
  /**
   * Rapor ucu DÜŞTÜ mü. Boş rapor ile başarısız rapor aynı şey değildir: ikisi de boş nesneye
   * indirgenince kullanıcı, var olan cirosunu "henüz kayıt yok" diye görüyordu.
   */
  reportFailed: boolean
  packagesResult: PagedResult<ApiServicePackage>
  /**
   * Personel performansı SUNUCUDAN. "En çok çalışan personel" kutusu eskiden ekrandaki randevu
   * listesinden sayıyordu; o liste `pageSize: 200` ile KIRPIK geliyor ve yoğun bir kurumda
   * dönemin yalnız ilk 200 randevusuna bakıp yanlış personeli birinci ilan ediyordu. Uç düşerse
   * `null` kalır ve kutu tahmin yürütmek yerine durumu söyler.
   */
  staffReport: ApiStaffReport | null
}

/** /api/admin/reports/staff yanıtının kullandığımız kadarı. */
interface ApiStaffReport {
  rows?: Array<{ staffName?: string; completedCount?: number; appointmentCount?: number }>
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

// DURUM renkleri kasıtlı olarak palet dışındadır: tamamlandı/bekliyor/iptal
// evrensel yeşil-sarı-kırmızı okuması taşır, bordo tonlarına çevrilirse durum
// ayrımı kaybolur. Yalnız kontrast yükseltildi (eski -50/-100 tonları soluktu).
const statusBadge: Record<AppointmentStatusKey, StatusBadgeMeta> = {
  tamamlandi: {
    label: 'Tamamlandı',
    icon: CheckCircle2,
    cls: 'border border-emerald-300 bg-emerald-100 text-emerald-800',
  },
  devam: {
    label: 'Devam',
    icon: Activity,
    cls: 'border border-sky-300 bg-sky-100 text-sky-800',
  },
  bekliyor: {
    label: 'Bekliyor',
    icon: Clock,
    cls: 'border border-amber-300 bg-amber-100 text-amber-800',
  },
  iptal: {
    label: 'İptal',
    icon: FileWarning,
    cls: 'border border-rose-300 bg-rose-100 text-rose-800',
  },
  taslak: {
    label: 'Taslak',
    icon: Clock,
    cls: 'border border-dashed border-indigo-300 bg-indigo-100 text-indigo-700',
  },
  islemde: {
    label: 'İşlemde',
    icon: Activity,
    cls: 'border border-violet-300 bg-violet-100 text-violet-800',
  },
}

const quickActions: QuickAction[] = [
  { label: 'Yeni Randevu\nOluştur', href: '/panel/randevular', icon: CalendarPlus, tone: 'rose' },
  { label: 'Müşteri\nEkle', href: '/panel/musteriler', icon: UserPlus, tone: 'peach' },
  { label: 'Paket Satışı\nYap', href: '/panel/paketler', icon: ShoppingBag, tone: 'cream' },
  { label: 'Ödeme\nAl', href: '/panel/on-muhasebe?scope=accounts', icon: CreditCard, tone: 'mint' },
  { label: 'Stok Çıkışı\nYap', href: '/panel/stok', icon: Boxes, tone: 'violet' },
  { label: 'Kampanya\nOluştur', href: '/panel/paketler?scope=packages#kampanyalar', icon: Tag, tone: 'gold' },
]

// ---------------------------------------------------------------------------
// DASHBOARD PALETİ (bkz. globals.css → "Dashboard paleti")
//   #A5556E plum · #F9A1B9 pink · #1E4E8C blue · #8E7882 mauve · #F7F6F6 paper
// Kural: kart YÜZÜ beyaz, kuyu/inset yüzeyler paper, renk doygun aksandan gelir.
// Altı ton bu dört renkten türer (violet = koyu bordo, cream = açık mavi).
// ---------------------------------------------------------------------------

/**
 * Dolu yüzeyli kartlar (hızlı işlem · takip kutuları): kenar · zemin · yazı.
 * Zemin PALETİN KENDİ RENGİDİR — açık tint değil (tint'ler soluk görünüyordu).
 */
const toneClasses: Record<QuickAction['tone'], string> = {
  rose: 'border-[#8C4460] bg-[#A5556E] text-white',
  gold: 'border-[#15694A] bg-[#1E8C60] text-white',
  mint: 'border-[#17406F] bg-[#1E4E8C] text-white',
  violet: 'border-[#74616A] bg-[#8E7882] text-white',
  peach: 'border-[#E4577F] bg-[#F9A1B9] text-[#5A1730]',
  cream: 'border-[#CBC1C6] bg-[#F7F6F6] text-[#3E343A]',
}

/**
 * Kartın başlık bandı — yine paletin DOĞRUDAN rengi; gövde beyaz kalır.
 * `toneOnBand` bandın üstündeki yazı, `toneChip` ikon rozetidir: #F9A1B9 ve
 * #F7F6F6 açık olduğu için onlarda mürekkep koyu olur.
 */
/*
 * Menekşe ve yeşil bandın tonu, üzerindeki KÜÇÜK beyaz metin AA (4,5:1) sağlasın diye bir tık
 * koyudur (#8E7882 → 4,07 ve #1E8C60 → 4,22 eşiğin altındaydı). Metni koyulaştırmak işe yaramaz:
 * bu ara tonlarda koyu metnin oranı daha düşük. Bkz. `PanelKit.toneSurface` — aynı gerekçe.
 */
const toneSurface: Record<QuickAction['tone'], string> = {
  rose: 'bg-[#A5556E]',
  gold: 'bg-[#1D865C]',
  mint: 'bg-[#1E4E8C]',
  violet: 'bg-[#85717A]',
  peach: 'bg-[#F9A1B9]',
  cream: 'bg-[#F7F6F6]',
}

const toneOnBand: Record<QuickAction['tone'], string> = {
  rose: 'text-white',
  gold: 'text-white',
  mint: 'text-white',
  violet: 'text-white',
  peach: 'text-[#5A1730]',
  cream: 'text-[#3E343A]',
}

const toneChip: Record<QuickAction['tone'], string> = {
  rose: 'bg-white/20 text-white',
  gold: 'bg-white/20 text-white',
  mint: 'bg-white/20 text-white',
  violet: 'bg-white/20 text-white',
  peach: 'bg-white/45 text-[#5A1730]',
  cream: 'bg-[#8E7882] text-white',
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

/**
 * "Bekleyen Tahsilat" kartının dönemi. 'all' = tüm zamanlar; kartın kuruluş anlamı budur ve
 * varsayılan odur — dönem seçilince pencere SATIŞ TARİHİNE uygulanır, yani "bu ay yaptığım
 * satışların ne kadarı hâlâ borçta" sorusuna döner (eski satışların borcu kapsam dışı kalır).
 */
type CollectionPeriod = 'all' | RangePeriod

const COLLECTION_PERIOD_OPTIONS: { key: CollectionPeriod; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'daily', label: 'Gün' },
  { key: 'monthly', label: 'Ay' },
  { key: 'yearly', label: 'Yıl' },
]

interface CategoryOption { name: string; subs: string[] }

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
  // Tetikleyici ↔ panel bağı (`aria-controls`) için ortak kimlik; ekran okuyucu ikisini eşler.
  const panelId = `${useId()}-kategori`

  // Dışarı tıklama + ESC artık AnchoredPopover'ın işi: panel <body>'ye portal'landığı için
  // "kutumun dışına tıklandı mı" ölçütü panelin İÇİNE tıklamayı da dışarı sayardı.

  const active = Boolean(value)
  const subs = options.find((o) => o.name === value)?.subs ?? []

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[11px] font-semibold leading-none transition-colors ${
          active
            ? 'border-[#8C4460] bg-[#A5556E] text-white shadow-sm'
            : 'border-[#E4DEE0] bg-white text-[#5A4B53] hover:border-[#BE7690] hover:bg-[#FBF0F3]'
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{active ? value : allLabel}</span>
        {active && subValue && <span className="shrink-0 rounded-full bg-white/25 px-1.5 py-[1px] text-[10px]">{subValue}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>

      {/* Panel karta GÖMÜLÜ DEĞİL: kart kabuğu `overflow-hidden` taşıdığı için buradaki
          `absolute` bir menü kartın alt kenarında kırpılıyordu (z-index bunu aşamaz). */}
      <AnchoredPopover open={open} anchorRef={boxRef} onClose={() => setOpen(false)} width={240} align="right" id={panelId} label="Kategori filtresi">
        <div>
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => { onChange(''); onSubChange(''); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  !active ? 'bg-[#F6DFE6] font-semibold text-[#7A3450]' : 'text-[#3E343A] hover:bg-[#F7F6F6]'
                }`}
              >
                <span>{allLabel}</span>
              </button>
              {options.length === 0 && (
                <div className="px-2.5 py-3 text-center text-[11px] text-[#74616A]">Kategori tanımlı değil.</div>
              )}
              {options.map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => { onChange(o.name); onSubChange(''); if (o.subs.length === 0) setOpen(false) }}
                  className={`flex w-full items-center justify-between gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    value === o.name ? 'bg-[#F6DFE6] font-semibold text-[#7A3450]' : 'text-[#3E343A] hover:bg-[#F7F6F6]'
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                </button>
              ))}
            </div>

            {/* Alt kategoriler yalnızca seçili kategorinin altı varsa görünür. */}
            {subs.length > 0 && (
              <div className="border-t border-[#EFEAEC] bg-[#F7F6F6] p-2">
                <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#74616A]">Alt kategori</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => { onSubChange(''); setOpen(false) }}
                    className={`rounded-full border px-2 py-[3px] text-[10px] font-medium transition-colors ${
                      !subValue ? 'border-[#BE7690] bg-[#F6DFE6] text-[#7A3450]' : 'border-[#E4DEE0] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]'
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
                        subValue === s ? 'border-[#BE7690] bg-[#F6DFE6] text-[#7A3450]' : 'border-[#E4DEE0] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
        </div>
      </AnchoredPopover>
    </div>
  )
}

/**
 * Dönem çipleri. Anahtar tipi GENELDİR: çoğu yerde `RangePeriod`, "Bekleyen Tahsilat" kartında
 * ise ona ek olarak 'all' (Tümü) taşınır — o kart tarih penceresi olmadan da anlamlıdır.
 */
function PeriodTabs<T extends string = RangePeriod>({
  value,
  onChange,
  options,
  dimmed = false,
}: {
  value: T
  onChange: (value: T) => void
  options: { key: T; label: string }[]
  /** Özel tarih aralığı devredeyken seçili çip vurgusu kalkar — hangisinin geçerli olduğu belli olsun. */
  dimmed?: boolean
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none transition-colors ${
            value === option.key && !dimmed
              ? 'bg-[#A5556E] text-white shadow-sm'
              : 'text-[#74616A] hover:text-[#2A2027]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Kullanıcının seçtiği serbest tarih aralığı (yerel gün anahtarları, ikisi de DAHİL). */
interface CustomRange { from: string; to: string }

/**
 * ÖZEL TARİH ARALIĞI — dönem çiplerinin (Günlük/Aylık/Yıllık) yanında durur ve seçilince
 * onların yerine geçer.
 *
 * <p>Neden ayrı bir durum, neden `RangePeriod`'a 'custom' eklenmedi: o tip yalnız rapor
 * penceresini değil mini grafik kovalarını (buildPeriodBuckets) ve taksit takvimini de
 * sürüklüyor. Oralara anlamı olmayan bir değer sızdırmak, bugün görünmeyen yerlerde sessizce
 * yanlış kova üretirdi. Serbest aralık YALNIZ rapor sorgusunu etkiler.</p>
 */
function DateRangeFilter({
  value,
  onChange,
}: {
  value: CustomRange | null
  onChange: (value: CustomRange | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(value?.from ?? '')
  const [to, setTo] = useState(value?.to ?? '')
  const boxRef = useRef<HTMLDivElement>(null)
  const panelId = `${useId()}-tarih`

  const apply = () => {
    if (!from || !to) return
    // Ters seçim kullanıcı hatasıdır, hata mesajı değil düzeltme hak eder.
    const [a, b] = from <= to ? [from, to] : [to, from]
    onChange({ from: a, to: b })
    setFrom(a)
    setTo(b)
    setOpen(false)
  }

  const clear = () => {
    onChange(null)
    setFrom('')
    setTo('')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[4px] text-[10px] font-semibold leading-none transition-colors ${
          value
            ? 'border-[#8C4460] bg-[#A5556E] text-white'
            : 'border-[#E4DEE0] bg-[#F7F6F6] text-[#5A4B53] hover:text-[#2A2027]'
        }`}
      >
        <CalendarRange className="h-3 w-3" strokeWidth={1.9} />
        {value ? `${trDay(value.from)} – ${trDay(value.to)}` : 'Özel tarih'}
      </button>

      {/* Panel karta GÖMÜLÜ DEĞİL: metrik ve rapor kartlarının kabuğu `overflow-hidden` taşıyor,
          içeride açılan `absolute` bir panel kartın kenarında kırpılıyordu (z-index aşamaz). */}
      <AnchoredPopover open={open} anchorRef={boxRef} onClose={() => setOpen(false)} width={248} align="right" id={panelId} label="Özel tarih aralığı">
          <div className="p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#74616A]">Tarih aralığı</div>
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-[#5A4B53]">Başlangıç</span>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-[#E4DEE0] bg-[#F7F6F6] px-2 py-1.5 text-[11px] text-[#3E343A] outline-none focus:border-[#A5556E]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-[#5A4B53]">Bitiş</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-[#E4DEE0] bg-[#F7F6F6] px-2 py-1.5 text-[11px] text-[#3E343A] outline-none focus:border-[#A5556E]"
                />
              </label>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={apply}
                disabled={!from || !to}
                className="flex-1 rounded-lg bg-[#A5556E] px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#8C4460] disabled:opacity-45"
              >
                Uygula
              </button>
              {value && (
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-lg border border-[#E4DEE0] px-2 py-1.5 text-[11px] font-semibold text-[#5A4B53] hover:text-[#7A3450]"
                >
                  Temizle
                </button>
              )}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[#74616A]">Seçilen iki tarih de dahildir.</p>
          </div>
      </AnchoredPopover>
    </div>
  )
}

/** 2026-08-07 → "7 Ağu" (çip etiketinde yer kazanır). */
function trDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return key
  return `${d} ${MONTHS_TR_SHORT[m - 1]}`
}

/**
 * Serbest aralığın rapor penceresi. Bitiş günü DAHİL olmalı: kullanıcı "1–7 Ağustos" derken
 * 7 Ağustos'u da kastediyor, oysa uçlar [başlangıç, bitiş) yarı açık aralık bekliyor → +1 gün.
 * Yerel gece yarısından ISO'ya çevrilir; `new Date('...T00:00:00')` yerel okunur, dosyanın
 * geri kalanındaki dönüşümle aynı eksende kalır (UTC kayması yok).
 */
function customWindowIso(range: CustomRange): { fromIso: string; toIso: string; label: string } {
  const start = new Date(`${range.from}T00:00:00`)
  const endExclusive = new Date(`${range.to}T00:00:00`)
  endExclusive.setDate(endExclusive.getDate() + 1)
  return {
    fromIso: start.toISOString(),
    toIso: endExclusive.toISOString(),
    label: range.from === range.to ? trDay(range.from) : `${trDay(range.from)} – ${trDay(range.to)}`,
  }
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.08 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
}

// Panelin ortak kart dili: hero ile aynı — BEYAZ yüzey (renk aksandan gelir),
// üstte marka hairline'ı, köşede yumuşak hale ve hover'da hafif yükselme.
const cardShell =
  'relative overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_22px_58px_-38px_rgba(87,39,61,0.55)] transition-shadow hover:shadow-[0_28px_66px_-34px_rgba(87,39,61,0.6)]'

/** Kartın üst kenarındaki marka çizgisi — pembe → bordo → pembe (eski altın imza). */
function BrandHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
      style={{ background: 'linear-gradient(90deg, transparent, #F9A1B9 20%, #A5556E 50%, #F9A1B9 80%, transparent)' }}
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
      <BrandHairline />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#F9A1B9]/35 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[#2A2027]">
          <span aria-hidden className="h-4 w-[3px] rounded-full bg-gradient-to-b from-[#F9A1B9] to-[#A5556E]" />
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
      <span className={`${dim} shrink-0 overflow-hidden rounded-full border border-[#E3C6D1] shadow-[0_10px_22px_-16px_rgba(165,85,110,0.85)]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      </span>
    )
  }
  return (
    <span
      className={`${dim} grid shrink-0 place-items-center rounded-full border border-[#E3C6D1] bg-gradient-to-br from-[#FDE4EB] via-[#F6C9D6] to-[#EDAFC1] font-semibold text-[#7A3450] shadow-[0_10px_22px_-16px_rgba(165,85,110,0.85)]`}
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
      <polyline points={points} fill="none" stroke="#A5556E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {points.split(' ').map((point, index, arr) => {
        const [cx, cy] = point.split(',')
        const isLast = index === arr.length - 1
        return (
          <circle
            key={`${point}-${index}`}
            cx={cx}
            cy={cy}
            r={isLast ? '2.6' : '1.8'}
            fill={isLast ? '#A5556E' : '#fff'}
            stroke="#A5556E"
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
            index === lastIndex ? 'from-[#A5556E] to-[#8C4460]' : 'from-[#F6DFE6] to-[#E0B2C2]'
          }`}
          style={{ height: `${Math.max(4, (value / max) * 54)}px` }}
        />
      ))}
    </div>
  )
}

/** Kartın altındaki trend şeridinin çizgi rengi. */
const toneStroke: Record<QuickAction['tone'], string> = {
  rose: '#A5556E', gold: '#1E8C60', violet: '#8E7882', mint: '#1E4E8C', peach: '#E4577F', cream: '#8E7882',
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
      <BrandHairline />

      {/* Renkli başlık bandı: ikon + dönem kontrolü */}
      <div className={`relative flex min-h-[76px] items-start justify-between gap-3 ${toneSurface[tone]} ${toneOnBand[tone]} px-5 pb-4 pt-5`}>
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/20 blur-2xl transition-transform duration-500 group-hover:scale-110" />
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] shadow-[0_12px_26px_-14px_rgba(42,32,39,0.75)] transition-transform duration-300 group-hover:scale-105 ${toneChip[tone]}`}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
        </span>
        <div className="relative flex shrink-0 flex-col items-end gap-2">{control}</div>
      </div>

      {/* Gövde: başlık · büyük rakam · rozetler */}
      <div className="relative flex flex-1 items-end justify-between gap-3 px-5 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#74616A]">{title}</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-[#2A2027] tabular-nums">
            {value}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="rounded-full bg-[#F7F6F6] px-2 py-0.5 font-medium text-[#5A4B53]">{detail}</span>
            {subDetail && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">{subDetail}</span>
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
  topStaff = null,
  topStaffFailed = false,
}: {
  data: WeeklyRevenuePoint[]
  granularity?: string
  periodLabel?: string
  /**
   * En çok TAMAMLANMIŞ randevusu olan personel. Bu kutu bir zamanlar "Performans API" yazan bir
   * YER TUTUCUYDU; sonra ekrandaki (kırpık) randevu listesinden sayıldı. Değer artık sunucudaki
   * personel raporundan gelir — dönemin tamamı, yalnız tamamlanan randevular. Ad yoksa kutu bunu
   * açıkça söyler (uydurma yok).
   */
  topStaff?: { name: string; count: number; scopeLabel: string } | null
  /** Rapor ucu düştüyse "kayıt yok" demek yanlış olur; kutu bilinmediğini söyler. */
  topStaffFailed?: boolean
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
      {/* Grafik kuyusu nötr paper zemin: pembe üstüne pembe çubuk soluk okunuyordu. */}
      <div className="relative mt-1 rounded-[18px] border border-[#E9E5E6] bg-[#F7F6F6] px-4 pb-3 pt-7">
        {/* Tepe değer balonu — zirve çubuğunun üstünde */}
        {hasData && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#15694A] px-2 py-1 text-[10px] font-semibold text-white shadow-lg"
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
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-[#74616A]">{axisLabel(niceMax * (1 - i / 5))}</span>
              <span className="h-px flex-1 bg-[#E0D9DC]" />
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
                      isPeak ? 'bg-gradient-to-t from-[#15694A] to-[#34B37E]' : 'bg-gradient-to-t from-[#1E8C60] to-[#7FD3AC]'
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
            {/* Trend çizgisi lacivert: bordo çubukların üstünde tek başına okunur. */}
            <polyline points={linePoints} fill="none" stroke="#A5556E" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            {data.map((point, i) => {
              const cx = ((i + 0.5) / n) * 100
              const cy = 100 - (point.value / niceMax) * 100
              return <circle key={point.label} cx={cx} cy={cy} r="1.6" fill="#fff" stroke="#A5556E" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            })}
          </svg>
        </div>

        {/* Gün etiketleri — çubuklarla hizalı */}
        <div className="mt-2 flex gap-1.5 pl-12">
          {data.map((point) => (
            <span key={point.label} className="flex-1 text-center text-[10px] font-medium text-[#5A4B53]">{point.label}</span>
          ))}
        </div>
      </div>

      {/* Lejant / açıklama — ne neyi gösteriyor */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border border-[#E5DEE1] bg-[#F7F6F6] px-3.5 py-2.5 text-[11px] text-[#5A4B53]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px] bg-gradient-to-t from-[#15694A] to-[#34B37E]" />
          Çubuk: {granularity} başına toplam gelir (tahsilat)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[#A5556E]" />
          Çizgi: gelir trendi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[#74616A]">↕</span>
          Dikey eksen: {granularity} başına ciro (₺)
        </span>
      </div>

      <div data-guide="dash-insights" className="mt-3 grid gap-3 sm:grid-cols-3">
        <InsightTile title={`En yoğun ${granularity}`} value={hasData ? peak.label : 'Veri bekleniyor'} sub={formatTL(Math.round(peak.value))} />
        <InsightTile
          title="En çok çalışan personel"
          value={topStaff ? topStaff.name : topStaffFailed ? 'Hesaplanamadı' : 'Kayıt yok'}
          sub={
            topStaff
              ? `${topStaff.count} tamamlanan randevu · ${topStaff.scopeLabel}`
              : topStaffFailed
                ? 'Personel raporu yüklenemedi'
                : 'Dönemde tamamlanan randevu yok'
          }
          medal
        />
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
      className="group relative overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white p-3.5 shadow-[0_16px_40px_-32px_rgba(87,39,61,0.6)]"
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-[#F9A1B9]/30 blur-2xl transition-transform duration-500 group-hover:scale-125" />
      <div className="relative text-[9.5px] font-semibold uppercase tracking-wide text-[#74616A]">{title}</div>
      <div className="relative mt-1.5 truncate text-[15px] font-semibold leading-tight text-[#2A2027]">{value}</div>
      <div className="relative mt-1.5 inline-block rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[10.5px] font-semibold text-[#7A3450]">{sub}</div>
      {medal && (
        <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#F9A1B9] to-[#A5556E] text-white shadow-[0_10px_20px_-14px_rgba(87,39,61,0.95)]">
          <Star className="h-4 w-4" fill="currentColor" strokeWidth={1.4} />
        </span>
      )}
      {pie && (
        <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-[conic-gradient(#1E4E8C_0_70%,#DCE7F5_70%)]">
          <span className="h-4 w-4 rounded-full bg-white" />
        </span>
      )}
    </motion.div>
  )
}

function stockTone(product: Product): string {
  if (product.status === 'out') return 'text-[#b91c1c]'
  if (product.status === 'critical') return 'text-[#a16207]'
  return 'text-[#5A4B53]'
}

/*
 * Çubuk etiketleri için kısa biçim (5375 → "5,4B"); tam değer ipucunda gösterilir.
 *
 * BİRİM HARFİ SAYIYA BİTİŞİKTİR ("5,4B", "5,4 B" değil). Recharts'ın metin bileşeni etiketi
 * KAPSAYAN ÖĞENİN GENİŞLİĞİNE sarar; sütun ~38px olduğu için aradaki boşluk "8,7" / "B" diye
 * iki satıra bölünüyor, uzun sütunda ikinci satır çizim alanının üstünden taşıp kırpılıyordu.
 * Boşluk olmayınca sarılacak bir yer de kalmaz.
 */
function formatTLShort(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}Mn`
  if (absolute >= 1000) return `${(value / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}B`
  return Math.round(value).toLocaleString('tr-TR')
}

function formatChartCurrency(value: number): string {
  return `₺${formatTLShort(value)}`
}

/**
 * Aylık Ciro grafiğinde sütunun üstündeki tutar etiketi.
 *
 * NEDEN ÖZEL ÇİZİM: recharts'ın hazır etiketi metni sütun genişliğine sarıyor ve konumunu
 * kırpılmaya karşı korumuyordu. En yüksek ayın rakamı hem ikiye bölünüyor hem de sütunun
 * tepesine binip okunamıyordu. Burada metin TEK SATIR çizilir, arkasına okunur bir zemin
 * konur ve etiket çizim alanının üstünden taşmayacak şekilde sınırlanır.
 */
function RevenueBarLabel({ x, y, width, value }: { x?: number; y?: number; width?: number; value?: number }) {
  if (typeof value !== 'number' || value <= 0) return null
  const barX = Number(x ?? 0)
  const barY = Number(y ?? 0)
  const barW = Number(width ?? 0)
  const text = `₺${formatTLShort(value)}`
  const centerX = barX + barW / 2
  // Sütun tepesinin ~11px üstünde; grafiğin üst kenarına yapışmasın diye 15px'te durdurulur
  // (BarChart'ın üst boşluğu 30px, yani sınıra dayanan etiket bile tam görünür).
  const centerY = Math.max(15, barY - 11)
  // Genişlik metne göre: rozet ne rakamı kırpar ne de komşu sütuna taşar.
  const pillW = text.length * 6 + 12
  return (
    <g>
      <rect
        x={centerX - pillW / 2}
        y={centerY - 9}
        width={pillW}
        height={18}
        rx={9}
        fill="#FFFFFF"
        stroke="#BFE3D1"
        strokeWidth={1}
      />
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#15694A"
        fontSize={11}
        fontWeight={800}
        style={{ letterSpacing: '-0.01em' }}
      >
        {text}
      </text>
    </g>
  )
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
        danger ? 'border-rose-300' : 'border-[#EAD8DF]'
      } bg-white shadow-[0_16px_40px_-32px_rgba(87,39,61,0.6)] transition-shadow hover:shadow-[0_22px_46px_-30px_rgba(87,39,61,0.65)]`}
    >
      {/* Tonlu üst bant — paletin doğrudan rengi */}
      <div className={`relative flex items-center gap-2 ${toneSurface[tone]} ${toneOnBand[tone]} px-3 py-2.5`}>
        <span aria-hidden className="pointer-events-none absolute -right-5 -top-6 h-16 w-16 rounded-full bg-white/20 blur-xl transition-transform duration-500 group-hover:scale-125" />
        <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-[11px] shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)] ${toneChip[tone]}`}>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <span className="relative text-[10px] font-semibold uppercase leading-tight tracking-wide">{label}</span>
      </div>
      {/* Rakam + ipucu */}
      <div className="px-3 pb-3 pt-2.5">
        <div className={`text-[22px] font-semibold leading-none tabular-nums tracking-tight ${danger ? 'text-[#B23252]' : 'text-[#2A2027]'}`}>
          {value}
        </div>
        <div className="mt-1.5 inline-block rounded-full bg-[#F7F6F6] px-2 py-0.5 text-[10px] font-medium text-[#5A4B53]">{hint}</div>
      </div>
    </motion.div>
  )
}

/**
 * Aylık ciro grafiğinin tek noktası. Çizilen değer `collected` — o ay KASAYA GİREN para,
 * peşinat DAHİL (bkz. AccountMonthlyInstallment.collected). Peşinat ayrıca eklenmez ya da
 * çıkarılmaz: tek bant çizildiği için çift sayım riski yok.
 *
 * `due`/`remaining` alanları taşınmaya devam eder ama grafiğe girmez — alacak/vade takibi
 * Ön Muhasebe'nin işi; bu kart yalnız "bu ay ne kadar ciro yaptım" sorusunu yanıtlar.
 */
interface MonthlyRevenuePoint extends AccountMonthlyInstallment {
  key: string
  axisLabel: string
  /** İçinde bulunulan ay — henüz tamamlanmadığı için ayrı tonla çizilir. */
  isCurrent: boolean
  /** Penceredeki en yüksek cirolu ay (sıfır ciroda hiçbiri zirve sayılmaz). */
  isPeak: boolean
  /** Bir önceki aya göre değişim (%). İlk ayda ya da önceki ay sıfırken null. */
  changePct: number | null
  /** Pencere toplamı içindeki pay (%) — ipucundaki rozet. */
  sharePct: number
}

interface RevenueAxisTickProps {
  x?: number
  y?: number
  payload?: { value?: string }
}

// Eksen etiketi "Ay|Yıl|durum" biçiminde tek string gelir (Recharts tek dataKey taşır).
function RevenueAxisTick({ x = 0, y = 0, payload }: RevenueAxisTickProps) {
  const [month = '', year = '', state = ''] = String(payload?.value ?? '').split('|')
  const isCurrent = state === 'current'

  return (
    <g transform={`translate(${x},${y})`}>
      {isCurrent && <rect x={-24} y={8} width={48} height={23} rx={11.5} fill="#DFF3EA" stroke="#8CDCB8" />}
      <text
        x={0}
        y={23}
        textAnchor="middle"
        fill={isCurrent ? '#15694A' : '#5A4B53'}
        fontSize={11}
        fontWeight={isCurrent ? 700 : 600}
      >
        {month}
      </text>
      <text x={0} y={44} textAnchor="middle" fill="#8E7882" fontSize={9.5} fontWeight={500}>
        {year}
      </text>
    </g>
  )
}

function RevenueTooltip({ active, payload }: TooltipProps<number, string>) {
  const point = payload?.[0]?.payload as MonthlyRevenuePoint | undefined
  if (!active || !point) return null
  const rising = (point.changePct ?? 0) >= 0

  return (
    <div className="min-w-[210px] rounded-[16px] border border-[#E4DEE0] bg-white/[0.98] p-3.5 shadow-[0_18px_48px_-18px_rgba(87,39,61,0.42)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-[#2A2027]">
            {point.label} {point.year}
          </div>
          <div className="mt-0.5 text-[10px] text-[#74616A]">
            {point.isCurrent ? 'Bu ay · henüz devam ediyor' : 'Aylık ciro'}
          </div>
        </div>
        {/* Rozet: bu ayın görünen dönem cirosundaki payı. */}
        <span className="rounded-full bg-[#F7F6F6] px-2 py-1 text-[10px] font-bold tabular-nums text-[#5A4B53]">
          %{Math.round(point.sharePct)}
        </span>
      </div>
      <div className="mt-3 space-y-2 border-t border-[#EFEAEC] pt-3">
        <div className="flex items-center justify-between gap-5 text-[11px]">
          <span className="flex items-center gap-2 text-[#5A4B53]">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#1E8C60]" />
            Kasaya giren
          </span>
          <b className="tabular-nums text-[#15694A]">{formatTL(Math.round(point.collectedInMonth))}</b>
        </div>
        {/* Peşinat kasaya girenin İÇİNDEDİR — ayrı bant değil, yalnız kırılım satırı. */}
        {point.deposit > 0.005 && (
          <div className="flex items-center justify-between gap-5 text-[11px]">
            <span className="pl-[18px] text-[#74616A]">Peşin alınan</span>
            <b className="tabular-nums text-[#5A4B53]">{formatTL(Math.round(point.deposit))}</b>
          </div>
        )}
        {/*
         * VADE PERFORMANSI — AYRI EKSEN, AYRI SATIR.
         *
         * Sütun "bu ay kasaya ne girdi"yi çizer; bu satır "bu ayın VADESİ ne kadardı, ne kadarı
         * kapandı"yı söyler. İkisi aynı ay için farklı olabilir (Eylül vadeli borç Ağustos'ta
         * ödenebilir) ve tek rakama indirilirse ikisi de yanlış okunur.
         */}
        {(point.due > 0.005 || point.collected > 0.005) && (
          <div className="flex items-center justify-between gap-5 border-t border-dashed border-[#E4DEE0] pt-2 text-[11px]">
            <span className="flex items-center gap-2 text-[#5A4B53]">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-[#1E4E8C]" />
              Bu ayın vadesi
            </span>
            <b className="tabular-nums text-[#17406F]">
              {formatTL(Math.round(point.collected))} / {formatTL(Math.round(point.due))}
            </b>
          </div>
        )}
        {point.changePct !== null && (
          <div className="flex items-center justify-between gap-5 border-t border-dashed border-[#E4DEE0] pt-2 text-[11px]">
            <span className="font-medium text-[#5A4B53]">Önceki aya göre</span>
            <b className={`tabular-nums ${rising ? 'text-[#15694A]' : 'text-[#BE3960]'}`}>
              {rising ? '+' : ''}%{Math.round(point.changePct)}
            </b>
          </div>
        )}
      </div>
    </div>
  )
}

function RevenueSummary({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'gold' | 'mint' | 'violet'
}) {
  const toneClass = {
    gold: 'bg-[#1E8C60] text-[#15694A] ring-[#DFF3EA]',
    mint: 'bg-[#1E4E8C] text-[#17406F] ring-[#DCE7F5]',
    violet: 'bg-[#8E7882] text-[#4E4048] ring-[#EFEAEC]',
  }[tone]

  return (
    <div className="min-w-0 rounded-[15px] border border-[#EAD8DF] bg-white px-3.5 py-3 shadow-[0_10px_24px_-22px_rgba(87,39,61,0.55)]">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#74616A]">
        <span className={`h-2 w-2 rounded-full ring-4 ${toneClass}`} />
        {label}
      </div>
      <div className="mt-2 truncate text-[16px] font-bold tabular-nums tracking-tight text-[#2A2027]">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-[#74616A]">{detail}</div>
    </div>
  )
}

/**
 * AYLIK CİRO — ay ay gerçekleşen tahsilat (kasaya giren para).
 *
 * Bu kart eskiden üç bantlı "Aylık Taksit Performansı" idi (peşin · taksit · kalan alacak).
 * Vade/alacak takibi Ön Muhasebe'nin işi olduğu için grafik TEK seriye indirildi: her sütun
 * o ayın cirosu. Sadeleşmenin iki doğrudan sonucu var:
 *   • Peşinat ayrı banttan çıkarıldı — `collected` onu zaten içeriyor, tek bantta çift sayım olmaz.
 *   • GELECEK AYLAR ELENİR: rapor penceresi son taksit vadesine kadar ileri uzanır, ciro
 *     grafiğinde ise henüz yaşanmamış aylar boş sütun olarak dizilirdi.
 */
function MonthlyRevenueChart({ months, period, loadFailed = false }: {
  months: AccountMonthlyInstallment[]
  period: RangePeriod
  /** Rapor ucu düştü — "veri yok" yerine hata gösterilir (bkz. aşağıdaki boş durum). */
  loadFailed?: boolean
}) {
  const now = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1
  const isYearly = period === 'yearly'
  const VISIBLE = isYearly ? 12 : 6
  const elapsed = useMemo(
    () => months.filter((month) => month.year < curY || (month.year === curY && month.month <= curM)),
    [months, curY, curM],
  )
  const maxOffset = Math.max(0, elapsed.length - VISIBLE)
  const [start, setStart] = useState(0)
  // Varsayılan pencere EN SON aylardır: ciro grafiğinde ilk bakılan yer içinde bulunulan aydır.
  useEffect(() => {
    setStart(maxOffset)
  }, [maxOffset])
  const visible = elapsed.slice(start, start + VISIBLE)

  /*
   * ÖLÇÜ = TAHSİLAT EKSENİ (`collectedInMonth`), tahakkuk ekseni değil.
   *
   * Kart "Aylık Ciro" diyor, yani "bu ay kasaya ne girdi". Eskiden `collected` çiziliyordu ve o,
   * ödemenin taksitin VADE ayına dağıtılmış hâlidir: Eylül vadeli 1.000 ₺ Ağustos'ta tahsil
   * edilince Ağustos 0, Eylül 1.000 görünüyordu — para giren ay boş kalıyordu. İki eksen artık
   * ayrı alanlar; grafik kasayı, ipucu ayrıca vade performansını gösterir.
   */
  const windowTotal = visible.reduce((sum, month) => sum + month.collectedInMonth, 0)
  const monthAverage = visible.length > 0 ? windowTotal / visible.length : 0
  const peak = visible.reduce<AccountMonthlyInstallment | null>(
    (best, month) => (best === null || month.collectedInMonth > best.collectedInMonth ? month : best),
    null,
  )
  const hasPeak = peak !== null && peak.collectedInMonth > 0

  const chartData: MonthlyRevenuePoint[] = visible.map((month, index) => {
    // Kıyas penceredeki değil TAKVİMDEKİ önceki aydır: pencerenin ilk sütunu da
    // "önceki aya göre" bilgisini taşısın (kaydırınca kıyas kaybolmasın).
    const previousMonth = elapsed[start + index - 1]
    const previous = previousMonth ? previousMonth.collectedInMonth : null
    return {
      ...month,
      key: `${month.year}-${month.month}`,
      axisLabel: `${month.label}|${month.year}|${month.year === curY && month.month === curM ? 'current' : 'default'}`,
      isCurrent: month.year === curY && month.month === curM,
      isPeak: hasPeak && month.year === peak!.year && month.month === peak!.month,
      changePct: previous !== null && previous > 0 ? ((month.collectedInMonth - previous) / previous) * 100 : null,
      sharePct: windowTotal > 0 ? (month.collectedInMonth / windowTotal) * 100 : 0,
    }
  })

  const hasAny = elapsed.some((month) => month.collectedInMonth > 0)
  const canPrev = start > 0
  const canNext = start + VISIBLE < elapsed.length
  const rangeLabel =
    visible.length === 0
      ? '—'
      : visible.length === 1
        ? `${visible[0].label} ${visible[0].year}`
        : `${visible[0].label} ${visible[0].year} – ${visible[visible.length - 1].label} ${visible[visible.length - 1].year}`

  return (
    <div data-guide="dash-ciro" className="relative overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-white p-4 shadow-[0_22px_55px_-42px_rgba(87,39,61,0.7)] sm:p-5">
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-[#8CDCB8]/30 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[11px] bg-[#1E8C60] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
              <BarChart3 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <div className="text-[13px] font-bold tracking-[-0.01em] text-[#2A2027]">Aylık Ciro</div>
              {/* Etiket ÖLÇÜYÜ doğru anlatmalı: sütun, ödemenin GERÇEKLEŞTİĞİ aya yazılır. */}
              <div className="mt-0.5 text-[10.5px] text-[#74616A]">{rangeLabel} · ay ay kasaya giren tahsilat</div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="mr-1 hidden rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-1.5 text-[10px] font-semibold text-[#5A4B53] md:inline">
            {isYearly ? `Son ${VISIBLE} ay` : `${VISIBLE} aylık görünüm`}
          </span>
          <button
            type="button"
            aria-label="Önceki aylar"
            disabled={!canPrev}
            onClick={() => setStart(Math.max(0, start - VISIBLE))}
            className="grid h-9 w-9 place-items-center rounded-full border border-[#E4DEE0] bg-white text-[#8C4460] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Sonraki aylar"
            disabled={!canNext}
            onClick={() => setStart(Math.min(maxOffset, start + VISIBLE))}
            className="grid h-9 w-9 place-items-center rounded-full border border-[#E4DEE0] bg-white text-[#8C4460] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative mt-4 grid gap-2.5 sm:grid-cols-3">
        <RevenueSummary
          label="Dönem cirosu"
          value={formatTL(Math.round(windowTotal))}
          detail={`${visible.length} aylık toplam`}
          tone="gold"
        />
        <RevenueSummary
          label="Aylık ortalama"
          value={formatTL(Math.round(monthAverage))}
          detail="Ay başına düşen ciro"
          tone="mint"
        />
        <RevenueSummary
          label="En yüksek ay"
          value={hasPeak ? formatTL(Math.round(peak!.collectedInMonth)) : '—'}
          detail={hasPeak ? `${peak!.label} ${peak!.year}` : 'Henüz ciro yok'}
          tone="violet"
        />
      </div>

      {hasAny ? (
        <>
          <div className="relative mt-3 overflow-x-auto rounded-[18px] border border-[#E9E5E6] bg-[#F7F6F6] px-1 pb-1 pt-4 sm:px-3">
            <div className="h-[280px] min-w-[560px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {/* Üst boşluk 30: en yüksek sütunun etiket rozeti çizim alanına tam sığsın. */}
                <BarChart data={chartData} margin={{ top: 30, right: 10, left: -10, bottom: 26 }} barCategoryGap="42%">
                  <defs>
                    <linearGradient id="monthlyRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34B37E" />
                      <stop offset="55%" stopColor="#1E8C60" />
                      <stop offset="100%" stopColor="#15694A" />
                    </linearGradient>
                    {/* Bu ay AÇIK tonda: henüz kapanmamış bir ayın sütunu, tamamlanmış aylarla
                        aynı doluluğa sahip görünürse "ciro düştü" diye yanlış okunuyor. */}
                    <linearGradient id="monthlyRevenueCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#B9E9D2" />
                      <stop offset="100%" stopColor="#34B37E" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#E4DEE0" strokeDasharray="2 8" strokeWidth={1} />
                  <XAxis
                    dataKey="axisLabel"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    height={58}
                    tick={<RevenueAxisTick />}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={58}
                    tick={{ fill: '#74616A', fontSize: 9.5, fontWeight: 500 }}
                    tickFormatter={(value: number) => formatChartCurrency(value)}
                  />
                  <Tooltip
                    content={<RevenueTooltip />}
                    cursor={{ fill: '#EFEAEC', opacity: 0.9, radius: 14 }}
                    wrapperStyle={{ outline: 'none' }}
                  />
                  {/* TEK SERİ: o ay KASAYA GİREN tutar (peşinat dahil). Vade performansı AYRI
                      bir eksendir ve ipucunda ayrı satır olarak gösterilir — aynı sütuna iki
                      farklı zaman eksenini bindirmek grafiği okunamaz hâle getiriyordu. */}
                  <Bar
                    dataKey="collectedInMonth"
                    name="Kasaya giren"
                    fill="url(#monthlyRevenue)"
                    maxBarSize={38}
                    radius={[12, 12, 4, 4]}
                    animationDuration={850}
                    animationEasing="ease-out"
                  >
                    {chartData.map((point) => (
                      <Cell
                        key={`revenue-${point.key}`}
                        fill={point.isCurrent ? 'url(#monthlyRevenueCurrent)' : 'url(#monthlyRevenue)'}
                        stroke={point.isPeak ? '#15694A' : 'transparent'}
                        strokeWidth={point.isPeak ? 1.5 : 0}
                      />
                    ))}
                    <LabelList
                      // Sütunun üstündeki rakam da sütunla AYNI ölçüden gelmeli.
                      // Çizimi RevenueBarLabel yapar: tek satır + zeminli rozet + taşma koruması.
                      dataKey="collectedInMonth"
                      content={<RevenueBarLabel />}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute left-[70px] top-[18px] text-[9px] font-semibold uppercase tracking-[0.12em] text-[#74616A]">
              Tutar
            </div>
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[10px] text-[#5A4B53]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-b from-[#34B37E] to-[#15694A]" /> Sütun: o ayın cirosu
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-b from-[#B9E9D2] to-[#34B37E]" /> Bu ay (devam ediyor)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-[#15694A] bg-white" /> En yüksek ay
            </span>
            <span className="ml-auto hidden text-[#74616A] sm:inline">Ayrıntı için sütunların üzerine gelin</span>
          </div>
        </>
      ) : loadFailed ? (
        /* HATA ≠ VERİ YOK. Uç düştüğünde "henüz ciro kaydı yok" demek, kullanıcıya var olan
           cirosunu SIFIR gösterir; yanlış bilgi, eksik bilgiden kötüdür. */
        <div className="relative mt-4 flex min-h-[150px] flex-col items-center justify-center rounded-[18px] border border-dashed border-rose-200 bg-rose-50/60 px-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-rose-700">Ciro raporu yüklenemedi</div>
          <div className="mt-1 text-[10.5px] text-[#74616A]">
            Bu kart şu an gerçek veriyi göstermiyor. Sayfayı yenileyin; sorun sürerse yetkinizi kontrol edin.
          </div>
        </div>
      ) : (
        <div className="relative mt-4 flex min-h-[150px] flex-col items-center justify-center rounded-[18px] border border-dashed border-[#DFD9DC] bg-[#F7F6F6] px-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#edf8f2] text-[#4b8a68]">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-[#3E343A]">Henüz ciro kaydı yok</div>
          <div className="mt-1 text-[10.5px] text-[#74616A]">Tahsilat girildikçe aylık ciro burada ay ay oluşur.</div>
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
  // Özel tarih aralığı: doluysa dönem çipinin YERİNE geçer (ikisi aynı anda uygulanmaz —
  // "Aylık + 3–9 Ağustos" diye bir pencere yok, kullanıcı hangisini seçtiyse o kazanır).
  const [packageCustom, setPackageCustom] = useState<CustomRange | null>(null)
  // Paket Raporu kategori süzgeci — dönem çipiyle BİRLİKTE çalışır ('' = tüm kategoriler).
  const [packageCategory, setPackageCategory] = useState('')
  const [packageSubCategory, setPackageSubCategory] = useState('')
  // Hizmet Raporu kendi dönemi ve kendi (hizmet) kategorisiyle çalışır — paketle karışmaz.
  const [servicePeriod, setServicePeriod] = useState<RangePeriod>('monthly')
  const [serviceCustom, setServiceCustom] = useState<CustomRange | null>(null)
  const [serviceCategory, setServiceCategory] = useState('')
  const [serviceSubCategory, setServiceSubCategory] = useState('')
  // Bekleyen Tahsilat kartı kendi dönemini taşır: varsayılan 'all' (tüm zamanların borcu).
  const [collectionPeriod, setCollectionPeriod] = useState<CollectionPeriod>('all')
  const [collectionCustom, setCollectionCustom] = useState<CustomRange | null>(null)
  // Satış Detayı > Müşteri kırılımında seçilen paket/hizmet ('' = tüm satışlar). Seçim SUNUCUYA
  // gider: müşteri satırındaki taksit/ödeme/seans toplamları o satışa göre yeniden hesaplanmalı.
  const [breakdownItem, setBreakdownItem] = useState<BreakdownItemSelection | null>(null)
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
        staffReport,
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
        // HATA "VERİ YOK" DEĞİLDİR: boş nesneye düşmek, uç 500/403 dönse bile grafiği
        // "Henüz ciro kaydı yok" diye çizdiriyordu — kullanıcı eksik veriyi gerçek sanıyordu.
        // null döner, aşağıda AYRI bir bayrağa çevrilir ve kart hata durumu gösterir.
        adminApi.accountReport<ApiAccountReport>(tenantId, 6).catch(() => null),
        // Paket Raporu kategori süzgecinin seçenekleri paketlerin kendi kategorilerinden türetilir
        // (boş kategori gösterilmesin diye katalog listesi yerine gerçek paketler kullanılır).
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        // Dönemin TAMAMINI kapsayan personel toplamı (kırpık liste değil).
        adminApi
          .reportStaff<ApiStaffReport>({ tenantId, fromUtc: apptFromIso, toUtc: apptToIso })
          .catch<null>(() => null),
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
        reportResult: reportResult ?? ({} as ApiAccountReport),
        /** Rapor ucu düştü mü — grafik "veri yok" yerine hata gösterebilsin. */
        reportFailed: reportResult === null,
        packagesResult,
        staffReport,
      }
    },
    [tenantId, apptFromIso, apptToIso, dayStartIso, dayEndIso, yearStartIso],
    { initialData: null },
  )

  // Paket Raporu dönem penceresi: yerel sınırlar ISO'ya çevrilir (CreatedAtUtc ile doğru karşılaştırılır).
  const pkgToday = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate())
  const pkgToDate = new Date(pkgToday)
  pkgToDate.setDate(pkgToDate.getDate() + 1)
  const pkgFromDate =
    packagePeriod === 'daily'
      ? pkgToday
      : packagePeriod === 'yearly'
        ? new Date(pkgToday.getFullYear(), 0, 1)
        : new Date(pkgToday.getFullYear(), pkgToday.getMonth(), 1)
  // Özel aralık seçiliyse dönem çipinin penceresi kullanılmaz.
  const pkgCustomWindow = packageCustom ? customWindowIso(packageCustom) : null
  const pkgFromIso = pkgCustomWindow?.fromIso ?? pkgFromDate.toISOString()
  const pkgToIso = pkgCustomWindow?.toIso ?? pkgToDate.toISOString()
  const packageWindowLabel = pkgCustomWindow?.label ?? periodWindow(packagePeriod, dayStart).label

  // Paket Raporu kartları için döneme göre süzülmüş ayrı rapor (Tahsilat Oranı + takvim genel kalır).
  // Kategori seçiliyse aynı sorguya eklenir → dönem + kategori birlikte uygulanır.
  const { data: packageReportData, loading: packageLoading } = useApiQuery<ApiAccountReport>(
    () => adminApi
      .accountReport<ApiAccountReport>(tenantId, 6, pkgFromIso, pkgToIso, packageCategory || undefined, packageSubCategory || undefined)
      .catch(() => ({}) as ApiAccountReport),
    [tenantId, pkgFromIso, pkgToIso, packageCategory, packageSubCategory],
    { initialData: null },
  )

  // --- Bekleyen Tahsilat kartının kendi penceresi (Tümü / Gün / Ay / Yıl / özel aralık) -------
  // 'all' + özel aralık yokken hiç istek atılmaz: genel rapor (data.reportResult) zaten
  // penceresizdir, aynı veriyi ikinci kez çekmek boşuna tur olurdu.
  const colToday = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate())
  const colToDate = new Date(colToday)
  colToDate.setDate(colToDate.getDate() + 1)
  const colFromDate =
    collectionPeriod === 'daily'
      ? colToday
      : collectionPeriod === 'yearly'
        ? new Date(colToday.getFullYear(), 0, 1)
        : new Date(colToday.getFullYear(), colToday.getMonth(), 1)
  const colCustomWindow = collectionCustom ? customWindowIso(collectionCustom) : null
  const collectionScoped = colCustomWindow !== null || collectionPeriod !== 'all'
  const colFromIso = colCustomWindow?.fromIso ?? (collectionPeriod === 'all' ? undefined : colFromDate.toISOString())
  const colToIso = colCustomWindow?.toIso ?? (collectionPeriod === 'all' ? undefined : colToDate.toISOString())
  const collectionWindowLabel = colCustomWindow?.label
    ?? (collectionPeriod === 'all' ? 'Tüm zamanlar' : periodWindow(collectionPeriod, dayStart).label)

  const { data: collectionReportData, loading: collectionLoading } = useApiQuery<ApiAccountReport>(
    () => adminApi
      .accountReport<ApiAccountReport>(tenantId, 6, colFromIso, colToIso)
      .catch(() => ({}) as ApiAccountReport),
    [tenantId, colFromIso, colToIso],
    { initialData: null, enabled: collectionScoped },
  )

  // Satış Detayı > Müşteri kırılımı: paket/hizmet seçiliyken AYNI dönem ve kategoriyle ama tek
  // ürüne daraltılmış ayrı bir rapor çekilir. Seçim yokken ek istek atılmaz — paket raporunun
  // kendi yanıtındaki müşteri listesi zaten aynı kapsamdadır.
  const breakdownScoped = breakdownItem !== null
  const { data: breakdownReportData, loading: breakdownLoading } = useApiQuery<ApiAccountReport>(
    () => adminApi
      .accountReport<ApiAccountReport>(
        tenantId, 6, pkgFromIso, pkgToIso, packageCategory || undefined, packageSubCategory || undefined,
        breakdownItem ? { kind: breakdownItem.kind, id: breakdownItem.id } : null,
      )
      .catch(() => ({}) as ApiAccountReport),
    [tenantId, pkgFromIso, pkgToIso, packageCategory, packageSubCategory, breakdownItem?.kind, breakdownItem?.id, breakdownScoped],
    { initialData: null, enabled: breakdownScoped },
  )

  // --- Hizmet Raporu: paket raporundan TAMAMEN AYRI (kendi dönemi + kendi kategorisi) ---------
  // Özel aralığı da ayrıdır: paketle hizmet farklı tarihlerde incelenebilmeli.
  const svcPeriodWindow = periodWindow(servicePeriod, dayStart)
  const svcCustomWindow = serviceCustom ? customWindowIso(serviceCustom) : null
  const svcFromIso = svcCustomWindow?.fromIso ?? new Date(`${svcPeriodWindow.startKey}T00:00:00`).toISOString()
  const svcToIso = svcCustomWindow?.toIso ?? new Date(`${svcPeriodWindow.endKey}T00:00:00`).toISOString()
  const svcWindowLabel = svcCustomWindow?.label ?? svcPeriodWindow.label
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
    const map = new Map<string, { subs: Set<string> }>()
    for (const s of apiItems(data?.servicesResult)) {
      const cat = (s.category || '').trim()
      if (!cat) continue
      if (!map.has(cat)) map.set(cat, { subs: new Set() })
      const entry = map.get(cat)!
      const sub = (s.subCategory || '').trim()
      if (sub) entry.subs.add(sub)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
      .map(([name, v]) => ({ name, subs: [...v.subs].sort((a, b) => a.localeCompare(b, 'tr')) }))
  }, [data])

  // Kategori süzgecinin seçenekleri: paketlerin kendi kategori/alt kategorileri.
  // Alt kategori kutusu yalnızca seçili kategorinin alt kategorisi VARSA görünür.
  const packageCategoryOptions = useMemo<CategoryOption[]>(() => {
    const map = new Map<string, { subs: Set<string> }>()
    for (const p of apiItems(data?.packagesResult)) {
      const cat = (p.category || '').trim()
      if (!cat) continue
      if (!map.has(cat)) map.set(cat, { subs: new Set() })
      const entry = map.get(cat)!
      const sub = (p.subCategory || '').trim()
      if (sub) entry.subs.add(sub)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
      .map(([name, v]) => ({ name, subs: [...v.subs].sort((a, b) => a.localeCompare(b, 'tr')) }))
  }, [data])

  /* Satış Detayı seçicisinin listeleri — pano zaten katalog paketlerini ve hizmetlerini
     yüklüyor, seçici için AYRI istek atılmaz. */
  const breakdownPackageItems = useMemo<PickerItem[]>(
    () => apiItems(data?.packagesResult).map((p) => ({
      id: p.id ?? '',
      name: p.name ?? 'Paket',
      price: Number(p.totalPrice ?? 0),
      cat: (p.category || '').trim(),
      sub: (p.subCategory || '').trim(),
      meta: p.totalSessions ? `${p.totalSessions} seans` : undefined,
    })).filter((p) => p.id),
    [data],
  )
  const breakdownServiceItems = useMemo<PickerItem[]>(
    () => apiItems(data?.servicesResult).map((s) => ({
      id: s.id ?? '',
      name: s.name ?? 'Hizmet',
      price: Number(s.price ?? 0),
      cat: (s.category || '').trim(),
      sub: (s.subCategory || '').trim(),
      meta: s.durationMinutes ? `${s.durationMinutes} dk` : undefined,
    })).filter((s) => s.id),
    [data],
  )

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

  /*
   * EN ÇOK ÇALIŞAN PERSONEL — randevu sayısına göre.
   *
   * KAPSAM AÇIKÇA YAZILIR: sayım, sayfanın "Randevu Dönemi" seçicisinin getirdiği randevulardan
   * yapılır (grafiğin kendi Hafta/Ay/Yıl çipinden DEĞİL — o çip tahsilat serisini sürer, randevu
   * listesini değil). Kutunun alt satırı bu yüzden dönemi adıyla yazar; yoksa hangi aralığın
   * sayıldığı belirsiz kalırdı.
   *
   * İPTALLER SAYILMAZ: iptal edilmiş randevu yapılmış iş değildir.
   */
  /*
   * EN ÇOK ÇALIŞAN PERSONEL — kaynak: sunucudaki personel raporu.
   *
   * İki kusur birden kapanıyor:
   *  1) Sayım artık ekrandaki KIRPIK listeden (pageSize 200) değil, dönemin tamamından geliyor.
   *  2) Ölçüt TAMAMLANAN randevu. "İptal değilse say" demek, ileri tarihli açık randevularını
   *     ve gelmeyen müşterilerini de çalışmış gibi sayıyordu; en çok çalışan ≠ en çok defteri
   *     dolu olan. Rapor ucu düşerse ad UYDURULMAZ, kutu durumu söyler (aşağıdaki `failed`).
   */
  const staffReportRows = data?.staffReport?.rows
  const topStaff = useMemo(() => {
    if (!staffReportRows) return null
    let best: { name: string; count: number } | null = null
    for (const row of staffReportRows) {
      const name = (row.staffName || '').trim()
      const count = Number(row.completedCount ?? 0)
      if (!name || count <= 0) continue
      if (!best || count > best.count || (count === best.count && name.localeCompare(best.name, 'tr') < 0)) {
        best = { name, count }
      }
    }
    return best ? { ...best, scopeLabel: apptRange.label } : null
  }, [staffReportRows, apptRange.label])
  /** Rapor ucu düştü mü — "kayıt yok" ile "bilinmiyor" ayrı cümlelerdir. */
  const topStaffFailed = Boolean(data) && !staffReportRows

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
  // Müşteri kırılımı: paket/hizmet seçiliyse onun raporundan, değilse dönem raporundan.
  const breakdownReport = breakdownScoped ? normalizeAccountReport(breakdownReportData) : packageReport

  /*
   * BEKLEYEN TAHSİLAT — kartın rakamı KALAN BORÇ TUTARIDIR, oran değil.
   *
   * Kart eskiden "satışlarımın yüzde kaçı tahsil edilmedi" oranını basıyordu; kurumun sorduğu şey
   * ise "ne kadar param dışarıda" olduğu için oran her seferinde tutara çevriliyordu. Rakam artık
   * doğrudan `openReceivable`.
   *
   * TABAN SATIŞTIR, TAKSİT PLANI DEĞİL: `totalReceivable`/`totalCollected` yalnız TAKSİT
   * satırlarını ölçer, peşin satış hiç taksit üretmez. `openReceivable`/`totalPaid` cari kartının
   * kendi kuralından gelir ve Ön Muhasebe'deki "Toplam açık alacak" / "Toplam tahsilat" ile aynı
   * tabandır.
   *
   * Dönem seçiliyse kendi sorgusunun raporu kullanılır; 'all' iken genel rapor zaten penceresiz.
   */
  const collectionReport = collectionScoped ? normalizeAccountReport(collectionReportData) : report
  const collectionBase = collectionReport.openReceivable + collectionReport.totalPaid
  /* Dönem değişince rakam ile ALTINDAKİ tutarlar birlikte beklemeli: yalnız büyük rakamı '…'
     yapmak, kart bir an "yükleniyor ama borç şu kadar" diye ÖNCEKİ dönemin parasını gösteriyordu. */
  const collectionPending = collectionScoped && collectionLoading

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
      href: '/panel/musteriler?scope=passive',
    },
    {
      title: 'Bu ay doğum günü olan müşteriler',
      count: birthdayThisMonth,
      icon: Sparkles,
      tone: 'rose' as const,
      href: '/panel/musteriler',
    },
    {
      title: 'KVKK onaysız müşteriler',
      count: kvkkPending,
      icon: ShieldCheck,
      tone: 'gold' as const,
      href: '/panel/musteriler?scope=kvkk-pending',
    },
    {
      title: 'Kara listedeki müşteriler',
      count: blacklisted,
      icon: FileWarning,
      tone: 'peach' as const,
      href: '/panel/musteriler?scope=blacklist',
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
          href: '/panel/onaylar',
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

        <motion.div variants={listContainer} initial="hidden" animate="visible" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Calendar}
            title={globalPeriod === 'daily' ? 'Bugünkü Randevular' : 'Randevular'}
            value={<AnimatedNumber value={appointmentsTotal} />}
            detail={<><b className="font-semibold text-[#2A2027]">{completed}</b> Tamamlandı</>}
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
            /* Kartın rakamı KALAN BORÇ TUTARI (oran değil) — bkz. yukarıdaki not. */
            value={collectionPending ? '…' : <AnimatedNumber value={collectionReport.openReceivable} format={(n) => formatTL(Math.round(n))} />}
            detail={
              <span title={`Dönem: ${collectionWindowLabel}`}>
                {collectionPending
                  ? 'Dönem hesaplanıyor…'
                  : collectionBase > 0
                    ? <>Kalan borç · {collectionWindowLabel}</>
                    : collectionScoped ? 'Bu dönemde satış yok' : 'Henüz satış yok'}
              </span>
            }
            subDetail={!collectionPending && collectionBase > 0 ? <>{formatTL(Math.round(collectionReport.totalPaid))} tahsil edildi</> : undefined}
            control={
              <>
                {/* Çip seçilince özel aralık düşer: ikisi aynı anda uygulanmaz. */}
                <PeriodTabs
                  value={collectionPeriod}
                  onChange={(p) => { setCollectionPeriod(p); setCollectionCustom(null) }}
                  options={COLLECTION_PERIOD_OPTIONS}
                  dimmed={collectionCustom !== null}
                />
                <DateRangeFilter value={collectionCustom} onChange={setCollectionCustom} />
              </>
            }
            tone="gold"
          />
        </motion.div>

        {/* min-w-0: xl altında ızgara tek kolona düşer ve track içeriğe göre boyutlanır. İçeride
            auto-fit kullanan kart ızgaraları buna yaslanıp kapsayıcıyı taşırıyordu (mobilde sağ
            taraf kırpılıyordu). min-w-0 track'in daralmasına izin verir. */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.92fr)]">
          <div className="min-w-0 space-y-5">
            {/* RANDEVU DÖNEMİ — sürüklediği listenin (Randevu Akışı) hemen üstünde durur.
                Sayfanın tepesindeyken hangi kartı süzdüğü belli olmuyordu. */}
            <div data-guide="dash-donem" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#EAD8DF] bg-white px-4 py-3 shadow-[0_14px_40px_-32px_rgba(87,39,61,0.55)]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#A5556E] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
                  <Calendar className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </span>
                <div>
                  <div className="text-[12.5px] font-semibold leading-4 text-[#2A2027]">Randevu Dönemi</div>
                  <div className="text-[11px] text-[#74616A]">{apptRange.label}</div>
                </div>
              </div>
              <PeriodTabs value={globalPeriod} onChange={setGlobalPeriod} options={FULL_PERIOD_OPTIONS} />
            </div>

            <SectionCard
              title={globalPeriod === 'daily' ? 'Bugünkü Randevu Akışı' : 'Randevu Akışı'}
              action={
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1.5 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-2.5 py-1 text-[10px] font-semibold text-[#5A4B53] sm:inline-flex">
                    <Calendar className="h-3 w-3" strokeWidth={1.8} />
                    {apptRange.label}
                  </span>
                  <Link href="/panel/randevular" className="hidden items-center gap-1 text-[12px] font-semibold text-[#A5556E] hover:text-[#723550] sm:flex">
                    Tüm randevuları görüntüle <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              }
            >
              <motion.div variants={listContainer} initial="hidden" animate="visible" className="px-4 pb-4">
                {/* Zaman çizelgesi: solda saat, ortada müşteri+işlem, sağda uzman ve durum. */}
                <div className="relative space-y-2">
                  {appointments.length > 0 && (
                    <span aria-hidden className="pointer-events-none absolute bottom-3 left-[54px] top-3 w-px bg-gradient-to-b from-[#D69CAF] via-[#EAD8DF] to-transparent" />
                  )}
                  {appointments.slice(0, 5).map((appointment) => {
                    const badge = statusBadge[appointment.status] || statusBadge.bekliyor
                    return (
                      <motion.div
                        key={appointment.id}
                        variants={listRow}
                        whileHover={{ x: 3 }}
                        className="group relative flex items-center gap-3 rounded-[18px] border border-[#EAD8DF] bg-white px-3 py-2.5 transition-colors hover:border-[#BE7690] hover:bg-[#FBF0F3]"
                      >
                        {/* Saat rozeti */}
                        <span className="relative z-[1] grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#F6DFE6] to-[#EBC3CF] text-[12px] font-bold tabular-nums text-[#7A3450] ring-1 ring-white">
                          {appointment.time || '—'}
                        </span>

                        {/* Müşteri + işlem */}
                        <span className="flex min-w-0 flex-1 items-center gap-2.5">
                          <AvatarBubble name={appointment.musteri} size="md" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-[#2A2027]">{appointment.musteri}</span>
                            <span className="block truncate text-[11.5px] text-[#5A4B53]">{appointment.islem}</span>
                          </span>
                        </span>

                        {/* Uzman */}
                        <span className="hidden min-w-0 items-center gap-2 sm:flex">
                          <AvatarBubble name={appointment.personel} size="sm" />
                          <span className="truncate text-[11.5px] font-medium text-[#4E4048]">{appointment.personel}</span>
                        </span>

                        {/* Durum */}
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>

                        <Link
                          href="/panel/randevular"
                          aria-label="Randevulara git"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#8E7882] opacity-0 transition-opacity hover:bg-[#F6DFE6] hover:text-[#7A3450] group-hover:opacity-100"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </motion.div>
                    )
                  })}
                  {!appointments.length && (
                    <div className="rounded-[18px] border border-dashed border-[#DFD9DC] bg-[#F7F6F6] px-4 py-10 text-center">
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#F6DFE6] text-[#A5556E]">
                        <Calendar className="h-6 w-6" strokeWidth={1.6} />
                      </span>
                      <p className="mt-2 text-[12.5px] text-[#5A4B53]">
                        {globalPeriod === 'daily' ? 'Bugün için randevu kaydı yok.' : 'Seçili dönemde randevu kaydı yok.'}
                      </p>
                      <Link
                        href="/panel/randevular?action=new"
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#A5556E] px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_14px_26px_-14px_rgba(87,39,61,0.95)] transition-colors hover:bg-[#8C4460]"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" /> Randevu oluştur
                      </Link>
                    </div>
                  )}
                </div>
                {appointments.length > 0 && (
                  <Link href="/panel/randevular" className="mx-auto mt-4 flex w-max items-center gap-1 text-[12px] font-semibold text-[#A5556E] hover:text-[#723550]">
                    Tüm randevuları görüntüle <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </motion.div>
            </SectionCard>

            <SectionCard
              title="Paket Raporu"
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* Çip seçilince özel aralık düşer: ikisi aynı anda uygulanmaz. */}
                  <PeriodTabs
                    value={packagePeriod}
                    onChange={(p) => { setPackagePeriod(p); setPackageCustom(null) }}
                    options={PACKAGE_PERIOD_OPTIONS}
                    dimmed={packageCustom !== null}
                  />
                  <DateRangeFilter value={packageCustom} onChange={setPackageCustom} />
                  <Link href="/panel/on-muhasebe" className="hidden items-center gap-1 text-[12px] font-semibold text-[#A5556E] hover:text-[#723550] sm:inline-flex">
                    Ön muhasebe <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              }
            >
              <div className="space-y-4 px-5 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-2.5 py-1 text-[10px] font-semibold text-[#5A4B53]">
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
                    <span className="text-[10px] text-[#74616A]">Dönemde satılan paketler</span>
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

                {/* Ciro grafiği dönem çipinden yalnız pencere genişliğini alır (6 ay / 12 ay);
                    veri her zaman genel rapordan gelir, kategori süzgeciyle daralmaz. */}
                <MonthlyRevenueChart months={reportMonths} period={packagePeriod} loadFailed={data?.reportFailed ?? false} />

                {/* HİZMET RAPORU — paket raporundan TAMAMEN AYRI blok. Kendi dönemi ve kendi
                    (hizmet) kategorisi vardır; yukarıdaki paket seçimlerinden etkilenmez. */}
                <div className="rounded-[16px] border border-[#E4DEE0] bg-[#F7F6F6] p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#1E4E8C] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </span>
                      <div>
                        <div className="text-[13px] font-semibold text-[#2A2027]">Hizmet Raporu</div>
                        {/* Kapsam ekranda yazılı: bu blok YALNIZ tekil hizmet satışlarını sayar,
                            paketten gelen seanslar Paket Raporu'nda okunur (ikisi ayrık küme). */}
                        <div className="text-[10px] text-[#5A4B53]">
                          Tekil hizmet satışları · {svcWindowLabel}
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
                      <PeriodTabs
                        value={servicePeriod}
                        onChange={(p) => { setServicePeriod(p); setServiceCustom(null) }}
                        options={FULL_PERIOD_OPTIONS}
                        dimmed={serviceCustom !== null}
                      />
                      <DateRangeFilter value={serviceCustom} onChange={setServiceCustom} />
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

                {/* Müşteri bazlı taksit/ödeme/seans kırılımı (dönem + kategori filtresine uyar).
                    Paket/hizmet seçilirse liste yalnız onu alan müşterilere daralır. */}
                <PackageReportBreakdown
                  customers={breakdownReport.customers}
                  loading={packageLoading || breakdownLoading}
                  packageItems={breakdownPackageItems}
                  serviceItems={breakdownServiceItems}
                  selectedItem={breakdownItem}
                  onSelectItem={setBreakdownItem}
                />
              </div>
            </SectionCard>

            <div className="grid gap-5 lg:grid-cols-[1.32fr_0.88fr]">
              <SectionCard
                title="Gelir Analizi"
                action={<PeriodTabs value={chartRange} onChange={setChartRange} options={CHART_PERIOD_OPTIONS} />}
              >
                <div data-guide="dash-gelir"><RevenueChart data={chartData} granularity={chartGranularity} periodLabel={chartPeriodLabel} topStaff={topStaff} topStaffFailed={topStaffFailed} /></div>
              </SectionCard>

              <SectionCard
                title="Takip Edilmesi Gereken Müşteriler"
                action={
                  <Link href="/panel/musteriler" className="text-[12px] font-semibold text-[#A5556E] hover:text-[#723550]">
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
                            urgent ? toneClasses[item.tone] : 'border-[#E4DEE0] bg-white text-[#5A4B53]'
                          }`}
                        >
                          <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/25 blur-xl transition-transform duration-500 group-hover:scale-125" />
                          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-white/25 ring-1 ring-white/30">
                            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                          </span>
                          <span className="relative min-w-0 flex-1">
                            <span className="block text-[22px] font-semibold leading-none tabular-nums">{item.count}</span>
                            <span className="mt-1 block text-[11px] font-semibold leading-snug">{item.title}</span>
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
                        <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/25 blur-xl transition-transform duration-500 group-hover:scale-125" />
                        <span className="relative grid h-10 w-10 place-items-center rounded-[13px] bg-white/25 ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-105">
                          <Icon className="h-[19px] w-[19px]" strokeWidth={1.9} />
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
              action={<Star className="h-5 w-5 text-[#A5556E]" fill="currentColor" strokeWidth={1.3} />}
            >
              <div className="space-y-2 px-4 pb-5">
                {(() => {
                  const topRevenue = Math.max(1, ...performanceRows.map((r) => r.revenue))
                  const medals = ['from-[#A5556E] to-[#723550]', 'from-[#F9A1B9] to-[#E4577F]', 'from-[#8E7882] to-[#5A4B53]']
                  return performanceRows.map((row, idx) => (
                    <motion.div
                      key={row.person.id}
                      variants={listRow}
                      initial="hidden"
                      animate="visible"
                      whileHover={{ x: 3 }}
                      className="group rounded-[18px] border border-[#EAD8DF] bg-white px-3 py-2.5 transition-colors hover:border-[#BE7690] hover:bg-[#FBF0F3]"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(120,71,88,0.9)] ${
                            idx < 3 ? `bg-gradient-to-br ${medals[idx]}` : 'bg-[#DFD9DC] text-[#4E4048]'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <AvatarBubble name={row.person.name} size="md" photoUrl={row.person.photoUrl || undefined} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[#2A2027]">{row.person.name}</span>
                          <span className="block text-[11px] text-[#5A4B53]">{row.count} randevu</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13.5px] font-semibold tabular-nums text-[#8C4460]">{formatTL(Math.round(row.revenue))}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#DCE7F5] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#17406F]">
                            {row.score.toFixed(1)} <Star className="h-3 w-3" fill="currentColor" strokeWidth={1.2} />
                          </span>
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EFEAEC]">
                        <motion.span
                          className="block h-full rounded-full bg-gradient-to-r from-[#A5556E] to-[#F9A1B9]"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(4, Math.round((row.revenue / topRevenue) * 100))}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </motion.div>
                  ))
                })()}
                {!performanceRows.length && (
                  <div className="rounded-[18px] border border-dashed border-[#DFD9DC] bg-[#F7F6F6] py-8 text-center text-[12px] text-[#5A4B53]">
                    Personel performans verisi bekleniyor.
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Stok Uyarıları"
              action={
                <Link href="/panel/stok" className="text-[12px] font-semibold text-[#A5556E] hover:text-[#723550]">
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
                      href="/panel/stok"
                      className={`group flex items-center gap-3 rounded-[18px] border px-3 py-2.5 transition-colors ${
                        out ? 'border-rose-300 bg-rose-50 hover:bg-rose-100' : 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                      }`}
                    >
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-white shadow-[0_10px_22px_-14px_rgba(42,32,39,0.55)] ${stockTone(product)}`}>
                        <FileWarning className="h-[18px] w-[18px]" strokeWidth={1.6} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-[#2A2027]">{product.name}</span>
                        <span className={`mt-0.5 block text-[11px] font-semibold ${stockTone(product)}`}>
                          {out ? 'Tükendi — sipariş ver' : `${product.currentStock} ${product.unit} kaldı`}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[9.5px] font-bold ${out ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800'}`}>
                        {out ? 'KRİTİK' : 'AZALDI'}
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-[#8E7882] opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  )
                })}
                {!criticalProducts.length && (
                  <div className="flex items-center justify-center gap-2 rounded-[18px] border border-dashed border-emerald-300 bg-emerald-50 py-6 text-[12px] font-semibold text-emerald-800">
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
