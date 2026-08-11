import type { AccountInstallmentItem, CustomerAccount } from '@/lib/types'

/**
 * CARİ HESAPLARI MÜŞTERİ BAZINDA TOPLAMA.
 *
 * Bir müşterinin üç ayrı satışı üç ayrı cari kartı açar (bkz. "her satış kendi kartını açar"
 * kuralı — tahsilat/iptal/taksit doğru satışa bağlansın diye ŞART). Ama ön muhasebede kullanıcı
 * "bu müşteri bana ne kadar borçlu" diye bakar; aynı ad üç satırda üç farklı tutarla görününce
 * toplamı kafadan yapmak gerekiyordu.
 *
 * Bu yüzden VERİ MODELİ DEĞİŞMEZ, yalnız GÖRÜNÜM gruplanır: satır = müşteri, açılınca altında
 * kendi satışları durur. Tahsilat hâlâ tek bir satışın carisine yazılır.
 */

/**
 * DÜZENSİZ ÖDEME (DEVİR) KURALI — bu dosyadaki iki kurucu da bunu uygular.
 *
 * Müşteri bir ayın taksitini ödemezse o tutar SİLİNMEZ, sonraki ayın taksitinin ÜSTÜNE biner:
 * 5.000'lik planda 2. ay ödenmezse 3. ayda ödenmesi gereken 10.000 olur; 7.500 ödenirse kalan
 * 2.500 aynı şekilde 4. aya devreder (4. ay = 5.000 + 2.500 = 7.500).
 *
 * TÜRETİLMİŞTİR, PLANI DEĞİŞTİRMEZ. Taksit satırlarının tutarını 10.000 yapmak iki nedenle
 * yanlış olurdu:
 *  1. Plan sabittir; ödenen bilgisi taksitte değil tahsilat satırlarında durur ve sunucu
 *     tahsilatı VADE SIRASIYLA dağıtır (CustomerAccount.AllocatePayments) — para zaten doğru
 *     taksite gider, tutarı şişirmek çift sayım olurdu.
 *  2. `CustomerAccount.RealignInstallmentAmounts()` planı "finanse edilen / taksit sayısı"na
 *     göre yeniden hizalar; yazılan 10.000 ilk onarım turunda sessizce 5.000'e döner.
 *
 * Dolayısıyla devir yalnız GÖRÜNÜM ve TAHSİLAT ÖNERİSİ katmanındadır: bakiyeler sunucununkiyle
 * birebir aynı kalır, kullanıcı da "bu ay ne almam gerekiyor" sorusunun cevabını görür.
 */

/** Aylık takvim hücresi — bir müşterinin bir aydaki taksit durumu. */
export interface MonthCell {
  /** `YYYY-MM` — sütun anahtarı. */
  key: string
  year: number
  /** 1-12. */
  month: number
  /** O ay vadesi gelen taksitlerin toplamı (PLAN tutarı — devir hariç). */
  due: number
  /** Bu vadelere dağıtılmış tahsilat. */
  paid: number
  /** Kalan (due − paid), negatife düşmez. */
  remaining: number
  /** Önceki aylardan devreden ödenmemiş bakiye. */
  carryIn: number
  /** O ay ödenmesi gereken toplam: `due + carryIn`. */
  expected: number
  /** Sonraki aya devreden: `expected − paid` (= carryIn + remaining). */
  outstanding: number
  /** O aydaki ilk taksit vadesi (`YYYY-MM-DD`) — tabloda "Tarih" sütunu bunu gösterir. */
  firstDueDate: string | null
  /** O aya düşen taksit satırı sayısı (birden çok satıştan gelebilir). */
  installmentCount: number
  /**
   * Hücre durumu:
   * - `none` : o ay taksit yok
   * - `paid` : tamamı ödendi (yeşil)
   * - `partial` : kısmen ödendi (amber)
   * - `overdue` : vadesi geçti, kalan var (kırmızı)
   * - `upcoming` : vadesi gelmedi (nötr)
   */
  status: 'none' | 'paid' | 'partial' | 'overdue' | 'upcoming'
}

export interface CustomerAccountGroup {
  customerId: string
  customerName: string
  customerPhone: string
  /** Bu müşterinin satışları (cari kartları) — en yeni önce. */
  accounts: CustomerAccount[]
  /** Satış adedi. */
  saleCount: number
  totalAmount: number
  paidAmount: number
  /** Kalan borç — cari BAŞINA sıfırla sınırlanır (fazla ödeme başka satışın borcunu kapatmaz). */
  remainingAmount: number
  /** En az bir satışta gecikmiş taksit var mı. */
  hasOverdue: boolean
  /** Gecikmiş taksitlerin toplam kalanı. */
  overdueAmount: number
  /** En yakın ödenmemiş vade (tüm satışlar arasında). */
  nextDueDate: string | null
  nextDueAmount: number
  /** İptal edilmemiş taksit sayısı > 1 olan satış var mı (taksitli müşteri). */
  hasInstallmentPlan: boolean
  /** En son satış tarihi — liste sıralaması bunu kullanır (tazelik). */
  lastSaleAtUtc: string
  sessionsTotal: number
  sessionsRemaining: number
}

/** İptal edilmiş taksit borç doğurmaz — her hesapta bu süzgeç uygulanır. */
export function activeInstallments(a: CustomerAccount) {
  return a.installments.filter((i) => i.status !== 'Cancelled')
}

/** `YYYY-MM` anahtarı; boş/bozuk tarihte null. */
function monthKeyOf(iso: string | null | undefined): string | null {
  const s = (iso || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}

/**
 * Cari listesini müşteriye göre gruplar. `customerId` boş olan kayıt (veri bozukluğu) kendi
 * grubunda kalır — sessizce yutmak yerine görünür olsun.
 */
export function groupAccountsByCustomer(accounts: CustomerAccount[]): CustomerAccountGroup[] {
  const map = new Map<string, CustomerAccountGroup>()

  for (const a of accounts) {
    const key = a.customerId || `__acc:${a.id}`
    let g = map.get(key)
    if (!g) {
      g = {
        customerId: a.customerId || '',
        customerName: a.customerName || a.name || 'Müşteri',
        customerPhone: a.customerPhone || '',
        accounts: [],
        saleCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        hasOverdue: false,
        overdueAmount: 0,
        nextDueDate: null,
        nextDueAmount: 0,
        hasInstallmentPlan: false,
        lastSaleAtUtc: '',
        sessionsTotal: 0,
        sessionsRemaining: 0,
      }
      map.set(key, g)
    }

    g.accounts.push(a)
    g.saleCount += 1
    g.totalAmount += a.totalAmount
    g.paidAmount += a.paidAmount
    // Cari BAŞINA sıfır tabanı: bir satıştaki fazla ödeme (kredi bakiyesi) diğerinin borcunu
    // kapatmaz — sunucu da tahsilatı hesap bazında tutar.
    g.remainingAmount += Math.max(0, a.remainingAmount)
    g.sessionsTotal += a.sessionsTotal
    g.sessionsRemaining += a.sessionsRemaining

    const insts = activeInstallments(a)
    if (insts.length > 1) g.hasInstallmentPlan = true
    for (const i of insts) {
      if (i.overdue && i.remaining > 0.005) {
        g.hasOverdue = true
        g.overdueAmount += i.remaining
      }
    }

    if (a.nextDueDate && (!g.nextDueDate || a.nextDueDate < g.nextDueDate)) {
      g.nextDueDate = a.nextDueDate
      g.nextDueAmount = a.nextDueAmount
    }
    const soldAt = a.soldAtUtc || a.createdAtUtc || ''
    if (soldAt > g.lastSaleAtUtc) g.lastSaleAtUtc = soldAt
  }

  for (const g of map.values()) {
    // Grup içinde en yeni satış üstte — müşteri açılınca en güncel iş ilk görünsün.
    g.accounts.sort((x, y) => (y.soldAtUtc || y.createdAtUtc || '').localeCompare(x.soldAtUtc || x.createdAtUtc || ''))
  }

  return [...map.values()]
}

/**
 * Bir müşterinin AY AY taksit takvimi (Excel'deki "aylık ödeme ızgarası" karşılığı).
 *
 * Aynı ayda birden çok satışın taksiti olabilir — hepsi tek hücrede toplanır; kullanıcı
 * "bu ay bu müşteriden ne kadar alacağım" sorusunun cevabını arar, hangi satıştan geldiğini
 * satır detayında görür.
 *
 * `todayIso` dışarıdan verilir: test edilebilirlik + "bugün" hesabının YEREL güne göre
 * yapılması için (UTC gününe geçmek ay sınırında hücreyi kaydırır).
 */
export function buildMonthlySchedule(group: CustomerAccountGroup, todayIso: string): MonthCell[] {
  const byMonth = new Map<string, {
    due: number; paid: number; remaining: number; anyOverdue: boolean
    firstDueDate: string | null; installmentCount: number
  }>()

  for (const a of group.accounts) {
    for (const i of activeInstallments(a)) {
      const key = monthKeyOf(i.dueDate)
      if (!key) continue
      const cur = byMonth.get(key) ?? {
        due: 0, paid: 0, remaining: 0, anyOverdue: false, firstDueDate: null, installmentCount: 0,
      }
      cur.due += i.amount
      cur.paid += i.paidAmount
      cur.remaining += Math.max(0, i.remaining)
      if (i.overdue && i.remaining > 0.005) cur.anyOverdue = true
      const day = (i.dueDate || '').slice(0, 10)
      if (day && (!cur.firstDueDate || day < cur.firstDueDate)) cur.firstDueDate = day
      cur.installmentCount += 1
      byMonth.set(key, cur)
    }
  }

  if (byMonth.size === 0) return []

  // Takvim SÜREKLİ olmalı: taksiti olmayan aylar da sütun olarak durur, yoksa "Mart→Haziran"
  // gibi atlayan bir şerit çıkıp ödeme ritmi okunmaz hâle gelir.
  const keys = [...byMonth.keys()].sort()
  const [minY, minM] = keys[0].split('-').map(Number)
  const [maxY, maxM] = keys[keys.length - 1].split('-').map(Number)
  const nowKey = todayIso.slice(0, 7)
  const today = todayIso.slice(0, 10)

  const cells: MonthCell[] = []
  // DEVİR: aylar kronolojik gezilir, ödenmemiş kalan bir sonraki aya taşınır (bkz. dosya başı).
  let carry = 0
  for (let y = minY, m = minM; y < maxY || (y === maxY && m <= maxM); m === 12 ? (m = 1, y += 1) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const v = byMonth.get(key)
    if (!v) {
      // Taksitsiz ay: devir bakiyesi taşınmaya devam eder ama HÜCRE BOŞTUR — o ayın kendi
      // vadesi olmadığı için rengi de yoktur.
      cells.push({
        key, year: y, month: m, due: 0, paid: 0, remaining: 0,
        carryIn: carry, expected: carry, outstanding: carry,
        firstDueDate: null, installmentCount: 0,
        status: 'none',
      })
      continue
    }
    // DURUM AYIN KENDİ HÂLİDİR, devrin değil: geçmişteki borç yüzünden gelecek ayı kırmızı
    // yapmak "bu ayın parası gecikti" diye okunur. Devir ayrı sütun/rakam olarak görünür.
    let status: MonthCell['status']
    if (v.remaining <= 0.005) status = 'paid'
    // GÜN HASSASİYETİ: ay granülü ("bu ay henüz bitmedi") 10 Mart vadesini 15 Mart'ta hâlâ
    // "bekliyor" gösteriyordu. Takvim artık gerçek vade tarihini yazdığı için gün karşılaştırılır.
    else if (v.anyOverdue || key < nowKey || (v.firstDueDate !== null && v.firstDueDate < today)) status = 'overdue'
    else if (v.paid > 0.005) status = 'partial'
    else status = 'upcoming'
    const expected = v.due + carry
    const outstanding = Math.max(0, carry + v.remaining)
    cells.push({
      key, year: y, month: m, due: v.due, paid: v.paid, remaining: v.remaining,
      carryIn: carry, expected, outstanding,
      firstDueDate: v.firstDueDate, installmentCount: v.installmentCount,
      status,
    })
    // Devre yalnız VADESİ GELMİŞ ay katkı verir (bkz. buildInstallmentRows'daki aynı kural).
    if (key <= nowKey) carry = outstanding
  }
  return cells
}

/** Devirli taksit satırı — TEK bir cari hesabın planı (tahsilat modalı bunu kullanır). */
export interface InstallmentDueRow {
  item: AccountInstallmentItem
  /** Önceki taksitlerden devreden ödenmemiş bakiye. */
  carryIn: number
  /** Bu ay ödenmesi gereken toplam: `amount + carryIn`. */
  expected: number
  /** Bu taksitten sonra devreden: `carryIn + remaining`. */
  outstanding: number
  /** Vadesi geçmiş ve hâlâ kalanı var mı (sunucu bayrağı ya da vade < bugün). */
  isOverdue: boolean
}

/**
 * Bir hesabın taksitlerini vade sırasıyla gezip devir bakiyesini hesaplar.
 *
 * <b>Hesap bazındadır</b>: sunucu tahsilatı hesap havuzundan dağıtır, bu yüzden bir satışın
 * gecikmesi başka satışın taksitine binmez. Müşteri düzeyindeki (tüm satışlar) toplu görünüm
 * için `buildMonthlySchedule` kullanılır.
 */
export function buildInstallmentRows(
  installments: AccountInstallmentItem[],
  todayIso: string,
): InstallmentDueRow[] {
  const ordered = installments
    .filter((i) => i.status !== 'Cancelled')
    .slice()
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.no - b.no)

  const today = todayIso.slice(0, 10)
  let carry = 0
  return ordered.map((item) => {
    const remaining = Math.max(0, item.remaining)
    const due = (item.dueDate || '').slice(0, 10)
    const carryIn = carry
    const outstanding = carryIn + remaining
    // DEVRE YALNIZ VADESİ GELMİŞ BORÇ GİRER. Gelecekteki taksitin kalanı da ileri taşınsaydı,
    // düzenli ödeyen müşteride bile sonraki satırlar "devir" göstererek ödenmeyeceğini varsayardı.
    if (due && due <= today) carry = outstanding
    return {
      item,
      carryIn,
      expected: item.amount + carryIn,
      outstanding,
      isOverdue: remaining > 0.005 && (item.overdue || (due !== '' && due < today)),
    }
  })
}

/**
 * "Bu ay ödenmesi gereken" — gecikmiş taksitlerin kalanı + içinde bulunulan ayın taksiti.
 * Tahsilat modalı taksitli hesapta tutarı bununla açar (peşin hesapta kalan borcun tamamı).
 */
export function dueThisMonth(installments: AccountInstallmentItem[], todayIso: string): number {
  const limit = `${todayIso.slice(0, 7)}-31`
  return installments
    .filter((i) => i.status !== 'Cancelled' && i.remaining > 0.005 && (i.dueDate || '').slice(0, 10) <= limit)
    .reduce((sum, i) => sum + Math.max(0, i.remaining), 0)
}
