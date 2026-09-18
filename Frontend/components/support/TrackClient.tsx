'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowRight, KeyRound, Loader2, Lock, Send, Ticket } from 'lucide-react'
import { replySupportTicket, trackSupportTicket, type SupportTicketDetail } from '@/lib/supportApi'
import { SupportThread, SupportTicketHeader } from './SupportThread'

/**
 * TALEP TAKİP — oturumsuz görüntüleme ve yanıtlama.
 *
 * <p>
 * Kod ve jeton adres satırından okunur (<c>?kod=…&amp;jeton=…</c>). İkisi de varsa talep
 * kendiliğinden yüklenir; yoksa kullanıcıdan istenir — e-postadaki bağlantıyı kaybeden biri
 * kodunu elle yazıp devam edebilmeli, ama jeton olmadan hiçbir talep açılamaz (kod sıralıdır
 * ve tek başına yeterli olsaydı talepler taranarak okunabilirdi).
 * </p>
 *
 * <p>
 * <b>KAPALI TALEBE YANIT KUTUSU GÖSTERİLMEZ.</b> Sunucu da reddeder; ekranda göstermek
 * kullanıcıya yazdırıp sonra hata vermek olurdu. Çözüldü durumundaki talep yanıt KABUL EDER
 * ve yanıt onu yeniden açar — bu ekranda açıkça yazar.
 * </p>
 */
export default function TrackClient() {
  const params = useSearchParams()
  const urlCode = params.get('kod') ?? ''
  const urlToken = params.get('jeton') ?? ''

  const [code, setCode] = useState(urlCode)
  const [token, setToken] = useState(urlToken)
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async (c: string, t: string): Promise<void> => {
    setError('')
    setLoading(true)
    try {
      setTicket(await trackSupportTicket(c.trim(), t.trim()))
    } catch (err) {
      setTicket(null)
      setError(err instanceof Error ? err.message : 'Talep bulunamadı.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Adres satırında ikisi de varsa kendiliğinden yükle — kullanıcı e-postadaki bağlantıya
  // tıklayıp bir de "Getir" demek zorunda kalmasın. Bir kez: sonraki denemeler formdan gelir.
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current || !urlCode || !urlToken) return
    autoLoaded.current = true
    void load(urlCode, urlToken)
  }, [urlCode, urlToken, load])

  const submitLookup = (e: FormEvent): void => {
    e.preventDefault()
    if (!code.trim() || !token.trim()) {
      setError('Takip kodu ve erişim anahtarının ikisi de gerekir.')
      return
    }
    void load(code, token)
  }

  const submitReply = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (reply.trim().length < 2) return
    setSending(true)
    setError('')
    try {
      setTicket(await replySupportTicket(code.trim(), token.trim(), reply.trim()))
      setReply('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yanıtınız gönderilemedi.')
    } finally {
      setSending(false)
    }
  }

  // ---------------------------------------------------------------- ARAMA FORMU
  if (!ticket) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="material-light material-thick mx-auto max-w-[540px] rounded-[26px] p-7 sm:p-9"
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#FFF0F5] text-[#EF6F94]">
          <Ticket className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[#352432]">Talebinizi görüntüleyin</h1>
        <p className="on-material mt-2 text-[14px] leading-relaxed text-[#5A4752]">
          Talep oluştururken verdiğimiz takip kodunu ve erişim anahtarını girin. İkisi de
          e-postanızdaki bağlantının içinde yer alır.
        </p>

        <form onSubmit={submitLookup} className="mt-6">
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9A7386]" htmlFor="trk-code">
            Takip kodu
          </label>
          <div className="flex items-center gap-3 rounded-2xl border border-[#EEDCE4] bg-white px-4 transition-colors focus-within:border-[#EF6F94]">
            <Ticket className="h-4 w-4 shrink-0 text-[#C85776]/70" strokeWidth={1.7} />
            <input
              id="trk-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="DST-26-0042"
              className="min-h-12 w-full bg-transparent font-mono text-[14px] uppercase tracking-[0.04em] text-[#352432] outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-[#B29AA5]"
            />
          </div>

          <label className="mb-2 mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9A7386]" htmlFor="trk-token">
            Erişim anahtarı
          </label>
          <div className="flex items-center gap-3 rounded-2xl border border-[#EEDCE4] bg-white px-4 transition-colors focus-within:border-[#EF6F94]">
            <KeyRound className="h-4 w-4 shrink-0 text-[#C85776]/70" strokeWidth={1.7} />
            <input
              id="trk-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="E-postanızdaki bağlantıda yer alır"
              className="min-h-12 w-full bg-transparent text-[13px] text-[#352432] outline-none placeholder:text-[#B29AA5]"
            />
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[12.5px] leading-relaxed text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#E798B4] via-[#D4789A] to-[#B75A7E] text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? 'Aranıyor' : 'Talebi getir'}
          </button>
        </form>

        <p className="mt-5 text-center text-[12.5px] text-[#7B6470]">
          Bağlantınızı kaybettiniz mi?{' '}
          <Link href="/destek#talep" className="font-semibold text-[#C85776] hover:underline">
            Yeni talep oluşturun
          </Link>
        </p>
      </motion.div>
    )
  }

  // ---------------------------------------------------------------- TALEP AYRINTISI
  const closed = ticket.status === 4

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="material-light material-thick rounded-[26px] p-7 sm:p-9"
    >
      <SupportTicketHeader ticket={ticket} />

      <div className="mt-6">
        <SupportThread messages={ticket.messages} />
      </div>

      {closed ? (
        <div className="mt-7 flex items-start gap-2.5 rounded-2xl border border-[#E8E8EC] bg-[#F7F6F6] px-4 py-3.5 text-[12.5px] leading-relaxed text-[#5A4752]">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#9A8593]" />
          <span>
            Bu talep kapatıldı. Konuyla ilgili yeni bir sorunuz varsa{' '}
            <Link href="/destek#talep" className="font-semibold text-[#C85776] hover:underline">
              yeni bir talep oluşturun
            </Link>
            .
          </span>
        </div>
      ) : (
        <form onSubmit={submitReply} className="mt-7 border-t border-[#EEDCE4] pt-6">
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9A7386]" htmlFor="trk-reply">
            Yanıt yazın
          </label>
          <textarea
            id="trk-reply"
            rows={4}
            maxLength={4000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Eklemek istediğiniz bilgi ya da sorunuz…"
            className="w-full resize-y rounded-2xl border border-[#EEDCE4] bg-white px-4 py-3.5 text-[14px] leading-relaxed text-[#352432] outline-none transition-colors placeholder:text-[#B29AA5] focus:border-[#EF6F94]"
          />

          {ticket.status === 3 && (
            <p className="mt-2 text-[12px] leading-relaxed text-[#7B6470]">
              Bu talep çözüldü olarak işaretlendi. Sorun devam ediyorsa yazmanız yeterli — talep
              yeniden açılır.
            </p>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[12.5px] leading-relaxed text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={sending || reply.trim().length < 2}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#C85776] px-6 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Gönder
          </button>
        </form>
      )}
    </motion.div>
  )
}
