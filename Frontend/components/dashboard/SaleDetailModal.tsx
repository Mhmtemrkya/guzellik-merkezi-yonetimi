'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
  Sparkles,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import ModalPortal from '@/components/dashboard/ModalPortal'
import type { CustomerAccount, SaleStatusKey } from '@/lib/types'
import { idempotencyKey, newIdempotencySalt, type IdempotentWriteOptions } from '@/lib/idempotency'

/**
 * Satış detay modali — müşteri kartındaki satış satırına tıklanınca açılır.
 *
 * İçerik: müşteri + satış tarihi + satan personel, özet şeridi (tutar/tahsilat/kalan/seans),
 * hizmet kalemleri ve aylık taksit tablosu. Taksit satırına tıklandığında o ayın ayrıntısı
 * (vade, ödeme tarihi) açılır; kalanı varsa oradan tahsilat alınabilir.
 *
 * NOT: `ModalPortal` ile <body>'ye taşınır → `globals.css`'teki `.theme-surface` okunabilirlik
 * düzeltmeleri buraya UYGULANMAZ; ikincil metinler doğrudan okunur tonlarda (#4a3a44 / #705a66)
 * ve en küçük punto 10px olarak yazılır.
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
  onCancelSale: (accountId: string, reason: string, refundedAmount: number, refundMethod: string) => Promise<void>
  onRestoreSale: (accountId: string) => Promise<void>
  onCollectInstallment?: (accountId: string, amount: number, opts: IdempotentWriteOptions) => Promise<void>
}) {
  const meta = STATUS_META[account.saleStatus]
  const StatusIcon = meta.icon
  const [openInstallment, setOpenInstallment] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  // İptalde tahsil edilmiş paranın ne kadarı müşteriye geri ödendi? Geri ödenen kısım gelirden
  // de düşer; kalan kurumda sayılmaya devam eder. Boş = iade yok.
  const [refund, setRefund] = useState('')
  // Paranın hangi kanaldan çıktığı. Sunucu boş bırakılırsa NAKİT varsayar; kart/havale iadesi
  // nakit kasadan çıkmış görünmesin diye burada açıkça seçilir.
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  /**
   * ÇİFT TAHSİLAT FRENİ. Rapor edilen senaryo: tahsilat sunucuda başarılı olur ama ardından gelen
   * ekran tazeleme patlar; düğme açık kalır, kullanıcı bir daha basar ve 400 ₺ 800 ₺ olarak yazılır.
   *
   * Aynı taksit + aynı tutar için niyet BİR KEZ üretilir ve modal yaşadığı sürece saklanır:
   * ikinci tıklama aynı anahtar + aynı gövdeyle gider, sunucu ilk yanıtı oynatır, ikinci satır
   * açılmaz. BAŞARIDA TEMİZLENMEZ — temizlenseydi tam da korunması gereken tıklama yeni anahtar
   * üretirdi. Meşru ikinci tahsilat yine mümkün: tahsilat sonrası `inst.remaining` düşer, tutar
   * değişir ve anahtar kendiliğinden yenilenir.
   */
  const saltRef = useRef<string>('')
  if (!saltRef.current) saltRef.current = newIdempotencySalt()
  const intentsRef = useRef(new Map<string, IdempotentWriteOptions>())
  const collectIntent = (installmentId: string, amount: number): IdempotentWriteOptions => {
    const cacheKey = `${installmentId}:${amount}`
    const cached = intentsRef.current.get(cacheKey)
    if (cached) return cached
    const intent: IdempotentWriteOptions = {
      idempotencyKey: idempotencyKey(saltRef.current, account.id, installmentId, amount),
      occurredAtUtc: new Date().toISOString(),
    }
    intentsRef.current.set(cacheKey, intent)
    return intent
  }

  /**
   * Esc yalnız EN ÜSTTEKİ modalı kapatsın. Alttaki modaller (satış listesi, müşteri kartı)
   * pencere üzerinde bubble aşamasında dinliyor; capture aşamasında yakalayıp propagation'ı
   * durdurunca üst üste açılmış modaller tek tuşla topluca kapanmıyor.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const paidPct = account.totalAmount > 0 ? Math.min(100, Math.round((account.paidAmount / account.totalAmount) * 100)) : 100
  const items = useMemo(
    () => (account.items.length > 0 ? account.items : [{ serviceDefinitionId: null, name: account.name, amount: account.totalAmount, sessionsTotal: 0, sessionsUsed: 0 }]),
    [account],
  )
  const paidInstallments = account.installments.filter((i) => i.status === 'Paid').length

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setWorking(true)
    setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'İşlem başarısız.') } finally { setWorking(false) }
  }

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-[#2a141f]/55 p-2 backdrop-blur-[3px] sm:items-center sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex max-h-[94dvh] w-full max-w-[920px] flex-col overflow-hidden rounded-[22px] border border-[#ead8df] bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.7)] sm:rounded-[26px]"
      >
        {/* HEADER */}
        <header className="relative shrink-0 overflow-hidden border-b border-[#ead8df] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-4 py-4 sm:px-6">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-[#f0aac2]/25 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[15px] border ${meta.pill}`}>
              <StatusIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${meta.pill}`}>{meta.label}</span>
                {account.isHistorical && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-2 py-0.5 text-[10.5px] font-bold text-[#6b4aa0]">
                    <Archive className="h-3 w-3" /> Geçmiş kayıt
                  </span>
                )}
              </div>
              <h2 className="mt-1 truncate font-display text-[20px] font-bold leading-tight tracking-tight text-[#241923] sm:text-[22px]">{account.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#705a66]">
                <span className="inline-flex items-center gap-1 font-semibold text-[#4a3a44]"><User className="h-3.5 w-3.5 text-[#c85776]" /> {customerName}</span>
                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-[#c85776]" /> {formatLongDate(account.soldAtUtc)}</span>
                {account.soldByStaffName && <span className="inline-flex items-center gap-1">Satan: <b className="font-semibold text-[#4a3a44]">{account.soldByStaffName}</b></span>}
                {account.appliedByStaffName && <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-[#c85776]" /> Uygulayan: <b className="font-semibold text-[#4a3a44]">{account.appliedByStaffName}</b></span>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat" className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-[#ead8df] bg-white text-[#705a66] shadow-sm transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {account.saleStatus === 'Cancelled' && (
            <div className="relative mt-3 flex items-start gap-2 rounded-[13px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>İptal edildi</b>{account.cancelledAtUtc ? ` · ${formatLongDate(account.cancelledAtUtc)}` : ''}
                {account.cancellationReason ? ` — ${account.cancellationReason}` : ' — gerekçe belirtilmemiş'}
              </span>
            </div>
          )}
        </header>

        {/* BODY */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fbf4f7] px-3.5 py-4 sm:px-5">
          {/* SATIŞ ÖZETİ — tablo yerine kart şeridi: dar ekranda yatay kaymadan okunur. */}
          <section className="rounded-[16px] border border-[#ead8df] bg-white p-4">
            <SectionTitle icon={Wallet} text="Satış özeti" />
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Stat label="Toplam tutar" value={formatTL(Math.round(account.totalAmount))} />
              <Stat label="Tahsil edilen" value={formatTL(Math.round(account.paidAmount))} tone="text-[#2c7d63]" />
              <Stat
                label="Kalan"
                value={formatTL(Math.round(account.remainingAmount))}
                tone={account.remainingAmount > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}
              />
              <Stat
                label="Seans"
                value={account.sessionsTotal > 0 ? `${account.sessionsRemaining}/${account.sessionsTotal}` : '—'}
                sub={account.sessionsTotal > 0 ? `${account.sessionsUsed} kullanıldı` : undefined}
              />
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#f2e6eb]">
                <span
                  className={`block h-full rounded-full ${account.remainingAmount > 0.005 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
                  style={{ width: `${Math.max(2, paidPct)}%` }}
                />
              </span>
              <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-[#4a3a44]">%{paidPct} tahsil edildi</span>
            </div>
            {account.creditBalance > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-[#2c7d63]">
                <Wallet className="h-3 w-3" /> {formatTL(Math.round(account.creditBalance))} fazla ödeme (kredi)
              </div>
            )}
          </section>

          {/* KAPSAM — hizmet / seans / tutar tablosu */}
          <section className="rounded-[16px] border border-[#ead8df] bg-white p-4">
            <SectionTitle icon={Scissors} text="Kapsam" />
            <TableShell>
              <table className="w-full min-w-[420px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#fff5f8] text-[10.5px] font-bold uppercase tracking-wide text-[#705a66]">
                    <th className="px-3 py-2.5">Hizmet</th>
                    <th className="px-3 py-2.5 text-right">Seans</th>
                    <th className="px-3 py-2.5 text-right">Kalan</th>
                    <th className="px-3 py-2.5 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f6ecf0]">
                  {items.map((item, i) => (
                    <tr key={`${item.serviceDefinitionId ?? 'item'}-${i}`} className="text-[12.5px] text-[#4a3a44] transition-colors hover:bg-[#fffafc]">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] bg-[#fff1f6] text-[#c85776]"><Scissors className="h-3 w-3" /></span>
                          <span className="block max-w-[260px] truncate font-semibold text-[#352432]">{item.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {item.sessionsTotal > 0 ? `${item.sessionsUsed}/${item.sessionsTotal}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#2c7d63]">
                        {item.sessionsTotal > 0 ? Math.max(0, item.sessionsTotal - item.sessionsUsed) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#352432]">{formatTL(Math.round(item.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                {items.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-[#efe1e7] bg-[#fffafc] text-[12.5px] font-bold text-[#352432]">
                      <td className="px-3 py-2.5">TOPLAM</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {account.sessionsTotal > 0 ? `${account.sessionsUsed}/${account.sessionsTotal}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#2c7d63]">
                        {account.sessionsTotal > 0 ? account.sessionsRemaining : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatTL(Math.round(account.totalAmount))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </TableShell>
          </section>

          {/* AYLIK TAKSİTLER — satıra tıklayınca ayrıntı satırı açılır */}
          <section className="rounded-[16px] border border-[#ead8df] bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionTitle icon={CreditCard} text="Aylık taksitler" bare />
              {account.installments.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ead8df] bg-[#fffafc] px-2.5 py-0.5 text-[11px] font-bold text-[#4a3a44]">
                  <span className="tabular-nums">{paidInstallments}/{account.installments.length}</span> ödendi
                </span>
              )}
            </div>

            {account.installments.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11.5px] text-[#705a66]">
                Taksit planı yok — satış peşin kaydedilmiş.
              </div>
            ) : (
              <TableShell>
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="bg-[#fff5f8] text-[10.5px] font-bold uppercase tracking-wide text-[#705a66]">
                      <th className="px-3 py-2.5">#</th>
                      <th className="px-3 py-2.5">Vade</th>
                      <th className="px-3 py-2.5 text-right">Tutar</th>
                      <th className="px-3 py-2.5 text-right">Tahsil</th>
                      <th className="px-3 py-2.5 text-right">Kalan</th>
                      <th className="px-3 py-2.5">Durum</th>
                      <th className="px-3 py-2.5" />
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
                            className={`cursor-pointer text-[12.5px] transition-colors ${
                              inst.overdue ? 'bg-rose-50/60 hover:bg-rose-50' : paid ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-[#fffafc]'
                            }`}
                          >
                            <td className="px-3 py-2.5 font-bold tabular-nums text-[#352432]">{inst.no}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[#4a3a44]">
                              {due.full}
                              <span className="ml-1 text-[10.5px] text-[#705a66]">{due.month}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#352432]">{formatTL(Math.round(inst.amount))}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[#2c7d63]">{formatTL(Math.round(inst.paidAmount))}</td>
                            <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${inst.remaining > 0.005 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'}`}>
                              {formatTL(Math.round(inst.remaining))}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${
                                paid ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : inst.overdue ? 'border-rose-200 bg-rose-50 text-rose-600'
                                  : 'border-[#efe1e7] bg-[#fffafc] text-[#705a66]'
                              }`}>
                                {paid ? 'Ödendi' : inst.overdue ? 'Gecikti' : 'Bekliyor'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <ChevronDown className={`inline h-4 w-4 text-[#c9b3bd] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="bg-[#fffafc]">
                              <td colSpan={7} className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11.5px] text-[#705a66]">
                                    {inst.paidAtUtc ? `Ödeme tarihi: ${formatLongDate(inst.paidAtUtc)}` : `Vade: ${due.full}`}
                                    {inst.overdue && <span className="ml-1 font-bold text-rose-600">· vadesi geçti</span>}
                                  </span>
                                  {collectable && (
                                    <button
                                      type="button"
                                      disabled={working || busy}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const intent = collectIntent(inst.id, inst.remaining)
                                        void run(() => onCollectInstallment!(account.id, inst.remaining, intent))
                                      }}
                                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-[#2c7d63] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#24664f] disabled:opacity-60"
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
                    <tr className="border-t border-[#efe1e7] bg-[#fffafc] text-[12.5px] font-bold text-[#352432]">
                      <td className="px-3 py-2.5" colSpan={2}>TOPLAM</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.amount, 0)))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#2c7d63]">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.paidAmount, 0)))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#cf4d68]">
                        {formatTL(Math.round(account.installments.reduce((s, i) => s + i.remaining, 0)))}
                      </td>
                      <td className="px-3 py-2.5" colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </TableShell>
            )}
          </section>

          {account.notes && (
            <div className="rounded-[13px] border border-[#f0e6c8] bg-[#fffdf5] px-3.5 py-2.5 text-[11.5px] text-[#7a6320]">
              <b>Not:</b> {account.notes}
            </div>
          )}

          {error && <div className="rounded-[13px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[11.5px] font-semibold text-rose-700">{error}</div>}
        </div>

        {/* FOOTER — iptal / geri alma */}
        {canManage && (
          <footer className="shrink-0 border-t border-[#ead8df] bg-white px-4 py-3 sm:px-6">
            {account.saleStatus === 'Cancelled' ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11.5px] text-[#705a66]">Bu satış iptal edilmiş.</span>
                <button
                  type="button"
                  disabled={working || busy}
                  onClick={() => run(() => onRestoreSale(account.id))}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11.5px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6] disabled:opacity-60"
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} İptali geri al
                </button>
              </div>
            ) : cancelling ? (
              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#4a3a44]">İptal gerekçesi</label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                    placeholder="örn. müşteri vazgeçti, paket iade edildi"
                    className="mt-1 w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] text-[#352432] outline-none focus:border-[#ef9ab5] placeholder:text-[#9d8590]"
                  />
                </div>

                {/* Tahsil edilmiş para varsa: ne kadarı iade edildi? Geri ödenen kısım gelir
                    raporlarından da düşer; kalan kurumda sayılmaya devam eder. */}
                {account.paidAmount > 0.005 && (
                  <div>
                    <label className="block text-[11.5px] font-semibold text-[#4a3a44]">
                      Müşteriye iade edilen tutar
                      <span className="ml-1.5 font-normal text-[#705a66]">(tahsil edilmiş: {formatTL(account.paidAmount)})</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        value={refund}
                        onChange={(e) => setRefund(e.target.value.replace(/[^\d.,]/g, ''))}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-40 rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] tabular-nums text-[#352432] outline-none focus:border-[#ef9ab5] placeholder:text-[#9d8590]"
                      />
                      <button
                        type="button"
                        onClick={() => setRefund(String(account.paidAmount))}
                        className="cursor-pointer rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6]"
                      >
                        Tamamı
                      </button>
                    </div>
                    <p className="mt-1 text-[10.5px] text-[#705a66]">
                      Boş bırakılırsa para kurumda kaldı sayılır ve gelirde görünmeye devam eder.
                    </p>

                    {/* Yöntem seçilmezse sunucu nakit varsayar; kart/havale iadesi kasa
                        kırılımında nakit çıkışı gibi görünürdü. */}
                    <div className="mt-2">
                      <span className="block text-[11px] font-semibold text-[#4a3a44]">İade yöntemi</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {([
                          { key: 'cash', label: 'Nakit' },
                          { key: 'card', label: 'Kart' },
                          { key: 'transfer', label: 'Havale/EFT' },
                        ] as const).map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setRefundMethod(m.key)}
                            className={`cursor-pointer rounded-[10px] border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                              refundMethod === m.key
                                ? 'border-[#cf4d68] bg-[#fff2f6] text-[#a34a62]'
                                : 'border-[#ead8df] bg-white text-[#705a66] hover:bg-[#fff7f9]'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => { setCancelling(false); setReason(''); setRefund('') }} disabled={working} className="cursor-pointer rounded-[11px] border border-[#ead8df] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#705a66] disabled:opacity-60">Vazgeç</button>
                  <button
                    type="button"
                    disabled={working || busy}
                    onClick={() => run(async () => {
                      // SESSİZ KIRPMA YOK: tahsil edileni aşan tutar sunucuda doğrulama hatası
                      // döner ve kullanıcı ne kaydedilmediğini görür (eskiden fark ettirmeden
                      // tahsil edilene çekiliyordu).
                      const parsed = Number(refund.replace(/\./g, '').replace(',', '.'))
                      const refunded = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
                      await onCancelSale(account.id, reason.trim(), refunded, refundMethod)
                      setCancelling(false); setRefund(''); setRefundMethod('cash')
                    })}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[11px] bg-[#cf4d68] px-3.5 py-1.5 text-[11.5px] font-bold text-white transition-colors hover:bg-[#b8405a] disabled:opacity-60"
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Satışı iptal et
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#705a66]">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#b88938]" /> Kayıt "İptal Edilenler" arşivine taşınır; geri alınabilir.
                </span>
                <button
                  type="button"
                  onClick={() => setCancelling(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-[11px] border border-[#f2c4c4] bg-[#fff4f4] px-3.5 py-2 text-[11.5px] font-semibold text-[#b3453f] transition-colors hover:bg-[#ffecec]"
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-[13px] border border-[#f0e0e6] bg-[#fffafc] px-3 py-2.5">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#705a66]">{label}</div>
      <div className={`mt-0.5 font-display text-[17px] font-bold leading-tight tracking-tight tabular-nums ${tone || 'text-[#241923]'}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-[#705a66]">{sub}</div>}
    </div>
  )
}

function SectionTitle({ icon: Icon, text, bare = false }: { icon: typeof Wallet; text: string; bare?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#c85776] ${bare ? '' : 'mb-2.5'}`}>
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
