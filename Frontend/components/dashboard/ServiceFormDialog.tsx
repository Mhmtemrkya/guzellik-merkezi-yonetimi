'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Gift,
  Loader2,
  Plus,
  Repeat,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { CatalogStatusKey, CustomServiceCategory } from '@/lib/types'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'

const STATUS_OPTIONS: { value: CatalogStatusKey; label: string }[] = [
  { value: 'Active', label: 'Aktif' },
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

const OTHER_SENTINEL = '__OTHER__'

export interface ServiceFormDialogValues {
  name: string
  category: string | null
  subCategory: string | null
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
  'w-full rounded-[14px] border border-[#efe1e7] bg-white px-4 py-3 text-[14px] text-[#4a3a44] outline-none transition focus:border-[#c85776] focus:ring-2 focus:ring-[#c85776]/20 placeholder:text-[#705a66]/50'
const labelStyle = 'text-[13px] font-medium text-[#241923]'
const helperStyle = 'text-[12px] text-[#705a66]'

export default function ServiceFormDialog({
  trigger,
  customCategories,
  onSubmit,
  onCreateCustomCategory,
  onDeleteCustomCategory,
  initialValues,
  title = 'Yeni Hizmet Tanımla',
  submitLabel = 'Hizmeti oluştur',
  mode = 'create',
}: ServiceFormDialogProps) {
  const defaults: ServiceFormDialogValues = {
    name: '',
    category: 'Cilt Bakımı',
    subCategory: null,
    durationMinutes: 60,
    price: 1500,
    defaultSessionCount: 1,
    loyaltyPointCost: 0,
    isActive: true,
    iconKey: '',
    status: 'Active',
  }
  const merged: ServiceFormDialogValues = { ...defaults, ...(initialValues || {}) }

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
      setCategoryError(e instanceof Error ? e.message : 'Kategori oluşturulamadı.')
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
      setError(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const sortedCustomCategories = useMemo(
    () => [...customCategories].filter((c) => c.isActive).sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'tr-TR')),
    [customCategories],
  )

  // Seçili üst kategorinin alt kategorileri (öneri). Üst kategori özel kayıtsa parentId ile eşleşir;
  // standart kategoride tüm alt kategoriler önerilir.
  const parentCategoryId = useMemo(
    () => customCategories.find((c) => !c.parentId && c.name === values.category)?.id ?? null,
    [customCategories, values.category],
  )
  const subCategoryOptions = useMemo(
    () => customCategories
      .filter((c) => c.isActive && c.parentId && (!parentCategoryId || c.parentId === parentCategoryId))
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'tr'))
      .map((c) => c.name),
    [customCategories, parentCategoryId],
  )

  const previewIcon = values.iconKey || suggestIcon(values.name || values.category)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[28px] border border-[#efe1e7] bg-white p-0 text-[#4a3a44] shadow-[0_44px_120px_-60px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1152px)', height: 'min(92dvh, 900px)', maxHeight: '92dvh' }}
      >
        {/* HEADER */}
        <header className="flex shrink-0 items-start justify-between border-b border-[#efe1e7] bg-white px-6 py-6 sm:px-8">
          <div className="flex items-center gap-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#f0aac2] bg-[#f7ecf1] text-[#c85776]">
              <Sparkles className="h-5 w-5" strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <div className="mb-1 font-mono text-[12px] uppercase tracking-widest text-[#705a66]">
                HİZMET · {mode === 'edit' ? 'DÜZENLE' : 'YENİ TANIM'}
              </div>
              <DialogTitle className="mb-1 font-display text-[28px] leading-tight text-[#241923] sm:text-3xl">{title}</DialogTitle>
              <DialogDescription className="text-[13px] text-[#705a66]">
                Hizmet, randevu ve paket akışında anında kullanılabilir.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Kapat"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f7ecf1] text-[#705a66] transition-colors hover:bg-[#ffd3df]/40 hover:text-[#c85776]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* BODY — iki sütun */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* SOL — önizleme + ikon seçimi (krem). Sütun bütün olarak kayar: üstte kart + ikonların başı görünür, aşağı kaydırınca tüm ikonlar gelir. */}
          <div className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-[#efe1e7] bg-[#f7ecf1] p-6 sm:p-8 md:w-[38%] md:border-b-0 md:border-r">
            {/* Canlı önizleme kartı */}
            <div className="relative flex shrink-0 flex-col items-center overflow-hidden rounded-2xl border border-[#efe1e7]/60 bg-white p-5 text-center shadow-[0_4px_12px_-8px_rgba(200,87,118,0.3)]">
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/40 to-transparent" />
              <motion.div
                key={previewIcon}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                className="relative z-10 mb-5 flex h-20 w-20 items-center justify-center rounded-full text-white shadow-[0_8px_24px_-12px_rgba(184,137,56,0.45)]"
                style={{ backgroundImage: 'linear-gradient(135deg, #f0aac2 0%, #e9a6bf 50%, #d9a441 100%)' }}
              >
                <ServiceIcon iconKey={previewIcon} className="h-10 w-10" strokeWidth={1.7} />
              </motion.div>
              <div className="relative z-10 mb-3 rounded-full bg-[#ffd3df]/50 px-3 py-1 font-mono text-[10px] tracking-wider text-[#c85776]">
                {values.category || 'Kategori'}
              </div>
              <h3 className="relative z-10 mb-4 px-2 font-display text-xl text-[#241923]">{values.name.trim() || 'Hizmet adı'}</h3>
              <div className="relative z-10 mt-auto flex w-full items-center justify-center gap-4 border-t border-[#efe1e7] pt-4 text-[13px] font-medium text-[#4a3a44]">
                <span className="flex items-center gap-1.5"><Clock className="h-[18px] w-[18px] text-[#705a66]" /> {values.durationMinutes} dk</span>
                <span className="h-1 w-1 rounded-full bg-[#efe1e7]" />
                <span className="flex items-center gap-1.5"><Repeat className="h-[18px] w-[18px] text-[#705a66]" /> {values.defaultSessionCount} seans</span>
              </div>
              <div className="relative z-10 mt-4 font-display text-2xl font-semibold text-[#b88938]">
                ₺{(Number(values.price) || 0).toLocaleString('tr-TR')}
              </div>
            </div>

            {/* İkon seçimi — tüm ikonlar satır satır; sütunla birlikte aşağı kayar */}
            <div className="flex flex-col gap-3">
              <h4 className="text-[13px] font-medium tracking-wide text-[#241923]">İKON SEÇİMİ</h4>
              <IconPicker bare maxHeight="max-h-none" value={previewIcon} onChange={(key) => setValues((v) => ({ ...v, iconKey: key }))} />
            </div>
          </div>

          {/* SAĞ — form (beyaz) */}
          <div className="w-full overflow-y-auto bg-white p-6 sm:p-8 md:w-[62%]">
            <div className="flex max-w-2xl flex-col gap-6">
              {/* Hizmet adı */}
              <div className="flex flex-col gap-2">
                <label className={labelStyle}>Hizmet adı</label>
                <input
                  type="text"
                  placeholder="Örn. Hydrafacial Cilt Bakımı"
                  value={values.name}
                  onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                  className={`${fieldStyle} font-medium`}
                />
              </div>

              {/* Kategori */}
              <div className="flex flex-col gap-2">
                <label className={labelStyle}>Kategori</label>
                <div className="relative">
                  <select
                    value={showCustomList ? OTHER_SENTINEL : (values.category || '')}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === OTHER_SENTINEL) {
                        setShowCustomList(true)
                        if (values.category && (PREDEFINED_CATEGORIES as readonly string[]).includes(values.category)) {
                          setValues((cur) => ({ ...cur, category: null }))
                        }
                      } else {
                        setShowCustomList(false)
                        setValues((cur) => ({ ...cur, category: v }))
                      }
                    }}
                    className={`${fieldStyle} appearance-none pr-10`}
                  >
                    <optgroup label="Standart kategoriler">
                      {PREDEFINED_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </optgroup>
                    <option value={OTHER_SENTINEL}>── Diğer (özel kategori)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#705a66]" />
                </div>

                {/* "Diğer" → kuruma özel kategoriler */}
                <AnimatePresence>
                  {showCustomList && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 rounded-2xl border border-[#efbfd0]/80 bg-[#f7ecf1] p-4">
                        <div className="flex items-center justify-between">
                          <span className={labelStyle}>Kuruma özel kategoriler</span>
                          <span className="text-[11px] text-[#705a66]">{sortedCustomCategories.length} adet</span>
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <select
                            value={values.category && sortedCustomCategories.some((c) => c.name === values.category) ? values.category : ''}
                            onChange={(e) => setValues((v) => ({ ...v, category: e.target.value || null }))}
                            className={`flex-1 ${fieldStyle}`}
                          >
                            <option value="">— Özel kategori seç —</option>
                            {sortedCustomCategories.map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
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
                              className="grid w-12 shrink-0 place-items-center rounded-[14px] border border-[#f3c9d4] bg-[#fff1f4] text-[#cf4d68] transition-colors hover:bg-[#ffe4ea]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {onCreateCustomCategory && (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              placeholder="Yeni kategori adı yaz, Enter veya Ekle..."
                              maxLength={80}
                              value={newCategoryName}
                              onChange={(e) => { setNewCategoryName(e.target.value); setCategoryError('') }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory() } }}
                              className={`flex-1 ${fieldStyle}`}
                            />
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.96 }}
                              onClick={handleCreateCategory}
                              disabled={creatingCategory || !newCategoryName.trim()}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-[14px] border border-[#efbfd0] bg-[#fff1f6] px-4 text-[13px] font-semibold text-[#c85776] transition-colors hover:bg-[#fbe5eb] disabled:opacity-60"
                            >
                              {creatingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
                            </motion.button>
                          </div>
                        )}
                        {categoryError && <div className="mt-2 text-[12px] font-medium text-rose-600">{categoryError}</div>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <p className={helperStyle}>Raporlarda hizmet gruplaması bu alana göre yapılır.</p>

                {/* Alt kategori (opsiyonel) — kategorinin altında daha ince gruplama */}
                <div className="mt-1 flex flex-col gap-1.5">
                  <label className={labelStyle}>Alt kategori <span className="font-normal text-[#705a66]">(opsiyonel)</span></label>
                  <input
                    type="text"
                    list="svc-subcategory-options"
                    placeholder="Örn. Bölgesel · Yüz · Vücut…"
                    value={values.subCategory || ''}
                    onChange={(e) => setValues((v) => ({ ...v, subCategory: e.target.value || null }))}
                    className={fieldStyle}
                  />
                  <datalist id="svc-subcategory-options">
                    {subCategoryOptions.map((n) => <option key={n} value={n} />)}
                  </datalist>
                  <p className={helperStyle}>Kategoriler sayfasında tanımlı alt kategoriler önerilir; serbest de yazabilirsin.</p>
                </div>
              </div>

              {/* Fiyat & Süre */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className={labelStyle}>Fiyat</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 font-medium text-[#705a66]">₺</span>
                    <input
                      type="number" min={0} step={0.01}
                      value={values.price}
                      onChange={(e) => setValues((v) => ({ ...v, price: Number(e.target.value) }))}
                      className={`${fieldStyle} pl-9 font-mono`}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className={labelStyle}>Süre (dk)</label>
                  <div className="relative">
                    <input
                      type="number" min={5} step={5}
                      value={values.durationMinutes}
                      onChange={(e) => setValues((v) => ({ ...v, durationMinutes: Number(e.target.value) }))}
                      className={`${fieldStyle} pr-16 font-mono`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-[13px] text-[#705a66]">dakika</span>
                  </div>
                </div>
              </div>

              {/* Varsayılan seans */}
              <div className="flex flex-col gap-2">
                <label className={labelStyle}>Varsayılan seans sayısı</label>
                <input
                  type="number" min={1} step={1}
                  value={values.defaultSessionCount}
                  onChange={(e) => setValues((v) => ({ ...v, defaultSessionCount: Math.max(1, Number(e.target.value) || 1) }))}
                  className={`${fieldStyle} font-mono md:w-1/2`}
                />
                <p className={helperStyle}>Paket satışlarında baz alınacak varsayılan seans miktarı.</p>
              </div>

              {/* Sadakat puanı (altın kutu) */}
              <div className="relative overflow-hidden rounded-2xl border border-[#b88938]/30 bg-[#f7ecf1] p-5">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#b88938]/5 blur-2xl" />
                <div className="relative z-10 flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#b88938]/10 text-[#b88938]">
                    <Gift className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-2 block text-[13px] font-medium text-[#241923]">Sadakat puanı ile hediye</label>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative w-32">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-mono font-bold text-[#b88938]">P</span>
                        <input
                          type="number" min={0} step={1}
                          value={values.loyaltyPointCost || ''}
                          onChange={(e) => setValues((v) => ({ ...v, loyaltyPointCost: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                          placeholder="Örn. 500"
                          className="w-full rounded-[14px] border border-[#b88938]/40 bg-white py-2 pl-8 pr-3 font-mono text-[13px] text-[#4a3a44] outline-none transition focus:border-[#b88938] focus:ring-2 focus:ring-[#b88938]/20"
                        />
                      </div>
                      <span className="flex-1 text-[12px] text-[#705a66]">
                        {values.loyaltyPointCost > 0
                          ? `Adisyonda ${values.loyaltyPointCost} puan karşılığında hediye edilebilir.`
                          : 'Bu hizmeti ücretsiz almak için gereken puan (boş bırakılırsa puanla alınamaz).'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Yayın durumu — segmented */}
              <div className="flex flex-col gap-3">
                <label className={labelStyle}>Yayın durumu</label>
                <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-2xl border border-[#efe1e7] bg-[#f7ecf1] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setValues((v) => ({ ...v, status: opt.value, isActive: opt.value === 'Active' }))}
                      className={`whitespace-nowrap rounded-xl px-5 py-2 text-[13px] font-medium transition-all ${
                        values.status === opt.value
                          ? 'bg-white text-[#c85776] shadow-sm'
                          : 'text-[#705a66] hover:text-[#241923]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className={helperStyle}>Taslak / Pasif / Arşiv hizmetler randevu listesinde gösterilmez.</p>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="shrink-0 border-t border-[#efe1e7] bg-white px-6 py-5 sm:px-8">
          {error && (
            <div className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{error}</div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="hidden items-center gap-2 font-mono text-[12px] text-[#705a66] sm:flex">
              <Scissors className="h-4 w-4" />
              <span>·</span>
              <span>{values.category || 'Kategori seçilmedi'}</span>
              <span>·</span>
              <span>{values.durationMinutes}dk</span>
            </div>
            <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-[14px] px-6 py-2.5 text-[13px] font-medium text-[#705a66] transition-colors hover:bg-[#f7ecf1] hover:text-[#241923] disabled:opacity-50"
              >
                Vazgeç
              </button>
              <motion.button
                type="button"
                onClick={handleSubmit}
                disabled={busy || saved}
                whileTap={{ scale: 0.97 }}
                whileHover={{ y: -1 }}
                className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_-8px_rgba(200,87,118,0.5)] transition-all hover:shadow-[0_18px_40px_-24px_rgba(200,87,118,0.45)] disabled:opacity-70"
              >
                {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : saved ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Save className="h-[18px] w-[18px]" />}
                {saved ? 'Kaydedildi' : submitLabel}
              </motion.button>
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
