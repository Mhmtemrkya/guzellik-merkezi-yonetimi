'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, Info, Send, Unplug, KeyRound, Server, AlertTriangle, Lock } from 'lucide-react'
import type { ApiSmsConnection, ApiSmsConnectionTestResult, SmsConnectionStatus } from '@/lib/types'

export const SMS_STATUS_META: Record<SmsConnectionStatus, { label: string; cls: string }> = {
  Connected: { label: 'Bağlı', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  PendingTest: { label: 'Test bekliyor', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  Failed: { label: 'Test başarısız', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  Disabled: { label: 'Kapalı', cls: 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]' },
  NotConnected: { label: 'Bağlı değil', cls: 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]' },
}

export function SmsStatusBadge({ status }: { status?: SmsConnectionStatus | null }) {
  const meta = SMS_STATUS_META[status ?? 'NotConnected'] ?? SMS_STATUS_META.NotConnected
  return <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
}

const PROVIDER_HELP: Record<string, { user: string; userPlaceholder: string; how: string }> = {
  Verimor: {
    user: 'Abone numarası (kullanıcı adı)',
    userPlaceholder: '908501234567',
    how: 'Verimor OİM panelinde API kullanıcısı tanımlanıp API parolası alınır.',
  },
  Netgsm: {
    user: 'Kullanıcı kodu',
    userPlaceholder: '8501234567',
    how: 'Netgsm panelinde "API kullanıcısı" oluşturulup kullanıcı kodu ve şifresi alınır.',
  },
}

export function formatSmsDateTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
}

export interface SmsConnectionApi {
  save: (body: Record<string, unknown>) => Promise<ApiSmsConnection>
  test: (phone: string) => Promise<ApiSmsConnectionTestResult>
  remove: () => Promise<ApiSmsConnection>
}

/**
 * KURUMUN SMS HESABINI BAĞLAMA FORMU — yalnız platform (BeautyAsist) kullanır.
 *
 * Verimor/Netgsm abone numarası + API parolası + başlık kaydedilir, bir test SMS'iyle doğrulanır.
 * Doğrulanınca kurumun müşteri SMS'leri o hesaptan gider (kota/kredi düşmez). Parola sunucudan hiç
 * gelmez; kullanıcı adı/parola alanı boş bırakılırsa kayıtlı olan korunur. Uç fonksiyonları dışarıdan
 * verilir (platform API'si) — form kimin adına konuştuğunu bilmez.
 */
export default function SmsConnectionForm({
  connection,
  api,
  onChange,
}: {
  connection: ApiSmsConnection
  api: SmsConnectionApi
  onChange: (next: ApiSmsConnection) => void
}) {
  const data = connection
  const [provider, setProvider] = useState('Verimor')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sender, setSender] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [testPhone, setTestPhone] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const exists = data.status !== 'NotConnected'

  useEffect(() => {
    setProvider(data.provider || 'Verimor')
    setSender(data.sender ?? '')
    setEnabled(data.status === 'NotConnected' ? true : Boolean(data.enabled))
    // Kimlik bilgisi alanları HER ZAMAN boş başlar: sunucu parolayı göndermez, kullanıcı adını maskeli
    // gönderir. Boş alan "değiştirme" demektir — ipucu placeholder'da gösterilir.
    setUsername('')
    setPassword('')
    setTestPhone((p) => p || data.suggestedTestPhone || '')
  }, [data])

  // Kayıtlıdan farklı bir şey yazıldı mı? Kaydedilmemiş bilgiyle test yapılmaz (test KAYITLI hesapla gider).
  const dirty = useMemo(() => {
    if (!exists) return Boolean(username || password || sender)
    return provider !== (data.provider || 'Verimor')
      || sender.trim() !== (data.sender ?? '')
      || enabled !== Boolean(data.enabled)
      || username.trim() !== ''
      || password.trim() !== ''
  }, [data, exists, provider, sender, enabled, username, password])

  const help = PROVIDER_HELP[provider] ?? PROVIDER_HELP.Verimor

  const run = async (kind: 'save' | 'test' | 'delete', fn: () => Promise<void>) => {
    setBusy(kind); setMessage(null)
    try { await fn() } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'İşlem tamamlanamadı.' })
    } finally { setBusy(null) }
  }

  const save = () => run('save', async () => {
    // Yalnız GERÇEKTEN yazılan kimlik bilgisi gönderilir; boş = sunucudaki korunur.
    const body: Record<string, unknown> = { provider, sender: sender.trim(), enabled }
    if (username.trim()) body.username = username.trim()
    if (password.trim()) body.password = password.trim()
    const next = await api.save(body)
    onChange(next)
    setMessage({
      tone: 'ok',
      text: next.active
        ? 'Kaydedildi. Kurumun SMS\'leri bu hesaptan gidiyor.'
        : next.status === 'Disabled'
          ? 'Kaydedildi. Hesap kapalı — kurumun SMS\'leri BeautyAsist altyapısından gider.'
          : 'Kaydedildi. Şimdi bir test SMS\'i göndererek bağlantıyı doğrulayın.',
    })
  })

  const test = () => run('test', async () => {
    const res = await api.test(testPhone)
    onChange(res.connection)
    // Sağlayıcının hata metni "Son test başarısız" kutusunda zaten görünür; burada tekrarlanmaz.
    setMessage(res.sent
      ? { tone: 'ok', text: 'Test SMS\'i gönderildi — bağlantı doğrulandı. Kurumun müşteri SMS\'leri artık bu hesaptan gider.' }
      : { tone: 'error', text: 'Test SMS\'i gönderilemedi. Bilgileri ve sağlayıcı panelindeki IP iznini kontrol edip tekrar deneyin.' })
  })

  const remove = () => run('delete', async () => {
    const next = await api.remove()
    onChange(next)
    setConfirmDelete(false)
    setMessage({ tone: 'ok', text: 'Bağlantı kaldırıldı. Kurumun SMS\'leri BeautyAsist altyapısından (kota → mesaj kredisi) gider.' })
  })

  const removeControls = exists && (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {confirmDelete ? (
        <>
          <span className="text-[10.5px] text-[#5A4B53]">Bağlantı ve kayıtlı parola silinecek; SMS&apos;ler BeautyAsist altyapısından gider.</span>
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-[#EAD8DF] bg-white px-3 py-1 text-[11px] font-semibold text-[#5A4B53]">Vazgeç</button>
          <button type="button" disabled={busy !== null} onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />} Kaldır
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
          <Unplug className="h-3 w-3" /> Bağlantıyı kaldır
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {data.smsFeatureAllowed === false ? (
        // Paket kapısı: kendi hesap da SMS özelliğine tabidir — bağlansa bile kurum gönderemezdi.
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
          <div className="flex items-start gap-1.5">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Bu kurumun paketinde SMS yok. SMS hesabı bağlamak için önce kurumu SMS içeren bir pakete geçirin.</span>
          </div>
          {removeControls}
        </div>
      ) : (
        <>
          <div className="space-y-2.5 rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Sağlayıcı</span>
              <span className="flex items-center gap-1 rounded-lg border border-[#EAD8DF] bg-white p-0.5">
                {(data.providers?.length ? data.providers : ['Verimor', 'Netgsm']).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvider(p)}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${provider === p ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53] hover:text-[#8e3f5b]'}`}
                  >
                    {p}
                  </button>
                ))}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={help.user}>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  inputMode={provider === 'Verimor' ? 'numeric' : undefined}
                  autoComplete="off"
                  placeholder={exists && data.usernameHint ? `${data.usernameHint} · değiştirmek için yazın` : help.userPlaceholder}
                  className="w-full rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 font-mono text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
                />
              </Field>
              <Field label="API parolası">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={exists && data.hasPassword ? '•••••••• kayıtlı · değiştirmek için yazın' : 'Sağlayıcıdan alınan API parolası'}
                  className="w-full rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
                />
              </Field>
            </div>

            <Field label="Gönderici başlığı">
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                maxLength={16}
                autoComplete="off"
                placeholder="örn. SALONUM"
                className="w-full rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 font-mono text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
              />
              <p className="mt-1 text-[10px] text-[#5A4B53]">Müşterinin telefonunda görünen ad: kurumun sağlayıcıda onaylı (BTK kayıtlı) başlığı ya da numarası.</p>
            </Field>

            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${enabled ? 'border-[#8C4460] bg-[#F6DFE6]' : 'border-[#EAD8DF] bg-white'}`}
            >
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-[#A5556E]/15 text-[#8C4460]' : 'bg-[#f3e7ec] text-[#8a6b77]'}`}><Send className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-medium text-[#2A2027]">Kurumun SMS&apos;lerini bu hesaptan gönder</span>
                <span className="block text-[10px] leading-snug text-[#5A4B53]">Kapalıyken bilgiler saklanır ama SMS&apos;ler BeautyAsist altyapısından gider.</span>
              </span>
              <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${enabled ? 'bg-[#A5556E]' : 'bg-[#d8c4cc]'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </button>

            <div className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-900">
              <Server className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {help.how}{' '}
                {data.serverIp ? (
                  <>Sağlayıcı panelinde izinli IP listesine <b className="font-mono">{data.serverIp}</b> eklenmeli — eklenmezse gönderim &quot;yetkisiz&quot; hatası verir.</>
                ) : (
                  <>Sunucu IP&apos;si ayarlı değil (<span className="font-mono">Messaging:ServerOutboundIp</span>); sağlayıcı IP kısıtı istiyorsa canlı sunucunun dış IP&apos;si izinli listeye eklenmeli.</>
                )}
              </span>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy !== null || !dirty}
                onClick={save}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#A5556E] to-[#8e3f5b] px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50"
              >
                {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                {exists ? 'Değişiklikleri kaydet' : 'Hesabı kaydet'}
              </button>
            </div>
          </div>

          {exists && (
            <div className="space-y-2 rounded-xl border border-[#EAD8DF] bg-white p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Bağlantıyı doğrula</div>
              <p className="text-[10.5px] leading-relaxed text-[#5A4B53]">
                Kayıtlı hesapla bu numaraya bir test SMS&apos;i gider (ücreti kurumun sağlayıcısı keser). Başarılı olursa kurumun SMS&apos;leri bu hesaptan gönderilmeye başlar.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="05XX XXX XX XX"
                  className="min-w-0 flex-1 rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 font-mono text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
                />
                <button
                  type="button"
                  disabled={busy !== null || dirty || testPhone.replace(/\D/g, '').length < 10}
                  onClick={test}
                  title={dirty ? 'Önce değişiklikleri kaydedin' : undefined}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#8C4460] bg-[#F6DFE6] px-3 py-1.5 text-[12px] font-semibold text-[#8C4460] transition hover:bg-[#f1d2dc] disabled:opacity-50"
                >
                  {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Test SMS&apos;i gönder
                </button>
              </div>
              {data.suggestedTestPhone && <p className="text-[10px] text-[#74616A]">Kurumun kayıtlı telefonu: <span className="font-mono">{data.suggestedTestPhone}</span></p>}
              {dirty && <p className="text-[10px] text-amber-700">Test kayıtlı bilgilerle yapılır — önce değişiklikleri kaydedin.</p>}
              {(data.lastTestAtUtc || data.verifiedAtUtc) && (
                <p className="text-[10px] text-[#74616A]">
                  {data.verifiedAtUtc && <>Doğrulandı: {formatSmsDateTime(data.verifiedAtUtc)}</>}
                  {data.verifiedAtUtc && data.lastTestAtUtc && ' · '}
                  {data.lastTestAtUtc && <>Son test: {formatSmsDateTime(data.lastTestAtUtc)}</>}
                </p>
              )}
              {data.lastError && (
                <div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-rose-800">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span><b>Son test başarısız:</b> {data.lastError}</span>
                </div>
              )}
            </div>
          )}

          {removeControls}
        </>
      )}

      {message && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium ${message.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {message.tone === 'ok' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#74616A]">{label}</label>
      {children}
    </div>
  )
}
