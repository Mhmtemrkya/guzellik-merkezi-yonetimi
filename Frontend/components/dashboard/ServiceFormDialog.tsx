'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  CreditCard,
  Gift,
  Layers3,
  Loader2,
  PenLine,
  Plus,
  Scissors,
  Sparkles,
  Tag,
  Timer,
  ToggleRight,
  Trash2,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CatalogStatusKey, CustomServiceCategory } from '@/lib/types'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'

const STATUS_OPTIONS: { value: CatalogStatusKey; label: string }[] = [
  { value: 'Active', label: 'Aktif (yayında)' },
  { value: 'Draft', label: 'Taslak' },
  { value: 'Passive', label: 'Pasif' },
  { value: 'Archived', label: 'Arşiv' },
]

// Standart kategoriler — kuruma özel olanlar bu listeye eklenir
const PREDEFINED_CATEGORIES = [
  'Lazer Epilasyon',
  'Cilt Bakımı',
  'Bölgesel İncelme',
  'Kaş & Kalıcı Makyaj',
  'Masaj',
  'Tırnak Bakımı',
] as const

// Predefined kategori ikonları (basit eşleme)
const categoryIcon = (name: string): LucideIcon => {
  const n = name.toLocaleLowerCase('tr-TR')
  if (n.includes('lazer') || n.includes('epilasyon')) return Zap
  if (n.includes('cilt') || n.includes('bakım')) return Sparkles
  return Layers3
}

const OTHER_SENTINEL = '__OTHER__'

export interface ServiceFormDialogValues {
  name: string
  category: string | null
  durationMinutes: number
  price: number
  /** Varsayılan seans sayısı — paket oluşturmada ön-dolum olarak çekilir. */
  defaultSessionCount: number
  /** Sadakat puanı karşılığı hediye maliyeti (0 = hediye edilemez). */
  loyaltyPointCost: number
  isActive: boolean
  iconKey: string
  status: CatalogStatusKey
}

export interface ServiceFormDialogProps {
  trigger: ReactNode
  customCategories: CustomServiceCategory[]
  onSubmit: (values: ServiceFormDialogValues) => Promise<void>
  /** Verilmezse (paket categories.service.custom içermiyorsa) özel kategori oluşturma UI gizlenir. */
  onCreateCustomCategory?: (name: string) => Promise<CustomServiceCategory | null>
  onDeleteCustomCategory?: (id: string) => Promise<void>
  initialValues?: Partial<ServiceFormDialogValues>
  title?: string
  submitLabel?: string
  /** "Düzenle" modunda iken bazı UX değişiklikleri */
  mode?: 'create' | 'edit'
}

const fieldStyle =
  'min-h-11 w-full rounded-[14px] border border-[#ead8df]/[0.80] bg-white/[0.88] px-3 py-2 text-sm text-[#352432] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors placeholder:text-[#8f7784]/[0.45] hover:border-[#efbfd0]/[0.85] focus:border-[#f0aac2]/[0.85] focus:bg-white focus:outline-none'

const labelStyle =
  'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]'

const helperStyle = 'mt-1 text-[10px] leading-relaxed text-[#352432]/[0.40]'

export default function ServiceFormDialog({
  trigger,
  customCategories,
  onSubmit,
  onCreateCustomCategory,
  onDeleteCustomCategory,
  initialValues,
  title = 'Yeni hizmet tanımla',
  submitLabel = 'Hizmeti oluştur',
  mode = 'create',
}: ServiceFormDialogProps) {
  const defaults: ServiceFormDialogValues = {
    name: '',
    category: 'Cilt Bakımı',
    durationMinutes: 60,
    price: 1500,
    defaultSessionCount: 1,
    loyaltyPointCost: 0,
    isActive: true,
    iconKey: '',
    status: 'Active',
  }
  const merged: ServiceFormDialogValues = { ...defaults, ...(initialValues || {}) }

  // Eğer initial category predefined ya da custom değilse Other olarak başla
  const initialIsKnown = (cat: string | null): boolean => {
    if (!cat) return false
    if ((PREDEFINED_CATEGORIES as readonly string[]).includes(cat)) return true
    return customCategories.some((c) => c.name === cat)
  }
  const startWithOther = Boolean(merged.category) && !initialIsKnown(merged.category)

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<ServiceFormDialogValues>(merged)
  const [showCustomList, setShowCustomList] = useState(startWithOther)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Custom category management
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState('')

  const initialSignature = JSON.stringify(merged)
  useEffect(() => {
    if (open) {
      setValues(merged)
      setSaved(false)
      setError('')
      setShowCustomList(Boolean(merged.category) && !initialIsKnown(merged.category))
      setNewCategoryName('')
      setCategoryError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

  const handleCreateCategory = async (): Promise<void> => {
    if (!onCreateCustomCategory) return
    const name = newCategoryName.trim()
    if (!name) {
      setCategoryError('Kategori adı boş olamaz.')
      return
    }
    setCreatingCategory(true)
    setCategoryError('')
    try {
      const created = await onCreateCustomCategory(name)
      if (created) {
        setValues((v) => ({ ...v, category: created.name }))
        setNewCategoryName('')
        setShowCustomList(true)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Kategori oluşturulamadı.'
      setCategoryError(msg)
    } finally {
      setCreatingCategory(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    setError('')
    setSaved(false)
    if (!values.name.trim()) {
      setError('Hizmet adı boş olamaz.')
      return
    }
    if (values.price < 0) {
      setError('Fiyat negatif olamaz.')
      return
    }
    if (values.durationMinutes <= 0) {
      setError('Süre pozitif olmalı.')
      return
    }
    if (showCustomList && !values.category) {
      setError('"Diğer" seçildi ama özel kategori seçmedin. Mevcut bir kategoriyi seç veya yenisini ekle.')
      return
    }
    setBusy(true)
    try {
      await onSubmit({ ...values, iconKey: values.iconKey || suggestIcon(values.name || values.category) })
      setSaved(true)
      setTimeout(() => setOpen(false), 900)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Kayıt başarısız.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const sortedCustomCategories = useMemo(
    () => [...customCategories].filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name, 'tr-TR')),
    [customCategories],
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex h-[94dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(94vw, 1180px)', maxWidth: 'min(94vw, 1180px)', height: '94dvh', maxHeight: '94dvh' }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.55, 0.85, 0.55] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0aac2]/[0.22] blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.04]" />

          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-5 pr-12 sm:p-6 sm:pr-14">
            <div className="flex items-start gap-4">
              <motion.span
                initial={{ scale: 0.85, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.4 }}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                <Wand2 className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/[0.80]">
                  ServiceDefinition · {mode === 'edit' ? 'PUT' : 'POST'}
                </div>
                <DialogTitle className="mt-1 font-display text-2xl tracking-tight">{title}</DialogTitle>
                <DialogDescription className="mt-2 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  Hizmet randevu oluşturma ekranında ve paket taslaklarında anında kullanılabilir hale gelir.
                  &quot;Diğer&quot; kategoriyi seçerek kuruma özel kategori ekleyebilir, ileride aynı kategoriyi tekrar
                  kullanabilirsin.
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.82] text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* BODY */}
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7 sm:py-7">
            <div className="space-y-5">
              {/* Hizmet adı */}
              <div>
                <label className={labelStyle}>
                  <Sparkles className="h-3 w-3" /> Hizmet adı
                </label>
                <input
                  type="text"
                  placeholder="Örn. Hydrafacial Cilt Bakımı"
                  value={values.name}
                  onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                />
              </div>

              {/* Hizmet ikonu */}
              <div>
                <label className={labelStyle}>
                  <Wand2 className="h-3 w-3" /> Hizmet ikonu
                  <span className="ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-[8px] border border-[#efbfd0]/70 bg-[#fff1f6] text-[#c85776]">
                    <ServiceIcon iconKey={values.iconKey || suggestIcon(values.name || values.category)} className="h-3.5 w-3.5" />
                  </span>
                </label>
                <div className="mt-2">
                  <IconPicker
                    value={values.iconKey || suggestIcon(values.name || values.category)}
                    onChange={(key) => setValues((v) => ({ ...v, iconKey: key }))}
                  />
                </div>
                <div className={helperStyle}>Hizmet listesinde, detayında ve randevuda bu ikon görünür</div>
              </div>

              {/* Kategori dropdown */}
              <div>
                <label className={labelStyle}>
                  <Tag className="h-3 w-3" /> Kategori
                </label>
                <select
                  value={showCustomList ? OTHER_SENTINEL : (values.category || '')}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === OTHER_SENTINEL) {
                      setShowCustomList(true)
                      // Eğer custom kategori daha önce seçili değilse temizle, ilk custom kategoriye fallback yapma
                      if (values.category && (PREDEFINED_CATEGORIES as readonly string[]).includes(values.category)) {
                        setValues((cur) => ({ ...cur, category: null }))
                      }
                    } else {
                      setShowCustomList(false)
                      setValues((cur) => ({ ...cur, category: v }))
                    }
                  }}
                  className={`mt-2 ${fieldStyle}`}
                >
                  <optgroup label="Standart kategoriler">
                    {PREDEFINED_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </optgroup>
                  <option value={OTHER_SENTINEL}>── Diğer (özel kategori)</option>
                </select>
                <div className={helperStyle}>Raporlarda hizmet gruplaması bu alana göre yapılır</div>
              </div>

              {/* "Diğer" seçilince → özel kategoriler */}
              <AnimatePresence>
                {showCustomList && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-[22px] border border-[#efbfd0]/[0.80] bg-white/[0.72] p-4 shadow-[0_18px_44px_-36px_rgba(200,87,118,0.5)]">
                      <div className="flex items-center justify-between">
                        <label className={labelStyle}>
                          <Sparkles className="h-3 w-3" /> Kuruma özel hizmet kategorileri
                        </label>
                        <span className="text-[9px] font-mono text-[#352432]/[0.40]">
                          {sortedCustomCategories.length} adet
                        </span>
                      </div>

                      {/* Özel kategori dropdown */}
                      <div className="mt-2 flex gap-2">
                        <select
                          value={values.category && sortedCustomCategories.some((c) => c.name === values.category) ? values.category : ''}
                          onChange={(e) => setValues((v) => ({ ...v, category: e.target.value || null }))}
                          className={`flex-1 ${fieldStyle}`}
                        >
                          <option value="">— Özel kategori seç —</option>
                          {sortedCustomCategories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {onDeleteCustomCategory && values.category && sortedCustomCategories.find((c) => c.name === values.category) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const target = sortedCustomCategories.find((c) => c.name === values.category)
                              if (!target || !onDeleteCustomCategory) return
                              try {
                                await onDeleteCustomCategory(target.id)
                                setValues((v) => ({ ...v, category: null }))
                              } catch (err: unknown) {
                                setCategoryError(err instanceof Error ? err.message : 'Silinemedi.')
                              }
                            }}
                            title="Seçili kategoriyi sil"
                            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-rose-50 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-rose-700 transition-colors hover:bg-rose-100/80"
                          >
                            <Trash2 className="h-3 w-3" />
                            Sil
                          </button>
                        )}
                      </div>

                      {/* Yeni kategori ekle — sadece paket categories.service.custom içeriyorsa */}
                      {onCreateCustomCategory && (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          placeholder="Yeni kategori adı yaz, Enter veya Ekle..."
                          maxLength={80}
                          value={newCategoryName}
                          onChange={(e) => {
                            setNewCategoryName(e.target.value)
                            setCategoryError('')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleCreateCategory()
                            }
                          }}
                          className={`flex-1 ${fieldStyle}`}
                        />
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={handleCreateCategory}
                          disabled={creatingCategory || !newCategoryName.trim()}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0]/[0.80] bg-[#fff2f6] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#fbe5eb] disabled:opacity-60"
                        >
                          {creatingCategory ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          Ekle
                        </motion.button>
                      </div>
                      )}
                      {categoryError && (
                        <div className="mt-2 text-[10px] text-rose-700">{categoryError}</div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Fiyat + Süre */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelStyle}>
                    <CreditCard className="h-3 w-3" /> Fiyat
                  </label>
                  <div className="relative mt-2">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-[#c85776]/[0.55]">
                      ₺
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={values.price}
                      onChange={(e) => setValues((v) => ({ ...v, price: Number(e.target.value) }))}
                      className={`${fieldStyle} pl-7`}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelStyle}>
                    <Timer className="h-3 w-3" /> Süre (dk)
                  </label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={values.durationMinutes}
                    onChange={(e) => setValues((v) => ({ ...v, durationMinutes: Number(e.target.value) }))}
                    className={`mt-2 ${fieldStyle}`}
                  />
                </div>
              </div>

              <div>
                <label className={labelStyle}>
                  <Timer className="h-3 w-3" /> Varsayılan seans sayısı
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={values.defaultSessionCount}
                  onChange={(e) => setValues((v) => ({ ...v, defaultSessionCount: Math.max(1, Number(e.target.value) || 1) }))}
                  className={`mt-2 ${fieldStyle}`}
                />
                <div className={helperStyle}>Paket oluştururken bu hizmet eklendiğinde seans sayısı bu değerle gelir; pakette düzenlenebilir.</div>
              </div>

              {/* Sadakat puanı (hediye) */}
              <div className="rounded-[18px] border border-amber-200/70 bg-amber-50/40 p-3.5">
                <label className={labelStyle}>
                  <Gift className="h-3 w-3" /> Sadakat puanı ile hediye
                </label>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-amber-600/70">
                    P
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={values.loyaltyPointCost || ''}
                    onChange={(e) => setValues((v) => ({ ...v, loyaltyPointCost: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    placeholder="0 = hediye edilemez"
                    className={`${fieldStyle} pl-7`}
                  />
                </div>
                <div className={helperStyle}>
                  {values.loyaltyPointCost > 0
                    ? `Adisyonda müşteri ${values.loyaltyPointCost} sadakat puanı karşılığında bu hizmeti hediye olarak alabilir.`
                    : 'Pozitif bir değer girersen bu hizmet adisyonda sadakat puanı karşılığı hediye olarak seçilebilir hale gelir.'}
                </div>
              </div>

              {/* Durum (Taslak / Aktif / Pasif / Arşiv) */}
              <div>
                <label className={labelStyle}>
                  <ToggleRight className="h-3 w-3" /> Yayın durumu
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setValues((v) => ({ ...v, status: opt.value, isActive: opt.value === 'Active' }))}
                      className={`rounded-[12px] border px-2 py-2 text-[11px] font-medium transition-colors ${
                        values.status === opt.value
                          ? 'border-[#c85776] bg-[#fff1f6] text-[#c85776]'
                          : 'border-[#ead8df]/[0.70] bg-white text-[#352432]/[0.6] hover:border-[#efbfd0]/[0.8]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className={helperStyle}>Taslak/Pasif/Arşiv hizmetler randevu listesinde gösterilmez</div>
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.75] bg-white/[0.78] px-5 py-4 shadow-[0_-18px_46px_-36px_rgba(120,71,88,0.45)] backdrop-blur-xl sm:px-7 sm:py-5">
            {error && (
              <div className="mb-3 border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
                <Scissors className="mr-1 inline h-3 w-3" />
                {values.category || 'Kategori seçilmedi'} · {values.durationMinutes}dk
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.72] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.65] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <motion.button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || saved}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] disabled:opacity-70"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  {saved && <CheckCircle2 className="h-3 w-3" />}
                  {!busy && !saved && <PenLine className="h-3 w-3" />}
                  {saved ? 'Kaydedildi' : submitLabel}
                </motion.button>
              </div>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
