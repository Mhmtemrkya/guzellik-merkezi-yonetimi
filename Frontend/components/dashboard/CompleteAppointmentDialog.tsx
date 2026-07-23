'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, Banknote, Check, CheckCircle2, CreditCard, Loader2, Wallet, XCircle } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { formatTL } from '@/lib/apiMappers'
import type { CustomerAccount } from '@/lib/types'

// ---------------------------------------------------------------------------
// Randevu "Tamamlandı" akışı — her yüzeyde (günlük kart, liste, onay kutusu) ortak.
//  Adım 1: "Ödeme alındı mı?" → alındı / alınmadı.
//  Adım 2 (alındı): tutar (varsayılan = kalan borç) + yöntem (nakit/kart/havale).
// Onayda randevu Tamamlandı yapılır; ödeme alındıysa tahsilat cariye/adisyona işlenir
// (kalan borç varsa cari tahsilat = yöntem korunur; yoksa adisyon üzerinden ciroya işler).
// ---------------------------------------------------------------------------

interface CompleteAppointmentDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  appointmentId: string
  customerId?: string | null
  customerName?: string
  /** Yüzey biliyorsa doğrudan cari hesap (yöntem korunarak tahsilat). */
  accountId?: string | null
  /** Açık adisyon/servis fiyatı yoksa kullanılacak varsayılan tutar. */
  fallbackAmount?: number
  tenantId?: string
  onDone?: () => void | Promise<unknown>
}

interface OpenAdisyonLite {
  id: string
  chargeTotal?: number
  paymentTotal?: number
  customerAccountId?: string | null
}

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'transfer', label: 'Havale / EFT' },
]

export default function CompleteAppointmentDialog({
  open,
  onOpenChange,
  appointmentId,
  customerId,
  customerName,
  accountId,
  fallbackAmount = 0,
  tenantId,
  onDone,
}: CompleteAppointmentDialogProps) {
  const [step, setStep] = useState<'ask' | 'amount'>('ask')
  const [amount, setAmount] = useState<number | ''>('')
  const [method, setMethod] = useState('cash')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [openAdisyon, setOpenAdisyon] = useState<OpenAdisyonLite | null>(null)

  // Açılışta sıfırla + açık adisyon kalanını çekip varsayılan tutarı belirle.
  useEffect(() => {
    if (!open) return
    setStep('ask')
    setMethod('cash')
    setError('')
    setSaving(false)
    setAmount(fallbackAmount > 0 ? Math.round(fallbackAmount) : '')
    setOpenAdisyon(null)
    if (!customerId) return
    let cancelled = false
    adminApi
      .openAdisyon<OpenAdisyonLite>(customerId, tenantId)
      .then((a) => {
        if (cancelled || !a?.id) return
        setOpenAdisyon(a)
        const remaining = Math.max(0, Number(a.chargeTotal || 0) - Number(a.paymentTotal || 0))
        if (remaining > 0) setAmount(Math.round(remaining))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, customerId, tenantId, fallbackAmount])

  const finish = async (): Promise<void> => {
    if (onDone) await onDone()
    onOpenChange(false)
  }

  // Tahsilat hedefini çöz + kaydet (yöntem korunacak şekilde önce cari hesap).
  const collect = async (amt: number, mth: string): Promise<void> => {
    const nowIso = new Date().toISOString()
    // 1) Yüzeyden gelen ya da müşteri adından bulunan cari hesap → yöntem korunur.
    let targetAccountId = accountId || null
    if (!targetAccountId && openAdisyon?.customerAccountId) targetAccountId = openAdisyon.customerAccountId
    if (!targetAccountId && customerId) {
      try {
        const res = await adminApi.accounts<CustomerAccount>({ tenantId, search: customerName || '', page: 1, pageSize: 50 })
        const items = (res as { items?: CustomerAccount[] })?.items || []
        targetAccountId = items.find((a) => a.customerId === customerId)?.id || null
      } catch {
        // yoksay — adisyon yoluna düşülür
      }
    }
    if (targetAccountId) {
      await adminApi.registerAccountPayment(
        targetAccountId,
        { amount: amt, method: mth, reference: 'Randevu tahsilatı', occurredAtUtc: nowIso },
        tenantId,
      )
      return
    }
    // 2) Cari yok → açık adisyon (varsa) veya yeni adisyon üzerinden tahsilat + onay (ciroya işler).
    if (!customerId) return
    let adisyonId = openAdisyon?.id || null
    if (!adisyonId) {
      const created = await adminApi.createAdisyon<{ id?: string }>(
        { customerId, customerAccountId: null, notes: 'Randevu tahsilatı' },
        tenantId,
      )
      adisyonId = created?.id || null
    }
    if (!adisyonId) throw new Error('Tahsilat için adisyon açılamadı.')
    await adminApi.addAdisyonItem(
      adisyonId,
      { type: 'Payment', refId: null, description: 'Randevu tahsilatı', quantity: 1, unitPrice: amt, staffMemberId: null, coveredByPackage: false },
      tenantId,
    )
    await adminApi.approveAdisyon(adisyonId, tenantId)
  }

  const completeWithoutPayment = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await adminApi.changeAppointmentStatus(appointmentId, { status: 'Completed', reason: null }, tenantId)
      await finish()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Randevu tamamlanamadı.')
    } finally {
      setSaving(false)
    }
  }

  const completeWithPayment = async (): Promise<void> => {
    const amt = Number(amount || 0)
    if (!(amt > 0)) {
      setError('Tutar 0’dan büyük olmalı.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await adminApi.changeAppointmentStatus(appointmentId, { status: 'Completed', reason: null }, tenantId)
      await collect(amt, method)
      await finish()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Randevu tamamlandı fakat tahsilat işlenemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[12px] border border-emerald-200 bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4.5 w-4.5" />
          </span>
          <div>
            <DialogTitle className="text-[15px] font-bold text-[#2b1e29]">Randevuyu tamamla</DialogTitle>
            <DialogDescription className="mt-0.5 text-[11.5px] leading-snug text-[#8a7480]">
              {customerName ? `${customerName} · ` : ''}
              {step === 'ask' ? 'Bu randevu için ödeme alındı mı?' : 'Tahsilat tutarı ve yöntemini onayla.'}
            </DialogDescription>
          </div>
        </div>

        {step === 'ask' ? (
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setError('')
                setStep('amount')
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-[13px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(16,185,129,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Banknote className="h-4 w-4" /> Ödeme alındı
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void completeWithoutPayment()}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-[#ead8df] bg-white px-4 py-3 text-[13px] font-semibold text-[#5d4a56] transition-colors hover:border-[#efbfd0] hover:text-[#c85776] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Ödeme alınmadı
            </button>
            {error && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
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
                    autoFocus
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

            {openAdisyon && Math.max(0, Number(openAdisyon.chargeTotal || 0) - Number(openAdisyon.paymentTotal || 0)) > 0 && (
              <div className="rounded-[10px] border border-[#efe1e7] bg-[#fff8fa] px-3 py-2 text-[11px] text-[#8a7480]">
                Açık adisyon kalanı:{' '}
                <b className="text-[#c05277]">
                  {formatTL(Math.max(0, Number(openAdisyon.chargeTotal || 0) - Number(openAdisyon.paymentTotal || 0)))}
                </b>
              </div>
            )}

            {error && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setError('')
                  setStep('ask')
                }}
                className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#efbfd0] disabled:opacity-60"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Geri
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void completeWithPayment()}
                className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(16,185,129,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Tahsilatı al & tamamla
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
