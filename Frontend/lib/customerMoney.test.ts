import { describe, expect, it } from 'vitest'
import { reconcileCustomerMoney } from './customerMoney'

/**
 * BLOCKER B3: iptal + iade senaryosunda kartlar arasında açıklanamayan fark kalmamalı.
 */
describe('reconcileCustomerMoney', () => {
  it('DENETİM SENARYOSU: 1.000 tahsilat → iptal → 400 iade, fark açıklanır', () => {
    const s = reconcileCustomerMoney({
      liveTotal: 0, livePaid: 0, liveDebt: 0,
      cancelledTotal: 1000, cancelledRetained: 600, cancelledRefunded: 400,
    })

    expect(s.total).toBe(1000)
    expect(s.collected).toBe(600)
    // 400'ün nereye gittiği artık BİR KALEM: iade.
    expect(s.refunded).toBe(400)
    expect(s.debt).toBe(0)
    // Kimlik kapanıyor: 1000 − 600 − 400 − 0 = 0
    expect(s.balances).toBe(true)
    expect(s.unexplained).toBe(0)
  })

  it('normal satış: harcama − tahsilat = borç', () => {
    const s = reconcileCustomerMoney({
      liveTotal: 30000, livePaid: 10000, liveDebt: 20000,
      cancelledTotal: 0, cancelledRetained: 0, cancelledRefunded: 0,
    })

    expect(s.balances).toBe(true)
    expect(s.refunded).toBe(0)
  })

  it('iadesiz iptal: para kurumda kalır, fark yok', () => {
    const s = reconcileCustomerMoney({
      liveTotal: 0, livePaid: 0, liveDebt: 0,
      cancelledTotal: 1000, cancelledRetained: 1000, cancelledRefunded: 0,
    })

    expect(s.collected).toBe(1000)
    expect(s.balances).toBe(true)
  })

  it('FAZLA ÖDEME kimliği kapatmaz — ve bu BİLİNEN/İSTENEN durumdur', () => {
    // Açık borç cari BAŞINA sıfırla sınırlanır: fazla ödeme alacak olur, borcu eksiye çekmez.
    const s = reconcileCustomerMoney({
      liveTotal: 1000, livePaid: 1200, liveDebt: 0,
      cancelledTotal: 0, cancelledRetained: 0, cancelledRefunded: 0,
    })

    expect(s.balances).toBe(false)
    // Negatif = müşterinin alacağı var.
    expect(s.unexplained).toBe(-200)
  })

  it('canlı + iptal karışık: iki kaynak birlikte kapanır', () => {
    const s = reconcileCustomerMoney({
      liveTotal: 5000, livePaid: 2000, liveDebt: 3000,
      cancelledTotal: 1000, cancelledRetained: 600, cancelledRefunded: 400,
    })

    expect(s.total).toBe(6000)
    expect(s.collected).toBe(2600)
    expect(s.refunded).toBe(400)
    expect(s.debt).toBe(3000)
    expect(s.balances).toBe(true)
  })

  it('kuruş yuvarlaması kimliği bozmaz', () => {
    const s = reconcileCustomerMoney({
      liveTotal: 100.01, livePaid: 33.34, liveDebt: 66.67,
      cancelledTotal: 0, cancelledRetained: 0, cancelledRefunded: 0,
    })
    expect(s.balances).toBe(true)
  })
})
