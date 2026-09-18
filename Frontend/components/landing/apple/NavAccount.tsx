'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CalendarHeart, LayoutGrid, ShoppingBag } from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useCart } from '@/lib/cart'
import PressButton from './PressButton'

/**
 * ÜST ÇUBUĞUN HESAP + SEPET BÖLÜMÜ.
 *
 * HİDRASYON KURALI: oturum `localStorage`'dan, sepet de öyle okunur — ikisi de sunucuda
 * BİLİNMEZ. Sunucu render'ı ile ilk istemci render'ı birebir aynı olmak zorunda olduğundan,
 * bu bileşen `mounted` olana kadar MİSAFİR görünümünü çizer. Aksi hâlde React hidrasyon
 * uyuşmazlığı verir ve ağacı baştan kurar.
 *
 * `hydrated` (AuthContext) ayrıca oturumun okunup okunmadığını söyler; ikisi birden beklenir
 * ki giriş yapmış kullanıcıya bir an "Giriş" düğmesi gösterilip sonra adı belirmesin.
 */
export default function NavAccount() {
  const { hydrated, isAuthenticated, user } = useAuth()
  const { item } = useCart()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const ready = mounted && hydrated
  const signedIn = ready && isAuthenticated

  /** Ad yoksa e-postanın kullanıcı adı kısmı; o da yoksa nötr bir etiket. */
  const label = user?.fullName?.trim() || user?.email?.split('@')[0] || 'Hesabım'
  const short = label.length > 22 ? `${label.slice(0, 21)}…` : label

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* SEPET — yalnız doluyken görünür. Boş bir sepet simgesi hiçbir şey söylemez. */}
      {ready && item && (
        <PressButton
          href="/odeme"
          tone="glass-light"
          className="relative border border-[#EEC9D7] bg-white px-3 py-1.5 text-[12.5px]"
          ariaLabel="Sepeti aç"
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="hidden sm:inline">Sepet</span>
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#EF6F94] px-1 text-[10px] font-semibold text-white"
          >
            1
          </span>
        </PressButton>
      )}

      {signedIn ? (
        <>
          <PressButton
            href="/panel"
            tone="glass-light"
            className="border border-[#EEC9D7] bg-white px-3.5 py-2 text-[13px]"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Panel</span>
          </PressButton>

          {/* Yetkilinin adı — panelde kim olarak açılacağını söyler. */}
          <Link
            href="/panel"
            className="hidden items-center gap-2 rounded-full border border-[#EEC9D7] bg-white py-1 pl-1 pr-3.5 md:inline-flex"
            title={user?.email || undefined}
          >
            <span
              aria-hidden
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#FFDCE8] text-[11px] font-semibold text-[#8E3F5B]"
            >
              {initialsOf(label)}
            </span>
            <span className="max-w-[16ch] truncate text-[12.5px] font-medium text-[#352432]">{short}</span>
          </Link>
        </>
      ) : (
        <>
          {/* DANIŞAN YOLU — ziyaretçi merkez sahibi olmayabilir.
              DÜZ BAĞLANTI OLARAK DURUR: eskiden "Ücretsiz dene" ile yan yana, aynı ölçüde iki
              hap gibiydi. Çubukta birbiriyle yarışan iki dolu eylem, hangisinin asıl yol
              olduğunu söylemez; ikisi de zayıflar. Dolu düğme TEKTİR, bu bağlantı onun
              yanında ikincil okunur. Dar ekranda çekmecede tam boy durur. */}
          <PressButton
            href="/salonlar"
            tone="plain"
            className="hidden px-2.5 py-1.5 text-[13px] md:inline-flex"
          >
            <CalendarHeart className="h-4 w-4" /> Randevu al
          </PressButton>

          <PressButton
            href="/login"
            tone="plain"
            className="hidden px-2.5 py-1.5 text-[13px] sm:inline-flex"
          >
            Giriş
          </PressButton>

          {/* ÇUBUĞUN TEK DOLU DÜĞMESİ.
              METİN DAR EKRANDA DA TAM BİR EYLEMDİR: eskiden "Ücretsiz dene"nin ikinci
              kelimesi `sm` altında gizleniyordu ve düğmede yalnız "Ücretsiz" kalıyordu —
              bu bir çağrı değil, sıfattır ("Ücretsiz" ne?). Artık kısalan sürüm de kendi
              başına okunan bir fiil: "Başla".
              "dene" yerine "başla": kayıt akışının kendi dili de böyle ("14 günlük ücretsiz
              denemeniz başladı") ve başlamak, denemekten daha net bir davet. */}
          <PressButton
            href="/kayit"
            tone="primary-bar"
            className="h-9 px-4 text-[13px] font-semibold tracking-[-0.01em]"
          >
            <span className="hidden sm:inline">Ücretsiz&nbsp;başla</span>
            <span className="sm:hidden">Başla</span>
          </PressButton>
        </>
      )}
    </div>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  const raw = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]
  return raw.toLocaleUpperCase('tr-TR')
}
