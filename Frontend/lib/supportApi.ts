import type { ApiEnvelope } from './types'

/**
 * DESTEK TALEPLERİ istemcisi.
 *
 * ÜÇ AYRI GİRİŞ, TEK KUYRUK (backend ile birebir):
 * 1. **Ziyaretçi** — `/destek` formu. Oturum gerektirmez; takip kod + jetonla yapılır.
 * 2. **Kurum kullanıcısı** — panelden açar; yalnız kendi kurumunun taleplerini görür.
 * 3. **Platform** — tüm kuyruk (bkz. `lib/apiClient.ts` → `platformSupportApi`).
 *
 * BU DOSYA yalnız 1. yolu kapsar: anonim uçlar oturum başlığı taşımaz ve taşımamalıdır.
 * Oturumlu uçlar `apiClient` üzerinden gider (jeton ve şube başlığı orada eklenir).
 */
const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/proxy').replace(/\/$/, '')

export class SupportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SupportError'
  }
}

async function supportRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options
  const response = await fetch(`${API_BASE_URL}/api/public/support${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // OTURUM BAŞLIĞI EKLENMEZ: bu uçlar anonimdir. Ama tarayıcı kendi çerezini yollarsa
    // sunucu oturumu tanır ve talebi kuruma bağlar — bu İSTENEN davranıştır (giriş yapmış
    // kullanıcı formu doldurduğunda talep kurumunun kuyruğuna düşsün).
    credentials: 'include',
  })

  let envelope: ApiEnvelope<T> | null = null
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    /* gövdesiz yanıt */
  }
  if (!response.ok || !envelope?.success) {
    throw new SupportError(
      envelope?.error?.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      response.status,
    )
  }
  return envelope.data as T
}

// ---- Tipler (backend DTO karşılıkları; enum'lar JSON'da integer gelir) ----

/** SupportTicketStatus — 0 Açık · 1 İnceleniyor · 2 Yanıt bekleniyor · 3 Çözüldü · 4 Kapatıldı. */
export type SupportStatus = 0 | 1 | 2 | 3 | 4

/** SupportTicketPriority — 0 Düşük · 1 Normal · 2 Yüksek · 3 Acil. */
export type SupportPriority = 0 | 1 | 2 | 3

/** SupportTicketCategory — 0 Genel · 1 Hata · 2 Fatura · 3 Özellik · 4 Hesap · 5 Kurulum. */
export type SupportCategory = 0 | 1 | 2 | 3 | 4 | 5

/** SupportAuthorSide — 0 talep sahibi · 1 platform · 2 sistem notu. */
export type SupportSide = 0 | 1 | 2

export interface SupportMessage {
  id: string
  side: SupportSide
  body: string
  authorName: string | null
  sentAtUtc: string
}

export interface SupportTicketDetail {
  id: string
  code: string
  subject: string
  status: SupportStatus
  priority: SupportPriority
  category: SupportCategory
  requesterName: string
  requesterEmail: string
  requesterPhone: string | null
  tenantName: string | null
  tenantId: string | null
  assignedToUserId: string | null
  assignedToName: string | null
  createdAtUtc: string
  lastMessageAtUtc: string
  firstResponseAtUtc: string | null
  resolvedAtUtc: string | null
  messages: SupportMessage[]
}

export interface SupportTicketListItem {
  id: string
  code: string
  subject: string
  status: SupportStatus
  priority: SupportPriority
  category: SupportCategory
  requesterName: string
  requesterEmail: string
  tenantName: string | null
  tenantId: string | null
  assignedToUserId: string | null
  assignedToName: string | null
  createdAtUtc: string
  lastMessageAtUtc: string
  hasUnreadForPlatform: boolean
  hasUnreadForRequester: boolean
  messageCount: number
}

export interface SupportTicketCreated {
  id: string
  code: string
  /**
   * TAKİP JETONU — yalnız oluşturma yanıtında gelir, bir daha GÖSTERİLMEZ.
   * Kullanıcı takip bağlantısını kaybederse e-postasındaki kopyayı kullanır.
   */
  accessToken: string
  trackUrl: string
}

export interface SupportSummary {
  open: number
  inProgress: number
  waitingCustomer: number
  unread: number
  urgent: number
  resolvedLast7Days: number
  avgFirstResponseHours: number | null
}

// ---- Etiketler — TEK kaynak (web + platform paneli aynı sözcükleri kullanır) ----

export const supportStatusLabel: Record<SupportStatus, string> = {
  0: 'Açık',
  1: 'İnceleniyor',
  2: 'Yanıtınız bekleniyor',
  3: 'Çözüldü',
  4: 'Kapatıldı',
}

export const supportPriorityLabel: Record<SupportPriority, string> = {
  0: 'Düşük',
  1: 'Normal',
  2: 'Yüksek',
  3: 'Acil',
}

export const supportCategoryLabel: Record<SupportCategory, string> = {
  0: 'Genel soru',
  1: 'Bir şey çalışmıyor',
  2: 'Fatura & abonelik',
  3: 'Özellik isteği',
  4: 'Hesap & yetki',
  5: 'Kurulum & veri aktarımı',
}

/** Durum rengi — rozetlerde kullanılır. Anlam renkten okunabilmeli. */
export const supportStatusTone: Record<SupportStatus, 'amber' | 'sky' | 'violet' | 'emerald' | 'slate'> = {
  0: 'amber',
  1: 'sky',
  2: 'violet',
  3: 'emerald',
  4: 'slate',
}

// ---- Anonim uçlar ----

export function createSupportTicket(input: {
  subject: string
  message: string
  name?: string | null
  email?: string | null
  phone?: string | null
  category: SupportCategory
}): Promise<SupportTicketCreated> {
  return supportRequest<SupportTicketCreated>('/', { method: 'POST', body: input })
}

/** Kod + jetonla talebi görüntüler. */
export function trackSupportTicket(code: string, token: string): Promise<SupportTicketDetail> {
  const query = new URLSearchParams({ code, token })
  return supportRequest<SupportTicketDetail>(`/track?${query.toString()}`)
}

/** Kod + jetonla yanıt yazar. Kod ve jeton GÖVDEDE taşınır (URL'de kalıcı iz bırakmasın). */
export function replySupportTicket(code: string, token: string, message: string): Promise<SupportTicketDetail> {
  return supportRequest<SupportTicketDetail>('/track/reply', { method: 'POST', body: { code, token, message } })
}
