'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Loader2, Check, Clock3, Info, ShieldCheck, PhoneCall, Megaphone, Wallet, Route, Star, CalendarCheck2, ScrollText } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { ApiWhatsAppSettings, OneWayChannel } from '@/lib/types'

const DEFAULT_TEMPLATE =
  'Merhaba {ad}, {tarih} {saat} tarihli {hizmet} randevunuzu hatırlatırız. Onaylıyorsanız EVET, iptal için HAYIR, ertelemek için ERTELE yazın. — {salon}'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  Connected: { label: 'Bağlı', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Pending: { label: 'Doğrulama bekliyor', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  Disabled: { label: 'Devre dışı', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  NotConnected: { label: 'Bağlı değil', cls: 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]' },
}

export default function WhatsAppSettingsCard({ tenantId }: { tenantId?: string }) {
  const { data, loading, reload } = useApiQuery<ApiWhatsAppSettings>(
    () => adminApi.whatsappSettings<ApiWhatsAppSettings>(tenantId),
    [tenantId],
    { initialData: {} },
  )

  const [template, setTemplate] = useState('')
  const [marketingEnabled, setMarketingEnabled] = useState(false)
  const [allowOverage, setAllowOverage] = useState(false)
  const [spendCap, setSpendCap] = useState('')
  const [ratingChannel, setRatingChannel] = useState<OneWayChannel>('WhatsApp')
  const [waitlistChannel, setWaitlistChannel] = useState<OneWayChannel>('WhatsApp')
  const [kvkkChannel, setKvkkChannel] = useState<OneWayChannel>('WhatsApp')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!data) return
    setTemplate(data.reminderTemplate ?? '')
    setMarketingEnabled(Boolean(data.marketingEnabled))
    setAllowOverage(Boolean(data.allowWalletOverage))
    setSpendCap(data.monthlySpendCapCredits != null ? String(data.monthlySpendCapCredits) : '')
    setRatingChannel(data.ratingLinkChannel === 'Sms' ? 'Sms' : 'WhatsApp')
    setWaitlistChannel(data.waitlistActivatedChannel === 'Sms' ? 'Sms' : 'WhatsApp')
    setKvkkChannel(data.kvkkChannel === 'Sms' ? 'Sms' : 'WhatsApp')
  }, [data])

  const save = async () => {
    setBusy(true); setSaved(false); setPending(false)
    try {
      const cap = spendCap.trim() === '' ? null : Number(spendCap)
      const body = {
        reminderTemplate: template.trim() || null,
        marketingEnabled,
        allowWalletOverage: allowOverage,
        monthlySpendCapCredits: cap != null && Number.isFinite(cap) ? cap : null,
        // Birim işareti: sunucu boş tavanı yalnız bunu gönderen (krediyi bilen) istemciden silinmiş sayar.
        spendCapUnit: 'Credits',
        ratingLinkChannel: ratingChannel,
        waitlistActivatedChannel: waitlistChannel,
        kvkkChannel,
        // Meta onaylı şablon adları platformdadır (Platform > WhatsApp > Bağlantılar) — burada gönderilmez.
      }
      const res = await adminApi.saveWhatsappSettings(body, tenantId)
      if (isPendingApprovalResult(res)) setPending(true)
      else { setSaved(true); await reload(); setTimeout(() => setSaved(false), 2500) }
    } finally { setBusy(false) }
  }

  const status = data?.connectionStatus ?? 'NotConnected'
  const meta = STATUS_META[status] ?? STATUS_META.NotConnected
  const connected = Boolean(data?.isConnected)

  return (
    <div className="rounded-[20px] border border-[#EAD8DF] bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#1da851]"><MessageCircle className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#2A2027]">WhatsApp Bildirimleri</div>
            <div className="text-[10.5px] text-[#74616A]">Randevu hatırlatma + 2 yönlü onay (Evet / Hayır / Ertele)</div>
          </div>
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
      </div>

      {loading ? (
        <div className="py-4 text-center text-[11px] text-[#74616A]">Yükleniyor…</div>
      ) : (
        <div className="space-y-3">
          {/* Bağlantı durumu — platform yönetir, salt-okunur */}
          <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${connected ? 'border-emerald-200 bg-emerald-50/60' : 'border-[#cfe0ea] bg-[#f2f8fc]'}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${connected ? 'bg-emerald-100 text-emerald-600' : 'bg-[#e0eef7] text-[#4a80a6]'}`}>
              {connected ? <ShieldCheck className="h-3.5 w-3.5" /> : <PhoneCall className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 text-[11px] leading-relaxed text-[#39525f]">
              {connected ? (
                <>
                  <b className="text-emerald-700">WhatsApp numaranız bağlı.</b>{' '}
                  {data?.displayPhoneNumber && <span className="font-mono">{data.displayPhoneNumber}</span>} üzerinden mesajlar gönderilir.
                  Bağlantı ve teknik kurulum <b>BeautyAsist</b> tarafından yönetilir; siz yalnızca mesaj içeriğini ve kredi tercihlerini belirlersiniz.
                </>
              ) : (
                <>
                  WhatsApp bağlantınız henüz kurulmadı. Numaranızın bağlanması için <b>BeautyAsist destek ekibiyle</b> iletişime geçin.
                  Bağlantı yapılana kadar mesajlar <b>simülasyon</b> olur (kaydedilir ama gönderilmez).
                </>
              )}
            </div>
          </div>

          {/* Hatırlatma şablonu (içerik) */}
          <div>
            <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Hatırlatma şablonu</label>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={DEFAULT_TEMPLATE}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {['{ad}', '{tarih}', '{saat}', '{hizmet}', '{personel}', '{salon}'].map((p) => (
                <button key={p} type="button" onClick={() => setTemplate((t) => `${t}${p}`)} className="rounded border border-[#EAD8DF] bg-[#F7F6F6] px-1.5 py-0.5 text-[10px] font-mono text-[#8C4460] hover:bg-[#F6DFE6]">{p}</button>
              ))}
            </div>
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Şablonu işlemsel tutun. "%20 indirim", "kampanya" gibi ifadeler Meta tarafından pahalı <b>Pazarlama</b> kategorisine sokabilir.
            </div>
          </div>

          {/* Faturalama tercihleri — mesaj kredisi WhatsApp ve SMS'in ORTAK bakiyesidir */}
          <div className="space-y-2 rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Mesaj kredisi tercihleri · WhatsApp + SMS</div>

            <PrefToggle
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Kota bitince mesaj kredisinden devam et"
              desc="Paketinizdeki aylık WhatsApp/SMS kotası dolunca mesajlar kredi bakiyenizden gönderilsin. Kapalıyken kota bitince gönderim durur (sürpriz harcama olmaz)."
              on={allowOverage} toggle={() => setAllowOverage((v) => !v)}
            />
            <PrefToggle
              icon={<Megaphone className="h-3.5 w-3.5" />}
              label="WhatsApp kampanya mesajlarına izin ver"
              desc="Doğum günü / kampanya gibi WhatsApp mesajları. Meta bunları pahalı kategoride ücretlendirir; mesaj başına daha fazla kredi düşer."
              on={marketingEnabled} toggle={() => setMarketingEnabled((v) => !v)}
            />
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Aylık kredi harcama tavanı</label>
              <input
                value={spendCap}
                onChange={(e) => setSpendCap(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="Boş = paket / platform varsayılanı"
                className="w-full rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
              />
              <p className="mt-1 text-[10px] text-[#74616A]">Bir ayda bu kadar krediden fazlası harcanmaz (WhatsApp + SMS toplamı).</p>
            </div>
          </div>

          {/* Tek yönlü bildirimlerin kanalı — kurum WhatsApp ya da SMS seçer */}
          <div className="space-y-2 rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-3">
            <div className="flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5 text-[#A5556E]" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Otomatik bildirim kanalı</span>
            </div>
            <p className="text-[10px] leading-relaxed text-[#5A4B53]">
              Bu bildirimler müşteriye tek yönlü gider. WhatsApp numaranız bağlı değilse ya da müşterileriniz SMS&apos;e daha hızlı dönüyorsa
              <b> SMS</b> seçin — SMS, paketinizdeki SMS kotasından, kota bitince mesaj kredisinden düşer
              (BeautyAsist kendi başlığınızla SMS hesabınızı bağladıysa ücreti sağlayıcınız keser).
            </p>
            <ChannelRow
              icon={<Star className="h-3.5 w-3.5" />}
              label="Değerlendirme (yıldız) linki"
              desc="Randevu tamamlanınca müşteriye 24 saat geçerli puanlama linki."
              value={ratingChannel} onChange={setRatingChannel}
            />
            <ChannelRow
              icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
              label="Bekleme listesinden randevu oluştu"
              desc="Bekleyen müşteri için randevu açılınca tarih ve saati bildirir."
              value={waitlistChannel} onChange={setWaitlistChannel}
            />
            <ChannelRow
              icon={<ScrollText className="h-3.5 w-3.5" />}
              label="KVKK"
              desc={kvkkChannel === 'Sms'
                ? 'SMS ile yalnız aydınlatma metni linki gider; açık rıza SMS yanıtıyla ALINMAZ (kayıt formunda işaretleyin).'
                : 'WhatsApp ile açık rıza isteği gider; müşteri ONAYLIYORUM yazınca kayıt otomatik onaylanır.'}
              value={kvkkChannel} onChange={setKvkkChannel}
            />
          </div>

          {pending && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <Clock3 className="h-3.5 w-3.5" /> Ayar değişikliği onaya gönderildi.
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#A5556E] to-[#8e3f5b] px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
              {saved ? 'Kaydedildi' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tek yönlü bildirim için kanal seçimi (WhatsApp / SMS). */
function ChannelRow({ icon, label, desc, value, onChange }: { icon: React.ReactNode; label: string; desc: string; value: OneWayChannel; onChange: (v: OneWayChannel) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-2 sm:flex-row sm:items-center">
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#f3e7ec] text-[#8C4460]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[11.5px] font-medium text-[#2A2027]">{label}</span>
          <span className="block text-[10px] leading-snug text-[#5A4B53]">{desc}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 self-start rounded-lg border border-[#EAD8DF] bg-[#F7F6F6] p-0.5 sm:self-center">
        {(['WhatsApp', 'Sms'] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => onChange(ch)}
            className={`rounded-md px-2.5 py-1 text-[10.5px] font-semibold transition ${value === ch ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53] hover:text-[#8e3f5b]'}`}
          >
            {ch === 'Sms' ? 'SMS' : 'WhatsApp'}
          </button>
        ))}
      </span>
    </div>
  )
}

function PrefToggle({ icon, label, desc, on, toggle }: { icon: React.ReactNode; label: string; desc: string; on: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${on ? 'border-[#8C4460] bg-[#F6DFE6]' : 'border-[#EAD8DF] bg-white'}`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-[#A5556E]/15 text-[#8C4460]' : 'bg-[#f3e7ec] text-[#8a6b77]'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-medium text-[#2A2027]">{label}</span>
        <span className="block text-[10px] leading-snug text-[#5A4B53]">{desc}</span>
      </span>
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-[#A5556E]' : 'bg-[#d8c4cc]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
