'use client'

import { Fragment, useMemo, useState } from 'react'
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
import ModalPortal from '@/components/dashboard/ModalPortal'
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
    <ModalPortal>
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
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

        {/* BODY — her blok gerçek bir tablo; dar ekranda tablolar kendi içinde yatay kayar. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* SATIŞ ÖZETİ */}
          <section>
            <SectionTitle icon={Wallet} text="Satış özeti" />
            <TableShell>
              <table className="w-full min-w-[440px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#fff5f8] text-[9.5px] font-semibold uppercase tracking-wide text-[#8a7480]">
                    <th className="px-3 py-2">Tutar</th>
                    <th className="px-3 py-2 text-right">Tahsil edilen</th>
                    <th className="px-3 py-2 text-right">Kalan</th>
                    <th className="px-3 py-2 text-right">Seans</th>
                    <th className="px-3 py-2 text-right">Ödeme</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-[13px] font-bold tabular-nums text-[#241923]">
                    <td className="px-3 py-2.5">{formatTL(Math.round(account.totalAmount))}</td>
                    <td className="px-3 py-2.5 text-right text-[#2c7d63]">{formatTL(Math.round(account.paidAmount))}</td>
                    <td className={`px-3 py-2.5 text-right ${account.remainingAmount > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}`}>
                      {formatTL(Math.round(account.remainingAmount))}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {account.sessionsTotal > 0 ? `${account.sessionsRemaining}/${account.sessionsTotal}` : '—'}
                      {account.sessionsTotal > 0 && (
                        <span className="ml-1 text-[9.5px] font-medium text-[#705a66]">({account.sessionsUsed} kullanıldı)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">%{paidPct}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-3 pb-2.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#f2e6eb]">
                        <div
                          className={`h-full rounded-full ${account.remainingAmount > 0.005 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
                          style={{ width: `${Math.max(2, paidPct)}%` }}
                        />
                      </div>
                      {account.creditBalance > 0 && (
                        <div className="mt-1 text-[10px] font-semibold text-[#2c7d63]">
                          {formatTL(Math.round(account.creditBalance))} fazla ödeme (kredi)
                        </div>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </TableShell>
          </section>

          {/* KAPSAM — hizmet / seans / tutar tablosu */}
          <section>
            <SectionTitle icon={Scissors} text="Kapsam" />
            <TableShell>
              <table className="w-full min-w-[440px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#fff5f8] text-[9.5px] font-semibold uppercase tracking-wide text-[#8a7480]">
                    <th className="px-3 py-2">Hizmet</th>
                    <th className="px-3 py-2 text-right">Seans</th>
                    <th className="px-3 py-2 text-right">Kalan</th>
                    <th className="px-3 py-2 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f6ecf0]">
                  {items.map((item, i) => (
                    <tr key={`${item.serviceDefinitionId ?? 'item'}-${i}`} className="text-[12px] text-[#4a3a44]">
                      <td className="px-3 py-2.5">
                        <span className="block max-w-[220px] truncate font-medium text-[#352432]">{item.name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {item.sessionsTotal > 0 ? `${item.sessionsUsed}/${item.sessionsTotal}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#2c7d63]">
                        {item.sessionsTotal > 0 ? Math.max(0, item.sessionsTotal - item.sessionsUsed) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#352432]">{formatTL(Math.round(item.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                {items.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-[#efe1e7] bg-[#fffafc] text-[12px] font-bold text-[#352432]">
                      <td className="px-3 py-2">TOPLAM</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {account.sessionsTotal > 0 ? `${account.sessionsUsed}/${account.sessionsTotal}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#2c7d63]">
                        {account.sessionsTotal > 0 ? account.sessionsRemaining : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTL(Math.round(account.totalAmount))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </TableShell>
          </section>

          {/* AYLIK TAKSİTLER — satıra tıklayınca ayrıntı satırı açılır */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionTitle icon={CreditCard} text="Aylık taksitler" bare />
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
              <TableShell>
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead>
                    <tr className="bg-[#fff5f8] text-[9.5px] font-semibold uppercase tracking-wide text-[#8a7480]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Vade</th>
                      <th className="px-3 py-2 text-right">Tutar</th>
                      <th className="px-3 py-2 text-right">Tahsil</th>
                      <th className="px-3 py-2 text-right">Kalan</th>
                      <th className="px-3 py-2">Durum</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f6ecf0]">
                    {account.installments.map((inst) => {
                      const due = parseDue(inst.dueDate)
                      const isOpen = openInstallment === inst.id
                      const paid = inst.status === 'Paid' || inst.remaining <= 0.005
                      const collectable = !paid && canManage && !!onCollectInstallment && account.saleStatus !== 'Cancelled'
                      return (
                        <Fragment key={inst.id}>
                          <tr
                            onClick={() => setOpenInstallment(isOpen ? null : inst.id)}
                            className={`cursor-pointer text-[12px] transition-colors ${
                              inst.overdue ? 'bg-rose-50/50 hover:bg-rose-50' : paid ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-[#fffafc]'
                            }`}
                          >
                            <td className="px-3 py-2.5 font-semibold text-[#352432] tabular-nums">{inst.no}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[#4a3a44]">
                              {due.full}
                              <span className="ml-1 text-[10px] text-[#705a66]">{due.month}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#352432]">{formatTL(Math.round(inst.amount))}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[#2c7d63]">{formatTL(Math.round(inst.paidAmount))}</td>
                            <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${inst.remaining > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}`}>
                              {formatTL(Math.round(inst.remaining))}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${
                                paid ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : inst.overdue ? 'border-rose-200 bg-rose-50 text-rose-600'
                                  : 'border-[#efe1e7] bg-[#fffafc] text-[#705a66]'
                              }`}>
                                {paid ? 'Ödendi' : inst.overdue ? 'Gecikti' : 'Bekliyor'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <ChevronDown className={`inline h-3.5 w-3.5 text-[#c9b3bd] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="bg-[#fffafc]">
                              <td colSpan={7} className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[10.5px] text-[#705a66]">
                                    {inst.paidAtUtc ? `Ödeme tarihi: ${formatLongDate(inst.paidAtUtc)}` : `Vade: ${due.full}`}
                                    {inst.overdue && <span className="ml-1 font-semibold text-rose-600">· vadesi geçti</span>}
                                  </span>
                                  {collectable && (
                                    <button
                                      type="button"
                                      disabled={working || busy}
                                      onClick={(e) => { e.stopPropagation(); void run(() => onCollectInstallment!(account.id, inst.remaining)) }}
                                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#2c7d63] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#24664f] disabled:opacity-60"
                                    >
                                      {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                                      Bu taksiti tahsil et ({formatTL(Math.round(inst.remaining))})
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#efe1e7] bg-[#fffafc] text-[12px] font-bold text-[#352432]">
                      <td className="px-3 py-2" colSpan={2}>TOPLAM</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.amount, 0)))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#2c7d63]">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.paidAmount, 0)))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#cf4d68]">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.remaining, 0)))}
                      </td>
                      <td className="px-3 py-2" colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </TableShell>
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
    </ModalPortal>
  )
}

function SectionTitle({ icon: Icon, text, bare = false }: { icon: typeof Wallet; text: string; bare?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#c85776] ${bare ? '' : 'mb-2'}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" /> {text}
    </span>
  )
}

/** Tabloyu çerçeveler ve dar ekranda YALNIZ tabloyu yatay kaydırır (modal gövdesi kaymaz). */
function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#f2e6eb]">
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
