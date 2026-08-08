'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  AlertTriangle, Banknote, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, CreditCard,
  Layers, Loader2, PencilLine, Phone, Receipt, Sparkles, User, Wallet,
} from 'lucide-react'
import CustomerSessionsCard from './CustomerSessionsCard'
import ConsentWarningBanner from '@/components/dashboard/ConsentWarningBanner'
import LoyaltyCard from './LoyaltyCard'
import type { CustomerAccount } from '@/lib/types'
import { formatTL, paymentMethodLabel } from '@/lib/apiMappers'

// ---------------------------------------------------------------------------
// CARİ DETAY MODALI
// Ön Muhasebe > Cari Hesaplar listesinden açılır. Sekmeli: Özet · Taksit Planı ·
// Hesap Ekstresi · Seans & Sadakat. Tahsilat modalları SAYFADA tutulur (bu modal
// yalnız isteği yukarı bildirir) — iç içe dialog yığınından kaçınmak için.
// ---------------------------------------------------------------------------

export interface LedgerRow {
  date: string
  label: string
  detail: string
  debit: number
  credit: number
  balance: number
}

type TabKey = 'summary' | 'plan' | 'ledger' | 'extras'

interface Props {
  account: CustomerAccount | null
  open: boolean
  onOpenChange: (next: boolean) => void
  tenantId?: string
  ledger: LedgerRow[]
  sessionsTick?: number
  /** Genel tahsilat (tüm kalan borç) modalını aç. */
  onCollectGeneral: () => void
  /** Aylık taksit tahsilatı modalını aç. */
  onCollectMonthly: () => void
  onReschedule: (installmentCount: number, firstDueDate: string) => Promise<void>
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatDay(iso: string | null | undefined): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AccountDetailModal({
  account, open, onOpenChange, tenantId, ledger, sessionsTick,
  onCollectGeneral, onCollectMonthly, onReschedule,
}: Props) {
  const [tab, setTab] = useState<TabKey>('summary')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [count, setCount] = useState(1)
  const [firstDue, setFirstDue] = useState(todayIso())

  useEffect(() => {
    if (!open) return
    setTab('summary')
    setRescheduleOpen(false)
    setError('')
    setBusy(false)
    setFirstDue(todayIso())
    setCount(Math.max(1, (account?.installments || []).filter((i) => i.remaining > 0.005).length))
  }, [open, account?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    if (!account) return null
    const active = account.installments.filter((i) => i.status !== 'Cancelled')
    const paidCount = active.filter((i) => i.remaining <= 0.005).length
    const overdueCount = active.filter((i) => i.overdue).length
    const pct = account.totalAmount > 0 ? Math.min(100, Math.round((account.paidAmount / account.totalAmount) * 100)) : 0
    return {
      isInstallment: active.length > 1,
      count: active.length,
      paidCount,
      overdueCount,
      pct,
      overdueAmount: active.filter((i) => i.overdue).reduce((s, i) => s + i.remaining, 0),
    }
  }, [account])

  if (!account || !stats) return null

  const cancelled = account.saleStatus === 'Cancelled'
  const closed = !cancelled && account.remainingAmount <= 0.005

  const TABS: { key: TabKey; label: string; icon: typeof Wallet }[] = [
    { key: 'summary', label: 'Özet', icon: Wallet },
    { key: 'plan', label: `Taksit Planı${stats.count ? ` · ${stats.count}` : ''}`, icon: CalendarClock },
    { key: 'ledger', label: `Ekstre · ${ledger.length}`, icon: ClipboardList },
    { key: 'extras', label: 'Seans & Sadakat', icon: Sparkles },
  ]

  const runReschedule = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await onReschedule(Number(count || 0), firstDue || todayIso())
      setRescheduleOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Taksit planı güncellenemedi.')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[28px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 1080px)', height: 'min(94dvh, 900px)', maxHeight: '94dvh' }}
      >
        {/* ================= BAŞLIK ================= */}
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-br from-[#fff5f8] via-white to-[#fff1f6] px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-10">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#c05277]">
                  <User className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-[18px] font-bold tracking-tight text-[#2b1e29]">
                    {account.customerName || account.name}
                  </DialogTitle>
                  <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#705a66]">
                    {account.customerPhone && (
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-[#c85776]" />{account.customerPhone}</span>
                    )}
                    <span className="truncate">{[account.name, account.servicePackageName].filter(Boolean).join(' • ')}</span>
                    {/* SATIŞ TARİHİ — geçmişe dönük girilen satışlarda kayıt tarihinden farklıdır. */}
                    {account.soldAtUtc && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3 text-[#c85776]" />{formatDay(account.soldAtUtc)}
                      </span>
                    )}
                    {account.soldByStaffName && <span className="truncate">Satan: <b className="text-[#4a3a44]">{account.soldByStaffName}</b></span>}
                  </DialogDescription>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${
                cancelled ? 'bg-rose-100 text-rose-700'
                : closed ? 'bg-emerald-100 text-emerald-700'
                : stats.overdueCount > 0 ? 'bg-rose-50 text-rose-700'
                : 'bg-amber-50 text-amber-700'
              }`}>
                {cancelled ? 'İPTAL EDİLDİ' : closed ? 'KAPANDI' : stats.overdueCount > 0 ? `${stats.overdueCount} TAKSİT GECİKTİ` : 'AÇIK HESAP'}
              </span>
              <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${stats.isInstallment ? 'bg-[#f3e8ff] text-[#7c3aed]' : 'bg-[#e0f2fe] text-[#0369a1]'}`}>
                {stats.isInstallment ? `TAKSİTLİ · ${stats.count} AY` : 'PEŞİN'}
              </span>
            </div>
          </div>

          {/* KPI şeridi */}
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#f0dae2] bg-[#f7e9ee] sm:grid-cols-4">
            <div className="bg-white px-3 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#a3576f]">Toplam</div>
              <div className="font-display text-[19px] tabular-nums">{formatTL(account.totalAmount)}</div>
            </div>
            <div className="bg-white px-3 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#a3576f]">Ödenen</div>
              <div className="font-display text-[19px] tabular-nums text-emerald-700">{formatTL(account.paidAmount)}</div>
            </div>
            <div className="bg-white px-3 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#a3576f]">Kalan</div>
              <div className="font-display text-[19px] tabular-nums text-rose-700">{formatTL(account.remainingAmount)}</div>
            </div>
            <div className="bg-white px-3 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-widest text-[#a3576f]">Sıradaki vade</div>
              <div className="font-display text-[15px] leading-7 text-[#352432]">
                {account.nextDueDate ? formatDay(account.nextDueDate) : '—'}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
              <span className={`block h-full rounded-full ${cancelled ? 'bg-[#d9b7c3]' : 'bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]'}`} style={{ width: `${stats.pct}%` }} />
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-[#705a66]">%{stats.pct} ödendi</span>
          </div>

          {/* Sekmeler */}
          <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
            {TABS.map((t) => {
              const Icon = t.icon
              const on = tab === t.key
              return (
                <button
                  key={t.key} type="button" onClick={() => setTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-[11px] px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    on ? 'bg-[#c85776] text-white shadow-[0_10px_22px_-14px_rgba(168,62,95,0.9)]' : 'text-[#705a66] hover:bg-[#fff1f6]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ================= GÖVDE ================= */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {cancelled && (
            <div className="mb-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[11.5px] text-rose-700">
              <b>Bu satış iptal edildi</b>
              {account.cancelledAtUtc ? ` · ${formatDay(account.cancelledAtUtc)}` : ''}
              {account.cancellationReason ? ` — ${account.cancellationReason}` : ' — gerekçe belirtilmemiş'}
              <div className="mt-0.5 text-[10.5px] text-rose-600">
                Kalan taksitler tahsil edilmez; geçmiş tahsilat kaydı korunur. Yanlışlıkla iptal edildiyse müşteri kartındaki satış detayından &quot;İptali geri al&quot; yapın.
              </div>
            </div>
          )}

          {/* ---------------- ÖZET ---------------- */}
          {tab === 'summary' && (
            <div className="space-y-3">
              {!cancelled && account.remainingAmount > 0.005 && (
                <div className="rounded-[16px] border border-[#f0d9e2] bg-gradient-to-br from-[#fff1f6] to-white p-4">
                  <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Tahsilat</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {stats.isInstallment && (
                      <button
                        type="button" onClick={onCollectMonthly}
                        className="group flex items-center gap-3 rounded-[14px] border border-[#c85776]/45 bg-white px-3.5 py-3 text-left transition-transform hover:-translate-y-0.5"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c05277]">
                          <CalendarClock className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-[#352432]">Aylık taksiti tahsil et</span>
                          <span className="block truncate text-[10.5px] text-[#705a66]">
                            Sıradaki taksit {formatTL(account.nextDueAmount)}
                            {account.nextDueDate ? ` · ${formatDay(account.nextDueDate)}` : ''}
                          </span>
                        </span>
                      </button>
                    )}
                    <button
                      type="button" onClick={onCollectGeneral}
                      className={`group flex items-center gap-3 rounded-[14px] px-3.5 py-3 text-left text-white transition-transform hover:-translate-y-0.5 ${
                        stats.isInstallment ? 'bg-gradient-to-r from-[#c85776] to-[#a63e5f]' : 'bg-gradient-to-r from-[#c85776] to-[#a63e5f] sm:col-span-2'
                      } shadow-[0_16px_30px_-20px_rgba(168,62,95,0.95)]`}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15">
                        <Banknote className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-bold">Genel tahsilat</span>
                        <span className="block truncate text-[10.5px] text-white/85">
                          Kalan borcun tamamı {formatTL(account.remainingAmount)}
                        </span>
                      </span>
                    </button>
                  </div>
                  {stats.overdueCount > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-[11px] bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {stats.overdueCount} taksit gecikmiş · {formatTL(stats.overdueAmount)}
                    </div>
                  )}
                </div>
              )}

              {closed && !cancelled && (
                <div className="flex items-center gap-2 rounded-[14px] border border-emerald-200 bg-emerald-50/70 px-3.5 py-3 text-[12px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Bu carinin borcu kapandı.
                </div>
              )}

              {account.creditBalance > 0 && (
                <div className="flex items-center justify-between rounded-[14px] border border-emerald-200/70 bg-emerald-50/60 px-3.5 py-2.5 text-[11.5px] text-emerald-700">
                  <span className="flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5" /> Fazla ödeme (kredi)</span>
                  <span className="font-display tabular-nums">{formatTL(account.creditBalance)}</span>
                </div>
              )}

              {/* Satılan kalemler */}
              {account.items.length > 0 && (
                <div className="rounded-[16px] border border-[#ead8df] bg-white p-3.5">
                  <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Satış kalemleri</div>
                  {/* Kalem çoksa liste uzayıp kartı boğuyordu: geniş ekranda iki sütuna açılır. */}
                  <div className="mt-2 grid gap-1.5 lg:grid-cols-2">
                    {account.items.map((it, i) => (
                      <div key={`${it.serviceDefinitionId || 'x'}-${i}`} className="flex items-center justify-between gap-2 rounded-[11px] bg-[#fffafc] px-3 py-2 text-[12px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 shrink-0 text-[#c85776]" />
                          <span className="truncate text-[#4a3a44]">{it.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {/* "2/4 seans" hangi sayının kalan olduğunu söylemiyordu — cevap yazılır. */}
                          {it.sessionsTotal > 0 && (
                            <span className="text-[10px] font-semibold tabular-nums text-[#705a66]">
                              {Math.max(0, it.sessionsTotal - it.sessionsUsed)} seans kaldı
                            </span>
                          )}
                          <span className="font-bold tabular-nums">{formatTL(it.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Son tahsilatlar */}
              <div className="rounded-[16px] border border-[#ead8df] bg-white p-3.5">
                <div className="flex items-center justify-between">
                  <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Son tahsilatlar</div>
                  <span className="text-[10px] font-semibold text-[#705a66]">{account.payments.length} kayıt</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {[...account.payments]
                    .sort((a, b) => (b.occurredAtUtc || '').localeCompare(a.occurredAtUtc || ''))
                    .slice(0, 5)
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-[11px] bg-[#f6fbf8] px-3 py-2 text-[12px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Receipt className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span className="truncate text-[#4a3a44]">
                            {formatDay(p.occurredAtUtc)}
                            {p.method ? ` · ${paymentMethodLabel(p.method)}` : ''}
                            {p.reference ? ` · ${p.reference}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-emerald-700">{formatTL(p.amount)}</span>
                      </div>
                    ))}
                  {account.payments.length === 0 && (
                    <div className="rounded-[11px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[11.5px] text-[#705a66]">
                      Henüz tahsilat yok.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------------- TAKSİT PLANI ---------------- */}
          {tab === 'plan' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#f0dae2] bg-[#f7e9ee]">
                <div className="bg-white px-3 py-2 text-center">
                  <div className="text-[9px] font-mono uppercase text-[#a3576f]">Taksit</div>
                  <div className="font-display text-[17px] tabular-nums">{stats.count}</div>
                </div>
                <div className="bg-white px-3 py-2 text-center">
                  <div className="text-[9px] font-mono uppercase text-[#a3576f]">Ödenen</div>
                  <div className="font-display text-[17px] tabular-nums text-emerald-700">{stats.paidCount}</div>
                </div>
                <div className="bg-white px-3 py-2 text-center">
                  <div className="text-[9px] font-mono uppercase text-[#a3576f]">Geciken</div>
                  <div className={`font-display text-[17px] tabular-nums ${stats.overdueCount ? 'text-rose-700' : 'text-[#352432]'}`}>{stats.overdueCount}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                {account.installments.map((i) => {
                  const isPaid = i.remaining <= 0.005
                  const partial = !isPaid && i.paidAmount > 0.005
                  const tone = isPaid ? 'border-emerald-200/70 bg-emerald-50/50'
                    : i.overdue ? 'border-rose-200/70 bg-rose-50/45'
                    : partial ? 'border-sky-200/70 bg-sky-50/40'
                    : 'border-[#f0e0e6] bg-white'
                  const [badge, badgeTone] = isPaid ? ['ÖDENDİ', 'bg-emerald-100 text-emerald-700']
                    : i.overdue ? ['GECİKTİ', 'bg-rose-100 text-rose-700']
                    : partial ? ['KISMİ', 'bg-sky-100 text-sky-700']
                    : ['BEKLİYOR', 'bg-amber-50 text-amber-700']
                  return (
                    <div key={i.id} className={`rounded-[12px] border px-3.5 py-2.5 ${tone}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-[#a3576f] ring-1 ring-[#f0d9e2]">{i.no}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold text-[#4a3a44]">{formatDay(i.dueDate)}</span>
                            {isPaid && i.paidAtUtc && (
                              <span className="block text-[10px] text-emerald-700">Ödendi · {formatDay(i.paidAtUtc)}</span>
                            )}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-display text-[15px] tabular-nums">{formatTL(i.amount)}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[8.5px] font-bold ${badgeTone}`}>{badge}</span>
                        </span>
                      </div>
                      {partial && (
                        <div className="mt-1.5 flex items-center justify-between text-[10.5px]">
                          <span className="font-medium text-emerald-700">✓ Ödendi {formatTL(i.paidAmount)}</span>
                          <span className="font-semibold text-rose-700">Kalan {formatTL(i.remaining)}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {account.installments.length === 0 && (
                  <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11.5px] text-[#705a66]">
                    Taksit planı yok — bu satış peşin kaydedilmiş.
                  </div>
                )}
              </div>

              {/* Planı yeniden kur (iç içe dialog yok: satır içi form) */}
              {!cancelled && (
                <div className="rounded-[14px] border border-[#ead8df] bg-[#fffafc] p-3">
                  <button
                    type="button" onClick={() => setRescheduleOpen((o) => !o)}
                    className="flex w-full items-center gap-2 text-[11.5px] font-semibold text-[#a3576f]"
                  >
                    <PencilLine className="h-3.5 w-3.5" /> {rescheduleOpen ? 'Vazgeç' : 'Taksit planını yeniden kur'}
                  </button>
                  <AnimatePresence initial={false}>
                    {rescheduleOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden"
                      >
                        <div className="pt-3">
                          <div className="text-[10.5px] text-[#705a66]">
                            Finanse edilen tutar (toplam − peşinat) seçtiğin taksit sayısına eşit bölünür; alınan tahsilatlar yeni plana vade sırasıyla dağıtılır.
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <label className="block">
                              <span className="mb-1 block text-[10.5px] font-semibold text-[#7e5f6e]">Taksit sayısı</span>
                              <input
                                type="number" min={1} value={count}
                                onChange={(e) => setCount(Number(e.target.value || 1))}
                                className="w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] tabular-nums outline-none focus:border-[#efbfd0]"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[10.5px] font-semibold text-[#7e5f6e]">İlk vade</span>
                              <input
                                type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)}
                                className="w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#efbfd0]"
                              />
                            </label>
                            <button
                              type="button" onClick={() => void runReschedule()} disabled={busy}
                              className="mt-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[11px] bg-[#c85776] px-4 text-[12px] font-semibold text-white disabled:opacity-60"
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Planı kur
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* ---------------- EKSTRE ---------------- */}
          {tab === 'ledger' && (
            <div className="overflow-hidden rounded-[14px] border border-[#ead8df]">
              <div className="grid grid-cols-[0.8fr_1.6fr_0.7fr_0.7fr_0.7fr] gap-2 border-b border-[#f2e2e9] bg-[#fffafc] px-3 py-2 text-[8.5px] font-mono uppercase tracking-widest text-[#a3576f]">
                <span>Tarih</span><span>İşlem</span><span className="text-right">Borç</span><span className="text-right">Alacak</span><span className="text-right">Bakiye</span>
              </div>
              <div className="divide-y divide-[#f4e8ed] bg-white">
                {ledger.map((r, i) => (
                  <div key={i} className="grid grid-cols-[0.8fr_1.6fr_0.7fr_0.7fr_0.7fr] items-center gap-2 px-3 py-2 text-[11.5px]">
                    <span className="font-mono text-[10px] text-[#705a66]">{(r.date || '').slice(0, 10) || '—'}</span>
                    <span className="min-w-0">
                      <span className={`mr-1.5 rounded px-1 py-0.5 text-[8.5px] font-bold ${r.credit > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-[#fff1f6] text-[#c85776]'}`}>{r.label}</span>
                      <span className="text-[10.5px] text-[#705a66]">{r.detail}</span>
                    </span>
                    <span className="text-right font-display tabular-nums text-rose-700">{r.debit > 0 ? formatTL(r.debit) : '—'}</span>
                    <span className="text-right font-display tabular-nums text-emerald-700">{r.credit > 0 ? formatTL(r.credit) : '—'}</span>
                    <span className={`text-right font-display tabular-nums ${r.balance > 0 ? 'text-[#352432]' : 'text-emerald-700'}`}>{formatTL(r.balance)}</span>
                  </div>
                ))}
                {ledger.length === 0 && <div className="px-3 py-6 text-center text-[11.5px] text-[#705a66]">Hareket yok.</div>}
              </div>
              {ledger.length > 0 && (
                <div className="flex items-center justify-between border-t border-[#f2e2e9] bg-[#fffafc] px-3 py-2 text-[11px]">
                  <span className="font-mono uppercase tracking-widest text-[#a3576f]">Son bakiye</span>
                  <span className={`font-display text-[14px] tabular-nums ${ledger[ledger.length - 1].balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {formatTL(ledger[ledger.length - 1].balance)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ---------------- SEANS & SADAKAT ---------------- */}
          {tab === 'extras' && (
            <div className="space-y-3">
              {/* Cari kartında onam uyarısı: imzasız işlem borçlandırılmış olabilir. */}
              <ConsentWarningBanner customerId={account.customerId} customerName={account.customerName || account.name} />
              <CustomerSessionsCard customerId={account.customerId} tenantId={tenantId} refreshKey={sessionsTick} />
              <LoyaltyCard customerId={account.customerId} tenantId={tenantId} />
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
          )}
        </div>

        {/* ================= ALT BAR ================= */}
        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* "Cariyi sil" KALDIRILDI: yalnız cariyi soft-delete ediyordu — tahsilat arşivlenmiyor,
                iade işlenmiyor, paket seansları kullanılabilir kalıyor ve satış raporlardan
                düşerken ödeme geçmişi ortada kalıyordu. Satışı sonlandırmanın tek güvenli yolu
                müşteri kartındaki "Satışı iptal et" akışıdır (gerekçe + iade tutarı sorar). */}
            <span className="max-w-[46ch] text-[11.5px] leading-snug text-[#7e5f6e]">
              Satışı sonlandırmak için müşteri kartındaki <span className="font-semibold">Satışlar</span> bölümünden
              &nbsp;“Satışı iptal et”i kullanın — iade ve seans iadesi orada doğru işlenir.
            </span>

            {!cancelled && account.remainingAmount > 0.005 && (
              <div className="flex flex-wrap items-center gap-2">
                {stats.isInstallment && (
                  <button
                    type="button" onClick={onCollectMonthly}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-[#c85776]/50 bg-white px-3.5 text-[12px] font-semibold text-[#a3576f] transition-transform hover:-translate-y-0.5"
                  >
                    <CalendarClock className="h-4 w-4" /> Aylık taksit
                  </button>
                )}
                <button
                  type="button" onClick={onCollectGeneral}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-4 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
                >
                  <CreditCard className="h-4 w-4" /> Genel tahsilat
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
