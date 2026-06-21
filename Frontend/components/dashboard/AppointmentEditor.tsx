'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import {
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Loader2,
  Package,
  PenLine,
  Phone,
  Plane,
  Scissors,
  StickyNote,
  User,
  UserCog,
  X,
  type LucideIcon,
} from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { formatTL } from '@/lib/apiMappers'
import ConsultationWarningBanner from '@/components/dashboard/ConsultationWarningBanner'
import type { ApiCustomerPackageSession, ApiStaffTimeOff, Customer, Service, ServicePackage, Staff } from '@/lib/types'

export type AppointmentEditorMode = 'create' | 'edit'

export interface AppointmentEditorValues {
  customerId: string
  serviceDefinitionId: string
  staffMemberId: string
  packageId: string | null
  date: string
  time: string
  durationMinutes: number
  price: number
  notes: string
  status: string
}

const statusOptions: Array<{ value: string; label: string }> = [
  { value: 'Scheduled', label: 'Bekliyor' },
  { value: 'Confirmed', label: 'Devam' },
  { value: 'Completed', label: 'Tamamlandı' },
  { value: 'Cancelled', label: 'İptal' },
  { value: 'NoShow', label: 'Gelmedi' },
]

export interface AppointmentEditorProps {
  mode: AppointmentEditorMode
  open: boolean
  onOpenChange: (next: boolean) => void
  trigger?: ReactNode
  customers: Customer[]
  staff: Staff[]
  services: Service[]
  packages: ServicePackage[]
  /** Create modunda seçili müşterinin satın aldığı seans bakiyelerini çekmek için. */
  tenantId?: string
  initialValues?: Partial<AppointmentEditorValues>
  customerLabel?: string
  serviceLabel?: string
  staffLabel?: string
  staffLocked?: boolean
  onSubmit: (values: AppointmentEditorValues) => Promise<void>
  /** Notları "sadece not düzenle" modunda göster */
  noteOnly?: boolean
}

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

function fieldStyle(): string {
  return 'min-h-11 w-full border border-[#ead8df]/[0.70] bg-white/[0.82] px-3 py-2 text-sm text-[#352432] transition-colors hover:border-[#efbfd0]/[0.75] focus:border-[#f0aac2]/[0.65] focus:outline-none'
}

function labelStyle(): string {
  return 'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]'
}

function helperStyle(): string {
  return 'mt-1 text-[10px] leading-relaxed text-[#352432]/[0.40]'
}

interface FieldShellProps {
  label: string
  icon?: LucideIcon
  helper?: string
  required?: boolean
  fullWidth?: boolean
  prefix?: string
  suffix?: string
  children: ReactNode
}

function FieldShell({ label, icon: Icon, helper, required, fullWidth, prefix, suffix, children }: FieldShellProps) {
  return (
    <motion.div variants={sectionVariants} className={fullWidth ? 'sm:col-span-2' : ''}>
      <div className={labelStyle()}>
        {Icon && <Icon className="h-3 w-3" strokeWidth={1.6} />}
        <span>{label}</span>
        {required && <span className="text-[#c85776]">*</span>}
      </div>
      <div className="relative mt-2">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-[#c85776]/[0.55]">
            {prefix}
          </span>
        )}
        <div className={prefix ? 'pl-7' : ''}>{children}</div>
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.55]">
            {suffix}
          </span>
        )}
      </div>
      {helper && <div className={helperStyle()}>{helper}</div>}
    </motion.div>
  )
}

export default function AppointmentEditor({
  mode,
  open,
  onOpenChange,
  trigger,
  customers,
  staff,
  services,
  packages,
  initialValues,
  customerLabel,
  serviceLabel,
  staffLabel,
  staffLocked = false,
  onSubmit,
  noteOnly = false,
  tenantId,
}: AppointmentEditorProps) {
  const todayIso = new Date().toISOString().slice(0, 10)
  // Create modunda hizmet, müşterinin satın aldığı seanslardan seçilir (katalogdan değil) — boş başlar.
  const baseDefaults: AppointmentEditorValues = {
    customerId: customers[0]?.id || '',
    serviceDefinitionId: mode === 'create' ? '' : services[0]?.id || '',
    staffMemberId: staff[0]?.id || '',
    packageId: null,
    date: todayIso,
    time: '14:00',
    durationMinutes: mode === 'create' ? 30 : services[0]?.duration || 30,
    price: 0,
    notes: '',
    status: 'Scheduled',
  }
  const mergedInitial: AppointmentEditorValues = { ...baseDefaults, ...(initialValues || {}) }

  const [values, setValues] = useState<AppointmentEditorValues>(mergedInitial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const initialSignature = JSON.stringify(mergedInitial)

  useEffect(() => {
    if (open) {
      setValues(mergedInitial)
      setSaved(false)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === values.customerId),
    [customers, values.customerId],
  )
  const selectedService = useMemo(
    () => services.find((s) => s.id === values.serviceDefinitionId),
    [services, values.serviceDefinitionId],
  )
  const selectedStaff = useMemo(
    () => staff.find((s) => s.id === values.staffMemberId),
    [staff, values.staffMemberId],
  )

  // Create modu: seçili müşterinin satın aldığı paket/hizmet seans bakiyeleri.
  const [custSessions, setCustSessions] = useState<ApiCustomerPackageSession[]>([])
  const [sessLoading, setSessLoading] = useState(false)
  useEffect(() => {
    if (!open || mode !== 'create' || !values.customerId) {
      setCustSessions([])
      return
    }
    let cancelled = false
    setSessLoading(true)
    adminApi
      .customerSessions<ApiCustomerPackageSession>(values.customerId, tenantId)
      .then((rows) => {
        if (!cancelled) setCustSessions(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setCustSessions([])
      })
      .finally(() => {
        if (!cancelled) setSessLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, mode, values.customerId, tenantId])

  // Hizmet bazında grupla (aynı hizmet birden çok pakette olabilir) — kalan seansları topla.
  const bookableByService = useMemo(() => {
    const map = new Map<string, { serviceDefinitionId: string; serviceName: string; remaining: number; total: number }>()
    for (const s of custSessions) {
      const sid = s.serviceDefinitionId
      const remaining = s.remainingSessions ?? 0
      if (!sid || remaining <= 0) continue
      const e = map.get(sid) ?? {
        serviceDefinitionId: sid,
        serviceName: s.serviceName ?? 'Hizmet',
        remaining: 0,
        total: 0,
      }
      e.remaining += remaining
      e.total += s.totalSessions ?? 0
      map.set(sid, e)
    }
    return Array.from(map.values())
  }, [custSessions])

  const selectedSessionInfo = useMemo(
    () => bookableByService.find((s) => s.serviceDefinitionId === values.serviceDefinitionId),
    [bookableByService, values.serviceDefinitionId],
  )

  const handleSessionSelect = (serviceDefinitionId: string): void => {
    const svc = services.find((s) => s.id === serviceDefinitionId)
    setValues((v) => ({
      ...v,
      serviceDefinitionId,
      packageId: null,
      price: 0,
      durationMinutes: svc?.duration || v.durationMinutes || 30,
    }))
  }


  // Seçili tarihte izinli personeller — izinli personele o gün randevu açılamaz.
  const [leaveStaffIds, setLeaveStaffIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!open || noteOnly || !values.date || !tenantId) {
      setLeaveStaffIds(new Set())
      return
    }
    let cancelled = false
    adminApi
      .timeOff<ApiStaffTimeOff>({ tenantId, fromDate: values.date, toDate: values.date })
      .then((rows) => {
        if (cancelled) return
        const ids = (Array.isArray(rows) ? rows : [])
          .filter((r) => (r.date || '').slice(0, 10) === values.date)
          .map((r) => r.staffMemberId)
          .filter((id): id is string => Boolean(id))
        setLeaveStaffIds(new Set(ids))
      })
      .catch(() => {
        if (!cancelled) setLeaveStaffIds(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [open, noteOnly, values.date, tenantId])

  const selectedStaffOnLeave = Boolean(values.staffMemberId && leaveStaffIds.has(values.staffMemberId))
  // İzinli personele randevu engellenir; mevcut randevu yalnızca iptal/gelmedi ile çözülebilir.
  const submitBlockedByLeave =
    selectedStaffOnLeave && !(mode === 'edit' && (values.status === 'Cancelled' || values.status === 'NoShow'))
  const leaveDateLabel = values.date
    ? new Date(values.date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long' })
    : ''

  const handleSubmit = async (): Promise<void> => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      if (!noteOnly) {
        const missing: string[] = []
        if (!values.customerId) missing.push('Müşteri')
        if (!values.serviceDefinitionId) missing.push('Hizmet')
        if (!values.staffMemberId) missing.push('Personel')
        if (!values.date) missing.push('Tarih')
        if (!values.time) missing.push('Saat')
        if (missing.length) {
          setError(`Zorunlu alanları doldur: ${missing.join(', ')}`)
          return
        }
        if (submitBlockedByLeave) {
          setError(`${selectedStaff?.name || 'Seçili personel'} ${leaveDateLabel} tarihinde izinli. Bu güne randevu verilemez — farklı personel ya da tarih seç.`)
          return
        }
      }
      await onSubmit(values)
      setSaved(true)
      setTimeout(() => onOpenChange(false), 1000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'İşlem tamamlanamadı.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const headline = mode === 'create' ? 'Yeni randevu' : 'Randevuyu güncelle'
  const eyebrow = noteOnly
    ? 'Randevu notu'
    : mode === 'create'
      ? 'Appointment · POST'
      : 'Appointment · PATCH'
  const submitLabel = noteOnly ? 'Notu kaydet' : mode === 'create' ? 'Randevuyu oluştur' : 'Değişiklikleri kaydet'
  const HeaderIcon = noteOnly ? StickyNote : mode === 'create' ? CalendarPlus : CalendarClock

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className="flex h-[94dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(98vw, 1640px)', maxWidth: 'min(98vw, 1640px)' }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          {/* Üstte altın hairline */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 z-10 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(240,170,194,0.85) 30%, rgba(255,211,223,0.85) 60%, transparent)' }}
          />
          {/* Sağ üst gold blob */}
          <span aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full bg-[#f0aac2]/[0.12] blur-3xl" />
          {/* Sol alt copper blob */}
          <span aria-hidden className="pointer-events-none absolute -left-24 bottom-12 h-56 w-56 rounded-full bg-[#d48aa7]/[0.10] blur-3xl" />
          <motion.span
            aria-hidden
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            className="pointer-events-none absolute -left-20 bottom-20 h-60 w-60 rounded-full bg-[#ffd3df]/[0.16] blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.04]" />

          {/* HEADER — kompakt, içeriğe yer açıyor */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-4 pr-12 sm:px-7 sm:py-4 sm:pr-14 lg:px-8">
            <div className="flex items-start gap-4">
              <motion.span
                initial={{ scale: 0.85, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.4 }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                <HeaderIcon className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.26em] text-[#c85776]/[0.70]">{eyebrow}</div>
                <DialogTitle className="armo-heading mt-0.5 text-2xl tracking-tight lg:text-3xl">
                  <span className="armo-shimmer">{headline}</span>
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-3xl text-[11px] leading-snug text-[#352432]/[0.55]">
                  {mode === 'create'
                    ? noteOnly
                      ? 'Bu güne not ekle.'
                      : 'Müşteri seç; satın aldığı paket/hizmetten randevu aç. Satış ve ödeme burada yapılmaz.'
                    : noteOnly
                      ? 'Randevu notunu güncelle.'
                      : 'Değişiklikler audit log\'a düşer.'}
                </DialogDescription>
                {(customerLabel || serviceLabel || staffLabel) && !noteOnly && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-mono uppercase tracking-widest">
                    {customerLabel && (
                      <span className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] px-2 py-0.5 text-[#352432]/[0.65]">
                        <User className="mr-1 inline h-2.5 w-2.5" /> {customerLabel}
                      </span>
                    )}
                    {serviceLabel && (
                      <span className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] px-2 py-0.5 text-[#352432]/[0.65]">
                        <Scissors className="mr-1 inline h-2.5 w-2.5" /> {serviceLabel}
                      </span>
                    )}
                    {staffLabel && (
                      <span className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] px-2 py-0.5 text-[#352432]/[0.65]">
                        <UserCog className="mr-1 inline h-2.5 w-2.5" /> {staffLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => !saving && onOpenChange(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.82] text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* BODY — sol özet sütun + sağ seçim alanı */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {!noteOnly && (
              <div className="flex h-full flex-col lg:flex-row">
                {/* SOL — Sticky özet panel */}
                <aside className="relative shrink-0 overflow-y-auto border-b border-[#ead8df]/[0.75] bg-gradient-to-b from-white/[0.86] via-[#fff8fb]/[0.82] to-[#fff0f5]/[0.86] p-5 lg:w-[360px] lg:border-b-0 lg:border-r lg:p-7">
                  <div className="armo-pill !text-[9px]">
                    <span className="armo-pill-dot" />
                    Randevu özeti
                  </div>

                  <div className="mt-4 space-y-2.5">
                    <SummaryItem icon={User} label="Müşteri" empty="Henüz seçilmedi">
                      {selectedCustomer && (
                        <>
                          <div className="text-[13px] font-medium leading-tight">{selectedCustomer.name}</div>
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-mono text-[#352432]/[0.50]">
                            <Phone className="h-2.5 w-2.5" /> {selectedCustomer.phone}
                          </div>
                        </>
                      )}
                    </SummaryItem>

                    <ConsultationWarningBanner customerId={values.customerId} tenantId={tenantId} />

                    <SummaryItem icon={Scissors} label="Hizmet" empty={mode === 'create' ? 'Sağdan seç' : '—'}>
                      {selectedService && (
                        <>
                          <div className="text-[13px] font-medium leading-tight">{selectedService.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono text-[#352432]/[0.50]">
                            {selectedService.group}
                          </div>
                        </>
                      )}
                    </SummaryItem>

                    <SummaryItem icon={UserCog} label="Personel" empty="Aşağıdan seç">
                      {selectedStaff && (
                        <>
                          <div className="text-[13px] font-medium leading-tight">{selectedStaff.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono text-[#352432]/[0.50]">{selectedStaff.dept}</div>
                        </>
                      )}
                    </SummaryItem>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <SummaryItem icon={Calendar} label="Tarih" compact>
                        <div className="text-[12px] font-medium">
                          {values.date ? new Date(values.date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '—'}
                        </div>
                      </SummaryItem>
                      <SummaryItem icon={Clock} label="Saat" compact>
                        <div className="text-[12px] font-mono font-medium tabular-nums">{values.time || '—'}</div>
                      </SummaryItem>
                    </div>

                    {/* Create: kalan seans · Edit: tutar */}
                    {mode === 'create' ? (
                      <div className="mt-3 rounded-[20px] border border-[#efbfd0]/[0.80] bg-gradient-to-br from-white/[0.88] via-[#fff4f8]/[0.82] to-[#fbe5eb]/[0.70] p-3 shadow-[0_18px_44px_-34px_rgba(200,87,118,0.48)]">
                        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]">
                          <Layers className="h-3 w-3" /> Kalan seans
                        </div>
                        <div className="mt-1.5 armo-stat-value text-3xl tabular-nums leading-none">
                          {selectedSessionInfo ? selectedSessionInfo.remaining : '—'}
                          {selectedSessionInfo && (
                            <span className="text-base text-[#352432]/[0.40]"> / {selectedSessionInfo.total}</span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] font-mono text-[#352432]/[0.40]">
                          {values.durationMinutes} dakika · tamamlanınca 1 seans düşer
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[20px] border border-[#efbfd0]/[0.80] bg-gradient-to-br from-white/[0.88] via-[#fff4f8]/[0.82] to-[#fbe5eb]/[0.70] p-3 shadow-[0_18px_44px_-34px_rgba(200,87,118,0.48)]">
                        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]">
                          <Layers className="h-3 w-3" /> Durum
                        </div>
                        <div className="mt-1.5 armo-stat-value text-2xl leading-none">
                          {statusOptions.find((o) => o.value === values.status)?.label ?? values.status}
                        </div>
                        <div className="mt-1 text-[10px] font-mono text-[#352432]/[0.40]">
                          {values.durationMinutes} dakika · {values.date ? new Date(values.date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '—'} {values.time}
                        </div>
                      </div>
                    )}
                  </div>
                </aside>

                {/* SAĞ — Tabs + arama + grid */}
                <div className="relative flex-1 overflow-y-auto overscroll-contain p-5 sm:p-7 lg:p-8">
                  {/* CREATE — müşteriye satılan paket/hizmet seçimi (katalog değil) */}
                  {mode === 'create' && (
                    <section className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]/[0.65]">
                        <Layers className="h-3 w-3" /> Satın alınan paket / hizmet
                        <span className="normal-case tracking-normal text-[#352432]/[0.40]">· randevu bu seanslardan birine açılır, tamamlanınca düşer</span>
                      </div>
                      {!values.customerId ? (
                        <div className="rounded-[22px] border border-dashed border-[#ead8df]/[0.80] bg-white/[0.70] p-8 text-center text-[12px] text-[#352432]/[0.55]">
                          <User className="mx-auto h-7 w-7 text-[#c85776]/[0.40]" strokeWidth={1.4} />
                          <div className="mt-3">Önce aşağıdan müşteri seç — satın aldığı paket/hizmetler burada listelenir.</div>
                        </div>
                      ) : sessLoading ? (
                        <div className="flex items-center justify-center gap-2 rounded-[22px] border border-[#ead8df]/[0.80] bg-white/[0.70] p-8 text-[12px] text-[#352432]/[0.55]">
                          <Loader2 className="h-4 w-4 animate-spin text-[#c85776]" /> Seans bakiyesi yükleniyor…
                        </div>
                      ) : bookableByService.length === 0 ? (
                        <div className="rounded-[22px] border border-amber-200/[0.70] bg-amber-50/[0.55] p-6 text-center">
                          <Package className="mx-auto h-7 w-7 text-amber-500/[0.70]" strokeWidth={1.4} />
                          <div className="mt-3 text-[12px] font-medium text-amber-800">Bu müşterinin randevuya uygun (kalan seanslı) paket/hizmeti yok.</div>
                          <div className="mt-1 text-[11px] text-amber-700/[0.80]">Önce paket/hizmet satışı yapılıp kurum yöneticisi onaylamalı; sonra randevu açılabilir.</div>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {bookableByService.map((s, idx) => (
                            <motion.div
                              key={s.serviceDefinitionId}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.28, delay: idx * 0.04 }}
                            >
                              <SessionCard
                                active={values.serviceDefinitionId === s.serviceDefinitionId}
                                onClick={() => handleSessionSelect(s.serviceDefinitionId)}
                                name={s.serviceName}
                                remaining={s.remaining}
                                total={s.total}
                              />
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {/* EDIT — randevu zaten oluşturuldu; müşteri/hizmet/personel sabit, aşağıdan zamanlama+durum güncellenir */}
                  {mode === 'edit' && (
                    <div className="flex items-start gap-2.5 rounded-[18px] border border-[#efbfd0]/[0.70] bg-gradient-to-r from-[#fff4f8]/[0.85] to-transparent px-4 py-3 text-[12px] leading-snug text-[#352432]/[0.72]">
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#c85776]" strokeWidth={1.6} />
                      <span>
                        Bu randevunun <strong className="text-[#c85776]">müşteri, hizmet ve personeli</strong> sabittir.
                        Aşağıdan <strong>tarih, saat, süre, durum</strong> ve <strong>not</strong> güncelleyebilirsin.
                        Farklı bir hizmet gerekiyorsa randevuyu iptal edip yenisini aç.
                      </span>
                    </div>
                  )}

                  {/* TEMEL ALANLAR — müşteri / personel / tarih / saat / durum / not */}
                  <div className="mt-7 border-t border-[#ead8df]/[0.70] pt-5">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]/[0.65]">
                      <CalendarPlus className="h-3 w-3" />
                      Randevu detayları
                    </div>
                    <motion.div
                      variants={{
                        hidden: { opacity: 0 },
                        visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
                      }}
                      initial="hidden"
                      animate="visible"
                      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                    >
                      {selectedStaffOnLeave && (
                        <motion.div variants={sectionVariants} className="sm:col-span-2">
                          <div className="flex items-start gap-2.5 rounded-[16px] border border-rose-200/80 bg-rose-50/90 px-4 py-3 text-[12px] leading-snug text-rose-700">
                            <Plane className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" strokeWidth={1.7} />
                            <span>
                              <strong>{selectedStaff?.name || 'Seçili personel'}</strong> {leaveDateLabel} tarihinde{' '}
                              <strong>izinli</strong>.
                              {mode === 'edit'
                                ? ' Bu güne randevu taşınamaz; randevuyu iptal edebilir ya da farklı bir güne alabilirsin.'
                                : ' Bu personele bu gün için randevu verilemez — farklı personel veya tarih seç.'}
                            </span>
                          </div>
                        </motion.div>
                      )}

                      <FieldShell label="Müşteri" icon={User} required fullWidth helper={mode === 'edit' ? 'Randevu oluşturulduktan sonra müşteri değiştirilemez.' : "Listede yoksa önce 'Yeni müşteri' oluştur"}>
                        <select
                          className={`${fieldStyle()} ${mode === 'edit' ? 'cursor-not-allowed opacity-60' : ''}`}
                          value={values.customerId}
                          disabled={mode === 'edit'}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              customerId: e.target.value,
                              // Müşteri değişince create modunda seçili seans geçersiz olur — sıfırla.
                              ...(mode === 'create' ? { serviceDefinitionId: '', durationMinutes: 30 } : {}),
                            }))
                          }
                        >
                          <option value="">— Müşteri seç —</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.phone}
                            </option>
                          ))}
                        </select>
                      </FieldShell>

                      <FieldShell
                        label="Personel"
                        icon={UserCog}
                        required
                        helper={mode === 'edit' ? 'Randevu oluşturulduktan sonra personel değiştirilemez.' : staffLocked ? 'Personel rolünde sadece kendi takvim kaydına randevu açılır.' : undefined}
                      >
                        <select
                          className={`${fieldStyle()} ${staffLocked || mode === 'edit' ? 'cursor-not-allowed opacity-60' : ''}`}
                          value={values.staffMemberId}
                          onChange={(e) => setValues((v) => ({ ...v, staffMemberId: e.target.value }))}
                          disabled={staffLocked || mode === 'edit'}
                        >
                          <option value="">— Personel seç —</option>
                          {staff.map((s) => {
                            const onLeave = leaveStaffIds.has(s.id)
                            return (
                              <option key={s.id} value={s.id} disabled={onLeave && s.id !== values.staffMemberId}>
                                {s.name} · {s.dept}
                                {onLeave ? ' · İzinli' : ''}
                              </option>
                            )
                          })}
                        </select>
                      </FieldShell>

                      <FieldShell label="Tarih" icon={Calendar} required>
                        <input
                          type="date"
                          className={fieldStyle()}
                          value={values.date}
                          onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
                        />
                      </FieldShell>

                      <FieldShell label="Saat" icon={Clock} required>
                        <input
                          type="time"
                          className={fieldStyle()}
                          value={values.time}
                          onChange={(e) => setValues((v) => ({ ...v, time: e.target.value }))}
                        />
                      </FieldShell>

                      <FieldShell label="Süre" icon={CalendarClock} suffix="dk">
                        <input
                          type="number"
                          min={5}
                          className={fieldStyle()}
                          value={values.durationMinutes}
                          onChange={(e) => setValues((v) => ({ ...v, durationMinutes: Number(e.target.value) }))}
                        />
                      </FieldShell>

                      {mode === 'edit' && (
                        <FieldShell label="Durum" icon={Layers} helper={'"Tamamlandı" işaretlendiğinde paket bakiyesi otomatik düşer'}>
                          <select
                            className={fieldStyle()}
                            value={values.status}
                            onChange={(e) => setValues((v) => ({ ...v, status: e.target.value }))}
                          >
                            {statusOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </FieldShell>
                      )}

                      <FieldShell label="Randevu notu" icon={StickyNote} fullWidth helper="Müşteri tercihleri, özel uyarılar... Takvimde küçük bir göstergeyle gözükür.">
                        <textarea
                          rows={2}
                          placeholder="Hassasiyetler, özel istekler, ödeme uyarısı..."
                          className={`${fieldStyle()} resize-none py-2`}
                          value={values.notes}
                          onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                        />
                      </FieldShell>
                    </motion.div>
                  </div>
                </div>
              </div>
            )}

            {noteOnly && (
              <div className="h-full overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
                <motion.div variants={sectionVariants} initial="hidden" animate="visible" className="space-y-3">
                  <div className="text-[11px] text-[#352432]/[0.55]">
                    Bu nota müşteri görmez; salonun iç iletişimi içindir. Takvimde küçük bir gösterge olarak görünür.
                  </div>
                  <FieldShell label="Randevu notu" icon={FileText} fullWidth>
                    <textarea
                      autoFocus
                      rows={8}
                      placeholder="Müşteri hassasiyetleri, özel istekler, ödeme durumu..."
                      className={`${fieldStyle()} resize-none py-2`}
                      value={values.notes}
                      onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                    />
                  </FieldShell>
                </motion.div>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.75] bg-white/[0.78] px-5 py-4 shadow-[0_-18px_46px_-36px_rgba(120,71,88,0.45)] backdrop-blur-xl sm:px-8 sm:py-5 lg:px-10 lg:py-6">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-3 rounded-[16px] border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-[11px] text-rose-700"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
                {noteOnly ? 'Sadece not güncellenir' : mode === 'create' ? 'Yeni kayıt oluşturulur' : 'Mevcut kayıt güncellenir'}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => !saving && onOpenChange(false)}
                  disabled={saving}
                  className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.72] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.65] transition-colors hover:border-[#efbfd0]/[0.85] hover:bg-[#fff2f6]/[0.90] hover:text-[#352432] disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <motion.button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || saved || submitBlockedByLeave}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] shadow-[0_12px_28px_-18px_rgba(200,87,118,0.55)] disabled:opacity-70"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {saved && <CheckCircle2 className="h-3 w-3" />}
                  {!saving && !saved && <PenLine className="h-3 w-3" />}
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

// ---------- Helper components ----------

function SummaryItem({
  icon: Icon,
  label,
  empty,
  tone,
  compact,
  children,
}: {
  icon: LucideIcon
  label: string
  empty?: string
  tone?: 'gold'
  compact?: boolean
  children?: ReactNode
}) {
  const hasContent = Boolean(children)
  const cls = tone === 'gold'
    ? 'border-[#efbfd0]/[0.80] bg-gradient-to-br from-white/[0.88] via-[#fff4f8]/[0.82] to-[#fbe5eb]/[0.70] shadow-[0_14px_34px_-28px_rgba(200,87,118,0.48)]'
    : hasContent
      ? 'border-[#ead8df]/[0.80] bg-white/[0.78]'
      : 'border-dashed border-[#ead8df]/[0.80] bg-white/[0.62]'
  return (
    <div className={`rounded-[18px] border ${cls} ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.45]">
        <Icon className="h-3 w-3" strokeWidth={1.6} />
        {label}
      </div>
      <div className="mt-1.5">
        {hasContent ? children : <div className="text-[11px] text-[#352432]/[0.35]">{empty}</div>}
      </div>
    </div>
  )
}

// Create modu — müşteriye satılmış bir paket/hizmetin seans kartı (randevu buna açılır).
function SessionCard({
  active,
  onClick,
  name,
  remaining,
  total,
}: {
  active: boolean
  onClick: () => void
  name: string
  remaining: number
  total: number
}) {
  const pct = total > 0 ? Math.round((remaining / total) * 100) : 0
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`group relative overflow-hidden rounded-[20px] border p-4 text-left transition-all duration-300 ${
        active
          ? 'border-[#f0aac2]/[0.65] bg-gradient-to-br from-[#f0aac2]/[0.14] via-[#fff7fa] to-[#d48aa7]/[0.10] shadow-[0_18px_42px_-12px_rgba(240,170,194,0.4)]'
          : 'border-[#ead8df]/[0.80] bg-white/[0.76] hover:border-[#efbfd0]/[0.80] hover:bg-[#fff2f6]/[0.90]'
      }`}
    >
      {active && (
        <motion.span
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#fff4f8] via-[#ffd3df] to-[#f0aac2] text-[#2f1724] shadow-[0_4px_12px_rgba(240,170,194,0.5)]"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
        </motion.span>
      )}
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]">
        <Layers className="h-3 w-3" /> Satın alınan
      </div>
      <div className="mt-2 line-clamp-2 min-h-[2.4em] font-display text-lg leading-tight tracking-tight">{name}</div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="uppercase tracking-widest text-[#352432]/[0.50]">Kalan seans</span>
          <span className="tabular-nums text-[#c85776]">
            <span className="font-display text-base">{remaining}</span>
            <span className="text-[#352432]/[0.40]"> / {total}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#f0e0e6]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#ee789a] to-[#f5abc0]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </motion.button>
  )
}

