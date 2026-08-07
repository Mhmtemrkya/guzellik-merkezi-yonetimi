import { describe, it, expect } from 'vitest'
import { hasActionAccess, hasPageAccess, normalizePermissions } from './permissions'

/**
 * BU KURAL İKİ YERDE YAZILI: backend `Permissions.IsActionAllowed` ve burada. İkisi ayrı ayrı
 * değiştirilebildiği için SAPMAYA AÇIK — ve sapma sessizdir: personel ya yapamayacağı işlemi
 * görür (butona basınca 403 alır) ya da yapabileceği işlemi hiç göremez. Testler kuralın
 * ayrıntılarını, özellikle GERİYE UYUMLULUK dalını sabitler.
 */
describe('hasPageAccess', () => {
  it('personel DIŞINDAKİ roller her zaman yetkilidir', () => {
    expect(hasPageAccess(false, [], 'Waitlist')).toBe(true)
  })

  it('personel yalnız verilmiş sayfayı görür', () => {
    expect(hasPageAccess(true, ['waitlist'], 'Waitlist')).toBe(true)
    expect(hasPageAccess(true, ['waitlist'], 'Reports')).toBe(false)
  })

  it('karşılaştırma büyük/küçük harf duyarsızdır', () => {
    expect(hasPageAccess(true, ['customers'], 'CUSTOMERS')).toBe(true)
  })
})

describe('hasActionAccess', () => {
  it('personel DIŞINDAKİ roller her zaman yetkilidir', () => {
    expect(hasActionAccess(false, [], 'Customers.Delete')).toBe(true)
  })

  it('işlem anahtarı DOĞRUDAN verilmişse izinlidir', () => {
    expect(hasActionAccess(true, ['customers', 'customers.delete'], 'Customers.Delete')).toBe(true)
  })

  it('SAYFA izni yoksa işlem de yapılamaz', () => {
    expect(hasActionAccess(true, ['reports'], 'Customers.Delete')).toBe(false)
  })

  /**
   * ASIL İNCE NOKTA — geriye uyumluluk. Eski kayıtlarda yalnız sayfa izni var, işlem anahtarı hiç
   * atanmamış: bu personel TAM yetkili sayılmalı, yoksa mevcut kurumlarda personel bir anda
   * hiçbir şey yapamaz hâle gelir.
   */
  it('sayfa izni var ve o sayfaya ait HİÇBİR işlem anahtarı yoksa izinlidir (eski format)', () => {
    expect(hasActionAccess(true, ['customers'], 'Customers.Delete')).toBe(true)
  })

  /**
   * KARŞIT DURUM — kural fazla geniş değil: sayfaya ait EN AZ BİR işlem anahtarı atanmışsa
   * yönetici bilinçli kısıtlamış demektir; verilmeyen işlem reddedilir.
   */
  it('sayfaya ait BAŞKA bir işlem anahtarı atanmışsa, verilmeyen işlem reddedilir', () => {
    expect(hasActionAccess(true, ['customers', 'customers.manage'], 'Customers.Delete')).toBe(false)
  })

  it('BAŞKA sayfanın işlem anahtarı bu sayfayı kısıtlamaz', () => {
    // 'reports.export' varlığı, customers sayfasının "eski format" sayılmasını engellememeli.
    expect(hasActionAccess(true, ['customers', 'reports', 'reports.export'], 'Customers.Delete')).toBe(true)
  })

  it('boş işlem anahtarı serbesttir (işlem izni tanımlı olmayan yollar)', () => {
    expect(hasActionAccess(true, [], '')).toBe(true)
  })

  it('noktasız anahtar sayfa izni gibi ele alınmaz — doğrudan eşleşme şarttır', () => {
    expect(hasActionAccess(true, ['customers'], 'Reports')).toBe(false)
    expect(hasActionAccess(true, ['reports'], 'Reports')).toBe(true)
  })
})

describe('normalizePermissions', () => {
  it('null/undefined güvenle boş listeye düşer', () => {
    expect(normalizePermissions(null)).toEqual([])
    expect(normalizePermissions(undefined)).toEqual([])
  })

  it('küçük harfe indirir', () => {
    expect(normalizePermissions(['Customers', 'Customers.Delete'])).toEqual(['customers', 'customers.delete'])
  })
})
