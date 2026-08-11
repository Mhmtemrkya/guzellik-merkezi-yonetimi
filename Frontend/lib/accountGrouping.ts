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

// ---------------------------------------------------------------------------
// "TÜMÜ" — MÜŞTERİNİN BÜTÜN SATIŞLARINA TEK SEFERDE TAHSİLAT
// ---------------------------------------------------------------------------

/** Tümü modunda bir satışın vade kuyruğundaki tek sırası. */
export interface GlobalDueRow {
  accountId: string
  /** Satış adı — birleşik kuyrukta hangi satıştan geldiği yazılmalı. */
  accountLabel: string
  /** Taksit satırı; peşin satışın kalanı için sentetik satır üretilir (bkz. buildGlobalDueQueue). */
  installmentNo: number | null
  dueDate: string
  remaining: number
  isOverdue: boolean
}

/** Tümü modunun özeti — modaldeki rakamlar buradan okunur. */
export interface AllAccountsSummary {
  /** Tüm satışların kalan borcu (cari başına sıfırla sınırlı). */
  remaining: number
  /** Tüm satışların "bu ay ödenmesi gereken" toplamı. */
  dueNow: number
  /** Tüm satışların gecikmiş kalanı. */
  overdue: number
  /** Açık borcu olan satış adedi. */
  openCount: number
  /** Birleşik vade kuyruğu (global vade sırası) — dağıtım da bunu izler. */
  queue: GlobalDueRow[]
}

/** Tek satışın "tahsilat dağıtımında" kullanılacak kalan borcu. */
function accountRemaining(a: CustomerAccount): number {
  return Math.max(0, a.remainingAmount)
}

/**
 * Tüm satışların vadelerini TEK KUYRUKTA, global vade sırasıyla birleştirir.
 *
 * <p>Peşin satışın (taksit satırı olmayan) kalan borcu da kuyruğa girer: parası satış anında
 * istenmiştir, yani vadesi satış günüdür — kuyrukta erken sıraya oturur ve gecikmiş sayılır.
 * Kuyruğa alınmasaydı "Tümü" ile ödenen para peşin satışın borcunu hiç kapatmazdı.</p>
 *
 * <p>Taksit toplamı ile hesabın <c>remainingAmount</c>'ı kuruş farkıyla ayrışabilir (fazla
 * ödeme / kredi bakiyesi); kuyruk hesap başına <c>remainingAmount</c> ile SINIRLANIR ki
 * dağıtım sunucunun kabul edeceğinden fazlasını bir satışa yazmasın.</p>
 */
export function buildGlobalDueQueue(accounts: CustomerAccount[], todayIso: string): GlobalDueRow[] {
  const today = todayIso.slice(0, 10)
  const rows: GlobalDueRow[] = []

  for (const a of accounts) {
    let budget = accountRemaining(a)
    if (budget <= 0.005) continue
    const label = a.servicePackageName || a.name || 'Satış'
    const insts = activeInstallments(a)
      .filter((i) => i.remaining > 0.005)
      .slice()
      .sort((x, y) => (x.dueDate || '').localeCompare(y.dueDate || '') || x.no - y.no)

    for (const i of insts) {
      if (budget <= 0.005) break
      const take = Math.min(budget, Math.max(0, i.remaining))
      budget -= take
      const due = (i.dueDate || '').slice(0, 10)
      rows.push({
        accountId: a.id,
        accountLabel: label,
        installmentNo: i.no,
        dueDate: due,
        remaining: take,
        isOverdue: i.overdue || (due !== '' && due < today),
      })
    }

    // Taksitle karşılanmayan kalan (peşin satış ya da plan dışı bakiye) — vadesi satış günüdür.
    if (budget > 0.005) {
      const soldDay = (a.soldAtUtc || a.createdAtUtc || '').slice(0, 10)
      rows.push({
        accountId: a.id,
        accountLabel: label,
        installmentNo: null,
        dueDate: soldDay,
        remaining: budget,
        isOverdue: soldDay === '' || soldDay < today,
      })
    }
  }

  // GLOBAL VADE SIRASI: en eski borç önce kapanır. Tarihsiz satır (bozuk veri) en başa alınır —
  // gizlenmesi, kullanıcının göremediği bir borcun ödenmemesi demek olurdu.
  return rows.sort((x, y) => (x.dueDate || '0000-00-00').localeCompare(y.dueDate || '0000-00-00'))
}

/** Tümü modunun özet rakamları. */
export function summarizeAllAccounts(accounts: CustomerAccount[], todayIso: string): AllAccountsSummary {
  const open = accounts.filter((a) => accountRemaining(a) > 0.005)
  const queue = buildGlobalDueQueue(accounts, todayIso)
  return {
    remaining: open.reduce((s, a) => s + accountRemaining(a), 0),
    // Her satışın kendi "bu ay ödenmesi gereken"i toplanır; peşin satışta kalan borcun tamamı.
    dueNow: open.reduce((s, a) => {
      const plan = activeInstallments(a)
      return s + (plan.length > 0 ? dueThisMonth(a.installments, todayIso) : accountRemaining(a))
    }, 0),
    overdue: queue.filter((r) => r.isOverdue).reduce((s, r) => s + r.remaining, 0),
    openCount: open.length,
    queue,
  }
}

/** Dağıtım sonucu — satış başına yazılacak tahsilat tutarı. */
export interface AccountAllocation {
  accountId: string
  accountLabel: string
  amount: number
}

/**
 * Bir tutarı BİRDEN ÇOK satışa, GLOBAL VADE SIRASIYLA dağıtır.
 *
 * <p>Sunucu tahsilatı tek bir hesaba yazar ve o hesabın taksitlerine dağıtır; müşteri düzeyinde
 * "hepsine öde" diye bir uç yok. Bu yüzden bölüştürme İSTEMCİDE yapılır ve her satış için AYRI
 * bir tahsilat çağrısı gider — para hangi satışa yazıldıysa oranın taksitini kapatır.</p>
 *
 * <p>Kuruş artığı: her satırda 2 haneye yuvarlanır, toplam sapması SON satıra eklenir; böylece
 * dağıtılan toplam girilen tutara birebir eşit kalır (yoksa 0,01 ₺ eksik/fazla tahsilat).</p>
 */
export function allocateAcrossAccounts(
  accounts: CustomerAccount[],
  amount: number,
  todayIso: string,
): AccountAllocation[] {
  let pool = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100)
  if (pool <= 0.005) return []

  const byAccount = new Map<string, AccountAllocation>()
  for (const row of buildGlobalDueQueue(accounts, todayIso)) {
    if (pool <= 0.005) break
    const take = Math.min(pool, row.remaining)
    if (take <= 0.005) continue
    pool -= take
    const cur = byAccount.get(row.accountId)
    if (cur) cur.amount += take
    else byAccount.set(row.accountId, { accountId: row.accountId, accountLabel: row.accountLabel, amount: take })
  }

  const out = [...byAccount.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
  if (out.length === 0) return out

  // FAZLA ÖDEME: borçtan büyük tutar girildiyse artan son satışa yazılır (sunucuda kredi bakiyesi
  // olur). Sessizce yutulsaydı kasaya giren para ile carilere yazılan tutar tutmazdı.
  const distributed = out.reduce((s, r) => s + r.amount, 0)
  const drift = Math.round((Math.round(amount * 100) / 100 - distributed) * 100) / 100
  if (Math.abs(drift) > 0.001) out[out.length - 1].amount = Math.round((out[out.length - 1].amount + drift) * 100) / 100

  return out.filter((r) => r.amount > 0.005)
}

/** Sunucuya gidecek TEK tahsilat çağrısı (satış × yöntem). */
export interface CollectionCall {
  accountId: string
  accountLabel: string
  method: string
  amount: number
}

/**
 * Satış dağıtımı ile ödeme yöntemi kırılımını ÇAKIŞTIRIR.
 *
 * <p>Neden ayrı bir adım: yöntemleri tek tek dağıtmak borcu ÇİFT SAYAR. 1.500 borçlu A ve
 * 2.000 borçlu B varken "2.000 nakit + 1.000 kart" girildiğinde her yöntem kuyruğun başından
 * dağıtılsaydı A'ya hem nakitten 1.500 hem karttan 1.000 yazılırdı. Doğrusu: önce TOPLAM
 * satışlara dağıtılır (allocateAcrossAccounts), sonra yöntem havuzları bu paylara sırayla
 * doldurulur — böylece hem satış payları hem kasa yöntem kırılımı korunur.</p>
 *
 * <p>Tek satışlı (klasik) tahsilatta da aynı fonksiyon kullanılır; orada tek pay vardır ve
 * çıktı yöntem satırlarının aynısıdır.</p>
 */
export function planCollectionCalls(
  allocations: AccountAllocation[],
  methodRows: { method: string; amount: number }[],
): CollectionCall[] {
  const pools = methodRows
    .map((r) => ({ method: r.method, left: Math.round((Number(r.amount) || 0) * 100) / 100 }))
    .filter((r) => r.left > 0.005)
  const calls: CollectionCall[] = []

  for (const alloc of allocations) {
    let need = Math.round(alloc.amount * 100) / 100
    for (const pool of pools) {
      if (need <= 0.005) break
      if (pool.left <= 0.005) continue
      const take = Math.round(Math.min(need, pool.left) * 100) / 100
      pool.left = Math.round((pool.left - take) * 100) / 100
      need = Math.round((need - take) * 100) / 100
      // Aynı satış + aynı yöntem tek çağrıda toplanır: sunucuda gereksiz ikinci satır açılmasın.
      const existing = calls.find((c) => c.accountId === alloc.accountId && c.method === pool.method)
      if (existing) existing.amount = Math.round((existing.amount + take) * 100) / 100
      else calls.push({ accountId: alloc.accountId, accountLabel: alloc.accountLabel, method: pool.method, amount: take })
    }
  }

  return calls.filter((c) => c.amount > 0.005)
}
