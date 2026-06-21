'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ClipboardList, ShieldAlert, AlertTriangle, ShieldCheck, Pencil, Check, X, Loader2, Clock3, CalendarClock, Lock, Plus, Star,
} from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import FeatureLockedCard from '@/components/dashboard/FeatureLockedCard'
import {
  CONSULTATION_FLAGS, SKIN_TYPE_OPTIONS, deriveConsultationWarnings, type ConsultationFlagKey,
} from '@/lib/consultation'
import type { ApiConsultationForm, ApiConsultationOption } from '@/lib/types'

const TEXT_FIELDS: { key: 'complaint' | 'allergies' | 'medications' | 'chronicConditions' | 'notes'; label: string; placeholder: string }[] = [
  { key: 'complaint', label: 'Şikayet / talep', placeholder: 'Müşterinin başvuru nedeni…' },
  { key: 'allergies', label: 'Alerjiler', placeholder: 'Bilinen alerjiler…' },
  { key: 'medications', label: 'Kullanılan ilaçlar', placeholder: 'Düzenli ilaçlar…' },
  { key: 'chronicConditions', label: 'Kronik rahatsızlıklar', placeholder: 'Tansiyon, tiroid, kalp…' },
  { key: 'notes', label: 'Ek notlar', placeholder: 'Gözlem / plan…' },
]

function emptyForm(): ApiConsultationForm {
  return {
    isPregnant: false, isBreastfeeding: false, hasPacemakerOrImplant: false, hasEpilepsy: false,
    hasDiabetes: false, hasCancerHistory: false, usesBloodThinners: false, usedIsotretinoin: false,
    hasKeloidTendency: false, hasActiveSkinIssue: false, recentSunExposure: false,
    skinType: 'Unknown', allergies: '', medications: '', chronicConditions: '', complaint: '', notes: '',
    consentGiven: false, customSelections: [],
  }
}

/** Özel seçeneklerde büyük/küçük harf duyarsız tekilleştirme. */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = (raw || '').trim()
    if (!label) continue
    const key = label.toLocaleLowerCase('tr-TR')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '' }
}

export default function ConsultationForm({ customerId, tenantId, branchId }: { customerId?: string; tenantId?: string; branchId?: string | null }) {
  const { user } = useAuth()
  const { data: form, loading, reload } = useApiQuery<ApiConsultationForm | null>(
    () => (customerId ? adminApi.consultation<ApiConsultationForm>(customerId, tenantId) : Promise.resolve(null)),
    [customerId, tenantId],
    { initialData: null },
  )

  // "Özel" bölümü için kuruma/şubeye özel seçenek kütüphanesi.
  const { data: optionsData, reload: reloadOptions } = useApiQuery<ApiConsultationOption[]>(
    () => adminApi.consultationOptions<ApiConsultationOption>(branchId ?? undefined, tenantId),
    [tenantId, branchId],
    { initialData: [] },
  )
  const libraryOptions = optionsData ?? []

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ApiConsultationForm>(emptyForm())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingMsg, setPendingMsg] = useState('')
  const [newOption, setNewOption] = useState('')

  const warnings = useMemo(() => deriveConsultationWarnings(editing ? draft : form ?? {}), [editing, draft, form])
  const highCount = warnings.filter((w) => w.severity === 'high').length
  const allowed = useFeature('clinical.consultation')
  // Özel checkbox/seçenek OLUŞTURMA ayrı bir paket özelliği — kapalıysa "ekle" girişi gizlenir,
  // mevcut özel seçenekler yine işaretlenebilir.
  const customFieldsAllowed = useFeature('clinical.customfields')

  if (!customerId) return null
  if (!allowed) return <FeatureLockedCard title="Müşteri Bilgi ve Onay Formu" message="Müşteri bilgi formu ve işlem uygunluğu uyarıları paketinizde yok." />

  const startEdit = () => {
    setDraft(form ? { ...emptyForm(), ...form } : emptyForm())
    setError(''); setPendingMsg(''); setNewOption(''); setEditing(true)
  }

  // --- "Özel" bölümü yardımcıları ---
  const selectedCustom = draft.customSelections ?? []
  const isSelected = (label: string) => selectedCustom.some((x) => x.toLocaleLowerCase('tr-TR') === label.toLocaleLowerCase('tr-TR'))
  // Gösterilecek seçenekler: kütüphane + bu formda işaretli ama kütüphanede olmayanlar (silinmiş olabilir).
  const customOptionLabels = uniqueLabels([...libraryOptions.map((o) => o.label || ''), ...selectedCustom])
  const optionByLabel = (label: string) => libraryOptions.find((o) => (o.label || '').toLocaleLowerCase('tr-TR') === label.toLocaleLowerCase('tr-TR'))

  const toggleCustom = (label: string) => setDraft((d) => {
    const cur = d.customSelections ?? []
    return { ...d, customSelections: isSelected(label) ? cur.filter((x) => x.toLocaleLowerCase('tr-TR') !== label.toLocaleLowerCase('tr-TR')) : [...cur, label] }
  })

  const addCustom = () => {
    const label = newOption.trim()
    if (!label) return
    setDraft((d) => {
      const cur = d.customSelections ?? []
      if (cur.some((x) => x.toLocaleLowerCase('tr-TR') === label.toLocaleLowerCase('tr-TR'))) return d
      return { ...d, customSelections: [...cur, label] }
    })
    setNewOption('')
  }

  // Seçeneği formdan kaldırır; kütüphane seçeneğiyse kütüphaneden de siler (kalıcı).
  const removeOption = async (label: string) => {
    setDraft((d) => ({ ...d, customSelections: (d.customSelections ?? []).filter((x) => x.toLocaleLowerCase('tr-TR') !== label.toLocaleLowerCase('tr-TR')) }))
    const opt = optionByLabel(label)
    if (opt?.id) {
      try { await adminApi.deleteConsultationOption(opt.id, tenantId); await reloadOptions() } catch { /* sessizce geç */ }
    }
  }

  const save = async () => {
    setBusy(true); setError('')
    try {
      const body = { ...draft, filledByName: draft.filledByName || user?.fullName || user?.email || null }
      const res = await adminApi.upsertConsultation(customerId, body as Record<string, unknown>, tenantId)
      if (isPendingApprovalResult(res)) {
        setPendingMsg('Müşteri bilgi formu onaya gönderildi. Kurum yöneticisi onaylayınca kaydedilecek.')
        setEditing(false)
      } else {
        setEditing(false); await reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Form kaydedilemedi.')
    } finally { setBusy(false) }
  }

  const hasForm = Boolean(form?.id)
  const markedFlags = CONSULTATION_FLAGS.filter((fl) => (form as Record<string, unknown> | null)?.[fl.key])
  const skinLabel = SKIN_TYPE_OPTIONS.find((s) => s.value === (form?.skinType ?? 'Unknown'))?.label

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/80 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <ClipboardList className="h-3.5 w-3.5" /> Müşteri Bilgi ve Onay Formu
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-lg border border-[#efbfd0] bg-[#fff1f6] px-2 py-1 text-[11px] font-semibold text-[#b14d6c] transition hover:bg-[#ffe3ec]"
          >
            <Pencil className="h-3.5 w-3.5" /> {hasForm ? 'Düzenle' : 'Form oluştur'}
          </button>
        )}
      </div>

      {pendingMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
          <Clock3 className="h-3.5 w-3.5 shrink-0" /> {pendingMsg}
        </div>
      )}

      {/* İşlem uygunluğu uyarıları — her zaman üstte, belirgin */}
      {warnings.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-600">
            <ShieldAlert className="h-4 w-4" /> İşlem uygunluğu uyarıları ({warnings.length}{highCount > 0 ? ` · ${highCount} yüksek` : ''})
          </div>
          {warnings.map((w) => (
            <motion.div
              key={w.title}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] ${
                w.severity === 'high' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-semibold">{w.title}:</span> {w.detail}</span>
            </motion.div>
          ))}
        </div>
      ) : (hasForm || editing) ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] font-medium text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Belirgin işlem uygunluğu uyarısı yok.
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {/* İşlem uygunluğu seçimleri */}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {CONSULTATION_FLAGS.map((fl) => {
                const checked = Boolean(draft[fl.key as ConsultationFlagKey])
                return (
                  <button
                    key={fl.key}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, [fl.key]: !checked }))}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] font-medium transition ${
                      checked ? 'border-[#c85776] bg-[#fff1f6] text-[#b14d6c]' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fffafb]'
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#cdb8c1] bg-white'}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    {fl.label}
                  </button>
                )
              })}
            </div>

            {/* Özel — kuruma/şubeye özel işaretlenebilir seçenekler */}
            <div className="rounded-lg border border-[#efbfd0]/70 bg-[#fffafb] p-2.5">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/80">
                <Star className="h-3 w-3" /> Özel
                <span className="font-sans normal-case tracking-normal text-[#352432]/40">· kuruma/şubeye özel seçenekler</span>
              </div>

              {customOptionLabels.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {customOptionLabels.map((label) => {
                    const checked = isSelected(label)
                    return (
                      <div
                        key={label}
                        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition ${
                          checked ? 'border-[#c85776] bg-[#fff1f6] text-[#b14d6c]' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fffafb]'
                        }`}
                      >
                        <button type="button" onClick={() => toggleCustom(label)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#cdb8c1] bg-white'}`}>
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          <span className="truncate">{label}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOption(label)}
                          aria-label={`${label} seçeneğini kaldır`}
                          title="Seçeneği kaldır"
                          className="shrink-0 rounded p-0.5 text-[#352432]/30 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Inline ekleme — yalnızca "özel alan" paket özelliği açıksa */}
              {customFieldsAllowed ? (
                <>
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                      placeholder="Özel seçenek ekle (ör. Botoks geçmişi)…"
                      className="min-w-0 flex-1 rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                    />
                    <button
                      type="button"
                      onClick={addCustom}
                      disabled={!newOption.trim()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1.5 text-[11px] font-semibold text-[#b14d6c] transition hover:bg-[#ffe3ec] disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" /> Ekle
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-[#352432]/40">Eklenen seçenek bu kuruma/şubeye kaydedilir; sonraki müşterilerde hazır checkbox olarak çıkar.</div>
                </>
              ) : (
                <div className="mt-2 text-[10px] text-[#352432]/40">Özel seçenek ekleme paketinizde yok — mevcut seçenekleri işaretleyebilirsiniz.</div>
              )}
            </div>

            {/* Cilt tipi */}
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Cilt tipi (Fitzpatrick)</label>
              <select
                value={draft.skinType ?? 'Unknown'}
                onChange={(e) => setDraft((d) => ({ ...d, skinType: e.target.value as ApiConsultationForm['skinType'] }))}
                className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
              >
                {SKIN_TYPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Serbest metinler */}
            {TEXT_FIELDS.map((tf) => (
              <div key={tf.key}>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{tf.label}</label>
                <textarea
                  value={(draft[tf.key] as string) ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [tf.key]: e.target.value }))}
                  placeholder={tf.placeholder}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                />
              </div>
            ))}

            {/* Onam */}
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, consentGiven: !d.consentGiven }))}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11.5px] font-medium transition ${
                draft.consentGiven ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#ead8df] bg-white text-[#352432]/65'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${draft.consentGiven ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[#cdb8c1] bg-white'}`}>
                {draft.consentGiven && <Check className="h-3 w-3" />}
              </span>
              Müşteri bilgilendirildi ve onam/rıza alındı (KVKK + işlem onamı).
            </button>

            {error && <div className="text-[11px] font-medium text-rose-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-lg border border-[#ead8df] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#352432]/60 transition hover:bg-[#fffafb]">
                <X className="h-3.5 w-3.5" /> İptal
              </button>
              <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#c85776] to-[#8e3f5b] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Kaydet
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {loading && !hasForm ? (
              <div className="py-4 text-center text-[11px] text-[#352432]/40">Yükleniyor…</div>
            ) : !hasForm ? (
              <div className="py-4 text-center text-[11px] text-[#352432]/45">
                Henüz müşteri bilgi formu yok. İşlem öncesi müşteri beyanları ve onay için <span className="font-semibold text-[#b14d6c]">Form oluştur</span>’a dokunun.
              </div>
            ) : (
              <div className="space-y-2.5">
                {markedFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {markedFlags.map((fl) => (
                      <span key={fl.key} className="rounded-md border border-[#efbfd0] bg-[#fff1f6] px-2 py-0.5 text-[10.5px] font-medium text-[#b14d6c]">{fl.label}</span>
                    ))}
                  </div>
                )}
                {(form?.customSelections?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/35"><Star className="h-2.5 w-2.5" /> Özel</span>
                    {form!.customSelections!.map((label) => (
                      <span key={label} className="rounded-md border border-[#efbfd0] bg-[#fff7fa] px-2 py-0.5 text-[10.5px] font-medium text-[#b14d6c]">{label}</span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-1.5 text-[11.5px] sm:grid-cols-2">
                  {skinLabel && skinLabel !== SKIN_TYPE_OPTIONS[0].label && <Field label="Cilt tipi" value={skinLabel} />}
                  {form?.complaint && <Field label="Şikayet / talep" value={form.complaint} />}
                  {form?.allergies && <Field label="Alerjiler" value={form.allergies} />}
                  {form?.medications && <Field label="İlaçlar" value={form.medications} />}
                  {form?.chronicConditions && <Field label="Kronik" value={form.chronicConditions} />}
                  {form?.notes && <Field label="Notlar" value={form.notes} />}
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-[#f0e0e6] pt-2 text-[10px] text-[#352432]/45">
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${form?.consentGiven ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {form?.consentGiven ? <><ShieldCheck className="h-3 w-3" /> Onam alındı</> : <><AlertTriangle className="h-3 w-3" /> Onam yok</>}
                  </span>
                  {form?.filledByName && <span>· {form.filledByName}</span>}
                  {(form?.updatedAtUtc || form?.takenAtUtc) && (
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {fmtDate(form?.updatedAtUtc || form?.takenAtUtc)}</span>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#f0e0e6] bg-[#fffafb] px-2.5 py-1.5">
      <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/35">{label}</div>
      <div className="text-[11.5px] text-[#352432]/75">{value}</div>
    </div>
  )
}
