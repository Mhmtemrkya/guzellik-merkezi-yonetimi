'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, Heart, Menu, Share2, X } from 'lucide-react'
import { getCustomerSession } from '@/lib/customerPortalApi'

const MENU = [
  { label: 'Keşfet', href: '/salonlar' },
  { label: 'Hizmetler', href: '/salonlar#kategoriler' },
  { label: 'Salona Üye Ol', href: '/#pricing' },
  { label: 'Hakkımızda', href: '/#features' },
  { label: 'İletişim', href: '/#footer' },
]

/**
 * Herkese açık vitrin sayfalarının yüzen kart navbar'ı (mockup birebir):
 * solda çiçek logolu wordmark, ortada menü, sağda Randevularım pili.
 * `variant="detail"` salon profili için: solda "‹ Salonlar", sağda kalp/paylaş.
 */
export default function PublicNavbar({ variant = 'list' }: { variant?: 'list' | 'detail' }) {
  const pathname = usePathname()
  const [hasSession, setHasSession] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setHasSession(Boolean(getCustomerSession())), [])

  const bookingsHref = hasSession ? '/randevu' : `/randevu/giris?next=${encodeURIComponent(pathname || '/salonlar')}`

  const share = async (): Promise<void> => {
    try {
      if (navigator.share) await navigator.share({ url: window.location.href, title: document.title })
      else {
        await navigator.clipboard.writeText(window.location.href)
      }
    } catch {
      /* paylaşım iptal */
    }
  }

  if (variant === 'detail') {
    return (
      <div className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex max-w-7xl items-center justify-between rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 shadow-[0_20px_50px_-32px_rgba(200,87,118,0.45)] backdrop-blur-xl"
        >
          <Link
            href="/salonlar"
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[12.5px] font-semibold text-[#7c6170] transition-colors hover:text-[#c85776]"
          >
            <ChevronLeft className="h-4 w-4" /> Salonlar
          </Link>
          <Link href="/" className="font-display text-[19px] leading-none tracking-[0.02em] text-[#b2334f]">
            BeautyAsist
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Favorilere ekle"
              className="grid h-9 w-9 place-items-center rounded-full text-[#c85776] transition-colors hover:bg-[#fdeef3]"
            >
              <Heart className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => void share()}
              aria-label="Paylaş"
              className="grid h-9 w-9 place-items-center rounded-full text-[#7c6170] transition-colors hover:bg-[#fdeef3] hover:text-[#c85776]"
            >
              <Share2 className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </motion.header>
      </div>
    )
  }

  return (
    <div className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-7xl rounded-[24px] border border-white/70 bg-white/94 shadow-[0_20px_50px_-32px_rgba(200,87,118,0.45)] backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-[#fdeef3]">
              <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full scale-110 object-contain" />
            </span>
            <span className="font-display text-[21px] leading-none tracking-[0.01em] text-[#b2334f]">BeautyAsist</span>
          </Link>

          {/* Orta menü */}
          <nav className="hidden items-center gap-7 lg:flex">
            {MENU.map((m) => (
              <Link
                key={m.label}
                href={m.href}
                className="text-[13px] font-semibold text-[#4a3542] transition-colors hover:text-[#e0517a]"
              >
                {m.label}
              </Link>
            ))}
          </nav>

          {/* Sağ aksiyonlar */}
          <div className="flex items-center gap-2">
            <Link
              href={bookingsHref}
              className="hidden min-h-10 items-center gap-2 rounded-full border border-[#f3c6d4] bg-white px-5 text-[12.5px] font-bold text-[#e0517a] transition-colors hover:bg-[#fdeef3] sm:inline-flex"
            >
              <CalendarDays className="h-4 w-4" /> Randevularım
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menü"
              className="grid h-10 w-10 place-items-center rounded-full text-[#4a3542] transition-colors hover:bg-[#fdeef3] lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobil menü */}
        {menuOpen && (
          <nav className="border-t border-[#f6e3ea] px-5 pb-4 pt-2 lg:hidden">
            {MENU.map((m) => (
              <Link
                key={m.label}
                href={m.href}
                onClick={() => setMenuOpen(false)}
                className="block py-2.5 text-[13.5px] font-semibold text-[#4a3542] hover:text-[#e0517a]"
              >
                {m.label}
              </Link>
            ))}
            <Link
              href={bookingsHref}
              onClick={() => setMenuOpen(false)}
              className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#f3c6d4] px-5 text-[12.5px] font-bold text-[#e0517a]"
            >
              <CalendarDays className="h-4 w-4" /> Randevularım
            </Link>
          </nav>
        )}
      </motion.header>
    </div>
  )
}
