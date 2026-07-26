'use client'

import { use, useEffect, useState } from 'react'
import { Download, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { getPublicKvkkText, publicKvkkPdfUrl, type PublicKvkkContent } from '@/lib/publicSalonApi'

/**
 * Herkese açık KVKK aydınlatma metni sayfası.
 *
 * WhatsApp'tan gönderilen KVKK onay isteğindeki linkin hedefi budur: müşteri onay vermeden
 * önce metnin tamamını okuyabilmeli, bunun için giriş yapması beklenemez. Metin KURUMA
 * ÖZELDİR (Ayarlar'dan düzenlenen), aynı içerik PDF olarak da indirilebilir.
 */
export default function PublicKvkkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [content, setContent] = useState<PublicKvkkContent | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getPublicKvkkText(slug)
      .then((c) => { if (alive) setContent(c) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Metin yüklenemedi.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug])

  return (
    <main className="min-h-dvh bg-[#fff8fa] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="overflow-hidden rounded-[22px] border border-[#efe1e7] bg-white shadow-[0_28px_70px_-46px_rgba(120,71,88,0.6)]">
          <header className="flex flex-wrap items-center gap-3 border-b border-[#f2e6eb] bg-[#fffafc] px-5 py-4 sm:px-7">
            {content?.logoData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={content.logoData} alt={content.salonName} className="h-11 w-11 shrink-0 rounded-full border border-[#efbfd0] object-cover" />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#efbfd0] bg-[#fff1f6] text-[#c05277]">
                <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[17px] font-bold text-[#2f2230]">
                {content?.salonName || (loading ? 'Yükleniyor…' : 'KVKK Aydınlatma Metni')}
              </div>
              <div className="text-[11.5px] text-[#705a66]">Kişisel Verilerin Korunması Aydınlatma Metni ve Açık Rıza Beyanı</div>
            </div>
            {content && (
              <a
                href={publicKvkkPdfUrl(slug)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-[#c05277] px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2.2} /> PDF indir
              </a>
            )}
          </header>

          <div className="px-5 py-5 sm:px-7 sm:py-7">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-14 text-[13px] text-[#705a66]">
                <Loader2 className="h-4 w-4 animate-spin" /> Metin yükleniyor…
              </div>
            )}

            {!loading && error && (
              <div className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-6 text-center text-[13px] font-medium text-rose-700">
                {error}
              </div>
            )}

            {!loading && content && (
              <article className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#4a3a44]">
                {content.text}
              </article>
            )}
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t border-[#f2e6eb] bg-[#fffafc] px-5 py-3.5 text-[11.5px] text-[#705a66] sm:px-7">
            <FileText className="h-3.5 w-3.5 shrink-0 text-[#c05277]" strokeWidth={1.9} />
            <span>
              Onay vermek için WhatsApp mesajına <b className="text-[#4a3a44]">ONAYLIYORUM</b> yazmanız yeterlidir.
              Rızanızı dilediğiniz zaman geri çekebilirsiniz.
            </span>
          </footer>
        </div>
      </div>
    </main>
  )
}
