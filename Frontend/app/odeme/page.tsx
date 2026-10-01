import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BILLING_ENABLED } from '@/lib/billing'
import { fetchPublicPlans } from '@/lib/landingPlans'
import CheckoutClient from '@/components/checkout/CheckoutClient'

export const metadata: Metadata = {
  title: 'Ödeme — BeautyAsist',
  description: 'Seçtiğiniz aboneliği iyzico güvencesiyle tamamlayın.',
}

/** Fiyat kataloğu tanıtım sayfasıyla aynı kaynaktan ve aynı tazeleme süresiyle gelir. */
export const revalidate = 300

/**
 * ÖDEME SAYFASI (sunucu kabuğu).
 *
 * Plan kataloğunu sunucuda alır ve istemci adasına verir. Sepetteki plan `localStorage`'da
 * durduğu için hangi planın seçildiğini yalnız istemci bilir; sunucu tüm ücretli planları
 * gönderir, eşleştirmeyi ada yapar.
 *
 * FİYAT GÖSTERİMDİR: burada yazan tutar bilgilendirmedir. TAHSİL EDİLECEK tutarı backend
 * `POST /api/admin/billing/checkout` yanıtındaki `amountTRY` belirler; istemciden gelen
 * hiçbir fiyat ödemeye esas alınmaz.
 */
export default async function CheckoutPage() {
  // Satış kapalı (bkz. lib/billing.ts): eski bir bağlantı ya da yer imiyle gelen ziyaretçi
  // ödeme yerine ücretsiz kayda gider.
  if (!BILLING_ENABLED) redirect('/kayit')
  const plans = await fetchPublicPlans()
  return <CheckoutClient plans={plans} />
}
