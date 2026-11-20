'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseUtc } from '@/lib/datetime'
import { ArrowLeft, Eye, History, Loader2, Lock, Search, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import {
  ASSISTANT_LOG_REASONS,
  fetchAssistantAccessLog,
  fetchAssistantLogConversation,
  fetchAssistantLogs,
  fetchPlatformAssistantStats,
  type AssistantAccessLogEntry,
  type AssistantLogConversation,
  type AssistantLogPage,
  type AssistantLogReason,
} from '@/lib/assistantApi'

const PORTAL_LABELS: Record<string, string> = { owner: 'Kurum sahibi', branch: 'Şube yöneticisi', staff: 'Personel', customer: 'Müşteri' }
const ROLE_LABELS: Record<string, string> = { InstitutionOwner: 'Kurum sahibi', BranchManager: 'Şube yöneticisi', Staff: 'Personel', Customer: 'Müşteri' }
const OUTCOMES: { value: string; label: string }[] = [
  { value: '', label: 'Tüm sonuçlar' },
  { value: 'not_found', label: 'Cevaplanamayan' },
  { value: 'denied', label: 'Yetki / paket dışı' },
  { value: 'advice_refused', label: 'Tavsiye reddi' },
  { value: 'error', label: 'Hata' },
]
const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Veri cevabı', how_to: 'Nasıl yapılır', small_talk: 'Sohbet', other_portal: 'Başka panel',
  not_found: 'Cevaplanamadı', denied: 'Yetki dışı', advice_refused: 'Tavsiye reddi', error: 'Hata',
}
const REASON_LABELS = Object.fromEntries(ASSISTANT_LOG_REASONS.map((r) => [r.value, r.label]))
// Sunucu UTC damgalarını 'Z' eki olmadan gönderir (MySQL Kind=Unspecified): parseUtc ile mutlak ana çevrilir.
const when = (utc: string) => parseUtc(utc)?.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) ?? '—'

/**
 * MAYDİ SOHBET KAYITLARI (platform, güvenlik kaydı) — hangi kurumda, hangi kullanıcı, ne zaman, ne konuştu.
 * Kullanıcı kimliği açıktır. Kayıtlar ERİŞİM GEREKÇESİ seçilmeden açılmaz; her liste ve sohbet açılışı sunucuda
 * erişim izine yazılır (kim, ne zaman, neden). Kuruma bildirim gitmez. Kayıtlar 90 gün saklanır; dışa aktarma yoktur.
 */
export default function PlatformMaydiLogsPage() {
  const [tab, setTab] = useState<'logs' | 'access'>('logs')
  const [reason, setReason] = useState<AssistantLogReason | ''>('')
  const [note, setNote] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [days, setDays] = useState(7)
  const [outcome, setOutcome] = useState('')
  const [negative, setNegative] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<AssistantLogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<AssistantLogConversation | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([])
  const [access, setAccess] = useState<AssistantAccessLogEntry[] | null>(null)

  // Kurum seçimi için yalnız kurum adları (istatistikten; kişi verisi yok, erişim izine yazılmaz).
  useEffect(() => {
    fetchPlatformAssistantStats(90)
      .then((stats) => setTenants(stats.tenants.map((t) => ({ id: t.tenantId, name: t.tenantName }))))
      .catch(() => setTenants([]))
  }, [])

  useEffect(() => {
    if (tab === 'access' && access === null) fetchAssistantAccessLog(30).then(setAccess).catch(() => setAccess([]))
  }, [tab, access])

  const load = async (nextPage = 1) => {
    if (!reason) { setError('Kayıtları açmak için önce erişim gerekçesi seçin.'); return }
    setError('')
    setLoading(true)
    try {
      setResult(await fetchAssistantLogs({ reason, note, tenantId, days, outcome, negative, search, page: nextPage }))
      setPage(nextPage)
      setAccess(null) // erişim izi değişti
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıtlar yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  const open = async (conversationId: string) => {
    if (!reason) return
    setDetailLoading(conversationId)
    try {
      setDetail(await fetchAssistantLogConversation(conversationId, reason, note))
      setAccess(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sohbet açılamadı.')
    } finally {
      setDetailLoading(null)
    }
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

  return (
    <>
      <Topbar title="Maydi Sohbet Kayıtları" subtitle="Güvenlik kaydı · kim, hangi kurumda, ne zaman, ne konuştu · 90 gün saklanır" breadcrumbs={['Platform', 'Sistem', 'Maydi', 'Kayıtlar']} />
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 lg:px-8">
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Bu kayıtlar kişisel veri içerir. Her liste ve sohbet açılışı <b>kim, ne zaman, hangi gerekçeyle</b> bilgisiyle erişim izine yazılır. Yalnız gerektiğinde açın.</p>
        </div>

        <div className="flex gap-1 rounded-xl border border-[#EAD8DF] bg-white p-1 text-[12px] font-semibold">
          <button type="button" onClick={() => setTab('logs')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'logs' ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53]'}`}>Sohbet kayıtları</button>
          <button type="button" onClick={() => setTab('access')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'access' ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53]'}`}>
            <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> Erişim izi</span>
          </button>
        </div>

        {tab === 'logs' ? (
          <>
            <form onSubmit={(event) => { event.preventDefault(); void load(1) }} className="grid gap-3 rounded-[20px] border border-[#EAD8DF] bg-white p-4 md:grid-cols-4">
              <Field label="Erişim gerekçesi *">
                <select value={reason} onChange={(e) => setReason(e.target.value as AssistantLogReason)} className={input} required>
                  <option value="">Seçin…</option>
                  {ASSISTANT_LOG_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Not (isteğe bağlı)" className="md:col-span-3">
                <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="ör. destek talebi #1234" className={input} />
              </Field>
              <Field label="Kurum">
                <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={input}>
                  <option value="">Tüm kurumlar</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Dönem">
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={input}>
                  {[1, 7, 30, 90].map((d) => <option key={d} value={d}>Son {d} gün</option>)}
                </select>
              </Field>
              <Field label="Sonuç">
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={input}>
                  {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Kullanıcı e-postası">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ad@kurum.com" className={input} />
              </Field>
              <label className="flex items-center gap-2 text-[12px] text-[#3b2330] md:col-span-3">
                <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> Yalnız 👎 alan cevabı olan sohbetler
              </label>
              <button type="submit" disabled={loading || !reason}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#8e3f5b] px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Kayıtları göster
              </button>
            </form>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}

            {result && (
              <section className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white">
                <div className="flex items-center justify-between border-b border-[#f6edf1] px-4 py-2.5 text-[11.5px] text-[#74616A]">
                  <span>{result.total.toLocaleString('tr-TR')} sohbet · kayıtlar {result.retentionDays} gün saklanır</span>
                  <span className="flex items-center gap-2">
                    <button type="button" disabled={page <= 1 || loading} onClick={() => load(page - 1)} className="rounded-lg px-2 py-1 disabled:opacity-30">‹</button>
                    {page} / {pages}
                    <button type="button" disabled={page >= pages || loading} onClick={() => load(page + 1)} className="rounded-lg px-2 py-1 disabled:opacity-30">›</button>
                  </span>
                </div>
                {result.items.length === 0 ? <p className="py-8 text-center text-[12px] text-[#74616A]">Bu filtrelerle kayıt yok.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[12.5px]">
                      <thead className="bg-[#fff5f8] text-[11px] uppercase tracking-wide text-[#74616A]">
                        <tr><th className="px-4 py-2">Zaman</th><th className="px-4 py-2">Kurum / şube</th><th className="px-4 py-2">Kullanıcı</th><th className="px-4 py-2">İlk soru</th><th className="px-4 py-2 text-right">Soru</th><th className="px-4 py-2" /></tr>
                      </thead>
                      <tbody>
                        {result.items.map((row) => (
                          <tr key={row.conversationId} className="border-t border-[#f6edf1] align-top">
                            <td className="whitespace-nowrap px-4 py-2 text-[#5A4B53]">{when(row.lastMessageAtUtc)}</td>
                            <td className="px-4 py-2"><div className="font-semibold text-[#2A2027]">{row.tenantName}</div><div className="text-[11px] text-[#74616A]">{row.branchName ?? '—'}</div></td>
                            <td className="px-4 py-2">
                              <div className="text-[#2A2027]">{row.user?.fullName || '—'}</div>
                              <div className="text-[11px] text-[#74616A]">{row.user?.email ?? '—'} · {ROLE_LABELS[row.user?.role ?? ''] ?? PORTAL_LABELS[row.portal] ?? row.portal}</div>
                            </td>
                            <td className="max-w-[280px] px-4 py-2 text-[#2A2027]">{row.title}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-right">
                              {row.questions}
                              {row.notFound > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">{row.notFound} ?</span>}
                              {row.negative > 0 && <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] text-rose-700">{row.negative} 👎</span>}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button type="button" onClick={() => open(row.conversationId)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#8C4460] ring-1 ring-[#EAD8DF] hover:ring-[#8C4460]">
                                {detailLoading === row.conversationId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Aç
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white">
            <p className="border-b border-[#f6edf1] px-4 py-2.5 text-[11.5px] text-[#74616A]">Son 30 günde sohbet kayıtlarına yapılan erişimler (en fazla 500).</p>
            {access === null ? <p className="py-8 text-center text-[12px] text-[#74616A]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p> : access.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-[#74616A]">Henüz erişim yok.</p>
            ) : (
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-[#fff5f8] text-[11px] uppercase tracking-wide text-[#74616A]">
                  <tr><th className="px-4 py-2">Zaman</th><th className="px-4 py-2">Kim</th><th className="px-4 py-2">Ne</th><th className="px-4 py-2">Gerekçe</th><th className="px-4 py-2">Kurum</th></tr>
                </thead>
                <tbody>
                  {access.map((row, index) => (
                    <tr key={`${row.atUtc}-${index}`} className="border-t border-[#f6edf1]">
                      <td className="whitespace-nowrap px-4 py-2 text-[#5A4B53]">{when(row.atUtc)}</td>
                      <td className="px-4 py-2">{row.platformUser}</td>
                      <td className="px-4 py-2">{row.action === 'view' ? 'Sohbet açtı' : 'Liste görüntüledi'}{row.filter && <div className="text-[10.5px] text-[#74616A]">{row.filter}</div>}</td>
                      <td className="px-4 py-2">{REASON_LABELS[row.reason] ?? row.reason}{row.note && <div className="text-[10.5px] text-[#74616A]">{row.note}</div>}</td>
                      <td className="px-4 py-2">{row.tenantName ?? 'Tüm kurumlar'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      {/* Portal: sayfa içeriği kendi katmanında (relative z-10) — panel orada kalsa menünün altında kalırdı. */}
      {detail && typeof document !== 'undefined' && createPortal(<ConversationDrawer detail={detail} onClose={() => setDetail(null)} />, document.body)}
    </>
  )
}

const input = 'w-full rounded-xl border border-[#EAD8DF] bg-[#FBF8F9] px-3 py-2 text-[12.5px] text-[#2A2027] outline-none focus:border-[#A5556E]'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-[11px] font-semibold text-[#74616A] ${className}`}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function ConversationDrawer({ detail, onClose }: { detail: AssistantLogConversation; onClose: () => void }) {
  const c = detail.conversation
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[130] flex justify-end bg-[#3b2330]/40" onClick={onClose}>
      <aside role="dialog" aria-label="Sohbet kaydı" className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-[#f1e3e9] px-4 py-3">
          <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-lg p-1.5 text-[#74616A] hover:bg-[#fff5f8] sm:hidden"><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[#2A2027]">{c.user?.fullName || 'Kullanıcı'} <span className="text-[11.5px] font-normal text-[#74616A]">· {ROLE_LABELS[c.user?.role ?? ''] ?? PORTAL_LABELS[c.portal]}</span></div>
            <div className="text-[11.5px] text-[#74616A]">{c.user?.email ?? '—'}</div>
            <div className="text-[11.5px] text-[#74616A]">{c.tenantName}{c.branchName ? ` · ${c.branchName}` : ''} · {when(c.startedAtUtc)} – {when(c.lastMessageAtUtc)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="hidden rounded-lg p-1.5 text-[#74616A] hover:bg-[#fff5f8] sm:block"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          {detail.messages.map((message) => (
            <div key={message.id} className={message.sender === 'user' ? 'ml-10' : 'mr-6'}>
              <div className={`rounded-2xl px-3 py-2 text-[12.5px] ${message.sender === 'user' ? 'bg-[#8e3f5b] text-white' : 'bg-[#F7F6F6] text-[#2A2027]'}`}>
                <p className="whitespace-pre-line">{message.text}</p>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 px-1 text-[10.5px] text-[#8a7880]">
                <span>{parseUtc(message.createdAtUtc)?.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                {message.sender === 'assistant' && (
                  <>
                    <span>· {OUTCOME_LABELS[message.outcome] ?? message.outcome}</span>
                    {message.articleId && <span>· makale: {message.articleId}{message.matchedBy ? ` (${message.matchedBy})` : ''}</span>}
                    <span>· {message.durationMs} ms</span>
                    {message.feedback === 1 && <ThumbsUp className="h-3 w-3 text-emerald-600" />}
                    {message.feedback === -1 && <ThumbsDown className="h-3 w-3 text-rose-600" />}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
