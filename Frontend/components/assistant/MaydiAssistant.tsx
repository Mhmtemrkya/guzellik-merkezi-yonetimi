'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseUtc } from '@/lib/datetime'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, History, Loader2, RotateCcw, Send, ShieldCheck, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import MaydiMascot, { type MaydiResponseMood } from './MaydiMascot'
import MaydiLauncher from './MaydiLauncher'
import {
  assistantClient,
  isAppreciation,
  isStoreBuild,
  readAiConsent,
  readDataCard,
  readHowTo,
  storedToReply,
  writeAiConsent,
  type AiConsent,
  type AssistantAudience,
  type AssistantBriefing,
  type AssistantConversation,
  type AssistantReply,
  type AssistantStatus,
} from '@/lib/assistantApi'

interface ChatMessage {
  id: string
  from: 'user' | 'assistant'
  text: string
  reply?: AssistantReply
  feedback?: number | null
  mood?: MaydiResponseMood
}

interface MaydiAssistantProps {
  audience: AssistantAudience
  /** Onay ve geçmiş kişiye özel: kullanıcı kimliği (müşteride müşteri kimliği). Boşsa Maydi gösterilmez. */
  scope: string | null | undefined
}

/** Veri kartındaki alan adlarının Türkçe etiketleri (sunucu sabit anahtarlar döner). */
const FIELD_LABELS: Record<string, string> = {
  time: 'Saat', customer: 'Müşteri', service: 'Hizmet', status: 'Durum', left: 'Kalan', total: 'Toplam', staff: 'Personel',
  free: 'Boş aralık', count: 'Adet', day: 'Gün', title: 'İşlem', by: 'İsteyen', at: 'Tarih', product: 'Ürün', stock: 'Stok',
  min: 'Kritik', unit: 'Birim', date: 'Tarih', amount: 'Tutar', oldest: 'En eski vade', completed: 'Tamamlanan', revenue: 'Ciro',
  last: 'Son', when: 'Zaman', method: 'Yöntem', income: 'Tahsilat', average: 'Ortalama',
}

const MONEY_FIELDS = new Set(['amount', 'revenue', 'income'])

function cell(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'number' && MONEY_FIELDS.has(key)) return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
  if (typeof value === 'number') return value.toLocaleString('tr-TR')
  return value == null ? '—' : String(value)
}

function moodOf(reply: AssistantReply, question: string): MaydiResponseMood {
  if (reply.outcome === 'denied' || reply.outcome === 'error') return 'speaking'
  if (isAppreciation(question)) return 'love'
  if (reply.kind === 'how_to' || reply.actions.some((action) => action.type === 'navigate')) return 'guiding'
  if (reply.kind === 'data') return 'happy'
  return 'speaking'
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/**
 * Maydi — BeautyAsist'in uygulama içi asistanı (SchoolAsist Maydi ile aynı). Web panelinde (/panel, /ekip), müşteri
 * portalında (/randevu) ve aynı web panelini açan masaüstü uygulamasında görünür.
 * <ul>
 * <li>Kurumun paketinde "ai.assistant" yoksa ya da asistan kapalıysa hiç çizilmez.</li>
 * <li>İlk açılışta yapay zekâ onayı istenir (App Store 5.1.2(i)); reddedilirse soru buluta hiç gitmez,
 * Maydi kural motoru ve anahtar kelimeyle cevaplar.</li>
 * <li>Mac App Store kabuğunda satın alma ekranları önerilmez (3.1.1).</li>
 * </ul>
 */
export default function MaydiAssistant({ audience, scope }: MaydiAssistantProps) {
  const api = useMemo(() => assistantClient(audience), [audience])
  const pathname = usePathname() || ''
  const router = useRouter()
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState<AiConsent>(null)
  const [briefing, setBriefing] = useState<AssistantBriefing | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<AssistantConversation[]>([])
  const [responseId, setResponseId] = useState<string>()
  const [responseMood, setResponseMood] = useState<MaydiResponseMood>('speaking')
  const [affection, setAffection] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const context = useMemo(() => ({
    route: pathname,
    storeBuild: isStoreBuild(),
    english: false,
    allowAi: consent === 'granted',
  }), [pathname, consent])

  // Durum: paket kapısı. Hata (403/404/oturum yok) = Maydi gizli kalır, sayfa etkilenmez.
  useEffect(() => {
    if (!scope) return
    let active = true
    api.status().then((value) => { if (active) setStatus(value) }).catch(() => { if (active) setStatus(null) })
    setConsent(readAiConsent(`${audience}.${scope}`))
    return () => { active = false }
  }, [api, audience, scope])

  const visible = Boolean(scope && status?.enabled && status.featureAllowed)

  // Panel ilk açılışta (onaydan sonra) brifing yükler.
  useEffect(() => {
    if (!open || consent === null || briefing || !visible) return
    api.briefing(context).then(setBriefing).catch(() => setBriefing({ greeting: 'Merhaba, ben Maydi.', lines: [], suggestions: [] }))
  }, [open, consent, briefing, visible, api, context])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const decide = (value: Exclude<AiConsent, null>) => {
    if (!scope) return
    writeAiConsent(`${audience}.${scope}`, value)
    setConsent(value)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setError('')
    setInput('')
    setMessages((current) => [...current, { id: newId(), from: 'user', text: message }])
    setBusy(true)
    try {
      const reply = await api.send(message, context, conversationId, newId())
      setConversationId(reply.conversationId)
      const mood = moodOf(reply, message)
      setMessages((current) => [...current, { id: reply.messageId, from: 'assistant', text: reply.text, reply, mood }])
      setResponseMood(mood)
      setResponseId(reply.messageId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mesaj gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }, [api, busy, context, conversationId])

  const rate = async (message: ChatMessage, helpful: boolean) => {
    setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, feedback: helpful ? 1 : -1 } : item)))
    if (helpful) setAffection((current) => current + 1)
    try {
      await api.feedback(message.id, helpful)
    } catch {
      /* geri bildirim kaybı sohbeti bozmaz */
    }
  }

  const navigate = (route?: string | null) => {
    if (!route) return
    if (route !== pathname) router.push(route)
    if (window.matchMedia('(max-width: 1023px)').matches) setOpen(false)
  }

  const newChat = () => {
    setMessages([])
    setConversationId(null)
    setShowHistory(false)
    setError('')
  }

  const openHistory = async () => {
    setShowHistory(true)
    try { setHistory(await api.conversations()) } catch { setHistory([]) }
  }

  const loadConversation = async (id: string) => {
    try {
      const stored = await api.messages(id)
      setMessages(stored.map((item) => item.sender === 'user'
        ? { id: item.id, from: 'user', text: item.text }
        : { id: item.id, from: 'assistant', text: item.text, reply: storedToReply(id, item), feedback: item.feedback }))
      setConversationId(id)
      setShowHistory(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sohbet açılamadı.')
    }
  }

  const removeConversation = async (id: string) => {
    try {
      await api.deleteConversation(id)
      setHistory((current) => current.filter((item) => item.id !== id))
      if (id === conversationId) newChat()
    } catch {
      /* sessiz */
    }
  }

  if (!visible) return null
  const suggestions = messages.length === 0
    ? briefing?.suggestions ?? []
    : [...messages].reverse().find((item) => item.reply)?.reply?.suggestions ?? []

  return (
    <>
      <MaydiLauncher routeKey={pathname} visible={!open} label="Maydi'ye sor" onOpen={() => setOpen(true)} />
      {open && (
        <section
          role="dialog"
          aria-label="Maydi asistanı"
          className="fixed inset-x-2 bottom-2 top-16 z-[90] flex flex-col overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-white shadow-[0_30px_80px_-30px_rgba(110,40,70,0.55)] sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[min(640px,calc(100vh-2rem))] sm:w-[400px] lg:bottom-4"
        >
          {/* Başlık */}
          <header className="flex items-center gap-2 border-b border-[#f1e3e9] bg-gradient-to-r from-[#fff5f8] to-[#fdeef3] px-3 py-2">
            <MaydiMascot size={44} thinking={busy} responseId={responseId} responseMood={responseMood} affectionSignal={affection} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-[#2A2027]">Maydi</div>
              <div className="truncate text-[10.5px] text-[#74616A]">
                {consent === 'declined' ? 'Yapay zekâ kapalı · yalnız uygulama içi cevaplar' : 'BeautyAsist asistanı'}
              </div>
            </div>
            {consent !== null && (
              <>
                <button type="button" onClick={showHistory ? () => setShowHistory(false) : openHistory} title="Geçmiş sohbetler"
                  className="rounded-lg p-1.5 text-[#8C4460] hover:bg-white/70">
                  {showHistory ? <ArrowLeft className="h-4 w-4" /> : <History className="h-4 w-4" />}
                </button>
                <button type="button" onClick={newChat} title="Yeni sohbet" className="rounded-lg p-1.5 text-[#8C4460] hover:bg-white/70">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" className="rounded-lg p-1.5 text-[#74616A] hover:bg-white/70">
              <X className="h-4 w-4" />
            </button>
          </header>

          {consent === null ? (
            <ConsentCard status={status} onDecide={decide} />
          ) : showHistory ? (
            <div className="flex-1 overflow-y-auto p-3">
              {history.length === 0 && <p className="py-8 text-center text-[12px] text-[#74616A]">Henüz kayıtlı sohbet yok.</p>}
              {history.map((item) => (
                <div key={item.id} className="mb-1.5 flex items-center gap-2 rounded-xl border border-[#f1e3e9] px-3 py-2 hover:border-[#C85776]">
                  <button type="button" onClick={() => loadConversation(item.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[12.5px] font-semibold text-[#2A2027]">{item.title}</div>
                    <div className="text-[10.5px] text-[#74616A]">{parseUtc(item.lastMessageAtUtc)?.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </button>
                  <button type="button" onClick={() => removeConversation(item.id)} title="Sohbeti sil" className="rounded-lg p-1 text-[#74616A] hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
                {messages.length === 0 && (
                  <div className="rounded-2xl bg-[#fff5f8] px-3 py-3 text-[12.5px] leading-relaxed text-[#3b2330]">
                    {briefing ? (
                      <>
                        <p className="font-semibold">{briefing.greeting}</p>
                        {briefing.lines.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {briefing.lines.map((line) => (
                              <li key={line} className="flex gap-1.5"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C85776]" />{line}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-[#74616A]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Hazırlanıyor…</span>
                    )}
                  </div>
                )}
                {messages.map((message) => message.from === 'user' ? (
                  <div key={message.id} className="ml-10 rounded-2xl rounded-br-md bg-[#8e3f5b] px-3 py-2 text-[12.5px] text-white">{message.text}</div>
                ) : (
                  <AssistantBubble key={message.id} message={message} onNavigate={navigate} onRate={rate} />
                ))}
                {busy && (
                  <div className="mr-10 inline-flex items-center gap-2 rounded-2xl bg-[#F7F6F6] px-3 py-2 text-[12px] text-[#74616A]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Maydi düşünüyor…
                  </div>
                )}
                {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>}
              </div>

              {suggestions.length > 0 && !busy && (
                <div className="flex gap-1.5 overflow-x-auto border-t border-[#f6edf1] px-3 py-2">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => send(suggestion)}
                      className="shrink-0 rounded-full border border-[#EAD8DF] bg-white px-2.5 py-1 text-[11px] font-medium text-[#8C4460] hover:border-[#8C4460]">
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={(event) => { event.preventDefault(); void send(input) }} className="flex items-end gap-2 border-t border-[#f1e3e9] px-3 py-2.5">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value.slice(0, 1000))}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input) } }}
                  rows={1}
                  placeholder="Maydi'ye sorun…"
                  aria-label="Mesajınız"
                  className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-[#EAD8DF] bg-[#FBF8F9] px-3 py-2 text-[12.5px] text-[#2A2027] outline-none focus:border-[#A5556E]"
                />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Gönder"
                  className="grid h-[38px] w-[38px] place-items-center rounded-xl bg-[#8e3f5b] text-white disabled:opacity-40">
                  <Send className="h-4 w-4" />
                </button>
              </form>
              <p className="flex items-start gap-1.5 px-3 pb-2 text-[9.5px] leading-snug text-[#8a7880]">
                <ShieldCheck className="mt-px h-3 w-3 shrink-0" />
                {consent === 'granted'
                  ? 'Yardım için yalnız sorunuz, ad/telefon/TC/e-posta gizlenerek yapay zekâya gider; sağlık bilgisi asla gönderilmez.'
                  : 'Yapay zekâ kapalı: sorularınız dışarı gönderilmez.'}
                {' '}Sohbetler 90 gün saklanır. Güzellik/sağlık tavsiyesi vermez.
              </p>
            </>
          )}
        </section>
      )}
    </>
  )
}

function ConsentCard({ status, onDecide }: { status: AssistantStatus | null; onDecide: (value: 'granted' | 'declined') => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 overflow-y-auto px-4 py-4 text-[12.5px] leading-relaxed text-[#3b2330]">
      <div className="flex justify-center"><MaydiMascot size={110} mood="guiding" /></div>
      <p className="text-center text-[14px] font-bold">Merhaba, ben Maydi!</p>
      <p>Uygulamanın nasıl kullanıldığını anlatır, randevu, kasa ve stok gibi sorularınızı doğrudan kendi kayıtlarınızdan cevaplarım.</p>
      <div className="rounded-xl border border-[#EAD8DF] bg-[#fff8fb] p-3 text-[11.5px]">
        <p className="mb-1 font-semibold text-[#8C4460]">Yapay zekâ kullanımı</p>
        <p>
          &quot;Nasıl yapılır&quot; sorularınızı daha iyi anlamak için yalnız <b>soru metniniz</b>, üçüncü taraf bir yapay zekâ
          hizmetine (OpenRouter üzerinden) gönderilir. Göndermeden önce müşteri/personel adları, telefon, TC ve e-posta gizlenir;
          konsültasyon ve sağlık bilgileri <b>hiçbir zaman</b> gönderilmez, sağlayıcı veriyi saklamaz ya da eğitimde kullanmaz.
        </p>
        {status && !status.aiEnabled && <p className="mt-1 text-[#74616A]">Şu an yapay zekâ hizmeti kapalı; onay verseniz de sorular dışarı gitmez.</p>}
      </div>
      <p className="rounded-xl bg-[#F7F6F6] p-3 text-[11px] text-[#5A4B53]">
        <b>Kayıt:</b> Maydi sohbetleri güvenlik amacıyla 90 gün saklanır ve bu sürede yetkili BeautyAsist personeli
        tarafından görüntülenebilir. Ayrıntılar <a href="/gizlilik" target="_blank" rel="noreferrer" className="font-semibold text-[#8C4460] underline">Gizlilik Politikası</a>&apos;nda.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => onDecide('granted')} className="flex-1 rounded-xl bg-[#8e3f5b] px-3 py-2 text-[12.5px] font-semibold text-white">
          Kabul ediyorum
        </button>
        <button type="button" onClick={() => onDecide('declined')} className="flex-1 rounded-xl border border-[#EAD8DF] px-3 py-2 text-[12.5px] font-semibold text-[#8C4460]">
          Yapay zekâsız kullan
        </button>
      </div>
      <p className="text-center text-[10.5px] text-[#74616A]">Tercihinizi istediğiniz zaman tarayıcı verilerini temizleyerek değiştirebilirsiniz.</p>
    </div>
  )
}

function AssistantBubble({ message, onNavigate, onRate }: {
  message: ChatMessage
  onNavigate: (route?: string | null) => void
  onRate: (message: ChatMessage, helpful: boolean) => void
}) {
  const reply = message.reply
  const howTo = reply?.kind === 'how_to' ? readHowTo(reply.data) : null
  const card = reply?.kind === 'data' ? readDataCard(reply.data) : null
  const columns = card && card.items.length > 0 ? Object.keys(card.items[0]).filter((key) => card.items.some((item) => item[key] != null)) : []
  return (
    <div className="mr-6">
      <div className="rounded-2xl rounded-bl-md bg-[#F7F6F6] px-3 py-2 text-[12.5px] leading-relaxed text-[#2A2027]">
        <p className="whitespace-pre-line">{message.text}</p>
        {howTo && (
          <ol className="mt-2 space-y-1.5">
            {howTo.steps.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#8e3f5b] text-[10px] font-bold text-white">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
        {card && card.items.length > 0 && columns.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-xl border border-[#EAD8DF] bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#fff5f8] text-[#74616A]">
                <tr>{columns.map((key) => <th key={key} className="px-2 py-1 font-semibold">{FIELD_LABELS[key] ?? key}</th>)}</tr>
              </thead>
              <tbody>
                {card.items.slice(0, 15).map((item, row) => (
                  <tr key={row} className="border-t border-[#f6edf1]">
                    {columns.map((key) => <td key={key} className="px-2 py-1 align-top">{cell(key, item[key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {reply?.actions.filter((action) => action.type === 'navigate' && action.route).map((action) => (
          <button key={`${action.route}`} type="button" onClick={() => onNavigate(action.route)}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-[#8C4460] ring-1 ring-[#EAD8DF] hover:ring-[#8C4460]">
            {action.label} <ArrowRight className="h-3 w-3" />
          </button>
        ))}
      </div>
      {reply && reply.outcome !== 'small_talk' && (
        <div className="mt-1 flex items-center gap-1 pl-1 text-[#9a8790]">
          <button type="button" onClick={() => onRate(message, true)} aria-label="Faydalı" aria-pressed={message.feedback === 1}
            className={`rounded-md p-1 hover:text-emerald-600 ${message.feedback === 1 ? 'text-emerald-600' : ''}`}>
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onRate(message, false)} aria-label="Faydalı değil" aria-pressed={message.feedback === -1}
            className={`rounded-md p-1 hover:text-rose-600 ${message.feedback === -1 ? 'text-rose-600' : ''}`}>
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
