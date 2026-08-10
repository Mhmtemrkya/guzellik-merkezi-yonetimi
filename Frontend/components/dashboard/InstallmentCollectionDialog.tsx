'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertTriangle, Banknote, CalendarClock, CalendarDays, Check, CheckCircle2, CreditCard,
  FileText, Loader2, Wallet,
} from 'lucide-react'
import type { AccountInstallmentItem, CustomerAccount } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'
import { idempotencyKey, newIdempotencySalt } from '@/lib/idempotency'
import type { CollectionSubmitPayload } from './CollectionDialog'

// ---------------------------------------------------------------------------
// AYLIK TAKSİT TAHSİLATI
//
// "Genel tahsilat" tüm kalan borcu tek kalemde alır; bu modal ise taksitli
// müşterinin AYLIK ödemesini alır: bu ay (ve varsa gecikmiş önceki aylar)
// vadesi gelen taksitler seçili gelir, tutar otomatik dolar.
//
// ÖNEMLİ (allocation modeli): sunucu tahsilatı taksite değil hesaba yazar ve
// VADE SIRASIYLA dağıtır. Bu yüzden "şu taksiti öde" diye bir seçim yoktur —
// tutar en eski ödenmemiş taksitten başlayarak kapatır. Modal bunu gizlemez,
// canlı önizlemede hangi taksitin kapanacağını gösterir.
// ---------------------------------------------------------------------------

interface Props {
  account: CustomerAccount
  onSubmit: (payload: CollectionSubmitPayload) => Promise<void> | void
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (next: boolean) => void
  hideTrigger?: boolean
}

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'transfer', label: 'Havale / EFT' },
]

function todayIso(): string {
  // YEREL tarih (UTC değil): gece yarısından sonra tahsilat düne kaymasın.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Bu ayın son günü (YYYY-MM-DD) — "bu ay vadesi gelen" kapsamı için. */
function endOfThisMonthIso(): string {
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

function formatDay(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  return `${d} ${MONTHS[Number(m) - 1] ?? ''} ${y}`
}

export default function InstallmentCollectionDialog({
  account, onSubmit, trigger, open: controlledOpen, onOpenChange, hideTrigger,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (onOpenChange) onOpenChange(next)
    if (controlledOpen === undefined) setUncontrolledOpen(next)
  }

  const [amount, setAmount] = useState<number | ''>('')
  const [method, setMethod] = useState('cash')
  const [date, setDate] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Ödenmemiş taksitler — vade sırasıyla (tahsilatın dağıtılacağı sıra).
  const pending = useMemo<AccountInstallmentItem[]>(
    () => account.installments
      .filter((i) => i.status !== 'Cancelled' && i.remaining > 0.005)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [account.installments],
  )

  // Bu ay (ve gecikmiş önceki aylar) vadesi gelmiş taksit sayısı — varsayılan seçim.
  const dueNowCount = useMemo(() => {
    const limit = endOfThisMonthIso()
    const n = pending.filter((i) => i.dueDate && i.dueDate <= limit).length
    return Math.max(1, n)
  }, [pending])

  const [count, setCount] = useState(1)

  /** Çift gönderim freni — bkz. lib/idempotency. Tuz yalnız açılış/kapanışta döner. */
  const saltRef = useRef<string>('')
  useEffect(() => {
    if (open) saltRef.current = newIdempotencySalt()
  }, [open])

  const sumOf = (n: number): number =>
    pending.slice(0, Math.max(0, n)).reduce((s, i) => s + i.remaining, 0)

  useEffect(() => {
    if (!open) return
    const initial = Math.min(dueNowCount, pending.length || 1)
    setCount(initial)
    setAmount(Math.round(sumOf(initial) * 100) / 100)
    setMethod('cash')
    setDate(todayIso())
    setReference('')
    setError('')
    setSaving(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickCount = (n: number): void => {
    setCount(n)
    setAmount(Math.round(sumOf(n) * 100) / 100)
  }

  // Girilen tutarın hangi taksitleri kapatacağı — vade sırasıyla canlı dağıtım.
  const preview = useMemo(() => {
    let pool = Number(amount || 0)
    const rows = pending.map((i) => {
      const applied = Math.min(pool, i.remaining)
      pool = Math.max(0, pool - applied)
      return { inst: i, applied, closes: applied >= i.remaining - 0.005 && applied > 0 }
    })
    return { rows, leftover: pool }
  }, [amount, pending])

  const coveredCount = preview.rows.filter((r) => r.closes).length
  const partial = preview.rows.find((r) => r.applied > 0 && !r.closes)
  const overdueCount = pending.filter((i) => i.overdue).length
  const nextDue = pending[0]

  const handleSubmit = async (): Promise<void> => {
    setError('')
    const amt = Number(amount || 0)
    if (!(amt > 0)) { setError('Tutar 0’dan büyük olmalı.'); return }
    setSaving(true)
    // Tarihten türer (öğlen sabit) → aynı formun tekrar gönderimi AYNI gövdeyi üretir; anahtar
    // tuttuğunda sunucu ilk yanıtı oynatabilir.
    const occurredAtUtc = new Date(`${date || todayIso()}T12:00:00`).toISOString()
    const trimmedReference = reference.trim() || null
    try {
      await onSubmit({
        accountId: account.id,
        amount: amt,
        method,
        reference: trimmedReference,
        occurredAtUtc,
        idempotencyKey: idempotencyKey(saltRef.current, account.id, method, amt, occurredAtUtc, trimmedReference),
      })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tahsilat kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const quickCounts = Array.from(new Set([1, 2, 3, dueNowCount, pending.length]))
    .filter((n) => n >= 1 && n <= pending.length)
    .sort((a, b) => a - b)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 900px)', height: 'min(92dvh, 780px)', maxHeight: '92dvh' }}
      >
        {/* ---- Başlık ---- */}
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f8] via-white to-[#fff2f6] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#c05277]">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[16px] font-bold text-[#2b1e29]">
                Aylık taksit tahsilatı
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-[11.5px] text-[#705a66]">
                {account.customerName || account.name}
                {account.servicePackageName ? ` · ${account.servicePackageName}` : ''}
                {` · ${pending.length} taksit ödenmedi`}
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 lg:flex-row">
          {/* ---- SOL: taksit planı ---- */}
          <div className="flex min-h-0 flex-col lg:w-[46%]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#a3576f]">Taksit planı</span>
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[9.5px] font-semibold text-rose-700">
                  <AlertTriangle className="h-3 w-3" /> {overdueCount} gecikmiş
                </span>
              )}
            </div>

            <div className="mt-2 space-y-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {account.installments.map((i) => {
                const row = preview.rows.find((r) => r.inst.id === i.id)
                const willApply = (row?.applied || 0) > 0
                const isPaid = i.remaining <= 0.005
                const tone = isPaid ? 'border-emerald-200/70 bg-emerald-50/50'
                  : willApply ? 'border-[#c85776]/45 bg-[#fff1f6] ring-1 ring-[#c85776]/20'
                  : i.overdue ? 'border-rose-200/70 bg-rose-50/45'
                  : 'border-[#f0e0e6] bg-white'
                const [badge, badgeTone] = isPaid ? ['ÖDENDİ', 'bg-emerald-100 text-emerald-700']
                  : i.overdue ? ['GECİKTİ', 'bg-rose-100 text-rose-700']
                  : i.paidAmount > 0.005 ? ['KISMİ', 'bg-sky-100 text-sky-700']
                  : ['BEKLİYOR', 'bg-amber-50 text-amber-700']
                return (
                  <div key={i.id} className={`rounded-[12px] border px-3 py-2 transition-colors ${tone}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-[#a3576f] ring-1 ring-[#f0d9e2]">
                          {i.no}
                        </span>
                        <span className="truncate text-[12px] font-medium text-[#4a3a44]">{formatDay(i.dueDate)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[13px] font-bold tabular-nums text-[#352432]">{formatTL(i.amount)}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[8.5px] font-bold ${badgeTone}`}>{badge}</span>
                      </span>
                    </div>
                    {i.paidAmount > 0.005 && !isPaid && (
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="font-medium text-emerald-700">✓ Ödendi {formatTL(i.paidAmount)}</span>
                        <span className="font-semibold text-rose-700">Kalan {formatTL(i.remaining)}</span>
                      </div>
                    )}
                    {willApply && (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded-[8px] bg-white/70 px-2 py-1 text-[10px] font-semibold text-[#a3576f]">
                        <Banknote className="h-3 w-3" />
                        Bu ödemeden {formatTL(row!.applied)} düşecek
                        {row!.closes ? ' · kapanır' : ' · kısmi kalır'}
                      </div>
                    )}
                  </div>
                )
              })}
              {account.installments.length === 0 && (
                <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11.5px] text-[#705a66]">
                  Taksit planı yok.
                </div>
              )}
            </div>
          </div>

          {/* ---- SAĞ: ödeme formu ---- */}
          <div className="flex min-h-0 flex-col gap-3 lg:flex-1 lg:overflow-y-auto lg:pl-1">
            {/* Sıradaki taksit vurgusu */}
            {nextDue && (
              <div className="rounded-[16px] border border-[#f0d9e2] bg-gradient-to-br from-[#fff1f6] to-white p-3.5">
                <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Sıradaki taksit</div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <div>
                    <div className="font-display text-2xl tabular-nums text-[#352432]">{formatTL(nextDue.remaining)}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#705a66]">
                      <CalendarDays className="h-3 w-3 text-[#c85776]" /> {formatDay(nextDue.dueDate)} · #{nextDue.no}
                    </div>
                  </div>
                  {nextDue.overdue && (
                    <span className="rounded-md bg-rose-100 px-2 py-1 text-[9.5px] font-bold text-rose-700">GECİKTİ</span>
                  )}
                </div>
              </div>
            )}

            {/* Kaç taksit */}
            {pending.length > 1 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-[#7e5f6e]">Kaç taksit tahsil edilecek?</div>
                <div className="flex flex-wrap gap-1.5">
                  {quickCounts.map((n) => (
                    <button
                      key={n} type="button" onClick={() => pickCount(n)}
                      className={`rounded-[10px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                        count === n ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0]'
                      }`}
                    >
                      {n === pending.length && n > 1 ? `Tümü (${n})` : `${n} taksit`}
                      <span className="ml-1 opacity-80">{formatTL(sumOf(n))}</span>
                    </button>
                  ))}
                </div>
                {dueNowCount > 1 && (
                  <div className="mt-1.5 text-[10.5px] text-[#705a66]">
                    Bu ay dahil <b>{dueNowCount}</b> taksitin vadesi gelmiş.
                  </div>
                )}
              </div>
            )}

            {/* Tutar + yöntem */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <Wallet className="h-3.5 w-3.5 text-[#c05277]" /> Tutar
                </label>
                <div className="flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 focus-within:border-[#efbfd0]">
                  <span className="text-[13px] font-semibold text-[#705a66]">₺</span>
                  <input
                    type="number" min={0} value={amount}
                    onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-transparent text-[14px] font-bold tabular-nums text-[#352432] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <CreditCard className="h-3.5 w-3.5 text-[#c05277]" /> Yöntem
                </label>
                <select
                  value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#efbfd0]"
                >
                  {METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>

            {/* Tarih + referans */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <CalendarDays className="h-3.5 w-3.5 text-[#c05277]" /> Tarih
                </label>
                <input
                  type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#efbfd0]"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <FileText className="h-3.5 w-3.5 text-[#c05277]" /> Dekont / referans
                </label>
                <input
                  value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Opsiyonel"
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#efbfd0] placeholder:text-[#b499a6]"
                />
              </div>
            </div>

            {/* Canlı dağıtım özeti — tahsilat vade sırasıyla dağıtılır, kullanıcı ne olacağını görsün */}
            <div className="rounded-[14px] border border-[#ead8df] bg-[#fffafc] p-3">
              <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Bu ödeme ne yapacak?</div>
              <ul className="mt-1.5 space-y-1 text-[11.5px] text-[#4a3a44]">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  {coveredCount > 0 ? <><b>{coveredCount} taksit</b> tamamen kapanır</> : 'Hiçbir taksit tamamen kapanmaz'}
                </li>
                {partial && (
                  <li className="flex items-center gap-1.5">
                    <Banknote className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    #{partial.inst.no} taksite <b>{formatTL(partial.applied)}</b> kısmi düşer
                  </li>
                )}
                {preview.leftover > 0.005 && (
                  <li className="flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-[#c05277]" />
                    <b>{formatTL(preview.leftover)}</b> fazla ödeme (kredi) olarak kalır
                  </li>
                )}
                <li className="text-[10.5px] text-[#705a66]">
                  Tahsilat en eski vadeli taksitten başlayarak dağıtılır.
                </li>
              </ul>
            </div>

            {error && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
            )}
          </div>
        </div>

        {/* ---- Alt bar ---- */}
        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[#705a66]">
              Kalan toplam borç <b className="text-[#352432]">{formatTL(account.remainingAmount)}</b>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#efbfd0]"
              >
                Vazgeç
              </button>
              <button
                type="button" onClick={() => void handleSubmit()} disabled={saving}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {formatTL(Number(amount || 0))} tahsil et
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
