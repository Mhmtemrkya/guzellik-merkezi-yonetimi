'use client'

import { useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Building2, CheckCircle2, CreditCard, Info, Loader2, MapPin, Receipt, Star, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, ApiClientError } from '@/lib/apiClient'
import { idempotencyKey, newIdempotencySalt } from '@/lib/idempotency'
import { findBranchInvoice, type PayableInvoice } from '@/lib/branchInvoice'
import type { BranchChargeQuote } from '@/lib/types'

/** Kuruşlu tutar: orantılı ücret küsuratlıdır (580,64 ₺); yuvarlamak onaylanan tutarı yanlış gösterirdi. */
const tl = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Liste fiyatı: tam lira kuruşsuz (₺1.000). */
const price = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

interface CheckoutStarted { redirectUrl?: string | null }

/**
 * YENİ ŞUBE MODALI (kullanıcı isteği 18 Kas 2026: "şube eklerken ücret mesajı çıksın, daha güzel modalı olsun").
 * Ücret etkisini SUNUCU hesaplar (`/billing/branch-quote` → `impact`): şube başı birim fiyat ve bir şube daha
 * eklenince paketin aylık/yıllık toplamı — deneme süresinde de gösterilir. Ücretli dönemde bugün kesilecek orantılı
 * tutar ayrıca onaylatılır; düğmeye basmak o tutarın onayıdır (istek onaylanan tutarı taşır, tutar arada değişirse
 * sunucu 409 döner ve teklif tazelenir). Ödeme Maydanoz'daysa şube faturası maydanozasist.com'da ödenir ve şube
 * ödeme alınınca açılır.
 */
export default function BranchCreateModal({
  tenantId,
  platformAdmin = false,
  onCreated,
  trigger,
}: {
  tenantId?: string
  /** Platform yöneticisinin açtığı şube ücretlendirilmez (sunucu kuralı): teklif sorulmaz. */
  platformAdmin?: boolean
  onCreated: () => void | Promise<void>
  trigger: (open: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const { data: charge, loading } = useApiQuery<BranchChargeQuote | null>(
    () => (open && !platformAdmin ? adminApi.branchChargeQuote<BranchChargeQuote>(tenantId).catch(() => null) : Promise.resolve(null)),
    [tenantId, open, refresh],
    { initialData: null },
  )
  const [name, setName] = useState('Yeni Şube')
  const [city, setCity] = useState('İstanbul')
  // Varsayılan HER ZAMAN kapalı: kurumun zaten bir varsayılan şubesi var; sayfa verisi gelmeden açılan pencere
  // yeni şubeyi yanlışlıkla varsayılan yapmasın.
  const [isDefault, setIsDefault] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  // Fatura sitede ödenebiliyor mu (sağlayıcı Maydanoz)? Ödeme adımına geçerken teklif kapanabilir; bayrak saklanır.
  const [payOnline, setPayOnline] = useState(false)
  // İDEMPOTENCY: anahtar İÇERİKTEN türer (tuz + ad/şehir/varsayılan/onaylı tutar). Sonucu bilinmeyen deneme aynı
  // tuzla tekrarlanır → sunucu ilk yanıtı oynatır (ikinci şube / ücret / fatura yok). Kesin yanıtta tuz yenilenir.
  const salt = useRef<string>(newIdempotencySalt())

  const impact = charge?.impact ?? null
  const chargeTotal = charge?.chargeRequired ? charge.quote?.total ?? null : null
  const byInvoice = charge?.chargeMethod === 'Invoice'
  const needsAck = chargeTotal != null
  const period = impact?.period === 'yearly' ? 'yearly' : 'monthly'
  const nextTotal = impact ? (period === 'yearly' ? impact.nextYearly.total : impact.nextMonthly.total) : null

  const reset = () => {
    setName('Yeni Şube'); setCity('İstanbul'); setIsDefault(false)
    setAcknowledged(false); setError(null); setAwaiting(null); setBusy(false); setPaying(false); setPayOnline(false)
  }
  const show = () => { reset(); setRefresh((n) => n + 1); setOpen(true) }

  async function submit() {
    if (busy || !name.trim()) return
    setError(null)
    const payload: Record<string, unknown> = { name: name.trim(), city: city.trim(), isDefault }
    if (charge?.chargeRequired) {
      if (!charge.canPurchase || chargeTotal == null) {
        setError(charge.reason || 'Şube ücreti şu an tahsil edilemiyor.')
        return
      }
      payload.confirmedChargeTRY = chargeTotal
    }
    const key = idempotencyKey(salt.current, 'branch', String(payload.name), String(payload.city), isDefault ? 1 : 0,
      typeof payload.confirmedChargeTRY === 'number' ? payload.confirmedChargeTRY : null)
    setBusy(true)
    try {
      await adminApi.createBranch(payload, tenantId, key)
      salt.current = newIdempotencySalt()
      await onCreated()
      setOpen(false)
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'BranchAwaitingPayment') {
        // ÖDEMEDEN AÇILMAZ: fatura kesildi; şube ödeme alınınca açılır. Hata değil — ödeme adımı gösterilir.
        salt.current = newIdempotencySalt()
        setPayOnline(Boolean(charge?.invoicePayOnline))
        setAwaiting(e.message)
        await onCreated()
        return
      }
      if (e instanceof ApiClientError && e.status > 0 && e.status < 500) salt.current = newIdempotencySalt()
      setRefresh((n) => n + 1)
      setError(e instanceof Error ? e.message : 'Şube oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  /** Şube faturasını bulur (mesajdaki numara, yoksa şube adı) ve maydanozasist.com ödeme sayfasına gider. */
  async function payInvoice() {
    if (paying || !awaiting) return
    setPaying(true)
    setError(null)
    try {
      const invoices = await adminApi.billingInvoices<PayableInvoice>(tenantId)
      const invoice = findBranchInvoice(invoices, awaiting, name)
      if (!invoice) {
        window.location.href = '/panel/paket'
        return
      }
      const started = await adminApi.payBillingInvoice<CheckoutStarted>(invoice.id, tenantId)
      if (started?.redirectUrl) {
        window.location.href = started.redirectUrl
        return
      }
      setError('Ödeme sayfası açılamadı. Paketim sayfasındaki faturalardan ödeyebilirsiniz.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ödeme sayfası açılamadı.')
    } finally {
      setPaying(false)
    }
  }

  const field = 'w-full rounded-2xl border border-[#EAD8DF] bg-white px-4 py-3 text-[14px] text-[#2A2027] outline-none transition placeholder:text-[#B39AA6] focus:border-[#A5556E] focus:ring-4 focus:ring-[#A5556E]/15'

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
        <DialogContent
          className="flex flex-col overflow-hidden rounded-[28px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
          style={{ width: 'min(94vw, 560px)', maxWidth: 'min(94vw, 560px)', maxHeight: '94dvh' }}
        >
          <div className="flex min-h-0 max-h-[94dvh] flex-col overflow-hidden">
            {/* Bant: dolu marka rengi (palet kuralı), üstünde beyaz yazı. */}
            <div className="relative shrink-0 overflow-hidden bg-[#A5556E] px-6 pb-5 pt-6 text-white">
              <motion.span
                aria-hidden
                animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.08, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#F9A1B9]/40 blur-3xl"
              />
              <button type="button" onClick={() => !busy && setOpen(false)} aria-label="Kapat"
                className="absolute right-4 top-4 rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
                <X className="h-4 w-4" />
              </button>
              <div className="relative flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Building2 className="h-5 w-5" /></span>
                <div>
                  <DialogTitle className="text-[18px] font-semibold tracking-tight text-white">{awaiting ? 'Şube talebiniz alındı' : 'Yeni şube'}</DialogTitle>
                  <DialogDescription className="mt-0.5 text-[12.5px] text-white/80">
                    {awaiting ? 'Şube, ödeme alındığında açılacak.' : 'Şube fiziksel bir çalışma noktası tanımlar.'}
                  </DialogDescription>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-auto overflow-y-auto px-6 py-5">
              <AnimatePresence mode="wait" initial={false}>
                {awaiting ? (
                  <motion.div key="awaiting" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}
                    className="space-y-4">
                    <div className="flex gap-3 rounded-2xl border border-[#1E8C60]/25 bg-[#DFF3EA] p-4 text-[13px] leading-relaxed text-[#15694A]">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>{awaiting}</p>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-[#74616A]">
                      {payOnline
                        ? <>Faturayı şimdi maydanozasist.com&apos;un güvenli ödeme sayfasında ödeyebilirsiniz. Daha sonra ödemek isterseniz <b>Paketim → Faturalar</b> bölümünde bekler.</>
                        : <>Faturanız <b>Paketim → Faturalar</b> bölümünde görünür; ödeme alındığında şube kendiliğinden açılır.</>}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}
                    className="space-y-4">
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#5A4650]"><Building2 className="h-3.5 w-3.5" /> Şube adı</span>
                      <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#5A4650]"><MapPin className="h-3.5 w-3.5" /> Şehir</span>
                      <input className={field} value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#EAD8DF] bg-[#F7F6F6] px-4 py-3 text-[13px]">
                      <input type="checkbox" className="h-4 w-4 accent-[#A5556E]" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                      <Star className="h-4 w-4 text-[#A5556E]" /> Varsayılan şube olsun
                    </label>

                    {/* ÜCRET ETKİSİ — sunucunun hesapladığı tutarlar. */}
                    <div className="overflow-hidden rounded-2xl border border-[#EAD8DF] bg-white">
                      <div className="flex items-center gap-2 bg-[#1E8C60] px-4 py-2.5 text-[12.5px] font-semibold text-white">
                        <Receipt className="h-4 w-4" /> Ücretinize etkisi
                      </div>
                      <div className="space-y-3 px-4 py-4 text-[13px] leading-relaxed text-[#2A2027]">
                        {platformAdmin ? (
                          <p className="text-[#74616A]">Platform yöneticisinin açtığı şube ücretlendirilmez; kurumun ücreti değişmez.</p>
                        ) : loading && !charge ? (
                          <p className="flex items-center gap-2 text-[#74616A]"><Loader2 className="h-4 w-4 animate-spin" /> Ücret hesaplanıyor…</p>
                        ) : !impact ? (
                          <p className="text-[#74616A]">{charge?.reason || 'Paketiniz şube başına ücretlendirilmiyor; yeni şube ücretinizi değiştirmez.'}</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-[#74616A]">Şube başı ({impact.planName})</span>
                              <span className="font-semibold">{price(impact.unitMonthly)} + KDV / ay <span className="font-normal text-[#74616A]">· yıllıkta {price(impact.unitYearly)} + KDV</span></span>
                            </div>
                            {impact.trial ? (
                              <div className="rounded-xl bg-[#F7F6F6] p-3">
                                <p><b>Deneme süresince ücretsiz.</b> Paket satın aldığınızda bu şube ücretinize yansır:</p>
                                <p className="mt-1.5">Aylık <b>{tl(impact.currentMonthly.total)}</b> → <b className="text-[#A5556E]">{tl(impact.nextMonthly.total)}</b> <span className="text-[#74616A]">(KDV dahil, +{tl(impact.nextMonthly.total - impact.currentMonthly.total)})</span></p>
                                <p className="text-[#74616A]">Yıllık ödemede {tl(impact.nextYearly.total)} (KDV dahil, {impact.branches + 1} şube)</p>
                              </div>
                            ) : chargeTotal != null ? (
                              <div className="rounded-xl bg-[#F7F6F6] p-3">
                                <p className="flex items-start gap-2">
                                  {byInvoice ? <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-[#A5556E]" /> : <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#A5556E]" />}
                                  <span>
                                    Bugün <b className="text-[#A5556E]">{tl(chargeTotal)}</b> (KDV dahil, dönem sonuna kadar orantılı){' '}
                                    {byInvoice
                                      ? charge?.invoicePayOnline
                                        ? <>için fatura kesilir; şube, ödeme maydanozasist.com&apos;da alındığında açılır.</>
                                        : <>için fatura kesilir; şube, ödeme alındığında açılır.</>
                                      : <>kayıtlı kartınızdan{charge?.cardMasked ? ` (${charge.cardMasked})` : ''} çekilir.</>}
                                  </span>
                                </p>
                                {nextTotal != null ? (
                                  <p className="mt-1.5 text-[#74616A]">Sonraki dönemden itibaren {period === 'yearly' ? 'yıllık' : 'aylık'} ücretiniz <b className="text-[#2A2027]">{tl(nextTotal)}</b> (KDV dahil, {impact.branches + 1} şube).</p>
                                ) : null}
                              </div>
                            ) : (
                              <div className="rounded-xl bg-[#F7F6F6] p-3">
                                {charge?.reason ? <p className="mb-1.5">{charge.reason}</p> : null}
                                <p>{period === 'yearly' ? 'Yıllık' : 'Aylık'} ücretiniz <b className="text-[#A5556E]">{tl(nextTotal ?? 0)}</b> olur (KDV dahil, {impact.branches + 1} şube).</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {needsAck ? (
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#A5556E]/30 bg-[#FCF3F6] px-4 py-3 text-[12.5px] leading-relaxed text-[#5A1730]">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#A5556E]" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                        <span>{tl(chargeTotal!)} tutarındaki şube ücretini ve ücretime yansıyacak değişikliği okudum, onaylıyorum.</span>
                      </label>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>

              {error ? (
                <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#EAD8DF] bg-[#F7F6F6] px-6 py-4">
              {awaiting ? (
                <>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#74616A] transition hover:bg-white">{payOnline ? 'Daha sonra' : 'Tamam'}</button>
                  {payOnline ? <button type="button" onClick={() => void payInvoice()} disabled={paying}
                    className="inline-flex items-center gap-2 rounded-full bg-[#1E8C60] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_14px_30px_-16px_rgba(30,140,96,0.9)] transition hover:bg-[#15694A] disabled:opacity-60">
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Faturayı maydanozasist.com&apos;da öde <ArrowRight className="h-4 w-4" />
                  </button> : null}
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#74616A] transition hover:bg-white">Vazgeç</button>
                  <button type="button" onClick={() => void submit()} disabled={busy || !name.trim() || (needsAck && !acknowledged) || (!platformAdmin && loading && !charge)}
                    className="inline-flex items-center gap-2 rounded-full bg-[#A5556E] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_14px_30px_-16px_rgba(165,85,110,0.9)] transition hover:bg-[#8C4460] disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                    {chargeTotal != null ? (byInvoice ? `${tl(chargeTotal)} faturayı onayla` : `${tl(chargeTotal)} öde ve şube oluştur`) : 'Şube oluştur'}
                  </button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
