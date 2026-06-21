'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Clock, Copy, QrCode, Star } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

// Backend UTC zaman damgasını bazen 'Z' olmadan gönderiyor; yerel saat sanılmasın diye UTC olarak çöz.
function utcMillis(s: string): number {
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s)
  return new Date(hasTz ? s : `${s}Z`).getTime()
}

export interface RatingTokenInfo {
  token: string
  expiresAtUtc: string
  maskedPhone: string
  staffName: string
  serviceName?: string | null
  linkLifetimeMinutes?: number
}

/**
 * Randevu "tamamlandı" işaretlenince açılan QR modalı. Müşteri bu kodu okutup kendi telefonunu
 * girerek personeli puanlar. Link 15 dk geçerlidir; süre dolunca puanlama sayfası "süresi bitti" der.
 */
export default function RatingQrModal({ info, onClose }: { info: RatingTokenInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [remaining, setRemaining] = useState('')
  const [expired, setExpired] = useState(false)

  const url = info && typeof window !== 'undefined' ? `${window.location.origin}/rate/${info.token}` : ''

  useEffect(() => {
    if (!info) return
    setExpired(false)
    const tick = (): void => {
      const ms = utcMillis(info.expiresAtUtc) - Date.now()
      if (ms <= 0) {
        setRemaining('00:00')
        setExpired(true)
        return
      }
      const m = Math.floor(ms / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setRemaining(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [info])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard erişimi yoksa sessiz geç */
    }
  }

  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="overflow-hidden rounded-[26px] border border-[#ead8df]/90 bg-white p-0 text-[#352432] shadow-[0_40px_120px_-50px_rgba(120,71,88,0.6)]"
        style={{ width: 'min(94vw, 420px)', maxWidth: 'min(94vw, 420px)' }}
      >
        <div className="relative p-6 text-center">
          <div className="flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/80">
            <QrCode className="h-3.5 w-3.5" /> Müşteri Puanlaması
          </div>
          <DialogTitle className="mt-2 font-display text-2xl tracking-tight">{info?.staffName}</DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-[#352432]/55">
            {info?.serviceName ? `${info.serviceName} · ` : ''}Müşteri bu kodu okutup telefonunu girerek puan verebilir.
          </DialogDescription>

          <div className="mx-auto mt-5 grid w-fit place-items-center rounded-[20px] border border-[#ead8df] bg-white p-4 shadow-[0_18px_40px_-28px_rgba(150,78,104,0.45)]">
            {url && (
              <QRCodeSVG
                value={url}
                size={188}
                level="M"
                fgColor={expired ? '#c9b3bd' : '#3a1a2a'}
                bgColor="#ffffff"
              />
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[12px]">
            <Star className="h-3.5 w-3.5 text-[#d8ad55]" />
            <span className="text-[#352432]/60">Müşteri no:</span>
            <span className="font-mono font-medium text-[#352432]">{info?.maskedPhone}</span>
          </div>

          <div
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ${
              expired ? 'bg-rose-50 text-rose-600' : 'bg-[#fff1f6] text-[#b14d6c]'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {expired ? 'Süre doldu — link geçersiz' : `Kalan süre: ${remaining}`}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-medium text-[#352432]/75 transition-colors hover:border-[#efbfd0] hover:text-[#352432]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Kopyalandı' : 'Linki kopyala'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[12px] bg-[#c85776] px-4 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Kapat
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
