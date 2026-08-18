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

/**
 * Müşteri girişinin kimliği: ad soyad + telefon.
 *
 * DOĞUM TARİHİ YOK: App Store 5.1.1(v) gereği girişte zorunlu tutulamaz (randevu almak için
 * gerekmez). Kayıtta isteğe bağlı olarak alınır — bkz. CustomerRegisterInput.
 */
export interface CustomerLoginInput {
  fullName: string
  phone: string
}

export interface CustomerRegisterInput extends CustomerLoginInput {
  gender: number // Gender enum: 0 Unspecified, 1 Female, 2 Male, 3 Other
  email: string | null
  birthDate?: string | null // 'yyyy-MM-dd' — İSTEĞE BAĞLI (doğum günü kampanyaları için)
}

/**
 * Doğrulama kodunun gideceği kanal. WhatsApp TEK kanal değildir (App Store 3.2.2(v)).
 * Sunucu tarafındaki sayılarla birebir: Auto 0, WhatsApp 1, Sms 2, Email 3.
 */
export type CustomerOtpChannel = 'whatsapp' | 'sms' | 'email'

const channelCode = (channel?: CustomerOtpChannel): number =>
  channel === 'whatsapp' ? 1 : channel === 'sms' ? 2 : channel === 'email' ? 3 : 0

export interface CustomerOtpChannels {
  whatsApp: boolean
  sms: boolean
  email: boolean
}

/**
 * Platformda hangi kanallardan kod gönderilebilir? Dönen bilgi platform yapılandırmasıdır;
 * kullanıcı kimliğiyle ilgisi yoktur. Amaç: çalışmayan bir kanalı seçenek olarak göstermemek.
 */
export async function getCustomerOtpChannels(): Promise<CustomerOtpChannels | null> {
  try {
    return await portalRequest<CustomerOtpChannels>('/api/auth/customer/otp/channels', { auth: false })
  } catch {
    // FAIL-OPEN DEĞİL. Eskiden hata durumunda "hepsi açık" dönülüyordu: kullanıcı SMS seçiyor,
    // sunucu ise kurulu olmayan kanalı atlayıp başkasına düşüyordu — yani ekranda seçtiği yerden
    // kod GELMİYORDU. Bilinmiyorsa kanal seçici hiç gösterilmez ve sunucunun kararı kullanılır.
    return null
  }
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
  if (!session) {
    window.localStorage.removeItem(CUSTOMER_SESSION_KEY)
    return
  }
  // GÜVENLİK: uzun ömürlü refresh token tarayıcı depolamasına YAZILMAZ — /api/proxy onu HttpOnly
  // çereze taşır (bkz. app/api/[[...path]]/route.ts). Burada yalnız access token + profil durur.
  window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify({ ...session, refreshToken: '' }))
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

/**
 * KİMLİK KAPISI = OTP. Doğrudan token veren `/customer/login` ve `/customer/register` uçları
 * kapatıldı (410): ad + telefon + doğum tarihi bilinen bir müşterinin hesabı OTP'siz ele
 * geçirilebiliyordu. Giriş de kayıt da iki adımlıdır: kod iste → kodu doğrula.
 */
export type CustomerOtpPurpose = 'login' | 'register'

const purposeCode = (purpose: CustomerOtpPurpose): number => (purpose === 'register' ? 1 : 0)

/**
 * OTP adım 1: seçilen kanaldan (SMS / WhatsApp / e-posta) 6 haneli kod gönderilir.
 * Dev ortamında kod yanıtta döner.
 *
 * `email` YALNIZCA kayıt akışında anlamlıdır: girişte kod, kurum kayıtlarındaki adrese gider —
 * kullanıcıdan adres istemek, yanlış yazıldığında sessiz başarısızlığa dönüşürdü.
 */
export function customerOtpRequest(
  input: CustomerLoginInput & { channel?: CustomerOtpChannel; email?: string | null },
  purpose: CustomerOtpPurpose = 'login',
): Promise<{ message?: string; hint?: string | null; devCode?: string | null }> {
  return portalRequest<{ message?: string; hint?: string | null; devCode?: string | null }>('/api/auth/customer/otp/request', {
    method: 'POST',
    auth: false,
    body: {
      fullName: input.fullName,
      phone: input.phone,
      purpose: purposeCode(purpose),
      channel: channelCode(input.channel),
      email: input.email || null,
    },
  })
}

/** OTP adım 2: kod doğruysa giriş yapılır; kayıt akışında hesap açılıp giriş yapılır. */
export async function customerOtpVerify(
  input: CustomerLoginInput & {
    code: string
    purpose?: CustomerOtpPurpose
    gender?: number
    email?: string | null
    birthDate?: string | null
    /** KVKK açık rızası — kayıt akışında ZORUNLU; sunucu onaysız kaydı reddeder. */
    kvkkConsent?: boolean
  },
): Promise<CustomerSession> {
  const purpose = input.purpose ?? 'login'
  const session = await portalRequest<CustomerSession>('/api/auth/customer/otp/verify', {
    method: 'POST',
    auth: false,
    body: {
      fullName: input.fullName,
      phone: input.phone,
      code: input.code,
      purpose: purposeCode(purpose),
      gender: input.gender ?? 0,
      email: input.email || null,
      // İsteğe bağlı: yalnız kayıtta ve yalnız kullanıcı girdiyse profile yazılır.
      birthDate: input.birthDate || null,
      kvkkConsent: input.kvkkConsent === true,
    },
  })
  storeCustomerSession(session)
  return session
}


export async function customerLogout(): Promise<void> {
  const session = getCustomerSession()
  storeCustomerSession(null)
  if (!session) return
  try {
    // Refresh token gövdede taşınmaz: proxy HttpOnly çerezden ekler ve çerezi siler.
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: '' }),
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

/** Müşteri kendi randevusunu iptal eder (başlangıca ≥ 2 saat varken). */
export function cancelMyPortalAppointment(appointmentId: string): Promise<void> {
  return portalRequest<void>(`/api/customer/appointments/${appointmentId}/cancel`, { method: 'POST', body: {} })
}

/** Müşteri kendi randevusunu erteler — yeni saat salon onayına düşer. */
export function rescheduleMyPortalAppointment(appointmentId: string, startUtc: string): Promise<void> {
  return portalRequest<void>(`/api/customer/appointments/${appointmentId}/reschedule`, { method: 'POST', body: { startUtc } })
}
