import Link from 'next/link'
import { ArrowUpRight, Flower2, MapPin, Star } from 'lucide-react'
import type { PublicSalonListItem } from '@/lib/publicSalonApi'
import styles from './SalonDirectoryCard.module.css'

const ratingFormat = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export default function SalonDirectoryCard({ salon }: { salon: PublicSalonListItem }) {
  const rating = salon.salonAvg ?? salon.staffAvg
  const categories = salon.categories ?? []
  const visibleCategories = categories.slice(0, 3)
  const additionalCategories = categories.length - visibleCategories.length
  const cover = salon.coverImage || salon.logo

  return (
    <article className={styles.card}>
      <Link
        href={`/salon/${encodeURIComponent(salon.slug)}`}
        className={styles.link}
        aria-label={`${salon.name} için randevu al`}
      >
        <div className={styles.visual}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              className={salon.coverImage ? styles.cover : styles.logoCover}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className={styles.placeholder} aria-hidden="true">
              <Flower2 size={38} strokeWidth={1.25} />
            </div>
          )}
          {salon.isFeatured && (
            <span className={styles.featured}>
              <Star size={13} aria-hidden="true" /> Öne çıkan
            </span>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.identity}>
            {salon.coverImage && salon.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={salon.logo} alt="" className={styles.avatar} loading="lazy" decoding="async" />
            )}
            <div className={styles.name}>
              <h3>{salon.name}</h3>
              {salon.city && <p className={styles.city}><MapPin size={14} aria-hidden="true" /> {salon.city}</p>}
            </div>
          </div>

          <div className={styles.rating}>
            <Star size={15} aria-hidden="true" />
            {rating === null ? 'Yeni' : <span><span className="sr-only">Puan </span>{ratingFormat.format(rating)} <span className="sr-only">/ 5</span></span>}
            {salon.reviewCount > 0 && <span className={styles.reviewCount}>{salon.reviewCount} yorum</span>}
          </div>

          {visibleCategories.length > 0 && (
            <ul className={styles.categories} aria-label="Hizmet kategorileri">
              {visibleCategories.map((category) => <li key={category}>{category}</li>)}
              {additionalCategories > 0 && <li><span className="sr-only">Ek kategori sayısı </span>+{additionalCategories}</li>}
            </ul>
          )}

          <p className={styles.action}>Randevu al <ArrowUpRight size={18} aria-hidden="true" /></p>
        </div>
      </Link>
    </article>
  )
}
