'use client'

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { ArrowUpRight, CalendarDays, CreditCard, Menu, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'

interface NavLink {
  href: string
  label: string
}

interface MobileHighlight {
  title: string
  body: string
  icon: LucideIcon
}

const links: NavLink[] = [
  { href: '#story', label: 'Hikaye' },
  { href: '#modules', label: 'Modüller' },
  { href: '#flow', label: 'Akış' },
  { href: '#pricing', label: 'Fiyatlar' },
  { href: '#faq', label: 'SSS' },
]

const mobileHighlights: MobileHighlight[] = [
  { title: 'Tek panel', body: 'Paket, seans ve ödeme kontrolü', icon: ShieldCheck },
  { title: 'Canlı takvim', body: 'Randevu ve personel akışı', icon: CalendarDays },
  { title: 'Akıllı tahsilat', body: 'Kalan borç otomatik planlanır', icon: CreditCard },
]

export default function Navbar() {
  const { scrollY } = useScroll()
  const [shrunk, setShrunk] = useState<boolean>(false)
  const [open, setOpen] = useState<boolean>(false)
  useMotionValueEvent(scrollY, 'change', (v: number) => setShrunk(v > 40))

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.__lenis?.stop?.()

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.__lenis?.start?.()
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const handleNav = (e: ReactMouseEvent<HTMLAnchorElement>, href: string): void => {
    e.preventDefault()
    const wasOpen = open
    setOpen(false)

    if (typeof window === 'undefined') return

    // Mobile full-screen menu locks body scroll and pauses Lenis. If we call
    // scrollTo while that lock is still active, the tap closes the menu but the
    // page does not move. Release the lock immediately, then scroll on the next
    // frame after React starts closing the overlay.
    if (typeof document !== 'undefined') document.body.style.overflow = ''
    window.__lenis?.start?.()

    const scrollToTarget = () => {
      const el = document.querySelector(href) as HTMLElement | null
      if (!el) return
      window.__lenis?.start?.()
      if (window.__lenis?.scrollTo) window.__lenis.scrollTo(el, { offset: -70, duration: 1.15 })
      else {
        const top = el.getBoundingClientRect().top + window.scrollY - 70
        window.scrollTo({ top, behavior: 'smooth' })
      }
      if (window.history?.replaceState) window.history.replaceState(null, '', href)
    }

    if (wasOpen) window.setTimeout(() => window.requestAnimationFrame(scrollToTarget), 90)
    else scrollToTarget()
  }

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="fixed left-0 right-0 top-0 z-[100]"
    >
      <div
        className={`relative z-[130] mx-auto mt-3 flex max-w-7xl items-center justify-between rounded-full border border-[#fff4f8]/14 px-4 py-2.5 transition-all duration-500 sm:px-6 ${
          shrunk || open
            ? 'mt-3 bg-[#160b12]/78 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl'
            : 'bg-[#160b12]/35 backdrop-blur-xl'
        }`}
      >
        <a href="#story" onClick={(e) => handleNav(e, '#story')} className="flex items-center gap-3" data-cursor="ÖZGE">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-[#f0aac2]/45 bg-gradient-to-br from-[#3a1a2a]/70 to-[#160b12]/70 text-xs font-bold shadow-[0_0_30px_rgba(240,170,194,0.25)]">
            ÖÖ
          </span>
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.26em] text-[#fff4f8]/85 sm:block">
            Özlem Özge · GMS
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => handleNav(e, l.href)}
              className="rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[#fff4f8]/72 transition hover:bg-[#fff4f8]/8 hover:text-[#fff4f8]"
              data-cursor={l.label}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="/login"
            className="hidden min-h-[44px] items-center rounded-full border border-[#fff4f8]/16 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#fff4f8]/82 transition hover:bg-[#fff4f8]/8 sm:inline-flex"
            data-cursor="GİRİŞ"
          >
            Giriş
          </a>
          <a
            href="/login"
            className="group hidden min-h-[44px] items-center gap-2 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#2f1724] shadow-[0_12px_45px_rgba(240,170,194,0.32)] min-[380px]:inline-flex"
            data-cursor="DEMO"
          >
            Demo Al
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-[#fff4f8]/16 bg-[#160b12]/65 text-[#fff4f8] shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition hover:border-[#f0aac2]/45 hover:bg-[#2a1420]/70 focus:outline-none focus:ring-2 focus:ring-[#f0aac2]/70 lg:hidden"
            aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            {open ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Mobil navigasyon menüsü"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[110] overflow-y-auto bg-[#160b12] px-5 pb-8 pt-24 text-[#fff4f8] lg:hidden"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(240,170,194,0.26),transparent_32%),radial-gradient(circle_at_80%_15%,rgba(139,92,246,0.22),transparent_30%),linear-gradient(180deg,rgba(22,11,18,0.94),#160b12_64%)]" />
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
            <div className="pointer-events-none absolute inset-x-5 top-24 h-px bg-gradient-to-r from-transparent via-[#f0aac2]/35 to-transparent" />

            <motion.div
              initial={{ y: 18, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto flex min-h-[calc(100dvh-7rem)] max-w-2xl flex-col justify-between gap-8"
            >
              <div className="space-y-7">
                <div className="rounded-[2rem] border border-[#fff4f8]/12 bg-[#fff4f8]/[0.055] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
                  <span className="eyebrow inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/50 px-3 py-1.5 text-[#ffd3df]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Mobil Menü
                  </span>
                  <h2 className="mt-4 max-w-sm font-display text-[clamp(2rem,9vw,3.6rem)] leading-[0.95] tracking-[-0.04em] text-[#fff4f8]">
                    Güzellik merkeziniz için
                    <span className="block armonessa-text-gradient">tek akış.</span>
                  </h2>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#fff4f8]/72">
                    Paket, randevu, seans ve tahsilat yönetimine hızlı ulaşın. Menü tam ekran, okunaklı ve dokunmatik kullanıma uygun.
                  </p>
                </div>

                <nav className="space-y-3" aria-label="Mobil ana menü">
                  {links.map((l, index) => (
                    <motion.a
                      key={l.href}
                      href={l.href}
                      onClick={(e) => handleNav(e, l.href)}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.06 + index * 0.035, duration: 0.28 }}
                      className="group flex min-h-[60px] cursor-pointer items-center justify-between rounded-3xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.045] px-4 py-3 text-left shadow-[0_16px_45px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:border-[#f0aac2]/35 hover:bg-[#f0aac2]/10 focus:outline-none focus:ring-2 focus:ring-[#f0aac2]/60"
                    >
                      <span className="flex items-center gap-4">
                        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#f0aac2]/80">0{index + 1}</span>
                        <span className="font-display text-[20px] tracking-[-0.02em] text-[#fff4f8]">{l.label}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-[#ffd3df]/65 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#ffd3df]" />
                    </motion.a>
                  ))}
                </nav>

                <div className="grid gap-3 sm:grid-cols-3">
                  {mobileHighlights.map((item, index) => {
                    const Icon = item.icon
                    return (
                      <motion.div
                        key={item.title}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.18 + index * 0.04, duration: 0.28 }}
                        className="rounded-3xl border border-[#fff4f8]/10 bg-[#160b12]/52 p-4 backdrop-blur-xl"
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[#f0aac2]/30 bg-[#f0aac2]/12 text-[#ffd3df]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="mt-3 font-display text-[15px] text-[#fff4f8]">{item.title}</div>
                        <div className="mt-1 text-[12px] leading-relaxed text-[#fff4f8]/60">{item.body}</div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              <div className="sticky bottom-0 -mx-5 border-t border-[#fff4f8]/10 bg-[#160b12]/82 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-2xl">
                <div className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-2">
                  <a
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="inline-flex min-h-[52px] cursor-pointer items-center justify-center rounded-full border border-[#fff4f8]/18 bg-[#fff4f8]/[0.055] px-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#fff4f8] transition hover:bg-[#fff4f8]/10 focus:outline-none focus:ring-2 focus:ring-[#f0aac2]/60"
                  >
                    Giriş Yap
                  </a>
                  <a
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="group inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-5 text-[11px] font-bold uppercase tracking-[0.24em] text-[#2f1724] shadow-[0_18px_55px_rgba(240,170,194,0.32)] transition hover:shadow-[0_22px_70px_rgba(240,170,194,0.42)] focus:outline-none focus:ring-2 focus:ring-[#fff4f8]/80"
                  >
                    Demo Al
                    <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
