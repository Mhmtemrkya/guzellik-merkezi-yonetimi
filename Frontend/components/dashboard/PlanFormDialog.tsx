'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BadgeCheck, BarChart3, BellRing, Building2, Calendar, CheckCircle2, CreditCard,
  FileSpreadsheet, FileText, Layers, Loader2, MessageSquare, Package, PenLine,
  Plus, Save, Settings2, Sparkles, Tag, UsersRound, Users, Wallet, X, Zap,
  type LucideIcon,
} from 'lucide-react'
import { platformApi } from '@/lib/apiClient'
import {
  FEATURE_CATEGORY_LABELS,
  groupFeaturesByCategory,
  normalizeFeatureCatalog,
} from '@/lib/apiMappers'
import type {
  ApiFeatureCatalog,
  FeatureCatalogItem,
  FeatureCategoryKey,
  FeatureKey,
  PricingTier,
  SubscriptionPlan,
} from '@/lib/types'

const CATEGORY_ICONS: Record<FeatureCategoryKey, LucideIcon> = {
  Excel: FileSpreadsheet,
  Pdf: FileText,
  Reports: BarChart3,
  Notifications: BellRing,
  Accounting: Wallet,
  Operations: Settings2,
  Organization: Building2,
}

interface PlanFormValues {
  planKey: string
  name: string
  description: string
  monthlyPriceTRY: number
  yearlyPriceTRY: number
  displayOrder: number
  isActive: boolean
  maxBranches: number
  maxStaff: number
  maxCustomers: number
  maxMonthlyAppointments: number
  maxMonthlySmsCount: number
  maxMonthlyWhatsAppCount: number
  maxMonthlyWhatsAppMarketing: number
  defaultSpendCapCredits: number
  maxMonthlyEmailCount: number
  features: Set<FeatureKey>
  /** Fiyatlama modeli — fiyatlar KDV HARİÇ; tahsilatta %20 KDV eklenir. */
  chargePerBranch: boolean
  customerTiers: PricingTier[]
  consentTiers: PricingTier[]
  yearlyTierMultiplier: number
}

function emptyForm(): PlanFormValues {
  return {
    planKey: '',
    name: '',
    description: '',
    monthlyPriceTRY: 0,
    yearlyPriceTRY: 0,
    displayOrder: 99,
    isActive: true,
    maxBranches: 1,
    maxStaff: 5,
    maxCustomers: 500,
    maxMonthlyAppointments: 500,
    maxMonthlySmsCount: 0,
    maxMonthlyWhatsAppCount: 0,
    maxMonthlyWhatsAppMarketing: 0,
    defaultSpendCapCredits: 0,
    maxMonthlyEmailCount: 0,
    features: new Set(),
    chargePerBranch: false,
    customerTiers: [],
    consentTiers: [],
    yearlyTierMultiplier: 10,
  }
}

function planToForm(plan: SubscriptionPlan): PlanFormValues {
  return {
    planKey: plan.planKey,
    name: plan.name,
    description: plan.description,
    monthlyPriceTRY: plan.monthlyPriceTRY,
    yearlyPriceTRY: plan.yearlyPriceTRY,
    displayOrder: plan.displayOrder,
    isActive: plan.isActive,
    maxBranches: plan.maxBranches,
    maxStaff: plan.maxStaff,
    maxCustomers: plan.maxCustomers,
    maxMonthlyAppointments: plan.maxMonthlyAppointments,
    maxMonthlySmsCount: plan.maxMonthlySmsCount,
    maxMonthlyWhatsAppCount: plan.maxMonthlyWhatsAppCount,
    maxMonthlyWhatsAppMarketing: plan.maxMonthlyWhatsAppMarketing ?? 0,
    defaultSpendCapCredits: plan.defaultSpendCapCredits ?? 0,
    maxMonthlyEmailCount: plan.maxMonthlyEmailCount,
    features: new Set(plan.features as FeatureKey[]),
    chargePerBranch: plan.chargePerBranch,
    customerTiers: plan.customerTiers.map((t) => ({ ...t })),
    consentTiers: plan.consentTiers.map((t) => ({ ...t })),
    yearlyTierMultiplier: plan.yearlyTierMultiplier || 10,
  }
}

const VAT_RATE = 0.2
const tl0 = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(n)

/** Kademe listesi doğrulaması — sunucudaki kuralların aynısı (erken ve anlaşılır hata için). */
function tierError(tiers: PricingTier[], label: string): string | null {
  if (tiers.length > 10) return `${label}: en fazla 10 kademe.`
  if (tiers.some((t) => !Number.isFinite(t.above) || t.above < 0)) return `${label}: eşik 0 ya da daha büyük olmalı.`
  if (tiers.some((t) => !Number.isFinite(t.monthlyFee) || t.monthlyFee < 0)) return `${label}: ücret negatif olamaz.`
  if (new Set(tiers.map((t) => t.above)).size !== tiers.length) return `${label}: aynı eşik iki kez kullanılamaz.`
  return null
}

interface PlanFormDialogProps {
  mode: 'create' | 'edit'
  plan?: SubscriptionPlan
  trigger: ReactNode
  onSuccess: (msg: string) => void
}

export default function PlanFormDialog({ mode, plan, trigger, onSuccess }: PlanFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<PlanFormValues>(() =>
    mode === 'edit' && plan ? planToForm(plan) : emptyForm(),
  )
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<FeatureCatalogItem[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(false)

  useEffect(() => {
    if (!open) return
    if (catalog.length > 0) return
    setLoadingCatalog(true)
    platformApi
      .featuresCatalog<ApiFeatureCatalog>()
      .then((r) => setCatalog(normalizeFeatureCatalog(r)))
      .catch(() => setCatalog([]))
      .finally(() => setLoadingCatalog(false))
  }, [open, catalog.length])

  useEffect(() => {
    if (open) {
      setForm(mode === 'edit' && plan ? planToForm(plan) : emptyForm())
      setErr(null)
    }
  }, [open, mode, plan])

  const grouped = useMemo(() => groupFeaturesByCategory(catalog), [catalog])

  const update = useCallback(<K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleFeature = useCallback((key: FeatureKey) => {
    setForm((prev) => {
      const next = new Set(prev.features)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...prev, features: next }
    })
  }, [])

  const toggleCategory = useCallback((items: FeatureCatalogItem[]) => {
    setForm((prev) => {
      const next = new Set(prev.features)
      const allSelected = items.every((it) => next.has(it.key))
      if (allSelected) items.forEach((it) => next.delete(it.key))
      else items.forEach((it) => next.add(it.key))
      return { ...prev, features: next }
    })
  }, [])

  const selectAll = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      features: new Set(catalog.map((c) => c.key)),
    }))
  }, [catalog])

  const clearAll = useCallback(() => {
    setForm((prev) => ({ ...prev, features: new Set() }))
  }, [])

  const handleSubmit = useCallback(async () => {
    setErr(null)
    if (!form.name.trim()) {
      setErr('Paket adı boş olamaz.')
      return
    }
    if (mode === 'create' && !form.planKey.trim()) {
      setErr('PlanKey boş olamaz.')
      return
    }
    const tierProblem = tierError(form.customerTiers, 'Müşteri kademeleri') ?? tierError(form.consentTiers, 'Onam kademeleri')
    if (tierProblem) {
      setErr(tierProblem)
      return
    }
    if (!(form.yearlyTierMultiplier > 0 && form.yearlyTierMultiplier <= 12)) {
      setErr('Yıllık kademe çarpanı 0\'dan büyük ve en fazla 12 olmalı.')
      return
    }
    setSubmitting(true)
    try {
      const featuresCsv = Array.from(form.features).join(',')
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        monthlyPriceTRY: Number(form.monthlyPriceTRY),
        yearlyPriceTRY: Number(form.yearlyPriceTRY),
        maxBranches: Number(form.maxBranches),
        maxStaff: Number(form.maxStaff),
        maxCustomers: Number(form.maxCustomers),
        maxMonthlyAppointments: Number(form.maxMonthlyAppointments),
        maxMonthlySmsCount: Number(form.maxMonthlySmsCount),
        maxMonthlyWhatsAppCount: Number(form.maxMonthlyWhatsAppCount),
        maxMonthlyWhatsAppMarketing: Number(form.maxMonthlyWhatsAppMarketing),
        defaultSpendCapCredits: Number(form.defaultSpendCapCredits),
        maxMonthlyEmailCount: Number(form.maxMonthlyEmailCount),
        features: featuresCsv,
        displayOrder: Number(form.displayOrder),
        isActive: Boolean(form.isActive),
        // Fiyatlama modeli HER ZAMAN gönderilir: sunucu null'u "koru" sayar; boş liste bilerek temizler.
        chargePerBranch: form.chargePerBranch,
        customerTiers: form.customerTiers.map((t) => ({ above: Number(t.above), monthlyFee: Number(t.monthlyFee) })),
        consentTiers: form.consentTiers.map((t) => ({ above: Number(t.above), monthlyFee: Number(t.monthlyFee) })),
        yearlyTierMultiplier: Number(form.yearlyTierMultiplier),
      }
      if (mode === 'create') {
        await platformApi.createSubscriptionPlan({ ...payload, planKey: form.planKey.trim() })
        onSuccess('Paket oluşturuldu.')
      } else if (plan) {
        await platformApi.updateSubscriptionPlan(plan.id, payload)
        onSuccess('Paket güncellendi.')
      }
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setSubmitting(false)
    }
  }, [form, mode, plan, onSuccess])

  const totalFeatures = catalog.length
  const selectedFeatures = form.features.size

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="!gap-0 !p-0 !rounded-[28px] border-[#EAD8DF]/[0.90] bg-white/[0.96] text-[#2A2027] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl !inset-x-2 !top-[3vh] !bottom-[3vh] sm:!inset-x-auto sm:!left-1/2 sm:!top-1/2 sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(98vw, 1640px)', maxWidth: 'min(98vw, 1640px)', height: '94dvh', maxHeight: '94dvh' }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>
            {mode === 'create' ? 'Yeni abonelik paketi oluştur' : `${form.name || 'Paket'} düzenle`}
          </DialogTitle>
          <DialogDescription>
            Limit alanlarına -1 yazarsan sınırsız olur. Aşağıdaki özellikleri seçerek bu paketin neleri açacağını belirle.
          </DialogDescription>
        </VisuallyHidden.Root>
        <div className="grid h-[94dvh] grid-cols-1 overflow-hidden lg:grid-cols-[360px_1fr]" style={{ height: '94dvh', maxHeight: '94dvh' }}>
          {/* Sol — özet panel */}
          <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-[#EAD8DF]/[0.75] bg-gradient-to-b from-white via-[#fff8fb] to-[#fff0f5] p-6 lg:flex">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/[0.65]">
              <Package className="h-3.5 w-3.5" />
              {mode === 'create' ? 'Yeni paket' : 'Paket düzenle'}
            </div>
            <h2 className="mt-2 font-display text-3xl beautyasist-text-gradient">
              {form.name.trim() || 'İsimsiz paket'}
            </h2>
            {form.planKey && (
              <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-[#2A2027]/[0.45]">
                {form.planKey}
              </div>
            )}

            <div className="mt-5">
              <div className="font-display text-4xl tabular-nums beautyasist-text-gradient">
                {form.monthlyPriceTRY === 0 ? 'Özel' : tl0(form.monthlyPriceTRY)}
              </div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.55]">
                aylık{form.chargePerBranch ? ' · şube başına' : ''} · + KDV
              </div>
              <div className="mt-2 font-display text-xl tabular-nums text-[#A5556E]">
                {form.yearlyPriceTRY === 0 ? 'Özel' : tl0(form.yearlyPriceTRY)}
              </div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.55]">
                yıllık{form.chargePerBranch ? ' · şube başına' : ''} · + KDV
              </div>
              {form.monthlyPriceTRY > 0 && (
                <div className="mt-3 rounded-[14px] border border-[#EAD8DF]/[0.80] bg-white/[0.80] px-3 py-2 text-[11px] text-[#2A2027]/[0.75]">
                  KDV dahil: <b className="tabular-nums">{tl0(form.monthlyPriceTRY * (1 + VAT_RATE))}</b> / ay
                  {form.yearlyPriceTRY > 0 && <> · <b className="tabular-nums">{tl0(form.yearlyPriceTRY * (1 + VAT_RATE))}</b> / yıl</>}
                </div>
              )}
              {(form.customerTiers.length > 0 || form.consentTiers.length > 0) && (
                <div className="mt-3 space-y-1 text-[11px] text-[#2A2027]/[0.75]">
                  {form.customerTiers.length > 0 && <div>Müşteri kademesi: {form.customerTiers.length} eşik</div>}
                  {form.consentTiers.length > 0 && <div>Onam kademesi: {form.consentTiers.length} eşik</div>}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <SummaryRow icon={Building2} label="Şube" value={limitText(form.maxBranches)} />
              <SummaryRow icon={UsersRound} label="Personel" value={limitText(form.maxStaff)} />
              <SummaryRow icon={Users} label="Müşteri" value={limitText(form.maxCustomers)} />
              <SummaryRow icon={Calendar} label="Aylık randevu" value={limitText(form.maxMonthlyAppointments)} />
              <SummaryRow icon={MessageSquare} label="Aylık SMS" value={limitText(form.maxMonthlySmsCount)} />
            </div>

            <div className="mt-auto pt-6">
              <div className="rounded-[20px] border border-[#EAD8DF]/[0.80] bg-white/[0.78] p-3 shadow-[0_18px_44px_-36px_rgba(120,71,88,0.45)]">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/[0.70]">
                  <span>Aktif özellik</span>
                  <span className="text-[#A5556E]">{selectedFeatures}/{totalFeatures}</span>
                </div>
                <div className="mt-2 h-1 bg-[#f9dce7]/[0.55]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#f0aac2] to-[#ffd3df] transition-all"
                    style={{ width: `${totalFeatures > 0 ? (selectedFeatures / totalFeatures) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-[10px] leading-snug text-[#2A2027]/[0.45]">
                  Aşağıdaki listeden bu pakete dahil olacak özellikleri seç.
                  Tenant'lar yalnızca kendi paketindeki özellikleri kullanabilir.
                </p>
              </div>
            </div>
          </aside>

          {/* Sağ — form alanı */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[#EAD8DF]/[0.70] px-6 py-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/[0.65]">
                  {mode === 'create' ? <Plus className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
                  Plan kataloğu
                </div>
                <h3 className="mt-1 font-display text-2xl armo-shimmer">
                  {mode === 'create' ? 'Yeni abonelik paketi oluştur' : `${form.name || 'Paket'} · düzenle`}
                </h3>
                <p className="mt-0.5 text-[11px] text-[#2A2027]/[0.55]">
                  Limit alanlarına -1 yazarsan sınırsız olur. Aşağıdaki özellikleri seçerek bu paketin neleri açacağını belirle.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[#EAD8DF]/[0.80] bg-white/[0.82] p-1.5 text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#BE7690]/[0.90] hover:text-[#2A2027]"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable form */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <SectionTitle icon={Tag}>Tanım</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {mode === 'create' && (
                  <Field label="PlanKey (anahtar)" required helper="Örn: Starter, Pro — kodda referans için kullanılır">
                    <input type="text" value={form.planKey} onChange={(e) => update('planKey', e.target.value)}
                      className={inputClass} placeholder="Pro" />
                  </Field>
                )}
                <Field label="Paket adı" required helper="Müşteriye gösterilen ad">
                  <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
                    className={inputClass} placeholder="örn. BeautyAsist Kurumsal" />
                </Field>
                <Field label="Açıklama" fullWidth>
                  <textarea rows={2} value={form.description} onChange={(e) => update('description', e.target.value)}
                    className={inputClass + ' resize-none'} placeholder="Bu paket kimler için, hangi kullanım senaryoları için..." />
                </Field>
              </div>

              <SectionTitle icon={CreditCard} className="mt-6">Fiyat & sıra <span className="ml-1 normal-case text-[#74616A]">(KDV HARİÇ · tahsilatta %20 KDV eklenir)</span></SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={`Aylık fiyat (₺, KDV hariç${form.chargePerBranch ? ', şube başına' : ''})`} helper="0 = özel/teklif">
                  <input type="number" min={0} step="0.01" value={form.monthlyPriceTRY}
                    onChange={(e) => update('monthlyPriceTRY', Number(e.target.value))}
                    className={inputClass} />
                </Field>
                <Field label={`Yıllık fiyat (₺, KDV hariç${form.chargePerBranch ? ', şube başına' : ''})`} helper="Yıllık satışlarda kullanılır">
                  <input type="number" min={0} step="0.01" value={form.yearlyPriceTRY}
                    onChange={(e) => update('yearlyPriceTRY', Number(e.target.value))}
                    className={inputClass} />
                </Field>
                <Field label="Görsel sıra">
                  <input type="number" value={form.displayOrder}
                    onChange={(e) => update('displayOrder', Number(e.target.value))}
                    className={inputClass} />
                </Field>
                <Field label="Durum">
                  <label className="flex h-10 cursor-pointer items-center gap-2 rounded-[14px] border border-[#EAD8DF]/[0.80] bg-white/[0.86] px-3">
                    <input type="checkbox" checked={form.isActive}
                      onChange={(e) => update('isActive', e.target.checked)}
                      className="h-4 w-4 accent-[#f0aac2]" />
                    <span className="text-[12px] text-[#2A2027]/[0.85]">
                      {form.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </label>
                </Field>
              </div>

              <SectionTitle icon={Building2} className="mt-6">Fiyatlama modeli</SectionTitle>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
                <label className="flex cursor-pointer items-start gap-3 rounded-[16px] border border-[#EAD8DF]/[0.80] bg-white/[0.86] p-3">
                  <input type="checkbox" checked={form.chargePerBranch}
                    onChange={(e) => update('chargePerBranch', e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#A5556E]" />
                  <span>
                    <span className="block text-[12.5px] font-semibold text-[#2A2027]">Şube başına ücretlendir</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[#5A4B53]">
                      Tutar = şube sayısı × fiyat. Dönem ortasında açılan şube, kalan gün kadar kayıtlı karttan hemen tahsil edilir
                      (kurum tutarı onaylar). Kapalıyken paket şube sayısından bağımsız tek fiyattır.
                    </span>
                  </span>
                </label>
                <Field label="Yıllık kademe çarpanı" helper="Yıllık dönemde kademe ücreti = aylık ücret × çarpan (10 = yıllıkta 2 ay indirim)">
                  <input type="number" min={1} max={12} step="0.5" value={form.yearlyTierMultiplier}
                    onChange={(e) => update('yearlyTierMultiplier', Number(e.target.value))} className={inputClass} />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <TierEditor
                  title="Müşteri sayısı kademeleri"
                  unit="müşteri"
                  hint="Kurumun kayıtlı müşteri sayısı eşiği AŞINCA aylık ek ücret (KDV hariç). Kademeler birikmez: aşılan en yüksek kademe uygulanır."
                  tiers={form.customerTiers}
                  onChange={(tiers) => update('customerTiers', tiers)}
                />
                <TierEditor
                  title="Dijital onam formu kademeleri"
                  unit="imzalı evrak"
                  hint="İmzalanmış onam formu sayısı eşiği AŞINCA aylık ek ücret (KDV hariç). Eşiğin altı ücretsizdir."
                  tiers={form.consentTiers}
                  onChange={(tiers) => update('consentTiers', tiers)}
                />
              </div>

              <SectionTitle icon={Layers} className="mt-6">Kullanım Limitleri <span className="ml-1 normal-case text-[#74616A]">(aylık maliyetli kanallar dahil · -1 = sınırsız · 0 = kapalı)</span></SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Max şube" helper="-1 = sınırsız">
                  <input type="number" value={form.maxBranches}
                    onChange={(e) => update('maxBranches', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Max personel">
                  <input type="number" value={form.maxStaff}
                    onChange={(e) => update('maxStaff', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Max müşteri">
                  <input type="number" value={form.maxCustomers}
                    onChange={(e) => update('maxCustomers', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Aylık randevu">
                  <input type="number" value={form.maxMonthlyAppointments}
                    onChange={(e) => update('maxMonthlyAppointments', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Aylık SMS" helper="SMS gönderim kotası">
                  <input type="number" value={form.maxMonthlySmsCount}
                    onChange={(e) => update('maxMonthlySmsCount', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Aylık WhatsApp (Hatırlatma)" helper="Utility kotası — pakete dahil işlemsel mesaj">
                  <input type="number" value={form.maxMonthlyWhatsAppCount}
                    onChange={(e) => update('maxMonthlyWhatsAppCount', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Aylık WhatsApp (Pazarlama)" helper="Marketing kotası — genelde 0, mesaj kredisiyle alınır">
                  <input type="number" value={form.maxMonthlyWhatsAppMarketing}
                    onChange={(e) => update('maxMonthlyWhatsAppMarketing', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Kredi harcama tavanı (kredi)" helper="Aylık WhatsApp + SMS kredi üst sınırı önerisi — 0 = platform varsayılanı">
                  <input type="number" value={form.defaultSpendCapCredits}
                    onChange={(e) => update('defaultSpendCapCredits', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="Aylık E-posta" helper="E-posta gönderim kotası">
                  <input type="number" value={form.maxMonthlyEmailCount}
                    onChange={(e) => update('maxMonthlyEmailCount', Number(e.target.value))} className={inputClass} />
                </Field>
              </div>

              {/* Feature Picker */}
              <div className="mt-7 flex items-center justify-between">
                <SectionTitle icon={Sparkles}>Pakete Dahil Özellikler</SectionTitle>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={selectAll}
                    className="text-[10px] font-mono uppercase tracking-widest text-[#A5556E] hover:text-[#A5556E]">
                    Tümünü seç
                  </button>
                  <span className="text-[#2A2027]/[0.25]">·</span>
                  <button type="button" onClick={clearAll}
                    className="text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.55] hover:text-[#2A2027]/[0.85]">
                    Temizle
                  </button>
                </div>
              </div>

              {loadingCatalog ? (
                <div className="mt-3 flex items-center gap-2 border border-[#EAD8DF]/[0.70] bg-white/[0.72] p-4 text-[12px] text-[#2A2027]/[0.55]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Özellik kataloğu yükleniyor...
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {grouped.map(({ category, items }) => {
                    const Icon = CATEGORY_ICONS[category] ?? Package
                    const selectedInCat = items.filter((it) => form.features.has(it.key)).length
                    const allSelected = selectedInCat === items.length
                    return (
                      <motion.div key={category}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="rounded-[20px] border border-[#EAD8DF]/[0.80] bg-gradient-to-br from-white/[0.92] to-[#fff2f6]/[0.90] p-4 shadow-[0_18px_44px_-36px_rgba(120,71,88,0.45)]">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-7 w-7 items-center justify-center border border-[#BE7690]/[0.75] bg-[#f0aac2]/[0.10] text-[#A5556E]">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <div>
                              <div className="font-display text-[15px] text-[#2A2027]">
                                {FEATURE_CATEGORY_LABELS[category] ?? category}
                              </div>
                              <div className="text-[9px] font-mono uppercase tracking-widest text-[#2A2027]/[0.45]">
                                {selectedInCat}/{items.length} seçili
                              </div>
                            </div>
                          </div>
                          <button type="button" onClick={() => toggleCategory(items)}
                            className={`border px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                              allSelected
                                ? 'border-[#BE7690]/[0.75] bg-[#f0aac2]/[0.15] text-[#A5556E]'
                                : 'border-[#EAD8DF]/[0.70] bg-white/[0.78] text-[#2A2027]/[0.65] hover:bg-[#f9dce7]/[0.55]'
                            }`}>
                            {allSelected ? 'Tümünü kaldır' : 'Tümünü seç'}
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {items.map((item) => {
                            const checked = form.features.has(item.key)
                            return (
                              <label key={item.key}
                                className={`flex cursor-pointer items-start gap-2.5 rounded-[16px] border p-2.5 transition-colors ${
                                  checked
                                    ? 'border-[#BE7690]/[0.75] bg-gradient-to-br from-[#f0aac2]/[0.10] to-[#ffd3df]/[0.05]'
                                    : 'border-[#EAD8DF]/[0.70] bg-white/[0.72] hover:border-[#EAD8DF]/[0.70] hover:bg-white/[0.78]'
                                }`}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => toggleFeature(item.key)}
                                  className="mt-0.5 h-3.5 w-3.5 accent-[#f0aac2]" />
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[12px] ${checked ? 'text-[#A5556E]' : 'text-[#2A2027]/[0.85]'}`}>
                                    {item.name}
                                  </div>
                                  <div className="mt-0.5 text-[10px] leading-snug text-[#2A2027]/[0.45]">
                                    {item.description}
                                  </div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-[#EAD8DF]/[0.70] bg-white/[0.95] px-6 py-3">
              <AnimatePresence>
                {err && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mb-2 border border-rose-300/30 bg-rose-400/10 px-3 py-1.5 text-[11px] text-rose-700">
                    {err}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.45]">
                  {selectedFeatures}/{totalFeatures} özellik · {limitText(form.maxBranches)} şube · {limitText(form.maxStaff)} personel
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)}
                    className="rounded-full border border-[#EAD8DF]/[0.80] bg-white/[0.72] px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-[#2A2027]/[0.75] transition-colors hover:bg-[#fff2f6]/[0.90]">
                    Vazgeç
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#BE7690]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[11px] font-mono uppercase tracking-widest text-[#2f1724] shadow-[0_12px_28px_-18px_rgba(200,87,118,0.55)] transition-opacity hover:opacity-90 disabled:opacity-50">
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : mode === 'create' ? <Zap className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                    {mode === 'create' ? 'Paketi oluştur' : 'Değişiklikleri kaydet'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const inputClass =
  'h-10 w-full rounded-[14px] border border-[#EAD8DF]/[0.80] bg-white/[0.88] px-3 text-[12px] text-[#2A2027] outline-none transition-colors placeholder:text-[#8f7784]/[0.45] focus:border-[#f0aac2]/[0.85] focus:bg-white'

function Field({
  label, helper, required, fullWidth, children,
}: { label: string; helper?: string; required?: boolean; fullWidth?: boolean; children: ReactNode }) {
  return (
    <div className={fullWidth ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.65]">
          {label}{required && <span className="ml-1 text-[#A5556E]">*</span>}
        </label>
      </div>
      {children}
      {helper && <p className="mt-1 text-[10px] leading-snug text-[#2A2027]/[0.45]">{helper}</p>}
    </div>
  )
}

/**
 * Hacim kademesi düzenleyici — "eşik ÜZERİ aylık ek ücret" satırları. Satırlar eşik sırasıyla
 * gösterilir; sunucu da aynı sıraya dizer ve aynı eşiği iki kez kabul etmez.
 */
function TierEditor({ title, unit, hint, tiers, onChange }: {
  title: string
  unit: string
  hint: string
  tiers: PricingTier[]
  onChange: (tiers: PricingTier[]) => void
}) {
  const set = (i: number, patch: Partial<PricingTier>) => onChange(tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const add = () => {
    const last = tiers.length ? Math.max(...tiers.map((t) => t.above)) : 5_000
    onChange([...tiers, { above: last + 5_000, monthlyFee: 0 }])
  }
  return (
    <div className="rounded-[16px] border border-[#EAD8DF]/[0.80] bg-white/[0.86] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[#2A2027]">{title}</span>
        <button type="button" onClick={add} disabled={tiers.length >= 10}
          className="inline-flex items-center gap-1 rounded-full border border-[#EAD8DF] px-2.5 py-1 text-[11px] font-semibold text-[#A5556E] hover:bg-[#fff1f6] disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Kademe
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#5A4B53]">{hint}</p>
      {tiers.length === 0 ? (
        <div className="mt-2 rounded-[12px] border border-dashed border-[#EAD8DF] px-3 py-2 text-[11px] text-[#74616A]">Kademe yok — sayıdan bağımsız ek ücret alınmaz.</div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <label className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-[#74616A]">&gt;</span>
                <input type="number" min={0} step={1} value={t.above} aria-label={`Eşik (${unit})`}
                  onChange={(e) => set(i, { above: Number(e.target.value) })}
                  className={inputClass + ' pl-6'} />
              </label>
              <label className="relative">
                <input type="number" min={0} step="0.01" value={t.monthlyFee} aria-label="Aylık ek ücret (₺, KDV hariç)"
                  onChange={(e) => set(i, { monthlyFee: Number(e.target.value) })}
                  className={inputClass + ' pr-16'} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#74616A]">₺/ay +KDV</span>
              </label>
              <button type="button" onClick={() => onChange(tiers.filter((_, k) => k !== i))} aria-label="Kademeyi sil"
                className="rounded-full p-1.5 text-[#B23252] hover:bg-rose-50">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-[10px] text-[#74616A]">
            <span>{unit} sayısı ÜZERİ</span><span>aylık ek ücret</span><span />
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ icon: Icon, children, className = '' }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <div className={`mb-2.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/[0.75] ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
      <span className="ml-2 h-px flex-1 bg-gradient-to-r from-[#f0aac2]/[0.35] to-transparent" />
    </div>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[#EAD8DF]/[0.70] pb-2">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#2A2027]/[0.55]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-display text-sm tabular-nums text-[#2A2027]">{value}</div>
    </div>
  )
}

function limitText(n: number): string {
  return n < 0 ? '∞' : n.toLocaleString('tr-TR')
}

// Compat re-exports — diğer yerlerde kullanılan ikonlar için
export { BadgeCheck, CheckCircle2 }
