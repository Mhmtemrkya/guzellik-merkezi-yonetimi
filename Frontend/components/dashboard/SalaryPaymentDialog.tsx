'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CalendarDays, Check, Landmark, Loader2, Search, Users, Wallet } from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { BusinessExpense, Staff } from '@/lib/types'

// ---------------------------------------------------------------------------
// MAAŞ ÖDEME
// Personel kartlardan seçilir (bu dönemde ne ödendiği kartın üstünde görünür),
// tutar + dönem + yöntem girilir. Kayıt gider olarak kasaya işlenir.
// ---------------------------------------------------------------------------

export interface SalaryPaymentPayload {
  staffMemberId: string
  amount: number
  method: string
  periodLabel: string
  occurredAt: string
  description: string
}

interface Props {
  staff: Staff[]
  /** Dönemdeki maaş giderleri — "bu ay ödendi" bilgisini göstermek için. */
  salaryExpenses: BusinessExpense[]
  defaultPeriod: string
  onSubmit: (payload: SalaryPaymentPayload) => Promise<void>
  trigger?: ReactNode
}

const METHODS = [
  { value: 'BankTransfer', label: 'Havale / EFT' },
  { value: 'Cash', label: 'Nakit' },
  { value: 'Card', label: 'Kart' },
]

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('tr')
}

export default function SalaryPaymentDialog({ staff, salaryExpenses, defaultPeriod, onSubmit, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [staffId, setStaffId] = useState('')
  const [query, setQuery] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
  const [method, setMethod] = useState('BankTransfer')
  const [period, setPeriod] = useState(defaultPeriod)
  const [date, setDate] = useState(todayIso())
  const [advance, setAdvance] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) return
    setStaffId(''); setQuery(''); setAmount(''); setMethod('BankTransfer')
    setPeriod(defaultPeriod); setDate(todayIso()); setAdvance(false); setError(''); setSaving(false)
  }, [open, defaultPeriod])

  // Personel başına bu dönemde ödenen toplam (kart üstünde rozet olarak).
  const paidByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of salaryExpenses) {
      const key = e.staffMemberId || ''
      if (!key) continue
      map.set(key, (map.get(key) || 0) + e.amount)
    }
    return map
  }, [salaryExpenses])

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return q ? staff.filter((s) => `${s.name} ${s.role}`.toLocaleLowerCase('tr').includes(q)) : staff
  }, [staff, query])

  const selected = staff.find((s) => s.id === staffId) || null
  const alreadyPaid = staffId ? paidByStaff.get(staffId) || 0 : 0

  const submit = async (): Promise<void> => {
    setError('')
    if (!staffId) { setError('Personel seçimi zorunlu.'); return }
    const amt = Number(amount || 0)
    if (!(amt > 0)) { setError('Tutar 0’dan büyük olmalı.'); return }
    setSaving(true)
    try {
      await onSubmit({
        staffMemberId: staffId,
        amount: amt,
        method,
        periodLabel: period,
        occurredAt: date || todayIso(),
        description: advance ? 'Avans' : 'Aylık maaş',
      })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Maaş ödemesi kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]'
  const label = 'mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#A5556E] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90">
            <Users className="h-3.5 w-3.5" /> Maaş Öde
          </button>
        )}
      </DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 720px)', height: 'min(92dvh, 800px)', maxHeight: '92dvh' }}
      >
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#f8f4ff] via-white to-[#fff2f6] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-violet-200 bg-white text-violet-600">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[16px] font-bold text-[#2b1e29]">Personel maaşı öde</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11.5px] text-[#74616A]">
                Ödeme gider olarak kasaya işlenir ve Personel Maaşları sekmesinde listelenir.
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Personel seçimi */}
          <div>
            <div className="flex items-center justify-between">
              <span className={label}><Users className="h-3.5 w-3.5 text-violet-600" /> Personel</span>
              {staff.length > 6 && (
                <span className="mb-1 flex items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-2 py-1">
                  <Search className="h-3 w-3 text-[#74616A]" />
                  <input
                    value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ara…"
                    className="w-28 bg-transparent text-[11.5px] outline-none placeholder:text-[#74616A]"
                  />
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {filteredStaff.map((s) => {
                const paid = paidByStaff.get(s.id) || 0
                const on = staffId === s.id
                return (
                  <button
                    key={s.id} type="button" onClick={() => setStaffId(s.id)}
                    className={`flex items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition-colors ${
                      on ? 'border-violet-400 bg-violet-50' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'
                    }`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${on ? 'bg-violet-500 text-white' : 'bg-violet-50 text-violet-700'}`}>
                      {initialsOf(s.name) || '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[#2A2027]">{s.name}</span>
                      <span className="block truncate text-[10.5px] text-[#74616A]">{s.role || 'Personel'}</span>
                    </span>
                    {paid > 0 && (
                      <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700">
                        {formatTL(paid)}
                      </span>
                    )}
                  </button>
                )
              })}
              {filteredStaff.length === 0 && (
                <div className="rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-5 text-center text-[11.5px] text-[#74616A] sm:col-span-2">
                  Personel bulunamadı.
                </div>
              )}
            </div>
            {selected && alreadyPaid > 0 && (
              <div className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
                {selected.name} için bu dönemde zaten {formatTL(alreadyPaid)} ödenmiş.
              </div>
            )}
          </div>

          {/* Tutar + tür */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><Wallet className="h-3.5 w-3.5 text-violet-600" /> Tutar</span>
              <div className="flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 focus-within:border-[#8C4460]">
                <span className="text-[13px] font-semibold text-[#74616A]">₺</span>
                <input
                  type="number" min={0} value={amount} placeholder="0"
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-transparent text-[14px] font-bold tabular-nums outline-none"
                />
              </div>
            </label>
            <div>
              <span className={label}>Ödeme türü</span>
              <div className="inline-flex w-full rounded-[12px] border border-[#EAD8DF] bg-white p-1">
                {([[false, 'Aylık maaş'], [true, 'Avans']] as const).map(([v, l]) => (
                  <button
                    key={l} type="button" onClick={() => setAdvance(v)}
                    className={`flex-1 rounded-[9px] px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${advance === v ? 'bg-violet-500 text-white' : 'text-[#74616A]'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dönem + yöntem + tarih */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}><CalendarDays className="h-3.5 w-3.5 text-violet-600" /> Dönem</span>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className={label}><Landmark className="h-3.5 w-3.5 text-violet-600" /> Yöntem</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label}><CalendarDays className="h-3.5 w-3.5 text-violet-600" /> Ödeme tarihi</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
          </div>

          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[#74616A]">
              {selected ? <>{selected.name} · <b className="text-[#2A2027]">{advance ? 'Avans' : 'Aylık maaş'}</b></> : 'Personel seçilmedi'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-4 text-[12px] font-semibold text-[#7e5f6e] hover:border-[#BE7690]"
              >
                Vazgeç
              </button>
              <button
                type="button" onClick={() => void submit()} disabled={saving}
                className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-gradient-to-r from-violet-600 to-violet-700 px-4 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(109,40,217,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {Number(amount || 0) > 0 ? `${formatTL(Number(amount))} öde` : 'Maaşı öde'}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
