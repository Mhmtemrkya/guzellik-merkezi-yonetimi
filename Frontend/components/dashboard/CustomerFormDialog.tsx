'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  User,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { downscaleImage } from '@/lib/imageUtils'
import type { CustomerGender } from '@/lib/types'

export interface CustomerFormValues {
  fullName?: string
  phone?: string
  email?: string
  birthDate?: string
  gender?: CustomerGender
  kvkkConsent?: boolean
  notes?: string
  photoUrl?: string
}

interface CustomerFormDialogProps {
  mode?: 'create' | 'edit'
  /** Düzenleme modunda mevcut değerler; oluşturmada varsayılanların üzerine yazılır */
  initial?: CustomerFormValues
  title?: string
  description?: string
  submitLabel?: string
  onSubmit: (values: CustomerFormValues) => void | Promise<void>
  /** Kontrollü açılış (oluşturma "Yeni müşteri" butonu için) */
  open?: boolean
  onOpenChange?: (next: boolean) => void
  /** Tetikleyici düğüm (DialogTrigger ile sarılır) */
  trigger?: ReactNode
}

const GENDER_OPTIONS: { value: CustomerGender; label: string }[] = [
  { value: 'Female', label: 'Kadın' },
  { value: 'Male', label: 'Erkek' },
  { value: 'Other', label: 'Diğer' },
  { value: 'Unspecified', label: 'Belirtmek istemiyor' },
]

const INPUT =
  'w-full rounded-[12px] border border-[#ead8df] bg-white px-3.5 py-3 text-[13.5px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40 placeholder:text-[#c9b3bd]'
const LABEL = 'mb-1.5 block text-[11px] font-semibold text-[#705a66]'

function initials(name: string): string {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return ''
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toLocaleUpperCase('tr-TR')
}

function emptyValues(): CustomerFormValues {
  return { fullName: '', phone: '', email: '', birthDate: '', gender: 'Female', kvkkConsent: false, notes: '', photoUrl: '' }
}

export default function CustomerFormDialog({
  mode = 'create',
  initial,
  title,
  description,
  submitLabel,
  onSubmit,
  open,
  onOpenChange,
  trigger,
}: CustomerFormDialogProps) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (next: boolean): void => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const [values, setValues] = useState<CustomerFormValues>(emptyValues())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)

  // Açılışta initial/varsayılan değerlere sıfırla
  useEffect(() => {
    if (isOpen) {
      setValues({ ...emptyValues(), ...(initial || {}) })
      setSaved(false)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const set = (patch: Partial<CustomerFormValues>): void => {
    setValues((c) => ({ ...c, ...patch }))
    setError('')
    setSaved(false)
  }

  const pickPhoto = async (file: File): Promise<void> => {
    setPhotoBusy(true)
    setError('')
    try {
      set({ photoUrl: await downscaleImage(file, 320) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel yüklenemedi.')
    } finally {
      setPhotoBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!values.fullName?.trim()) { setError('Ad soyad zorunludur.'); return }
    if (!values.phone?.trim()) { setError('Telefon zorunludur.'); return }
    setSaving(true)
    setError('')
    try {
      await onSubmit(values)
      setSaved(true)
      setTimeout(() => setOpen(false), 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt tamamlanamadı.')
    } finally {
      setSaving(false)
    }
  }

  const heading = title || (mode === 'edit' ? 'Müşteriyi Düzenle' : 'Yeni Müşteri')
  const sub = description || 'Bilgiler kaydedildikten sonra randevu, paket ve cari hesapta kullanılabilir.'
  const cta = submitLabel || (mode === 'edit' ? 'Müşteriyi güncelle' : 'Müşteri oluştur')
  const ini = initials(values.fullName || '')

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className="flex max-h-[92dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/90 bg-white p-0 text-[#352432] shadow-[0_40px_120px_-60px_rgba(120,71,88,0.7)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 860px)' }}
      >
        {/* Atmosfer */}
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#f0aac2]/20 blur-3xl" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(240,170,194,0.9) 40%, rgba(255,211,223,0.9) 60%, transparent)' }}
        />

        {/* HEADER */}
        <header className="relative flex shrink-0 items-start gap-4 border-b border-[#f2e6eb] p-6 pr-14 sm:px-8">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-[#efbfd0] bg-[#fff1f6] text-[#c85776] shadow-[0_14px_30px_-20px_rgba(200,87,118,0.9)]">
            {values.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={values.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : ini ? (
              <span className="font-display text-[15px] font-bold">{ini}</span>
            ) : (
              <UserPlus className="h-5 w-5" strokeWidth={1.7} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#c85776]">
              Müşteri · {mode === 'edit' ? 'Düzenle' : 'Yeni kayıt'}
            </div>
            <DialogTitle className="mt-0.5 font-display text-2xl font-bold tracking-tight text-[#241923]">{heading}</DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-relaxed text-[#705a66]">{sub}</DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Kapat"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-[#ead8df] bg-white text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* BODY */}
        <div className="relative min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="space-y-7">
            {/* Kimlik */}
            <Section icon={User} title="Kimlik">
              <div className="flex gap-4">
                <PhotoPicker value={values.photoUrl || ''} busy={photoBusy} onPick={pickPhoto} onClear={() => set({ photoUrl: '' })} />
                <div className="flex flex-1 flex-col gap-3">
                  <div>
                    <label className={LABEL}>Ad soyad *</label>
                    <input value={values.fullName || ''} onChange={(e) => set({ fullName: e.target.value })} placeholder="Örn. Ayşe Yılmaz" className={INPUT} />
                  </div>
                  <div>
                    <label className={LABEL}>Telefon *</label>
                    <div className="flex items-stretch overflow-hidden rounded-[12px] border border-[#ead8df] bg-white transition focus-within:border-[#ef9ab5] focus-within:ring-2 focus-within:ring-[#f4b6cb]/40">
                      <span className="grid place-items-center border-r border-[#ead8df] bg-[#fff7fa] px-3.5 text-[13.5px] font-semibold text-[#c85776]">+90</span>
                      <input value={values.phone || ''} onChange={(e) => set({ phone: e.target.value })} placeholder="5__ ___ __ __" className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[13.5px] text-[#352432] outline-none placeholder:text-[#c9b3bd]" />
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            {/* İletişim & demografi */}
            <Section icon={Mail} title="İletişim & demografi">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={LABEL}>E-posta</label>
                  <input type="email" value={values.email || ''} onChange={(e) => set({ email: e.target.value })} placeholder="opsiyonel" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Cinsiyet</label>
                  <select value={values.gender || 'Unspecified'} onChange={(e) => set({ gender: e.target.value as CustomerGender })} className={INPUT}>
                    {GENDER_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Doğum tarihi</label>
                  <input type="date" value={values.birthDate || ''} onChange={(e) => set({ birthDate: e.target.value })} className={INPUT} />
                </div>
              </div>
              <p className="mt-1.5 text-[10.5px] text-[#9d7386]">Doğum günü kampanyası bu alandan tetiklenir.</p>
            </Section>

            {/* Yasal & not */}
            <Section icon={ShieldCheck} title="Yasal & not">
              <button
                type="button"
                onClick={() => set({ kvkkConsent: !values.kvkkConsent })}
                className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-[#ead8df] bg-[#fffafc] px-3.5 py-3 text-left transition-colors hover:border-[#efbfd0]"
              >
                <span className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]"><ShieldCheck className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-[13px] font-semibold text-[#241923]">KVKK onayı alındı</span>
                    <span className="block text-[11px] text-[#705a66]">Müşteri aydınlatma metnini onayladı.</span>
                  </span>
                </span>
                <span className={`relative h-6 w-11 shrink-0 self-center rounded-full transition-colors ${values.kvkkConsent ? 'bg-gradient-to-r from-[#f47699] to-[#ef6088]' : 'bg-[#e7d6de]'}`}>
                  <motion.span animate={{ x: values.kvkkConsent ? 24 : 4 }} transition={{ type: 'spring', stiffness: 360, damping: 24 }} className="absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow-sm" />
                </span>
              </button>
              <div className="mt-3">
                <label className={LABEL}>Müşteri notu</label>
                <textarea rows={3} value={values.notes || ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Tercih, cilt tipi, alerji vb." className={`${INPUT} resize-none`} />
              </div>
            </Section>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#f2e6eb] bg-white/80 p-4 sm:px-8 sm:py-4">
          <span className="hidden text-[10px] font-mono uppercase tracking-[0.18em] text-[#9d7386] sm:inline">ESC ile kapat</span>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <button type="button" onClick={() => setOpen(false)} className="rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving || saved}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-[12px] font-semibold text-white shadow-[0_15px_26px_-15px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-70"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Kaydediliyor</>
              ) : saved ? (
                <><CheckCircle2 className="h-4 w-4" /> Kaydedildi</>
              ) : (
                <><Save className="h-4 w-4" /> {cta}</>
              )}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#c85776]">
          <Icon className="h-3.5 w-3.5" /> {title}
        </span>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-[#f0aac2]/45 to-transparent" />
      </div>
      {children}
    </div>
  )
}

function PhotoPicker({ value, busy, onPick, onClear }: { value: string; busy: boolean; onPick: (f: File) => void; onClear: () => void }) {
  return (
    <div className="shrink-0">
      <label title="Görsel yükle" className={`group relative grid h-[92px] w-[92px] cursor-pointer place-items-center overflow-hidden rounded-[14px] border border-dashed border-[#e7c9d4] bg-[#fff7fa] ${busy ? 'opacity-60' : ''}`}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[#c85776]">
            <ImagePlus className="h-5 w-5" />
            <span className="text-[10px] font-medium">Görsel seç</span>
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus className="h-5 w-5 text-white" />
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.target.value = ''
          }}
        />
      </label>
      {value && (
        <button type="button" onClick={onClear} className="mt-1.5 flex w-full items-center justify-center gap-1 text-[10px] font-medium text-rose-500 hover:text-rose-600">
          <X className="h-3 w-3" /> Kaldır
        </button>
      )}
    </div>
  )
}
