/**
 * PAKET SATIŞI AÇIK MI? (`NEXT_PUBLIC_BILLING_ENABLED`, varsayılan KAPALI)
 *
 * Şimdilik kurumlar kayıt olup ücretsiz kullanır: fiyatlandırma bölümü, plan seçimi, `/odeme`,
 * `/panel/paket` ve abonelik geri sayımı GİZLİDİR. Kod silinmedi, yalnız bu bayrağın arkasına
 * alındı; satış açılacağı gün `NEXT_PUBLIC_BILLING_ENABLED=true` ile geri gelir.
 *
 * Backend karşılığı `Billing:FreeMode` (bkz. backend `BillingMode.cs`) — ikisi BİRLİKTE
 * çevrilmelidir: yalnız bu açılırsa kurum askıya alınmadan paket sayfası görünür, yalnız backend
 * kapatılırsa denemesi biten kurum satın alacak bir sayfa bulamaz.
 */
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true'

/** Kayıt düğmelerinin ortak metni. */
export const SIGNUP_CTA = BILLING_ENABLED ? '14 gün ücretsiz dene' : 'Ücretsiz kayıt ol'
