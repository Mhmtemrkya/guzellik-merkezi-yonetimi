import type { BranchImpact } from './types'

/** Şube silme penceresindeki ücret satırları. */
export interface BranchRemovalLines {
  headline: string
  current: number
  next: number
  branchesAfter: number
  note: string
}

/**
 * Bir şube silinince paket tutarı (sunucunun hesapladığı etki: `current` = bugünkü şube sayısı, `next` = bir eksik).
 * Deneme sürecinde ücret alınmaz; ödenmiş dönem iade edilmez, yeni tutar sonraki ödemeden itibaren geçerlidir.
 * Yıllık pakette yıllık, öteki durumlarda aylık tutar gösterilir. Şube başına olmayan pakette etki yoktur (null).
 */
export function branchRemovalLines(impact: BranchImpact | null): BranchRemovalLines | null {
  if (!impact) return null
  const yearly = impact.period === 'yearly'
  const branchesAfter = Math.max(1, impact.branches - 1)
  // Tutarların hepsi sunucunun teklifinden (kademe ve KDV dahil); eski sunucu bugünkü yıllığı göndermezse aylığa düşülür.
  const current = yearly && impact.currentYearly ? impact.currentYearly.total : impact.currentMonthly.total
  const next = yearly && impact.currentYearly ? impact.nextYearly.total : impact.nextMonthly.total
  return {
    headline: impact.trial
      ? 'Deneme süresince ücret alınmaz. Paket satın aldığınızda aylık ücretiniz'
      : yearly && impact.currentYearly ? 'Sonraki ödemenizden itibaren yıllık ücretiniz' : 'Sonraki ödemenizden itibaren aylık ücretiniz',
    current,
    next,
    branchesAfter,
    note: impact.trial
      ? 'Silinen şube ilk ödemenizde hesaba katılmaz.'
      : 'Ödenmiş dönem için iade yapılmaz; yeni tutar bir sonraki ödemenizde geçerli olur.',
  }
}
