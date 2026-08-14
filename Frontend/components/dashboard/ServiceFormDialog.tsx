'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
} from 'lucide-react'
import type { CatalogStatusKey, CustomServiceCategory } from '@/lib/types'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import ConsentPicker from '@/components/dashboard/ConsentPicker'
import {
  CatalogModal,
  ModalSection,
  StatusPill,
  catalogGhostBtn,
  catalogPrimaryBtn,
} from '@/components/dashboard/CatalogKit'

const STATUS_OPTIONS: { value: CatalogStatusKey; label: string }[] = [
  { value: 'Active', label: 'Aktif' },
  { value: 'Draft', label: 'Taslak' },
  { value: 'Passive', label: 'Pasif' },
  { value: 'Archived', label: 'Arşiv' },
]

/**
 * Kategori listesi ARTIK sabit değil: kurumun gerçek kategorileri (kayıtlı kategoriler +
 * hizmetlerde fiilen kullanılan adlar) listelenir. Eskiden 6 adet uydurma kategori sabiti
 * vardı; kurum kendi kategorilerini kursa bile form onları göstermiyor, üstelik varsayılan
 * "Cilt Bakımı" olduğu için dokunulmayan her hizmet bu kategoriye yazılıyordu.
 */
const OTHER_SENTINEL = '__OTHER__'

/** Hizmete bağlanabilecek onam formu şablonu (Ayarlar › Onam Formları'nda tanımlanır). */
export interface ConsentTemplateOption {
  id: string
  title: string
  requiresSignature: boolean
}

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
  /** Bu hizmet için zorunlu onam formları — randevu tamamlanırken imzalı mı diye bakılır. */
  consentTemplateIds: string[]
}

export interface ServiceFormDialogProps {
  trigger: ReactNode
  customCategories: CustomServiceCategory[]
  onSubmit: (values: ServiceFormDialogValues) => Promise<void>
  onDeleteCustomCategory?: (id: string) => Promise<void>
  /** Kaydı olmayan ama hizmetlerde KULLANILAN kategori adları — listeden düşmesinler. */
  knownCategories?: string[]
  /** Kategori adı → o kategoride fiilen kullanılan alt kategori adları (kaydı olmayanlar dâhil). */
  knownSubCategories?: Record<string, string[]>
  /** Verilirse kategori kutusundaki "Yeni kategori ekle" seçeneği çıkar. */
  onCreateCustomCategory?: (name: string) => Promise<void>
  /** Kurumun tanımlı onam formları (yalnız geriye uyumluluk; picker listeyi kendi çeker). */
  consentTemplates?: ConsentTemplateOption[]
  /** Onam formu bölümünü çizerken kullanılacak kurum kimliği. */
  consentTenantId?: string
  initialValues?: Partial<ServiceFormDialogValues>
  title?: string
  submitLabel?: string
  /** "Düzenle" modunda iken bazı UX değişiklikleri */
  mode?: 'create' | 'edit'
}

// Modal `document.body`'ye portal'lanır: globals.css'teki okunabilirlik düzeltmesi buraya
// UYGULANMAZ, bu yüzden mürekkep doğrudan yazılır (opaklıklı ton ve 10px altı punto yok).
const fieldStyle =
  'w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] font-medium text-[#2A2027] outline-none transition-colors placeholder:font-normal placeholder:text-[#74616A] focus:border-[#A5556E]'
const labelStyle = 'text-[12px] font-semibold text-[#2A2027]'
const helperStyle = 'text-[11.5px] leading-snug text-[#705a66]'

export default function ServiceFormDialog({
  trigger,
  customCategories,
  onSubmit,
  onDeleteCustomCategory,
  knownCategories = [],
  knownSubCategories = {},
  onCreateCustomCategory,
  consentTemplates = [],
  consentTenantId,
  initialValues,
  title = 'Yeni Hizmet Tanımla',
  submitLabel = 'Hizmeti oluştur',
  mode = 'create',
}: ServiceFormDialogProps) {
  const defaults: ServiceFormDialogValues = {
    name: '',
    // Varsayılan kategori YOK: uydurma bir varsayılan, dokunulmayan her hizmeti yanlış
    // kategoriye yazıyordu. Kullanıcı gerçek kategorilerden seçer.
    category: null,
    subCategory: null,
    durationMinutes: 60,
    price: 1500,
    defaultSessionCount: 1,
    loyaltyPointCost: 0,
    isActive: true,
    iconKey: '',
    status: 'Active',
    consentTemplateIds: [],
  }
  const merged: ServiceFormDialogValues = { ...defaults, ...(initialValues || {}) }

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<ServiceFormDialogValues>(merged)
  /** "Yeni kategori ekle" satırı seçilince açılan ekleme kutusu. */
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [categoryError, setCategoryError] = useState('')

  const initialSignature = JSON.stringify(merged)
  useEffect(() => {
    if (open) {
      setValues(merged)
      setSaved(false)
      setError('')
      setCreatingCategory(false)
      setNewCategoryName('')
      setCategoryError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

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
    if (creatingCategory && newCategoryName.trim()) {
      setError('Yeni kategoriyi önce “Ekle” ile kaydedin ya da vazgeçin.')
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

  /** Kurumun KAYITLI üst kategorileri (Kategoriler sayfasında tanımlı olanlar). */
  const registeredCategories = useMemo(
    () => customCategories
      .filter((c) => c.isActive && !c.parentId)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'tr'))
      .map((c) => c.name),
    [customCategories],
  )
  /** Kaydı olmayan ama hizmetlerde kullanılan adlar — ayrı grupta, kaybolmasınlar. */
  const derivedCategories = useMemo(() => {
    const known = new Set(registeredCategories)
    const out = knownCategories.filter((n) => n && !known.has(n))
    // Düzenlenen hizmetin kategorisi hiçbir listede yoksa yine de seçili kalabilmeli.
    if (values.category && !known.has(values.category) && !out.includes(values.category)) out.push(values.category)
    return out.sort((a, b) => a.localeCompare(b, 'tr'))
  }, [registeredCategories, knownCategories, values.category])

  const selectedCategoryRecord = useMemo(
    () => customCategories.find((c) => !c.parentId && c.name === values.category) ?? null,
    [customCategories, values.category],
  )

  /**
   * Alt kategori listesi YALNIZCA seçili kategoriye aittir: kayıtlı alt kategoriler
   * (parentId eşleşen) + o kategorideki hizmetlerde fiilen kullanılan adlar. Eskiden tüm
   * kategorilerin alt kategorileri karışık listeleniyordu.
   */
  const subCategoryOptions = useMemo(() => {
    if (!values.category) return []
    const parentId = selectedCategoryRecord?.id ?? null
    const names = parentId
      ? customCategories
        .filter((c) => c.isActive && c.parentId === parentId)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'tr'))
        .map((c) => c.name)
      : []
    const set = new Set(names)
    for (const n of knownSubCategories[values.category] || []) if (n && !set.has(n)) { set.add(n); names.push(n) }
    if (values.subCategory && !set.has(values.subCategory)) names.push(values.subCategory)
    return names
  }, [customCategories, selectedCategoryRecord, knownSubCategories, values.category, values.subCategory])

  const createCategory = async (): Promise<void> => {
    const name = newCategoryName.trim()
    if (!name || !onCreateCustomCategory) return
    setCategoryBusy(true)
    setCategoryError('')
    try {
      await onCreateCustomCategory(name)
      // Yeni kategori seçili gelir; alt kategori önceki kategoriye aitti, sıfırlanır.
      setValues((v) => ({ ...v, category: name, subCategory: null }))
      setCreatingCategory(false)
      setNewCategoryName('')
    } catch (e: unknown) {
      setCategoryError(e instanceof Error ? e.message : 'Kategori eklenemedi.')
    } finally {
      setCategoryBusy(false)
    }
  }

  const previewIcon = values.iconKey || suggestIcon(values.name || values.category)

  return (
    <>
      {/*
        Tetikleyici Radix `DialogTrigger` DEĞİL: modal kabuğu (CatalogKit › CatalogModal)
        paket düzenleyicisiyle ORTAK olsun diye kendi `Dialog`'unu içeride kuruyor.
        `display: contents` sarmalayıcı, çağıranın verdiği düğmenin yerleşimini bozmaz.
      */}
      <span className="contents" onClick={() => setOpen(true)}>
        {trigger}
      </span>

      <CatalogModal
        open={open}
        onOpenChange={setOpen}
        icon={Sparkles}
        eyebrow={mode === 'edit' ? 'Hizmet düzenleme' : 'Yeni hizmet'}
        title={title}
        subtitle="Kaydedilen hizmet; randevu, paket ve satış akışında anında kullanılabilir."
        badge={<StatusPill status={values.status} />}
        width={1240}
        height={920}
        footer={
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-[#5A4B53]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1">
                  <Scissors className="h-3 w-3 text-[#A5556E]" /> {values.category || 'Kategorisiz'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1">
                  <Clock className="h-3 w-3 text-[#A5556E]" /> {values.durationMinutes} dk
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1">
                  <Repeat className="h-3 w-3 text-[#A5556E]" /> {values.defaultSessionCount} seans
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(false)} disabled={busy} className={catalogGhostBtn}>
                  Vazgeç
                </button>
                <motion.button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || saved}
                  whileTap={{ scale: 0.97 }}
                  className={catalogPrimaryBtn}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saved ? 'Kaydedildi' : submitLabel}
                </motion.button>
              </div>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[356px_minmax(0,1fr)]">
          {/* ---------------- SOL: CANLI ÖNİZLEME + İKON ---------------- */}
          <aside className="space-y-3">
            <section className="relative overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white p-5 text-center">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#F9A1B9]/30 blur-3xl" />
              <div className="relative">
                <motion.div
                  key={previewIcon}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                  className="mx-auto grid h-20 w-20 place-items-center rounded-[24px] bg-[#A5556E] text-white shadow-[0_18px_34px_-20px_rgba(87,39,61,0.9)]"
                >
                  <ServiceIcon iconKey={previewIcon} className="h-10 w-10" strokeWidth={1.7} />
                </motion.div>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1 text-[11px] font-semibold text-[#8C4460]">
                  {values.category || 'Kategori seçilmedi'}
                  {values.subCategory ? ` › ${values.subCategory}` : ''}
                </div>
                <h3 className="mt-2 font-display text-[20px] font-bold leading-tight tracking-tight text-[#2A2027]">
                  {values.name.trim() || 'Hizmet adı'}
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#74616A]">Süre</div>
                    <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#2A2027]">{values.durationMinutes} dk</div>
                  </div>
                  <div className="rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#74616A]">Fiyat</div>
                    <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#2A2027]">
                      ₺{(Number(values.price) || 0).toLocaleString('tr-TR')}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <ModalSection title="İkon" hint="Randevu, paket ve satış listelerinde bu ikon görünür.">
              <IconPicker bare maxHeight="max-h-[260px]" value={previewIcon} onChange={(key) => setValues((v) => ({ ...v, iconKey: key }))} />
            </ModalSection>
          </aside>

          {/* ---------------- SAĞ: FORM ---------------- */}
          <div className="space-y-3">
            <ModalSection title="Kimlik" hint="Hizmetin adı ve yayın durumu.">
              <div className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Hizmet adı</label>
                  <input
                    type="text"
                    placeholder="Örn. Hydrafacial Cilt Bakımı"
                    value={values.name}
                    onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                    className={fieldStyle}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Yayın durumu</label>
                  <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-1">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, status: opt.value, isActive: opt.value === 'Active' }))}
                        className="relative rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                      >
                        {values.status === opt.value && (
                          <motion.span
                            aria-hidden
                            layoutId="service-form-status"
                            className="absolute inset-0 rounded-full bg-[#A5556E]"
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                          />
                        )}
                        <span className={`relative ${values.status === opt.value ? 'text-white' : 'text-[#5A4B53] hover:text-[#2A2027]'}`}>
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className={helperStyle}>Taslak / Pasif / Arşiv hizmetler randevu ve satış listelerinde çıkmaz.</p>
                </div>
              </div>
            </ModalSection>

            <ModalSection title="Sınıflandırma" hint="Raporlarda hizmet gruplaması bu alana göre yapılır.">
              <div className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Kategori</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        value={creatingCategory ? OTHER_SENTINEL : (values.category || '')}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === OTHER_SENTINEL) {
                            setCreatingCategory(true)
                            setCategoryError('')
                            return
                          }
                          setCreatingCategory(false)
                          // Kategori değişince alt kategori artık geçerli değil → sıfırlanır.
                          setValues((cur) => ({ ...cur, category: v || null, subCategory: null }))
                        }}
                        className={`${fieldStyle} appearance-none pr-9`}
                      >
                        <option value="">— Kategori seçilmedi —</option>
                        {registeredCategories.length > 0 && (
                          <optgroup label="Kayıtlı kategoriler">
                            {registeredCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                          </optgroup>
                        )}
                        {derivedCategories.length > 0 && (
                          <optgroup label="Hizmetlerde kullanılanlar">
                            {derivedCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                          </optgroup>
                        )}
                        {onCreateCustomCategory && <option value={OTHER_SENTINEL}>＋ Diğer — yeni kategori ekle…</option>}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74616A]" />
                    </div>
                    {onDeleteCustomCategory && selectedCategoryRecord && !creatingCategory && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!onDeleteCustomCategory || !selectedCategoryRecord) return
                          setCategoryError('')
                          try {
                            await onDeleteCustomCategory(selectedCategoryRecord.id)
                            setValues((v) => ({ ...v, category: null, subCategory: null }))
                          } catch (err: unknown) {
                            setCategoryError(err instanceof Error ? err.message : 'Silinemedi.')
                          }
                        }}
                        title={`“${selectedCategoryRecord.name}” kategorisini sil`}
                        className="grid w-11 shrink-0 place-items-center rounded-[12px] border border-[#F0AFBF] bg-[#FCE7EC] text-[#A32347] transition-colors hover:bg-[#F9D7DF]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* "Diğer" → yeni kategori ekleme kutusu */}
                  <AnimatePresence initial={false}>
                    {creatingCategory && onCreateCustomCategory && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1 rounded-[14px] border border-[#BE7690] bg-[#F6DFE6] p-3">
                          <div className="flex items-center gap-1.5">
                            <Plus className="h-4 w-4 text-[#8C4460]" />
                            <span className="text-[12px] font-semibold text-[#8C4460]">Yeni kategori ekle</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <input
                              autoFocus
                              type="text"
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void createCategory() }
                                if (e.key === 'Escape') { setCreatingCategory(false); setNewCategoryName('') }
                              }}
                              placeholder="Örn. Medikal Estetik"
                              className={`min-w-[170px] flex-1 ${fieldStyle}`}
                            />
                            <button
                              type="button"
                              onClick={createCategory}
                              disabled={categoryBusy || !newCategoryName.trim()}
                              className={catalogPrimaryBtn}
                            >
                              {categoryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
                            </button>
                            <button
                              type="button"
                              onClick={() => { setCreatingCategory(false); setNewCategoryName(''); setCategoryError('') }}
                              className={catalogGhostBtn}
                            >
                              Vazgeç
                            </button>
                          </div>
                          <p className="mt-2 text-[11.5px] leading-snug text-[#4a3a44]">
                            Eklenen kategori tüm hizmet/paket formlarında ve <span className="font-semibold">Paket &amp; Hizmet › Kategoriler</span> sayfasında görünür.
                          </p>
                          {categoryError && <div className="mt-2 text-[12px] font-semibold text-[#A32347]">{categoryError}</div>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {!creatingCategory && categoryError && <div className="text-[12px] font-semibold text-[#A32347]">{categoryError}</div>}
                </div>

                {/* Alt kategori — kategori seçilene kadar kapalı, sonra O kategorinin alt kategorileri */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Alt kategori <span className="font-medium text-[#705a66]">(opsiyonel)</span></label>
                  <select
                    value={values.subCategory || ''}
                    onChange={(e) => setValues((v) => ({ ...v, subCategory: e.target.value || null }))}
                    disabled={!values.category || subCategoryOptions.length === 0}
                    className={`${fieldStyle} disabled:cursor-not-allowed disabled:bg-[#F7F6F6]`}
                  >
                    <option value="">— Alt kategorisiz —</option>
                    {subCategoryOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <p className={helperStyle}>
                    {!values.category
                      ? 'Önce kategori seçin; alt kategoriler seçtiğiniz kategoriye göre listelenir.'
                      : subCategoryOptions.length === 0
                        ? `“${values.category}” kategorisinin alt kategorisi yok. Kategoriler sayfasından ekleyebilirsiniz.`
                        : `“${values.category}” kategorisinin alt kategorileri.`}
                  </p>
                </div>
              </div>
            </ModalSection>

            <ModalSection title="Süre, fiyat ve seans" hint="Randevu takviminde ayrılacak süre ve satıştaki birim fiyat.">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Fiyat</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[13px] font-semibold text-[#74616A]">₺</span>
                    <input
                      type="number" min={0} step={0.01}
                      value={values.price}
                      onChange={(e) => setValues((v) => ({ ...v, price: Number(e.target.value) }))}
                      className={`${fieldStyle} pl-7 tabular-nums`}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Süre</label>
                  <div className="relative">
                    <input
                      type="number" min={5} step={5}
                      value={values.durationMinutes}
                      onChange={(e) => setValues((v) => ({ ...v, durationMinutes: Number(e.target.value) }))}
                      className={`${fieldStyle} pr-9 tabular-nums`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-[12px] font-medium text-[#74616A]">dk</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelStyle}>Varsayılan seans</label>
                  <input
                    type="number" min={1} step={1}
                    value={values.defaultSessionCount}
                    onChange={(e) => setValues((v) => ({ ...v, defaultSessionCount: Math.max(1, Number(e.target.value) || 1) }))}
                    className={`${fieldStyle} tabular-nums`}
                  />
                </div>
              </div>
              <p className={`mt-2 ${helperStyle}`}>Varsayılan seans, paket kurarken bu hizmetin ön-dolum değeridir.</p>
            </ModalSection>

            <ModalSection title="Sadakat puanı ile hediye" hint="0 = puanla alınamaz. Puan girilirse adisyonda hediye olarak seçilebilir.">
              <div className="flex flex-wrap items-center gap-2.5">
                <Gift aria-hidden className="h-4 w-4 shrink-0 text-[#8A5A11]" />
                <div className="relative w-[128px]">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[13px] font-bold text-[#8A5A11]">P</span>
                  <input
                    type="number" min={0} step={1}
                    value={values.loyaltyPointCost || ''}
                    onChange={(e) => setValues((v) => ({ ...v, loyaltyPointCost: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    placeholder="Örn. 500"
                    className={`${fieldStyle} pl-7 tabular-nums`}
                  />
                </div>
                <span className="min-w-[180px] flex-1 text-[11.5px] leading-snug text-[#4a3a44]">
                  {values.loyaltyPointCost > 0
                    ? `Adisyonda ${values.loyaltyPointCost} puan karşılığında hediye edilebilir.`
                    : 'Bu hizmeti ücretsiz almak için gereken puan (boş bırakılırsa puanla alınamaz).'}
                </span>
              </div>
            </ModalSection>

            {/* Onam formları — bu hizmet için zorunlu rıza belgeleri (seç veya yerinde oluştur) */}
            <section className="rounded-[18px] border border-[#EAD8DF] bg-white p-4">
              <ConsentPicker
                value={values.consentTemplateIds}
                onChange={(next) => setValues((v) => ({ ...v, consentTemplateIds: next }))}
                tenantId={consentTenantId}
                label="Bu hizmet için onam formu istensin mi?"
                hint="Seçilen formlar, bu hizmetin randevusu “Tamamlandı” yapılırken imzalı mı diye kontrol edilir; eksikse uyarı çıkar."
              />
            </section>
          </div>
        </div>
      </CatalogModal>
    </>
  )
}
