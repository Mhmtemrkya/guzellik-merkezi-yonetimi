import { CalendarCheck2, Check, FileSpreadsheet, MessageCircle, MonitorSmartphone, type LucideIcon } from 'lucide-react'
import { spotlights } from '@/lib/landing/featureHighlights'
import styles from './FeatureHighlights.module.css'

export const spotlightIcons: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  'online-randevu': CalendarCheck2,
  'veri-aktarimi': FileSpreadsheet,
  'her-cihaz': MonitorSmartphone,
}

/**
 * Öne çıkan özellikler — AYRINTILI hâli (Modüller sayfası, #ozellikler; kullanıcı isteği 23 Kas 2026: ana sayfada yalnız
 * özet, ayrıntı tüm modüllerin olduğu yerde). Sunucuda düz metin basılır: arama motorları ve yapay zekâ tarayıcıları da
 * okur. Metinlerin kaynağı lib/landing/featureHighlights.ts; her özelliğin rengi oradaki `tone`'dur.
 */
export default function FeatureHighlights() {
  return (
    <section id="ozellikler" className={styles.section} aria-labelledby="features-title">
      <header className={styles.intro} data-reveal>
        <p className={styles.kicker}>Öne çıkan özellikler</p>
        <h2 id="features-title">Salonunuzu büyüten <span>dört güç.</span></h2>
        <p>WhatsApp bildirimlerinden online randevuya, eski kayıtlarınızı aktarmaktan her cihazda çalışmaya kadar.</p>
      </header>

      <div className={styles.spotlights}>
        {spotlights.map(({ id, kicker, tone, title, lead, points }) => {
          const Icon = spotlightIcons[id] ?? Check
          return (
            <article key={id} id={id} className={styles.spotlight} data-tone={tone} data-reveal aria-labelledby={`${id}-title`}>
              <span className={styles.glow} aria-hidden="true" />
              <div className={styles.spotHead}>
                <span className={styles.spotIcon} aria-hidden="true"><Icon size={24} strokeWidth={1.8} /></span>
                <p className={styles.spotKicker}>{kicker}</p>
              </div>
              <h3 id={`${id}-title`}>{title}</h3>
              <p className={styles.lead}>{lead}</p>
              <ul className={styles.points}>
                {points.map((point) => (
                  <li key={point}><span className={styles.tick} aria-hidden="true"><Check size={13} strokeWidth={2.8} /></span><span>{point}</span></li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </section>
  )
}
