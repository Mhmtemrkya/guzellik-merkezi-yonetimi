'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Ban, CalendarPlus, Clock, CreditCard, Crown, FileText, Mail, Phone, PieChart,
  ReceiptText, Scissors, Sparkles, Trash2, TrendingUp, User, Wallet, X,
} from 'lucide-react'
import CustomerSessionsCard from '@/components/dashboard/CustomerSessionsCard'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'
import CustomerOperationsJournal from '@/components/dashboard/CustomerOperationsJournal'
import TreatmentJournal from '@/components/dashboard/TreatmentJournal'
import ConsultationForm from '@/components/dashboard/ConsultationForm'
import CustomerBlacklistCard from '@/components/dashboard/CustomerBlacklistCard'
import CustomerVipToggle from '@/components/dashboard/CustomerVipToggle'
import { formatTL } from '@/lib/apiMappers'
import type { Appointment, CustomerAccount } from '@/lib/types'

export interface CustomerModalData {
  id: string
  name: string
  phone: string
  email: string
  photoUrl?: string
  tier: string
  gender?: string
  joined: string
  notes?: string
  debt: number
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
const DONUT_COLORS = ['#c85776', '#7c5cbf', '#2fae8e', '#e8932f', '#4a9fe0', '#d65a8e']

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
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-28 w-full overflow-visible">
        <defs>
          <linearGradient id="cdm-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c85776" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#c85776" stopOpacity="0" />
          </linearGradient>
        </defs>
        {!allZero && <polygon points={area} fill="url(#cdm-spark)" />}
        <polyline
          points={line}
          fill="none"
          stroke="#c85776"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.4" fill="#c85776" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] font-mono uppercase tracking-wide text-[#352432]/35">
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
      <div className="relative mx-auto h-[122px] w-[122px]">
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
          <span className="font-display text-[18px] leading-none tracking-tight text-[#352432]">{centerValue}</span>
          <span className="mt-0.5 text-[8px] font-mono uppercase tracking-wide text-[#352432]/40">{centerLabel}</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {segments.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-3 text-center text-[11px] text-[#352432]/40">Veri yok</div>
        ) : segments.map((seg, i) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
          return (
            <div key={i}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5 text-[#352432]/75">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: seg.color }} />
                  <span className="truncate">{seg.label}</span>
                  {seg.sub && <span className="shrink-0 text-[9px] text-[#352432]/40">· {seg.sub}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums">
                  {formatValue && <span className="text-[#352432]/55">{formatValue(seg.value)}</span>}
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${seg.color}1f`, color: seg.color }}>%{pct}</span>
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
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-[#352432]/45">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-[#352432]">{value}</span>
    </div>
  )
}

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: typeof User; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-[#ead8df]/70 bg-white p-4 shadow-[0_14px_40px_-36px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/**
 * Müşteri Detay Modalı — salon yönetim panelinde danışan kartının zengin, sekmeli görünümü.
 * Genel bakış (bilgi + grafikler + son randevular + hızlı işlemler) ve operasyonel sekmeler
 * (randevu/seans, adisyon/işlem defteri, sağlık/günlük, notlar) tek modalda toplanır.
 */
export default function CustomerDetailModal({
  open,
  onClose,
  customer,
  detailPhoto,
  tenantId,
  appts,
  accounts,
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
  editSlot,
  saleSlot,
}: {
  open: boolean
  onClose: () => void
  customer: CustomerModalData | undefined
  detailPhoto: string | null
  tenantId?: string
  appts: Appointment[]
  accounts: CustomerAccount[]
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
  editSlot?: ReactNode
  saleSlot?: ReactNode
}) {
  const [tab, setTab] = useState<TabKey>('overview')
  const [noteDraft, setNoteDraft] = useState('')

  // Modal açıldığında / müşteri değiştiğinde sekmeyi ve notu tazele.
  useEffect(() => {
    if (open) {
      setTab('overview')
      setNoteDraft(customer?.notes || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id])

  // Esc ile kapat + arka plan kaydırmasını kilitle.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const cid = customer?.id

  const customerAppts = useMemo(
    () => appts.filter((a) => a.customerId === cid).sort((x, y) => `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`)),
    [appts, cid],
  )
  const customerAccounts = useMemo(() => accounts.filter((a) => a.customerId === cid), [accounts, cid])

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
  const paymentSegments = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>()
    for (const a of customerAccounts) {
      for (const p of a.payments) {
        const k = p.method?.trim() || 'Diğer'
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

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Genel Bakış' },
    { key: 'appointments', label: 'Randevu & Seans' },
    ...(canAdisyon ? [{ key: 'adisyon' as TabKey, label: 'Adisyon & İşlemler' }] : []),
    { key: 'health', label: 'Sağlık & Günlük' },
    { key: 'notes', label: 'Notlar' },
  ]

  const kpis = [
    { label: 'Toplam Randevu', value: String(customer.apptCount), icon: CalendarPlus },
    { label: 'Toplam Harcama', value: formatTL(customer.spent), icon: Wallet },
    { label: 'Açık Borç', value: formatTL(customer.debt), icon: CreditCard, tone: customer.debt > 0 ? 'text-rose-700' : undefined },
    { label: 'Son İşlem', value: customer.lastDate || '—', icon: Clock, small: true },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
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

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${customer.name} müşteri detayı`}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto flex max-h-[94dvh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[24px] border border-[#ead8df] bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            {/* HEADER */}
            <header className="relative shrink-0 overflow-hidden border-b border-[#ead8df]/80 bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4 sm:px-6">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#f0aac2]/25 blur-3xl" />
              <button
                type="button"
                onClick={onClose}
                aria-label="Kapat"
                className="absolute right-4 top-4 z-20 grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#ead8df] bg-white text-[#352432]/55 shadow-sm transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:pr-12">
                {/* Kimlik */}
                <div className="flex items-center gap-3.5 pr-10">
                  <label title="Fotoğraf yükle" className="group relative grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-[#efbfd0]/70 bg-gradient-to-br from-[#3a1a2a] to-[#c85776] font-display text-xl text-white">
                    {detailPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={detailPhoto} alt={customer.name} className="h-full w-full object-cover" />
                    ) : <span>{initials}</span>}
                    <span className="absolute inset-0 grid place-items-center bg-black/40 text-[9px] font-medium uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100">Değiştir</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadPhoto(f); e.target.value = '' }} />
                  </label>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl leading-tight tracking-tight text-[#352432]">{customer.name}</h2>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${active90 ? 'border-emerald-200/70 bg-emerald-50 text-emerald-700' : 'border-[#ead8df] bg-white text-[#352432]/45'}`}>
                        {active90 ? 'Aktif Müşteri' : 'Pasif'}
                      </span>
                      {customer.isVip && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e5c46a]/70 bg-[#fdf6e3] px-2 py-0.5 text-[10px] font-semibold text-[#9a7420]">
                          <Crown className="h-3 w-3 fill-[#e5c46a] text-[#c9a13c]" /> VIP
                        </span>
                      )}
                      {customer.isBlacklisted && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600"><Ban className="h-3 w-3" /> Kara liste</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#352432]/60">
                      <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-[#c85776]/70" /> {customer.email || '—'}</span>
                      <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-[#c85776]/70" /> {customer.phone}</span>
                    </div>
                  </div>
                </div>

                {/* KPI şeridi */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
                  {kpis.map((k) => (
                    <div key={k.label} className="rounded-[14px] border border-[#ead8df]/70 bg-white/70 px-3 py-2">
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">{k.label}</div>
                      <div className={`mt-0.5 font-display tracking-tight tabular-nums ${k.small ? 'text-[13px]' : 'text-lg'} ${k.tone || 'text-[#352432]'}`}>{k.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sekmeler */}
              <div className="relative mt-4 flex gap-1 overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`relative shrink-0 cursor-pointer rounded-t-[10px] px-3.5 py-2 text-[12px] font-medium transition-colors ${tab === t.key ? 'text-[#c85776]' : 'text-[#352432]/50 hover:text-[#352432]/75'}`}
                  >
                    {t.label}
                    {tab === t.key && <motion.span layoutId="cdm-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#c85776]" />}
                  </button>
                ))}
              </div>
            </header>

            {/* BODY */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf4f7] p-4 sm:p-5">
              {tab === 'overview' && (
                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr_0.95fr]">
                  {/* SOL: Müşteri bilgileri + hızlı bilgi */}
                  <div className="space-y-4">
                    <SectionCard title="Müşteri Bilgileri" icon={User} action={editSlot}>
                      <div className="divide-y divide-[#f1e5ea]">
                        <InfoRow label="Ad Soyad" value={customer.name} />
                        <InfoRow label="Telefon" value={customer.phone} />
                        <InfoRow label="E-posta" value={customer.email || '—'} />
                        <InfoRow label="Doğum Tarihi" value={isDate(customer.joined) ? customer.joined : '—'} />
                        <InfoRow label="Cinsiyet" value={genderLabel(customer.gender)} />
                        <InfoRow label="KVKK" value={<span className={kvkkOk ? 'text-emerald-700' : 'text-amber-700'}>{kvkkOk ? 'Onaylı' : 'Bekliyor'}</span>} />
                        <InfoRow label="Müşteri No" value={<span className="font-mono text-[11px]">{customer.id.slice(0, 8)}</span>} />
                      </div>
                    </SectionCard>

                    <SectionCard title="Hızlı İşlemler" icon={Sparkles}>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={onCreateAppointment}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] px-3 py-2.5 text-[12px] font-medium text-[#352432] transition-colors hover:border-[#efbfd0] hover:bg-[#fff1f6]/60"
                        >
                          <span className="flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-[#c85776]" /> Randevu Oluştur</span>
                          <span className="text-[#352432]/30">→</span>
                        </button>
                        {saleSlot}
                        <button
                          type="button"
                          onClick={() => setTab('notes')}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] px-3 py-2.5 text-[12px] font-medium text-[#352432] transition-colors hover:border-[#efbfd0] hover:bg-[#fff1f6]/60"
                        >
                          <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-[#c85776]" /> Not Ekle</span>
                          <span className="text-[#352432]/30">→</span>
                        </button>
                        <CustomerVipToggle variant="row" customerId={customer.id} tenantId={tenantId} isVip={Boolean(customer.isVip)} onChanged={onReload} />
                        <button
                          type="button"
                          onClick={onDelete}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[12px] border border-rose-200/70 bg-rose-50/60 px-3 py-2.5 text-[12px] font-medium text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100/70"
                        >
                          <span className="flex items-center gap-2"><Trash2 className="h-4 w-4" /> {isStaff ? 'Silme onayına gönder' : 'Müşteriyi Sil'}</span>
                          <span className="text-rose-300">→</span>
                        </button>
                      </div>
                    </SectionCard>
                  </div>

                  {/* ORTA: Grafikler */}
                  <div className="space-y-4">
                    <SectionCard title="Harcamaların Zaman İçindeki Dağılımı" icon={TrendingUp}>
                      <MiniLineChart values={spendValues} labels={spendLabels} />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#352432]/50">
                        <span>Son 6 ay tahsilat</span>
                        <span className="font-display tabular-nums text-[#c85776]">{formatTL(spendValues.reduce((s, v) => s + v, 0))}</span>
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

                  {/* SAĞ: Son randevular */}
                  <div className="space-y-4">
                    <SectionCard title="Son Randevular" icon={CalendarPlus} action={customerAppts.length > 5 ? <button type="button" onClick={() => setTab('appointments')} className="cursor-pointer text-[10px] font-medium text-[#c85776] hover:underline">Tümünü Gör</button> : undefined}>
                      <div className="space-y-2">
                        {customerAppts.length === 0 ? (
                          <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11px] text-[#352432]/45">Randevu kaydı yok.</div>
                        ) : customerAppts.slice(0, 5).map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-medium text-[#352432]">{a.islem}</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-[#352432]/45">
                                <span className="font-mono">{a.date}</span>
                                {a.personel && <span className="flex items-center gap-0.5 text-[#b14d6c]/70"><User className="h-2.5 w-2.5" /> {a.personel}</span>}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-medium ${STATUS_TONE[a.status] || 'bg-slate-50 text-slate-600 border-slate-200/60'}`}>
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
                  <SectionCard title="Randevu Geçmişi" icon={CalendarPlus}>
                    <div className="space-y-1.5">
                      {customerAppts.length === 0 ? (
                        <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11px] text-[#352432]/45">Randevu kaydı yok.</div>
                      ) : customerAppts.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#fff1f6] text-[#c85776]"><CalendarPlus className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="truncate text-[12.5px] font-medium text-[#352432]">{a.islem}</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-[#352432]/45">
                                <span className="font-mono">{a.date} · {a.time}</span>
                                {a.personel && <span className="flex items-center gap-0.5 text-[#b14d6c]/70"><User className="h-2.5 w-2.5" /> {a.personel}</span>}
                              </div>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-medium ${STATUS_TONE[a.status] || 'bg-slate-50 text-slate-600 border-slate-200/60'}`}>
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
                  <ConsultationForm customerId={customer.id} tenantId={tenantId} branchId={customer.branchId} />
                  <TreatmentJournal customerId={customer.id} tenantId={tenantId} />
                </div>
              )}

              {tab === 'notes' && (
                <div className="space-y-4">
                  <SectionCard title="Müşteri Notu" icon={FileText}>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onBlur={() => onSaveNote(noteDraft)}
                      rows={4}
                      placeholder="Tercih, cilt tipi, alerji, kampanya isteği vb."
                      className="w-full resize-none rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#c85776] placeholder:text-[#352432]/35"
                    />
                    <div className="mt-1 text-[10px] text-[#352432]/40">Alandan çıkınca otomatik kaydedilir.</div>
                  </SectionCard>

                  {canBlacklist && (
                    <CustomerBlacklistCard customerId={customer.id} tenantId={tenantId} isBlacklisted={Boolean(customer.isBlacklisted)} reason={customer.blacklistReason ?? undefined} onChanged={onReload} />
                  )}
                </div>
              )}
            </div>

            {/* FOOTER */}
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#ead8df]/80 bg-white/70 px-5 py-3 sm:px-6">
              <span className="hidden items-center gap-1.5 text-[11px] text-[#352432]/45 sm:flex">
                <ReceiptText className="h-3.5 w-3.5 text-[#c85776]/60" /> {customer.lastService && customer.lastService !== '—' ? `Son işlem: ${customer.lastService}` : 'Danışan kartı'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="cursor-pointer rounded-[10px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-medium text-[#352432]/70 transition-colors hover:bg-[#fff4f8]"
                >
                  Kapat
                </button>
                <button
                  type="button"
                  onClick={onCreateAppointment}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-[#c85776] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Randevu Oluştur
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
