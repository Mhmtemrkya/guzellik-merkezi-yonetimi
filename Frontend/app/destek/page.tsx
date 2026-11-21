import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight, Clock, Mail, MapPin, Phone, Plus, Search, Ticket, type LucideIcon } from 'lucide-react'
import PaymentBadges, { LegalLinkRow } from '@/components/legal/PaymentBadges'
import PublicNavbar from '@/components/public/PublicNavbar'
import SupportForm from '@/components/support/SupportForm'
import { company } from '@/lib/legal/company'
import styles from './SupportPage.module.css'

export const metadata: Metadata = {
  title: 'Destek — BeautyAsist',
  description: 'BeautyAsist destek merkezi. Talep oluşturun, takip kodunuzla durumunu izleyin ve sık sorulan soruların yanıtlarını bulun.',
}

interface Faq {
  q: string
  a: string
}

const FAQS: Faq[] = [
  {
    q: 'Şifremi unuttum, ne yapmalıyım?',
    a: 'Giriş ekranındaki “Şifremi unuttum” bağlantısından hesap e-postanıza doğrulama kodu isteyin; kodu girip yeni şifrenizi belirleyin. Güvenlik için diğer tüm oturumlarınız kapatılır. Personelseniz kurum yöneticiniz de Personel sayfasından şifrenizi sıfırlayabilir.',
  },
  {
    q: 'Deneme süresi bitince verilerim silinir mi?',
    a: 'Hayır. Deneme bitince hesabınız askıya alınır ve panele giriş kapanır, ancak verileriniz durur. Bir paket seçtiğinizde kaldığınız yerden devam edersiniz.',
  },
  {
    q: 'Eski müşteri listemi sisteme aktarabilir miyim?',
    a: 'Evet. Panelde üst çubuktaki “İçeri Aktar” ile Excel dosyanızı yükleyebilirsiniz; kolon adları farklı olsa bile sistem eşleştirmeyi size sorar. Büyük listeler için kurulum ekibimiz aktarımı sizin yerinize yapar.',
  },
  {
    q: 'Personelim hangi sayfaları görebilir?',
    a: 'Yetki iki seviyelidir: sayfa izni (ör. Müşteriler) ve işlem izni (ör. Müşteri silme). Her personel için tek tek seçersiniz. Ayrıca personelin yazma işlemleri isterseniz onay kutunuza düşer; siz onaylamadan hiçbir kayıt değişmez.',
  },
  {
    q: 'WhatsApp hatırlatmaları nasıl çalışıyor?',
    a: 'Randevudan önce müşterinize otomatik hatırlatma gider ve müşteri “Evet/Hayır” yazarak randevusunu onaylayabilir ya da iptal edebilir. İptal olan slot bekleme listesindeki sıradaki kişiye teklif edilir. WhatsApp ve SMS gönderimleri önce paketinizdeki aylık kotadan, kota bitince ortak mesaj kredisinden düşer (1 kredi = 1 WhatsApp hatırlatma); kredi bakiyenizi panelden görürsünüz.',
  },
  {
    q: 'Birden fazla şubem var, hepsini tek hesapta yönetebilir miyim?',
    a: 'Evet. Şubeleri Ayarlar sayfasından tanımlarsınız; üst çubuktaki şube seçicisiyle geçiş yaparsınız. Raporlarda şubeleri karşılaştırabilir, personeli şubeler arasında aktarabilirsiniz. Çok şube desteği pakete bağlıdır.',
  },
  {
    q: 'Hesabımı nasıl kapatırım?',
    a: 'Panelde Ayarlar sayfasının en altındaki “Hesabımı sil” bölümünden talep oluşturursunuz. Silme hemen gerçekleşmez: 30 gün bekleme süresi vardır ve bu süre içinde talebinizi geri alabilirsiniz. Süre boyunca panel normal çalışır, verilerinizi dışa aktarabilirsiniz.',
  },
  {
    q: 'Verilerim nerede saklanıyor, güvende mi?',
    a: 'Müşteri adı, telefonu, T.C. kimlik numarası ve notlar gibi hassas alanlar veritabanında AES-256-GCM ile şifrelenir. Tüm iletişim HTTPS üzerinden yapılır. Panele giriş iki adımlıdır: şifre + e-postanıza gelen doğrulama kodu. Ayrıntılar için Gizlilik Politikası sayfamıza bakabilirsiniz.',
  },
]

const phoneLink = `tel:${company.phone.replace(/\s/g, '')}`

const channels: {
  icon: LucideIcon
  title: string
  text: string
  action: string
  href: string
}[] = [
  { icon: Ticket, title: 'Destek talebi', text: 'Sorununuzu yazın. Yanıtı e-postanızdan ve takip ekranından görün.', action: 'Talep oluştur', href: '#talep' },
  { icon: Search, title: 'Talep takibi', text: 'Takip kodunuz ve bağlantınızla durumunu görün veya yanıt yazın.', action: 'Takip ekranını aç', href: '/destek/takip' },
  { icon: Phone, title: 'Telefon desteği', text: 'Giriş, ödeme ve gün sonu gibi çalışmanızı durduran sorunlarda bize ulaşın.', action: company.phone, href: phoneLink },
]

const requestTips = [
  'Kurum kodunuzu ve sorun yaşadığınız sayfayı belirtin.',
  'İşlemi hangi adımlarla yaptığınızı ve ne olmasını beklediğinizi yazın.',
  'Ekranda bir hata mesajı varsa tam metnini ekleyin.',
]

export default function SupportPage() {
  return (
    <div className={styles.page}>
      <PublicNavbar variant="list" />
      <main>
        <section className={styles.hero} aria-labelledby="support-title">
          <div className={styles.heroBody}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span /> BeautyAsist destek merkezi</p>
              <h1 id="support-title">Nasıl yardımcı <span>olabiliriz?</span></h1>
              <p className={styles.heroDescription}>Yanıtı sık sorulanlarda bulun, ekibimize yeni bir talep gönderin veya mevcut talebinizi takip edin.</p>
              <div className={styles.heroActions}>
                <a href="#sss" className={styles.primary}>Sık sorulanlara bakın <ArrowDown size={16} aria-hidden="true" /></a>
                <Link href="/destek/takip" className={styles.heroSecondary}>Talebimi takip et <ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            </div>
            <div className={styles.heroMaydi}>
              <Image src="/mascots/maydi/happy.webp" alt="BeautyAsist maskotu Maydi" width={256} height={320} loading="eager" unoptimized />
            </div>
          </div>
        </section>

        <section className={`${styles.wide} ${styles.channels}`} aria-label="Destek kanalları">
          {channels.map(({ icon: Icon, title, text, action, href }) => (
            <article key={title} className={styles.channel}>
              <span className={styles.iconTile}><Icon size={21} strokeWidth={1.7} aria-hidden="true" /></span>
              <h2>{title}</h2>
              <p>{text}</p>
              {href.startsWith('/') ? (
                <Link href={href}>{action} <ArrowRight size={15} aria-hidden="true" /></Link>
              ) : (
                <a href={href}>{action} <ArrowRight size={15} aria-hidden="true" /></a>
              )}
            </article>
          ))}
        </section>

        <section id="sss" className={`${styles.wide} ${styles.faq}`} aria-labelledby="faq-title">
          <div className={styles.sectionTitle}>
            <h2 id="faq-title">Sık sorulanlar.</h2>
          </div>
          <div className={styles.questions}>
            {FAQS.map(({ q, a }) => (
              <details key={q}>
                <summary>{q}<Plus size={17} aria-hidden="true" /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="talep" className={`${styles.wide} ${styles.request}`} aria-labelledby="support-request-title">
          <div className={styles.sectionTitle}>
            <h2 id="support-request-title">Destek talebi oluşturun.</h2>
            <p>Gönderimden sonra talebinize özel takip kodunu ve bağlantıyı alırsınız.</p>
          </div>
          <div className={styles.requestGrid}>
            <div className={styles.form}><SupportForm /></div>
            <aside className={styles.context} aria-label="Destek bilgileri">
              <div className={styles.maydiAdvice}>
                <div className={styles.maydiHeading}>
                  <span className={styles.maydiPortrait} aria-hidden="true">
                    <Image src="/mascots/maydi/thinking.webp" alt="" width={256} height={320} unoptimized />
                  </span>
                  <div>
                    <p>Maydi’den ipucu</p>
                    <h3>Talebi yazarken</h3>
                  </div>
                </div>
                <ul className={styles.tips}>
                  {requestTips.map(tip => <li key={tip}>{tip}</li>)}
                </ul>
              </div>
              <div className={styles.contact}>
                <h3>Bize ulaşın</h3>
                <a href={phoneLink}><Phone size={16} aria-hidden="true" /> {company.phone}</a>
                <a href={`mailto:${company.email}`}><Mail size={16} aria-hidden="true" /> {company.email}</a>
                <p><Clock size={16} aria-hidden="true" /> {company.supportHours}</p>
                <p><MapPin size={16} aria-hidden="true" /> {company.address}</p>
              </div>
            </aside>
          </div>
        </section>

        <section className={`${styles.wide} ${styles.trial}`} aria-labelledby="support-trial-title">
          <div>
            <h2 id="support-trial-title">BeautyAsist’i deneyin.</h2>
            <p>Kurulum, veri aktarımı ve eğitim dahil. Ücretsiz deneme kredi kartı gerektirmez.</p>
          </div>
          <div>
            <Link href="/kayit" className={styles.primary}>14 gün ücretsiz deneyin <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link href="/moduller" className={styles.secondary}>Modülleri inceleyin</Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.wide}>
          <div className={styles.footerTop}>
            <Link aria-label="BeautyAsist ana sayfa" href="/" className={styles.brand}>
              <Image src="/logo.png" alt="" width={40} height={40} />
              <span>BeautyAsist</span>
            </Link>
            <LegalLinkRow />
          </div>
          <PaymentBadges variant="white" className={styles.payments} />
        </div>
      </footer>
    </div>
  )
}
