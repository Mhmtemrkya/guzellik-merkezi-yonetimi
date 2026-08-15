'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeCanvas } from 'qrcode.react'
import { Check, Copy, Download, FileDown, Loader2, Printer, Send, X } from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import GiftCardArtwork, { giftCardArtworkData } from '@/components/dashboard/GiftCardArtwork'
import { publicWebBaseUrl } from '@/lib/publicWebUrl'
import type { GiftCard } from '@/lib/types'

/**
 * HEDİYE KARTINI PAYLAŞ — kartın basılabilir/gönderilebilir hâli.
 *
 * Kart burada canvas'ta çizilir; indirilen PNG ve WhatsApp'a giden görsel AYNI canvas'tan
 * üretilir, dolayısıyla önizlemede görülen ile gönderilen birebir aynıdır.
 */
export default function GiftCardShareModal({
  card,
  salonName,
  salonSlug,
  salonProfileFailed = false,
  logoDataUrl,
  open,
  onClose,
  onSendWhatsApp,
  defaultPhone = '',
}: {
  card: GiftCard | null
  salonName: string
  /** Kurumun herkese açık adres anahtarı — QR'ın hedefi buna dayanır. */
  salonSlug: string | null
  /** Profil ucu düştü mü — "adres tanımlı değil" ile "profil yüklenemedi" ayrı teşhistir. */
  salonProfileFailed?: boolean
  logoDataUrl: string | null
  open: boolean
  onClose: () => void
  /**
   * WhatsApp gönderimi. Verilmezse düğme çizilmez.
   * `pdfBase64` veri-URL önekiSİZ ham base64'tür (kart PDF'i).
   */
  /** `true` dönerse işlem ONAYA gönderilmiştir (gönderilmemiştir). */
  onSendWhatsApp?: (pdfBase64: string, phone: string) => Promise<boolean | void>
  /** Karta bağlı müşterinin kayıtlı numarası — biliniyorsa gönderim kutusuna ön-dolum gelir. */
  defaultPhone?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /**
   * QR canvas'ı CALLBACK REF ile alınır, `useRef` + efekt ile DEĞİL.
   *
   * Sebep: bu modal `ModalPortal` içinde yaşıyor ve portal ilk render'da `null` döndürüp
   * kendi efektinde bağlanıyor. Efektte "ref.current'ı oku" demek, QR canvas'ı henüz DOM'a
   * girmeden okumak demekti; değer null kalıyor, efekt bir daha çalışmadığı için kart
   * ÖMÜR BOYU QR'sız çiziliyordu. Callback ref tam bağlanma anında çağrılır.
   */
  const [qr, setQr] = useState<HTMLCanvasElement | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** Gönderim kutusu açık mı + alıcı numarası. */
  const [sendOpen, setSendOpen] = useState(false)
  const [phone, setPhone] = useState(defaultPhone)

  /**
   * QR'ın kodladığı adres. ÇIPLAK KOD DEĞİL: müşteri telefonuyla okuttuğunda anlamlı bir
   * sayfa açılmalı — kartın geçerliliği ve kalan bakiyesi orada görünür.
   */
  const qrValue = useMemo(() => {
    // HEDEF YAYIN ADRESİDİR, `window.location.origin` DEĞİL — gerekçe: lib/publicWebUrl.ts.
    const base = publicWebBaseUrl()
    // Kurum anahtarı ZORUNLU: kodlar yalnız kurum içinde benzersiz. Slug yoksa QR çizilmez
    // (aşağıda kullanıcıya söylenir) — yanlış kuruma götüren bir kare basmaktansa boş bırakılır.
    if (!salonSlug) return ''
    return `${base}/hediye-kart/${encodeURIComponent(salonSlug)}/${encodeURIComponent(card?.code ?? '')}`
  }, [card?.code, salonSlug])

  const data = useMemo(
    () => (card ? giftCardArtworkData(card, salonName, logoDataUrl, qrValue) : null),
    [card, salonName, logoDataUrl, qrValue],
  )

  useEffect(() => {
    if (!open) return
    setError('')
    setNotice('')
    setCopied(false)
    setSendOpen(false)
    setPhone(defaultPhone)
  }, [open, qrValue, defaultPhone])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !card || !data) return null

  const fileName = `hediye-karti-${card.code}.png`
  /** Karta müşteri bağlıysa numara zorunlu değil — sunucu kayıtlı numarayı kullanır. */
  const hasLinkedCustomer = Boolean(card.customerId)

  const download = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = fileName
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const print = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const win = window.open('', '_blank')
    if (!win) { setError('Yazdırma penceresi açılamadı — açılır pencere engelleyicisini kontrol edin.'); return }
    // Kart yatay ve geniş: sayfaya yatay sığdırılır.
    win.document.write(
      `<!doctype html><title>${fileName}</title>` +
      '<style>@page{size:landscape;margin:10mm}body{margin:0;display:grid;place-items:center}img{width:100%}</style>' +
      `<img src="${canvas.toDataURL('image/png')}" onload="window.print();window.close()">`,
    )
    win.document.close()
  }

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(card.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // pano izni yoksa sessiz geç — kod zaten ekranda seçilebilir
    }
  }

  /**
   * Kartı tek sayfalık PDF'e çevirir (ham base64 döner).
   *
   * SAYFA KARTIN ÖLÇÜSÜNDE: A4'e yerleştirip ortalamak, WhatsApp'ta kocaman beyaz boşluklu bir
   * belge gösterirdi. Sayfa kartın en-boy oranını birebir alır, görsel sayfayı tam doldurur.
   * jsPDF dinamik yüklenir — 300 KB'lik kütüphane yalnız gönderim/indirme anında iner.
   */
  const buildPdfBase64 = async (canvas: HTMLCanvasElement): Promise<string> => {
    const { jsPDF } = await import('jspdf')
    // mm cinsinden makul bir kart boyu (genişlik 210mm; yükseklik orandan).
    const widthMm = 210
    const heightMm = Math.round((canvas.height / canvas.width) * widthMm * 100) / 100
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] })
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
    // datauristring: "data:application/pdf;filename=...;base64,XXXX" → yalnız gövde alınır.
    return doc.output('datauristring').split(',')[1] ?? ''
  }

  const downloadPdf = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    setError('')
    try {
      const { jsPDF } = await import('jspdf')
      const widthMm = 210
      const heightMm = Math.round((canvas.height / canvas.width) * widthMm * 100) / 100
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] })
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
      doc.save(`hediye-karti-${card.code}.pdf`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF üretilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const sendWhatsApp = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas || !onSendWhatsApp) return
    const target = phone.trim()
    // Numara BOŞ BIRAKILABİLİR: kart bir müşteriye bağlıysa sunucu onun kayıtlı numarasını
    // kullanır (bkz. WhatsAppService.SendGiftCardAsync). Numara da yoksa sunucu açıkça reddeder.
    if (!target && !hasLinkedCustomer) { setError('Gönderilecek telefon numarasını yazın.'); return }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const pdfBase64 = await buildPdfBase64(canvas)
      const pending = await onSendWhatsApp(pdfBase64, target)
      setNotice(pending === true
        ? 'Gönderim ONAYA GÖNDERİLDİ. Yönetici onayladıktan sonra iletilecek.'
        : 'Hediye kartı WhatsApp\'tan gönderildi.')
      setSendOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[145] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button type="button" aria-label="Kapat" onClick={onClose} className="absolute inset-0 cursor-default bg-[#2a141f]/55 backdrop-blur-[3px]" />

          {/* QR ekranda görünmez; yalnız çizime kaynaklık eder. */}
          <div className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden>
            {/* SESSİZ BÖLGE ZORUNLU: QR standardı çevresinde 4 modül boşluk ister. marginSize={0}
                ile üretilen kod, kartın desenli pembe zemininde bazı okuyucularda hiç okunmuyordu —
                ve bu basılı kartta kalıcı bir kusur olurdu. */}
            {qrValue && <QRCodeCanvas ref={setQr} value={qrValue} size={530} level="M" marginSize={4} />}
          </div>

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${card.code} hediye kartı`}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto w-full max-w-[1100px] overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A5556E]">Hediye kartı</div>
                <div className="mt-0.5 font-display text-[19px] font-bold tracking-tight text-[#2A2027]">{card.code}</div>
                <div className="mt-0.5 text-[11.5px] text-[#74616A]">
                  Kartı indirip yazdırabilir ya da dijital olarak paylaşabilirsiniz.
                </div>
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

            <div className="bg-[#FBFAFA] p-4 sm:p-5">
              <GiftCardArtwork
                data={data}
                qrCanvas={qr}
                onReady={(canvas) => { canvasRef.current = canvas }}
              />

              {!qrValue && (
                <p className="mt-3 rounded-[11px] border border-[#EFC98B] bg-[#FDF3E2] px-3 py-2 text-[12px] font-medium text-[#8A5A11]">
                  {salonProfileFailed
                    ? 'Kurum profili yüklenemediği için karta QR basılamadı. Bu bir ayar eksiği değil, geçici bir erişim sorunudur — sayfayı yenileyip tekrar deneyin (kartı QR olmadan yazdırmayın, QR sonradan eklenemez).'
                    : 'Kurumun herkese açık adresi tanımlı olmadığı için karta QR basılamadı. Salon Profili sayfasından kurum adresini tanımlayınca QR otomatik gelir.'}
                </p>
              )}
              {error && (
                <p className="mt-3 rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]">
                  {error}
                </p>
              )}
              {notice && (
                <p className="mt-3 rounded-[11px] border border-[#8ED6B4] bg-[#DFF3EA] px-3 py-2 text-[12px] font-medium text-[#15694A]">
                  {notice}
                </p>
              )}

              {/* Gönderim kutusu — numara sorulmadan kontör harcanmaz. */}
              {sendOpen && onSendWhatsApp && (
                <div className="mt-3 rounded-[14px] border border-[#EAD8DF] bg-white p-3.5">
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">
                      Alıcı telefon numarası{hasLinkedCustomer ? ' (boş bırakılabilir)' : ''}
                    </span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="05xx xxx xx xx"
                      className="w-full rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]"
                    />
                  </label>
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSendOpen(false)}
                      className="inline-flex min-h-9 items-center rounded-[11px] border border-[#EAD8DF] bg-white px-3 text-[12px] font-semibold text-[#5A4B53]"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void sendWhatsApp()}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[11px] bg-[#1E8C60] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#15694A] disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gönder
                    </button>
                  </div>
                  <p className="mt-2 text-[10.5px] leading-snug text-[#74616A]">
                    {hasLinkedCustomer && !phone.trim()
                      ? 'Boş bırakırsanız karta bağlı müşterinin kayıtlı numarasına gönderilir. '
                      : ''}
                    Kart PDF olarak gönderilir ve kurumunuzun WhatsApp kontöründen düşer.
                  </p>
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#EAD8DF] bg-white px-5 py-3.5">
              <button
                type="button"
                onClick={() => void copyCode()}
                className="mr-auto inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Kod kopyalandı' : 'Kodu kopyala'}
              </button>
              <button
                type="button"
                onClick={print}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
              >
                <Printer className="h-4 w-4" /> Yazdır
              </button>
              <button
                type="button"
                onClick={download}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
              >
                <Download className="h-4 w-4" /> PNG
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void downloadPdf()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-60"
              >
                <FileDown className="h-4 w-4" /> PDF indir
              </button>
              {onSendWhatsApp && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setError(''); setNotice(''); setSendOpen((v) => !v) }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-[#1E8C60] px-4 text-[12px] font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[#15694A] disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <Send className="h-4 w-4" /> WhatsApp'tan gönder
                </button>
              )}
            </footer>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  )
}
