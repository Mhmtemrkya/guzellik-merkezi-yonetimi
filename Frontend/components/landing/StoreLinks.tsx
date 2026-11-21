import Image from 'next/image'
import { ArrowDownToLine, ArrowUpRight } from 'lucide-react'
import { windowsInstallerHref } from './windowsInstaller'
import styles from './AppLaunch.module.css'

const stores = [
  {
    platform: 'iPhone ve iPad',
    label: 'BeautyAsist’i App Store’dan indirin',
    href: 'https://apps.apple.com/tr/app/beautyasist/id6788379960?l=tr',
    image: '/landing/stores/app-store-tr.svg',
    width: 151,
    height: 40,
  },
  {
    platform: 'Android',
    label: 'BeautyAsist’i Google Play’den indirin',
    href: 'https://play.google.com/store/apps/details?id=com.beautyasist.app',
    image: '/landing/stores/google-play-tr.png',
    width: 146,
    height: 57,
  },
  {
    platform: 'Mac',
    label: 'BeautyAsist Desktop’ı Mac App Store’dan indirin',
    href: 'https://apps.apple.com/tr/app/beautyasist-desktop/id6829016092?l=tr&mt=12',
    image: '/landing/stores/mac-app-store-tr.svg',
    width: 188,
    height: 40,
  },
]

export default function StoreLinks({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={styles.stores} data-compact={compact || undefined} aria-label="BeautyAsist uygulamaları">
      {stores.map(({ platform, label, href, image, width, height }) => (
        <li key={href}>
          <a className={styles.store} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
            <span className={styles.storePlatform}>
              {platform}
              <ArrowUpRight size={14} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className={styles.badgeSlot}>
              <Image src={image} width={width} height={height} alt="" unoptimized />
            </span>
          </a>
        </li>
      ))}
      <li>
        <a className={styles.store} href={windowsInstallerHref} download aria-label="BeautyAsist Desktop Windows x64 kurulum dosyasını indirin">
          <span className={styles.storePlatform}>
            Windows
            <ArrowDownToLine size={13} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className={styles.badgeSlot}>
            <span className={styles.windowsBadge}>
              <span className={styles.windowsMark} aria-hidden="true" />
              <span><small>64 bit · .exe</small><strong>İndir</strong></span>
            </span>
          </span>
        </a>
      </li>
    </ul>
  )
}
