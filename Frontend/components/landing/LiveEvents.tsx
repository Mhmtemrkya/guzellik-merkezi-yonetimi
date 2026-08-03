'use client'

import { useEffect, useState } from 'react'
import { BellRing, CalendarCheck, CreditCard, MessageCircle, Sparkles, type LucideIcon } from 'lucide-react'

/**
 * HERO'NUN CANLI KATMANI: ürünün gerçekten ürettiği olaylar, olurken.
 *
 * Süs değil — her kart panelde karşılığı olan bir olayı gösterir (randevu geldi, WhatsApp onayı
 * döndü, seans düştü, tahsilat işlendi). Ziyaretçi ürünün ne yaptığını okumadan görür.
 *
 * Kartlar sırayla girer, bir süre durur, sonra yerini bir sonrakine bırakır. Aynı anda en fazla
 * üç kart durur ki hero okunaklı kalsın.
 *
 * ERİŞİLEBİLİRLİK: katman tamamen dekoratiftir (`aria-hidden`) — aynı bilgi hero metninde ve
 * ürün turunda zaten yazılı. Hareket azaltma açıksa ilk üç kart sabit gösterilir.
 */

interface LiveEvent {
  icon: LucideIcon
  title: string
  body: string
  tone: 'rose' | 'emerald' | 'amber'
}

const EVENTS: LiveEvent[] = [
  { icon: CalendarCheck, title: 'Yeni randevu', body: 'Merve Ş. · 11:15 · Bölgesel incelme', tone: 'rose' },
  { icon: MessageCircle, title: 'WhatsApp onayı', body: '“Evet” yanıtı geldi — randevu onaylandı', tone: 'emerald' },
  { icon: Sparkles, title: 'Seans düştü', body: 'Lazer epilasyon · kalan 2 seans', tone: 'rose' },
  { icon: CreditCard, title: 'Tahsilat işlendi', body: '₺1.800 · kart · cariye yazıldı', tone: 'emerald' },
  { icon: BellRing, title: 'Boş slot doldu', body: '10:30 · bekleme listesinden', tone: 'amber' },
]

const TONE: Record<LiveEvent['tone'], { dot: string; icon: string }> = {
  rose: { dot: 'bg-[#EF6F94]', icon: 'bg-[#FFDCE8] text-[#8E3F5B]' },
  emerald: { dot: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-700' },
  amber: { dot: 'bg-amber-500', icon: 'bg-amber-50 text-amber-700' },
}

/** Aynı anda ekranda duran kart sayısı. */
const WINDOW = 3

export default function LiveEvents() {
  const [head, setHead] = useState(0)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setHead((h) => (h + 1) % EVENTS.length), 2600)
    return () => clearInterval(t)
  }, [reduced])

  // Pencere: baştan itibaren WINDOW kadar olay, listede dönerek.
  const visible = Array.from({ length: WINDOW }, (_, i) => {
    const index = (head + i) % EVENTS.length
    return { ...EVENTS[index], key: `${index}-${Math.floor((head + i) / EVENTS.length)}` }
  })

  return (
    <div aria-hidden className="pointer-events-none flex flex-col gap-2.5">
      {visible.map((e, i) => (
        <article
          key={e.key}
          className="flex items-center gap-2.5 rounded-[14px] border border-[#EEC9D7] bg-white/90 px-3 py-2.5 shadow-[0_18px_44px_-30px_rgba(150,78,104,0.6)] backdrop-blur-sm"
          style={{
            // Alttaki kartlar hafifçe küçülür ve soluklaşır → derinlik yanılsaması.
            transform: `scale(${1 - i * 0.04})`,
            opacity: 1 - i * 0.22,
            animation: reduced ? undefined : 'live-in 0.55s cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${TONE[e.tone].icon}`}>
            <e.icon className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[e.tone].dot}`} />
              <span className="truncate text-[12.5px] font-semibold text-[#352432]">{e.title}</span>
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-[#705A66]">{e.body}</span>
          </span>
        </article>
      ))}
    </div>
  )
}
