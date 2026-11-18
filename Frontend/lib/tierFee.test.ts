import { describe, expect, it } from 'vitest'
import { nearThreshold, tierFeeView } from './tierFee'
import type { TierAllowance } from './types'

const base = (over: Partial<TierAllowance> = {}): TierAllowance => ({
  dimension: 'ConsentDocuments',
  allowed: true,
  count: 9_600,
  capacity: 10_000,
  paidTierAbove: null,
  nextTierAbove: 10_000,
  nextTierMonthlyFee: 250,
  canPurchase: true,
  reason: null,
  quote: null,
  chargeMethod: 'Invoice',
  cardMasked: null,
  openInvoiceNumber: null,
  subscriptionEndsAtUtc: null,
  impact: { trial: false, period: 'monthly', above: 10_000, currentTotal: 1_200, nextTotal: 1_500, increase: 300, increaseNet: 250 },
  ...over,
})

describe('tierFeeView', () => {
  it('stays silent far from the limit and on unlimited packages', () => {
    expect(tierFeeView(base({ count: 9_400 }), 'consents')).toBeNull()
    expect(tierFeeView(base({ capacity: null }), 'consents')).toBeNull()
    expect(tierFeeView(null, 'consents')).toBeNull()
  })

  it('warns near the limit with the server-computed fee impact', () => {
    const view = tierFeeView(base(), 'consents')!
    expect(view.tone).toBe('near')
    expect(view.title).toBe('İmzalı onam formu sınırınıza yaklaşıyorsunuz: 9.600 / 10.000 (400 kaldı).')
    expect(view.fee).toBe('10.000 imzalı onam formu sınırı aşıldığında aylık ücretinize +₺300,00 (KDV dahil) yansıyacak: ₺1.200,00 → ₺1.500,00.')
    expect(view.today).toBeNull()
  })

  it('turns red when the limit is reached and tells today’s prorated charge', () => {
    const view = tierFeeView(base({ count: 10_000, allowed: false, quote: { total: 150 } as TierAllowance['quote'] }), 'consents')!
    expect(view.tone).toBe('reached')
    expect(view.title).toBe('Ödenmiş imzalı onam formu kapasiteniz doldu (10.000 / 10.000).')
    expect(view.today).toBe('Kademeyi şimdi açarsanız bugün ₺150,00 (KDV dahil, dönem sonuna kadar orantılı) faturalanır.')
  })

  it('uses trial wording, yearly period and the open invoice', () => {
    const trial = tierFeeView(base({ dimension: 'Customers', count: 2, capacity: 2, impact: { trial: true, period: 'monthly', above: 2, currentTotal: 1_200, nextTotal: 1_500, increase: 300, increaseNet: 250 } }), 'customers', true)!
    expect(trial.fee).toBe('Paket satın aldığınızda 2 kayıtlı müşteri üzeri kademe aylık ücretinize +₺300,00 (KDV dahil) yansır.')
    expect(trial.today).toBeNull()

    const yearly = tierFeeView(base({ openInvoiceNumber: 'BA-2026-000009', quote: { total: 99 } as TierAllowance['quote'], impact: { trial: false, period: 'yearly', above: 10_000, currentTotal: 12_000, nextTotal: 15_000, increase: 3_000, increaseNet: 2_500 } }), 'consents', true)!
    expect(yearly.fee).toContain('yıllık ücretinize +₺3.000,00')
    expect(yearly.invoice).toBe('BA-2026-000009 numaralı fatura ödeme bekliyor; ödeme alındığında kademe açılır.')
    expect(yearly.today).toBeNull()
  })

  it('near threshold is at least ten and five percent of the capacity', () => {
    expect(nearThreshold(2)).toBe(10)
    expect(nearThreshold(10_000)).toBe(500)
  })
})
