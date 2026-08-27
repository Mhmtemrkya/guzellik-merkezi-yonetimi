'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Check, LockKeyhole, LogIn, ShieldCheck, ShoppingBag, UserPlus,
} from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { apiRequest } from '@/lib/apiClient'
import { useCart } from '@/lib/cart'
import { planFeatureLabels, planLimitLabels, type PublicPlan } from '@/lib/plans'
import PressButton from '@/components/landing/apple/PressButton'
import { legalLinks } from '@/lib/legal/company'

/**
 * ÖDEME EKRANI — solda ne aldığınız, sağda ödeme.
 *
 * KART BİLGİSİ BİZE HİÇ GELMEZ. Sağ sütundaki kart alanları bizim değil, iyzico'nun kendi
 * Ortak Ödeme Sayfası (Checkout Form) içeriğidir; backend `POST /api/admin/billing/checkout`
 * yanıtında `formContent` (gömülecek form) ya da `redirectUrl` (yönlendirme) döner ve biz
 * yalnız onu sahneye koyarız. Kart numarası, son kullanma ve CVC alanlarını KENDİMİZ
 * çizmeyiz — çizersek kart verisi sunucumuzdan geçer ve PCI-DSS yükümlülüğü doğar.
 *
 * ÜÇ DURUM:
 *   1) Sepet boş           → planlara geri dön.
 *   2) Giriş yapılmamış    → bu sayfada giriş / kayıt yolu; seçim sepette bekler, kaybolmaz.
 *   3) Girişli             → "iyzico ile öde" formu başlatır, iyzico formu sağ sütunda açılır.
 *
 * TUTAR: soldaki rakam GÖSTERİMDİR. Tahsil edilecek tutarı backend yanıtındaki `amountTRY`
 * söyler ve form açıldığında onu gösteririz; istemciden gelen fiyat ödemeye esas alınmaz.
 */

interface CheckoutResponse {
  checkoutToken: string
  formContent?: string | null
  redirectUrl?: string | null
  amountTRY: number
}

const tl = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`

/** KDV oranı yalnız GÖSTERİM içindir; tahsilatta geçerli olan sunucunun döndüğü tutardır. */
const VAT_RATE = 0.2

export default function CheckoutClient({ plans }: { plans: PublicPlan[] | null }) {
  const { hydrated, isAuthenticated, user } = useAuth()
  const { item, clear } = useCart()
  const [mounted, setMounted] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null)
  const formHost = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const plan = useMemo(
    () => (item && plans ? plans.find((p) => p.id === item.planId) ?? null : null),
    [item, plans],
  )

  /** Yıllık seçimde aylık karşılığı da gösterilir; kullanıcı neye baktığını bilsin. */
  const gross = item?.period === 'yearly' ? plan?.yearlyPriceTRY ?? 0 : plan?.monthlyPriceTRY ?? 0
  const net = gross > 0 ? gross / (1 + VAT_RATE) : 0
  const vat = gross - net

  /**
   * iyzico'nun form içeriği <script> taşır. `dangerouslySetInnerHTML` ile basılan script'ler
   * TARAYICI TARAFINDAN ÇALIŞTIRILMAZ (HTML spesifikasyonu); bu yüzden düğümleri elle
   * kopyalayıp script etiketlerini yeniden oluşturmak gerekir. Aksi hâlde sağ sütunda boş
   * bir kutu kalır ve "ödeme açılmıyor" denir.
   */
  useEffect(() => {
    const host = formHost.current
    const html = checkout?.formContent
    if (!host || !html) return

    host.innerHTML = ''
    const tpl = document.createElement('template')
    tpl.innerHTML = html

    Array.from(tpl.content.childNodes).forEach((node) => {
      if (node.nodeName === 'SCRIPT') {
        const src = node as HTMLScriptElement
        const fresh = document.createElement('script')
        Array.from(src.attributes).forEach((a) => fresh.setAttribute(a.name, a.value))
        fresh.text = src.text
        host.appendChild(fresh)
      } else {
        host.appendChild(node.cloneNode(true))
      }
    })
  }, [checkout])

  async function startCheckout(): Promise<void> {
    if (!item) return
    setBusy(true)
    setError('')
    try {
      const res = await apiRequest<CheckoutResponse>('/api/admin/billing/checkout', {
        method: 'POST',
        body: { subscriptionPlanId: item.planId, billingPeriod: item.period },
      })
      // Sağlayıcı yönlendirme istiyorsa oraya gideriz; formu gömmek her akışta mümkün değildir.
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl
        return
      }
      setCheckout(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ödeme başlatılamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const ready = mounted && hydrated

  return (
    <div className="min-h-screen bg-[#140A11] text-white antialiased lg:grid lg:grid-cols-2">
      {/* ============ SOL: NE ALIYORSUNUZ ============ */}
      <aside className="relative flex flex-col px-5 py-10 sm:px-10 lg:px-14 lg:py-14">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5 text-white/80 transition-colors hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          <Image src="/logo.png" alt="" width={30} height={30} className="h-[30px] w-[30px] object-contain" />
          <span className="text-[14.5px] font-semibold tracking-[-0.02em]">BeautyAsist</span>
        </Link>

        <div className="mt-12 max-w-[460px] lg:ml-auto lg:mr-0 lg:w-full">
          {!ready ? (
            <div className="h-40 animate-pulse rounded-[20px] bg-white/5" />
          ) : !item || !plan ? (
            <EmptyCart onBack={() => window.location.assign('/#fiyat')} />
          ) : (
            <>
              <p className="text-[14px] text-white/70">
                <strong className="font-medium text-white">{plan.name}</strong> aboneliğine geçin
              </p>
              <p className="mt-3 flex items-end gap-2">
                <span className="text-[42px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                  {tl(gross)}
                </span>
                <span className="pb-1 text-[14px] text-white/70">
                  {item.period === 'yearly' ? 'yılda bir' : 'ayda bir'}
                </span>
              </p>
              {item.period === 'yearly' && gross > 0 && (
                <p className="mt-1.5 text-[12.5px] text-white/60">
                  {tl(gross / 12)} / ay, yıllık olarak faturalandırılır
                </p>
              )}

              <div className="mt-9 space-y-4 border-t border-white/15 pt-6">
                <Row label={plan.name} sub={item.period === 'yearly' ? 'Yıllık faturalandırılır' : 'Aylık faturalandırılır'} value={tl(net)} />
                <Row label="Ara toplam" value={tl(net)} bold />
                <Row label="KDV (%20)" value={tl(vat)} muted />
                <div className="border-t border-white/15 pt-4">
                  <Row label="Bugün ödenecek toplam" value={tl(gross)} bold big />
                </div>
              </div>

              <ul className="mt-8 hidden space-y-2.5 border-t border-white/15 pt-6 lg:block">
                {[...planLimitLabels(plan), ...planFeatureLabels(plan.features, 5)].map((f) => (
                  <li key={f} className="flex gap-2.5 text-[13px] text-white/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#FFB6CC]" strokeWidth={2.2} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  clear()
                  // Tam gezinme: tarayıcı `#fiyat` çapasına kendisi kaydırır. İstemci tarafı
                  // gezinmede uzun/videolu sayfada çapa güvenilmez şekilde kaçırılıyordu.
                  window.location.assign('/#fiyat')
                }}
                className="mt-6 text-[12.5px] text-white/55 underline-offset-4 lg:mt-8 transition-colors hover:text-white/85 hover:underline"
              >
                Planı değiştir
              </button>
            </>
          )}
        </div>

        <p className="mt-auto pt-12 text-[11.5px] text-white/45">
          Kurulum, veri aktarımı ve eğitim dahildir. Aboneliğinizi istediğiniz zaman panelden
          iptal edebilirsiniz.
        </p>
      </aside>

      {/* ============ SAĞ: ÖDEME ============ */}
      <section className="min-h-[100svh] bg-white px-5 py-10 text-[#352432] sm:px-10 lg:px-14 lg:py-14">
        <div className="mx-auto w-full max-w-[440px]">
          {!ready ? (
            <div className="h-64 animate-pulse rounded-[20px] bg-[#FFF0F5]" />
          ) : !item || !plan ? (
            <p className="text-[14px] text-[#705A66]">Ödemeye geçmek için önce bir plan seçin.</p>
          ) : !isAuthenticated ? (
            <SignInPanel />
          ) : checkout ? (
            <>
              <header className="mb-6">
                <h1 className="font-display text-[22px] tracking-[-0.025em]">Kart bilgileri</h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#705A66]">
                  Ödeme <strong className="font-semibold">iyzico</strong> güvenli ödeme sayfasında
                  tamamlanır. Kart bilgileriniz BeautyAsist sunucularına gönderilmez ve saklanmaz.
                </p>
                <p className="mt-3 text-[13px] font-medium text-[#352432]">
                  Tahsil edilecek tutar: {tl(checkout.amountTRY)}
                </p>
              </header>

              {/* iyzico'nun kendi formu buraya gelir — alanları biz çizmeyiz. */}
              <div ref={formHost} id="iyzipay-checkout-form" className="responsive" />
            </>
          ) : (
            <PayPanel
              user={user?.fullName || user?.email || ''}
              amount={tl(gross)}
              busy={busy}
              error={error}
              onPay={startCheckout}
            />
          )}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Row({
  label,
  sub,
  value,
  bold = false,
  big = false,
  muted = false,
}: {
  label: string
  sub?: string
  value: string
  bold?: boolean
  big?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className={`${big ? 'text-[15px]' : 'text-[13.5px]'} ${bold ? 'font-semibold text-white' : 'text-white/85'}`}>
          {label}
        </p>
        {sub && <p className="mt-0.5 text-[12px] text-white/55">{sub}</p>}
      </div>
      <p
        className={`shrink-0 tabular-nums ${big ? 'text-[17px]' : 'text-[13.5px]'} ${
          bold ? 'font-semibold text-white' : muted ? 'text-white/70' : 'text-white/85'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function EmptyCart({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-[20px] border border-white/15 bg-white/5 p-7">
      <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-[#FFB6CC]">
        <ShoppingBag className="h-5 w-5" strokeWidth={1.7} />
      </span>
      <h1 className="mt-5 font-display text-[20px] tracking-[-0.025em] text-white">Sepetiniz boş</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-white/75">
        Merkezinize uygun paketi seçin; ödeme adımına buradan devam edersiniz.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-[#8E3F5B]"
      >
        Paketleri görün
      </button>
    </div>
  )
}

/**
 * GİRİŞ YAPILMAMIŞ DURUM.
 *
 * Burada parola alanı AÇILMAZ: panel girişi iki adımlıdır (parola + e-postaya gelen kod) ve o
 * akışın ikinci ekranı `/login`'de yaşar. Buraya bir kopyasını koymak, 2FA meydan okumasını
 * iki yerde yönetmek demektir — sapma kaçınılmazdır. Bunun yerine kullanıcı `/login`'e
 * gönderilir; SEÇİMİ SEPETTE BEKLER ve giriş biter bitmez bu sayfaya geri döner.
 */
function SignInPanel() {
  return (
    <div>
      <h1 className="font-display text-[22px] tracking-[-0.025em]">Ödemeyi tamamlamak için hesap gerekli</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[#705A66]">
        Abonelik bir kuruma bağlanır. Giriş yapın ya da 14 gün ücretsiz deneme ile kurumunuzu
        oluşturun — <strong className="font-semibold text-[#352432]">seçtiğiniz paket sepette bekliyor</strong>,
        işlem bittiğinde buraya döneceksiniz.
      </p>

      <div className="mt-7 space-y-3">
        <PressButton href="/login" tone="primary" className="w-full px-6 py-3.5 text-[15px] font-medium">
          <LogIn className="h-4 w-4" /> Giriş yap
        </PressButton>
        <PressButton
          href="/kayit"
          tone="glass-light"
          className="w-full border border-[#EEC9D7] px-6 py-3.5 text-[15px] font-medium"
        >
          <UserPlus className="h-4 w-4" /> Ücretsiz kayıt olun
        </PressButton>
      </div>

      <div className="mt-8 rounded-[16px] border border-[#EEC9D7] bg-[#FFF7FA] p-5">
        <p className="flex items-center gap-2 text-[13px] font-medium text-[#352432]">
          <ShieldCheck className="h-4 w-4 text-[#EF6F94]" /> Ödeme iyzico ile korunur
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#5A4752]">
          Kart bilgileriniz iyzico’nun güvenli ödeme sayfasında girilir; BeautyAsist
          sunucularına gönderilmez ve saklanmaz.
        </p>
      </div>

      <LegalNote />
    </div>
  )
}

/** Girişli kullanıcı için ödeme başlatma. */
function PayPanel({
  user,
  amount,
  busy,
  error,
  onPay,
}: {
  user: string
  amount: string
  busy: boolean
  error: string
  onPay: () => void
}) {
  return (
    <div>
      <h1 className="font-display text-[22px] tracking-[-0.025em]">Ödeme yöntemi</h1>
      {user && (
        <p className="mt-1.5 text-[13px] text-[#705A66]">
          <span className="font-medium text-[#352432]">{user}</span> olarak ödeme yapıyorsunuz.
        </p>
      )}

      <div className="mt-6 rounded-[18px] border-2 border-[#EF6F94] bg-[#FFF7FA] p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5 text-[14.5px] font-semibold text-[#352432]">
            <LockKeyhole className="h-4 w-4 text-[#EF6F94]" />
            iyzico ile öde
          </span>
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-[#EF6F94]">
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </span>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[#5A4752]">
          Kredi kartı, banka kartı ve taksit seçenekleri iyzico’nun güvenli ödeme sayfasında
          sunulur. Kart bilgileriniz bize iletilmez.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {['Visa', 'Mastercard', 'Troy', 'American Express'].map((b) => (
            <span key={b} className="rounded-md border border-[#EEC9D7] bg-white px-2.5 py-1 text-[11px] text-[#5A4752]">
              {b}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-[14px] border border-[#F0A9A9] bg-[#FFF1F1] px-4 py-3 text-[13px] text-[#9B2C2C]">
          {error}
        </p>
      )}

      <PressButton
        tone="primary"
        onClick={busy ? undefined : onPay}
        className={`mt-6 w-full px-6 py-4 text-[15.5px] font-semibold ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        {busy ? 'Ödeme sayfası hazırlanıyor…' : `${amount} öde`}
      </PressButton>

      <p className="mt-4 text-[12px] leading-relaxed text-[#705A66]">
        Ödemeyi onaylayarak, iptal edene kadar BeautyAsist’in bu tutarı dönem başında tahsil
        etmesine izin vermiş olursunuz.
      </p>

      <LegalNote />
    </div>
  )
}

/** Ödeme kuruluşu incelemesi sözleşmelere ödeme noktasından da erişilmesini arar. */
function LegalNote() {
  return (
    <div className="mt-7 border-t border-[#F2DFE7] pt-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {legalLinks.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-[11.5px] text-[#705A66] underline-offset-4 hover:text-[#EF6F94] hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
