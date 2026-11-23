import Link from 'next/link'
import { ArrowUpRight, CalendarCheck2, Check, FileSpreadsheet, MessageCircle, MonitorSmartphone, type LucideIcon } from 'lucide-react'
import { moreFeatures, spotlights } from '@/lib/landing/featureHighlights'
import styles from './FeatureHighlights.module.css'

const icons: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  'online-randevu': CalendarCheck2,
  'veri-aktarimi': FileSpreadsheet,
  'her-cihaz': MonitorSmartphone,
}

/**
 * Öne çıkan özellikler (ana sayfa, #ozellikler). Sunucuda düz metin olarak basılır: arama motorları ve yapay zekâ
 * tarayıcıları da ziyaretçi gibi okur. Metinlerin kaynağı lib/landing/featureHighlights.ts.
 */
export default function FeatureHighlights() {
  return (
    <section id="ozellikler" className={styles.section} aria-labelledby="features-title">
      <header className={styles.intro}>
        <p className={styles.kicker}>Öne çıkan özellikler</p>
        <h2 id="features-title">Salonunuz için gereken <span>her şey bir arada.</span></h2>
        <p>WhatsApp bildirimlerinden online randevuya, eski kayıtlarınızı aktarmaktan her cihazda çalışmaya kadar.</p>
      </header>

      <div className={styles.spotlights}>
        {spotlights.map(({ id, kicker, title, lead, points }, index) => {
          const Icon = icons[id] ?? Check
          return (
            <article key={id} id={id} className={styles.spotlight} data-tone={index % 2 === 0 ? 'blush' : 'night'} aria-labelledby={`${id}-title`}>
              <div className={styles.spotHead}>
                <span className={styles.spotIcon} aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
                <p className={styles.spotKicker}>{kicker}</p>
              </div>
              <h3 id={`${id}-title`}>{title}</h3>
              <p className={styles.lead}>{lead}</p>
              <ul className={styles.points}>
                {points.map((point) => (
                  <li key={point}><Check size={16} strokeWidth={2.4} aria-hidden="true" /><span>{point}</span></li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>

      <div className={styles.more}>
        <h3 className={styles.moreTitle}>Ve panelde dahası</h3>
        <ul className={styles.moreGrid}>
          {moreFeatures.map(({ title, body }) => (
            <li key={title}><strong>{title}</strong><span>{body}</span></li>
          ))}
        </ul>
        <Link className={styles.link} href="/moduller">Tüm modülleri ayrıntılı inceleyin <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>
    </section>
  )
}
