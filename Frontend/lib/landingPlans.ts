import 'server-only'

/**
 * TANITIM SAYFASI FİYAT VERİSİ — platformda tanımlı GERÇEK paketler.
 *
 * Veri `/api/public/plans` (anonim) ucundan gelir; platform yöneticisi paket kataloğunu
 * güncellediğinde tanıtım sayfası da güncellenir. Sayfa ISR ile yeniden üretildiği için her
 * istek backend'e gitmez (bkz. `revalidate`).
 *
 * BACKEND KAPALIYSA SAYFA ÇÖKMEZ: istek başarısız olursa `null` döner ve tanıtım sayfası
 * fiyat yerine "teklif isteyin" akışını gösterir. Tanıtım sayfası hiçbir koşulda API'ye
 * bağımlı olmamalıdır.
 */

export type { PublicPlan } from './plans'
// Etiket çeviricileri istemcide de gerekiyor; tek tanım `./plans` dosyasındadır.
export { planFeatureLabels, planLimitLabels } from './plans'

import type { PublicPlan } from './plans'

/** Sunucu tarafı çağrı için backend adresi (proxy rotasıyla aynı env değişkenleri). */
function backendBaseUrl(): string {
  const fromEnv = process.env.BACKEND_API_BASE_URL || process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5019'
}

export async function fetchPublicPlans(): Promise<PublicPlan[] | null> {
  const base = backendBaseUrl()
  if (!base) return null

  try {
    const res = await fetch(`${base}/api/public/plans`, {
      // Sayfa ISR ile üretilir; bu süre dolmadan backend'e tekrar gidilmez.
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null

    const payload = (await res.json()) as { success?: boolean; data?: PublicPlan[] }
    if (payload?.success !== true || !Array.isArray(payload.data)) return null

    // Ücretsiz/gizli paketler vitrine çıkmaz: fiyatı olmayan plan satın alınabilir bir teklif değildir.
    const paid = payload.data.filter((p) => p.monthlyPriceTRY > 0 || p.yearlyPriceTRY > 0)
    return paid.length > 0 ? paid : null
  } catch {
    // Ağ hatası / zaman aşımı — tanıtım sayfası fiyatsız akışa düşer.
    return null
  }
}
