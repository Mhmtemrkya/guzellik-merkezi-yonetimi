'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowUpRight, CalendarDays, CirclePlay, Heart, LayoutGrid, LifeBuoy, Mail, MapPin, Menu, Scissors,
  Smartphone, Sparkles, Sun, Tag, X, type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import LandingAccount from '@/components/landing/LandingAccount'
import { useAuth } from '@/components/dashboard/AuthContext'
import { getCustomerSession } from '@/lib/customerPortalApi'
import styles from './MaydiMenu.module.css'

type NavLink = { label: string; href: string; hint: string; icon: LucideIcon; tone: string }

/** Menü karoları: her bağlantının ikonu, kısa açıklaması ve rengi (`data-tone`, MaydiMenu.module.css). */
const navigation: { title: string; links: NavLink[] }[] = [
  {
    title: 'Ürün',
    links: [
      { label: 'Modüller', href: '/moduller', hint: 'Tüm özellikler ve yetkiler', icon: LayoutGrid, tone: 'pink' },
      { label: 'Ürün turu', href: '/#tur', hint: 'Panelde kısa bir gezinti', icon: CirclePlay, tone: 'violet' },
      { label: 'Salonun bir günü', href: '/#bir-gun-sahne', hint: 'Sabahtan gün sonuna akış', icon: Sun, tone: 'amber' },
      { label: 'Maydi ile tanış', href: '/#maydi', hint: 'Yapay zekâ asistanınız', icon: Sparkles, tone: 'sky' },
      { label: 'Fiyatlar', href: '/#fiyat', hint: 'Paketler ve ücretsiz deneme', icon: Tag, tone: 'emerald' },
      { label: 'Uygulamalar', href: '/#uygulamalar', hint: 'iPhone, Android, Mac, Windows', icon: Smartphone, tone: 'rose' },
    ],
  },
  {
    title: 'Keşif ve destek',
    links: [
      { label: 'Salonlar', href: '/salonlar', hint: 'Salon bulun, randevu alın', icon: MapPin, tone: 'pink' },
      { label: 'Hizmetler', href: '/salonlar#kategoriler', hint: 'Kategorilere göre keşfedin', icon: Scissors, tone: 'violet' },
      { label: 'Hakkımızda', href: '/hakkimizda', hint: 'BeautyAsist’i tanıyın', icon: Heart, tone: 'rose' },
      { label: 'Destek', href: '/destek', hint: 'Yardım ve talep takibi', icon: LifeBuoy, tone: 'emerald' },
      { label: 'İletişim', href: '/iletisim', hint: 'Bize ulaşın', icon: Mail, tone: 'sky' },
    ],
  },
]

export default function MaydiMenu() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [hasCustomerSession, setHasCustomerSession] = useState(false)
  // Perde "Menü" düğmesinin bulunduğu noktadan açılır, oraya kapanır (geniş ekranda düğme sağ kenarda değildir).
  const [origin, setOrigin] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const destination = useRef<URL | null>(null)
  const bookingsHref = hasCustomerSession
    ? '/randevu'
    : '/randevu/giris?next=' + encodeURIComponent(pathname || '/')

  const { hydrated, isAuthenticated } = useAuth()
  const signedIn = hydrated && isAuthenticated

  function rememberDestination(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    destination.current = new URL(event.currentTarget.href)
  }

  return (
    <div className={styles.controls}>
      {/* Kullanıcı isteği 22 Kas 2026: "Giriş yap" / "Panelim" üst çubukta; "Modüller" yalnız menüde. */}
      <Link className={styles.navAccount} data-signed-in={signedIn || undefined} href={signedIn ? '/panel' : '/login'}>
        {signedIn ? 'Panelim' : 'Giriş yap'} <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
      <Dialog.Root open={open} onOpenChange={(next) => {
        if (next) {
          setHasCustomerSession(Boolean(getCustomerSession()))
          const rect = trigger.current?.getBoundingClientRect()
          if (rect) {
            setOrigin({
              '--menu-x': `${Math.round(rect.left + rect.width / 2)}px`,
              '--menu-y': `${Math.round(rect.top + rect.height / 2)}px`,
            } as CSSProperties)
          }
        }
        setOpen(next)
      }}>
        <Dialog.Trigger asChild>
          <button ref={trigger} type="button" className={styles.trigger}>
            <Menu size={19} aria-hidden="true" /> Menü
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.dialog}
            style={origin}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              closeButton.current?.focus({ preventScroll: true })
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const target = destination.current
              destination.current = null

              if (!target || (target.pathname === pathname && !target.hash)) {
                trigger.current?.focus({ preventScroll: true })
              } else if (target.pathname === pathname) {
                const section = document.getElementById(target.hash.slice(1))
                if (section) {
                  if (!section.hasAttribute('tabindex')) section.tabIndex = -1
                  section.focus({ preventScroll: true })
                }
              }
            }}
            onFocusCapture={({ currentTarget, target }) => {
              if (currentTarget.scrollHeight > currentTarget.clientHeight && !target.closest('header')) {
                target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }
            }}
          >
            <header className={styles.dialogHeader}>
              <div className={styles.headerInner}>
                <Dialog.Close asChild>
                  <Link className={styles.brand} href="/" onClick={rememberDestination}>
                    <Image src="/logo.png" alt="" width={42} height={42} />
                    <span>BeautyAsist</span>
                  </Link>
                </Dialog.Close>
                <Dialog.Close asChild>
                  <button ref={closeButton} type="button" className={styles.close} aria-label="Menüyü kapat">
                    Kapat <X size={20} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
            </header>
            <div className={styles.frame}>
              <Dialog.Title className={styles.title}>Menü</Dialog.Title>
              <Dialog.Description className="sr-only">BeautyAsist’in sayfalarına ve hesap bağlantılarına gidin.</Dialog.Description>
              <div className={styles.body}>
                <nav className={styles.navigation} aria-label="Ana menü">
                  {navigation.map(({ title, links }, groupIndex) => (
                    <div key={title} className={styles.group}>
                      <h3>{title}</h3>
                      <ul className={styles.tiles}>
                        {links.map(({ label, href, hint, icon: Icon, tone }, index) => (
                          <li key={href} data-tone={tone} style={{ '--i': groupIndex * 3 + index } as CSSProperties}>
                            <Dialog.Close asChild>
                              <Link className={styles.tile} href={href} onClick={rememberDestination} aria-current={pathname === href ? 'page' : undefined}>
                                <span className={styles.tileIcon} aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></span>
                                <span className={styles.tileText}>
                                  <strong>{label}</strong>
                                  <small>{hint}</small>
                                </span>
                                <ArrowUpRight className={styles.tileArrow} size={16} aria-hidden="true" />
                              </Link>
                            </Dialog.Close>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </nav>
                <figure className={styles.maydi}>
                  <div className={styles.maydiArt}>
                    <Image src="/mascots/maydi/guiding.webp" alt="" width={256} height={320} unoptimized />
                  </div>
                  <figcaption className={styles.maydiCopy}>
                    <strong>Maydi</strong>
                    <span>BeautyAsist’in yapay zekâ asistanı</span>
                  </figcaption>
                </figure>
              </div>
              <div className={styles.session}>
                <Dialog.Close asChild>
                  <Link href={bookingsHref} className={styles.accountLink} onClick={rememberDestination}>
                    <CalendarDays size={17} aria-hidden="true" /> Randevularım
                  </Link>
                </Dialog.Close>
                <LandingAccount onNavigate={rememberDestination} />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
