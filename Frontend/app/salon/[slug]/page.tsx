'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Flower2,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Star,
} from 'lucide-react'
import PublicNavbar from '@/components/public/PublicNavbar'
import { getCustomerSession } from '@/lib/customerPortalApi'
import {
  getPublicSalon,
  getPublicSalonReviews,
  submitSalonReview,
  type PublicSalonDetail,
  type PublicSalonReviewList,
  type PublicSalonService,
} from '@/lib/publicSalonApi'
import SalonGallery from './SalonGallery'
import SalonReviews from './SalonReviews'
import styles from './salonProfile.module.css'

const REVIEW_PAGE_SIZE = 10
const SERVICE_PREVIEW_SIZE = 4
const STAFF_PREVIEW_SIZE = 4
const FAVORITES_KEY = 'beautyasist.salonFavorites'
const priceFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })
const ratingFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function readFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function getBookingHref(branchId?: string, serviceId?: string): string {
  const query = new URLSearchParams()
  if (branchId) query.set('branch', branchId)
  if (serviceId) query.set('service', serviceId)
  const params = query.toString()
  return params ? '/randevu?' + params : '/randevu'
}

function SalonProfile({ slug }: { slug: string }) {
  const [salon, setSalon] = useState<PublicSalonDetail | null>(null)
  const [salonError, setSalonError] = useState('')
  const [salonAttempt, setSalonAttempt] = useState(0)
  const [favorite, setFavorite] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [category, setCategory] = useState('')
  const [showAllServices, setShowAllServices] = useState(false)
  const [showAllStaff, setShowAllStaff] = useState(false)
  const [showMobileBooking, setShowMobileBooking] = useState(false)
  const heroBooking = useRef<HTMLAnchorElement>(null)
  const reviewsRequest = useRef(0)
  const [reviewList, setReviewList] = useState<PublicSalonReviewList | null>(null)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [failedReviewsPage, setFailedReviewsPage] = useState<number | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const [reviewFormOpen, setReviewFormOpen] = useState(false)
  const [formSalonStars, setFormSalonStars] = useState(5)
  const [formStaffStars, setFormStaffStars] = useState(5)
  const [formComment, setFormComment] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [formMessage, setFormMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setFavorite(readFavorites().includes(slug))
    setHasSession(Boolean(getCustomerSession()))
  }, [slug])

  useEffect(() => {
    let current = true
    getPublicSalon(slug)
      .then((detail) => {
        if (current) setSalon(detail)
      })
      .catch((error: unknown) => {
        if (current) setSalonError(error instanceof Error ? error.message : 'Salon yüklenemedi.')
      })
    return () => { current = false }
  }, [slug, salonAttempt])

  const requestReviews = useCallback(async (selectedBranchId: string, page: number) => {
    const request = ++reviewsRequest.current
    setReviewsLoading(true)
    setFailedReviewsPage(null)
    try {
      const list = await getPublicSalonReviews(slug, page, REVIEW_PAGE_SIZE, selectedBranchId || null)
      if (reviewsRequest.current !== request) return
      setReviewList((previous) => page === 1 || !previous
        ? list
        : { ...list, items: [...previous.items, ...list.items] })
    } catch {
      if (reviewsRequest.current === request) setFailedReviewsPage(page)
    } finally {
      if (reviewsRequest.current === request) setReviewsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void requestReviews(branchId, 1)
    return () => { reviewsRequest.current += 1 }
  }, [branchId, requestReviews])

  useEffect(() => {
    const anchor = heroBooking.current
    if (!salon || !anchor || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => {
      setShowMobileBooking(entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0))
    }, { rootMargin: '-61px 0px 0px 0px' })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [salon])

  function toggleFavorite() {
    const next = !favorite
    setFavorite(next)
    try {
      const favorites = readFavorites().filter((value) => value !== slug)
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next ? [...favorites, slug] : favorites))
    } catch {
      // Favori seçimi bu oturumda görünür kalır.
    }
  }

  function selectBranch(next: string) {
    if (next === branchId) return
    reviewsRequest.current += 1
    setBranchId(next)
    setShowAllServices(false)
    setShowAllStaff(false)
    setReviewList(null)
    setFailedReviewsPage(null)
    setReviewsLoading(true)
  }

  async function handleSubmitReview() {
    setFormMessage(null)
    setFormBusy(true)
    try {
      await submitSalonReview(slug, {
        staffStars: formStaffStars,
        salonStars: formSalonStars,
        comment: formComment.trim() || null,
      })
      setFormComment('')
      setFormMessage({ ok: true, text: 'Değerlendirmeniz için teşekkürler! Yorumunuz yayınlandı.' })
      // Kaydın hangi şubeye ait olduğunu sunucu belirler.
      refreshReviews.current()
    } catch (error) {
      setFormMessage({ ok: false, text: error instanceof Error ? error.message : 'Yorum gönderilemedi.' })
    } finally {
      setFormBusy(false)
    }
  }

  const refreshReviews = useRef(() => void requestReviews(branchId, 1))
  useEffect(() => {
    refreshReviews.current = () => void requestReviews(branchId, 1)
  }, [branchId, requestReviews])

  if (!salon) {
    return (
      <div className={styles.profile}>
        <PublicNavbar variant="detail" />
        <main className={styles.frame}>
          {salonError ? (
            <section className={styles.error}>
              <Flower2 size={36} aria-hidden="true" />
              <h1>Salon profili açılamadı</h1>
              <p role="alert">{salonError}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => { setSalonError(''); setSalonAttempt((attempt) => attempt + 1) }}
                >
                  Tekrar dene
                </button>
                <Link href="/salonlar" className={styles.secondary}>Salonlara dön</Link>
              </div>
            </section>
          ) : (
            <div className={styles.skeleton} role="status">
              <span>Salon profili yükleniyor…</span>
              <div aria-hidden="true" />
            </div>
          )}
        </main>
      </div>
    )
  }

  const aggregates = reviewList?.aggregates ?? salon.aggregates
  const rating = aggregates.salonAvg ?? aggregates.staffAvg
  const photos = [...new Set([...salon.sliderPhotos, ...salon.servicePhotos].filter(Boolean))]
  const location = [salon.address, salon.city].filter(Boolean).join(' · ')
  const mapHref = salon.mapUrl || 'https://maps.google.com/?q=' + encodeURIComponent([salon.name, location].filter(Boolean).join(' '))
  const bookingHref = getBookingHref(branchId || salon.branches[0]?.id)
  const serviceGroups = salon.services
    .map((group) => ({
      ...group,
      items: branchId ? group.items.filter((service) => !service.branchId || service.branchId === branchId) : group.items,
    }))
    .filter((group) => group.items.length > 0)
  const activeGroup = serviceGroups.find((group) => group.category === category) ?? serviceGroups[0]
  const activeServices = activeGroup?.items ?? []
  const visibleServices = showAllServices ? activeServices : activeServices.slice(0, SERVICE_PREVIEW_SIZE)
  const staff = salon.staff.filter((member) => !branchId || !member.branchId || member.branchId === branchId)
  const visibleStaff = showAllStaff ? staff : staff.slice(0, STAFF_PREVIEW_SIZE)
  const hasContact = Boolean(location || salon.mapUrl || salon.workingHoursText || salon.publicEmail || salon.publicPhone || salon.instagram)
  const instagramHandle = salon.instagram?.trim().replace(/^@/, '')

  const serviceHref = (service: PublicSalonService) =>
    getBookingHref(service.branchId || branchId || salon.branches[0]?.id, service.id)

  return (
    <div className={styles.profile}>
      <PublicNavbar variant="detail" favorite={{ active: favorite, onToggle: toggleFavorite }} />
      <main className={styles.frame}>
        <section className={styles.hero} aria-labelledby="salon-name">
          <div className={styles.identity}>
            <div className={styles.identityMark}>
              <span className={styles.salonLogo}>
                {salon.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={salon.logo} alt="" />
                ) : (
                  <Flower2 size={25} strokeWidth={1.5} aria-hidden="true" />
                )}
              </span>
              {salon.isFeatured && (
                <span className={styles.featured}><Sparkles size={14} aria-hidden="true" /> Öne çıkan salon</span>
              )}
            </div>
            <h1 id="salon-name">{salon.name}</h1>
            <div className={styles.meta}>
              {location && (
                <a href={mapHref} target="_blank" rel="noreferrer">
                  <MapPin size={18} aria-hidden="true" /> {location}
                </a>
              )}
              <a href="#yorumlar">
                <Star size={17} fill="currentColor" aria-hidden="true" />
                {rating != null && <strong>{ratingFormat.format(rating)}</strong>}
                {aggregates.reviewCount ? aggregates.reviewCount + ' yorum' : 'Henüz yorum yok'}
              </a>
            </div>
            {salon.description && <p className={styles.description}>{salon.description}</p>}
            <div className={styles.actions}>
              <Link ref={heroBooking} href={bookingHref} className={styles.primary}>
                Randevu al <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <a href="#hizmetler" className={styles.secondary}>
                Hizmetleri incele <ArrowDown size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
          <SalonGallery photos={photos} name={salon.name} />
        </section>

        <nav className={styles.sectionNav} aria-label="Salon profili bölümleri">
          <a href="#hizmetler">Hizmetler</a>
          {hasContact && <a href="#salon-iletisim">Konum ve iletişim</a>}
          {staff.length > 0 && <a href="#ekip">Salon ekibi</a>}
          <a href="#yorumlar">Müşteri yorumları</a>
        </nav>

        {salon.branches.length > 1 && (
          <section className={styles.branches} aria-labelledby="branch-heading">
            <h2 id="branch-heading"><Building2 size={18} aria-hidden="true" /> Şubeler</h2>
            <div className={styles.chips}>
              <button type="button" aria-pressed={!branchId} onClick={() => selectBranch('')}>Tüm şubeler</button>
              {salon.branches.map((branch) => (
                <button key={branch.id} type="button" aria-pressed={branchId === branch.id} onClick={() => selectBranch(branch.id)}>
                  {branch.name}{branch.city ? ' · ' + branch.city : ''}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className={styles.content}>
          <section id="hizmetler" className={styles.services} aria-labelledby="services-heading">
            <header className={styles.sectionHeading}>
              <h2 id="services-heading">Hizmetler</h2>
              <p>Süre ve fiyatları inceleyin, aradığınız hizmeti seçin.</p>
            </header>
            {serviceGroups.length > 1 && (
              <div className={styles.chips} role="group" aria-label="Hizmet kategorileri">
                {serviceGroups.map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    aria-pressed={group.category === activeGroup?.category}
                    onClick={() => { setCategory(group.category); setShowAllServices(false) }}
                  >
                    {group.category}
                  </button>
                ))}
              </div>
            )}
            {visibleServices.length > 0 ? (
              <>
                <div className={styles.menuHeading}>
                  <h3>{activeGroup?.category}</h3>
                  <span>{activeServices.length} hizmet</span>
                </div>
                <ul className={styles.serviceList} id="salon-service-list">
                  {visibleServices.map((service) => (
                    <li key={service.id} className={styles.service}>
                      <div>
                        <h4>{service.name}</h4>
                        <span><Clock3 size={15} aria-hidden="true" /> {service.durationMinutes} dk</span>
                      </div>
                      <strong>{priceFormat.format(service.price)} TL</strong>
                      <Link href={serviceHref(service)} className={styles.serviceLink} aria-label={service.name + ' için randevu al'}>
                        <span>Seç</span><ArrowUpRight size={17} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {activeServices.length > SERVICE_PREVIEW_SIZE && (
                  <button
                    type="button"
                    className={styles.expand}
                    aria-expanded={showAllServices}
                    aria-controls="salon-service-list"
                    onClick={() => setShowAllServices((current) => !current)}
                  >
                    {showAllServices ? 'Daha az göster' : 'Tüm hizmetleri göster'} <ChevronDown size={17} aria-hidden="true" />
                  </button>
                )}
              </>
            ) : (
              <p className={styles.empty}>{branchId ? 'Bu şubeye ait hizmet bulunamadı.' : 'Hizmet listesi henüz eklenmemiş.'}</p>
            )}
          </section>

          <aside className={styles.rail} aria-label="Randevu ve iletişim">
            <div className={styles.bookingCard}>
              <CalendarDays size={32} strokeWidth={1.5} aria-hidden="true" />
              <h2>Randevu oluşturun</h2>
              <p>Hizmetinizi seçin ve size uygun saati görüntüleyin.</p>
              <Link className={styles.primary} href={bookingHref}>
                Randevu al <ArrowRight size={19} aria-hidden="true" />
              </Link>
            </div>
            {hasContact && (
              <section id="salon-iletisim" className={styles.contact} aria-labelledby="contact-heading">
                <h2 id="contact-heading">İletişim ve konum</h2>
                <ul>
                  {(location || salon.mapUrl) && (
                    <li>
                      <MapPin size={18} aria-hidden="true" />
                      <div>
                        {location && <p>{location}</p>}
                        <a href={mapHref} target="_blank" rel="noreferrer">Yol tarifi al <ArrowUpRight size={14} aria-hidden="true" /></a>
                      </div>
                    </li>
                  )}
                  {salon.workingHoursText && <li><Clock3 size={18} aria-hidden="true" /><span className={styles.hours}>{salon.workingHoursText}</span></li>}
                  {salon.publicEmail && <li><Mail size={18} aria-hidden="true" /><a href={'mailto:' + salon.publicEmail}>{salon.publicEmail}</a></li>}
                  {salon.publicPhone && <li><Phone size={18} aria-hidden="true" /><a href={'tel:' + salon.publicPhone}>{salon.publicPhone}</a></li>}
                  {instagramHandle && (
                    <li>
                      <Instagram size={18} aria-hidden="true" />
                      <a href={'https://instagram.com/' + encodeURIComponent(instagramHandle)} target="_blank" rel="noreferrer">
                        @{instagramHandle}<ArrowUpRight size={14} aria-hidden="true" />
                      </a>
                    </li>
                  )}
                </ul>
              </section>
            )}
          </aside>
        </div>

        {staff.length > 0 && (
          <section id="ekip" className={styles.team} aria-labelledby="team-heading">
            <header className={styles.sectionHeading}><h2 id="team-heading">Salon ekibi</h2></header>
            <ul className={styles.teamGrid} id="salon-team-list">
              {visibleStaff.map((member) => (
                <li key={member.id} className={styles.teamMember}>
                  <span className={styles.staffPhoto}>
                    {member.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={member.photoUrl} alt="" loading="lazy" />
                    ) : member.fullName.slice(0, 1).toLocaleUpperCase('tr-TR')}
                  </span>
                  <h3>{member.fullName}</h3>
                  {member.title && <p>{member.title}</p>}
                  {member.avgStars != null && (
                    <span className={styles.staffRating}>
                      <Star size={15} fill="currentColor" aria-hidden="true" />
                      {ratingFormat.format(member.avgStars)} {member.ratingCount ? '(' + member.ratingCount + ')' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {staff.length > STAFF_PREVIEW_SIZE && (
              <button type="button" className={styles.expand} aria-expanded={showAllStaff} aria-controls="salon-team-list" onClick={() => setShowAllStaff((current) => !current)}>
                {showAllStaff ? 'Daha az göster' : 'Tüm ekibi göster'} <ChevronDown size={17} aria-hidden="true" />
              </button>
            )}
          </section>
        )}

        <SalonReviews
          slug={slug}
          aggregates={aggregates}
          reviews={reviewList?.items ?? []}
          total={reviewList?.total ?? 0}
          onLoadMore={() => requestReviews(branchId, (reviewList?.page ?? 0) + 1)}
          loading={reviewsLoading}
          loadError={failedReviewsPage ? 'Yorumlar yüklenemedi.' : undefined}
          onRetry={failedReviewsPage ? () => void requestReviews(branchId, failedReviewsPage) : undefined}
          hasSession={hasSession}
          formOpen={reviewFormOpen}
          onFormToggle={() => setReviewFormOpen((open) => !open)}
          salonStars={formSalonStars}
          onSalonStarsChange={setFormSalonStars}
          staffStars={formStaffStars}
          onStaffStarsChange={setFormStaffStars}
          comment={formComment}
          onCommentChange={setFormComment}
          submitting={formBusy}
          message={formMessage}
          onSubmit={handleSubmitReview}
        />
      </main>
      <footer className={styles.footer}>
        <Link href="/">BeautyAsist</Link>
        <Link href="/salonlar">Diğer salonları keşfet <ArrowRight size={16} aria-hidden="true" /></Link>
      </footer>
      <div className={styles.mobileBooking} hidden={!showMobileBooking}>
        <span>{salon.name}</span>
        <Link href={bookingHref} className={styles.primary}>Randevu al <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>
    </div>
  )
}

export default function SalonProfilePage() {
  const { slug } = useParams<{ slug: string }>()
  return <SalonProfile key={slug} slug={slug} />
}
