import { apiRequest } from './apiClient'
import { customerAssistantRequest } from './customerPortalApi'

/**
 * Maydi asistanı istemcisi. İşletme paneli (/panel, /ekip) personel/yönetici token'ıyla /api/assistant'a,
 * müşteri portalı (/randevu) müşteri token'ıyla /api/customer/assistant'a gider. Kişi, rol, şube ve izin
 * DAİMA sunucuda oturumdan belirlenir; buradan giden bağlam yalnız ekran ipucu, dil, mağaza sürümü ve
 * yapay zekâ onayıdır.
 */

export type AssistantAudience = 'business' | 'customer'

export interface AssistantAction { type: string; label: string; route?: string | null }

export interface AssistantReply {
  conversationId: string
  messageId: string
  kind: 'text' | 'how_to' | 'data' | 'quick_actions' | string
  text: string
  intent: string
  outcome: string
  data?: unknown
  actions: AssistantAction[]
  suggestions: string[]
}

export interface AssistantStatus {
  enabled: boolean
  featureAllowed: boolean
  aiEnabled: boolean
  portal: string
  name: string
  dailyLimit: number
  privacyNoteTr: string
  privacyNoteEn: string
}

export interface AssistantBriefing { greeting: string; lines: string[]; suggestions: string[] }
export interface AssistantSuggestion { text: string; intent: string }
export interface AssistantConversation { id: string; title: string; portal: string; createdAtUtc: string; lastMessageAtUtc: string }
export interface AssistantStoredMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  kind: string
  intent: string
  outcome: string
  payloadJson: string
  feedback?: number | null
  createdAtUtc: string
}
export interface AssistantUnanswered { question: string; portal: string; count: number; lastAskedAtUtc: string }

export interface AssistantClientContext { route?: string | null; storeBuild?: boolean; english?: boolean; allowAi?: boolean }

/**
 * Mağaza sürümü: Mac App Store kabuğu `window.__BA_STORE__ = true` yazar (desktop-app/src-tauri/panel-shell.js).
 * Bu sürümde satın alma yüzeyleri (Paketim) önerilmez — App Store 3.1.1.
 */
export function isStoreBuild(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { __BA_STORE__?: boolean }).__BA_STORE__ === true
}

function query(context: AssistantClientContext): string {
  const params = new URLSearchParams()
  if (context.route) params.set('route', context.route)
  if (context.storeBuild) params.set('store', 'true')
  if (context.english) params.set('lang', 'en')
  if (context.allowAi === false) params.set('ai', 'false')
  const text = params.toString()
  return text ? `?${text}` : ''
}

export interface AssistantClient {
  status(): Promise<AssistantStatus>
  briefing(context: AssistantClientContext): Promise<AssistantBriefing>
  suggestions(context: AssistantClientContext): Promise<AssistantSuggestion[]>
  send(message: string, context: AssistantClientContext, conversationId?: string | null, clientMessageId?: string): Promise<AssistantReply>
  conversations(): Promise<AssistantConversation[]>
  messages(conversationId: string): Promise<AssistantStoredMessage[]>
  deleteConversation(conversationId: string): Promise<void>
  feedback(messageId: string, helpful: boolean): Promise<void>
}

type Method = 'GET' | 'POST' | 'DELETE'

function client(request: <T>(path: string, options?: { method?: Method; body?: unknown }) => Promise<T>): AssistantClient {
  return {
    status: () => request<AssistantStatus>('/status'),
    briefing: (context) => request<AssistantBriefing>(`/briefing${query(context)}`),
    suggestions: (context) => request<AssistantSuggestion[]>(`/suggestions${query(context)}`),
    send: (message, context, conversationId, clientMessageId) =>
      request<AssistantReply>('/messages', {
        method: 'POST',
        body: {
          conversationId: conversationId || null,
          message,
          clientMessageId: clientMessageId || null,
          context: {
            route: context.route ?? null,
            storeBuild: Boolean(context.storeBuild),
            english: Boolean(context.english),
            allowAi: context.allowAi !== false,
          },
        },
      }),
    conversations: () => request<AssistantConversation[]>('/conversations'),
    messages: (conversationId) => request<AssistantStoredMessage[]>(`/conversations/${conversationId}/messages`),
    deleteConversation: (conversationId) => request<void>(`/conversations/${conversationId}`, { method: 'DELETE' }),
    feedback: (messageId, helpful) => request<void>(`/messages/${messageId}/feedback`, { method: 'POST', body: { helpful } }),
  }
}

/** İşletme paneli: önbelleksiz (sohbet her zaman taze), seçili şube başlığı apiRequest tarafından eklenir. */
export const businessAssistant: AssistantClient = client((path, options) =>
  apiRequest(`/api/assistant${path}`, { method: options?.method, body: options?.body, noCache: true }))

export const customerAssistant: AssistantClient = client((path, options) => customerAssistantRequest(path, options))

export function assistantClient(audience: AssistantAudience): AssistantClient {
  return audience === 'customer' ? customerAssistant : businessAssistant
}

/** "Maydi Soruları" (yalnız kurum sahibi / şube yöneticisi). */
export function fetchUnansweredQuestions(days = 30): Promise<AssistantUnanswered[]> {
  return apiRequest<AssistantUnanswered[]>('/api/assistant/unanswered', { query: { days }, noCache: true })
}

// ── Yapay zekâ onayı (App Store 5.1.2(i)) ─────────────────────────────────
// Kişi başına, cihazda saklanır. Onay verilmeden soru buluta gönderilmez (allowAi=false).
// v2 (2026-11-19): onay kartına 90 günlük sohbet kaydı bilgisi eklendi — herkes yeni metni bir kez görür.

export type AiConsent = 'granted' | 'declined' | null

const consentKey = (scope: string) => `beautyasist.maydi.aiConsent.v2.${scope}`

export function readAiConsent(scope: string): AiConsent {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(consentKey(scope))
    return value === 'granted' || value === 'declined' ? value : null
  } catch {
    return null
  }
}

export function writeAiConsent(scope: string, value: Exclude<AiConsent, null>): void {
  try {
    window.localStorage.setItem(consentKey(scope), value)
  } catch {
    /* depolama kapalı: onay yalnız bu oturumda geçerli */
  }
}

// ── Kart verisi (sunucu verisi unknown gelir; güvenli okuma) ─────────────

export interface HowToData { id: string; title: string; steps: string[]; route?: string | null; matchedBy?: string }
export interface DataCard { intent: string; items: Record<string, unknown>[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function readHowTo(data: unknown): HowToData | null {
  if (!isRecord(data) || typeof data.title !== 'string' || !Array.isArray(data.steps)) return null
  return {
    id: String(data.id ?? ''),
    title: data.title,
    steps: data.steps.filter((step): step is string => typeof step === 'string'),
    route: typeof data.route === 'string' ? data.route : null,
    matchedBy: typeof data.matchedBy === 'string' ? data.matchedBy : undefined,
  }
}

export function readDataCard(data: unknown): DataCard | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null
  return { intent: String(data.intent ?? ''), items: data.items.filter(isRecord) }
}

/** Kayıtlı mesajın (geçmiş) kart verisini canlı cevap biçimine çevirir. */
export function storedToReply(conversationId: string, message: AssistantStoredMessage): AssistantReply {
  let payload: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(message.payloadJson || '{}')
    if (isRecord(parsed)) payload = parsed
  } catch {
    /* bozuk kayıt: yalnız metin */
  }
  return {
    conversationId,
    messageId: message.id,
    kind: message.kind,
    text: message.text,
    intent: message.intent,
    outcome: message.outcome,
    data: payload.data,
    actions: Array.isArray(payload.actions) ? (payload.actions as AssistantAction[]) : [],
    suggestions: Array.isArray(payload.suggestions) ? (payload.suggestions as string[]).filter((s) => typeof s === 'string') : [],
  }
}

/** Yalnız teşekkür/beğeni mesajı (soru içinde geçen teşekkür sayılmaz) — maskot "love" pozu için. */
export function isAppreciation(message: string): boolean {
  const words = message
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\bmaydi\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(?:cok )?(?:tesekkur(?:ler| ederim| ediyorum| ederiz)?|sag ?ol(?:un)?|eline saglik|emegine saglik|harikasin|supersin|thanks(?: a lot)?|thank you(?: very much)?)(?: cok yardimci oldun)?$/.test(words)
}

// ── Platform: Maydi özet ve istatistik (kişi ve konuşma içeriği yok) ──────

export interface AssistantStatsCount { key: string; count: number }
export interface AssistantPlatformStats {
  days: number
  fromUtc: string
  totals: {
    questions: number; answered: number; notFound: number; denied: number; adviceRefused: number; errors: number
    answerRate: number; activeUsers: number; activeTenants: number; conversations: number
    feedbackUp: number; feedbackDown: number; averageResponseMs: number
  }
  byPortal: AssistantStatsCount[]
  byOutcome: AssistantStatsCount[]
  byIntent: AssistantStatsCount[]
  helpMatchedBy: AssistantStatsCount[]
  daily: { date: string; questions: number; notFound: number }[]
  tenants: { tenantId: string; tenantName: string; questions: number; notFound: number; activeUsers: number; feedbackUp: number; feedbackDown: number; lastActivityUtc: string }[]
  commonUnanswered: { question: string; count: number; tenants: number }[]
  llm: { configured: boolean; calls: number; failed: number; promptTokens: number; completionTokens: number; averageDurationMs: number; errors: AssistantStatsCount[] }
}

export function fetchPlatformAssistantStats(days = 30): Promise<AssistantPlatformStats> {
  return apiRequest<AssistantPlatformStats>('/api/platform/assistant/stats', { query: { days }, noCache: true })
}

// ── Platform: Maydi sohbet kayıtları (güvenlik kaydı; gerekçe zorunlu, her erişim izlenir) ──

export type AssistantLogReason = 'security' | 'support' | 'complaint' | 'quality'
export const ASSISTANT_LOG_REASONS: { value: AssistantLogReason; label: string }[] = [
  { value: 'security', label: 'Güvenlik' },
  { value: 'support', label: 'Destek talebi' },
  { value: 'complaint', label: 'Şikâyet incelemesi' },
  { value: 'quality', label: 'Kalite kontrol' },
]

export interface AssistantLogUser { userId: string; fullName?: string | null; email: string; role: string }
export interface AssistantLogRow {
  conversationId: string; tenantId: string; tenantName: string; branchName?: string | null; user?: AssistantLogUser | null
  portal: string; title: string; questions: number; notFound: number; negative: number; startedAtUtc: string; lastMessageAtUtc: string
}
export interface AssistantLogPage { page: number; pageSize: number; total: number; retentionDays: number; items: AssistantLogRow[] }
export interface AssistantLogMessage {
  id: string; sender: 'user' | 'assistant'; text: string; kind: string; intent: string; outcome: string; matchedBy: string
  articleId?: string | null; feedback?: number | null; durationMs: number; createdAtUtc: string
}
export interface AssistantLogConversation { conversation: AssistantLogRow; messages: AssistantLogMessage[] }
export interface AssistantAccessLogEntry {
  atUtc: string; platformUser: string; action: string; reason: string; note?: string | null; tenantName?: string | null; conversationId?: string | null; filter?: string | null
}

export interface AssistantLogFilter {
  reason: AssistantLogReason; note?: string; tenantId?: string; days: number; outcome?: string; negative?: boolean; search?: string; page?: number
}

export function fetchAssistantLogs(filter: AssistantLogFilter): Promise<AssistantLogPage> {
  return apiRequest<AssistantLogPage>('/api/platform/assistant/conversations', {
    noCache: true,
    query: {
      reason: filter.reason, note: filter.note || undefined, tenantId: filter.tenantId || undefined, days: filter.days,
      outcome: filter.outcome || undefined, negative: filter.negative ? true : undefined, search: filter.search || undefined, page: filter.page ?? 1,
    },
  })
}

export function fetchAssistantLogConversation(conversationId: string, reason: AssistantLogReason, note?: string): Promise<AssistantLogConversation> {
  return apiRequest<AssistantLogConversation>(`/api/platform/assistant/conversations/${conversationId}`, {
    noCache: true, query: { reason, note: note || undefined },
  })
}

export function fetchAssistantAccessLog(days = 30): Promise<AssistantAccessLogEntry[]> {
  return apiRequest<AssistantAccessLogEntry[]>('/api/platform/assistant/access-log', { noCache: true, query: { days } })
}
