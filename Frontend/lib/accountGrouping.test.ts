import { describe, it, expect } from 'vitest'
import { buildMonthlySchedule, groupAccountsByCustomer } from './accountGrouping'
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

describe('buildMonthlySchedule', () => {
  it('aynı ayda birden çok satışın taksitini TEK hücrede toplar', () => {
    const [g] = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', installments: [inst({ dueDate: '2026-08-10', amount: 400 })] }),
      acc({ id: 'a2', customerId: 'c1', installments: [inst({ dueDate: '2026-08-25', amount: 600 })] }),
    ])
    const cells = buildMonthlySchedule(g, '2026-08-15')
    expect(cells).toHaveLength(1)
    expect(cells[0].key).toBe('2026-08')
    expect(cells[0].due).toBe(1000)
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
    const byKey = Object.fromEntries(buildMonthlySchedule(g, '2026-08-15').map((c) => [c.key, c]))
    expect(byKey['2026-06'].status).toBe('paid')
    // Gecikme, kısmi ödemeye BASKIN: para hâlâ alınmadı ve vadesi geçti.
    expect(byKey['2026-07'].status).toBe('overdue')
    expect(byKey['2026-09'].status).toBe('partial')
    expect(byKey['2026-10'].status).toBe('upcoming')
  })

  it('takvim SÜREKLİ: taksitsiz aylar boş sütun olarak durur', () => {
    const [g] = groupAccountsByCustomer([
      acc({
        id: 'a1', customerId: 'c1',
        installments: [inst({ dueDate: '2026-11-10', amount: 500 }), inst({ dueDate: '2027-02-10', amount: 500 })],
      }),
    ])
    const cells = buildMonthlySchedule(g, '2026-08-15')
    // Kas · Ara · Oca · Şub — aradaki iki ay atlanmaz, yoksa ödeme ritmi okunmaz.
    expect(cells.map((c) => c.key)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(cells[1].status).toBe('none')
    expect(cells[3].year).toBe(2027)
  })

  it('vadesi geçmiş ay, taksit "overdue" işaretlenmemiş olsa da kırmızıdır', () => {
    // Sunucu gecikme bayrağını bir sonraki vadeye göre koyar (aylık tolerans); takvimde ise
    // kullanıcı "geçen ayın parası geldi mi" diye bakar — geçmiş ay + kalan = kırmızı.
    const [g] = groupAccountsByCustomer([
      acc({ id: 'a1', customerId: 'c1', installments: [inst({ dueDate: '2026-07-10', amount: 500 })] }),
    ])
    expect(buildMonthlySchedule(g, '2026-08-15')[0].status).toBe('overdue')
  })

  it('taksiti olmayan müşteride takvim boştur (peşin satış)', () => {
    const [g] = groupAccountsByCustomer([acc({ id: 'a1', customerId: 'c1' })])
    expect(buildMonthlySchedule(g, '2026-08-15')).toEqual([])
  })
})
