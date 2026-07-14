'use client'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Flower2,
  Heart,
  Instagram,
  Lock,
  Mail,
  MapPin,
  MessageSquareHeart,
  Phone,
  ShieldCheck,
  Sparkle,
  Star,
  UserRound,
  X,
} from 'lucide-react'
import {
  getPublicSalon,
  getPublicSalonReviews,
  submitSalonReview,
  type PublicSalonDetail,
  type PublicSalonReview,
  type PublicSalonService,
} from '@/lib/publicSalonApi'
import { getCustomerSession } from '@/lib/customerPortalApi'
import { StarPicker } from '@/components/public/Stars'
import PublicNavbar from '@/components/public/PublicNavbar'

const REVIEW_PAGE_SIZE = 10
const FAVORITES_KEY = 'beautyasist.salonFavorites'

function formatTl(v: number): string {
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v)} TL`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

function StarRow({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  const rounded = Math.round(value ?? 0)
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size, fill: i <= rounded ? '#f4a821' : '#ead9df', color: i <= rounded ? '#f4a821' : '#ead9df' }}
          strokeWidth={0}
        />
      ))}
    </span>
  )
}

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

/* ─── Kapak + lightbox ─── */
function CoverHero({ photos, name }: { photos: string[]; name: string }) {
  const [lightbox, setLightbox] = useState(false)
  const [index, setIndex] = useState(0)
  const cover = photos[0]

  return (
    <>
      <div className="relative h-56 w-full overflow-hidden rounded-[20px] sm:h-72 lg:h-[300px]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#fde5ee] to-[#f6cbd9]">
            <Flower2 className="h-16 w-16 text-[#df7c9c]/70" strokeWidth={1} />
          </div>
        )}
        {photos.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setIndex(0)
              setLightbox(true)
            }}
            className="absolute bottom-3.5 right-3.5 inline-flex items-center gap-2 rounded-full bg-white/94 px-3.5 py-2 text-[11.5px] font-bold text-[#33212b] shadow backdrop-blur transition-transform hover:scale-[1.03]"
          >
            <Camera className="h-3.5 w-3.5 text-[#e0517a]" /> {photos.length} Fotoğraf
          </button>
        )}
      </div>

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-[#231521]/85 px-4 backdrop-blur-sm"
            onClick={() => setLightbox(false)}
          >
            <button
              type="button"
              aria-label="Kapat"
              className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.img
                  key={index}
                  src={photos[index]}
                  alt={`${name} fotoğraf ${index + 1}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="max-h-[76vh] w-full rounded-[20px] object-contain"
                />
              </AnimatePresence>
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                    aria-label="Önceki"
                    className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#e0517a] shadow"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndex((i) => (i + 1) % photos.length)}
                    aria-label="Sonraki"
                    className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#e0517a] shadow"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <div className="mt-3 text-center text-[12px] font-semibold text-white/85">
                    {index + 1} / {photos.length}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-[24px] border border-white/80 bg-white p-5 shadow-[0_24px_54px_-46px_rgba(200,87,118,0.55)] sm:p-6 ${className}`}
    >
      {children}
    </motion.section>
  )
}

function ReviewCard({ review }: { review: PublicSalonReview }) {
  return (
    <div className="rounded-[20px] border border-[#f3e2e9] bg-white p-[18px] shadow-[0_18px_40px_-38px_rgba(200,87,118,0.55)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fdeef3] font-display text-[15px] text-[#e0517a]">
            {review.maskedName.slice(0, 1).toLocaleUpperCase('tr-TR')}
          </span>
          <div>
            <div className="text-[13px] font-bold tracking-wide text-[#33212b]">{review.maskedName}</div>
            <div className="text-[11px] text-[#9a8791]">{formatDate(review.submittedAtUtc)}</div>
          </div>
        </div>
        <StarRow value={review.salonStars ?? review.staffStars} size={15} />
      </div>
      {review.comment && <p className="mt-3 text-[13px] leading-relaxed text-[#4a3542]">{review.comment}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {review.serviceName && (
          <span className="rounded-full bg-[#fdeef3] px-2.5 py-1 text-[10px] font-semibold text-[#c85776]">
            {review.serviceName}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full border border-[#f3e2e9] px-2.5 py-1 text-[10px] font-semibold text-[#8a6a78]">
          <UserRound className="h-2.5 w-2.5" /> {review.staffName}
          <StarRow value={review.staffStars} size={9} />
        </span>
        {review.branchName && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#f3e2e9] px-2.5 py-1 text-[10px] font-semibold text-[#8a6a78]">
            <Building2 className="h-2.5 w-2.5" /> {review.branchName}
          </span>
        )}
      </div>
    </div>
  )
}

export default function SalonProfilePage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const slug = params?.slug || ''

  const [salon, setSalon] = useState<PublicSalonDetail | null>(null)
  const [reviews, setReviews] = useState<PublicSalonReview[]>([])
  const [reviewTotal, setReviewTotal] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [activeCategory, setActiveCategory] = useState('')
  // Çok şubeli kurum: '' = tüm şubeler; seçilince hizmet/personel/yorumlar o şubeye süzülür.
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [branchAggregates, setBranchAggregates] = useState<import('@/lib/publicSalonApi').PublicSalonAggregates | null>(null)
  const [selectedService, setSelectedService] = useState<PublicSalonService | null>(null)
  const [serviceListOpen, setServiceListOpen] = useState(false)
  const [showAllStaff, setShowAllStaff] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Yorum formu
  const [hasSession, setHasSession] = useState(false)
  const [reviewFormOpen, setReviewFormOpen] = useState(false)
  const [formSalonStars, setFormSalonStars] = useState(5)
  const [formStaffStars, setFormStaffStars] = useState(5)
  const [formComment, setFormComment] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [formMessage, setFormMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setHasSession(Boolean(getCustomerSession()))
    setFavorite(readFavorites().includes(slug))
  }, [slug])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    void Promise.all([getPublicSalon(slug), getPublicSalonReviews(slug, 1, REVIEW_PAGE_SIZE)])
      .then(([detail, reviewList]) => {
        setSalon(detail)
        const firstCat = detail.services[0]
        setActiveCategory(firstCat?.category || '')
        setSelectedService(firstCat?.items[0] ?? null)
        setReviews(reviewList.items)
        setReviewTotal(reviewList.total)
        setBranchAggregates(reviewList.aggregates ?? null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Salon yüklenemedi.'))
      .finally(() => setLoading(false))
  }, [slug])

  const toggleFavorite = (): void => {
    setFavorite((prev) => {
      const next = !prev
      try {
        const list = readFavorites().filter((s) => s !== slug)
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next ? [...list, slug] : list))
      } catch {
        /* depolama kapalıysa yalnızca görsel kalır */
      }
      return next
    })
  }

  const loadMoreReviews = useCallback(async () => {
    const next = reviewPage + 1
    const list = await getPublicSalonReviews(slug, next, REVIEW_PAGE_SIZE, selectedBranchId || null).catch(() => null)
    if (list) {
      setReviews((prev) => [...prev, ...list.items])
      setReviewTotal(list.total)
      setReviewPage(next)
    }
  }, [slug, reviewPage, selectedBranchId])

  // Şube değişince yorumlar + şube bazlı özet yeniden yüklenir.
  const selectBranch = useCallback(
    async (branchId: string) => {
      setSelectedBranchId(branchId)
      const list = await getPublicSalonReviews(slug, 1, REVIEW_PAGE_SIZE, branchId || null).catch(() => null)
      if (list) {
        setReviews(list.items)
        setReviewTotal(list.total)
        setReviewPage(1)
        setBranchAggregates(list.aggregates ?? null)
      }
    },
    [slug],
  )

  const defaultBranchId = selectedBranchId || salon?.branches[0]?.id
  const bookingHref = useCallback(
    (serviceId?: string): string => {
      const query = new URLSearchParams()
      if (defaultBranchId) query.set('branch', defaultBranchId)
      if (serviceId) query.set('service', serviceId)
      const qs = query.toString()
      return `/randevu${qs ? `?${qs}` : ''}`
    },
    [defaultBranchId],
  )

  const mapHref = useMemo(() => {
    if (!salon) return '#'
    if (salon.mapUrl) return salon.mapUrl
    const target = [salon.name, salon.address, salon.city].filter(Boolean).join(' ')
    return `https://maps.google.com/?q=${encodeURIComponent(target)}`
  }, [salon])

  // Şube filtresi: şubeye özel hizmetler (branchId eşleşen) + kurum geneli hizmetler (branchId null).
  const filteredGroups = useMemo(() => {
    const groups = salon?.services ?? []
    if (!selectedBranchId) return groups
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((sv) => !sv.branchId || sv.branchId === selectedBranchId),
      }))
      .filter((g) => g.items.length > 0)
  }, [salon, selectedBranchId])

  const activeServices = useMemo(
    () => filteredGroups.find((g) => g.category === activeCategory)?.items ?? [],
    [filteredGroups, activeCategory],
  )

  // Şube değişince seçili kategori/hizmet o şubede yoksa ilk geçerli olana kay.
  useEffect(() => {
    if (!salon) return
    const group = filteredGroups.find((g) => g.category === activeCategory) ?? filteredGroups[0]
    if (!group) {
      setSelectedService(null)
      return
    }
    if (group.category !== activeCategory) setActiveCategory(group.category)
    if (!group.items.some((sv) => sv.id === selectedService?.id)) setSelectedService(group.items[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGroups])

  const filteredStaff = useMemo(
    () => (selectedBranchId ? (salon?.staff ?? []).filter((m) => !m.branchId || m.branchId === selectedBranchId) : salon?.staff ?? []),
    [salon, selectedBranchId],
  )

  const selectCategory = (category: string): void => {
    setActiveCategory(category)
    setServiceListOpen(false)
    setSelectedService(filteredGroups.find((g) => g.category === category)?.items[0] ?? null)
  }

  const handleSubmitReview = async (): Promise<void> => {
    setFormMessage(null)
    setFormBusy(true)
    try {
      const created = await submitSalonReview(slug, {
        staffStars: formStaffStars,
        salonStars: formSalonStars,
        comment: formComment.trim() || null,
      })
      setReviews((prev) => [created, ...prev])
      setReviewTotal((t) => t + 1)
      setFormComment('')
      setFormMessage({ ok: true, text: 'Değerlendirmeniz için teşekkürler! Yorumunuz yayınlandı.' })
    } catch (err) {
      setFormMessage({ ok: false, text: err instanceof Error ? err.message : 'Yorum gönderilemedi.' })
    } finally {
      setFormBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fdf5f7]">
        <PublicNavbar variant="detail" />
        <div className="mx-auto max-w-7xl space-y-4 px-4 pt-4 sm:px-6">
          <div className="h-72 animate-pulse rounded-[22px] bg-[#fbe9f0]" />
          <div className="h-40 animate-pulse rounded-[24px] bg-white/90" />
          <div className="h-64 animate-pulse rounded-[24px] bg-white/90" />
        </div>
      </main>
    )
  }

  if (error || !salon) {
    return (
      <main className="min-h-screen bg-[#fdf5f7]">
        <PublicNavbar variant="detail" />
        <div className="grid place-items-center px-5 py-24">
          <div className="rounded-[24px] border border-[#f3e2e9] bg-white px-8 py-10 text-center">
            <div className="text-[16px] font-bold text-[#33212b]">{error || 'Salon bulunamadı.'}</div>
            <Link href="/salonlar" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#e0517a]">
              <ChevronLeft className="h-4 w-4" /> Tüm salonlara dön
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const agg = branchAggregates ?? salon.aggregates
  const overall = agg.salonAvg ?? agg.staffAvg
  const galleryPhotos = [...salon.sliderPhotos, ...salon.servicePhotos]
  const maxStarCount = Math.max(1, ...(agg.starCounts || []))
  const visibleStaff = showAllStaff ? filteredStaff : filteredStaff.slice(0, 4)
  const otherServices = activeServices.filter((sv) => sv.id !== selectedService?.id)

  return (
    <main className="min-h-screen bg-[#fdf5f7] pb-28 text-[#33212b]">
      <PublicNavbar variant="detail" />

      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-4 sm:px-6">
        {/* ÜST KART: kapak + bindirilmiş logo + kimlik */}
        <Card className="!p-3 sm:!p-3">
          <CoverHero photos={galleryPhotos} name={salon.name} />

          <div className="relative px-2 sm:px-5">
            {/* Kapağa bindirilmiş logo karosu */}
            <div className="pointer-events-none absolute -top-16 left-2 sm:-top-20 sm:left-5">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-[20px] border-4 border-white bg-gradient-to-b from-[#fdeef3] to-[#f8d7e2] shadow-[0_20px_44px_-24px_rgba(200,87,118,0.7)] sm:h-32 sm:w-32">
                {salon.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={salon.logo} alt={`${salon.name} logosu`} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <div className="font-display text-[34px] leading-none text-[#b2334f] sm:text-[40px]">
                      {salon.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
                    </div>
                    <div className="mx-auto mt-1.5 max-w-[92px] text-[7px] font-bold uppercase tracking-[0.18em] text-[#a06a7d] sm:text-[7.5px]">
                      {salon.name}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 pb-2 pl-32 pt-3 sm:pl-40 lg:flex-row lg:items-start lg:justify-between">
              {/* Kimlik */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-[22px] leading-tight text-[#231521] sm:text-[27px]">{salon.name}</h1>
                  <BadgeCheck className="h-5 w-5 shrink-0 text-[#e0517a]" strokeWidth={2} />
                </div>
                {(salon.address || salon.city) && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-[#6d5462] hover:text-[#e0517a]"
                  >
                    <MapPin className="h-3.5 w-3.5 text-[#e0517a]" />
                    {[salon.address, salon.city].filter(Boolean).join(' / ')}
                    <span className="font-bold text-[#e0517a]">(Haritada Gör)</span>
                  </a>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <StarRow value={overall} size={16} />
                  <span className="text-[14px] font-bold text-[#231521]">{overall ? overall.toFixed(1) : '—'}</span>
                  <span className="text-[12px] text-[#8a6a78]">({agg.reviewCount} yorum)</span>
                  {salon.isFeatured && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fdeef3] px-2.5 py-1 text-[10px] font-bold text-[#c85776]">
                      <Sparkle className="h-2.5 w-2.5" /> Premium Salon
                    </span>
                  )}
                </div>
              </div>

              {/* Aksiyonlar */}
              <div className="flex w-full shrink-0 flex-col gap-2 lg:w-60">
                <button
                  type="button"
                  onClick={() => router.push(bookingHref())}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[16px] bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-[14px] font-bold text-white shadow-[0_18px_36px_-16px_rgba(224,81,122,0.9)] transition-opacity hover:opacity-92"
                >
                  Randevu Al <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleFavorite}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[16px] border border-[#f3c6d4] bg-white text-[12.5px] font-bold text-[#e0517a] transition-colors hover:bg-[#fdeef3]"
                >
                  <Heart className="h-4 w-4" style={favorite ? { fill: '#e0517a' } : undefined} />
                  {favorite ? 'Favorilerde' : 'Favorilere Ekle'}
                </button>
              </div>
            </div>

            {salon.branches.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 pb-2 pt-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8a6a78]">
                  <Building2 className="h-3.5 w-3.5 text-[#e0517a]" /> Şubeler
                </span>
                <button
                  type="button"
                  onClick={() => void selectBranch('')}
                  className={`rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-all ${
                    selectedBranchId === ''
                      ? 'bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-white shadow-[0_10px_22px_-12px_rgba(224,81,122,0.9)]'
                      : 'border border-[#f3e2e9] bg-white text-[#6d5462] hover:text-[#e0517a]'
                  }`}
                >
                  Tüm Şubeler
                </button>
                {salon.branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => void selectBranch(b.id)}
                    className={`rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-all ${
                      selectedBranchId === b.id
                        ? 'bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-white shadow-[0_10px_22px_-12px_rgba(224,81,122,0.9)]'
                        : 'border border-[#f3e2e9] bg-white text-[#6d5462] hover:text-[#e0517a]'
                    }`}
                  >
                    {b.name}
                    {b.city ? ` · ${b.city}` : ''}
                  </button>
                ))}
              </div>
            )}
            {salon.description && (
              <p className="max-w-3xl px-0 pb-2 pt-1 text-[13px] leading-relaxed text-[#5f4855]">{salon.description}</p>
            )}
          </div>
        </Card>

        {/* İŞLETME BİLGİLERİ + HİZMETLER */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
          <Card>
            <h2 className="font-display text-[18px] text-[#231521]">İşletme Bilgileri</h2>
            <div className="mt-5 space-y-5 text-[12.5px] font-medium text-[#4a3542]">
              <div className="flex items-start gap-3.5">
                <MapPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#e0517a]" strokeWidth={1.8} />
                <div className="flex flex-wrap items-center gap-2">
                  <span>{[salon.address, salon.city].filter(Boolean).join(' / ') || 'Adres bilgisi bulunamadı'}</span>
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[#f3c6d4] px-2.5 py-1 text-[10px] font-bold text-[#e0517a] hover:bg-[#fdeef3]"
                  >
                    Yol Tarifi Al
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3.5">
                <Clock3 className="h-[18px] w-[18px] shrink-0 text-[#e0517a]" strokeWidth={1.8} />
                {salon.workingHoursText || 'Çalışma saati bilgisi bulunamadı'}
              </div>
              <div className="flex items-center gap-3.5">
                <Mail className="h-[18px] w-[18px] shrink-0 text-[#e0517a]" strokeWidth={1.8} />
                {salon.publicEmail || 'Mail bilgisi bulunamadı'}
              </div>
              {salon.publicPhone && (
                <div className="flex items-center gap-3.5">
                  <Phone className="h-[18px] w-[18px] shrink-0 text-[#e0517a]" strokeWidth={1.8} />
                  <a href={`tel:${salon.publicPhone}`} className="hover:text-[#e0517a]">{salon.publicPhone}</a>
                </div>
              )}
              {salon.instagram && (
                <div className="flex items-center gap-3.5">
                  <Instagram className="h-[18px] w-[18px] shrink-0 text-[#e0517a]" strokeWidth={1.8} />
                  <a href={`https://instagram.com/${salon.instagram}`} target="_blank" rel="noreferrer" className="hover:text-[#e0517a]">
                    {salon.instagram}
                  </a>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="h-5 w-1.5 rounded-full bg-gradient-to-b from-[#ef6f94] to-[#e0517a]" />
              <h2 className="font-display text-[18px] text-[#231521]">Hizmetler</h2>
            </div>
            {filteredGroups.length === 0 ? (
              <p className="mt-4 text-[12.5px] text-[#8a6a78]">Hizmet listesi henüz eklenmemiş.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                {/* Kategori listesi */}
                <div className="no-scrollbar flex gap-2 overflow-x-auto sm:w-40 sm:shrink-0 sm:flex-col sm:overflow-visible">
                  {filteredGroups.map((g) => (
                    <button
                      key={g.category}
                      type="button"
                      onClick={() => selectCategory(g.category)}
                      className={`shrink-0 rounded-[13px] px-4 py-2.5 text-left text-[12px] font-bold transition-all sm:w-full ${
                        g.category === activeCategory
                          ? 'bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-white shadow-[0_12px_26px_-14px_rgba(224,81,122,0.9)]'
                          : 'bg-[#fdf1f5] text-[#6d5462] hover:text-[#e0517a]'
                      }`}
                    >
                      {g.category}
                    </button>
                  ))}
                </div>

                {/* Seçili hizmet detay kartı */}
                <div className="min-w-0 flex-1">
                  {selectedService && (
                    <div className="rounded-[18px] border border-[#f3e2e9] bg-[#fffbfc] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="font-display text-[16.5px] text-[#231521]">{selectedService.name}</h3>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fdeef3] px-2 py-0.5 text-[9.5px] font-bold text-[#e0517a]">
                            <Flame className="h-2.5 w-2.5" /> Popüler
                          </span>
                        </div>
                        <div className="text-[16px] font-bold text-[#231521]">{formatTl(selectedService.price)}</div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-[#8a6a78]">
                        <Clock3 className="h-3 w-3 text-[#e0517a]" /> {selectedService.durationMinutes} dk
                      </div>
                      <p className="mt-2.5 text-[12px] leading-relaxed text-[#6d5462]">
                        {activeCategory} kategorisinde uzman kadromuzla uygulanır. Seans süresi yaklaşık{' '}
                        {selectedService.durationMinutes} dakikadır; uygun saatleri randevu adımında görebilirsiniz.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#f3e2e9] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#8a6a78]">
                          <Sparkle className="h-2.5 w-2.5 text-[#e0517a]" /> Profesyonel Uygulama
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#f3e2e9] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#8a6a78]">
                          <ShieldCheck className="h-2.5 w-2.5 text-[#e0517a]" /> Hijyen Garantisi
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#f3e2e9] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#8a6a78]">
                          <BadgeCheck className="h-2.5 w-2.5 text-[#e0517a]" /> Uzman Kadro
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(bookingHref(selectedService.id))}
                        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[13px] bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-[13px] font-bold text-white transition-opacity hover:opacity-92"
                      >
                        Randevu Al
                      </button>
                    </div>
                  )}

                  {/* Tüm hizmetler */}
                  {otherServices.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setServiceListOpen((v) => !v)}
                        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[14px] border border-[#f3c6d4] bg-white text-[12px] font-bold text-[#e0517a] transition-colors hover:bg-[#fdeef3]"
                      >
                        {serviceListOpen ? 'Listeyi Kapat' : 'Tüm Hizmetleri Gör'} <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <AnimatePresence initial={false}>
                        {serviceListOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 divide-y divide-[#f6e7ec] rounded-[16px] border border-[#f3e2e9] bg-white">
                              {activeServices.map((sv) => (
                                <button
                                  key={sv.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedService(sv)
                                    setServiceListOpen(false)
                                  }}
                                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fdf1f5] ${
                                    sv.id === selectedService?.id ? 'bg-[#fdf1f5]' : ''
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#33212b]">{sv.name}</span>
                                  <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-[#8a6a78]">
                                    <Clock3 className="h-3 w-3 text-[#e0517a]" /> {sv.durationMinutes} dk
                                  </span>
                                  <span className="shrink-0 text-[12.5px] font-bold text-[#231521]">{formatTl(sv.price)}</span>
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ÇALIŞANLAR */}
        {filteredStaff.length > 0 && (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[18px] text-[#231521]">Çalışanlar</h2>
              {filteredStaff.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllStaff((v) => !v)}
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-[#e0517a] transition-colors hover:text-[#b2334f]"
                >
                  {showAllStaff ? 'Daha Az Göster' : 'Tüm Çalışanları Gör'} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visibleStaff.map((m) => (
                <div
                  key={m.id}
                  className="relative rounded-[20px] border border-[#f3e2e9] bg-white px-3 py-5 text-center transition-shadow hover:shadow-[0_20px_44px_-36px_rgba(200,87,118,0.6)]"
                >
                  <span className="absolute right-3 top-3 text-[#eba7bd]">
                    <Heart className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  {m.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.photoUrl}
                      alt={m.fullName}
                      className="mx-auto h-20 w-20 rounded-full object-cover ring-2 ring-[#f6cbd9] ring-offset-2 ring-offset-white"
                    />
                  ) : (
                    <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-b from-[#fde5ee] to-[#f6cbd9] font-display text-xl text-[#c85776] ring-2 ring-[#f6cbd9] ring-offset-2 ring-offset-white">
                      {m.fullName.slice(0, 1).toLocaleUpperCase('tr-TR')}
                    </div>
                  )}
                  <div className="mt-3 truncate font-display text-[14px] text-[#231521]">{m.fullName}</div>
                  {m.title && <div className="mt-0.5 truncate text-[10.5px] font-semibold text-[#8a6a78]">{m.title}</div>}
                  <div className="mt-1.5 flex items-center justify-center gap-1">
                    <StarRow value={m.avgStars} size={11} />
                    {m.avgStars != null && (
                      <span className="text-[11px] font-bold text-[#33212b]">{m.avgStars.toFixed(1)}</span>
                    )}
                    {m.ratingCount > 0 && <span className="text-[10px] text-[#9a8791]">({m.ratingCount})</span>}
                  </div>
                  <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-[#fdeef3] px-2.5 py-1 text-[9.5px] font-bold text-[#c85776]">
                    <BadgeCheck className="h-2.5 w-2.5" /> Uzman
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* YORUMLAR */}
        <Card>
          <h2 className="font-display text-[18px] text-[#231521]">Yorumlar ({agg.reviewCount})</h2>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {/* Skor + dağılım */}
            <div className="flex items-center gap-5 rounded-[20px] border border-[#f3e2e9] bg-[#fffbfc] p-5">
              <div className="text-center">
                <div className="font-display text-[40px] leading-none text-[#231521]">
                  {overall ? overall.toFixed(1) : '—'}
                </div>
                <div className="mt-1.5 flex justify-center">
                  <StarRow value={overall} size={13} />
                </div>
                <div className="mt-1 text-[10.5px] font-semibold text-[#8a6a78]">{agg.reviewCount} değerlendirme</div>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = agg.starCounts?.[star - 1] ?? 0
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-3 text-right text-[10.5px] font-bold text-[#8a6a78]">{star}</span>
                      <Star className="h-2.5 w-2.5" style={{ fill: '#f4a821', color: '#f4a821' }} strokeWidth={0} />
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f6e7ec]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#f4a821] to-[#f7c04b]"
                          style={{ width: `${(count / maxStarCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-[10.5px] font-semibold tabular-nums text-[#9a8791]">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Güvenilir yorumlar */}
            <div className="rounded-[20px] border border-[#e3efe6] bg-[#f7fbf8] p-5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-[#2f7a52]">
                <ShieldCheck className="h-4 w-4" /> Güvenilir Yorumlar
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-[#4f6b59]">
                Tüm yorumlar gerçek müşteriler tarafından yapılmıştır. Deneyiminizi paylaşarak diğer
                kullanıcılara yardımcı olabilirsiniz.
              </p>
              <div className="mt-3 space-y-1.5 text-[11px] font-semibold text-[#2f7a52]">
                <div className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5" /> Doğrulanmış randevu
                </div>
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Gizliliğiniz korunur
                </div>
              </div>
            </div>

            {/* Deneyim paylaş */}
            <div className="rounded-[20px] border border-[#f3e2e9] bg-[#fffbfc] p-5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-[#231521]">
                <MessageSquareHeart className="h-4 w-4 text-[#e0517a]" /> Deneyiminizi paylaşın
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-[#6d5462]">
                Bu salonu ziyaret ettiniz mi? Deneyiminizi paylaşın, diğer kullanıcılara rehber olun.
              </p>
              {hasSession ? (
                <button
                  type="button"
                  onClick={() => setReviewFormOpen((v) => !v)}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#fdeef3] text-[12px] font-bold text-[#e0517a] transition-colors hover:bg-[#fbdce8]"
                >
                  {reviewFormOpen ? 'Formu Kapat' : 'Yorum Yap'}
                </button>
              ) : (
                <Link
                  href={`/randevu/giris?next=${encodeURIComponent(`/salon/${slug}`)}`}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#fdeef3] text-[12px] font-bold text-[#e0517a] transition-colors hover:bg-[#fbdce8]"
                >
                  Yorum Yapmak İçin Giriş Yapın
                </Link>
              )}
            </div>
          </div>

          {/* Yorum formu */}
          {hasSession && reviewFormOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 overflow-hidden rounded-[20px] border border-dashed border-[#f3c6d4] bg-[#fffbfc] p-5"
            >
              <div className="flex flex-wrap gap-8">
                <div>
                  <div className="mb-1.5 text-[11px] font-bold text-[#6d5462]">Salon değerlendirmesi</div>
                  <StarPicker value={formSalonStars} onChange={setFormSalonStars} disabled={formBusy} />
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-bold text-[#6d5462]">Personel değerlendirmesi</div>
                  <StarPicker value={formStaffStars} onChange={setFormStaffStars} disabled={formBusy} />
                </div>
              </div>
              <textarea
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
                rows={3}
                maxLength={600}
                placeholder="Deneyiminizi birkaç cümleyle anlatın (isteğe bağlı)…"
                className="mt-4 w-full rounded-[14px] border border-[#f3e2e9] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#eba7bd]"
              />
              {formMessage && (
                <div className={`mt-2 text-[12px] font-bold ${formMessage.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formMessage.text}
                </div>
              )}
              <button
                type="button"
                disabled={formBusy}
                onClick={() => void handleSubmitReview()}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-gradient-to-r from-[#ef6f94] to-[#e0517a] px-6 text-[12.5px] font-bold text-white transition-opacity hover:opacity-92 disabled:opacity-60"
              >
                {formBusy ? 'Gönderiliyor…' : 'Yorumu Gönder'}
              </button>
              <p className="mt-2 text-[10.5px] text-[#9a8791]">
                Yalnızca bu salonda tamamlanmış randevusu olan müşteriler yorum yapabilir. Adınız maskeli görünür.
              </p>
            </motion.div>
          )}

          {/* Yorum kartları */}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {reviews.length === 0 ? (
              <p className="col-span-full py-6 text-center text-[12.5px] text-[#9a8791]">
                Henüz yorum yok — ilk değerlendirmeyi siz yapın!
              </p>
            ) : (
              reviews.map((r, i) => <ReviewCard key={`${r.submittedAtUtc}-${i}`} review={r} />)
            )}
          </div>
          {reviews.length < reviewTotal && (
            <div className="pt-4 text-center">
              <button
                type="button"
                onClick={() => void loadMoreReviews()}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#f3c6d4] bg-white px-6 text-[12.5px] font-bold text-[#e0517a] transition-colors hover:bg-[#fdeef3]"
              >
                Tüm Yorumları Gör ({reviewTotal})
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* STICKY ALT BAR */}
      <motion.div
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.4, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-5"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-[22px] border border-white/70 bg-white/95 px-3.5 py-2.5 shadow-[0_24px_60px_-30px_rgba(200,87,118,0.6)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            {galleryPhotos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={galleryPhotos[0]} alt="" className="h-12 w-16 shrink-0 rounded-[12px] object-cover" />
            ) : (
              <span className="grid h-12 w-16 shrink-0 place-items-center rounded-[12px] bg-[#fdeef3] text-[#e0517a]">
                <Flower2 className="h-5 w-5" strokeWidth={1.6} />
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-[#231521]">{salon.name}</div>
              {(salon.address || salon.city) && (
                <div className="flex items-center gap-1 truncate text-[10.5px] font-medium text-[#8a6a78]">
                  <MapPin className="h-2.5 w-2.5 shrink-0 text-[#e0517a]" />
                  <span className="truncate">{[salon.address, salon.city].filter(Boolean).join(' / ')}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <StarRow value={overall} size={10} />
                <span className="text-[10px] font-semibold text-[#8a6a78]">
                  {overall ? overall.toFixed(1) : '—'} ({agg.reviewCount} yorum)
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(bookingHref())}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[16px] bg-gradient-to-r from-[#ef6f94] to-[#e0517a] px-6 text-[13px] font-bold text-white shadow-[0_16px_32px_-14px_rgba(224,81,122,0.9)] transition-opacity hover:opacity-92"
          >
            Randevu Al <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </main>
  )
}
