import { describe, it, expect } from 'vitest'
import { groupAccountsByCustomer } from './accountGrouping'
import {
  buildAccountStatement, buildStatementRows, cariCode, turkishAmountInWords, turkishNumberToWords,
} from './accountStatement'
import type { AccountInstallmentItem, CancelledSale, CustomerAccount } from './types'

/**
 * CARİ HESAP EKSTRESİ — belgenin BİR TEK kırılmaz kuralı var: yürüyen bakiye sütunu toplanabilir
 * olmalı ve kapanış bakiyesi sunucunun borç tanımıyla (`Σ total − paid`) BİREBİR tutmalı.
 * Belge basılıp müşteriye veriliyor; sessizce kayan bir kuruş bile itiraz konusudur.
 */

function inst(p: Partial<AccountInstallmentItem> & { dueDate: string; amount: number }): AccountInstallmentItem {
  const paidAmount = p.paidAmount ?? 0
  return {
    id: p.id ?? `i-${p.no ?? 1}`,
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

function account(p: Partial<CustomerAccount> & { id: string; totalAmount: number }): CustomerAccount {
  const payments = p.payments ?? []
  const paidAmount = p.paidAmount ?? payments.reduce((s, x) => s + x.amount, 0)
  return {
    id: p.id,
    customerId: p.customerId ?? 'c1',
    customerName: p.customerName ?? 'Ela Yılmaz',
    customerPhone: p.customerPhone ?? '+90 555 111 22 33',
    servicePackageId: p.servicePackageId ?? null,
    servicePackageName: p.servicePackageName ?? 'Cilt Bakımı 10 Seans',
    name: p.name ?? 'Satış',
    totalAmount: p.totalAmount,
    depositAmount: p.depositAmount ?? 0,
    paidAmount,
    remainingAmount: p.remainingAmount ?? Math.max(0, p.totalAmount - paidAmount),
    creditBalance: p.creditBalance ?? 0,
    isActive: true,
    notes: '',
    installments: p.installments ?? [],
    payments,
    appointmentRevenue: 0,
    completedAppointmentCount: 0,
    createdAtUtc: p.createdAtUtc ?? '2026-06-18T09:00:00Z',
    nextDueDate: p.nextDueDate ?? null,
    nextDueAmount: p.nextDueAmount ?? 0,
    hasOverdue: p.hasOverdue ?? false,
    soldAtUtc: p.soldAtUtc ?? '2026-06-18T09:00:00Z',
    soldByStaffName: '',
    appliedByStaffName: '',
    isHistorical: false,
    cancelledAtUtc: null,
    cancellationReason: '',
    sessionsTotal: 0,
    sessionsUsed: 0,
    sessionsRemaining: 0,
    items: [],
    saleStatus: 'Active',
  }
}

function cancelled(p: Partial<CancelledSale> & { id: string }): CancelledSale {
  return {
    id: p.id,
    originalAccountId: p.originalAccountId ?? `acc-${p.id}`,
    branchId: null,
    customerId: p.customerId ?? 'c1',
    customerName: 'Ela Yılmaz',
    customerPhone: '',
    servicePackageId: null,
    name: p.name ?? 'İptal Paketi',
    totalAmount: p.totalAmount ?? 0,
    depositAmount: 0,
    collectedAmount: p.collectedAmount ?? 0,
    refundedAmount: p.refundedAmount ?? 0,
    retainedAmount: p.retainedAmount ?? (p.collectedAmount ?? 0) - (p.refundedAmount ?? 0),
    soldAtUtc: p.soldAtUtc ?? '2026-05-01T09:00:00Z',
    soldByStaffName: '',
    isHistorical: false,
    sessionsTotal: 0,
    sessionsUsed: 0,
    adisyonId: null,
    packageSessionIds: [],
    allSessionIds: [],
    payments: p.payments ?? [],
    refunds: p.refunds ?? [],
    cancelledAtUtc: p.cancelledAtUtc ?? '2026-06-01T09:00:00Z',
    cancellationReason: '',
  }
}

const TODAY = '2026-08-11'

/** Örnek ekstredeki senaryo: 580.000 borç (150.000 peşinat + 10×43.000), 150.000 tahsilat. */
function referenceGroup() {
  // 01.07.2026'dan başlayan 10 aylık plan (7..12/2026 + 1..4/2027).
  const insts = Array.from({ length: 10 }, (_, i) => {
    const month = 7 + i
    const year = month > 12 ? 2027 : 2026
    const m = month > 12 ? month - 12 : month
    return inst({ no: i + 1, dueDate: `${year}-${String(m).padStart(2, '0')}-01`, amount: 43000 })
  })
  return groupAccountsByCustomer([
    account({
      id: 'a1',
      servicePackageName: '9-D',
      totalAmount: 580000,
      depositAmount: 150000,
      installments: insts,
      payments: [{ id: 'p1', amount: 150000, method: 'cash', reference: 'MKB-202606-00001', occurredAtUtc: '2026-06-18T12:00:00Z' }],
    }),
  ])[0]
}

describe('buildStatementRows', () => {
  it('satışın TAMAMINI satış gününde tek borç satırı yazar, tahsilatı alacak', () => {
    const rows = buildStatementRows(referenceGroup(), [], TODAY)

    expect(rows).toHaveLength(2) // 1 satış + 1 tahsilat — taksitler belgeye DÜŞMEZ
    expect(rows[0]).toMatchObject({ date: '2026-06-18', type: 'Satış', debit: 580000, credit: 0 })
    // Aynı gün: önce borç, sonra tahsilat (bakiye önce eksiye düşmesin).
    expect(rows[1]).toMatchObject({ date: '2026-06-18', type: 'Tahsilat', credit: 150000, debit: 0 })
  })

  it('vadesi gelmemiş taksiti belgeye YAZMAZ — borcun toplamı yine satış tutarı', () => {
    // Taksit ayrıca borçlandırılsaydı aynı tutar iki kez sayılırdı. Müşteri henüz ödemediği
    // bir taksit için ikinci kez borçlanamaz; taksit zamanı belgeye düşen şey TAHSİLATTIR.
    const rows = buildStatementRows(referenceGroup(), [], TODAY)
    expect(rows.some((r) => r.label.includes('Taksit'))).toBe(false)
    expect(rows.reduce((s, r) => s + r.debit, 0)).toBe(580000)
  })

  it('peşin satışta da tek "Satış" borç satırı üretir', () => {
    const group = groupAccountsByCustomer([
      account({ id: 'a1', totalAmount: 4000, servicePackageName: 'Lazer 5 Seans' }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'Satış', debit: 4000, description: 'Lazer 5 Seans' })
  })

  it('iptal edilmiş taksit borcu EKSİLTMEZ (borç plandan değil satış tutarından okunur)', () => {
    // Sunucu borcu `Total − Paid` sayar. Borç artık plan toplamından türetilmediği için
    // iptal edilmiş taksit belgeyi hiç etkilemez — "plan dışı bakiye" düzeltmesine gerek kalmadı.
    const group = groupAccountsByCustomer([
      account({
        id: 'a1',
        totalAmount: 3000,
        installments: [
          inst({ no: 1, dueDate: '2026-07-01', amount: 1000 }),
          inst({ no: 2, dueDate: '2026-08-01', amount: 1000, status: 'Cancelled' }),
          inst({ no: 3, dueDate: '2026-09-01', amount: 1000 }),
        ],
      }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows.reduce((s, r) => s + r.debit, 0)).toBe(3000)
  })

  it('işlem türü ile açıklamayı TEK sütunda birleştirir', () => {
    const rows = buildStatementRows(referenceGroup(), [], TODAY)
    expect(rows[0].label).toBe('Satış (9-D)')
    // Tahsilatta önce ödeme yöntemi yazar (kullanıcı isteği: "Tahsilat (Nakit)").
    expect(rows[1].label).toBe('Tahsilat (Nakit · 9-D · Belge: MKB-202606-00001)')
  })

  it('paket bağı olan satış "Paket Satışı" yazar, olmayan yalın "Satış" kalır', () => {
    const [pkg] = groupAccountsByCustomer([
      account({ id: 'a1', totalAmount: 30000, servicePackageId: 'pkg-1', servicePackageName: 'Ela Cilt Bakım Paketi' }),
    ])
    expect(buildStatementRows(pkg, [], TODAY)[0].label).toBe('Paket Satışı (Ela Cilt Bakım Paketi)')

    // Hizmet ↔ ürün ayrımı cari DTO'sunda YOK — uydurma tür etiketi yazılmaz.
    const [plain] = groupAccountsByCustomer([
      account({ id: 'a2', totalAmount: 500, servicePackageName: 'Ağda' }),
    ])
    expect(buildStatementRows(plain, [], TODAY)[0].label).toBe('Satış (Ağda)')
  })

  it('"Paket satışı:" ön ekini kırpar — satışta da tahsilatta da tekrar etmez', () => {
    // Adisyondan açılan carilerde `servicePackageName` = "Paket satışı: X + Y" (canlı veri).
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 3600, servicePackageId: 'pkg-1',
        servicePackageName: 'Paket satışı: Bölgesel İncelme + Cilt Bakımı',
        payments: [{ id: 'p1', amount: 400, method: 'cash', reference: '', occurredAtUtc: '2026-07-05T09:00:00Z' }],
      }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    expect(rows[0].label).toBe('Paket Satışı (Bölgesel İncelme + Cilt Bakımı)')
    expect(rows[1].label).toBe('Tahsilat (Nakit · Bölgesel İncelme + Cilt Bakımı)')
  })

  it('adı gerçekten "Satış" ile başlayan paketi KIRPMAZ', () => {
    const group = groupAccountsByCustomer([
      account({ id: 'a1', totalAmount: 1000, servicePackageName: 'Satış Danışmanlığı' }),
    ])[0]
    expect(buildStatementRows(group, [], TODAY)[0].label).toBe('Satış (Satış Danışmanlığı)')
  })

  it('yöntemi kaydedilmemiş tahsilatta uydurma "Nakit" yazmaz', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 1000, servicePackageName: 'X',
        payments: [{ id: 'p1', amount: 400, method: '', reference: '', occurredAtUtc: '2026-07-01T09:00:00Z' }],
      }),
    ])[0]
    expect(buildStatementRows(group, [], TODAY)[1].label).toBe('Tahsilat (Yöntem Kaydedilmemiş · X)')
  })

  it('satırları kronolojik ARTAN dizer: en yeni hareket EN ALTTA', () => {
    const group = groupAccountsByCustomer([
      account({ id: 'a1', totalAmount: 1000, soldAtUtc: '2026-06-01T09:00:00Z' }),
      account({ id: 'a2', totalAmount: 2000, soldAtUtc: '2026-08-01T09:00:00Z' }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    expect(rows.map((r) => r.date)).toEqual(['2026-06-01', '2026-08-01'])
  })

  it('tarihi olmayan satırı EN ALTA koyar (eskiden belgenin tepesine düşüyordu)', () => {
    const group = groupAccountsByCustomer([
      account({ id: 'a1', totalAmount: 1000, soldAtUtc: '2026-06-01T09:00:00Z' }),
      account({ id: 'a2', totalAmount: 2000, soldAtUtc: '', createdAtUtc: '' }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    expect(rows[rows.length - 1].date).toBe('')
  })

  it('kullanıcı senaryosu: 30.000 paket satışı → 5.000 tahsilat → bakiye 25.000', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 30000,
        servicePackageId: 'pkg-1', servicePackageName: 'Ela Cilt Bakım Paketi',
        soldAtUtc: '2026-08-12T09:00:00Z',
        payments: [{ id: 'p1', amount: 5000, method: 'cash', reference: '', occurredAtUtc: '2026-09-12T09:00:00Z' }],
      }),
    ])[0]
    const doc = buildAccountStatement({ group, todayIso: '2026-09-20' })

    expect(doc.rows).toHaveLength(2)
    expect(doc.rows[0]).toMatchObject({
      date: '2026-08-12', label: 'Paket Satışı (Ela Cilt Bakım Paketi)',
      debit: 30000, credit: 0, balance: 30000,
    })
    expect(doc.rows[1]).toMatchObject({
      date: '2026-09-12', label: 'Tahsilat (Nakit · Ela Cilt Bakım Paketi)',
      debit: 0, credit: 5000, balance: 25000,
    })
    expect(doc.closing).toBe(25000)
  })

  it('canlı carideki iade (DTO alanı yok) ödeme toplamı ile paidAmount farkından yazılır', () => {
    // İptali geri alınan satışta korunan iade cariye işlenir: Σödeme > paidAmount.
    const group = groupAccountsByCustomer([
      account({
        id: 'a1',
        totalAmount: 5000,
        paidAmount: 1200, // 2.000 tahsil edildi, 800 iade edildi
        payments: [{ id: 'p1', amount: 2000, method: 'card', reference: '', occurredAtUtc: '2026-07-05T10:00:00Z' }],
      }),
    ])[0]
    const rows = buildStatementRows(group, [], TODAY)
    const refund = rows.find((r) => r.type === 'İade')
    expect(refund).toBeTruthy()
    expect(refund!.debit).toBe(800)
    expect(refund!.date).toBe('2026-07-05')
  })
})

describe('buildAccountStatement — mutabakat', () => {
  it('kapanış bakiyesi = Σ(totalAmount − paidAmount)', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 580000, depositAmount: 150000,
        installments: [inst({ no: 1, dueDate: '2026-07-01', amount: 430000 })],
        payments: [{ id: 'p1', amount: 150000, method: 'cash', reference: '', occurredAtUtc: '2026-06-18T12:00:00Z' }],
      }),
      account({
        id: 'a2', totalAmount: 3000, soldAtUtc: '2026-07-20T09:00:00Z',
        payments: [{ id: 'p2', amount: 1000, method: 'card', reference: '', occurredAtUtc: '2026-07-20T09:10:00Z' }],
      }),
    ])[0]
    const doc = buildAccountStatement({ group, todayIso: TODAY })
    const expected = group.accounts.reduce((s, a) => s + a.totalAmount - a.paidAmount, 0)

    expect(doc.closing).toBe(expected)
    expect(doc.netAll).toBe(expected)
    expect(doc.totalDebit - doc.totalCredit).toBe(expected)
    // Yürüyen bakiye satır satır toplanabilir olmalı.
    let running = 0
    for (const row of doc.rows) {
      running = Math.round((running + row.debit - row.credit) * 100) / 100
      expect(row.balance).toBe(running)
    }
  })

  it('iptal edilen satış bakiyeye ETKİ ETMEZ (tahsilat − iade − kurumda kalan = 0)', () => {
    const group = groupAccountsByCustomer([account({ id: 'a1', totalAmount: 1000 })])[0]
    const doc = buildAccountStatement({
      group,
      cancelledSales: [cancelled({
        id: 'x1', totalAmount: 5000,
        payments: [{ id: 'cp1', amount: 2000, method: 'cash', reference: '', occurredAtUtc: '2026-05-02T09:00:00Z' }],
        refunds: [{ id: 'cr1', amount: 500, method: 'cash', reference: '', refundedAtUtc: '2026-06-01T09:00:00Z', reason: '' }],
      })],
      todayIso: TODAY,
    })

    expect(doc.netAll).toBe(1000) // yalnız canlı satışın borcu
    const cancelRow = doc.rows.find((r) => r.type === 'Satış (İptal)')
    expect(cancelRow?.debit).toBe(1500) // 2.000 tahsil − 500 iade
    expect(doc.rows.some((r) => r.type === 'İade' && r.debit === 500)).toBe(true)
  })

  it('eski arşiv kaydında (satır kopyası yok) skalerlerden satır üretir ve yine sıfıra kapanır', () => {
    const group = groupAccountsByCustomer([account({ id: 'a1', totalAmount: 0 })])[0]
    const doc = buildAccountStatement({
      group,
      cancelledSales: [cancelled({ id: 'x1', collectedAmount: 900, refundedAmount: 400 })],
      todayIso: TODAY,
    })
    expect(doc.netAll).toBe(0)
    expect(doc.totalCredit).toBe(900)
    expect(doc.totalDebit).toBe(900) // 400 iade + 500 kurumda kalan
  })

  it('tarih süzgecinde önceki hareketler Devir satırında toplanır', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 3000, depositAmount: 1000,
        installments: [
          inst({ no: 1, dueDate: '2026-07-01', amount: 1000 }),
          inst({ no: 2, dueDate: '2026-08-01', amount: 1000 }),
        ],
        payments: [{ id: 'p1', amount: 1000, method: 'cash', reference: '', occurredAtUtc: '2026-06-18T12:00:00Z' }],
      }),
    ])[0]

    const doc = buildAccountStatement({ group, todayIso: TODAY, from: '2026-07-15' })
    // Satış (3.000) ve tahsilat (1.000) ikisi de 18.06 — tamamı devre girer.
    expect(doc.opening).toBe(2000)
    expect(doc.rows[0]).toMatchObject({ type: 'Devir', debit: 2000, balance: 2000, date: '2026-07-15' })
    expect(doc.closing).toBe(2000)
    expect(doc.netAll).toBe(2000) // süzgeç netAll'ı değiştirmez
  })

  it('dönem sonu süzgeci sonraki hareketleri çıkarır ama netAll korunur', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 2000, soldAtUtc: '2026-06-18T09:00:00Z',
        payments: [{ id: 'p1', amount: 500, method: 'cash', reference: '', occurredAtUtc: '2026-12-01T09:00:00Z' }],
      }),
    ])[0]
    const doc = buildAccountStatement({ group, todayIso: TODAY, to: '2026-08-31' })
    expect(doc.rows).toHaveLength(1) // yalnız satış; aralık dışı tahsilat belgeye girmez
    expect(doc.closing).toBe(2000)
    expect(doc.netAll).toBe(1500)
  })

  it('fazla ödemede belge NET yazar, KPI ile farkı raporlar', () => {
    const group = groupAccountsByCustomer([
      account({
        id: 'a1', totalAmount: 1000, paidAmount: 1500, remainingAmount: 0,
        payments: [{ id: 'p1', amount: 1500, method: 'cash', reference: '', occurredAtUtc: '2026-07-01T09:00:00Z' }],
      }),
      account({ id: 'a2', totalAmount: 2000, soldAtUtc: '2026-07-02T09:00:00Z' }),
    ])[0]
    const doc = buildAccountStatement({ group, todayIso: TODAY })
    expect(doc.netAll).toBe(1500) // 3.000 borç − 1.500 tahsilat
    expect(group.remainingAmount).toBe(2000) // cari başına sıfırlanmış KPI
    expect(doc.clampDifference).toBe(500)
  })

  it('hareketsiz müşteride boş belge üretir', () => {
    const group = groupAccountsByCustomer([account({ id: 'a1', totalAmount: 0 })])[0]
    const doc = buildAccountStatement({ group, todayIso: TODAY })
    expect(doc.rows).toHaveLength(0)
    expect(doc.closing).toBe(0)
    expect(doc.firstDate).toBeNull()
  })
})

describe('turkishNumberToWords', () => {
  const cases: [number, string][] = [
    [0, 'Sıfır'],
    [1, 'Bir'],
    [11, 'OnBir'],
    [100, 'Yüz'],
    [101, 'YüzBir'],
    [200, 'İkiYüz'],
    [1000, 'Bin'],
    [1001, 'BinBir'],
    [2000, 'İkiBin'],
    [11000, 'OnBirBin'],
    [430000, 'DörtYüzOtuzBin'],
    [580000, 'BeşYüzSeksenBin'],
    [1000000, 'BirMilyon'],
    [1001000, 'BirMilyonBin'],
    [1234567, 'BirMilyonİkiYüzOtuzDörtBinBeşYüzAltmışYedi'],
  ]
  for (const [value, expected] of cases) {
    it(`${value} → ${expected}`, () => expect(turkishNumberToWords(value)).toBe(expected))
  }
})

describe('turkishAmountInWords', () => {
  it('kuruşsuz tutarı TL ile yazar', () => {
    expect(turkishAmountInWords(430000)).toBe('DörtYüzOtuzBin TL')
  })
  it('kuruşu ayrı yazar', () => {
    expect(turkishAmountInWords(12.45)).toBe('Onİki TL KırkBeş Kr')
  })
  it('negatif bakiyeyi (müşteri alacaklı) işaretler', () => {
    expect(turkishAmountInWords(-250)).toBe('Eksi İkiYüzElli TL')
  })
})

describe('cariCode', () => {
  it('aynı müşteri her belgede aynı kodu alır', () => {
    const id = '3f2a1b9c-4d5e-6f70-8192-a3b4c5d6e7f8'
    expect(cariCode(id)).toBe(cariCode(id))
    expect(cariCode(id)).toBe('CR-3F2A1B')
  })
  it('kimliksiz kayıtta çökmez', () => {
    expect(cariCode('')).toBe('CR-000000')
  })
})
