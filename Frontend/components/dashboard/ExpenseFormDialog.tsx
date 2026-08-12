'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Building2,
  Briefcase,
  Calendar,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileText,
  Hash,
  Loader2,
  Megaphone,
  Package,
  PenLine,
  Plus,
  Receipt,
  ScrollText,
  Sparkles,
  Tag,
  TrendingDown,
  Trash2,
  Wallet,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { expenseCategoryLabels, paymentMethodLabels } from '@/lib/apiMappers'
import type { CustomExpenseCategory, ExpenseCategoryKey, ExpensePaymentMethodKey } from '@/lib/types'

// Salary = personel maaşı, ayrı sekmede; Tax = vergi/SGK (genelde salary ile birlikte alınır)
const visiblePredefined: ExpenseCategoryKey[] = [
  'Rent',
  'Utilities',
  'Supplies',
  'Inventory',
  'Marketing',
  'Maintenance',
  'Professional',
  'Equipment',
  'Office',
  'Tax',
  'Other',
]

const categoryIcons: Record<ExpenseCategoryKey, LucideIcon> = {
  Salary: Receipt,
  Tax: Receipt,
  Rent: Building2,
  Utilities: Zap,
  Supplies: Package,
  Inventory: Package,
  Marketing: Megaphone,
  Maintenance: Wrench,
  Professional: Briefcase,
  Equipment: Wrench,
  Office: FileText,
  Other: ScrollText,
}

export interface ExpenseFormDialogValues {
  category: ExpenseCategoryKey
  customCategoryName: string | null
  amount: number
  paymentMethod: ExpensePaymentMethodKey
  occurredAt: string
  description: string
  reference: string
  periodLabel: string
}

export interface ExpenseFormDialogProps {
  trigger: ReactNode
  customCategories: CustomExpenseCategory[]
  onSubmit: (values: ExpenseFormDialogValues) => Promise<void>
  /** Verilmezse (paket categories.expense.custom içermiyorsa) özel kategori oluşturma UI gizlenir. */
  onCreateCustomCategory?: (name: string) => Promise<CustomExpenseCategory | null>
  onDeleteCustomCategory?: (id: string) => Promise<void>
  initialValues?: Partial<ExpenseFormDialogValues>
  title?: string
  submitLabel?: string
}

const fieldStyle =
  'min-h-11 w-full rounded-[14px] border border-[#EAD8DF]/[0.80] bg-white/[0.88] px-3 py-2 text-sm text-[#2A2027] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors placeholder:text-[#8f7784]/[0.45] hover:border-[#BE7690]/[0.85] focus:border-[#f0aac2]/[0.85] focus:bg-white focus:outline-none'

const labelStyle =
  'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#A5556E]/[0.70]'

const helperStyle = 'mt-1 text-[10px] leading-relaxed text-[#2A2027]/[0.40]'

function periodLabelFromDate(iso: string): string {
  const d = iso ? new Date(iso) : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ExpenseFormDialog({
  trigger,
  customCategories,
  onSubmit,
  onCreateCustomCategory,
  onDeleteCustomCategory,
  initialValues,
  title = 'Gider kaydı oluştur',
  submitLabel = 'Gideri kaydet',
}: ExpenseFormDialogProps) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const defaults: ExpenseFormDialogValues = {
    category: 'Rent',
    customCategoryName: null,
    amount: 0,
    paymentMethod: 'Cash',
    occurredAt: todayIso,
    description: '',
    reference: '',
    periodLabel: periodLabelFromDate(todayIso),
  }
  const merged: ExpenseFormDialogValues = { ...defaults, ...(initialValues || {}) }

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<ExpenseFormDialogValues>(merged)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Custom category management
  const [showCustomList, setShowCustomList] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState('')

  const initialSignature = JSON.stringify(merged)
  useEffect(() => {
    if (open) {
      setValues(merged)
      setSaved(false)
      setError('')
      setShowCustomList(false)
      setNewCategoryName('')
      setCategoryError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

  // "Diğer" seçilince custom liste açılır (eğer custom kategori varsa veya yeni eklenecekse)
  useEffect(() => {
    if (values.category === 'Other') setShowCustomList(true)
  }, [values.category])

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
        setValues((v) => ({ ...v, category: 'Other', customCategoryName: created.name }))
        setNewCategoryName('')
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
    if (values.amount <= 0) {
      setError('Tutar pozitif olmalı.')
      return
    }
    if (values.category === 'Other' && !values.customCategoryName) {
      setError('"Diğer" seçildiğinde özel kategori seçmen veya yeni kategori eklemen gerekli.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(values)
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

  const categoryTone = 'bg-[#A5556E] text-white'
  const field =
    'w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E] placeholder:text-[#74616A]'
  const label = 'mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 720px)', maxHeight: '90dvh' }}
      >
        {/* ---- Başlık ---- */}
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f8] via-white to-[#fff2f6] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#A5556E]">
                <TrendingDown className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-[16px] font-bold text-[#2b1e29]">{title}</DialogTitle>
                <DialogDescription className="mt-0.5 text-[11.5px] leading-snug text-[#74616A]">
                  Kira, fatura, sarf gibi tüm para çıkışları burada toplanır. Personel maaşı için “Personel Maaşları” sekmesini kullan.
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#7e5f6e] transition hover:border-[#BE7690] hover:text-[#3b2330]"
              aria-label="Kapat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ---- Gövde ---- */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Kategori kartları */}
          <div>
            <span className={label}><Tag className="h-3.5 w-3.5 text-[#A5556E]" /> Kategori</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {visiblePredefined.map((key) => {
                const Icon = categoryIcons[key] || ScrollText
                const on = values.category === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, category: key, customCategoryName: key === 'Other' ? v.customCategoryName : null }))}
                    className={`flex items-center gap-2 rounded-[13px] border px-2.5 py-2 text-left transition-colors ${
                      on ? 'border-[#8C4460] bg-[#F6DFE6]' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'
                    }`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${on ? 'bg-[#A5556E] text-white' : categoryTone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate text-[11.5px] font-semibold text-[#3E343A]">{expenseCategoryLabels[key]}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* "Diğer" → özel kategoriler */}
          <AnimatePresence initial={false}>
            {values.category === 'Other' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="rounded-[14px] border border-[#f0e0e6] bg-[#F7F6F6] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">
                    <Sparkles className="h-3.5 w-3.5" /> Özel kategori
                  </div>
                  {sortedCustomCategories.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sortedCustomCategories.map((c) => {
                        const on = values.customCategoryName === c.name
                        return (
                          <span key={c.id} className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={() => setValues((v) => ({ ...v, customCategoryName: c.name }))}
                              className={`rounded-l-[10px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                                on ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#EAD8DF] bg-white text-[#3E343A] hover:border-[#BE7690]'
                              }`}
                            >
                              {c.name}
                            </button>
                            {onDeleteCustomCategory && (
                              <button
                                type="button"
                                onClick={() => void onDeleteCustomCategory(c.id)}
                                className="rounded-r-[10px] border border-l-0 border-[#EAD8DF] bg-white px-1.5 py-1.5 text-[#74616A] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                aria-label={`${c.name} kategorisini sil`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {onCreateCustomCategory && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateCategory() } }}
                        placeholder="Yeni kategori adı (ör. Danışmanlık)"
                        className={field}
                      />
                      <button
                        type="button"
                        disabled={creatingCategory || !newCategoryName.trim()}
                        onClick={() => void handleCreateCategory()}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[12px] border border-[#8C4460]/45 bg-[#F6DFE6] px-3 py-2.5 text-[11.5px] font-semibold text-[#8C4460] transition-colors hover:bg-[#F6DFE6] disabled:opacity-40"
                      >
                        {creatingCategory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ekle
                      </button>
                    </div>
                  )}
                  {categoryError && <div className="mt-1.5 text-[11px] font-medium text-rose-600">{categoryError}</div>}
                  {showCustomList && sortedCustomCategories.length === 0 && !onCreateCustomCategory && (
                    <div className="mt-1.5 text-[11px] text-[#74616A]">Tanımlı özel kategori yok.</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tutar + yöntem */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><Wallet className="h-3.5 w-3.5 text-[#A5556E]" /> Tutar</span>
              <div className="flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 focus-within:border-[#8C4460]">
                <span className="text-[13px] font-semibold text-[#74616A]">₺</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={values.amount || ''}
                  placeholder="0"
                  onChange={(e) => setValues((v) => ({ ...v, amount: Number(e.target.value) }))}
                  className="w-full bg-transparent text-[15px] font-bold tabular-nums text-[#2A2027] outline-none"
                />
              </div>
            </label>
            <div>
              <span className={label}><CreditCard className="h-3.5 w-3.5 text-[#A5556E]" /> Ödeme yöntemi</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(paymentMethodLabels) as ExpensePaymentMethodKey[]).map((m) => {
                  const on = values.paymentMethod === m
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setValues((v) => ({ ...v, paymentMethod: m }))}
                      className={`rounded-[11px] border px-2.5 py-2 text-[11.5px] font-semibold transition-colors ${
                        on ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#EAD8DF] bg-white text-[#3E343A] hover:border-[#BE7690]'
                      }`}
                    >
                      {paymentMethodLabels[m]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Tarih + dönem */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><Calendar className="h-3.5 w-3.5 text-[#A5556E]" /> Tarih</span>
              <input
                type="date"
                value={values.occurredAt}
                onChange={(e) => setValues((v) => ({ ...v, occurredAt: e.target.value, periodLabel: periodLabelFromDate(e.target.value) }))}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}><CalendarClock className="h-3.5 w-3.5 text-[#A5556E]" /> Dönem</span>
              <input
                type="month"
                value={values.periodLabel}
                onChange={(e) => setValues((v) => ({ ...v, periodLabel: e.target.value }))}
                className={field}
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">Faturanın hangi aya ait olduğu</span>
            </label>
          </div>

          {/* Açıklama + fiş no */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}><PenLine className="h-3.5 w-3.5 text-[#A5556E]" /> Açıklama</span>
              <input
                value={values.description}
                onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
                placeholder="Hangi tedarikçi, ne için…"
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}><Hash className="h-3.5 w-3.5 text-[#A5556E]" /> Fiş / fatura no</span>
              <input
                value={values.reference}
                onChange={(e) => setValues((v) => ({ ...v, reference: e.target.value }))}
                placeholder="Opsiyonel"
                className={field}
              />
            </label>
          </div>

          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">{error}</div>
          )}
          {saved && (
            <div className="flex items-center gap-1.5 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Gider kaydedildi.
            </div>
          )}
        </div>

        {/* ---- Alt bar ---- */}
        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] text-[#74616A]">
              <b className="text-[#2A2027]">
                {values.category === 'Other' ? values.customCategoryName || 'Özel kategori' : expenseCategoryLabels[values.category]}
              </b>
              {values.amount > 0 ? ` · ₺${values.amount.toLocaleString('tr-TR')}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-4 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#BE7690]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSubmit()}
                className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-4 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
