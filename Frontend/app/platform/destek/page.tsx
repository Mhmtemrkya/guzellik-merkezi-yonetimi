'use client'

import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { SupportPriorityBadge, SupportStatusBadge, SupportThread, SupportTicketHeader, formatDateTime } from '@/components/support/SupportThread'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformSupportApi } from '@/lib/apiClient'
import { apiItems } from '@/lib/apiMappers'
import {
  supportCategoryLabel, supportPriorityLabel, supportStatusLabel,
  type SupportPriority, type SupportStatus, type SupportSummary,
  type SupportTicketDetail, type SupportTicketListItem,
} from '@/lib/supportApi'
import {
  AlertTriangle, Check, CircleDot, Clock, Inbox, Loader2, Mail, MessageSquare,
  Search, Send, Timer, UserCheck, X, type LucideIcon,
} from 'lucide-react'
import type { PagedResult } from '@/lib/types'

/**
 * PLATFORM DESTEK KUYRUĞU — tüm talepler tek listede.
 *
 * <p>
 * <b>KUYRUK SIRASI SUNUCUDA BELİRLENİR</b> (önce öncelik, sonra son hareket). Sıralamayı
 * istemciye bırakmak, sayfalama ile birlikte yanlış sonuç verirdi: yalnız o sayfadaki 25 satır
 * sıralanır ve "en acil" talep ikinci sayfada kalırdı.
 * </p>
 *
 * <p>
 * <b>SEÇİLİ TALEP ADRESE YAZILIR</b> (<c>?talep=…</c>): temsilci bir talebin bağlantısını
 * kopyalayıp bir başkasına gönderebilmeli. Sekme (<c>?scope=…</c>) de öyle — sidebar'daki
 * alt bağlantılar bu parametreyi kullanır.
 * </p>
 *
 * <p>
 * <b>OKUNMAMIŞ ROZETİ AÇINCA DÜŞER:</b> sunucu ayrıntı çağrısında işaretler. İstemcide
 * saymak, iki temsilcinin farklı sayılar görmesi demekti.
 * </p>
 */

type ScopeKey = 'open' | 'unread' | 'mine' | 'closed' | 'all'

const SCOPES: { key: ScopeKey; label: string; hint: string }[] = [
  { key: 'open', label: 'Açık kuyruk', hint: 'Açık, incelenen ve yanıt bekleyen talepler.' },
  { key: 'unread', label: 'Okunmamış', hint: 'Talep sahibinden gelen ve henüz açılmamış mesajlar.' },
  { key: 'mine', label: 'Bana atanan', hint: 'Üzerinize aldığınız talepler.' },
  { key: 'closed', label: 'Kapanmış', hint: 'Çözülen ve kapatılan talepler.' },
  { key: 'all', label: 'Tümü', hint: 'Bütün destek geçmişi.' },
]

const STATUS_OPTIONS: SupportStatus[] = [0, 1, 2, 3, 4]
const PRIORITY_OPTIONS: SupportPriority[] = [0, 1, 2, 3]

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
}
const listVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const rowVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
}

export default function PlatformSupportPage() {
  return (
    <Suspense fallback={null}>
      <PlatformSupportInner />
    </Suspense>
  )
}

function PlatformSupportInner() {
  const params = useSearchParams()
  const scope = (params.get('scope') as ScopeKey) || 'open'
  const urlTicket = params.get('talep')

  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(urlTicket)

  // Adresten gelen talep kimliği ekrana yansısın (bağlantı paylaşımı).
  useEffect(() => setSelectedId(urlTicket), [urlTicket])

  const { data, loading, error, reload } = useApiQuery<{
    list: PagedResult<SupportTicketListItem>
    summary: SupportSummary
  }>(
    async () => {
      const [list, summary] = await Promise.all([
        platformSupportApi.list<SupportTicketListItem>({
          scope: scope === 'all' ? undefined : scope,
          search: applied || undefined,
          pageSize: 50,
        }),
        platformSupportApi.summary<SupportSummary>(),
      ])
      return { list, summary }
    },
    [scope, applied],
    { initialData: null },
  )

  const tickets = apiItems(data?.list)
  const summary = data?.summary
  const scopeInfo = SCOPES.find((s) => s.key === scope) ?? SCOPES[0]

  const kpis: { label: string; value: number | string; icon: LucideIcon; tone: string }[] = useMemo(
    () => [
      { label: 'Açık', value: summary?.open ?? 0, icon: Inbox, tone: 'text-amber-600' },
      { label: 'İnceleniyor', value: summary?.inProgress ?? 0, icon: CircleDot, tone: 'text-sky-600' },
      { label: 'Yanıt bekliyor', value: summary?.waitingCustomer ?? 0, icon: Clock, tone: 'text-violet-600' },
      { label: 'Okunmamış', value: summary?.unread ?? 0, icon: Mail, tone: 'text-[#A5556E]' },
      { label: 'Acil', value: summary?.urgent ?? 0, icon: AlertTriangle, tone: 'text-rose-600' },
      {
        label: 'Ort. ilk yanıt',
        // null = son 30 günde yanıtlanmış talep YOK. "0 saat" yazmak, anında yanıtlandığı
        // izlenimi verirdi — ölçülemeyen ile sıfır aynı şey değildir.
        value: summary?.avgFirstResponseHours == null ? '—' : `${summary.avgFirstResponseHours} sa`,
        icon: Timer,
        tone: 'text-emerald-600',
      },
    ],
    [summary],
  )

  const submitSearch = (e: FormEvent): void => {
    e.preventDefault()
    setApplied(search.trim())
  }

  return (
    <>
      <Topbar
        title="Destek Talepleri"
        subtitle={scopeInfo.hint}
        breadcrumbs={['Platform', 'Destek', scopeInfo.label]}
      />

      <div className="space-y-5 px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <ApiStateNotice loading={loading} error={error} />

        {/* KPI ŞERİDİ — min-w-0 şart: truncate'li ızgara shrink-0 olursa komşusuna biner. */}
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        >
          {kpis.map(({ label, value, icon: Icon, tone }) => (
            <motion.div
              key={label}
              variants={rowVariants}
              className="min-w-0 rounded-[18px] border border-[#EAD8DF] bg-white/92 px-4 py-3.5 shadow-[0_18px_44px_-38px_rgba(150,78,104,0.5)]"
            >
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#74616A]">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
                <span className="truncate">{label}</span>
              </div>
              <div className="mt-1.5 font-display text-2xl tabular-nums text-[#2A2027]">
                {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* SEKMELER + ARAMA */}
        <div className="flex flex-wrap items-center gap-2">
          {SCOPES.map((s) => (
            <a
              key={s.key}
              href={`/platform/destek?scope=${s.key}`}
              className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition-colors ${
                s.key === scope
                  ? 'border-[#A5556E] bg-[#F6DFE6] text-[#A5556E]'
                  : 'border-[#EAD8DF] bg-white/80 text-[#74616A] hover:border-[#BE7690]'
              }`}
            >
              {s.label}
            </a>
          ))}

          <form onSubmit={submitSearch} className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-xs">
            <div className="flex flex-1 items-center gap-2 rounded-full border border-[#EAD8DF] bg-white px-3.5 transition-colors focus-within:border-[#BE7690]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#A5556E]/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kod, konu, ad, e-posta, kurum…"
                className="min-h-10 w-full bg-transparent text-[12.5px] text-[#2A2027] outline-none placeholder:text-[#B29AA5]"
              />
              {applied && (
                <button
                  type="button"
                  aria-label="Aramayı temizle"
                  onClick={() => {
                    setSearch('')
                    setApplied('')
                  }}
                  className="text-[#A5556E]/60 transition-colors hover:text-[#A5556E]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* KUYRUK */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-white/92 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]"
        >
          {tickets.length === 0 && !loading ? (
            <div className="px-6 py-16 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#EAD8DF] bg-white">
                <Inbox className="h-6 w-6 text-[#A5556E]" strokeWidth={1.5} />
              </span>
              <p className="mt-4 text-[14px] font-medium text-[#2A2027]">
                {applied ? 'Aramanızla eşleşen talep yok.' : 'Bu kuyrukta talep yok.'}
              </p>
              <p className="mt-1 text-[12px] text-[#74616A]">
                {applied ? 'Başka bir anahtar kelime deneyin.' : 'Yeni talepler geldiğinde burada görünür.'}
              </p>
            </div>
          ) : (
            <motion.ul variants={listVariants} initial="hidden" animate="visible" className="divide-y divide-[#F1E7EB]">
              {tickets.map((t) => (
                <motion.li key={t.id} variants={rowVariants}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[#FDF7F9]"
                  >
                    {/* Okunmamış işareti — rozet değil, satır başında sessiz bir nokta. */}
                    <span
                      aria-label={t.hasUnreadForPlatform ? 'Okunmamış' : undefined}
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.hasUnreadForPlatform ? 'bg-[#C85776]' : 'bg-transparent'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold tracking-[0.04em] text-[#A5556E]">{t.code}</span>
                        <SupportStatusBadge status={t.status} />
                        <SupportPriorityBadge priority={t.priority} />
                      </div>
                      <div className={`mt-1.5 truncate text-[14px] ${t.hasUnreadForPlatform ? 'font-semibold text-[#2A2027]' : 'text-[#3B3037]'}`}>
                        {t.subject}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-[#74616A]">
                        <span className="truncate">{t.requesterName}</span>
                        {t.tenantName && <span className="truncate">· {t.tenantName}</span>}
                        <span>· {supportCategoryLabel[t.category]}</span>
                        {t.assignedToName && (
                          <span className="inline-flex items-center gap-1 text-[#A5556E]">
                            · <UserCheck className="h-3 w-3" /> {t.assignedToName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-[#74616A]">{formatDateTime(t.lastMessageAtUtc)}</div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#A5556E]">
                        <MessageSquare className="h-3 w-3" /> {t.messageCount}
                      </div>
                    </div>
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {selectedId && (
          <TicketDrawer
            id={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={() => void reload()}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * TALEP AYRINTISI — sağdan açılan çekmece.
 *
 * <p>
 * <b>ModalPortal ZORUNLU:</b> panel gövdesi (<c>main</c>) kendi yığınlama bağlamını kurar ve
 * içine yerleştirilen bir katman sidebar'ın ALTINDA kalır. Portal onu gövde köküne taşır
 * (bkz. components/dashboard/ModalPortal.tsx).
 * </p>
 */
function TicketDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setTicket(await platformSupportApi.get<SupportTicketDetail>(id))
      // Okunmamış rozeti sunucuda düştü — listeyi tazele ki sayaçlar da doğru olsun.
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Talep yüklenemedi.')
    } finally {
      setLoading(false)
    }
    // onChanged her render'da yeni referans olabilir; bağımlılığa almak sonsuz döngü üretir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // ESC ile kapat — çekmece bir modaldir ve klavyeden çıkış yolu olmalı.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sendReply = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (reply.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      setTicket(await platformSupportApi.reply<SupportTicketDetail>(id, reply.trim()))
      setReply('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yanıt gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const update = async (body: { status?: number; priority?: number }): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setTicket(await platformSupportApi.update<SupportTicketDetail>(id, body))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Güncellenemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-[#2A2027]/40 backdrop-blur-[2px]"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Destek talebi ayrıntısı"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 right-0 z-[71] flex w-full max-w-[680px] flex-col bg-[#FFFBFC] shadow-[0_0_80px_-20px_rgba(60,25,42,0.5)]"
      >
        <header className="flex items-center justify-between border-b border-[#EAD8DF] px-5 py-3.5">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#A5556E]">Destek talebi</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* GÖVDE flex-auto + min-h-0: aksi hâlde uzun yazışma alt çubuğu ekrandan taşırır
            (bkz. AppointmentEditor deseni). */}
        <div className="min-h-0 flex-auto overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center gap-2.5 py-10 text-[13px] text-[#74616A]">
              <Loader2 className="h-4 w-4 animate-spin text-[#A5556E]" /> Talep yükleniyor…
            </div>
          ) : !ticket ? (
            <div className="py-10 text-center text-[13px] text-[#74616A]">{error || 'Talep bulunamadı.'}</div>
          ) : (
            <>
              <SupportTicketHeader
                ticket={ticket}
                extra={
                  <div className="text-right text-[11.5px] text-[#74616A]">
                    <div>{ticket.requesterEmail}</div>
                    {ticket.requesterPhone && <div className="mt-0.5">{ticket.requesterPhone}</div>}
                  </div>
                }
              />

              {/* DURUM + ÖNCELİK — tek tıkla. Ayrı bir "kaydet" adımı, temsilcinin
                  değiştirip kaydetmeyi unutmasına açık kapı bırakırdı. */}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Picker
                  label="Durum"
                  options={STATUS_OPTIONS.map((s) => ({ value: s, label: supportStatusLabel[s] }))}
                  current={ticket.status}
                  disabled={busy}
                  onPick={(v) => void update({ status: v })}
                />
                <Picker
                  label="Öncelik"
                  options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: supportPriorityLabel[p] }))}
                  current={ticket.priority}
                  disabled={busy}
                  onPick={(v) => void update({ priority: v })}
                />
              </div>

              <div className="mt-6 border-t border-[#EAD8DF] pt-5">
                <SupportThread messages={ticket.messages} />
              </div>
            </>
          )}
        </div>

        {ticket && (
          <form onSubmit={sendReply} className="shrink-0 border-t border-[#EAD8DF] bg-white px-5 py-4">
            {error && (
              <div className="mb-3 rounded-xl border border-rose-300/60 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-700">
                {error}
              </div>
            )}
            <textarea
              rows={3}
              maxLength={4000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Yanıtınızı yazın… Talep sahibine e-posta olarak da gider."
              className="w-full resize-y rounded-xl border border-[#EAD8DF] bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-[#2A2027] outline-none transition-colors placeholder:text-[#B29AA5] focus:border-[#BE7690]"
            />
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#74616A]">Yanıt yazınca durum “Yanıtınız bekleniyor” olur.</span>
              <button
                type="submit"
                disabled={busy || reply.trim().length < 2}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-[#A5556E] px-5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Gönder
              </button>
            </div>
          </form>
        )}
      </motion.aside>
    </ModalPortal>
  )
}

/** Tek tıkla seçim şeridi — seçili olan dolu, diğerleri boş. */
function Picker({
  label,
  options,
  current,
  disabled,
  onPick,
}: {
  label: string
  options: { value: number; label: string }[]
  current: number
  disabled: boolean
  onPick: (value: number) => void
}): ReactNode {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#74616A]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === current
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled || active}
              onClick={() => onPick(o.value)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                active
                  ? 'border-[#A5556E] bg-[#F6DFE6] text-[#A5556E]'
                  : 'border-[#EAD8DF] bg-white text-[#74616A] hover:border-[#BE7690] disabled:opacity-50'
              }`}
            >
              {active && <Check className="h-3 w-3" strokeWidth={2.6} />}
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
