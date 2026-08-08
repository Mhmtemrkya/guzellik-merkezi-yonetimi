import { describe, it, expect } from 'vitest'
import { paymentMethodLabel } from './apiMappers'

/**
 * BU KURAL ÜÇ YERDE YAZILI: burada, `mobile/lib/shared/payment_method.dart` ve backend
 * `ReportsService.MethodLabel`. Sapma SESSİZDİR — kullanıcı ekranda ya ham kod ("cash") ya da
 * aynı kaydı ikinci bir adla ("Kredi Kartı" ↔ "Kart") görür. Testler, üç yazımın da (web kodu /
 * enum adı / eski Türkçe metin) aynı etikete düşmesini ve YÖNTEMSİZ kaydın uydurulmamasını
 * sabitler.
 */
describe('paymentMethodLabel', () => {
  it('web kodunu, enum adını ve eski Türkçe metni aynı etikete indirger', () => {
    for (const raw of ['cash', 'Cash', 'CASH', 'Nakit', 'nakit']) {
      expect(paymentMethodLabel(raw)).toBe('Nakit')
    }
    for (const raw of ['card', 'Card', 'CreditCard', 'Kart', 'kredi kartı']) {
      expect(paymentMethodLabel(raw)).toBe('Kart')
    }
    for (const raw of ['transfer', 'BankTransfer', 'Havale/EFT', 'eft']) {
      expect(paymentMethodLabel(raw)).toBe('Havale / EFT')
    }
    for (const raw of ['check', 'Check', 'Çek']) {
      expect(paymentMethodLabel(raw)).toBe('Çek')
    }
  })

  it('yöntemi yazılmamış kayıtta UYDURMA yapmaz', () => {
    // Boş/eksik alan "Nakit" sayılırsa kasa kırılımı yanıltır.
    for (const raw of ['', '   ', null, undefined, 'unknown']) {
      expect(paymentMethodLabel(raw)).toBe('Yöntem Kaydedilmemiş')
    }
    // "Adisyon" bir ödeme yöntemi DEĞİL: yöntem kırılımı gelmeden önceki tahsilatların etiketi.
    expect(paymentMethodLabel('Adisyon')).toBe('Yöntem Kaydedilmemiş')
    expect(paymentMethodLabel('Adisyon Tahsilatı')).toBe('Yöntem Kaydedilmemiş')
  })

  it('kendi çıktısını geri yediğinde bozulmaz (idempotent)', () => {
    for (const raw of ['cash', 'BankTransfer', '', 'Adisyon', 'giftcard']) {
      const once = paymentMethodLabel(raw)
      expect(paymentMethodLabel(once)).toBe(once)
    }
  })

  it('para yerine geçen kaynakları adlandırır, bilinmeyen metni ham bırakmaz', () => {
    expect(paymentMethodLabel('hediye')).toBe('Hediye Çeki')
    expect(paymentMethodLabel('loyalty')).toBe('Sadakat Puanı')
    expect(paymentMethodLabel('other')).toBe('Diğer')
    // Serbest metin: uydurulmaz, yalnız okunur hâle getirilir (Türkçe i → İ).
    expect(paymentMethodLabel('ideal ödeme')).toBe('İdeal ödeme')
  })

  it('parça-arama önceliği backend ile AYNI — sapma sessiz olurdu', () => {
    // Kural bilinçli: `ReportsService.NormalizeMethod` de aynı sırayla bakar; "giftcard" içinde
    // "card", "hediye çeki" içinde "çek" geçer. Burada düzeltmek aynı kaydın rapordaki adıyla
    // ayrışması demek olurdu. Bugün hediye çeki tahsilat değil İNDİRİM kalemi olarak yazılıyor,
    // yani bu dizeler yöntem alanında hiç üretilmiyor.
    expect(paymentMethodLabel('giftcard')).toBe('Kart')
    expect(paymentMethodLabel('hediye çeki')).toBe('Çek')
  })
})
