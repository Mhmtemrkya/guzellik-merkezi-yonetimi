'use client'

import Link from 'next/link'
import { ArrowDown, ArrowRight, Building2, MessageSquare, ShieldCheck, Star, UserRound } from 'lucide-react'
import type { PublicSalonAggregates, PublicSalonReview } from '@/lib/publicSalonApi'
import styles from './SalonReviews.module.css'

const ratingOptions = [1, 2, 3, 4, 5] as const
const ratingOrder = [...ratingOptions].reverse()
const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' })
const decimalFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('tr-TR')

type SalonReviewsProps = {
  slug: string
  aggregates: PublicSalonAggregates
  reviews: PublicSalonReview[]
  total: number
  loading?: boolean
  loadError?: string
  onRetry?: () => void
  onLoadMore: () => void | Promise<void>
  hasSession: boolean
  formOpen: boolean
  onFormToggle: () => void
  salonStars: number
  onSalonStarsChange: (value: number) => void
  staffStars: number
  onStaffStarsChange: (value: number) => void
  comment: string
  onCommentChange: (value: string) => void
  submitting: boolean
  message: { ok: boolean; text: string } | null
  onSubmit: () => void | Promise<void>
}

function RatingStars({ value, size = 15 }: { value: number | null; size?: number }) {
  return (
    <span className={styles.stars} role="img" aria-label={value ? `${decimalFormat.format(value)} / 5 yıldız` : 'Henüz puanlanmadı'}>
      {ratingOptions.map(star => (
        <Star key={star} size={size} data-filled={star <= Math.round(value ?? 0) || undefined} strokeWidth={0} aria-hidden="true" />
      ))}
    </span>
  )
}

function RatingPicker({ title, name, value, onChange, disabled }: {
  title: string
  name: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>{title}</legend>
      <div className={styles.ratingInputs}>
        {ratingOptions.map(star => (
          <label key={star}>
            <input type="radio" name={name} value={star} checked={value === star} onChange={() => onChange(star)} aria-label={`${star} yıldız`} />
            <span data-filled={star <= value || undefined}><Star size={23} strokeWidth={0} aria-hidden="true" /></span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ReviewCard({ review }: { review: PublicSalonReview }) {
  const date = new Date(review.submittedAtUtc)
  const name = review.maskedName.trim() || 'Salon müşterisi'

  return (
    <li className={styles.reviewCard}>
      <article>
        <header className={styles.reviewHeader}>
          <div className={styles.reviewer}>
            <span className={styles.avatar} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
            <div>
              <h3>{name}</h3>
              {Number.isFinite(date.getTime()) && <time dateTime={review.submittedAtUtc}>{dateFormat.format(date)}</time>}
            </div>
          </div>
          <RatingStars value={review.salonStars ?? review.staffStars} />
        </header>
        {review.comment && <p className={styles.reviewComment}>{review.comment}</p>}
        <ul className={styles.reviewDetails} aria-label="Randevu bilgileri">
          {review.serviceName && <li>{review.serviceName}</li>}
          {review.staffName && <li><UserRound size={13} aria-hidden="true" />{review.staffName}<RatingStars value={review.staffStars} size={9} /></li>}
          {review.branchName && <li><Building2 size={13} aria-hidden="true" />{review.branchName}</li>}
        </ul>
      </article>
    </li>
  )
}

export default function SalonReviews({
  slug, aggregates, reviews, total, loading = false, loadError, onRetry, onLoadMore,
  hasSession, formOpen, onFormToggle, salonStars, onSalonStarsChange, staffStars, onStaffStarsChange,
  comment, onCommentChange, submitting, message, onSubmit,
}: SalonReviewsProps) {
  const awaitingSummary = reviews.length === 0 && (loading || Boolean(loadError))
  const score = awaitingSummary ? null : aggregates.salonAvg ?? aggregates.staffAvg
  const starCounts = aggregates.starCounts ?? []
  const ratingTotal = starCounts.reduce((sum, count) => sum + count, 0)

  return (
    <section id="yorumlar" className={styles.section} aria-labelledby="salon-reviews-heading">
      <header className={styles.sectionHeading}>
        <p>Deneyimler</p>
        <h2 id="salon-reviews-heading">Müşteri yorumları</h2>
      </header>

      <div className={styles.overview}>
        <div className={styles.summary}>
          <div className={styles.score}>
            <p>Salon puanı</p>
            <div><strong>{score === null ? '—' : decimalFormat.format(score)}</strong><span> / 5</span></div>
            <div className={styles.scoreCount}>
              <RatingStars value={score} />
              <span>{awaitingSummary ? '—' : `${countFormat.format(aggregates.reviewCount)} değerlendirme`}</span>
            </div>
          </div>
          <ol className={styles.distribution} aria-label="Yıldız dağılımı">
            {ratingOrder.map(star => {
              const count = awaitingSummary ? 0 : starCounts[star - 1] ?? 0
              return (
                <li key={star}>
                  <span>{star}<Star size={11} strokeWidth={0} aria-hidden="true" /><span className="sr-only"> yıldız</span></span>
                  <span className={styles.ratingTrack} aria-hidden="true"><span style={{ inlineSize: `${ratingTotal > 0 ? count / ratingTotal * 100 : 0}%` }} /></span>
                  <span>{awaitingSummary ? '—' : countFormat.format(count)}</span>
                </li>
              )
            })}
          </ol>
        </div>

        <div className={styles.invite}>
          <span className={styles.iconTile}><ShieldCheck size={21} strokeWidth={1.7} aria-hidden="true" /></span>
          <div>
            <h3>Deneyiminizi paylaşın.</h3>
            <p>Yorumlar tamamlanmış randevulara dayanır. Adınız diğer ziyaretçilere maskeli görünür.</p>
          </div>
          {hasSession ? (
            <button className={styles.action} type="button" aria-expanded={formOpen} aria-controls="salon-review-form" onClick={onFormToggle}>
              {formOpen ? 'Formu kapat' : 'Yorum yap'} <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : (
            <Link className={styles.action} href={`/randevu/giris?next=${encodeURIComponent(`/salon/${slug}`)}`}>
              Yorum yapmak için giriş yapın <ArrowRight size={15} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {hasSession && (
        <form id="salon-review-form" className={styles.form} hidden={!formOpen} onSubmit={event => { event.preventDefault(); if (!submitting) void onSubmit() }}>
          <div className={styles.formRatings}>
            <RatingPicker title="Salon değerlendirmesi" name="salonStars" value={salonStars} onChange={onSalonStarsChange} disabled={submitting} />
            <RatingPicker title="Personel değerlendirmesi" name="staffStars" value={staffStars} onChange={onStaffStarsChange} disabled={submitting} />
          </div>
          <label className={styles.field}>
            <span>Yorumunuz <small>(isteğe bağlı)</small></span>
            <textarea value={comment} onChange={event => onCommentChange(event.target.value)} rows={4} maxLength={600} disabled={submitting} placeholder="Salon deneyiminizi anlatın." />
          </label>
          {message && <p role={message.ok ? 'status' : 'alert'} className={styles.formMessage} data-success={message.ok}>{message.text}</p>}
          <button className={styles.action} type="submit" disabled={submitting}>{submitting ? 'Gönderiliyor…' : 'Yorumu gönder'}</button>
        </form>
      )}

      <div className={styles.feed} aria-busy={loading}>
        {reviews.length > 0 && (
          <ul className={styles.comments} aria-label="Müşteri yorumları">
            {reviews.map((review, index) => <ReviewCard key={`${review.submittedAtUtc}-${index}`} review={review} />)}
          </ul>
        )}
        {loading && reviews.length === 0 && <p className={styles.feedMessage} role="status">Yorumlar yükleniyor…</p>}
        {!loading && loadError && (
          <div className={styles.feedMessage}>
            <p role="alert">{loadError}</p>
            {onRetry && <button className={styles.secondary} type="button" onClick={onRetry}>Tekrar dene</button>}
          </div>
        )}
        {!loading && !loadError && reviews.length === 0 && (
          <p className={styles.feedMessage}><MessageSquare size={18} aria-hidden="true" /> Henüz yorum yok.</p>
        )}
        {reviews.length > 0 && reviews.length < total && !loadError && (
          <div className={styles.pagination}>
            <button className={styles.secondary} type="button" onClick={() => void onLoadMore()} disabled={loading}>
              {loading ? 'Yükleniyor…' : 'Daha fazla yorum göster'} <ArrowDown size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
