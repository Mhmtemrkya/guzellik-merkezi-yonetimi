'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2, ClipboardList, Download, FileSignature, Loader2, MonitorSmartphone,
  PenLine, RotateCcw, Tablet, X,
} from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { useBranch } from '@/components/dashboard/BranchContext'
import { adminApi, consentApi } from '@/lib/apiClient'
import { guidOrUndefined } from '@/lib/apiMappers'
import { generateConsentPdf, fillConsentPlaceholders } from '@/lib/consentPdf'
import {
  CONSENT_STATUS_LABEL, CONSENT_STATUS_TONE, consentStatusKey, isSigned, latestFormFor, missingRequirements,
} from '@/lib/consent'
import type { ApiConsentForm, ApiConsentStatus } from '@/lib/types'

const STATION_KEY = 'beautyasist.consentStation'
/** İmza bekleyen form için yoklama sıklığı — "Form imzalandı" bildirimi anında düşsün. */
const POLL_MS = 2500

interface PublicProfileLite { logoData?: string | null }

/**
 * ONAM FORMU MERKEZİ — personelin bilgisayarından çalıştırdığı ekran.
 *
 * Akış (kullanıcının tarif ettiği sıra):
 *  1. Personel müşteri için formu açar, uygulama notunu yazar.
 *  2. "Tablete Aktar" → tek kullanımlık imza oturumu üretilir, form seçilen tablette açılır.
 *  3. Müşteri tablette okur, onay kutularını işaretler, parmağıyla imzalar.
 *  4. Bu ekran yoklama ile imzayı yakalar → "Form imzalandı" bildirimi belirir.
 *  5. İmzalı belge logolu PDF olarak indirilebilir (müşterinin dosyasına eklenir).
 */
export default function ConsentCenterModal({
  open,
  onClose,
  customerId,
  customerName,
  appointmentId,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  customerId: string
  customerName?: string | null
  /** Randevudan açıldıysa yeni kayıtlar bu randevuya bağlanır. */
  appointmentId?: string | null
  onChanged?: () => void | Promise<unknown>
}) {
  const { selectedInstitution, selectedInstitutionId } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const institutionName = selectedInstitution?.name || 'Kurum'

  const [status, setStatus] = useState<ApiConsentStatus | null>(null)
  const [forms, setForms] = useState<ApiConsentForm[]>([])
  const [logo, setLogo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [signedToast, setSignedToast] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<ApiConsentForm | null>(null)
  const [notes, setNotes] = useState('')
  const [station, setStation] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    setStation(window.localStorage.getItem(STATION_KEY) || '')
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (!customerId) return
    setLoading(true)
    setError('')
    try {
      const [statusRes, formsRes] = await Promise.all([
        appointmentId
          ? consentApi.appointmentStatus<ApiConsentStatus>(appointmentId, tenantId)
          : consentApi.customerStatus<ApiConsentStatus>(customerId, tenantId),
        consentApi.customerForms<ApiConsentForm>(customerId, tenantId),
      ])
      setStatus(statusRes)
      setForms(Array.isArray(formsRes) ? formsRes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onam formları yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [customerId, appointmentId, tenantId])

  useEffect(() => {
    if (!open) return
    void load()
    adminApi.publicProfile<PublicProfileLite>().then((p) => setLogo(p?.logoData || null)).catch(() => setLogo(null))
  }, [open, load])

  // İmza bekleyen form varken yoklama: müşteri tablette imzalayınca bu ekran anında haber verir.
  const awaiting = useMemo(() => forms.filter((f) => consentStatusKey(f.status) === 'AwaitingSignature'), [forms])
  useEffect(() => {
    if (!open || awaiting.length === 0) return
    const timer = window.setInterval(async () => {
      try {
        const fresh = await consentApi.customerForms<ApiConsentForm>(customerId, tenantId)
        const list = Array.isArray(fresh) ? fresh : []
        const justSigned = awaiting.find((a) => list.some((f) => f.id === a.id && isSigned(f)))
        setForms(list)
        if (justSigned) {
          setSignedToast(justSigned.title || 'Onam formu')
          window.setTimeout(() => setSignedToast(null), 6000)
          void load()
          void onChanged?.()
        }
      } catch {
        // ağ hatası — bir sonraki turda yeniden dener
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, awaiting, customerId, tenantId, load, onChanged])

  const requirements = status?.requirements ?? []
  const missing = missingRequirements(status)

  const run = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusyId(id)
    setError('')
    try {
      await fn()
      await load()
      await onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusyId(null)
    }
  }

  /** Şablondan müşteri kaydı açar (yoksa) ve düzenleme panelini gösterir. */
  const openTemplate = async (templateId: string, serviceDefinitionId?: string | null): Promise<void> => {
    setBusyId(templateId)
    setError('')
    try {
      const existing = latestFormFor(forms, templateId)
      const form = existing && !isSigned(existing)
        ? existing
        : await consentApi.createForm<ApiConsentForm>(
          { customerId, templateId, appointmentId: appointmentId || null, serviceDefinitionId: serviceDefinitionId || null, staffNotes: null },
          tenantId,
        )
      setOpenForm(form)
      setNotes(form?.staffNotes || '')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Form açılamadı.')
    } finally {
      setBusyId(null)
    }
  }

  const sendToTablet = async (form: ApiConsentForm): Promise<void> => {
    if (!form.id) return
    const target = station.trim()
    if (!target) {
      setError('Önce tablet adı girin (ör. Kabin 1). Tablette de aynı ad tanımlı olmalı.')
      return
    }
    window.localStorage.setItem(STATION_KEY, target)
    await run(form.id, async () => {
      if (notes !== (form.staffNotes || '')) await consentApi.updateForm(form.id!, notes.trim() || null, tenantId)
      await consentApi.startSession(form.id!, target, undefined, tenantId)
      setOpenForm(null)
    })
  }

  const downloadPdf = (form: ApiConsentForm): void => {
    generateConsentPdf({
      institutionName,
      logoData: logo,
      title: form.title || 'Onam Formu',
      body: fillConsentPlaceholders(form.body || '', {
        customerName: form.customerName || customerName,
        serviceName: form.serviceName,
        institutionName,
        staffName: form.staffName,
        date: form.signedAtUtc ? new Date(form.signedAtUtc) : undefined,
      }),
      checkItems: form.checkItems,
      checkedItems: form.checkedItems,
      customerName: form.customerName || customerName,
      serviceName: form.serviceName,
      staffName: form.staffName,
      staffNotes: form.staffNotes,
      signatureImage: form.signatureImage,
      signedAt: form.signedAtUtc,
      signerName: form.signerName,
    })
  }

  if (!open) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[145] grid place-items-center bg-[#2b1620]/45 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-[#f3dde5] bg-white shadow-[0_44px_110px_-50px_rgba(120,71,88,0.7)]"
        >
          {/* Başlık */}
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f6e8ee] px-6 py-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#fff1f6] text-[#c85776]"><FileSignature className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="font-display text-xl leading-tight tracking-tight text-[#352432]">Onam Formları</div>
                <div className="mt-0.5 truncate text-[12.5px] text-[#705a66]">
                  {customerName || 'Müşteri'}
                  {status ? ` · ${status.signedCount ?? 0}/${status.requiredCount ?? 0} imzalı` : ''}
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff4f8] text-[#705a66] transition-colors hover:text-[#c85776]">
              <X className="h-4.5 w-4.5" />
            </button>
          </header>

          <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-5">
            {/* İmzalandı bildirimi */}
            <AnimatePresence>
              {signedToast && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3"
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div className="text-[13px] font-semibold text-emerald-800">Form imzalandı — {signedToast}</div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] font-medium text-rose-700">{error}</div>}

            {/* Özet */}
            {!loading && requirements.length > 0 && (
              <div className={`rounded-[14px] border px-4 py-3 ${missing.length === 0 ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
                <div className={`text-[13px] font-semibold ${missing.length === 0 ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {missing.length === 0
                    ? 'Bu işlem için gereken onam formlarının tamamı imzalı.'
                    : `${missing.length} onam formu eksik — işlem öncesi imzalanmalı.`}
                </div>
                {missing.length > 0 && (
                  <div className="mt-1 text-[12px] text-amber-900/80">{missing.map((m) => m.title).join(' · ')}</div>
                )}
              </div>
            )}

            {/* Gerekli formlar */}
            {loading ? (
              <div className="grid place-items-center py-14 text-[#705a66]"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : requirements.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[#ead8df] bg-[#fffafc] px-5 py-12 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]"><ClipboardList className="h-6 w-6" /></span>
                <div className="mt-3 text-[13.5px] font-semibold text-[#352432]">Bu işlem için tanımlı onam formu yok</div>
                <div className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-[#705a66]">
                  Hizmet formundan “Onam formları” bölümüne form bağlarsanız burada listelenir ve randevu
                  tamamlanmadan önce imza istenir.
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {requirements.map((req) => {
                  const form = latestFormFor(forms, req.templateId)
                  const key = consentStatusKey(form?.status)
                  const busy = busyId === req.templateId || (form?.id ? busyId === form.id : false)
                  return (
                    <div key={req.templateId} className="rounded-[16px] border border-[#ead8df] bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-semibold text-[#352432]">{req.title}</span>
                            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${key ? CONSENT_STATUS_TONE[key] : 'border-[#ead8df] bg-[#fffafc] text-[#705a66]'}`}>
                              {key ? CONSENT_STATUS_LABEL[key] : 'Alınmadı'}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] text-[#705a66]">
                            {req.serviceName ? `${req.serviceName} · ` : ''}
                            {form?.signedAtUtc
                              ? `İmza: ${new Date(form.signedAtUtc).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                              : key === 'AwaitingSignature'
                                ? `${form?.stationName || 'Tablet'} üzerinde imza bekleniyor…`
                                : 'Henüz imzalanmadı'}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {isSigned(form) ? (
                            <>
                              <button type="button" onClick={() => downloadPdf(form!)}
                                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-semibold text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                                <Download className="h-3.5 w-3.5" /> PDF indir
                              </button>
                              <button type="button" disabled={busy} onClick={() => void openTemplate(req.templateId!, req.serviceDefinitionId)}
                                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-medium text-[#705a66] transition-colors hover:text-[#c85776] disabled:opacity-50">
                                <RotateCcw className="h-3.5 w-3.5" /> Yeniden al
                              </button>
                            </>
                          ) : key === 'AwaitingSignature' && form?.id ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
                                <Tablet className="h-3.5 w-3.5" /> {form.stationName || 'Tablet'}
                              </span>
                              <button type="button" disabled={busy} onClick={() => void run(form.id!, () => consentApi.cancelSession(form.id!, tenantId))}
                                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-medium text-[#705a66] transition-colors hover:text-[#c85776] disabled:opacity-50">
                                Geri al
                              </button>
                            </>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => void openTemplate(req.templateId!, req.serviceDefinitionId)}
                              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />} Formu doldur
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Doldurma / tablete gönderme paneli */}
                      <AnimatePresence initial={false}>
                        {openForm && openForm.templateId === req.templateId && !isSigned(openForm) && (
                          <ConsentEditor
                            form={openForm}
                            institutionName={institutionName}
                            customerName={customerName}
                            notes={notes}
                            onNotesChange={setNotes}
                            station={station}
                            onStationChange={setStation}
                            busy={busyId === openForm.id}
                            onSend={() => void sendToTablet(openForm)}
                            onClose={() => setOpenForm(null)}
                          />
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Bu işlem dışındaki geçmiş imzalı formlar */}
            {forms.some((f) => isSigned(f) && !requirements.some((r) => r.templateId === f.templateId)) && (
              <div className="rounded-[16px] border border-[#ead8df] bg-[#fffafc] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-[#705a66]">Diğer imzalı formlar</div>
                <div className="mt-2 space-y-1.5">
                  {forms.filter((f) => isSigned(f) && !requirements.some((r) => r.templateId === f.templateId)).map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] text-[#4a3a44]">
                        {f.title}
                        {f.signedAtUtc ? ` · ${new Date(f.signedAtUtc).toLocaleDateString('tr-TR')}` : ''}
                      </span>
                      <button type="button" onClick={() => downloadPdf(f)} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#c85776] hover:underline">
                        <Download className="h-3.5 w-3.5" /> PDF
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  )
}

/**
 * Formu doldurma + tablete gönderme paneli.
 *
 * Ayrı bileşen: ana modalda `openForm` null olabildiği için JSX içinde her erişimde
 * daraltma (narrowing) kayboluyordu; burada `form` zorunlu prop olarak gelir.
 */
function ConsentEditor({
  form,
  institutionName,
  customerName,
  notes,
  onNotesChange,
  station,
  onStationChange,
  busy,
  onSend,
  onClose,
}: {
  form: ApiConsentForm
  institutionName: string
  customerName?: string | null
  notes: string
  onNotesChange: (value: string) => void
  station: string
  onStationChange: (value: string) => void
  busy: boolean
  onSend: () => void
  onClose: () => void
}) {
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="mt-4 space-y-3 border-t border-[#f6e8ee] pt-4">
        <div className="max-h-40 overflow-y-auto rounded-[12px] border border-[#f1e5ea] bg-[#fffafc] px-4 py-3">
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#4a3a44]">
            {fillConsentPlaceholders(form.body || '', {
              customerName: form.customerName || customerName,
              serviceName: form.serviceName,
              institutionName,
              staffName: form.staffName,
            })}
          </p>
        </div>

        {(form.checkItems?.length ?? 0) > 0 && (
          <div className="rounded-[12px] border border-[#f1e5ea] bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#b14d6c]">Müşteri onaylayacak</div>
            <ul className="mt-1.5 space-y-1">
              {(form.checkItems || []).map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] text-[#4a3a44]">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] border border-[#dcc2ce]" /> {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="text-[12px] font-semibold text-[#4a3a44]">
            Uygulama notu <span className="font-normal text-[#705a66]">(doz, bölge, uyarı…)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={2}
            placeholder="Örn. 3. seans, sol bacak, 18 J/cm²"
            className="mt-1.5 w-full rounded-[12px] border border-[#ead8df] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#c85776]"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label className="text-[12px] font-semibold text-[#4a3a44]">Tablet adı</label>
            <div className="relative mt-1.5">
              <MonitorSmartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#705a66]" />
              <input
                value={station}
                onChange={(e) => onStationChange(e.target.value)}
                placeholder="Kabin 1"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-10 py-2.5 text-[13px] outline-none focus:border-[#c85776]"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !station.trim()}
            onClick={onSend}
            className="inline-flex items-center gap-2 rounded-[12px] bg-[#c85776] px-5 py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tablet className="h-4 w-4" />} Tablete Aktar
          </button>
          <button type="button" onClick={onClose} className="rounded-[12px] border border-[#ead8df] bg-white px-4 py-3 text-[13px] font-medium text-[#4a3a44] hover:bg-[#fff4f8]">
            Kapat
          </button>
        </div>
        <p className="text-[11.5px] text-[#705a66]">
          Form tablette açılır; müşteri onay kutularını işaretleyip imzalayınca bu ekrana anında bildirim düşer.
        </p>
      </div>
    </motion.div>
  )
}
