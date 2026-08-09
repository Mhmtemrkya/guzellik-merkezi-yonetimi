import { describe, expect, it } from 'vitest'
import { mapCancelledSale } from './apiMappers'

/**
 * İPTAL ARŞİVİ EŞLEMESİ — İADE KANALI KAYBOLMAMALI.
 *
 * Ekstre iadeyi "müşteriye geri ödendi" diye SENTETİK bir metinle gösteriyordu: paranın hangi
 * kanaldan çıktığı (nakit/kart/havale) hiçbir yerde görünmüyor, kart iadesi kasa kırılımında
 * nakit çıkışı gibi okunuyordu. Kanal iptal anında zaten kaydediliyordu; yalnız dışarı
 * verilmiyor ve eşlenmiyordu.
 */
describe('mapCancelledSale — iade satırları', () => {
  it('sunucudan gelen iade kanalını ve tarihini taşır', () => {
    const mapped = mapCancelledSale({
      id: 'a1',
      name: 'Lazer Paketi',
      refundedAmount: 1500,
      refunds: [
        { id: 'r1', amount: 1000, method: 'card', reference: 'RF-1', refundedAtUtc: '2026-08-02T10:00:00Z', reason: 'kısmi' },
        { id: 'r2', amount: 500, method: 'transfer', refundedAtUtc: '2026-08-03T10:00:00Z' },
      ],
    })

    expect(mapped.refunds).toHaveLength(2)
    expect(mapped.refunds[0].method).toBe('card')
    expect(mapped.refunds[0].refundedAtUtc).toBe('2026-08-02T10:00:00Z')
    expect(mapped.refunds[1].method).toBe('transfer')
  })

  it('KISMİ İADELER toplanabilir kalır — tek alan olsaydı biri kaybolurdu', () => {
    const mapped = mapCancelledSale({
      id: 'a1',
      refunds: [
        { id: 'r1', amount: 1000, method: 'cash', refundedAtUtc: '2026-08-02T10:00:00Z' },
        { id: 'r2', amount: 250, method: 'cash', refundedAtUtc: '2026-08-05T10:00:00Z' },
      ],
    })

    expect(mapped.refunds.reduce((s, r) => s + r.amount, 0)).toBe(1250)
  })

  it('iade satırı yoksa boş dizi verir (eski arşiv kaydı) — undefined patlatmaz', () => {
    const mapped = mapCancelledSale({ id: 'a1', refundedAmount: 300 })

    // Ekran bu durumda "Yöntem Kaydedilmemiş" gösterir; uydurma kanal yazmaz.
    expect(mapped.refunds).toEqual([])
    expect(mapped.refundedAmount).toBe(300)
  })

  it('tahsilat satırları bozulmadan kalır (regresyon)', () => {
    const mapped = mapCancelledSale({
      id: 'a1',
      payments: [{ id: 'p1', amount: 2000, method: 'cash', occurredAtUtc: '2026-07-01T10:00:00Z' }],
      refunds: [{ id: 'r1', amount: 500, method: 'card', refundedAtUtc: '2026-08-02T10:00:00Z' }],
    })

    expect(mapped.payments).toHaveLength(1)
    expect(mapped.payments[0].method).toBe('cash')
    expect(mapped.refunds[0].method).toBe('card')
  })
})
