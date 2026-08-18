import type { ApiEnvelope } from './types'

/**
 * SELF-SERVİS KURUM KAYDI istemcisi (`/api/public/signup`) — oturum gerektirmez.
 *
 * Akış üç adımdır ve her adım bir sonrakinin ön koşuludur:
 * 1. `startSignup` — bilgiler alınır, e-postaya kod gider
 * 2. `verifySignupEmail` — e-posta kodu doğrulanır, telefona kod gider
 * 3. `verifySignupPhone` — telefon kodu doğrulanır, KURUM OLUŞUR + oturum döner
 *
 * Kurum yalnızca son adımda oluşur: yarım kalan denemeler veritabanına hiç yazılmaz.
 */
const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/proxy').replace(/\/$/, '')

export class SignupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SignupError'
  }
}

async function signupRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options
  const response = await fetch(`${API_BASE_URL}/api/public/signup${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let envelope: ApiEnvelope<T> | null = null
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    /* gövdesiz yanıt */
  }
  if (!response.ok || !envelope?.success) {
    throw new SignupError(
      envelope?.error?.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      response.status,
    )
  }
  return envelope.data as T
}

export interface SignupForm {
  tenantName: string
  ownerName: string
  email: string
  phone: string
  branchName: string
  city: string
  /**
   * 2. adımdaki telefon kodunun kanalı: 'sms' | 'whatsapp'. Boşsa sunucu kurulu olanı seçer.
   * Seçim kullanıcınındır — WhatsApp kullanmayan bir işletme sahibi SMS seçebilmeli.
   */
  phoneChannel?: SignupPhoneChannel | null
}

export type SignupPhoneChannel = 'sms' | 'whatsapp'

export interface SignupReadiness {
  email: boolean
  phone: boolean
  /** İkisi de kurulu değilse kayıt akışı tamamlanamaz — form gösterilmez. */
  canSignup: boolean
  /** Telefon kanalları ayrı ayrı: yalnız kurulu olan seçenek gösterilsin. */
  sms: boolean
  whatsApp: boolean
}

export interface SignupStarted {
  signupId: string
  maskedEmail: string
  devCode?: string | null
}

export interface SignupEmailVerified {
  maskedPhone: string
  /** 'whatsapp' | 'sms' — ikinci faktör telefon sahipliğidir, WhatsApp zorunlu değildir. */
  channel: string
  devCode?: string | null
}

export interface SignupCredentials {
  tenantId: string
  ownerName: string
  email: string
  initialPassword: string
  tenantName: string
  branchName: string | null
  mustChangePassword: boolean
  createdAtUtc: string
}

export interface SignupSessionUser {
  userId: string
  email: string
  fullName: string | null
  role: string | number
  tenantId: string | null
  branchId: string | null
  mustChangePassword: boolean
}

export interface SignupCompleted {
  tenantCode: string
  tenant: { id: string; name: string; slug: string; plan: string; trialEndsAtUtc: string | null }
  credentials: SignupCredentials
  session: {
    accessToken: string
    refreshToken: string
    expiresAtUtc: string
    user: SignupSessionUser
  }
}

/** Kayıt alınabilir mi? Form gösterilmeden önce sorulur (3 adım doldurup duvara çarpmasın). */
export function getSignupReadiness(): Promise<SignupReadiness> {
  return signupRequest<SignupReadiness>('/readiness')
}

export function startSignup(form: SignupForm): Promise<SignupStarted> {
  return signupRequest<SignupStarted>('/start', { method: 'POST', body: form })
}

export function verifySignupEmail(signupId: string, code: string): Promise<SignupEmailVerified> {
  return signupRequest<SignupEmailVerified>('/verify-email', { method: 'POST', body: { signupId, code } })
}

export function verifySignupPhone(signupId: string, code: string): Promise<SignupCompleted> {
  return signupRequest<SignupCompleted>('/verify-phone', { method: 'POST', body: { signupId, code } })
}

export function resendSignupCode(signupId: string): Promise<{ message?: string; devCode?: string | null }> {
  return signupRequest('/resend', { method: 'POST', body: { signupId } })
}
