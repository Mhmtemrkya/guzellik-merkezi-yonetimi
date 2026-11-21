'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, Heart, Share2 } from 'lucide-react'
import { getCustomerSession } from '@/lib/customerPortalApi'
import styles from './PublicNavbar.module.css'

const MENU = [
  { label: 'Salonlar', href: '/salonlar' },
  { label: 'Hizmetler', href: '/salonlar#kategoriler' },
  { label: 'İşletmeler', href: '/#fiyat' },
  { label: 'Hakkımızda', href: '/hakkimizda' },
  { label: 'Destek', href: '/destek' },
  { label: 'İletişim', href: '/iletisim' },
]

/**
 * Salon keşfinde ana navigasyon, salon profilinde geri dönüş ve paylaşım.
 */
export default function PublicNavbar({
  variant = 'list',
  favorite,
}: {
  variant?: 'list' | 'detail'
  favorite?: { active: boolean; onToggle: () => void }
}) {
  const pathname = usePathname()
  const [hasSession, setHasSession] = useState(false)
  const [shareStatus, setShareStatus] = useState('')

  useEffect(() => setHasSession(Boolean(getCustomerSession())), [])

  useEffect(() => {
    if (!shareStatus) return
    const timeout = window.setTimeout(() => setShareStatus(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [shareStatus])

  const bookingsHref = hasSession ? '/randevu' : `/randevu/giris?next=${encodeURIComponent(pathname || '/salonlar')}`

  const share = async (): Promise<void> => {
    const url = window.location.href
    setShareStatus('')
    try {
      if (navigator.share) {
        await navigator.share({ url, title: document.title })
        return
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url)
      setShareStatus('Salon bağlantısı kopyalandı.')
    } catch {
      setShareStatus('Bağlantı kopyalanamadı.')
    }
  }

  if (variant === 'detail') {
    return (
      <header className={styles.header}>
        <div className={styles.detailInner}>
          <Link href="/salonlar" className={styles.back}>
            <ChevronLeft size={17} aria-hidden="true" /> Salonlar
          </Link>
          <Link href="/" className={styles.brand}>
            <Image src="/logo.png" alt="" width={41} height={41} />
            <span>BeautyAsist</span>
          </Link>
          <div className={styles.detailActions}>
            {favorite && (
              <button
                type="button"
                onClick={favorite.onToggle}
                aria-label="Favori salon"
                aria-pressed={favorite.active}
                title={favorite.active ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                className={styles.detailAction}
              >
                <Heart size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void share()}
              aria-label="Paylaş"
              className={styles.detailAction}
            >
              <Share2 size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span role="status" className={styles.shareStatus}>{shareStatus}</span>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Image src="/logo.png" alt="" width={41} height={41} />
          <span>BeautyAsist</span>
        </Link>
        <nav className={styles.menu} aria-label="Ana menü">
          {MENU.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === pathname ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link href={bookingsHref} className={styles.bookings}>
          <CalendarDays size={16} aria-hidden="true" />
          Randevularım
        </Link>
      </div>
    </header>
  )
}
