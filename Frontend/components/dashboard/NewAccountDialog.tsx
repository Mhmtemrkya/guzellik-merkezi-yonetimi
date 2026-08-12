'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import CustomerPicker, { type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'
import {
  Banknote, CalendarDays, Check, CreditCard, FileText, Loader2, Package, User, Wallet,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { ServicePackage } from '@/lib/types'

// ---------------------------------------------------------------------------
// YENİ CARİ HESAP
// Müşteri + (opsiyonel) paket seçilir, tutar/peşinat girilir ve taksit planı
// KURULMADAN ÖNCE canlı önizlenir — "5 × ₺400, ilk vade 14 Ağu" gibi.
// ---------------------------------------------------------------------------

export interface NewAccountPayload {
  customerId: string
  servicePackageId: string | null
  name: string
  totalAmount: number
  depositAmount: number
  installmentCount: number
  firstDueDate: string
  notes: string | null
}

interface Props {
  packages: ServicePackage[]
  onSearchCustomers: (query: string) => Promise<CustomerPickerItem[]>
  onSubmit: (payload: NewAccountPayload) => Promise<void>
  trigger?: ReactNode
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  const dt = new Date(y, (m - 1) + months, d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''}`
}

export default function NewAccountDialog({ packages, onSearchCustomers, onSubmit, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [packageId, setPackageId] = useState('')
  const [name, setName] = useState('Paket satışı')
  const [total, setTotal] = useState<number | ''>('')
  const [deposit, setDeposit] = useState<number | ''>(0)
  const [count, setCount] = useState(5)
  const [firstDue, setFirstDue] = useState(addMonthsIso(todayIso(), 1))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) return
    setCustomer(null); setPackageId(''); setName('Paket satışı')
    setTotal(''); setDeposit(0); setCount(5); setFirstDue(addMonthsIso(todayIso(), 1))
    setNotes(''); setError(''); setSaving(false)
  }, [open])

  // Paket seçilince ad ve tutar otomatik dolar (kullanıcı yine değiştirebilir).
  const pickPackage = (id: string): void => {
    setPackageId(id)
    const pkg = packages.find((p) => p.id === id)
    if (pkg) {
      setName(pkg.name)
      setTotal(Math.round(pkg.totalPrice))
    }
  }

  const totalNum = Number(total || 0)
  const depositNum = Math.min(Number(deposit || 0), totalNum)
  const financed = Math.max(0, totalNum - depositNum)
  const perInstallment = count > 0 && financed > 0 ? financed / count : 0

  // Plan önizlemesi: ilk 4 taksit + kalanın özeti.
  const preview = useMemo(() => {
    if (count <= 0 || financed <= 0) return []
    return Array.from({ length: Math.min(count, 4) }, (_, i) => ({
      no: i + 1,
      due: addMonthsIso(firstDue, i),
      amount: perInstallment,
    }))
  }, [count, financed, firstDue, perInstallment])

  const submit = async (): Promise<void> => {
    setError('')
    if (!customer) { setError('Müşteri seçimi zorunlu.'); return }
    if (!(totalNum > 0)) { setError('Toplam tutar 0’dan büyük olmalı.'); return }
    setSaving(true)
    try {
      await onSubmit({
        customerId: customer.id,
        servicePackageId: packageId || null,
        name: name.trim() || 'Cari hesap',
        totalAmount: totalNum,
        depositAmount: depositNum,
        installmentCount: financed > 0 ? Math.max(0, count) : 0,
        firstDueDate: firstDue || todayIso(),
        notes: notes.trim() || null,
      })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cari hesap açılamadı.')
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
            <CreditCard className="h-3.5 w-3.5" /> Yeni Cari
          </button>
        )}
      </DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 760px)', height: 'min(92dvh, 820px)', maxHeight: '92dvh' }}
      >
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f8] via-white to-[#fff2f6] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#A5556E]">
              <CreditCard className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[16px] font-bold text-[#2b1e29]">Yeni cari hesap</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11.5px] text-[#74616A]">
                Borç/taksit takibi yapılacak hesap açılır. Paket seçilirse seans bakiyeleri de otomatik oluşur.
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Müşteri */}
          <div>
            <span className={label}><User className="h-3.5 w-3.5 text-[#A5556E]" /> Müşteri</span>
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-[12px] border border-[#8C4460]/40 bg-[#F6DFE6] px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-[#8C4460]">
                    {customer.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('tr')}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-[#2A2027]">{customer.name}</span>
                </span>
                <button type="button" onClick={() => setCustomer(null)} className="shrink-0 text-[11px] font-semibold text-[#8C4460] hover:underline">
                  Değiştir
                </button>
              </div>
            ) : (
              <CustomerPicker
                items={[]}
                onSearch={onSearchCustomers}
                value=""
                onChange={() => undefined}
                onSelectItem={(it) => setCustomer({ id: it.id, name: it.name })}
                placeholder="İsim veya telefon ile ara…"
              />
            )}
          </div>

          {/* Paket + ad */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><Package className="h-3.5 w-3.5 text-[#A5556E]" /> Paket (opsiyonel)</span>
              <select value={packageId} onChange={(e) => pickPackage(e.target.value)} className={field}>
                <option value="">— Paketsiz —</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {formatTL(p.totalPrice)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}><FileText className="h-3.5 w-3.5 text-[#A5556E]" /> Cari adı</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </label>
          </div>

          {/* Tutarlar */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><Wallet className="h-3.5 w-3.5 text-[#A5556E]" /> Toplam tutar</span>
              <div className="flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 focus-within:border-[#8C4460]">
                <span className="text-[13px] font-semibold text-[#74616A]">₺</span>
                <input
                  type="number" min={0} value={total} placeholder="0"
                  onChange={(e) => setTotal(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-transparent text-[14px] font-bold tabular-nums outline-none"
                />
              </div>
            </label>
            <label className="block">
              <span className={label}><Banknote className="h-3.5 w-3.5 text-[#A5556E]" /> Peşinat</span>
              <div className="flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 focus-within:border-[#8C4460]">
                <span className="text-[13px] font-semibold text-[#74616A]">₺</span>
                <input
                  type="number" min={0} value={deposit}
                  onChange={(e) => setDeposit(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-transparent text-[14px] font-bold tabular-nums outline-none"
                />
              </div>
            </label>
          </div>

          {/* Taksit planı */}
          <div className="rounded-[16px] border border-[#f0d9e2] bg-[#F7F6F6] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">Taksit planı</span>
              <span className="text-[11px] text-[#74616A]">
                Finanse edilen <b className="text-[#3E343A]">{formatTL(financed)}</b>
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 9, 12].map((n) => (
                <button
                  key={n} type="button" onClick={() => setCount(n)}
                  className={`rounded-[10px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    count === n ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#EAD8DF] bg-white text-[#3E343A] hover:border-[#BE7690]'
                  }`}
                >
                  {n === 1 ? 'Tek çekim' : `${n} taksit`}
                </button>
              ))}
            </div>

            <label className="mt-3 block sm:max-w-[220px]">
              <span className={label}><CalendarDays className="h-3.5 w-3.5 text-[#A5556E]" /> İlk vade</span>
              <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={field} />
            </label>

            {financed > 0 ? (
              <div className="mt-3">
                <div className="text-[11.5px] font-semibold text-[#3E343A]">
                  {count} × {formatTL(perInstallment)}
                  <span className="ml-1.5 font-normal text-[#74616A]">· ilk vade {shortDay(firstDue)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {preview.map((p) => (
                    <span key={p.no} className="rounded-[9px] border border-[#EAD8DF] bg-white px-2 py-1 text-[10.5px] text-[#3E343A]">
                      #{p.no} · {shortDay(p.due)} · <b>{formatTL(p.amount)}</b>
                    </span>
                  ))}
                  {count > 4 && (
                    <span className="rounded-[9px] bg-[#F6DFE6] px-2 py-1 text-[10.5px] font-semibold text-[#8C4460]">+{count - 4} taksit daha</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-[10px] border border-dashed border-[#EAD8DF] bg-white px-3 py-2 text-[11px] text-[#74616A]">
                Peşinat tutarın tamamını karşılıyor — taksit planı oluşmayacak (peşin satış).
              </div>
            )}
          </div>

          <label className="block">
            <span className={label}><FileText className="h-3.5 w-3.5 text-[#A5556E]" /> Not (opsiyonel)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${field} resize-none`} />
          </label>

          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[#74616A]">
              Toplam <b className="text-[#2A2027]">{formatTL(totalNum)}</b>
              {depositNum > 0 ? <> · peşinat <b className="text-emerald-700">{formatTL(depositNum)}</b></> : null}
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
                className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-4 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Cari hesabı aç
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
