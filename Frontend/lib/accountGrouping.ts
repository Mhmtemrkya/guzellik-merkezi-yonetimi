import type { CustomerAccount } from '@/lib/types'

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

/** Aylık takvim hücresi — bir müşterinin bir aydaki taksit durumu. */
export interface MonthCell {
  /** `YYYY-MM` — sütun anahtarı. */
  key: string
  year: number
  /** 1-12. */
  month: number
  /** O ay vadesi gelen taksitlerin toplamı. */
  due: number
  /** Bu vadelere dağıtılmış tahsilat. */
  paid: number
  /** Kalan (due − paid), negatife düşmez. */
  remaining: number
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
  const byMonth = new Map<string, { due: number; paid: number; remaining: number; anyOverdue: boolean }>()

  for (const a of group.accounts) {
    for (const i of activeInstallments(a)) {
      const key = monthKeyOf(i.dueDate)
      if (!key) continue
      const cur = byMonth.get(key) ?? { due: 0, paid: 0, remaining: 0, anyOverdue: false }
      cur.due += i.amount
      cur.paid += i.paidAmount
      cur.remaining += Math.max(0, i.remaining)
      if (i.overdue && i.remaining > 0.005) cur.anyOverdue = true
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

  const cells: MonthCell[] = []
  for (let y = minY, m = minM; y < maxY || (y === maxY && m <= maxM); m === 12 ? (m = 1, y += 1) : (m += 1)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const v = byMonth.get(key)
    if (!v) {
      cells.push({ key, year: y, month: m, due: 0, paid: 0, remaining: 0, status: 'none' })
      continue
    }
    let status: MonthCell['status']
    if (v.remaining <= 0.005) status = 'paid'
    else if (v.anyOverdue || key < nowKey) status = 'overdue'
    else if (v.paid > 0.005) status = 'partial'
    else status = 'upcoming'
    cells.push({ key, year: y, month: m, due: v.due, paid: v.paid, remaining: v.remaining, status })
  }
  return cells
}
