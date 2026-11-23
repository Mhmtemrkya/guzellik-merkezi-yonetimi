import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Clock3, Download, MonitorSmartphone,
  Sparkles, Users, WalletCards,
} from 'lucide-react'
import AppLaunchDialog, { AppLaunchTrigger } from '@/components/landing/AppLaunchDialog'
import CustomerStory from '@/components/landing/CustomerStory'
import FeatureTeaser from '@/components/landing/FeatureTeaser'
import MotionReel from '@/components/landing/MotionReel'
import LandingPricing from '@/components/landing/LandingPricing'
import MaydiMotion from '@/components/landing/MaydiMotion'
import SalonDay from '@/components/landing/SalonDay'
import StoreLinks from '@/components/landing/StoreLinks'
import StudioSequence from '@/components/landing/StudioSequence'
import { FieldNotes, GettingStarted, LandingQuestions, StudioCapabilities } from '@/components/landing/StudioEditorial'
import PaymentBadges from '@/components/legal/PaymentBadges'
import MaydiMenu from '@/components/public/MaydiMenu'
import { fetchPublicPlans } from '@/lib/landingPlans'
import { featureQuestions, moreFeatures, spotlights } from '@/lib/landing/featureHighlights'
import { legalLinks } from '@/lib/legal/company'
import styles from './home.module.css'

export const metadata: Metadata = {
  title: 'BeautyAsist | Güzellik Merkezi Yönetimi ve Maydi',
  description: 'Güzellik merkezi yazılımı: online randevu ve müşteri portalı, WhatsApp hatırlatma ve onay, Excel’den veri aktarımı, seans, kasa ve stok. Web, iOS, Android, Mac ve Windows’ta; yapay zekâ asistanı Maydi ile.',
}

export const revalidate = 300

/**
 * Arama motorları ve yapay zekâ tarayıcıları için yapılandırılmış veri (schema.org). Metin, sayfadaki bölümlerle aynı
 * kaynaktan gelir (lib/landing/featureHighlights). JSON içinde "<" kaçışlanır: veri bloğu HTML'i kapatamaz.
 */
function structuredData(): string {
  const site = 'https://beautyasist.com'
  const graph = [
    {
      '@type': 'SoftwareApplication',
      name: 'BeautyAsist',
      url: site,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Güzellik merkezi ve salon yönetim yazılımı',
      operatingSystem: 'Web, iOS, iPadOS, Android, macOS, Windows',
      inLanguage: 'tr',
      description: 'Güzellik merkezleri için randevu, danışan, seans, kasa ve stok yönetimi; WhatsApp bildirimleri, online randevu ve müşteri portalı, Excel ile veri aktarımı.',
      featureList: [...spotlights.map(s => `${s.kicker}: ${s.lead}`), ...moreFeatures.map(f => `${f.title}: ${f.body}`)],
      offers: { '@type': 'Offer', description: '14 gün ücretsiz deneme, kredi kartı gerekmez.' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: featureQuestions.map(q => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
    },
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
}

const operations = [
  { title: 'Randevu ve takvim', description: 'Uzman, oda ve saatleri aynı takvimde planlayın.', icon: CalendarDays },
  { title: 'Danışan ve seans', description: 'Seansları, paketleri ve dijital onamları takip edin.', icon: Users },
  { title: 'Kasa ve raporlar', description: 'Tahsilatları, gün sonu kasasını ve raporları görün.', icon: WalletCards },
]

function Brand() {
  return (
    <Link href="/" className={styles.brand}>
      <Image src="/logo.png" alt="" width={44} height={44} />
      <span>BeautyAsist</span>
    </Link>
  )
}

function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Brand />
        <MaydiMenu />
      </div>
      <div className={styles.pageProgress} aria-hidden="true" />
    </header>
  )
}

function Hero() {
  return (
    <section className={styles.sceneFrame} aria-labelledby="hero-title">
      <div className={styles.heroScene}>
        <div className={styles.heroPhoto} aria-hidden="true">
          <Image src="/landing/studio-nightfall.webp" alt="" fill preload sizes="100vw" />
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> Güzellik merkezi yönetimi</p>
          <h1 id="hero-title" className={styles.heroTitle}>Güzellik işiniz <span>tek akışta.</span></h1>
          <p className={styles.lead}>Randevudan gün sonuna, danışanlarınızı, seanslarınızı ve kasanızı BeautyAsist’ten yönetin.</p>
          <div className={styles.actions}>
            <Link href="/kayit" className={styles.primaryButton}>Kayıt ol <ArrowUpRight aria-hidden="true" size={18} /></Link>
          </div>
          <p className={styles.trialNote}><Clock3 aria-hidden="true" size={15} /> 14 gün ücretsiz · Kredi kartı gerekmez</p>
        </div>
        <div className={styles.heroFooter}>
          <a href="#bir-gun-sahne" className={styles.heroJump}><ArrowDown size={16} aria-hidden="true" /> Salonun bir gününü keşfedin</a>
          <Link href="/salonlar" className={styles.heroBooking}>Salon bulun ve randevu alın <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  )
}

function Product() {
  return (
    <section id="tur" className={styles.frame} aria-labelledby="product-title">
      <StudioSequence>
        <div id="nasil" className={styles.productCopy}>
          <p className={styles.eyebrow}><span /> BeautyAsist paneli</p>
          <h2 id="product-title" className={styles.sectionTitle}>Ajandadan <span>gün sonuna.</span></h2>
          <ul className={styles.operations}>
            {operations.map(({ title, description, icon: Icon }) => (
              <li key={title}>
                <Icon size={19} aria-hidden="true" />
                <div><h3>{title}</h3><p>{description}</p></div>
              </li>
            ))}
          </ul>
          <Link href="/moduller" className={styles.textButton}>Tüm modülleri inceleyin <ArrowUpRight aria-hidden="true" size={17} /></Link>
        </div>
      </StudioSequence>
    </section>
  )
}

function Maydi() {
  return (
    <section id="maydi" className={`${styles.sceneFrame} ${styles.maydi}`} aria-labelledby="maydi-title">
      <div className={styles.maydiGrid}>
        <div className={styles.maydiCopy}>
          <p className={styles.eyebrow}><Sparkles aria-hidden="true" size={16} /> Yapay zekâ asistanınız</p>
          <h2 id="maydi-title" className={styles.sectionTitle}>Sorun, <span>Maydi anlatsın.</span></h2>
          <p className={styles.lead}>Bugünkü randevularınızı öğrenin, kasayı sorun veya bir işlemin nasıl yapıldığını adım adım görün. Maydi, yetkiniz dahilindeki bilgilerle BeautyAsist panelinde yardımcı olur.</p>
          <Link href="/login" className={`${styles.textButton} ${styles.maydiLink}`}>Maydi’yi panelde açın <ArrowUpRight aria-hidden="true" size={17} /></Link>
        </div>
        <MaydiMotion />
      </div>
    </section>
  )
}

function FinalScene() {
  return (
    <section className={`${styles.sceneFrame} ${styles.finalScene}`} aria-labelledby="final-title">
      <div className={styles.finalBackdrop} aria-hidden="true">
        <Image src="/landing/studio-after-hours.webp" alt="" fill sizes="100vw" />
      </div>
      <div className={styles.finalInner}>
        <Image className={styles.finalMark} src="/logo.png" alt="" width={128} height={128} />
        <p className={styles.eyebrow}><span /> BeautyAsist</p>
        <h2 id="final-title" className={styles.sectionTitle}>Bugünü kapatın. <span>Yarına hazır olun.</span></h2>
        <p className={styles.lead}>Yarınki randevularınızdan bugünün tahsilatına kadar, salonunuzun bütün günü yanınızda.</p>
        <div className={styles.actions}>
          <Link className={styles.primaryButton} href="/kayit">14 gün ücretsiz deneyin <ArrowUpRight size={17} aria-hidden="true" /></Link>
          <AppLaunchTrigger className={styles.finalDownload}><Download size={17} aria-hidden="true" /> Uygulamaları indirin</AppLaunchTrigger>
        </div>
      </div>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className={`${styles.sceneFrame} ${styles.footer}`}>
      <div className={styles.footerInner}>
        <div id="uygulamalar" className={styles.downloadArea}>
          <div className={styles.maydiPeek}>
            <a href="#maydi" className={styles.maydiBubble}>
              <strong>Psst… Ben Maydi!</strong>
              <span>Maydi ile tanış <ArrowUpRight size={13} aria-hidden="true" /></span>
            </a>
            <div className={styles.maydiCharacter} aria-hidden="true">
              <div className={styles.maydiPeekCrop}>
                <Image src="/mascots/maydi/happy.webp" alt="" width={256} height={320} unoptimized />
              </div>
              <i className={styles.maydiHand} />
              <i className={styles.maydiHand} />
            </div>
          </div>
          <div className={styles.download}>
            <div>
              <p className={styles.eyebrow}><MonitorSmartphone size={17} aria-hidden="true" /> Mobil ve masaüstü</p>
              <h2 className={styles.sectionTitle}>Uygulamalarımız <span>yayında.</span></h2>
              <p>BeautyAsist’i iPhone, iPad ve Android’de, BeautyAsist Desktop’ı Mac ve Windows’ta kullanın.</p>
            </div>
            <StoreLinks />
          </div>
        </div>
        <div className={styles.footerMain}>
          <div className={styles.footerBrand}>
            <Brand />
            <p>Güzellik merkezleri için yönetim platformu.</p>
            <PaymentBadges variant="white" showNote={false} />
          </div>
          <nav aria-label="BeautyAsist bağlantıları">
            <h3>Keşfedin</h3>
            <ul>
              <li><a href="#bir-gun-sahne">Salonun bir günü</a></li>
              <li><a href="#ozellikler">Öne çıkan özellikler</a></li>
              <li><Link href="/moduller">Modüller</Link></li>
              <li><a href="#danisan-deneyimi">Danışan deneyimi</a></li>
              <li><Link href="/salonlar">Salonları keşfet</Link></li>
              <li><Link href="/randevu">Randevularım</Link></li>
              <li><Link href="/kayit">Ücretsiz başla <ArrowRight size={13} aria-hidden="true" /></Link></li>
            </ul>
          </nav>
          <nav aria-label="Kurumsal ve yasal bağlantılar">
            <h3>Kurumsal ve yasal</h3>
            <ul className={styles.legalLinks}>
              {legalLinks.map(({ href, label }) => <li key={href}><Link href={href}>{label}</Link></li>)}
            </ul>
          </nav>
        </div>
        <p className={styles.copyright}>© {new Date().getFullYear()} BeautyAsist. Tüm hakları saklıdır.</p>
      </div>
    </footer>
  )
}

export default async function HomePage() {
  const plans = await fetchPublicPlans()

  return (
    <div className={styles.home}>
      <a className={styles.skip} href="#ana-icerik">Ana içeriğe geç</a>
      <Header />
      <main id="ana-icerik" tabIndex={-1}>
        <Hero />
        <MotionReel />
        <FieldNotes />
        <SalonDay />
        <Product />
        <StudioCapabilities />
        <FeatureTeaser />
        <Maydi />
        <CustomerStory />
        <GettingStarted />
        <LandingPricing plans={plans} />
        <LandingQuestions />
        <FinalScene />
      </main>
      <SiteFooter />
      <AppLaunchDialog />
      {/* Yalnız veri bloğu (çalıştırılmaz); içerik sabit kaynaktan, '<' kaçışlı. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData() }} />
    </div>
  )
}
