'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Check, Keyboard, Loader2, ScanLine, X } from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'

/**
 * HEDİYE KARTI QR OKUYUCU — kartı bir müşteriye bağlamak için.
 *
 * Kartın üzerindeki QR bir ADRES kodlar (`/hediye-kart/{slug}/{KOD}`), çıplak kod değil:
 * müşteri okutunca kartın durumunu görebilsin diye. Eşleştirme için bize gereken KODDUR,
 * bu yüzden okunan değerden kod ayıklanır (bkz. `extractCode`). Elle giriş de kabul edilir —
 * kamera yoksa ya da QR yıpranmışsa iş durmasın.
 */

/** Okunan QR'dan çıkan kart kimliği: kod + (adresten geldiyse) kurum anahtarı. */
export interface ScannedCard {
  code: string
  /** Adresteki kurum anahtarı; çıplak kod okunduysa null. */
  slug: string | null
}

/**
 * Okunan QR'dan kart kimliğini çıkarır.
 * Kabul edilenler: tam adres (`https://.../hediye-kart/slug/HD-XXXX`), göreli yol ve çıplak kod.
 *
 * SLUG ATILMAZ. Önceden yalnız kod alınıyordu; BAŞKA salonun QR'ı okutulduğunda kod bu kurumda
 * da varsa (ör. "VIP" gibi kısa kodlar) istek sessizce KENDİ kurumumuzun aynı kodlu kartına
 * yazıyordu — somut bir yanlış hedefe yazma. Kurum anahtarı taşınır ve çağıran, kartın bu
 * kuruma ait olduğunu doğrulayana kadar işlem yapmaz.
 */
export function extractScanned(raw: string): ScannedCard {
  const text = (raw || '').trim()
  if (!text) return { code: '', slug: null }
  const match = text.match(/hediye-kart\/([^/]+)\/([^/?#\s]+)/i)
  if (match?.[2]) {
    // BOZUK KAÇIŞ ÇÖKERTMEZ: "%" gibi yarım diziler decodeURIComponent'i fırlatır; ham değere düşülür.
    const safe = (value: string): string => {
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
    return { code: safe(match[2]).toUpperCase(), slug: safe(match[1]).toLowerCase() }
  }
  // Adres değilse çıplak kod kabul edilir (elle giriş / kod yazan basit QR).
  if (/^[A-Za-z0-9-]{4,40}$/.test(text)) return { code: text.toUpperCase(), slug: null }
  return { code: '', slug: null }
}

/** Geriye dönük yardımcı — yalnız kod isteyen çağrılar için. */
export function extractCode(raw: string): string {
  return extractScanned(raw).code
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

export default function GiftCardScanModal({
  open,
  onClose,
  onScanned,
  expectedSlug,
  title = 'Hediye kartı okut',
  hint,
  busy = false,
  error = '',
}: {
  open: boolean
  onClose: () => void
  /** Okunan/yazılan kart kodu (temizlenmiş). */
  onScanned: (code: string) => void
  /**
   * Bu kurumun herkese açık adres anahtarı. Okunan QR BAŞKA bir kuruma aitse işlem yapılmaz —
   * kod bu kurumda da bulunabilir ve yanlış karta yazılırdı.
   */
  expectedSlug?: string | null
  title?: string
  hint?: string
  busy?: boolean
  error?: string
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [camError, setCamError] = useState('')
  const [manual, setManual] = useState('')
  const [lastRead, setLastRead] = useState('')
  /** Okunan QR başka bir kuruma aitti. */
  const [foreign, setForeign] = useState(false)

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamOn(false)
  }, [])

  useEffect(() => {
    if (!open) { stopCam(); setManual(''); setLastRead(''); setCamError(''); setForeign(false) }
  }, [open, stopCam])

  // Modal kapanınca kamera MUTLAKA kapanmalı: açık kalan akış telefonun kamerasını
  // kilitli tutar ve pil yakar.
  useEffect(() => () => stopCam(), [stopCam])

  const startCam = useCallback(async () => {
    setCamError('')
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Detector) {
      setCamError('Bu tarayıcı kamerayla QR okumayı desteklemiyor. Kodu elle yazabilirsiniz.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setCamOn(true)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }
      const detector = new Detector({ formats: ['qr_code'] })
      const tick = async (): Promise<void> => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const found = await detector.detect(videoRef.current)
          const value = found[0]?.rawValue
          if (value) {
            const scanned = extractScanned(value)
            if (scanned.code) {
              // BAŞKA KURUMUN KARTI REDDEDİLİR (bkz. extractScanned).
              if (scanned.slug && expectedSlug && scanned.slug !== expectedSlug.toLowerCase()) {
                setForeign(true)
                stopCam()
                return
              }
              setForeign(false)
              setLastRead(scanned.code)
              stopCam()
              onScanned(scanned.code)
              return
            }
          }
        } catch {
          // tek kare hatası akışı durdurmaz
        }
        window.setTimeout(() => void tick(), 350)
      }
      void tick()
    } catch {
      setCamError('Kameraya erişilemedi. İzin verin ya da kodu elle yazın.')
      stopCam()
    }
  }, [onScanned, stopCam])

  if (!open) return null

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[155] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <button type="button" aria-label="Kapat" onClick={onClose} className="absolute inset-0 cursor-default bg-[#2a141f]/55 backdrop-blur-[3px]" />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto w-full max-w-[440px] overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-white shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4">
              <div className="min-w-0">
                <div className="font-display text-[16px] font-bold tracking-tight text-[#2A2027]">{title}</div>
                {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-[#74616A]">{hint}</div>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Kapat"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-3 p-5">
              {camOn ? (
                <div className="relative overflow-hidden rounded-[16px] border border-[#EAD8DF] bg-black">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video ref={videoRef} className="block h-[260px] w-full object-cover" playsInline muted />
                  <span className="pointer-events-none absolute inset-8 rounded-[14px] border-2 border-white/70" />
                  <button
                    type="button"
                    onClick={stopCam}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1.5 text-[11.5px] font-semibold text-[#2A2027]"
                  >
                    Kamerayı kapat
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void startCam()}
                  className="flex w-full items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-[#D9AEBE] bg-[#FFF9FB] px-4 py-8 text-[13px] font-semibold text-[#A5556E] transition-colors hover:border-[#BE7690] hover:bg-[#FBEAF0]"
                >
                  <Camera className="h-5 w-5" /> Kamerayla QR okut
                </button>
              )}

              {camError && (
                <p className="rounded-[11px] border border-[#EFC98B] bg-[#FDF3E2] px-3 py-2 text-[11.5px] font-medium text-[#8A5A11]">
                  {camError}
                </p>
              )}

              {/* Elle giriş — kamera yoksa ya da QR okunmuyorsa iş durmasın. */}
              <div className="rounded-[14px] border border-[#EAD8DF] bg-[#FBFAFA] p-3.5">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#74616A]">
                    <Keyboard className="h-3.5 w-3.5" /> Kart kodunu elle yaz
                  </span>
                  <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value.toUpperCase())}
                    placeholder="örn. HD-DZFDA5"
                    className="w-full rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] uppercase tracking-wide text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || extractScanned(manual).code.length === 0}
                  onClick={() => {
                    const scanned = extractScanned(manual)
                    if (scanned.slug && expectedSlug && scanned.slug !== expectedSlug.toLowerCase()) {
                      setForeign(true)
                      return
                    }
                    setForeign(false)
                    onScanned(scanned.code)
                  }}
                  className="mt-2.5 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[11px] bg-[#A5556E] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#8C4460] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Eşleştir
                </button>
              </div>

              {lastRead && !error && (
                <p className="flex items-center gap-1.5 rounded-[11px] border border-[#8ED6B4] bg-[#DFF3EA] px-3 py-2 text-[11.5px] font-medium text-[#15694A]">
                  <ScanLine className="h-3.5 w-3.5" /> Okundu: {lastRead}
                </p>
              )}
              {foreign && (
                <p className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[11.5px] font-medium text-[#A32347]">
                  Bu QR başka bir işletmeye ait bir hediye kartına ait. İşlem yapılmadı.
                </p>
              )}
              {error && (
                <p className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[11.5px] font-medium text-[#A32347]">
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  )
}
