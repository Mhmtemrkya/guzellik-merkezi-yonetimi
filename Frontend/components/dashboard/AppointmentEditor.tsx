'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  Lock,
  ListPlus,
  Loader2,
  Package,
  Plane,
  ReceiptText,
  Scissors,
  User,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeAccount, staffCanPerform } from '@/lib/apiMappers'
import CollectionDialog from '@/components/dashboard/CollectionDialog'
import ConsultationWarningBanner from '@/components/dashboard/ConsultationWarningBanner'
import CustomerPicker, { customerSearchProvider, type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'
import CustomerFormDialog, { type CustomerFormValues } from '@/components/dashboard/CustomerFormDialog'
import CustomerHistoryPanel from '@/components/dashboard/CustomerHistoryPanel'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import AdisyonModal from '@/components/dashboard/AdisyonModal'
import type {
  ApiCustomerAccount,
  ApiCustomerPackageSession,
  ApiStaffTimeOff,
  Customer,
  CustomerAccount,
  Service,
  ServicePackage,
  Staff,
} from '@/lib/types'

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
  /**
   * true ise müşteri seçici tüm listeyi beklemez; sunucu-taraflı arama kullanır
   * (sınırsız müşteri ölçeği). `customers` prop'u yalnızca ilk görüntü/lookup içindir.
   */
  serverCustomerSearch?: boolean
  initialValues?: Partial<AppointmentEditorValues>
  customerLabel?: string
  serviceLabel?: string
  staffLabel?: string
  staffLocked?: boolean
  onSubmit: (values: AppointmentEditorValues) => Promise<void>
  /** Notları "sadece not düzenle" modunda göster */
  noteOnly?: boolean
  /**
   * Create modunda müşteri seçiminin yanında "Yeni müşteri" hızlı kaydı açar.
   * Oluşan müşteri döndürülürse modal içinde otomatik seçilir; Staff onaya düştüyse null döner.
   */
  onQuickCreateCustomer?: (values: CustomerFormValues) => Promise<Customer | null>
  /**
   * Create modunda slot dolu (backend `SlotFull`) olduğunda "Bekleme listesine ekle?" akışını açar.
   * Verilmezse dolu-slot hatası normal hata olarak gösterilir.
   */
  onAddToWaitlist?: (values: AppointmentEditorValues) => Promise<void>
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASARIM NOTU

   Bu modal masa başındaki KONUŞMANIN sırasını izler: kim → hangi işlem →
   ne zaman/kiminle → not. Adımlar gerçekten birbirine bağlı (müşteri seçilmeden
   satın aldığı seanslar bilinemez), bu yüzden numaralandırma bilgi taşır.
   Önceki sürümde seans seçimi en üstteydi ama müşteri alanı en alttaydı; boş
   durum "aşağıdan müşteri seç" diyerek aşağıyı işaret ediyordu.

   Sağ ray = çıktı + müşteri. Üstte oluşacak randevunun KARTI (doldukça
   şekillenir), altında müşterinin parası: açık borç ve tahsilat/satış/adisyon.
   Bunlar randevuya değil müşteriye yapılan işlemler olduğu için orada durur.

   Süsleme tek yerde: karttaki gül-altın hairline. Eski sürümdeki üç blob,
   grid deseni ve başlık shimmer'ı kaldırıldı — hiçbiri bilgi taşımıyordu.
   Mono yazı tipi yalnız hizalanması gereken RAKAMLARDA (saat, tutar, seans).
   ═══════════════════════════════════════════════════════════════════════════ */

const control =
  'min-h-11 w-full rounded-xl border border-[#efe1e7] bg-white px-3.5 py-2.5 text-[13.5px] text-[#2b1e29] outline-none transition-colors placeholder:text-[#b09ca5] hover:border-[#e8c2d1] focus:border-[#c7768f] focus:ring-4 focus:ring-[#ffdce8]/60 disabled:cursor-not-allowed disabled:bg-[#fbf5f7] disabled:text-[#705a66]'

/** Numaralı adım bloğu. `done` işareti tamamlanmayı, `locked` önkoşulu gösterir. */
function Step({
  n,
  title,
  hint,
  done,
  locked,
  children,
}: {
  n: number
  title: string
  hint?: string
  done?: boolean
  locked?: boolean
  children: ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: n * 0.05 }}
      className="relative pl-11"
      /**
       * ÖNCEKİ ADIM ÜSTTE. Adımlar framer-motion transform'u yüzünden kendi yığınlama
       * bağlamlarını kurar; içerideki açılır listenin z-index'i o bağlamda hapsolur ve
       * DOM'da sonra gelen adım üste biner. Müşteri arama listesi 2. adımın üstüne
       * düştüğünde tıklanamıyordu. Azalan z-index bunu kaynağında çözer.
       */
      style={{ zIndex: 40 - n }}
    >
      {/* Numara / durum işareti */}
      <span
        aria-hidden
        className={`absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full border text-[12.5px] font-bold transition-colors ${
          done
            ? 'border-[#8e3f5b] bg-[#8e3f5b] text-white'
            : locked
              ? 'border-[#efe1e7] bg-white text-[#b09ca5]'
              : 'border-[#e8c2d1] bg-[#fff4f8] text-[#8e3f5b]'
        }`}
      >
        {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : n}
      </span>

      <div className="flex min-h-8 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h3 className="font-display text-[15px] font-extrabold tracking-[-0.02em] text-[#2b1e29]">{title}</h3>
        {hint && <span className="text-[11.5px] leading-snug text-[#705a66]">{hint}</span>}
      </div>

      <div className="mt-3">{children}</div>
    </motion.section>
  )
}

function Field({
  label,
  required,
  helper,
  wide,
  children,
}: {
  label: string
  required?: boolean
  helper?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="mb-1.5 block text-[12px] font-semibold text-[#4a3a44]">
        {label}
        {required && <span className="ml-0.5 text-[#c7768f]">*</span>}
      </label>
      {children}
      {helper && <p className="mt-1.5 text-[11.5px] leading-snug text-[#705a66]">{helper}</p>}
    </div>
  )
}

/**
 * SİGNATÜR — oluşacak randevunun kartı. Eksikken kesikli ve sönük; tamamlanınca
 * gül-altın hairline'lı, yükselen bir "fiş" olur. Kahraman öğe SAAT: resepsiyonun
 * müşteriye okuduğu şey odur ("perşembe ikide bekliyoruz").
 */
function Ticket({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  duration,
  statusLabel,
  complete,
}: {
  customerName?: string
  serviceName?: string
  staffName?: string
  date: string
  time: string
  duration: number
  statusLabel?: string
  complete: boolean
}) {
  const dateLabel = date
    ? new Date(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
    : 'Tarih seçilmedi'

  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-2xl border p-4 ${
        complete
          ? 'border-[#e8c2d1] bg-white shadow-[0_20px_44px_-30px_rgba(142,63,91,0.5)]'
          : 'border-dashed border-[#e8d5de] bg-white/70'
      }`}
    >
      {/* Marka hairline — yalnız kart tamamlanınca. Tek süsleme burası. */}
      <AnimatePresence>
        {complete && (
          <motion.span
            key="hairline"
            aria-hidden
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ scaleX: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-0 h-[2px] origin-left"
            style={{ background: 'linear-gradient(90deg, #ffdce8, #c7768f 45%, #8e3f5b 70%, #ffdce8)' }}
          />
        )}
      </AnimatePresence>

      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a3576f]">{dateLabel}</div>

      {/* Kahraman: saat */}
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[38px] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-[#2b1e29]">
          {time || '—:—'}
        </span>
        <span className="text-[12px] font-medium tabular-nums text-[#705a66]">{duration} dk</span>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-[#f4e8ee] pt-3">
        <TicketRow icon={User} value={customerName} empty="Müşteri seçilmedi" strong />
        <TicketRow icon={Scissors} value={serviceName} empty="İşlem seçilmedi" />
        <TicketRow icon={UserCog} value={staffName} empty="Personel seçilmedi" />
      </div>

      {statusLabel && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#e8c2d1] bg-[#fff4f8] px-2.5 py-1 text-[11.5px] font-semibold text-[#8e3f5b]">
          {statusLabel}
        </div>
      )}
    </motion.div>
  )
}

function TicketRow({
  icon: Icon,
  value,
  empty,
  strong,
}: {
  icon: typeof User
  value?: string
  empty: string
  strong?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${value ? 'text-[#c7768f]' : 'text-[#c2adb6]'}`} strokeWidth={1.8} />
      <span
        className={`min-w-0 break-words text-[13px] leading-snug ${
          value ? (strong ? 'font-semibold text-[#2b1e29]' : 'text-[#4a3a44]') : 'text-[#705a66]'
        }`}
      >
        {value || empty}
      </span>
    </div>
  )
}

/** Müşteriye satılmış paket/hizmetin seans kartı — randevu buna açılır. */
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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative w-full rounded-2xl border p-3.5 text-left transition-all duration-200 ${
        active
          ? 'border-[#8e3f5b] bg-[#fff4f8] shadow-[0_14px_32px_-22px_rgba(142,63,91,0.6)]'
          : 'border-[#efe1e7] bg-white hover:-translate-y-0.5 hover:border-[#e8c2d1] hover:shadow-[0_12px_26px_-20px_rgba(142,63,91,0.45)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-[14.5px] font-bold leading-snug tracking-[-0.015em] text-[#2b1e29]">
          {name}
        </span>
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
            active ? 'border-[#8e3f5b] bg-[#8e3f5b]' : 'border-[#e3d2da] bg-white'
          }`}
        >
          {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between">
        <span className="text-[11.5px] text-[#705a66]">Kalan seans</span>
        <span className="font-display text-[15px] font-extrabold tabular-nums text-[#8e3f5b]">
          {remaining}
          <span className="text-[11.5px] font-semibold text-[#705a66]"> / {total}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#f4e4ea]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#c7768f] to-[#8e3f5b] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  )
}

/**
 * PERSONEL SEÇİCİ — native <select> yerine. Listede YALNIZ AD görünür (departman/uzmanlık
 * metni satırı uzatıp okumayı zorlaştırıyordu); uygun olmayan personel ise sebebiyle
 * birlikte pasif gösterilir, gizlenmez — "neden seçemiyorum" sorusu ekranda yanıtlanır.
 */
function StaffPicker({
  staff,
  value,
  disabled,
  onChange,
  isOnLeave,
  isSkillBlocked,
}: {
  staff: Staff[]
  value: string
  disabled?: boolean
  onChange: (id: string) => void
  isOnLeave: (s: Staff) => boolean
  isSkillBlocked: (s: Staff) => boolean
}) {
  const [openList, setOpenList] = useState(false)
  const selected = staff.find((s) => s.id === value)

  // Dışarı tıklayınca kapansın.
  useEffect(() => {
    if (!openList) return
    const onDown = (): void => setOpenList(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openList])

  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenList((o) => !o)}
        className={`${control} flex items-center gap-2.5 text-left ${disabled ? '' : 'cursor-pointer'}`}
      >
        {selected ? (
          <>
            <Avatar name={selected.name} />
            <span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-[#b09ca5]">Personel seç</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#a3576f] transition-transform ${openList ? 'rotate-180' : ''}`} />
      </button>

      {openList && !disabled && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-[#efe1e7] bg-white py-1 shadow-[0_24px_50px_-24px_rgba(120,71,88,0.5)]"
        >
          {staff.map((s) => {
            const leave = isOnLeave(s)
            const blocked = isSkillBlocked(s)
            const unavailable = (leave || blocked) && s.id !== value
            const active = s.id === value
            return (
              <button
                key={s.id}
                type="button"
                disabled={unavailable}
                onClick={() => {
                  onChange(s.id)
                  setOpenList(false)
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[#fff4f8]' : unavailable ? 'opacity-55' : 'hover:bg-[#fdf6f9]'
                } ${unavailable ? 'cursor-not-allowed' : ''}`}
              >
                <Avatar name={s.name} dim={unavailable} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[#2b1e29]">{s.name}</span>
                  {(leave || blocked) && (
                    <span className="block text-[11px] text-[#705a66]">{leave ? 'İzinli' : 'Bu kategoride yetkisiz'}</span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-[#8e3f5b]" strokeWidth={2.6} />}
              </button>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}

function Avatar({ name, dim }: { name: string; dim?: boolean }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toLocaleUpperCase('tr')
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
        dim ? 'bg-[#f2e6ec] text-[#a3899a]' : 'bg-[#ffdce8] text-[#8e3f5b]'
      }`}
    >
      {initials}
    </span>
  )
}

/** Salt-okunur bilgi satırı — edit modunda değiştirilemeyen alanlar. */
function LockedFact({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#efe1e7] bg-[#fbf5f7] px-3.5 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-[#c7768f]" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-[#705a66]">{label}</div>
        <div className="truncate text-[13.5px] font-medium text-[#2b1e29]">{value || '—'}</div>
      </div>
      <Lock className="h-3.5 w-3.5 shrink-0 text-[#b09ca5]" strokeWidth={1.8} />
    </div>
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
  serverCustomerSearch = false,
  onQuickCreateCustomer,
  onAddToWaitlist,
}: AppointmentEditorProps) {
  const todayIso = new Date().toISOString().slice(0, 10)
  // Create modunda hizmet, müşterinin satın aldığı seanslardan seçilir (katalogdan değil) — boş başlar.
  const baseDefaults: AppointmentEditorValues = {
    // 12 bin+ müşteri listesinde ilk kaydı otomatik seçmek yanıltıcı — create'te boş başlar, aramayla seçilir.
    customerId: mode === 'create' ? '' : customers[0]?.id || '',
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
  // Slot dolu → bekleme listesi teklifi (SlotFull hatasında dolar)
  const [waitlistPrompt, setWaitlistPrompt] = useState('')
  const [waitlistBusy, setWaitlistBusy] = useState(false)
  const [waitlistDone, setWaitlistDone] = useState(false)
  const initialSignature = JSON.stringify(mergedInitial)

  // Modal içinden hızlı kaydedilen müşteriler — dışarıdan gelen (seans filtreli) listede
  // olmasalar da seçilebilsinler diye yerel olarak eklenir.
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false)
  const [extraCustomers, setExtraCustomers] = useState<Customer[]>([])
  const allCustomers = useMemo(() => {
    const known = new Set(customers.map((c) => c.id))
    return [...customers, ...extraCustomers.filter((c) => !known.has(c.id))]
  }, [customers, extraCustomers])

  useEffect(() => {
    if (open) {
      setValues(JSON.parse(initialSignature) as AppointmentEditorValues)
      setError('')
      setSaved(false)
      setWaitlistPrompt('')
      setWaitlistBusy(false)
      setWaitlistDone(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSignature])

  // Sunucu aramasıyla seçilen müşteri `customers` listesinde olmayabilir — seçimden gelen kaydı tut.
  const [pickedCustomer, setPickedCustomer] = useState<CustomerPickerItem | null>(null)
  const [adisyonOpen, setAdisyonOpen] = useState(false) // müşteri adisyon kartı (randevu modalı içinden)
  const searchCustomersFn = useMemo(
    () => (serverCustomerSearch ? customerSearchProvider(tenantId) : undefined),
    [serverCustomerSearch, tenantId],
  )
  const selectedCustomer = useMemo(() => {
    const found = allCustomers.find((c) => c.id === values.customerId)
    if (found) return found
    if (pickedCustomer && pickedCustomer.id === values.customerId) {
      return { id: pickedCustomer.id, name: pickedCustomer.name, phone: pickedCustomer.phone || '', branchId: null } as unknown as Customer
    }
    return undefined
  }, [allCustomers, pickedCustomer, values.customerId])
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
  // Modal içinden satış yapılınca seans bakiyelerini yeniden çekmek için sayaç.
  const [sessRefreshKey, setSessRefreshKey] = useState(0)
  // Her iki modda da çekilir: create'te randevu bu seanslara açılır, edit'te sağ raydaki
  // müşteri dosyası "yapılan / kalan seans" dökümünü buradan gösterir.
  useEffect(() => {
    if (!open || !values.customerId) {
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
  }, [open, values.customerId, tenantId, sessRefreshKey])

  /**
   * Seçili müşterinin AÇIK CARİLERİ — hem "açık borç" göstergesini hem de modal içinden
   * tahsilat almayı besler. Müşteri masada dururken randevusunu açıp borcunu tahsil etmek
   * aynı andır; bunun için Ön Muhasebe'ye gitmek gerekmiyordu.
   */
  const [custAccounts, setCustAccounts] = useState<CustomerAccount[]>([])
  const [collectOpen, setCollectOpen] = useState(false)
  useEffect(() => {
    if (!open || !values.customerId) {
      setCustAccounts([])
      return
    }
    let cancelled = false
    adminApi
      .accounts<ApiCustomerAccount>({ tenantId, customerId: values.customerId, page: 1, pageSize: 50 })
      .then((res) => {
        if (cancelled) return
        const rows = apiItems(res).map((a, i) => normalizeAccount(a, i))
        // İptal edilmiş satışın borcu tahsil edilmez; listeye girmesin.
        setCustAccounts(rows.filter((a) => !a.cancelledAtUtc))
      })
      .catch(() => {
        if (!cancelled) setCustAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [open, values.customerId, tenantId, sessRefreshKey])

  const openDebt = useMemo(
    () => custAccounts.reduce((sum, a) => sum + Math.max(0, a.remainingAmount || 0), 0),
    [custAccounts],
  )
  const paidTotal = useMemo(
    () => custAccounts.reduce((sum, a) => sum + Math.max(0, a.paidAmount || 0), 0),
    [custAccounts],
  )

  /** Son tahsilatlar — tüm carilerin ödemeleri, yeniden eskiye. */
  const recentPayments = useMemo(
    () =>
      custAccounts
        .flatMap((a) => a.payments || [])
        .slice()
        .sort((x, y) => new Date(y.occurredAtUtc).getTime() - new Date(x.occurredAtUtc).getTime())
        .slice(0, 4),
    [custAccounts],
  )

  /** Hizmet bazında seans dökümü: yapılan / toplam (kalanı olmayanlar da görünür). */
  const sessionLedger = useMemo(() => {
    const map = new Map<string, { name: string; used: number; total: number }>()
    for (const s of custSessions) {
      const key = s.serviceDefinitionId || s.serviceName || 'x'
      const e = map.get(key) ?? { name: s.serviceName ?? 'Hizmet', used: 0, total: 0 }
      e.used += s.usedSessions ?? 0
      e.total += s.totalSessions ?? 0
      map.set(key, e)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [custSessions])

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

  // Tek işlem/hizmet kartı varsa otomatik seç — birden fazlaysa seçimi kullanıcı yapar (dokunma).
  useEffect(() => {
    if (!open || mode !== 'create' || sessLoading) return
    if (values.serviceDefinitionId) return
    if (bookableByService.length !== 1) return
    handleSessionSelect(bookableByService[0].serviceDefinitionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sessLoading, bookableByService, values.serviceDefinitionId])

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

  // Kategori yetkisi: personelin uzmanlık listesi doluysa yalnızca o kategorideki
  // (veya adı listede olan) hizmetlere randevu alabilir.
  const staffAllowedForService = (s: Staff): boolean =>
    !selectedService || staffCanPerform(s.specialties, selectedService.group, selectedService.name)
  const selectedStaffSkillBlocked = Boolean(
    mode === 'create' && selectedStaff && selectedService && !staffAllowedForService(selectedStaff),
  )

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
    setWaitlistPrompt('')
    setSaved(false)
    try {
      if (!noteOnly) {
        const missing: string[] = []
        if (!values.customerId) missing.push('Müşteri')
        if (!values.serviceDefinitionId) missing.push('İşlem')
        if (!values.staffMemberId) missing.push('Personel')
        if (!values.date) missing.push('Tarih')
        if (!values.time) missing.push('Saat')
        if (missing.length) {
          setError(`Şunlar eksik: ${missing.join(', ')}`)
          return
        }
        if (submitBlockedByLeave) {
          setError(`${selectedStaff?.name || 'Seçili personel'} ${leaveDateLabel} tarihinde izinli. Bu güne randevu verilemez — farklı personel ya da tarih seç.`)
          return
        }
        if (selectedStaffSkillBlocked) {
          setError(`${selectedStaff?.name || 'Seçili personel'} "${selectedService?.name || 'bu hizmet'}" kategorisinde yetkili değil. Farklı bir personel seç ya da personel kartından kategori yetkisi ver.`)
          return
        }
      }
      await onSubmit(values)
      setSaved(true)
      setTimeout(() => onOpenChange(false), 1000)
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      const msg = e instanceof Error ? e.message : 'İşlem tamamlanamadı.'
      // Slot dolu (SlotFull) + waitlist akışı mevcutsa: hata yerine "bekleme listesine ekle?" teklifi göster.
      if (code === 'SlotFull' && onAddToWaitlist && mode === 'create' && !noteOnly) {
        setWaitlistPrompt(msg)
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleAddToWaitlist = async (): Promise<void> => {
    if (!onAddToWaitlist) return
    setWaitlistBusy(true)
    setError('')
    try {
      await onAddToWaitlist(values)
      setWaitlistDone(true)
      setTimeout(() => onOpenChange(false), 1300)
    } catch (e: unknown) {
      setWaitlistPrompt('')
      setError(e instanceof Error ? e.message : 'Bekleme listesine eklenemedi.')
    } finally {
      setWaitlistBusy(false)
    }
  }

  const headline = noteOnly ? 'Randevu notu' : mode === 'create' ? 'Yeni randevu' : 'Randevuyu güncelle'
  const submitLabel = noteOnly ? 'Notu kaydet' : mode === 'create' ? 'Randevuyu oluştur' : 'Değişiklikleri kaydet'
  const statusLabel = statusOptions.find((o) => o.value === values.status)?.label

  /**
   * Adım tamamlanma durumu ZİNCİRLİDİR: bir adım, kendinden öncekiler bitmeden "tamam"
   * sayılmaz. Tarih/saat/personel varsayılan geldiği için 3. adım tek başına dolu görünüyor
   * ve müşteri boşken ✓ alıyordu — sıralı bir akışta bu yanlış okunur.
   */
  const step1Done = Boolean(values.customerId)
  const step2Done = step1Done && Boolean(values.serviceDefinitionId)
  const step3Done = step2Done && Boolean(values.date && values.time && values.staffMemberId)
  const ticketComplete = step3Done

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent
          className="flex flex-col overflow-hidden rounded-3xl border border-[#efe1e7] bg-white !p-0 text-[#2b1e29] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
          style={{ width: 'min(97vw, 1440px)', height: 'min(95dvh, 1020px)', maxHeight: '95dvh' }}
        >
          {/* ── BAŞLIK ───────────────────────────────────────────────────── */}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#efe1e7] px-6 py-4 sm:px-7">
            <div className="min-w-0">
              <DialogTitle className="font-display text-[22px] font-extrabold leading-none tracking-[-0.035em] text-[#2b1e29]">
                {headline}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-[12.5px] leading-snug text-[#705a66]">
                {noteOnly
                  ? 'Salonun iç notu — müşteri görmez.'
                  : mode === 'create'
                    ? 'Müşteriyi seç, satın aldığı işlemden randevu aç.'
                    : 'Tarih, saat, süre, durum ve not güncellenebilir.'}
              </DialogDescription>
              {(customerLabel || serviceLabel || staffLabel) && !noteOnly && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[customerLabel, serviceLabel, staffLabel].filter(Boolean).map((l) => (
                    <span
                      key={l}
                      className="rounded-full border border-[#efe1e7] bg-[#fbf5f7] px-2.5 py-0.5 text-[11px] font-medium text-[#705a66]"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => !saving && onOpenChange(false)}
              aria-label="Kapat"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white text-[#705a66] transition-colors hover:border-[#e8c2d1] hover:text-[#2b1e29]"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* ── GÖVDE ────────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-auto overflow-hidden">
            {noteOnly ? (
              <div className="h-full overflow-y-auto px-6 py-6 sm:px-7">
                <div className="mx-auto max-w-xl">
                  <Field label="Randevu notu" wide helper="Takvimde küçük bir göstergeyle görünür.">
                    <textarea
                      autoFocus
                      rows={10}
                      placeholder="Hassasiyetler, özel istekler, ödeme durumu…"
                      className={`${control} resize-none`}
                      value={values.notes}
                      onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col lg:flex-row">
                {/* ── SOL: sıralı adımlar ── */}
                <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6 sm:px-7">
                  {/* 1 — MÜŞTERİ */}
                  <Step
                    n={1}
                    title="Müşteri"
                    hint={mode === 'edit' ? 'Oluşturulduktan sonra değiştirilemez' : undefined}
                    done={step1Done}
                  >
                    {mode === 'edit' ? (
                      <LockedFact icon={User} label="Müşteri" value={selectedCustomer?.name || customerLabel || ''} />
                    ) : (
                      <>
                        <div className="flex items-stretch gap-2">
                          <div className="min-w-0 flex-1">
                            <CustomerPicker
                              items={allCustomers}
                              value={values.customerId}
                              onSearch={searchCustomersFn}
                              onSelectItem={setPickedCustomer}
                              onChange={(customerId) =>
                                setValues((v) => ({ ...v, customerId, serviceDefinitionId: '', durationMinutes: 30 }))
                              }
                            />
                          </div>
                          {onQuickCreateCustomer && (
                            <button
                              type="button"
                              onClick={() => setQuickCustomerOpen(true)}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#e8c2d1] bg-white px-3 text-[12.5px] font-semibold text-[#8e3f5b] transition-colors hover:bg-[#fff4f8]"
                            >
                              <UserPlus className="h-4 w-4" strokeWidth={1.9} />
                              Yeni
                            </button>
                          )}
                        </div>
                        {selectedCustomer?.phone && (
                          <p className="mt-1.5 text-[11.5px] tabular-nums text-[#705a66]">{selectedCustomer.phone}</p>
                        )}
                      </>
                    )}
                    <ConsultationWarningBanner customerId={values.customerId} tenantId={tenantId} />
                  </Step>

                  {/* 2 — İŞLEM */}
                  <Step
                    n={2}
                    title="İşlem"
                    hint={mode === 'create' ? 'Müşterinin satın aldığı seanslardan' : undefined}
                    done={step2Done}
                    locked={!values.customerId}
                  >
                    {mode === 'edit' ? (
                      <LockedFact icon={Scissors} label="Hizmet" value={selectedService?.name || serviceLabel || ''} />
                    ) : !values.customerId ? (
                      <EmptyNote icon={User}>Önce müşteriyi seç — satın aldığı işlemler burada listelenir.</EmptyNote>
                    ) : sessLoading ? (
                      <EmptyNote icon={Loader2} spin>
                        Seans bakiyesi yükleniyor…
                      </EmptyNote>
                    ) : bookableByService.length === 0 ? (
                      <div className="rounded-2xl border border-[#f0dcc4] bg-[#fdf6ec] px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <Package className="mt-0.5 h-4 w-4 shrink-0 text-[#b8863b]" strokeWidth={1.8} />
                          <div>
                            <div className="text-[13px] font-semibold text-[#8a6524]">Randevuya uygun seans yok.</div>
                            <div className="mt-0.5 text-[11.5px] leading-snug text-[#8a6524]/90">
                              Sağdaki panelden paket ya da hizmet sat; onaylandığında seanslar burada anında görünür.
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                        {bookableByService.map((s) => (
                          <SessionCard
                            key={s.serviceDefinitionId}
                            active={values.serviceDefinitionId === s.serviceDefinitionId}
                            onClick={() => handleSessionSelect(s.serviceDefinitionId)}
                            name={s.serviceName}
                            remaining={s.remaining}
                            total={s.total}
                          />
                        ))}
                      </div>
                    )}
                  </Step>

                  {/* 3 — ZAMAN & PERSONEL */}
                  <Step
                    n={3}
                    title="Zaman ve personel"
                    done={step3Done}
                    locked={!values.serviceDefinitionId && mode === 'create'}
                  >
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <Field label="Tarih" required>
                        <input
                          type="date"
                          className={control}
                          value={values.date}
                          onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
                        />
                      </Field>
                      <Field label="Saat" required>
                        <input
                          type="time"
                          className={`${control} tabular-nums`}
                          value={values.time}
                          onChange={(e) => setValues((v) => ({ ...v, time: e.target.value }))}
                        />
                      </Field>

                      <Field
                        label="Personel"
                        required
                        wide={mode !== 'edit'}
                        helper={
                          mode === 'edit'
                            ? 'Oluşturulduktan sonra değiştirilemez.'
                            : staffLocked
                              ? 'Personel rolünde yalnız kendi takvimine randevu açılır.'
                              : undefined
                        }
                      >
                        {mode === 'edit' ? (
                          <LockedFact icon={UserCog} label="Personel" value={selectedStaff?.name || staffLabel || ''} />
                        ) : (
                          <StaffPicker
                            staff={staff}
                            value={values.staffMemberId}
                            disabled={staffLocked}
                            onChange={(id) => setValues((v) => ({ ...v, staffMemberId: id }))}
                            isOnLeave={(s) => leaveStaffIds.has(s.id)}
                            isSkillBlocked={(s) => mode === 'create' && !staffAllowedForService(s)}
                          />
                        )}
                      </Field>

                      <Field label="Süre (dk)">
                        <input
                          type="number"
                          min={5}
                          className={`${control} tabular-nums`}
                          value={values.durationMinutes}
                          onChange={(e) => setValues((v) => ({ ...v, durationMinutes: Number(e.target.value) }))}
                        />
                      </Field>

                      {mode === 'edit' && (
                        <Field label="Durum" helper="“Tamamlandı” seçilince paket bakiyesi düşer.">
                          <select
                            className={control}
                            value={values.status}
                            onChange={(e) => setValues((v) => ({ ...v, status: e.target.value }))}
                          >
                            {statusOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    </div>

                    {/* Uyarılar — seçim yapıldıktan sonra, tam da ilgili adımda */}
                    <AnimatePresence>
                      {selectedStaffSkillBlocked && (
                        <Warn key="skill" tone="amber" icon={UserCog}>
                          <strong>{selectedStaff?.name}</strong>, <strong>{selectedService?.name}</strong> kategorisinde
                          yetkili değil. Farklı personel seç ya da personel kartından yetki ver.
                        </Warn>
                      )}
                      {selectedStaffOnLeave && (
                        <Warn key="leave" tone="rose" icon={Plane}>
                          <strong>{selectedStaff?.name || 'Seçili personel'}</strong> {leaveDateLabel} tarihinde izinli.
                          {mode === 'edit'
                            ? ' Bu güne taşınamaz; iptal edebilir ya da başka güne alabilirsin.'
                            : ' Farklı personel veya tarih seç.'}
                        </Warn>
                      )}
                    </AnimatePresence>
                  </Step>

                  {/* 4 — NOT */}
                  <Step n={4} title="Not" hint="İsteğe bağlı" done={Boolean(values.notes.trim())}>
                    <textarea
                      rows={2}
                      placeholder="Hassasiyetler, özel istekler, ödeme uyarısı…"
                      className={`${control} resize-none`}
                      value={values.notes}
                      onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                    />
                  </Step>
                </div>

                {/* ── SAĞ RAY: randevu kartı + müşteri ── */}
                <aside className="shrink-0 space-y-4 overflow-y-auto border-t border-[#efe1e7] bg-[#fdf9fb] px-6 py-6 lg:w-[380px] lg:border-l lg:border-t-0">
                  <Ticket
                    customerName={selectedCustomer?.name}
                    serviceName={selectedService?.name}
                    staffName={selectedStaff?.name}
                    date={values.date}
                    time={values.time}
                    duration={values.durationMinutes}
                    statusLabel={mode === 'edit' ? statusLabel : undefined}
                    complete={ticketComplete}
                  />

                  {/* MÜŞTERİ DOSYASI — para durumu, seans dökümü, son tahsilatlar.
                      Randevu verirken "bu müşteri kim, ne ödedi, kaç seansı kaldı" sorusunun
                      cevabı için başka ekrana gitmek gerekmiyordu. */}
                  {selectedCustomer && (
                    <div className="space-y-3 rounded-2xl border border-[#efe1e7] bg-white p-4">
                      {/* Para */}
                      <div className="grid grid-cols-2 gap-2">
                        <Metric label="Açık borç" value={formatTL(openDebt)} tone={openDebt > 0 ? 'debt' : 'plain'} />
                        <Metric label="Tahsil edilen" value={formatTL(paidTotal)} tone="plain" />
                      </div>

                      {/* SATIŞLAR — hangi paket/hizmet, ne kadar ve KİM SATTI.
                          Prim ve "bu müşteriyi kim kazandı" sorusu buradan okunur. */}
                      {custAccounts.length > 0 && (
                        <div className="border-t border-[#f4e8ee] pt-3">
                          <h5 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#a3576f]">Satışlar</h5>
                          <ul className="mt-2 space-y-2">
                            {custAccounts.slice(0, 4).map((a) => (
                              <li key={a.id}>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="min-w-0 truncate text-[12.5px] font-medium text-[#2b1e29]">{a.name}</span>
                                  <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#2b1e29]">
                                    {formatTL(a.totalAmount)}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px]">
                                  <span className="min-w-0 truncate text-[#705a66]">
                                    {a.soldByStaffName ? `Satan: ${a.soldByStaffName}` : 'Satan belirtilmemiş'}
                                  </span>
                                  {a.remainingAmount > 0 && (
                                    <span className="shrink-0 font-semibold tabular-nums text-[#8e3f5b]">
                                      {formatTL(a.remainingAmount)} kalan
                                    </span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Seans dökümü: yapılan / toplam */}
                      {sessionLedger.length > 0 && (
                        <div className="border-t border-[#f4e8ee] pt-3">
                          <h5 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#a3576f]">Seanslar</h5>
                          <ul className="mt-2 space-y-2">
                            {sessionLedger.map((s) => {
                              const pct = s.total > 0 ? Math.round((s.used / s.total) * 100) : 0
                              return (
                                <li key={s.name}>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="min-w-0 truncate text-[12.5px] font-medium text-[#2b1e29]">{s.name}</span>
                                    <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-[#705a66]">
                                      <span className="text-[#8e3f5b]">{s.used}</span> / {s.total} yapıldı
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#f4e4ea]">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-[#c7768f] to-[#8e3f5b]"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Son tahsilatlar */}
                      {recentPayments.length > 0 && (
                        <div className="border-t border-[#f4e8ee] pt-3">
                          <h5 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#a3576f]">
                            Son tahsilatlar
                          </h5>
                          <ul className="mt-2 space-y-1.5">
                            {recentPayments.map((p) => (
                              <li key={p.id} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                                <span className="text-[#705a66]">
                                  {new Date(p.occurredAtUtc).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
                                  {p.method && <span className="ml-1.5 text-[#4a3a44]">{methodLabel(p.method)}</span>}
                                </span>
                                <span className="shrink-0 font-semibold tabular-nums text-[#2b1e29]">
                                  {formatTL(p.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MÜŞTERİ GEÇMİŞİ — paketten kullanılan seansların TARİHLERİ, işlem defteri
                      ve tahsilat listesi. Üstteki dosya kartı "kaç seans kaldı"yı söylüyordu ama
                      "hangi gün geldi, ne zaman ödedi" hiçbir ekranda yan yana yoktu. */}
                  {selectedCustomer && (
                    <CustomerHistoryPanel
                      customerId={selectedCustomer.id}
                      tenantId={tenantId}
                      accounts={custAccounts}
                      refreshKey={sessRefreshKey}
                    />
                  )}

                  {/* Seçili seansın bakiyesi — randevu tamamlanınca 1 düşecek */}
                  {mode === 'create' && values.serviceDefinitionId && (
                    <SelectedSessionNote
                      bookable={bookableByService.find((s) => s.serviceDefinitionId === values.serviceDefinitionId)}
                    />
                  )}

                  {/* Müşteri seçilmeden ray boş kalmasın: burada NE yapılabileceğini söyle.
                      Kullanıcı özelliklerin varlığını keşfetmek için müşteri seçmek zorunda kalmaz. */}
                  {!selectedCustomer && (
                    <div className="rounded-2xl border border-dashed border-[#e8d5de] bg-white/70 p-4">
                      <h4 className="font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">
                        Müşteri seçince burada
                      </h4>
                      <ul className="mt-2.5 space-y-2">
                        {[
                          { icon: Banknote, label: 'Tahsilat al', note: 'açık borcu görüp tahsil et' },
                          { icon: Package, label: 'Paket / hizmet sat', note: 'seans anında açılır' },
                          { icon: ReceiptText, label: 'Adisyon aç', note: 'ürün, ek işlem, ödeme' },
                        ].map((i) => (
                          <li key={i.label} className="flex items-start gap-2.5">
                            <i.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#c7768f]" strokeWidth={1.8} />
                            <span className="text-[12.5px] leading-snug text-[#4a3a44]">
                              <span className="font-semibold">{i.label}</span>
                              <span className="text-[#705a66]"> — {i.note}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Müşteri işlemleri — randevuya değil MÜŞTERİYE yapılan işler */}
                  {selectedCustomer && (
                    <div className="rounded-2xl border border-[#efe1e7] bg-white p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">
                          {selectedCustomer.name.split(' ')[0]} için
                        </h4>
                        {openDebt > 0 && (
                          <span className="text-[11px] font-semibold text-[#705a66]">
                            borç{' '}
                            <span className="font-display text-[13px] font-extrabold tabular-nums text-[#8e3f5b]">
                              {formatTL(openDebt)}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => setCollectOpen(true)}
                          disabled={custAccounts.length === 0}
                          title={custAccounts.length === 0 ? 'Bu müşterinin açık carisi yok' : undefined}
                          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#8e3f5b] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#7c3450] disabled:cursor-not-allowed disabled:bg-[#d9c3cd]"
                        >
                          <Banknote className="h-4 w-4" strokeWidth={1.9} />
                          Tahsilat al
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <PackageSaleDialog
                            tenantId={tenantId}
                            stayOnPage
                            presetCustomer={{ id: selectedCustomer.id, name: selectedCustomer.name, branchId: selectedCustomer.branchId ?? null }}
                            onDone={() => setSessRefreshKey((k) => k + 1)}
                            triggerLabel="Paket sat"
                            triggerClassName="inline-flex !min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[#e8c2d1] bg-white px-2 !py-2 text-[12.5px] font-semibold text-[#8e3f5b] transition-colors hover:bg-[#fff4f8]"
                          />
                          <PackageSaleDialog
                            tenantId={tenantId}
                            serviceSale
                            stayOnPage
                            presetCustomer={{ id: selectedCustomer.id, name: selectedCustomer.name, branchId: selectedCustomer.branchId ?? null }}
                            onDone={() => setSessRefreshKey((k) => k + 1)}
                            triggerLabel="Hizmet sat"
                            triggerClassName="inline-flex !min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[#e8c2d1] bg-white px-2 !py-2 text-[12.5px] font-semibold text-[#8e3f5b] transition-colors hover:bg-[#fff4f8]"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setAdisyonOpen(true)}
                          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#e8c2d1] bg-white px-3 text-[12.5px] font-semibold text-[#8e3f5b] transition-colors hover:bg-[#fff4f8]"
                        >
                          <ReceiptText className="h-4 w-4" strokeWidth={1.9} />
                          Adisyon aç
                        </button>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </div>

          {/* ── ALT ÇUBUK ────────────────────────────────────────────────── */}
          <footer className="shrink-0 border-t border-[#efe1e7] bg-white px-6 py-4 sm:px-7">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-medium text-rose-700"
                >
                  {error}
                </motion.div>
              )}
              {waitlistPrompt && !waitlistDone && (
                <motion.div
                  key="wl"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-3 flex flex-col gap-2.5 rounded-xl border border-[#f0dcc4] bg-[#fdf6ec] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-2 text-[12.5px] leading-snug text-[#8a6524]">
                    <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-[#b8863b]" strokeWidth={1.8} />
                    <span>
                      {waitlistPrompt}{' '}
                      <strong>
                        {selectedCustomer?.name
                          ? `${selectedCustomer.name} bekleme listesine eklensin mi?`
                          : 'Bekleme listesine eklensin mi?'}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddToWaitlist}
                    disabled={waitlistBusy}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#b8863b] px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#a3752f] disabled:opacity-60"
                  >
                    {waitlistBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" strokeWidth={2.2} />}
                    Bekleme listesine ekle
                  </button>
                </motion.div>
              )}
              {waitlistDone && (
                <motion.div
                  key="wl-ok"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-medium text-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" /> Bekleme listesine eklendi. Yer açılınca müşteriye WhatsApp&apos;tan
                  teklif gidecek.
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => !saving && onOpenChange(false)}
                disabled={saving}
                className="rounded-xl border border-[#efe1e7] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#705a66] transition-colors hover:border-[#e8c2d1] hover:text-[#2b1e29] disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || saved || submitBlockedByLeave}
                className="inline-flex items-center gap-2 rounded-xl bg-[#8e3f5b] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_14px_28px_-18px_rgba(142,63,91,0.9)] transition-colors hover:bg-[#7c3450] disabled:cursor-not-allowed disabled:bg-[#d9c3cd] disabled:shadow-none"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <CalendarClock className="h-4 w-4" strokeWidth={1.9} />
                )}
                {saved ? 'Kaydedildi' : submitLabel}
              </button>
            </div>
          </footer>
        </DialogContent>

        {/* Hızlı müşteri kaydı — müşteriler sayfasındaki formun aynısı, randevudan ayrılmadan */}
        {mode === 'create' && onQuickCreateCustomer && (
          <CustomerFormDialog
            mode="create"
            open={quickCustomerOpen}
            onOpenChange={setQuickCustomerOpen}
            description="Müşteriyi kaydet; randevu modalında otomatik seçilir."
            onSubmit={async (formValues) => {
              const created = await onQuickCreateCustomer(formValues)
              if (created) {
                setExtraCustomers((prev) => [...prev, created])
                setValues((v) => ({ ...v, customerId: created.id, serviceDefinitionId: '', durationMinutes: 30 }))
              }
            }}
          />
        )}
      </Dialog>

      {/* Randevu modalı içinden müşteri adisyon kartı — Ön Muhasebe'ye gitmeden */}
      {selectedCustomer && (
        <AdisyonModal
          open={adisyonOpen}
          onOpenChange={(o) => {
            setAdisyonOpen(o)
            if (!o) setSessRefreshKey((k) => k + 1)
          }}
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.name}
          tenantId={tenantId}
          onChanged={() => setSessRefreshKey((k) => k + 1)}
          defaultStaffMemberId={values.staffMemberId || undefined}
        />
      )}

      {/* Tahsilat — randevu modalından çıkmadan. Cari listesi müşteriye kilitli. */}
      {selectedCustomer && (
        <CollectionDialog
          hideTrigger
          open={collectOpen}
          onOpenChange={setCollectOpen}
          accounts={custAccounts}
          title={`${selectedCustomer.name} · tahsilat`}
          description="Ödeme, seçilen carinin en eski vadesinden başlayarak taksitlere dağıtılır. Birden çok yöntem eklenebilir."
          onSubmit={async (p) => {
            await adminApi.registerAccountPayment(
              p.accountId,
              { amount: p.amount, method: p.method, reference: p.reference, occurredAtUtc: p.occurredAtUtc },
              tenantId,
            )
            setSessRefreshKey((k) => k + 1)
          }}
        />
      )}
    </>
  )
}

/* ── küçük yardımcılar ──────────────────────────────────────────────────── */

function EmptyNote({ icon: Icon, spin, children }: { icon: typeof User; spin?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-[#e8d5de] bg-white/70 px-4 py-5 text-[12.5px] text-[#705a66]">
      <Icon className={`h-4 w-4 shrink-0 text-[#c7768f] ${spin ? 'animate-spin' : ''}`} strokeWidth={1.8} />
      {children}
    </div>
  )
}

function Warn({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'amber' | 'rose'
  icon: typeof User
  children: ReactNode
}) {
  const cls =
    tone === 'amber'
      ? 'border-[#f0dcc4] bg-[#fdf6ec] text-[#8a6524]'
      : 'border-rose-200 bg-rose-50 text-rose-700'
  const iconCls = tone === 'amber' ? 'text-[#b8863b]' : 'text-rose-500'
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={`mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-snug ${cls}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`} strokeWidth={1.8} />
      <span>{children}</span>
    </motion.div>
  )
}

/** Rayda iki sütunlu küçük sayı kutusu (borç / tahsil edilen). */
function Metric({ label, value, tone }: { label: string; value: string; tone: 'debt' | 'plain' }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'debt' ? 'border-[#e8c2d1] bg-[#fff4f8]' : 'border-[#efe1e7] bg-[#fdf9fb]'}`}>
      <div className="text-[11px] font-semibold text-[#705a66]">{label}</div>
      <div
        className={`mt-0.5 font-display text-[15px] font-extrabold tabular-nums leading-none ${
          tone === 'debt' ? 'text-[#8e3f5b]' : 'text-[#2b1e29]'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

/** Backend ödeme yöntemi kodunu insan diline çevirir. */
function methodLabel(method: string): string {
  const key = method.toLowerCase()
  if (key.includes('cash') || key.includes('nakit')) return 'Nakit'
  if (key.includes('card') || key.includes('kart')) return 'Kart'
  if (key.includes('transfer') || key.includes('havale') || key.includes('eft')) return 'Havale'
  return method
}

function SelectedSessionNote({
  bookable,
}: {
  bookable?: { serviceName: string; remaining: number; total: number }
}) {
  if (!bookable) return null
  return (
    <div className="rounded-2xl border border-[#efe1e7] bg-white px-4 py-3">
      <div className="text-[11.5px] font-semibold text-[#705a66]">Seçili işlemin bakiyesi</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-display text-[24px] font-extrabold leading-none tabular-nums text-[#8e3f5b]">
          {bookable.remaining}
        </span>
        <span className="text-[12px] font-semibold tabular-nums text-[#705a66]">/ {bookable.total} seans</span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#705a66]">
        Randevu “Tamamlandı” olunca 1 seans düşer.
      </p>
    </div>
  )
}
