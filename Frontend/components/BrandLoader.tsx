import Image from 'next/image'

interface BrandLoaderProps {
  /** Tam ekran (public sayfalar) veya panel içerik alanı (sidebar sabit kalır) */
  fullScreen?: boolean
  label?: string
}

/**
 * Logolu marka yükleme ekranı — rota segmentlerinin loading.tsx dosyalarında kullanılır.
 * Saf CSS animasyonlu (framer-motion yok) ki server component olarak kalsın ve anında boyansın.
 */
export default function BrandLoader({ fullScreen = false, label = 'Hazırlanıyor' }: BrandLoaderProps) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${
        fullScreen ? 'min-h-screen' : 'min-h-[70vh] w-full'
      }`}
      style={{ background: 'linear-gradient(160deg, #fff7fa 0%, #ffeef4 55%, #fde7ef 100%)' }}
      role="status"
      aria-label={label}
    >
      <style>{`
        @keyframes bl-breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-7px) scale(1.045); }
        }
        @keyframes bl-shadow {
          0%, 100% { transform: scaleX(1); opacity: 0.35; }
          50% { transform: scaleX(0.72); opacity: 0.2; }
        }
        @keyframes bl-halo {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.12); }
        }
        @keyframes bl-sweep {
          0% { transform: translateX(-130%) rotate(18deg); }
          55%, 100% { transform: translateX(130%) rotate(18deg); }
        }
        @keyframes bl-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes bl-dot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-4px); }
        }
        @keyframes bl-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bl-anim, .bl-anim * { animation: none !important; }
        }
      `}</style>

      {/* arka plan yumuşak ışık lekeleri */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 right-1/4 h-72 w-72 rounded-full blur-3xl"
        style={{ background: 'rgba(244,185,201,0.35)' }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-28 left-1/4 h-72 w-72 rounded-full blur-3xl"
        style={{ background: 'rgba(255,220,232,0.5)' }}
      />

      <div className="bl-anim relative flex flex-col items-center">
        {/* yörünge parçacıkları — dış katman merkezler, iç katman döner */}
        <div aria-hidden className="absolute left-1/2 top-[52px] h-44 w-44 -translate-x-1/2 -translate-y-1/2">
          <div className="h-full w-full" style={{ animation: 'bl-orbit 7s linear infinite' }}>
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[#ef6f94] shadow-[0_0_12px_rgba(239,111,148,0.8)]" />
            <span className="absolute bottom-4 left-4 h-1.5 w-1.5 rounded-full bg-[#e7b98c] shadow-[0_0_10px_rgba(231,185,140,0.9)]" />
            <span className="absolute right-3 top-10 h-1 w-1 rounded-full bg-[#c85776] opacity-80" />
          </div>
        </div>

        {/* nefes alan hale — dış katman merkezler, iç katman nefes alır */}
        <span aria-hidden className="absolute left-1/2 top-[52px] h-36 w-36 -translate-x-1/2 -translate-y-1/2">
          <span
            className="block h-full w-full rounded-full blur-2xl"
            style={{
              background: 'radial-gradient(circle, rgba(239,111,148,0.4) 0%, rgba(244,185,201,0.18) 55%, transparent 75%)',
              animation: 'bl-halo 2.6s ease-in-out infinite',
            }}
          />
        </span>

        {/* logo */}
        <div
          className="relative h-[104px] w-[104px]"
          style={{ animation: 'bl-breathe 2.6s ease-in-out infinite' }}
        >
          <Image src="/logo.png" alt="BeautyAsist" fill priority sizes="104px" className="object-contain drop-shadow-[0_18px_28px_rgba(190,91,125,0.35)]" />
          {/* süzülen ışıltı */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]"
          >
            <span
              className="absolute -inset-y-4 w-1/3"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                animation: 'bl-sweep 2.2s ease-in-out infinite',
              }}
            />
          </span>
        </div>

        {/* zemin gölgesi */}
        <span
          aria-hidden
          className="mt-3 h-2 w-16 rounded-full bg-[#c85776]/30 blur-[6px]"
          style={{ animation: 'bl-shadow 2.6s ease-in-out infinite' }}
        />

        {/* marka + durum */}
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <span className="text-[15px] font-semibold tracking-[0.02em] text-[#8c415b]">
            Beauty<span className="text-[#3d4fb0]">Asist</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#9d7386]">
            {label}
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-[#c85776]"
                style={{ animation: `bl-dot 1.3s ease-in-out ${i * 0.18}s infinite` }}
              />
            ))}
          </span>
          {/* ilerleme çubuğu */}
          <span className="relative mt-1 block h-[3px] w-40 overflow-hidden rounded-full bg-[#f4d3de]">
            <span
              className="absolute inset-y-0 w-2/5 rounded-full"
              style={{
                background: 'linear-gradient(90deg, #f4b9c9, #ef6f94, #c85776)',
                animation: 'bl-bar 1.4s ease-in-out infinite',
              }}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
