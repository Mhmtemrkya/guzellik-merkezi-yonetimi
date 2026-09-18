'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { CalendarHeart, Menu, X } from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import PressButton from './PressButton'
import NavAccount from './NavAccount'
import { SPRING_MOVE, SPRING_SHEET } from './springs'

/**
 * ÜST ÇUBUK — videonun üstünde YÜZEN BEYAZ YÜZEY.
 *
 * Sayfanın tamamının arkasında tek kesintisiz bir çekim akıyor (bkz. JourneyBackdrop). Çubuk
 * yarı saydamdır ve arkasını bulanıklaştırır (`.material-light`); altındaki hareketli görüntü
 * ne kaybolur ne de metni bozar. Kalınlık, gölgeyle okunur.
 *
 * İLERİCİ ZENGİNLEŞTİRME: çubuk her zaman oradadır ve JavaScript'siz de okunur. Kaydırma
 * yalnız yüksekliği bir tık toparlar.
 *
 * Mobil menü bir ÇEKMECEDİR: aynı yoldan girer, aynı yoldan çıkar. Kıvamı `SPRING_SHEET` —
 * kullanıcı onu bir hareketle açtığı için hafif aşma doğru hissettirir.
 */

/**
 * Üst çubuk bağlantıları.
 *
 * KIRIK ÇAPA TUZAĞI: `#bir-gun` gibi çapalar YALNIZ tanıtım sayfasında vardır (bölümler
 * Film/Hero gibi bileşenlerde tanımlıdır). Aynı çubuk /moduller ve /destek sayfalarında da
 * kullanıldığı için çapa bağlantıları köke yazılır (`/#bir-gun`); `#bir-gun` yazılsaydı o
 * sayfalarda hiçbir yere gitmeyen ölü bağlantılar olurdu.
 *
 * `page` olanlar GERÇEK sayfadır; yalnız onlarda "şu an buradasın" işareti gösterilebilir.
 * Çapalar için gösterilemez: hangi bölümde olunduğu kaydırmaya bağlıdır ve çubuk üç ayrı
 * sayfada paylaşıldığı için burada izlenmesi yanıltıcı olurdu.
 */
const LINKS: { href: string; label: string; page?: string }[] = [
  { href: '/#bir-gun', label: 'Bir gün' },
  { href: '/#tur', label: 'Ürün turu' },
  { href: '/moduller', label: 'Modüller', page: '/moduller' },
  { href: '/#nasil', label: 'Nasıl çalışır' },
  { href: '/#fiyat', label: 'Fiyatlandırma' },
  { href: '/destek', label: 'Destek', page: '/destek' },
]

export default function Nav() {
  const reduced = useReducedMotion()
  const pathname = usePathname()
  // Çekmece yalnız tıklamayla açılır, yani her zaman bağlanmadan SONRA çizilir:
  // burada oturumu okumak NavAccount'taki hidrasyon tuzağını doğurmaz.
  const { isAuthenticated } = useAuth()
  const [atTop, setAtTop] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setAtTop(window.scrollY < 72)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  // Rota değişince çekmece kapanır: menüden bir sayfaya gidildiğinde açık kalması,
  // kullanıcıyı vardığı sayfada kapatılacak bir katmanla karşılıyordu.
  useEffect(() => setMenuOpen(false), [pathname])

  return (
    <header className="sticky top-0 z-50">
      <div
        className={`material-light w-full border-x-0 border-t-0 transition-all duration-500 ${
          atTop && !menuOpen
            ? 'shadow-[0_14px_40px_-30px_rgba(60,25,42,0.7)]'
            : 'shadow-[0_18px_50px_-26px_rgba(60,25,42,0.95)]'
        }`}
      >
        <div
          className={`mx-auto flex max-w-[1280px] items-center gap-3 px-5 transition-all duration-500 sm:px-8 ${
            atTop && !menuOpen ? 'h-16' : 'h-14'
          }`}
        >
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* Marka rozeti tam renkli ve opaktır; filtreyle beyazlatmak markayı yok eder. */}
            <Image src="/logo.png" alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
            <span className="text-[16px] font-semibold tracking-[-0.02em] text-[#352432]">BeautyAsist</span>
          </Link>

          {/* BAĞLANTILAR ORTADA: `mx-auto` ile iki yandaki blokların arasında ortalanır, böylece
              sağdaki eylemler büyüyüp küçüldükçe menü sağa sola kaymaz.
              md'DEN İTİBAREN GÖRÜNÜR: eskiden lg (1024px) şarttı ve 900px'lik bir ekranda
              logo + üç düğme + hamburger kalıyordu — yer varken menü saklanıyordu. */}
          <nav className="mx-auto hidden items-center gap-0.5 md:flex">
            {LINKS.map((l) => {
              const active = l.page ? pathname === l.page : false
              return (
                <a
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  className={`on-material rounded-full px-2.5 py-1.5 text-[13px] transition-colors duration-200 lg:px-3 ${
                    active
                      ? 'bg-[#FFE7EF] font-medium text-[#C2456B]'
                      : 'text-[#4A3A44] hover:bg-white/70 hover:text-[#C2456B]'
                  }`}
                >
                  {l.label}
                </a>
              )
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
            <NavAccount />

            <PressButton
              tone="glass-light"
              className="h-9 w-9 border border-[#EEC9D7] bg-white md:hidden"
              ariaLabel={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </PressButton>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            key="menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={reduced ? SPRING_MOVE : SPRING_SHEET}
            className="material-light max-h-[calc(100dvh-3.5rem)] w-full overflow-y-auto border-t border-[#F2DFE7] px-5 py-3 shadow-[0_18px_50px_-28px_rgba(60,25,42,0.9)] sm:px-8 md:hidden"
          >
            <ul className="space-y-0.5">
              {LINKS.map((l) => {
                const active = l.page ? pathname === l.page : false
                return (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`on-material block rounded-xl px-3 py-2.5 text-[14.5px] transition-colors ${
                        active
                          ? 'bg-[#FFE7EF] font-medium text-[#C2456B]'
                          : 'text-[#4A3A44] hover:bg-white hover:text-[#C2456B]'
                      }`}
                    >
                      {l.label}
                    </a>
                  </li>
                )
              })}
            </ul>

            {/* EYLEMLER AYRI BİR KÜME: gezinme bağlantılarıyla aynı listede dururken
                "Giriş yap" ile "Nasıl çalışır" aynı şeymiş gibi görünüyordu.
                OTURUMA DUYARLI: eski liste "Giriş yap"ı KOŞULSUZ ekliyordu, giriş yapmış
                kullanıcıya da gösteriliyordu. */}
            <div className="mt-3 grid gap-2 border-t border-[#F2DFE7] pt-3">
              <PressButton
                href="/salonlar"
                tone="glass-light"
                className="w-full justify-center border border-[#EEC9D7] bg-white py-2.5 text-[14px]"
              >
                <CalendarHeart className="h-4 w-4" /> Randevu al
              </PressButton>

              {isAuthenticated ? (
                <PressButton href="/panel" tone="primary-bar" className="w-full justify-center py-2.5 text-[14px] font-semibold">
                  Panele git
                </PressButton>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <PressButton
                    href="/login"
                    tone="glass-light"
                    className="w-full justify-center border border-[#EEC9D7] bg-white py-2.5 text-[14px]"
                  >
                    Giriş
                  </PressButton>
                  <PressButton href="/kayit" tone="primary-bar" className="w-full justify-center py-2.5 text-[14px] font-semibold">
                    Ücretsiz başla
                  </PressButton>
                </div>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
