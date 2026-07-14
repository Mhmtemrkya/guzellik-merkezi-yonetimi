'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Loader2, Check, ChevronDown, Copy, Webhook, Clock3, Info, LifeBuoy } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { ApiWhatsAppSettings } from '@/lib/types'

const DEFAULT_TEMPLATE =
  'Merhaba {ad}, {tarih} {saat} tarihli {hizmet} randevunuzu hatırlatırız. Onaylıyorsanız EVET, iptal için HAYIR, ertelemek için ERTELE yazın. — {salon}'

export default function WhatsAppSettingsCard({ tenantId }: { tenantId?: string }) {
  const { data, loading, reload } = useApiQuery<ApiWhatsAppSettings>(
    () => adminApi.whatsappSettings<ApiWhatsAppSettings>(tenantId),
    [tenantId],
    { initialData: {} },
  )

  const [enabled, setEnabled] = useState(false)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)

  useEffect(() => {
    if (!data) return
    setEnabled(Boolean(data.enabled))
    setPhoneNumberId(data.phoneNumberId ?? '')
    setBusinessAccountId(data.businessAccountId ?? '')
    setVerifyToken(data.verifyToken ?? '')
    setTemplate(data.reminderTemplate ?? '')
  }, [data])

  const save = async () => {
    setBusy(true); setSaved(false); setPending(false)
    try {
      const body = {
        enabled,
        phoneNumberId: phoneNumberId.trim() || null,
        accessToken: accessToken.trim() || null, // boş = mevcut korunur
        businessAccountId: businessAccountId.trim() || null,
        verifyToken: verifyToken.trim() || null,
        reminderTemplate: template.trim() || null,
      }
      const res = await adminApi.saveWhatsappSettings(body, tenantId)
      if (isPendingApprovalResult(res)) setPending(true)
      else { setSaved(true); setAccessToken(''); await reload(); setTimeout(() => setSaved(false), 2500) }
    } finally { setBusy(false) }
  }

  const copyWebhook = () => {
    if (!data?.webhookUrl) return
    navigator.clipboard?.writeText(data.webhookUrl)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  const live = Boolean(data?.configured && data?.enabled)

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#1da851]"><MessageCircle className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#352432]">WhatsApp Hatırlatma</div>
            <div className="text-[10.5px] text-[#352432]/45">Randevu hatırlatması + 2 yönlü onay (Evet / Hayır / Ertele)</div>
          </div>
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
          live ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : data?.enabled ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-[#ead8df] bg-[#fffafb] text-[#352432]/50'}`}>
          {live ? 'Canlı' : data?.enabled ? 'Simülasyon' : 'Kapalı'}
        </span>
      </div>

      {loading ? (
        <div className="py-4 text-center text-[11px] text-[#352432]/40">Yükleniyor…</div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${enabled ? 'border-[#c85776] bg-[#fff1f6]' : 'border-[#ead8df] bg-[#fffafb]'}`}
          >
            <span className="text-[12px] font-medium text-[#352432]">WhatsApp hatırlatmayı etkinleştir</span>
            <span className={`relative h-5 w-9 rounded-full transition ${enabled ? 'bg-[#c85776]' : 'bg-[#d8c4cc]'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
          </button>

          {!data?.configured && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] text-amber-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Kimlik bilgisi (telefon no. ID + erişim token) girilmeden mesajlar <b>simülasyon</b> olur: gönderilmez ama akış (kayıt, onay durumu) çalışır. Meta bilgilerini girince otomatik canlıya geçer.
            </div>
          )}

          {/* NASIL BAĞLANIR? — adım adım kullanıcı rehberi */}
          <div className="overflow-hidden rounded-xl border border-[#cfe8d8] bg-[#f4fbf6]">
            <button
              type="button"
              onClick={() => setHowToOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold text-[#1f7a45]">
                <LifeBuoy className="h-4 w-4" /> Nasıl bağlanır? (adım adım)
              </span>
              <ChevronDown className={`h-4 w-4 text-[#1f7a45] transition-transform ${howToOpen ? 'rotate-180' : ''}`} />
            </button>
            {howToOpen && (
              <div className="space-y-2.5 border-t border-[#cfe8d8] px-3 py-3 text-[11.5px] leading-relaxed text-[#2f5b41]">
                <p className="rounded-lg bg-white/70 px-2.5 py-2">
                  Bu sistem telefonunuzdaki WhatsApp'a QR ile bağlanmaz; Meta'nın <b>resmî WhatsApp Business API</b>'sini
                  kullanır. Tek seferlik kurulumdan sonra tüm hatırlatma ve bildirimler otomatik gider.
                </p>
                <ol className="list-decimal space-y-2 pl-4">
                  <li>
                    <b>developers.facebook.com</b>'a işletme Facebook hesabınızla girin →
                    "My Apps → Create App" ile <b>Business</b> türünde bir uygulama oluşturun.
                  </li>
                  <li>
                    Uygulamaya <b>WhatsApp</b> ürününü ekleyin ("Add Product → WhatsApp → Set up").
                    Meta size ücretsiz bir test numarası verir; kendi salon numaranızı kullanmak için
                    "Add phone number" ile numaranızı ekleyip SMS koduyla doğrulayın.
                    <span className="mt-0.5 block text-[10.5px] text-[#4f7a61]">
                      Önemli: Bu numara telefonunuzdaki normal WhatsApp'tan çıkarılmış olmalı (API'ye taşınan numara
                      uygulamada aynı anda kullanılamaz).
                    </span>
                  </li>
                  <li>
                    WhatsApp → "API Setup" ekranındaki <b>Phone number ID</b>'yi kopyalayıp aşağıdaki
                    "Telefon Numarası ID" kutusuna yapıştırın. <i>(Dikkat: telefon numaranız değil, 15 haneli ID.)</i>
                  </li>
                  <li>
                    <b>Kalıcı erişim token</b> alın: Meta Business Ayarları → "System Users" bölümünde bir sistem
                    kullanıcısı oluşturup uygulamanıza <code>whatsapp_business_messaging</code> izniyle süresiz token
                    üretin ve "Kalıcı Erişim Token" kutusuna yapıştırın. (API Setup'taki 24 saatlik geçici token yalnızca denemelik.)
                  </li>
                  <li>
                    <b>Kaydet</b>'e basın → sağ üstteki rozet <b>"Canlı"</b> olur ve giden mesajlar
                    (randevu hatırlatma, bekleme listesi teklifi, değerlendirme linki) gerçek olarak gönderilmeye başlar.
                  </li>
                  <li>
                    Müşterinin <b>EVET / HAYIR / ERTELE</b> yanıtlarının sisteme düşmesi için:
                    "Webhook Verify Token" kutusuna kendi belirlediğiniz gizli bir kelime yazın →
                    Meta'da WhatsApp → "Configuration → Webhook" bölümüne aşağıdaki <b>Webhook URL</b>'yi ve aynı
                    verify token'ı girin → "messages" alanına abone olun.
                  </li>
                </ol>
                <p className="rounded-lg bg-white/70 px-2.5 py-2 text-[10.5px]">
                  Not: Paketinizde WhatsApp özelliği açık olmalı ve aylık mesaj kotanız dolmamış olmalı.
                  Bilgileri girmeden anahtarı açarsanız sistem "Simülasyon" modunda kalır — mesajlar kaydedilir ama gönderilmez.
                </p>
              </div>
            )}
          </div>

          <Field label="Telefon Numarası ID (Meta)" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="örn. 123456789012345" />
          <div>
            <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">
              Kalıcı Erişim Token {data?.hasAccessToken && <span className="ml-1 rounded bg-emerald-50 px-1 text-emerald-600">kayıtlı</span>}
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={data?.hasAccessToken ? 'Değiştirmek için yazın — boş = korunur' : 'Meta kalıcı token'}
              className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="WhatsApp Business Account ID" value={businessAccountId} onChange={setBusinessAccountId} placeholder="opsiyonel" />
            <Field label="Webhook Verify Token" value={verifyToken} onChange={setVerifyToken} placeholder="kendi belirlediğiniz gizli dizi" />
          </div>

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
          </div>

          {data?.webhookUrl && (
            <div className="rounded-xl border border-[#ead8df] bg-[#fffafb] p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40"><Webhook className="h-3 w-3" /> Meta'ya yapıştırılacak Webhook URL</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-[#352432]/75">{data.webhookUrl}</code>
                <button type="button" onClick={copyWebhook} className="inline-flex items-center gap-1 rounded-lg border border-[#ead8df] bg-white px-2 py-1 text-[11px] font-semibold text-[#b14d6c] hover:bg-[#fff1f6]">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Kopyalandı' : 'Kopyala'}
                </button>
              </div>
            </div>
          )}

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

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]" />
    </div>
  )
}
