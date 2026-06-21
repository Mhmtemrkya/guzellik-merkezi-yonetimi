// Backend modülü henüz olmayan ekranlar için gerçekçi demo veri üretir.
// Live API verisi (customer/staff/service/appointment) varsa onunla harmanlanır;
// kasa/cari/stok hareketleri deterministik (seedli) üretilir ki sayfalar dinamik canlı görünsün.

import type { Appointment, Customer, Service, Staff } from './types'

// ---------------------------------------------------------------------------
// KASA — Günlük gelir/gider hareketleri
// ---------------------------------------------------------------------------

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other'
export type CashFlowKind = 'income' | 'expense'

export interface CashEntry {
  id: string
  date: string // ISO date
  time: string // HH:MM
  kind: CashFlowKind
  category: string
  description: string
  customer?: string
  method: PaymentMethod
  amount: number
  staff: string
  status: 'approved' | 'pending' | 'reversed'
}

const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Nakit',
  card: 'Kart',
  transfer: 'Havale / EFT',
  other: 'Diğer',
}

const paymentMethodTone: Record<PaymentMethod, string> = {
  cash: 'border-emerald-300/25 bg-emerald-400/12 text-emerald-200',
  card: 'border-sky-300/25 bg-sky-400/12 text-sky-200',
  transfer: 'border-violet-300/25 bg-violet-400/12 text-violet-200',
  other: 'border-[#fff4f8]/15 bg-[#fff4f8]/8 text-[#fff4f8]/70',
}

export function getMethodLabel(method: PaymentMethod): string {
  return paymentMethodLabel[method]
}

export function getMethodTone(method: PaymentMethod): string {
  return paymentMethodTone[method]
}

interface BuildCashEntriesInput {
  appointments: Appointment[]
  customers: Customer[]
  staff: Staff[]
  services: Service[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

const expenseCategories: Array<{ category: string; description: string; amount: number; time: string }> = [
  { category: 'Sarf Malzeme', description: 'Cilt bakım ürünleri', amount: 4200, time: '11:30' },
  { category: 'Kira', description: 'İşyeri aylık kira ödemesi', amount: 28000, time: '09:15' },
  { category: 'Personel Avans', description: 'Personel maaş avansı', amount: 6500, time: '15:00' },
  { category: 'Elektrik / Su', description: 'Aylık fatura', amount: 3850, time: '12:00' },
  { category: 'Reklam', description: 'Instagram ads', amount: 2500, time: '14:20' },
  { category: 'Bakım Onarım', description: 'Lazer cihazı bakım', amount: 5500, time: '10:45' },
]

/**
 * Build a synthetic cash entries list using real appointment data
 * (completed appointments → income rows) augmented with expense rows
 * so the daily cash page has both sides.
 */
export function buildCashEntries(input: BuildCashEntriesInput): CashEntry[] {
  const { appointments, staff } = input
  const entries: CashEntry[] = []

  // Income rows from completed appointments
  appointments
    .filter((a) => a.status === 'tamamlandi' && a.price > 0)
    .forEach((a, i) => {
      const method: PaymentMethod = i % 3 === 0 ? 'cash' : i % 3 === 1 ? 'card' : 'transfer'
      entries.push({
        id: `inc-${a.id}`,
        date: a.date,
        time: a.time,
        kind: 'income',
        category: 'Seans Tahsilatı',
        description: `${a.islem} · ${a.musteri}`,
        customer: a.musteri,
        method,
        amount: a.price,
        staff: a.personel,
        status: 'approved',
      })
    })

  // Pending income rows from scheduled (bekliyor) appointments
  appointments
    .filter((a) => a.status === 'bekliyor' && a.price > 0)
    .slice(0, 4)
    .forEach((a) => {
      entries.push({
        id: `pend-${a.id}`,
        date: a.date,
        time: a.time,
        kind: 'income',
        category: 'Tahsilat Bekliyor',
        description: `${a.islem} · ${a.musteri}`,
        customer: a.musteri,
        method: 'card',
        amount: a.price,
        staff: a.personel,
        status: 'pending',
      })
    })

  // Expense rows distributed across the week
  const today = new Date()
  const referenceStaff = staff[0]?.name || 'Ön muhasebe'
  expenseCategories.forEach((ex, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    entries.push({
      id: `exp-${i}`,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: ex.time,
      kind: 'expense',
      category: ex.category,
      description: ex.description,
      method: i % 2 === 0 ? 'transfer' : 'cash',
      amount: ex.amount,
      staff: referenceStaff,
      status: i === 1 ? 'pending' : 'approved',
    })
  })

  // Sort newest first
  return entries.sort((a, b) =>
    a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date),
  )
}

// ---------------------------------------------------------------------------
// ÖN MUHASEBE — Cari hesap & taksit
// ---------------------------------------------------------------------------

export interface AccountInstallment {
  id: string
  customerId: string
  customerName: string
  package: string
  total: number
  paid: number
  debt: number
  dueDate: string // YYYY-MM-DD
  overdueDays: number
  status: 'planned' | 'upcoming' | 'overdue' | 'completed'
  phone: string
  paymentPlan: Array<{ no: number; date: string; amount: number; paid: boolean }>
}

const packageTemplates: Array<{ name: string; total: number; sessions: number }> = [
  { name: 'VIP Kombine Paket', total: 218000, sessions: 24 },
  { name: 'Lazer + Cilt Bakımı', total: 142000, sessions: 18 },
  { name: 'Diode Lazer 8 Seans', total: 14000, sessions: 8 },
  { name: 'Hydrafacial 6 Seans', total: 18000, sessions: 6 },
  { name: 'Bölgesel İncelme Programı', total: 67000, sessions: 12 },
  { name: 'Microblading + Bakım', total: 12500, sessions: 3 },
]

export function buildInstallments(customers: Customer[]): AccountInstallment[] {
  if (!customers.length) return []
  const today = new Date()
  return customers.slice(0, packageTemplates.length).map((c, i) => {
    const tpl = packageTemplates[i % packageTemplates.length]!
    const installmentCount = 5
    const installmentAmount = Math.round(tpl.total / installmentCount)
    const dueOffset = (i - 2) * 7 // -14, -7, 0, +7, +14, +21 days
    const due = new Date(today)
    due.setDate(today.getDate() + dueOffset)
    const overdueDays = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
    const paidInstallments = Math.max(1, Math.min(installmentCount - 1, i + 1))
    const paid = paidInstallments * installmentAmount
    const debt = Math.max(0, tpl.total - paid)
    let status: AccountInstallment['status']
    if (debt === 0) status = 'completed'
    else if (overdueDays > 0) status = 'overdue'
    else if (dueOffset <= 7) status = 'upcoming'
    else status = 'planned'

    const plan = Array.from({ length: installmentCount }, (_, j) => {
      const d = new Date(due)
      d.setDate(due.getDate() + (j - paidInstallments) * 30)
      return {
        no: j + 1,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        amount: installmentAmount,
        paid: j < paidInstallments,
      }
    })

    return {
      id: `acc-${c.id}`,
      customerId: c.id,
      customerName: c.name,
      package: tpl.name,
      total: tpl.total,
      paid,
      debt,
      dueDate: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`,
      overdueDays,
      status,
      phone: c.phone,
      paymentPlan: plan,
    }
  })
}

// ---------------------------------------------------------------------------
// STOK — Ürün ve hareket demo
// ---------------------------------------------------------------------------

export interface StockProduct {
  id: string
  name: string
  category: 'consumable' | 'sale' | 'care'
  categoryLabel: string
  sku: string
  stock: number
  minStock: number
  unit: string
  cost: number
  salePrice: number
  supplier: string
  location: string
  status: 'sufficient' | 'critical' | 'out'
  lastMovement: string
}

export interface StockMovement {
  id: string
  date: string
  type: 'in' | 'out' | 'sale' | 'count'
  typeLabel: string
  product: string
  qty: number
  unit: string
  owner: string
  note: string
}

const productCatalog: Array<Omit<StockProduct, 'id' | 'status' | 'lastMovement'>> = [
  {
    name: 'HydraFacial Serum Seti',
    category: 'care',
    categoryLabel: 'Cilt Bakım Ürünü',
    sku: 'HF-SRM-01',
    stock: 18,
    minStock: 10,
    unit: 'kutu',
    cost: 1450,
    salePrice: 2250,
    supplier: 'DermaPlus',
    location: 'Cilt bakım odası',
  },
  {
    name: 'Lazer Jel 5 Lt',
    category: 'consumable',
    categoryLabel: 'Sarf Malzeme',
    sku: 'LZR-JEL-5L',
    stock: 4,
    minStock: 12,
    unit: 'bidon',
    cost: 420,
    salePrice: 0,
    supplier: 'Medikal Tedarik',
    location: 'Depo A',
  },
  {
    name: 'Tek Kullanımlık Spatula',
    category: 'consumable',
    categoryLabel: 'Sarf Malzeme',
    sku: 'SPT-100',
    stock: 240,
    minStock: 150,
    unit: 'adet',
    cost: 2,
    salePrice: 0,
    supplier: 'SalonMarket',
    location: 'Depo B',
  },
  {
    name: 'Güneş Koruyucu SPF 50',
    category: 'sale',
    categoryLabel: 'Satış Ürünü',
    sku: 'SPF50-DRM',
    stock: 22,
    minStock: 8,
    unit: 'adet',
    cost: 310,
    salePrice: 690,
    supplier: 'DermaPlus',
    location: 'Resepsiyon rafı',
  },
  {
    name: 'Microblading İğne Ucu',
    category: 'consumable',
    categoryLabel: 'Sarf Malzeme',
    sku: 'MB-NDL-12',
    stock: 6,
    minStock: 20,
    unit: 'paket',
    cost: 260,
    salePrice: 0,
    supplier: 'Kalıcı Makyaj Pro',
    location: 'Kalıcı makyaj odası',
  },
  {
    name: 'Kolajen Maske',
    category: 'sale',
    categoryLabel: 'Satış Ürünü',
    sku: 'MSK-KLJ-10',
    stock: 34,
    minStock: 12,
    unit: 'adet',
    cost: 95,
    salePrice: 240,
    supplier: 'BeautyLab',
    location: 'Resepsiyon rafı',
  },
  {
    name: 'Lazer Filtre Set',
    category: 'consumable',
    categoryLabel: 'Sarf Malzeme',
    sku: 'LZR-FLT-S',
    stock: 0,
    minStock: 5,
    unit: 'set',
    cost: 1800,
    salePrice: 0,
    supplier: 'Medikal Tedarik',
    location: 'Depo A',
  },
  {
    name: 'Cilt Tonik Losyon',
    category: 'sale',
    categoryLabel: 'Satış Ürünü',
    sku: 'TON-LSN-200',
    stock: 14,
    minStock: 8,
    unit: 'adet',
    cost: 180,
    salePrice: 420,
    supplier: 'BeautyLab',
    location: 'Resepsiyon rafı',
  },
]

export function buildStockProducts(): StockProduct[] {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return productCatalog.map((p, i) => {
    const status: StockProduct['status'] =
      p.stock === 0 ? 'out' : p.stock < p.minStock ? 'critical' : 'sufficient'
    const lastDay = new Date(today)
    lastDay.setDate(today.getDate() - (i % 6))
    return {
      ...p,
      id: `prod-${i}`,
      status,
      lastMovement: i === 0 ? todayIso : `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`,
    }
  })
}

const movementTemplates: Array<{ type: StockMovement['type']; label: string; product: string; qty: number; unit: string; note: string }> = [
  { type: 'in', label: 'Tedarik girişi', product: 'HydraFacial Serum Seti', qty: 6, unit: 'kutu', note: 'Tedarikçi teslimatı' },
  { type: 'out', label: 'Şube çıkışı', product: 'Lazer Jel 5 Lt', qty: 2, unit: 'bidon', note: 'Lazer odası günlük kullanım' },
  { type: 'sale', label: 'Resepsiyon satış', product: 'Güneş Koruyucu SPF 50', qty: 3, unit: 'adet', note: 'Müşteri ürün satışı' },
  { type: 'count', label: 'Sayım düzeltme', product: 'Microblading İğne Ucu', qty: -4, unit: 'paket', note: 'Sayım farkı' },
  { type: 'in', label: 'Tedarik girişi', product: 'Kolajen Maske', qty: 24, unit: 'adet', note: 'BeautyLab kampanya' },
  { type: 'out', label: 'Şube çıkışı', product: 'Tek Kullanımlık Spatula', qty: 35, unit: 'adet', note: 'Günlük kullanım' },
  { type: 'sale', label: 'Resepsiyon satış', product: 'Cilt Tonik Losyon', qty: 1, unit: 'adet', note: 'Müşteri satışı' },
]

// ---------------------------------------------------------------------------
// ONAYLAR — Bekleyen işlemler (ApprovalRequest demosu)
// ---------------------------------------------------------------------------

export type ApprovalKind = 'payment' | 'staff' | 'refund' | 'discount'
export type ApprovalUrgency = 'low' | 'medium' | 'high'

export interface ApprovalRequest {
  id: string
  kind: ApprovalKind
  kindLabel: string
  title: string
  description: string
  amount?: number
  requestedBy: string
  customer?: string
  age: string
  urgency: ApprovalUrgency
}

interface BuildApprovalsInput {
  customers: Customer[]
  staff: Staff[]
  appointments: Appointment[]
}

export function buildApprovals({ customers, staff, appointments }: BuildApprovalsInput): ApprovalRequest[] {
  const requests: ApprovalRequest[] = []
  const staffPool = staff.length ? staff.map((s) => s.name) : ['Resepsiyon']

  appointments
    .filter((a) => a.status === 'tamamlandi' && a.price > 0)
    .slice(0, 2)
    .forEach((a, i) => {
      requests.push({
        id: `appr-pay-${a.id}`,
        kind: 'payment',
        kindLabel: 'Tahsilat onayı',
        title: `${formatTL(a.price)} nakit tahsilat`,
        description: `${a.musteri} · ${a.islem}`,
        amount: a.price,
        requestedBy: a.personel,
        customer: a.musteri,
        age: `${(i + 1) * 12} dk`,
        urgency: i === 0 ? 'high' : 'medium',
      })
    })

  if (customers[0]) {
    requests.push({
      id: 'appr-refund-1',
      kind: 'refund',
      kindLabel: 'İade / iptal',
      title: 'Paket iadesi onayı',
      description: `${customers[0].name} · 2 kullanılmamış seans iadesi`,
      amount: 3600,
      requestedBy: staffPool[0]!,
      customer: customers[0].name,
      age: '32 dk',
      urgency: 'high',
    })
  }

  if (staff[0]) {
    requests.push({
      id: 'appr-staff-1',
      kind: 'staff',
      kindLabel: 'Personel işlemi',
      title: 'Avans talebi',
      description: `${staff[0].name} · maaş avansı`,
      amount: 5000,
      requestedBy: staff[0].name,
      age: '1 sa',
      urgency: 'medium',
    })
  }

  if (customers[1]) {
    requests.push({
      id: 'appr-discount-1',
      kind: 'discount',
      kindLabel: 'İndirim',
      title: '%15 sadakat indirimi',
      description: `${customers[1].name} · 12. seans hediye indirimi`,
      requestedBy: staffPool[0]!,
      customer: customers[1].name,
      age: '3 sa',
      urgency: 'low',
    })
  }

  return requests
}

// Helper used inside buildApprovals
function formatTL(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(value)
}

// ---------------------------------------------------------------------------
// LOG KAYITLARI — Audit log demosu
// ---------------------------------------------------------------------------

export type LogActionKind =
  | 'appointment.create'
  | 'appointment.complete'
  | 'appointment.cancel'
  | 'customer.create'
  | 'customer.update'
  | 'payment.collect'
  | 'package.sell'
  | 'staff.update'
  | 'login'
  | 'permission.change'

export interface AuditLogEntry {
  id: string
  date: string // ISO date
  time: string // HH:MM
  action: LogActionKind
  actionLabel: string
  actor: string
  target: string
  detail: string
  ip: string
}

interface BuildLogsInput {
  appointments: Appointment[]
  customers: Customer[]
  staff: Staff[]
}

function pickIp(i: number): string {
  return ['10.20.4.21', '10.20.4.35', '10.20.4.18', '10.20.4.42', '192.168.1.10'][i % 5]!
}

export function buildAuditLogs({ appointments, customers, staff }: BuildLogsInput): AuditLogEntry[] {
  const entries: AuditLogEntry[] = []
  const staffPool = staff.length ? staff.map((s) => s.name) : ['Sistem']
  const today = new Date()

  appointments.slice(0, 6).forEach((a, i) => {
    const d = new Date(today)
    d.setMinutes(d.getMinutes() - i * 17)
    const action: LogActionKind =
      a.status === 'tamamlandi'
        ? 'appointment.complete'
        : a.status === 'iptal'
          ? 'appointment.cancel'
          : 'appointment.create'
    const actionLabel =
      action === 'appointment.complete'
        ? 'Randevu tamamlandı'
        : action === 'appointment.cancel'
          ? 'Randevu iptal'
          : 'Randevu oluşturuldu'
    entries.push({
      id: `log-app-${a.id}`,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      action,
      actionLabel,
      actor: a.personel,
      target: `Randevu · ${a.musteri}`,
      detail: `${a.islem} · ${a.time}`,
      ip: pickIp(i),
    })
  })

  customers.slice(0, 3).forEach((c, i) => {
    const d = new Date(today)
    d.setHours(d.getHours() - i - 2)
    entries.push({
      id: `log-cus-${c.id}`,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      action: i === 0 ? 'customer.create' : 'customer.update',
      actionLabel: i === 0 ? 'Müşteri oluşturuldu' : 'Müşteri güncellendi',
      actor: staffPool[i % staffPool.length]!,
      target: `Müşteri · ${c.name}`,
      detail: c.phone,
      ip: pickIp(i + 6),
    })
  })

  staff.slice(0, 2).forEach((s, i) => {
    const d = new Date(today)
    d.setHours(d.getHours() - i - 4)
    entries.push({
      id: `log-staff-${s.id}`,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      action: 'staff.update',
      actionLabel: 'Personel güncellendi',
      actor: 'Kurum Yöneticisi',
      target: `Personel · ${s.name}`,
      detail: `${s.role} · komisyon %${s.commissionRate || 0}`,
      ip: pickIp(i + 9),
    })
  })

  // Login event
  const loginDate = new Date(today)
  loginDate.setHours(8, 12)
  entries.push({
    id: 'log-login-1',
    date: `${loginDate.getFullYear()}-${pad(loginDate.getMonth() + 1)}-${pad(loginDate.getDate())}`,
    time: '08:12',
    action: 'login',
    actionLabel: 'Oturum açıldı',
    actor: 'Kurum Yöneticisi',
    target: 'Auth',
    detail: 'Web · Chrome 134',
    ip: pickIp(11),
  })

  return entries.sort((a, b) =>
    a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date),
  )
}

// ---------------------------------------------------------------------------
// BİLDİRİMLER — Şablon + kuyruk demosu
// ---------------------------------------------------------------------------

export type NotificationChannel = 'sms' | 'whatsapp' | 'email'

export interface NotificationTemplate {
  id: string
  name: string
  channel: NotificationChannel
  trigger: string
  body: string
  status: 'active' | 'draft' | 'pending-approval'
}

export interface NotificationQueueItem {
  id: string
  date: string
  time: string
  channel: NotificationChannel
  recipient: string
  template: string
  status: 'sent' | 'queued' | 'failed'
}

export const notificationTemplates: NotificationTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Randevu hatırlatma · 24 sa',
    channel: 'sms',
    trigger: 'Randevu öncesi 24 sa',
    body: 'Sayın {{ad}}, yarın {{saat}} randevunuz var. Görüşmek üzere — {{kurum}}',
    status: 'active',
  },
  {
    id: 'tpl-2',
    name: 'Tahsilat onayı',
    channel: 'whatsapp',
    trigger: 'Ödeme tahsil edildiğinde',
    body: 'Sayın {{ad}}, {{tutar}} tahsilatınız kasaya işlendi. Teşekkürler.',
    status: 'pending-approval',
  },
  {
    id: 'tpl-3',
    name: 'Doğum günü kutlaması',
    channel: 'sms',
    trigger: 'Doğum günü',
    body: 'Sayın {{ad}}, doğum gününüz kutlu olsun! Size özel %15 indirim hediyemiz.',
    status: 'active',
  },
  {
    id: 'tpl-4',
    name: 'Seans paketinde kalan 1',
    channel: 'whatsapp',
    trigger: 'Pakette 1 seans kaldığında',
    body: 'Sayın {{ad}}, paketinizde 1 seans kaldı. Yeni paket için danışın.',
    status: 'active',
  },
  {
    id: 'tpl-5',
    name: 'Aylık özet',
    channel: 'email',
    trigger: 'Ay sonu',
    body: 'Sayın {{ad}}, geçen ay {{seans}} seansınız tamamlandı. Detaylar ektedir.',
    status: 'draft',
  },
]

interface BuildNotifQueueInput {
  customers: Customer[]
  appointments: Appointment[]
}

export function buildNotificationQueue({ customers, appointments }: BuildNotifQueueInput): NotificationQueueItem[] {
  const queue: NotificationQueueItem[] = []
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  appointments.slice(0, 5).forEach((a, i) => {
    const d = new Date(today)
    d.setHours(d.getHours() - i * 2)
    const channel: NotificationChannel = i % 2 === 0 ? 'sms' : 'whatsapp'
    queue.push({
      id: `q-${a.id}`,
      date: todayIso,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      channel,
      recipient: a.musteri,
      template: 'Randevu hatırlatma · 24 sa',
      status: i === 4 ? 'queued' : 'sent',
    })
  })

  customers.slice(0, 2).forEach((c, i) => {
    queue.push({
      id: `q-bd-${c.id}`,
      date: todayIso,
      time: i === 0 ? '08:30' : '09:15',
      channel: 'sms',
      recipient: c.name,
      template: 'Doğum günü kutlaması',
      status: 'sent',
    })
  })

  if (customers[2]) {
    queue.push({
      id: 'q-fail-1',
      date: todayIso,
      time: '11:42',
      channel: 'whatsapp',
      recipient: customers[2].name,
      template: 'Tahsilat onayı',
      status: 'failed',
    })
  }

  return queue.sort((a, b) => b.time.localeCompare(a.time))
}

export function buildStockMovements(staff: Staff[]): StockMovement[] {
  const today = new Date()
  const ownerPool = staff.length ? staff.map((s) => s.name) : ['Selin Demir']
  return movementTemplates.map((m, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    return {
      id: `mov-${i}`,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      type: m.type,
      typeLabel: m.label,
      product: m.product,
      qty: m.qty,
      unit: m.unit,
      owner: ownerPool[i % ownerPool.length]!,
      note: m.note,
    }
  })
}
