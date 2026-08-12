'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, Banknote, Check, CheckCircle2, CreditCard, FileSignature, Loader2, ShieldAlert, Wallet, XCircle } from 'lucide-react'
import ConsentCenterModal from '@/components/dashboard/ConsentCenterModal'
import { adminApi, consentApi } from '@/lib/apiClient'
import { formatTL } from '@/lib/apiMappers'
import { missingRequirements } from '@/lib/consent'
import type { ApiConsentStatus } from '@/lib/types'

// ---------------------------------------------------------------------------
// Randevu "Tamamlandı" akışı — her yüzeyde (günlük kart, liste, onay kutusu) ortak.
//  Adım 0: ONAM FORMU KAPISI — bu randevunun hizmetine bağlı formlar imzalı mı? Eksikse
//          randevu tamamlanmadan önce uyarı çıkar ve formlar buradan görüntülenip imzaya
//          gönderilebilir. (Kapı YUMUŞAKTIR: yönetici "yine de tamamla" diyebilir; işi
//          durdurmak değil, imzasız işlem yapıldığını görünür kılmak amaçlanır.)
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

/**
 * Otomatik doldurulan tutarı KURUŞUNA kadar korur (yalnız kayan nokta artığını temizler).
 * Tam TL'ye yuvarlamak 999,50 ₺ kalanı 1.000 ₺ yapıp fazla tahsilat üretiyordu.
 */
function roundKurus(value: number): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
}

/** 32-bit FNV-1a. Kriptografik değil; amaç yalnızca kararlı ve çakışmayan bir ayırt edici üretmek. */
function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * İsteği ayırt eden alanların SABİT UZUNLUKLU (14 karakter) parmak izi — idempotency anahtarı için.
 * İki farklı tohumla 32'şer bit → 64 bit; her şerit base36'da 7 haneye doldurulur, böylece uzunluk
 * girdiden bağımsızdır ve anahtar hiçbir zaman kırpılıp ayırt edici alan kaybetmez.
 * Aynı algoritma mobilde de var (mobile/lib/features/appointments/complete_appointment.dart).
 */
function fingerprint(text: string): string {
  const lane = (seed: number): string => fnv1a32(text, seed).toString(36).padStart(7, '0')
  return `${lane(0x811c9dc5)}${lane(0x7b1a5f3d)}`
}

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
  const [step, setStep] = useState<'consent' | 'ask' | 'amount'>('ask')
  // Onam durumu: null = henüz bilinmiyor (kapı gösterilmez), dolu = kontrol edildi.
  const [consent, setConsent] = useState<ApiConsentStatus | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
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
    // KURUŞ KORUNUR: yuvarlama 999,50 ₺'yi 1.000 ₺ yapıp fazla tahsilat üretiyordu.
    setAmount(fallbackAmount > 0 ? roundKurus(fallbackAmount) : '')
    setOpenAdisyon(null)
    setConsent(null)
    setConsentOpen(false)
    if (!customerId) return
    let cancelled = false
    // Onam kapısı: eksik form varsa ilk ekran uyarı olur.
    consentApi
      .appointmentStatus<ApiConsentStatus>(appointmentId, tenantId)
      .then((st) => {
        if (cancelled) return
        setConsent(st)
        if (missingRequirements(st).length > 0) setStep('consent')
      })
      .catch(() => {})
    adminApi
      .openAdisyon<OpenAdisyonLite>(customerId, tenantId)
      .then((a) => {
        if (cancelled || !a?.id) return
        setOpenAdisyon(a)
        const remaining = roundKurus(Number(a.chargeTotal || 0) - Number(a.paymentTotal || 0))
        if (remaining > 0) setAmount(remaining)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, customerId, tenantId, fallbackAmount, appointmentId])

  /** Onam durumunu tazeler; eksik kalmadıysa kapıyı geçip ödeme adımına düşer. */
  const refreshConsent = async (): Promise<void> => {
    try {
      const st = await consentApi.appointmentStatus<ApiConsentStatus>(appointmentId, tenantId)
      setConsent(st)
      if (missingRequirements(st).length === 0 && step === 'consent') setStep('ask')
    } catch {
      // yoksay — kapı yumuşaktır
    }
  }

  const finish = async (): Promise<void> => {
    if (onDone) await onDone()
    onOpenChange(false)
  }

  /**
   * TAMAMLAMA + TAHSİLAT TEK İSTEK.
   *
   * Eskiden iki ayrı çağrı yapılıyordu: önce "Tamamlandı", sonra tahsilat. İkincisi ağda düşerse
   * randevu tamamlanmış (seans tüketilmiş) ama parası alınmamış hâlde kalıyordu — idempotency
   * anahtarı tekrarı güvenli kılıyor, ATOMİKLİĞİ sağlamıyordu. Artık sunucu ikisini tek
   * transaction'da uygular; tahsilat düşerse tamamlama da geri alınır.
   *
   * Hedef cari seçimi de sunucuya taşındı (accountId verilmezse borcu olan en eski cari, o da
   * yoksa adisyon defteri). Buradan yalnız yüzeyden gelen accountId iletilir.
   */
  const completeAtomically = async (payment: { amount: number; method: string } | null): Promise<void> => {
    // HEDEF CARİYİ İSTEMCİ TAHMİN ETMEZ. Burada müşterinin AÇIK ADİSYONUNUN carisi ekleniyordu:
    // randevu kendi satışından doğmuşsa (SourceAdisyonId) o cari BAŞKA bir satışa ait olabiliyor ve
    // tahsilat yanlış deftere yazılıyordu. Sunucu doğru hedefi zaten biliyor (randevunun kendi
    // satışının carisi → borçlu en eski cari → adisyon defteri) ve uyuşmayan bir cari gönderilirse
    // isteği reddediyor. Yalnız çağıranın AÇIKÇA verdiği cari iletilir.
    const targetAccountId = accountId || null
    // ANAHTAR PAYLOAD'IN TAMAMINI TEMSİL ETMELİ. Eskiden yalnız randevu + tutar + yöntem giriyordu:
    // yanlış cariyle yapılan ilk deneme 4xx alınca, kullanıcı DOĞRU cariyi seçip tekrar
    // gönderdiğinde anahtar aynı kaldığı için sunucu eski hatayı replay edebiliyordu (istek hiç
    // çalışmadan başarısız görünürdü).
    //
    // AYIRT EDİCİ ALANLAR ANAHTARA HASH OLARAK GİRER, KUYRUĞA EKLENİP KIRPILMAZ. Cari kimliğini
    // sona ekleyip anahtarı 52 karakterde kesmek aynı hatayı geri getiriyordu: "apc" + 32 hane
    // randevu + tutar (7 hane) + "transfer" zaten 52'yi doldurabildiği için cari parçası tümüyle
    // kesilebiliyor ve düzeltilmiş istek YİNE eski anahtarı üretiyordu. Sabit uzunluklu parmak izi
    // (3+32+1+14 = 50 karakter) hiçbir koşulda kırpılmaz.
    const idem = payment
      ? `apc${appointmentId.replace(/-/g, '')}-${fingerprint(
          `${Math.round(payment.amount * 100)}|${payment.method}|${targetAccountId ?? 'auto'}`,
        )}`
      : `apc${appointmentId.replace(/-/g, '')}`
    await adminApi.completeAppointment(
      appointmentId,
      {
        reason: null,
        payment: payment
          ? {
              amount: payment.amount,
              method: payment.method,
              reference: 'Randevu tahsilatı',
              accountId: targetAccountId,
              occurredAtUtc: new Date().toISOString(),
            }
          : null,
      },
      tenantId,
      idem,
    )
  }

  const completeWithoutPayment = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await completeAtomically(null)
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
      await completeAtomically({ amount: amt, method })
      await finish()
    } catch (e) {
      // Tek transaction: hata varsa randevu da tamamlanmamıştır.
      setError(e instanceof Error ? e.message : 'Randevu tamamlanamadı; tahsilat da işlenmedi.')
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
            <DialogDescription className="mt-0.5 text-[11.5px] leading-snug text-[#74616A]">
              {customerName ? `${customerName} · ` : ''}
              {step === 'consent'
                ? 'Onam formu kontrolü'
                : step === 'ask'
                  ? 'Bu randevu için ödeme alındı mı?'
                  : 'Tahsilat tutarı ve yöntemini onayla.'}
            </DialogDescription>
          </div>
        </div>

        {step === 'consent' ? (
          <div className="space-y-3">
            <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-amber-900">
                    {missingRequirements(consent).length} onam formu eksik
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-amber-900/85">
                    Bu işlem için imzalanması gereken formlar tamamlanmadı. Formları görüntüleyip müşterinin
                    tabletten imzalamasını sağlayabilirsiniz.
                  </div>
                  <ul className="mt-2 space-y-1">
                    {missingRequirements(consent).map((m) => (
                      <li key={m.templateId} className="flex items-center gap-1.5 text-[11.5px] font-medium text-amber-900">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {m.title}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setConsentOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#A5556E] px-4 py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <FileSignature className="h-4 w-4" /> Onam formlarını görüntüle
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep('ask')}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-[#EAD8DF] bg-white px-4 py-3 text-[12.5px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-60"
            >
              İmzasız devam et
            </button>
            <p className="text-center text-[11px] text-[#74616A]">
              İmzasız tamamlanan işlem, müşteri kartında ve cari/adisyon ekranlarında uyarı olarak görünmeye devam eder.
            </p>
          </div>
        ) : step === 'ask' ? (
          <div className="space-y-2.5">
            {missingRequirements(consent).length > 0 && (
              <button
                type="button"
                onClick={() => setStep('consent')}
                className="flex w-full items-center gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11.5px] font-semibold text-amber-900 transition-colors hover:bg-amber-100"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                {missingRequirements(consent).length} onam formu imzasız — görüntüle
              </button>
            )}
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
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-[#EAD8DF] bg-white px-4 py-3 text-[13px] font-semibold text-[#5d4a56] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-60"
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
                  <Wallet className="h-3.5 w-3.5 text-[#A5556E]" /> Tutar
                </label>
                <div className="flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 focus-within:border-[#BE7690]">
                  <span className="text-[13px] font-semibold text-[#74616A]">₺</span>
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-transparent text-[13px] font-semibold tabular-nums text-[#2A2027] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <CreditCard className="h-3.5 w-3.5 text-[#A5556E]" /> Yöntem
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#BE7690]"
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
              <div className="rounded-[10px] border border-[#EAD8DF] bg-[#fff8fa] px-3 py-2 text-[11px] text-[#74616A]">
                Açık adisyon kalanı:{' '}
                <b className="text-[#A5556E]">
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
                className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#BE7690] disabled:opacity-60"
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

      {customerId && (
        <ConsentCenterModal
          open={consentOpen}
          onClose={() => { setConsentOpen(false); void refreshConsent() }}
          customerId={customerId}
          customerName={customerName}
          appointmentId={appointmentId}
          onChanged={refreshConsent}
        />
      )}
    </Dialog>
  )
}
