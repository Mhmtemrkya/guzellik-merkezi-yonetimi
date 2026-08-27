'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

/**
 * ARKA PLAN VİDEOSU — sessiz, döngüsel, SÜS.
 *
 * Sözleşme: video hiçbir bilgi taşımaz. Her katmanın altında durağan karesi (`poster`) durur,
 * bu yüzden video hiç yüklenmese de bölüm eksiksizdir.
 *   · Kaynak yalnız JavaScript ile takılır (`preload="none"` + geç bağlama).
 *   · `prefers-reduced-motion` açıksa video HİÇ indirilmez — tam ekran hareketli arka plan
 *     vestibüler rahatsızlık sebebidir; durağan kare gösterilir.
 *   · Bölüm bir ekran boyu yaklaşınca hazırlanır, görüş alanından çıkınca durdurulur;
 *     arka planda boşuna kod çözülmez.
 *   · Otomatik oynatma engellenirse hata yutulur, poster görünmeye devam eder.
 */
export default function AmbientVideo({
  src,
  poster,
  /** İlk ekranda görünen bölümlerde durağan kare öncelikli yüklenir. */
  priority = false,
  className = '',
}: {
  src: string
  poster: string
  priority?: boolean
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [armed, setArmed] = useState(false)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const el = wrapRef.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setArmed(true)
      setInView(true)
      return
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setArmed(true)
        setInView(entry.isIntersecting)
      },
      { rootMargin: '100% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (inView) void video.play().catch(() => {})
    else video.pause()
  }, [inView, armed])

  return (
    <div ref={wrapRef} className={`absolute inset-0 overflow-hidden ${className}`}>
      <Image src={poster} alt="" fill sizes="100vw" priority={priority} className="object-cover" />
      {armed ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
        />
      ) : null}
    </div>
  )
}
