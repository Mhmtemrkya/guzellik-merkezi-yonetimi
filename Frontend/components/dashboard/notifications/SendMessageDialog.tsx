'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Cake,
  Check,
  CheckSquare,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Send,
  Square,
  Users,
  UserCheck,
  X,
} from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { customerSearchProvider, type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { ApiNotificationSendEstimate, NotificationChannelKey, NotificationTemplate } from '@/lib/types'
import { PhonePreview } from './TemplateComposerDialog'
import { formatCredits } from './messageKit'

type AudienceMode = 'all' | 'birthdayWeek' | 'pick'

const channelIcon: Record<NotificationChannelKey, typeof Phone> = { Sms: Phone, WhatsApp: MessageCircle, Email: Mail }

const AUDIENCES: { key: AudienceMode; title: string; desc: string; icon: typeof Users }[] = [
  { key: 'all', title: 'Tüm müşteriler', desc: 'Kara listedekiler hariç herkes', icon: Users },
  { key: 'pick', title: 'Müşteri seç', desc: 'İsim ya da telefonla arayıp seç', icon: UserCheck },
  { key: 'birthdayWeek', title: 'Doğum günü bu hafta', desc: 'Önümüzdeki 7 gün içinde', icon: Cake },
]

/**
 * MESAJ GÖNDER — şablon seç, kitleyi seç (tümü / seçili müşteriler), maliyeti gör, onayla.
 *
 * Tahmin sunucudan gelir ve gönderimle AYNI kuralı izler (kitle, metin, kota → kredi → tavan).
 * Para harcayan bir işlem olduğu için gönderim iki adımlıdır: önce özet, sonra onay.
 */
export default function SendMessageDialog({
  open,
  onClose,
  tenantId,
  templates,
  initialTemplateId,
  salonName,
  allowBulk,
  onSent,
  onCreateTemplate,
}: {
  open: boolean
  onClose: () => void
  tenantId?: string
  templates: NotificationTemplate[]
  initialTemplateId?: string | null
  salonName: string
  /** Paket "toplu gönderim" içeriyor mu? Yoksa yalnız seçili müşterilere gönderilebilir. */
  allowBulk: boolean
  /** `ok` false: hiç mesaj gitmedi ve en az biri başarısız — çağıran uyarı olarak göstermeli. */
  onSent: (msg: string, ok: boolean) => void
  onCreateTemplate: () => void
}) {
  const activeTemplates = useMemo(() => templates.filter((t) => t.status === 'Active'), [templates])

  const [templateId, setTemplateId] = useState<string>('')
  const [mode, setMode] = useState<AudienceMode>('all')
  const [picked, setPicked] = useState<CustomerPickerItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerPickerItem[]>([])
  const [searching, setSearching] = useState(false)
  const [estimate, setEstimate] = useState<ApiNotificationSendEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const searchSeq = useRef(0)
  const estimateSeq = useRef(0)

  // Açılışta sıfırla; şablon önceden seçildiyse onu kullan (yoksa ilk el ile gönderim şablonu).
  useEffect(() => {
    if (!open) return
    const preferred = activeTemplates.find((t) => t.id === initialTemplateId)
      ?? activeTemplates.find((t) => t.trigger === 'Manual' || t.trigger === 'Campaign')
      ?? activeTemplates[0]
    setTemplateId(preferred?.id ?? '')
    setMode(allowBulk ? 'all' : 'pick')
    setPicked([])
    setQuery('')
    setEstimate(null)
    setEstimateError('')
    setConfirming(false)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTemplateId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, sending])

  // Sunucu-taraflı müşteri araması (debounce'lu). 12 bin+ müşteride listeyi istemciye çekmeyiz.
  useEffect(() => {
    if (!open || mode !== 'pick') return
    const seq = ++searchSeq.current
    setSearching(true)
    const handle = setTimeout(() => {
      customerSearchProvider(tenantId)(query.trim())
        .then((rows) => { if (searchSeq.current === seq) setResults(rows) })
        .catch(() => { if (searchSeq.current === seq) setResults([]) })
        .finally(() => { if (searchSeq.current === seq) setSearching(false) })
    }, query.trim() ? 250 : 0)
    return () => clearTimeout(handle)
  }, [open, mode, query, tenantId])

  const pickedIds = useMemo(() => picked.map((p) => p.id), [picked])
  const pickedKey = pickedIds.join(',')

  // Tahmin: şablon/kitle/seçim değişince sunucuya sorulur (hiçbir şey yazmaz).
  useEffect(() => {
    if (!open || !templateId) { setEstimate(null); return }
    if (mode === 'pick' && pickedIds.length === 0) { setEstimate(null); setEstimateError(''); return }
    const seq = ++estimateSeq.current
    setEstimating(true)
    setEstimateError('')
    setConfirming(false)
    const handle = setTimeout(() => {
      const body = mode === 'pick' ? { templateId, customerIds: pickedIds } : { templateId, audience: mode }
      adminApi.estimateNotification<ApiNotificationSendEstimate>(body, tenantId)
        .then((res) => { if (estimateSeq.current === seq) setEstimate(res) })
        .catch((e: unknown) => {
          if (estimateSeq.current !== seq) return
          setEstimate(null)
          setEstimateError(e instanceof Error ? e.message : 'Tahmin alınamadı.')
        })
        .finally(() => { if (estimateSeq.current === seq) setEstimating(false) })
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId, mode, pickedKey, tenantId])

  const template = activeTemplates.find((t) => t.id === templateId)

  const togglePick = (c: CustomerPickerItem): void => {
    setPicked((prev) => (prev.some((p) => p.id === c.id) ? prev.filter((p) => p.id !== c.id) : [...prev, c]))
  }
  const allResultsPicked = results.length > 0 && results.every((r) => pickedIds.includes(r.id))
  const toggleAllResults = (): void => {
    setPicked((prev) => {
      if (allResultsPicked) return prev.filter((p) => !results.some((r) => r.id === p.id))
      const add = results.filter((r) => !prev.some((p) => p.id === r.id))
      return [...prev, ...add]
    })
  }

  const send = async (): Promise<void> => {
    if (!template) return
    setSending(true)
    setError('')
    try {
      const body = mode === 'pick' ? { templateId, customerIds: pickedIds } : { templateId, audience: mode }
      const res = await adminApi.sendNotification<{ sent: number; failed: number; skipped: number }>(body, tenantId)
      if (isPendingApprovalResult(res)) {
        onSent('Gönderim ONAYA GÖNDERİLDİ. Yönetici onayladıktan sonra iletilecek.', true)
      } else {
        const parts = [`${res.sent} mesaj gönderildi`]
        if (res.failed > 0) parts.push(`${res.failed} gönderilemedi (sebebi geçmişte görünür)`)
        if (res.skipped > 0) parts.push(`${res.skipped} kişide telefon/e-posta yok`)
        onSent(`"${template.name}" — ${parts.join(' · ')}.`, res.sent > 0 || res.failed === 0)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gönderilemedi.')
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  const reachable = estimate?.reachable ?? 0
  const canSend = Boolean(template) && !estimating && reachable > 0 && !(mode === 'pick' && pickedIds.length === 0)
  const channel = template?.channel ?? 'Sms'
  const ChannelIcon = channelIcon[channel]

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[145] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button type="button" aria-label="Kapat" onClick={() => { if (!sending) onClose() }} className="absolute inset-0 cursor-default bg-[#2a141f]/55 backdrop-blur-[3px]" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Mesaj gönder"
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto flex max-h-[94vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A5556E]">Mesaj gönder</div>
                <div className="mt-0.5 font-display text-[19px] font-bold tracking-tight text-[#2A2027]">Kime, hangi mesaj?</div>
                <div className="mt-0.5 text-[11.5px] text-[#74616A]">Göndermeden önce kaç kişiye gideceğini ve kotadan/krediden ne düşeceğini görürsün.</div>
              </div>
              <button type="button" onClick={onClose} disabled={sending} aria-label="Kapat"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E] disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid min-h-0 flex-auto overflow-y-auto lg:grid-cols-[1.3fr_1fr]">
              {/* SOL — şablon + kitle */}
              <div className="space-y-5 p-5">
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[#2A2027]">1 · Mesaj</span>
                    <button type="button" onClick={onCreateTemplate}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8C4460] hover:underline">
                      <Plus className="h-3.5 w-3.5" /> Yeni şablon
                    </button>
                  </div>
                  {activeTemplates.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#FBFAFA] px-4 py-6 text-center text-[12px] text-[#74616A]">
                      Gönderilebilir (aktif) şablon yok.
                      <button type="button" onClick={onCreateTemplate} className="mt-2 block w-full text-[12px] font-semibold text-[#8C4460] hover:underline">
                        Hemen bir şablon oluştur
                      </button>
                    </div>
                  ) : (
                    <div className="grid max-h-[220px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {activeTemplates.map((t) => {
                        const Icon = channelIcon[t.channel]
                        return (
                          <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                            className={`rounded-[14px] border px-3 py-2.5 text-left transition ${
                              templateId === t.id ? 'border-[#8C4460] bg-[#fdf1f5]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'}`}>
                            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#2A2027]">
                              <Icon className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" />
                              <span className="truncate">{t.name}</span>
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-[#74616A]">{t.body}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 text-[13px] font-semibold text-[#2A2027]">2 · Kime?</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {AUDIENCES.map((a) => {
                      const locked = !allowBulk && a.key !== 'pick'
                      return (
                        <button key={a.key} type="button" disabled={locked} onClick={() => setMode(a.key)}
                          className={`rounded-[14px] border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                            mode === a.key ? 'border-[#8C4460] bg-[#fdf1f5]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'}`}>
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#2A2027]"><a.icon className="h-3.5 w-3.5 text-[#A5556E]" /> {a.title}</div>
                          <div className="mt-0.5 text-[10.5px] text-[#74616A]">{locked ? 'Toplu gönderim paketinizde yok' : a.desc}</div>
                        </button>
                      )
                    })}
                  </div>

                  {mode === 'pick' && (
                    <div className="mt-3 rounded-[14px] border border-[#EAD8DF] bg-[#FBFAFA] p-3">
                      {picked.length > 0 && (
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          {picked.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-[#ecd6df] bg-white py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-[#2A2027]">
                              {p.name}
                              <button type="button" aria-label={`${p.name} seçimini kaldır`} onClick={() => togglePick(p)}
                                className="grid h-4 w-4 place-items-center rounded-full text-[#9d7386] hover:bg-[#fbe5eb] hover:text-[#A5556E]">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                          <button type="button" onClick={() => setPicked([])} className="text-[10.5px] font-semibold text-[#8C4460] hover:underline">Temizle</button>
                        </div>
                      )}
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A5556E]/60" />
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="İsim veya telefonla ara…"
                          className="w-full rounded-[12px] border border-[#EAD8DF] bg-white py-2 pl-8 pr-3 text-[12.5px] text-[#2A2027] outline-none focus:border-[#A5556E]" />
                      </div>
                      <div className="mt-2 max-h-[220px] overflow-y-auto rounded-[12px] border border-[#EAD8DF] bg-white">
                        {results.length > 0 && (
                          <button type="button" onClick={toggleAllResults}
                            className="flex w-full items-center gap-2 border-b border-[#f4e8ed] px-3 py-2 text-left text-[11px] font-semibold text-[#8C4460] hover:bg-[#F7F6F6]">
                            {allResultsPicked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                            {allResultsPicked ? 'Listedekilerin seçimini kaldır' : `Listedeki ${results.length} kişiyi seç`}
                          </button>
                        )}
                        {searching && results.length === 0 ? (
                          <div className="px-3 py-5 text-center text-[11.5px] text-[#74616A]">Aranıyor…</div>
                        ) : results.length === 0 ? (
                          <div className="px-3 py-5 text-center text-[11.5px] text-[#74616A]">Eşleşen müşteri yok.</div>
                        ) : (
                          results.map((c) => {
                            const on = pickedIds.includes(c.id)
                            return (
                              <button key={c.id} type="button" onClick={() => togglePick(c)}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#F7F6F6] ${on ? 'bg-[#fdf4f8]' : ''}`}>
                                {on ? <CheckSquare className="h-4 w-4 shrink-0 text-[#A5556E]" /> : <Square className="h-4 w-4 shrink-0 text-[#c9b3bc]" />}
                                <span className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-medium text-[#2A2027]">{c.name}</span>
                                  {c.phone && <span className="block font-mono text-[10.5px] text-[#74616A]">{c.phone}</span>}
                                </span>
                              </button>
                            )
                          })
                        )}
                      </div>
                      <div className="mt-1.5 text-[10px] text-[#9d7386]">
                        {query.trim() ? 'İlk 50 eşleşme gösterilir — daraltmak için yazmaya devam et.' : 'İlk 50 müşteri — aramak için yaz.'} · {picked.length} seçili
                      </div>
                    </div>
                  )}
                </section>
              </div>

              {/* SAĞ — önizleme + maliyet */}
              <div className="space-y-3 border-t border-[#EAD8DF] bg-[#FBFAFA] p-5 lg:border-l lg:border-t-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#A5556E]">Önizleme</div>
                <PhonePreview channel={channel} text={estimate?.sampleBody ?? template?.body ?? ''} salonName={salonName} />
                {estimate?.sampleRecipientName && (
                  <div className="text-center text-[10.5px] text-[#74616A]">{estimate.sampleRecipientName} için doldurulmuş hâli</div>
                )}

                <div className="rounded-[14px] border border-[#EAD8DF] bg-white p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#2A2027]">
                    <ChannelIcon className="h-3.5 w-3.5 text-[#A5556E]" /> Gönderim özeti
                    {estimating && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[#A5556E]" />}
                  </div>
                  {mode === 'pick' && picked.length === 0 ? (
                    <div className="py-2 text-[11.5px] text-[#74616A]">Göndermek için en az bir müşteri seç.</div>
                  ) : estimateError ? (
                    <div className="py-1 text-[11.5px] text-rose-700">{estimateError}</div>
                  ) : estimate ? (
                    <div className="space-y-1.5 text-[11.5px]">
                      <Row label="Kitledeki müşteri" value={estimate.recipients.toLocaleString('tr-TR')} />
                      <Row label={estimate.channel === 'Email' ? 'E-postası olan' : 'Telefonu olan'} value={estimate.reachable.toLocaleString('tr-TR')} strong />
                      {estimate.channel === 'Sms' && (
                        <Row label="SMS parçası" value={`${estimate.totalSmsParts.toLocaleString('tr-TR')} (kişi başı en çok ${estimate.maxSmsParts})`} />
                      )}
                      {estimate.channel !== 'Email' && estimate.ownAccount && (
                        // Kurumun kendi SMS hesabı: kota/kredi satırları anlamsız — ücreti sağlayıcı keser.
                        <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-emerald-800">
                          <b>Kendi SMS hesabınızdan</b> gider — BeautyAsist kotası ve mesaj krediniz düşmez, ücreti sağlayıcınız keser.
                        </div>
                      )}
                      {estimate.channel !== 'Email' && !estimate.ownAccount && (
                        <>
                          <Row label="Paket kotasından" value={`${estimate.quotaCovered.toLocaleString('tr-TR')} mesaj${estimate.quotaRemaining >= 0 ? ` (kalan ${estimate.quotaRemaining.toLocaleString('tr-TR')})` : ' (sınırsız)'}`} />
                          {estimate.creditMessages > 0 && (
                            <Row label="Mesaj kredisinden" value={`${estimate.creditMessages.toLocaleString('tr-TR')} mesaj · ${formatCredits(estimate.creditsNeeded)} kredi`} />
                          )}
                          <Row label="Kullanılabilir kredi" value={formatCredits(estimate.availableCredits)} />
                        </>
                      )}
                      <div className="mt-1 flex items-center justify-between rounded-[10px] bg-[#fdf1f5] px-2.5 py-1.5">
                        <span className="font-semibold text-[#2A2027]">Gitmesi beklenen</span>
                        <span className="text-[15px] font-bold text-[#8e3f5b]">{estimate.expectedToSend.toLocaleString('tr-TR')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-2 text-[11.5px] text-[#74616A]">{template ? 'Hesaplanıyor…' : 'Önce bir mesaj seç.'}</div>
                  )}
                </div>

                {(estimate?.warnings ?? []).map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 rounded-[12px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10.5px] leading-snug text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            </div>

            <footer className="shrink-0 border-t border-[#EAD8DF] bg-white px-5 py-3.5">
              {error && <div className="mb-2 rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]">{error}</div>}
              {confirming && estimate ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="mr-auto text-[12px] text-[#2A2027]">
                    <b>{reachable.toLocaleString('tr-TR')}</b> kişiye {channel === 'Sms' ? 'SMS' : channel === 'WhatsApp' ? 'WhatsApp' : 'e-posta'} gönderilecek
                    {estimate.creditsNeeded > 0 && <> · en çok <b>{formatCredits(estimate.creditsNeeded)}</b> kredi düşebilir</>}. Onaylıyor musun?
                  </span>
                  <button type="button" disabled={sending} onClick={() => setConfirming(false)}
                    className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-4 text-[12px] font-semibold text-[#5A4B53]">
                    Geri
                  </button>
                  <button type="button" disabled={sending} onClick={() => void send()}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 text-[12px] font-semibold text-white disabled:opacity-60">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Evet, gönder
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={onClose}
                    className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-4 text-[12px] font-semibold text-[#5A4B53]">
                    Vazgeç
                  </button>
                  <button type="button" disabled={!canSend} onClick={() => setConfirming(true)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 text-[12px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0">
                    <Send className="h-4 w-4" /> {reachable > 0 ? `${reachable.toLocaleString('tr-TR')} kişiye gönder` : 'Gönder'}
                  </button>
                </div>
              )}
            </footer>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#5A4B53]">{label}</span>
      <span className={strong ? 'font-bold text-[#2A2027]' : 'font-semibold text-[#2A2027]'}>{value}</span>
    </div>
  )
}
