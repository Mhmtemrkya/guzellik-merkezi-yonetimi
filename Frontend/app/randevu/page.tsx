'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  Clock3,
  ListChecks,
  LogOut,
  MapPin,
  NotebookPen,
  Sparkles,
  UserRound,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import {
  createPortalAppointment,
  customerLogout,
  getCustomerSession,
  getPortalAvailability,
  getPortalProfile,
  listMyPortalAppointments,
  listPortalBranches,
  listPortalServices,
  listPortalStaff,
  portalStatusMeta,
  PortalApiError,
  type PortalAppointment,
  type PortalAvailability,
  type PortalBranch,
  type PortalProfile,
  type PortalService,
  type PortalStaff,
} from '@/lib/customerPortalApi'

type Step = 1 | 2 | 3 | 4 | 5

const stepMeta: { step: Step; label: string; icon: LucideIcon }[] = [
  { step: 1, label: 'Şube', icon: MapPin },
  { step: 2, label: 'Hizmet', icon: WandSparkles },
  { step: 3, label: 'Uzman', icon: UserRound },
  { step: 4, label: 'Tarih & Saat', icon: CalendarDays },
  { step: 5, label: 'Onay', icon: CalendarCheck },
]

function formatPrice(value: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(value)
}

function formatAppointmentDate(utc: string): string {
  return new Date(utc).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Bugünden itibaren 14 günlük seçilebilir tarih listesi. */
function upcomingDates(): { value: string; day: string; weekday: string; month: string }[] {
  const days: { value: string; day: string; weekday: string; month: string }[] = []
  const now = new Date()
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({
      value,
      day: String(d.getDate()),
      weekday: d.toLocaleDateString('tr-TR', { weekday: 'short' }),
      month: d.toLocaleDateString('tr-TR', { month: 'short' }),
    })
  }
  return days
}

const cardCls =
  'rounded-[28px] border border-[#ead8df]/80 bg-white/92 p-5 shadow-[0_24px_68px_-48px_rgba(142,63,91,0.75)]'

export default function CustomerPortalPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<PortalProfile | null>(null)
  const [branches, setBranches] = useState<PortalBranch[]>([])
  const [services, setServices] = useState<PortalService[]>([])
  const [staff, setStaff] = useState<PortalStaff[]>([])
  const [availability, setAvailability] = useState<PortalAvailability | null>(null)
  const [appointments, setAppointments] = useState<PortalAppointment[]>([])

  const [step, setStep] = useState<Step>(1)
  const [branch, setBranch] = useState<PortalBranch | null>(null)
  const [service, setService] = useState<PortalService | null>(null)
  const [expert, setExpert] = useState<PortalStaff | null>(null)
  const dates = useMemo(upcomingDates, [])
  const [date, setDate] = useState(dates[0].value)
  const [slot, setSlot] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const [loading, setLoading] = useState(false)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<PortalAppointment | null>(null)
  // Salon sayfasından gelen ön-seçim (?branch=..&service=..) — şubeler/hizmetler yüklenince uygulanır.
  const [pendingServiceId, setPendingServiceId] = useState<string | null>(null)

  const handleAuthError = useCallback(
    (err: unknown): string => {
      if (err instanceof PortalApiError && err.status === 401) {
        const next = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/randevu'
        router.replace(`/randevu/giris?next=${encodeURIComponent(next)}`)
        return ''
      }
      return err instanceof Error ? err.message : 'Bir hata oluştu. Lütfen tekrar deneyin.'
    },
    [router],
  )

  // Oturum kontrolü + başlangıç verileri
  useEffect(() => {
    if (!getCustomerSession()) {
      const next = `${window.location.pathname}${window.location.search}`
      router.replace(`/randevu/giris?next=${encodeURIComponent(next)}`)
      return
    }
    void (async () => {
      try {
        const [me, branchList, myAppointments] = await Promise.all([
          getPortalProfile(),
          listPortalBranches(),
          listMyPortalAppointments(),
        ])
        setProfile(me)
        setBranches(branchList)
        setAppointments(myAppointments)
        // Salon sayfasından gelen ön-seçim: ?branch=<id>[&service=<id>]
        const params = new URLSearchParams(window.location.search)
        const wantedBranch = params.get('branch')
        const preselected = wantedBranch ? branchList.find((b) => b.id === wantedBranch) : undefined
        if (preselected) {
          setBranch(preselected)
          setPendingServiceId(params.get('service'))
          setStep(2)
        } else if (branchList.length === 1) {
          setBranch(branchList[0])
        }
        setReady(true)
      } catch (err) {
        const message = handleAuthError(err)
        if (message) {
          setError(message)
          setReady(true)
        }
      }
    })()
  }, [router, handleAuthError])

  // Şube seçilince hizmetler
  useEffect(() => {
    if (!branch) return
    setServices([])
    void listPortalServices(branch.id)
      .then((list) => {
        setServices(list)
        // Salon sayfasındaki "Randevu Al" ile gelen hizmet ön-seçimi.
        setPendingServiceId((pending) => {
          if (pending) {
            const match = list.find((sv) => sv.id === pending)
            if (match) {
              setService(match)
              setStep(3)
            }
          }
          return null
        })
      })
      .catch((err) => setError(handleAuthError(err)))
  }, [branch, handleAuthError])

  // Hizmet seçilince uzmanlar
  useEffect(() => {
    if (!branch || !service) return
    setStaff([])
    void listPortalStaff(branch.id, service.id)
      .then(setStaff)
      .catch((err) => setError(handleAuthError(err)))
  }, [branch, service, handleAuthError])

  // Tarih/uzman seçilince slotlar
  useEffect(() => {
    if (!branch || !service || !expert || step !== 4) return
    setSlot(null)
    setAvailability(null)
    setSlotsLoading(true)
    void getPortalAvailability(branch.id, expert.id, service.id, date)
      .then(setAvailability)
      .catch((err) => setError(handleAuthError(err)))
      .finally(() => setSlotsLoading(false))
  }, [branch, service, expert, date, step, handleAuthError])

  const goTo = (next: Step): void => {
    setError('')
    setStep(next)
  }

  const handleCreate = async (): Promise<void> => {
    if (!branch || !service || !expert || !slot) return
    setError('')
    try {
      setLoading(true)
      // Slot yerel Türkiye saatiyle "HH:mm" gelir; tarayıcı yerel saatinden UTC'ye çevrilir.
      const startUtc = new Date(`${date}T${slot}:00`).toISOString()
      const appointment = await createPortalAppointment({
        branchId: branch.id,
        staffMemberId: expert.id,
        serviceDefinitionId: service.id,
        startUtc,
        notes: notes.trim() || null,
      })
      setCreated(appointment)
      setAppointments(await listMyPortalAppointments().catch(() => appointments))
    } catch (err) {
      const message = handleAuthError(err)
      if (message) setError(message)
    } finally {
      setLoading(false)
    }
  }

  const resetWizard = (): void => {
    setCreated(null)
    setService(null)
    setExpert(null)
    setSlot(null)
    setNotes('')
    setError('')
    setStep(branches.length === 1 ? 2 : 1)
  }

  const handleLogout = async (): Promise<void> => {
    await customerLogout()
    router.replace('/randevu/giris')
  }

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff7fa]">
        <div className="flex items-center gap-3 text-[13px] font-semibold text-[#8d7180]">
          <motion.span
            aria-hidden
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
            className="h-4 w-4 rounded-full border-2 border-[#c85776] border-t-transparent"
          />
          Randevu portalı hazırlanıyor...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#fff7fa] text-[#352432]">
      {/* Üst bar */}
      <header className="sticky top-0 z-40 border-b border-[#e7bfd0]/80 bg-[#fbe7ef]/85 backdrop-blur-2xl">
        <span aria-hidden className="block h-[3px] w-full bg-gradient-to-r from-[#df6688] via-[#f5abc0] to-[#ee789a]" />
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3" aria-label="BeautyAsist ana sayfa">
            <span className="grid h-10 w-10 place-items-center">
              <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full object-contain" />
            </span>
            <span className="leading-none">
              <span className="block font-display text-[17px] tracking-[-0.04em] text-[#6f4153]">BeautyAsist</span>
              <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.26em] text-[#b58295]">
                Online Randevu
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            {profile && (
              <span className="hidden items-center gap-2 rounded-full border border-[#ead8df] bg-white/80 px-4 py-2 text-[12px] font-semibold text-[#6f4153] sm:inline-flex">
                <UserRound className="h-3.5 w-3.5 text-[#c85776]" />
                {profile.fullName}
              </span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#ead8df] bg-white/80 px-4 text-[12px] font-bold text-[#6f4153] transition hover:border-[#ef9ab5] hover:text-[#c85776]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.45fr_0.9fr]">
        {/* SOL — randevu sihirbazı */}
        <section>
          <div className="mb-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0] bg-white/75 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b65f7b]">
              <Sparkles className="h-3.5 w-3.5" />
              Yeni randevu
            </div>
            <h1 className="mt-3 font-display text-[clamp(2rem,4.5vw,3rem)] leading-[1.02] tracking-[-0.05em] text-[#251923]">
              Randevunuzu adım adım oluşturun.
            </h1>
            {profile && (
              <p className="mt-2 text-[13px] text-[#755d6d]">
                {profile.tenantName} · {profile.fullName}
              </p>
            )}
          </div>

          {/* Adım göstergesi */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {stepMeta.map(({ step: s, label, icon: Icon }, index) => {
              const active = step === s
              const done = step > s
              return (
                <div key={s} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => done && !created && goTo(s)}
                    disabled={!done || Boolean(created)}
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-bold transition ${
                      active
                        ? 'border-[#c85776] bg-[#c85776] text-white shadow-[0_14px_30px_-18px_rgba(200,87,118,0.8)]'
                        : done
                          ? 'border-[#efbfd0] bg-[#fff0f5] text-[#c85776]'
                          : 'border-[#ead8df] bg-white/70 text-[#9b7b8d]'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Icon className="h-3.5 w-3.5" />}
                    {label}
                  </button>
                  {index < stepMeta.length - 1 && <span className="hidden h-px w-4 bg-[#ead8df] sm:block" />}
                </div>
              )
            })}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                key="wizard-error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-4 rounded-2xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className={cardCls}>
            {created ? (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                  <Clock3 className="h-7 w-7" strokeWidth={2.5} />
                </span>
                <h2 className="mt-5 font-display text-[30px] tracking-[-0.04em] text-[#251923]">Talebiniz onaya gönderildi!</h2>
                <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-[#755d6d]">
                  <strong>{created.serviceName}</strong> — {created.staffName} ·{' '}
                  {formatAppointmentDate(created.startUtc)}. Randevunuz salon tarafından onaylandığında
                  &quot;Randevularım&quot; listenizde durumu güncellenecek.
                </p>
                <button
                  type="button"
                  onClick={resetWizard}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-6 text-[13px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)]"
                >
                  Yeni Randevu Al <ArrowRight className="h-4 w-4" />
                </button>
              </motion.div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  {step === 1 && (
                    <div>
                      <h2 className="font-display text-[22px] text-[#251923]">Şube seçin</h2>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {branches.map((b) => {
                          const active = branch?.id === b.id
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setBranch(b)
                                setService(null)
                                setExpert(null)
                                goTo(2)
                              }}
                              className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${
                                active
                                  ? 'border-[#c85776] bg-[#fff0f5]'
                                  : 'border-[#ead8df] bg-[#fffafb] hover:border-[#efbfd0] hover:bg-white'
                              }`}
                            >
                              <span className="flex items-center gap-3">
                                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                                  <MapPin className="h-4.5 w-4.5" />
                                </span>
                                <span>
                                  <span className="block text-[14px] font-bold text-[#2f1724]">{b.name}</span>
                                  <span className="mt-0.5 block text-[11px] font-semibold text-[#9b7b8d]">
                                    {b.tenantName} · {b.city}
                                  </span>
                                </span>
                              </span>
                              <ArrowRight className="h-4 w-4 text-[#c85776]" />
                            </button>
                          )
                        })}
                        {branches.length === 0 && (
                          <p className="text-[13px] text-[#755d6d]">Şu anda randevu alınabilecek bir şube bulunamadı.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div>
                      <h2 className="font-display text-[22px] text-[#251923]">Hizmet seçin</h2>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {services.map((s) => {
                          const active = service?.id === s.id
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setService(s)
                                setExpert(null)
                                goTo(3)
                              }}
                              className={`rounded-2xl border p-4 text-left transition ${
                                active
                                  ? 'border-[#c85776] bg-[#fff0f5]'
                                  : 'border-[#ead8df] bg-[#fffafb] hover:border-[#efbfd0] hover:bg-white'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                                  <WandSparkles className="h-4.5 w-4.5" />
                                </span>
                                <span className="rounded-full bg-[#fff7fa] px-2.5 py-1 text-[11px] font-bold text-[#b65f7b] ring-1 ring-[#f0dfe7]">
                                  {formatPrice(s.price)}
                                </span>
                              </div>
                              <div className="mt-3 text-[14px] font-bold text-[#2f1724]">{s.name}</div>
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#9b7b8d]">
                                <Clock3 className="h-3.5 w-3.5" />
                                {s.durationMinutes} dk{s.category ? ` · ${s.category}` : ''}
                              </div>
                            </button>
                          )
                        })}
                        {services.length === 0 && (
                          <p className="text-[13px] text-[#755d6d]">Hizmetler yükleniyor ya da bu şubede tanımlı hizmet yok.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div>
                      <h2 className="font-display text-[22px] text-[#251923]">Uzman seçin</h2>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {staff.map((person) => {
                          const active = expert?.id === person.id
                          return (
                            <button
                              key={person.id}
                              type="button"
                              onClick={() => {
                                setExpert(person)
                                goTo(4)
                              }}
                              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                                active
                                  ? 'border-[#c85776] bg-[#fff0f5]'
                                  : 'border-[#ead8df] bg-[#fffafb] hover:border-[#efbfd0] hover:bg-white'
                              }`}
                            >
                              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#f7d0dc] to-[#fff3f7] text-[15px] font-bold text-[#c85776] ring-1 ring-[#efbfd0]">
                                {person.photoUrl ? (
                                  <img src={person.photoUrl} alt={person.fullName} className="h-full w-full object-cover" />
                                ) : (
                                  person.fullName.slice(0, 1).toUpperCase()
                                )}
                              </span>
                              <span>
                                <span className="block text-[14px] font-bold text-[#2f1724]">{person.fullName}</span>
                                <span className="mt-0.5 block text-[11px] font-semibold text-[#9b7b8d]">
                                  {person.title}
                                  {person.specialties ? ` · ${person.specialties}` : ''}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                        {staff.length === 0 && (
                          <p className="text-[13px] text-[#755d6d]">Bu hizmeti verebilecek uzman bulunamadı.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {step === 4 && (
                    <div>
                      <h2 className="font-display text-[22px] text-[#251923]">Tarih ve saat seçin</h2>
                      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                        {dates.map((d) => {
                          const active = date === d.value
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => setDate(d.value)}
                              className={`flex min-w-[64px] shrink-0 flex-col items-center rounded-2xl border px-3 py-2.5 transition ${
                                active
                                  ? 'border-[#c85776] bg-[#c85776] text-white'
                                  : 'border-[#ead8df] bg-[#fffafb] text-[#6f5968] hover:border-[#efbfd0]'
                              }`}
                            >
                              <span className="text-[10px] font-bold uppercase">{d.weekday}</span>
                              <span className="font-display text-[20px] leading-tight">{d.day}</span>
                              <span className={`text-[10px] font-semibold ${active ? 'text-white/80' : 'text-[#9b7b8d]'}`}>
                                {d.month}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-4">
                        {slotsLoading ? (
                          <div className="flex items-center gap-3 py-6 text-[12.5px] font-semibold text-[#8d7180]">
                            <motion.span
                              aria-hidden
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                              className="h-3.5 w-3.5 rounded-full border-2 border-[#c85776] border-t-transparent"
                            />
                            Uygun saatler getiriliyor...
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                            {(availability?.slots || []).map((s) => {
                              const active = slot === s.start
                              return (
                                <button
                                  key={s.start}
                                  type="button"
                                  disabled={!s.available}
                                  onClick={() => setSlot(s.start)}
                                  className={`rounded-xl border py-2.5 text-[13px] font-bold transition ${
                                    !s.available
                                      ? 'cursor-not-allowed border-[#f0e6ea] bg-[#faf4f6] text-[#c9b4bf] line-through'
                                      : active
                                        ? 'border-[#c85776] bg-[#c85776] text-white shadow-[0_12px_26px_-14px_rgba(200,87,118,0.8)]'
                                        : 'border-[#ead8df] bg-[#fffafb] text-[#4d3947] hover:border-[#efbfd0] hover:bg-white'
                                  }`}
                                >
                                  {s.start}
                                </button>
                              )
                            })}
                            {(availability?.slots || []).length === 0 && (
                              <p className="col-span-full py-4 text-[13px] text-[#755d6d]">
                                Bu tarihte uygun saat yok — başka bir gün deneyin.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="mt-5 flex justify-between">
                        <button
                          type="button"
                          onClick={() => goTo(3)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#ead8df] bg-white px-5 text-[12.5px] font-bold text-[#6f4153] transition hover:border-[#ef9ab5]"
                        >
                          <ArrowLeft className="h-4 w-4" /> Geri
                        </button>
                        <button
                          type="button"
                          disabled={!slot}
                          onClick={() => goTo(5)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-6 text-[12.5px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)] disabled:opacity-50"
                        >
                          Devam Et <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {step === 5 && branch && service && expert && slot && (
                    <div>
                      <h2 className="font-display text-[22px] text-[#251923]">Randevu özeti</h2>
                      <div className="mt-4 grid gap-2.5">
                        {[
                          { label: 'Şube', value: `${branch.name} · ${branch.city}`, icon: MapPin },
                          { label: 'Hizmet', value: `${service.name} · ${service.durationMinutes} dk · ${formatPrice(service.price)}`, icon: WandSparkles },
                          { label: 'Uzman', value: `${expert.fullName} — ${expert.title}`, icon: UserRound },
                          {
                            label: 'Tarih & Saat',
                            value: `${new Date(`${date}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })} · ${slot}`,
                            icon: CalendarDays,
                          },
                        ].map(({ label, value, icon: Icon }) => (
                          <div key={label} className="flex items-center gap-3 rounded-2xl border border-[#f0e0e6] bg-[#fffafb] px-4 py-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span>
                              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b7b8d]">{label}</span>
                              <span className="mt-0.5 block text-[13.5px] font-semibold text-[#2f1724]">{value}</span>
                            </span>
                          </div>
                        ))}
                        <div className="rounded-2xl border border-[#f0e0e6] bg-[#fffafb] px-4 py-3">
                          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b7b8d]">
                            <NotebookPen className="h-3.5 w-3.5 text-[#d65f83]" /> Not (isteğe bağlı)
                          </label>
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            placeholder="Eklemek istediğiniz bir not var mı?"
                            className="mt-2 w-full resize-none bg-transparent text-[13px] text-[#352432] outline-none placeholder:text-[#352432]/[0.30]"
                          />
                        </div>
                      </div>
                      <div className="mt-5 flex justify-between">
                        <button
                          type="button"
                          onClick={() => goTo(4)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#ead8df] bg-white px-5 text-[12.5px] font-bold text-[#6f4153] transition hover:border-[#ef9ab5]"
                        >
                          <ArrowLeft className="h-4 w-4" /> Geri
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={handleCreate}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-6 text-[12.5px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)] disabled:opacity-60"
                        >
                          {loading ? 'Oluşturuluyor...' : 'Randevuyu Onayla'} <CalendarCheck className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </section>

        {/* SAĞ — randevularım */}
        <aside>
          <div className={cardCls}>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-[20px] text-[#251923]">
                <ListChecks className="h-4.5 w-4.5 text-[#d65f83]" />
                Randevularım
              </h2>
              <span className="rounded-full bg-[#fff0f5] px-3 py-1 text-[11px] font-bold text-[#b65f7b] ring-1 ring-[#ffd3df]">
                {appointments.length}
              </span>
            </div>
            <div className="mt-4 space-y-2.5">
              {appointments.length === 0 && (
                <p className="text-[13px] leading-6 text-[#755d6d]">
                  Henüz randevunuz yok. Soldaki adımlarla ilk randevunuzu oluşturabilirsiniz.
                </p>
              )}
              {appointments.map((a) => {
                const status = portalStatusMeta(a.status)
                const toneCls =
                  status.tone === 'emerald'
                    ? 'bg-emerald-50 text-emerald-700'
                    : status.tone === 'violet'
                      ? 'bg-violet-50 text-violet-700'
                      : status.tone === 'rose'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-slate-100 text-slate-600'
                return (
                  <div key={a.id} className="rounded-2xl border border-[#f0e0e6] bg-[#fffafb] p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13.5px] font-bold text-[#2f1724]">{a.serviceName || 'Hizmet'}</div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${toneCls}`}>{status.label}</span>
                    </div>
                    <div className="mt-1.5 text-[11.5px] font-semibold text-[#9b7b8d]">
                      {a.staffName} · {a.branchName}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#6f5968]">
                      <CalendarDays className="h-3.5 w-3.5 text-[#d65f83]" />
                      {formatAppointmentDate(a.startUtc)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
