import type { ImportedRow, ImportResult } from './excel'

// ---------------------------------------------------------------------------
// Genel Excel içeri aktarma analizörü.
// Kolon adları ne olursa olsun (Türkçe/İngilizce, bozuk karakter kodlaması,
// büyük/küçük harf, GSM 1 / GSM 2 gibi çoklu kolonlar) başlıkları normalize
// edip eş anlamlı sözlüğüyle eşler; satır değerlerine de bakarak dosyanın
// müşteri mi, hizmet mi, paket mi, ürün mü olduğunu tespit eder ve backend'in
// beklediği normalize satırlara çevirir.
// ---------------------------------------------------------------------------

export type ImportEntityType = 'customer' | 'service' | 'package' | 'product' | 'staff'

export interface ImportCustomerRow {
  fullName: string
  phone: string
  email: string | null
  birthDate: string | null // yyyy-MM-dd
  gender: number // 0 belirsiz, 1 kadın, 2 erkek
  notes: string | null
}

export interface ImportServiceRow {
  name: string
  category: string | null
  durationMinutes: number | null
  price: number | null
  sessionCount: number | null
}

/** Paket içeriğindeki tek hizmet — "Lazer Epilasyon (8)" gibi bir parçadan çözülür. */
export interface ImportPackageItemRow {
  serviceName: string
  sessionCount: number | null
}

export interface ImportPackageRow {
  name: string
  description: string | null
  category: string | null
  totalPrice: number | null
  sessionCount: number | null
  depositAmount: number | null
  installmentCount: number | null
  /** Paketin kapsadığı hizmetler. Boşsa backend tek kalemli varsayılana düşer. */
  items: ImportPackageItemRow[]
}

export interface ImportProductRow {
  name: string
  sku: string | null
  barcode: string | null
  brand: string | null
  category: string | null
  unit: string | null
  cost: number | null
  salePrice: number | null
  currentStock: number | null
  minStockLevel: number | null
}

export interface ImportStaffRow {
  fullName: string
  title: string | null
  phone: string | null
  specialties: string | null
  commissionRate: number | null
}

export interface AnalyzedSheet {
  sheetName: string
  entityType: ImportEntityType
  /** otomatik tespit mi kullanıcı seçimi mi */
  autoDetected: boolean
  /** hedef alan → kaynak Excel kolon başlıkları ("nasıl eşledik" göstermek için) */
  mapping: Record<string, string>
  totalRows: number
  validRows: number
  customers: ImportCustomerRow[]
  services: ImportServiceRow[]
  packages: ImportPackageRow[]
  products: ImportProductRow[]
  staff: ImportStaffRow[]
  warnings: string[]
}

export const ENTITY_LABELS: Record<ImportEntityType, string> = {
  customer: 'Müşteri',
  service: 'Hizmet',
  package: 'Paket',
  product: 'Ürün',
  staff: 'Personel',
}

export const FIELD_LABELS: Record<string, string> = {
  firstName: 'Ad',
  lastName: 'Soyad',
  fullName: 'Ad Soyad',
  phone: 'Telefon',
  email: 'E-posta',
  birthDate: 'Doğum Tarihi',
  gender: 'Cinsiyet',
  notes: 'Not',
  createdAt: 'Kayıt Tarihi',
  name: 'Ad / Başlık',
  category: 'Kategori',
  duration: 'Süre (dk)',
  price: 'Fiyat',
  totalPrice: 'Toplam Fiyat',
  sessionCount: 'Seans Sayısı',
  description: 'Açıklama',
  packageItems: 'Paket İçeriği',
  deposit: 'Peşinat',
  installment: 'Taksit',
  title: 'Unvan',
  specialties: 'Uzmanlık',
  commission: 'Komisyon %',
  sku: 'Stok Kodu',
  barcode: 'Barkod',
  brand: 'Marka',
  unit: 'Birim',
  cost: 'Maliyet',
  stock: 'Stok',
  minStock: 'Min. Stok',
}

// --- başlık normalizasyonu ---------------------------------------------------

/** Türkçe karakterleri sadeleştirir; boşluk/noktalama ve bozuk (�) karakterleri yutar. */
function normalizeText(h: string): string {
  return h
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Eş anlamlılar bozuk kodlama toleransıyla yazıldı: ör. "DOĞUM TARİHİ" bozuk
 * dosyada "DO�UM TAR�H�" gelir → normalize sonrası "doumtarh". Bu yüzden hem
 * tam hem "harfleri eksik" varyantlar listede.
 */
const FIELD_SYNONYMS: Record<string, string[]> = {
  firstName: ['ad', 'adi', 'isim', 'name', 'firstname'],
  lastName: ['soyad', 'soyadi', 'soyisim', 'surname', 'lastname'],
  fullName: ['adsoyad', 'adisoyadi', 'fullname', 'musteriadi', 'musteri', 'danisan', 'danisanadi', 'mteri', 'dansan'],
  phone: ['telefon', 'tel', 'gsm', 'gms', 'cep', 'ceptelefonu', 'phone', 'mobile', 'numara', 'gonderimnumarasi', 'gndermnumaras', 'gonderim'],
  email: ['email', 'eposta', 'mail'],
  birthDate: ['dogumtarihi', 'dogumtarih', 'dogum', 'birthdate', 'birthday', 'doumtarh', 'doumtarihi'],
  gender: ['cinsiyet', 'gender', 'cnsyet', 'sex'],
  notes: ['not', 'notlar', 'note', 'notes', 'comment'],
  createdAt: ['olusturulmatarihi', 'kayittarihi', 'olusturma', 'createdat', 'oluturulmatarh', 'oluturulma'],
  name: ['hizmetadi', 'hizmet', 'islemadi', 'islem', 'paketadi', 'paket', 'urunadi', 'urun', 'servicename', 'service', 'baslik', 'hzmet', 'lemad', 'rn'],
  category: ['kategori', 'category', 'grup', 'kategor'],
  duration: ['sure', 'suredakika', 'dakika', 'duration', 'durationminutes', 'islemsuresi', 'sre'],
  price: ['fiyat', 'ucret', 'tutar', 'price', 'amount', 'birimfiyat', 'fyat', 'cret'],
  totalPrice: ['toplamfiyat', 'toplamtutar', 'totalprice', 'pakettutari', 'paketfiyati'],
  sessionCount: ['seans', 'seanssayisi', 'seansadedi', 'sessioncount', 'sessions'],
  description: ['aciklama', 'description', 'detay', 'aklama'],
  // "İçerik" bu projenin paket dışa aktarımında paketin KAPSADIĞI HİZMETLERdir
  // ("Lazer (8) + Cilt Bakımı (4)"), açıklama değil. Bu yüzden description'dan ayrıldı.
  // Parçalanamazsa ham metin yine açıklamaya düşer (bkz. analyzeSheet).
  packageItems: ['icerik', 'icerigi', 'paketicerigi', 'kapsam', 'dahilhizmetler', 'hizmetler', 'cerk'],
  deposit: ['pesinat', 'onodeme', 'kapora', 'deposit', 'downpayment', 'peinat'],
  installment: ['taksit', 'taksitsayisi', 'installment', 'installmentcount'],
  // --- ürün / stok ---
  // NOT: en uzun eşleşme kazandığı için çakışmalar kendiliğinden çözülür:
  // "Stok Kodu" → sku ('stokkodu' 8 > 'stok' 4), "Barkod" → barcode ('barkod' 6 > 'kod'),
  // "Min. Stok" → minStock ('minstok' 7 > 'stok' 4), "Birim Fiyat" → price ('birimfiyat' 10 > 'birim' 5).
  sku: ['sku', 'stokkodu', 'urunkodu', 'productcode', 'stokkod'],
  barcode: ['barkod', 'barcode', 'ean'],
  brand: ['marka', 'brand'],
  unit: ['birim', 'unit', 'olcubirimi'],
  cost: ['maliyet', 'alisfiyati', 'alisfiyat', 'cost', 'malyet'],
  stock: ['stok', 'mevcutstok', 'stokadedi', 'currentstock', 'stokmiktari'],
  minStock: ['minstok', 'minimumstok', 'kritikstok', 'minstokseviyesi', 'minstocklevel'],
  // --- personel ---
  title: ['unvan', 'gorev', 'pozisyon', 'title', 'jobtitle', 'unvani'],
  specialties: ['uzmanlik', 'uzmanliklar', 'brans', 'specialty', 'specialties', 'uzmanlk', 'uzmanlkalan'],
  commission: ['komisyon', 'komisyonorani', 'prim', 'primorani', 'commission', 'commissionrate'],
}

/** Başlığı bir alana eşle; en uzun (en spesifik) eşleşme kazanır. */
function matchField(header: string): string | null {
  const n = normalizeText(header)
  if (!n) return null
  let best: { field: string; len: number } | null = null
  for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
    for (const syn of syns) {
      if (n === syn || n.startsWith(syn) || n.includes(syn)) {
        if (!best || syn.length > best.len) best = { field, len: syn.length }
      }
    }
  }
  return best?.field ?? null
}

// --- değer ayrıştırıcılar ----------------------------------------------------

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function digitsOf(v: string): string {
  return v.replace(/\D/g, '')
}

/** Telefon adayları arasından en anlamlısını seç (en çok haneli, 7+ hane). "+90" gibi artıklar elenir. */
function bestPhone(candidates: string[]): string {
  let best = ''
  for (const c of candidates) {
    const d = digitsOf(c)
    if (d.length < 7) continue
    if (d.length > digitsOf(best).length) best = c
  }
  return best.trim()
}

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  let s = str(v).replace(/[₺$€\s]/g, '')
  if (!s) return null
  // "1.250,50" → "1250.50"; "1250.50" olduğu gibi kalır
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    // Excel seri tarih (1900 tabanlı)
    if (v > 20000 && v < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
    }
    return null
  }
  const s = str(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) // importFromExcel Date hücrelerini ISO yapar
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const tr = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s)
  if (tr) return `${tr[3]}-${tr[2]!.padStart(2, '0')}-${tr[1]!.padStart(2, '0')}`
  return null
}

function parseGender(v: unknown): number {
  const s = normalizeText(str(v))
  if (!s) return 0
  if (s.startsWith('kadin') || s.startsWith('kadn') || s.startsWith('bayan') || s === 'f' || s.startsWith('female') || s.startsWith('kiz')) return 1
  if (s.startsWith('erkek') || s === 'bay' || s === 'm' || s.startsWith('male')) return 2
  return 0
}

/**
 * Paket içeriği metnini hizmet kalemlerine ayırır.
 *
 * Desteklenen biçimler (bu projenin kendi Excel çıktısı ilk sıradaki):
 * - `Lazer Epilasyon (8) + Cilt Bakımı (4)`
 * - `Lazer Epilasyon x8, Cilt Bakımı x4`
 * - `8 x Lazer Epilasyon; Cilt Bakımı`   (sayı yoksa 1 seans varsayılır)
 *
 * Ayraç: `+`, `,`, `;`, `/` ve yeni satır. Hiçbir kalem çözülemezse boş döner —
 * çağıran taraf metni açıklama olarak kullanır (veri kaybolmasın).
 *
 * SERBEST METİN KORUMASI: tek parça + hiç seans sayısı yoksa bu bir içerik listesi değil,
 * düz bir açıklamadır ("Cildinizi yenileyen özel bakım") ve boş döner. Aksi halde o cümle
 * hizmet adı sanılıp katalogda çöp bir hizmet oluşturur — geri alması zor bir hata.
 * Bedeli: tek hizmetli, sayısız içerik ("Cilt Bakımı") açıklamaya düşer; backend paketi
 * kendi adıyla tek kaleme bağlar. Sessiz çöp üretmektense bu yön tercih edilir.
 */
export function parsePackageItems(text: string): ImportPackageItemRow[] {
  if (!text.trim()) return []
  const items: ImportPackageItemRow[] = []
  let sawExplicitCount = false

  for (const rawPart of text.split(/[+,;/\n]/)) {
    let part = rawPart.trim()
    if (!part) continue
    let count: number | null = null

    // "... (8)" — parantez içi seans sayısı
    const paren = part.match(/^(.*?)\s*\(\s*(\d+)\s*\)\s*$/)
    if (paren) {
      part = paren[1].trim()
      count = Number(paren[2])
    } else {
      // "... x8" / "... 8 seans"
      const suffix = part.match(/^(.*?)\s*[x*]\s*(\d+)$/i) ?? part.match(/^(.*?)\s+(\d+)\s*seans$/i)
      if (suffix) {
        part = suffix[1].trim()
        count = Number(suffix[2])
      } else {
        // "8 x ..." — sayı önde
        const prefix = part.match(/^(\d+)\s*[x*]?\s+(.*)$/)
        if (prefix && prefix[2].trim()) {
          count = Number(prefix[1])
          part = prefix[2].trim()
        }
      }
    }

    if (!part || /^\d+$/.test(part)) continue // yalnız sayıdan ibaret parça hizmet adı değildir
    if (count && count > 0) sawExplicitCount = true
    items.push({ serviceName: part, sessionCount: count && count > 0 ? count : null })
  }

  // Tek parça + hiç sayı yok → içerik listesi değil, serbest açıklama.
  if (items.length <= 1 && !sawExplicitCount) return []
  return items
}

// --- varlık tipi tespiti ------------------------------------------------------

function detectEntityType(headers: string[], rows: ImportedRow[], mappedFields: Set<string>): ImportEntityType {
  const headerText = headers.map(normalizeText).join(' ')
  let customer = 0
  let service = 0
  let pkg = 0
  let product = 0
  let staff = 0

  if (mappedFields.has('phone')) customer += 3
  if (mappedFields.has('firstName') || mappedFields.has('lastName') || mappedFields.has('fullName')) customer += 2
  if (mappedFields.has('birthDate')) customer += 2
  if (mappedFields.has('gender')) customer += 2
  if (/tckimlik|tckml|kimlik/.test(headerText)) customer += 2
  if (/musteri|danisan|mteri|dansan/.test(headerText)) customer += 2

  if (mappedFields.has('duration')) service += 3
  if (/hizmet|islem|hzmet/.test(headerText)) service += 3
  if (mappedFields.has('price') && !mappedFields.has('phone')) service += 1

  if (/paket/.test(headerText)) pkg += 4
  if (mappedFields.has('sessionCount')) pkg += 2
  if (mappedFields.has('totalPrice')) pkg += 1
  // İçerik/peşinat/taksit kolonları yalnızca paket listelerinde bulunur.
  if (mappedFields.has('packageItems')) pkg += 3
  if (mappedFields.has('deposit') || mappedFields.has('installment')) pkg += 2

  // Ürün/stok: barkod ve stok kodu neredeyse yalnız ürün listelerinde bulunur.
  if (mappedFields.has('barcode')) product += 4
  if (mappedFields.has('sku')) product += 3
  if (mappedFields.has('stock') || mappedFields.has('minStock')) product += 3
  if (mappedFields.has('cost')) product += 2
  if (mappedFields.has('brand')) product += 2
  if (/urun|stok|rn/.test(headerText)) product += 2

  // Personel: unvan/uzmanlık/komisyon üçlüsü müşteri listelerinde bulunmaz. Müşteri de
  // ad+telefon taşıdığı için bu sinyaller müşteri puanını (ad+telefon+değer deseni) aşmalı.
  if (mappedFields.has('title')) staff += 3
  if (mappedFields.has('specialties')) staff += 3
  if (mappedFields.has('commission')) staff += 3
  if (/personel|calisan|uzman|staff|kuafor|alan/.test(headerText)) staff += 2

  // Başlıklar bir şey söylemiyorsa değer desenlerine bak: satırların çoğunda
  // telefon görünümlü hücre varsa müşteri listesidir.
  const sample = rows.slice(0, 30)
  if (sample.length) {
    let phoneish = 0
    for (const row of sample) {
      for (const v of Object.values(row)) {
        const d = digitsOf(str(v))
        if (d.length >= 10 && d.length <= 13) {
          phoneish++
          break
        }
      }
    }
    if (phoneish / sample.length > 0.5) customer += 2
  }

  if (staff > 0 && staff >= customer && staff >= service && staff >= pkg && staff >= product) return 'staff'
  if (product > 0 && product >= customer && product >= service && product >= pkg) return 'product'
  if (pkg > 0 && pkg >= customer && pkg >= service) return 'package'
  if (service > customer) return 'service'
  return 'customer'
}

// --- ana analiz ---------------------------------------------------------------

/**
 * Sayfayı analiz eder. `forcedType` verilirse tip tespiti atlanır (kullanıcı
 * önizlemede tipi elle değiştirdiğinde aynı ham veriden yeniden üretim).
 */
export function analyzeSheet(sheet: ImportResult, forcedType?: ImportEntityType): AnalyzedSheet {
  const warnings: string[] = []
  const fieldToHeaders = new Map<string, string[]>()
  const mapping: Record<string, string> = {}

  for (const header of sheet.headers) {
    const field = matchField(header)
    if (!field) continue
    const list = fieldToHeaders.get(field) ?? []
    list.push(header)
    fieldToHeaders.set(field, list)
    mapping[field] = mapping[field] ? `${mapping[field]}, ${header}` : header
  }

  const entityType = forcedType ?? detectEntityType(sheet.headers, sheet.rows, new Set(fieldToHeaders.keys()))

  const get = (row: ImportedRow, field: string): string => {
    for (const h of fieldToHeaders.get(field) ?? []) {
      const v = str(row[h])
      if (v) return v
    }
    return ''
  }
  const getAll = (row: ImportedRow, field: string): string[] =>
    (fieldToHeaders.get(field) ?? []).map((h) => str(row[h])).filter(Boolean)

  const customers: ImportCustomerRow[] = []
  const services: ImportServiceRow[] = []
  const packages: ImportPackageRow[] = []
  const products: ImportProductRow[] = []
  const staffRows: ImportStaffRow[] = []

  for (const row of sheet.rows) {
    const primary = str(row[sheet.headers[0] ?? ''] ?? '')
    if (entityType === 'customer') {
      const fullName =
        get(row, 'fullName') ||
        [get(row, 'firstName'), get(row, 'lastName')].filter(Boolean).join(' ').trim() ||
        get(row, 'name') ||
        primary
      if (!fullName) continue
      customers.push({
        fullName,
        phone: bestPhone(getAll(row, 'phone')),
        email: get(row, 'email') || null,
        birthDate: parseDate(get(row, 'birthDate')),
        gender: parseGender(get(row, 'gender')),
        notes: get(row, 'notes') || null,
      })
    } else if (entityType === 'service') {
      const name = get(row, 'name') || get(row, 'fullName') || primary
      if (!name) continue
      services.push({
        name,
        category: get(row, 'category') || null,
        durationMinutes: parseNumber(get(row, 'duration')),
        price: parseNumber(get(row, 'price') || get(row, 'totalPrice')),
        sessionCount: parseNumber(get(row, 'sessionCount')),
      })
    } else if (entityType === 'staff') {
      const fullName =
        get(row, 'fullName') ||
        [get(row, 'firstName'), get(row, 'lastName')].filter(Boolean).join(' ').trim() ||
        get(row, 'name') ||
        primary
      if (!fullName) continue
      // E-posta bilerek okunmaz: aktarım giriş hesabı AÇMAZ (bkz. backend ImportStaffRow notu).
      staffRows.push({
        fullName,
        title: get(row, 'title') || null,
        phone: bestPhone(getAll(row, 'phone')) || null,
        specialties: get(row, 'specialties') || null,
        commissionRate: parseNumber(get(row, 'commission')),
      })
    } else if (entityType === 'product') {
      const name = get(row, 'name') || get(row, 'fullName') || primary
      if (!name) continue
      products.push({
        name,
        sku: get(row, 'sku') || null,
        barcode: get(row, 'barcode') || null,
        brand: get(row, 'brand') || null,
        category: get(row, 'category') || null,
        unit: get(row, 'unit') || null,
        cost: parseNumber(get(row, 'cost')),
        salePrice: parseNumber(get(row, 'price') || get(row, 'totalPrice')),
        currentStock: parseNumber(get(row, 'stock')),
        minStockLevel: parseNumber(get(row, 'minStock')),
      })
    } else {
      const name = get(row, 'name') || get(row, 'fullName') || primary
      if (!name) continue
      // İçerik kolonu önce kalemlere ayrılmaya çalışılır; ayrılamazsa (serbest metin)
      // veri kaybolmasın diye açıklama olarak saklanır.
      const itemsText = get(row, 'packageItems')
      const items = parsePackageItems(itemsText)
      packages.push({
        name,
        description: get(row, 'description') || (items.length === 0 ? itemsText : '') || get(row, 'notes') || null,
        category: get(row, 'category') || null,
        totalPrice: parseNumber(get(row, 'totalPrice') || get(row, 'price')),
        sessionCount: parseNumber(get(row, 'sessionCount')),
        depositAmount: parseNumber(get(row, 'deposit')),
        installmentCount: parseNumber(get(row, 'installment')),
        items,
      })
    }
  }

  if (entityType === 'customer') {
    const phoneless = customers.filter((c) => !c.phone).length
    if (phoneless > 0) warnings.push(`${phoneless} satırda geçerli telefon bulunamadı — bu satırlar aktarılamayacak.`)
  }

  const validRows =
    entityType === 'customer'
      ? customers.filter((c) => c.phone).length
      : entityType === 'service'
        ? services.length
        : entityType === 'product'
          ? products.length
          : entityType === 'staff'
            ? staffRows.length
            : packages.length

  return {
    sheetName: sheet.sheetName,
    entityType,
    autoDetected: !forcedType,
    mapping,
    totalRows: sheet.rows.length,
    validRows,
    customers,
    services,
    packages,
    products,
    staff: staffRows,
    warnings,
  }
}
