import type { TierAllowance } from '@/lib/types'

/**
 * KADEME ÜCRET UYARISI (kullanıcı isteği 18 Kas 2026: "10 bin onam formu gibi ek ücret gereken yerlerde uyarıcı mesaj
 * çıksın: ücretinize bu kadar yansıyacak"). Tutarları SUNUCU hesaplar (`allowance.impact`); burada yalnız ne zaman ve
 * hangi metinle gösterileceğine karar verilir:
 *  - sınır DOLDU (409 `CustomerLimitReached` / `ConsentLimitReached` ya da `allowed: false`) → kırmızı uyarı;
 *  - sınıra YAKIN (kalan ≤ max(10, kapasitenin %5'i)) → sarı ön uyarı;
 *  - aksi halde ya da sınırsız pakette hiçbir şey gösterilmez.
 */
export type TierFeeDimension = 'customers' | 'consents'

export interface TierFeeView {
  tone: 'reached' | 'near'
  title: string
  fee: string | null
  today: string | null
  invoice: string | null
}

const UNIT: Record<TierFeeDimension, { one: string; title: string }> = {
  customers: { one: 'kayıtlı müşteri', title: 'Kayıtlı müşteri' },
  consents: { one: 'imzalı onam formu', title: 'İmzalı onam formu' },
}

const n = (value: number) => value.toLocaleString('tr-TR')
export const tl = (value: number) => `₺${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function nearThreshold(capacity: number): number {
  return Math.max(10, Math.ceil(capacity * 0.05))
}

export function tierFeeView(allowance: TierAllowance | null | undefined, dimension: TierFeeDimension, reached = false): TierFeeView | null {
  if (!allowance || allowance.capacity == null) return null
  const capacity = allowance.capacity
  const count = allowance.count
  const remaining = Math.max(0, capacity - count)
  const full = reached || !allowance.allowed || remaining === 0
  if (!full && remaining > nearThreshold(capacity)) return null

  const unit = UNIT[dimension]
  const impact = allowance.impact ?? null
  const period = impact?.period === 'yearly' ? 'yıllık' : 'aylık'
  const title = full
    ? `Ödenmiş ${unit.one} kapasiteniz doldu (${n(count)} / ${n(capacity)}).`
    : `${unit.title} sınırınıza yaklaşıyorsunuz: ${n(count)} / ${n(capacity)} (${n(remaining)} kaldı).`

  let fee: string | null = null
  if (impact && impact.increase > 0) {
    fee = impact.trial
      ? `Paket satın aldığınızda ${n(impact.above)} ${unit.one} üzeri kademe ${period} ücretinize +${tl(impact.increase)} (KDV dahil) yansır.`
      : `${n(impact.above)} ${unit.one} sınırı aşıldığında ${period} ücretinize +${tl(impact.increase)} (KDV dahil) yansıyacak: ${tl(impact.currentTotal)} → ${tl(impact.nextTotal)}.`
  }

  const total = allowance.quote?.total ?? 0
  const today = !impact?.trial && !allowance.openInvoiceNumber && total > 0
    ? `Kademeyi şimdi açarsanız bugün ${tl(total)} (KDV dahil, dönem sonuna kadar orantılı) ${allowance.chargeMethod === 'Card' ? 'kayıtlı kartınızdan çekilir' : 'faturalanır'}.`
    : null
  const invoice = allowance.openInvoiceNumber
    ? `${allowance.openInvoiceNumber} numaralı fatura ödeme bekliyor; ödeme alındığında kademe açılır.`
    : null

  return { tone: full ? 'reached' : 'near', title, fee, today, invoice }
}
