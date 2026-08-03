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

export interface PublicPlan {
  id: string
  name: string
  description: string | null
  monthlyPriceTRY: number
  yearlyPriceTRY: number
  maxBranches: number
  maxStaff: number
  maxCustomers: number
  features: string | null
  displayOrder: number
}

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

/**
 * Paketin `Features` alanı özellik ANAHTARLARINI taşır (ör. "appointments.waitlist").
 * Vitrinde okunabilir Türkçe karşılıkları gösterilir; eşleşmeyen anahtar atlanır ki
 * ziyaretçiye teknik anahtar görünmesin.
 */
const FEATURE_LABELS: Array<[RegExp, string]> = [
  [/waitlist/i, 'Bekleme listesi otomasyonu'],
  [/whatsapp/i, 'WhatsApp hatırlatma'],
  [/sms/i, 'SMS bildirimi'],
  [/mail|email/i, 'E-posta bildirimi'],
  [/online|portal|booking/i, 'Online randevu portalı'],
  [/report|rapor|analytic/i, 'Gelişmiş raporlar'],
  [/stock|stok|inventory/i, 'Stok yönetimi'],
  [/account|muhasebe|cash|kasa/i, 'Ön muhasebe ve kasa'],
  [/staff|personel|schedule|cizelge|çizelge/i, 'Personel ve çizelge'],
  [/package|paket|session|seans/i, 'Paket ve seans takibi'],
  [/consent|onam|kvkk/i, 'Onam ve KVKK formları'],
  [/loyalty|sadakat|gift|hediye|coupon|kupon/i, 'Sadakat ve hediye çeki'],
  [/device|cihaz|security|guvenlik|güvenlik/i, 'Cihaz güvenliği'],
  [/branch|sube|şube|multi/i, 'Çok şubeli kullanım'],
  [/salon|vitrin|showcase|public/i, 'Salon vitrini'],
]

export function planFeatureLabels(features: string | null, limit = 6): string[] {
  if (!features) return []
  const out: string[] = []
  for (const raw of features.split(',')) {
    const key = raw.trim()
    if (!key) continue
    const match = FEATURE_LABELS.find(([re]) => re.test(key))
    if (!match) continue
    if (!out.includes(match[1])) out.push(match[1])
    if (out.length >= limit) break
  }
  return out
}

/** Limit satırları: 0/negatif = sınırsız (paket kataloğundaki kural). */
export function planLimitLabels(plan: PublicPlan): string[] {
  const rows: string[] = []
  rows.push(plan.maxBranches > 0 ? `${plan.maxBranches} şube` : 'Sınırsız şube')
  rows.push(plan.maxStaff > 0 ? `${plan.maxStaff} kullanıcı` : 'Sınırsız kullanıcı')
  if (plan.maxCustomers > 0) rows.push(`${plan.maxCustomers.toLocaleString('tr-TR')} danışan`)
  else rows.push('Sınırsız danışan')
  return rows
}
