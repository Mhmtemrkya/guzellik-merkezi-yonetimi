'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, Mail, Loader2, Check, Send, ShieldCheck, Info } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import type { ApiPlatformMessagingSettings, ApiMessagingTestResult } from '@/lib/types'

const card = 'border border-[#fff4f8]/15 bg-[#fff4f8]/[0.025]'
const inputCls =
  'w-full border border-[#fff4f8]/15 bg-[#fff4f8]/[0.03] px-3 py-2 text-[13px] text-[#fff4f8] outline-none transition focus:border-[#fff4f8]/40 placeholder:text-[#fff4f8]/25'
const labelCls = 'mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/40'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 text-[12px] text-[#fff4f8]/80">
      <span className={`relative h-5 w-9 transition ${on ? 'bg-emerald-400/80' : 'bg-[#fff4f8]/15'}`}>
        <span className={`absolute top-0.5 h-4 w-4 bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

function StatusPill({ configured, enabled }: { configured?: boolean; enabled?: boolean }) {
  const live = configured && enabled
  return (
    <span className={`border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
      live ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
      : enabled ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
      : 'border-[#fff4f8]/15 bg-[#fff4f8]/[0.03] text-[#fff4f8]/45'}`}>
      {live ? 'Canlı' : enabled ? 'Simülasyon' : 'Kapalı'}
    </span>
  )
}

export default function PlatformMessagingSettings() {
  const { data, loading, reload } = useApiQuery<ApiPlatformMessagingSettings>(
    () => platformApi.messagingSettings<ApiPlatformMessagingSettings>(),
    [],
    { initialData: {} },
  )

  const [sms, setSms] = useState({ enabled: false, provider: 'Netgsm', apiKey: '', apiSecret: '', sender: '', apiUrl: '' })
  const [email, setEmail] = useState({ enabled: false, fromAddress: '', fromName: '', host: '', port: 587, username: '', password: '', useSsl: true })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [smsTarget, setSmsTarget] = useState('')
  const [emailTarget, setEmailTarget] = useState('')
  const [smsTest, setSmsTest] = useState('')
  const [emailTest, setEmailTest] = useState('')
  const [testingSms, setTestingSms] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)

  useEffect(() => {
    if (!data) return
    setSms((s) => ({ ...s, enabled: !!data.smsEnabled, provider: data.smsProvider || 'Netgsm', sender: data.smsSender || '', apiUrl: data.smsApiUrl || '' }))
    setEmail((e) => ({ ...e, enabled: !!data.emailEnabled, fromAddress: data.emailFromAddress || '', fromName: data.emailFromName || '', host: data.smtpHost || '', port: data.smtpPort || 587, username: data.smtpUsername || '', useSsl: data.smtpUseSsl ?? true }))
  }, [data])

  const save = async () => {
    setBusy(true); setSaved(false)
    try {
      await platformApi.saveMessagingSettings({
        smsEnabled: sms.enabled, smsProvider: sms.provider, smsApiKey: sms.apiKey || null, smsApiSecret: sms.apiSecret || null, smsSender: sms.sender || null, smsApiUrl: sms.apiUrl || null,
        emailEnabled: email.enabled, emailFromAddress: email.fromAddress || null, emailFromName: email.fromName || null, smtpHost: email.host || null, smtpPort: Number(email.port) || 587, smtpUsername: email.username || null, smtpPassword: email.password || null, smtpUseSsl: email.useSsl,
      })
      setSms((s) => ({ ...s, apiKey: '', apiSecret: '' })); setEmail((e) => ({ ...e, password: '' }))
      setSaved(true); await reload(); setTimeout(() => setSaved(false), 2500)
    } finally { setBusy(false) }
  }

  const runTestSms = async () => {
    if (!smsTarget.trim()) return
    setTestingSms(true); setSmsTest('')
    try { const r = await platformApi.testSms<ApiMessagingTestResult>(smsTarget.trim()); setSmsTest(r.success ? (r.simulated ? 'Simülasyon ✓ (kayıtlı ayar canlı değil)' : 'Gönderildi ✓') : `Hata: ${r.error}`) }
    catch { setSmsTest('İstek başarısız') } finally { setTestingSms(false); setTimeout(() => setSmsTest(''), 6000) }
  }
  const runTestEmail = async () => {
    if (!emailTarget.trim()) return
    setTestingEmail(true); setEmailTest('')
    try { const r = await platformApi.testEmail<ApiMessagingTestResult>(emailTarget.trim()); setEmailTest(r.success ? (r.simulated ? 'Simülasyon ✓ (kayıtlı ayar canlı değil)' : 'Gönderildi ✓') : `Hata: ${r.error}`) }
    catch { setEmailTest('İstek başarısız') } finally { setTestingEmail(false); setTimeout(() => setEmailTest(''), 6000) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* SMS */}
      <div className={`${card} flex flex-col gap-4 p-5`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center border border-[#fff4f8]/15 bg-[#fff4f8]/[0.03]"><MessageSquare className="h-5 w-5 text-[#fff4f8]/70" strokeWidth={1.4} /></div>
            <div>
              <div className="font-display text-xl tracking-tight text-[#fff4f8]">SMS Altyapısı</div>
              <div className="text-[11px] text-[#fff4f8]/45">Tüm kurumların ortak SMS sağlayıcısı</div>
            </div>
          </div>
          <StatusPill configured={data?.smsConfigured} enabled={data?.smsEnabled} />
        </div>

        {loading ? <div className="py-4 text-center text-[12px] text-[#fff4f8]/40">Yükleniyor…</div> : (
          <>
            <Toggle on={sms.enabled} onClick={() => setSms((s) => ({ ...s, enabled: !s.enabled }))} label="SMS gönderimini etkinleştir" />
            <div>
              <label className={labelCls}>Sağlayıcı</label>
              <select value={sms.provider} onChange={(e) => setSms((s) => ({ ...s, provider: e.target.value }))} className={inputCls}>
                <option className="bg-[#1a1118]" value="Netgsm">Netgsm (Türkiye)</option>
                <option className="bg-[#1a1118]" value="Twilio">Twilio (global)</option>
                <option className="bg-[#1a1118]" value="Simulation">Simülasyon (test)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>API Anahtarı {data?.hasSmsApiKey && <span className="text-emerald-300/80">· kayıtlı</span>}</label>
                <input type="password" value={sms.apiKey} onChange={(e) => setSms((s) => ({ ...s, apiKey: e.target.value }))} placeholder={data?.hasSmsApiKey ? 'değiştirmek için yaz' : sms.provider === 'Twilio' ? 'Account SID' : 'usercode'} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>API Gizli {data?.hasSmsApiSecret && <span className="text-emerald-300/80">· kayıtlı</span>}</label>
                <input type="password" value={sms.apiSecret} onChange={(e) => setSms((s) => ({ ...s, apiSecret: e.target.value }))} placeholder={sms.provider === 'Twilio' ? 'Auth Token' : 'password'} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Gönderen başlık / numara</label>
              <input value={sms.sender} onChange={(e) => setSms((s) => ({ ...s, sender: e.target.value }))} placeholder={sms.provider === 'Twilio' ? '+1xxx' : 'BeautyAssist'} className={inputCls} />
            </div>
            <div className="border-t border-[#fff4f8]/10 pt-3">
              <label className={labelCls}>Test SMS</label>
              <div className="flex gap-2">
                <input value={smsTarget} onChange={(e) => setSmsTarget(e.target.value)} placeholder="05xx xxx xx xx" className={inputCls} />
                <button type="button" onClick={runTestSms} disabled={testingSms} className="flex shrink-0 items-center gap-1.5 border border-[#fff4f8]/20 bg-[#fff4f8]/[0.05] px-3 text-[12px] text-[#fff4f8] transition hover:bg-[#fff4f8]/10 disabled:opacity-50">
                  {testingSms ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Test
                </button>
              </div>
              {smsTest && <div className="mt-1.5 text-[11px] text-[#fff4f8]/60">{smsTest}</div>}
            </div>
          </>
        )}
      </div>

      {/* EMAIL */}
      <div className={`${card} flex flex-col gap-4 p-5`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center border border-[#fff4f8]/15 bg-[#fff4f8]/[0.03]"><Mail className="h-5 w-5 text-[#fff4f8]/70" strokeWidth={1.4} /></div>
            <div>
              <div className="font-display text-xl tracking-tight text-[#fff4f8]">E-posta Altyapısı</div>
              <div className="text-[11px] text-[#fff4f8]/45">SMTP — tüm kurumların ortak e-postası</div>
            </div>
          </div>
          <StatusPill configured={data?.emailConfigured} enabled={data?.emailEnabled} />
        </div>

        {loading ? <div className="py-4 text-center text-[12px] text-[#fff4f8]/40">Yükleniyor…</div> : (
          <>
            <Toggle on={email.enabled} onClick={() => setEmail((e) => ({ ...e, enabled: !e.enabled }))} label="E-posta gönderimini etkinleştir" />
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Gönderen adres</label><input value={email.fromAddress} onChange={(e) => setEmail((s) => ({ ...s, fromAddress: e.target.value }))} placeholder="bilgi@beautyassist.com" className={inputCls} /></div>
              <div><label className={labelCls}>Gönderen adı</label><input value={email.fromName} onChange={(e) => setEmail((s) => ({ ...s, fromName: e.target.value }))} placeholder="BeautyAssist" className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-[1fr_88px] gap-3">
              <div><label className={labelCls}>SMTP sunucu</label><input value={email.host} onChange={(e) => setEmail((s) => ({ ...s, host: e.target.value }))} placeholder="smtp.gmail.com" className={inputCls} /></div>
              <div><label className={labelCls}>Port</label><input type="number" value={email.port} onChange={(e) => setEmail((s) => ({ ...s, port: Number(e.target.value) }))} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Kullanıcı</label><input value={email.username} onChange={(e) => setEmail((s) => ({ ...s, username: e.target.value }))} placeholder="bilgi@beautyassist.com" className={inputCls} /></div>
              <div><label className={labelCls}>Parola {data?.hasSmtpPassword && <span className="text-emerald-300/80">· kayıtlı</span>}</label><input type="password" value={email.password} onChange={(e) => setEmail((s) => ({ ...s, password: e.target.value }))} placeholder={data?.hasSmtpPassword ? 'değiştirmek için yaz' : 'SMTP parolası'} className={inputCls} /></div>
            </div>
            <Toggle on={email.useSsl} onClick={() => setEmail((e) => ({ ...e, useSsl: !e.useSsl }))} label="SSL/TLS kullan" />
            <div className="border-t border-[#fff4f8]/10 pt-3">
              <label className={labelCls}>Test e-posta</label>
              <div className="flex gap-2">
                <input value={emailTarget} onChange={(e) => setEmailTarget(e.target.value)} placeholder="adres@ornek.com" className={inputCls} />
                <button type="button" onClick={runTestEmail} disabled={testingEmail} className="flex shrink-0 items-center gap-1.5 border border-[#fff4f8]/20 bg-[#fff4f8]/[0.05] px-3 text-[12px] text-[#fff4f8] transition hover:bg-[#fff4f8]/10 disabled:opacity-50">
                  {testingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Test
                </button>
              </div>
              {emailTest && <div className="mt-1.5 text-[11px] text-[#fff4f8]/60">{emailTest}</div>}
            </div>
          </>
        )}
      </div>

      {/* Save bar */}
      <div className="lg:col-span-2 flex items-center justify-between gap-3 border border-[#fff4f8]/10 bg-[#fff4f8]/[0.02] px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-[#fff4f8]/50">
          <Info className="h-3.5 w-3.5" /> Gizli alanlar şifreli saklanır; boş bırakılırsa mevcut değer korunur. Kimlik bilgisi girilmezse mesajlar simülasyon olur.
        </div>
        <button type="button" onClick={save} disabled={busy} className="flex items-center gap-2 border border-[#fff4f8]/25 bg-[#fff4f8]/10 px-5 py-2 text-[13px] font-semibold text-[#fff4f8] transition hover:bg-[#fff4f8]/15 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-emerald-300" /> : <ShieldCheck className="h-4 w-4" />}
          {saved ? 'Kaydedildi' : 'Ayarları kaydet'}
        </button>
      </div>
    </div>
  )
}
