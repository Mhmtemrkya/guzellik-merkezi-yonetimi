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
  'min-h-11 w-full rounded-[14px] border border-[#ead8df]/[0.80] bg-white/[0.88] px-3 py-2 text-sm text-[#352432] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors placeholder:text-[#8f7784]/[0.45] hover:border-[#efbfd0]/[0.85] focus:border-[#f0aac2]/[0.85] focus:bg-white focus:outline-none'

const labelStyle =
  'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]'

const helperStyle = 'mt-1 text-[10px] leading-relaxed text-[#352432]/[0.40]'

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
                <TrendingDown className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/[0.80]">Expense · POST</div>
                <DialogTitle className="mt-1 font-display text-2xl tracking-tight">{title}</DialogTitle>
                <DialogDescription className="mt-2 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  İşletme gideri ekle. Kira, fatura, sarf vb. tüm para çıkışları burada toplanır. &quot;Diğer&quot; seçersen
                  kendi kategorinin altına alabilir, ileride aynı kategoriyi tekrar kullanabilirsin.
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
              {/* Kategori dropdown */}
              <div>
                <label className={labelStyle}>
                  <Tag className="h-3 w-3" /> Kategori
                </label>
                <select
                  value={values.category}
                  onChange={(e) => {
                    const cat = e.target.value as ExpenseCategoryKey
                    setValues((v) => ({ ...v, category: cat, customCategoryName: cat === 'Other' ? v.customCategoryName : null }))
                    if (cat === 'Other') setShowCustomList(true)
                    else setShowCustomList(false)
                  }}
                  className={`mt-2 ${fieldStyle}`}
                >
                  <optgroup label="Standart kategoriler">
                    {visiblePredefined
                      .filter((c) => c !== 'Other')
                      .map((cat) => (
                        <option key={cat} value={cat}>
                          {expenseCategoryLabels[cat]}
                        </option>
                      ))}
                  </optgroup>
                  <option value="Other">── Diğer (özel kategori)</option>
                </select>
                <div className={helperStyle}>
                  Personel maaşı için sol menüden &quot;Personel Maaşları&quot; sekmesini kullan.
                </div>
              </div>

              {/* "Diğer" seçilince → özel kategoriler */}
              <AnimatePresence>
                {(values.category === 'Other' || showCustomList) && (
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
                          <Sparkles className="h-3 w-3" /> Özel kategoriler (kuruma özel)
                        </label>
                        <span className="text-[9px] font-mono text-[#352432]/[0.40]">
                          {sortedCustomCategories.length} adet
                        </span>
                      </div>

                      {/* Özel kategori dropdown + sil */}
                      <div className="mt-2 flex gap-2">
                        <select
                          value={values.customCategoryName && sortedCustomCategories.some((c) => c.name === values.customCategoryName) ? values.customCategoryName : ''}
                          onChange={(e) => setValues((v) => ({ ...v, category: 'Other', customCategoryName: e.target.value || null }))}
                          className={`flex-1 ${fieldStyle}`}
                        >
                          <option value="">— Özel kategori seç —</option>
                          {sortedCustomCategories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {onDeleteCustomCategory && values.customCategoryName && sortedCustomCategories.find((c) => c.name === values.customCategoryName) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const target = sortedCustomCategories.find((c) => c.name === values.customCategoryName)
                              if (!target || !onDeleteCustomCategory) return
                              try {
                                await onDeleteCustomCategory(target.id)
                                setValues((v) => ({ ...v, customCategoryName: null }))
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

                      {/* Yeni kategori ekle — sadece paket categories.expense.custom içeriyorsa */}
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

              {/* Tutar + Ödeme yöntemi */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelStyle}>
                    <Wallet className="h-3 w-3" /> Tutar
                  </label>
                  <div className="relative mt-2">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-[#c85776]/[0.55]">
                      ₺
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={values.amount}
                      onChange={(e) => setValues((v) => ({ ...v, amount: Number(e.target.value) }))}
                      className={`${fieldStyle} pl-7`}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelStyle}>
                    <CreditCard className="h-3 w-3" /> Ödeme yöntemi
                  </label>
                  <select
                    value={values.paymentMethod}
                    onChange={(e) => setValues((v) => ({ ...v, paymentMethod: e.target.value as ExpensePaymentMethodKey }))}
                    className={`mt-2 ${fieldStyle}`}
                  >
                    {(Object.keys(paymentMethodLabels) as ExpensePaymentMethodKey[]).map((m) => (
                      <option key={m} value={m}>
                        {paymentMethodLabels[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tarih + Dönem */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelStyle}>
                    <Calendar className="h-3 w-3" /> Tarih
                  </label>
                  <input
                    type="date"
                    value={values.occurredAt}
                    onChange={(e) => {
                      const d = e.target.value
                      setValues((v) => ({ ...v, occurredAt: d, periodLabel: v.periodLabel || periodLabelFromDate(d) }))
                    }}
                    className={`mt-2 ${fieldStyle}`}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <CalendarClock className="h-3 w-3" /> Dönem (YYYY-AA)
                  </label>
                  <input
                    type="text"
                    placeholder="2026-05"
                    value={values.periodLabel}
                    onChange={(e) => setValues((v) => ({ ...v, periodLabel: e.target.value }))}
                    className={`mt-2 ${fieldStyle}`}
                  />
                  <div className={helperStyle}>Faturanın hangi aya ait olduğu</div>
                </div>
              </div>

              {/* Açıklama + Referans */}
              <div>
                <label className={labelStyle}>
                  <FileText className="h-3 w-3" /> Açıklama
                </label>
                <input
                  type="text"
                  placeholder="Hangi tedarikçi, ne için..."
                  value={values.description}
                  onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                />
              </div>
              <div>
                <label className={labelStyle}>
                  <Hash className="h-3 w-3" /> Fiş / fatura no
                </label>
                <input
                  type="text"
                  placeholder="Opsiyonel"
                  value={values.reference}
                  onChange={(e) => setValues((v) => ({ ...v, reference: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                />
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
                {values.category === 'Other' && values.customCategoryName
                  ? `Diğer · ${values.customCategoryName}`
                  : expenseCategoryLabels[values.category]}
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
