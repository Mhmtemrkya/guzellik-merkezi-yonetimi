import type { ApiEnvelope } from './types'

// Online randevu portalı (müşteri rolü) — panel oturumundan tamamen bağımsız,
// kendi token deposu olan hafif istemci. Backend uçları: /api/auth/customer/* + /api/customer/*.
const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/proxy').replace(/\/$/, '')

export const CUSTOMER_SESSION_KEY = 'beautyasist.customerSession'

// ---- Tipler (backend DTO karşılıkları; enum'lar JSON'da integer gelir) ----

export interface PortalUser {
  userId: string
  email: string
  fullName: string | null
  role: number | string
  customerId: string | null
}

export interface CustomerSession {
  accessToken: string
  refreshToken: string
  expiresAtUtc: string
  user: PortalUser
}

export interface PortalProfile {
  customerId: string
  fullName: string
  phone: string
  tenantId: string
  tenantName: string
  branchId: string
  isMarketplace: boolean
}

export interface PortalBranch {
  id: string
  name: string
  city: string
  isDefault: boolean
  tenantId: string
  tenantName: string
}

export interface PortalService {
  id: string
  name: string
  category: string | null
  durationMinutes: number
  price: number
  iconKey: string | null
}

export interface PortalStaff {
  id: string
  fullName: string
  title: string
  specialties: string | null
  photoUrl: string | null
}

export interface PortalSlot {
  start: string
  end: string
  available: boolean
}

export interface PortalAvailability {
  date: string
  slots: PortalSlot[]
}

// Randevu durumu JSON'da sayı ya da string enum adı gelebilir; ikisini de eşler.
const STATUS_META: Record<string, { label: string; tone: 'rose' | 'emerald' | 'violet' | 'slate' }> = {
  '1': { label: 'Planlandı', tone: 'rose' },
  scheduled: { label: 'Planlandı', tone: 'rose' },
  '2': { label: 'Onaylandı', tone: 'emerald' },
  confirmed: { label: 'Onaylandı', tone: 'emerald' },
  '3': { label: 'Tamamlandı', tone: 'violet' },
  completed: { label: 'Tamamlandı', tone: 'violet' },
  '4': { label: 'İptal', tone: 'slate' },
  cancelled: { label: 'İptal', tone: 'slate' },
  '5': { label: 'Gelmedi', tone: 'slate' },
  noshow: { label: 'Gelmedi', tone: 'slate' },
  '6': { label: 'Onay Bekliyor', tone: 'rose' },
  draft: { label: 'Onay Bekliyor', tone: 'rose' },
}

export function portalStatusMeta(status: number | string): { label: string; tone: 'rose' | 'emerald' | 'violet' | 'slate' } {
  return STATUS_META[String(status).toLowerCase()] || { label: 'Bilinmiyor', tone: 'slate' }
}

export interface PortalAppointment {
  id: string
  branchId: string
  branchName: string | null
  staffMemberId: string
  staffName: string | null
  serviceDefinitionId: string
  serviceName: string | null
  startUtc: string
  endUtc: string
  status: number | string
  price: number
  isOnline: boolean
}

export interface CustomerLoginInput {
  fullName: string
  phone: string
  birthDate: string // 'yyyy-MM-dd'
}

export interface CustomerRegisterInput extends CustomerLoginInput {
  gender: number // Gender enum: 0 Unspecified, 1 Female, 2 Male, 3 Other
  email: string | null
}

// ---- Oturum saklama ----

export function getCustomerSession(): CustomerSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CUSTOMER_SESSION_KEY)
    return raw ? (JSON.parse(raw) as CustomerSession) : null
  } catch {
    return null
  }
}

export function storeCustomerSession(session: CustomerSession | null): void {
  if (typeof window === 'undefined') return
  if (!session) window.localStorage.removeItem(CUSTOMER_SESSION_KEY)
  else window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session))
}

export class PortalApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'PortalApiError'
    this.status = status
  }
}

async function portalRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const session = getCustomerSession()
    if (!session?.accessToken) throw new PortalApiError('Oturum bulunamadı.', 401)
    headers.Authorization = `Bearer ${session.accessToken}`
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let envelope: ApiEnvelope<T> | null = null
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    /* gövdesiz yanıt */
  }
  if (!response.ok || !envelope?.success) {
    if (response.status === 401 && auth) storeCustomerSession(null)
    const message = envelope?.error?.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
    throw new PortalApiError(message, response.status)
  }
  return envelope.data as T
}

// ---- Auth ----

export async function customerLogin(input: CustomerLoginInput): Promise<CustomerSession> {
  const session = await portalRequest<CustomerSession>('/api/auth/customer/login', {
    method: 'POST',
    auth: false,
    body: { fullName: input.fullName, phone: input.phone, birthDate: input.birthDate },
  })
  storeCustomerSession(session)
  return session
}

export async function customerRegister(input: CustomerRegisterInput): Promise<CustomerSession> {
  const session = await portalRequest<CustomerSession>('/api/auth/customer/register', {
    method: 'POST',
    auth: false,
    body: {
      fullName: input.fullName,
      phone: input.phone,
      birthDate: input.birthDate,
      gender: input.gender,
      email: input.email || null,
    },
  })
  storeCustomerSession(session)
  return session
}

export async function customerLogout(): Promise<void> {
  const session = getCustomerSession()
  storeCustomerSession(null)
  if (!session?.refreshToken) return
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })
  } catch {
    /* çevrimdışı çıkışta sessiz geç */
  }
}

// ---- Portal veri uçları ----

export function getPortalProfile(): Promise<PortalProfile> {
  return portalRequest<PortalProfile>('/api/customer/me')
}

export function listPortalBranches(): Promise<PortalBranch[]> {
  return portalRequest<PortalBranch[]>('/api/customer/branches')
}

export function listPortalServices(branchId: string): Promise<PortalService[]> {
  return portalRequest<PortalService[]>(`/api/customer/branches/${branchId}/services`)
}

export function listPortalStaff(branchId: string, serviceId: string): Promise<PortalStaff[]> {
  return portalRequest<PortalStaff[]>(`/api/customer/branches/${branchId}/staff?serviceId=${serviceId}`)
}

export function getPortalAvailability(
  branchId: string,
  staffId: string,
  serviceId: string,
  date: string,
): Promise<PortalAvailability> {
  const query = new URLSearchParams({ branchId, staffId, serviceId, date })
  return portalRequest<PortalAvailability>(`/api/customer/availability?${query.toString()}`)
}

export function createPortalAppointment(input: {
  branchId: string
  staffMemberId: string
  serviceDefinitionId: string
  startUtc: string
  notes?: string | null
}): Promise<PortalAppointment> {
  return portalRequest<PortalAppointment>('/api/customer/appointments', { method: 'POST', body: input })
}

export function listMyPortalAppointments(): Promise<PortalAppointment[]> {
  return portalRequest<PortalAppointment[]>('/api/customer/appointments')
}
