import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight, BarChart3, CalendarDays, CreditCard, FileLock2, KeyRound, LockKeyhole, MessageCircle, Package,
  ShieldCheck, UserRound, UsersRound, WalletCards, type LucideIcon,
} from 'lucide-react'
import { MailLink } from '@/components/legal/LegalPage'
import PaymentBadges from '@/components/legal/PaymentBadges'
import PublicNavbar from '@/components/public/PublicNavbar'
import { company } from '@/lib/legal/company'
import RevealOnScroll from '../moduller/RevealOnScroll'
import styles from './About.module.css'

export const metadata: Metadata = {
  title: 'Hakkımızda — BeautyAsist',
  description:
    'BeautyAsist; güzellik merkezleri, klinikler ve salonlar için randevu, müşteri, paket, seans, taksit ve ön muhasebe yönetimini tek panelde toplayan bir yönetim yazılımıdır.',
}

type Offer = { title: string; text: string; icon: LucideIcon; tone: string }

const offers: Offer[] = [
  { title: 'Randevu ve çizelge', text: 'Günlük/haftalık/aylık ajanda, personel bazlı çalışma saatleri, çakışma kontrolü, bekleme listesi.', icon: CalendarDays, tone: 'pink' },
  { title: 'Müşteri yönetimi', text: 'Müşteri kartı, işlem geçmişi, tedavi günlüğü (önce/sonra), konsültasyon ve onam formları, KVKK aydınlatma akışı.', icon: UserRound, tone: 'violet' },
  { title: 'Paket, hizmet ve seans', text: 'Paket kurgusu, kalan seans takibi, hediye/sadakat puanı, kampanya tanımları.', icon: Package, tone: 'amber' },
  { title: 'Ön muhasebe', text: 'Cari hesap, taksitlendirme, tahsilat, gider, günlük kasa ve kasa kapanışı.', icon: WalletCards, tone: 'green' },
  { title: 'Personel', text: 'Rol ve yetki yönetimi, prim/komisyon, performans ve onay akışı.', icon: UsersRound, tone: 'blue' },
  { title: 'İletişim', text: 'WhatsApp, SMS ve e-posta ile randevu hatırlatma, değerlendirme ve bilgilendirme mesajları.', icon: MessageCircle, tone: 'mint' },
  { title: 'Raporlama', text: 'Satış, tahsilat, paket, personel ve şube kırılımlarında dönem karşılaştırmalı raporlar.', icon: BarChart3, tone: 'rose' },
]

/** "Ne yapıyoruz?" bölümündeki zincir: bir randevunun tamamlanması üç kaydı birden günceller. */
const chain = [
  { label: 'Randevu tamamlandı', tone: 'pink' },
  { label: 'Seans düşer', tone: 'amber' },
  { label: 'Satış cariye işlenir', tone: 'violet' },
  { label: 'Tahsilat kasaya yazılır', tone: 'green' },
]

const security = [
  { title: 'AES-256-GCM', text: 'Müşteri adı, telefonu, kimlik numarası ve notları gibi hassas alanlar veritabanında şifrelenerek saklanır.', icon: FileLock2 },
  { title: 'HTTPS', text: 'Tüm iletişim şifreli bağlantı üzerinden yapılır.', icon: LockKeyhole },
  { title: 'Rol tabanlı yetki', text: 'Erişim rol tabanlı yetkilerle sınırlandırılır, kritik işlemler denetim günlüğüne yazılır.', icon: KeyRound },
]

const steps = [
  { title: 'Hesabınızı açın', text: `${company.brand} bir abonelik (SaaS) hizmetidir; kutulu ürün veya fiziksel teslimat yoktur.` },
  { title: '14 gün ücretsiz deneyin', text: 'Hesabınızı açtıktan sonra 14 gün ücretsiz deneyebilirsiniz.' },
  { title: 'Aboneliği başlatın', text: `Memnun kalırsanız panel içindeki “Paket” ekranından kredi/banka kartıyla başlatın. Ödeme ${company.paymentProvider} tarafından barındırılan güvenli sayfada tamamlanır; kart bilgileri sunucularımıza gelmez.` },
]

export default function HakkimizdaPage() {
  const phoneHref = `tel:${company.phone.replace(/\s/g, '')}`

  return (
    <div id="hakkimizda" className={styles.page}>
      <RevealOnScroll rootId="hakkimizda" />
      <PublicNavbar />
      <main>
        {/* --- Giriş --------------------------------------------------------------------------------------------- */}
        <section className={styles.hero} aria-labelledby="about-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Kurumsal</p>
            <h1 id="about-title">Güzellik merkezleri için <span>akıllı yönetim yazılımı.</span></h1>
            <p className={styles.intro}>
              <strong>{company.brand}</strong>; güzellik merkezleri, medikal estetik klinikleri ve salonlar için geliştirilmiş bir
              işletme yönetim yazılımıdır. Randevudan seansa, paket satışından taksit takibine ve ön muhasebeye kadar bir merkezin
              günlük işleyişini tek panelde toplar. Web, tablet, mobil ve masaüstü uygulamalarıyla aynı veriye her yerden erişilir.
            </p>
            <div className={styles.actions}>
              <Link href="/kayit" className={styles.primary}>14 gün ücretsiz deneyin <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/moduller" className={styles.secondary}>Modülleri inceleyin</Link>
            </div>
          </div>
          <div className={styles.heroArt} aria-hidden="true">
            <span className={styles.ring} />
            <span className={styles.chip} data-tone="pink" data-spot="a"><CalendarDays size={22} /></span>
            <span className={styles.chip} data-tone="green" data-spot="b"><WalletCards size={22} /></span>
            <span className={styles.chip} data-tone="blue" data-spot="c"><BarChart3 size={22} /></span>
            <Image src="/mascots/maydi/happy.webp" alt="" width={256} height={320} unoptimized loading="eager" />
          </div>
        </section>

        {/* --- Ne yapıyoruz -------------------------------------------------------------------------------------- */}
        <section className={`${styles.wide} ${styles.story}`} aria-labelledby="story-title">
          <div data-reveal>
            <p className={styles.eyebrow}>Ne yapıyoruz?</p>
            <h2 id="story-title">Ajanda, kasa ve danışan defteri <span>tek yazılımda.</span></h2>
          </div>
          <div className={styles.storyBody} data-reveal>
            <p>
              Güzellik sektöründe işletmeler; randevu defterini bir yerde, paket ve seans takibini başka yerde, tahsilat ve borç
              takibini ise çoğu zaman elde tutuyor. Bu dağınıklık unutulan seansa, tahsil edilmemiş taksite ve kaybolan müşteriye
              dönüşüyor. {company.brand}, bu üç defteri tek yerde birleştirir ve aralarındaki bağı otomatik kurar.
            </p>
            <ol className={styles.chain} aria-label="Bir randevu tamamlandığında">
              {chain.map(({ label, tone }) => (
                <li key={label} data-tone={tone}>{label}</li>
              ))}
            </ol>
          </div>
        </section>

        {/* --- Neler sunuyoruz ----------------------------------------------------------------------------------- */}
        <section className={`${styles.wide} ${styles.offers}`} aria-labelledby="offers-title">
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.eyebrow}>Neler sunuyoruz?</p>
            <h2 id="offers-title">Randevudan rapora <span>her iş tek yerde.</span></h2>
          </div>
          <ul className={styles.offerGrid}>
            {offers.map(({ title, text, icon: Icon, tone }) => (
              <li key={title} className={styles.offer} data-tone={tone} data-reveal>
                <span className={styles.offerIcon} aria-hidden="true"><Icon size={22} strokeWidth={1.7} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* --- Veri yaklaşımı ------------------------------------------------------------------------------------ */}
        <section className={`${styles.wide} ${styles.security}`} aria-labelledby="security-title">
          <div className={styles.securityHead} data-reveal>
            <span className={styles.shield} aria-hidden="true"><ShieldCheck size={30} /></span>
            <div>
              <p className={styles.eyebrow}>Verilerinize yaklaşımımız</p>
              <h2 id="security-title">Hassas veri, <span>şifreli kalır.</span></h2>
            </div>
          </div>
          <ul className={styles.securityGrid}>
            {security.map(({ title, text, icon: Icon }) => (
              <li key={title} data-reveal>
                <Icon size={22} aria-hidden="true" />
                <strong>{title}</strong>
                <p>{text}</p>
              </li>
            ))}
          </ul>
          <p className={styles.securityNote}>Ayrıntılar için <Link href="/gizlilik">Gizlilik Politikası</Link> sayfamıza bakabilirsiniz.</p>
        </section>

        {/* --- Satın alma ---------------------------------------------------------------------------------------- */}
        <section className={`${styles.wide} ${styles.buy}`} aria-labelledby="buy-title">
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.eyebrow}>Nasıl satın alınır?</p>
            <h2 id="buy-title">Üç adımda <span>başlayın.</span></h2>
          </div>
          <ol className={styles.steps}>
            {steps.map(({ title, text }) => (
              <li key={title} data-reveal>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <div className={styles.buyFoot} data-reveal>
            <p>
              <CreditCard size={16} aria-hidden="true" /> Satın alma koşullarının tamamı{' '}
              <Link href="/mesafeli-satis-sozlesmesi">Mesafeli Satış Sözleşmesi</Link> ve{' '}
              <Link href="/teslimat-ve-iade">Teslimat ve İade Şartları</Link> sayfalarındadır.
            </p>
            <PaymentBadges />
          </div>
        </section>

        {/* --- Künye --------------------------------------------------------------------------------------------- */}
        <section id="iletisim" className={`${styles.wide} ${styles.facts}`} aria-labelledby="facts-title">
          <div data-reveal>
            <p className={styles.eyebrow}>İletişim ve künye</p>
            <h2 id="facts-title">Bize <span>ulaşın.</span></h2>
          </div>
          <dl className={styles.factList} data-reveal>
            <div><dt>Ticaret unvanı</dt><dd>{company.legalName}</dd></div>
            <div><dt>Marka</dt><dd>{company.brand}</dd></div>
            <div><dt>Adres</dt><dd>{company.address}</dd></div>
            <div><dt>E-posta</dt><dd><MailLink /></dd></div>
            <div><dt>Telefon</dt><dd><a href={phoneHref}>{company.phone}</a></dd></div>
            <div><dt>Web sitesi</dt><dd>{company.website}</dd></div>
            <div><dt>Destek saatleri</dt><dd>{company.supportHours}</dd></div>
          </dl>
        </section>
      </main>
    </div>
  )
}
