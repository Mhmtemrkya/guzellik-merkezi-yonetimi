import { describe, it, expect } from 'vitest'
import {
  allocateAcrossAccounts, buildDueDateSchedule, buildGlobalDueQueue, buildInstallmentRows,
  dueThisMonth, groupAccountsByCustomer, planCollectionCalls, summarizeAllAccounts,
} from './accountGrouping'
import type { AccountInstallmentItem, CustomerAccount } from './types'

/**
 * Ön Muhasebe listesi artık MÜŞTERİ bazında gruplanıyor (veri modeli değişmedi: her satış hâlâ
 * kendi cari kartını açar). Buradaki testler toplama kurallarını sabitler — özellikle "fazla
 * ödeme başka satışın borcunu kapatmaz" ve "iptal edilen taksit borç doğurmaz".
 */

function inst(p: Partial<AccountInstallmentItem> & { dueDate: string; amount: number }): AccountInstallmentItem {
  const paidAmount = p.paidAmount ?? 0
  return {
    id: p.id ?? `i-${p.dueDate}-${p.amount}`,
    no: p.no ?? 1,
    dueDate: p.dueDate,
    amount: p.amount,
    paidAmount,
    remaining: p.remaining ?? Math.max(0, p.amount - paidAmount),
    status: p.status ?? 'Planned',
    paidAtUtc: p.paidAtUtc ?? null,
    overdue: p.overdue ?? false,
  }
}

function acc(p: Partial<CustomerAccount> & { id: string; customerId: string }): CustomerAccount {
  const installments = p.installments ?? []
  const totalAmount = p.totalAmount ?? installments.reduce((s, i) => s + i.amount, 0)
  const paidAmount = p.paidAmount ?? installments.reduce((s, i) => s + i.paidAmount, 0)
  return {
    id: p.id,
    customerId: p.customerId,
    customerName: p.customerName ?? 'Ayşe Yılmaz',
    customerPhone: p.customerPhone ?? '0555 111 22 33',
    servicePackageId: null,
    servicePackageName: p.servicePackageName ?? '',
    name: p.name ?? 'Satış',
    totalAmount,
    depositAmount: 0,
    paidAmount,
    remainingAmount: p.remainingAmount ?? Math.max(0, totalAmount - paidAmount),
    creditBalance: p.creditBalance ?? 0,
    isActive: true,
    notes: '',
    installments,
    payments: [],
    appointmentRevenue: 0,
    completedAppointmentCount: 0,
    createdAtUtc: p.createdAtUtc ?? '2026-01-01T00:00:00Z',
    nextDueDate: p.nextDueDate ?? null,
    nextDueAmount: p.nextDueAmount ?? 0,
    hasOverdue: p.hasOverdue ?? false,
    soldAtUtc: p.soldAtUtc ?? '2026-01-01T00:00:00Z',
    soldByStaffName: '',
    appliedByStaffName: '',
    isHistorical: false,
    cancelledAtUtc: null,
    cancellationReason: '',
    sessionsTotal: p.sessionsTotal ?? 0,
    sessionsUsed: 0,
    sessionsRemaining: p.sessionsRemaining ?? 0,
    items: [],
    saleStatus: p.saleStatus ?? 'Active',
  } as CustomerAccount
}

describe('groupAccountsByCustomer', () => {
  it('aynı müşterinin üç satışını TEK satırda toplar', () => {
    const groups = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', totalAmount: 3000, paidAmount: 1000, remainingAmount: 2000 }),
      acc({ id: 'a2', customerId: 'c1', totalAmount: 1500, paidAmount: 1500, remainingAmount: 0 }),
      acc({ id: 'a3', customerId: 'c1', totalAmount: 500, paidAmount: 0, remainingAmount: 500 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].saleCount).toBe(3)
    expect(groups[0].totalAmount).toBe(5000)
    expect(groups[0].paidAmount).toBe(2500)
    expect(groups[0].remainingAmount).toBe(2500)
  })

  it('FAZLA ÖDEME başka satışın borcunu kapatmaz', () => {
    // Sunucu tahsilatı hesap bazında tutar: a1'deki 200 kredi, a2'nin 800 borcunu azaltmamalı.
    // Ham toplama (Σ total − Σ paid) 600 verirdi ve müşteri olduğundan az borçlu görünürdü.
    const groups = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', totalAmount: 1000, paidAmount: 1200, remainingAmount: 0, creditBalance: 200 }),
      acc({ id: 'a2', customerId: 'c1', totalAmount: 800, paidAmount: 0, remainingAmount: 800 }),
    ])
    expect(groups[0].remainingAmount).toBe(800)
  })

  it('farklı müşteriler ayrı satır; müşterisiz kayıt yutulmaz', () => {
    const groups = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1' }),
      acc({ id: 'a2', customerId: 'c2', customerName: 'Zeynep' }),
      acc({ id: 'a3', customerId: '', customerName: 'Bozuk kayıt' }),
    ])
    expect(groups).toHaveLength(3)
  })

  it('gecikme ve en yakın vade tüm satışlar arasından seçilir', () => {
    const groups = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1', nextDueDate: '2026-09-10', nextDueAmount: 500,
        installments: [inst({ dueDate: '2026-07-10', amount: 500, overdue: true })],
      }),
      acc({ id: 'a2', customerId: 'c1', nextDueDate: '2026-08-05', nextDueAmount: 300 }),
    ])
    expect(groups[0].hasOverdue).toBe(true)
    expect(groups[0].overdueAmount).toBe(500)
    expect(groups[0].nextDueDate).toBe('2026-08-05')
    expect(groups[0].nextDueAmount).toBe(300)
  })

  it('İPTAL edilen taksit borç/gecikme doğurmaz', () => {
    const groups = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1',
        installments: [
          inst({ dueDate: '2026-07-10', amount: 500, overdue: true, status: 'Cancelled' }),
          inst({ dueDate: '2026-08-10', amount: 500 }),
        ],
      }),
    ])
    expect(groups[0].hasOverdue).toBe(false)
    expect(groups[0].overdueAmount).toBe(0)
    // Tek AKTİF taksit kaldı → taksitli sayılmaz (peşin gibi davranır).
    expect(groups[0].hasInstallmentPlan).toBe(false)
  })
})

describe('buildDueDateSchedule', () => {
  it('AYNI GÜNE düşen taksitleri tek satırda TOPLAR, kaynağını dökümler', () => {
    // Kullanıcı senaryosu: 12.08'de bir pakette 5.000, başka pakette 2.000 → o gün 7.000.
    const [g] = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1', servicePackageName: 'Cilt Bakımı',
        installments: [inst({ dueDate: '2026-08-12', amount: 5000 })],
      }),
      acc({
        id: 'a2', customerId: 'c1', servicePackageName: 'Lazer',
        installments: [inst({ dueDate: '2026-08-12', amount: 2000 })],
      }),
    ])
    const rows = buildDueDateSchedule(g, '2026-08-01')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-08-12')
    expect(rows[0].due).toBe(7000)
    expect(rows[0].installmentCount).toBe(2)
    // Payı büyük olan önce; hangi satıştan geldiği satır altında yazar.
    expect(rows[0].sources.map((s) => [s.label, s.amount])).toEqual([['Cilt Bakımı', 5000], ['Lazer', 2000]])
  })

  it('farklı tarihler KRONOLOJİK araya girer (12 → 15 → 17)', () => {
    // Üçüncü paket iki takvimin ORTASINA denk geliyor: 15'i, 12 ile 17'nin arasına girmeli.
    const [g] = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', installments: [inst({ dueDate: '2026-08-12', amount: 500 })] }),
      acc({ id: 'a2', customerId: 'c1', installments: [inst({ dueDate: '2026-08-17', amount: 700 })] }),
      acc({ id: 'a3', customerId: 'c1', installments: [inst({ dueDate: '2026-08-15', amount: 900 })] }),
    ])
    expect(buildDueDateSchedule(g, '2026-08-01').map((r) => r.date))
      .toEqual(['2026-08-12', '2026-08-15', '2026-08-17'])
  })

  it('satış seçilince takvim YALNIZ o satışa daralır', () => {
    const [g] = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', installments: [inst({ dueDate: '2026-08-12', amount: 5000 })] }),
      acc({ id: 'a2', customerId: 'c1', installments: [inst({ dueDate: '2026-08-12', amount: 2000 })] }),
    ])
    const only = buildDueDateSchedule(g, '2026-08-01', 'a2')
    expect(only).toHaveLength(1)
    expect(only[0].due).toBe(2000)
    expect(only[0].sources).toHaveLength(1)
  })

  it('durum renkleri: ödendi / kısmi / gecikmiş / bekleyen', () => {
    const [g] = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1',
        installments: [
          inst({ dueDate: '2026-06-10', amount: 500, paidAmount: 500 }),                 // ödendi
          inst({ dueDate: '2026-07-10', amount: 500, paidAmount: 200, overdue: true }),  // kısmi + gecikmiş
          inst({ dueDate: '2026-09-10', amount: 500, paidAmount: 100 }),                 // kısmi (vade gelmedi)
          inst({ dueDate: '2026-10-10', amount: 500 }),                                  // bekleyen
        ],
      }),
    ])
    const byDate = Object.fromEntries(buildDueDateSchedule(g, '2026-08-15').map((r) => [r.date, r]))
    expect(byDate['2026-06-10'].status).toBe('paid')
    // Gecikme, kısmi ödemeye BASKIN: para hâlâ alınmadı ve vadesi geçti.
    expect(byDate['2026-07-10'].status).toBe('overdue')
    expect(byDate['2026-09-10'].status).toBe('partial')
    expect(byDate['2026-10-10'].status).toBe('upcoming')
  })

  it('vadesiz gün SATIR ÜRETMEZ (aylık ızgaradaki boş sütunlar kalktı)', () => {
    const [g] = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1',
        installments: [inst({ dueDate: '2026-11-10', amount: 500 }), inst({ dueDate: '2027-02-10', amount: 500 })],
      }),
    ])
    expect(buildDueDateSchedule(g, '2026-08-15').map((r) => r.date)).toEqual(['2026-11-10', '2027-02-10'])
  })

  it('vadesi geçmiş gün, taksit "overdue" işaretlenmemiş olsa da kırmızıdır', () => {
    // Sunucu gecikme bayrağını bir sonraki vadeye göre koyar (aylık tolerans); takvimde ise
    // kullanıcı "o günün parası geldi mi" diye bakar — geçmiş gün + kalan = kırmızı.
    const [g] = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', installments: [inst({ dueDate: '2026-07-10', amount: 500 })] }),
    ])
    expect(buildDueDateSchedule(g, '2026-08-15')[0].status).toBe('overdue')
  })

  it('iptal edilmiş taksit takvime girmez', () => {
    const [g] = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1',
        installments: [
          inst({ dueDate: '2026-09-10', amount: 500 }),
          inst({ dueDate: '2026-10-10', amount: 500, status: 'Cancelled' }),
        ],
      }),
    ])
    expect(buildDueDateSchedule(g, '2026-08-15').map((r) => r.date)).toEqual(['2026-09-10'])
  })

  it('taksiti olmayan müşteride takvim boştur (peşin satış)', () => {
    const [g] = groupAccountsByCustomer([acc({ id: 'a1', customerId: 'c1' })])
    expect(buildDueDateSchedule(g, '2026-08-15')).toEqual([])
  })
})

/**
 * DÜZENSİZ ÖDEME (DEVİR) — kullanıcının anlattığı Ela senaryosu birebir sabitlenir.
 *
 * 30.000 ₺ paket · 5.000 ₺ peşin · kalan 25.000 ₺ 5 ay taksit (ayda 5.000 ₺).
 * Sunucu tahsilatı VADE SIRASIYLA dağıtır; bu testler o dağıtımın üstüne kurulan
 * "ödenmeyen ay bir sonraki ayın üstüne biner" görünümünü doğrular.
 */
describe('devir (düzensiz ödeme) — Ela senaryosu', () => {
  const plan = (paidPerInstallment: number[]): AccountInstallmentItem[] =>
    ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10'].map((dueDate, idx) =>
      inst({ id: `i${idx + 1}`, no: idx + 1, dueDate, amount: 5000, paidAmount: paidPerInstallment[idx] ?? 0 }),
    )

  it('2. ay ödenmezse 3. ayda ödenmesi gereken 10.000 olur', () => {
    // Ela yalnız 1. ayı ödedi (5.000). Havuz 5.000 → i1 kapanır, i2 ve i3 açık.
    const rows = buildInstallmentRows(plan([5000]), '2026-03-15')
    const march = rows[2]
    expect(march.carryIn).toBe(5000)   // ödenmeyen Şubat devretti
    expect(march.expected).toBe(10000) // 5.000 plan + 5.000 devir
    expect(march.outstanding).toBe(10000)
    // "Bu ay ödenmesi gereken" tahsilat modalının açılış tutarıdır.
    expect(dueThisMonth(plan([5000]), '2026-03-15')).toBe(10000)
  })

  it('3. ayda 7.500 ödenirse kalan 2.500 nisana devreder (nisan 7.500 olur)', () => {
    // Toplam ödenen 12.500 → vade sırasıyla: i1 5.000, i2 5.000, i3 2.500.
    const rows = buildInstallmentRows(plan([5000, 5000, 2500]), '2026-04-15')
    const march = rows[2]
    const april = rows[3]
    expect(march.item.remaining).toBe(2500)
    expect(april.carryIn).toBe(2500)
    expect(april.expected).toBe(7500) // 5.000 plan + 2.500 devir
    expect(dueThisMonth(plan([5000, 5000, 2500]), '2026-04-15')).toBe(7500)
  })

  it('devir birikir: iki ay üst üste ödenmezse üçüncü ay üç taksit ister', () => {
    const rows = buildInstallmentRows(plan([5000]), '2026-04-15')
    expect(rows[3].carryIn).toBe(10000)
    expect(rows[3].expected).toBe(15000)
  })

  it('düzenli ödeyende devir yoktur', () => {
    const rows = buildInstallmentRows(plan([5000, 5000, 5000]), '2026-03-15')
    expect(rows.map((r) => r.carryIn)).toEqual([0, 0, 0, 0, 0])
    expect(rows[3].expected).toBe(5000)
    // Vadesi gelmemiş aylar "bu ay ödenmesi gereken"e girmez.
    expect(dueThisMonth(plan([5000, 5000, 5000]), '2026-03-15')).toBe(0)
  })

  it('iptal edilen taksit devre girmez', () => {
    const items = plan([5000])
    items[1] = { ...items[1], status: 'Cancelled' }
    const rows = buildInstallmentRows(items, '2026-03-15')
    expect(rows).toHaveLength(4)
    expect(rows[1].carryIn).toBe(0) // iptal edilen şubat borç doğurmaz
  })

  it('TAKSİT TAKVİMİ devri TAŞIMAZ — her satır kendi PLAN tutarını yazar', () => {
    // Devir, tahsilat önerisine özeldir (buildInstallmentRows / dueThisMonth). Takvimde "Kalan"
    // sütunu kaldırıldığı için devri gösterecek yer de yok; ayrıca takvim birden çok satışı
    // birleştirebiliyor, oysa devir HESAP bazlıdır — orada taşımak yanlış rakam üretirdi.
    const [g] = groupAccountsByCustomer([acc({ id: 'a1', customerId: 'c1', installments: plan([5000]) })])
    const rows = buildDueDateSchedule(g, '2026-03-15')
    const march = rows.find((r) => r.date.startsWith('2026-03'))!
    expect(march.due).toBe(5000)      // PLAN tutarı; ödenmemiş ocak/şubat buraya BİNMEZ
    expect(march.status).toBe('overdue')
    // Devir hâlâ tahsilat tarafında yaşıyor:
    expect(buildInstallmentRows(plan([5000]), '2026-03-15')[2].carryIn).toBe(5000)
  })
})

/**
 * "TÜMÜ" — bir tutarın müşterinin BÜTÜN satışlarına dağıtılması.
 *
 * Sunucu tahsilatı tek hesaba yazar; bölüştürme istemcide yapılır ve her satış için ayrı
 * tahsilat çağrısı gider. Buradaki testler dağıtım sırasını (global vade) ve kuruş
 * bütünlüğünü (dağıtılan toplam = girilen tutar) sabitler.
 */
describe('allocateAcrossAccounts (Tümü)', () => {
  const twoSales = (): CustomerAccount[] => [
    acc({
      id: 'a1', customerId: 'c1', servicePackageName: 'Lazer Paketi',
      totalAmount: 3000, paidAmount: 0, remainingAmount: 3000,
      installments: [
        inst({ id: 'a1-1', no: 1, dueDate: '2026-01-10', amount: 1500 }),
        inst({ id: 'a1-2', no: 2, dueDate: '2026-03-10', amount: 1500 }),
      ],
    }),
    acc({
      id: 'a2', customerId: 'c1', servicePackageName: 'Cilt Bakımı',
      totalAmount: 2000, paidAmount: 0, remainingAmount: 2000,
      installments: [
        inst({ id: 'a2-1', no: 1, dueDate: '2026-02-10', amount: 1000 }),
        inst({ id: 'a2-2', no: 2, dueDate: '2026-04-10', amount: 1000 }),
      ],
    }),
  ]

  it('GLOBAL vade sırası: en eski borç hangi satışta olursa olsun önce kapanır', () => {
    // Kuyruk: 10 Oca (a1) · 10 Şub (a2) · 10 Mar (a1) · 10 Nis (a2)
    const queue = buildGlobalDueQueue(twoSales(), '2026-05-15')
    expect(queue.map((r) => `${r.accountId}:${r.dueDate}`)).toEqual([
      'a1:2026-01-10', 'a2:2026-02-10', 'a1:2026-03-10', 'a2:2026-04-10',
    ])
  })

  it('2.500 ödeme iki satışa bölünür: a1 1.500 + a2 1.000', () => {
    const out = allocateAcrossAccounts(twoSales(), 2500, '2026-05-15')
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.accountId === 'a1')!.amount).toBe(1500)
    expect(out.find((r) => r.accountId === 'a2')!.amount).toBe(1000)
  })

  it('dağıtılan toplam girilen tutara BİREBİR eşittir (kuruş kaybı yok)', () => {
    const out = allocateAcrossAccounts(twoSales(), 3333.33, '2026-05-15')
    const sum = out.reduce((s, r) => s + r.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(3333.33)
  })

  it('borçtan büyük ödeme yutulmaz — artan son satışa (kredi) yazılır', () => {
    // Toplam borç 5.000; 6.000 girilirse 1.000 fazla da bir cariye yazılmalı, yoksa kasaya
    // giren para ile carilere işlenen tutar tutmaz.
    const out = allocateAcrossAccounts(twoSales(), 6000, '2026-05-15')
    expect(out.reduce((s, r) => s + r.amount, 0)).toBe(6000)
  })

  it('PEŞİN satışın kalanı da kuyruğa girer (taksit satırı yok ama borç var)', () => {
    const list = [
      acc({ id: 'p1', customerId: 'c1', name: 'Ürün satışı', totalAmount: 800, paidAmount: 0, remainingAmount: 800, soldAtUtc: '2026-01-05T00:00:00Z' }),
      acc({
        id: 'p2', customerId: 'c1', totalAmount: 1000, paidAmount: 0, remainingAmount: 1000,
        installments: [inst({ id: 'p2-1', no: 1, dueDate: '2026-03-10', amount: 1000 })],
      }),
    ]
    const out = allocateAcrossAccounts(list, 800, '2026-05-15')
    // Peşin satışın vadesi satış günü (5 Oca) → taksitten önce kapanır.
    expect(out).toHaveLength(1)
    expect(out[0].accountId).toBe('p1')
    expect(out[0].amount).toBe(800)
  })

  it('kapanmış satışa para yazılmaz', () => {
    const list = [
      acc({ id: 'k1', customerId: 'c1', totalAmount: 1000, paidAmount: 1000, remainingAmount: 0 }),
      acc({
        id: 'k2', customerId: 'c1', totalAmount: 500, paidAmount: 0, remainingAmount: 500,
        installments: [inst({ id: 'k2-1', no: 1, dueDate: '2026-03-10', amount: 500 })],
      }),
    ]
    const out = allocateAcrossAccounts(list, 500, '2026-05-15')
    expect(out.map((r) => r.accountId)).toEqual(['k2'])
  })

  it('dağıtım hesabın kalan borcunu AŞMAZ (kredi bakiyeli satışta taksit toplamı büyük olabilir)', () => {
    // remainingAmount 400 ama taksit kalanları toplamı 1.000: sunucu 400'den fazlasını borç
    // saymıyor, kuyruk da 400 ile sınırlanmalı.
    const list = [
      acc({
        id: 'x1', customerId: 'c1', totalAmount: 1000, paidAmount: 600, remainingAmount: 400,
        installments: [
          inst({ id: 'x1-1', no: 1, dueDate: '2026-01-10', amount: 500 }),
          inst({ id: 'x1-2', no: 2, dueDate: '2026-02-10', amount: 500 }),
        ],
      }),
      acc({
        id: 'x2', customerId: 'c1', totalAmount: 900, paidAmount: 0, remainingAmount: 900,
        installments: [inst({ id: 'x2-1', no: 1, dueDate: '2026-03-10', amount: 900 })],
      }),
    ]
    const out = allocateAcrossAccounts(list, 1300, '2026-05-15')
    expect(out.find((r) => r.accountId === 'x1')!.amount).toBe(400)
    expect(out.find((r) => r.accountId === 'x2')!.amount).toBe(900)
  })

  it('özet: kalan / bu ay ödenmesi gereken / gecikmiş ayrı ayrı toplanır', () => {
    // 5 Şubat: 10 Şub taksiti BU AY ödenecek ama henüz GECİKMEDİ — iki kavram ayrı rakamdır.
    const s = summarizeAllAccounts(twoSales(), '2026-02-05')
    expect(s.remaining).toBe(5000)
    expect(s.openCount).toBe(2)
    // Bu ay ödenmesi gereken: 10 Oca (1.500) + 10 Şub (1.000). Mart/Nisan hariç.
    expect(s.dueNow).toBe(2500)
    /*
     * GECİKME TEK KAYNAKTAN: `overdue` bayrağı.
     *
     * Kuyruk eskiden ham "vade < bugün" ile de gecikme sayıyordu ve AYLIK TOLERANSI deliyordu:
     * 10 Oca taksiti, bir sonraki vade (10 Şub) gelene kadar gecikmiş değildir — cari kartı da
     * öyle gösterir. İkisi ayrışınca aynı borç bir ekranda kırmızı, diğerinde normal oluyordu.
     * Bu kurgudaki taksitlerde bayrak KURULU DEĞİL, dolayısıyla gecikme de yoktur.
     */
    expect(s.overdue).toBe(0)
  })

  it('gecikme bayrağı kurulu taksit kuyrukta da gecikmiş sayılır', () => {
    // Bayrağın kendisi çalışıyor: tolerans dolduğunda sunucu/mapper bunu işaretler.
    const list = [
      acc({
        id: 'x1', customerId: 'c1', totalAmount: 1500, paidAmount: 0, remainingAmount: 1500,
        installments: [inst({ id: 'x1-1', no: 1, dueDate: '2026-01-10', amount: 1500, overdue: true })],
      }),
    ]
    expect(summarizeAllAccounts(list, '2026-02-15').overdue).toBe(1500)
  })

  it('tutar 0 ise hiç çağrı üretilmez', () => {
    expect(allocateAcrossAccounts(twoSales(), 0, '2026-05-15')).toEqual([])
  })
})

/**
 * SATIŞ DAĞITIMI × YÖNTEM KIRILIMI.
 *
 * En sinsi hata burada: yöntemleri tek tek dağıtmak aynı borcu iki kez sayar. Bu testler
 * hem satış paylarının hem kasa yöntem toplamlarının korunduğunu sabitler.
 */
describe('planCollectionCalls', () => {
  it('ÇİFT SAYIM YOK: iki yöntem iki satışa doğru bölünür', () => {
    // A 1.500, B 1.500 pay aldı; ödeme 2.000 nakit + 1.000 kart.
    const calls = planCollectionCalls(
      [
        { accountId: 'a', accountLabel: 'A', amount: 1500 },
        { accountId: 'b', accountLabel: 'B', amount: 1500 },
      ],
      [{ method: 'cash', amount: 2000 }, { method: 'card', amount: 1000 }],
    )
    // A tamamı nakit; B 500 nakit + 1.000 kart.
    expect(calls).toEqual([
      { accountId: 'a', accountLabel: 'A', method: 'cash', amount: 1500 },
      { accountId: 'b', accountLabel: 'B', method: 'cash', amount: 500 },
      { accountId: 'b', accountLabel: 'B', method: 'card', amount: 1000 },
    ])
  })

  it('satış payları ve yöntem toplamları AYNI ANDA korunur', () => {
    const calls = planCollectionCalls(
      [
        { accountId: 'a', accountLabel: 'A', amount: 1200 },
        { accountId: 'b', accountLabel: 'B', amount: 800 },
      ],
      [{ method: 'cash', amount: 1500 }, { method: 'transfer', amount: 500 }],
    )
    const perAccount = (id: string) => calls.filter((c) => c.accountId === id).reduce((s, c) => s + c.amount, 0)
    const perMethod = (m: string) => calls.filter((c) => c.method === m).reduce((s, c) => s + c.amount, 0)
    expect(perAccount('a')).toBe(1200)
    expect(perAccount('b')).toBe(800)
    expect(perMethod('cash')).toBe(1500)
    expect(perMethod('transfer')).toBe(500)
  })

  it('tek satış + tek yöntem: çıktı girdinin aynısıdır (klasik tahsilat)', () => {
    const calls = planCollectionCalls(
      [{ accountId: 'a', accountLabel: 'A', amount: 750 }],
      [{ method: 'cash', amount: 750 }],
    )
    expect(calls).toEqual([{ accountId: 'a', accountLabel: 'A', method: 'cash', amount: 750 }])
  })

  it('aynı satış + aynı yöntem TEK çağrıda toplanır', () => {
    const calls = planCollectionCalls(
      [{ accountId: 'a', accountLabel: 'A', amount: 1000 }],
      [{ method: 'cash', amount: 400 }, { method: 'cash', amount: 600 }],
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].amount).toBe(1000)
  })
})

/**
 * "TÜMÜ + bu ayın taksitleri" — kullanıcının tarif ettiği beklenti.
 *
 * Beklenen: Tümü'de iki kırılım vardır (tüm borç ↔ bu ayın taksit toplamı) ve ikincisi
 * seçilince HER SATIŞIN o ayki taksiti kapanır — para tek satışa yığılmaz.
 */
describe('Tümü kırılımı: bu ayın taksitleri her satıştan birer taksit kapatır', () => {
  /** Üç satış, her biri 5 × 1.000 aylık taksit; hiçbiri gecikmemiş. */
  const threeSales = (): CustomerAccount[] =>
    ['A Paketi', 'B Paketi', 'C Paketi'].map((label, s) =>
      acc({
        id: `s${s + 1}`,
        customerId: 'c1',
        servicePackageName: label,
        totalAmount: 5000,
        paidAmount: 0,
        remainingAmount: 5000,
        installments: [1, 2, 3, 4, 5].map((no) =>
          inst({ id: `s${s + 1}-i${no}`, no, dueDate: `2026-0${no}-15`, amount: 1000 }),
        ),
      }),
    )

  it('kırılım-1 "tüm borç": üç satışın toplamı', () => {
    const s = summarizeAllAccounts(threeSales(), '2026-01-10')
    expect(s.remaining).toBe(15000)
  })

  it('kırılım-2 "bu ayın taksitleri": her satıştan BİR taksit = 3 × 1.000', () => {
    const s = summarizeAllAccounts(threeSales(), '2026-01-10')
    expect(s.dueNow).toBe(3000)
  })

  it('3.000 ödenince her satışa 1.000 yazılır (biri diğerini yemez)', () => {
    const out = allocateAcrossAccounts(threeSales(), 3000, '2026-01-10')
    expect(out).toHaveLength(3)
    expect(out.map((r) => r.amount)).toEqual([1000, 1000, 1000])
    expect(out.map((r) => r.accountId).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('kapanan taksit HER SATIŞIN 1. taksitidir (2. aya geçilmez)', () => {
    // Kuyruk global vade sırasında: üç satışın da 15 Oca taksiti, sonra 15 Şub'lar.
    const queue = buildGlobalDueQueue(threeSales(), '2026-01-10')
    const firstThree = queue.slice(0, 3)
    expect(firstThree.every((r) => r.installmentNo === 1)).toBe(true)
    expect(firstThree.map((r) => r.accountId).sort()).toEqual(['s1', 's2', 's3'])
    // 4. sıra artık şubat: 3.000 girildiğinde oraya para gitmez.
    expect(queue[3].installmentNo).toBe(2)
  })

  it('bir satış gecikmişse "bu ayın taksitleri" o gecikmeyi de kapsar', () => {
    // s1 iki ay gecikmiş (Oca+Şub ödenmemiş), diğerleri güncel; bugün 10 Şubat.
    const list = threeSales()
    const s = summarizeAllAccounts(list, '2026-02-10')
    // Her satış için Oca+Şub = 2.000 → 3 satış × 2.000.
    expect(s.dueNow).toBe(6000)
    const out = allocateAcrossAccounts(list, 6000, '2026-02-10')
    expect(out.map((r) => r.amount)).toEqual([2000, 2000, 2000])
  })
})

/**
 * DAĞITIM SIRASI DETERMİNİSTİK OLMALI.
 *
 * Kuyruk yalnız vade tarihine göre sıralanınca, aynı gün vadeli iki satıştan hangisinin önce
 * kapanacağı API'nin döndürme sırasına kalıyordu: aynı veri, iki farklı dağıtım. Kullanıcı
 * onaydan önce gördüğü önizlemenin bir sonraki açılışta değişmeyeceğine güvenebilmeli.
 */
describe('eşit vadede dağıtım sırası', () => {
  const sameDay = (): CustomerAccount[] => [
    acc({
      id: 'b-account', customerId: 'c1', servicePackageName: 'B satışı',
      installments: [inst({ id: 'b1', no: 1, dueDate: '2026-03-10', amount: 1000 })],
    }),
    acc({
      id: 'a-account', customerId: 'c1', servicePackageName: 'A satışı',
      installments: [inst({ id: 'a1', no: 1, dueDate: '2026-03-10', amount: 1000 })],
    }),
  ]

  it('aynı vadede sıra hesap kimliğine göre sabitlenir (giriş sırası değiştirse de aynı)', () => {
    const forward = buildGlobalDueQueue(sameDay(), '2026-03-15').map((r) => r.accountId)
    const reversed = buildGlobalDueQueue(sameDay().reverse(), '2026-03-15').map((r) => r.accountId)
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(['a-account', 'b-account'])
  })

  it('kısmi tutar hep aynı satışa gider — giriş sırası dağıtımı değiştirmez', () => {
    const forward = allocateAcrossAccounts(sameDay(), 1000, '2026-03-15')
    const reversed = allocateAcrossAccounts(sameDay().reverse(), 1000, '2026-03-15')
    expect(forward).toEqual(reversed)
    expect(forward.map((r) => [r.accountId, r.amount])).toEqual([['a-account', 1000]])
  })
})

/**
 * AYNI GÜNE DÜŞEN VADELER TOPLANIR.
 *
 * Grup özeti yalnız "daha erken" vadeyi kazandırıyordu; aynı gün vadeli ikinci satış hiç
 * sayılmıyor, müşterinin o gün ödemesi gereken tutar eksik görünüyordu.
 */
describe('grup özetinde aynı gün vadeleri', () => {
  it('aynı vadeli iki satışın tutarı toplanır', () => {
    const [g] = groupAccountsByCustomer([
      acc({ id: 's1', customerId: 'c1', nextDueDate: '2026-04-05', nextDueAmount: 500 }),
      acc({ id: 's2', customerId: 'c1', nextDueDate: '2026-04-05', nextDueAmount: 700 }),
    ])
    expect(g.nextDueDate).toBe('2026-04-05')
    expect(g.nextDueAmount).toBe(1200)
  })

  it('daha erken vade kazanır, geç vade toplanmaz', () => {
    const [g] = groupAccountsByCustomer([
      acc({ id: 's1', customerId: 'c1', nextDueDate: '2026-05-01', nextDueAmount: 900 }),
      acc({ id: 's2', customerId: 'c1', nextDueDate: '2026-04-05', nextDueAmount: 700 }),
    ])
    expect(g.nextDueDate).toBe('2026-04-05')
    expect(g.nextDueAmount).toBe(700)
  })
})
