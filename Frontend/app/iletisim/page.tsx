import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Clock3, Mail, MapPin, Phone } from 'lucide-react'
import PublicNavbar from '@/components/public/PublicNavbar'
import { company } from '@/lib/legal/company'
import styles from './iletisim.module.css'

export const metadata: Metadata = {
  title: 'İletişim | BeautyAsist',
  description: 'BeautyAsist’in telefon, e-posta ve adres bilgilerine ulaşın. Teknik destek talebi oluşturun veya açık talebinizi takip edin.',
}

const phoneHref = `tel:${company.phone.replace(/\s/g, '')}`
const addressHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company.address)}`

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <PublicNavbar />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="contact-title">
          <div className={styles.heroCopy}>
            <div className={styles.heroHeading}>
              <h1 id="contact-title">İletişim</h1>
              <figure className={styles.maydi}>
                <Image src="/mascots/maydi/guiding.webp" alt="" width={256} height={320} unoptimized />
                <figcaption>Maydi</figcaption>
              </figure>
            </div>
            <p>BeautyAsist hakkında bilgi almak veya iş birliği önerinizi paylaşmak için bize ulaşın.</p>
          </div>

          <aside aria-labelledby="contact-support-title" className={styles.support}>
            <div className={styles.supportHours}>
              <Clock3 size={18} aria-hidden="true" />
              <span>{company.supportHours}</span>
            </div>
            <h2 id="contact-support-title">Teknik destek</h2>
            <p>Hesabınız veya uygulamayla ilgili bir sorun için talep oluşturup durumunu takip edebilirsiniz.</p>
            <div className={styles.supportActions}>
              <Link className={styles.primaryLink} href="/destek#talep">
                Destek talebi oluştur <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className={styles.trackLink} href="/destek/takip">Talebinizi takip edin</Link>
            </div>
          </aside>
        </section>

        <section className={styles.channels} aria-labelledby="contact-channels-title">
          <h2 id="contact-channels-title">Doğrudan ulaşın</h2>
          <ul className={styles.channelGrid}>
            <li>
              <a className={styles.channel} href={phoneHref}>
                <Phone className={styles.channelIcon} size={23} aria-hidden="true" />
                <h3>Telefon</h3>
                <p>{company.phone}</p>
                <span className={styles.channelAction}>Telefonla arayın <ArrowUpRight size={16} aria-hidden="true" /></span>
              </a>
            </li>
            <li>
              <a className={styles.channel} href={`mailto:${company.email}`}>
                <Mail className={styles.channelIcon} size={23} aria-hidden="true" />
                <h3>E-posta</h3>
                <p>{company.email}</p>
                <span className={styles.channelAction}>E-posta gönderin <ArrowUpRight size={16} aria-hidden="true" /></span>
              </a>
            </li>
            <li>
              <a className={styles.channel} href={addressHref} target="_blank" rel="noreferrer">
                <MapPin className={styles.channelIcon} size={23} aria-hidden="true" />
                <h3>Ofis</h3>
                <address>{company.address}</address>
                <span className={styles.channelAction}>Haritada açın <ArrowUpRight size={16} aria-hidden="true" /></span>
              </a>
            </li>
          </ul>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>{company.legalName}</p>
        <Link href="/gizlilik">Gizlilik Politikası</Link>
      </footer>
    </div>
  )
}
