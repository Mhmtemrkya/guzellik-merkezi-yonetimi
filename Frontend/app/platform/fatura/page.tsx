'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, CalendarClock, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, CreditCard, Download, FileSignature, FileText, Loader2, Plus, Receipt, RefreshCw, Search, Send, Sparkles, Trash2,
  TrendingUp, Users, Wallet, XCircle, type LucideIcon,
} from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline from '@/components/dashboard/Sparkline'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import type {
  PlatformBillingOverview, PlatformInvoice, PlatformPaymentRow, PlatformSubscriptionRow, QuoteLine,
} from '@/lib/types'

/*
 * PLATFORM › FATURALAMA
 *
 * Tüm tutarlar SUNUCUDAN gelir: MRR / sonraki yenileme fiyatlama motoruyla (şube × birim + müşteri /
 * onam kademeleri), tahsilat ve açık alacak faturalardan (brüt + aynen saklanan net/KDV). Bu sayfa
 * hiçbir fiyatı kendisi hesaplamaz — yalnız gösterir ve süzer. Geçmiş faturalar tahsilat anındaki
 * kalem dökümüyle (anlık görüntü) açılır, sonradan yeniden hesaplanmaz.
 */

const gridVariant: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.04 } } }
const cardVariant: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
}

/** Kuruşlu TL — fatura ekranında yuvarlama yanıltıcı olur. */
const tl = (n: number | null | undefined) =>
  `₺${Number(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Büyük KPI rakamı (kuruşsuz). */
const tl0 = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const dateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

const STATUS: Record<string, { label: string; cls: string }> = {
  Active: { label: 'Aktif', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Trial: { label: 'Deneme', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  Suspended: { label: 'Askıda', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  Cancelled: { label: 'İptal', cls: 'border-[#e7d6dd] bg-[#f7f2f4] text-[#5A4B53]' },
}
const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  Draft: { label: 'Taslak', cls: 'border-[#e7d6dd] bg-[#f7f2f4] text-[#5A4B53]' },
  Sent: { label: 'Gönderildi', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  Paid: { label: 'Ödendi', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Overdue: { label: 'Gecikmiş', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  Cancelled: { label: 'İptal', cls: 'border-[#e7d6dd] bg-[#f7f2f4] text-[#5A4B53]' },
}
const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  Succeeded: { label: 'Başarılı', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Pending: { label: 'Doğrulanıyor', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  Failed: { label: 'Başarısız', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  Refunded: { label: 'İade', cls: 'border-[#e7d6dd] bg-[#f7f2f4] text-[#5A4B53]' },
}

type Tab = 'subscriptions' | 'invoices' | 'payments'

interface FaturaData {
  overview: PlatformBillingOverview
  invoices: PlatformInvoice[]
}

export default function PlatformFaturaPage() {
  const [tab, setTab] = useState<Tab>('subscriptions')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const { data, loading, error, reload } = useApiQuery<FaturaData | null>(
    async () => {
      const [overview, invoices] = await Promise.all([
        platformApi.billingOverview<PlatformBillingOverview>(),
        platformApi.invoices<PlatformInvoice>().catch(() => [] as PlatformInvoice[]),
      ])
      return { overview, invoices: Array.isArray(invoices) ? invoices : [] }
    },
    [],
    { initialData: null },
  )

  const overview = data?.overview
  const k = overview?.kpis
  const invoices = data?.invoices ?? []
  const subscriptions = overview?.subscriptions ?? []
  const payments = overview?.recentPayments ?? []
  const months = overview?.monthlyCollections ?? []

  const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(key)
    setNotice(null)
    try {
      await fn()
      await reload()
      if (okText) setNotice({ tone: 'ok', text: okText })
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'İşlem başarısız.' })
    } finally {
      setBusy('')
    }
  }

  const collectedDelta = k && k.collectedLastMonthGross > 0
    ? Math.round(((k.collectedThisMonthGross - k.collectedLastMonthGross) / k.collectedLastMonthGross) * 100)
    : null

  const kpis: KpiProps[] = k ? [
    {
      label: 'Aylık tekrarlayan gelir (MRR)',
      value: <AnimatedNumber value={k.mrrNet} format={tl0} />,
      caption: `ARR ${tl0(k.arrNet)} · KDV hariç`,
      icon: TrendingUp,
      tone: 'plum',
      spark: months.map((m) => m.net),
    },
    {
      label: 'Bu ay tahsil edilen',
      value: <AnimatedNumber value={k.collectedThisMonthGross} format={tl0} />,
      caption: collectedDelta == null
        ? `KDV dahil · net ${tl0(k.collectedThisMonthNet)}`
        : `${collectedDelta >= 0 ? '+' : ''}%${collectedDelta} geçen aya göre · KDV dahil`,
      trend: collectedDelta == null ? undefined : collectedDelta >= 0 ? 'up' : 'down',
      icon: CircleDollarSign,
      tone: 'green',
      spark: months.map((m) => m.gross),
    },
    {
      label: 'Açık alacak',
      value: <AnimatedNumber value={k.outstandingGross} format={tl0} />,
      caption: k.overdueInvoices > 0 ? `${k.overdueInvoices} fatura vadesi geçmiş` : 'Vadesi geçmiş fatura yok',
      trend: k.overdueInvoices > 0 ? 'down' : undefined,
      icon: Receipt,
      tone: k.overdueInvoices > 0 ? 'amber' : 'plum',
    },
    {
      label: 'Önümüzdeki 30 gün yenileme',
      value: <AnimatedNumber value={k.nextThirtyDaysRenewalsGross} format={tl0} />,
      caption: `${k.cardOnFile} kurumda kayıtlı kart · KDV dahil`,
      icon: CalendarClock,
      tone: 'blue',
    },
  ] : []

  return (
    <>
      <Topbar
        title="Faturalama"
        subtitle="Abonelikler, tahsilatlar ve faturalar — tutarlar fiyatlama motorundan, KDV ayrıştırılmış"
        breadcrumbs={['Platform', 'Finans', 'Faturalama']}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading && !data} error={error} />

        {notice && (
          <div className={`flex items-start gap-2 rounded-[14px] border px-4 py-3 text-[12.5px] font-medium ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            {notice.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* KPI'lar */}
        {k && (
          <motion.section variants={gridVariant} initial="hidden" animate="visible" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi) => <Kpi key={kpi.label} {...kpi} />)}
          </motion.section>
        )}

        {/* Uyarı şeridi */}
        {k && (k.pendingPayments > 0 || k.failedPaymentsLast30Days > 0) && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 text-[12.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {k.pendingPayments > 0 && <><b>{k.pendingPayments}</b> tahsilatın sonucu sağlayıcıdan henüz kesinleşmedi (tekrar çekilmez, doğrulanınca işlenir). </>}
                {k.failedPaymentsLast30Days > 0 && <>Son 30 günde <b>{k.failedPaymentsLast30Days}</b> başarısız tahsilat denemesi var.</>}
              </span>
            </div>
            {k.pendingPayments > 0 && (
              <button type="button" disabled={busy === 'resolve'}
                onClick={() => void run('resolve', () => platformApi.resolvePendingCharges(), 'Bekleyen ödemeler sağlayıcıya soruldu.')}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-amber-300 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
                {busy === 'resolve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Şimdi doğrula
              </button>
            )}
          </motion.div>
        )}

        {/* Aylık tahsilat grafiği */}
        {months.length > 0 && <CollectionsChart months={months} />}

        {/* Sekmeler */}
        <div className="flex flex-wrap gap-2">
          {([
            ['subscriptions', 'Abonelikler', Building2, subscriptions.length],
            ['invoices', 'Faturalar', FileText, invoices.length],
            ['payments', 'Tahsilat denemeleri', CreditCard, payments.length],
          ] as const).map(([key, label, Icon, count]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 rounded-[12px] border px-3.5 py-2 text-[12.5px] font-semibold transition ${tab === key
                ? 'border-[#A5556E] bg-[#A5556E] text-white shadow-[0_12px_28px_-18px_rgba(165,85,110,0.9)]'
                : 'border-[#ecd9e1] bg-white text-[#5A4B53] hover:border-[#d9a9bb]'}`}>
              <Icon className="h-4 w-4" /> {label}
              <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${tab === key ? 'bg-white/20' : 'bg-[#f6e9ee] text-[#8C4460]'}`}>{count}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
            {tab === 'subscriptions' && <SubscriptionsTab rows={subscriptions} />}
            {tab === 'invoices' && (
              <InvoicesTab invoices={invoices} subscriptions={subscriptions} busy={busy}
                onAction={(key, fn, okText) => void run(key, fn, okText)} reload={reload} />
            )}
            {tab === 'payments' && <PaymentsTab rows={payments} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

/* ───────────────────────────── KPI ───────────────────────────── */

type Tone = 'plum' | 'green' | 'amber' | 'blue'
const TONE: Record<Tone, { band: string; icon: string; spark: 'rose' | 'emerald' | 'amber' | 'violet' }> = {
  plum: { band: 'bg-[#A5556E]', icon: 'text-white', spark: 'rose' },
  green: { band: 'bg-[#1E8C60]', icon: 'text-white', spark: 'emerald' },
  amber: { band: 'bg-[#B88938]', icon: 'text-white', spark: 'amber' },
  blue: { band: 'bg-[#1E4E8C]', icon: 'text-white', spark: 'violet' },
}

interface KpiProps {
  label: string
  value: ReactNode
  caption: string
  icon: LucideIcon
  tone: Tone
  trend?: 'up' | 'down'
  spark?: number[]
}

function Kpi({ label, value, caption, icon: Icon, tone, trend, spark }: KpiProps) {
  const t = TONE[tone]
  const hasSpark = spark && spark.some((v) => v > 0)
  return (
    <motion.div variants={cardVariant} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="armo-card armo-card-luxury armo-lift relative overflow-hidden p-5">
      <div className="flex items-stretch justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ${t.band} ${t.icon} shadow-[0_14px_28px_-16px_rgba(42,32,39,0.6)]`}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-[#5A4B53]">{label}</div>
          <div className="mt-1 truncate font-display text-[28px] leading-none tabular-nums text-[#2A2027]">{value}</div>
          <div className={`mt-2.5 inline-flex w-fit items-center gap-1 text-[11.5px] font-semibold ${trend === 'up' ? 'text-[#15694A]' : trend === 'down' ? 'text-[#B23252]' : 'text-[#74616A]'}`}>
            {trend === 'up' && <ArrowUpRight className="h-3.5 w-3.5" />}
            {trend === 'down' && <ArrowDownRight className="h-3.5 w-3.5" />}
            {caption}
          </div>
        </div>
        {hasSpark && (
          <div className="hidden flex-1 items-end justify-end sm:flex">
            <Sparkline points={spark!} tone={t.spark} variant="bars" width={120} height={64} className="h-[64px] w-full max-w-[130px] overflow-visible" />
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ───────────────────────── Aylık tahsilat ───────────────────────── */

function CollectionsChart({ months }: { months: PlatformBillingOverview['monthlyCollections'] }) {
  const max = Math.max(1, ...months.map((m) => m.gross))
  const total = months.reduce((s, m) => s + m.gross, 0)
  const [hover, setHover] = useState<number | null>(null)
  const active = hover != null ? months[hover] : months[months.length - 1]
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
      className="armo-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-[#5A4B53]">Aylık tahsilat · son 12 ay</div>
          <div className="mt-1 font-display text-[22px] tabular-nums text-[#2A2027]">{tl(total)} <span className="text-[12px] font-sans text-[#74616A]">KDV dahil</span></div>
        </div>
        <div className="rounded-[12px] border border-[#ecd9e1] bg-[#fbf7f9] px-3 py-2 text-right text-[11.5px] text-[#5A4B53]">
          <div className="font-semibold text-[#2A2027]">{MONTHS[active.month - 1]} {active.year}</div>
          <div className="tabular-nums">{tl(active.gross)} · net {tl(active.net)}</div>
          <div>{active.invoiceCount} fatura</div>
        </div>
      </div>
      <div className="mt-4 grid h-40 grid-cols-12 items-end gap-1.5 sm:gap-2.5" onMouseLeave={() => setHover(null)}>
        {months.map((m, i) => {
          const h = m.gross > 0 ? Math.max(4, Math.round((m.gross / max) * 100)) : 2
          const isActive = hover === i || (hover == null && i === months.length - 1)
          return (
            <button key={`${m.year}-${m.month}`} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
              aria-label={`${MONTHS[m.month - 1]} ${m.year}: ${tl(m.gross)}`}
              className="group flex h-full flex-col items-stretch justify-end">
              <motion.span initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                className={`w-full rounded-t-[8px] ${m.gross > 0 ? (isActive ? 'bg-[#1E8C60]' : 'bg-[#34B37E]/70 group-hover:bg-[#34B37E]') : 'bg-[#efe3e8]'}`} />
              <span className={`mt-1.5 text-center text-[10px] ${isActive ? 'font-semibold text-[#2A2027]' : 'text-[#74616A]'}`}>{MONTHS[m.month - 1]}</span>
            </button>
          )
        })}
      </div>
    </motion.section>
  )
}

/* ───────────────────────── Abonelikler ───────────────────────── */

function SubscriptionsTab({ rows }: { rows: PlatformSubscriptionRow[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'Active' | 'Trial' | 'Suspended' | 'nocard'>('all')
  const [open, setOpen] = useState<string | null>(null)

  const filtered = useMemo(() => rows.filter((r) => {
    if (query.trim() && !r.tenantName.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'))) return false
    if (status === 'nocard') return !r.hasCard && r.status === 'Active'
    return status === 'all' || r.status === status
  }), [rows, query, status])

  return (
    <div className="armo-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#f1e3e9] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[15px] font-semibold text-[#2A2027]">Abonelikler</div>
          <div className="text-[12px] text-[#74616A]">Sonraki yenileme tutarı kurumun güncel şube / müşteri / onam sayısıyla hesaplanır.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills value={status} onChange={setStatus} options={[
            ['all', 'Tümü'], ['Active', 'Aktif'], ['Trial', 'Deneme'], ['Suspended', 'Askıda'], ['nocard', 'Kartsız aktif'],
          ]} />
          <SearchBox value={query} onChange={setQuery} placeholder="Kurum ara" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[12.5px]">
          <thead className="bg-[#fbf5f8] text-[11px] font-semibold text-[#74616A]">
            <tr>
              <th className="px-5 py-2.5">Kurum</th>
              <th className="px-3 py-2.5">Durum</th>
              <th className="px-3 py-2.5">Paket</th>
              <th className="px-3 py-2.5 text-right">Şube · Müşteri · Onam</th>
              <th className="px-3 py-2.5 text-right">Aylık eşdeğer</th>
              <th className="px-3 py-2.5">Sonraki yenileme</th>
              <th className="px-5 py-2.5">Ödeme yöntemi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isOpen = open === r.tenantId
              const st = STATUS[r.status] ?? STATUS.Cancelled
              const end = r.subscriptionEndsAtUtc ?? r.trialEndsAtUtc
              const soon = end ? new Date(end).getTime() - Date.now() < 7 * 86400000 : false
              return (
                <Fragment key={r.tenantId}>
                  <tr onClick={() => setOpen(isOpen ? null : r.tenantId)}
                    className={`cursor-pointer border-t border-[#f3e6ec] transition hover:bg-[#fdf8fa] ${isOpen ? 'bg-[#fdf8fa]' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#A5556E] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        <span className="font-semibold text-[#2A2027]">{r.tenantName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><Pill cls={st.cls}>{st.label}</Pill></td>
                    <td className="px-3 py-3 text-[#3E343A]">
                      {r.planName ?? '—'}
                      {r.period && <span className="ml-1 text-[11px] text-[#74616A]">· {r.period === 'Yearly' ? 'Yıllık' : 'Aylık'}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-[#3E343A]">
                      {r.branches} · {r.customers.toLocaleString('tr-TR')} · {r.signedConsentForms.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#2A2027]">{r.monthlyEquivalentNet > 0 ? tl(r.monthlyEquivalentNet) : '—'}</td>
                    <td className="px-3 py-3">
                      <div className={`tabular-nums ${soon ? 'font-semibold text-[#B23252]' : 'text-[#3E343A]'}`}>{date(end)}</div>
                      {r.nextRenewalQuote && <div className="text-[11.5px] tabular-nums text-[#74616A]">{tl(r.nextRenewalQuote.total)} KDV dahil</div>}
                    </td>
                    <td className="px-5 py-3">
                      {r.hasCard
                        ? <span className="inline-flex items-center gap-1.5 text-[#15694A]"><CreditCard className="h-3.5 w-3.5" /> <span className="font-mono text-[11.5px]">{r.cardMasked ?? 'Kayıtlı kart'}</span></span>
                        : <span className="text-[#74616A]">Kart yok</span>}
                    </td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <tr className="bg-[#fdf8fa]">
                        <td colSpan={7} className="px-5 pb-4">
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden">
                            {r.nextRenewalQuote ? (
                              <div className="grid gap-4 pt-1 lg:grid-cols-[minmax(0,1fr)_280px]">
                                <QuoteTable lines={r.nextRenewalQuote.lines} subtotal={r.nextRenewalQuote.subtotal}
                                  vat={r.nextRenewalQuote.vat} vatRate={r.nextRenewalQuote.vatRate} total={r.nextRenewalQuote.total}
                                  title={`Sonraki yenileme dökümü · ${r.nextRenewalQuote.period === 'Yearly' ? 'yıllık' : 'aylık'}`} />
                                <div className="space-y-2 rounded-[14px] border border-[#ecd9e1] bg-white p-3 text-[12px] text-[#5A4B53]">
                                  <div className="font-semibold text-[#2A2027]">Kurum</div>
                                  <div className="flex justify-between"><span>Şube</span><b className="tabular-nums text-[#2A2027]">{r.branches}</b></div>
                                  <div className="flex justify-between"><span>Kayıtlı müşteri</span><b className="tabular-nums text-[#2A2027]">{r.customers.toLocaleString('tr-TR')}</b></div>
                                  <div className="flex justify-between"><span>İmzalı onam formu</span><b className="tabular-nums text-[#2A2027]">{r.signedConsentForms.toLocaleString('tr-TR')}</b></div>
                                  <div className="flex justify-between"><span>Dönem sonu</span><b className="tabular-nums text-[#2A2027]">{date(end)}</b></div>
                                  {!r.hasCard && r.status === 'Active' && (
                                    <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900">
                                      Kayıtlı kart yok — dönem sonunda otomatik yenileme yapılamaz.
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="pt-1 text-[12px] text-[#74616A]">Ücretli abonelik yok (deneme ya da ücretsiz paket).</div>
                            )}
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[12.5px] text-[#74616A]">Eşleşen abonelik yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────── Faturalar ───────────────────────── */

function InvoicesTab({ invoices, subscriptions, busy, onAction, reload }: {
  invoices: PlatformInvoice[]
  subscriptions: PlatformSubscriptionRow[]
  busy: string
  onAction: (key: string, fn: () => Promise<unknown>, okText?: string) => void
  reload: () => Promise<unknown>
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'open' | 'Paid' | 'Cancelled'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)

  const filtered = useMemo(() => invoices.filter((i) => {
    const q = query.trim().toLocaleLowerCase('tr-TR')
    if (q && !i.tenantName.toLocaleLowerCase('tr-TR').includes(q) && !i.number.toLocaleLowerCase('tr-TR').includes(q)) return false
    if (status === 'open') return i.status === 'Draft' || i.status === 'Sent' || i.status === 'Overdue'
    return status === 'all' || i.status === status
  }), [invoices, query, status])

  const totals = useMemo(() => filtered.filter((i) => i.status !== 'Cancelled').reduce(
    (s, i) => ({ net: s.net + i.netAmountTRY, vat: s.vat + i.vatAmountTRY, gross: s.gross + i.amountTRY }),
    { net: 0, vat: 0, gross: 0 }), [filtered])

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const money = (n: number) => n.toFixed(2).replace('.', ',')
    const header = ['Fatura No', 'Kurum', 'Dönem başı', 'Dönem sonu', 'Kaynak', 'KDV hariç', 'KDV', 'KDV oranı', 'Toplam', 'Durum', 'Kesim', 'Ödeme', 'Not']
    const rows = filtered.map((i) => [
      i.number, i.tenantName, date(i.periodStartUtc), date(i.periodEndUtc), i.source === 'Card' ? 'Kart' : 'Elle',
      money(i.netAmountTRY), money(i.vatAmountTRY), `%${Math.round(i.vatRate * 100)}`, money(i.amountTRY),
      INVOICE_STATUS[i.status]?.label ?? i.status, date(i.issuedAtUtc), date(i.paidAtUtc), i.notes ?? '',
    ])
    const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `faturalar-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const tenantOptions = subscriptions.map((s) => s.tenantName)

  return (
    <div className="armo-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#f1e3e9] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[15px] font-semibold text-[#2A2027]">Faturalar</div>
          <div className="text-[12px] text-[#74616A]">Kartla tahsil edilenler otomatik kesilir; elle faturalanan kurumlar için taslak oluşturabilirsiniz.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills value={status} onChange={setStatus} options={[['all', 'Tümü'], ['open', 'Açık'], ['Paid', 'Ödendi'], ['Cancelled', 'İptal']]} />
          <SearchBox value={query} onChange={setQuery} placeholder="Kurum ya da fatura no" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#f1e3e9] px-5 py-3">
        <button type="button" onClick={() => setDraftOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#A5556E] bg-[#A5556E] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_10px_24px_-16px_rgba(165,85,110,0.9)] transition hover:bg-[#8C4460]">
          <Plus className="h-3.5 w-3.5" /> Fatura taslağı
        </button>
        <AdminEditDialog
          hideTrigger
          open={draftOpen}
          onOpenChange={setDraftOpen}
          title="Yeni fatura taslağı"
          note="Tutar KDV DAHİL brüt tutardır; net ve KDV %20 oranla ayrıştırılır. Durumu listeden yönetirsiniz."
          submitLabel="Taslağı oluştur"
          fields={[
            { label: 'Kurum', type: 'select', value: tenantOptions[0], options: tenantOptions },
            { label: 'Tutar (KDV dahil)', type: 'number', value: 0 },
            { label: 'Not', type: 'textarea', value: 'Aylık abonelik' },
          ]}
          onSubmit={async (values) => {
            const tenant = subscriptions.find((s) => s.tenantName === values['Kurum'])
            if (!tenant) throw new Error('Kurum seçilmedi.')
            const amount = Number(values['Tutar (KDV dahil)'] ?? 0)
            if (!(amount > 0)) throw new Error('Tutar 0\'dan büyük olmalı.')
            await platformApi.createInvoice({ tenantId: tenant.tenantId, amountTRY: amount, notes: String(values['Not'] ?? '') })
            await reload()
          }}
        />
        <button type="button" disabled={busy === 'generate'}
          title="Yalnız ELLE faturalanan aylık kurumlar için bu ayın taslakları (kartla ödeyenler otomatik faturalanır)"
          onClick={() => onAction('generate', () => platformApi.generateInvoices(), 'Elle faturalanan kurumlar için dönem taslakları üretildi.')}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#ecd9e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#5A4B53] hover:border-[#d9a9bb] disabled:opacity-60">
          {busy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-[#A5556E]" />} Dönem taslaklarını üret
        </button>
        <button type="button" onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#ecd9e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#5A4B53] hover:border-[#d9a9bb]">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#5A4B53]">
          <span>KDV hariç <b className="tabular-nums text-[#2A2027]">{tl(totals.net)}</b></span>
          <span>KDV <b className="tabular-nums text-[#2A2027]">{tl(totals.vat)}</b></span>
          <span>Toplam <b className="tabular-nums text-[#2A2027]">{tl(totals.gross)}</b></span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[12.5px]">
          <thead className="whitespace-nowrap bg-[#fbf5f8] text-[11px] font-semibold text-[#74616A]">
            <tr>
              <th className="px-5 py-2.5">Fatura</th>
              <th className="px-3 py-2.5">Kurum</th>
              <th className="px-3 py-2.5">Dönem</th>
              <th className="px-3 py-2.5">Kaynak</th>
              <th className="px-3 py-2.5 text-right">KDV hariç</th>
              <th className="px-3 py-2.5 text-right">KDV</th>
              <th className="px-3 py-2.5 text-right">Toplam</th>
              <th className="px-3 py-2.5">Durum</th>
              <th className="px-5 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => {
              const isOpen = open === inv.id
              const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.Draft
              const overdue = (inv.status === 'Sent' || inv.status === 'Overdue') && new Date(inv.dueDateUtc).getTime() < Date.now()
              const editable = inv.source !== 'Card'
              return (
                <Fragment key={inv.id}>
                  <tr className={`border-t border-[#f3e6ec] transition hover:bg-[#fdf8fa] ${isOpen ? 'bg-[#fdf8fa]' : ''}`}>
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => setOpen(isOpen ? null : inv.id)} className="flex items-center gap-2 text-left">
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#A5556E] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        <span className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-[#2A2027]">{inv.number}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 font-medium text-[#2A2027]">
                      {inv.tenantName}
                      {inv.pendingBranchName && (
                        <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#c9d8ee] bg-[#f1f6fd] px-2 py-0.5 text-[10.5px] font-semibold text-[#1E4E8C]">
                          <Building2 className="h-3 w-3" /> Şube ödeme bekliyor
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-[#3E343A]">{date(inv.periodStartUtc)} – {date(inv.periodEndUtc)}</td>
                    <td className="px-3 py-3">
                      {inv.source === 'Card'
                        ? <span className="inline-flex items-center gap-1 text-[#15694A]"><CreditCard className="h-3.5 w-3.5" /> Kart</span>
                        : <span className="inline-flex items-center gap-1 text-[#5A4B53]"><FileText className="h-3.5 w-3.5" /> Elle</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-[#3E343A]">{tl(inv.netAmountTRY)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-[#3E343A]">{tl(inv.vatAmountTRY)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#2A2027]">{tl(inv.amountTRY)}</td>
                    <td className="px-3 py-3">
                      <Pill cls={overdue && inv.status !== 'Overdue' ? INVOICE_STATUS.Overdue.cls : st.cls}>
                        {overdue && inv.status !== 'Overdue' ? 'Vadesi geçti' : st.label}
                      </Pill>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {editable && inv.status === 'Draft' && (
                          <ActionButton busy={busy === inv.id} icon={Send}
                            onClick={() => onAction(inv.id, () => platformApi.updateInvoiceStatus(inv.id, 'Sent'), `${inv.number} gönderildi olarak işaretlendi.`)}>Gönderildi</ActionButton>
                        )}
                        {editable && inv.status !== 'Paid' && inv.status !== 'Cancelled' && (
                          <ActionButton busy={busy === inv.id} icon={CheckCircle2} tone="green"
                            onClick={() => onAction(inv.id, () => platformApi.updateInvoiceStatus(inv.id, 'Paid'),
                              `${inv.number} ödendi olarak işaretlendi.${inv.pendingBranchName ? ` "${inv.pendingBranchName}" şubesi açıldı.` : ''}`)}>Ödendi</ActionButton>
                        )}
                        {editable && inv.status !== 'Paid' && inv.status !== 'Cancelled' && (
                          <ActionButton busy={busy === inv.id} icon={XCircle}
                            onClick={() => onAction(inv.id, () => platformApi.updateInvoiceStatus(inv.id, 'Cancelled'), `${inv.number} iptal edildi.`)}>İptal</ActionButton>
                        )}
                        {editable && inv.status !== 'Paid' && (
                          <ActionButton busy={busy === inv.id} icon={Trash2} tone="rose"
                            onClick={() => {
                              if (!confirm(`${inv.number} numaralı fatura silinsin mi?`)) return
                              onAction(inv.id, () => platformApi.deleteInvoice(inv.id), `${inv.number} silindi.`)
                            }}>Sil</ActionButton>
                        )}
                        {!editable && <span className="text-[11px] text-[#74616A]">Karttan tahsil edildi</span>}
                      </div>
                    </td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <tr className="bg-[#fdf8fa]">
                        <td colSpan={9} className="px-5 pb-4">
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="grid gap-4 pt-1 lg:grid-cols-[minmax(0,1fr)_300px]">
                              {inv.lines && inv.lines.length > 0 ? (
                                <QuoteTable lines={inv.lines} subtotal={inv.netAmountTRY} vat={inv.vatAmountTRY} vatRate={inv.vatRate}
                                  total={inv.amountTRY} title="Tahsilat anındaki kalem dökümü" />
                              ) : (
                                <div className="rounded-[14px] border border-[#ecd9e1] bg-white p-3 text-[12px] text-[#5A4B53]">
                                  Kalem dökümü yok (elle kesilmiş ya da eski fatura). Net ve KDV brütten %{Math.round(inv.vatRate * 100)} oranla ayrıştırıldı.
                                </div>
                              )}
                              <div className="space-y-1.5 rounded-[14px] border border-[#ecd9e1] bg-white p-3 text-[12px] text-[#5A4B53]">
                                <div className="flex justify-between"><span>Kesim</span><b className="text-[#2A2027]">{date(inv.issuedAtUtc)}</b></div>
                                <div className="flex justify-between"><span>Vade</span><b className="text-[#2A2027]">{date(inv.dueDateUtc)}</b></div>
                                <div className="flex justify-between"><span>Ödeme</span><b className="text-[#2A2027]">{date(inv.paidAtUtc)}</b></div>
                                {inv.paymentReference && <div className="flex justify-between gap-2"><span>Sağlayıcı ref.</span><span className="truncate font-mono text-[11px] text-[#2A2027]">{inv.paymentReference}</span></div>}
                                {inv.pendingBranchName && (
                                  <div className="rounded-[10px] border border-[#c9d8ee] bg-[#f1f6fd] px-2.5 py-1.5 text-[11.5px]">
                                    Bekleyen şube: <b className="text-[#2A2027]">{inv.pendingBranchName}</b>
                                    <span className="block text-[#74616A]">
                                      &quot;Ödendi&quot; yapıldığında şube açılır. İptal edilirse ya da silinirse şube açılmaz.
                                    </span>
                                  </div>
                                )}
                                {inv.customerTierAbove != null && (
                                  <div className="rounded-[10px] border border-[#ecd9e1] bg-[#fff7fa] px-2.5 py-1.5 text-[11.5px]">
                                    Müşteri kademesi: <b className="text-[#2A2027]">{inv.customerTierAbove.toLocaleString('tr-TR')} üzeri müşteri</b>
                                    <span className="block text-[#74616A]">
                                      {inv.status === 'Paid' ? 'Ödendi — dönem boyunca açık.' : '"Ödendi" yapıldığında kurumun yeni müşteri kilidi açılır.'}
                                    </span>
                                  </div>
                                )}
                                {inv.consentTierAbove != null && (
                                  <div className="rounded-[10px] border border-[#ecd9e1] bg-[#fff7fa] px-2.5 py-1.5 text-[11.5px]">
                                    Onam kademesi: <b className="text-[#2A2027]">{inv.consentTierAbove.toLocaleString('tr-TR')} üzeri evrak</b>
                                    <span className="block text-[#74616A]">
                                      {inv.status === 'Paid' ? 'Ödendi — dönem boyunca açık.' : '"Ödendi" yapıldığında kurumun onam imzalama kilidi açılır.'}
                                    </span>
                                  </div>
                                )}
                                {inv.notes && <div className="border-t border-[#f3e6ec] pt-1.5 text-[11.5px]">{inv.notes}</div>}
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-[12.5px] text-[#74616A]">Eşleşen fatura yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────── Tahsilat denemeleri ───────────────────────── */

function PaymentsTab({ rows }: { rows: PlatformPaymentRow[] }) {
  return (
    <div className="armo-card overflow-hidden">
      <div className="border-b border-[#f1e3e9] px-5 py-4">
        <div className="text-[15px] font-semibold text-[#2A2027]">Tahsilat denemeleri</div>
        <div className="text-[12px] text-[#74616A]">Son 60 deneme. Sonucu belirsiz çekim tekrar çekilmez; sağlayıcıya sorulup sonuçlandırılır.</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[12.5px]">
          <thead className="bg-[#fbf5f8] text-[11px] font-semibold text-[#74616A]">
            <tr>
              <th className="px-5 py-2.5">Tarih</th>
              <th className="px-3 py-2.5">Kurum</th>
              <th className="px-3 py-2.5">Tür</th>
              <th className="px-3 py-2.5 text-right">Tutar</th>
              <th className="px-3 py-2.5">Durum</th>
              <th className="px-5 py-2.5">Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.Pending
              return (
                <tr key={p.id} className="border-t border-[#f3e6ec]">
                  <td className="px-5 py-3 tabular-nums text-[#3E343A]">{dateTime(p.createdAtUtc)}</td>
                  <td className="px-3 py-3 font-medium text-[#2A2027]">{p.tenantName}</td>
                  <td className="px-3 py-3 text-[#3E343A]">
                    {p.kind === 'BranchAddon'
                      ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-[#1E4E8C]" /> Ek şube</span>
                      : p.kind === 'ConsentUpgrade'
                        ? <span className="inline-flex items-center gap-1"><FileSignature className="h-3.5 w-3.5 text-[#8E3F5B]" /> Onam kademesi</span>
                        : p.kind === 'CustomerUpgrade'
                          ? <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-[#8E3F5B]" /> Müşteri kademesi</span>
                          : <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5 text-[#A5556E]" /> Abonelik{p.attemptNumber > 1 ? ` · ${p.attemptNumber}. deneme` : ''}</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#2A2027]">{tl(p.amountTRY)}</td>
                  <td className="px-3 py-3"><Pill cls={st.cls}>{p.status === 'Pending' ? <><Clock3 className="h-3 w-3" /> {st.label}</> : st.label}</Pill></td>
                  <td className="px-5 py-3 text-[12px] text-[#5A4B53]">{p.errorMessage ?? (p.status === 'Succeeded' ? `Tamamlandı · ${dateTime(p.completedAtUtc)}` : '—')}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[12.5px] text-[#74616A]">Henüz tahsilat denemesi yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────── Ortak parçalar ───────────────────────── */

function QuoteTable({ lines, subtotal, vat, vatRate, total, title }: {
  lines: QuoteLine[]; subtotal: number; vat: number; vatRate: number; total: number; title: string
}) {
  return (
    <div className="rounded-[14px] border border-[#ecd9e1] bg-white p-3">
      <div className="mb-2 text-[11.5px] font-semibold text-[#5A4B53]">{title}</div>
      <div className="space-y-1.5 text-[12.5px]">
        {lines.map((l) => (
          <div key={l.code + l.label} className="flex items-start justify-between gap-3">
            <span className="text-[#3E343A]">{l.label}</span>
            <span className="shrink-0 tabular-nums text-[#2A2027]">{tl(l.net)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-[#f3e6ec] pt-1.5 text-[#5A4B53]"><span>Ara toplam (KDV hariç)</span><span className="tabular-nums">{tl(subtotal)}</span></div>
        <div className="flex justify-between gap-3 text-[#5A4B53]"><span>KDV (%{Math.round(vatRate * 100)})</span><span className="tabular-nums">{tl(vat)}</span></div>
        <div className="flex justify-between gap-3 font-semibold text-[#2A2027]"><span>Toplam</span><span className="tabular-nums">{tl(total)}</span></div>
      </div>
    </div>
  )
}

function Pill({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

function ActionButton({ children, onClick, busy, icon: Icon, tone }: {
  children: ReactNode; onClick: () => void; busy: boolean; icon: LucideIcon; tone?: 'green' | 'rose'
}) {
  const cls = tone === 'green'
    ? 'border-emerald-200 text-[#15694A] hover:bg-emerald-50'
    : tone === 'rose' ? 'border-rose-200 text-[#B23252] hover:bg-rose-50' : 'border-[#ecd9e1] text-[#5A4B53] hover:bg-[#fbf5f8]'
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${cls}`}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />} {children}
    </button>
  )
}

function FilterPills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]> }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full border border-[#ecd9e1] bg-white p-0.5">
      {options.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition ${value === key ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:text-[#A5556E]'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-56 rounded-full border border-[#ecd9e1] bg-white py-1.5 pl-8 pr-3 text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]" />
    </label>
  )
}
