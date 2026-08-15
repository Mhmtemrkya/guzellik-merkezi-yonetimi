'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GiftCard } from '@/lib/types'

/**
 * HEDİYE KARTI GÖRSELİ — basılı/dijital kart, gerçek boyutunda çizilir.
 *
 * NEDEN CANVAS: kart hem ekranda gösterilecek hem PNG olarak indirilip WhatsApp'tan
 * gönderilecek. Tek kaynak olsun diye tasarım tek yerde, `drawGiftCard` içinde çizilir;
 * önizleme de indirilen dosya da AYNI koddan çıkar (HTML'i ekran görüntüsüne çeviren bir
 * ara katman yok, dolayısıyla "ekranda başka, dosyada başka" durumu oluşamaz).
 *
 * ÖLÇEK: şablon 2479×825; çizim daima bu boyutta yapılır, ekranda CSS ile küçültülür.
 * Ekran boyutunda çizip büyütmek yazıları bulanıklaştırırdı.
 *
 * SABİT KATMANLAR KODDA: elimizdeki boş şablon yalnız pembe zemini ve alt bilgi şeridini
 * taşıyor; "HEDİYE KARTI" başlığı, "GEÇERLİLİK SÜRESİ"/"BAKİYE" etiketleri ve gövde metni
 * burada çizilir. Böylece kart tamamen veriye bağlıdır (kapsam metni değişince görsel de değişir).
 */

/** Şablonun gerçek pikselleri — tüm koordinatlar bu ölçekte. */
export const CARD_W = 2479
export const CARD_H = 825
const TEMPLATE_SRC = '/giftcard/gift-card-template.png'

/** Marka tonları (dolu örnekten alındı). */
const INK = '#3F3B3C'
const PINK_STRONG = '#D6537F'
const PINK_TITLE = '#E0698E'
const INK_SOFT = '#5A5658'

export interface GiftCardArtworkData {
  code: string
  /** Basılacak bakiye/değer metni (₺500 · %15 gibi) — tür farkını çağıran çözer. */
  amountText: string
  amountLabel: string
  validText: string
  scopeLabel: string
  recipientName: string
  salonName: string
  /** Kurum logosu (data URL). Yoksa kurum adı yazıyla çizilir. */
  logoDataUrl?: string | null
  /** QR'ın kodladığı adres — çıplak kod değil, doğrulama bağlantısı. */
  qrValue: string
}

/** Metni verilen genişliğe göre satırlara böler (canvas'ta otomatik sarma yoktur). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Kalın (vurgulu) parçalar içeren tek satırı çizer ve son x konumunu döndürür.
 * "geçerli **El ve Ayak Bakım** çekidir" gibi karma ağırlıklı satır için.
 */
function drawRuns(
  ctx: CanvasRenderingContext2D,
  runs: { text: string; bold?: boolean }[],
  x: number,
  y: number,
  size: number,
): number {
  let cursor = x
  for (const run of runs) {
    ctx.font = `${run.bold ? 800 : 500} ${size}px Manrope, Inter, sans-serif`
    ctx.fillText(run.text, cursor, y)
    cursor += ctx.measureText(run.text).width
  }
  return cursor
}

/** Bir görseli verilen kutuya, oranını bozmadan sığdırır (contain). */
function drawContained(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): void {
  if (!naturalW || !naturalH) return
  const scale = Math.min(boxW / naturalW, boxH / naturalH)
  const w = naturalW * scale
  const h = naturalH * scale
  ctx.drawImage(img, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Görsel yüklenemedi: ${src}`))
    img.src = src
  })
}

/**
 * Kartı verilen canvas'a çizer. QR ayrı bir canvas'tan kopyalanır (qrcode.react onu
 * bizim için üretir); yoksa QR alanı boş bırakılır — uydurma bir kare çizilmez.
 */
export async function drawGiftCard(
  canvas: HTMLCanvasElement,
  data: GiftCardArtworkData,
  qrSource: HTMLCanvasElement | null,
): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = CARD_W
  canvas.height = CARD_H

  // Yazı tipleri ÇİZİMDEN ÖNCE hazır olmalı: hazır değilse tarayıcı yedek fontla çizer
  // ve kart her yenilemede farklı görünür.
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await Promise.all([
        document.fonts.load('800 100px Manrope'),
        document.fonts.load('700 100px Manrope'),
        document.fonts.load('500 100px Manrope'),
      ])
    } catch {
      // font yüklenemezse yedek aileyle devam — çizim yine de yapılır
    }
  }

  const template = await loadImage(TEMPLATE_SRC)
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  ctx.drawImage(template, 0, 0, CARD_W, CARD_H)
  ctx.textBaseline = 'alphabetic'

  /* ---------------- SOL SÜTUN ---------------- */

  // Kurum logosu (yoksa kurum adı). Kutu: sol üst.
  const logoBox = { x: 150, y: 78, w: 640, h: 165 }
  if (data.logoDataUrl) {
    try {
      const logo = await loadImage(data.logoDataUrl)
      drawContained(ctx, logo, logo.naturalWidth, logo.naturalHeight, logoBox.x, logoBox.y, logoBox.w, logoBox.h)
    } catch {
      // logo bozuksa ada düş
      ctx.fillStyle = INK
      ctx.font = '800 54px Manrope, Inter, sans-serif'
      ctx.fillText(data.salonName.toLocaleUpperCase('tr'), logoBox.x, logoBox.y + 100)
    }
  } else {
    ctx.fillStyle = INK
    ctx.font = '800 54px Manrope, Inter, sans-serif'
    const name = data.salonName.toLocaleUpperCase('tr')
    const lines = wrapLines(ctx, name, logoBox.w)
    lines.slice(0, 2).forEach((line, i) => ctx.fillText(line, logoBox.x, logoBox.y + 78 + i * 62))
  }

  // "HEDİYE KARTI" — kartın imzası.
  ctx.fillStyle = PINK_TITLE
  ctx.font = '800 96px Manrope, Inter, sans-serif'
  ctx.fillText('HEDİYE KARTI', 130, 355)

  // Gövde: "Bu çek, <alıcı> size <salon>'nde geçerli <kapsam> çekidir."
  const bodySize = 34
  const bodyX = 130
  let bodyY = 445
  ctx.fillStyle = INK_SOFT
  // Referans tasarımdaki ferah dokuyu veren hafif harf aralığı (destekleyen tarayıcılarda).
  ctx.letterSpacing = '1.4px'
  // 1. satır — alıcı adı yoksa elle yazılsın diye noktalı boşluk kalır (basılı kart geleneği).
  drawRuns(
    ctx,
    [
      { text: 'Bu çek, ' },
      { text: data.recipientName || '..........', bold: Boolean(data.recipientName) },
      { text: ' size' },
    ],
    bodyX,
    bodyY,
    bodySize,
  )
  // 2.–3. satır — salon adı + kapsam. Uzun salon adı sarmalı, taşmamalı.
  bodyY += 46
  ctx.font = `500 ${bodySize}px Manrope, Inter, sans-serif`
  const salonLine = `${data.salonName}'nde geçerli`
  const salonLines = wrapLines(ctx, salonLine, 780)
  for (const line of salonLines) {
    ctx.font = `500 ${bodySize}px Manrope, Inter, sans-serif`
    ctx.fillText(line, bodyX, bodyY)
    bodyY += 46
  }
  drawRuns(
    ctx,
    [
      { text: data.scopeLabel || 'tüm hizmetlerde', bold: true },
      { text: ' çekidir.' },
    ],
    bodyX,
    bodyY,
    bodySize,
  )

  // Kod — kartın kimliği.
  ctx.fillStyle = INK_SOFT
  ctx.font = '600 36px Manrope, Inter, sans-serif'
  ctx.fillText(data.code, bodyX, bodyY + 70)
  ctx.letterSpacing = '0px'

  /* ---------------- SAĞ SÜTUN ---------------- */

  const rightX = 1250

  ctx.fillStyle = PINK_STRONG
  ctx.font = '800 46px Manrope, Inter, sans-serif'
  ctx.fillText('GEÇERLİLİK SÜRESİ', rightX, 268)

  ctx.fillStyle = INK
  ctx.font = '500 54px Manrope, Inter, sans-serif'
  ctx.fillText(data.validText, rightX, 352)

  ctx.fillStyle = PINK_STRONG
  ctx.font = '800 46px Manrope, Inter, sans-serif'
  ctx.fillText(data.amountLabel, rightX, 445)

  ctx.fillStyle = INK
  ctx.font = '600 62px Manrope, Inter, sans-serif'
  ctx.fillText(data.amountText, rightX, 528)

  /* ---------------- QR ---------------- */

  if (qrSource && qrSource.width > 0) {
    // Beyaz zemin YOK: şablonun bu köşesi zaten açık pembe, QR'ın sessiz bölgesi işlevini görüyor
    // (referans tasarım da kutusuz). Yumuşatma kapalı — ölçeklenen QR bulanıklaşırsa okunmaz.
    const qr = { x: 2082, y: 366, size: 268 }
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(qrSource, qr.x, qr.y, qr.size, qr.size)
    ctx.imageSmoothingEnabled = true
  }
}

/** Türe göre kartın basılacak veri kümesi. */
export function giftCardArtworkData(
  card: GiftCard,
  salonName: string,
  logoDataUrl: string | null | undefined,
  qrValue: string,
): GiftCardArtworkData {
  const fmtDate = (iso: string | null): string | null => {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  const from = fmtDate(card.validFrom)
  const until = fmtDate(card.validUntil)
  // Süre metni ELDEKİ VERİYE GÖRE kurulur; olmayan bir başlangıç uydurulmaz.
  const validText = from && until ? `${from}-${until}` : until ? `${until}'a kadar` : from ? `${from}'dan itibaren` : 'Süresiz'

  const money = (v: number): string => `₺${Math.round(v).toLocaleString('tr-TR')}`
  const amountText = card.kind === 'Percentage' ? `%${card.value}` : card.kind === 'StoredValue' ? money(card.balance) : money(card.value)
  const amountLabel = card.kind === 'StoredValue' ? 'BAKİYE' : 'İNDİRİM'

  return {
    code: card.code,
    amountText,
    amountLabel,
    validText,
    scopeLabel: card.scopeLabel,
    recipientName: card.recipientName,
    salonName,
    logoDataUrl,
    qrValue,
  }
}

/**
 * Kartı ekranda gösteren önizleme. Çizim gerçek boyutta yapılır, CSS ile ölçeklenir;
 * `onReady` ile çağıran aynı canvas'tan PNG üretebilir (indirme / WhatsApp gönderimi).
 */
export default function GiftCardArtwork({
  data,
  qrCanvas,
  className = '',
  onReady,
}: {
  data: GiftCardArtworkData
  /** qrcode.react'in ürettiği canvas — çizim ondan kopyalanır. */
  qrCanvas: HTMLCanvasElement | null
  className?: string
  onReady?: (canvas: HTMLCanvasElement) => void
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState('')

  const render = useCallback(async () => {
    const canvas = ref.current
    if (!canvas) return
    try {
      await drawGiftCard(canvas, data, qrCanvas)
      setError('')
      onReady?.(canvas)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kart çizilemedi.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data.code, data.amountText, data.amountLabel, data.validText, data.scopeLabel,
    data.recipientName, data.salonName, data.logoDataUrl, qrCanvas,
  ])

  useEffect(() => { void render() }, [render])

  return (
    <div className={`relative ${className}`}>
      <canvas ref={ref} className="block h-auto w-full rounded-[14px] shadow-[0_18px_44px_-30px_rgba(150,78,104,0.6)]" />
      {error && (
        <p className="mt-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  )
}
