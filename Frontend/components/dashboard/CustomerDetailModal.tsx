'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Ban, Cake, CalendarPlus, Check, ChevronRight, Clock, Copy, CreditCard, Crown, FileText, Loader2, Mail,
  Package, Phone, PieChart, QrCode, ReceiptText, RotateCcw, Scissors, Search, Sparkles, Trash2, TrendingUp, User, Wallet, X,
} from 'lucide-react'
import CustomerSessionsCard from '@/components/dashboard/CustomerSessionsCard'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'
import CustomerOperationsJournal from '@/components/dashboard/CustomerOperationsJournal'
import TreatmentJournal from '@/components/dashboard/TreatmentJournal'
import ConsultationForm from '@/components/dashboard/ConsultationForm'
import CustomerBlacklistCard from '@/components/dashboard/CustomerBlacklistCard'
import ConsentWarningBanner from '@/components/dashboard/ConsentWarningBanner'
import CustomerVipToggle from '@/components/dashboard/CustomerVipToggle'
import CustomerSalesModal, { summarizeCustomerSales } from '@/components/dashboard/CustomerSalesModal'
import CollectionDialog, { type CollectionSubmitPayload } from '@/components/dashboard/CollectionDialog'
import { formatTL, paymentMethodLabel } from '@/lib/apiMappers'
import { reconcileCustomerMoney } from '@/lib/customerMoney'
import ModalPortal from '@/components/dashboard/ModalPortal'
import CustomerHistoryPanel from '@/components/dashboard/CustomerHistoryPanel'
import type { Appointment, CancelledSale, CustomerAccount } from '@/lib/types'

export interface CustomerModalData {
  id: string
  name: string
  phone: string
  email: string
  photoUrl?: string
  tier: string
  gender?: string
  /** DOĞUM TARİHİ (kayıt tarihi değil) — adı geçmişten kalmadır, `createdAt` ile karıştırma. */
  joined: string
  /** Müşterinin sisteme KAYIT tarihi (ISO). Liste ucundan `createdAtUtc` olarak gelir. */
  createdAt?: string
  notes?: string
  debt: number
  /**
   * Sunucunun hesapladığı NET TAHSİLAT (tahsilat + arşiv − iade). KPI'lardaki "Toplam Harcama /
   * Tahsil Edilen" ikilisi artık `accounts` listesinden türetiliyor — iki rakam birbirinden
   * çıkarılabilsin diye aynı kümeye bakmaları şart. Alan, listeyle aynı kaynaktan gelsin diye
   * arayüzde kalır ama kartlarda kullanılmaz.
   */
  spent: number
  apptCount: number
  lastService: string
  lastDate: string
  isBlacklisted?: boolean
  blacklistReason?: string | null
  isVip?: boolean
  branchId?: string | null
}

type TabKey = 'overview' | 'appointments' | 'adisyon' | 'health' | 'notes'

const TR_MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const STATUS_LABEL: Record<string, string> = { tamamlandi: 'Tamamlandı', devam: 'Devam ediyor', bekliyor: 'Bekliyor', iptal: 'İptal' }
const STATUS_TONE: Record<string, string> = {
  tamamlandi: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  iptal: 'bg-rose-50 text-rose-700 border-rose-200/60',
  bekliyor: 'bg-amber-50 text-amber-700 border-amber-200/60',
  devam: 'bg-sky-50 text-sky-700 border-sky-200/60',
}
// Net ayrışan, marka uyumlu palet — yan yana dilimler birbirinden bariz farklı görünsün.
const DONUT_COLORS = ['#A5556E', '#7c5cbf', '#2fae8e', '#e8932f', '#4a9fe0', '#d65a8e']

/**
 * OKUNABİLİRLİK NOTU: bu modal `ModalPortal` ile <body>'ye taşınır, yani `globals.css`'teki
 * `.theme-surface` altına kurulu silik-metin düzeltmeleri BURAYA UYGULANMAZ. Bu yüzden ikincil
 * metinlerde `#352432/45` gibi opaklıklar yerine doğrudan okunur tonlar kullanılır:
 * birincil #352432 · yarı-muted #4a3a44 · muted #705a66 (en küçük punto 10px).
 */
const MUTED = 'text-[#74616A]'
const SEMI = 'text-[#3E343A]'

type ApptFilterKey = 'all' | 'tamamlandi' | 'devam' | 'bekliyor' | 'iptal'
const APPT_FILTERS: { key: ApptFilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'tamamlandi', label: 'Tamamlandı' },
  { key: 'devam', label: 'Devam' },
  { key: 'bekliyor', label: 'Bekliyor' },
  { key: 'iptal', label: 'İptal' },
]

/**
 * Doğum gününe kalan gün. Yıl bilgisi yok sayılır: bu yılın tarihi geçtiyse gelecek yıla bakılır.
 * Salon için değerli bir sinyal — doğum günü yaklaşan müşteriye kampanya/kutlama yapılır.
 */
function daysToBirthday(birth?: string): number | null {
  if (!birth) return null
  const d = new Date(birth)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate())
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate())
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

/**
 * Kayıt tarihinin yanındaki kıdem rozeti: "3. yılı", "7 aydır", "yeni kayıt".
 * Ham tarih tek başına "bu müşteri bizde ne kadardır var?" sorusunu cevaplamıyordu.
 */
function membershipSince(createdAt?: string): string | null {
  if (!createdAt) return null
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 0) return null
  if (days < 30) return 'yeni kayıt'
  const months = Math.floor(days / 30.44)
  if (months < 12) return `${months} aydır`
  return `${Math.floor(days / 365.25) + 1}. yılı`
}

/** Telefonu tel: bağlantısına uygun hale getirir (boşluk/parantez temizler). */
function telHref(phone?: string): string {
  return `tel:${(phone || '').replace(/[^\d+]/g, '')}`
}

/** `2026-05-31` yerine `31 May 2026` — mobil taraftaki biçimin aynısı. */
function fmtDateTR(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${d.getDate()} ${TR_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

function genderLabel(g?: string): string {
  return g === 'Female' ? 'Kadın' : g === 'Male' ? 'Erkek' : g === 'Other' ? 'Diğer' : 'Belirtilmemiş'
}
function isDate(s: string): boolean {
  const t = new Date(s).getTime()
  return !Number.isNaN(t)
}

/** Hafif inline çizgi grafik — harcamanın zaman içindeki dağılımı. */
function MiniLineChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  const n = values.length
  const pts = values.map((v, i) => [(i / Math.max(n - 1, 1)) * 100, 38 - (v / max) * 32] as const)
  const line = pts.map((p) => `${p[0]},${p[1]}`).join(' ')
  const area = `0,40 ${line} 100,40`
  const allZero = values.every((v) => v === 0)
  return (
    <div>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-32 w-full overflow-visible xl:h-36">
        <defs>
          <linearGradient id="cdm-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A5556E" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#A5556E" stopOpacity="0" />
          </linearGradient>
        </defs>
        {!allZero && <polygon points={area} fill="url(#cdm-spark)" />}
        <polyline
          points={line}
          fill="none"
          stroke="#A5556E"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.4" fill="#A5556E" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={`mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide ${MUTED}`}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  )
}

/** Inline donut — net ayrışan dilimler + dilim başına bar/değer/yüzde lejantı (detaylı dağılım). */
function MiniDonut({ segments, centerLabel, centerValue, formatValue }: { segments: { label: string; value: number; color: string; sub?: string }[]; centerLabel: string; centerValue: string; formatValue?: (v: number) => string }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = 15.9155
  const C = 2 * Math.PI * r
  const gap = segments.length > 1 ? 1.6 : 0 // dilimler arası boşluk → bariz ayrım
  let acc = 0
  return (
    <div>
      <div className="relative mx-auto h-[130px] w-[130px]">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r={r} fill="none" stroke="#f4e7ec" strokeWidth="5" />
          {total > 0 && segments.map((seg, i) => {
            const len = (seg.value / total) * C
            const draw = Math.max(0.4, len - gap)
            const el = (
              <circle
                key={i}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="5"
                strokeDasharray={`${draw} ${C - draw}`}
                strokeDashoffset={-acc}
                strokeLinecap="round"
              />
            )
            acc += len
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-[19px] leading-none tracking-tight text-[#2A2027]">{centerValue}</span>
          <span className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${MUTED}`}>{centerLabel}</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {segments.length === 0 ? (
          <div className={`rounded-[10px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-3 text-center text-[11.5px] ${MUTED}`}>Veri yok</div>
        ) : segments.map((seg, i) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
          return (
            <div key={i}>
              {/* Dar sütunda (müşteri modali orta kolonu) satır taşıp üst üste binmesin:
                  sol taraf kısalır, sağdaki tutar/yüzde satır sonuna sarar. */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11.5px]">
                <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${SEMI}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: seg.color }} />
                  <span className="truncate">{seg.label}</span>
                  {seg.sub && <span className={`truncate text-[10px] ${MUTED}`}>· {seg.sub}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                  {formatValue && <span className={MUTED}>{formatValue(seg.value)}</span>}
                  <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-bold" style={{ backgroundColor: `${seg.color}1f`, color: seg.color }}>%{pct}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f4e7ec]">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, backgroundColor: seg.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className={`shrink-0 text-[11.5px] ${MUTED}`}>{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px] font-medium text-[#2A2027]">{value}</span>
    </div>
  )
}

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: typeof User; action?: ReactNode; children: ReactNode }) {
  return (
    // min-w-0: kart bir ızgara/flex hücresinin çocuğu olduğunda hücrenin daralmasını engellememeli
    // (varsayılan min-width:auto içerideki en geniş satırı taban genişlik yapar → dar ekranda taşma).
    <div className="min-w-0 rounded-[16px] border border-[#EAD8DF] bg-white p-4 shadow-[0_14px_40px_-36px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#A5556E]">
          <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/** Genel Bakış'taki satış özeti — tam liste ayrı modalde açılır. */
function SalesSummaryCard({
  summary,
  onOpen,
}: {
  summary: ReturnType<typeof summarizeCustomerSales>
  onOpen: () => void
}) {
  const paidPct = summary.total > 0 ? Math.min(100, Math.round((summary.paid / summary.total) * 100)) : 0
  return (
    <SectionCard
      title="Paket & Hizmet Satışları"
      icon={Package}
      action={
        <button type="button" onClick={onOpen} className="shrink-0 cursor-pointer text-[11px] font-bold text-[#A5556E] hover:underline">
          Tümünü aç
        </button>
      }
    >
      {summary.count === 0 ? (
        <button
          type="button"
          onClick={onOpen}
          className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-6 text-center text-[11.5px] transition-colors hover:border-[#BE7690] hover:bg-[#fff5f8] ${MUTED}`}
        >
          Satış kaydı yok.
          <span className="font-bold text-[#A5556E]">Geçmiş satış ekle →</span>
        </button>
      ) : (
        <button type="button" onClick={onOpen} className="group w-full cursor-pointer text-left">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className={`text-[10.5px] font-semibold uppercase tracking-wider ${MUTED}`}>Toplam satış tutarı</div>
              <div className="font-display text-[24px] leading-tight tracking-tight tabular-nums text-[#2A2027]">{formatTL(Math.round(summary.total))}</div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1 text-[11px] font-bold text-[#a34a62] transition-colors group-hover:border-[#BE7690] group-hover:bg-[#F6DFE6]">
              {summary.count} satış <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>

          {/* Tahsilat ilerlemesi */}
          <div className="mt-3 flex items-center gap-2.5">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f6e3ea]">
              <span
                className={`block h-full rounded-full ${summary.remaining > 0.5 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
                style={{ width: `${Math.max(3, paidPct)}%` }}
              />
            </span>
            <span className={`shrink-0 text-[11px] font-semibold ${SEMI}`}>%{paidPct}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px]">
            <span className={MUTED}>Tahsil edilen <b className={`font-semibold ${SEMI}`}>{formatTL(Math.round(summary.paid))}</b></span>
            <span className={summary.remaining > 0.5 ? 'font-semibold text-rose-700' : MUTED}>
              {summary.remaining > 0.5 ? `${formatTL(Math.round(summary.remaining))} kalan` : 'Borç yok'}
            </span>
          </div>

          {/* Durum rozetleri */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.active > 0 && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">Devam eden {summary.active}</span>
            )}
            {summary.completed > 0 && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10.5px] font-bold text-sky-700">Biten {summary.completed}</span>
            )}
            {summary.cancelled > 0 && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-600">İptal {summary.cancelled}</span>
            )}
            {summary.sessionsTotal > 0 && (
              <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2 py-0.5 text-[10.5px] font-bold text-[#a34a62]">
                {Math.max(0, summary.sessionsTotal - summary.sessionsUsed)} seans kaldı
              </span>
            )}
          </div>

          {summary.lastSaleName && (
            <div className={`mt-2.5 truncate border-t border-[#f4e7ec] pt-2 text-[11px] ${MUTED}`}>
              Son satış: <b className={`font-semibold ${SEMI}`}>{summary.lastSaleName}</b> · {fmtDateTR(summary.lastSaleAtUtc || '')}
            </div>
          )}
        </button>
      )}
    </SectionCard>
  )
}

/**
 * Müşteri Detay Modalı — salon yönetim panelinde danışan kartının zengin, sekmeli görünümü.
 * Genel bakış (bilgi + grafikler + son randevular + satış özeti + hızlı işlemler) ve operasyonel
 * sekmeler (randevu/seans, adisyon/işlem defteri, sağlık/günlük, notlar) tek modalda toplanır.
 *
 * Geniş çalışma tezgâhı gibi davranır: masaüstünde sabit yükseklik (sekme değişince zıplamaz),
 * dizüstünde (MacBook ~800px) başlık şeridi kompakt kalır, tablet/telefonda tek sütuna iner.
 */
export default function CustomerDetailModal({
  open,
  onClose,
  customer,
  detailPhoto,
  tenantId,
  appts,
  accounts,
  accountsLoading = false,
  cancelledSales = [],
  isStaff,
  canAdisyon,
  canBlacklist,
  sessRefresh,
  onReload,
  onReloadWithSessions,
  onSaveNote,
  onUploadPhoto,
  onCreateAppointment,
  onDelete,
  onAssignGiftCard,
  editSlot,
  saleSlot,
  salesPanel,
  onCollectPayment,
  onRestoreCancelledSale,
}: {
  open: boolean
  onClose: () => void
  customer: CustomerModalData | undefined
  detailPhoto: string | null
  tenantId?: string
  appts: Appointment[]
  accounts: CustomerAccount[]
  /**
   * Cari/randevu verisi hâlâ geliyor mu? Satış tutarı kartları bu listeden hesaplandığı için,
   * yükleme sırasında ₺0 yazmak yerine "—" gösterilir (bir an "harcama yok" sanılıyordu).
   */
  accountsLoading?: boolean
  /**
   * İPTAL ARŞİVİ. İptal edilen satışın cari/tahsilat satırları canlı tablodan SİLİNİR
   * (`cancelled_sales`'a taşınır), bu yüzden `accounts` listesinde iz bırakmazlar: iptal sayacı
   * hiç dolmaz ve kısmi iade sonrası KURUMDA KALAN para ("retained") hiçbir kartta görünmezdi.
   */
  cancelledSales?: CancelledSale[]
  isStaff: boolean
  canAdisyon: boolean
  canBlacklist: boolean
  sessRefresh: number
  onReload: () => unknown
  onReloadWithSessions: () => unknown
  onSaveNote: (text: string) => unknown
  onUploadPhoto: (file: File) => unknown
  onCreateAppointment: () => void
  onDelete: () => void
  /**
   * "Hediye kartı tanımla" — QR okutup kartı BU müşteriye bağlar. Verilmezse düğme çizilmez
   * (özellik kapalı ya da yetki yok).
   */
  onAssignGiftCard?: () => void
  editSlot?: ReactNode
  saleSlot?: ReactNode
  /** "Paket & Hizmet Satışları" listesi — kartta özet durur, tam liste ayrı modalde açılır. */
  salesPanel?: ReactNode
  /**
   * Hızlı işlemlerdeki "Tahsilat Al" akışı. Verilmezse buton çizilmez; verilse de yalnızca
   * müşterinin AÇIK BORÇLU carisi varsa görünür (tahsil edilecek bir şey yoksa buton anlamsız).
   */
  onCollectPayment?: (payload: CollectionSubmitPayload) => Promise<void>
  /**
   * "İptali geri al" — Ön Muhasebe'deki akışın aynısı (adminApi.restoreSale). Verilmezse
   * iptal listesi salt okunur kalır. `voidRefund` yalnız iade FİİLEN yapılmamışsa true olur ve
   * gerekçe zorunludur: gerçek bir kasa çıkışı siliniyor demektir.
   */
  onRestoreCancelledSale?: (originalAccountId: string, voidRefund: boolean, voidReason?: string) => Promise<void>
}) {
  const [tab, setTab] = useState<TabKey>('overview')
  const [noteDraft, setNoteDraft] = useState('')
  /** Not kaydı sessizdi; kullanıcı kaydolup olmadığını göremiyordu. */
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [copied, setCopied] = useState<'phone' | 'email' | null>(null)
  /** Randevu geçmişi süzgeci — uzun süreli müşteride liste onlarca satır oluyor. */
  const [apptQuery, setApptQuery] = useState('')
  const [apptStatus, setApptStatus] = useState<ApptFilterKey>('all')
  /** Satış listesi ayrı (geniş) modalde açılır — kartın sağ sütununa sığmıyordu. */
  const [salesOpen, setSalesOpen] = useState(false)
  /** Hızlı işlemlerden açılan "Tahsilat Al" modalı. */
  const [collectOpen, setCollectOpen] = useState(false)
  /** "İptali geri al" akışı — iadeli iptalde önce "para gerçekten ödendi mi?" sorulur. */
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Modal açıldığında / müşteri değiştiğinde sekmeyi ve notu tazele.
  useEffect(() => {
    if (open) {
      setTab('overview')
      setNoteDraft(customer?.notes || '')
      setNoteState('idle')
      setApptQuery('')
      setApptStatus('all')
      setSalesOpen(false)
      setRestoreConfirmId(null)
      setVoidReason('')
      setRestoreError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id])

  /** Geri alma isteği — hata satır altında yazılır, modal kapanmaz. */
  const restoreCancelled = useCallback(async (originalAccountId: string, rowId: string, voidRefund: boolean) => {
    if (!onRestoreCancelledSale) return
    if (voidRefund && !voidReason.trim()) { setRestoreError('İadeyi geçersiz kılmak için gerekçe yazın.'); return }
    setRestoringId(rowId)
    setRestoreError('')
    try {
      await onRestoreCancelledSale(originalAccountId, voidRefund, voidRefund ? voidReason.trim() : undefined)
      setRestoreConfirmId(null)
      setVoidReason('')
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'İptal geri alınamadı.')
    } finally {
      setRestoringId(null)
    }
  }, [onRestoreCancelledSale, voidReason])

  // Sekme değişince gövde başa dönsün: uzun sekmeden kısa sekmeye geçince
  // sayfa ortasında açılıyor ve içerik yokmuş gibi görünüyordu.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [tab])

  const copyToClipboard = useCallback(async (value: string, kind: 'phone' | 'email') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      // pano izni yoksa sessiz geç — metin zaten ekranda seçilebilir
    }
  }, [])

  /** Not yalnız DEĞİŞTİYSE kaydedilir; her odak kaybında boşuna istek atılmaz. */
  const saveNote = useCallback(async (value: string) => {
    if (value === (customer?.notes || '')) return
    setNoteState('saving')
    try {
      await onSaveNote(value)
      setNoteState('saved')
      window.setTimeout(() => setNoteState('idle'), 2000)
    } catch {
      setNoteState('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.notes, onSaveNote])

  // Esc ile kapat + arka plan kaydırmasını kilitle.
  // Satış modali açıkken Esc'i O kapatır; yoksa tek tuşla iki modal birden kapanıyordu.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salesOpen && !collectOpen) onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, salesOpen, collectOpen])

  const cid = customer?.id

  const customerAppts = useMemo(
    () => appts.filter((a) => a.customerId === cid).sort((x, y) => `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`)),
    [appts, cid],
  )
  const customerAccounts = useMemo(() => accounts.filter((a) => a.customerId === cid), [accounts, cid])
  const salesSummary = useMemo(() => summarizeCustomerSales(customerAccounts), [customerAccounts])
  /** KPI'daki satış adedi: tutarlarla AYNI kümeye bakar (iptaller tutara girmiyor, sayıya da girmez). */
  const salesCount = salesSummary.active + salesSummary.completed

  /**
   * İPTAL ARŞİVİ ÖZETİ. İptal edilen satış canlı `accounts` listesinde YOKTUR (satırlar silinip
   * arşive taşınır), bu yüzden `salesSummary.cancelled` gerçekte hep 0 kalır — iptal sayısı da
   * kısmi iade sonrası kurumda kalan para da yalnız buradan okunabilir.
   */
  const customerCancelled = useMemo(
    () => cancelledSales.filter((c) => c.customerId === cid),
    [cancelledSales, cid],
  )
  const cancelledSummary = useMemo(() => ({
    count: customerCancelled.length,
    // Tahsil edilip İADE EDİLMEYEN kısım: iptalden sonra da kurumun kasasında kalır.
    retained: customerCancelled.reduce((s, c) => s + Math.max(0, c.retainedAmount), 0),
    refunded: customerCancelled.reduce((s, c) => s + Math.max(0, c.refundedAmount), 0),
    // İptal edilen satışların TUTARI: "Toplam Harcama" kartı da bunu saymalı. Yalnız
    // "Tahsil Edilen"e arşiv eklenince ÇELİŞKİ çıkıyordu — tüm satışları iptal edilmiş
    // müşteride Harcama ₺0 iken Tahsil ₺600 görünüyor, iki kart birbirini yalanlıyordu.
    total: customerCancelled.reduce((s, c) => s + Math.max(0, c.totalAmount), 0),
  }), [customerCancelled])

  /**
   * Tahsilat alınabilecek cariler: kalan borcu olanlar. İptal edilen satışlar zaten canlı listeye
   * girmez (arşive taşınır) ama eski damgalı kayıtlara karşı süzgeç burada da uygulanır.
   */
  const collectableAccounts = useMemo(
    () => customerAccounts.filter((a) => a.saleStatus !== 'Cancelled' && a.remainingAmount > 0.005),
    [customerAccounts],
  )
  const totalDebt = useMemo(
    () => collectableAccounts.reduce((s, a) => s + a.remainingAmount, 0),
    [collectableAccounts],
  )
  const canCollect = Boolean(onCollectPayment) && collectableAccounts.length > 0

  /**
   * ÜÇ KARTIN MUTABAKATI (bkz. lib/customerMoney). İptal + iade senaryosunda kartlar
   * "Harcama 1.000 · Tahsil 600 · Borç 0" gösterip aradaki 400'ü HİÇBİR YERDE yazmıyordu.
   * İade artık kendi kalemidir; kimlik kapanır.
   */
  const money = useMemo(() => reconcileCustomerMoney({
    liveTotal: salesSummary.total,
    livePaid: salesSummary.paid,
    liveDebt: totalDebt,
    cancelledTotal: cancelledSummary.total,
    cancelledRetained: cancelledSummary.retained,
    cancelledRefunded: cancelledSummary.refunded,
  }), [salesSummary.total, salesSummary.paid, totalDebt, cancelledSummary])

  /** Süzgeç çiplerindeki sayaçlar — hangi durumda kaç kayıt olduğu tıklamadan görünür. */
  const apptStatusCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of customerAppts) m[a.status] = (m[a.status] ?? 0) + 1
    return m
  }, [customerAppts])

  /** Randevu sekmesindeki liste — arama + durum süzgeci uygulanmış hâli. */
  const filteredAppts = useMemo(() => {
    let list = customerAppts
    if (apptStatus !== 'all') list = list.filter((a) => a.status === apptStatus)
    const t = apptQuery.trim().toLocaleLowerCase('tr')
    if (t) {
      list = list.filter((a) =>
        (a.islem || '').toLocaleLowerCase('tr').includes(t)
        || (a.personel || '').toLocaleLowerCase('tr').includes(t)
        || (a.date || '').includes(t))
    }
    return list
  }, [customerAppts, apptQuery, apptStatus])

  // Harcamaların zaman içindeki dağılımı — son 6 ay, cari tahsilatları aydan aya.
  const { spendValues, spendLabels } = useMemo(() => {
    const now = new Date()
    const buckets: number[] = Array(6).fill(0)
    const labels: string[] = []
    const keys: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      labels.push(TR_MONTHS_SHORT[d.getMonth()])
      keys.push(`${d.getFullYear()}-${d.getMonth()}`)
    }
    for (const a of customerAccounts) {
      for (const p of a.payments) {
        const d = new Date(p.occurredAtUtc)
        if (Number.isNaN(d.getTime())) continue
        const k = `${d.getFullYear()}-${d.getMonth()}`
        const idx = keys.indexOf(k)
        if (idx >= 0) buckets[idx] += p.amount
      }
    }
    return { spendValues: buckets, spendLabels: labels }
  }, [customerAccounts])

  // İşlem dağılımı (donut) — tamamlanan randevular hizmete göre.
  const serviceSegments = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of customerAppts) {
      if (a.status !== 'tamamlandi') continue
      const k = a.islem || 'Diğer'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    const sorted = [...m.entries()].sort((x, y) => y[1] - x[1])
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((s, x) => s + x[1], 0)
    const segs = top.map(([label, value], i) => ({ label, value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
    if (rest > 0) segs.push({ label: 'Diğer', value: rest, color: DONUT_COLORS[5] })
    return segs
  }, [customerAppts])
  const completedCount = useMemo(() => customerAppts.filter((a) => a.status === 'tamamlandi').length, [customerAppts])

  // Ödeme tercihleri (donut) — cari tahsilatları ödeme yöntemine göre (tutar + işlem adedi).
  // Etiket ORTAK çeviriciden gelir: ham kod ("cash") dilimde olduğu gibi yazılıyordu.
  const paymentSegments = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>()
    for (const a of customerAccounts) {
      for (const p of a.payments) {
        const k = paymentMethodLabel(p.method)
        const cur = m.get(k) ?? { sum: 0, count: 0 }
        cur.sum += p.amount
        cur.count += 1
        m.set(k, cur)
      }
    }
    return [...m.entries()]
      .sort((x, y) => y[1].sum - x[1].sum)
      .map(([label, v], i) => ({ label, value: v.sum, color: DONUT_COLORS[i % DONUT_COLORS.length], sub: `${v.count} tahsilat` }))
  }, [customerAccounts])
  const paymentTotal = useMemo(() => paymentSegments.reduce((s, x) => s + x.value, 0), [paymentSegments])

  if (!customer) return null

  const initials = customer.name.trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toLocaleUpperCase('tr')
  const kvkkOk = customer.tier === 'KVKK Onaylı'
  const active90 = customer.lastDate ? Date.now() - new Date(customer.lastDate).getTime() <= 90 * 86_400_000 : false

  const birthdayIn = daysToBirthday(customer.joined)
  const membershipLabel = membershipSince(customer.createdAt)
  const hasSalesPanel = Boolean(salesPanel)

  // Sekme başlığında sayaç: içeriğe girmeden ne kadar kayıt olduğu görünür.
  const TABS: { key: TabKey; label: string; count?: number; dot?: boolean }[] = [
    { key: 'overview', label: 'Genel Bakış' },
    { key: 'appointments', label: 'Randevu & Seans', count: customerAppts.length },
    ...(canAdisyon ? [{ key: 'adisyon' as TabKey, label: 'Adisyon & İşlemler' }] : []),
    { key: 'health', label: 'Sağlık & Günlük' },
    { key: 'notes', label: 'Notlar', dot: Boolean((customer.notes || '').trim()) },
  ]

  const kpis: { label: string; value: string; sub?: string; icon: typeof User; tone?: string; small?: boolean; onClick?: () => void }[] = [
    {
      label: 'Toplam Randevu',
      value: String(customer.apptCount),
      sub: completedCount > 0 ? `${completedCount} tamamlandı` : undefined,
      icon: CalendarPlus,
      onClick: () => setTab('appointments'),
    },
    /*
     * ÜÇLÜ OKUMA: Toplam Harcama − Tahsil Edilen ≈ Açık Borç. Eskiden "Toplam Harcama" TAHSİL
     * EDİLEN parayı gösteriyordu; 30.000 ₺'lik paket alıp 5.000 ₺ ödeyen müşteride kart 5.000
     * yazıyor, satışın büyüklüğü hiçbir yerde görünmüyordu. Üç kart da AYNI kaynaktan (satış
     * özeti) beslenir; rakamlar birbirini tutsun diye sunucudaki "harcama" (tahsilat − iade)
     * alanı burada KULLANILMAZ.
     *
     * "≈": Açık Borç cari BAŞINA sıfırla sınırlanır (fazla ödeme alacak bakiyesi olur, borcu
     * eksiye çekmez) — fazla tahsilatı olan müşteride çıkarma birebir tutmayabilir.
     */
    {
      label: 'Toplam Harcama',
      // İPTAL EDİLEN SATIŞLAR DA SAYILIR: "Tahsil Edilen" arşivi sayarken bu kart saymayınca
      // tüm satışı iptal edilmiş müşteride Harcama ₺0 ↔ Tahsil ₺600 çelişkisi çıkıyordu.
      value: accountsLoading ? '—' : formatTL(Math.round(money.total)),
      sub: accountsLoading
        ? 'yükleniyor'
        : cancelledSummary.count > 0
          ? `${salesCount + cancelledSummary.count} satış · ${cancelledSummary.count} iptal`
          : salesCount > 0 ? `${salesCount} satış tutarı` : 'satış kaydı yok',
      icon: Wallet,
      onClick: hasSalesPanel ? () => setSalesOpen(true) : undefined,
    },
    {
      label: 'Tahsil Edilen',
      // İPTAL EDİLEN SATIŞTAN KALAN PARA DA SAYILIR: iptalde satırlar arşive taşındığı için
      // canlı özet onu görmez, ama para fiilen kasada kaldı (iade edilen kısım düşülmüştür).
      // Sıfır göstermek "bu müşteriden hiç tahsilat yok" gibi okunuyordu.
      value: accountsLoading ? '—' : formatTL(Math.round(money.collected)),
      // Kalan tutarı yazmıyoruz: yanındaki "Açık Borç" kartı zaten AYNI rakamı gösteriyor
      // (iki kart da Toplam − Tahsil Edilen formülünden çıkıyor). Burada oran daha çok şey söyler.
      // İADE GÖRÜNÜR OLMALI: "kurumda kalan" ile "hiç alınmamış" ekranda aynı görünüyordu ve
      // Harcama − Tahsil farkı açıklanamıyordu.
      sub: accountsLoading
        ? 'yükleniyor'
        : money.refunded > 0.005
          ? `${formatTL(Math.round(money.refunded))} müşteriye iade edildi`
          : cancelledSummary.retained > 0
            ? `${formatTL(Math.round(cancelledSummary.retained))} iptalden kaldı`
            : salesSummary.total > 0
              ? `satışın %${Math.min(100, Math.round((salesSummary.paid / salesSummary.total) * 100))}'i`
              : 'tahsilat yok',
      icon: Wallet,
      tone: 'text-emerald-700',
    },
    {
      label: 'Açık Borç',
      /*
       * TEK ANLIK GÖRÜNTÜ: bu kart `customer.debt`i (SUNUCUNUN hesabı, LİSTE isteğiyle gelmiş)
       * gösteriyordu; yanındaki iki kart ise modalın KENDİ `accounts` isteğinden türüyordu.
       * İki ayrı okuma = iki ayrı an: liste çekildikten sonra bir tahsilat girilirse üçlü
       * "Harcama − Tahsil ≈ Borç" bağıntısı tam o tahsilat kadar tutmuyordu.
       * Aynı modalın tahsilat panelinde zaten `totalDebt` kullanılıyordu; yani modal kendi
       * içinde İKİ FARKLI borç rakamı gösterebiliyordu.
       *
       * Kalan "≈" farkı artık yalnız BİLİNEN ve İSTENEN sebepten: açık borç cari BAŞINA
       * sıfırla sınırlanır (fazla ödeme alacak olur, başka satışın borcunu silmez).
       */
      value: accountsLoading ? '—' : formatTL(Math.round(totalDebt)),
      sub: accountsLoading ? 'yükleniyor' : totalDebt > 0.005 ? 'adisyona git' : 'borç yok',
      icon: CreditCard,
      tone: totalDebt > 0.005 ? 'text-rose-700' : undefined,
      // Borç görünce yapılacak ilk şey adisyona bakmaktır — kart oraya götürsün.
      onClick: canAdisyon && totalDebt > 0.005 ? () => setTab('adisyon') : undefined,
    },
    // Satış listesi ayrı modalde: her sekmeden tek tıkla ulaşılsın diye KPI şeridinde duruyor.
    // Sayı İPTALLERİ SAYMAZ — "Toplam Harcama" da saymıyor; iptaller alt satırda ayrıca yazılır.
    // İptal adedi ARŞİVDEN gelir: iptal edilen satır canlı listede kalmaz, bu yüzden canlı
    // özetin `cancelled` sayacı gerçekte hep 0'dır.
    ...(hasSalesPanel
      ? [{
        label: 'Satışlar',
        value: accountsLoading ? '—' : String(salesCount),
        sub: accountsLoading
          ? 'yükleniyor'
          : cancelledSummary.count > 0
            ? `${cancelledSummary.count} iptal edildi`
            : salesCount > 0 ? 'listeyi aç' : 'kayıt yok',
        icon: Package,
        onClick: () => setSalesOpen(true),
      }]
      : []),
    { label: 'Son İşlem', value: fmtDateTR(customer.lastDate), sub: customer.lastService && customer.lastService !== '—' ? customer.lastService : undefined, icon: Clock, small: true },
  ]

  /**
   * İPTAL EDİLEN SATIŞLAR — artık Genel Bakış'ın sağ sütununda değil, SATIŞLAR MODALİNİN
   * içinde. Yeri orası: iptal edilmiş satış da bir satış kaydıdır, canlı listeyle yan yana
   * okunması gerekir; müşteri kartının sağ sütununda ise randevu/satış özetinin arasına
   * girip kartı uzatıyordu.
   *
   * Bu satırlar canlı `accounts` listesinde YOKTUR (iptalde `cancelled_sales` arşivine
   * taşınır); KPI'lardaki iptal sayısının arkasındaki kayıtlar başka hiçbir yerde görünmez.
   */
  const cancelledSalesCard = customerCancelled.length > 0 ? (
    <SectionCard
      title="İptal Edilen Satışlar"
      icon={Ban}
      action={<span className={`shrink-0 text-[11px] tabular-nums ${MUTED}`}>{customerCancelled.length} kayıt</span>}
    >
      <div className="space-y-2">
        {customerCancelled.map((c) => (
          <div key={c.id} className="rounded-[12px] border border-rose-200/70 bg-rose-50/50 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-[#2A2027]">{c.name}</div>
                <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${MUTED}`}>
                  <span className="tabular-nums">Satış {fmtDateTR(c.soldAtUtc)}</span>
                  <span className="tabular-nums">· İptal {fmtDateTR(c.cancelledAtUtc)}</span>
                </div>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-[12.5px] font-bold text-[#2A2027] tabular-nums">{formatTL(Math.round(c.totalAmount))}</span>
                <span className="block text-[10px] font-semibold text-rose-700">iptal edildi</span>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                Tahsil {formatTL(Math.round(c.collectedAmount))}
              </span>
              {c.refundedAmount > 0.005 && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                  İade {formatTL(Math.round(c.refundedAmount))}
                </span>
              )}
              {c.retainedAmount > 0.005 && (
                <span className="rounded-md border border-[#EAD8DF] bg-white px-1.5 py-0.5 text-[#8C4460]">
                  Kurumda kalan {formatTL(Math.round(c.retainedAmount))}
                </span>
              )}
              {c.soldByStaffName && (
                <span className="rounded-md border border-[#EAD8DF] bg-white px-1.5 py-0.5 text-[#5A4B53]">
                  Satan: {c.soldByStaffName}
                </span>
              )}
            </div>
            {c.cancellationReason && (
              <div className={`mt-1.5 text-[11px] ${SEMI}`}>
                <span className="font-semibold">Gerekçe:</span> {c.cancellationReason}
              </div>
            )}

            {/* İPTALİ GERİ AL — Ön Muhasebe'deki akışın aynısı. İade varsa
                önce "para gerçekten ödendi mi?" sorulur: geri alma, müşteriye
                fiilen ödenmiş bir parayı kendiliğinden "olmamış" sayamaz. */}
            {onRestoreCancelledSale && (
              restoreConfirmId === c.id ? (
                <div className="mt-2 rounded-[11px] border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-amber-900">
                    Bu iptalde müşteriye {formatTL(Math.round(c.refundedAmount))} iade edilmişti. Para gerçekten ödendi mi?
                  </p>
                  <p className="mt-1 text-[10.5px] text-amber-800">
                    &quot;Evet&quot; derseniz kasa çıkışı korunur ve bu tutar müşteri borcuna geri yazılır.
                  </p>
                  <input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Yanlış girildiyse gerekçe yazın (ör. iade fiilen yapılmadı)"
                    className="mt-2 w-full rounded-[9px] border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-[#2A2027] outline-none focus:border-amber-400 placeholder:text-[#74616A]"
                  />
                  {restoreError && <p className="mt-1 text-[10.5px] font-semibold text-rose-700">{restoreError}</p>}
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setRestoreConfirmId(null); setVoidReason(''); setRestoreError('') }}
                      className="cursor-pointer rounded-[9px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#74616A]"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      disabled={restoringId === c.id}
                      onClick={() => void restoreCancelled(c.originalAccountId, c.id, true)}
                      className="cursor-pointer rounded-[9px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] disabled:opacity-60"
                    >
                      Hayır, yanlış girilmiş — iadeyi de geri al
                    </button>
                    <button
                      type="button"
                      disabled={restoringId === c.id}
                      onClick={() => void restoreCancelled(c.originalAccountId, c.id, false)}
                      className="cursor-pointer rounded-[9px] bg-[#a34a62] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                    >
                      Evet, ödendi — kasa çıkışı kalsın
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {restoreError && restoringId === null && (
                    <span className="text-[10.5px] font-semibold text-rose-700">{restoreError}</span>
                  )}
                  <button
                    type="button"
                    disabled={restoringId === c.id}
                    onClick={() => {
                      // İade yoksa soracak bir şey yok; doğrudan geri al.
                      setRestoreError('')
                      if (c.refundedAmount > 0.005) { setRestoreConfirmId(c.id); setVoidReason(''); return }
                      void restoreCancelled(c.originalAccountId, c.id, false)
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6] disabled:opacity-60"
                  >
                    <RotateCcw className={`h-3 w-3 ${restoringId === c.id ? 'animate-spin' : ''}`} /> İptali geri al
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  ) : null

  return (
    <ModalPortal>
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto p-2 sm:items-center sm:p-4 xl:p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Kapat"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-[#2a141f]/45 backdrop-blur-[3px]"
          />

          {/* Panel — masaüstünde sabit yükseklikli tezgâh, mobilde içeriğe göre büyür. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${customer.name} müşteri detayı`}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            /* Genişlik 1440 → 1760: bu turda KPI şeridi 6 karta çıkınca başlıkta ad/soyad ile
               kartlar aynı satırda yarışmaya başladı ve uzun isimler kırpılıyordu. Geniş
               ekranda ikisi de tam sığar; dar ekranda zaten alt alta iner (xl:flex-row). */
            className="relative z-10 my-auto flex max-h-[96dvh] w-full max-w-[1760px] flex-col overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)] sm:rounded-[26px] lg:h-[92dvh]"
          >
            {/* HEADER */}
            <header className="relative shrink-0 overflow-hidden border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-4 pb-0 pt-3.5 sm:px-6 sm:pt-4">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-[#f0aac2]/25 blur-3xl" />
              <button
                type="button"
                onClick={onClose}
                aria-label="Kapat"
                className="absolute right-3.5 top-3.5 z-20 grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] shadow-sm transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
              >
                <X className="h-4 w-4" />
              </button>

              {/*
                YAN YANA YERLEŞİM 2XL'DEN İTİBAREN. Daha erken denendiğinde kimlik bloğu eziliyordu:
                KPI kartlarının alt satırları `truncate` (yani `white-space:nowrap`) olduğu için
                şeridin MAX-CONTENT genişliği son işlem adı kadar (~1600px) çıkıyor, `shrink-0`
                ile de bu genişlik dayatılıyordu. Sonuç: ad iki satıra kırılıyor, telefon/e-posta
                kartların ALTINDA kalıyor ve son kart modalın dışına taşıyordu.
                Çözüm iki yerde: şerit artık esner (`min-w-0` + `flex-1`, taban genişliği sıfır)
                ve dar ekranda kendi satırına iner.
              */}
              <div className="relative flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between 2xl:gap-5 2xl:pr-12">
                {/* Kimlik */}
                <div className="flex min-w-0 items-center gap-3.5 pr-10 2xl:pr-0">
                  <label title="Fotoğraf yükle" className="group relative grid h-14 w-14 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-[#BE7690] bg-gradient-to-br from-[#3a1a2a] to-[#A5556E] font-display text-lg text-white sm:h-16 sm:w-16 sm:text-xl">
                    {detailPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={detailPhoto} alt={customer.name} className="h-full w-full object-cover" />
                    ) : <span>{initials}</span>}
                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-[10px] font-semibold uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100">Değiştir</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadPhoto(f); e.target.value = '' }} />
                  </label>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* AD KIRPILMAZ: uzun ad-soyad "Ayşe Nur Yıldırımoğ…" gibi kesiliyordu.
                          `truncate` yerine sarma — yer darsa ikinci satıra iner, kimlik hep
                          tam okunur (rozetler zaten flex-wrap ile alta geçiyor). */}
                      <h2 className="min-w-0 font-display text-xl leading-tight tracking-tight text-[#2A2027] sm:text-2xl" title={customer.name}>{customer.name}</h2>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${active90 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#EAD8DF] bg-white text-[#74616A]'}`}>
                        {active90 ? 'Aktif Müşteri' : 'Pasif'}
                      </span>
                      {customer.isVip && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e5c46a] bg-[#fdf6e3] px-2 py-0.5 text-[10.5px] font-bold text-[#8a6718]">
                          <Crown className="h-3 w-3 fill-[#e5c46a] text-[#c9a13c]" /> VIP
                        </span>
                      )}
                      {customer.isBlacklisted && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-600"><Ban className="h-3 w-3" /> Kara liste</span>
                      )}
                      {/* Doğum günü yaklaşıyorsa göster — salonun kutlama/kampanya fırsatı. */}
                      {birthdayIn !== null && birthdayIn <= 14 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#d9b3e8] bg-[#f8f0fc] px-2 py-0.5 text-[10.5px] font-bold text-[#6d4187]">
                          <Cake className="h-3 w-3" />
                          {birthdayIn === 0 ? 'Bugün doğum günü!' : `Doğum günü ${birthdayIn} gün sonra`}
                        </span>
                      )}
                    </div>
                    {/* İletişim satırı TIKLANABİLİR: personel gün boyu müşteri arar; düz metinden
                        numarayı elle çevirmek zaman kaybıydı. Yanındaki simge panoya kopyalar. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                      {customer.phone && (
                        <span className="flex items-center gap-1">
                          <a
                            href={telHref(customer.phone)}
                            className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] ${SEMI}`}
                            title="Ara"
                          >
                            <Phone className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> {customer.phone}
                          </a>
                          <button
                            type="button"
                            onClick={() => void copyToClipboard(customer.phone, 'phone')}
                            title="Numarayı kopyala"
                            className={`grid h-6 w-6 cursor-pointer place-items-center rounded-md transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] ${MUTED}`}
                          >
                            {copied === 'phone' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </span>
                      )}
                      {customer.email ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <a
                            href={`mailto:${customer.email}`}
                            className={`flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] ${SEMI}`}
                            title="E-posta gönder"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> <span className="truncate">{customer.email}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => void copyToClipboard(customer.email, 'email')}
                            title="E-postayı kopyala"
                            className={`grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] ${MUTED}`}
                          >
                            {copied === 'email' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </span>
                      ) : (
                        <span className={`flex items-center gap-1.5 px-1 ${MUTED}`}><Mail className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> —</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPI şeridi — telefonda 2, tablette 3, dizüstünden itibaren tek sıra.
                    `min-w-0` + `2xl:flex-1`: şerit kalan yeri alır, içeriği kadar YER KAPLAMAZ. */}
                <div className={`grid w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 2xl:flex-1 ${hasSalesPanel ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
                  {kpis.map((k) => {
                    const Tag = k.onClick ? 'button' : 'div'
                    return (
                      <Tag
                        key={k.label}
                        {...(k.onClick ? { type: 'button' as const, onClick: k.onClick, title: 'Ayrıntıya git' } : {})}
                        /* Asgari genişlik YOK: şerit artık esnek bir ızgara: `min-w-[118px]`
                           dayatınca kart kendi kanalını taşırıp komşusunun üstüne biniyordu.
                           Uzun tutarlar `truncate` ile kırpılır, tamamı `title`'da durur. */
                        className={`min-w-0 rounded-[14px] border border-[#EAD8DF] bg-white/80 px-3 py-2 text-left ${
                          k.onClick ? 'cursor-pointer transition-colors hover:border-[#BE7690] hover:bg-white' : ''
                        }`}
                      >
                        <div className={`truncate text-[10px] font-bold uppercase tracking-wider ${MUTED}`}>{k.label}</div>
                        <div title={k.value} className={`mt-0.5 truncate font-display tracking-tight tabular-nums ${k.small ? 'text-[13.5px]' : 'text-lg'} ${k.tone || 'text-[#2A2027]'}`}>{k.value}</div>
                        {k.sub && <div title={k.sub} className={`truncate text-[10.5px] ${MUTED}`}>{k.sub}</div>}
                      </Tag>
                    )
                  })}
                </div>
              </div>

              {/* Sekmeler — sol/sağ ok tuşuyla gezilebilir, ekran okuyucu için rol/durum bildirilir. */}
              <div
                role="tablist"
                aria-label="Müşteri kartı sekmeleri"
                className="relative mt-3 flex gap-1 overflow-x-auto"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                  e.preventDefault()
                  const i = TABS.findIndex((t) => t.key === tab)
                  const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length
                  setTab(TABS[next].key)
                }}
              >
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    tabIndex={tab === t.key ? 0 : -1}
                    onClick={() => setTab(t.key)}
                    className={`relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[10px] px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? 'text-[#A5556E]' : `${MUTED} hover:text-[#2A2027]`}`}
                  >
                    {t.label}
                    {typeof t.count === 'number' && t.count > 0 && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${tab === t.key ? 'bg-[#A5556E] text-white' : 'bg-[#f3e9ed] text-[#74616A]'}`}>
                        {t.count}
                      </span>
                    )}
                    {t.dot && <span className="h-1.5 w-1.5 rounded-full bg-[#A5556E]" title="Not var" />}
                    {tab === t.key && <motion.span layoutId="cdm-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#A5556E]" />}
                  </button>
                ))}
              </div>
            </header>

            {/* BODY */}
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto bg-[#fbf4f7] p-3.5 sm:p-5">
              {/* Onam formu uyarısı — hangi sekmede olursa olsun görünür (eksik yoksa çizilmez). */}
              <ConsentWarningBanner
                customerId={customer.id}
                customerName={customer.name}
                className="mb-4"
              />

              {tab === 'overview' && (
                /* 12 sütunluk yerleşim: telefonda tek, tablette 2, geniş ekranda 3+5+4 sütun.
                   `items-start`: sütunlar en uzun sütuna göre gerilip kartların içini boş
                   bırakmasın (satış özeti kartı devasa görünüyordu). */
                <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-12">
                  {/* SOL: Müşteri bilgileri + hızlı işlemler */}
                  {/* min-w-0 ZORUNLU: ızgara hücresinin varsayılan `min-width:auto` değeri,
                      içerideki en geniş satırın min-content'i kadar taban genişlik dayatır.
                      Telefonda (360px) bu, sütunu 385px'e şişirip modalı 71px taşırıyordu —
                      sağdaki kartlar kırpılıyordu. min-w-0 hücrenin daralmasına izin verir. */}
                  <div className="min-w-0 space-y-4 xl:col-span-3">
                    <SectionCard title="Müşteri Bilgileri" icon={User} action={editSlot}>
                      <div className="divide-y divide-[#F1E7EB]">
                        <InfoRow label="Ad Soyad" value={customer.name} />
                        <InfoRow label="Telefon" value={customer.phone} />
                        <InfoRow label="E-posta" value={customer.email || '—'} />
                        <InfoRow
                          label="Doğum Tarihi"
                          value={isDate(customer.joined) ? (
                            <span className="inline-flex items-center gap-1.5">
                              {fmtDateTR(customer.joined)}
                              {birthdayIn !== null && birthdayIn <= 30 && (
                                <span className="rounded-full bg-[#f8f0fc] px-1.5 py-0.5 text-[10.5px] font-bold text-[#6d4187]">
                                  {birthdayIn === 0 ? 'bugün' : `${birthdayIn} gün`}
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        />
                        {/* KAYIT TARİHİ ≠ doğum tarihi. "Bu müşteri bizde ne kadardır var?" sorusu
                            kartta hiç cevaplanmıyordu; yanına kaçıncı yılı olduğu yazılır. */}
                        <InfoRow
                          label="Kayıt Tarihi"
                          value={customer.createdAt && isDate(customer.createdAt) ? (
                            <span className="inline-flex items-center gap-1.5">
                              {fmtDateTR(customer.createdAt)}
                              {membershipLabel && (
                                <span className="rounded-full bg-[#F6DFE6] px-1.5 py-0.5 text-[10.5px] font-bold text-[#8C4460]">
                                  {membershipLabel}
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        />
                        <InfoRow label="Cinsiyet" value={genderLabel(customer.gender)} />
                        <InfoRow label="KVKK" value={<span className={kvkkOk ? 'text-emerald-700' : 'text-amber-700'}>{kvkkOk ? 'Onaylı' : 'Onaysız'}</span>} />
                        <InfoRow label="Müşteri No" value={<span className="text-[11.5px] tracking-wide">{customer.id.slice(0, 8)}</span>} />
                      </div>
                    </SectionCard>

                    <SectionCard title="Hızlı İşlemler" icon={Sparkles}>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={onCreateAppointment}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5 text-[12.5px] font-semibold text-[#2A2027] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                        >
                          <span className="flex min-w-0 items-center gap-2"><CalendarPlus className="h-4 w-4 shrink-0 text-[#A5556E]" /> <span className="truncate">Randevu Oluştur</span></span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#c9b3bd]" />
                        </button>
                        {saleSlot}
                        {/* Tahsilat: yalnızca açık borç varsa. Kalan borç butonda görünür ki
                            kullanıcı modalı açmadan ne kadar tahsil edeceğini bilsin. */}
                        {canCollect && (
                          <button
                            type="button"
                            onClick={() => setCollectOpen(true)}
                            className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100/70"
                          >
                            <span className="flex min-w-0 items-center gap-2"><Wallet className="h-4 w-4 shrink-0 text-emerald-600" /> <span className="truncate">Tahsilat Al</span></span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="font-display text-[12px] tabular-nums text-emerald-700">{formatTL(Math.round(totalDebt))}</span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-emerald-300" />
                            </span>
                          </button>
                        )}
                        {hasSalesPanel && (
                          <button
                            type="button"
                            onClick={() => setSalesOpen(true)}
                            className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5 text-[12.5px] font-semibold text-[#2A2027] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                          >
                            <span className="flex min-w-0 items-center gap-2"><Package className="h-4 w-4 shrink-0 text-[#A5556E]" /> <span className="truncate">Satışları Görüntüle</span></span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-[#c9b3bd]" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setTab('notes')}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5 text-[12.5px] font-semibold text-[#2A2027] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                        >
                          <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-[#A5556E]" /> <span className="truncate">Not Ekle</span></span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#c9b3bd]" />
                        </button>
                        {/* Kart müşteriye ELDEN verilmiş olur; burada QR okutulup hesabına bağlanır. */}
                        {onAssignGiftCard && (
                          <button
                            type="button"
                            onClick={onAssignGiftCard}
                            className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5 text-[12.5px] font-semibold text-[#2A2027] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                          >
                            <span className="flex min-w-0 items-center gap-2"><QrCode className="h-4 w-4 shrink-0 text-[#A5556E]" /> <span className="truncate">Hediye Kartı Tanımla</span></span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-[#c9b3bd]" />
                          </button>
                        )}
                        <CustomerVipToggle variant="row" customerId={customer.id} tenantId={tenantId} isVip={Boolean(customer.isVip)} onChanged={onReload} />
                        <button
                          type="button"
                          onClick={onDelete}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[12.5px] font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100/70"
                        >
                          <span className="flex min-w-0 items-center gap-2"><Trash2 className="h-4 w-4 shrink-0" /> <span className="truncate">{isStaff ? 'Silme onayına gönder' : 'Müşteriyi Sil'}</span></span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-rose-300" />
                        </button>
                      </div>
                    </SectionCard>
                  </div>

                  {/* ORTA: Grafikler */}
                  <div className="min-w-0 space-y-4 xl:col-span-5">
                    <SectionCard title="Harcamaların Zaman İçindeki Dağılımı" icon={TrendingUp}>
                      <MiniLineChart values={spendValues} labels={spendLabels} />
                      <div className={`mt-2 flex items-center justify-between border-t border-[#f4e7ec] pt-2 text-[11.5px] ${MUTED}`}>
                        <span>Son 6 ay tahsilat</span>
                        <span className="font-display text-[15px] tabular-nums text-[#A5556E]">{formatTL(spendValues.reduce((s, v) => s + v, 0))}</span>
                      </div>
                    </SectionCard>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <SectionCard title="İşlem Dağılımı" icon={Scissors}>
                        <MiniDonut segments={serviceSegments} centerLabel="işlem" centerValue={String(completedCount)} formatValue={(v) => `${v}×`} />
                      </SectionCard>
                      <SectionCard title="Ödeme Tercihleri" icon={PieChart}>
                        <MiniDonut segments={paymentSegments} centerLabel="tahsilat" centerValue={paymentTotal > 0 ? formatTL(paymentTotal) : '—'} formatValue={formatTL} />
                      </SectionCard>
                    </div>
                  </div>

                  {/* SAĞ: Satış özeti + son randevular (tablette yan yana, geniş ekranda alt alta) */}
                  <div className="grid min-w-0 content-start gap-4 md:col-span-2 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
                    {hasSalesPanel && <SalesSummaryCard summary={salesSummary} onOpen={() => setSalesOpen(true)} />}

                    <SectionCard
                      title="Son Randevular"
                      icon={CalendarPlus}
                      action={customerAppts.length > 6 ? <button type="button" onClick={() => setTab('appointments')} className="shrink-0 cursor-pointer text-[11px] font-bold text-[#A5556E] hover:underline">Tümünü gör</button> : undefined}
                    >
                      <div className="space-y-2">
                        {customerAppts.length === 0 ? (
                          <div className={`rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-6 text-center text-[11.5px] ${MUTED}`}>Randevu kaydı yok.</div>
                        ) : customerAppts.slice(0, 6).map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-[12.5px] font-medium text-[#2A2027]">{a.islem}</div>
                              <div className={`flex items-center gap-2 text-[11px] ${MUTED}`}>
                                <span className="tabular-nums">{a.date}</span>
                                {a.personel && <span className="flex items-center gap-0.5"><User className="h-3 w-3 text-[#A5556E]" /> {a.personel}</span>}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[a.status] || 'bg-slate-50 text-slate-600 border-slate-200/60'}`}>
                              {STATUS_LABEL[a.status] || a.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}

              {tab === 'appointments' && (
                <div className="space-y-4">
                  <CustomerSessionsCard customerId={customer.id} tenantId={tenantId} refreshKey={sessRefresh} />
                  {/* Seans bakiyesi "kaç kaldı"yı söyler; bu panel HANGİ GÜN kullanıldığını,
                      işlem geçmişini ve ödeme listesini tablo olarak verir (randevu modalıyla
                      aynı bileşen). */}
                  <CustomerHistoryPanel
                    customerId={customer.id}
                    tenantId={tenantId}
                    accounts={customerAccounts}
                    refreshKey={sessRefresh}
                  />
                  <SectionCard
                    title="Randevu Geçmişi"
                    icon={CalendarPlus}
                    action={customerAppts.length > 0 ? (
                      <span className={`shrink-0 text-[11px] tabular-nums ${MUTED}`}>
                        {filteredAppts.length === customerAppts.length
                          ? `${customerAppts.length} kayıt`
                          : `${filteredAppts.length} / ${customerAppts.length} kayıt`}
                      </span>
                    ) : undefined}
                  >
                    {/* Süzgeç — yıllardır gelen müşteride liste onlarca satır oluyor, aranmadan bulunmuyordu. */}
                    {customerAppts.length > 4 && (
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <div className="relative min-w-[220px] flex-1">
                          <Search className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${MUTED}`} />
                          <input
                            value={apptQuery}
                            onChange={(e) => setApptQuery(e.target.value)}
                            placeholder="İşlem, personel veya tarih ara…"
                            className="w-full rounded-[10px] border border-[#EAD8DF] bg-[#F7F6F6] py-2 pl-8 pr-8 text-[12.5px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E] placeholder:text-[#74616A]"
                          />
                          {apptQuery && (
                            <button
                              type="button"
                              onClick={() => setApptQuery('')}
                              aria-label="Aramayı temizle"
                              className={`absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] ${MUTED}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {APPT_FILTERS.map((f) => {
                            const n = f.key === 'all' ? customerAppts.length : (apptStatusCounts[f.key] ?? 0)
                            if (f.key !== 'all' && n === 0) return null
                            const on = apptStatus === f.key
                            return (
                              <button
                                key={f.key}
                                type="button"
                                onClick={() => setApptStatus(f.key)}
                                className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                                  on
                                    ? 'border-[#8C4460] bg-[#A5556E] text-white'
                                    : `border-[#EAD8DF] bg-white hover:border-[#BE7690] hover:text-[#2A2027] ${MUTED}`
                                }`}
                              >
                                {f.label} <span className="tabular-nums opacity-70">{n}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {/* Geniş modalda randevu geçmişi iki sütuna açılır. */}
                    <div className="grid gap-1.5 2xl:grid-cols-2">
                      {customerAppts.length === 0 ? (
                        <div className={`rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-6 text-center text-[11.5px] 2xl:col-span-2 ${MUTED}`}>Randevu kaydı yok.</div>
                      ) : filteredAppts.length === 0 ? (
                        <div className={`rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-6 text-center text-[11.5px] 2xl:col-span-2 ${MUTED}`}>
                          Süzgeçle eşleşen randevu yok.
                          <button
                            type="button"
                            onClick={() => { setApptQuery(''); setApptStatus('all') }}
                            className="ml-1.5 cursor-pointer font-bold text-[#A5556E] hover:underline"
                          >
                            Temizle
                          </button>
                        </div>
                      ) : filteredAppts.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#A5556E] text-white"><CalendarPlus className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="truncate text-[12.5px] font-medium text-[#2A2027]">{a.islem}</div>
                              <div className={`flex items-center gap-2 text-[11px] ${MUTED}`}>
                                <span className="tabular-nums">{a.date} · {a.time}</span>
                                {a.personel && <span className="flex items-center gap-0.5"><User className="h-3 w-3 text-[#A5556E]" /> {a.personel}</span>}
                              </div>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[a.status] || 'bg-slate-50 text-slate-600 border-slate-200/60'}`}>
                            {STATUS_LABEL[a.status] || a.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </div>
              )}

              {tab === 'adisyon' && canAdisyon && (
                <div className="space-y-4">
                  <AdisyonPanel customerId={customer.id} tenantId={tenantId} onChanged={onReloadWithSessions} />
                  <CustomerOperationsJournal customerId={customer.id} tenantId={tenantId} appointments={appts} accounts={accounts} refreshKey={sessRefresh} />
                </div>
              )}

              {tab === 'health' && (
                <div className="space-y-4">
                  {/* Sağlık sekmesinde tamam durumunu da göster: personel imzalı belgelere buradan ulaşır. */}
                  <ConsentWarningBanner customerId={customer.id} customerName={customer.name} showWhenComplete />
                  <ConsultationForm customerId={customer.id} tenantId={tenantId} branchId={customer.branchId} />
                  <TreatmentJournal customerId={customer.id} tenantId={tenantId} />
                </div>
              )}

              {tab === 'notes' && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <SectionCard
                    title="Müşteri Notu"
                    icon={FileText}
                    /* Kayıt sessizdi: personel notun gidip gitmediğini göremiyordu. */
                    action={noteState === 'saving' ? (
                      <span className={`flex shrink-0 items-center gap-1 text-[11px] ${MUTED}`}><Loader2 className="h-3 w-3 animate-spin" /> Kaydediliyor</span>
                    ) : noteState === 'saved' ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-600"><Check className="h-3 w-3" /> Kaydedildi</span>
                    ) : undefined}
                  >
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onBlur={() => void saveNote(noteDraft)}
                      rows={7}
                      placeholder="Tercih, cilt tipi, alerji, kampanya isteği vb."
                      className="w-full resize-none rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E] placeholder:text-[#74616A]"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className={`text-[11px] ${MUTED}`}>Alandan çıkınca otomatik kaydedilir.</span>
                      {noteDraft !== (customer.notes || '') && (
                        <button
                          type="button"
                          onClick={() => void saveNote(noteDraft)}
                          className="cursor-pointer rounded-[9px] bg-[#A5556E] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          Kaydet
                        </button>
                      )}
                    </div>
                  </SectionCard>

                  {canBlacklist && (
                    <CustomerBlacklistCard customerId={customer.id} tenantId={tenantId} isBlacklisted={Boolean(customer.isBlacklisted)} reason={customer.blacklistReason ?? undefined} onChanged={onReload} />
                  )}
                </div>
              )}
            </div>

            {/* FOOTER */}
            {/* Telefonda üç düğme tek satıra sığmıyordu (sıkışıp yazılar sarıyordu): dar ekranda
                düğmeler tam genişlikte alt alta, sm'den itibaren tek sıra. */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#EAD8DF] bg-white/80 px-4 py-3 sm:px-6">
              <span className={`hidden min-w-0 items-center gap-1.5 text-[11.5px] sm:flex ${MUTED}`}>
                <ReceiptText className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> <span className="truncate">{customer.lastService && customer.lastService !== '—' ? `Son işlem: ${customer.lastService}` : 'Danışan kartı'}</span>
              </span>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
                {hasSalesPanel && (
                  <button
                    type="button"
                    onClick={() => setSalesOpen(true)}
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#EAD8DF] bg-white px-3.5 py-2 text-[12.5px] font-semibold transition-colors hover:border-[#BE7690] hover:text-[#A5556E] ${SEMI}`}
                  >
                    <Package className="h-3.5 w-3.5 text-[#A5556E]" /> Satışlar
                    {salesSummary.count > 0 && <span className="rounded-full bg-[#F6DFE6] px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-[#a34a62]">{salesSummary.count}</span>}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-[10px] border border-[#EAD8DF] bg-white px-4 py-2 text-[12.5px] font-semibold transition-colors hover:bg-[#F7F6F6] ${SEMI}`}
                >
                  Kapat
                </button>
                <button
                  type="button"
                  onClick={onCreateAppointment}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#A5556E] px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Randevu Oluştur
                </button>
              </div>
            </footer>
          </motion.div>

          {/* Paket & hizmet satışları — müşteri kartının üstünde açılan geniş liste modalı. */}
          {hasSalesPanel && (
            <CustomerSalesModal
              open={salesOpen}
              onClose={() => setSalesOpen(false)}
              customerName={customer.name}
              summary={salesSummary}
              cancelledCount={cancelledSummary.count}
              cancelledSlot={cancelledSalesCard}
            >
              {salesPanel}
            </CustomerSalesModal>
          )}

          {/* Tahsilat — Ön Muhasebe ve Günlük Kasa ile AYNI modal; yalnızca bu müşterinin
              açık borçlu carileri listelenir, ilki ön-seçili gelir. */}
          {canCollect && onCollectPayment && (
            <CollectionDialog
              accounts={collectableAccounts}
              initialAccountId={collectableAccounts[0]?.id ?? null}
              open={collectOpen}
              onOpenChange={setCollectOpen}
              hideTrigger
              title={`Tahsilat Al · ${customer.name}`}
              description="Cariyi seçin, tutar kalan borca göre önerilir."
              onSubmit={onCollectPayment}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
    </ModalPortal>
  )
}
