'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, Clock, Loader2, ShieldCheck, Sparkles, Star } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'

// Backend UTC zaman damgasını bazen 'Z' olmadan gönderiyor; yerel saat sanılmasın diye UTC olarak çöz.
function utcMillis(s: string): number {
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s)
  return new Date(hasTz ? s : `${s}Z`).getTime()
}

interface PublicRating {
  status: 'Pending' | 'Submitted' | 'Expired'
  staffName: string
  serviceName?: string | null
  businessName?: string | null
  maskedPhone: string
  expiresAtUtc: string
  stars?: number | null
}

const STAR_LABELS = ['', 'Kötü', 'İdare eder', 'İyi', 'Çok iyi', 'Mükemmel']

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#fbe4ec] px-4 py-10 text-[#4a2f3c]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_15%_-12%,rgba(255,226,237,0.95),transparent_60%),radial-gradient(820px_560px_at_88%_115%,rgba(248,206,221,0.85),transparent_58%)]" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px] rounded-[28px] border border-[#f6e2e9] bg-white/95 p-7 shadow-[0_44px_120px_-50px_rgba(180,110,140,0.5)]"
      >
        {children}
      </motion.div>
    </main>
  )
}

export default function RatePage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token || '')

  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<PublicRating | null>(null)
  const [loadError, setLoadError] = useState('')
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const [remaining, setRemaining] = useState('')
  const [expired, setExpired] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!token) return
    setLoading(true)
    setLoadError('')
    try {
      const data = await adminApi.publicRating<PublicRating>(token)
      setInfo(data)
      if (data.status === 'Submitted') setDone(data.stars ?? null)
      if (data.status === 'Expired') setExpired(true)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Puanlama bağlantısı bulunamadı.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!info || info.status !== 'Pending') return
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

  const submit = async (): Promise<void> => {
    setSubmitError('')
    if (stars < 1) { setSubmitError('Lütfen 1-5 arasında yıldız seçin.'); return }
    if (phone.replace(/\D/g, '').length < 10) { setSubmitError('Telefon numaranızı eksiksiz girin.'); return }
    setSubmitting(true)
    try {
      const data = await adminApi.submitRating<PublicRating>(token, { phone, stars, comment: comment || null })
      setDone(data.stars ?? stars)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Puan gönderilemedi.'
      setSubmitError(msg)
      if (/süre/i.test(msg)) setExpired(true)
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Durum ekranları ----
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#c85776]" />
          <div className="text-[13px] text-[#9a8791]">Yükleniyor…</div>
        </div>
      </Shell>
    )
  }

  if (loadError || !info) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-500"><Clock className="h-6 w-6" /></span>
          <h1 className="font-display text-xl tracking-tight text-[#4a2f3c]">Bağlantı bulunamadı</h1>
          <p className="max-w-xs text-[13px] leading-relaxed text-[#9a8791]">{loadError || 'Bu puanlama bağlantısı geçersiz.'}</p>
        </div>
      </Shell>
    )
  }

  if (done !== null) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-500"
          >
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </motion.span>
          <h1 className="font-display text-2xl tracking-tight text-[#4a2f3c]">Teşekkürler!</h1>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className="h-6 w-6" style={{ fill: i <= (done || 0) ? '#f4b73e' : 'transparent', color: i <= (done || 0) ? '#f4b73e' : '#e3cdd6' }} />
            ))}
          </div>
          <p className="max-w-xs text-[13px] leading-relaxed text-[#9a8791]">
            {info.staffName} için puanınız kaydedildi. Değerli geri bildiriminiz için teşekkür ederiz.
          </p>
        </div>
      </Shell>
    )
  }

  if (expired) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-500"><Clock className="h-6 w-6" /></span>
          <h1 className="font-display text-xl tracking-tight text-[#4a2f3c]">Süreniz doldu</h1>
          <p className="max-w-xs text-[13px] leading-relaxed text-[#9a8791]">
            Bu puanlama bağlantısının süresi dolmuştur. Puanlama, işlem bittikten sonra yalnızca 15 dakika geçerlidir.
          </p>
        </div>
      </Shell>
    )
  }

  // ---- Puanlama formu (Pending) ----
  const shown = hover || stars
  return (
    <Shell>
      <div className="text-center">
        {info.businessName && (
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#c79aab]">{info.businessName}</div>
        )}
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#dd7e9d]">
          <Sparkles className="h-3.5 w-3.5" /> Deneyiminizi puanlayın
        </div>
        <h1 className="mt-2 font-display text-[26px] leading-tight tracking-tight text-[#4a2f3c]">{info.staffName}</h1>
        {info.serviceName && <div className="mt-1 text-[12.5px] text-[#9a8791]">{info.serviceName}</div>}
      </div>

      {/* Yıldızlar */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i} yıldız`}
              onMouseEnter={() => setHover(i)}
              onClick={() => setStars(i)}
              className="transition-transform hover:scale-110"
            >
              <Star
                className="h-10 w-10"
                strokeWidth={1.5}
                style={{ fill: i <= shown ? '#f4b73e' : 'transparent', color: i <= shown ? '#f4b73e' : '#e3cdd6' }}
              />
            </button>
          ))}
        </div>
        <div className="h-4 text-[12px] font-medium text-[#c85776]">{shown ? STAR_LABELS[shown] : ''}</div>
      </div>

      {/* Telefon doğrulama */}
      <div className="mt-4">
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a4909a]">
          Telefon numaranız
        </label>
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={info.maskedPhone}
          className="min-h-[50px] w-full rounded-[14px] border border-[#f1d7df] bg-white px-4 text-[14px] text-[#4a2f3c] outline-none transition-all placeholder:text-[#cbb7c0] focus:border-[#e89bb4] focus:shadow-[0_0_0_4px_rgba(232,155,180,0.16)]"
        />
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#9a8791]">
          <ShieldCheck className="h-3 w-3 text-[#c85776]/70" /> Randevuda kullandığınız numarayı girin — kimliğiniz doğrulanır.
        </p>
      </div>

      {/* Yorum (opsiyonel) */}
      <div className="mt-3">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Eklemek istediğiniz bir not (opsiyonel)"
          className="w-full resize-none rounded-[14px] border border-[#f1d7df] bg-white px-4 py-3 text-[13px] text-[#4a2f3c] outline-none transition-all placeholder:text-[#cbb7c0] focus:border-[#e89bb4] focus:shadow-[0_0_0_4px_rgba(232,155,180,0.16)]"
        />
      </div>

      {submitError && (
        <div className="mt-3 rounded-[12px] border border-[#f3c6cf] bg-[#fdebef] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#c0506c]">
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f4a9c0] via-[#ec84a4] to-[#e06a90] py-3.5 text-[13px] font-semibold text-white shadow-[0_20px_44px_-18px_rgba(224,106,144,0.85)] transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" style={{ fill: '#fff' }} />}
        {submitting ? 'Gönderiliyor…' : 'Puanı Gönder'}
      </button>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-[#9a8791]">
        <Clock className="h-3 w-3 text-[#c85776]/70" /> Kalan süre: <span className="font-mono font-medium text-[#c85776]">{remaining || '15:00'}</span>
      </div>
    </Shell>
  )
}
