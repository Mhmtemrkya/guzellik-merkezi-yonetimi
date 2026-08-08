'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { MonthCell } from '@/lib/accountGrouping'

/**
 * AYLIK TAKSİT TAKVİMİ — Excel'deki "aylık ödeme ızgarası"nın panel karşılığı.
 *
 * Sütunlar aylar (yıl sınırını geçince yıl etiketi yeniden yazılır), hücre rengi o ayın
 * durumunu söyler: yeşil ödendi · amber kısmi · kırmızı gecikmiş · nötr bekleyen.
 * Muhasebeci "hangi ay para geldi, hangi ay gelmedi" sorusunu tek bakışta yanıtlasın diye
 * tutarlar hücrenin İÇİNDE yazılır (tooltip'e saklanmaz — yazdırılan tabloda da okunmalı).
 *
 * RENK TEK BAŞINA ANLAM TAŞIMAZ: her hücrede durum harfi/işareti ve alt satırda tutar var
 * (renk körlüğü + siyah-beyaz çıktı). Şerit yatay kaydırılır ve "bugün" sütunu açılışta
 * görünür konuma getirilir.
 */

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

const CELL_STYLE: Record<MonthCell['status'], { box: string; chip: string; label: string; mark: string }> = {
  paid: {
    box: 'border-emerald-300 bg-emerald-50',
    chip: 'text-emerald-800',
    label: 'Ödendi',
    mark: '✓',
  },
  partial: {
    box: 'border-amber-300 bg-amber-50',
    chip: 'text-amber-900',
    label: 'Kısmi',
    mark: '◐',
  },
  overdue: {
    box: 'border-rose-300 bg-rose-50',
    chip: 'text-rose-800',
    label: 'Gecikmiş',
    mark: '!',
  },
  upcoming: {
    box: 'border-[#e3d2da] bg-white',
    chip: 'text-[#4a3a44]',
    label: 'Bekleyen',
    mark: '·',
  },
  none: {
    box: 'border-dashed border-[#ecdfe5] bg-[#fcfafb]',
    chip: 'text-[#a3908f]',
    label: 'Taksit yok',
    mark: '–',
  },
}

export default function PaymentScheduleGrid({
  cells,
  todayKey,
}: {
  cells: MonthCell[]
  /** `YYYY-MM` — "bugün" sütununu vurgulamak ve oraya kaydırmak için. */
  todayKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const todayRef = useRef<HTMLDivElement | null>(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  // Açılışta "bugün"e kaydır: 24 aylık planda kullanıcı her seferinde elle sağa sürüklüyordu.
  useEffect(() => {
    const box = scrollRef.current
    const target = todayRef.current
    if (!box || !target) return
    box.scrollLeft = Math.max(0, target.offsetLeft - box.clientWidth / 2 + target.clientWidth / 2)
  }, [cells, todayKey])

  const syncArrows = (): void => {
    const box = scrollRef.current
    if (!box) return
    setCanScroll({
      left: box.scrollLeft > 4,
      right: box.scrollLeft + box.clientWidth < box.scrollWidth - 4,
    })
  }
  useEffect(syncArrows, [cells])

  const totals = useMemo(() => ({
    due: cells.reduce((s, c) => s + c.due, 0),
    paid: cells.reduce((s, c) => s + c.paid, 0),
    remaining: cells.reduce((s, c) => s + c.remaining, 0),
    overdue: cells.filter((c) => c.status === 'overdue').reduce((s, c) => s + c.remaining, 0),
  }), [cells])

  const nudge = (dir: -1 | 1): void => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' })
  }

  if (cells.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-8 text-center text-[12px] text-[#705a66]">
        Bu müşteride taksit planı yok — satışlar peşin.
      </div>
    )
  }

  return (
    <div>
      {/* Özet şeridi — KAPSAM AÇIKÇA YAZILI: bu rakamlar YALNIZ taksitleri sayar. Peşinat ve
          peşin satışlar taksit satırı üretmediğinden buraya girmez; üstteki "Tahsil Edilen"
          KPI'ı ise müşterinin TÜM tahsilatıdır. Etiketsiz bırakılınca iki rakam çelişiyormuş
          gibi okunuyordu (₺135 taksit ↔ ₺10.385 toplam). */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <SummaryChip label="Taksit planı" value={totals.due} tone="text-[#4a3a44] border-[#ead8df] bg-white" />
        <SummaryChip label="Taksitlerden tahsil" value={totals.paid} tone="text-emerald-800 border-emerald-200 bg-emerald-50" />
        <SummaryChip label="Kalan taksit" value={totals.remaining} tone="text-[#a3576f] border-[#efbfd0] bg-[#fff4f8]" />
        {totals.overdue > 0.005 && (
          <SummaryChip label="Gecikmiş" value={totals.overdue} tone="text-rose-800 border-rose-200 bg-rose-50" />
        )}
        <span className="ml-auto hidden items-center gap-2 text-[10px] text-[#705a66] sm:flex">
          <Legend swatch="bg-emerald-200 border-emerald-300" text="Ödendi" />
          <Legend swatch="bg-amber-200 border-amber-300" text="Kısmi" />
          <Legend swatch="bg-rose-200 border-rose-300" text="Gecikmiş" />
          <Legend swatch="bg-white border-[#e3d2da]" text="Bekleyen" />
        </span>
      </div>

      <div className="relative">
        {canScroll.left && <ScrollButton side="left" onClick={() => nudge(-1)} />}
        {canScroll.right && <ScrollButton side="right" onClick={() => nudge(1)} />}

        <div
          ref={scrollRef}
          onScroll={syncArrows}
          className="flex gap-1.5 overflow-x-auto pb-1.5"
          role="list"
          aria-label="Aylık taksit takvimi"
        >
          {cells.map((c, idx) => {
            const s = CELL_STYLE[c.status]
            const isToday = c.key === todayKey
            // Yıl etiketi yalnız ilk sütunda ve yıl değişiminde — 24 aylık planda "Oca" hangi
            // yılın ocağı sorusu ortaya çıkıyordu.
            const showYear = idx === 0 || c.year !== cells[idx - 1].year
            return (
              <div
                key={c.key}
                ref={isToday ? todayRef : undefined}
                role="listitem"
                title={`${MONTHS_SHORT[c.month - 1]} ${c.year} · ${s.label}${c.due > 0 ? ` · Planlanan ${formatTL(c.due)} · Tahsil ${formatTL(c.paid)} · Kalan ${formatTL(c.remaining)}` : ''}`}
                className={`relative w-[104px] shrink-0 rounded-[12px] border px-2 py-2 ${s.box} ${
                  isToday ? 'ring-2 ring-[#c85776] ring-offset-1' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[11px] font-bold text-[#352432]">
                    {MONTHS_SHORT[c.month - 1]}
                    {showYear && <span className="ml-1 text-[9px] font-semibold text-[#a3576f]">{c.year}</span>}
                  </span>
                  {/* Renkten BAĞIMSIZ durum işareti (renk körlüğü + s/b çıktı). */}
                  <span className={`text-[11px] font-black leading-none ${s.chip}`} aria-hidden>{s.mark}</span>
                </div>

                {c.due > 0 ? (
                  <>
                    <div className={`mt-1 font-display text-[14px] leading-none tabular-nums ${s.chip}`}>
                      {formatTL(Math.round(c.remaining > 0.005 ? c.remaining : c.due))}
                    </div>
                    <div className="mt-0.5 text-[9.5px] leading-tight text-[#705a66]">
                      {c.status === 'paid'
                        ? 'ödendi'
                        : c.status === 'partial'
                          ? `${formatTL(Math.round(c.paid))} ödendi`
                          : c.status === 'overdue'
                            ? 'gecikmiş'
                            : 'bekliyor'}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-[10px] leading-tight text-[#a3908f]">taksit yok</div>
                )}

                {isToday && (
                  <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-[#c85776] px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-white">
                    bu ay
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${tone}`}>
      {label}
      <b className="font-display text-[12px] tabular-nums">{formatTL(Math.round(value))}</b>
    </span>
  )
}

function Legend({ swatch, text }: { swatch: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-[3px] border ${swatch}`} />
      {text}
    </span>
  )
}

function ScrollButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Önceki aylar' : 'Sonraki aylar'}
      className={`absolute top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-[#ead8df] bg-white/95 text-[#a3576f] shadow-[0_6px_16px_-8px_rgba(150,78,104,0.7)] transition-colors hover:bg-[#fff1f6] ${
        side === 'left' ? '-left-2' : '-right-2'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
