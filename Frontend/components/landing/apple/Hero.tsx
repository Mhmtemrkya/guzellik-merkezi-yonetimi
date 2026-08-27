'use client'

import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown } from 'lucide-react'
import PressButton from './PressButton'
import { SPRING_ENTER } from './springs'

/**
 * AÇILIŞ — yolculuğun ilk karesi.
 *
 * Bu bölümün kendi görüntüsü YOKTUR: arkasında sayfanın tamamına yayılan tek kesintisiz
 * çekim durur (bkz. JourneyBackdrop) ve sayfanın en üstü o çekimin ilk karesidir — buzlu
 * camın dışı, mavi şafak. Ziyaretçi kaydırmaya başladığı anda kapıdan içeri girer.
 *
 * Metin katmanı sahnenin ORTASINDA durur; okunabilirlik ışıksal bir örtüyle kurulur, metnin
 * opaklığı düşürülerek değil. Giriş hareketleri kritik sönümlüdür (aşma yok) ve içerik
 * harekete bağlı değildir: her şey ilk karede yerindedir, hareket yalnız onu getirir.
 */
export default function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center justify-center">
      {/* Okunabilirlik örtüsü: kadrajın ortası hafifçe koyulaşır, kenarlar daha da koyu. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 92% at 50% 46%, rgba(58,20,38,0.30) 0%, rgba(40,14,27,0.62) 48%, rgba(20,10,17,0.92) 100%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-[1100px] px-5 py-28 text-center sm:px-8">
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_ENTER, delay: 0.05 }}
          className="material-dark on-material mx-auto inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] text-white"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#FFB6CC]" />
          Güzellik merkezlerinin büyüme ortağı
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_ENTER, delay: 0.12 }}
          className="display-hero balance mx-auto mt-7 max-w-[16ch] text-white"
        >
          Merkeziniz büyür. <span className="text-[#FFB6CC]">Kaosu büyümez.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_ENTER, delay: 0.2 }}
          className="balance mx-auto mt-7 max-w-[54ch] text-[17px] leading-relaxed text-white"
        >
          Randevu, danışan, paket seansı, stok, tahsilat ve raporlar tek panelde. Boş kalan saat
          kendiliğinden dolar, biten seans otomatik düşer, gün sonunda hesap tutar.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_ENTER, delay: 0.28 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <PressButton href="/kayit" tone="primary" className="px-7 py-3.5 text-[15px] font-medium">
            14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
          </PressButton>
          <PressButton href="#bir-gun" tone="glass-dark" className="px-7 py-3.5 text-[15px]">
            Bir günü izleyin <ChevronDown className="h-4 w-4" />
          </PressButton>
        </motion.div>

        {/* Danışan yolu: bu sayfaya merkez sahibi de danışan da gelir. */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...SPRING_ENTER, delay: 0.36 }}
          className="mt-6 text-[13px] text-white/90"
        >
          Bir merkezden randevu almak mı istiyorsunuz?{' '}
          <a href="/salonlar" className="font-medium text-[#FFB6CC] underline-offset-4 hover:underline">
            Salonları görün
          </a>
        </motion.p>
      </div>

      {/* Kaydırma daveti — "aşağıda bir yolculuk var" der. */}
      <div aria-hidden className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <span className="scroll-hint block h-9 w-[22px] rounded-full border border-white/50" />
      </div>
    </section>
  )
}
