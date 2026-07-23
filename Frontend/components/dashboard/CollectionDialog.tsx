'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Banknote,
  CalendarDays,
  Check,
  CreditCard,
  FileText,
  Loader2,
  Search,
  User,
  Wallet,
} from 'lucide-react'
import type { CustomerAccount } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'

// ---------------------------------------------------------------------------
// Ortak "Tahsilat Al" modalı — Günlük Kasa ve Ön Muhasebe (cari) aynı bileşeni
// kullanır. Cari hesap aranabilir; seçilince tutar otomatik olarak o hesabın
// KALAN BORCUNA (remainingAmount) düşer. Yöntem: nakit / kart / havale-EFT.
// ---------------------------------------------------------------------------

export interface CollectionSubmitPayload {
  accountId: string
  amount: number
  method: string
  reference: string | null
  occurredAtUtc: string
}

interface CollectionDialogProps {
  accounts: CustomerAccount[]
  /** Dışarıdan ön-seçili cari (ön muhasebe cari sekmesi gibi). */
  initialAccountId?: string | null
  onSubmit: (payload: CollectionSubmitPayload) => Promise<void> | void
  /** Kendi trigger'ını ver (asChild). Yoksa varsayılan buton çizilir. */
  trigger?: ReactNode
  triggerLabel?: string
  title?: string
  description?: string
  /** Kontrollü açılış (opsiyonel). */
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
  return new Date().toISOString().slice(0, 10)
}

export default function CollectionDialog({
  accounts,
  initialAccountId,
  onSubmit,
  trigger,
  triggerLabel = 'Tahsilat al',
  title = 'Yeni tahsilat',
  description = 'Cari hesabı olan bir müşteriden ödeme al. Tutar, seçilen hesabın kalan borcuyla otomatik dolar; en eski vadeden başlayarak taksitlere dağıtılır.',
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: CollectionDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (onOpenChange) onOpenChange(next)
    if (controlledOpen === undefined) setUncontrolledOpen(next)
  }

  const [accountId, setAccountId] = useState<string>('')
  const [amount, setAmount] = useState<number | ''>('')
  const [method, setMethod] = useState<string>('cash')
  const [date, setDate] = useState<string>(todayIso())
  const [reference, setReference] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pickerRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(() => accounts.find((a) => a.id === accountId) || null, [accounts, accountId])

  // Modal her açılışta ilk cariye + onun borcuna sıfırlanır.
  useEffect(() => {
    if (!open) return
    const initial = accounts.find((a) => a.id === initialAccountId) || accounts[0] || null
    setAccountId(initial?.id || '')
    setAmount(initial ? Math.max(0, Math.round(initial.remainingAmount)) : '')
    setMethod('cash')
    setDate(todayIso())
    setReference('')
    setQuery('')
    setPickerOpen(false)
    setError('')
    setSaving(false)
  }, [open, initialAccountId, accounts])

  // Dışarı tıklayınca cari seçici kapansın.
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const list = q
      ? accounts.filter((a) => `${a.customerName} ${a.name} ${a.customerPhone}`.toLocaleLowerCase('tr').includes(q))
      : accounts
    return list.slice(0, 60)
  }, [accounts, query])

  const pickAccount = (a: CustomerAccount): void => {
    setAccountId(a.id)
    // Seçilen carinin kalan borcunu tutara otomatik yaz.
    setAmount(Math.max(0, Math.round(a.remainingAmount)))
    setPickerOpen(false)
    setQuery('')
  }

  const handleSubmit = async (): Promise<void> => {
    setError('')
    if (!accountId) {
      setError('Cari hesap seçimi zorunlu.')
      return
    }
    const amt = Number(amount || 0)
    if (!(amt > 0)) {
      setError('Tutar 0’dan büyük olmalı.')
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        accountId,
        amount: amt,
        method,
        reference: reference.trim() || null,
        occurredAtUtc: new Date(`${date || todayIso()}T12:00:00`).toISOString(),
      })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tahsilat kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger &&
        (trigger ? (
          <DialogTrigger asChild>{trigger}</DialogTrigger>
        ) : (
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
            >
              <Banknote className="h-4 w-4" /> {triggerLabel}
            </button>
          </DialogTrigger>
        ))}
      <DialogContent className="sm:max-w-md">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#f0d9e2] bg-[#fff1f6] text-[#c05277]">
            <Banknote className="h-4.5 w-4.5" />
          </span>
          <div>
            <DialogTitle className="text-[15px] font-bold text-[#2b1e29]">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[11.5px] leading-snug text-[#8a7480]">
              {description}
            </DialogDescription>
          </div>
        </div>

        <div className="space-y-3">
          {/* Cari hesap seçici (aranabilir) */}
          <div className="relative" ref={pickerRef}>
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
              <User className="h-3.5 w-3.5 text-[#c05277]" /> Cari hesap
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-left text-[13px] text-[#352432] transition-colors hover:border-[#efbfd0]"
            >
              {selected ? (
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{selected.customerName || selected.name}</span>
                  <span className="text-[#a58d99]"> · {formatTL(selected.remainingAmount)} kalan</span>
                </span>
              ) : (
                <span className="text-[#a58d99]">Cari hesap seç…</span>
              )}
              <Search className="h-4 w-4 shrink-0 text-[#b499a6]" />
            </button>
            {pickerOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[14px] border border-[#ead8df] bg-white shadow-[0_24px_60px_-30px_rgba(120,71,88,0.55)]">
                <div className="flex items-center gap-2 border-b border-[#f2e6ec] px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-[#b499a6]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Müşteri adı / telefon ara…"
                    className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#c2a8b4]"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {filtered.length === 0 && (
                    <div className="px-3 py-4 text-center text-[11.5px] text-[#a58d99]">Cari hesap bulunamadı.</div>
                  )}
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => pickAccount(a)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[#fff2f6] ${a.id === accountId ? 'bg-[#fff1f6]' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[#352432]">{a.customerName || a.name}</span>
                        <span className="block truncate text-[10.5px] text-[#a58d99]">{a.name}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-bold tabular-nums text-rose-600">{formatTL(a.remainingAmount)}</span>
                        <span className="block text-[9.5px] uppercase tracking-wide text-[#b09ca5]">kalan</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tutar + yöntem */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                <Wallet className="h-3.5 w-3.5 text-[#c05277]" /> Tutar
              </label>
              <div className="flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 focus-within:border-[#efbfd0]">
                <span className="text-[13px] font-semibold text-[#a58d99]">₺</span>
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-transparent text-[13px] font-semibold tabular-nums text-[#352432] outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                <CreditCard className="h-3.5 w-3.5 text-[#c05277]" /> Yöntem
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0]"
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
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
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0]"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                <FileText className="h-3.5 w-3.5 text-[#c05277]" /> Dekont / referans
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Opsiyonel"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0] placeholder:text-[#c2a8b4]"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">
              {error}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-10 items-center rounded-[12px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#efbfd0]"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Tahsilatı kaydet
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
