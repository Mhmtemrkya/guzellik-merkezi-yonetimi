'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import {
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Loader2,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { downscaleImage } from '@/lib/imageUtils'
import { IconPicker } from '@/components/dashboard/ServiceIcons'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AdminOptionInput = string | { value?: string; label?: string; name?: string; id?: string }

export type AdminFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'time'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'textarea'
  | 'checkbox'
  | 'file'
  | 'image'
  | 'icon'
  | 'list'

export type AdminFieldValue = string | number | boolean | string[] | AdminListRow[]
export type AdminListRow = string | Record<string, string | number | boolean>

export interface AdminItemField {
  label: string
  name?: string
  type?: AdminFieldType
  options?: AdminOptionInput[]
  placeholder?: string
}

export interface AdminField {
  /** Display label above the input */
  label: string
  /** Form payload key. Defaults to label when omitted */
  name?: string
  type?: AdminFieldType
  value?: AdminFieldValue
  required?: boolean
  options?: AdminOptionInput[]
  accept?: string
  emptyLabel?: string
  rowLabel?: string
  itemFields?: AdminItemField[]
  itemPlaceholder?: string
  addLabel?: string
  placeholder?: string
  /** Optional icon shown left of the label */
  icon?: LucideIcon
  /** Helper text shown below the input */
  helper?: string
  /** Optional prefix (e.g. "₺", "+90") */
  prefix?: string
  /** Optional suffix (e.g. "dk", "%") */
  suffix?: string
  /** Make the field span 2 columns in the grid */
  fullWidth?: boolean
  /** Section group (rendered as a separator title) */
  section?: string
}

type AdminFormValues = Record<string, AdminFieldValue>

export interface AdminEditDialogProps {
  title: string
  description?: string
  /** Optional eyebrow shown above the title */
  eyebrow?: string
  /** Optional icon shown in the title block */
  titleIcon?: LucideIcon
  triggerLabel?: string
  triggerVariant?: 'primary' | 'ghost'
  triggerClassName?: string
  /** Trigger butonundaki ikon (varsayılan: PenLine) */
  triggerIcon?: LucideIcon
  fields?: AdminField[]
  note?: string
  submitLabel?: string
  successMessage?: string
  onSubmit?: (values: AdminFormValues) => void | Promise<void>
  /** Dialog genişliği — md varsayılan, lg geniş randevu/paket modalları için, xl maksimum */
  size?: 'md' | 'lg' | 'xl'
  /** Dialog dışarıdan kontrollü açılış için (props.open !== undefined => controlled) */
  open?: boolean
  onOpenChange?: (next: boolean) => void
  /** Trigger'ı tamamen gizler (controlled modda) */
  hideTrigger?: boolean
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const sectionContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
}

const sectionItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultValue(field: AdminField): AdminFieldValue {
  if (field.value !== undefined) return field.value
  if (field.type === 'multiselect') return field.options?.slice(0, 1).map(optionValue) || []
  if (field.type === 'select') return field.options?.[0] ? optionValue(field.options[0]) : ''
  if (field.type === 'textarea') return ''
  if (field.type === 'number') return 0
  if (field.type === 'checkbox') return false
  if (field.type === 'list') return []
  return ''
}

function emptyListItem(field: AdminField): AdminListRow {
  if (Array.isArray(field.itemFields) && field.itemFields.length) {
    return Object.fromEntries(
      field.itemFields.map((f): [string, string | number] => [f.name || f.label, f.type === 'number' ? 0 : '']),
    )
  }
  return ''
}

function optionLabel(option: AdminOptionInput | undefined | null): string {
  if (option === undefined || option === null) return ''
  return typeof option === 'string' ? option : option?.label || option?.name || option?.value || ''
}

function optionValue(option: AdminOptionInput | undefined | null): string {
  if (option === undefined || option === null) return ''
  return typeof option === 'string' ? option : option?.value || option?.id || option?.label || option?.name || ''
}

function isEmptyValue(value: AdminFieldValue | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => String(item ?? '').trim() === '')
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

function asString(value: AdminFieldValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : ''
  return ''
}

function asStringArray(value: AdminFieldValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  const arr = value as Array<string | AdminListRow>
  return arr.filter((item): item is string => typeof item === 'string')
}

function asListRows(value: AdminFieldValue | undefined): AdminListRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is AdminListRow => typeof item === 'string' || (typeof item === 'object' && item !== null),
  )
}

// ---------------------------------------------------------------------------
// Trigger button styles
// ---------------------------------------------------------------------------

const primaryTrigger =
  'group relative inline-flex min-h-10 w-full items-center justify-center gap-2 overflow-hidden bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] px-4 py-2 text-center text-[10px] font-mono uppercase tracking-widest text-[#2f1724] disabled:opacity-60 sm:w-auto sm:text-[11px]'

const ghostTrigger =
  'group relative inline-flex min-h-10 w-full items-center justify-center gap-2 overflow-hidden border border-[#ead8df]/[0.70] px-3 py-2 text-center text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.72] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] sm:w-auto'

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminEditDialog({
  title,
  description,
  eyebrow = 'Düzenleme modalı',
  titleIcon: TitleIcon = Sparkles,
  triggerLabel = 'Düzenle',
  triggerVariant = 'primary',
  triggerClassName = '',
  triggerIcon: TriggerIcon = PenLine,
  fields = [],
  note = 'Form canlı API işlemine bağlıdır; kaydettiğiniz değişiklikler backend\'e gönderilir.',
  submitLabel = 'Kaydet',
  successMessage,
  onSubmit,
  size = 'md',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: AdminEditDialogProps) {
  const resolvedSuccessMessage =
    successMessage ||
    (onSubmit ? 'Değişiklikler API\'ye kaydedildi.' : 'Form doğrulandı; backend modeli bağlandığında kaydedilecek.')

  const initialValuesSignature = JSON.stringify(
    fields.map((field) => [field.name || field.label, defaultValue(field)]),
  )
  const initialValues = useMemo<AdminFormValues>(
    () => Object.fromEntries(fields.map((field) => [field.name || field.label, defaultValue(field)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialValuesSignature],
  )

  const [internalOpen, setInternalOpen] = useState<boolean>(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean): void => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }
  const [values, setValues] = useState<AdminFormValues>(initialValues)
  const [saved, setSaved] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<string>('')

  // Group fields by section header
  const sectionedFields = useMemo(() => {
    const groups: Array<{ section: string | null; items: AdminField[] }> = []
    let current: { section: string | null; items: AdminField[] } | null = null
    fields.forEach((f) => {
      const sec = f.section || null
      if (!current || current.section !== sec) {
        current = { section: sec, items: [] }
        groups.push(current)
      }
      current.items.push(f)
    })
    return groups
  }, [fields])

  useEffect(() => {
    if (!open) {
      setValues(initialValues)
      setSaved(false)
      setSubmitError('')
    }
  }, [initialValues, open])

  const setField = (key: string, value: AdminFieldValue): void => {
    setSaved(false)
    setSubmitError('')
    setValues((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (): Promise<void> => {
    setSaving(true)
    setSubmitError('')
    setSaved(false)
    try {
      const missing = fields
        .filter((field) => field.required && isEmptyValue(values[field.name || field.label]))
        .map((field) => field.label)
      if (missing.length) {
        setSubmitError(`Zorunlu alanları doldurun: ${missing.join(', ')}`)
        return
      }
      if (onSubmit) await onSubmit(values)
      setSaved(true)
      setTimeout(() => setOpen(false), 1200)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Kayıt işlemi tamamlanamadı.'
      setSubmitError(message || 'Kayıt işlemi tamamlanamadı.')
    } finally {
      setSaving(false)
    }
  }

  const triggerCls = triggerVariant === 'ghost' ? ghostTrigger : primaryTrigger
  // Dialog'un sm:max-w-lg default'unu kırmak için inline style ile width + maxWidth veriyoruz.
  // Tüm modallar artık eskisinden ~%50 daha geniş — hizmet/paket gridleri, form grid'leri rahat sığsın.
  const widthPx =
    size === 'xl'
      ? 'min(98vw, 1640px)'
      : size === 'lg'
        ? 'min(96vw, 1400px)'
        : 'min(94vw, 1180px)'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setValues(initialValues)
          setSaved(false)
          setSubmitError('')
        }
      }}
    >
      {!hideTrigger && (
      <DialogTrigger asChild>
        <button className={`${triggerCls} ${triggerClassName}`}>
          {triggerVariant === 'primary' && (
            <span
              aria-hidden
              className="absolute inset-0 translate-y-full bg-white transition-transform duration-500 group-hover:translate-y-0"
            />
          )}
          {triggerVariant === 'ghost' && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#f0aac2]/[0.12] via-[#fff4f8]/[0.04] to-transparent transition-transform duration-500 group-hover:translate-x-0"
            />
          )}
          <TriggerIcon className="relative z-10 h-3.5 w-3.5 transition-colors group-hover:text-[#352432]" />
          <span className="relative z-10 transition-colors duration-500 group-hover:text-[#352432]">
            {triggerLabel}
          </span>
        </button>
      </DialogTrigger>
      )}

      <DialogContent
        className="flex h-[94dvh] grid-rows-none flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: widthPx, maxWidth: widthPx, height: '94dvh', maxHeight: '94dvh' }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.55, 0.95, 0.55] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0aac2]/[0.28] blur-3xl"
          />
          <motion.span
            aria-hidden
            animate={{ opacity: [0.4, 0.75, 0.4] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            className="pointer-events-none absolute -left-20 bottom-20 h-60 w-60 rounded-full bg-[#ffd3df]/[0.22] blur-3xl"
          />
          <motion.span
            aria-hidden
            animate={{ opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
            className="pointer-events-none absolute right-1/3 -bottom-12 h-44 w-72 rounded-full bg-[#d48aa7]/[0.16] blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.045]" />
          {/* Üstte altın hairline */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(240,170,194,0.95) 30%, rgba(255,211,223,0.95) 60%, transparent)',
            }}
          />

          {/* HEADER — kompakt, armo-shimmer başlık */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-4 pr-12 text-left sm:px-7 sm:py-4 sm:pr-14 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-3.5"
            >
              <motion.span
                whileHover={{ rotate: -8, scale: 1.06 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                <TitleIcon className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="armo-pill !text-[9px]">
                  <span className="armo-pill-dot" />
                  {eyebrow}
                </div>
                <DialogTitle className="armo-heading mt-1.5 break-words text-2xl tracking-tight lg:text-3xl">
                  <span className="armo-shimmer">{title}</span>
                </DialogTitle>
                {description && (
                  <DialogDescription className="mt-1.5 max-w-3xl text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                    {description}
                  </DialogDescription>
                )}
              </div>
            </motion.div>
          </header>

          {/* BODY — Sol özet (sadece lg+) + Sağ form */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full flex-col lg:flex-row">
              {/* SOL — Canlı form özeti. Mobil/tablet'te gizli (scroll bozulmasın), lg+ ekranlarda görünür. */}
              <aside className="relative hidden shrink-0 overflow-y-auto bg-gradient-to-b from-white/[0.80] to-[#fff0f5]/[0.82] p-5 lg:flex lg:w-[300px] lg:flex-col lg:border-r lg:border-[#ead8df]/[0.70] lg:p-6">
                <div className="armo-pill !text-[9px]">
                  <span className="armo-pill-dot" />
                  Form özeti
                </div>
                <div className="mt-3.5 space-y-1.5">
                  <FormSummary fields={fields} values={values} />
                </div>
              </aside>

              {/* SAĞ — Form alanları */}
              <div className="relative flex-1 overflow-y-auto overscroll-contain p-5 sm:p-7 lg:p-8">
                <motion.div variants={sectionContainer} initial="hidden" animate="visible" className="space-y-6">
                  {note && (
                    <div className="border border-[#efbfd0]/[0.75] bg-gradient-to-br from-[#f0aac2]/[0.10] via-[#fff4f8]/[0.02] to-transparent p-3 text-[11px] leading-relaxed text-[#352432]/[0.70]">
                      <Sparkles className="mr-1 inline h-3 w-3 text-[#c85776]" />
                      {note}
                    </div>
                  )}
                  {sectionedFields.map((group, gi) => (
                    <SectionBlock key={`section-${gi}-${group.section || 'main'}`} section={group.section}>
                      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${size === 'xl' || size === 'lg' ? 'lg:grid-cols-3' : ''}`}>
                        {group.items.map((field) => (
                          <FieldBlock
                            key={field.name || field.label}
                            field={field}
                            value={values[field.name || field.label]}
                            setField={setField}
                          />
                        ))}
                      </div>
                    </SectionBlock>
                  ))}

                  <AnimatePresence>
                    {submitError && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="border border-rose-300/30 bg-rose-400/12 p-3 text-[11px] leading-5 text-rose-700"
                      >
                        {submitError}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {saved && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                        className="flex items-center gap-2 border border-emerald-300/30 bg-emerald-400/10 p-3 text-[11px] font-mono uppercase tracking-widest text-emerald-700"
                      >
                        <CheckCircle2 className="h-4 w-4" /> {resolvedSuccessMessage}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>
          </div>

          {/* FOOTER — premium gradient submit */}
          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.75] bg-white/[0.78] p-4 shadow-[0_-18px_46px_-36px_rgba(120,71,88,0.45)] backdrop-blur-xl sm:px-7 sm:py-4 lg:px-10 lg:py-5">
            <div className="flex items-center justify-between gap-2">
              <span className="hidden items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.40] sm:inline-flex">
                <kbd className="border border-[#ead8df]/[0.70] bg-white/[0.78] px-1.5 py-0.5 text-[8.5px] tracking-normal text-[#352432]/[0.55]">
                  ESC
                </kbd>
                ile kapat
              </span>
              <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-11 border border-[#ead8df]/[0.70] bg-white/[0.72] px-5 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.72] transition-colors hover:border-[#efbfd0]/[0.75] hover:bg-[#f0aac2]/[0.08] hover:text-[#352432]"
                >
                  Vazgeç
                </button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ y: -1 }}
                  onClick={handleSubmit}
                  disabled={saving || saved}
                  className="group relative inline-flex min-h-11 items-center justify-center gap-2 overflow-hidden border border-[#efbfd0]/[0.75] bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] px-7 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#2f1724] shadow-[0_10px_28px_-8px_rgba(240,170,194,0.65)] transition-shadow disabled:opacity-70"
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 translate-y-full bg-white transition-transform duration-500 group-hover:translate-y-0"
                  />
                  <span className="relative z-10 flex items-center gap-2 transition-colors duration-500 group-hover:text-[#352432]">
                    {saving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Kaydediliyor
                      </>
                    ) : saved ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Kaydedildi
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" /> {submitLabel}
                      </>
                    )}
                  </span>
                </motion.button>
              </div>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// SectionBlock
// ---------------------------------------------------------------------------

function SectionBlock({ section, children }: { section: string | null; children: ReactNode }) {
  return (
    <motion.div variants={sectionItem}>
      {section && (
        <div className="mb-4 flex items-center gap-3">
          <span className="armo-pill !text-[9px]">
            <span className="armo-pill-dot" />
            {section}
          </span>
          <motion.span
            aria-hidden
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ originX: 0 }}
            className="block h-px flex-1 bg-gradient-to-r from-[#f0aac2]/[0.40] via-[#fff4f8]/[0.10] to-transparent"
          />
        </div>
      )}
      {children}
    </motion.div>
  )
}

/** Doldurulmuş field'ları sol özet panelde gösterir. Boş/false değerler atlanır. */
function FormSummary({
  fields,
  values,
}: {
  fields: AdminField[]
  values: Record<string, AdminFieldValue>
}) {
  const filled = fields
    .map((f) => {
      const k = f.name || f.label
      const v = values[k]
      if (v === undefined || v === null || v === '' || v === false) return null
      if (Array.isArray(v) && v.length === 0) return null
      return { field: f, value: v }
    })
    .filter(Boolean) as Array<{ field: AdminField; value: AdminFieldValue }>

  if (filled.length === 0) {
    return (
      <div className="border border-dashed border-[#ead8df]/[0.70] bg-[#fff4f8]/[0.012] p-4 text-center text-[11px] text-[#352432]/[0.35]">
        Form doldukça burada özet görünecek
      </div>
    )
  }

  return (
    <>
      {filled.slice(0, 14).map(({ field, value }, i) => {
        const Icon = field.icon
        let display = ''
        if (typeof value === 'boolean') display = value ? 'Açık' : 'Kapalı'
        else if (Array.isArray(value)) display = `${value.length} kayıt`
        else display = String(value)

        return (
          <motion.div
            key={field.name || field.label}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: i * 0.02 }}
            className="border border-[#ead8df]/[0.65] bg-white/[0.74] px-2.5 py-2"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.45]">
              {Icon && <Icon className="h-2.5 w-2.5" strokeWidth={1.7} />}
              {field.label}
            </div>
            <div className="mt-1 line-clamp-2 break-words text-[12px] leading-tight text-[#c85776]/[0.90]">
              {display}
            </div>
          </motion.div>
        )
      })}
      {filled.length > 14 && (
        <div className="pt-1 text-center text-[10px] font-mono text-[#352432]/[0.40]">
          +{filled.length - 14} alan daha
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// FieldBlock
// ---------------------------------------------------------------------------

interface FieldBlockProps {
  field: AdminField
  value: AdminFieldValue | undefined
  setField: (key: string, value: AdminFieldValue) => void
}

function FieldBlock({ field, value, setField }: FieldBlockProps) {
  const Icon = field.icon
  const fullWidth =
    field.fullWidth || field.type === 'textarea' || field.type === 'multiselect' || field.type === 'list'

  const commonInputCls =
    'min-h-11 w-full bg-white/[0.90] border border-[#ead8df]/[0.70] px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0]/[0.75] placeholder:text-[#352432]/[0.25]'

  return (
    <motion.label
      variants={sectionItem}
      className={`group min-w-0 ${fullWidth ? 'sm:col-span-2' : ''}`}
    >
      <div className="mb-2 flex items-center gap-2">
        {Icon && (
          <span className="grid h-5 w-5 place-items-center border border-[#efbfd0]/[0.75] bg-white text-[#c85776] text-[#c85776]">
            <Icon className="h-2.5 w-2.5" strokeWidth={1.8} />
          </span>
        )}
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.65] transition-colors group-focus-within:text-[#c85776]">
          {field.label}
          {field.required && (
            <span className="ml-1 text-rose-700" aria-hidden="true">
              *
            </span>
          )}
        </span>
      </div>

      <FieldControl field={field} value={value} setField={setField} commonInputCls={commonInputCls} />

      {field.helper && (
        <div className="mt-1.5 text-[10px] leading-relaxed text-[#352432]/[0.40]">{field.helper}</div>
      )}
    </motion.label>
  )
}

// ---------------------------------------------------------------------------
// FieldControl
// ---------------------------------------------------------------------------

interface FieldControlProps {
  field: AdminField
  value: AdminFieldValue | undefined
  setField: (key: string, value: AdminFieldValue) => void
  commonInputCls: string
}

function FieldControl({ field, value, setField, commonInputCls }: FieldControlProps) {
  const key = field.name || field.label

  if (field.type === 'textarea') {
    return (
      <textarea
        rows={4}
        value={asString(value)}
        onChange={(e) => setField(key, e.target.value)}
        placeholder={field.placeholder || ''}
        className={`${commonInputCls} resize-none`}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <div className="relative">
        <select
          value={asString(value)}
          onChange={(e) => setField(key, e.target.value)}
          className={`${commonInputCls} appearance-none pr-9`}
        >
          {(field.options || []).map((option) => (
            <option key={optionValue(option)} value={optionValue(option)}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/[0.45]"
          strokeWidth={1.6}
        />
      </div>
    )
  }

  if (field.type === 'multiselect') {
    return <MultiSelect field={field} value={asStringArray(value)} onChange={(next) => setField(key, next)} />
  }

  if (field.type === 'list') {
    return (
      <ListEditor
        field={field}
        rows={asListRows(value)}
        commonCls={commonInputCls}
        onChange={(next) => setField(key, next)}
      />
    )
  }

  if (field.type === 'checkbox') {
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => setField(key, !value)}
        className={`${commonInputCls} flex items-center justify-between text-left`}
      >
        <span className="text-[#352432]/[0.85]">{value ? 'Evet' : 'Hayır'}</span>
        <span
          className={`relative h-5 w-10 border transition-colors ${
            value ? 'border-[#f0aac2] bg-[#f0aac2]/[0.25]' : 'border-[#ead8df]/[0.70] bg-transparent'
          }`}
        >
          <motion.span
            animate={{ x: value ? 18 : 2, backgroundColor: value ? '#ffd3df' : '#fff4f8' }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
          />
        </span>
      </motion.button>
    )
  }

  if (field.type === 'file') {
    return (
      <input
        type="file"
        accept={field.accept || '.xlsx,.xls,.csv'}
        onChange={(e) => setField(key, e.target.files?.[0]?.name || '')}
        className={commonInputCls}
      />
    )
  }

  if (field.type === 'image') {
    return <ImageField value={asString(value)} onChange={(next) => setField(key, next)} />
  }

  if (field.type === 'icon') {
    return <IconPicker value={asString(value)} onChange={(next) => setField(key, next)} />
  }

  // text / email / tel / date / time / number
  if (field.prefix || field.suffix) {
    return (
      <div className="relative flex items-stretch border border-[#ead8df]/[0.70] bg-white/[0.90] transition-colors focus-within:border-[#efbfd0]/[0.75]">
        {field.prefix && (
          <span className="grid place-items-center border-r border-[#ead8df]/[0.70] bg-white/[0.72] px-3 text-[12px] font-mono text-[#c85776]">
            {field.prefix}
          </span>
        )}
        <input
          type={field.type || 'text'}
          value={asString(value)}
          onChange={(e) =>
            setField(key, field.type === 'number' ? Number(e.target.value || 0) : e.target.value)
          }
          placeholder={field.placeholder || ''}
          className="min-h-11 w-full bg-transparent px-3 py-2.5 text-[13px] text-[#352432] outline-none placeholder:text-[#352432]/[0.25]"
        />
        {field.suffix && (
          <span className="grid place-items-center border-l border-[#ead8df]/[0.70] bg-white/[0.72] px-3 text-[12px] font-mono text-[#c85776]">
            {field.suffix}
          </span>
        )}
      </div>
    )
  }

  return (
    <input
      type={field.type || 'text'}
      value={asString(value)}
      onChange={(e) => setField(key, field.type === 'number' ? Number(e.target.value || 0) : e.target.value)}
      placeholder={field.placeholder || ''}
      className={commonInputCls}
    />
  )
}

// ---------------------------------------------------------------------------
// ImageField — görsel yükleme (base64 data-URL, 320px'e küçültülür)
// ---------------------------------------------------------------------------

function ImageField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      onChange(await downscaleImage(file, 320))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel yüklenemedi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label
        title="Görsel yükle"
        className={`group relative grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-[#ead8df]/[0.70] bg-[#fff4f8]/[0.50] ${busy ? 'opacity-60' : ''}`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-5 w-5 text-[#c85776]/[0.55]" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/[0.40] opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus className="h-5 w-5 text-white" />
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = ''
          }}
        />
      </label>
      <div className="min-w-0 text-[11px] text-[#352432]/[0.55]">
        <div>{value ? 'Görseli değiştirmek için tıkla' : 'Görsel seç (kare, ≤320px)'}</div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-rose-600 hover:text-rose-700"
          >
            <X className="h-3 w-3" /> Kaldır
          </button>
        )}
        {error && <div className="mt-1 text-[10px] text-rose-600">{error}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MultiSelect
// ---------------------------------------------------------------------------

interface MultiSelectProps {
  field: AdminField
  value: string[]
  onChange: (next: string[]) => void
}

function MultiSelect({ field, value, onChange }: MultiSelectProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((option) => {
          const optValue = optionValue(option)
          const checked = value.includes(optValue)
          return (
            <motion.button
              key={optValue}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => onChange(checked ? value.filter((v) => v !== optValue) : [...value, optValue])}
              className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-widest transition-colors ${
                checked
                  ? 'border-[#f0aac2] bg-[#f0aac2]/[0.18] text-[#c85776]'
                  : 'border-[#ead8df]/[0.70] bg-white/[0.72] text-[#352432]/[0.55] hover:border-[#efbfd0]/[0.75] hover:text-[#352432]'
              }`}
            >
              {checked && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  className="h-1.5 w-1.5 rounded-full bg-[#f0aac2] shadow-[0_0_10px_rgba(240,170,194,0.7)]"
                />
              )}
              <span>{optionLabel(option)}</span>
            </motion.button>
          )
        })}
      </div>
      {value.length > 0 && (
        <div className="text-[10px] font-mono text-[#352432]/[0.45]">{value.length} öğe seçildi</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ListEditor
// ---------------------------------------------------------------------------

interface ListEditorProps {
  field: AdminField
  rows: AdminListRow[]
  commonCls: string
  onChange: (next: AdminListRow[]) => void
}

function ListEditor({ field, rows, commonCls, onChange }: ListEditorProps) {
  const itemFields = Array.isArray(field.itemFields) && field.itemFields.length ? field.itemFields : null
  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="border border-dashed border-[#ead8df]/[0.70] px-3 py-3 text-[11px] text-[#352432]/[0.40]">
            {field.emptyLabel || 'Henüz satır eklenmedi.'}
          </div>
        )}
        <AnimatePresence>
          {rows.map((row, rowIndex) => {
            const updateRow = (next: AdminListRow): void => {
              const list = [...rows]
              list[rowIndex] = next
              onChange(list)
            }
            const removeRow = (): void => {
              const list = [...rows]
              list.splice(rowIndex, 1)
              onChange(list)
            }
            return (
              <motion.div
                key={rowIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="border border-[#ead8df]/[0.70] bg-white/[0.72] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-[#c85776]/[0.65]">
                    {field.rowLabel ? `${field.rowLabel} ${rowIndex + 1}` : `Satır ${rowIndex + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={removeRow}
                    aria-label={`Satır ${rowIndex + 1} kaldır`}
                    className="inline-flex min-h-8 items-center gap-1.5 border border-rose-300/25 bg-rose-400/10 px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-rose-700 transition-colors hover:bg-rose-400/20"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.6} /> Kaldır
                  </button>
                </div>
                {itemFields ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {itemFields.map((sub) => {
                      const subKey = sub.name || sub.label
                      const rowObject = typeof row === 'object' ? row : {}
                      const rawValue = rowObject[subKey]
                      const subValue =
                        rawValue !== undefined && rawValue !== null
                          ? String(rawValue)
                          : sub.type === 'number'
                            ? '0'
                            : ''
                      const onSubChange = (next: string | number): void =>
                        updateRow({ ...rowObject, [subKey]: next })
                      return (
                        <label key={subKey} className={`min-w-0 ${sub.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                          <span className="block mb-1.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/[0.45]">
                            {sub.label}
                          </span>
                          {sub.type === 'select' ? (
                            <select
                              value={subValue}
                              onChange={(e) => onSubChange(e.target.value)}
                              className={commonCls}
                            >
                              {(sub.options || []).map((option) => (
                                <option key={optionValue(option)} value={optionValue(option)}>
                                  {optionLabel(option)}
                                </option>
                              ))}
                            </select>
                          ) : sub.type === 'textarea' ? (
                            <textarea
                              rows={2}
                              value={subValue}
                              onChange={(e) => onSubChange(e.target.value)}
                              className={`${commonCls} resize-none`}
                            />
                          ) : (
                            <input
                              type={sub.type || 'text'}
                              value={subValue}
                              onChange={(e) =>
                                onSubChange(sub.type === 'number' ? Number(e.target.value || 0) : e.target.value)
                              }
                              placeholder={sub.placeholder || ''}
                              className={commonCls}
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={typeof row === 'string' ? row : String(row ?? '')}
                    onChange={(e) => updateRow(e.target.value)}
                    placeholder={field.itemPlaceholder || ''}
                    aria-label={`${field.label} satırı ${rowIndex + 1}`}
                    className={commonCls}
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="button"
        onClick={() => onChange([...rows, emptyListItem(field)])}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-dashed border-[#efbfd0]/[0.75] bg-[#f0aac2]/[0.08] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#f0aac2]/[0.14] sm:w-auto"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> {field.addLabel || 'Satır ekle'}
      </motion.button>
    </div>
  )
}
