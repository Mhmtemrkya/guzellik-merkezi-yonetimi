import type {
  AccountInstallmentItem,
  AccountMonthlyInstallment,
  AccountPayment,
  AccountReport,
  ApiAccountReport,
  ApiAppointment,
  ApiBusinessExpense,
  ApiCustomer,
  ApiCustomerAccount,
  ApiCashFlowEntry,
  ApiCashFlowSummary,
  ApiCustomExpenseCategory,
  ApiCustomServiceCategory,
  ApiExpenseSummary,
  ApiAuditLog,
  ApiNotificationLog,
  ApiNotificationSummary,
  ApiNotificationTemplate,
  ApiPendingOperation,
  ApiPlanUsageBreakdown,
  ApiPlatformUsageSummary,
  ApiSubscriptionPlan,
  ApiTenantUsage,
  ApiUsageMetric,
  ApiProduct,
  ApiStockMovement,
  ApiStockSummary,
  ApiService,
  ApiServicePackage,
  ApiAdisyon,
  Adisyon,
  AdisyonItem,
  AdisyonStatusKey,
  AdisyonItemTypeKey,
  ApiCashClosing,
  ApiGiftCard,
  ApiWaitlistEntry,
  ApiStaff,
  ApiStaffTimeOff,
  StaffTimeOff,
  ApiCampaign,
  Campaign,
  DiscountTypeKey,
  CampaignTargetKey,
  ApiTenant,
  Appointment,
  AppointmentLookups,
  AppointmentStatusKey,
  BusinessExpense,
  Customer,
  CustomerAccount,
  CashFlowEntry,
  CashFlowEntryTypeKey,
  CashFlowMethodKey,
  CashFlowSummary,
  CatalogStatusKey,
  CustomerGender,
  CustomExpenseCategory,
  CustomServiceCategory,
  ExpenseCategoryKey,
  PendingOperation,
  PendingOperationStatusKey,
  PendingOperationTypeKey,
  Product,
  ProductCategoryKey,
  ProductStatusKey,
  StockMovement,
  StockMovementTypeKey,
  StockSummary,
  AuditLog,
  ApiFeatureCatalog,
  ApiTenantFeatures,
  FeatureCatalogItem,
  FeatureCategoryKey,
  FeatureKey,
  TenantFeatures,
  ExpensePaymentMethodKey,
  ExpenseSummary,
  InstallmentStatusKey,
  NotificationChannelKey,
  NotificationLog,
  NotificationLogStatusKey,
  NotificationSummary,
  NotificationTemplate,
  NotificationTemplateStatusKey,
  NotificationTriggerKey,
  PagedResult,
  PlanUsageBreakdown,
  PlatformUsageSummary,
  SubscriptionPlan,
  TenantUsage,
  UsageMetric,
  Service,
  ServicePackage,
  ServicePackageItem,
  CashClosing,
  GiftCard,
  GiftCardKind,
  WaitlistEntry,
  WaitlistStatus,
  Staff,
  Tenant,
  TenantStatusKey,
} from './types'
import { parseUtc, localDateKey } from './datetime'

export function formatTL(value: number | string | null | undefined): string {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(amount)
}

export const planPrice: Record<string, number> = {
  Premium: 2990,
  'AI Klinik': 4990,
  Profesyonel: 1499,
  Başlangıç: 799,
  Enterprise: 0,
  Trial: 0,
  Free: 0,
}

export function apiItems<T>(result: PagedResult<T> | T[] | null | undefined): T[] {
  if (Array.isArray(result)) return result
  return result?.items || []
}

export function guidOrUndefined(value: string | null | undefined): string | undefined {
  const text = String(value || '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : undefined
}

export function shortId(value: string | null | undefined): string {
  return String(value || '').slice(0, 8)
}

export function initialsFromName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR')
}

export function tenantStatusKey(status: string | null | undefined): TenantStatusKey {
  const key = String(status || 'Active').toLowerCase()
  if (['trial', 'deneme'].includes(key)) return 'trial'
  if (['suspended', 'cancelled', 'paused', 'askida', 'askıda', 'inactive'].includes(key)) return 'paused'
  return 'active'
}

export function normalizeTenant(tenant: ApiTenant | null | undefined, index = 0): Tenant {
  const plan = tenant?.plan || 'Başlangıç'
  const name = tenant?.name || tenant?.tenantName || `Kurum ${index + 1}`
  const branchCount = tenant?.branchCount ?? tenant?.branches?.length ?? 0
  const owner = tenant?.ownerName || tenant?.owner || 'Yetkili atanmadı'
  const status = tenantStatusKey(tenant?.status)
  return {
    id: tenant?.id || tenant?.tenantId || `tenant-${index}`,
    name,
    slug: tenant?.slug || name.toLowerCase().replaceAll(' ', '-'),
    city: tenant?.city || (tenant?.domain ? 'Domain bağlı' : 'Şube şehir bilgisi API’de yok'),
    plan,
    status,
    users: tenant?.userCount ?? tenant?.users ?? 0,
    customers: tenant?.customerCount ?? tenant?.customers ?? 0,
    mrr: tenant?.mrr ?? planPrice[plan] ?? 0,
    joined: tenant?.createdAt || tenant?.joined || 'API',
    owner,
    domain: tenant?.domain || `${String(tenant?.slug || name).toLowerCase().replaceAll(' ', '')}.beautyasist.app`,
    phone: tenant?.phone || '',
    taxNumber: tenant?.taxNumber || '',
    email: tenant?.email || '',
    legalName: tenant?.legalName || '',
    taxOffice: tenant?.taxOffice || '',
    currency: tenant?.currency || 'TRY',
    maxInstallments: tenant?.maxInstallments ?? 12,
    overdueGraceDays: tenant?.overdueGraceDays ?? 3,
    ownerName: owner,
    health: status === 'paused' ? 62 : status === 'trial' ? 82 : 96,
    lastSync: 'API canlı',
    storage: 0,
    invoicesOpen: 0,
    loginEmails: tenant?.ownerEmail ? [tenant.ownerEmail] : [],
    branchCount,
    branches: tenant?.branches || [],
    subscriptionPlanId: tenant?.subscriptionPlanId ?? null,
    subscriptionPlanKey: tenant?.subscriptionPlanKey || '',
    subscriptionPlanName: tenant?.subscriptionPlanName || plan,
    subscriptionPlanMonthlyPriceTRY: Number(tenant?.subscriptionPlanMonthlyPriceTRY ?? planPrice[plan] ?? 0),
    subscriptionPlanYearlyPriceTRY: Number(tenant?.subscriptionPlanYearlyPriceTRY ?? 0),
    trialEndsAt: tenant?.trialEndsAtUtc ?? null,
    subscriptionPeriod: tenant?.subscriptionPeriod ?? null,
    subscriptionEndsAt: tenant?.subscriptionEndsAtUtc ?? null,
  }
}

// ---------------------------------------------------------------------------
// Subscription Plans & Usage
// ---------------------------------------------------------------------------

export function normalizeSubscriptionPlan(p: ApiSubscriptionPlan | null | undefined, index = 0): SubscriptionPlan {
  const features = (p?.features || '').split(',').map((f) => f.trim()).filter(Boolean)
  return {
    id: p?.id || `plan-${index}`,
    planKey: p?.planKey || '',
    name: p?.name || `Paket ${index + 1}`,
    description: p?.description || '',
    monthlyPriceTRY: Number(p?.monthlyPriceTRY ?? 0),
    yearlyPriceTRY: Number(p?.yearlyPriceTRY ?? 0),
    maxBranches: Number(p?.maxBranches ?? 1),
    maxStaff: Number(p?.maxStaff ?? 5),
    maxCustomers: Number(p?.maxCustomers ?? 500),
    maxMonthlyAppointments: Number(p?.maxMonthlyAppointments ?? 500),
    maxMonthlySmsCount: Number(p?.maxMonthlySmsCount ?? 0),
    maxMonthlyWhatsAppCount: Number(p?.maxMonthlyWhatsAppCount ?? 0),
    maxMonthlyEmailCount: Number(p?.maxMonthlyEmailCount ?? 0),
    features,
    displayOrder: Number(p?.displayOrder ?? 0),
    isActive: p?.isActive ?? true,
    tenantCount: Number(p?.tenantCount ?? 0),
  }
}

export function normalizeUsageMetric(m: ApiUsageMetric | null | undefined): UsageMetric {
  const limit = Number(m?.limit ?? 0)
  const used = Number(m?.used ?? 0)
  const isUnlimited = m?.isUnlimited ?? limit < 0
  const percent = m?.percent ?? (isUnlimited || limit === 0 ? 0 : Math.min(100, Math.round((used * 100) / limit)))
  const isOver = m?.isOver ?? (!isUnlimited && used > limit)
  return {
    key: m?.key || '',
    label: m?.label || '',
    used,
    limit,
    isUnlimited,
    percent,
    isOver,
    isWarning: m?.isWarning ?? (!isUnlimited && !isOver && percent >= 80),
  }
}

export function normalizeTenantUsage(u: ApiTenantUsage | null | undefined): TenantUsage {
  const metrics = (u?.metrics ?? []).map(normalizeUsageMetric)
  return {
    tenantId: u?.tenantId || '',
    tenantName: u?.tenantName || '',
    subscriptionPlanId: u?.subscriptionPlanId ?? null,
    planName: u?.planName || 'Atanmamış',
    planKey: u?.planKey || '',
    planMonthlyPriceTRY: Number(u?.planMonthlyPriceTRY ?? 0),
    metrics,
    hasOverflow: u?.hasAnyOverflow ?? metrics.some((m) => m.isOver),
    hasWarning: u?.hasWarning ?? metrics.some((m) => m.isWarning),
    maxPercent: u?.maxPercent ?? (metrics.length ? Math.max(...metrics.map((m) => m.percent)) : 0),
  }
}

export function normalizePlanBreakdown(b: ApiPlanUsageBreakdown | null | undefined): PlanUsageBreakdown {
  return {
    planId: b?.planId ?? null,
    planKey: b?.planKey || '',
    planName: b?.planName || 'Atanmamış',
    tenantCount: Number(b?.tenantCount ?? 0),
    monthlyRevenueTRY: Number(b?.monthlyRevenueTRY ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export const auditActionLabels: Record<string, string> = {
  Create: 'Oluşturma',
  Update: 'Güncelleme',
  Delete: 'Silme',
  View: 'Görüntüleme',
  Change: 'Değişiklik',
  Reschedule: 'Yeniden planlama',
  ChangeStatus: 'Durum değişikliği',
  ChangeNotes: 'Not güncelleme',
  ChangePassword: 'Parola değişikliği',
  ResetPassword: 'Şifre sıfırlama',
  RegisterPayment: 'Tahsilat',
  StockMovement: 'Stok hareketi',
  PayCommission: 'Prim ödemesi',
  AdjustLoyalty: 'Puan düzenleme',
  Submit: 'Onaya gönderme',
  Approve: 'Onaylama',
  Reject: 'Reddetme',
  Cancel: 'İptal',
  Send: 'Gönderim',
  Upgrade: 'Yükseltme',
  Login: 'Giriş',
  Logout: 'Çıkış',
  'Security.UnauthorizedDevice': 'Farklı Cihaz Girişimi',
  'Security.DeviceRegistered': 'Cihaz Tanımlandı',
  'Security.DeviceRemoved': 'Cihaz Silindi',
  'Security.DeviceLimitChanged': 'Cihaz Limiti',
  'Security.DeviceControlEnabled': 'Cihaz Güvenliği Açıldı',
  'Security.DeviceControlDisabled': 'Cihaz Güvenliği Kapatıldı',
}

export const auditEntityLabels: Record<string, string> = {
  Customer: 'Müşteri',
  Appointment: 'Randevu',
  Expense: 'Gider',
  ExpenseCategory: 'Gider kategorisi',
  Product: 'Ürün',
  Staff: 'Personel',
  StaffCommission: 'Prim',
  StaffTimeOff: 'İzin',
  CustomerAccount: 'Cari hesap',
  AccountPayment: 'Tahsilat',
  PendingOperation: 'Onay isteği',
  Branch: 'Şube',
  CashFlow: 'Kasa',
  Feature: 'Özellik',
  AuditLog: 'Log kayıtları',
  Notification: 'Bildirim',
  NotificationLog: 'Bildirim logu',
  NotificationTemplate: 'Bildirim şablonu',
  Service: 'Hizmet',
  ServiceCategory: 'Hizmet kategorisi',
  ServicePackage: 'Paket',
  StockMovement: 'Stok hareketi',
  Tenant: 'Kurum',
  Usage: 'Kullanım',
  Auth: 'Oturum',
  ApiRequest: 'API isteği',
  Adisyon: 'Adisyon',
  Adisyonlar: 'Adisyon',
  Campaign: 'Kampanya',
  Campaigns: 'Kampanya',
  LoyaltyTransaction: 'Sadakat puanı',
  Loyalty: 'Sadakat',
  Commissions: 'Prim',
  Schedule: 'Çizelge',
  Rating: 'Müşteri puanlama',
  WhatsApp: 'WhatsApp',
  SubscriptionPlan: 'Abonelik planı',
  Security: 'Güvenlik',
}

export const auditRoleLabels: Record<string, string> = {
  PlatformAdmin: 'Platform Admin',
  InstitutionOwner: 'Kurum Yöneticisi',
  BranchManager: 'Şube Yöneticisi',
  Staff: 'Personel',
}

/** Eski log özetlerinde gömülü kalan "GET /api/..." gibi teknik kısımları gizler. */
function sanitizeAuditSummary(summary: string): string {
  return summary
    .replace(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\/\S+\s*/gi, '')
    .replace(/\/api\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Cihaz güvenliği: X-Device-Info JSON'unu güvenle çözer (bozuksa null). */
function parseDeviceInfo(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    // İç içe networkInfoJson stringi de açılır (okunur detay için).
    if (typeof parsed.networkInfoJson === 'string') {
      try { parsed.network = JSON.parse(parsed.networkInfoJson) } catch { /* olduğu gibi bırak */ }
      delete parsed.networkInfoJson
    }
    return parsed
  } catch {
    return null
  }
}

export function normalizeAuditLog(log: ApiAuditLog | null | undefined, index = 0): AuditLog {
  let data: Record<string, unknown> | null = null
  try {
    data = log?.dataJson ? (JSON.parse(log.dataJson) as Record<string, unknown>) : null
    // API yolu gibi teknik alanlar kullanıcıya gösterilmez.
    if (data) for (const key of ['path', 'endpoint', 'traceId', 'method']) delete data[key]
  } catch {
    data = null
  }
  const action = log?.action || ''
  const entityName = log?.entityName || ''
  return {
    id: log?.id || `log-${index}`,
    branchId: log?.branchId ?? null,
    actorUserId: log?.actorUserId ?? null,
    actorName: log?.actorName || 'Sistem',
    actorRole: auditRoleLabels[log?.actorRole || ''] || log?.actorRole || '',
    action,
    actionLabel: auditActionLabels[action] || action,
    entityName,
    entityLabel: auditEntityLabels[entityName] || entityName,
    entityId: log?.entityId ?? null,
    summary: sanitizeAuditSummary(log?.summary || ''),
    data,
    ipAddress: log?.ipAddress || '',
    deviceId: log?.deviceId ?? null,
    deviceInfo: parseDeviceInfo(log?.deviceInfoJson),
    createdAt: log?.createdAtUtc || '',
    createdAtFormatted: formatDateTime(log?.createdAtUtc),
  }
}

export function normalizePlatformUsageSummary(s: ApiPlatformUsageSummary | null | undefined): PlatformUsageSummary {
  return {
    totalTenants: Number(s?.totalTenants ?? 0),
    activeTenants: Number(s?.activeTenants ?? 0),
    trialTenants: Number(s?.trialTenants ?? 0),
    pausedTenants: Number(s?.pausedTenants ?? 0),
    monthlyRecurringRevenueTRY: Number(s?.monthlyRecurringRevenueTRY ?? 0),
    tenantsAtWarning: Number(s?.tenantsAtWarning ?? 0),
    tenantsOverLimit: Number(s?.tenantsOverLimit ?? 0),
    planBreakdown: (s?.planBreakdown ?? []).map(normalizePlanBreakdown),
    tenants: (s?.tenants ?? []).map(normalizeTenantUsage),
  }
}

export function normalizeCustomer(customer: ApiCustomer | null | undefined, index = 0): Customer {
  const fullName = customer?.fullName || customer?.name || `Müşteri ${index + 1}`
  const cityMatch = customer?.notes?.match(/şehir:\s*([^\n]+)/i)
  return {
    id: customer?.id || `customer-${index}`,
    tenantId: customer?.tenantId,
    branchId: customer?.branchId,
    name: fullName,
    phone: customer?.phone || 'Telefon yok',
    email: customer?.email || '',
    city: cityMatch?.[1] || 'Şube müşterisi',
    tier: customer?.kvkkConsent ? 'KVKK Onaylı' : 'KVKK Bekliyor',
    joined: customer?.birthDate || 'API',
    createdAt: customer?.createdAtUtc || '',
    activePackages: 0,
    totalSpent: 0,
    debt: 0,
    remainingSessions: 0,
    lastVisit: 'Randevu API’sinden hesaplanacak',
    gender: (customer?.gender || 'Unspecified') as CustomerGender,
    notes: customer?.notes || '',
    photoUrl: customer?.photoUrl || '',
    isBlacklisted: Boolean(customer?.isBlacklisted),
    blacklistReason: customer?.blacklistReason ?? null,
    isVip: Boolean(customer?.isVip),
  }
}

const MONTH_LABELS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

export function normalizeAccountReport(report: ApiAccountReport | null | undefined): AccountReport {
  const months: AccountMonthlyInstallment[] = (report?.monthlyInstallments ?? []).map((m) => {
    const month = Number(m?.month ?? 0)
    return {
      year: Number(m?.year ?? 0),
      month,
      label: MONTH_LABELS_TR[month - 1] ?? '—',
      due: Number(m?.due ?? 0),
      collected: Number(m?.collected ?? 0),
      remaining: Number(m?.remaining ?? 0),
    }
  })
  return {
    packageSalesCount: Number(report?.packageSalesCount ?? 0),
    customersWithPackages: Number(report?.customersWithPackages ?? 0),
    totalAccounts: Number(report?.totalAccounts ?? 0),
    activeAccounts: Number(report?.activeAccounts ?? 0),
    sessionsTotal: Number(report?.sessionsTotal ?? 0),
    sessionsUsed: Number(report?.sessionsUsed ?? 0),
    sessionsRemaining: Number(report?.sessionsRemaining ?? 0),
    totalReceivable: Number(report?.totalReceivable ?? 0),
    totalCollected: Number(report?.totalCollected ?? 0),
    overdueAmount: Number(report?.overdueAmount ?? 0),
    collectedThisMonth: Number(report?.collectedThisMonth ?? 0),
    monthlyInstallments: months,
  }
}

export function normalizeGiftCard(g: ApiGiftCard | null | undefined, index = 0): GiftCard {
  const kind = (g?.kind ?? 'FixedAmount') as GiftCardKind
  return {
    id: g?.id || `gift-${index}`,
    code: g?.code || '—',
    kind,
    value: Number(g?.value ?? 0),
    balance: Number(g?.balance ?? 0),
    validUntil: g?.validUntilUtc ?? null,
    maxUses: Number(g?.maxUses ?? 0),
    usedCount: Number(g?.usedCount ?? 0),
    isActive: Boolean(g?.isActive),
    note: g?.note || '',
    customerId: g?.customerId ?? null,
    isValid: Boolean(g?.isValid),
  }
}

export function normalizeCashClosing(c: ApiCashClosing | null | undefined, index = 0): CashClosing {
  return {
    id: c?.id || `closing-${index}`,
    businessDate: (c?.businessDate || '').slice(0, 10),
    openingBalance: Number(c?.openingBalance ?? 0),
    cashIncome: Number(c?.cashIncome ?? 0),
    cashExpense: Number(c?.cashExpense ?? 0),
    systemCash: Number(c?.systemCash ?? 0),
    countedCash: Number(c?.countedCash ?? 0),
    difference: Number(c?.difference ?? 0),
    note: c?.note || '',
    createdAt: c?.createdAtUtc || '',
  }
}

export function normalizeWaitlistEntry(w: ApiWaitlistEntry | null | undefined, index = 0): WaitlistEntry {
  return {
    id: w?.id || `wait-${index}`,
    customerId: w?.customerId || '',
    serviceDefinitionId: w?.serviceDefinitionId ?? null,
    staffMemberId: w?.staffMemberId ?? null,
    preferredDate: (w?.preferredDate || '').slice(0, 10),
    status: (w?.status ?? 'Waiting') as WaitlistStatus,
    note: w?.note || '',
    createdAt: w?.createdAtUtc || '',
    preferredStartUtc: w?.preferredStartUtc ?? null,
    durationMinutes: w?.durationMinutes ?? null,
  }
}

export function normalizeStaff(staff: ApiStaff | null | undefined, index = 0): Staff {
  const fullName = staff?.fullName || staff?.name || `Personel ${index + 1}`
  return {
    id: staff?.id || `staff-${index}`,
    tenantId: staff?.tenantId,
    branchId: staff?.branchId,
    tenantUserId: staff?.tenantUserId ?? null,
    name: fullName,
    role: staff?.title || staff?.role || 'Personel',
    dept: staff?.specialties || staff?.dept || staff?.title || 'Genel',
    phone: staff?.phone || '',
    email: staff?.email ?? null,
    active: staff?.isActive ?? staff?.active ?? true,
    permissions: staff?.permissions || [],
    sessionsThisMonth: staff?.sessionsThisMonth || 0,
    performanceScore: staff?.performanceScore || (staff?.isActive === false ? 0 : 100),
    commissionRate: staff?.commissionRate,
    photoUrl: staff?.photoUrl || '',
    averageRating: staff?.averageRating ?? null,
    ratingCount: staff?.ratingCount ?? 0,
  }
}

export function normalizeStaffTimeOff(t: ApiStaffTimeOff | null | undefined, index = 0): StaffTimeOff {
  return {
    id: t?.id || `timeoff-${index}`,
    staffMemberId: t?.staffMemberId || '',
    staffName: t?.staffName || '',
    date: (t?.date || '').slice(0, 10),
    reason: t?.reason || '',
  }
}

export function normalizeCampaign(c: ApiCampaign | null | undefined, index = 0): Campaign {
  const discountType: DiscountTypeKey = String(c?.discountType) === 'Amount' || String(c?.discountType) === '1' ? 'Amount' : 'Percent'
  const targetRaw = String(c?.target)
  const target: CampaignTargetKey = targetRaw === 'Service' || targetRaw === '1' ? 'Service' : targetRaw === 'Package' || targetRaw === '2' ? 'Package' : 'All'
  return {
    id: c?.id || `campaign-${index}`,
    tenantId: c?.tenantId,
    branchId: c?.branchId ?? null,
    name: c?.name || `Kampanya ${index + 1}`,
    discountType,
    discountValue: Number(c?.discountValue ?? 0),
    target,
    targetId: c?.targetId ?? null,
    startDate: (c?.startDate || '').slice(0, 10),
    endDate: (c?.endDate || '').slice(0, 10),
    isActive: c?.isActive ?? true,
    isRunning: c?.isRunning ?? false,
  }
}

export function normalizeCatalogStatus(status: unknown, isActive?: boolean): CatalogStatusKey {
  const byIndex: Record<string, CatalogStatusKey> = { '0': 'Active', '1': 'Draft', '2': 'Passive', '3': 'Archived' }
  const key = String(status ?? '')
  if (byIndex[key]) return byIndex[key]
  if (key === 'Active' || key === 'Draft' || key === 'Passive' || key === 'Archived') return key
  return isActive === false ? 'Passive' : 'Active'
}

export function normalizeService(service: ApiService | null | undefined, index = 0): Service {
  return {
    id: service?.id || `service-${index}`,
    tenantId: service?.tenantId,
    branchId: service?.branchId,
    group: service?.category || service?.group || 'Genel Hizmet',
    name: service?.name || `Hizmet ${index + 1}`,
    session: Number(service?.defaultSessionCount ?? service?.session ?? 1) || 1,
    price: Number(service?.price || 0),
    duration: Number(service?.durationMinutes || service?.duration || 0),
    isActive: service?.isActive ?? true,
    iconKey: service?.iconKey || '',
    status: normalizeCatalogStatus(service?.status, service?.isActive),
    loyaltyPointCost: Math.max(0, Number(service?.loyaltyPointCost || 0)),
  }
}

export function normalizePackage(pkg: ApiServicePackage | null | undefined, index = 0): ServicePackage {
  const items: ServicePackageItem[] = (pkg?.items || []).map((item, i) => ({
    serviceDefinitionId: item.serviceDefinitionId || '',
    serviceName: item.serviceName || `Hizmet ${i + 1}`,
    sessionCount: Number(item.sessionCount || 1),
    unitPrice: Number(item.unitPrice || 0),
  }))
  return {
    id: pkg?.id || `package-${index}`,
    tenantId: pkg?.tenantId,
    branchId: pkg?.branchId ?? null,
    name: pkg?.name || `Paket ${index + 1}`,
    description: pkg?.description || '',
    category: pkg?.category || '',
    totalPrice: Number(pkg?.totalPrice || 0),
    depositAmount: Number(pkg?.depositAmount || 0),
    installmentCount: Number(pkg?.installmentCount || 0),
    isActive: pkg?.isActive ?? true,
    items,
    totalDurationMinutes: Number(pkg?.totalDurationMinutes || 0),
    totalSessions: Number(pkg?.totalSessions || items.reduce((s, i) => s + i.sessionCount, 0)),
    iconKey: pkg?.iconKey || '',
    status: normalizeCatalogStatus(pkg?.status, pkg?.isActive),
    updatedAt: (() => {
      const d = parseUtc(pkg?.updatedAtUtc)
      if (!d) return ''
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    })(),
    loyaltyPointCost: Math.max(0, Number(pkg?.loyaltyPointCost || 0)),
  }
}

const ADISYON_STATUSES: AdisyonStatusKey[] = ['Open', 'Approved', 'Cancelled']
const ADISYON_ITEM_TYPES: AdisyonItemTypeKey[] = ['Service', 'Product', 'PackageUse', 'Extra', 'Payment', 'Discount', 'PackageSale']

function normalizeAdisyonStatus(status: string | null | undefined): AdisyonStatusKey {
  const key = String(status ?? 'Open')
  if (key === '1' || key === 'Approved') return 'Approved'
  if (key === '2' || key === 'Cancelled') return 'Cancelled'
  return ADISYON_STATUSES.includes(key as AdisyonStatusKey) ? (key as AdisyonStatusKey) : 'Open'
}

function normalizeAdisyonItemType(type: string | null | undefined): AdisyonItemTypeKey {
  const key = String(type ?? 'Service')
  const byIndex: Record<string, AdisyonItemTypeKey> = { '0': 'Service', '1': 'Product', '2': 'PackageUse', '3': 'Extra', '4': 'Payment', '5': 'Discount', '6': 'PackageSale' }
  if (byIndex[key]) return byIndex[key]
  return ADISYON_ITEM_TYPES.includes(key as AdisyonItemTypeKey) ? (key as AdisyonItemTypeKey) : 'Extra'
}

export function normalizeAdisyon(a: ApiAdisyon | null | undefined): Adisyon {
  const items: AdisyonItem[] = (a?.items || []).map((it, i) => ({
    id: it.id || `adisyon-item-${i}`,
    type: normalizeAdisyonItemType(it.type),
    refId: it.refId ?? null,
    description: it.description || '',
    quantity: Number(it.quantity ?? 1),
    unitPrice: Number(it.unitPrice ?? 0),
    lineTotal: Number(it.lineTotal ?? (Number(it.quantity ?? 1) * Number(it.unitPrice ?? 0))),
    staffMemberId: it.staffMemberId ?? null,
    staffName: it.staffName ?? null,
    coveredByPackage: it.coveredByPackage ?? false,
    createdAtUtc: it.createdAtUtc || '',
  }))
  return {
    id: a?.id || '',
    tenantId: a?.tenantId,
    branchId: a?.branchId ?? null,
    customerId: a?.customerId || '',
    customerName: a?.customerName ?? null,
    customerAccountId: a?.customerAccountId ?? null,
    status: normalizeAdisyonStatus(a?.status),
    openedAtUtc: a?.openedAtUtc || '',
    approvedAtUtc: a?.approvedAtUtc ?? null,
    notes: a?.notes ?? null,
    chargeTotal: Number(a?.chargeTotal ?? 0),
    paymentTotal: Number(a?.paymentTotal ?? 0),
    plannedInstallmentCount: Number(a?.plannedInstallmentCount ?? 0),
    plannedFirstDueDate: a?.plannedFirstDueDate ?? null,
    items,
  }
}

function normalizeInstallmentStatus(status: string | null | undefined): InstallmentStatusKey {
  const key = String(status || 'Planned')
  if (key === 'Paid' || key === '1') return 'Paid'
  if (key === 'Cancelled' || key === '2') return 'Cancelled'
  return 'Planned'
}

export function normalizeAccount(account: ApiCustomerAccount | null | undefined, index = 0): CustomerAccount {
  const todayIso = new Date().toISOString().slice(0, 10)

  // Aylık ödeme mantığı: bir taksit, BİR SONRAKİ taksitin vade günü gelene kadar "gecikti" sayılmaz.
  // (Bu ayın taksiti vadesini 1 gün geçti diye kırmızı "gecikti" gösterilmez; gelecek ayın taksit
  //  günü geldiğinde hâlâ ödenmemişse geciker.) Son taksit için kendi vadesine +1 ay tolerans.
  const sortedDues = (account?.installments || [])
    .map((i) => String(i.dueDate || '').slice(0, 10))
    .filter(Boolean)
    .sort()
  const graceDeadlineFor = (due: string): string => {
    const next = sortedDues.find((d) => d > due)
    if (next) return next
    const [y, m, d] = due.split('-').map(Number)
    if (!y) return due
    return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10) // m 0-index olduğundan +1 ay
  }

  const installments: AccountInstallmentItem[] = (account?.installments || []).map((i, idx) => {
    const status = normalizeInstallmentStatus(i.status)
    const due = String(i.dueDate || '').slice(0, 10)
    const amount = Number(i.amount || 0)
    const paidAmount = Math.min(amount, Math.max(0, Number(i.paidAmount || 0)))
    const remaining = Math.max(0, amount - paidAmount)
    // Geciken = tam ödenmemiş + bir sonraki taksitin vade günü de gelmiş (aylık tolerans).
    const overdue = status !== 'Paid' && remaining > 0.005 && Boolean(due) && graceDeadlineFor(due) <= todayIso
    return {
      id: i.id || `inst-${idx}`,
      no: Number(i.no || idx + 1),
      dueDate: due,
      amount,
      paidAmount,
      remaining,
      status,
      paidAtUtc: i.paidAtUtc || null,
      overdue,
    }
  })

  const payments: AccountPayment[] = (account?.payments || []).map((p, idx) => ({
    id: p.id || `pay-${idx}`,
    amount: Number(p.amount || 0),
    method: p.method || '',
    reference: p.reference || '',
    occurredAtUtc: p.occurredAtUtc || '',
  }))

  // Sıradaki tahsilat = en erken vadeli, tam ödenmemiş (kalanı olan) taksit.
  const nextPending = installments
    .filter((i) => i.status !== 'Paid' && i.remaining > 0.005)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]

  return {
    id: account?.id || `account-${index}`,
    tenantId: account?.tenantId,
    branchId: account?.branchId ?? null,
    customerId: account?.customerId || '',
    customerName: account?.customerName || 'Müşteri',
    customerPhone: account?.customerPhone || '',
    servicePackageId: account?.servicePackageId ?? null,
    servicePackageName: account?.servicePackageName || '',
    name: account?.name || 'Cari hesap',
    totalAmount: Number(account?.totalAmount || 0),
    depositAmount: Number(account?.depositAmount || 0),
    paidAmount: Number(account?.paidAmount || 0),
    remainingAmount: Number(account?.remainingAmount || 0),
    creditBalance: Math.max(0, Number(account?.creditBalance || 0)),
    isActive: account?.isActive ?? true,
    notes: account?.notes || '',
    installments,
    payments,
    appointmentRevenue: Number(account?.appointmentRevenue || 0),
    completedAppointmentCount: Number(account?.completedAppointmentCount || 0),
    createdAtUtc: account?.createdAtUtc || '',
    nextDueDate: nextPending?.dueDate || null,
    nextDueAmount: nextPending?.remaining || 0,
    hasOverdue: installments.some((i) => i.overdue),
  }
}

const validExpenseCategories: ExpenseCategoryKey[] = [
  'Salary', 'Tax', 'Rent', 'Utilities', 'Supplies', 'Inventory',
  'Marketing', 'Maintenance', 'Professional', 'Equipment', 'Office', 'Other',
]

const validPaymentMethods: ExpensePaymentMethodKey[] = ['Cash', 'Card', 'BankTransfer', 'Check']

export const expenseCategoryLabels: Record<ExpenseCategoryKey, string> = {
  Salary: 'Personel Maaşı',
  Tax: 'Vergi / SGK',
  Rent: 'Kira',
  Utilities: 'Faturalar (Elektrik / Su / İnternet)',
  Supplies: 'Sarf Malzeme',
  Inventory: 'Ürün / Stok Alımı',
  Marketing: 'Reklam & Pazarlama',
  Maintenance: 'Bakım & Onarım',
  Professional: 'Muhasebe / Danışmanlık',
  Equipment: 'Demirbaş Alımı',
  Office: 'Ofis & İdari',
  Other: 'Diğer',
}

export const paymentMethodLabels: Record<ExpensePaymentMethodKey, string> = {
  Cash: 'Nakit',
  Card: 'Kart',
  BankTransfer: 'Havale / EFT',
  Check: 'Çek',
}

function normalizeExpenseCategory(value: string | null | undefined): ExpenseCategoryKey {
  const key = String(value || 'Other')
  return validExpenseCategories.includes(key as ExpenseCategoryKey) ? (key as ExpenseCategoryKey) : 'Other'
}

function normalizePaymentMethod(value: string | null | undefined): ExpensePaymentMethodKey {
  const key = String(value || 'Cash')
  return validPaymentMethods.includes(key as ExpensePaymentMethodKey) ? (key as ExpensePaymentMethodKey) : 'Cash'
}

export function normalizeExpense(expense: ApiBusinessExpense | null | undefined, index = 0): BusinessExpense {
  return {
    id: expense?.id || `expense-${index}`,
    tenantId: expense?.tenantId,
    branchId: expense?.branchId ?? null,
    category: normalizeExpenseCategory(expense?.category),
    amount: Number(expense?.amount || 0),
    paymentMethod: normalizePaymentMethod(expense?.paymentMethod),
    occurredAt: expense?.occurredAtUtc || '',
    staffMemberId: expense?.staffMemberId ?? null,
    staffName: expense?.staffName || '',
    periodLabel: expense?.periodLabel || '',
    description: expense?.description || '',
    reference: expense?.reference || '',
    isApproved: expense?.isApproved ?? false,
    approvedAt: expense?.approvedAtUtc || null,
    createdAt: expense?.createdAtUtc || '',
  }
}

export function normalizeCustomCategory(category: ApiCustomExpenseCategory | null | undefined, index = 0): CustomExpenseCategory {
  return {
    id: category?.id || `custom-cat-${index}`,
    tenantId: category?.tenantId,
    name: category?.name || `Kategori ${index + 1}`,
    isActive: category?.isActive ?? true,
    createdAt: category?.createdAtUtc || '',
  }
}

export function normalizeCustomServiceCategory(category: ApiCustomServiceCategory | null | undefined, index = 0): CustomServiceCategory {
  return {
    id: category?.id || `custom-svc-cat-${index}`,
    tenantId: category?.tenantId,
    name: category?.name || `Kategori ${index + 1}`,
    isActive: category?.isActive ?? true,
    createdAt: category?.createdAtUtc || '',
  }
}

export function normalizeExpenseSummary(summary: ApiExpenseSummary | null | undefined): ExpenseSummary {
  return {
    totalAmount: Number(summary?.totalAmount || 0),
    count: Number(summary?.count || 0),
    byCategory: (summary?.byCategory || []).map((c) => ({
      category: normalizeExpenseCategory(c.category),
      totalAmount: Number(c.totalAmount || 0),
      count: Number(c.count || 0),
    })),
    byStaff: (summary?.byStaff || []).map((s) => ({
      staffMemberId: s.staffMemberId || '',
      staffName: s.staffName || 'Personel',
      totalAmount: Number(s.totalAmount || 0),
      count: Number(s.count || 0),
    })),
  }
}

function normalizeCashFlowMethod(method: string | null | undefined): { key: CashFlowMethodKey; raw: string } {
  const raw = String(method || '').trim()
  const m = raw.toLowerCase()
  if (m.includes('cash') || m.includes('nakit')) return { key: 'cash', raw }
  if (m.includes('card') || m.includes('kart')) return { key: 'card', raw }
  if (m.includes('transfer') || m.includes('havale') || m.includes('eft') || m.includes('bank')) return { key: 'transfer', raw }
  if (m.includes('check') || m.includes('çek')) return { key: 'check', raw }
  return { key: 'unknown', raw }
}

const cashFlowMethodLabels: Record<CashFlowMethodKey, string> = {
  cash: 'Nakit',
  card: 'Kart',
  transfer: 'Havale / EFT',
  check: 'Çek',
  unknown: 'Diğer',
}

export function cashFlowMethodLabel(key: CashFlowMethodKey): string {
  return cashFlowMethodLabels[key]
}

const cashFlowMethodTones: Record<CashFlowMethodKey, string> = {
  cash: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-200',
  card: 'border-sky-300/30 bg-sky-400/12 text-sky-200',
  transfer: 'border-violet-300/30 bg-violet-400/12 text-violet-200',
  check: 'border-amber-300/30 bg-amber-400/12 text-amber-200',
  unknown: 'border-[#fff4f8]/20 bg-[#fff4f8]/8 text-[#fff4f8]/70',
}

export function cashFlowMethodTone(key: CashFlowMethodKey): string {
  return cashFlowMethodTones[key]
}

export function normalizeCashFlowEntry(entry: ApiCashFlowEntry | null | undefined, index = 0): CashFlowEntry {
  const typeRaw = entry?.type
  const type: CashFlowEntryTypeKey =
    typeRaw === 'Income' || typeRaw === 0 || String(typeRaw).toLowerCase() === 'income' ? 'income' : 'expense'
  const occurredAt = entry?.occurredAtUtc || ''
  const d = parseUtc(occurredAt) ?? new Date()
  const date = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const method = normalizeCashFlowMethod(entry?.method)
  return {
    id: entry?.id || `cf-${index}`,
    type,
    occurredAt,
    date,
    time,
    amount: Number(entry?.amount || 0),
    method: method.key,
    methodRaw: method.raw,
    category: entry?.category || '',
    description: entry?.description || '',
    reference: entry?.reference || '',
    customerName: entry?.customerName || '',
    staffName: entry?.staffName || '',
    accountName: entry?.accountName || '',
    isApproved: entry?.isApproved ?? false,
  }
}

export function normalizeCashFlowSummary(summary: ApiCashFlowSummary | null | undefined): CashFlowSummary {
  return {
    totalIncome: Number(summary?.totalIncome || 0),
    totalExpense: Number(summary?.totalExpense || 0),
    netAmount: Number(summary?.netAmount || 0),
    incomeCount: Number(summary?.incomeCount || 0),
    expenseCount: Number(summary?.expenseCount || 0),
    byMethod: (summary?.byMethod || []).map((m) => {
      const norm = normalizeCashFlowMethod(m.method)
      return {
        method: norm.key,
        methodRaw: norm.raw,
        incomeAmount: Number(m.incomeAmount || 0),
        expenseAmount: Number(m.expenseAmount || 0),
        count: Number(m.count || 0),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Stok normalizasyon
// ---------------------------------------------------------------------------

export const productCategoryLabels: Record<ProductCategoryKey, string> = {
  SkinCare: 'Cilt Bakım',
  Consumable: 'Sarf Malzeme',
  Sale: 'Satış Ürünü',
  HairCare: 'Saç Bakım',
  Makeup: 'Makyaj',
  NailCare: 'Tırnak Bakım',
  Other: 'Diğer',
}

export const stockMovementLabels: Record<StockMovementTypeKey, string> = {
  Inbound: 'Giriş',
  Outbound: 'Çıkış',
  Sale: 'Satış',
  Adjustment: 'Sayım',
  Damage: 'Fire',
}

export const stockMovementTones: Record<StockMovementTypeKey, string> = {
  Inbound: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-200',
  Outbound: 'border-sky-300/30 bg-sky-400/12 text-sky-200',
  Sale: 'border-violet-300/30 bg-violet-400/12 text-violet-200',
  Adjustment: 'border-amber-300/30 bg-amber-400/12 text-amber-200',
  Damage: 'border-rose-300/30 bg-rose-400/12 text-rose-200',
}

const validProductCategories: ProductCategoryKey[] = ['SkinCare', 'Consumable', 'Sale', 'HairCare', 'Makeup', 'NailCare', 'Other']

function normalizeProductCategory(value: string | null | undefined): ProductCategoryKey {
  const key = String(value || 'Other')
  return validProductCategories.includes(key as ProductCategoryKey) ? (key as ProductCategoryKey) : 'Other'
}

const validMovementTypes: StockMovementTypeKey[] = ['Inbound', 'Outbound', 'Sale', 'Adjustment', 'Damage']

function normalizeMovementType(value: string | number | null | undefined): StockMovementTypeKey {
  if (typeof value === 'number') {
    return validMovementTypes[value] || 'Outbound'
  }
  const key = String(value || 'Outbound')
  return validMovementTypes.includes(key as StockMovementTypeKey) ? (key as StockMovementTypeKey) : 'Outbound'
}

export function normalizeProduct(product: ApiProduct | null | undefined, index = 0): Product {
  const cost = Number(product?.cost || 0)
  const sale = Number(product?.salePrice || 0)
  const margin = sale > 0 ? sale - cost : 0
  const marginPct = sale > 0 ? Math.round((margin / sale) * 100) : 0
  const stock = Number(product?.currentStock || 0)
  const min = Number(product?.minStockLevel || 0)
  let status: ProductStatusKey = 'sufficient'
  if (product?.isOutOfStock ?? stock <= 0) status = 'out'
  else if (product?.isCritical ?? stock <= min) status = 'critical'
  const cat = normalizeProductCategory(product?.category)
  return {
    id: product?.id || `product-${index}`,
    tenantId: product?.tenantId,
    branchId: product?.branchId ?? null,
    name: product?.name || `Ürün ${index + 1}`,
    sku: product?.sku || '',
    category: cat,
    categoryLabel: productCategoryLabels[cat],
    unit: product?.unit || 'adet',
    supplier: product?.supplier || '',
    location: product?.location || '',
    cost,
    salePrice: sale,
    currentStock: stock,
    minStockLevel: min,
    isActive: product?.isActive ?? true,
    isOutOfStock: status === 'out',
    isCritical: status === 'critical',
    barcode: product?.barcode || '',
    imageUrl: product?.imageUrl || '',
    brand: product?.brand || '',
    taxRatePercent: product?.taxRatePercent ?? null,
    expiryDate: (product?.expiryDate || '').slice(0, 10),
    lotNumber: product?.lotNumber || '',
    pendingInbound: Number(product?.pendingInbound || 0),
    leadTimeDays: Number(product?.leadTimeDays || 0),
    updatedAt: (() => {
      const d = parseUtc(product?.updatedAtUtc || product?.createdAtUtc)
      if (!d) return ''
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    })(),
    status,
    margin,
    marginPct,
    stockValueCost: stock * cost,
    stockValueSale: stock * sale,
  }
}

export function normalizeStockMovement(m: ApiStockMovement | null | undefined, index = 0): StockMovement {
  const occurredAt = m?.occurredAtUtc || ''
  const d = parseUtc(occurredAt) ?? new Date()
  const date = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return {
    id: m?.id || `movement-${index}`,
    productId: m?.productId || '',
    productName: m?.productName || '',
    productSku: m?.productSku || '',
    type: normalizeMovementType(m?.type),
    quantity: Number(m?.quantity || 0),
    unitCost: Number(m?.unitCost || 0),
    totalCost: Number(m?.totalCost || 0),
    occurredAt,
    date,
    time,
    reference: m?.reference || '',
    notes: m?.notes || '',
    staffName: m?.staffName || '',
  }
}

export function normalizeStockSummary(s: ApiStockSummary | null | undefined): StockSummary {
  return {
    totalProducts: Number(s?.totalProducts || 0),
    criticalCount: Number(s?.criticalCount || 0),
    outOfStockCount: Number(s?.outOfStockCount || 0),
    stockValueAtCost: Number(s?.stockValueAtCost || 0),
    stockValueAtSale: Number(s?.stockValueAtSale || 0),
    byCategory: (s?.byCategory || []).map((c) => {
      const cat = normalizeProductCategory(c.category)
      return {
        category: cat,
        categoryLabel: productCategoryLabels[cat],
        productCount: Number(c.productCount || 0),
        stockValueAtCost: Number(c.stockValueAtCost || 0),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Pending Operations
// ---------------------------------------------------------------------------

export const pendingOperationLabels: Record<PendingOperationTypeKey, string> = {
  CreateCustomer: 'Müşteri ekleme',
  UpdateCustomer: 'Müşteri güncelleme',
  DeleteCustomer: 'Müşteri silme',
  CreateAppointment: 'Yeni randevu',
  UpdateAppointment: 'Randevu güncelleme',
  ChangeAppointmentStatus: 'Randevu durumu',
  DeleteAppointment: 'Randevu silme',
  CreateExpense: 'Gider ekleme',
  DeleteExpense: 'Gider silme',
  CreateAccount: 'Cari hesap aç',
  RegisterAccountPayment: 'Tahsilat al',
  RescheduleAccount: 'Taksit değiştir',
  CreateStockMovement: 'Stok hareketi',
  CreateProduct: 'Ürün ekleme',
  HttpReplay: 'Personel işlemi',
  Other: 'Diğer',
}

const validOpTypes: PendingOperationTypeKey[] = Object.keys(pendingOperationLabels) as PendingOperationTypeKey[]
const validOpStatuses: PendingOperationStatusKey[] = ['Pending', 'Approved', 'Rejected', 'Cancelled']

function normalizeOpType(value: string | number | null | undefined): PendingOperationTypeKey {
  if (typeof value === 'number') {
    // Backend enum integer değeri
    const enumMap: Record<number, PendingOperationTypeKey> = {
      0: 'CreateCustomer', 1: 'UpdateCustomer', 2: 'DeleteCustomer',
      10: 'CreateAppointment', 11: 'UpdateAppointment', 12: 'ChangeAppointmentStatus', 13: 'DeleteAppointment',
      20: 'CreateExpense', 21: 'DeleteExpense',
      30: 'CreateAccount', 31: 'RegisterAccountPayment', 32: 'RescheduleAccount',
      40: 'CreateStockMovement', 41: 'CreateProduct',
      100: 'HttpReplay',
      99: 'Other',
    }
    return enumMap[value] || 'Other'
  }
  const key = String(value || 'Other')
  return validOpTypes.includes(key as PendingOperationTypeKey) ? (key as PendingOperationTypeKey) : 'Other'
}

function normalizeOpStatus(value: string | number | null | undefined): PendingOperationStatusKey {
  if (typeof value === 'number') return validOpStatuses[value] || 'Pending'
  const key = String(value || 'Pending')
  return validOpStatuses.includes(key as PendingOperationStatusKey) ? (key as PendingOperationStatusKey) : 'Pending'
}

export function normalizePendingOperation(op: ApiPendingOperation | null | undefined, index = 0): PendingOperation {
  const opType = normalizeOpType(op?.operationType)
  let payload: Record<string, unknown> | null = null
  try {
    payload = op?.payloadJson ? (JSON.parse(op.payloadJson) as Record<string, unknown>) : null
  } catch {
    payload = null
  }
  const requestedAt = op?.requestedAtUtc || ''
  const d = parseUtc(requestedAt)
  const requestedAtFormatted = d && !isNaN(d.getTime())
    ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
    : ''
  return {
    id: op?.id || `pending-${index}`,
    tenantId: op?.tenantId,
    branchId: op?.branchId ?? null,
    requestedByUserId: op?.requestedByUserId || '',
    requestedByName: op?.requestedByName || 'Personel',
    operationType: opType,
    operationTypeLabel: pendingOperationLabels[opType],
    title: op?.title || pendingOperationLabels[opType],
    summary: op?.summary || '',
    payload,
    status: normalizeOpStatus(op?.status),
    requestedAt,
    requestedAtFormatted,
    decidedAt: op?.decidedAtUtc || null,
    rejectionReason: op?.rejectionReason || '',
    resultEntityId: op?.resultEntityId || null,
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationChannelLabels: Record<NotificationChannelKey, string> = {
  Sms: 'SMS',
  WhatsApp: 'WhatsApp',
  Email: 'E-posta',
}
const channelEnumMap: Record<number, NotificationChannelKey> = { 0: 'Sms', 1: 'WhatsApp', 2: 'Email' }
const validChannels: NotificationChannelKey[] = ['Sms', 'WhatsApp', 'Email']

export const notificationTriggerLabels: Record<NotificationTriggerKey, string> = {
  Manual: 'Manuel gönderim',
  AppointmentReminder: 'Randevu hatırlatma',
  BirthdayGreeting: 'Doğum günü',
  PaymentDue: 'Ödeme hatırlatma',
  Campaign: 'Kampanya',
  WinBack: 'Geri kazanım (pasif müşteri)',
}
const triggerEnumMap: Record<number, NotificationTriggerKey> = {
  0: 'Manual', 1: 'AppointmentReminder', 2: 'BirthdayGreeting', 3: 'PaymentDue', 4: 'Campaign', 5: 'WinBack',
}
const validTriggers: NotificationTriggerKey[] = ['Manual', 'AppointmentReminder', 'BirthdayGreeting', 'PaymentDue', 'Campaign', 'WinBack']

export const notificationTemplateStatusLabels: Record<NotificationTemplateStatusKey, string> = {
  Draft: 'Taslak',
  Active: 'Aktif',
  PendingApproval: 'Meta onayında',
}
const tplStatusEnumMap: Record<number, NotificationTemplateStatusKey> = { 0: 'Draft', 1: 'Active', 2: 'PendingApproval' }
const validTplStatuses: NotificationTemplateStatusKey[] = ['Draft', 'Active', 'PendingApproval']

export const notificationLogStatusLabels: Record<NotificationLogStatusKey, string> = {
  Queued: 'Kuyrukta',
  Sent: 'Gönderildi',
  Failed: 'Başarısız',
}
const logStatusEnumMap: Record<number, NotificationLogStatusKey> = { 0: 'Queued', 1: 'Sent', 2: 'Failed' }
const validLogStatuses: NotificationLogStatusKey[] = ['Queued', 'Sent', 'Failed']

function normalizeChannel(v: unknown): NotificationChannelKey {
  if (typeof v === 'number') return channelEnumMap[v] || 'Sms'
  const k = String(v ?? 'Sms') as NotificationChannelKey
  return validChannels.includes(k) ? k : 'Sms'
}
function normalizeTrigger(v: unknown): NotificationTriggerKey {
  if (typeof v === 'number') return triggerEnumMap[v] || 'Manual'
  const k = String(v ?? 'Manual') as NotificationTriggerKey
  return validTriggers.includes(k) ? k : 'Manual'
}
function normalizeTemplateStatus(v: unknown): NotificationTemplateStatusKey {
  if (typeof v === 'number') return tplStatusEnumMap[v] || 'Draft'
  const k = String(v ?? 'Draft') as NotificationTemplateStatusKey
  return validTplStatuses.includes(k) ? k : 'Draft'
}
function normalizeLogStatus(v: unknown): NotificationLogStatusKey {
  if (typeof v === 'number') return logStatusEnumMap[v] || 'Queued'
  const k = String(v ?? 'Queued') as NotificationLogStatusKey
  return validLogStatuses.includes(k) ? k : 'Queued'
}

function formatDateTime(iso: string | null | undefined): string {
  // UTC damgasını doğru çöz (cihaz timezone'una göre yerel saat gösterilir).
  const d = parseUtc(iso)
  if (!d) return ''
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

export function normalizeNotificationTemplate(t: ApiNotificationTemplate | null | undefined, index = 0): NotificationTemplate {
  const channel = normalizeChannel(t?.channel)
  const trigger = normalizeTrigger(t?.trigger)
  const status = normalizeTemplateStatus(t?.status)
  return {
    id: t?.id || `tpl-${index}`,
    branchId: t?.branchId ?? null,
    name: t?.name || '',
    channel,
    channelLabel: notificationChannelLabels[channel],
    trigger,
    triggerLabel: notificationTriggerLabels[trigger],
    body: t?.body || '',
    status,
    statusLabel: notificationTemplateStatusLabels[status],
    totalSentCount: t?.totalSentCount ?? 0,
    lastSentAt: t?.lastSentAtUtc ?? null,
    lastSentAtFormatted: formatDateTime(t?.lastSentAtUtc),
    createdAt: t?.createdAtUtc || '',
  }
}

export function normalizeNotificationLog(l: ApiNotificationLog | null | undefined, index = 0): NotificationLog {
  const channel = normalizeChannel(l?.channel)
  const status = normalizeLogStatus(l?.status)
  return {
    id: l?.id || `log-${index}`,
    templateId: l?.templateId ?? null,
    templateName: l?.templateName || '',
    customerId: l?.customerId ?? null,
    customerName: l?.customerName || '',
    channel,
    channelLabel: notificationChannelLabels[channel],
    recipient: l?.recipient || '',
    body: l?.body || '',
    status,
    statusLabel: notificationLogStatusLabels[status],
    errorMessage: l?.errorMessage || '',
    sentAt: l?.sentAtUtc ?? null,
    sentAtFormatted: formatDateTime(l?.sentAtUtc),
    createdAt: l?.createdAtUtc || '',
    createdAtFormatted: formatDateTime(l?.createdAtUtc),
  }
}

export function normalizeNotificationSummary(s: ApiNotificationSummary | null | undefined): NotificationSummary {
  return {
    totalTemplates: s?.totalTemplates ?? 0,
    activeTemplates: s?.activeTemplates ?? 0,
    todaySent: s?.todaySent ?? 0,
    todayFailed: s?.todayFailed ?? 0,
    todayQueued: s?.todayQueued ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Feature mappers
// ---------------------------------------------------------------------------

export const FEATURE_CATEGORY_LABELS: Record<FeatureCategoryKey, string> = {
  Excel: 'Excel İçe / Dışa Aktarma',
  Pdf: 'PDF Üretimi',
  Reports: 'Raporlar',
  Notifications: 'Bildirimler',
  Accounting: 'Ön Muhasebe',
  Operations: 'Operasyon',
  Organization: 'Kurum & Sistem',
}

export const FEATURE_CATEGORY_ICONS: Record<FeatureCategoryKey, string> = {
  Excel: 'FileSpreadsheet',
  Pdf: 'FileText',
  Reports: 'BarChart3',
  Notifications: 'BellRing',
  Accounting: 'Wallet',
  Operations: 'Settings2',
  Organization: 'Building2',
}

export function normalizeFeatureCatalog(c: ApiFeatureCatalog | null | undefined): FeatureCatalogItem[] {
  const items = c?.items ?? []
  return items.map((it) => ({
    key: (it.key ?? '') as FeatureKey,
    name: it.name ?? '',
    description: it.description ?? '',
    category: (it.category ?? 'Organization') as FeatureCategoryKey,
    categoryOrder: it.categoryOrder ?? 0,
  }))
}

export function normalizeTenantFeatures(t: ApiTenantFeatures | null | undefined): TenantFeatures {
  const active = new Set<FeatureKey>()
  for (const f of t?.activeFeatures ?? []) {
    if (f) active.add(f as FeatureKey)
  }
  return {
    tenantId: t?.tenantId ?? '',
    planId: t?.planId ?? null,
    planKey: t?.planKey ?? '',
    planName: t?.planName ?? '',
    activeFeatures: active,
  }
}

export function groupFeaturesByCategory(items: FeatureCatalogItem[]):
  Array<{ category: FeatureCategoryKey; label: string; items: FeatureCatalogItem[] }> {
  const map = new Map<FeatureCategoryKey, FeatureCatalogItem[]>()
  for (const f of items) {
    const arr = map.get(f.category) ?? []
    arr.push(f)
    map.set(f.category, arr)
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[1][0]?.categoryOrder ?? 0) - (b[1][0]?.categoryOrder ?? 0))
    .map(([category, items]) => ({
      category,
      label: FEATURE_CATEGORY_LABELS[category] ?? category,
      items,
    }))
}

export function appointmentStatusKey(status: string | null | undefined): AppointmentStatusKey {
  const key = String(status || 'Scheduled').toLowerCase()
  if (['draft', 'taslak', 'pendingapproval'].includes(key)) return 'taslak'
  if (['completed', 'tamamlandi', 'tamamlandı'].includes(key)) return 'tamamlandi'
  if (['confirmed', 'inprogress', 'devam', 'arrived'].includes(key)) return 'devam'
  if (['cancelled', 'canceled', 'noshow', 'no_show', 'gelmedi', 'iptal'].includes(key)) return 'iptal'
  return 'bekliyor'
}

export function statusLabel(statusKey: AppointmentStatusKey): string {
  return statusKey === 'tamamlandi'
    ? 'Tamamlandı'
    : statusKey === 'devam'
      ? 'Devam'
      : statusKey === 'iptal'
        ? 'İptal'
        : statusKey === 'taslak'
          ? 'Taslak'
          : 'Bekliyor'
}

export function isoDate(value: string | Date | null | undefined): string {
  // Backend UTC string'i ('Z'siz olabilir) doğru çözülür; Date objesi aynen kullanılır.
  const d = (value ? parseUtc(value) : null) ?? new Date()
  return d.toISOString().slice(0, 10)
}

export function timeHHMM(value: string | Date | null | undefined): string {
  const d = (value ? parseUtc(value) : null) ?? new Date()
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export function normalizeAppointment(
  appointment: ApiAppointment | null | undefined,
  lookups: AppointmentLookups = {},
  index = 0,
): Appointment {
  const start = parseUtc(appointment?.startUtc) ?? new Date()
  const end = parseUtc(appointment?.endUtc)
  const duration =
    end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : 0
  const customer = appointment?.customerId ? lookups.customers?.[appointment.customerId] : undefined
  const staff = appointment?.staffMemberId ? lookups.staff?.[appointment.staffMemberId] : undefined
  const service = appointment?.serviceDefinitionId ? lookups.services?.[appointment.serviceDefinitionId] : undefined
  const status = appointmentStatusKey(appointment?.status)
  return {
    id: appointment?.id || `appointment-${index}`,
    tenantId: appointment?.tenantId,
    branchId: appointment?.branchId,
    customerId: appointment?.customerId,
    staffMemberId: appointment?.staffMemberId,
    serviceDefinitionId: appointment?.serviceDefinitionId,
    // Gösterilen yerel saatle aynı güne düşsün diye yerel gün anahtarı (UTC günü değil).
    date: localDateKey(appointment?.startUtc),
    time: timeHHMM(appointment?.startUtc),
    musteri: appointment?.customerName || customer?.fullName || customer?.name || `Müşteri ${shortId(appointment?.customerId)}`,
    islem: appointment?.serviceName || service?.name || `Hizmet ${shortId(appointment?.serviceDefinitionId)}`,
    personel: appointment?.staffName || staff?.fullName || staff?.name || `Personel ${shortId(appointment?.staffMemberId)}`,
    status,
    sure: duration,
    price: Number(appointment?.price || 0),
    notes: appointment?.notes || appointment?.cancellationReason || '',
    rawStatus: appointment?.status,
    customerConfirmation: appointment?.customerConfirmation,
    lastReminderAtUtc: appointment?.lastReminderAtUtc,
    isOnline: Boolean(appointment?.isOnline),
  }
}

export function monthLabel(dateText: string | null | undefined): string {
  const d = dateText ? new Date(`${dateText}T12:00:00`) : new Date()
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
}

export function dayTitle(dateText: string | null | undefined): string {
  const d = dateText ? new Date(`${dateText}T12:00:00`) : new Date()
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
}

export function realModuleNotice(moduleName: string): string {
  return `${moduleName} backend modeli henüz yok. Bu ekranda fake operasyon verisi gösterilmiyor; backend'e paket satışı/ödeme/stok/audit modeli eklendiğinde burası aynı API client üzerinden bağlanacak.`
}
