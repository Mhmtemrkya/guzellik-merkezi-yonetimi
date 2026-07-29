/**
 * Raporlar sayfasının API tipleri — backend `Application/Features/Reports/ReportsDtos.cs` ile birebir.
 * Tüm alanlar zorunlu tutulur; API'den eksik gelme ihtimaline karşı sayfada `??` ile korunur.
 */

export type ReportGranularity = 'day' | 'week' | 'month'

export type ReportMetricUnit = 'currency' | 'count' | 'percent'

export interface ReportPoint {
  key: string
  label: string
  income: number
  expense: number
  net: number
  sales: number
  appointments: number
  completedAppointments: number
  newCustomers: number
}

export interface ReportMetric {
  key: string
  label: string
  value: number
  previousValue: number
  unit: ReportMetricUnit
  hint?: string | null
}

export interface ReportSlice {
  key: string
  label: string
  amount: number
  count: number
}

export interface ReportHeatCell {
  dayOfWeek: number
  hour: number
  count: number
}

export interface ReportSummary {
  fromUtc: string
  toUtc: string
  compareFromUtc?: string | null
  compareToUtc?: string | null
  granularity: ReportGranularity
  metrics: ReportMetric[]
  series: ReportPoint[]
  compareSeries: ReportPoint[]
  paymentMethods: ReportSlice[]
  expenseCategories: ReportSlice[]
  revenueSources: ReportSlice[]
  appointmentStatuses: ReportSlice[]
  heatmap: ReportHeatCell[]
}

// --------------------------------------------------- çoklu dönem kıyası ---

export interface ComparePeriod {
  key: string
  label: string
  fromUtc: string
  toUtc: string
  dayCount: number
  /** Listedeki ilk dönem — diğerlerinin farkı buna göre hesaplanır. */
  isBaseline: boolean
  /** `previousValue` burada TEMEL dönemin değeridir. */
  metrics: ReportMetric[]
  series: ReportPoint[]
  paymentMethods: ReportSlice[]
  expenseCategories: ReportSlice[]
  topServices: ReportSlice[]
  topStaff: ReportSlice[]
}

export interface CompareReport {
  granularity: ReportGranularity
  /** Ortak x ekseni — aylık kovada yıl atılmıştır ("Ocak", "Şubat"…). */
  axisLabels: string[]
  periods: ComparePeriod[]
}

// --------------------------------------------------------------- katalog ---

export interface ReportSeller {
  staffMemberId?: string | null
  staffName: string
  soldCount: number
  customerCount: number
  amount: number
}

export interface ReportPerformer {
  staffMemberId?: string | null
  staffName: string
  sessionCount: number
  customerCount: number
  revenue: number
}

export interface CatalogItemReport {
  id: string
  name: string
  category: string
  subCategory?: string | null
  soldCount: number
  customerCount: number
  grossAmount: number
  collectedAmount: number
  remainingAmount: number
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
  sessionsInPeriod: number
  sessionRevenue: number
  /** Uygulamayı yapan personelin prim maliyeti. */
  commissionCost: number
  /** Uygulama cirosu − prim = hizmet kârlılığı. */
  netRevenue: number
  cancelledCount: number
  cancelledAmount: number
  sellers: ReportSeller[]
  performers: ReportPerformer[]
}

export interface CatalogTotals {
  soldCount: number
  customerCount: number
  grossAmount: number
  collectedAmount: number
  remainingAmount: number
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
  sessionsInPeriod: number
  sessionRevenue: number
  commissionCost: number
  netRevenue: number
  cancelledCount: number
  cancelledAmount: number
}

export interface CatalogReport {
  packages: CatalogItemReport[]
  services: CatalogItemReport[]
  packageCategories: ReportSlice[]
  serviceCategories: ReportSlice[]
  topSellers: ReportSeller[]
  topPerformers: ReportPerformer[]
  packageTotals: CatalogTotals
  packageTotalsPrevious: CatalogTotals
  serviceTotals: CatalogTotals
  serviceTotalsPrevious: CatalogTotals
}

// --------------------------------------------------------------- personel ---

export interface StaffReportRow {
  staffMemberId: string
  staffName: string
  title: string
  branchId?: string | null
  branchName?: string | null
  appointmentCount: number
  completedCount: number
  cancelledCount: number
  noShowCount: number
  customerCount: number
  serviceRevenue: number
  salesAmount: number
  salesCount: number
  commissionEarned: number
  commissionPaid: number
  commissionRate: number
  workedMinutes: number
  averageRating: number
  ratingCount: number
  previousServiceRevenue: number
  previousSalesAmount: number
  previousCompletedCount: number
}

export interface StaffReport {
  rows: StaffReportRow[]
  totalServiceRevenue: number
  totalSalesAmount: number
  totalCommission: number
  totalAppointments: number
  totalCompleted: number
  totalWorkedMinutes: number
  previousTotalServiceRevenue: number
  previousTotalSalesAmount: number
  previousTotalCompleted: number
}

// ----------------------------------------------------------------- şubeler ---

export interface BranchReportRow {
  branchId: string
  branchName: string
  city: string
  income: number
  expense: number
  net: number
  previousIncome: number
  previousExpense: number
  previousNet: number
  salesAmount: number
  receivable: number
  appointmentCount: number
  completedCount: number
  customerCount: number
  newCustomerCount: number
  staffCount: number
  averageTicket: number
  profitMargin: number
  series: ReportPoint[]
}

export interface BranchReport {
  rows: BranchReportRow[]
  totalIncome: number
  totalExpense: number
  totalNet: number
  previousTotalIncome: number
  previousTotalExpense: number
  previousTotalNet: number
  granularity: ReportGranularity
  scopedToSingleBranch: boolean
}

// --------------------------------------------------------------- müşteriler ---

export interface CustomerReportRow {
  customerId: string
  fullName: string
  phone: string
  visitCount: number
  spent: number
  debt: number
  lastVisitUtc?: string | null
  isVip: boolean
  kvkkConsent: boolean
  branchName?: string | null
}

export interface CustomerReport {
  totalCustomers: number
  newCustomers: number
  activeCustomers: number
  returningCustomers: number
  oneTimeCustomers: number
  lostCustomers: number
  vipCount: number
  blacklistedCount: number
  kvkkApproved: number
  totalSpent: number
  averageSpent: number
  totalDebt: number
  retentionRate: number
  previousNewCustomers: number
  previousActiveCustomers: number
  previousTotalSpent: number
  ageSegments: ReportSlice[]
  genderSlices: ReportSlice[]
  visitFrequency: ReportSlice[]
  series: ReportPoint[]
  topCustomers: CustomerReportRow[]
}

// ------------------------------------------------------- stok + hediye çeki ---

export interface ProductReportRow {
  productId: string
  name: string
  category: string
  brand?: string | null
  soldQuantity: number
  soldAmount: number
  costAmount: number
  profit: number
  usedQuantity: number
  currentStock: number
  minStockLevel: number
  isCritical: boolean
  stockValue: number
}

export interface GiftCardReportRow {
  id: string
  code: string
  kind: string
  value: number
  balance: number
  usedAmount: number
  usedCount: number
  maxUses: number
  isActive: boolean
  validUntilUtc?: string | null
  customerName?: string | null
}

export interface InventoryReport {
  productCount: number
  criticalCount: number
  outOfStockCount: number
  stockValueAtCost: number
  stockValueAtSale: number
  soldQuantity: number
  soldAmount: number
  soldCost: number
  soldProfit: number
  usedQuantity: number
  damagedQuantity: number
  purchasedAmount: number
  previousSoldAmount: number
  previousSoldProfit: number
  products: ProductReportRow[]
  categories: ReportSlice[]
  movementTypes: ReportSlice[]
  series: ReportPoint[]
  giftCardIssuedCount: number
  giftCardIssuedValue: number
  giftCardRedeemedValue: number
  giftCardOutstanding: number
  giftCardActiveCount: number
  giftCardExpiredCount: number
  giftCards: GiftCardReportRow[]
}
