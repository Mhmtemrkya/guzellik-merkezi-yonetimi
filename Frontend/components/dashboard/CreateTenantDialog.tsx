'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { platformApi } from '@/lib/apiClient'
import type { ApiTenantAvailability, ApiTenantCredentials, ApiTenantWithCredentials } from '@/lib/types'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react'

export interface CreateTenantFormValues {
  name: string
  slug: string
  plan: string
  /** "Trial" | "Monthly" | "Yearly" — ücretli dönem seçilirse kurum hemen aktif abonelikle oluşur. */
  billingPeriod: string
  domain: string
  ownerName: string
  ownerEmail: string
  initialPassword: string
  defaultBranchName: string
  defaultBranchCity: string
  phone: string
  email: string
}

/** Plan seçeneği — dönem bazlı tutar gösterimi için aylık/yıllık fiyatları taşır. */
export interface CreateTenantPlanOption {
  name: string
  monthlyPriceTRY: number
  yearlyPriceTRY: number
}

const PERIOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Trial', label: 'Deneme (14 Gün)' },
  { value: 'Monthly', label: 'Aylık' },
  { value: 'Yearly', label: 'Yıllık' },
]

function formatTRY(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n)
}

interface CreateTenantDialogProps {
  plans: CreateTenantPlanOption[]
  /** Kurum oluşturur; şifre boş bırakıldıysa backend credentials döndürür. */
  onCreate: (values: CreateTenantFormValues) => Promise<ApiTenantWithCredentials | void>
  /** Otomatik şifre üretildiyse ayrı credentials modalını açmak için. */
  onCredentials?: (credentials: ApiTenantCredentials) => void
}

type AutoField = 'slug' | 'domain' | 'ownerEmail'

const autoFields: AutoField[] = ['slug', 'domain', 'ownerEmail']

function initialValues(plan: string): CreateTenantFormValues {
  return {
    name: '',
    slug: '',
    plan: plan || 'Profesyonel',
    billingPeriod: 'Yearly',
    domain: '',
    ownerName: '',
    ownerEmail: '',
    initialPassword: '',
    defaultBranchName: 'Merkez Şube',
    defaultBranchCity: 'İstanbul',
    phone: '',
    email: '',
  }
}

function isAutoField(key: keyof CreateTenantFormValues): key is AutoField {
  return autoFields.includes(key as AutoField)
}

// --- Client-side türetme (backend TenantService ile birebir aynı kurallar) ---
const TENANT_DOMAIN_SUFFIX = 'beautyassist.app'

function transliterateTurkish(value: string): string {
  return value
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
}

/** Kurum adından URL-safe slug üretir. Boşsa boş döner (placeholder görünsün). */
function deriveSlug(name: string): string {
  const source = transliterateTurkish((name || '').trim()).toLowerCase()
  let out = ''
  for (const c of source) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) out += c
    else if (/\s/.test(c) || c === '-' || c === '_' || c === '.' || c === '/') out += '-'
  }
  return out.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/** Slug'tan domain üretir: "slug.beautyassist.app". Slug boşsa boş döner. */
function deriveDomain(slug: string): string {
  const s = slug.trim()
  return s ? `${s}.${TENANT_DOMAIN_SUFFIX}` : ''
}

/** Yetkili adından e-posta local kısmını üretir: "selin.demir". */
function deriveEmailLocal(name: string): string {
  const source = transliterateTurkish((name || '').trim()).toLowerCase()
  let out = ''
  for (const c of source) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) out += c
    else if (/\s/.test(c) || c === '-' || c === '_' || c === '.') out += '.'
  }
  return out.replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '')
}

function deriveEmail(ownerName: string, domain: string): string {
  const local = deriveEmailLocal(ownerName)
  return local && domain ? `${local}@${domain}` : ''
}

/**
 * Auto alanları (slug/domain/ownerEmail) kaynaklarından canlı türetir.
 * `dirty` olan (kullanıcının elle değiştirdiği) alanlara dokunulmaz.
 */
function deriveAuto(values: CreateTenantFormValues, dirty: Record<AutoField, boolean>): CreateTenantFormValues {
  const slug = dirty.slug ? values.slug : deriveSlug(values.name)
  const domain = dirty.domain ? values.domain : deriveDomain(slug)
  const ownerEmail = dirty.ownerEmail ? values.ownerEmail : deriveEmail(values.ownerName, domain)
  if (slug === values.slug && domain === values.domain && ownerEmail === values.ownerEmail) return values
  return { ...values, slug, domain, ownerEmail }
}

function fieldLabel(field: string): string {
  if (field === 'name') return 'Kurum adı'
  if (field === 'slug') return 'Slug'
  if (field === 'domain') return 'Domain'
  if (field === 'ownerEmail') return 'Yetkili e-postası'
  return field
}

const inputCls =
  'min-h-11 w-full border border-[#ead8df]/[0.70] bg-white/[0.90] px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors placeholder:text-[#352432]/[0.25] focus:border-[#efbfd0]/[0.75]'

export default function CreateTenantDialog({ plans, onCreate, onCredentials }: CreateTenantDialogProps) {
  const defaultPlan = plans[0]?.name || 'Profesyonel'
  const defaults = useMemo(() => initialValues(defaultPlan), [defaultPlan])
  const planNames = plans.length ? plans.map((p) => p.name) : ['Başlangıç', 'Profesyonel', 'Premium', 'AI Klinik', 'Enterprise']

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<CreateTenantFormValues>(defaults)
  const [availability, setAvailability] = useState<ApiTenantAvailability | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [availabilityNotice, setAvailabilityNotice] = useState('')

  // Hangi auto alanlar kullanıcı tarafından elle değiştirildi (dirty) → türetme dokunmaz.
  const dirtyRef = useRef<Record<AutoField, boolean>>({ slug: false, domain: false, ownerEmail: false })
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!open) {
      setValues(defaults)
      setAvailability(null)
      setAvailabilityNotice('')
      setSubmitError('')
      setSaved(false)
      setChecking(false)
      dirtyRef.current = { slug: false, domain: false, ownerEmail: false }
    }
  }, [defaults, open])

  // Backend yalnızca ÇAKIŞMA durumunda suffix'li öneri verir; onu sadece
  // kullanıcının elle değiştirmediği (auto) alanlara yazarız.
  const applyAvailability = useCallback((result: ApiTenantAvailability): void => {
    const conflictFields = new Set(result.conflicts.map((conflict) => conflict.field))
    const suggestions: Array<[AutoField, string]> = [
      ['slug', result.suggestedSlug],
      ['domain', result.suggestedDomain],
      ['ownerEmail', result.suggestedOwnerEmail],
    ]

    setValues((current) => {
      let changed = false
      const next: CreateTenantFormValues = { ...current }
      for (const [field, suggestion] of suggestions) {
        if (!suggestion) continue
        if (dirtyRef.current[field]) continue // kullanıcı override etti, dokunma
        if (conflictFields.has(field) && next[field] !== suggestion) {
          next[field] = suggestion
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [])

  // Her tuş vuruşunda auto alanları kaynaklarından canlı yeniden türetir.
  const updateField = <K extends keyof CreateTenantFormValues>(key: K, value: CreateTenantFormValues[K]): void => {
    setSubmitError('')
    setAvailabilityNotice('')
    setSaved(false)
    if (isAutoField(key)) {
      // Elle yazıldıysa dirty; tamamen silindiyse tekrar auto moda döner.
      dirtyRef.current = { ...dirtyRef.current, [key]: String(value || '').trim() !== '' }
    }
    setValues((current) => deriveAuto({ ...current, [key]: value }, dirtyRef.current))
  }

  useEffect(() => {
    if (!open) return
    const hasAnySeed = Boolean(
      values.name.trim() || values.slug.trim() || values.domain.trim() || values.ownerName.trim() || values.ownerEmail.trim(),
    )

    if (!hasAnySeed) {
      setAvailability(null)
      setChecking(false)
      return
    }

    const timer = window.setTimeout(async () => {
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      setChecking(true)
      try {
        const result = await platformApi.tenantAvailability<ApiTenantAvailability>({
          name: values.name,
          slug: values.slug,
          domain: values.domain,
          ownerName: values.ownerName,
          ownerEmail: values.ownerEmail,
        })
        if (requestSeq.current !== seq) return
        setAvailability(result)
        applyAvailability(result)
        if (result.conflicts.length) {
          const details = result.conflicts
            .map((conflict) => `${fieldLabel(conflict.field)}: ${conflict.suggestedValue || 'öneri hazırlanıyor'}`)
            .join(' · ')
          setAvailabilityNotice(`Bazı değerler daha önce kullanılmış. Uygun öneriler hazırlandı: ${details}`)
        } else {
          setAvailabilityNotice('')
        }
      } catch (error: unknown) {
        if (requestSeq.current !== seq) return
        const message = error instanceof Error ? error.message : 'Uygunluk kontrolü yapılamadı.'
        setSubmitError(message || 'Uygunluk kontrolü yapılamadı.')
      } finally {
        if (requestSeq.current === seq) setChecking(false)
      }
    }, 450)

    return () => window.clearTimeout(timer)
  }, [applyAvailability, open, values.domain, values.name, values.ownerEmail, values.ownerName, values.slug])

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
  }

  const handleUseSuggestedName = (): void => {
    const suggested = availability?.suggestedName || availability?.conflicts.find((x) => x.field === 'name')?.suggestedValue || ''
    if (!suggested) return
    updateField('name', suggested)
    setAvailabilityNotice('Önerilen kurum adı forma yazıldı; slug, domain ve e-posta yeniden kontrol ediliyor.')
  }

  const handleSubmit = async (): Promise<void> => {
    setSaving(true)
    setSubmitError('')
    setSaved(false)
    try {
      const missing = [
        ['Kurum adı', values.name],
        ['Slug', values.slug],
        ['Plan', values.plan],
        ['Domain', values.domain],
      ].filter(([, value]) => !String(value || '').trim())

      if (missing.length) {
        setSubmitError(`Zorunlu alanları doldurun: ${missing.map(([label]) => label).join(', ')}`)
        return
      }

      const result = await platformApi.tenantAvailability<ApiTenantAvailability>({
        name: values.name,
        slug: values.slug,
        domain: values.domain,
        ownerName: values.ownerName,
        ownerEmail: values.ownerEmail,
      })
      setAvailability(result)
      applyAvailability(result)

      if (result.conflicts.length) {
        const message = result.conflicts
          .map((conflict) => `${fieldLabel(conflict.field)} kullanılıyor${conflict.suggestedValue ? ` → öneri: ${conflict.suggestedValue}` : ''}`)
          .join(' · ')
        setAvailabilityNotice(`Çakışma bulundu. ${message}`)
        setSubmitError('Önerilen değerleri kontrol edip tekrar oluşturun.')
        return
      }

      const submitValues: CreateTenantFormValues = {
        ...values,
        name: (result.suggestedName || values.name).trim(),
        slug: result.suggestedSlug || values.slug,
        domain: result.suggestedDomain || values.domain,
        ownerEmail: result.suggestedOwnerEmail || values.ownerEmail,
        // Backend uzunluk limitlerine (telefon 40) takılıp 500 üretmemek için submit öncesi trim.
        phone: values.phone.trim(),
        email: values.email.trim(),
        ownerName: values.ownerName.trim(),
      }

      setValues(submitValues)
      const created = await onCreate(submitValues)
      setSaved(true)

      // Şifre boş bırakıldıysa backend otomatik geçici şifre üretip credentials döner.
      // Bu durumda create modalı kapanır ve AYRI credentials modalı açılır.
      const creds = created && (created as ApiTenantWithCredentials).credentials
      if (creds) {
        setOpen(false)
        window.setTimeout(() => onCredentials?.(creds), 280)
      } else {
        window.setTimeout(() => setOpen(false), 900)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Kurum oluşturulamadı.'
      setSubmitError(message || 'Kurum oluşturulamadı.')
    } finally {
      setSaving(false)
    }
  }

  const selectedPlan = plans.find((p) => p.name === values.plan)
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === values.billingPeriod)?.label ?? 'Yıllık'
  const amountLabel = ((): string => {
    if (values.billingPeriod === 'Trial') return '14 gün ücretsiz deneme'
    if (!selectedPlan) return '—'
    const price = values.billingPeriod === 'Yearly' ? selectedPlan.yearlyPriceTRY : selectedPlan.monthlyPriceTRY
    const suffix = values.billingPeriod === 'Yearly' ? '/yıl' : '/ay'
    return price <= 0 ? 'Özel teklif' : `${formatTRY(price)} ${suffix}`
  })()

  const hasConflict = Boolean(availability?.conflicts.length)
  const allAvailable = Boolean(
    availability &&
      !hasConflict &&
      values.name.trim() &&
      values.slug.trim() &&
      values.domain.trim() &&
      availability.nameAvailable &&
      availability.slugAvailable &&
      availability.domainAvailable &&
      availability.ownerEmailAvailable,
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="group relative inline-flex min-h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-[12px] border border-[#d65f83]/45 bg-gradient-to-r from-[#f2789c] via-[#ef6f94] to-[#d65f83] px-4 py-2 text-[11px] font-mono tracking-widest text-white shadow-[0_14px_28px_-14px_rgba(214,95,131,0.85)] transition-transform hover:-translate-y-0.5 sm:w-auto">
          <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-white/0 via-white/25 to-white/0 transition-transform duration-700 group-hover:translate-x-full" />
          <Plus className="relative z-10 h-3.5 w-3.5" strokeWidth={2.2} />
          <span className="relative z-10">YENİ KURUM</span>
          <ChevronDown className="relative z-10 h-3.5 w-3.5 opacity-80" />
        </button>
      </DialogTrigger>

      <DialogContent
        className="flex h-[94dvh] grid-rows-none flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1320px)', maxWidth: 'min(96vw, 1320px)', height: '94dvh', maxHeight: '94dvh' }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0aac2]/[0.25] blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -left-20 bottom-20 h-60 w-60 rounded-full bg-[#ffd3df]/[0.18] blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.045]" />

          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-4 pr-12 text-left sm:px-7 sm:py-4 sm:pr-14 lg:px-8">
            <div className="flex items-start gap-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]">
                <Sparkles className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="armo-pill !text-[9px]">
                  <span className="armo-pill-dot" />
                  Platform tenant kaydı
                </div>
                <DialogTitle className="armo-heading mt-1.5 break-words text-2xl tracking-tight lg:text-3xl">
                  <span className="armo-shimmer">Yeni kurum oluştur</span>
                </DialogTitle>
                <DialogDescription className="mt-1.5 max-w-3xl text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                  Kurum adı ve yetkili adına göre slug, domain ve yetkili e-postası otomatik önerilir; backend gerçek kayıtlarla çakışma kontrolü yapar.
                </DialogDescription>
              </div>
            </div>
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto p-5 sm:p-7 lg:p-8">
            <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
              <section className="space-y-5">
                <div className="border border-[#efbfd0]/[0.75] bg-gradient-to-br from-[#f0aac2]/[0.10] via-[#fff4f8]/[0.02] to-transparent p-3 text-[11px] leading-relaxed text-[#352432]/[0.70]">
                  <Sparkles className="mr-1 inline h-3 w-3 text-[#c85776]" />
                  Kurum adını yazdıkça slug ve domain; yetkili adını yazdıkça yetkili e-postası anlık (her tuşta) güncellenir. Kullanılmış değer varsa uyarı ve öneri gösterilir. Bir alanı elle değiştirirsen o alan sabit kalır.
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormInput
                    label="Kurum adı"
                    value={values.name}
                    onChange={(value) => updateField('name', value)}
                    placeholder="Örn. BeautyAssist Nişantaşı"
                    helper={availability?.nameAvailable === false ? `Önerilen ad: ${availability.suggestedName}` : 'Slug ve domain bu ada göre hazırlanır.'}
                  />
                  <FormInput
                    label="Slug"
                    value={values.slug}
                    onChange={(value) => updateField('slug', value)}
                    placeholder="beautyassist-nisantasi"
                    helper="Kurum adından anlık üretilir; elle yazarsan sabit kalır, silersen tekrar otomatik olur."
                  />
                  <FormSelect
                    label="Plan"
                    value={values.plan}
                    options={planNames}
                    onChange={(value) => updateField('plan', value)}
                  />
                  <FormSelect
                    label="Dönem"
                    value={values.billingPeriod}
                    options={PERIOD_OPTIONS}
                    onChange={(value) => updateField('billingPeriod', value)}
                    helper={
                      values.billingPeriod === 'Trial'
                        ? '14 günlük deneme — sayaç yetkilinin ilk girişinde başlar.'
                        : `Ücretli abonelik hemen başlar · ${amountLabel} · süre dolunca kurum pasife düşer.`
                    }
                  />
                  <FormInput
                    label="Domain"
                    value={values.domain}
                    onChange={(value) => updateField('domain', value)}
                    placeholder="beautyassist-nisantasi.beautyassist.app"
                    helper="Slug'a göre anlık üretilir; elle değiştirebilirsin."
                  />
                  <FormInput
                    label="Yetkili adı"
                    value={values.ownerName}
                    onChange={(value) => updateField('ownerName', value)}
                    placeholder="Örn. Selin Demir"
                    helper="Yetkili e-postası bu ada ve domain’e göre anlık hazırlanır."
                  />
                  <FormInput
                    label="Yetkili e-posta"
                    type="email"
                    value={values.ownerEmail}
                    onChange={(value) => updateField('ownerEmail', value)}
                    placeholder="selin.demir@beautyassist-nisantasi.beautyassist.app"
                  />
                  <FormInput
                    label="Kurum telefonu"
                    type="tel"
                    value={values.phone}
                    onChange={(value) => updateField('phone', value)}
                    placeholder="+90 312 123 45 67"
                    helper="Kurumun resmi iletişim telefonu (opsiyonel)."
                    maxLength={40}
                  />
                  <FormInput
                    label="Kurum e-postası"
                    type="email"
                    value={values.email}
                    onChange={(value) => updateField('email', value)}
                    placeholder="info@kurum.com.tr"
                    helper="Kurumun resmi iletişim e-postası (opsiyonel)."
                  />
                  <FormInput
                    label="İlk parola (opsiyonel)"
                    value={values.initialPassword}
                    onChange={(value) => updateField('initialPassword', value)}
                    placeholder="Boşsa backend varsayılan geçici parolayı kullanır"
                  />
                  <FormInput
                    label="Varsayılan şube"
                    value={values.defaultBranchName}
                    onChange={(value) => updateField('defaultBranchName', value)}
                    placeholder="Merkez Şube"
                  />
                  <FormInput
                    label="Şehir"
                    value={values.defaultBranchCity}
                    onChange={(value) => updateField('defaultBranchCity', value)}
                    placeholder="İstanbul"
                  />
                </div>

                {(availabilityNotice || hasConflict || allAvailable || checking) && (
                  <div
                    className={`border p-3 text-[11px] leading-5 ${
                      hasConflict || availabilityNotice
                        ? 'border-amber-300/30 bg-amber-400/10 text-amber-800'
                        : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-700'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {checking ? (
                        <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
                      ) : hasConflict || availabilityNotice ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4" />
                      )}
                      <div className="min-w-0 flex-1">
                        {checking && 'Uygunluk kontrol ediliyor...'}
                        {!checking && availabilityNotice && availabilityNotice}
                        {!checking && !availabilityNotice && allAvailable && 'Kurum adı, slug, domain ve yetkili e-postası uygun görünüyor.'}
                        {!checking && availability?.conflicts?.map((conflict) => (
                          <div key={`${conflict.field}-${conflict.value || ''}`} className="mt-1">
                            <span className="font-medium">{fieldLabel(conflict.field)}:</span> {conflict.message}
                            {conflict.suggestedValue && <span> Öneri: {conflict.suggestedValue}</span>}
                          </div>
                        ))}
                        {!checking && availability?.nameAvailable === false && (
                          <button
                            type="button"
                            onClick={handleUseSuggestedName}
                            className="mt-2 border border-amber-200/35 px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-amber-800 transition-colors hover:bg-amber-200/10"
                          >
                            Önerilen kurum adını kullan
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {submitError && (
                  <div className="border border-rose-300/30 bg-rose-400/12 p-3 text-[11px] leading-5 text-rose-700">
                    {submitError}
                  </div>
                )}

                {saved && (
                  <div className="flex items-center gap-2 border border-emerald-300/30 bg-emerald-400/10 p-3 text-[11px] font-mono uppercase tracking-widest text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Kurum API’ye kaydedildi.
                  </div>
                )}
              </section>

              <aside className="h-fit border border-[#ead8df]/[0.70] bg-white/[0.72] p-4 lg:sticky lg:top-0">
                <div className="armo-pill !text-[9px]">
                  <span className="armo-pill-dot" />
                  Canlı öneri
                </div>
                <div className="mt-4 space-y-3 text-[11px]">
                  <SummaryRow label="Kurum" value={values.name || 'Henüz yazılmadı'} />
                  <SummaryRow label="Plan" value={values.plan || '—'} />
                  <SummaryRow label="Dönem" value={periodLabel} />
                  <SummaryRow label="Tutar" value={amountLabel} />
                  <SummaryRow label="Slug" value={values.slug || 'Otomatik bekleniyor'} />
                  <SummaryRow label="Domain" value={values.domain || 'Otomatik bekleniyor'} />
                  <SummaryRow label="Yetkili" value={values.ownerName || 'Opsiyonel'} />
                  <SummaryRow label="E-posta" value={values.ownerEmail || 'Yetkili adıyla dolar'} />
                </div>
              </aside>
            </div>
          </div>

          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.75] bg-white/[0.78] p-4 shadow-[0_-18px_46px_-36px_rgba(120,71,88,0.45)] backdrop-blur-xl sm:px-7 sm:py-4 lg:px-10 lg:py-5">
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 border border-[#ead8df]/[0.70] bg-white/[0.72] px-5 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.72] transition-colors hover:border-[#efbfd0]/[0.75] hover:bg-[#f0aac2]/[0.08] hover:text-[#352432]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || checking || saved}
                className="group relative inline-flex min-h-11 items-center justify-center gap-2 overflow-hidden border border-[#efbfd0]/[0.75] bg-gradient-to-r from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] px-7 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#2f1724] shadow-[0_10px_28px_-8px_rgba(240,170,194,0.65)] transition-shadow disabled:opacity-70"
              >
                <span aria-hidden className="absolute inset-0 translate-y-full bg-white transition-transform duration-500 group-hover:translate-y-0" />
                <span className="relative z-10 flex items-center gap-2 transition-colors duration-500 group-hover:text-[#352432]">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {saving ? 'Oluşturuluyor' : 'Kurum oluştur'}
                </span>
              </button>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  helper,
  type = 'text',
  maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  helper?: string
  type?: string
  maxLength?: number
}) {
  return (
    <label className="group min-w-0">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.65] transition-colors group-focus-within:text-[#c85776]">
        {label}
      </div>
      <input type={type} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder || ''} className={inputCls} />
      {helper && <div className="mt-1.5 text-[10px] leading-relaxed text-[#352432]/[0.40]">{helper}</div>}
    </label>
  )
}

function FormSelect({
  label,
  value,
  options,
  onChange,
  helper,
}: {
  label: string
  value: string
  options: Array<string | { value: string; label: string }>
  onChange: (value: string) => void
  helper?: string
}) {
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <label className="group min-w-0">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.65] transition-colors group-focus-within:text-[#c85776]">
        {label}
      </div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${inputCls} appearance-none`}>
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helper && <div className="mt-1.5 text-[10px] leading-relaxed text-[#352432]/[0.40]">{helper}</div>}
    </label>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#ead8df]/[0.65] bg-white/[0.74] px-2.5 py-2">
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.40]">{label}</div>
      <div className="mt-1 break-words text-[12px] leading-tight text-[#c85776]/[0.90]">{value}</div>
    </div>
  )
}
