import type { Metadata } from 'next'
import { Suspense } from 'react'
import Nav from '@/components/landing/apple/Nav'
import TrackClient from '@/components/support/TrackClient'

export const metadata: Metadata = {
  title: 'Talep takibi — BeautyAsist',
  description: 'Destek talebinizin durumunu takip kodunuzla görüntüleyin ve yanıt yazın.',
  // ARAMA MOTORLARINDAN GİZLE: adres jetonu taşır. İndekslenen bir takip bağlantısı, jetonu
  // arama sonuçlarına düşürürdü.
  robots: { index: false, follow: false },
}

/**
 * TALEP TAKİP SAYFASI — oturumsuz.
 *
 * <p>
 * Kod ve jeton adres satırından okunur; ikisi de varsa talep kendiliğinden yüklenir, yoksa
 * kullanıcıdan istenir. Girişli bir sayfa olmamasının sebebi basit: talebi açan kişi çoğu
 * zaman müşterimiz DEĞİLDİR ve giriş yapamaz.
 * </p>
 *
 * <p>
 * <c>useSearchParams</c> kullanan istemci bileşeni <c>Suspense</c> içine alınır — Next.js
 * bunu zorunlu tutar; aksi hâlde derleme aşamasında sayfa statik üretilemez ve hata verir.
 * </p>
 */
export default function SupportTrackPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#FFF7FA] text-[#352432] antialiased">
      <Nav />
      <main className="mx-auto max-w-[900px] px-5 py-12 sm:px-8 sm:py-16">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-[26px] bg-white/60" />}>
          <TrackClient />
        </Suspense>
      </main>
    </div>
  )
}
