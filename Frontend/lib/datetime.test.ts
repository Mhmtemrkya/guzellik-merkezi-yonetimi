import { describe, it, expect } from 'vitest'
import { parseUtc, parseUtcMs, localDateKey } from './datetime'

/**
 * BACKEND UTC DAMGASININ 'Z'SİZ GELMESİ — bu ürünün en pahalı sessiz hatalarından biri.
 *
 * MySQL'den okunan DateTime'lar Kind=Unspecified döndüğü için backend zaman damgalarını çoğu
 * zaman "Z" son eki OLMADAN gönderiyor. Tarayıcı bunu YEREL saat sanıyor ve TR cihazda bile
 * 3 saat kayma oluşuyor: randevu yanlış saatte görünüyor, süreli bir link "süresi dolmuş"
 * sayılıyor. Çözüm merkezi (parseUtc) ama TESTİ YOKTU — yani koruma sessizce bozulabilirdi.
 *
 * Buradaki testler, koruma kaldırıldığında ya da regex bozulduğunda kırılır.
 */
describe('parseUtc', () => {
  it("'Z' EKSİKSE bile değeri UTC sayar (asıl hata buydu)", () => {
    const withoutZ = parseUtc('2026-06-22T09:00:00')
    const withZ = parseUtc('2026-06-22T09:00:00Z')

    expect(withoutZ).not.toBeNull()
    expect(withoutZ!.getTime()).toBe(withZ!.getTime())
    // Mutlak an doğru: 09:00 UTC.
    expect(withoutZ!.toISOString()).toBe('2026-06-22T09:00:00.000Z')
  })

  it('AÇIK saat dilimi taşıyan değeri OLDUĞU GİBİ bırakır (üstüne Z eklemez)', () => {
    // +03:00 → 06:00 UTC. Regex bozulup buraya da 'Z' eklenseydi 3 saat kayardı.
    expect(parseUtc('2026-06-22T09:00:00+03:00')!.toISOString()).toBe('2026-06-22T06:00:00.000Z')
    expect(parseUtc('2026-06-22T09:00:00-05:00')!.toISOString()).toBe('2026-06-22T14:00:00.000Z')
  })

  it('küçük harfli z de saat dilimi sayılır', () => {
    expect(parseUtc('2026-06-22T09:00:00z')!.toISOString()).toBe('2026-06-22T09:00:00.000Z')
  })

  it('boş/geçersiz değerde null döner — çağıran "şimdi"ye düşmemeli', () => {
    expect(parseUtc(null)).toBeNull()
    expect(parseUtc(undefined)).toBeNull()
    expect(parseUtc('')).toBeNull()
    expect(parseUtc('bozuk-tarih')).toBeNull()
  })

  it('Date nesnesi geçirilirse aynen döner; geçersiz Date null olur', () => {
    const d = new Date('2026-06-22T09:00:00Z')
    expect(parseUtc(d)).toBe(d)
    expect(parseUtc(new Date('bozuk'))).toBeNull()
  })
})

describe('parseUtcMs', () => {
  it('parseUtc ile aynı anı milisaniye olarak verir', () => {
    expect(parseUtcMs('2026-06-22T09:00:00')).toBe(Date.parse('2026-06-22T09:00:00Z'))
  })

  it('geçersizde null (0 DEĞİL — 0 geçerli bir an sayılırdı)', () => {
    expect(parseUtcMs('bozuk')).toBeNull()
  })
})

describe('localDateKey', () => {
  it("YYYY-MM-DD biçiminde ve CİHAZIN YEREL gününü verir", () => {
    const key = localDateKey('2026-06-22T09:00:00')
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Beklenen: aynı mutlak anın yerel günü. Test makinesinin saat diliminden
    // bağımsız olsun diye referans değer aynı yoldan hesaplanır.
    const d = new Date('2026-06-22T09:00:00Z')
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(key).toBe(expected)
  })

  it('ay ve gün TEK HANELİYSE sıfırla doldurur (takvim gruplaması bozulmasın)', () => {
    const key = localDateKey('2026-01-05T12:00:00Z')
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
