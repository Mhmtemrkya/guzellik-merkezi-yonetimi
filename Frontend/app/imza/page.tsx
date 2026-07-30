'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Loader2, MonitorSmartphone, PenLine, RefreshCw, ShieldCheck, Tablet } from 'lucide-react'
import RouteGuard from '@/components/dashboard/RouteGuard'
import { useBranch } from '@/components/dashboard/BranchContext'
import PanelBackdrop from '@/components/dashboard/PanelBackdrop'
import SignaturePad from '@/components/dashboard/SignaturePad'
import { useAuth } from '@/components/dashboard/AuthContext'
import { consentApi } from '@/lib/apiClient'
import { fillConsentPlaceholders } from '@/lib/consentPdf'
import type { ApiConsentForm, ConsentAnswer } from '@/lib/types'

const STATION_KEY = 'beautyasist.consentStation'
/** Bekleyen form yoklama sıklığı — tablet başındaki müşteri beklememeli. */
const POLL_MS = 2500

/**
 * TABLET İMZA İSTASYONU.
 *
 * Tablet bir kez "istasyon adı" ile eşleşir (ör. "Kabin 1"), sonra sürekli o istasyona
 * gönderilmiş formu yoklar. Personel bilgisayardan "Tablete Aktar" dediği anda form burada
 * tam ekran açılır; müşteri okur, onay maddelerini işaretler, parmağıyla imzalar.
 *
 * NEDEN YOKLAMA (polling): salon içi tek bir tablet için kalıcı soket altyapısı kurmak
 * gereksiz karmaşıklık; 2,5 saniyelik yoklama hem anında hissettirir hem de ağ kesintisinde
 * kendiliğinden toparlar.
 */
export default function SignatureStationPage() {
  return (
    <RouteGuard allowedRoles={['InstitutionOwner', 'BranchManager', 'Staff']}>
      <div className="relative min-h-screen overflow-hidden bg-[#fff7fa] text-[#352432]">
        <PanelBackdrop variant="admin" />
        <StationInner />
      </div>
    </RouteGuard>
  )
}

function StationInner() {
  const { user } = useAuth()
  // Kurum adı: eski kayıtlarda {{kurum}} çözülmemiş olabilir (yeni kayıtlarda sunucu doldurur).
  const { selectedInstitution } = useBranch()
  const institutionName = selectedInstitution?.name || undefined
  const [station, setStation] = useState<string>('')
  const [stationDraft, setStationDraft] = useState('')
  const [form, setForm] = useState<ApiConsentForm | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  /** Soru kimliği → yanıt (Evet/Hayır) ve açıklama. */
  const [answers, setAnswers] = useState<Record<string, { answer: boolean; note: string }>>({})
  const [signature, setSignature] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const activeFormId = useRef<string | null>(null)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STATION_KEY) : null
    if (saved) setStation(saved)
  }, [])

  const pairStation = (): void => {
    const value = stationDraft.trim()
    if (!value) return
    window.localStorage.setItem(STATION_KEY, value)
    setStation(value)
  }

  const unpair = (): void => {
    window.localStorage.removeItem(STATION_KEY)
    setStation('')
    setForm(null)
    activeFormId.current = null
  }

  // --- bekleyen form yoklaması ------------------------------------------------
  const poll = useCallback(async () => {
    if (!station) return
    try {
      const pending = await consentApi.stationPending<ApiConsentForm>(station)
      setOnline(true)
      const id = pending?.id || null
      // Aynı form tekrar gelirse ekranı sıfırlamayız (müşteri imza atıyor olabilir).
      if (id && id !== activeFormId.current) {
        activeFormId.current = id
        setForm(pending)
        setChecked([])
        setAnswers({})
        setSignature(null)
        setSignerName(pending?.customerName || '')
        setError('')
        setDone(null)
      } else if (!id && !activeFormId.current) {
        setForm(null)
      }
    } catch {
      setOnline(false)
    }
  }, [station])

  useEffect(() => {
    if (!station) return
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [station, poll])

  const items = useMemo(() => form?.checkItems ?? [], [form])
  const questions = useMemo(() => form?.questions ?? [], [form])
  const allChecked = items.length === 0 || items.every((i) => checked.includes(i))
  // Zorunlu soruların TAMAMI yanıtlanmadan imza düğmesi açılmaz (sunucu da ayrıca doğrular).
  const allAnswered = questions.every((q) => q.required === false || answers[q.id] !== undefined)
  const needsSignature = form?.requiresSignature !== false
  const canSubmit = Boolean(form) && allChecked && allAnswered && (!needsSignature || Boolean(signature)) && !busy

  const toggle = (item: string): void =>
    setChecked((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]))

  const answerQuestion = (id: string, answer: boolean): void =>
    setAnswers((prev) => ({ ...prev, [id]: { answer, note: prev[id]?.note ?? '' } }))

  const noteQuestion = (id: string, note: string): void =>
    setAnswers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], note } } : prev))

  const submit = async (): Promise<void> => {
    if (!form?.id || !canSubmit) return
    setBusy(true)
    setError('')
    try {
      // İmza oturumu token'ı formun kendisinde değil; imzalama ucunda form id ile eşleşen
      // aktif oturum kullanılır. Tablet yalnızca kendisine gönderilen formu görür.
      const token = form.sessionToken || ''
      if (!token) throw new Error('İmza oturumu bulunamadı. Personelden formu yeniden göndermesini isteyin.')
      const payload: ConsentAnswer[] = questions
        .filter((q) => answers[q.id] !== undefined)
        .map((q) => ({
          id: q.id,
          text: q.text,
          answer: answers[q.id].answer,
          note: answers[q.id].note.trim() || null,
        }))
      await consentApi.sign(token, {
        checkedItems: checked,
        answers: payload,
        signatureImage: signature,
        signerName: signerName.trim() || form.customerName || null,
      })
      setDone(form.title || 'Onam formu')
      setForm(null)
      activeFormId.current = null
      window.setTimeout(() => setDone(null), 6000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İmza kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  // --- eşleşme ekranı ---------------------------------------------------------
  if (!station) {
    return (
      <div className="relative z-10 grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-md rounded-[24px] border border-[#ead8df] bg-white/95 p-8 shadow-[0_40px_90px_-60px_rgba(120,71,88,0.6)]">
          <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-[#fff1f6] text-[#c85776]"><Tablet className="h-7 w-7" /></span>
          <h1 className="mt-4 font-display text-2xl tracking-tight">İmza tabletini tanımlayın</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#705a66]">
            Bu tablete bir ad verin (ör. <span className="font-medium text-[#4a3a44]">Kabin 1</span>). Personel bilgisayardan
            formu bu ada gönderdiğinde form burada otomatik açılır.
          </p>
          <input
            value={stationDraft}
            onChange={(e) => setStationDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') pairStation() }}
            placeholder="Kabin 1"
            autoFocus
            className="mt-5 w-full rounded-[14px] border border-[#ead8df] bg-white px-4 py-3.5 text-[15px] outline-none focus:border-[#c85776]"
          />
          <button
            type="button"
            onClick={pairStation}
            disabled={!stationDraft.trim()}
            className="mt-3 w-full rounded-[14px] bg-[#c85776] px-4 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Bu tableti hazırla
          </button>
          <p className="mt-3 text-[12px] text-[#705a66]">Oturum: {user?.fullName || user?.email || '—'}</p>
        </div>
      </div>
    )
  }

  // --- imza ekranı ------------------------------------------------------------
  return (
    <div className="relative z-10 mx-auto min-h-screen w-full max-w-4xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#ead8df] bg-white/90 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><Tablet className="h-5 w-5" /></span>
          <div>
            <div className="font-display text-[17px] leading-tight tracking-tight">{station}</div>
            <div className="text-[12px] text-[#705a66]">İmza istasyonu · {user?.fullName || user?.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'Bağlı' : 'Bağlantı bekleniyor'}
          </span>
          <button type="button" onClick={unpair} className="rounded-[10px] border border-[#ead8df] bg-white px-3 py-1.5 text-[12px] font-medium text-[#4a3a44] hover:bg-[#fff4f8]">
            Tableti değiştir
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-6 grid place-items-center rounded-[24px] border border-emerald-200 bg-emerald-50/70 px-6 py-20 text-center"
          >
            <span className="grid h-20 w-20 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-10 w-10" /></span>
            <div className="mt-4 font-display text-2xl tracking-tight text-emerald-900">Formunuz imzalandı</div>
            <div className="mt-1.5 text-[13px] text-emerald-800">{done} · Teşekkür ederiz.</div>
          </motion.div>
        ) : form ? (
          <motion.div key={form.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 space-y-4">
            {/* Belge */}
            <div className="overflow-hidden rounded-[20px] border border-[#ead8df] bg-white">
              <div className="border-b border-[#f1e5ea] bg-gradient-to-r from-[#fff1f6] to-white px-6 py-5">
                <div className="text-[12px] font-semibold uppercase tracking-widest text-[#b14d6c]">Onam Formu</div>
                <h1 className="mt-1 font-display text-2xl leading-tight tracking-tight">{form.title}</h1>
                <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-[#4a3a44]">
                  {form.customerName && <span className="rounded-full border border-[#ead8df] bg-white px-2.5 py-1">Müşteri: <span className="font-semibold">{form.customerName}</span></span>}
                  {form.serviceName && <span className="rounded-full border border-[#ead8df] bg-white px-2.5 py-1">İşlem: <span className="font-semibold">{form.serviceName}</span></span>}
                  {form.staffName && <span className="rounded-full border border-[#ead8df] bg-white px-2.5 py-1">Uygulayan: <span className="font-semibold">{form.staffName}</span></span>}
                </div>
              </div>
              <div className="max-h-[42vh] overflow-y-auto px-6 py-5">
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#352432]">
                  {fillConsentPlaceholders(form.body || '', {
                    customerName: form.customerName,
                    serviceName: form.serviceName,
                    institutionName,
                    staffName: form.staffName,
                  })}
                </p>
                {form.staffNotes && (
                  <div className="mt-4 rounded-[12px] border border-[#efbfd0]/70 bg-[#fff1f6]/60 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#b14d6c]">Uygulama notu</div>
                    <div className="mt-1 whitespace-pre-wrap text-[13px] text-[#4a3a44]">{form.staffNotes}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Evet / Hayır soruları — beyan; "Hayır" da geçerli bir yanıttır. */}
            {questions.length > 0 && (
              <div className="rounded-[20px] border border-[#ead8df] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold uppercase tracking-widest text-[#b14d6c]">Sorular</div>
                  <span className="text-[12px] text-[#705a66]">
                    {questions.filter((q) => answers[q.id] !== undefined).length}/{questions.length} yanıtlandı
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {questions.map((q, i) => {
                    const picked = answers[q.id]
                    const missing = q.required !== false && picked === undefined
                    return (
                      <div key={q.id} className={`rounded-[14px] border px-4 py-3.5 transition-colors ${missing ? 'border-[#f0d3dc] bg-[#fffafc]' : 'border-[#ead8df] bg-white'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-[220px] flex-1 items-start gap-2.5">
                            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff1f6] text-[12px] font-bold text-[#a34a62]">{i + 1}</span>
                            <span className="text-[14.5px] leading-relaxed text-[#352432]">
                              {q.text}
                              {q.required !== false && <span className="ml-1 text-[#c85776]">*</span>}
                            </span>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => answerQuestion(q.id, true)}
                              className={`min-w-[92px] rounded-[12px] border px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                                picked?.answer === true
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-emerald-300 hover:bg-emerald-50'
                              }`}
                            >
                              Evet
                            </button>
                            <button
                              type="button"
                              onClick={() => answerQuestion(q.id, false)}
                              className={`min-w-[92px] rounded-[12px] border px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                                picked?.answer === false
                                  ? 'border-[#c85776] bg-[#c85776] text-white'
                                  : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0] hover:bg-[#fff1f6]'
                              }`}
                            >
                              Hayır
                            </button>
                          </div>
                        </div>
                        {/* Açıklama alanı: şablonda istendiyse, yanıt verilince açılır. */}
                        {q.note && picked !== undefined && (
                          <input
                            value={picked.note}
                            onChange={(e) => noteQuestion(q.id, e.target.value)}
                            placeholder="Açıklama (isteğe bağlı)"
                            className="mt-2.5 w-full rounded-[10px] border border-[#ead8df] bg-[#fffafc] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#c85776]"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Onay maddeleri */}
            {items.length > 0 && (
              <div className="rounded-[20px] border border-[#ead8df] bg-white p-5">
                <div className="text-[12px] font-semibold uppercase tracking-widest text-[#b14d6c]">Onay maddeleri</div>
                <div className="mt-3 space-y-2">
                  {items.map((item) => {
                    const on = checked.includes(item)
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggle(item)}
                        className={`flex w-full items-start gap-3 rounded-[14px] border px-4 py-3.5 text-left transition-colors ${
                          on ? 'border-[#c85776] bg-[#fff1f6]' : 'border-[#ead8df] bg-white hover:bg-[#fffafc]'
                        }`}
                      >
                        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border-2 transition-colors ${on ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#dcc2ce] bg-white'}`}>
                          {on && <CheckCircle2 className="h-4 w-4" />}
                        </span>
                        <span className="text-[14px] leading-relaxed text-[#352432]">{item}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* İmza */}
            {needsSignature && (
              <div className="rounded-[20px] border border-[#ead8df] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold uppercase tracking-widest text-[#b14d6c]">İmza</div>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="İmzalayan ad soyad"
                    className="w-56 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#c85776]"
                  />
                </div>
                <div className="mt-3">
                  <SignaturePad onChange={setSignature} height={200} disabled={busy} />
                </div>
              </div>
            )}

            {error && <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">{error}</div>}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full rounded-[16px] bg-[#c85776] px-6 py-4 text-[16px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Kaydediliyor…</span>
              ) : (
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Onaylıyorum ve İmzalıyorum</span>
              )}
            </button>
            {!allAnswered && <p className="text-center text-[12px] text-[#705a66]">Devam etmek için zorunlu soruları yanıtlayın.</p>}
            {allAnswered && !allChecked && <p className="text-center text-[12px] text-[#705a66]">Devam etmek için tüm onay maddelerini işaretleyin.</p>}
            {allChecked && allAnswered && needsSignature && !signature && <p className="text-center text-[12px] text-[#705a66]">Son adım: imza alanına imzanızı atın.</p>}
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 grid place-items-center rounded-[24px] border border-dashed border-[#ead8df] bg-white/70 px-6 py-24 text-center">
            <motion.span
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              className="grid h-20 w-20 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]"
            >
              <PenLine className="h-9 w-9" />
            </motion.span>
            <div className="mt-4 font-display text-2xl tracking-tight">Form bekleniyor</div>
            <div className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[#705a66]">
              Personel bilgisayardan <span className="font-medium text-[#4a3a44]">“Tablete Aktar”</span> dediğinde form burada
              otomatik açılır. Bu ekranı açık bırakabilirsiniz.
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-[12px] text-[#705a66]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ animationDuration: '3s' }} />
              <MonitorSmartphone className="h-3.5 w-3.5" /> {station} istasyonu dinleniyor
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
