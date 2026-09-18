'use client'

import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import PressButton from './PressButton'
import NavAccount from './NavAccount'
import { SPRING_MOVE, SPRING_SHEET } from './springs'

/**
 * ÜST ÇUBUK — videonun üstünde YÜZEN BEYAZ KART.
 *
 * Sayfanın tamamının arkasında tek kesintisiz bir çekim akıyor (bkz. JourneyBackdrop). Kenardan
 * kenara uzanan bir çubuk o görüntüyü keser; bunun yerine çubuk, ekranın üstünde duran ayrı bir
 * NESNEDİR: yuvarlak köşeli, kendi gölgesi olan bir kart. Video kartın altından ve iki yanından
 * akmaya devam eder — Apple'ın "yüzen katman" dili budur.
 *
 * MALZEME: kart yarı saydam beyazdır ve arkasını bulanıklaştırır (`.material-light`); bu yüzden
 * altındaki hareketli görüntü ne kaybolur ne de metni bozar. Kalınlık, gölgeyle okunur.
 *
 * İLERİCİ ZENGİNLEŞTİRME: kart her zaman oradadır ve JavaScript'siz de okunur. Kaydırma yalnız
 * kartı bir tık toparlar (üstteyken biraz daha geniş ve şeffaf, aşağıda daha derli toplu).
 *
 * İKİ HEDEF KİTLE: bu sayfaya hem merkez sahibi (Giriş / Ücretsiz dene) hem de randevu almak
 * isteyen danışan (Randevu al → /salonlar) gelir. İkisinin yolu da çubukta durur.
 *
 * Mobil menü bir ÇEKMECEDİR: aynı yoldan girer, aynı yoldan çıkar (yukarıdan aşağı ve geri).
 * Kıvamı `SPRING_SHEET` — kullanıcı onu bir hareketle açtığı için hafif aşma doğru hissettirir.
 */

/**
 * Üst çubuk bağlantıları.
 *
 * KIRIK ÇAPA TUZAĞI: buradaki `#bir-gun` gibi çapalar YALNIZ tanıtım sayfasında vardır.
 * Aynı çubuk /moduller ve /destek sayfalarında da kullanıldığı için çapa bağlantıları köke
 * yazılır (`/#bir-gun`); `#bir-gun` yazılsaydı o sayfalarda hiçbir yere gitmeyen ölü
 * bağlantılar olurdu.
 */
const LINKS = [
  { href: '/#bir-gun', label: 'Bir gün' },
  { href: '/#tur', label: 'Ürün turu' },
  { href: '/moduller', label: 'Modüller' },
  { href: '/#nasil', label: 'Nasıl çalışır' },
  { href: '/#fiyat', label: 'Fiyatlandırma' },
  { href: '/destek', label: 'Destek' },
]

export default function Nav() {
  const reduced = useReducedMotion()
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

  return (
    <header className="sticky top-0 z-50">
      {/* TAM GENİŞLİK KART: çubuk ekranı boydan boya kaplar ama yine bir yüzeydir —
          video altından akar, malzeme onu bulanıklaştırır (bkz. `.material-light`).
          İçerik sayfanın ölçüsüyle hizalı kalsın diye ayrıca ortalanır. */}
      <div
        className={`material-light w-full border-x-0 border-t-0 transition-all duration-500 ${
          atTop && !menuOpen
            ? 'shadow-[0_14px_40px_-30px_rgba(60,25,42,0.7)]'
            : 'shadow-[0_18px_50px_-26px_rgba(60,25,42,0.95)]'
        }`}
      >
      <div
        className={`mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 transition-all duration-500 sm:px-8 ${
          atTop && !menuOpen ? 'h-16' : 'h-14'
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5">
          {/* Marka rozeti tam renkli ve opaktır; filtreyle beyazlatmak markayı yok eder. */}
          <Image src="/logo.png" alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
          <span className="text-[16px] font-semibold tracking-[-0.02em] text-[#352432]">BeautyAsist</span>
        </Link>

        <nav className="hidden items-center gap-7 text-[12.5px] lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="on-material text-[#4A3A44] transition-colors duration-300 hover:text-[#EF6F94]"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <NavAccount />

          <PressButton
            tone="glass-light"
            className="h-9 w-9 border border-[#EEC9D7] bg-white lg:hidden"
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
            className="material-light w-full border-t border-[#F2DFE7] px-5 py-3 shadow-[0_18px_50px_-28px_rgba(60,25,42,0.9)] sm:px-8 lg:hidden"
          >
            <ul className="space-y-0.5">
              {[...LINKS, { href: '/salonlar', label: 'Salonları keşfet' }, { href: '/login', label: 'Giriş yap' }].map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="on-material block rounded-xl px-3 py-2.5 text-[14.5px] text-[#4A3A44] transition-colors hover:bg-white hover:text-[#EF6F94]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
