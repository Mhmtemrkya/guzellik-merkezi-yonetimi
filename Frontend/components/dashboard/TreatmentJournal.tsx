'use client'

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera, Plus, Trash2, X, Sparkles, ImageOff, CalendarDays, Loader2, CheckCircle2, Clock3,
} from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import { downscaleImage } from '@/lib/imageUtils'
import type { ApiTreatmentPhoto, TreatmentPhotoKind, PagedResult } from '@/lib/types'
import { useFeature } from '@/components/dashboard/FeatureContext'
import FeatureLockedCard from '@/components/dashboard/FeatureLockedCard'
import BeforeAfterSlider from './BeforeAfterSlider'

const KIND_META: Record<TreatmentPhotoKind, { label: string; badge: string; dot: string }> = {
  Before: { label: 'Önce', badge: 'border-[#efbfd0] bg-[#fff1f6] text-[#b14d6c]', dot: 'bg-[#c85776]' },
  After: { label: 'Sonra', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  Progress: { label: 'Süreç', badge: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
}

const KIND_ORDER: TreatmentPhotoKind[] = ['Before', 'After', 'Progress']

function fmtDate(iso?: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '' }
}

export default function TreatmentJournal({
  customerId,
  tenantId,
}: {
  customerId?: string
  tenantId?: string
}) {
  const { data, loading, reload } = useApiQuery<ApiTreatmentPhoto[]>(
    () => (customerId ? adminApi.treatmentPhotos<ApiTreatmentPhoto>(customerId, tenantId) : Promise.resolve([])),
    [customerId, tenantId],
    { initialData: [] },
  )
  const { data: servicesData } = useApiQuery<PagedResult<{ id?: string; name?: string }>>(
    () => adminApi.services<{ id?: string; name?: string }>(),
    [tenantId],
    { initialData: { items: [], total: 0, page: 1, pageSize: 100 } as PagedResult<{ id?: string; name?: string }> },
  )
  const services = servicesData?.items ?? []

  const photos = data ?? []
  const befores = useMemo(() => photos.filter((p) => p.kind === 'Before'), [photos])
  const afters = useMemo(() => photos.filter((p) => p.kind === 'After'), [photos])

  const [beforeId, setBeforeId] = useState<string | null>(null)
  const [afterId, setAfterId] = useState<string | null>(null)
  const selBefore = befores.find((p) => p.id === beforeId) ?? befores[0]
  const selAfter = afters.find((p) => p.id === afterId) ?? afters[0]
  const canCompare = Boolean(selBefore?.imageUrl && selAfter?.imageUrl)

  // --- Yükleme formu ---
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<string>('')
  const [kind, setKind] = useState<TreatmentPhotoKind>('Before')
  const [serviceId, setServiceId] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [takenDate, setTakenDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>('')
  const [pendingMsg, setPendingMsg] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const allowed = useFeature('clinical.beforeafter')

  if (!customerId) return null
  if (!allowed) return <FeatureLockedCard title="İşlem günlüğü · Önce / Sonra" message="Önce/sonra fotoğraf galerisi ve karşılaştırma paketinizde yok." />

  const resetForm = () => {
    setPreview(''); setNote(''); setServiceId(''); setKind('Before')
    setTakenDate(new Date().toISOString().slice(0, 10)); setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const onPickFile = async (file?: File) => {
    if (!file) return
    setError('')
    try { setPreview(await downscaleImage(file, 1080)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Görsel okunamadı.') }
  }

  const submit = async () => {
    if (!preview) { setError('Önce bir fotoğraf seçin.'); return }
    setBusy(true); setError(''); setPendingMsg('')
    try {
      const res = await adminApi.addTreatmentPhoto(customerId, {
        kind,
        imageUrl: preview,
        note: note.trim() || null,
        serviceDefinitionId: serviceId || null,
        takenAtUtc: new Date(takenDate + 'T12:00:00').toISOString(),
      }, tenantId)
      if (isPendingApprovalResult(res)) {
        setPendingMsg('Fotoğraf onaya gönderildi. Kurum yöneticisi onayladığında günlüğe eklenecek.')
        setOpen(false); resetForm()
      } else {
        resetForm(); setOpen(false)
        await reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fotoğraf eklenemedi.')
    } finally { setBusy(false) }
  }

  const remove = async (id?: string) => {
    if (!id) return
    if (!window.confirm('Bu fotoğraf günlükten silinsin mi?')) return
    try { await adminApi.deleteTreatmentPhoto(customerId, id, tenantId); await reload() } catch { /* sessiz */ }
  }

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/80 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <Camera className="h-3.5 w-3.5" /> İşlem günlüğü · Önce / Sonra
        </div>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setPendingMsg('') }}
          className="inline-flex items-center gap-1 rounded-lg border border-[#efbfd0] bg-[#fff1f6] px-2 py-1 text-[11px] font-semibold text-[#b14d6c] transition hover:bg-[#ffe3ec]"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {open ? 'Kapat' : 'Fotoğraf ekle'}
        </button>
      </div>

      {pendingMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
          <Clock3 className="h-3.5 w-3.5 shrink-0" /> {pendingMsg}
        </div>
      )}

      {/* Yükleme formu */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mb-4 overflow-hidden"
          >
            <div className="rounded-[16px] border border-[#f0e0e6] bg-[#fffafb] p-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-2 border-dashed border-[#efbfd0] bg-white text-[#c85776] transition hover:bg-[#fff1f6]"
                >
                  {preview ? (
                    <img src={preview} alt="önizleme" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-[10px] font-medium">
                      <Camera className="h-5 w-5" /> Seç
                    </div>
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {KIND_ORDER.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKind(k)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          kind === k ? KIND_META[k].badge : 'border-[#ead8df] bg-white text-[#352432]/55 hover:bg-[#fff1f6]'
                        }`}
                      >
                        {KIND_META[k].label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={serviceId}
                    onChange={(e) => setServiceId(e.target.value)}
                    className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                  >
                    <option value="">İlişkili hizmet (opsiyonel)</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={takenDate}
                    onChange={(e) => setTakenDate(e.target.value)}
                    className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                  />
                </div>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Not (opsiyonel) — ör. 3. seans, cihaz ayarı, gözlem…"
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
              />
              {error && <div className="mt-2 text-[11px] font-medium text-rose-600">{error}</div>}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={busy || !preview}
                  onClick={submit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#c85776] to-[#8e3f5b] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Günlüğe ekle
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Önce/Sonra karşılaştırma */}
      {canCompare && selBefore && selAfter && (
        <div className="mb-4">
          <BeforeAfterSlider beforeUrl={selBefore.imageUrl!} afterUrl={selAfter.imageUrl!} />
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wide text-[#352432]/40">
            <span>{fmtDate(selBefore.takenAtUtc)} → {fmtDate(selAfter.takenAtUtc)}</span>
            <span className="inline-flex items-center gap-1 text-[#b14d6c]"><CheckCircle2 className="h-3 w-3" /> sürükleyerek karşılaştır</span>
          </div>
          {(befores.length > 1 || afters.length > 1) && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <PickRow label="Önce" items={befores} selectedId={selBefore.id} onPick={setBeforeId} />
              <PickRow label="Sonra" items={afters} selectedId={selAfter.id} onPick={setAfterId} />
            </div>
          )}
        </div>
      )}

      {/* Galeri */}
      {loading && photos.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-[#352432]/40">Yükleniyor…</div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <ImageOff className="h-6 w-6 text-[#efbfd0]" />
          <div className="text-[12px] font-medium text-[#352432]/55">Henüz fotoğraf yok</div>
          <div className="text-[10.5px] text-[#352432]/40">Önce/sonra ekleyince burada görünür ve karşılaştırma açılır.</div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, idx) => {
            const meta = KIND_META[p.kind ?? 'Progress']
            return (
              <motion.div
                key={p.id ?? idx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.4) }}
                className="group relative overflow-hidden rounded-[12px] border border-[#f0e0e6] bg-[#fffafb]"
              >
                <div className="aspect-square w-full overflow-hidden">
                  <img src={p.imageUrl} alt={meta.label} className="h-full w-full object-cover transition group-hover:scale-105" />
                </div>
                <span className={`absolute left-1 top-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${meta.badge}`}>
                  {meta.label}
                </span>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition group-hover:opacity-100 hover:bg-rose-600"
                  aria-label="Sil"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <div className="px-1.5 py-1">
                  <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide text-[#352432]/40">
                    <CalendarDays className="h-2.5 w-2.5" /> {fmtDate(p.takenAtUtc)}
                  </div>
                  {p.serviceName && <div className="truncate text-[10px] font-medium text-[#352432]/70">{p.serviceName}</div>}
                  {p.note && <div className="truncate text-[9.5px] text-[#352432]/45">{p.note}</div>}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PickRow({
  label, items, selectedId, onPick,
}: {
  label: string
  items: ApiTreatmentPhoto[]
  selectedId?: string
  onPick: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/35">{label}</div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => p.id && onPick(p.id)}
            className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 transition ${
              p.id === selectedId ? 'border-[#c85776]' : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
