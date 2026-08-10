import { describe, it, expect } from 'vitest'
import { idempotencyKey, newIdempotencySalt } from './idempotency'

/**
 * Bu testler PARA kaybını/çiftlenmesini önleyen bir davranışı sabitler. Kusur şuydu: tahsilat
 * uçlarının hiçbiri `Idempotency-Key` göndermiyordu, sunucudaki koruma ölü koddu ve tazeleme
 * patladıktan sonra atılan ikinci tıklama 400 ₺'yi 800 ₺ olarak yazıyordu.
 *
 * Anahtar üretecinin iki yönlü olması şart — yalnız "aynı girdi aynı anahtar" yetmez, "farklı
 * girdi farklı anahtar" da gerekir; ikincisi bozulursa meşru ikinci tahsilat sessizce yutulur.
 *
 * Aynı kural `mobile/lib/core/network/idempotency.dart` içinde ikinci kez yazılıdır.
 */
describe('idempotencyKey', () => {
  const salt = 'testsalt1234'

  it('aynı niyeti aynı anahtara indirger (çift tıklama / tazeleme sonrası tekrar)', () => {
    // Rapor edilen senaryo: tahsilat sunucuda başarılı, ekran tazeleme patladı, kullanıcı
    // aynı formu bir daha gönderdi. Anahtar aynı kalmalı ki sunucu ilk yanıtı oynatsın.
    const first = idempotencyKey(salt, 'acc-1', 'cash', 400, '2026-08-10T09:00:00.000Z', null)
    const again = idempotencyKey(salt, 'acc-1', 'cash', 400, '2026-08-10T09:00:00.000Z', null)
    expect(again).toBe(first)
  })

  it('tutar/yöntem/hesap değişince anahtar da değişir (meşru ikinci tahsilat yutulmaz)', () => {
    const base = idempotencyKey(salt, 'acc-1', 'cash', 400, 'stamp', null)
    expect(idempotencyKey(salt, 'acc-1', 'cash', 300, 'stamp', null)).not.toBe(base)
    expect(idempotencyKey(salt, 'acc-1', 'card', 400, 'stamp', null)).not.toBe(base)
    expect(idempotencyKey(salt, 'acc-2', 'cash', 400, 'stamp', null)).not.toBe(base)
    expect(idempotencyKey(salt, 'acc-1', 'cash', 400, 'stamp', 'dekont')).not.toBe(base)
  })

  it('modal kapatılıp açılınca (yeni tuz) aynı tahsilat tekrar yapılabilir', () => {
    const a = idempotencyKey(newIdempotencySalt(), 'acc-1', 'cash', 400, 'stamp', null)
    const b = idempotencyKey(newIdempotencySalt(), 'acc-1', 'cash', 400, 'stamp', null)
    expect(b).not.toBe(a)
  })

  it('alan sınırını korur: kayan ayraç iki farklı girdiyi aynı anahtara indirmez', () => {
    // Referans serbest metindir. Ayraç boşluk olsaydı ikisi de "ödeme 1 x" dizesine iner ve
    // farklı iki tahsilattan biri sessizce oynatılırdı.
    expect(idempotencyKey(salt, 'ödeme 1', 'x')).not.toBe(idempotencyKey(salt, 'ödeme', '1 x'))
  })

  it('middleware sınırını aşmaz: uzun referansta bile 64 karakterin altında kalır', () => {
    // Sunucu `key.Length is 0 or > 64` ise başlığı YOK SAYAR — uzun anahtar sessizce korumasız.
    const key = idempotencyKey(newIdempotencySalt(), 'acc-1', 'cash', 1234.56, 'stamp', 'x'.repeat(5000))
    expect(key.length).toBeGreaterThan(0)
    expect(key.length).toBeLessThanOrEqual(64)
  })
})

describe('newIdempotencySalt', () => {
  it('her çağrıda farklı tuz üretir', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newIdempotencySalt()))
    expect(seen.size).toBe(200)
  })
})
