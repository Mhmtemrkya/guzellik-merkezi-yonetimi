'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  Package,
  RotateCcw,
  Scissors,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { CustomerAccount, SaleStatusKey } from '@/lib/types'

/**
 * Satış detay modali — müşteri kartındaki satış satırına tıklanınca açılır.
 *
 * İçerik: müşteri + satış tarihi + satan personel, seans ve ödeme durumu, hizmet kalemleri
 * (adı karşısında tutarı) ve aylık taksit kartı. Taksit ayına tıklandığında o ayın ayrıntısı
 * (vade, tutar, tahsil edilen, kalan) açılır; kalanı varsa oradan tahsilat alınabilir.
 */

const STATUS_META: Record<SaleStatusKey, { label: string; pill: string; icon: typeof Package }> = {
  Active: { label: 'Devam ediyor', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: Package },
  Completed: { label: 'Tamamlandı', pill: 'border-sky-200 bg-sky-50 text-sky-700', icon: CheckCircle2 },
  Cancelled: { label: 'İptal edildi', pill: 'border-rose-200 bg-rose-50 text-rose-600', icon: XCircle },
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatLongDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** "2026-08-15" → { ay: "Ağu", yıl: 2026, gün: "15.08.2026" } */
function parseDue(due: string): { month: string; year: string; full: string } {
  const [y, m, d] = (due || '').split('-')
  const mi = Number(m) - 1
  return {
    month: MONTHS_TR[mi] ?? '—',
    year: y || '',
    full: y ? `${d}.${m}.${y}` : '—',
  }
}

export default function SaleDetailModal({
  account,
  customerName,
  canManage = true,
  busy = false,
  onClose,
  onCancelSale,
  onRestoreSale,
  onCollectInstallment,
}: {
  account: CustomerAccount
  customerName: string
  canManage?: boolean
  busy?: boolean
  onClose: () => void
  onCancelSale: (accountId: string, reason: string) => Promise<void>
  onRestoreSale: (accountId: string) => Promise<void>
  onCollectInstallment?: (accountId: string, amount: number) => Promise<void>
}) {
  const meta = STATUS_META[account.saleStatus]
  const StatusIcon = meta.icon
  const [openInstallment, setOpenInstallment] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const paidPct = account.totalAmount > 0 ? Math.min(100, Math.round((account.paidAmount / account.totalAmount) * 100)) : 100
  const items = useMemo(
    () => (account.items.length > 0 ? account.items : [{ serviceDefinitionId: null, name: account.name, amount: account.totalAmount, sessionsTotal: 0, sessionsUsed: 0 }]),
    [account],
  )

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setWorking(true)
    setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'İşlem başarısız.') } finally { setWorking(false) }
  }

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white shadow-2xl"
      >
        {/* HEADER */}
        <header className="shrink-0 border-b border-[#f2e6eb] bg-[linear-gradient(135deg,#fff7fa,#ffffff)] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border ${meta.pill}`}>
              <StatusIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.pill}`}>{meta.label}</span>
                {account.isHistorical && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-2 py-0.5 text-[10px] font-bold text-[#6b4aa0]">
                    <Archive className="h-2.5 w-2.5" /> Geçmiş kayıt
                  </span>
                )}
              </div>
              <div className="mt-1 truncate font-display text-[19px] font-bold leading-tight text-[#241923]">{account.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#705a66]">
                <span className="inline-flex items-center gap-1 font-semibold text-[#4a3a44]"><User className="h-3 w-3 text-[#c85776]" /> {customerName}</span>
                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3 text-[#c85776]" /> {formatLongDate(account.soldAtUtc)}</span>
                {account.soldByStaffName && <span className="inline-flex items-center gap-1">Satan: <b className="font-semibold text-[#4a3a44]">{account.soldByStaffName}</b></span>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white text-[#705a66] transition-colors hover:text-[#c85776]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {account.saleStatus === 'Cancelled' && (
            <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <b>İptal edildi</b>{account.cancelledAtUtc ? ` · ${formatLongDate(account.cancelledAtUtc)}` : ''}
              {account.cancellationReason ? ` — ${account.cancellationReason}` : ' — gerekçe belirtilmemiş'}
            </div>
          )}
        </header>

        {/* BODY */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Özet kutuları */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Tutar" value={formatTL(Math.round(account.totalAmount))} />
            <Stat label="Tahsil edilen" value={formatTL(Math.round(account.paidAmount))} tone="text-[#2c7d63]" />
            <Stat label="Kalan" value={formatTL(Math.round(account.remainingAmount))} tone={account.remainingAmount > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'} />
            <Stat
              label="Seans"
              value={account.sessionsTotal > 0 ? `${account.sessionsRemaining}/${account.sessionsTotal}` : '—'}
              hint={account.sessionsTotal > 0 ? `${account.sessionsUsed} kullanıldı` : 'seanssız satış'}
            />
          </div>

          {/* Ödeme durumu */}
          <div className="rounded-[14px] border border-[#f2e6eb] bg-[#fffafc] px-3.5 py-3">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#4a3a44]">
              <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-[#c85776]" /> Ödeme durumu</span>
              <span>%{paidPct}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f2e6eb]">
              <div className={`h-full rounded-full ${account.remainingAmount > 0.005 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`} style={{ width: `${Math.max(2, paidPct)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] text-[#705a66]">
              {formatTL(Math.round(account.paidAmount))} / {formatTL(Math.round(account.totalAmount))}
              {account.creditBalance > 0 && <span className="ml-1 text-[#2c7d63]">· {formatTL(Math.round(account.creditBalance))} fazla ödeme</span>}
            </div>
          </div>

          {/* Hizmet kalemleri: adı karşısında tutarı */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c85776]">
              <Scissors className="h-3.5 w-3.5" /> Kapsam
            </div>
            <div className="overflow-hidden rounded-[14px] border border-[#f2e6eb]">
              {items.map((item, i) => (
                <div
                  key={`${item.serviceDefinitionId ?? 'item'}-${i}`}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fffafc]'}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-[#352432]">{item.name}</div>
                    {item.sessionsTotal > 0 && (
                      <div className="mt-0.5 text-[10px] text-[#705a66]">
                        {item.sessionsUsed}/{item.sessionsTotal} seans kullanıldı · {Math.max(0, item.sessionsTotal - item.sessionsUsed)} kaldı
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 font-display text-[13px] font-bold tabular-nums text-[#352432]">{formatTL(Math.round(item.amount))}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Aylık taksitler — aya tıklayınca ayrıntı açılır */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c85776]">
                <CreditCard className="h-3.5 w-3.5" /> Aylık Taksitler
              </span>
              {account.installments.length > 0 && (
                <span className="text-[10px] text-[#705a66]">
                  {account.installments.filter((i) => i.status === 'Paid').length}/{account.installments.length} ödendi
                </span>
              )}
            </div>

            {account.installments.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-5 text-center text-[11px] text-[#705a66]">
                Taksit planı yok — satış peşin kaydedilmiş.
              </div>
            ) : (
              <div className="space-y-1.5">
                {account.installments.map((inst) => {
                  const due = parseDue(inst.dueDate)
                  const isOpen = openInstallment === inst.id
                  const paid = inst.status === 'Paid' || inst.remaining <= 0.005
                  return (
                    <div key={inst.id} className={`overflow-hidden rounded-[12px] border ${inst.overdue ? 'border-rose-200 bg-rose-50/40' : paid ? 'border-emerald-200/70 bg-emerald-50/30' : 'border-[#f2e6eb] bg-white'}`}>
                      <button
                        type="button"
                        onClick={() => setOpenInstallment(isOpen ? null : inst.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#fffafc]"
                      >
                        <span className={`grid h-9 w-11 shrink-0 place-items-center rounded-[9px] border text-center ${paid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : inst.overdue ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-[#efe1e7] bg-[#fffafc] text-[#705a66]'}`}>
                          <span className="leading-tight">
                            <span className="block text-[11px] font-bold">{due.month}</span>
                            <span className="block text-[8px] opacity-70">{due.year}</span>
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-[#352432]">{inst.no}. taksit · {formatTL(Math.round(inst.amount))}</span>
                          <span className={`block text-[10px] ${inst.overdue ? 'font-semibold text-rose-600' : 'text-[#705a66]'}`}>
                            {paid ? 'Ödendi' : inst.overdue ? `Gecikti · vade ${due.full}` : `Vade ${due.full}`}
                          </span>
                        </span>
                        {paid ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <ChevronDown className={`h-4 w-4 shrink-0 text-[#c9b3bd] transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                      </button>

                      {isOpen && (
                        <div className="space-y-2 border-t border-[#f2e6eb] bg-[#fffafc] px-3 py-2.5">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <MiniCell label="Taksit" value={formatTL(Math.round(inst.amount))} />
                            <MiniCell label="Tahsil" value={formatTL(Math.round(inst.paidAmount))} tone="text-[#2c7d63]" />
                            <MiniCell label="Kalan" value={formatTL(Math.round(inst.remaining))} tone={inst.remaining > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'} />
                          </div>
                          {inst.paidAtUtc && <div className="text-[10px] text-[#705a66]">Ödeme tarihi: {formatLongDate(inst.paidAtUtc)}</div>}
                          {!paid && canManage && onCollectInstallment && account.saleStatus !== 'Cancelled' && (
                            <button
                              type="button"
                              disabled={working || busy}
                              onClick={() => run(() => onCollectInstallment(account.id, inst.remaining))}
                              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#2c7d63] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#24664f] disabled:opacity-60"
                            >
                              <Wallet className="h-3.5 w-3.5" /> Bu taksiti tahsil et ({formatTL(Math.round(inst.remaining))})
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {account.notes && (
            <div className="rounded-[12px] border border-[#f0e6c8] bg-[#fffdf5] px-3 py-2 text-[11px] text-[#7a6320]">
              <b>Not:</b> {account.notes}
            </div>
          )}

          {error && <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">{error}</div>}
        </div>

        {/* FOOTER — iptal / geri alma */}
        {canManage && (
          <footer className="shrink-0 border-t border-[#f2e6eb] bg-white px-5 py-3">
            {account.saleStatus === 'Cancelled' ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#705a66]">Bu satış iptal edilmiş.</span>
                <button
                  type="button"
                  disabled={working || busy}
                  onClick={() => run(() => onRestoreSale(account.id))}
                  className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#efe1e7] bg-white px-3.5 py-2 text-[11px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6] disabled:opacity-60"
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} İptali geri al
                </button>
              </div>
            ) : cancelling ? (
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-[#4a3a44]">İptal gerekçesi</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                  placeholder="örn. müşteri vazgeçti, paket iade edildi"
                  className="w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] text-[#352432] outline-none focus:border-[#ef9ab5]"
                />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => { setCancelling(false); setReason('') }} disabled={working} className="rounded-[11px] border border-[#ead8df] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#705a66] disabled:opacity-60">Vazgeç</button>
                  <button
                    type="button"
                    disabled={working || busy}
                    onClick={() => run(async () => { await onCancelSale(account.id, reason.trim()); setCancelling(false) })}
                    className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#cf4d68] px-3.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#b8405a] disabled:opacity-60"
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Satışı iptal et
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] text-[#705a66]">
                  <AlertTriangle className="h-3 w-3 text-[#b88938]" /> İptalde tahsilat geçmişi korunur.
                </span>
                <button
                  type="button"
                  onClick={() => setCancelling(true)}
                  className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#f2c4c4] bg-[#fff4f4] px-3.5 py-2 text-[11px] font-semibold text-[#b3453f] transition-colors hover:bg-[#ffecec]"
                >
                  <XCircle className="h-3.5 w-3.5" /> Satışı iptal et
                </button>
              </div>
            )}
          </footer>
        )}
      </motion.div>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-[12px] border border-[#f2e6eb] bg-[#fffafc] px-2.5 py-2 text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-[#705a66]">{label}</div>
      <div className={`mt-0.5 font-display text-[14px] font-bold tabular-nums ${tone || 'text-[#241923]'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[9px] text-[#705a66]">{hint}</div>}
    </div>
  )
}

function MiniCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[10px] border border-[#f2e6eb] bg-white px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-[#705a66]">{label}</div>
      <div className={`text-[12px] font-bold tabular-nums ${tone || 'text-[#352432]'}`}>{value}</div>
    </div>
  )
}
