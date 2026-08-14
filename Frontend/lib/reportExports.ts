/**
 * Raporlar sayfasının Excel / PDF çıktı üreticileri.
 *
 * Her sekme için ayrı sheet + PDF bölümü seti üretilir; seçili dönem ve (varsa) karşılaştırma
 * dönemi başlıklara yazılır — böylece dosyaya bakan kişi hangi aralığın raporu olduğunu bilir.
 */

import type { ExcelSheetSpec } from '@/lib/excel'
import type { PdfSection, PdfStatBlock } from '@/lib/reportPdf'
import type {
  BranchReport,
  CatalogItemReport,
  CatalogReport,
  CompareReport,
  CustomerReport,
  InventoryReport,
  ReportSummary,
  StaffReport,
} from '@/lib/reportTypes'

export type ReportTabKey =
  | 'overview'
  | 'compare'
  | 'packages'
  | 'services'
  | 'staff'
  | 'branches'
  | 'customers'
  | 'inventory'
  | 'giftcards'

export interface ExportContext {
  tab: ReportTabKey
  rangeLabel: string
  compareLabel?: string
  summary: ReportSummary | null
  compareReport: CompareReport | null
  catalog: CatalogReport | null
  staff: StaffReport | null
  branches: BranchReport | null
  customers: CustomerReport | null
  inventory: InventoryReport | null
}

const num = (v: number): number => Math.round(v * 100) / 100

/** Excel/PDF satırlarını gevşek tipli tutup accessor'larda daraltıyoruz (jenerik tablo API'si). */
type Row = Record<string, unknown>

const sellerText = (item: CatalogItemReport): string =>
  item.sellers.map((s) => `${s.staffName} (${s.soldCount})`).join(', ') || '—'

const performerText = (item: CatalogItemReport): string =>
  item.performers.map((p) => `${p.staffName} (${p.sessionCount})`).join(', ') || '—'

// ===========================================================================
// Excel
// ===========================================================================

export function buildExcelSheets(ctx: ExportContext): ExcelSheetSpec<unknown>[] {
  const period = ctx.compareLabel ? `${ctx.rangeLabel} · kıyas: ${ctx.compareLabel}` : ctx.rangeLabel
  const sheets: ExcelSheetSpec<unknown>[] = []

  if (ctx.tab === 'overview' && ctx.summary) {
    sheets.push({
      name: 'Özet',
      subtitle: period,
      rows: ctx.summary.metrics as unknown as Row[],
      columns: [
        { key: 'label', header: 'Metrik', width: 26, type: 'text', accessor: (r) => (r as Row).label as string },
        { key: 'value', header: 'Dönem', width: 18, type: 'number', accessor: (r) => num((r as Row).value as number) },
        { key: 'previous', header: 'Kıyas Dönem', width: 18, type: 'number', accessor: (r) => num((r as Row).previousValue as number) },
        { key: 'unit', header: 'Birim', width: 12, type: 'text', accessor: (r) => unitLabel((r as Row).unit as string) },
      ],
    })

    sheets.push({
      name: 'Zaman Serisi',
      subtitle: period,
      rows: ctx.summary.series as unknown as Row[],
      columns: [
        { key: 'label', header: 'Dönem', width: 16, type: 'text', accessor: (r) => (r as Row).label as string },
        { key: 'income', header: 'Gelir', width: 16, type: 'currency', accessor: (r) => num((r as Row).income as number) },
        { key: 'expense', header: 'Gider', width: 16, type: 'currency', accessor: (r) => num((r as Row).expense as number) },
        { key: 'sales', header: 'Satış', width: 16, type: 'currency', accessor: (r) => num((r as Row).sales as number) },
        { key: 'appointments', header: 'Randevu', width: 12, type: 'number', accessor: (r) => (r as Row).appointments as number },
        { key: 'completed', header: 'Tamamlanan', width: 12, type: 'number', accessor: (r) => (r as Row).completedAppointments as number },
        { key: 'newCustomers', header: 'Yeni Müşteri', width: 14, type: 'number', accessor: (r) => (r as Row).newCustomers as number },
      ],
      totals: {
        label: 'TOPLAM',
        income: num(ctx.summary.series.reduce((s, p) => s + p.income, 0)),
        expense: num(ctx.summary.series.reduce((s, p) => s + p.expense, 0)),
        sales: num(ctx.summary.series.reduce((s, p) => s + p.sales, 0)),
      },
    })

    sheets.push(sliceSheet('Ödeme Yöntemi', period, ctx.summary.paymentMethods))
    sheets.push(sliceSheet('Gider Kalemleri', period, ctx.summary.expenseCategories))
    sheets.push(sliceSheet('Ciro Kaynağı', period, ctx.summary.revenueSources))
  }

  if (ctx.tab === 'compare' && ctx.compareReport) {
    const periods = ctx.compareReport.periods
    const baseline = periods[0]

    // Satır = metrik, kolon = dönem (+ temele göre fark). Pivot çekmeye gerek kalmadan okunur.
    if (baseline) {
      const metricRows = baseline.metrics.map((m, i) => {
        const row: Row = { metric: m.label, unit: unitLabel(m.unit) }
        periods.forEach((p, pi) => {
          const value = p.metrics[i]?.value ?? 0
          row[`p${pi}`] = num(value)
          if (pi > 0) {
            const base = periods[0].metrics[i]?.value ?? 0
            row[`d${pi}`] = base === 0 ? 0 : num(((value - base) / Math.abs(base)) * 100)
          }
        })
        return row
      })

      sheets.push({
        name: 'Dönem Karşılaştırması',
        subtitle: periods.map((p) => p.label).join('  ↔  '),
        rows: metricRows,
        columns: [
          { key: 'metric', header: 'Metrik', width: 26, type: 'text', accessor: (r) => (r as Row).metric as string },
          { key: 'unit', header: 'Birim', width: 10, type: 'text', accessor: (r) => (r as Row).unit as string },
          ...periods.flatMap((p, pi) => {
            const valueColumn = {
              key: `p${pi}`,
              header: p.label + (pi === 0 ? ' (temel)' : ''),
              width: 18,
              type: 'number' as const,
              accessor: (r: unknown) => (r as Row)[`p${pi}`] as number,
            }
            if (pi === 0) return [valueColumn]
            return [
              valueColumn,
              {
                key: `d${pi}`,
                header: `${p.label} fark %`,
                width: 15,
                type: 'number' as const,
                accessor: (r: unknown) => (r as Row)[`d${pi}`] as number,
              },
            ]
          }),
        ],
      })
    }

    // Her dönemin zaman serisi — ortak eksende alt alta.
    const axis = ctx.compareReport.axisLabels
    const seriesRows = axis.map((label, i) => {
      const row: Row = { bucket: label }
      periods.forEach((p, pi) => {
        row[`i${pi}`] = num(p.series[i]?.income ?? 0)
      })
      return row
    })
    sheets.push({
      name: 'Dönem Serileri',
      subtitle: periods.map((p) => p.label).join('  ↔  '),
      rows: seriesRows,
      columns: [
        { key: 'bucket', header: 'Kova', width: 16, type: 'text', accessor: (r) => (r as Row).bucket as string },
        ...periods.flatMap((p, pi) => [
          {
            key: `i${pi}`,
            header: `${p.label} gelir`,
            width: 17,
            type: 'currency' as const,
            accessor: (r: unknown) => (r as Row)[`i${pi}`] as number,
          },
        ]),
      ],
    })

    // Dönem başına en çok uygulanan hizmet / en çok iş bitiren personel — düz liste.
    const topRows = periods.flatMap((p) => [
      ...p.topServices.map((s) => ({ period: p.label, kind: 'Hizmet', name: s.label, count: s.count, amount: s.amount })),
      ...p.topStaff.map((s) => ({ period: p.label, kind: 'Personel', name: s.label, count: s.count, amount: s.amount })),
    ])
    sheets.push({
      name: 'Dönem Öne Çıkanlar',
      subtitle: periods.map((p) => p.label).join('  ↔  '),
      rows: topRows as unknown as Row[],
      columns: [
        { key: 'period', header: 'Dönem', width: 18, type: 'text', accessor: (r) => (r as Row).period as string },
        { key: 'kind', header: 'Tür', width: 12, type: 'text', accessor: (r) => (r as Row).kind as string },
        { key: 'name', header: 'Ad', width: 30, type: 'text', accessor: (r) => (r as Row).name as string },
        { key: 'count', header: 'Adet', width: 12, type: 'number', accessor: (r) => (r as Row).count as number },
        { key: 'amount', header: 'Ciro', width: 16, type: 'currency', accessor: (r) => num((r as Row).amount as number) },
      ],
    })
  }

  if ((ctx.tab === 'packages' || ctx.tab === 'services') && ctx.catalog) {
    const isPackage = ctx.tab === 'packages'
    const items = isPackage ? ctx.catalog.packages : ctx.catalog.services
    const label = isPackage ? 'Paket' : 'Hizmet'

    sheets.push({
      name: `${label} Detayı`,
      subtitle: period,
      rows: items as unknown as Row[],
      columns: [
        { key: 'name', header: label, width: 30, type: 'text', accessor: (r) => (r as Row).name as string },
        { key: 'category', header: 'Kategori', width: 20, type: 'text', accessor: (r) => (r as Row).category as string },
        { key: 'sold', header: 'Satış Adedi', width: 12, type: 'number', accessor: (r) => (r as Row).soldCount as number },
        { key: 'customers', header: 'Müşteri', width: 12, type: 'number', accessor: (r) => (r as Row).customerCount as number },
        { key: 'gross', header: 'Satış Tutarı', width: 16, type: 'currency', accessor: (r) => num((r as Row).grossAmount as number) },
        { key: 'collected', header: 'Tahsilat', width: 16, type: 'currency', accessor: (r) => num((r as Row).collectedAmount as number) },
        { key: 'remaining', header: 'Kalan', width: 16, type: 'currency', accessor: (r) => num((r as Row).remainingAmount as number) },
        { key: 'sessionsTotal', header: 'Toplam Seans', width: 13, type: 'number', accessor: (r) => (r as Row).sessionsTotal as number },
        { key: 'sessionsUsed', header: 'Kullanılan', width: 12, type: 'number', accessor: (r) => (r as Row).sessionsUsed as number },
        { key: 'sessionsRemaining', header: 'Kalan Seans', width: 13, type: 'number', accessor: (r) => (r as Row).sessionsRemaining as number },
        { key: 'inPeriod', header: 'Dönemde Yapılan', width: 15, type: 'number', accessor: (r) => (r as Row).sessionsInPeriod as number },
        { key: 'sessionRevenue', header: 'Uygulama Cirosu', width: 17, type: 'currency', accessor: (r) => num((r as Row).sessionRevenue as number) },
        { key: 'commissionCost', header: 'Prim Maliyeti', width: 16, type: 'currency', accessor: (r) => num((r as Row).commissionCost as number) },
        { key: 'netRevenue', header: 'Prim Sonrası Net', width: 17, type: 'currency', accessor: (r) => num((r as Row).netRevenue as number) },
        { key: 'cancelled', header: 'İptal', width: 10, type: 'number', accessor: (r) => (r as Row).cancelledCount as number },
        { key: 'sellers', header: 'Kim Sattı', width: 34, type: 'text', accessor: (r) => sellerText(r as unknown as CatalogItemReport) },
        { key: 'performers', header: 'Kim Uyguladı', width: 34, type: 'text', accessor: (r) => performerText(r as unknown as CatalogItemReport) },
      ],
      totals: {
        name: 'TOPLAM',
        sold: items.reduce((s, r) => s + r.soldCount, 0),
        gross: num(items.reduce((s, r) => s + r.grossAmount, 0)),
        collected: num(items.reduce((s, r) => s + r.collectedAmount, 0)),
        remaining: num(items.reduce((s, r) => s + r.remainingAmount, 0)),
        inPeriod: items.reduce((s, r) => s + r.sessionsInPeriod, 0),
        sessionRevenue: num(items.reduce((s, r) => s + r.sessionRevenue, 0)),
        commissionCost: num(items.reduce((s, r) => s + r.commissionCost, 0)),
        netRevenue: num(items.reduce((s, r) => s + r.netRevenue, 0)),
      },
    })

    // Personel bazlı düz liste — pivot çekmek isteyenler için satır satır.
    const sellerRows = items.flatMap((item) =>
      item.sellers.map((s) => ({ item: item.name, category: item.category, staff: s.staffName, count: s.soldCount, customers: s.customerCount, amount: s.amount })),
    )
    sheets.push({
      name: 'Kim Sattı',
      subtitle: period,
      rows: sellerRows as unknown as Row[],
      columns: [
        { key: 'staff', header: 'Personel', width: 26, type: 'text', accessor: (r) => (r as Row).staff as string },
        { key: 'item', header: label, width: 30, type: 'text', accessor: (r) => (r as Row).item as string },
        { key: 'category', header: 'Kategori', width: 20, type: 'text', accessor: (r) => (r as Row).category as string },
        { key: 'count', header: 'Satış', width: 12, type: 'number', accessor: (r) => (r as Row).count as number },
        { key: 'customers', header: 'Müşteri', width: 12, type: 'number', accessor: (r) => (r as Row).customers as number },
        { key: 'amount', header: 'Tutar', width: 16, type: 'currency', accessor: (r) => num((r as Row).amount as number) },
      ],
      totals: { staff: 'TOPLAM', count: sellerRows.reduce((s, r) => s + r.count, 0), amount: num(sellerRows.reduce((s, r) => s + r.amount, 0)) },
    })

    const performerRows = items.flatMap((item) =>
      item.performers.map((p) => ({ item: item.name, category: item.category, staff: p.staffName, count: p.sessionCount, customers: p.customerCount, amount: p.revenue })),
    )
    sheets.push({
      name: 'Kim Uyguladı',
      subtitle: period,
      rows: performerRows as unknown as Row[],
      columns: [
        { key: 'staff', header: 'Personel', width: 26, type: 'text', accessor: (r) => (r as Row).staff as string },
        { key: 'item', header: label, width: 30, type: 'text', accessor: (r) => (r as Row).item as string },
        { key: 'category', header: 'Kategori', width: 20, type: 'text', accessor: (r) => (r as Row).category as string },
        { key: 'count', header: 'Seans', width: 12, type: 'number', accessor: (r) => (r as Row).count as number },
        { key: 'customers', header: 'Müşteri', width: 12, type: 'number', accessor: (r) => (r as Row).customers as number },
        { key: 'amount', header: 'Ciro', width: 16, type: 'currency', accessor: (r) => num((r as Row).amount as number) },
      ],
      totals: { staff: 'TOPLAM', count: performerRows.reduce((s, r) => s + r.count, 0), amount: num(performerRows.reduce((s, r) => s + r.amount, 0)) },
    })
  }

  if (ctx.tab === 'staff' && ctx.staff) {
    sheets.push({
      name: 'Personel Performansı',
      subtitle: period,
      rows: ctx.staff.rows as unknown as Row[],
      columns: [
        { key: 'name', header: 'Personel', width: 26, type: 'text', accessor: (r) => (r as Row).staffName as string },
        { key: 'title', header: 'Ünvan', width: 20, type: 'text', accessor: (r) => (r as Row).title as string },
        { key: 'branch', header: 'Şube', width: 18, type: 'text', accessor: (r) => ((r as Row).branchName as string) || '—' },
        { key: 'appointments', header: 'Randevu', width: 12, type: 'number', accessor: (r) => (r as Row).appointmentCount as number },
        { key: 'completed', header: 'Tamamlanan', width: 13, type: 'number', accessor: (r) => (r as Row).completedCount as number },
        { key: 'cancelled', header: 'İptal', width: 10, type: 'number', accessor: (r) => (r as Row).cancelledCount as number },
        { key: 'noShow', header: 'Gelmedi', width: 10, type: 'number', accessor: (r) => (r as Row).noShowCount as number },
        { key: 'customers', header: 'Müşteri', width: 12, type: 'number', accessor: (r) => (r as Row).customerCount as number },
        { key: 'worked', header: 'Çalışma (dk)', width: 14, type: 'number', accessor: (r) => (r as Row).workedMinutes as number },
        { key: 'serviceRevenue', header: 'Uygulama Cirosu', width: 18, type: 'currency', accessor: (r) => num((r as Row).serviceRevenue as number) },
        { key: 'prevService', header: 'Kıyas Uygulama', width: 18, type: 'currency', accessor: (r) => num((r as Row).previousServiceRevenue as number) },
        { key: 'salesAmount', header: 'Satış Cirosu', width: 18, type: 'currency', accessor: (r) => num((r as Row).salesAmount as number) },
        { key: 'commission', header: 'Komisyon', width: 16, type: 'currency', accessor: (r) => num((r as Row).commissionEarned as number) },
        { key: 'rating', header: 'Puan', width: 10, type: 'number', accessor: (r) => (r as Row).averageRating as number },
      ],
      totals: {
        name: 'TOPLAM',
        appointments: ctx.staff.totalAppointments,
        completed: ctx.staff.totalCompleted,
        worked: ctx.staff.totalWorkedMinutes,
        serviceRevenue: num(ctx.staff.totalServiceRevenue),
        salesAmount: num(ctx.staff.totalSalesAmount),
        commission: num(ctx.staff.totalCommission),
      },
    })
  }

  if (ctx.tab === 'branches' && ctx.branches) {
    sheets.push({
      name: 'Şube Karşılaştırma',
      subtitle: period,
      rows: ctx.branches.rows as unknown as Row[],
      columns: [
        { key: 'branch', header: 'Şube', width: 24, type: 'text', accessor: (r) => (r as Row).branchName as string },
        { key: 'city', header: 'Şehir', width: 16, type: 'text', accessor: (r) => (r as Row).city as string },
        { key: 'income', header: 'Gelir', width: 16, type: 'currency', accessor: (r) => num((r as Row).income as number) },
        { key: 'prevIncome', header: 'Kıyas Gelir', width: 16, type: 'currency', accessor: (r) => num((r as Row).previousIncome as number) },
        { key: 'expense', header: 'Gider', width: 16, type: 'currency', accessor: (r) => num((r as Row).expense as number) },
        { key: 'prevExpense', header: 'Kıyas Gider', width: 16, type: 'currency', accessor: (r) => num((r as Row).previousExpense as number) },
        { key: 'sales', header: 'Satış', width: 16, type: 'currency', accessor: (r) => num((r as Row).salesAmount as number) },
        { key: 'receivable', header: 'Açık Alacak', width: 16, type: 'currency', accessor: (r) => num((r as Row).receivable as number) },
        { key: 'appointments', header: 'Randevu', width: 12, type: 'number', accessor: (r) => (r as Row).appointmentCount as number },
        { key: 'completed', header: 'Tamamlanan', width: 13, type: 'number', accessor: (r) => (r as Row).completedCount as number },
        { key: 'customers', header: 'Müşteri', width: 12, type: 'number', accessor: (r) => (r as Row).customerCount as number },
        { key: 'newCustomers', header: 'Yeni Müşteri', width: 14, type: 'number', accessor: (r) => (r as Row).newCustomerCount as number },
        { key: 'staff', header: 'Personel', width: 12, type: 'number', accessor: (r) => (r as Row).staffCount as number },
      ],
      totals: {
        branch: 'TOPLAM',
        income: num(ctx.branches.totalIncome),
        expense: num(ctx.branches.totalExpense),
        prevIncome: num(ctx.branches.previousTotalIncome),
        prevExpense: num(ctx.branches.previousTotalExpense),
      },
    })
  }

  if (ctx.tab === 'customers' && ctx.customers) {
    sheets.push({
      name: 'Müşteri Özeti',
      subtitle: period,
      rows: customerSummaryRows(ctx.customers) as unknown as Row[],
      columns: [
        { key: 'label', header: 'Metrik', width: 28, type: 'text', accessor: (r) => (r as Row).label as string },
        { key: 'value', header: 'Değer', width: 18, type: 'number', accessor: (r) => (r as Row).value as number },
        { key: 'previous', header: 'Kıyas Dönem', width: 18, type: 'number', accessor: (r) => (r as Row).previous as number },
      ],
    })
    sheets.push({
      name: 'En Çok Harcayanlar',
      subtitle: period,
      rows: ctx.customers.topCustomers as unknown as Row[],
      columns: [
        { key: 'name', header: 'Müşteri', width: 26, type: 'text', accessor: (r) => (r as Row).fullName as string },
        { key: 'phone', header: 'Telefon', width: 18, type: 'text', accessor: (r) => (r as Row).phone as string },
        { key: 'branch', header: 'Şube', width: 18, type: 'text', accessor: (r) => ((r as Row).branchName as string) || '—' },
        { key: 'visits', header: 'Ziyaret', width: 12, type: 'number', accessor: (r) => (r as Row).visitCount as number },
        { key: 'spent', header: 'Harcama', width: 16, type: 'currency', accessor: (r) => num((r as Row).spent as number) },
        { key: 'vip', header: 'VIP', width: 10, type: 'boolean', accessor: (r) => (r as Row).isVip as boolean },
        { key: 'kvkk', header: 'KVKK', width: 10, type: 'boolean', accessor: (r) => (r as Row).kvkkConsent as boolean },
      ],
      totals: {
        name: 'TOPLAM',
        visits: ctx.customers.topCustomers.reduce((s, r) => s + r.visitCount, 0),
        spent: num(ctx.customers.topCustomers.reduce((s, r) => s + r.spent, 0)),
      },
    })
    sheets.push(sliceSheet('Yaş Dağılımı', period, ctx.customers.ageSegments, 'count'))
    sheets.push(sliceSheet('Cinsiyet', period, ctx.customers.genderSlices, 'count'))
  }

  if (ctx.tab === 'inventory' && ctx.inventory) {
    sheets.push({
      name: 'Ürün Raporu',
      subtitle: period,
      rows: ctx.inventory.products as unknown as Row[],
      columns: [
        { key: 'name', header: 'Ürün', width: 30, type: 'text', accessor: (r) => (r as Row).name as string },
        { key: 'category', header: 'Kategori', width: 18, type: 'text', accessor: (r) => (r as Row).category as string },
        { key: 'brand', header: 'Marka', width: 16, type: 'text', accessor: (r) => ((r as Row).brand as string) || '—' },
        { key: 'soldQty', header: 'Satılan', width: 12, type: 'number', accessor: (r) => (r as Row).soldQuantity as number },
        { key: 'soldAmount', header: 'Satış Tutarı', width: 16, type: 'currency', accessor: (r) => num((r as Row).soldAmount as number) },
        { key: 'cost', header: 'Maliyet', width: 16, type: 'currency', accessor: (r) => num((r as Row).costAmount as number) },
        { key: 'profit', header: 'Kâr', width: 16, type: 'currency', accessor: (r) => num((r as Row).profit as number) },
        { key: 'used', header: 'Sarf/Fire', width: 12, type: 'number', accessor: (r) => (r as Row).usedQuantity as number },
        { key: 'stock', header: 'Stok', width: 12, type: 'number', accessor: (r) => (r as Row).currentStock as number },
        { key: 'min', header: 'Min Seviye', width: 12, type: 'number', accessor: (r) => (r as Row).minStockLevel as number },
        { key: 'stockValue', header: 'Stok Değeri', width: 16, type: 'currency', accessor: (r) => num((r as Row).stockValue as number) },
      ],
      totals: {
        name: 'TOPLAM',
        soldAmount: num(ctx.inventory.soldAmount),
        cost: num(ctx.inventory.soldCost),
        profit: num(ctx.inventory.soldProfit),
        stockValue: num(ctx.inventory.stockValueAtCost),
      },
    })
    sheets.push(sliceSheet('Stok Hareketleri', period, ctx.inventory.movementTypes))
  }

  if (ctx.tab === 'giftcards' && ctx.inventory) {
    sheets.push({
      name: 'Hediye Çekleri',
      subtitle: period,
      rows: ctx.inventory.giftCards as unknown as Row[],
      columns: [
        { key: 'code', header: 'Kod', width: 20, type: 'text', accessor: (r) => (r as Row).code as string },
        { key: 'kind', header: 'Tür', width: 18, type: 'text', accessor: (r) => (r as Row).kind as string },
        { key: 'customer', header: 'Müşteri', width: 24, type: 'text', accessor: (r) => ((r as Row).customerName as string) || 'Genel' },
        { key: 'value', header: 'Değer', width: 16, type: 'currency', accessor: (r) => num((r as Row).value as number) },
        { key: 'used', header: 'Kullanılan', width: 16, type: 'currency', accessor: (r) => num((r as Row).usedAmount as number) },
        { key: 'balance', header: 'Kalan Bakiye', width: 16, type: 'currency', accessor: (r) => num((r as Row).balance as number) },
        { key: 'uses', header: 'Kullanım', width: 12, type: 'number', accessor: (r) => (r as Row).usedCount as number },
        { key: 'valid', header: 'Geçerlilik', width: 16, type: 'date', accessor: (r) => ((r as Row).validUntilUtc as string) ?? null },
        { key: 'active', header: 'Aktif', width: 10, type: 'boolean', accessor: (r) => (r as Row).isActive as boolean },
      ],
      totals: {
        code: 'TOPLAM',
        value: num(ctx.inventory.giftCards.reduce((s, r) => s + r.value, 0)),
        used: num(ctx.inventory.giftCards.reduce((s, r) => s + r.usedAmount, 0)),
        balance: num(ctx.inventory.giftCards.reduce((s, r) => s + r.balance, 0)),
      },
    })
  }

  return sheets
}

function sliceSheet(
  name: string,
  subtitle: string,
  slices: { key: string; label: string; amount: number; count: number }[],
  emphasis: 'amount' | 'count' = 'amount',
): ExcelSheetSpec<unknown> {
  return {
    name,
    subtitle,
    rows: slices as unknown as Row[],
    columns: [
      { key: 'label', header: 'Kalem', width: 28, type: 'text', accessor: (r) => (r as Row).label as string },
      { key: 'amount', header: 'Tutar', width: 18, type: 'currency', accessor: (r) => num((r as Row).amount as number) },
      { key: 'count', header: 'Adet', width: 12, type: 'number', accessor: (r) => (r as Row).count as number },
    ],
    totals: {
      label: 'TOPLAM',
      amount: emphasis === 'amount' ? num(slices.reduce((s, r) => s + r.amount, 0)) : undefined,
      count: slices.reduce((s, r) => s + r.count, 0),
    },
  }
}

function customerSummaryRows(c: CustomerReport): { label: string; value: number; previous: number }[] {
  return [
    { label: 'Toplam müşteri', value: c.totalCustomers, previous: 0 },
    { label: 'Yeni müşteri', value: c.newCustomers, previous: c.previousNewCustomers },
    { label: 'Aktif müşteri', value: c.activeCustomers, previous: c.previousActiveCustomers },
    { label: 'Tekrar gelen', value: c.returningCustomers, previous: 0 },
    { label: 'Tek seferlik', value: c.oneTimeCustomers, previous: 0 },
    { label: 'Kayıp müşteri (180 gün)', value: c.lostCustomers, previous: 0 },
    { label: 'VIP müşteri', value: c.vipCount, previous: 0 },
    { label: 'Kara listede', value: c.blacklistedCount, previous: 0 },
    { label: 'KVKK onaylı', value: c.kvkkApproved, previous: 0 },
    { label: 'Dönem harcaması (₺)', value: Math.round(c.totalSpent), previous: Math.round(c.previousTotalSpent) },
    { label: 'Kişi başı harcama (₺)', value: Math.round(c.averageSpent), previous: 0 },
    { label: 'Açık borç (₺)', value: Math.round(c.totalDebt), previous: 0 },
  ]
}

function unitLabel(unit: string): string {
  if (unit === 'currency') return '₺'
  if (unit === 'percent') return '%'
  return 'adet'
}

// ===========================================================================
// PDF
// ===========================================================================

export function buildPdfStats(ctx: ExportContext): PdfStatBlock[] {
  const tl = (v: number): string => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(v)

  switch (ctx.tab) {
    case 'compare': {
      // Kapak kartları: temel dönem ile son dönemin GELİRİ ve farkı (net kâr gösterilmiyor).
      const periods = ctx.compareReport?.periods ?? []
      const pick = (i: number, key: string): number => periods[i]?.metrics.find((m) => m.key === key)?.value ?? 0
      const last = Math.max(0, periods.length - 1)
      const baseIncome = pick(0, 'income')
      const lastIncome = pick(last, 'income')
      const diff = baseIncome === 0 ? null : ((lastIncome - baseIncome) / Math.abs(baseIncome)) * 100
      return [
        { label: 'Dönem sayısı', value: String(periods.length) },
        { label: `${periods[0]?.label ?? 'Temel'} geliri`, value: tl(baseIncome), hint: `${tl(pick(0, 'sales'))} satış` },
        { label: `${periods[last]?.label ?? 'Kıyas'} geliri`, value: tl(lastIncome), hint: `${tl(pick(last, 'sales'))} satış` },
        { label: 'Gelir farkı', value: diff === null ? tl(lastIncome - baseIncome) : `%${Math.round(diff)}`, hint: 'temele göre' },
      ]
    }
    case 'packages':
    case 'services': {
      const t = ctx.tab === 'packages' ? ctx.catalog?.packageTotals : ctx.catalog?.serviceTotals
      return [
        { label: 'Satış Adedi', value: String(t?.soldCount ?? 0), hint: `${t?.customerCount ?? 0} müşteri` },
        { label: 'Satış Tutarı', value: tl(t?.grossAmount ?? 0) },
        { label: 'Tahsil Edilen', value: tl(t?.collectedAmount ?? 0), hint: `${tl(t?.remainingAmount ?? 0)} kaldı` },
        { label: 'Yapılan Seans', value: String(t?.sessionsInPeriod ?? 0), hint: `${t?.sessionsRemaining ?? 0} kalan seans` },
      ]
    }
    case 'staff':
      return [
        { label: 'Uygulama Cirosu', value: tl(ctx.staff?.totalServiceRevenue ?? 0) },
        { label: 'Satış Cirosu', value: tl(ctx.staff?.totalSalesAmount ?? 0) },
        { label: 'Komisyon', value: tl(ctx.staff?.totalCommission ?? 0) },
        { label: 'Tamamlanan', value: String(ctx.staff?.totalCompleted ?? 0), hint: `${ctx.staff?.totalAppointments ?? 0} randevu` },
      ]
    case 'branches':
      return [
        { label: 'Toplam Gelir', value: tl(ctx.branches?.totalIncome ?? 0) },
        { label: 'Toplam Gider', value: tl(ctx.branches?.totalExpense ?? 0) },
        { label: 'Toplam Alacak', value: tl((ctx.branches?.rows ?? []).reduce((s2, r) => s2 + r.receivable, 0)) },
        { label: 'Şube', value: String(ctx.branches?.rows.length ?? 0) },
      ]
    case 'customers':
      return [
        { label: 'Toplam Müşteri', value: String(ctx.customers?.totalCustomers ?? 0) },
        { label: 'Yeni', value: String(ctx.customers?.newCustomers ?? 0) },
        { label: 'Aktif', value: String(ctx.customers?.activeCustomers ?? 0) },
        { label: 'Harcama', value: tl(ctx.customers?.totalSpent ?? 0) },
      ]
    case 'inventory':
      return [
        { label: 'Ürün Satışı', value: tl(ctx.inventory?.soldAmount ?? 0) },
        { label: 'Satış Kârı', value: tl(ctx.inventory?.soldProfit ?? 0) },
        { label: 'Stok Değeri', value: tl(ctx.inventory?.stockValueAtCost ?? 0) },
        { label: 'Kritik Stok', value: String(ctx.inventory?.criticalCount ?? 0) },
      ]
    case 'giftcards':
      return [
        { label: 'Kesilen Çek', value: String(ctx.inventory?.giftCardIssuedCount ?? 0) },
        { label: 'Kesilen Tutar', value: tl(ctx.inventory?.giftCardIssuedValue ?? 0) },
        { label: 'Kullanılan', value: tl(ctx.inventory?.giftCardRedeemedValue ?? 0) },
        { label: 'Açık Bakiye', value: tl(ctx.inventory?.giftCardOutstanding ?? 0) },
      ]
    default: {
      const m = (key: string): number => ctx.summary?.metrics.find((x) => x.key === key)?.value ?? 0
      // Kart seti sunucudan gelen metriklerle AYNI olmalı: net kâr / tamamlanma gibi kaldırılmış
      // anahtarlar burada okunursa yanıtta bulunmadıkları için sessizce 0 basılırdı.
      return [
        { label: 'Toplam Gelir', value: tl(m('income')) },
        { label: 'Toplam Gider', value: tl(m('expense')) },
        { label: 'Toplam Alacak', value: tl(m('openReceivable')) },
        { label: 'Toplam Satış Tutarı', value: tl(m('sales')) },
        { label: 'Randevu Sayısı', value: String(m('appointments')) },
        { label: 'Aktif Müşteri', value: String(m('activeCustomers')) },
      ]
    }
  }
}

/**
 * PDF bölümleri — Excel sheet'lerinden türetilir ki iki çıktı asla ayrışmasın.
 * Sayfaya sığması için satır sayısı 120 ile sınırlanır (Excel tam listeyi taşır).
 */
export function buildPdfSections(ctx: ExportContext): PdfSection<unknown>[] {
  return buildExcelSheets(ctx).map((sheet) => ({
    title: sheet.name,
    subtitle: sheet.subtitle,
    rows: sheet.rows.slice(0, 120),
    columns: sheet.columns.slice(0, 8).map((col) => ({
      header: col.header,
      type: col.type === 'currency' ? ('currency' as const) : col.type === 'number' ? ('number' as const) : ('text' as const),
      align: col.type === 'currency' || col.type === 'number' ? ('right' as const) : ('left' as const),
      accessor: col.accessor as (row: unknown) => string | number | boolean | Date | null | undefined,
    })),
  }))
}
