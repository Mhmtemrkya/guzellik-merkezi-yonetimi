/**
 * PAKET TİPİ VE ETİKETLERİ — İSTEMCİ-GÜVENLİ.
 *
 * `lib/landingPlans.ts` `server-only` işaretlidir (backend'e gider). Ödeme ekranı gibi
 * İSTEMCİ bileşenleri de plan tipine ve etiket çeviricilerine ihtiyaç duyduğu için bu saf
 * parçalar buraya ayrıldı; aksi hâlde istemci sunucu modülünü içe aktarmaya çalışır ve
 * derleme "You're importing a module that depends on server-only" ile durur.
 *
 * BURAYA AĞ ÇAĞRISI VE GİZLİ ANAHTAR GİRMEZ.
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
