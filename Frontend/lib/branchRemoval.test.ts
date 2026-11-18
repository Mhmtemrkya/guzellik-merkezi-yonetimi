import { describe, expect, it } from 'vitest'
import { branchRemovalLines } from './branchRemoval'
import type { BranchImpact } from './types'

const quote = (total: number) => ({ total }) as BranchImpact['currentMonthly']

const impact = (over: Partial<BranchImpact> = {}): BranchImpact => ({
  planName: 'BeautyAsist',
  trial: false,
  branches: 3,
  unitMonthly: 1000,
  unitYearly: 10000,
  vatRate: 0.2,
  currentMonthly: quote(3600),
  nextMonthly: quote(2400),
  nextYearly: quote(24000),
  period: 'monthly',
  currentYearly: quote(36000),
  ...over,
})

describe('şube silme ücret satırları', () => {
  it('şube başına olmayan pakette etki yok', () => {
    expect(branchRemovalLines(null)).toBeNull()
  })

  it('aylık pakette sonraki aylık tutar bir şube eksik', () => {
    expect(branchRemovalLines(impact())).toEqual({
      headline: 'Sonraki ödemenizden itibaren aylık ücretiniz',
      current: 3600,
      next: 2400,
      branchesAfter: 2,
      note: 'Ödenmiş dönem için iade yapılmaz; yeni tutar bir sonraki ödemenizde geçerli olur.',
    })
  })

  it('yıllık pakette yıllık tutarlar; eski sunucu bugünkü yıllığı vermezse aylığa düşülür', () => {
    const yearly = branchRemovalLines(impact({ period: 'yearly' }))!
    expect([yearly.headline, yearly.current, yearly.next]).toEqual(['Sonraki ödemenizden itibaren yıllık ücretiniz', 36000, 24000])
    const old = branchRemovalLines(impact({ period: 'yearly', currentYearly: null }))!
    expect([old.headline, old.current, old.next]).toEqual(['Sonraki ödemenizden itibaren aylık ücretiniz', 3600, 2400])
  })

  it('denemede ücret alınmaz; tek şubeden aşağı düşülmez', () => {
    const trial = branchRemovalLines(impact({ trial: true, branches: 1 }))!
    expect(trial.headline).toContain('Deneme süresince ücret alınmaz')
    expect(trial.note).toBe('Silinen şube ilk ödemenizde hesaba katılmaz.')
    expect(trial.branchesAfter).toBe(1)
  })
})
