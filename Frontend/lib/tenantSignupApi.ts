import type { ApiEnvelope } from './types'

/**
 * SELF-SERVİS KURUM KAYDI istemcisi (`/api/public/signup`) — oturum gerektirmez.
 *
 * Akış İKİ ya da ÜÇ adımdır — kararı SUNUCU verir (`readiness.phoneVerification`):
 * 1. `startSignup` — bilgiler alınır, e-postaya kod gider
 * 2. `verifySignupEmail` — e-posta kodu doğrulanır. Yanıttaki `nextStep`:
 *      · `'done'`  → KURUM OLUŞTU (telefon adımı kapalı); `completed` alanı doludur
 *      · `'phone'` → telefona kod gitti, 3. adım gerekli
 * 3. `verifySignupPhone` — telefon kodu doğrulanır, KURUM OLUŞUR + oturum döner
 *
 * TELEFON ADIMI NEDEN KAPALI OLABİLİR? SMS sağlayıcısı canlıya alınmadan telefon sahipliği
 * kanıtlanamıyor; adım açık bırakılsaydı hiçbir kayıt tamamlanamazdı. Sağlayıcı kurulunca
 * sunucuda `TenantSignup:RequirePhoneVerification` açılır ve akış kendiliğinden üç adıma döner —
 * bu istemcide DEĞİŞİKLİK GEREKMEZ. Adım sayısını istemci VARSAYMAZ, yanıttan okur.
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
  /** Kayıt akışı tamamlanabilir mi? Değilse form gösterilmez. */
  canSignup: boolean
  /** Telefon kanalları ayrı ayrı: yalnız kurulu olan seçenek gösterilsin. */
  sms: boolean
  whatsApp: boolean
  /**
   * Telefon doğrulama adımı AÇIK MI?
   *
   * Kapalıyken form telefon adımını ve kanal seçimini HİÇ göstermez; kayıt e-posta kodundan
   * sonra biter. Bu bir istemci tercihi değil sunucu kararıdır — istemci yalnız ekranı buna
   * göre kurar, kuralı sunucu zorlar.
   */
  phoneVerification: boolean
}

export interface SignupStarted {
  signupId: string
  maskedEmail: string
  devCode?: string | null
}

/**
 * 2. adımın yanıtı — AYRIK BİRLEŞİM (discriminated union).
 *
 * `nextStep` kararı AÇIKÇA söyler. Hangi alanların dolu geldiğine bakarak çıkarmak kırılgandır:
 * bir alan ileride isteğe bağlı olduğunda akış sessizce yanlış dalı seçerdi.
 */
export interface SignupEmailVerified {
  /** `'phone'` → telefon adımı gerekli · `'done'` → kurum açıldı. */
  nextStep: 'phone' | 'done'
  /** Yalnız `nextStep === 'phone'` iken dolu. */
  maskedPhone?: string | null
  /** 'whatsapp' | 'sms' — ikinci faktör telefon sahipliğidir, WhatsApp zorunlu değildir. */
  channel?: string | null
  devCode?: string | null
  /** Yalnız `nextStep === 'done'` iken dolu: kurum, geçici parola ve oturum. */
  completed?: SignupCompleted | null
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
