'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Barcode as BarcodeIcon,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Loader2,
  Package,
  PackagePlus,
  X,
} from 'lucide-react'
import { downscaleImage } from '@/lib/imageUtils'
import { productCategoryLabels } from '@/lib/apiMappers'
import type { ProductCategoryKey } from '@/lib/types'

export interface ProductFormValues {
  imageUrl: string
  name: string
  sku: string
  barcode: string
  category: ProductCategoryKey
  unit: string
  brand: string
  supplier: string
  location: string
  lotNumber: string
  expiryDate: string
  taxRatePercent: number
  leadTimeDays: number
  pendingInbound: number
  cost: number
  salePrice: number
  currentStock: number
  minStockLevel: number
  isActive: boolean
}

interface ProductFormDialogProps {
  mode?: 'create' | 'edit'
  initial?: Partial<ProductFormValues>
  title?: string
  submitLabel?: string
  onSubmit: (values: ProductFormValues) => void | Promise<void>
  trigger: ReactNode
}

const UNITS = ['adet', 'kutu', 'paket', 'set', 'gr', 'ml']
const CATEGORY_KEYS = Object.keys(productCategoryLabels) as ProductCategoryKey[]

const fieldStyle =
  'w-full rounded-[14px] border border-[#efe1e7] bg-white px-4 py-3 text-[14px] text-[#4a3a44] outline-none transition focus:border-[#c85776] focus:ring-2 focus:ring-[#c85776]/20 placeholder:text-[#705a66]/50'
const labelStyle = 'mb-1.5 block text-[13px] font-medium text-[#241923]'
const helperStyle = 'mt-1.5 text-[12px] text-[#705a66]'

function defaults(): ProductFormValues {
  return {
    imageUrl: '', name: '', sku: '', barcode: '', category: 'SkinCare', unit: 'adet',
    brand: '', supplier: '', location: '', lotNumber: '', expiryDate: '',
    taxRatePercent: 20, leadTimeDays: 0, pendingInbound: 0,
    cost: 100, salePrice: 200, currentStock: 10, minStockLevel: 5, isActive: true,
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#c85776]">{title}</span>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-[#f0aac2]/45 to-transparent" />
      </div>
      {children}
    </div>
  )
}

export default function ProductFormDialog({
  mode = 'create',
  initial,
  title,
  submitLabel,
  onSubmit,
  trigger,
}: ProductFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<ProductFormValues>(defaults())
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)

  const initialSignature = JSON.stringify(initial || {})
  useEffect(() => {
    if (open) {
      setValues({ ...defaults(), ...(initial || {}) })
      setSaved(false)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

  const set = (patch: Partial<ProductFormValues>): void => {
    setValues((c) => ({ ...c, ...patch }))
    setError('')
    setSaved(false)
  }
  const num = (raw: string): number => Math.max(0, Number(raw) || 0)

  const pickPhoto = async (file: File): Promise<void> => {
    setPhotoBusy(true)
    setError('')
    try {
      set({ imageUrl: await downscaleImage(file, 320) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel yüklenemedi.')
    } finally {
      setPhotoBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!values.name.trim()) { setError('Ürün adı zorunludur.'); return }
    if (!values.sku.trim()) { setError('SKU zorunludur.'); return }
    setBusy(true)
    setError('')
    try {
      await onSubmit(values)
      setSaved(true)
      setTimeout(() => setOpen(false), 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const heading = title || (mode === 'edit' ? 'Ürünü Düzenle' : 'Yeni Ürün Tanımla')
  const cta = submitLabel || (mode === 'edit' ? 'Güncelle' : 'Ürün oluştur')
  const margin = values.salePrice > 0 ? Math.round(((values.salePrice - values.cost) / values.salePrice) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[28px] border border-[#efe1e7] bg-white p-0 text-[#4a3a44] shadow-[0_44px_120px_-60px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1152px)', height: 'min(92dvh, 900px)', maxHeight: '92dvh' }}
      >
        {/* Üst altın hairline */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]" style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #b88938 50%, #ffd3df 80%, transparent)' }} />

        {/* HEADER */}
        <header className="flex shrink-0 items-start justify-between border-b border-[#efe1e7] bg-white px-6 py-6 sm:px-8">
          <div className="flex items-center gap-4">
            <motion.span
              initial={{ scale: 0.85, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#f0aac2] bg-[#f7ecf1] text-[#c85776]"
            >
              <PackagePlus className="h-5 w-5" strokeWidth={1.7} />
            </motion.span>
            <div className="min-w-0">
              <div className="mb-1 font-mono text-[12px] uppercase tracking-widest text-[#705a66]">ÜRÜN · {mode === 'edit' ? 'DÜZENLE' : 'YENİ TANIM'}</div>
              <DialogTitle className="font-display text-[26px] leading-tight text-[#241923] sm:text-3xl">{heading}</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-[#705a66]">Ürün stok, satış ve adisyon akışında kullanılabilir.</DialogDescription>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f7ecf1] text-[#705a66] transition-colors hover:bg-[#ffd3df]/40 hover:text-[#c85776]">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* BODY — iki sütun */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* SOL — canlı önizleme (krem) */}
          <div className="w-full shrink-0 overflow-y-auto border-b border-[#efe1e7] bg-[#f7ecf1] p-6 sm:p-8 md:w-[340px] md:border-b-0 md:border-r">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#c85776]">Önizleme</div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#efe1e7]/60 bg-white p-5 shadow-[0_4px_12px_-8px_rgba(200,87,118,0.3)]">
              {/* görsel */}
              <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-[16px] border border-[#f0dde5] bg-[#fffafc]">
                {values.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={values.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 text-[#c89bac]">
                    <Package className="h-9 w-9" strokeWidth={1.3} />
                    <span className="text-[11px] font-medium">Görsel yok</span>
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex rounded-full border border-[#f3cdda] bg-[#fff1f6] px-2.5 py-0.5 text-[10px] font-semibold text-[#a84f69]">
                  {productCategoryLabels[values.category]}
                </span>
                <span className={`text-[10px] font-semibold ${values.isActive ? 'text-[#2f9e72]' : 'text-[#705a66]'}`}>
                  {values.isActive ? 'Satışta' : 'Pasif'}
                </span>
              </div>
              <div className="mt-2 font-display text-lg font-bold leading-tight text-[#241923]">{values.name.trim() || 'Ürün adı'}</div>
              <div className="mt-1 font-mono text-[11px] text-[#705a66]">{values.sku.trim() || 'SKU—'}{values.barcode.trim() ? ` · ${values.barcode.trim()}` : ''}</div>
              <div className="mt-3 font-display text-2xl font-bold tabular-nums beautyasist-text-gradient">₺{(Number(values.salePrice) || 0).toLocaleString('tr-TR')}</div>
              <div className="mt-0.5 text-[11px] text-[#705a66]">Maliyet ₺{(Number(values.cost) || 0).toLocaleString('tr-TR')} · %{margin} kâr</div>
              <div className="mt-3 flex gap-2 border-t border-[#f3e1e9] pt-3">
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#fffafc] px-2 py-1 text-[10px] font-semibold text-[#705a66]"><Boxes className="h-3 w-3 text-[#c85776]" /> {mode === 'create' ? `Açılış ${values.currentStock}` : 'Stok'}</span>
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#fffafc] px-2 py-1 text-[10px] font-semibold text-[#705a66]"><AlertTriangle className="h-3 w-3 text-[#b88938]" /> Min {values.minStockLevel}</span>
              </div>
            </div>
          </div>

          {/* SAĞ — form (beyaz) */}
          <div className="w-full overflow-y-auto bg-white p-6 sm:p-8 md:flex-1">
            <div className="space-y-7">
              {/* TANIM */}
              <Section title="TANIM">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <label title="Görsel yükle" className={`group relative grid h-[68px] w-[68px] shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[14px] border border-dashed border-[#e7c9d4] bg-[#fffafc] ${photoBusy ? 'opacity-60' : ''}`}>
                      {values.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={values.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus className="h-5 w-5 text-[#c85776]" />
                      )}
                      <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = '' }} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#241923]">Ürün görseli</div>
                      <div className="mt-0.5 text-[12px] text-[#705a66]">Kare, ≤320px. {values.imageUrl ? 'Değiştirmek için tıkla.' : 'Görsel seç (opsiyonel).'}</div>
                      {values.imageUrl && (
                        <button type="button" onClick={() => set({ imageUrl: '' })} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-rose-500 hover:text-rose-600"><X className="h-3 w-3" /> Kaldır</button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className={labelStyle}>Ürün adı *</label>
                    <input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="Örn. Yenileyici Gece Serumu" className={fieldStyle} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelStyle}>SKU *</label>
                      <input value={values.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Örn. YGS-001" className={`${fieldStyle} font-mono`} />
                    </div>
                    <div>
                      <label className={labelStyle}>Barkod</label>
                      <div className="relative">
                        <BarcodeIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a98a98]" />
                        <input value={values.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="Boş → otomatik EAN-13" className={`${fieldStyle} pl-10 font-mono`} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelStyle}>Kategori</label>
                      <div className="relative">
                        <select value={values.category} onChange={(e) => set({ category: e.target.value as ProductCategoryKey })} className={`${fieldStyle} appearance-none pr-10`}>
                          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{productCategoryLabels[k]}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#705a66]" />
                      </div>
                    </div>
                    <div>
                      <label className={labelStyle}>Birim</label>
                      <div className="relative">
                        <select value={values.unit} onChange={(e) => set({ unit: e.target.value })} className={`${fieldStyle} appearance-none pr-10`}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#705a66]" />
                      </div>
                    </div>
                  </div>
                </div>
              </Section>

              {/* DİĞER BİLGİLER */}
              <Section title="DİĞER BİLGİLER">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label className={labelStyle}>Marka</label><input value={values.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="opsiyonel" className={fieldStyle} /></div>
                  <div><label className={labelStyle}>Tedarikçi</label><input value={values.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="opsiyonel" className={fieldStyle} /></div>
                  <div><label className={labelStyle}>Raf / Dolap</label><input value={values.location} onChange={(e) => set({ location: e.target.value })} placeholder="örn. A1-Raf3" className={fieldStyle} /></div>
                  <div><label className={labelStyle}>Lot numarası</label><input value={values.lotNumber} onChange={(e) => set({ lotNumber: e.target.value })} placeholder="opsiyonel" className={`${fieldStyle} font-mono`} /></div>
                  <div><label className={labelStyle}>Son kullanma</label><input type="date" value={values.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} className={fieldStyle} /></div>
                  <div>
                    <label className={labelStyle}>Vergi oranı</label>
                    <div className="relative">
                      <input type="number" min={0} value={values.taxRatePercent} onChange={(e) => set({ taxRatePercent: num(e.target.value) })} className={`${fieldStyle} pr-9 tabular-nums`} />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[#705a66]">%</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelStyle}>Tedarik süresi</label>
                    <div className="relative">
                      <input type="number" min={0} value={values.leadTimeDays} onChange={(e) => set({ leadTimeDays: num(e.target.value) })} className={`${fieldStyle} pr-12 tabular-nums`} />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[#705a66]">gün</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelStyle}>Bekleyen giriş</label>
                    <input type="number" min={0} value={values.pendingInbound} onChange={(e) => set({ pendingInbound: num(e.target.value) })} className={`${fieldStyle} tabular-nums`} />
                  </div>
                </div>
              </Section>

              {/* FİYAT & STOK */}
              <Section title="FİYAT & STOK">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelStyle}>Maliyet</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#a98a98]">₺</span>
                        <input type="number" min={0} step={0.01} value={values.cost} onChange={(e) => set({ cost: num(e.target.value) })} className={`${fieldStyle} pl-8 tabular-nums`} />
                      </div>
                    </div>
                    <div>
                      <label className={labelStyle}>Satış fiyatı</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#a98a98]">₺</span>
                        <input type="number" min={0} step={0.01} value={values.salePrice} onChange={(e) => set({ salePrice: num(e.target.value) })} className={`${fieldStyle} pl-8 tabular-nums`} />
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {mode === 'create' && (
                      <div>
                        <label className={labelStyle}>Açılış stoğu</label>
                        <input type="number" min={0} value={values.currentStock} onChange={(e) => set({ currentStock: num(e.target.value) })} className={`${fieldStyle} tabular-nums`} />
                      </div>
                    )}
                    <div>
                      <label className={labelStyle}>Minimum stok</label>
                      <input type="number" min={0} value={values.minStockLevel} onChange={(e) => set({ minStockLevel: num(e.target.value) })} className={`${fieldStyle} tabular-nums`} />
                    </div>
                  </div>
                  {/* Aktif toggle */}
                  <button
                    type="button"
                    onClick={() => set({ isActive: !values.isActive })}
                    className="flex w-full items-center justify-between gap-3 rounded-[14px] border border-[#efe1e7] bg-[#fffafc] px-4 py-3 text-left transition-colors hover:border-[#efbfd0]"
                  >
                    <span>
                      <span className="block text-[13px] font-semibold text-[#241923]">Aktif (satışta)</span>
                      <span className="block text-[12px] text-[#705a66]">Pasif ürünler satış/adisyon listesinde görünmez.</span>
                    </span>
                    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${values.isActive ? 'bg-gradient-to-r from-[#f47699] to-[#ef6088]' : 'bg-[#e7d6de]'}`}>
                      <motion.span animate={{ x: values.isActive ? 24 : 4 }} transition={{ type: 'spring', stiffness: 360, damping: 24 }} className="absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow-sm" />
                    </span>
                  </button>
                </div>
              </Section>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{error}</motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#efe1e7] bg-white px-6 py-4 sm:px-8">
          <div className="hidden items-center gap-2 font-mono text-[12px] text-[#705a66] sm:flex">
            <Package className="h-4 w-4 text-[#c85776]" />
            <span>{productCategoryLabels[values.category]}</span>
            <span>·</span>
            <span className="tabular-nums">₺{(Number(values.salePrice) || 0).toLocaleString('tr-TR')}</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-[14px] border border-[#ead8df] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776] disabled:opacity-50">Vazgeç</button>
            <motion.button
              type="button"
              onClick={submit}
              disabled={busy || saved}
              whileTap={{ scale: 0.97 }}
              whileHover={{ y: -1 }}
              className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-all hover:shadow-[0_22px_44px_-20px_rgba(214,95,131,0.9)] disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : saved ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <PackagePlus className="h-[18px] w-[18px]" />}
              {saved ? 'Kaydedildi' : cta}
            </motion.button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
