'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BellRing,
  Check,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { NotificationChannelKey, NotificationTemplate, NotificationTemplateStatusKey, NotificationTriggerKey } from '@/lib/types'
import {
  CHANNEL_OPTIONS,
  SUGGESTED_TEXTS,
  TRIGGER_OPTIONS,
  formatCredits,
  hasEmoji,
  renderSample,
  smsParts,
  usesWhatsAppReminderFlow,
  variablesFor,
} from './messageKit'

const channelIcon: Record<NotificationChannelKey, typeof Phone> = { Sms: Phone, WhatsApp: MessageCircle, Email: Mail }

/**
 * ŞABLON OLUŞTURUCU — "ne zaman, hangi kanaldan, ne yazsın" üç soruda.
 *
 * Kullanıcı teknik tetikleyici/kanal adlarıyla uğraşmaz; hazır metinden başlar, değişkenleri
 * imlecin olduğu yere tıklayarak ekler, gerçek görünümü ve SMS maliyetini yazarken görür.
 */
export default function TemplateComposerDialog({
  open,
  onClose,
  tenantId,
  allowedChannels,
  salonName,
  smsCreditsPerPart,
  template,
  initialTrigger,
  initialChannel,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  tenantId?: string
  allowedChannels: NotificationChannelKey[]
  salonName: string
  /** Mesaj kredisi: SMS parça başı kredi (cüzdandan). Bilinmiyorsa maliyet satırı gizlenir. */
  smsCreditsPerPart?: number
  /** Verilirse düzenleme modu. */
  template?: NotificationTemplate | null
  initialTrigger?: NotificationTriggerKey
  initialChannel?: NotificationChannelKey
  onSaved: (msg: string) => void
}) {
  const editing = Boolean(template)
  const defaultChannel: NotificationChannelKey = allowedChannels.includes('Sms') ? 'Sms' : allowedChannels[0] ?? 'Sms'

  const [trigger, setTrigger] = useState<NotificationTriggerKey>('Manual')
  const [channel, setChannel] = useState<NotificationChannelKey>(defaultChannel)
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [active, setActive] = useState(true)
  const [statusTouched, setStatusTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  // Açılışta formu kur (düzenleme: şablondan; yeni: önerilen ilk metin).
  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    if (template) {
      setTrigger(template.trigger)
      setChannel(template.channel)
      setBody(template.body)
      setName(template.name)
      setNameTouched(true)
      setActive(template.status === 'Active')
      setStatusTouched(false)
    } else {
      const t = initialTrigger ?? 'Manual'
      setTrigger(t)
      setChannel(initialChannel && allowedChannels.includes(initialChannel) ? initialChannel : defaultChannel)
      setBody(SUGGESTED_TEXTS[t]?.[0] ?? '')
      setName('')
      setNameTouched(false)
      setActive(true)
      setStatusTouched(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id, initialTrigger, initialChannel])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const triggerMeta = TRIGGER_OPTIONS.find((t) => t.key === trigger)
  const channelMeta = CHANNEL_OPTIONS.find((c) => c.key === channel)
  const autoName = `${triggerMeta?.title ?? 'Bildirim'} · ${channelMeta?.title ?? channel}`
  const effectiveName = nameTouched ? name : autoName

  const preview = useMemo(() => renderSample(body, salonName), [body, salonName])
  const parts = smsParts(preview)
  const emoji = hasEmoji(body)
  const reminderFlow = usesWhatsAppReminderFlow(channel, trigger)

  /** Tetikleyici değişince, kullanıcı metne dokunmadıysa o tetikleyicinin önerisi gelir. */
  const pickTrigger = (next: NotificationTriggerKey): void => {
    const untouched = !body.trim() || Object.values(SUGGESTED_TEXTS).some((list) => list.includes(body))
    setTrigger(next)
    if (untouched) setBody(SUGGESTED_TEXTS[next]?.[0] ?? body)
  }

  /** Değişkeni İMLECİN olduğu yere ekler (sona değil) ve imleci arkasına taşır. */
  const insertVariable = (key: string): void => {
    const token = `{{${key}}}`
    const el = bodyRef.current
    if (!el) { setBody((b) => `${b}${token}`); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const save = async (): Promise<void> => {
    if (!effectiveName.trim()) { setError('Şablona bir ad verin.'); return }
    if (!body.trim()) { setError('Mesaj metni boş olamaz.'); return }
    setBusy(true)
    setError('')
    try {
      // Meta onayındaki bir şablonun durumu kullanıcı anahtara dokunmadıkça korunur.
      const status: NotificationTemplateStatusKey =
        editing && !statusTouched && template?.status === 'PendingApproval' ? 'PendingApproval' : active ? 'Active' : 'Draft'
      const payload = { name: effectiveName.trim(), channel, trigger, body: body.trim(), status }
      const res = editing && template
        ? await adminApi.updateNotificationTemplate(template.id, payload, tenantId)
        : await adminApi.createNotificationTemplate(payload, tenantId)
      if (isPendingApprovalResult(res)) onSaved('Şablon değişikliği onaya gönderildi.')
      else if (editing) onSaved('Şablon güncellendi.')
      else onSaved(active && triggerMeta?.automatic
        ? `"${effectiveName.trim()}" oluşturuldu ve aktif — otomatik gönderim devrede.`
        : `"${effectiveName.trim()}" oluşturuldu.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Şablon kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[145] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button type="button" aria-label="Kapat" onClick={onClose} className="absolute inset-0 cursor-default bg-[#2a141f]/55 backdrop-blur-[3px]" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'Şablonu düzenle' : 'Yeni mesaj şablonu'}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto flex max-h-[94vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A5556E]">{editing ? 'Şablonu düzenle' : 'Yeni mesaj şablonu'}</div>
                <div className="mt-0.5 font-display text-[19px] font-bold tracking-tight text-[#2A2027]">{effectiveName || 'Mesaj şablonu'}</div>
                <div className="mt-0.5 text-[11.5px] text-[#74616A]">Ne zaman, hangi kanaldan ve ne yazacağını seç — sağda müşterinin göreceği hâli canlı görünür.</div>
              </div>
              <button type="button" onClick={onClose} aria-label="Kapat"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid min-h-0 flex-auto gap-0 overflow-y-auto lg:grid-cols-[1.25fr_1fr]">
              {/* SOL — form */}
              <div className="space-y-5 p-5">
                {/* 1) Ne zaman */}
                <section>
                  <StepTitle n={1} title="Ne zaman gönderilsin?" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TRIGGER_OPTIONS.map((t) => (
                      <button key={t.key} type="button" onClick={() => pickTrigger(t.key)}
                        className={`rounded-[14px] border px-3 py-2.5 text-left transition ${
                          trigger === t.key ? 'border-[#8C4460] bg-[#fdf1f5] shadow-[0_10px_24px_-20px_rgba(142,63,91,0.8)]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'}`}>
                        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2A2027]">
                          {t.automatic ? <BellRing className="h-3.5 w-3.5 text-[#A5556E]" /> : <Sparkles className="h-3.5 w-3.5 text-[#A5556E]" />}
                          {t.title}
                        </div>
                        <div className="mt-0.5 text-[10.5px] leading-snug text-[#74616A]">{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </section>

                {/* 2) Kanal */}
                <section>
                  <StepTitle n={2} title="Hangi kanaldan?" />
                  <div className="grid gap-2 sm:grid-cols-3">
                    {CHANNEL_OPTIONS.filter((c) => allowedChannels.includes(c.key)).map((c) => {
                      const Icon = channelIcon[c.key]
                      return (
                        <button key={c.key} type="button" onClick={() => setChannel(c.key)}
                          className={`rounded-[14px] border px-3 py-2.5 text-left transition ${
                            channel === c.key ? 'border-[#8C4460] bg-[#fdf1f5]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'}`}>
                          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2A2027]"><Icon className="h-3.5 w-3.5 text-[#A5556E]" /> {c.title}</div>
                          <div className="mt-0.5 text-[10px] leading-snug text-[#74616A]">{c.note}</div>
                        </button>
                      )
                    })}
                  </div>
                  {allowedChannels.length === 0 && (
                    <p className="mt-2 text-[11px] text-rose-700">Paketinizde mesaj kanalı yok — şablon oluşturmak için paket yükseltmesi gerekir.</p>
                  )}
                </section>

                {/* 3) Metin */}
                <section>
                  <StepTitle n={3} title="Ne yazsın?" />
                  {reminderFlow && (
                    <div className="mb-2 flex items-start gap-1.5 rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-900">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        WhatsApp randevu hatırlatması <b>iki yönlü onay</b> (Evet / Hayır / Ertele) akışıyla gider ve metnini
                        <b> Ayarlar › WhatsApp › Hatırlatma şablonu</b>&apos;ndan alır. Bu şablonu açmanız hatırlatmayı başlatır; buradaki metin kullanılmaz.
                      </span>
                    </div>
                  )}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#74616A]"><Wand2 className="h-3.5 w-3.5" /> Hazır metin:</span>
                    {(SUGGESTED_TEXTS[trigger] ?? []).map((text, i) => (
                      <button key={i} type="button" onClick={() => setBody(text)}
                        className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold transition ${
                          body === text ? 'border-[#8C4460] bg-[#8e3f5b] text-white' : 'border-[#EAD8DF] bg-white text-[#8C4460] hover:bg-[#F6DFE6]'}`}>
                        Öneri {i + 1}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    placeholder="Merhaba {{ad}}, …"
                    className="w-full resize-y rounded-[14px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {variablesFor(trigger).map((v) => (
                      <button key={v.key} type="button" title={v.hint} onClick={() => insertVariable(v.key)}
                        className="rounded-[8px] border border-[#EAD8DF] bg-[#F7F6F6] px-2 py-0.5 text-[10.5px] font-semibold text-[#8C4460] transition-colors hover:bg-[#F6DFE6]">
                        + {v.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-[#74616A]">Değişkene tıkla, imlecin olduğu yere eklensin. Gönderimde her müşterinin kendi bilgisiyle dolar.</p>
                </section>

                {/* Ad + durum */}
                <section className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-1 block text-[10.5px] font-semibold text-[#74616A]">Şablon adı</span>
                    <input value={effectiveName} onChange={(e) => { setName(e.target.value); setNameTouched(true) }}
                      className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12.5px] text-[#2A2027] outline-none focus:border-[#A5556E]" />
                  </label>
                  <button type="button" onClick={() => { setActive((v) => !v); setStatusTouched(true) }}
                    className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 text-left transition ${active ? 'border-[#8C4460] bg-[#F6DFE6]' : 'border-[#EAD8DF] bg-white'}`}>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${active ? 'bg-[#A5556E]' : 'bg-[#d8c4cc]'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${active ? 'left-[18px]' : 'left-0.5'}`} />
                    </span>
                    <span className="text-[11.5px] font-semibold text-[#2A2027]">
                      {active ? 'Aktif' : 'Taslak'}
                      <span className="block text-[10px] font-normal text-[#74616A]">
                        {triggerMeta?.automatic ? (active ? 'Otomatik gönderim çalışır' : 'Otomatik gönderim durur') : (active ? 'Gönderime hazır' : 'Gönderilemez')}
                      </span>
                    </span>
                  </button>
                </section>

                {error && (
                  <p className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]">{error}</p>
                )}
              </div>

              {/* SAĞ — canlı önizleme + maliyet */}
              <div className="border-t border-[#EAD8DF] bg-[#FBFAFA] p-5 lg:border-l lg:border-t-0">
                <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#A5556E]">Müşterinin göreceği</div>
                <PhonePreview channel={channel} text={reminderFlow ? '' : preview} salonName={salonName} />
                {reminderFlow && (
                  <p className="mt-2 text-[11px] text-[#74616A]">Önizleme yok: metin WhatsApp ayarlarındaki hatırlatma şablonundan gelir.</p>
                )}

                {channel === 'Sms' && !reminderFlow && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Karakter" value={preview.length.toLocaleString('tr-TR')} />
                      <Metric label="SMS parçası" value={String(parts)} tone={parts > 2 ? 'warn' : 'ok'} />
                      <Metric label="Kredi / kişi" value={smsCreditsPerPart != null ? formatCredits(parts * smsCreditsPerPart) : '—'} />
                    </div>
                    <p className="text-[10.5px] leading-snug text-[#74616A]">
                      70 karaktere kadar 1 SMS; daha uzunu 67&apos;şer karakterlik parçalara bölünür. Önce paketinizdeki SMS kotası kullanılır;
                      kredi yalnız kota bitince düşer. Sayım örnek bir müşteri adıyla yapılır — uzun adlarda parça artabilir.
                    </p>
                    {emoji && (
                      <div className="flex items-start gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Metinde emoji var: SMS&apos;te 2 karakter sayılır ve bazı telefonlarda kutucuk olarak görünebilir.
                      </div>
                    )}
                    {parts > 2 && (
                      <div className="flex items-start gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Mesaj {parts} parça tutuyor; kısaltırsanız kişi başı maliyet düşer.
                      </div>
                    )}
                  </div>
                )}
                {channel === 'WhatsApp' && !reminderFlow && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-2 text-[10.5px] leading-snug text-[#5A4B53]">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-[#A5556E]" />
                    {trigger === 'PaymentDue'
                      ? 'Bilgilendirme mesajı: kota bitince mesaj başına hatırlatma kredisi düşer.'
                      : 'Kampanya sınıfında ücretlendirilir (Meta kuralı) ve WhatsApp ayarlarından kampanya izni gerekir. Serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir.'}
                  </div>
                )}
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EAD8DF] bg-white px-5 py-3.5">
              <button type="button" onClick={onClose}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-4 text-[12px] font-semibold text-[#5A4B53]">
                Vazgeç
              </button>
              <button type="button" disabled={busy || allowedChannels.length === 0} onClick={() => void save()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 text-[12px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {editing ? 'Kaydet' : 'Şablonu oluştur'}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  )
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-[#8e3f5b] text-[10px] font-bold text-white">{n}</span>
      <span className="text-[13px] font-semibold text-[#2A2027]">{title}</span>
    </div>
  )
}

function Metric({ label, value, tone = 'ok' }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`rounded-[12px] border px-2.5 py-2 text-center ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-[#EAD8DF] bg-white'}`}>
      <div className={`text-[16px] font-bold leading-tight ${tone === 'warn' ? 'text-amber-700' : 'text-[#8e3f5b]'}`}>{value}</div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[#74616A]">{label}</div>
    </div>
  )
}

/** Telefonda nasıl görüneceği — kanala göre balon rengi. */
export function PhonePreview({ channel, text, salonName }: { channel: NotificationChannelKey; text: string; salonName: string }) {
  const bubble =
    channel === 'WhatsApp'
      ? 'bg-[#dcf8c6] text-[#1f2c1a]'
      : channel === 'Email'
        ? 'bg-white text-[#2A2027] border border-[#EAD8DF]'
        : 'bg-[#e9e9eb] text-[#1c1c1e]'
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[28px] border-[6px] border-[#2A2027] bg-[#f4f1f2] p-3 shadow-[0_20px_50px_-30px_rgba(42,32,39,0.7)]">
      <div className="mb-2 text-center text-[10px] font-semibold text-[#74616A]">
        {channel === 'Sms' ? 'SMS' : channel === 'WhatsApp' ? 'WhatsApp' : 'E-posta'} · {salonName || 'Salonunuz'}
      </div>
      <div className="min-h-[120px]">
        {text ? (
          <div className={`max-w-[92%] whitespace-pre-wrap break-words rounded-[16px] rounded-tl-[4px] px-3 py-2 text-[12.5px] leading-relaxed ${bubble}`}>
            {text}
          </div>
        ) : (
          <div className="grid h-[120px] place-items-center text-[11px] text-[#9d7386]">Mesaj metni burada görünecek</div>
        )}
      </div>
    </div>
  )
}
