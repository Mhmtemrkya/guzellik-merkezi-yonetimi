'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2, FileText, Gift, History, ImagePlus, Layers3, Loader2, Minus, PauseCircle, Plus,
  RotateCcw, Search, ShoppingBag, Trash2, UploadCloud, Wallet, X, XCircle,
} from 'lucide-react'
import ConsentPicker from '@/components/dashboard/ConsentPicker'
import { IconPicker, ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import {
  CatalogModal, ModalSection, ModalTabs, StatusPill,
  catalogDangerBtn, catalogFieldCls, catalogGhostBtn, catalogHistoryBtn, catalogPrimaryBtn,
} from '@/components/dashboard/CatalogKit'
import { formatTL } from '@/lib/apiMappers'
import type { CatalogStatusKey, Service } from '@/lib/types'

/* ==========================================================================
 * PAKET DÜZENLEYİCİ
 *
 * Eskiden paket taslağı sayfanın sağ sütununda duruyor, pakete eklenecek
 * hizmet ızgarası ise sayfanın EN ALTINDA ayrı bir bloktaydı: bir hizmet
 * eklemek için ekranın altına inip yukarı dönmek gerekiyordu. Üstelik
 * kategori kutusu kendi kendine kaydediyor ("Seçim otomatik kaydedilir"),
 * geri kalan her şey "Taslağı Kaydet" bekliyordu — iki farklı kaydetme
 * davranışı aynı formda.
 *
 * Yeni hâl: paketi kurmanın tamamı tek modalde ve TEK kaydetme davranışı var.
 * Fiyat kutusundaki her satır ölçülü aritmetiktir (ara toplam, indirim, kalan,
 * aylık taksit); eski "tahmini kâr %" göstergesi uydurma olduğu için kaldırıldı.
 * ========================================================================== */

export interface PackageDraftItem {
  serviceDefinitionId: string
  name: string
  iconKey: string
  duration: number
  sessionCount: number
  unitPrice: number
}

export interface PackageDraft {
  id: string | null
  name: string
  description: string
  category: string
  subCategory: string
  iconKey: string
  salePrice: number
  /** Kullanıcı fiyata elle dokundu mu — dokunmadıysa ara toplamı izler. */
  priceTouched: boolean
  deposit: number
  /** Kullanıcı peşinata elle dokundu mu — dokunmadıysa satış fiyatının %25'i. */
  depositTouched: boolean
  installments: number
  loyaltyPointCost: number
  status: CatalogStatusKey
  /** Paket TANIMI iptal edildiyse gerekçesi (müşteri satış iptalinden ayrı). */
  cancellationReason: string
  items: PackageDraftItem[]
  /** Bu paket için zorunlu onam formları — paketi SATIN ALAN müşteride uyarı doğurur. */
  consentTemplateIds: string[]
}

/**
 * Havuzdaki hizmet + HAM kategori adı.
 *
 * `Service.group`, `normalizeService`in kategorisi boş hizmete uydurduğu "Genel Hizmet"
 * adını taşır; havuzun kategori süzgeci onu kullanırsa listede var olmayan bir kategori
 * belirir. Bu yüzden havuz her yerde `rawCategory` üzerinden çalışır.
 */
export type CatalogService = Service & { rawCategory: string }

export const emptyPackageDraft = (): PackageDraft => ({
  id: null, name: '', description: '', category: '', subCategory: '', iconKey: '',
  salePrice: 0, priceTouched: false, deposit: 0, depositTouched: false,
  installments: 4, loyaltyPointCost: 0, status: 'Draft', cancellationReason: '', items: [],
  consentTemplateIds: [],
})

type TabKey = 'duzenle' | 'satis'

/** Fiyat/peşinat otomatiği: dokunulmayan alanlar içeriği izler. */
const applyAuto = (draft: PackageDraft): PackageDraft => {
  const subtotal = draft.items.reduce((total, item) => total + item.unitPrice * item.sessionCount, 0)
  const sale = draft.priceTouched ? draft.salePrice : subtotal
  const deposit = draft.depositTouched ? draft.deposit : Math.round(sale * 0.25)
  return { ...draft, salePrice: sale, deposit }
}

export default function PackageEditorModal({
  open,
  onOpenChange,
  initialDraft,
  services,
  assignableCategories,
  subCategoriesFor,
  tenantId,
  busy,
  error,
  notice,
  canManage,
  canDelete,
  onSave,
  onCancelPackage,
  onRestorePackage,
  onDelete,
  onAddHistoricalSale,
  renderSellTrigger,
  renderSales,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Modal her açılışta bu taslağı temel alır (yeni paket ya da seçilen kayıt). */
  initialDraft: PackageDraft
  services: CatalogService[]
  assignableCategories: string[]
  subCategoriesFor: (category: string) => string[]
  tenantId?: string
  busy: boolean
  error: string
  notice: string
  canManage: boolean
  canDelete: boolean
  /** Kaydeder ve kaydedilen paketin id'sini döner (yeni pakette oluşan id). */
  onSave: (draft: PackageDraft, status: CatalogStatusKey) => Promise<string | null>
  onCancelPackage: (draft: PackageDraft, reason: string) => Promise<void>
  onRestorePackage: (draft: PackageDraft) => Promise<void>
  onDelete: (draft: PackageDraft) => Promise<void>
  /**
   * "Geçmiş satış ekle" — diyalog satış panelinde yaşar (kayıttan sonra listeyi o tazeler),
   * tetikleyici alt çubukta. Önce Satışlar sekmesine geçilir ki panel kurulmuş olsun.
   * Yeni (kaydedilmemiş) pakette çizilmez: bağlanacak bir kayıt yok.
   */
  onAddHistoricalSale?: () => void
  renderSellTrigger: (draft: PackageDraft) => ReactNode
  renderSales: (draft: PackageDraft) => ReactNode
}) {
  const [draft, setDraft] = useState<PackageDraft>(initialDraft)
  const [tab, setTab] = useState<TabKey>('duzenle')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [localError, setLocalError] = useState('')
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerCategory, setPickerCategory] = useState('')

  // Modal her açılışta seçili kayıttan yeniden kurulur; kapalıyken taslak tazelenmez
  // (kaydetme sırasında gelen listenin taslağın üzerine yazmasını istemiyoruz).
  useEffect(() => {
    if (!open) return
    setDraft(initialDraft)
    setTab('duzenle')
    setShowIconPicker(false)
    setCancelOpen(false)
    setCancelReason('')
    setLocalError('')
    setPickerSearch('')
    setPickerCategory('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraft.id])

  /* ---- hesaplar (hepsi ölçülü aritmetik) ------------------------------- */
  const subtotal = draft.items.reduce((total, item) => total + item.unitPrice * item.sessionCount, 0)
  const discount = Math.max(0, subtotal - draft.salePrice)
  const surcharge = Math.max(0, draft.salePrice - subtotal)
  const discountRate = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0
  const remaining = Math.max(0, draft.salePrice - draft.deposit)
  const monthly = draft.installments > 0 ? Math.round(remaining / draft.installments) : 0
  const totalSessions = draft.items.reduce((total, item) => total + item.sessionCount, 0)

  /* ---- hizmet seçici ---------------------------------------------------- */
  // Arşivliler hariç TÜM hizmetler (aktif olanlar önce).
  const pickerPool = useMemo(
    () => services
      .filter((service) => service.status !== 'Archived')
      .sort((a, b) => (a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1) || a.name.localeCompare(b.name, 'tr')),
    [services],
  )
  const pickerCategories = useMemo(() => {
    const names = new Set<string>()
    for (const service of pickerPool) if (service.rawCategory) names.add(service.rawCategory)
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'tr'))
  }, [pickerPool])
  const pickerServices = useMemo(() => {
    const needle = pickerSearch.trim().toLocaleLowerCase('tr')
    return pickerPool.filter(
      (service) =>
        (!pickerCategory || service.rawCategory === pickerCategory) &&
        (!needle || service.name.toLocaleLowerCase('tr').includes(needle) || service.rawCategory.toLocaleLowerCase('tr').includes(needle)),
    )
  }, [pickerPool, pickerSearch, pickerCategory])

  const subOptions = useMemo(() => {
    const names = subCategoriesFor(draft.category)
    if (draft.subCategory && !names.includes(draft.subCategory)) return [...names, draft.subCategory]
    return names
  }, [subCategoriesFor, draft.category, draft.subCategory])

  /* ---- taslak düzenleme ------------------------------------------------- */
  const addService = (service: CatalogService) => {
    setLocalError('')
    setDraft((current) => applyAuto({
      ...current,
      items: current.items.some((item) => item.serviceDefinitionId === service.id)
        ? current.items.map((item) => (item.serviceDefinitionId === service.id ? { ...item, sessionCount: item.sessionCount + 1 } : item))
        // Hizmetin varsayılan seans sayısı ön-dolum gelir; pakette serbestçe düzenlenebilir.
        : [...current.items, {
            serviceDefinitionId: service.id, name: service.name, iconKey: service.iconKey,
            duration: service.duration, sessionCount: Math.max(1, service.session || 1), unitPrice: service.price,
          }],
    }))
  }
  const changeCount = (id: string, delta: number) =>
    setDraft((current) => applyAuto({
      ...current,
      items: current.items.map((item) => (item.serviceDefinitionId === id ? { ...item, sessionCount: Math.max(1, item.sessionCount + delta) } : item)),
    }))
  const setCount = (id: string, count: number) =>
    setDraft((current) => applyAuto({
      ...current,
      items: current.items.map((item) => (item.serviceDefinitionId === id ? { ...item, sessionCount: Math.max(1, Math.round(count) || 1) } : item)),
    }))
  const setUnitPrice = (id: string, price: number) =>
    setDraft((current) => applyAuto({
      ...current,
      items: current.items.map((item) => (item.serviceDefinitionId === id ? { ...item, unitPrice: Math.max(0, Number(price) || 0) } : item)),
    }))
  const removeItem = (id: string) =>
    setDraft((current) => applyAuto({ ...current, items: current.items.filter((item) => item.serviceDefinitionId !== id) }))

  const validate = (): boolean => {
    if (!draft.name.trim()) { setLocalError('Paket adı gerekli.'); return false }
    if (draft.items.length === 0) { setLocalError('Pakete en az bir hizmet ekle.'); return false }
    if (draft.deposit > draft.salePrice) { setLocalError('Peşinat, satış fiyatından büyük olamaz.'); return false }
    setLocalError('')
    return true
  }

  const save = async (status: CatalogStatusKey) => {
    if (!validate()) return
    // Kaydetme başarısızsa taslak DEĞİŞMEZ: eskiden durum yine de yazılıyordu ve
    // kullanıcı "Yayına Al" hata verdiği hâlde paketi yayında sanıyordu.
    const savedId = await onSave(draft, status)
    if (savedId) setDraft((current) => ({ ...current, id: savedId, status }))
  }

  const runCancel = async () => {
    const reason = cancelReason.trim()
    if (!reason) { setLocalError('İptal gerekçesi yazmalısın.'); return }
    await onCancelPackage(draft, reason)
    setDraft((current) => ({ ...current, status: 'Cancelled', cancellationReason: reason }))
    setCancelOpen(false)
    setCancelReason('')
  }

  const runRestore = async () => {
    await onRestorePackage(draft)
    setDraft((current) => ({ ...current, status: 'Passive', cancellationReason: '' }))
  }

  const isNew = !draft.id
  const shownError = localError || error

  return (
    <CatalogModal
      open={open}
      onOpenChange={onOpenChange}
      icon={ShoppingBag}
      eyebrow={isNew ? 'Yeni paket' : 'Paket düzenleme'}
      title={draft.name.trim() || 'Adsız paket'}
      subtitle={
        draft.items.length === 0
          ? 'Hizmet ekleyerek paketi kurun; fiyat ve peşinat otomatik hesaplanır.'
          : `${draft.items.length} hizmet · ${totalSessions} seans · ${formatTL(draft.salePrice)}`
      }
      badge={<StatusPill status={draft.status} />}
      width={1360}
      height={940}
      tabs={
        <ModalTabs
          idPrefix="package-editor"
          value={tab}
          onChange={setTab}
          options={
            isNew
              ? [{ key: 'duzenle' as TabKey, label: 'Paket kurulumu', icon: Layers3 }]
              : [
                  { key: 'duzenle' as TabKey, label: 'Paket kurulumu', icon: Layers3 },
                  { key: 'satis' as TabKey, label: 'Satışlar', icon: Wallet },
                ]
          }
        />
      }
      footer={
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {shownError && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]"
              >
                {shownError}
              </motion.div>
            )}
            {!shownError && notice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-[11px] border border-[#8ED6B4] bg-[#DFF3EA] px-3 py-2 text-[12px] font-medium text-[#15694A]"
              >
                <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                {notice}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <>
                  <button type="button" disabled={busy} onClick={() => void save('Draft')} className={catalogGhostBtn}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Taslağı kaydet
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(draft.status === 'Active' ? 'Passive' : 'Active')}
                    className={draft.status === 'Active' ? catalogGhostBtn : catalogPrimaryBtn}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.status === 'Active' ? <PauseCircle className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                    {draft.status === 'Active' ? 'Pasife al' : 'Yayına al'}
                  </button>
                </>
              )}
              {!isNew && renderSellTrigger(draft)}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* İptal: paket TANIMINDAN gerekçeli vazgeçme. Silmez — geçmiş satışlar ve raporlar
                  korunur, paket yalnızca satış listelerinden düşer. Müşterinin satış iptali BAŞKA
                  bir şeydir; o, satış panelinden yapılır. */}
              {canManage && !isNew && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { if (draft.status === 'Cancelled') void runRestore(); else { setLocalError(''); setCancelOpen((v) => !v) } }}
                  className={draft.status === 'Cancelled' ? catalogGhostBtn : catalogDangerBtn}
                >
                  {draft.status === 'Cancelled' ? <RotateCcw className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {draft.status === 'Cancelled' ? 'İptali geri al' : 'Paketi iptal et'}
                </button>
              )}
              {/* Geçmiş satış — Sil'in SOLUNDA (hizmet modaliyle aynı yer). */}
              {onAddHistoricalSale && !isNew && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setTab('satis'); onAddHistoricalSale() }}
                  className={catalogHistoryBtn}
                >
                  <History className="h-3.5 w-3.5" /> Geçmiş satış ekle
                </button>
              )}
              {canDelete && !isNew && (
                <button type="button" disabled={busy} onClick={() => void onDelete(draft)} className={catalogDangerBtn}>
                  <Trash2 className="h-3.5 w-3.5" /> Sil
                </button>
              )}
            </div>
          </div>
        </div>
      }
    >
      {tab === 'satis' && !isNew ? (
        <div className="p-4 sm:p-5">{renderSales(draft)}</div>
      ) : (
        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_368px]">
          {/* ---------------- SOL: KİMLİK + İÇERİK ---------------- */}
          <div className="space-y-4">
            <section className="rounded-[18px] border border-[#EAD8DF] bg-white p-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setShowIconPicker((v) => !v)}
                  title="Paket ikonu seç"
                  className="group relative grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#A5556E] text-white transition-transform hover:scale-105"
                >
                  <ServiceIcon iconKey={draft.iconKey || suggestIcon(draft.name || draft.category)} className="h-7 w-7" />
                  <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-[#8C4460]">
                    <ImagePlus className="h-3 w-3" />
                  </span>
                </button>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Paket adı"
                    aria-label="Paket adı"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2 font-display text-[19px] font-bold tracking-tight text-[#2A2027] outline-none transition-colors placeholder:font-sans placeholder:text-[15px] placeholder:font-medium placeholder:text-[#74616A] focus:border-[#A5556E]"
                  />
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
                    placeholder="Kısa açıklama (müşteriye gösterilir)…"
                    aria-label="Paket açıklaması"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12.5px] text-[#2A2027] outline-none transition-colors placeholder:text-[#74616A] focus:border-[#A5556E]"
                  />
                </div>
              </div>
              <AnimatePresence initial={false}>
                {showIconPicker && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <IconPicker
                        value={draft.iconKey || suggestIcon(draft.name || draft.category)}
                        onChange={(key) => { setDraft((current) => ({ ...current, iconKey: key })); setShowIconPicker(false) }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <ModalSection
              title="Pakete dahil hizmetler"
              hint="Seans sayısını ve birim fiyatı burada ayarlayın; ara toplam anında güncellenir."
              action={
                <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#5A4B53]">
                  {draft.items.length} hizmet · {totalSessions} seans
                </span>
              }
            >
              {draft.items.length === 0 ? (
                <div className="rounded-[13px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-6 text-center text-[12px] font-medium text-[#705a66]">
                  Aşağıdaki havuzdan hizmet seçerek paketi kurmaya başlayın.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  <AnimatePresence initial={false}>
                    {draft.items.map((item) => (
                      <motion.li
                        key={item.serviceDefinitionId}
                        layout
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-wrap items-center gap-2 rounded-[13px] border border-[#EAD8DF] bg-white px-2.5 py-2"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#A5556E] text-white">
                          <ServiceIcon iconKey={item.iconKey || suggestIcon(item.name)} className="h-4 w-4" />
                        </span>
                        <div className="min-w-[120px] flex-1">
                          <div className="truncate text-[12.5px] font-semibold text-[#2A2027]">{item.name}</div>
                          <div className="text-[11px] font-medium text-[#705a66]">{item.duration} dk</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-[#EAD8DF] bg-white">
                          <button
                            type="button"
                            onClick={() => changeCount(item.serviceDefinitionId, -1)}
                            aria-label="Seans azalt"
                            className="grid h-7 w-7 place-items-center rounded-l-[9px] text-[#5A4B53] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E]"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={item.sessionCount}
                            onChange={(e) => setCount(item.serviceDefinitionId, Number(e.target.value))}
                            aria-label="Seans sayısı"
                            className="w-10 [appearance:textfield] border-0 bg-transparent text-center text-[12px] font-semibold tabular-nums text-[#2A2027] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() => changeCount(item.serviceDefinitionId, 1)}
                            aria-label="Seans artır"
                            className="grid h-7 w-7 place-items-center rounded-r-[9px] text-[#5A4B53] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E]"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <label className="flex shrink-0 items-center gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#74616A]">Birim</span>
                          <input
                            type="number"
                            min={0}
                            value={item.unitPrice || ''}
                            onChange={(e) => setUnitPrice(item.serviceDefinitionId, Number(e.target.value))}
                            className="w-[86px] rounded-[9px] border border-[#EAD8DF] bg-white px-2 py-1 text-right text-[12.5px] font-semibold tabular-nums text-[#2A2027] outline-none focus:border-[#A5556E]"
                          />
                        </label>
                        <span className="w-[92px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-[#2A2027]">
                          {formatTL(item.unitPrice * item.sessionCount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.serviceDefinitionId)}
                          aria-label={`${item.name} paketten çıkar`}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[#74616A] transition-colors hover:bg-[#FCE7EC] hover:text-[#A32347]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </ModalSection>

            <ModalSection
              title="Hizmet havuzu"
              hint="Karta tıklayın; zaten ekliyse tekrar tıklamak seans sayısını artırır."
              action={
                <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#5A4B53]">
                  {pickerServices.length} / {pickerPool.length}
                </span>
              }
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74616A]" />
                    <input
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Hizmet ara: ad veya kategori…"
                      className="h-9 w-full rounded-[11px] border border-[#EAD8DF] bg-white pl-9 pr-3 text-[12.5px] text-[#2A2027] outline-none transition-colors placeholder:text-[#74616A] focus:border-[#A5556E]"
                    />
                  </div>
                  <select
                    value={pickerCategory}
                    onChange={(e) => setPickerCategory(e.target.value)}
                    aria-label="Kategoriye göre süz"
                    className={catalogFieldCls}
                  >
                    <option value="">Tüm kategoriler</option>
                    {pickerCategories.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {pickerPool.length === 0 ? (
                  <div className="rounded-[13px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-6 text-center text-[12px] font-medium text-[#705a66]">
                    Henüz hizmet yok — önce Hizmet Havuzu&apos;ndan hizmet ekleyin.
                  </div>
                ) : pickerServices.length === 0 ? (
                  <div className="rounded-[13px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-6 text-center text-[12px] font-medium text-[#705a66]">
                    Aramanıza uygun hizmet bulunamadı.
                  </div>
                ) : (
                  <div className="grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                    {pickerServices.map((service) => {
                      const picked = draft.items.find((item) => item.serviceDefinitionId === service.id)
                      return (
                        <button
                          key={service.id}
                          type="button"
                          onClick={() => addService(service)}
                          title={picked ? `${service.name} — tekrar tıkla, seansı artır` : `${service.name} — pakete ekle`}
                          className={`group flex flex-col rounded-[13px] border p-2.5 text-left transition-all ${
                            picked
                              ? 'border-[#8C4460] bg-[#F6DFE6] ring-1 ring-[#A5556E]/25'
                              : 'border-[#EAD8DF] bg-white hover:-translate-y-0.5 hover:border-[#BE7690]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#A5556E] text-white">
                              <ServiceIcon iconKey={service.iconKey || suggestIcon(service.name || service.rawCategory)} className="h-4 w-4" />
                            </span>
                            {picked ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-[#A5556E] px-2 py-0.5 text-[10px] font-semibold text-white">
                                ×{picked.sessionCount}
                              </span>
                            ) : (
                              <span className="grid h-6 w-6 place-items-center rounded-full border border-[#EAD8DF] text-[#A5556E] transition-colors group-hover:border-[#8C4460] group-hover:bg-[#A5556E] group-hover:text-white">
                                <Plus className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                          <div className="mt-2 line-clamp-1 text-[12.5px] font-semibold text-[#2A2027]">{service.name}</div>
                          <div className="line-clamp-1 text-[11px] font-medium text-[#705a66]">{service.rawCategory || 'Kategorisiz'}</div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-[#5A4B53]">{service.duration} dk</span>
                            <span className="text-[12.5px] font-semibold tabular-nums text-[#2A2027]">{formatTL(service.price)}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </ModalSection>
          </div>

          {/* ---------------- SAĞ: FİYAT + AYARLAR ---------------- */}
          <aside className="space-y-3">
            <section className="overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white">
              <div className="bg-[#A5556E] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white">
                Fiyatlandırma
              </div>
              <div className="space-y-2.5 p-4">
                <PriceRow label="Ara toplam" value={formatTL(subtotal)} hint="Hizmet birim fiyatı × seans" />
                {discount > 0 && (
                  <PriceRow label={`İndirim (%${discountRate})`} value={`−${formatTL(discount)}`} tone="text-[#A32347]" />
                )}
                {surcharge > 0 && (
                  <PriceRow label="Ara toplam üzeri" value={`+${formatTL(surcharge)}`} tone="text-[#8A5A11]" />
                )}

                <label className="flex items-center justify-between gap-2 border-t border-[#EAD8DF] pt-2.5">
                  <span className="text-[12.5px] font-semibold text-[#2A2027]">Satış fiyatı</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.salePrice || ''}
                    onChange={(e) => setDraft((current) => ({ ...current, salePrice: Math.max(0, Number(e.target.value) || 0), priceTouched: true }))}
                    className="w-[116px] rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-right font-display text-[16px] font-bold tabular-nums text-[#2A2027] outline-none focus:border-[#A5556E]"
                  />
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#5A4B53]">Peşinat</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.deposit || ''}
                    onChange={(e) => setDraft((current) => ({ ...current, deposit: Math.max(0, Number(e.target.value) || 0), depositTouched: true }))}
                    className="w-[116px] rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-right text-[13px] font-semibold tabular-nums text-[#2A2027] outline-none focus:border-[#A5556E]"
                  />
                </label>

                <PriceRow label="Peşinat sonrası kalan" value={formatTL(remaining)} />

                <label className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#5A4B53]">Taksit (ay)</span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    value={draft.installments}
                    onChange={(e) => setDraft((current) => ({ ...current, installments: Math.min(24, Math.max(0, Number(e.target.value) || 0)) }))}
                    className="w-[116px] rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-right text-[13px] font-semibold tabular-nums text-[#2A2027] outline-none focus:border-[#A5556E]"
                  />
                </label>

                {draft.installments > 0 && remaining > 0 && (
                  <div className="rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2 text-[12px] font-medium text-[#4a3a44]">
                    Kalan tutar <strong className="font-semibold text-[#2A2027]">{draft.installments}</strong> ayda,
                    ayda <strong className="font-semibold text-[#2A2027]">{formatTL(monthly)}</strong> olarak bölünür.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 border-t border-[#EAD8DF] pt-2.5">
                  <div className="rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#74616A]">Toplam seans</div>
                    <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-[#2A2027]">{totalSessions}</div>
                  </div>
                  <div className="rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#74616A]">Hizmet</div>
                    <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-[#2A2027]">{draft.items.length}</div>
                  </div>
                </div>
              </div>
            </section>

            <ModalSection title="Sınıflandırma" hint="Alt kategori üst kategoriye bağlıdır; kategori değişince alt seçim düşer.">
              <div className="space-y-2">
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((current) => ({ ...current, category: e.target.value, subCategory: '' }))}
                  aria-label="Kategori"
                  className={`w-full ${catalogFieldCls}`}
                >
                  <option value="">— Kategorisiz —</option>
                  {assignableCategories.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <select
                  value={draft.subCategory}
                  disabled={subOptions.length === 0}
                  onChange={(e) => setDraft((current) => ({ ...current, subCategory: e.target.value }))}
                  aria-label="Alt kategori"
                  className={`w-full ${catalogFieldCls} disabled:cursor-not-allowed disabled:bg-[#F7F6F6]`}
                >
                  <option value="">— Alt kategorisiz —</option>
                  {subOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {subOptions.length === 0 && (
                  <p className="text-[11.5px] font-medium text-[#705a66]">
                    {draft.category ? 'Bu kategorinin alt kategorisi yok.' : 'Alt kategori için önce kategori seçin.'}
                  </p>
                )}
              </div>
            </ModalSection>

            <ModalSection title="Sadakat puanı ile hediye" hint="0 = hediye edilemez. Puan girilirse adisyonda hediye olarak seçilebilir.">
              <div className="flex items-center gap-2">
                <Gift aria-hidden className="h-4 w-4 shrink-0 text-[#8A5A11]" />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft.loyaltyPointCost || ''}
                  placeholder="0"
                  aria-label="Sadakat puanı"
                  onChange={(e) => setDraft((current) => ({ ...current, loyaltyPointCost: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                  className="w-[104px] rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-right text-[13px] font-semibold tabular-nums text-[#2A2027] outline-none focus:border-[#A5556E]"
                />
                <span className="text-[12.5px] font-semibold text-[#8A5A11]">puan</span>
              </div>
            </ModalSection>

            <section className="rounded-[18px] border border-[#EAD8DF] bg-white p-4">
              <ConsentPicker
                value={draft.consentTemplateIds}
                onChange={(next) => setDraft((current) => ({ ...current, consentTemplateIds: next }))}
                tenantId={tenantId}
                label="Bu paket için onam formu istensin mi?"
                hint="Seçilen formlar, bu paketi satın alan müşteride imzalanana kadar müşteri kartı, cari, adisyon ve randevu ekranlarında uyarı olarak görünür."
              />
            </section>

            {/* İptal edilmiş paketin gerekçesi — hangi paketten neden vazgeçildiği görünür. */}
            {draft.status === 'Cancelled' && (
              <div className="rounded-[16px] border border-[#F0AFBF] bg-[#FCE7EC] px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#A32347]">
                  <XCircle className="h-3.5 w-3.5" /> Paket iptal edildi
                </div>
                <p className="mt-1 text-[12.5px] font-medium text-[#2A2027]">
                  {draft.cancellationReason || 'Gerekçe belirtilmemiş.'}
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-[#4a3a44]">
                  Bu, kurumun paketten vazgeçmesidir; müşterilerin satış iptalleriyle ilgisi yoktur.
                </p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {cancelOpen && draft.status !== 'Cancelled' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-[16px] border border-[#F0AFBF] bg-[#FCE7EC] p-3.5">
                    <div className="text-[12px] font-semibold text-[#A32347]">Paketi neden iptal ediyorsun?</div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-[#4a3a44]">
                      Paket silinmez; geçmiş satışlar ve raporlar korunur, yalnızca yeni satış listelerinden düşer.
                    </p>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value.slice(0, 500))}
                      rows={3}
                      autoFocus
                      placeholder="Örn: Hizmet kapsamı değişti, yerine yeni paket açıldı."
                      className="mt-2 w-full resize-none rounded-[11px] border border-[#F0AFBF] bg-white px-3 py-2 text-[12.5px] text-[#2A2027] outline-none placeholder:text-[#74616A] focus:border-[#C8365C]"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button type="button" onClick={() => { setCancelOpen(false); setCancelReason('') }} className={catalogGhostBtn}>
                        Vazgeç
                      </button>
                      <button
                        type="button"
                        disabled={busy || !cancelReason.trim()}
                        onClick={() => void runCancel()}
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] bg-[#A32347] px-3.5 py-2 text-[12px] font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#8A1C3B] disabled:opacity-55 disabled:hover:translate-y-0"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Paketi iptal et
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        </div>
      )}
    </CatalogModal>
  )
}

function PriceRow({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[12px] font-medium text-[#5A4B53]">
        {label}
        {hint && <span className="mt-0.5 block text-[10.5px] font-medium text-[#74616A]">{hint}</span>}
      </span>
      <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${tone || 'text-[#2A2027]'}`}>{value}</span>
    </div>
  )
}
