import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { AppWindow, ArrowDownToLine, ArrowUpRight, Globe, Laptop, MonitorSmartphone, RefreshCw, Smartphone, TabletSmartphone, type LucideIcon } from 'lucide-react'
import PublicNavbar from '@/components/public/PublicNavbar'
import { stores } from '@/components/landing/StoreLinks'
import { windowsInstallerHref } from '@/components/landing/windowsInstaller'
import RevealOnScroll from '../moduller/RevealOnScroll'
import styles from './Apps.module.css'

export const metadata: Metadata = {
  title: 'Uygulamalar — BeautyAsist',
  description: 'BeautyAsist iPhone ve iPad, Android, Mac ve Windows uygulamaları. Aynı hesapla web, tablet, mobil ve masaüstünden aynı veriye erişin.',
}

type Platform = {
  name: string
  device: string
  text: string
  icon: LucideIcon
  tone: string
  href: string
  badge?: { src: string; width: number; height: number; label: string }
  download?: boolean
}

const store = (platform: string) => stores.find((item) => item.platform === platform)

const appStore = store('iPhone ve iPad')
const googlePlay = store('Android')
const macStore = store('Mac')

const platforms: Platform[] = [
  {
    name: 'iPhone ve iPad', device: 'iOS · iPadOS', icon: TabletSmartphone, tone: 'pink',
    text: 'Randevularınız, müşterileriniz ve kasanız cebinizde. iPad’de resepsiyon ekranı olarak da kullanın.',
    href: appStore?.href ?? '#', badge: appStore && { src: appStore.image, width: appStore.width, height: appStore.height, label: appStore.label },
  },
  {
    name: 'Android', device: 'Telefon · Tablet', icon: Smartphone, tone: 'green',
    text: 'Android telefon ve tabletlerde aynı panel; ekibiniz kendi cihazından çalışsın.',
    href: googlePlay?.href ?? '#', badge: googlePlay && { src: googlePlay.image, width: googlePlay.width, height: googlePlay.height, label: googlePlay.label },
  },
  {
    name: 'Mac', device: 'BeautyAsist Desktop', icon: Laptop, tone: 'violet',
    text: 'Resepsiyon bilgisayarında ayrı bir pencere olarak açılır; tarayıcı sekmeleri arasında kaybolmaz.',
    href: macStore?.href ?? '#', badge: macStore && { src: macStore.image, width: macStore.width, height: macStore.height, label: macStore.label },
  },
  {
    name: 'Windows', device: '64 bit · .exe kurulum', icon: AppWindow, tone: 'blue',
    text: 'Windows bilgisayarlar için masaüstü uygulaması. Kurulum dosyasını indirip çalıştırın.',
    href: windowsInstallerHref, download: true,
  },
]

export default function AppsPage() {
  return (
    <div id="uygulamalar-sayfa" className={styles.page}>
      <RevealOnScroll rootId="uygulamalar-sayfa" />
      <PublicNavbar />
      <main>
        {/* --- Giriş --------------------------------------------------------------------------------------------- */}
        <section className={styles.hero} aria-labelledby="apps-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><MonitorSmartphone size={15} aria-hidden="true" /> Mobil ve masaüstü</p>
            <h1 id="apps-title">Salonunuz <span>her cihazda yanınızda.</span></h1>
            <p className={styles.intro}>Cebinizde, resepsiyon masanızda ve tabletinizde aynı panel. Bir kez giriş yapın; randevular, müşteriler ve kasa her cihazda aynı anda güncel.</p>
            <ul className={styles.platformChips} aria-label="Desteklenen platformlar">
              {platforms.map(({ name, icon: Icon, tone }) => (
                <li key={name} data-tone={tone}><Icon size={15} aria-hidden="true" /> {name}</li>
              ))}
              <li data-tone="amber"><Globe size={15} aria-hidden="true" /> Web</li>
            </ul>
          </div>
          <div className={styles.heroArt} aria-hidden="true">
            <span className={styles.glow} />
            <div className={styles.tablet}>
              <Image src="/landing/tablet.webp" alt="" fill sizes="(max-width: 760px) 80vw, 40vw" priority />
            </div>
            <div className={styles.phone}>
              <Image src="/landing/danisan-telefon.webp" alt="" fill sizes="(max-width: 760px) 40vw, 18vw" />
            </div>
            <span className={styles.sync}><RefreshCw size={18} /> Anlık eşitleme</span>
          </div>
        </section>

        {/* --- Platformlar --------------------------------------------------------------------------------------- */}
        <section className={`${styles.wide} ${styles.platforms}`} aria-labelledby="platforms-title">
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.eyebrow}>İndirin</p>
            <h2 id="platforms-title">Bir hesap, <span>bütün cihazlar.</span></h2>
          </div>
          <ul className={styles.cards}>
            {platforms.map(({ name, device, text, icon: Icon, tone, href, badge, download }) => (
              <li key={name} className={styles.card} data-tone={tone} data-reveal>
                <div className={styles.cardTop}>
                  <span className={styles.cardIcon} aria-hidden="true"><Icon size={26} strokeWidth={1.7} /></span>
                  <span className={styles.device}>{device}</span>
                </div>
                <h3>{name}</h3>
                <p>{text}</p>
                {download ? (
                  <a className={styles.download} href={href} download aria-label="BeautyAsist Desktop Windows x64 kurulum dosyasını indirin">
                    <ArrowDownToLine size={18} aria-hidden="true" /> Windows için indir
                  </a>
                ) : badge ? (
                  <a className={styles.badge} href={href} target="_blank" rel="noopener noreferrer" aria-label={badge.label}>
                    <Image src={badge.src} width={badge.width} height={badge.height} alt="" unoptimized />
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* --- Web ve eşitleme ----------------------------------------------------------------------------------- */}
        <section className={`${styles.wide} ${styles.sync2}`} aria-labelledby="web-title">
          <div className={styles.webCard} data-reveal>
            <span className={styles.webIcon} aria-hidden="true"><Globe size={28} /></span>
            <div>
              <p className={styles.eyebrow}>Kurulum gerekmez</p>
              <h2 id="web-title">Kurulum yok, <span>tarayıcıdan başlayın.</span></h2>
              <p>Hiçbir şey indirmeden her bilgisayardan giriş yapabilirsiniz. Uygulamalar aynı hesabı ve aynı veriyi kullanır.</p>
            </div>
            <div className={styles.webActions}>
              <Link href="/login" className={styles.primary}>Giriş yap <ArrowUpRight size={16} aria-hidden="true" /></Link>
              <Link href="/kayit" className={styles.secondary}>14 gün ücretsiz deneyin</Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
