'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck,
  Bell,
  Boxes,
  Calendar,
  CalendarCheck,
  Camera,
  CheckCircle2,
  CircleUser,
  ClipboardList,
  Copy,
  Download,
  FileBarChart,
  Gift,
  Hourglass,
  Info,
  Key,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Package,
  PenLine,
  Phone,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { apiItems } from '@/lib/apiMappers'
import { downscaleImage } from '@/lib/imageUtils'
import { generateStaffCredentialsPdf } from '@/lib/staffCredentialsPdf'
import { useFeature } from '@/components/dashboard/FeatureContext'
import type { ApiCustomServiceCategory, ApiService, ApiStaffWithCredentials, ApiStaffCredentials, PermissionMeta } from '@/lib/types'

export interface StaffFormValues {
  fullName: string
  title: string
  phone: string
  specialties: string
  commissionRate: number
  isActive: boolean
  branchId: string
  email?: string
  permissions: string[]
  /** Personel fotoğrafı (data-URL) — sol önizleme avatarından yüklenir. */
  photoUrl?: string
}

export interface StaffFormDialogProps {
  mode: 'create' | 'edit'
  trigger: ReactNode
  branches: Array<{ id: string; name: string }>
  tenantId?: string
  tenantName?: string
  initialValues?: Partial<StaffFormValues>
  staffId?: string
  onSubmitted?: () => void | Promise<void>
}

// Stitch tasarım token'ları (rose-gold light): input, label
const fieldStyle =
  'w-full rounded-xl border border-[#efe1e7] bg-white px-4 py-2.5 text-sm text-[#241923] outline-none transition-all placeholder:text-[#705a66]/[0.45] hover:border-[#efbfd0] focus:border-[#c85776] focus:ring-2 focus:ring-[#c85776]/[0.15]'
const labelStyle = 'mb-1.5 block text-xs font-medium text-[#4a3a44]'

// Sayfa izin anahtarı → ikon (Stitch kartlarındaki ikonlu başlık için).
const PAGE_ICONS: Record<string, LucideIcon> = {
  Customers: Users,
  Appointments: Calendar,
  Waitlist: Hourglass,
  Services: Package,
  GiftCards: Gift,
  Stock: Boxes,
  CashRegister: Wallet,
  CashClosing: CalendarCheck,
  Accounting: Landmark,
  Reports: FileBarChart,
  Notifications: Bell,
  Logs: ClipboardList,
  Settings: Settings,
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('tr-TR')
}

export default function StaffFormDialog({
  mode,
  trigger,
  branches,
  tenantId,
  tenantName,
  initialValues,
  staffId,
  onSubmitted,
}: StaffFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Paket özellik kapıları
  const canStaffPermissions = useFeature('staff.permissions')
  const canPdfCredentials = useFeature('pdf.credentials')

  // İzin listesi (backend'den)
  const [permissions, setPermissions] = useState<PermissionMeta[]>([])
  const [permLoading, setPermLoading] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<string[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)

  // Credentials (sadece create mode'da, response sonrası)
  const [credentials, setCredentials] = useState<ApiStaffCredentials | null>(null)
  const [copiedField, setCopiedField] = useState<'email' | 'pwd' | null>(null)

  const defaults: StaffFormValues = {
    fullName: '',
    title: 'Estetisyen',
    phone: '',
    specialties: '',
    commissionRate: 10,
    isActive: true,
    branchId: branches[0]?.id || '',
    email: '',
    permissions: [],
    photoUrl: '',
  }
  const merged: StaffFormValues = { ...defaults, ...(initialValues || {}) }
  const [values, setValues] = useState<StaffFormValues>(merged)

  // Open olunca permission listesini bir kez çek
  useEffect(() => {
    if (!open) return
    setValues(merged)
    setError('')
    setCredentials(null)
    let cancelled = false
    setPermLoading(true)
    setServicesLoading(true)
    adminApi
      .staffPermissions<PermissionMeta>()
      .then((res) => {
        if (!cancelled) setPermissions(res)
      })
      .catch(() => {
        if (!cancelled) setPermissions([])
      })
      .finally(() => {
        if (!cancelled) setPermLoading(false)
      })
    // Uzmanlık = hizmet KATEGORİLERİ (Kategoriler sayfasıyla aynı havuz): özel kategoriler +
    // hizmetlerde kullanılan kategori adları. Seçilmeyen kategorideki hizmete randevu verilemez.
    Promise.all([
      adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
      adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
    ])
      .then(([servicesRes, catsRes]) => {
        if (cancelled) return
        const names = new Set<string>()
        for (const c of Array.isArray(catsRes) ? catsRes : []) {
          const n = (c.name || '').trim()
          if (n) names.add(n)
        }
        for (const s of apiItems(servicesRes)) {
          const n = (s.category || '').trim()
          if (n) names.add(n)
        }
        setServiceOptions(Array.from(names).sort((a, b) => a.localeCompare(b, 'tr')))
      })
      .catch(() => {
        if (!cancelled) setServiceOptions([])
      })
      .finally(() => {
        if (!cancelled) setServicesLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const visiblePermissions = useMemo(() => {
    const map = new Map<string, PermissionMeta>()
    const knownActionKeys = new Set<string>()
    permissions.forEach((p) => {
      map.set(p.key, p)
      p.actions?.forEach((a) => knownActionKeys.add(a.key))
    })
    values.permissions.forEach((key) => {
      // Katalogda olmayan anahtar: işlem izinleri karta dönüşmesin, yalnız bilinmeyen sayfa anahtarı göster.
      if (!map.has(key) && !knownActionKeys.has(key)) {
        map.set(key, {
          key,
          label: key,
          description: 'Mevcut personelde kayıtlı özel/legacy yetki. Kaldırmak için tekrar tıkla.',
        })
      }
    })
    return Array.from(map.values())
  }, [permissions, values.permissions])

  // Sayfa izni: açılınca sayfayla birlikte TÜM işlem izinleri verilir (yönetici istemediğini kapatır);
  // kapatılınca sayfa + altındaki işlem izinleri birlikte kaldırılır.
  const togglePermission = (page: PermissionMeta): void => {
    const actionKeys = (page.actions || []).map((a) => a.key)
    setValues((v) => {
      if (v.permissions.includes(page.key)) {
        const drop = new Set([page.key, ...actionKeys])
        return { ...v, permissions: v.permissions.filter((k) => !drop.has(k)) }
      }
      const next = new Set([...v.permissions, page.key, ...actionKeys])
      return { ...v, permissions: Array.from(next) }
    })
  }

  // İşlem izni: sayfa açıkken tek tek aç/kapat ("görsün ama yapamasın").
  const toggleAction = (actionKey: string): void => {
    setValues((v) =>
      v.permissions.includes(actionKey)
        ? { ...v, permissions: v.permissions.filter((k) => k !== actionKey) }
        : { ...v, permissions: [...v.permissions, actionKey] },
    )
  }

  const handleSelectAll = (): void =>
    setValues((v) => ({
      ...v,
      permissions: visiblePermissions.flatMap((p) => [p.key, ...(p.actions || []).map((a) => a.key)]),
    }))
  const handleSelectNone = (): void => setValues((v) => ({ ...v, permissions: [] }))
  const selectedPageCount = useMemo(
    () => visiblePermissions.filter((p) => values.permissions.includes(p.key)).length,
    [visiblePermissions, values.permissions],
  )
  const selectedActionCount = useMemo(
    () => values.permissions.filter((k) => k.includes('.')).length,
    [values.permissions],
  )
  const selectedSpecialties = useMemo(
    () => values.specialties.split(',').map((item) => item.trim()).filter(Boolean),
    [values.specialties],
  )
  const toggleSpecialty = (name: string): void => {
    setValues((v) => {
      const selected = v.specialties.split(',').map((item) => item.trim()).filter(Boolean)
      const next = selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]
      return { ...v, specialties: next.join(', ') }
    })
  }

  const buildPayload = (): Record<string, unknown> => ({
    branchId: values.branchId,
    fullName: values.fullName.trim(),
    title: values.title.trim(),
    phone: values.phone.trim() || null,
    specialties: values.specialties.trim() || null,
    commissionRate: Number(values.commissionRate || 0),
    isActive: values.isActive,
    email: values.email && values.email.trim().length > 0 ? values.email.trim() : null,
    permissions: values.permissions,
    photoUrl: values.photoUrl || null,
  })

  const handleCreate = async (): Promise<void> => {
    setError('')
    if (!values.fullName.trim()) {
      setError('Ad soyad boş olamaz.')
      return
    }
    if (!values.branchId) {
      setError('Şube seçimi zorunlu.')
      return
    }
    setBusy(true)
    try {
      const result = await adminApi.createStaff<ApiStaffWithCredentials>(buildPayload(), tenantId)
      if (result.credentials) {
        setCredentials(result.credentials)
      }
      await onSubmitted?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (): Promise<void> => {
    if (!staffId) return
    setError('')
    setBusy(true)
    try {
      const payload = buildPayload()
      // Update modda email/şube değiştirilmez; bu modal sadece HR alanları + yetki setini günceller.
      delete (payload as Record<string, unknown>).email
      delete (payload as Record<string, unknown>).branchId
      await adminApi.updateStaff(staffId, payload, tenantId)
      await onSubmitted?.()
      setOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Güncelleme başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const handleDownloadPdf = (): void => {
    if (!credentials || !credentials.email || !credentials.initialPassword) return
    const permMeta = visiblePermissions.filter((p) => values.permissions.includes(p.key))
    generateStaffCredentialsPdf({
      staffName: credentials.fullName || values.fullName,
      email: credentials.email || '',
      initialPassword: credentials.initialPassword || '',
      tenantName: credentials.tenantName || tenantName || 'Kurum',
      branchName: credentials.branchName || branches.find((b) => b.id === values.branchId)?.name || null,
      title: values.title,
      permissions: permMeta.map((p) => ({ key: p.key, label: p.label })),
    })
  }

  const copyToClipboard = async (text: string, field: 'email' | 'pwd'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // ignore
    }
  }

  const isEdit = mode === 'edit'
  // PDF yalnızca hem e-posta hem geçici şifre varken üretilebilir; eksikse boş/bozuk PDF üretmeyiz.
  const hasStaffCredentialValues = Boolean(credentials?.email && credentials?.initialPassword)
  const selectedBranchName = branches.find((b) => b.id === values.branchId)?.name || 'Şube seçilmedi'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setCredentials(null)
          setError('')
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[22px] border border-[#efe1e7] bg-white p-0 text-[#4a3a44] shadow-[0_18px_40px_-24px_rgba(200,87,118,0.45)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1180px)', maxWidth: 'min(96vw, 1180px)', height: 'min(92dvh, 860px)', maxHeight: '92dvh' }}
      >
        <DialogTitle className="sr-only">{isEdit ? 'Personeli düzenle' : 'Yeni personel oluştur'}</DialogTitle>
        <DialogDescription className="sr-only">
          Personel kimlik bilgileri, uzmanlık alanları ve sayfa/işlem yetkileri bu formdan yönetilir.
        </DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* ================= SOL — CANLI ÖNİZLEME (krem) ================= */}
          <aside className="relative z-10 flex w-full shrink-0 flex-col justify-between overflow-y-auto border-b border-[#efe1e7] bg-[#f7ecf1] p-6 md:w-80 md:border-b-0 md:border-r lg:w-[340px]">
            {/* Soluk gül + altın ışık lekeleri */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
              <div className="absolute -left-24 -top-24 h-48 w-48 rounded-full bg-[#c85776] blur-[60px]" />
              <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-[#b88938] blur-[60px]" />
            </div>

            <div className="relative z-10 flex flex-col items-center pt-6">
              {/* Avatar — rose-gold halka; fotoğraf varsa fotoğraf, yoksa baş harfler. Tıkla → yükle. */}
              <label
                title="Fotoğraf yükle / değiştir"
                className="group relative mb-5 block h-28 w-28 cursor-pointer rounded-full bg-gradient-to-tr from-[#ffd3df] via-[#e9a6bf] to-[#d9a441] p-[2px] shadow-[0_8px_20px_-12px_rgba(200,87,118,0.35)]"
              >
                <div className="grid h-full w-full place-items-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-[#f7ecf1] to-white">
                  {values.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={values.photoUrl} alt={values.fullName || 'Personel'} className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-display text-3xl font-medium tracking-widest text-[#c85776]">
                      {initialsOf(values.fullName)}
                    </span>
                  )}
                  {/* Hover overlay — kamera */}
                  <span className="absolute inset-[2px] grid place-items-center rounded-full bg-[#241923]/[0.40] opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera className="h-6 w-6 text-white" strokeWidth={1.6} />
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={Boolean(credentials)}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    try {
                      const dataUrl = await downscaleImage(file, 320)
                      setValues((v) => ({ ...v, photoUrl: dataUrl }))
                    } catch {
                      setError('Fotoğraf okunamadı. Farklı bir görsel deneyin.')
                    }
                  }}
                />
              </label>
              {values.photoUrl && !credentials && (
                <button
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, photoUrl: '' }))}
                  className="-mt-3 mb-3 text-[11px] font-medium text-[#705a66] transition-colors hover:text-[#c85776]"
                >
                  Fotoğrafı kaldır
                </button>
              )}

              {/* Ad / unvan / şube — CANLI */}
              <div className="mb-6 w-full text-center">
                <h2 className="font-display text-2xl font-medium text-[#241923]">
                  {values.fullName.trim() || 'Yeni Personel'}
                </h2>
                <p className="mt-0.5 text-sm font-medium text-[#c85776]">{values.title.trim() || 'Unvan'}</p>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-3 py-1 text-xs text-[#705a66]">
                  <MapPin className="h-3.5 w-3.5" />
                  {selectedBranchName}
                </div>
              </div>

              {/* İletişim satırları */}
              <div className="mb-6 w-full space-y-3 px-2">
                <div className="flex items-center gap-3 text-sm text-[#4a3a44]">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white">
                    <Phone className="h-4 w-4 text-[#c85776]" />
                  </div>
                  <span className="truncate">{values.phone.trim() || 'Telefon girilmedi'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[#4a3a44]">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white">
                    <Mail className="h-4 w-4 text-[#c85776]" />
                  </div>
                  <span className="truncate">
                    {credentials?.email || (isEdit ? 'E-posta değiştirilmez' : 'E-posta otomatik üretilir')}
                  </span>
                </div>
                {values.commissionRate > 0 && (
                  <div className="flex items-center gap-3 text-sm text-[#4a3a44]">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white">
                      <BadgeCheck className="h-4 w-4 text-[#b88938]" />
                    </div>
                    <span className="truncate">%{values.commissionRate} prim oranı</span>
                  </div>
                )}
              </div>
            </div>

            {/* Alt blok: yetki rozetleri + durum toggle */}
            <div className="relative z-10 mt-auto w-full space-y-4">
              {canStaffPermissions && (
                <div className="mb-2 flex justify-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-[#efe1e7] bg-white px-3 py-1.5 shadow-sm">
                    <FileBarChart className="h-4 w-4 text-[#b88938]" />
                    <span className="text-xs text-[#705a66]" style={{ fontFamily: 'var(--font-mono)' }}>
                      {selectedPageCount} SAYFA
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border border-[#efe1e7] bg-white px-3 py-1.5 shadow-sm">
                    <Wrench className="h-4 w-4 text-[#c85776]" />
                    <span className="text-xs text-[#705a66]" style={{ fontFamily: 'var(--font-mono)' }}>
                      {selectedActionCount} İŞLEM
                    </span>
                  </div>
                </div>
              )}

              {/* Personel Durumu toggle kartı */}
              <button
                type="button"
                disabled={Boolean(credentials)}
                onClick={() => setValues((v) => ({ ...v, isActive: !v.isActive }))}
                className="flex w-full items-center justify-between rounded-xl border border-[#efe1e7] bg-white p-4 text-left shadow-sm transition-colors hover:border-[#efbfd0] disabled:opacity-60"
              >
                <div>
                  <h4 className="text-sm font-medium text-[#241923]">Personel Durumu</h4>
                  <p className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${values.isActive ? 'text-[#2f9e72]' : 'text-[#d1556f]'}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${values.isActive ? 'bg-[#2f9e72]' : 'bg-[#d1556f]'}`} />
                    {values.isActive ? 'Aktif Personel' : 'Pasif — giriş yapamaz'}
                  </p>
                </div>
                {/* Toggle — topuz konumu left ile (transform tuzağına düşme) */}
                <span className={`relative inline-block h-6 w-12 shrink-0 rounded-full transition-colors ${values.isActive ? 'bg-[#c85776]' : 'bg-[#efe1e7]'}`}>
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${values.isActive ? 'left-[26px]' : 'left-0.5'}`}
                  />
                </span>
              </button>
            </div>
          </aside>

          {/* ================= SAĞ — FORM + YETKİLER (beyaz, iç scroll) ================= */}
          <div className="flex min-h-0 flex-1 flex-col bg-white">
            {/* İnce üst şerit — kapat butonu scroll çubuğuyla çakışmasın diye scroll alanının DIŞINDA */}
            <div className="flex shrink-0 items-center justify-end border-b border-[#efe1e7]/[0.60] px-4 py-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-[#705a66] transition-colors hover:bg-[#f7ecf1] hover:text-[#c85776]"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-10 overflow-y-auto p-6 pt-5 lg:p-8 lg:pt-6">
              {/* CREDENTIALS PANEL — sadece create + başarılı */}
              <AnimatePresence>
                {credentials && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl border border-emerald-300/40 bg-emerald-50/60 p-5"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Personel oluşturuldu — giriş bilgileri
                    </div>
                    <div className="mt-1 text-xs text-emerald-700/85">
                      Bu bilgiler bu ekranda sadece bir kez gösterilir. Personeline aktarmak için PDF olarak indir.
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-emerald-300/30 bg-white p-3">
                        <div className="flex items-center gap-1.5 text-xs text-[#705a66]">
                          <Mail className="h-3.5 w-3.5 text-[#c85776]" /> E-posta
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <code className="text-[13px] text-[#241923]" style={{ fontFamily: 'var(--font-mono)' }}>{credentials.email}</code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(credentials.email || '', 'email')}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-[#efe1e7] text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#241923]"
                            title="Kopyala"
                          >
                            {copiedField === 'email' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-300/30 bg-white p-3">
                        <div className="flex items-center gap-1.5 text-xs text-[#705a66]">
                          <Key className="h-3.5 w-3.5 text-[#c85776]" /> Geçici şifre
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <code className="text-sm font-bold text-[#c85776]" style={{ fontFamily: 'var(--font-mono)' }}>{credentials.initialPassword}</code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(credentials.initialPassword || '', 'pwd')}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-[#efe1e7] text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#241923]"
                            title="Kopyala"
                          >
                            {copiedField === 'pwd' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {canPdfCredentials && (
                      <>
                        {!hasStaffCredentialValues && (
                          <div className="mt-3 text-xs leading-relaxed text-rose-700">
                            Giriş bilgileri eksik geldiği için PDF oluşturulamıyor. Sayfayı yenileyip tekrar deneyin.
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={handleDownloadPdf}
                          disabled={!hasStaffCredentialValues}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-sm font-medium text-white shadow-[0_8px_20px_-12px_rgba(200,87,118,0.35)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                          Giriş bilgileri PDF&apos;i indir
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ---- Bölüm 1: Kimlik & İletişim ---- */}
              <section>
                <div className="mb-6 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f7ecf1]">
                    <CircleUser className="h-5 w-5 text-[#c85776]" />
                  </div>
                  <h3 className="font-display text-xl font-medium text-[#241923]">Kimlik &amp; İletişim</h3>
                </div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <label className={labelStyle}>Ad Soyad</label>
                    <input
                      type="text"
                      placeholder="Örn. Elif Aydın"
                      value={values.fullName}
                      onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
                      className={fieldStyle}
                      disabled={Boolean(credentials)}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Unvan</label>
                    <input
                      type="text"
                      placeholder="Estetisyen / Lazer Uzmanı / Resepsiyon"
                      value={values.title}
                      onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
                      className={fieldStyle}
                      disabled={Boolean(credentials)}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Telefon</label>
                    <div className="flex">
                      <span className="inline-flex items-center rounded-l-xl border border-r-0 border-[#efe1e7] bg-[#f7ecf1] px-3 text-sm text-[#705a66]">
                        +90
                      </span>
                      <input
                        type="tel"
                        placeholder="5__ ___ __ __"
                        value={values.phone}
                        maxLength={32}
                        onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
                        className={`${fieldStyle} rounded-l-none`}
                        disabled={Boolean(credentials)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelStyle}>Şube</label>
                    <select
                      value={values.branchId}
                      onChange={(e) => setValues((v) => ({ ...v, branchId: e.target.value }))}
                      className={`${fieldStyle} cursor-pointer ${isEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                      disabled={Boolean(credentials) || isEdit}
                    >
                      <option value="">— Şube seç —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    {isEdit && <div className="mt-1 text-xs text-[#705a66]">Şube değişikliği bu modaldan yapılmaz (güvenlik nedeniyle)</div>}
                  </div>
                  <div>
                    <label className={labelStyle}>Prim Oranı (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={values.commissionRate}
                        onChange={(e) => setValues((v) => ({ ...v, commissionRate: Number(e.target.value) }))}
                        className={`${fieldStyle} pr-8`}
                        disabled={Boolean(credentials)}
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#705a66]">%</span>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className={`${labelStyle} mb-2`}>Yapabildiği İşlem Kategorileri</label>
                    {servicesLoading ? (
                      <div className="flex items-center gap-2 text-sm text-[#705a66]">
                        <Loader2 className="h-4 w-4 animate-spin" /> Kategoriler yükleniyor...
                      </div>
                    ) : serviceOptions.length || selectedSpecialties.length ? (
                      <div className="flex flex-wrap gap-2">
                        {[...serviceOptions, ...selectedSpecialties.filter((s) => !serviceOptions.includes(s))].map((name) => {
                          const active = selectedSpecialties.includes(name)
                          return (
                            <button
                              key={name}
                              type="button"
                              disabled={Boolean(credentials)}
                              onClick={() => toggleSpecialty(name)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                                active
                                  ? 'border-[#c85776]/[0.20] bg-[#c85776]/[0.10] text-[#c85776] hover:bg-[#c85776]/[0.18]'
                                  : 'border-dashed border-[#efe1e7] bg-[#f7ecf1] text-[#705a66] hover:border-[#c85776]'
                              }`}
                            >
                              {active && <X className="h-3.5 w-3.5" />}
                              {name}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-[#705a66]">Kategori bulunamadı. Önce hizmetlere kategori atayın ya da Kategoriler sayfasından ekleyin.</div>
                    )}
                    <div className="mt-1.5 text-xs text-[#705a66]/[0.75]">
                      Personel yalnızca seçili kategorilerdeki hizmetlere randevu alabilir. <strong>Hiçbiri seçilmezse tüm kategorilerde çalışabilir.</strong>
                    </div>
                  </div>
                </div>
              </section>

              {/* ---- Bölüm 2: Rol & Sayfa Yetkileri ---- */}
              {canStaffPermissions && (
                <>
                  <hr className="border-[#efe1e7]" />
                  <section>
                    <div className="mb-6 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f7ecf1]">
                          <ShieldCheck className="h-5 w-5 text-[#c85776]" />
                        </div>
                        <div>
                          <h3 className="font-display text-xl font-medium text-[#241923]">Rol &amp; Sayfa Yetkileri</h3>
                          <p className="mt-1 text-xs text-[#705a66]">
                            Personelin görebileceği sayfaları ve yapabileceği işlemleri yönetin · {selectedPageCount}/{visiblePermissions.length} sayfa açık
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAll}
                          disabled={Boolean(credentials)}
                          className="rounded px-2 py-1 text-xs font-medium text-[#c85776] transition-colors hover:text-[#ef9ab5] disabled:opacity-50"
                        >
                          Tümü
                        </button>
                        <span className="text-[#efe1e7]">|</span>
                        <button
                          type="button"
                          onClick={handleSelectNone}
                          disabled={Boolean(credentials)}
                          className="rounded px-2 py-1 text-xs font-medium text-[#705a66] transition-colors hover:text-[#241923] disabled:opacity-50"
                        >
                          Hiçbiri
                        </button>
                      </div>
                    </div>

                    {permLoading ? (
                      <div className="grid h-32 place-items-center text-sm text-[#705a66]">
                        <Loader2 className="h-5 w-5 animate-spin text-[#c85776]" />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {visiblePermissions.map((p) => {
                          const active = values.permissions.includes(p.key)
                          const actions = p.actions || []
                          const PageIcon = PAGE_ICONS[p.key] || ClipboardList
                          return (
                            <div
                              key={p.key}
                              className={`relative overflow-hidden rounded-xl border transition-all ${
                                active
                                  ? 'border-[#c85776]/[0.30] bg-white shadow-sm'
                                  : 'border-[#efe1e7] bg-white opacity-70 hover:bg-[#f7ecf1]/[0.50] hover:opacity-90'
                              }`}
                            >
                              {/* Aktif sol vurgu şeridi */}
                              {active && <div className="absolute bottom-0 left-0 top-0 w-1 bg-[#c85776]" />}
                              <div className="flex items-start gap-4 p-4">
                                <button
                                  type="button"
                                  onClick={() => togglePermission(p)}
                                  disabled={Boolean(credentials)}
                                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors disabled:opacity-60 ${
                                    active ? 'border-[#c85776] bg-[#c85776]' : 'border-[#efe1e7] bg-white hover:border-[#efbfd0]'
                                  }`}
                                  aria-label={active ? `${p.label} sayfasını kapat` : `${p.label} sayfasını aç`}
                                >
                                  {active && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <button
                                    type="button"
                                    onClick={() => togglePermission(p)}
                                    disabled={Boolean(credentials)}
                                    className="w-full text-left disabled:opacity-60"
                                  >
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <h4 className="flex items-center gap-2 text-sm font-medium text-[#241923]">
                                        <PageIcon className={`h-[18px] w-[18px] ${active ? 'text-[#c85776]' : 'text-[#705a66]'}`} />
                                        {p.label}
                                      </h4>
                                      {active && (
                                        <span className="rounded bg-[#c85776]/[0.10] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#c85776]" style={{ fontFamily: 'var(--font-mono)' }}>
                                          AKTİF
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-xs text-[#705a66] ${active && actions.length ? 'mb-3' : ''}`}>
                                      {p.description}
                                    </p>
                                  </button>
                                  {/* İşlem çipleri — sayfa açıkken tek tek kapatılabilir ("görsün ama yapamasın") */}
                                  {active && actions.length > 0 && (
                                    <div className="flex flex-wrap gap-2 border-t border-dashed border-[#efe1e7] pt-2.5">
                                      {actions.map((a) => {
                                        const actionActive = values.permissions.includes(a.key)
                                        return (
                                          <button
                                            key={a.key}
                                            type="button"
                                            onClick={() => toggleAction(a.key)}
                                            disabled={Boolean(credentials)}
                                            title={actionActive ? 'İşlemi kapat — sayfayı görür ama bu işlemi yapamaz' : 'İşlemi aç'}
                                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                                              actionActive
                                                ? 'border-[#c85776]/[0.40] bg-white text-[#241923] shadow-sm'
                                                : 'border-[#efe1e7] bg-[#f7ecf1] text-[#705a66]/[0.60] line-through'
                                            }`}
                                          >
                                            <span
                                              className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${
                                                actionActive ? 'border-[#c85776] bg-[#c85776]' : 'border-[#d9c3ce] bg-white'
                                              }`}
                                            >
                                              {actionActive && <CheckCircle2 className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                                            </span>
                                            {a.label}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            {/* ================= FOOTER (sticky) ================= */}
            <div className="relative z-20 shrink-0 border-t border-[#efe1e7] bg-white p-4 px-6 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] md:px-8">
              {error && (
                <div className="mb-3 rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <div className="flex w-full items-center gap-2 rounded-lg bg-[#f7ecf1] px-3 py-1.5 text-[#705a66] sm:w-auto">
                  <Info className="h-[18px] w-[18px] text-[#b88938]" />
                  <p className="text-xs font-medium">
                    {credentials
                      ? 'Kayıt başarılı — PDF indirip kapatabilirsin.'
                      : 'Sayfa işaretlenince tüm işlemleri açılır; istemediğin işlemi çipten kapat.'}
                  </p>
                </div>
                <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
                  {credentials ? (
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-sm font-medium text-white shadow-[0_8px_20px_-12px_rgba(200,87,118,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(200,87,118,0.45)]"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Kapat
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        disabled={busy}
                        className="rounded-lg border border-[#efe1e7] bg-white px-5 py-2.5 text-sm font-medium text-[#4a3a44] transition-colors hover:bg-[#f7ecf1] disabled:opacity-50"
                      >
                        Vazgeç
                      </button>
                      <motion.button
                        type="button"
                        onClick={isEdit ? handleUpdate : handleCreate}
                        disabled={busy}
                        whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-sm font-medium text-white shadow-[0_8px_20px_-12px_rgba(200,87,118,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(200,87,118,0.45)] disabled:opacity-70"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? <PenLine className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                        {isEdit ? 'Personeli Güncelle' : 'Personeli Kaydet'}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

