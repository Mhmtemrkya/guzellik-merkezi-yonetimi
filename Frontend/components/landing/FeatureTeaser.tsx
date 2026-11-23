import Link from 'next/link'
import { ArrowUpRight, Check } from 'lucide-react'
import { spotlights } from '@/lib/landing/featureHighlights'
import { spotlightIcons } from './FeatureHighlights'
import styles from './FeatureTeaser.module.css'

/**
 * Öne çıkan özellikler — ana sayfa ÖZETİ (kullanıcı isteği 23 Kas 2026: "ana sayfada özet kısmı olacak", ayrıntı Modüller
 * sayfasında). Her kart Modüller sayfasındaki kendi bölümüne gider.
 */
export default function FeatureTeaser() {
  return (
    <section id="ozellikler" className={styles.section} aria-labelledby="teaser-title">
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>Öne çıkan özellikler</p>
          <h2 id="teaser-title">Salonunuzu büyüten <span>dört güç.</span></h2>
        </div>
        <Link className={styles.all} href="/moduller#ozellikler">Tüm özellikler ve modüller <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>

      <ul className={styles.grid}>
        {spotlights.map(({ id, kicker, tone, short }) => {
          const Icon = spotlightIcons[id] ?? Check
          return (
            <li key={id} data-tone={tone}>
              <Link className={styles.card} href={`/moduller#${id}`}>
                <span className={styles.icon} aria-hidden="true"><Icon size={24} strokeWidth={1.8} /></span>
                <strong>{kicker}</strong>
                <span className={styles.short}>{short}</span>
                <span className={styles.more}>Ayrıntılar <ArrowUpRight size={15} aria-hidden="true" /></span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
