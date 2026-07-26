'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Barcode as BarcodeIcon, Camera, ScanLine, X } from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'

/**
 * Barkod alanı + okuyucu entegrasyonu.
 *
 * İki yol destekler:
 *  1) **El terminali / USB-Bluetooth barkod okuyucu**: bu cihazlar klavye gibi davranır —
 *     karakterleri çok hızlı yazıp sonunda Enter gönderir. "Okuyucu" moduna alındığında
 *     tuş vuruşları pencere seviyesinde dinlenir (odak nerede olursa olsun) ve hızlı
 *     dizilim + Enter kalıbı barkod olarak yakalanır. Elle yazma bu kalıba uymaz.
 *  2) **Kamera**: tarayıcı BarcodeDetector API'sini destekliyorsa (Chrome/Edge/Android)
 *     arka kameradan canlı tarama yapılır. Desteklenmiyorsa kullanıcıya okuyucu/el girişi önerilir.
 */
export default function BarcodeScanField({
  value,
  onChange,
  placeholder = 'Boş → otomatik EAN-13',
  inputClassName = '',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  inputClassName?: string
}) {
  const [armed, setArmed] = useState(false)
  const [camOpen, setCamOpen] = useState(false)
  const [lastScan, setLastScan] = useState('')

  // --- 1) Klavye taklidi yapan okuyucu -------------------------------------
  const buffer = useRef('')
  const lastKeyAt = useRef(0)

  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now()
      // 120 ms'den uzun aradan sonra gelen tuş yeni bir okuma sayılır (insan yazımı bu hızda değildir).
      if (now - lastKeyAt.current > 120) buffer.current = ''
      lastKeyAt.current = now

      if (e.key === 'Enter') {
        const code = buffer.current.trim()
        buffer.current = ''
        if (code.length >= 4) {
          e.preventDefault()
          onChange(code)
          setLastScan(code)
          setArmed(false)
        }
        return
      }
      if (e.key.length === 1) buffer.current += e.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed, onChange])

  const handleCameraResult = useCallback(
    (code: string) => {
      onChange(code)
      setLastScan(code)
      setCamOpen(false)
    },
    [onChange],
  )

  return (
    <div className="space-y-2">
      <div className="relative">
        <BarcodeIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a98a98]" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          className={`pl-10 font-mono ${inputClassName}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setArmed((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-[12px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            armed
              ? 'border-[#c85776] bg-[#fff1f6] text-[#a34a62]'
              : 'border-[#efe1e7] bg-white text-[#705a66] hover:border-[#efbfd0] hover:text-[#c85776]'
          }`}
        >
          <ScanLine className={`h-3.5 w-3.5 ${armed ? 'animate-pulse' : ''}`} />
          {armed ? 'Okutun…' : 'Barkod okuyucu'}
        </button>
        <button
          type="button"
          onClick={() => setCamOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#efe1e7] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
        >
          <Camera className="h-3.5 w-3.5" /> Kamera ile tara
        </button>
        {lastScan && <span className="text-[11px] font-medium text-[#2f9e72]">Okundu: {lastScan}</span>}
      </div>

      {armed && (
        <p className="text-[11px] text-[#705a66]">
          Okuyucuyu ürünün barkoduna tutun — cihaz kodu yazıp Enter gönderdiğinde alan otomatik dolar.
        </p>
      )}

      <AnimatePresence>{camOpen && <CameraScanner onClose={() => setCamOpen(false)} onResult={handleCameraResult} />}</AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------- kamera ---

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function CameraScanner({ onClose, onResult }: { onClose: () => void; onResult: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    let frame = 0

    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      if (!Detector) {
        setError('Bu tarayıcı kamera ile barkod okumayı desteklemiyor. USB/Bluetooth barkod okuyucu kullanabilir ya da kodu elle yazabilirsiniz.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) return
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const detector = new Detector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'],
        })
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const hit = codes.find((c) => c.rawValue?.trim())
            if (hit) {
              onResult(hit.rawValue.trim())
              return
            }
          } catch {
            // tek kare hatası taramayı durdurmasın
          }
          frame = requestAnimationFrame(() => void tick())
        }
        void tick()
      } catch {
        setError('Kameraya erişilemedi. Tarayıcı izinlerini kontrol edin.')
      }
    }
    void start()

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])

  return (
<ModalPortal>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[155] grid place-items-center bg-black/70 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-[22px] border border-[#efe1e7] bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#f2e6eb] px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-[#241923]">
            <Camera className="h-4 w-4 text-[#c85776]" /> Barkodu kameraya gösterin
          </span>
          <button type="button" onClick={onClose} aria-label="Kapat" className="grid h-7 w-7 place-items-center rounded-full border border-[#efe1e7] text-[#705a66] hover:text-[#c85776]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error ? (
          <div className="px-4 py-6 text-center text-[12px] text-[#705a66]">{error}</div>
        ) : (
          <div className="relative bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            <span className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-[#ef6088] shadow-[0_0_18px_rgba(239,96,136,0.9)]" />
          </div>
        )}
      </motion.div>
    </motion.div>
    </ModalPortal>
  )
}
