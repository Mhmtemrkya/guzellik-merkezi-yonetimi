'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Briefcase,
  CheckCircle2,
  CircleUser,
  Copy,
  Download,
  FileText,
  Key,
  Loader2,
  Mail,
  Percent,
  PenLine,
  Phone,
  ShieldCheck,
  Sparkles,
  ToggleRight,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { generateStaffCredentialsPdf } from '@/lib/staffCredentialsPdf'
import { useFeature } from '@/components/dashboard/FeatureContext'
import type { ApiStaffWithCredentials, ApiStaffCredentials, PermissionMeta } from '@/lib/types'

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

const fieldStyle =
  'min-h-11 w-full rounded-[14px] border border-[#ead8df]/[0.80] bg-white/[0.88] px-3 py-2 text-sm text-[#352432] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors placeholder:text-[#8f7784]/[0.45] hover:border-[#efbfd0]/[0.85] focus:border-[#f0aac2]/[0.85] focus:bg-white focus:outline-none'
const labelStyle =
  'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]'
const helperStyle = 'mt-1 text-[10px] leading-relaxed text-[#352432]/[0.40]'

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
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const visiblePermissions = useMemo(() => {
    const map = new Map<string, PermissionMeta>()
    permissions.forEach((p) => map.set(p.key, p))
    values.permissions.forEach((key) => {
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: key,
          description: 'Mevcut personelde kayıtlı özel/legacy yetki. Kaldırmak için tekrar tıkla.',
        })
      }
    })
    return Array.from(map.values())
  }, [permissions, values.permissions])

  const togglePermission = (key: string): void => {
    setValues((v) =>
      v.permissions.includes(key)
        ? { ...v, permissions: v.permissions.filter((k) => k !== key) }
        : { ...v, permissions: [...v.permissions, key] },
    )
  }

  const handleSelectAll = (): void => setValues((v) => ({ ...v, permissions: visiblePermissions.map((p) => p.key) }))
  const handleSelectNone = (): void => setValues((v) => ({ ...v, permissions: [] }))

  const buildPayload = (): Record<string, unknown> => ({
    branchId: values.branchId,
    fullName: values.fullName.trim(),
    title: values.title.trim(),
    phone: values.phone || null,
    specialties: values.specialties || null,
    commissionRate: Number(values.commissionRate || 0),
    isActive: values.isActive,
    email: values.email && values.email.trim().length > 0 ? values.email.trim() : null,
    permissions: values.permissions,
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
    if (!credentials) return
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
        className="flex h-[94dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1400px)', maxWidth: 'min(96vw, 1400px)', height: '94dvh', maxHeight: '94dvh' }}
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
                {isEdit ? <PenLine className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} /> : <UserPlus className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />}
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/[0.80]">
                  Staff · {isEdit ? 'PUT' : 'POST'}
                </div>
                <DialogTitle className="mt-1 font-display text-2xl tracking-tight">
                  {isEdit ? `${values.fullName} · düzenle` : 'Yeni personel oluştur'}
                </DialogTitle>
                <DialogDescription className="mt-2 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  {isEdit
                    ? 'Personel bilgileri ve sayfa yetkileri oluşturma ekranındaki gibi güncellenir. Yetkiler eklenip çıkarıldığında hemen geçerli olur.'
                    : 'Personel oluşturulurken sistem otomatik e-posta ve geçici şifre üretir. Yetkilendirme verdiğin sayfalar personel panelinde görünür.'}
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
            {/* CREDENTIALS PANEL — sadece create + başarılı */}
            <AnimatePresence>
              {credentials && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-6 border border-emerald-300/30 bg-emerald-400/[0.06] p-5"
                >
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.26em] text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Personel oluşturuldu — giriş bilgileri
                  </div>
                  <div className="mt-2 text-[11px] text-emerald-700/85">
                    Bu bilgiler bu ekranda sadece bir kez gösterilir. Personeline aktarmak için PDF olarak indir.
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="border border-emerald-300/20 bg-white/[0.82] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-[#c85776]/[0.70]">
                        <Mail className="h-3 w-3" /> E-posta
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <code className="text-[13px] font-mono text-[#352432]">{credentials.email}</code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(credentials.email || '', 'email')}
                          className="grid h-6 w-6 place-items-center border border-[#ead8df]/[0.70] text-[#352432]/[0.55] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432]"
                          title="Kopyala"
                        >
                          {copiedField === 'email' ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="border border-emerald-300/20 bg-white/[0.82] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-[#c85776]/[0.70]">
                        <Key className="h-3 w-3" /> Geçici şifre
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <code className="text-[14px] font-mono font-bold text-[#c85776]">{credentials.initialPassword}</code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(credentials.initialPassword || '', 'pwd')}
                          className="grid h-6 w-6 place-items-center border border-[#ead8df]/[0.70] text-[#352432]/[0.55] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432]"
                          title="Kopyala"
                        >
                          {copiedField === 'pwd' ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  {canPdfCredentials && (
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Giriş bilgileri PDF'i indir
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelStyle}>
                  <CircleUser className="h-3 w-3" /> Ad soyad
                </label>
                <input
                  type="text"
                  placeholder="Örn. Elif Aydın"
                  value={values.fullName}
                  onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                  disabled={Boolean(credentials)}
                />
              </div>

              <div>
                <label className={labelStyle}>
                  <Briefcase className="h-3 w-3" /> Ünvan
                </label>
                <input
                  type="text"
                  placeholder="Estetisyen / Lazer Uzmanı / Resepsiyon"
                  value={values.title}
                  onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                  disabled={Boolean(credentials)}
                />
              </div>

              <div>
                <label className={labelStyle}>
                  <Phone className="h-3 w-3" /> Telefon
                </label>
                <input
                  type="text"
                  placeholder="+90 5__ ___ __ __"
                  value={values.phone}
                  onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                  disabled={Boolean(credentials)}
                />
              </div>

              <div className="sm:col-span-2">
                <label className={labelStyle}>
                  <Sparkles className="h-3 w-3" /> Uzmanlık alanı
                </label>
                <input
                  type="text"
                  placeholder="Lazer epilasyon, Hydrafacial"
                  value={values.specialties}
                  onChange={(e) => setValues((v) => ({ ...v, specialties: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                  disabled={Boolean(credentials)}
                />
              </div>

              <div>
                <label className={labelStyle}>
                  <Percent className="h-3 w-3" /> Komisyon oranı
                </label>
                <div className="relative mt-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={values.commissionRate}
                    onChange={(e) => setValues((v) => ({ ...v, commissionRate: Number(e.target.value) }))}
                    className={fieldStyle}
                    disabled={Boolean(credentials)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.55]">%</span>
                </div>
              </div>

              <div>
                <label className={labelStyle}>
                  <Briefcase className="h-3 w-3" /> Şube
                </label>
                <select
                  value={values.branchId}
                  onChange={(e) => setValues((v) => ({ ...v, branchId: e.target.value }))}
                  className={`mt-2 ${fieldStyle}`}
                  disabled={Boolean(credentials) || isEdit}
                >
                  <option value="">— Şube seç —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {isEdit && <div className={helperStyle}>Şube değişikliği bu modaldan yapılmaz (güvenlik nedeniyle)</div>}
              </div>

              <label className="flex cursor-pointer items-center gap-2 border border-[#ead8df]/[0.70] bg-white/[0.82] px-3 py-2.5 text-[12px] text-[#352432]/[0.85] transition-colors hover:border-[#efbfd0]/[0.75] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))}
                  className="h-4 w-4"
                  disabled={Boolean(credentials)}
                />
                <ToggleRight className="h-3.5 w-3.5 text-[#c85776]" strokeWidth={1.6} />
                <span>Aktif kadro — pasif personel randevuya atanamaz, giriş yapamaz</span>
              </label>

              {/* Permission grid — sadece paket staff.permissions içeriyorsa */}
              {canStaffPermissions && (
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className={labelStyle}>
                    <ShieldCheck className="h-3 w-3" /> Rol / sayfa yetkileri
                    <span className="ml-1 text-[#352432]/[0.35]">({values.permissions.length}/{visiblePermissions.length})</span>
                  </label>
                  <div className="flex gap-1.5 text-[9px] font-mono uppercase tracking-widest">
                    <button type="button" onClick={handleSelectAll} disabled={Boolean(credentials)} className="border border-[#ead8df]/[0.70] px-2 py-0.5 text-[#352432]/[0.65] hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50">
                      Tümü
                    </button>
                    <button type="button" onClick={handleSelectNone} disabled={Boolean(credentials)} className="border border-[#ead8df]/[0.70] px-2 py-0.5 text-[#352432]/[0.65] hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50">
                      Hiçbiri
                    </button>
                  </div>
                </div>
                {permLoading ? (
                  <div className="mt-2 grid h-32 place-items-center text-sm text-[#352432]/[0.45]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {visiblePermissions.map((p) => {
                      const active = values.permissions.includes(p.key)
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => togglePermission(p.key)}
                          disabled={Boolean(credentials)}
                          className={`group border px-2.5 py-2 text-left transition-colors ${
                            active
                              ? 'border-[#efbfd0]/[0.75] bg-[#f0aac2]/[0.08] text-[#352432]'
                              : 'border-[#ead8df]/[0.70] bg-white/[0.72] text-[#352432]/[0.65] hover:border-[#efbfd0]/[0.75] hover:text-[#352432]'
                          } disabled:opacity-60`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border ${
                                active ? 'border-[#ffd3df] bg-[#ffd3df]/[0.15]' : 'border-[#ead8df]/[0.70]'
                              }`}
                            >
                              {active && <CheckCircle2 className="h-3 w-3 text-[#c85776]" />}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium">{p.label}</div>
                              <div className="mt-0.5 text-[9px] leading-tight text-[#352432]/[0.50]">{p.description}</div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className={helperStyle}>Eklediğin roller personel panelinde görünür, çıkardıkların hemen kaldırılır. Kritik işlemler kurum yöneticisi onayına düşer.</div>
              </div>
              )}
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
                {credentials ? 'Kayıt başarılı · PDF indirip kapatabilirsin' : isEdit ? 'Bilgi ve yetki değişiklikleri kaydedilir' : 'E-posta ve şifre otomatik üretilir'}
              </div>
              <div className="flex gap-2">
                {credentials ? (
                  <motion.button
                    type="button"
                    onClick={() => setOpen(false)}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724]"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Kapat
                  </motion.button>
                ) : (
                  <>
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
                      onClick={isEdit ? handleUpdate : handleCreate}
                      disabled={busy}
                      whileTap={{ scale: 0.96 }}
                      className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] disabled:opacity-70"
                    >
                      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                      {!busy && (isEdit ? <PenLine className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />)}
                      {isEdit ? 'Personeli güncelle' : 'Personel oluştur'}
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
