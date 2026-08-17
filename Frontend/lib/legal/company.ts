/**
 * SATICI (ŞİRKET) KÜNYESİ — yasal sayfaların TEK kaynağı.
 *
 * Mesafeli Satış Sözleşmesi, Teslimat & İade, Gizlilik ve Hakkımızda sayfaları
 * bu dosyadan beslenir. Bir bilgi değişirse YALNIZ burası düzeltilir.
 *
 * ⚠️ DOLDURULMASI ZORUNLU ALANLAR
 * Mesafeli Sözleşmeler Yönetmeliği satıcının ticaret unvanını, açık adresini,
 * telefonunu, e-postasını ve vergi bilgilerini sözleşmede ZORUNLU kılar; iyzico
 * üye iş yeri incelemesi de bunları başvurudaki bilgilerle karşılaştırır.
 *
 * Bu yüzden bilinmeyen alanlara UYDURMA değer yazılmadı; `[DOLDURULACAK: …]`
 * damgası bırakıldı. Damga sayfada olduğu gibi görünür — bu bilinçlidir:
 * boş bırakmak eksikliği gizler, uydurmak ise yanlış bir yasal kayıt üretir.
 *
 * Canlıya çıkmadan önce `DOLDURULACAK` geçen her satır doldurulmalıdır:
 *   grep -rn "DOLDURULACAK" Frontend/lib/legal/company.ts
 */

/** Doldurulmamış alanları işaretleyen damga. */
export const PLACEHOLDER_PREFIX = '[DOLDURULACAK'

export const isPlaceholder = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX)

export const company = {
  /** Ürün / marka adı. */
  brand: 'BeautyAsist',
  /** Satıcının tam ticaret unvanı (fatura ve sözleşmede geçen ad). */
  legalName: '[DOLDURULACAK: tam ticaret unvanı — ör. Maydanoz Yazılım Ltd. Şti.]',
  /** Kısa ad — metin içinde tekrar eden kullanımlar için. */
  shortName: 'Maydanoz Yazılım',
  /** Şirket türü — kullanıcı 15 Ağu 2026'da limited şirket olarak bildirdi. */
  companyType: 'Limited şirket',
  /** Açık adres (mahalle, cadde, no, ilçe/il). */
  address: '[DOLDURULACAK: açık adres]',
  /** Müşteri hizmetleri telefonu. */
  phone: '[DOLDURULACAK: telefon]',
  /**
   * Destek ve bildirim e-postası.
   *
   * Kurumsal adres kullanılacak (kullanıcı kararı): iyzico üye iş yeri incelemesinde
   * alan adıyla eşleşen bir adres beklenir, kişisel e-posta ret gerekçesi olabilir.
   * Eski kayıt (gizlilik sayfasındaki adres): oguzhan.mindivanli@gmail.com
   */
  email: '[DOLDURULACAK: kurumsal e-posta — ör. destek@beautyasist.com]',
  taxOffice: '[DOLDURULACAK: vergi dairesi]',
  /** Vergi kimlik numarası. */
  taxNumber: '[DOLDURULACAK: vergi kimlik no]',
  /** MERSİS numarası — limited şirkette zorunludur. */
  mersis: '[DOLDURULACAK: MERSİS no]',
  website: 'https://beautyasist.com',
  domain: 'beautyasist.com',
  supportHours: 'Pazartesi – Cumartesi · 09:00 – 19:00',
  /** Ödeme altyapısı sağlayıcısı — sözleşme ve ödeme sayfalarında anılır. */
  paymentProvider: 'iyzico Ödeme Hizmetleri A.Ş.',
} as const

/** Yasal sayfaların ortak "son güncelleme" tarihi. */
export const LEGAL_LAST_UPDATED = '15 Ağustos 2026'

/**
 * Footer ve ödeme adımlarında kullanılan yasal sayfa listesi.
 *
 * `/kvkk` BİLEREK YOK: o rota kuruma özel aydınlatma metnidir (`/kvkk/[slug]`),
 * kök adresi bir sayfaya karşılık gelmez. Footer'da eskiden duran `/kvkk` bağlantısı
 * 404 veriyordu; platformun kendi metni Gizlilik Politikası'dır.
 */
export const legalLinks: { href: string; label: string }[] = [
  { href: '/hakkimizda', label: 'Hakkımızda' },
  { href: '/mesafeli-satis-sozlesmesi', label: 'Mesafeli Satış Sözleşmesi' },
  { href: '/teslimat-ve-iade', label: 'Teslimat ve İade Şartları' },
  { href: '/gizlilik', label: 'Gizlilik Politikası' },
]
