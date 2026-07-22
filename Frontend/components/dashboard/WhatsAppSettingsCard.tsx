'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Loader2, Check, Clock3, Info, ShieldCheck, PhoneCall, Megaphone, Wallet } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { ApiWhatsAppSettings } from '@/lib/types'

const DEFAULT_TEMPLATE =
  'Merhaba {ad}, {tarih} {saat} tarihli {hizmet} randevunuzu hatırlatırız. Onaylıyorsanız EVET, iptal için HAYIR, ertelemek için ERTELE yazın. — {salon}'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  Connected: { label: 'Bağlı', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Pending: { label: 'Doğrulama bekliyor', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  Disabled: { label: 'Devre dışı', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  NotConnected: { label: 'Bağlı değil', cls: 'border-[#ead8df] bg-[#fffafb] text-[#352432]/50' },
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
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!data) return
    setTemplate(data.reminderTemplate ?? '')
    setMarketingEnabled(Boolean(data.marketingEnabled))
    setAllowOverage(Boolean(data.allowWalletOverage))
    setSpendCap(data.monthlySpendCapTry != null ? String(data.monthlySpendCapTry) : '')
  }, [data])

  const save = async () => {
    setBusy(true); setSaved(false); setPending(false)
    try {
      const cap = spendCap.trim() === '' ? null : Number(spendCap)
      const body = {
        reminderTemplate: template.trim() || null,
        marketingEnabled,
        allowWalletOverage: allowOverage,
        monthlySpendCapTry: cap != null && Number.isFinite(cap) ? cap : null,
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
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#1da851]"><MessageCircle className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#352432]">WhatsApp Bildirimleri</div>
            <div className="text-[10.5px] text-[#352432]/45">Randevu hatırlatma + 2 yönlü onay (Evet / Hayır / Ertele)</div>
          </div>
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
      </div>

      {loading ? (
        <div className="py-4 text-center text-[11px] text-[#352432]/40">Yükleniyor…</div>
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
                  Bağlantı ve teknik kurulum <b>BeautyAsist</b> tarafından yönetilir; siz yalnızca mesaj içeriğini ve kontör tercihlerini belirlersiniz.
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
            <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Hatırlatma şablonu</label>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={DEFAULT_TEMPLATE}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {['{ad}', '{tarih}', '{saat}', '{hizmet}', '{personel}', '{salon}'].map((p) => (
                <button key={p} type="button" onClick={() => setTemplate((t) => `${t}${p}`)} className="rounded border border-[#ead8df] bg-[#fffafb] px-1.5 py-0.5 text-[10px] font-mono text-[#b14d6c] hover:bg-[#fff1f6]">{p}</button>
              ))}
            </div>
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Şablonu işlemsel tutun. "%20 indirim", "kampanya" gibi ifadeler Meta tarafından pahalı <b>Pazarlama</b> kategorisine sokabilir.
            </div>
          </div>

          {/* Faturalama tercihleri */}
          <div className="space-y-2 rounded-xl border border-[#ead8df] bg-[#fffafb] p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Kontör tercihleri</div>

            <PrefToggle
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Kota bitince kontörden devam et"
              desc="Aylık ücretsiz kotanız dolunca mesajlar kontör bakiyenizden gönderilsin. Kapalıyken kota bitince durur (sürpriz fatura olmaz)."
              on={allowOverage} toggle={() => setAllowOverage((v) => !v)}
            />
            <PrefToggle
              icon={<Megaphone className="h-3.5 w-3.5" />}
              label="Pazarlama (kampanya) mesajlarına izin ver"
              desc="Doğum günü / kampanya gibi mesajlar. Meta bunları pahalı kategoride ücretlendirir; kontörden düşer."
              on={marketingEnabled} toggle={() => setMarketingEnabled((v) => !v)}
            />
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Aylık kontör harcama tavanı (₺)</label>
              <input
                value={spendCap}
                onChange={(e) => setSpendCap(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="Boş = paket / platform varsayılanı"
                className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
              />
              <p className="mt-1 text-[10px] text-[#352432]/45">Bu tutarı aşan gönderim yapılmaz — Meta faturanız bu tavanı geçemez.</p>
            </div>
          </div>

          {pending && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              <Clock3 className="h-3.5 w-3.5" /> Ayar değişikliği onaya gönderildi.
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#c85776] to-[#8e3f5b] px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
              {saved ? 'Kaydedildi' : 'Kaydet'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PrefToggle({ icon, label, desc, on, toggle }: { icon: React.ReactNode; label: string; desc: string; on: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${on ? 'border-[#c85776] bg-[#fff1f6]' : 'border-[#ead8df] bg-white'}`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-[#c85776]/15 text-[#b14d6c]' : 'bg-[#f3e7ec] text-[#8a6b77]'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-medium text-[#352432]">{label}</span>
        <span className="block text-[10px] leading-snug text-[#352432]/50">{desc}</span>
      </span>
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-[#c85776]' : 'bg-[#d8c4cc]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
