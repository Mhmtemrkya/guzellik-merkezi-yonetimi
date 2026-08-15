'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Gift, Loader2 } from 'lucide-react'
import { getPublicGiftCard, type PublicGiftCard } from '@/lib/publicSalonApi'

/**
 * Herkese açık HEDİYE KARTI DOĞRULAMA sayfası — karttaki QR'ın hedefi.
 *
 * Müşteri kartı telefonuyla okuttuğunda kartın gerçek olup olmadığını, kalan bakiyesini ve
 * geçerlilik süresini burada görür; giriş yapması beklenmez. Kurum anahtarı adresin parçasıdır
 * çünkü kodlar yalnız kurum içinde benzersizdir.
 */

function fmt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function money(v: number): string {
  return `₺${Math.round(v).toLocaleString('tr-TR')}`
}

export default function PublicGiftCardPage({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = use(params)
  const [card, setCard] = useState<PublicGiftCard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  /**
   * ERİŞİM HATASI ≠ KART YOK. Ağ kesintisi, 429 ya da 5xx durumunda "bu kart bulunamadı" demek
   * müşteriye elindeki kartın SAHTE olduğunu söylemektir. İki durum ayrı gösterilir.
   */
  const [unreachable, setUnreachable] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    setUnreachable(false)
    let alive = true
    getPublicGiftCard(slug, code)
      .then((c) => { if (alive) setCard(c) })
      .catch((e) => {
        if (!alive) return
        const message = e instanceof Error ? e.message : ''
        // "Bulunamadı" sunucunun kesin cevabıdır; gerisi ulaşılamama sayılır.
        const notFound = /bulunamad/i.test(message)
        setUnreachable(!notFound)
        setError(notFound ? message : 'Kart bilgisi şu an alınamıyor.')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug, code])

  useEffect(() => load(), [load])

  const from = fmt(card?.validFromUtc ?? null)
  const until = fmt(card?.validUntilUtc ?? null)
  const validText = from && until ? `${from} – ${until}` : until ? `${until} tarihine kadar` : from ? `${from} tarihinden itibaren` : 'Süresiz'
  const amountLabel = card?.kind === 'StoredValue' ? 'Kalan bakiye' : 'İndirim'
  const amountText = card ? (card.kind === 'Percentage' ? `%${card.amount}` : money(card.amount)) : '—'

  return (
    <main className="min-h-dvh bg-[#fff8fa] px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white shadow-[0_28px_70px_-46px_rgba(120,71,88,0.6)]">
          <header className="flex items-center gap-3 border-b border-[#f2e6eb] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#A5556E] text-white">
              <Gift className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A5556E]">Hediye kartı</div>
              <div className="truncate font-display text-[17px] font-bold text-[#2f2230]">
                {card?.salonName || (loading ? 'Yükleniyor…' : 'Hediye Kartı')}
              </div>
            </div>
          </header>

          <div className="px-5 py-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#74616A]">
                <Loader2 className="h-4 w-4 animate-spin" /> Kart doğrulanıyor…
              </div>
            ) : error || !card ? (
              /* BULUNAMADI ≠ GEÇERSİZ ≠ ULAŞILAMADI — üçü ayrı cümle hak eder. */
              <div className="rounded-[16px] border border-dashed border-[#e7c7d4] bg-[#fffafc] px-4 py-8 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#FCE7EC] text-[#A32347]">
                  <AlertTriangle className="h-6 w-6" />
                </span>
                <p className="mt-3 text-[14px] font-semibold text-[#2f2230]">
                  {unreachable ? 'Kart bilgisi alınamadı' : 'Bu kart bulunamadı'}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[#74616A]">
                  {unreachable
                    ? 'Bağlantı sorunu olabilir. Kartınız geçersiz demek DEĞİLDİR; birazdan tekrar deneyin.'
                    : 'Adres yanlış olabilir ya da kart kaldırılmış olabilir. Kartı aldığınız işletmeyle iletişime geçin.'}
                </p>
                {unreachable && (
                  <button
                    type="button"
                    onClick={load}
                    className="mt-3 rounded-[11px] border border-[#EAD8DF] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#A5556E]"
                  >
                    Tekrar dene
                  </button>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3 ${
                    card.isValid
                      ? 'border-[#8ED6B4] bg-[#DFF3EA] text-[#15694A]'
                      : 'border-[#F0AFBF] bg-[#FCE7EC] text-[#A32347]'
                  }`}
                >
                  {card.isValid ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold">{card.isValid ? 'Kart geçerli' : 'Kart kullanılamıyor'}</div>
                    {!card.isValid && card.invalidReason && (
                      <div className="mt-0.5 text-[12px] leading-snug">{card.invalidReason}</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-[16px] border border-[#EAD8DF] bg-[#FBFAFA] px-4 py-4">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#74616A]">{amountLabel}</div>
                  <div className="mt-0.5 font-display text-[34px] font-bold leading-none tracking-tight text-[#2A2027]">
                    {amountText}
                  </div>
                </div>

                <dl className="mt-4 divide-y divide-[#F1E7EB]">
                  <Row label="Kart kodu" value={card.code} mono />
                  <Row label="Geçerlilik" value={validText} />
                  <Row label="Kapsam" value={card.scopeLabel || 'Tüm hizmetler'} />
                  <Row label="İşletme" value={card.salonName} />
                </dl>

                <p className="mt-5 text-center text-[11px] leading-relaxed text-[#74616A]">
                  Bu sayfa kartın anlık durumunu gösterir. Kullanım, işletmede kod okutularak yapılır.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Kontrast WCAG AA (4.5:1): önceki #9d8792 beyaz üstünde 3.18:1 ile altındaydı. */}
        <p className="mt-4 text-center text-[11px] text-[#6E5A64]">Güzellik Merkezi Yönetim Sistemi</p>
      </div>
    </main>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[12px] text-[#74616A]">{label}</dt>
      <dd className={`min-w-0 text-right text-[13px] font-semibold text-[#2A2027] ${mono ? 'tracking-wide' : ''}`}>{value}</dd>
    </div>
  )
}
