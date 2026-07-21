// BeautyAsist — merkezi tip tanımları
// Backend DTO'ları (Api*) ve UI model katmanı (normalize edilmiş) burada.

// ---------------------------------------------------------------------------
// Ortak / API zarfı
// ---------------------------------------------------------------------------

export interface ApiErrorPayload {
  code?: string
  message?: string
  detail?: string
}

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: ApiErrorPayload
  traceId?: string | null
}

export interface PagedResult<T> {
  items: T[]
  total?: number
  totalCount?: number
  page?: number
  pageSize?: number
}

export type ApiResultOrArray<T> = PagedResult<T> | T[] | null | undefined

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  headers?: HeadersInit
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  token?: string | null
  scope?: ApiScope | false
  cache?: RequestCache
  /** true ise GET yanıt önbelleğini atla (her zaman taze çek). */
  noCache?: boolean
  /** İç kullanım: 401 sonrası token yenilenip istek bir kez tekrar denendiğinde işaretlenir (sonsuz döngü koruması). */
  _retry?: boolean
  /** İç kullanım: çevrimdışı kuyruk tekrar oynatması — ağ hatasında yeniden kuyruklama YAPILMAZ. */
  _outboxBypass?: boolean
}

export interface ApiScope {
  tenantId: string | null
  branchId: string | null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type UserRole = 'PlatformAdmin' | 'InstitutionOwner' | 'BranchManager' | 'Staff'
export type RoleKey = 'admin' | 'personel' | 'platform'

export interface ApiUser {
  userId: string
  email: string
  fullName?: string | null
  role: UserRole
  tenantId?: string | null
  branchId?: string | null
  permissions?: string[] | null
  mustChangePassword?: boolean
}

export interface ApiStaffCredentials {
  staffId?: string
  fullName?: string
  email?: string
  initialPassword?: string
  tenantName?: string
  branchName?: string | null
  createdAtUtc?: string
}

export interface ApiStaffWithCredentials {
  staff?: ApiStaff & { email?: string | null; permissions?: string[] }
  credentials?: ApiStaffCredentials | null
}

export interface PermissionActionMeta {
  key: string
  label: string
}

export interface PermissionMeta {
  key: string
  label: string
  description: string
  /** Sayfa altındaki işlem (aksiyon) izinleri — "görsün ama yapamasın" ayrımı için. */
  actions?: PermissionActionMeta[]
}

export interface ApiLoginResponse {
  accessToken: string
  refreshToken: string
  expiresAtUtc: string
  user: ApiUser
}

export interface ApiLoginScopeBranch {
  branchId: string
  branchName: string
  city?: string
  isDefault?: boolean
  staff?: number
  rooms?: number
}

export interface ApiLoginScopeTenant {
  tenantId: string
  tenantName: string
  plan?: string
  status?: string
  branches: ApiLoginScopeBranch[]
}

export interface ApiLoginScopeResponse {
  email?: string
  /** Rol gönderilmeden sorgulandıysa backend'in e-postadan tespit ettiği rol. */
  role?: UserRole | null
  tenants: ApiLoginScopeTenant[]
}

export interface SessionUser {
  userId: string
  email: string
  fullName?: string | null
  role: UserRole
  roleLabel: string
  tenantId?: string | null
  branchId?: string | null
  permissions: string[]
  mustChangePassword?: boolean
  avatar: string
}

export interface SessionScope {
  tenants: Institution[]
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAtUtc: string
  user: SessionUser
  scope: SessionScope | null
  selectedTenantId: string | null
  selectedBranchId: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Tenant / Institution / Branch (Platform + Admin)
// ---------------------------------------------------------------------------

export interface ApiBranch {
  id?: string
  branchId?: string
  name?: string
  branchName?: string
  city?: string
  isDefault?: boolean
  // Backend BranchDto bunları `staffCount`/`roomCount` olarak döndürür; eski `staff`/`rooms` login-scope içindir.
  staffCount?: number
  roomCount?: number
  staff?: number
  rooms?: number
  todayAppointments?: number
  monthlyRevenue?: number
}

export interface ApiTenant {
  id?: string
  tenantId?: string
  name?: string
  tenantName?: string
  slug?: string
  city?: string
  plan?: string
  status?: string
  userCount?: number
  customerCount?: number
  users?: number
  customers?: number
  mrr?: number
  createdAt?: string
  joined?: string
  ownerName?: string
  owner?: string
  ownerEmail?: string
  domain?: string
  phone?: string | null
  taxNumber?: string | null
  legalName?: string | null
  taxOffice?: string | null
  email?: string | null
  currency?: string
  maxInstallments?: number
  overdueGraceDays?: number
  branchCount?: number
  branches?: ApiBranch[]
  subscriptionPlanId?: string | null
  subscriptionPlanKey?: string | null
  subscriptionPlanName?: string | null
  subscriptionPlanMonthlyPriceTRY?: number
  subscriptionPlanYearlyPriceTRY?: number
  trialEndsAtUtc?: string | null
  /** Ücretli abonelik dönemi: "Monthly" | "Yearly" | null (deneme/süresiz). */
  subscriptionPeriod?: string | null
  /** Ücretli abonelik bitiş tarihi (ISO). Null ise süresiz/deneme. */
  subscriptionEndsAtUtc?: string | null
}

export interface ApiTenantAvailabilityConflict {
  field: 'name' | 'slug' | 'domain' | 'ownerEmail' | string
  value?: string | null
  message: string
  suggestedValue?: string | null
}

export interface ApiTenantAvailability {
  name?: string | null
  suggestedName: string
  nameAvailable: boolean
  suggestedSlug: string
  slugAvailable: boolean
  suggestedDomain: string
  domainAvailable: boolean
  suggestedOwnerEmail: string
  ownerEmailAvailable: boolean
  conflicts: ApiTenantAvailabilityConflict[]
}

/** Kurum oluşturulurken şifre boş bırakıldıysa dönen otomatik yetkili giriş bilgileri. */
export interface ApiTenantCredentials {
  tenantId?: string
  ownerName?: string
  email?: string
  initialPassword?: string
  tenantName?: string
  branchName?: string | null
  mustChangePassword?: boolean
  createdAtUtc?: string
}

export interface ApiTenantWithCredentials {
  tenant?: ApiTenant
  /** Geriye uyumluluk: ilk (birincil) yöneticinin bilgileri. */
  credentials?: ApiTenantCredentials | null
  /** Otomatik şifre üretilen TÜM kurum yöneticileri (birincil + ek). */
  allCredentials?: ApiTenantCredentials[] | null
}

export type TenantStatusKey = 'active' | 'trial' | 'paused'

export interface Branch {
  id: string
  branchId: string
  name: string
  branchName: string
  city: string
  isDefault: boolean
  staff: number
  rooms: number
  todayAppointments: number
  monthlyRevenue: number
}

export interface Institution {
  id: string
  tenantId: string
  name: string
  tenantName: string
  plan: string
  status: string
  branches: Branch[]
}

export interface Tenant {
  id: string
  name: string
  slug: string
  city: string
  plan: string
  status: TenantStatusKey
  users: number
  customers: number
  mrr: number
  joined: string
  owner: string
  domain: string
  phone: string
  taxNumber: string
  email: string
  legalName: string
  taxOffice: string
  currency: string
  maxInstallments: number
  overdueGraceDays: number
  ownerName: string
  health: number
  lastSync: string
  storage: number
  invoicesOpen: number
  loginEmails: string[]
  branchCount: number
  branches: ApiBranch[]
  subscriptionPlanId: string | null
  subscriptionPlanKey: string
  subscriptionPlanName: string
  subscriptionPlanMonthlyPriceTRY: number
  subscriptionPlanYearlyPriceTRY: number
  trialEndsAt: string | null
  /** Ücretli abonelik dönemi: "Monthly" | "Yearly" | null (deneme/süresiz). */
  subscriptionPeriod: string | null
  /** Ücretli abonelik bitiş tarihi (ISO). Null ise süresiz/deneme. */
  subscriptionEndsAt: string | null
}

// ---------------------------------------------------------------------------
// Subscription Plans & Usage
// ---------------------------------------------------------------------------

export interface ApiSubscriptionPlan {
  id?: string
  planKey?: string
  name?: string
  description?: string | null
  monthlyPriceTRY?: number
  yearlyPriceTRY?: number
  maxBranches?: number
  maxStaff?: number
  maxCustomers?: number
  maxMonthlyAppointments?: number
  maxMonthlySmsCount?: number
  maxMonthlyWhatsAppCount?: number
  maxMonthlyEmailCount?: number
  features?: string | null
  displayOrder?: number
  isActive?: boolean
  tenantCount?: number
}

export interface SubscriptionPlan {
  id: string
  planKey: string
  name: string
  description: string
  monthlyPriceTRY: number
  yearlyPriceTRY: number
  maxBranches: number
  maxStaff: number
  maxCustomers: number
  maxMonthlyAppointments: number
  maxMonthlySmsCount: number
  maxMonthlyWhatsAppCount: number
  maxMonthlyEmailCount: number
  features: string[]
  displayOrder: number
  isActive: boolean
  tenantCount: number
}

export interface ApiUsageMetric {
  key?: string
  label?: string
  used?: number
  limit?: number
  isUnlimited?: boolean
  percent?: number
  isOver?: boolean
  isWarning?: boolean
}

export interface UsageMetric {
  key: string
  label: string
  used: number
  limit: number
  isUnlimited: boolean
  percent: number
  isOver: boolean
  isWarning: boolean
}

export interface ApiTenantUsage {
  tenantId?: string
  tenantName?: string
  subscriptionPlanId?: string | null
  planName?: string | null
  planKey?: string | null
  planMonthlyPriceTRY?: number
  metrics?: ApiUsageMetric[]
  hasAnyOverflow?: boolean
  hasWarning?: boolean
  maxPercent?: number
}

export interface TenantUsage {
  tenantId: string
  tenantName: string
  subscriptionPlanId: string | null
  planName: string
  planKey: string
  planMonthlyPriceTRY: number
  metrics: UsageMetric[]
  hasOverflow: boolean
  hasWarning: boolean
  maxPercent: number
}

export interface ApiPlanUsageBreakdown {
  planId?: string | null
  planKey?: string
  planName?: string
  tenantCount?: number
  monthlyRevenueTRY?: number
}

export interface PlanUsageBreakdown {
  planId: string | null
  planKey: string
  planName: string
  tenantCount: number
  monthlyRevenueTRY: number
}

export interface ApiPlatformUsageSummary {
  totalTenants?: number
  activeTenants?: number
  trialTenants?: number
  pausedTenants?: number
  monthlyRecurringRevenueTRY?: number
  tenantsAtWarning?: number
  tenantsOverLimit?: number
  planBreakdown?: ApiPlanUsageBreakdown[]
  tenants?: ApiTenantUsage[]
}

export interface PlatformUsageSummary {
  totalTenants: number
  activeTenants: number
  trialTenants: number
  pausedTenants: number
  monthlyRecurringRevenueTRY: number
  tenantsAtWarning: number
  tenantsOverLimit: number
  planBreakdown: PlanUsageBreakdown[]
  tenants: TenantUsage[]
}

// ---------------------------------------------------------------------------
// Feature Catalog (Plan paketinde flag'lenebilir özellikler)
// ---------------------------------------------------------------------------

/**
 * FeatureCatalog.cs içindeki sabitlerle birebir eşleşir. Yeni özellik eklerken
 * önce backend'e ekleyip seed güncelle, sonra burayı genişlet.
 */
export type FeatureKey =
  // Excel
  | 'excel.customers' | 'excel.appointments' | 'excel.services'
  | 'excel.staff' | 'excel.branches' | 'excel.reports'
  // PDF
  | 'pdf.reports' | 'pdf.credentials'
  // Raporlar
  | 'reports.finance' | 'reports.customer' | 'reports.staff' | 'reports.services'
  // Bildirimler
  | 'notifications.sms' | 'notifications.whatsapp' | 'notifications.email'
  | 'notifications.bulk' | 'notifications.templates' | 'notifications.automation'
  // Ön Muhasebe
  | 'accounting.installments' | 'accounting.payments' | 'billing.adisyon'
  // Operasyon
  | 'stock.products' | 'stock.movements'
  | 'categories.expense.custom' | 'categories.service.custom'
  | 'audit.logs'
  // Klinik
  | 'clinical.consultation' | 'clinical.beforeafter' | 'clinical.customfields'
  // Müşteri / CRM
  | 'customers.blacklist' | 'customers.passive'
  // Personel
  | 'staff.commission' | 'staff.schedule'
  // Pazarlama
  | 'marketing.campaigns' | 'loyalty.points' | 'marketing.giftcards'
  // Faz 1 ek özellikler
  | 'finance.cashclosing' | 'appointments.waitlist'
  // Kurum & Sistem
  | 'staff.permissions' | 'approval.workflow' | 'multiBranch'
  | 'api.access' | 'ai.insights'
  // Güvenlik
  | 'security.devicecontrol'

export type FeatureCategoryKey =
  | 'Excel' | 'Pdf' | 'Reports' | 'Notifications'
  | 'Accounting' | 'Operations' | 'Organization'

export interface ApiFeatureCatalogItem {
  key?: string
  name?: string
  description?: string
  category?: string
  categoryOrder?: number
}

export interface ApiFeatureCatalog {
  items?: ApiFeatureCatalogItem[]
}

export interface FeatureCatalogItem {
  key: FeatureKey
  name: string
  description: string
  category: FeatureCategoryKey
  categoryOrder: number
}

export interface ApiTenantFeatures {
  tenantId?: string
  planId?: string | null
  planKey?: string | null
  planName?: string | null
  activeFeatures?: string[]
}

export interface TenantFeatures {
  tenantId: string
  planId: string | null
  planKey: string
  planName: string
  activeFeatures: Set<FeatureKey>
}

// ---------------------------------------------------------------------------
// Domain (Customer / Staff / Service / Appointment)
// ---------------------------------------------------------------------------

export type CustomerGender = 'Unspecified' | 'Female' | 'Male' | 'Other'

export interface ApiCustomer {
  id?: string
  tenantId?: string
  branchId?: string
  fullName?: string
  name?: string
  phone?: string
  email?: string | null
  birthDate?: string | null
  gender?: CustomerGender
  kvkkConsent?: boolean
  notes?: string | null
  photoUrl?: string | null
  isBlacklisted?: boolean
  blacklistReason?: string | null
  createdAtUtc?: string
  isVip?: boolean
}

export interface ApiPassiveCustomer {
  id?: string
  branchId?: string
  fullName?: string
  phone?: string
  email?: string | null
  lastActivityUtc?: string | null
  daysSinceActivity?: number
}

export interface ApiPassiveCustomerList {
  thresholdDays?: number
  items?: ApiPassiveCustomer[]
}

export interface Customer {
  id: string
  tenantId?: string
  branchId?: string
  name: string
  phone: string
  email: string
  city: string
  tier: string
  joined: string
  createdAt: string
  activePackages: number
  totalSpent: number
  debt: number
  remainingSessions: number
  lastVisit: string
  gender: CustomerGender
  notes: string
  photoUrl: string
  isBlacklisted: boolean
  blacklistReason?: string | null
  isVip: boolean
}

export type GiftCardKind = 'Percentage' | 'FixedAmount' | 'StoredValue'

export interface ApiGiftCard {
  id?: string
  tenantId?: string
  branchId?: string | null
  code?: string
  kind?: GiftCardKind
  value?: number
  balance?: number
  validUntilUtc?: string | null
  maxUses?: number
  usedCount?: number
  isActive?: boolean
  note?: string | null
  customerId?: string | null
  isValid?: boolean
}

export interface GiftCard {
  id: string
  code: string
  kind: GiftCardKind
  value: number
  balance: number
  validUntil: string | null
  maxUses: number
  usedCount: number
  isActive: boolean
  note: string
  customerId: string | null
  isValid: boolean
}

export type WaitlistStatus = 'Waiting' | 'Notified' | 'Booked' | 'Cancelled'

export interface ApiWaitlistEntry {
  id?: string
  tenantId?: string
  branchId?: string | null
  customerId?: string
  serviceDefinitionId?: string | null
  staffMemberId?: string | null
  preferredDate?: string
  status?: WaitlistStatus
  note?: string | null
  createdAtUtc?: string
  preferredStartUtc?: string | null
  durationMinutes?: number | null
  customerName?: string | null
  customerPhone?: string | null
}

export interface WaitlistEntry {
  id: string
  customerId: string
  serviceDefinitionId: string | null
  staffMemberId: string | null
  preferredDate: string
  status: WaitlistStatus
  note: string
  createdAt: string
  /** İstenen slotun tam başlangıcı (ISO UTC); saatsiz (eski) kayıtlarda null. */
  preferredStartUtc: string | null
  durationMinutes: number | null
  customerName?: string
  customerPhone?: string
}

export interface ApiCashClosing {
  id?: string
  branchId?: string | null
  businessDate?: string
  openingBalance?: number
  cashIncome?: number
  cashExpense?: number
  systemCash?: number
  countedCash?: number
  difference?: number
  note?: string | null
  createdAtUtc?: string
}

export interface CashClosing {
  id: string
  businessDate: string
  openingBalance: number
  cashIncome: number
  cashExpense: number
  systemCash: number
  countedCash: number
  difference: number
  note: string
  createdAt: string
}

export interface ApiCashClosingPreview {
  businessDate?: string
  cashIncome?: number
  cashExpense?: number
  suggestedOpening?: number
  systemCash?: number
  alreadyClosed?: boolean
}

export interface ApiStaff {
  id?: string
  tenantId?: string
  branchId?: string
  tenantUserId?: string | null
  fullName?: string
  name?: string
  title?: string
  role?: string
  specialties?: string
  dept?: string
  phone?: string
  email?: string | null
  isActive?: boolean
  active?: boolean
  permissions?: string[]
  sessionsThisMonth?: number
  performanceScore?: number
  commissionRate?: number
  photoUrl?: string | null
  averageRating?: number | null
  ratingCount?: number
}

export interface Staff {
  id: string
  tenantId?: string
  branchId?: string
  tenantUserId?: string | null
  name: string
  role: string
  dept: string
  /** Ham uzmanlık listesi (virgüllü kategori/hizmet adları) — boşsa kısıt yok. */
  specialties: string
  phone: string
  email?: string | null
  active: boolean
  permissions: string[]
  sessionsThisMonth: number
  performanceScore: number
  commissionRate?: number
  photoUrl: string
  averageRating?: number | null
  ratingCount?: number
}

// ---------- Personel çizelge / izin (4A) ----------
export interface ApiStaffTimeOff {
  id?: string
  staffMemberId?: string
  staffName?: string | null
  date?: string
  reason?: string | null
}

export interface StaffTimeOff {
  id: string
  staffMemberId: string
  staffName: string
  date: string
  reason: string
}

// ---------- Kampanya (4C) ----------
export type DiscountTypeKey = 'Percent' | 'Amount'
export type CampaignTargetKey = 'All' | 'Service' | 'Package'

export interface ApiCampaign {
  id?: string
  tenantId?: string
  branchId?: string | null
  name?: string
  discountType?: DiscountTypeKey | string
  discountValue?: number
  target?: CampaignTargetKey | string
  targetId?: string | null
  startDate?: string
  endDate?: string
  isActive?: boolean
  isRunning?: boolean
}

export interface Campaign {
  id: string
  tenantId?: string
  branchId: string | null
  name: string
  discountType: DiscountTypeKey
  discountValue: number
  target: CampaignTargetKey
  targetId: string | null
  startDate: string
  endDate: string
  isActive: boolean
  isRunning: boolean
}

// ---------- Sadakat / puan (4B) ----------
export interface ApiLoyaltyTransaction {
  id?: string
  customerId?: string
  points?: number
  sourceType?: string
  description?: string | null
  occurredAtUtc?: string
}

export interface ApiLoyaltyBalance {
  customerId?: string
  balance?: number
  totalEarned?: number
  totalRedeemed?: number
  history?: ApiLoyaltyTransaction[]
}

export interface LoyaltyTransaction {
  id: string
  points: number
  sourceType: string
  description: string
  occurredAtUtc: string
}

export interface LoyaltyBalance {
  customerId: string
  balance: number
  totalEarned: number
  totalRedeemed: number
  history: LoyaltyTransaction[]
}

export type CatalogStatusKey = 'Active' | 'Draft' | 'Passive' | 'Archived'

export interface ApiService {
  id?: string
  tenantId?: string
  branchId?: string
  name?: string
  category?: string
  subCategory?: string | null
  group?: string
  session?: number
  /** Varsayılan seans sayısı — paket oluşturmada ön-dolum (orada düzenlenebilir). */
  defaultSessionCount?: number
  price?: number
  durationMinutes?: number
  duration?: number
  isActive?: boolean
  iconKey?: string | null
  status?: CatalogStatusKey | string | number
  /** Sadakat puanı karşılığı hediye maliyeti (null/0 = hediye edilemez). */
  loyaltyPointCost?: number | null
}

export interface Service {
  id: string
  tenantId?: string
  branchId?: string
  group: string
  subGroup: string
  name: string
  session: number
  price: number
  duration: number
  isActive: boolean
  iconKey: string
  status: CatalogStatusKey
  /** Sadakat puanı karşılığı hediye maliyeti (0 = hediye edilemez). */
  loyaltyPointCost: number
}

export interface ApiServicePackageItem {
  serviceDefinitionId?: string
  serviceName?: string | null
  sessionCount?: number
  unitPrice?: number
}

export interface ApiServicePackage {
  id?: string
  tenantId?: string
  branchId?: string | null
  name?: string
  description?: string | null
  category?: string | null
  subCategory?: string | null
  totalPrice?: number
  depositAmount?: number
  installmentCount?: number
  isActive?: boolean
  items?: ApiServicePackageItem[]
  totalDurationMinutes?: number
  totalSessions?: number
  iconKey?: string | null
  status?: CatalogStatusKey | string | number
  updatedAtUtc?: string | null
  /** Sadakat puanı karşılığı hediye maliyeti (null/0 = hediye edilemez). */
  loyaltyPointCost?: number | null
}

export interface ServicePackageItem {
  serviceDefinitionId: string
  serviceName: string
  sessionCount: number
  unitPrice: number
}

export interface ServicePackage {
  id: string
  tenantId?: string
  branchId?: string | null
  name: string
  description: string
  category: string
  subCategory: string
  totalPrice: number
  depositAmount: number
  installmentCount: number
  isActive: boolean
  items: ServicePackageItem[]
  totalDurationMinutes: number
  totalSessions: number
  iconKey: string
  status: CatalogStatusKey
  updatedAt: string
  /** Sadakat puanı karşılığı hediye maliyeti (0 = hediye edilemez). */
  loyaltyPointCost: number
}

export type InstallmentStatusKey = 'Planned' | 'Paid' | 'Cancelled'

export interface ApiInstallment {
  id?: string
  no?: number
  dueDate?: string
  amount?: number
  /** Bu taksite dağıtılan tahsilat (kısmi/tam ödeme). */
  paidAmount?: number
  status?: InstallmentStatusKey | string
  paidAtUtc?: string | null
}

export interface ApiAccountPayment {
  id?: string
  amount?: number
  method?: string | null
  reference?: string | null
  occurredAtUtc?: string
}

export interface ApiCustomerAccount {
  id?: string
  tenantId?: string
  branchId?: string | null
  customerId?: string
  customerName?: string | null
  customerPhone?: string | null
  servicePackageId?: string | null
  servicePackageName?: string | null
  name?: string
  totalAmount?: number
  depositAmount?: number
  paidAmount?: number
  remainingAmount?: number
  isActive?: boolean
  notes?: string | null
  installments?: ApiInstallment[]
  payments?: ApiAccountPayment[]
  appointmentRevenue?: number
  completedAppointmentCount?: number
  createdAtUtc?: string
  /** Tüm borcu aşan tahsilat (fazla ödeme / kredi). */
  creditBalance?: number
}

export interface AccountInstallmentItem {
  id: string
  no: number
  dueDate: string
  amount: number
  /** Bu taksite dağıtılan tahsilat. */
  paidAmount: number
  /** Bu taksitten kalan (amount − paidAmount). */
  remaining: number
  status: InstallmentStatusKey
  paidAtUtc: string | null
  overdue: boolean
}

export interface AccountPayment {
  id: string
  amount: number
  method: string
  reference: string
  occurredAtUtc: string
}

export interface CustomerAccount {
  id: string
  tenantId?: string
  branchId?: string | null
  customerId: string
  customerName: string
  customerPhone: string
  servicePackageId: string | null
  servicePackageName: string
  name: string
  totalAmount: number
  depositAmount: number
  paidAmount: number
  remainingAmount: number
  creditBalance: number
  isActive: boolean
  notes: string
  installments: AccountInstallmentItem[]
  payments: AccountPayment[]
  appointmentRevenue: number
  completedAppointmentCount: number
  createdAtUtc: string
  nextDueDate: string | null
  nextDueAmount: number
  hasOverdue: boolean
}

export interface ApiCustomerPackageSession {
  id?: string
  customerAccountId?: string
  servicePackageId?: string
  serviceDefinitionId?: string
  serviceName?: string
  totalSessions?: number
  usedSessions?: number
  remainingSessions?: number
}

// ---------- Pano "Genel Rapor" (cari/taksit/seans özeti) ----------
export interface ApiAccountMonthlyInstallment {
  year?: number
  month?: number
  due?: number
  collected?: number
  remaining?: number
}

export interface ApiAccountReport {
  packageSalesCount?: number
  customersWithPackages?: number
  totalAccounts?: number
  activeAccounts?: number
  sessionsTotal?: number
  sessionsUsed?: number
  sessionsRemaining?: number
  totalReceivable?: number
  totalCollected?: number
  overdueAmount?: number
  collectedThisMonth?: number
  monthlyInstallments?: ApiAccountMonthlyInstallment[]
}

export interface AccountMonthlyInstallment {
  year: number
  month: number
  /** "Haz" gibi kısa ay etiketi (tr-TR). */
  label: string
  due: number
  collected: number
  remaining: number
}

export interface AccountReport {
  packageSalesCount: number
  customersWithPackages: number
  totalAccounts: number
  activeAccounts: number
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
  totalReceivable: number
  totalCollected: number
  overdueAmount: number
  collectedThisMonth: number
  monthlyInstallments: AccountMonthlyInstallment[]
}

export type TreatmentPhotoKind = 'Before' | 'After' | 'Progress'

export interface ApiTreatmentPhoto {
  id?: string
  customerId?: string
  serviceDefinitionId?: string | null
  serviceName?: string | null
  kind?: TreatmentPhotoKind
  imageUrl?: string
  takenAtUtc?: string
  note?: string | null
}

export interface ApiPlatformMessagingSettings {
  smsEnabled?: boolean
  smsProvider?: string
  hasSmsApiKey?: boolean
  hasSmsApiSecret?: boolean
  smsSender?: string | null
  smsApiUrl?: string | null
  smsConfigured?: boolean
  emailEnabled?: boolean
  emailFromAddress?: string | null
  emailFromName?: string | null
  smtpHost?: string | null
  smtpPort?: number
  smtpUsername?: string | null
  hasSmtpPassword?: boolean
  smtpUseSsl?: boolean
  emailConfigured?: boolean
  // WhatsApp (Meta Cloud API) — platform geneli; müşteri OTP/2FA kodu buradan gider
  whatsAppEnabled?: boolean
  whatsAppProvider?: string
  whatsAppPhoneNumberId?: string | null
  hasWhatsAppAccessToken?: boolean
  whatsAppBusinessAccountId?: string | null
  whatsAppConfigured?: boolean
}

export interface ApiMessagingTestResult {
  success?: boolean
  simulated?: boolean
  providerMessageId?: string | null
  error?: string | null
}

export type WhatsAppConfirmation = 'None' | 'Pending' | 'Confirmed' | 'Declined' | 'RescheduleRequested'

export interface ApiWhatsAppSettings {
  enabled?: boolean
  phoneNumberId?: string | null
  hasAccessToken?: boolean
  businessAccountId?: string | null
  verifyToken?: string | null
  reminderTemplate?: string | null
  provider?: string
  webhookUrl?: string
  configured?: boolean
}

export interface ApiWhatsAppMessage {
  id?: string
  appointmentId?: string | null
  customerId?: string | null
  direction?: 'Outbound' | 'Inbound'
  phone?: string
  body?: string
  status?: string
  intent?: 'Unknown' | 'Confirm' | 'Cancel' | 'Reschedule'
  providerMessageId?: string | null
  errorMessage?: string | null
  createdAtUtc?: string
}

export interface ApiWhatsAppReminderResult {
  sent?: boolean
  simulated?: boolean
  toPhone?: string
  body?: string
  providerMessageId?: string | null
  error?: string | null
}

export type SkinTypeValue = 'Unknown' | 'Type1' | 'Type2' | 'Type3' | 'Type4' | 'Type5' | 'Type6'

export interface ApiConsultationForm {
  id?: string
  customerId?: string
  isPregnant?: boolean
  isBreastfeeding?: boolean
  hasPacemakerOrImplant?: boolean
  hasEpilepsy?: boolean
  hasDiabetes?: boolean
  hasCancerHistory?: boolean
  usesBloodThinners?: boolean
  usedIsotretinoin?: boolean
  hasKeloidTendency?: boolean
  hasActiveSkinIssue?: boolean
  recentSunExposure?: boolean
  skinType?: SkinTypeValue
  allergies?: string | null
  medications?: string | null
  chronicConditions?: string | null
  complaint?: string | null
  notes?: string | null
  consentGiven?: boolean
  consentAtUtc?: string | null
  filledByName?: string | null
  takenAtUtc?: string
  updatedAtUtc?: string | null
  /** "Özel" bölümünde işaretlenen kuruma/şubeye özel seçenek etiketleri. */
  customSelections?: string[]
}

/** "Özel" bölümü için kuruma/şubeye özel işaretlenebilir seçenek tanımı. */
export interface ApiConsultationOption {
  id?: string
  label?: string
  branchId?: string | null
  isActive?: boolean
  displayOrder?: number
}

// ---------- Adisyon (onaylı cari aktarım katmanı) ----------
export type AdisyonStatusKey = 'Open' | 'Approved' | 'Cancelled'
export type AdisyonItemTypeKey = 'Service' | 'Product' | 'PackageUse' | 'Extra' | 'Payment' | 'Discount' | 'PackageSale'

export interface ApiAdisyonItem {
  id?: string
  type?: AdisyonItemTypeKey | string
  refId?: string | null
  description?: string
  quantity?: number
  unitPrice?: number
  lineTotal?: number
  staffMemberId?: string | null
  staffName?: string | null
  coveredByPackage?: boolean
  createdAtUtc?: string
}

export interface ApiAdisyon {
  id?: string
  tenantId?: string
  branchId?: string | null
  customerId?: string
  customerName?: string | null
  customerAccountId?: string | null
  status?: AdisyonStatusKey | string
  openedAtUtc?: string
  approvedAtUtc?: string | null
  notes?: string | null
  chargeTotal?: number
  paymentTotal?: number
  plannedInstallmentCount?: number
  plannedFirstDueDate?: string | null
  items?: ApiAdisyonItem[]
}

export interface AdisyonItem {
  id: string
  type: AdisyonItemTypeKey
  refId: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  staffMemberId: string | null
  staffName: string | null
  coveredByPackage: boolean
  createdAtUtc: string
}

export interface Adisyon {
  id: string
  tenantId?: string
  branchId: string | null
  customerId: string
  customerName: string | null
  customerAccountId: string | null
  status: AdisyonStatusKey
  openedAtUtc: string
  approvedAtUtc: string | null
  notes: string | null
  chargeTotal: number
  paymentTotal: number
  plannedInstallmentCount: number
  plannedFirstDueDate: string | null
  items: AdisyonItem[]
}

// ---------- Personel primi (2B) ----------
export interface ApiStaffCommissionTotal {
  staffMemberId?: string
  staffName?: string | null
  earnedTotal?: number
  paidTotal?: number
  unpaidTotal?: number
  count?: number
}

export interface ApiCommissionSummary {
  earnedTotal?: number
  paidTotal?: number
  unpaidTotal?: number
  count?: number
  byStaff?: ApiStaffCommissionTotal[]
}

export interface StaffCommissionTotal {
  staffMemberId: string
  staffName: string
  earnedTotal: number
  paidTotal: number
  unpaidTotal: number
  count: number
}

export interface CommissionSummary {
  earnedTotal: number
  paidTotal: number
  unpaidTotal: number
  count: number
  byStaff: StaffCommissionTotal[]
}

export type ExpenseCategoryKey =
  | 'Salary'
  | 'Tax'
  | 'Rent'
  | 'Utilities'
  | 'Supplies'
  | 'Inventory'
  | 'Marketing'
  | 'Maintenance'
  | 'Professional'
  | 'Equipment'
  | 'Office'
  | 'Other'

export type ExpensePaymentMethodKey = 'Cash' | 'Card' | 'BankTransfer' | 'Check'

export interface ApiCustomExpenseCategory {
  id?: string
  tenantId?: string
  name?: string
  isActive?: boolean
  createdAtUtc?: string
}

export interface CustomExpenseCategory {
  id: string
  tenantId?: string
  name: string
  isActive: boolean
  createdAt: string
}

export interface ApiCustomServiceCategory {
  id?: string
  tenantId?: string
  name?: string
  isActive?: boolean
  createdAtUtc?: string
  parentId?: string | null
}

export interface CustomServiceCategory {
  id: string
  tenantId?: string
  name: string
  isActive: boolean
  createdAt: string
  parentId: string | null
}

export interface ApiBusinessExpense {
  id?: string
  tenantId?: string
  branchId?: string | null
  category?: ExpenseCategoryKey | string
  amount?: number
  paymentMethod?: ExpensePaymentMethodKey | string
  occurredAtUtc?: string
  staffMemberId?: string | null
  staffName?: string | null
  periodLabel?: string | null
  description?: string | null
  reference?: string | null
  isApproved?: boolean
  approvedAtUtc?: string | null
  createdAtUtc?: string
}

export interface BusinessExpense {
  id: string
  tenantId?: string
  branchId: string | null
  category: ExpenseCategoryKey
  amount: number
  paymentMethod: ExpensePaymentMethodKey
  occurredAt: string
  staffMemberId: string | null
  staffName: string
  periodLabel: string
  description: string
  reference: string
  isApproved: boolean
  approvedAt: string | null
  createdAt: string
}

export interface ApiExpenseCategoryTotal {
  category?: ExpenseCategoryKey | string
  totalAmount?: number
  count?: number
}

export interface ApiExpenseStaffTotal {
  staffMemberId?: string
  staffName?: string
  totalAmount?: number
  count?: number
}

export interface ApiExpenseSummary {
  totalAmount?: number
  count?: number
  byCategory?: ApiExpenseCategoryTotal[]
  byStaff?: ApiExpenseStaffTotal[]
}

export interface ExpenseSummary {
  totalAmount: number
  count: number
  byCategory: Array<{ category: ExpenseCategoryKey; totalAmount: number; count: number }>
  byStaff: Array<{ staffMemberId: string; staffName: string; totalAmount: number; count: number }>
}

export type CashFlowEntryTypeKey = 'income' | 'expense'
export type CashFlowMethodKey = 'cash' | 'card' | 'transfer' | 'check' | 'unknown'

export interface ApiCashFlowEntry {
  id?: string
  type?: 'Income' | 'Expense' | string | number
  occurredAtUtc?: string
  amount?: number
  method?: string | null
  category?: string | null
  description?: string | null
  reference?: string | null
  customerName?: string | null
  staffName?: string | null
  accountName?: string | null
  isApproved?: boolean
}

export interface CashFlowEntry {
  id: string
  type: CashFlowEntryTypeKey
  occurredAt: string
  date: string
  time: string
  amount: number
  method: CashFlowMethodKey
  methodRaw: string
  category: string
  description: string
  reference: string
  customerName: string
  staffName: string
  accountName: string
  isApproved: boolean
}

export interface ApiCashFlowMethodTotal {
  method?: string
  incomeAmount?: number
  expenseAmount?: number
  count?: number
}

export interface ApiCashFlowSummary {
  totalIncome?: number
  totalExpense?: number
  netAmount?: number
  incomeCount?: number
  expenseCount?: number
  byMethod?: ApiCashFlowMethodTotal[]
}

export interface CashFlowSummary {
  totalIncome: number
  totalExpense: number
  netAmount: number
  incomeCount: number
  expenseCount: number
  byMethod: Array<{
    method: CashFlowMethodKey
    methodRaw: string
    incomeAmount: number
    expenseAmount: number
    count: number
  }>
}

export type ProductCategoryKey = 'SkinCare' | 'Consumable' | 'Sale' | 'HairCare' | 'Makeup' | 'NailCare' | 'Other'
export type StockMovementTypeKey = 'Inbound' | 'Outbound' | 'Sale' | 'Adjustment' | 'Damage'
export type ProductStatusKey = 'sufficient' | 'critical' | 'out'

export interface ApiProduct {
  id?: string
  tenantId?: string
  branchId?: string | null
  name?: string
  sku?: string
  category?: ProductCategoryKey | string
  unit?: string
  supplier?: string | null
  location?: string | null
  cost?: number
  salePrice?: number
  currentStock?: number
  minStockLevel?: number
  isActive?: boolean
  isOutOfStock?: boolean
  isCritical?: boolean
  barcode?: string | null
  imageUrl?: string | null
  createdAtUtc?: string
  updatedAtUtc?: string | null
  brand?: string | null
  taxRatePercent?: number | null
  expiryDate?: string | null
  lotNumber?: string | null
  pendingInbound?: number
  leadTimeDays?: number
}

export interface Product {
  id: string
  tenantId?: string
  branchId: string | null
  name: string
  sku: string
  category: ProductCategoryKey
  categoryLabel: string
  unit: string
  supplier: string
  location: string
  cost: number
  salePrice: number
  currentStock: number
  minStockLevel: number
  isActive: boolean
  isOutOfStock: boolean
  isCritical: boolean
  barcode: string
  imageUrl: string
  brand: string
  taxRatePercent: number | null
  expiryDate: string
  lotNumber: string
  pendingInbound: number
  leadTimeDays: number
  updatedAt: string
  status: ProductStatusKey
  margin: number
  marginPct: number
  stockValueCost: number
  stockValueSale: number
}

export interface ApiStockMovement {
  id?: string
  tenantId?: string
  productId?: string
  productName?: string | null
  productSku?: string | null
  type?: StockMovementTypeKey | string | number
  quantity?: number
  unitCost?: number | null
  totalCost?: number
  occurredAtUtc?: string
  reference?: string | null
  notes?: string | null
  staffMemberId?: string | null
  staffName?: string | null
}

export interface StockMovement {
  id: string
  productId: string
  productName: string
  productSku: string
  type: StockMovementTypeKey
  quantity: number
  unitCost: number
  totalCost: number
  occurredAt: string
  date: string
  time: string
  reference: string
  notes: string
  staffName: string
}

export interface ApiStockSummary {
  totalProducts?: number
  criticalCount?: number
  outOfStockCount?: number
  stockValueAtCost?: number
  stockValueAtSale?: number
  byCategory?: Array<{
    category?: ProductCategoryKey | string
    productCount?: number
    stockValueAtCost?: number
  }>
}

export interface StockSummary {
  totalProducts: number
  criticalCount: number
  outOfStockCount: number
  stockValueAtCost: number
  stockValueAtSale: number
  byCategory: Array<{
    category: ProductCategoryKey
    categoryLabel: string
    productCount: number
    stockValueAtCost: number
  }>
}

export type PendingOperationStatusKey = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
export type PendingOperationTypeKey =
  | 'CreateCustomer' | 'UpdateCustomer' | 'DeleteCustomer'
  | 'CreateAppointment' | 'UpdateAppointment' | 'ChangeAppointmentStatus' | 'DeleteAppointment'
  | 'CreateExpense' | 'DeleteExpense'
  | 'CreateAccount' | 'RegisterAccountPayment' | 'RescheduleAccount'
  | 'CreateStockMovement' | 'CreateProduct'
  | 'HttpReplay'
  | 'Other'

export interface ApiPendingOperation {
  id?: string
  tenantId?: string
  branchId?: string | null
  requestedByUserId?: string
  requestedByName?: string
  operationType?: PendingOperationTypeKey | string | number
  title?: string
  summary?: string | null
  payloadJson?: string
  status?: PendingOperationStatusKey | string | number
  requestedAtUtc?: string
  decidedAtUtc?: string | null
  decidedByUserId?: string | null
  rejectionReason?: string | null
  resultEntityId?: string | null
}

export interface PendingOperation {
  id: string
  tenantId?: string
  branchId: string | null
  requestedByUserId: string
  requestedByName: string
  operationType: PendingOperationTypeKey
  operationTypeLabel: string
  title: string
  summary: string
  payload: Record<string, unknown> | null
  status: PendingOperationStatusKey
  requestedAt: string
  requestedAtFormatted: string
  decidedAt: string | null
  rejectionReason: string
  resultEntityId: string | null
}

// ---------------------------------------------------------------------------
// Notifications (SMS / WhatsApp / Email)
// ---------------------------------------------------------------------------

export type NotificationChannelKey = 'Sms' | 'WhatsApp' | 'Email'
export type NotificationTriggerKey =
  | 'Manual'
  | 'AppointmentReminder'
  | 'BirthdayGreeting'
  | 'PaymentDue'
  | 'Campaign'
  | 'WinBack'
  | 'SessionRenewal'
export type NotificationTemplateStatusKey = 'Draft' | 'Active' | 'PendingApproval'
export type NotificationLogStatusKey = 'Queued' | 'Sent' | 'Failed'

export interface ApiNotificationTemplate {
  id?: string
  tenantId?: string
  branchId?: string | null
  name?: string
  channel?: NotificationChannelKey | string | number
  trigger?: NotificationTriggerKey | string | number
  body?: string
  status?: NotificationTemplateStatusKey | string | number
  totalSentCount?: number
  lastSentAtUtc?: string | null
  createdAtUtc?: string
}

export interface NotificationTemplate {
  id: string
  branchId: string | null
  name: string
  channel: NotificationChannelKey
  channelLabel: string
  trigger: NotificationTriggerKey
  triggerLabel: string
  body: string
  status: NotificationTemplateStatusKey
  statusLabel: string
  totalSentCount: number
  lastSentAt: string | null
  lastSentAtFormatted: string
  createdAt: string
}

export interface ApiNotificationLog {
  id?: string
  tenantId?: string
  branchId?: string | null
  templateId?: string | null
  templateName?: string | null
  customerId?: string | null
  customerName?: string | null
  channel?: NotificationChannelKey | string | number
  recipient?: string
  body?: string
  status?: NotificationLogStatusKey | string | number
  errorMessage?: string | null
  sentAtUtc?: string | null
  createdAtUtc?: string
}

export interface NotificationLog {
  id: string
  templateId: string | null
  templateName: string
  customerId: string | null
  customerName: string
  channel: NotificationChannelKey
  channelLabel: string
  recipient: string
  body: string
  status: NotificationLogStatusKey
  statusLabel: string
  errorMessage: string
  sentAt: string | null
  sentAtFormatted: string
  createdAt: string
  createdAtFormatted: string
}

export interface ApiNotificationSummary {
  totalTemplates?: number
  activeTemplates?: number
  todaySent?: number
  todayFailed?: number
  todayQueued?: number
}

export interface NotificationSummary {
  totalTemplates: number
  activeTemplates: number
  todaySent: number
  todayFailed: number
  todayQueued: number
}

export interface SendNotificationResult {
  sent: number
  failed: number
  skipped: number
  logs: NotificationLog[]
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export interface ApiAuditLog {
  id?: string
  tenantId?: string | null
  branchId?: string | null
  actorUserId?: string | null
  actorName?: string | null
  actorRole?: string | null
  action?: string
  entityName?: string
  entityId?: string | null
  summary?: string | null
  dataJson?: string | null
  ipAddress?: string | null
  createdAtUtc?: string
  deviceId?: string | null
  deviceInfoJson?: string | null
}

export interface AuditLog {
  id: string
  branchId: string | null
  actorUserId: string | null
  actorName: string
  actorRole: string
  action: string
  actionLabel: string
  entityName: string
  entityLabel: string
  entityId: string | null
  summary: string
  data: Record<string, unknown> | null
  ipAddress: string
  deviceId: string | null
  deviceInfo: Record<string, unknown> | null
  createdAt: string
  createdAtFormatted: string
}

export type AppointmentStatusKey = 'tamamlandi' | 'devam' | 'bekliyor' | 'iptal' | 'taslak'

/** Kurum yöneticisi aksiyon kutusu — saati gelmiş randevular + onay bekleyen taslaklar. */
export interface AppointmentInbox {
  awaitingOutcome: ApiAppointment[]
  awaitingApproval: ApiAppointment[]
}

export interface ApiAppointment {
  id?: string
  tenantId?: string
  branchId?: string
  customerId?: string
  staffMemberId?: string
  serviceDefinitionId?: string
  startUtc?: string
  endUtc?: string
  status?: string
  price?: number
  notes?: string
  cancellationReason?: string
  customerName?: string | null
  staffName?: string | null
  serviceName?: string | null
  customerConfirmation?: WhatsAppConfirmation
  lastReminderAtUtc?: string | null
  isOnline?: boolean
  customerPhone?: string | null
  customerIsVip?: boolean
  number?: number | null
}

export interface AppointmentLookups {
  customers?: Record<string, ApiCustomer>
  staff?: Record<string, ApiStaff>
  services?: Record<string, ApiService>
}

export interface Appointment {
  id: string
  tenantId?: string
  branchId?: string
  customerId?: string
  staffMemberId?: string
  serviceDefinitionId?: string
  date: string
  time: string
  musteri: string
  islem: string
  personel: string
  status: AppointmentStatusKey
  sure: number
  price: number
  notes: string
  rawStatus?: string
  customerConfirmation?: WhatsAppConfirmation
  lastReminderAtUtc?: string | null
  isOnline?: boolean
  customerPhone?: string
  isVip?: boolean
  number?: number | null
}

// ---------------------------------------------------------------------------
// UI yardımcı tipleri
// ---------------------------------------------------------------------------

export interface NotificationItem {
  title: string
  description?: string
  meta?: string
  href?: string
}
