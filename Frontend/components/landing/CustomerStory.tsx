import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowDown, ArrowUpRight, CalendarDays, Check, Clock3, Download, MapPin, Monitor, Smartphone,
} from 'lucide-react'
import styles from './CustomerStory.module.css'

const bookingSteps = [
  {
    title: 'Bir salon bulun.',
    text: 'BeautyAsist’te salonları keşfedin. Karar vermeden önce salonun hizmetlerine ve konumuna bakın.',
    icon: MapPin,
  },
  {
    title: 'Size uyan saati seçin.',
    text: 'Hizmeti ve uygun saati seçip randevunuzu oluşturun. Salonla aynı takvim üzerinden ilerleyin.',
    icon: CalendarDays,
  },
  {
    title: 'Randevunuzu takip edin.',
    text: 'Randevularım ekranından tarihinizi ve durumunuzu kontrol edin. Planınız değişirse randevunuzu buradan yönetin.',
    icon: Check,
  },
]

function BookingScene() {
  return (
    <div className={styles.bookingScene} aria-hidden="true">
      <Image
        src="/landing/danisan-telefon.webp"
        alt=""
        className={styles.bookingImage}
        fill
        sizes="(max-width: 800px) 100vw, 55vw"
      />
      <div className={styles.bookingShade} />
      <div className={styles.phoneGuide} />
      <div className={styles.bookingPhone}>
        <div className={styles.phoneCamera} />
        <div className={styles.phoneTop}>
          <Image src="/logo.png" width={28} height={28} alt="" />
          <span>BeautyAsist</span>
        </div>
        <div className={styles.phoneBodies}>
          <div className={styles.discoverScreen}>
            <small>Salonlar</small>
            <p>Bir sonraki bakımınızı planlayın.</p>
            <div className={styles.salonSample}>
              <MapPin size={17} />
              <div><strong>Örnek güzellik salonu</strong><span>Cilt bakımı · El ve tırnak</span></div>
            </div>
          </div>
          <div className={styles.slotScreen}>
            <small>Randevu alın</small>
            <p>Size uygun saat</p>
            <div className={styles.slotDate}><CalendarDays size={16} /> 24 Kasım, Salı</div>
            <div className={styles.slotTimes}><span>11.30</span><span>14.30</span><span>16.00</span></div>
          </div>
          <div className={styles.confirmScreen}>
            <small>Randevularım</small>
            <p>Randevu detayları</p>
            <div className={styles.confirmSample}>
              <Check size={18} />
              <div><strong>Cilt bakımı</strong><span>24 Kasım · 14.30</span></div>
            </div>
          </div>
        </div>
        <span className={styles.phoneCaption}>Örnek ekran</span>
      </div>
      <div className={styles.bookingProgress}><i /></div>
    </div>
  )
}

function BookingChapter() {
  return (
    <section id="danisan-deneyimi" className={styles.bookingChapter} aria-labelledby="danisan-deneyimi-baslik">
      <header className={styles.bookingHeading}>
        <p className={styles.eyebrow}>Danışan deneyimi</p>
        <h2 id="danisan-deneyimi-baslik">İlk randevu <span>cep telefonunda başlar.</span></h2>
        <Link href="/salonlar" className={styles.lightLink}>Salonları keşfedin <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </header>
      <div className={styles.bookingTrack} data-customer-scroll="booking">
        <div className={styles.bookingPin}><BookingScene /></div>
        <ol className={styles.bookingSteps}>
          {bookingSteps.map(({ title, text, icon: Icon }) => (
            <li key={title}>
              <Icon size={27} strokeWidth={1.5} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function DevicesScene() {
  return (
    <div className={styles.deviceScene} aria-hidden="true">
      <div className={styles.deviceOrbit} />
      <div className={styles.desktop}>
        <div className={styles.desktopScreen}>
          <div className={styles.desktopBar}>
            <Image src="/logo.png" width={26} height={26} alt="" />
            <strong>BeautyAsist Desktop</strong>
          </div>
          <div className={styles.desktopContent}>
            <div className={styles.desktopRail}>
              <span><CalendarDays size={12} /> Randevular</span>
              <span>Danışanlar</span>
              <span>Kasa</span>
            </div>
            <div className={styles.desktopAgenda}>
              <p>Bugünün ajandası</p>
              <div className={styles.desktopAppointments}>
                <div><time>10.00</time><span>Cilt bakımı</span></div>
                <div><time>11.30</time><span>Manikür</span></div>
                <div><time>14.30</time><span>Cilt bakımı</span></div>
              </div>
              <small>Örnek ekran</small>
            </div>
          </div>
        </div>
        <div className={styles.desktopStand} />
      </div>
      <div className={styles.devicePhone}>
        <div className={styles.phoneCamera} />
        <Image src="/logo.png" width={37} height={37} alt="" />
        <p>Randevular</p>
        <div className={styles.devicePhoneAppointment}>
          <Clock3 size={14} /><span>14.30</span><strong>Cilt bakımı</strong>
        </div>
        <small>Örnek ekran</small>
      </div>
    </div>
  )
}

function AppsChapter() {
  return (
    <section id="her-ekranda" className={styles.appsChapter} aria-labelledby="her-ekranda-baslik">
      <header className={styles.appsHeading}>
        <p className={styles.eyebrow}>Mobil ve masaüstü</p>
        <h2 id="her-ekranda-baslik">Salonunuzun ajandası <span>her ekranda.</span></h2>
        <p>Resepsiyonda bilgisayardan, salon içinde telefondan ya da tabletten randevularınıza ulaşın.</p>
      </header>
      <div className={styles.appsTrack} data-customer-scroll="devices">
        <div className={styles.appsPin}>
          <Image src="/landing/tablet.webp" alt="" className={styles.appsImage} fill sizes="100vw" />
          <div className={styles.appsShade} />
          <DevicesScene />
          <div className={styles.appsPlatforms}>
            <div><Smartphone size={21} aria-hidden="true" /><p>iPhone, iPad ve Android</p></div>
            <Link href="#uygulamalar"><Download size={17} aria-hidden="true" /> Uygulamaları indirin <ArrowDown size={15} aria-hidden="true" /></Link>
            <div><Monitor size={22} aria-hidden="true" /><p>Mac ve Windows</p></div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function CustomerStory() {
  return (
    <>
      <BookingChapter />
      <AppsChapter />
    </>
  )
}
