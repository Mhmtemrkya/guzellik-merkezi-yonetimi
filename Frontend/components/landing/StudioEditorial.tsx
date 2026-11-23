import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowUpRight, Bell, Boxes, ChartNoAxesCombined, ChevronDown, CircleCheck,
  ClipboardCheck, Layers3, ShieldCheck, Store, UsersRound,
} from 'lucide-react'
import { featureQuestions } from '@/lib/landing/featureHighlights'
import styles from './StudioEditorial.module.css'

const capabilities = [
  {
    title: 'Paket ve seans takibi',
    body: 'Seans geçmişini danışan kartından açın. Kalan hakları ve imzalı onamları randevu öncesinde kontrol edin.',
    image: '/landing/film/kurulum.webp',
    position: '55% center',
    theme: 'rose',
    icon: ClipboardCheck,
    heading: 'Cilt bakımı paketi',
    detail: 'Kalan haklar',
    rows: [{ label: 'Tamamlanan seans', value: '2 / 6' }, { label: 'Dijital onam', value: 'İmzalandı' }],
  },
  {
    title: 'Ekip ve şube yönetimi',
    body: 'Randevuları çalışanların çizelgesiyle birlikte planlayın. Her ekip üyesine görevine uygun erişim verin.',
    image: '/landing/ekip.webp',
    position: 'center center',
    theme: 'sand',
    icon: UsersRound,
    heading: 'Bugünün çizelgesi',
    detail: 'Merkez şube',
    rows: [{ label: 'Elif · Uzman', value: '09.00–17.00' }, { label: 'Deniz · Resepsiyon', value: '11.00–19.00' }],
  },
  {
    title: 'Stok ve finans raporları',
    body: 'Ürün hareketlerini ve tahsilatları aynı gün takip edin. Şube, hizmet ve personel bazında raporları inceleyin.',
    image: '/landing/tedavi-odasi.webp',
    position: '58% center',
    theme: 'night',
    icon: ChartNoAxesCombined,
    heading: 'Haftalık görünüm',
    detail: 'Merkez şube',
    rows: [{ label: 'Tahsilat toplamı', value: '₺24.650' }, { label: 'Kritik stok uyarısı', value: '2 ürün' }],
  },
] as const

const steps = [
  { title: 'Merkezinizi tanıtın', body: 'Başvurunuzu iletin. Hesabınız onaylandıktan sonra şubenizi ve çalışma saatlerinizi tanımlayın.', icon: Store },
  { title: 'Panelinizi hazırlayın', body: 'Hizmetleri ve ekip erişimlerini ekleyin. İhtiyaç duyarsanız kurulum, veri aktarımı ve eğitim için destek alın.', icon: Layers3 },
  { title: 'İlk randevunuzu planlayın', body: 'Takviminizi oluşturun ve danışanlarınıza online randevu bağlantınızı gönderin.', icon: CircleCheck },
]

const questions = [
  ...featureQuestions,
  { question: 'Ücretsiz deneme nasıl başlıyor?', answer: 'Başvurunuz onaylandıktan ve hesabınız açıldıktan sonra BeautyAsist’i 14 gün ücretsiz deneyebilirsiniz. Kredi kartı gerekmez.' },
  { question: 'Birden fazla şubem varsa ne yapabilirim?', answer: 'Şubelerinizi aynı hesapta yönetebilirsiniz. Şube başına ücret ve varsa kullanım kademeleri fiyatlandırma bölümündeki planda gösterilir.' },
  { question: 'BeautyAsist’i hangi cihazlarda kullanabilirim?', answer: 'Web panelini tarayıcınızda açabilir, mobil uygulamayı iOS ve Android’de, BeautyAsist Desktop’ı Mac ve Windows’ta kullanabilirsiniz.' },
  { question: 'Kurulum ve veri aktarımı için destek var mı?', answer: 'Destek ekibi kurulum, mevcut verilerin aktarılması ve eğitim için size yardımcı olur. İhtiyacınızı Destek sayfasından iletebilirsiniz.' },
]

export function FieldNotes() {
  return (
    <section className={styles.notes} aria-labelledby="field-notes-title">
      <p className={styles.kicker}>Güzellik işi, her ayrıntısıyla</p>
      <h2 id="field-notes-title">Bir günün ritmini <span>yakından görün.</span></h2>
      <p>İlk randevudan son tahsilata kadar, salonun önünde ve arkasında olup biten her şeyi aynı yerden takip edin.</p>
      <a href="#bir-gun-sahne">Salonun bir gününe inin <ChevronDown size={17} aria-hidden="true" /></a>
    </section>
  )
}

export function StudioCapabilities() {
  return (
    <section id="isletme" className={styles.capabilities} aria-labelledby="capabilities-title">
      <header className={styles.intro}>
        <p className={styles.kicker}>Günlük iş akışı</p>
        <h2 id="capabilities-title">Salonun arkasındaki <span>işler de yolunda.</span></h2>
        <p>Danışan kayıtları, ekip planı ve gelir-gider takibi aynı işletme panelinde.</p>
      </header>

      <div className={styles.capabilityList}>
        {capabilities.map(({ title, body, image, position, theme, icon: Icon, heading, detail, rows }) => (
          <article key={title} className={styles.capability} data-theme={theme}>
            <div className={styles.capabilityVisual}>
              <Image src={image} alt="" fill sizes="(max-width: 780px) 100vw, 60vw" style={{ objectPosition: position }} />
              <div className={styles.sample}>
                <div className={styles.sampleHeader}><Icon size={21} strokeWidth={1.7} aria-hidden="true" /><span>Örnek panel</span></div>
                <p className={styles.sampleTitle}>{heading}</p>
                <p className={styles.sampleDetail}>{detail}</p>
                <dl>
                  {rows.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </div>
            </div>
            <div className={styles.capabilityCopy}>
              <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </div>
      <Link className={styles.link} href="/moduller">Tüm modülleri görün <ArrowUpRight size={17} aria-hidden="true" /></Link>
    </section>
  )
}

export function GettingStarted() {
  return (
    <section id="kurulum" className={styles.setup} aria-labelledby="setup-title">
      <header className={styles.setupIntro}>
        <div className={styles.setupCopy}>
          <p className={styles.kicker}>İlk kurulum</p>
          <h2 id="setup-title">İlk randevunuza <span>üç adım.</span></h2>
          <p>Kurulum, veri aktarımı ve eğitim desteğiyle çalışma düzeninizi BeautyAsist’e taşıyın.</p>
          <Link className={styles.link} href="/kayit">14 günlük denemeye başvurun <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
        <div className={styles.setupArt} aria-hidden="true">
          <div className={styles.setupLogo}><Image src="/logo.png" width={240} height={240} alt="" /></div>
          <div className={styles.setupIcon}><ShieldCheck size={31} strokeWidth={1.55} /></div>
          <div className={styles.setupIcon}><Bell size={30} strokeWidth={1.55} /></div>
          <div className={styles.setupIcon}><Boxes size={29} strokeWidth={1.55} /></div>
        </div>
      </header>
      <ol className={styles.steps}>
        {steps.map(({ title, body, icon: Icon }) => (
          <li key={title}><Icon size={25} strokeWidth={1.65} aria-hidden="true" /><h3>{title}</h3><p>{body}</p></li>
        ))}
      </ol>
    </section>
  )
}

export function LandingQuestions() {
  return (
    <section id="sorular" className={styles.faq} aria-labelledby="faq-title">
      <header className={styles.intro}>
        <p className={styles.kicker}>Sık sorulan sorular</p>
        <h2 id="faq-title">Başlamadan <span>önce.</span></h2>
        <Link className={styles.link} href="/destek">Destek ekibine ulaşın <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </header>
      <div className={styles.questions}>
        {questions.map(({ question, answer }) => (
          <details key={question}>
            <summary>{question}<ChevronDown size={19} aria-hidden="true" /></summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
