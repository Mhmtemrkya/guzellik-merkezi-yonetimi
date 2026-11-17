import type { NotificationChannelKey, NotificationTriggerKey } from '@/lib/types'

/**
 * BİLDİRİM MESAJI ORTAK KİTİ — şablon oluşturucu, gönderim penceresi ve mobil/web açıklamaları
 * aynı kuralı kullansın diye tek yerde.
 *
 * SMS PARÇA KURALI arka uçla (SmsSegments.cs) BİREBİR aynıdır: sağlayıcı Türkçe karakter
 * bozulmasın diye Unicode gönderir → 70 karaktere kadar 1 parça, daha uzunu 67'lik parçalar.
 * JS `length` .NET gibi UTF-16 birim sayar; emoji 2 birim tutar (telde de 2 yer kaplar).
 */
export const SMS_SINGLE_PART = 70
export const SMS_MULTI_PART = 67

export function smsParts(text: string): number {
  if (!text) return 0
  return text.length <= SMS_SINGLE_PART ? 1 : Math.ceil(text.length / SMS_MULTI_PART)
}

/** Metinde emoji var mı? (SMS'te 2 karakter sayılır, bazı telefonlarda kutucuk görünür.) */
export function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text)
}

export interface TemplateVariable {
  key: string
  label: string
  /** Bu tetikleyicilerde anlamlı (boşsa her tetikleyicide). */
  onlyFor?: NotificationTriggerKey[]
  hint: string
}

/** Arka uçtaki RenderContext'in doldurduğu değişkenler ({{anahtar}}). */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: 'ad', label: 'Müşteri adı', hint: 'Müşterinin adı soyadı' },
  { key: 'tarih', label: 'Tarih', hint: 'Randevu hatırlatmasında RANDEVUNUN tarihi; diğerlerinde gönderim günü' },
  { key: 'saat', label: 'Saat', hint: 'Randevu hatırlatmasında RANDEVUNUN saati; diğerlerinde gönderim saati' },
  { key: 'hizmet', label: 'Hizmet', onlyFor: ['AppointmentReminder'], hint: 'Yaklaşan randevunun hizmeti' },
  { key: 'salon', label: 'Salon adı', hint: 'Müşterinin şubesi (yoksa kurum adı)' },
  { key: 'telefon', label: 'Telefon', hint: 'Müşterinin telefonu' },
]

export function variablesFor(trigger: NotificationTriggerKey): TemplateVariable[] {
  return TEMPLATE_VARIABLES.filter((v) => !v.onlyFor || v.onlyFor.includes(trigger))
}

/** Önizleme için örnek doldurma — gerçek gönderimde değerler müşteriye göre sunucuda dolar. */
export function renderSample(body: string, salonName: string): string {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
  const dd = String(tomorrow.getDate()).padStart(2, '0')
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const sample: Record<string, string> = {
    ad: 'Ayşe Yılmaz',
    isim: 'Ayşe Yılmaz',
    tarih: `${dd}.${mm}.${tomorrow.getFullYear()}`,
    saat: '14:00',
    hizmet: 'Lazer Epilasyon',
    salon: salonName || 'Salonunuz',
    telefon: '0555 123 45 67',
  }
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => sample[k.toLowerCase()] ?? '')
}

export interface TriggerOption {
  key: NotificationTriggerKey
  title: string
  desc: string
  automatic: boolean
}

/** "Ne zaman gönderilsin?" seçenekleri — kullanıcıya teknik tetikleyici adı gösterilmez. */
export const TRIGGER_OPTIONS: TriggerOption[] = [
  { key: 'Manual', title: 'Duyuru / kampanya', desc: 'Siz gönderirsiniz: tüm müşterilere ya da seçtiklerinize.', automatic: false },
  { key: 'AppointmentReminder', title: 'Randevu hatırlatma', desc: 'Randevudan 24 saat önce otomatik gider.', automatic: true },
  { key: 'BirthdayGreeting', title: 'Doğum günü', desc: 'Müşterinin doğum gününde otomatik (yılda 1).', automatic: true },
  { key: 'PaymentDue', title: 'Ödeme hatırlatma', desc: 'Vadesi gelen taksiti olana otomatik (günde en çok 1).', automatic: true },
  { key: 'WinBack', title: 'Sizi özledik', desc: 'Uzun süredir gelmeyen müşteriye otomatik (ayda en çok 1).', automatic: true },
  { key: 'SessionRenewal', title: 'Paket yenileme', desc: 'Paketi bitmek üzere olana otomatik (ayda en çok 1).', automatic: true },
]

/**
 * Tetikleyici başına hazır metinler. KISA ve EMOJİSİZ tutuldu: SMS parça başına ücretlenir ve
 * emoji iki karakter sayılır. WhatsApp'ta da aynı metin rahatlıkla kullanılabilir.
 */
export const SUGGESTED_TEXTS: Record<NotificationTriggerKey, string[]> = {
  Manual: [
    'Merhaba {{ad}}, {{salon}} olarak bu hafta size özel indirimlerimiz başladı. Randevu için bize ulaşabilirsiniz.',
    'Merhaba {{ad}}, yeni hizmetimizi denemeye ne dersiniz? Detaylar ve randevu için {{salon}} sizi bekliyor.',
  ],
  Campaign: [
    'Merhaba {{ad}}, {{salon}} olarak bu hafta size özel indirimlerimiz başladı. Randevu için bize ulaşabilirsiniz.',
  ],
  AppointmentReminder: [
    'Merhaba {{ad}}, {{tarih}} {{saat}} {{hizmet}} randevunuzu hatırlatırız. Gelemeyecekseniz lütfen haber verin. {{salon}}',
    'Sayın {{ad}}, {{tarih}} saat {{saat}} randevunuz var. Sizi bekliyoruz! {{salon}}',
  ],
  BirthdayGreeting: [
    'Doğum gününüz kutlu olsun {{ad}}! Bu ay yapacağınız randevuda size özel bir sürprizimiz var. {{salon}}',
    'Nice mutlu yıllara {{ad}}! {{salon}} ailesi olarak yeni yaşınızı kutlarız.',
  ],
  PaymentDue: [
    'Sayın {{ad}}, vadesi gelen taksit ödemeniz bulunmaktadır. Bilgi için {{salon}} ile iletişime geçebilirsiniz.',
  ],
  WinBack: [
    'Merhaba {{ad}}, sizi özledik! Bu hafta randevu alırsanız size özel bir karşılama hazırlayalım. {{salon}}',
  ],
  SessionRenewal: [
    'Merhaba {{ad}}, paketinizdeki seanslarınız bitmek üzere. Yenileme yapan müşterilerimize özel avantajlarımız var. {{salon}}',
  ],
}

export interface ChannelOption {
  key: NotificationChannelKey
  title: string
  note: string
}

export const CHANNEL_OPTIONS: ChannelOption[] = [
  { key: 'Sms', title: 'SMS', note: 'Her telefona ulaşır. Paketinizdeki SMS kotasından, kota bitince mesaj kredisinden (parça başına) düşer.' },
  { key: 'WhatsApp', title: 'WhatsApp', note: 'Serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir (Meta kuralı). Toplu duyuru için SMS daha güvenlidir.' },
  { key: 'Email', title: 'E-posta', note: 'Yalnız e-postası kayıtlı müşterilere gider; krediden düşmez.' },
]

/**
 * WhatsApp randevu hatırlatması AYRI bir akıştan gider: iki yönlü onay (Evet/Hayır/Ertele) ve
 * metni WhatsApp ayarlarındaki "Hatırlatma şablonu"dur. Bildirim şablonundaki gövde KULLANILMAZ —
 * kullanıcı boşuna metin yazmasın diye açıkça söylenir.
 */
export function usesWhatsAppReminderFlow(channel: NotificationChannelKey, trigger: NotificationTriggerKey): boolean {
  return channel === 'WhatsApp' && trigger === 'AppointmentReminder'
}

export const formatCredits = (n?: number): string => {
  const v = n ?? 0
  return Number.isInteger(v)
    ? v.toLocaleString('tr-TR')
    : v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
