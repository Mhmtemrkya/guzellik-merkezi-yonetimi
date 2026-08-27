'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

/**
 * YOLCULUK — sayfanın TAMAMININ arkasında duran tek kesintisiz çekim.
 *
 * Video oynamaz; KAYDIRMA ONU SÜRER. Sayfanın en üstü klibin ilk karesi (mavi şafak,
 * buzlu camın dışı), en altı son karesidir (gece, camın ardında şehir ışıkları). Aradaki
 * her şey — resepsiyon, sabah koridoru, öğle bakım odası, ikindi salonu, akşam lambaları —
 * ziyaretçi ilerledikçe gerçek zamanlı açılır. Sahne metinlerindeki saatler (08:40 → 20:10)
 * bu yüzden gerçekten videodaki ışıkla aynı saati gösterir.
 *
 * NEDEN `fixed`: tek bir görüntü katmanı bütün bölümlerin altında sürekli kalır; bölüm
 * sınırlarında kesme olmaz. İçerik `z-10` ile üstünde akar.
 *
 * AKICILIK: `currentTime` doğrudan kaydırma değerine yazılmaz. Hedef değere her karede
 * yaklaşılır (yumuşatma); tekerlek basamakları ve sürükleme sıçramaları böyle silinir.
 * Ayrıca kare aralığından küçük değişimlerde arama yapılmaz — gereksiz decode isteği,
 * takılmanın en yaygın sebebidir.
 *
 * SÖZLEŞME — İÇERİK HAREKETE BAĞLI DEĞİLDİR:
 *   · Video SÜSTÜR; hiçbir bilgi taşımaz.
 *   · Altında her zaman durağan kare (`poster`) durur, bu yüzden video hiç yüklenmese de
 *     sayfa eksiksizdir.
 *   · `prefers-reduced-motion` açıksa video HİÇ indirilmez — tam ekran hareketli arka plan
 *     vestibüler rahatsızlık sebebidir; yalnız durağan kare gösterilir.
 *   · JavaScript çalışmazsa kaynak hiç takılmaz, yine durağan kare kalır.
 */
export default function JourneyBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [armed, setArmed] = useState(false)

  /** Kaydırmadan gelen hedef saniye ve ekranda gösterilen saniye. */
  const target = useRef(0)
  const shown = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setArmed(true)
  }, [])

  useEffect(() => {
    if (!armed) return
    const video = videoRef.current
    if (!video) return

    let frame = 0
    let alive = true

    // iOS, hiç oynatılmamış bir videoda arama yapmaya izin vermez. Sessiz bir oynat–duraklat
    // videoyu "açar"; başarısız olursa sorun değil, poster kalır.
    const unlock = () => {
      void video
        .play()
        .then(() => video.pause())
        .catch(() => {})
    }
    unlock()

    const readTarget = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
      target.current = progress * duration
    }

    const loop = () => {
      if (!alive) return
      frame = requestAnimationFrame(loop)

      // Hedefe kademeli yaklaş: kaydırma sıçramaları kamera hareketine dönüşmesin.
      shown.current += (target.current - shown.current) * 0.14

      if (video.readyState >= 2) {
        // Bir kare aralığından küçük fark için arama yapma; boşuna decode isteği takılmaya yol açar.
        if (Math.abs(video.currentTime - shown.current) > 1 / 15) {
          video.currentTime = shown.current
        }
      }
    }

    const onScroll = () => readTarget()
    const onMeta = () => {
      readTarget()
      shown.current = target.current
    }

    video.addEventListener('loadedmetadata', onMeta)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    readTarget()
    shown.current = target.current
    frame = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(frame)
      video.removeEventListener('loadedmetadata', onMeta)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [armed])

  return (
    <div aria-hidden className="fixed inset-0 z-0 overflow-hidden">
      <Image
        src="/landing/film/yolculuk.webp"
        alt=""
        fill
        sizes="100vw"
        priority
        className="object-cover"
      />
      {armed ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src="/landing/film/yolculuk.mp4"
          poster="/landing/film/yolculuk.webp"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      ) : null}
    </div>
  )
}
