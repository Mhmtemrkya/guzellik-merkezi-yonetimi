'use client'

import { useEffect, useMemo, useRef } from 'react'
import { formatTL } from '@/lib/apiMappers'
import type { MonthCell } from '@/lib/accountGrouping'

/**
 * TAKSİT TAKVİMİ — Excel hücre mantığında, satır = vade.
 *
 * Beş sütun: <b>Tarih · Planlanan Miktar · Ödenen Taksit · Kalan · Durum</b>.
 * Renk kuralı: ödendi YEŞİL · bekliyor SARI · vadesi geçtiyse KIRMIZI.
 * RENK TEK BAŞINA ANLAM TAŞIMAZ — "Durum" sütununda yazılı karşılığı da vardır
 * (renk körlüğü + siyah-beyaz çıktı).
 *
 * DEVİR (düzensiz ödeme): ödenmeyen ayın borcu sonraki ayın taksitinin üstüne biner.
 * "Planlanan Miktar" hücresi PLAN tutarını yazar, altında devreden varsa "+X devir → Y"
 * satırıyla o ay gerçekten ödenmesi gereken tutarı gösterir. "Kalan" sütunu ise o ayın
 * borcundan geriye kalanı (yani bir sonraki aya devredecek tutarı) verir.
 * Hesabı `lib/accountGrouping` yapar (bkz. oradaki "DÜZENSİZ ÖDEME (DEVİR) KURALI").
 */

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** Satır zemini + durum rozeti. Sarı = bekleyen, yeşil = ödendi, kırmızı = gecikmiş. */
const CELL: Record<MonthCell['status'], { row: string; badge: string; label: string; mark: string }> = {
  paid: { row: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: 'Ödendi', mark: '✓' },
  partial: { row: 'bg-amber-50', badge: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Kısmi', mark: '◐' },
  overdue: { row: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800 border-rose-300', label: 'Gecikti', mark: '!' },
  upcoming: { row: 'bg-amber-50/60', badge: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Bekliyor', mark: '·' },
  none: { row: 'bg-white', badge: 'bg-[#f3e9ed] text-[#705a66] border-[#e3d2da]', label: '—', mark: '' },
}

function fmtDue(cell: MonthCell): string {
  const iso = cell.firstDueDate
  if (!iso) return `${MONTHS_SHORT[cell.month - 1]} ${cell.year}`
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

export default function PaymentScheduleGrid({
  cells,
  todayKey,
}: {
  cells: MonthCell[]
  /** `YYYY-MM` — içinde bulunulan ayın satırını vurgulamak ve oraya kaydırmak için. */
  todayKey: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const todayRef = useRef<HTMLTableRowElement | null>(null)

  // Vadesi olan aylar; taksitsiz aylar satır üretmez (sütun ızgarasında süreklilik için
  // duruyorlardı, satır tablosunda yalnız gürültü olurlardı).
  const rows = useMemo(() => cells.filter((c) => c.installmentCount > 0), [cells])

  // Açılışta "bu ay" satırına kaydır: 24 aylık planda kullanıcı her seferinde elle arıyordu.
  useEffect(() => {
    const box = scrollRef.current
    const target = todayRef.current
    if (!box || !target) return
    box.scrollTop = Math.max(0, target.offsetTop - box.clientHeight / 2 + target.clientHeight / 2)
  }, [rows, todayKey])

  const totals = useMemo(() => ({
    due: rows.reduce((s, c) => s + c.due, 0),
    paid: rows.reduce((s, c) => s + c.paid, 0),
    remaining: rows.reduce((s, c) => s + c.remaining, 0),
    overdue: rows.filter((c) => c.status === 'overdue').reduce((s, c) => s + c.remaining, 0),
  }), [rows])

  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-8 text-center text-[12px] text-[#705a66]">
        Bu müşteride taksit planı yok — satışlar peşin.
      </div>
    )
  }

  return (
    <div>
      {/* Özet şeridi — KAPSAM AÇIKÇA YAZILI: bu rakamlar YALNIZ taksitleri sayar. Peşinat ve
          peşin satışlar taksit satırı üretmediğinden buraya girmez. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <SummaryChip label="Taksit planı" value={totals.due} tone="text-[#4a3a44] border-[#ead8df] bg-white" />
        <SummaryChip label="Taksitlerden tahsil" value={totals.paid} tone="text-emerald-800 border-emerald-200 bg-emerald-50" />
        <SummaryChip label="Kalan taksit" value={totals.remaining} tone="text-[#a3576f] border-[#efbfd0] bg-[#fff4f8]" />
        {totals.overdue > 0.005 && (
          <SummaryChip label="Gecikmiş" value={totals.overdue} tone="text-rose-800 border-rose-200 bg-rose-50" />
        )}
        <span className="ml-auto hidden items-center gap-2 text-[10px] text-[#705a66] sm:flex">
          <Legend swatch="bg-emerald-100 border-emerald-300" text="Ödendi" />
          <Legend swatch="bg-amber-100 border-amber-300" text="Bekliyor" />
          <Legend swatch="bg-rose-100 border-rose-300" text="Gecikti" />
        </span>
      </div>

      <div ref={scrollRef} className="max-h-[420px] overflow-auto rounded-[12px] border border-[#ead8df]">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          {/* YAPIŞKANLIK HÜCREDE, thead/tfoot ÜZERİNDE DEĞİL: `position: sticky` bölüm
              elemanlarında (özellikle tfoot) tarayıcılar arasında güvenilir değil. */}
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2">Tarih</th>
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right">Planlanan Miktar</th>
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right">Ödenen Taksit</th>
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right">Kalan</th>
              <th className="sticky top-0 z-10 border-b border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-center">Durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = CELL[c.status]
              const isThisMonth = c.key === todayKey
              return (
                <tr
                  key={c.key}
                  ref={isThisMonth ? todayRef : undefined}
                  className={`${s.row} ${isThisMonth ? 'ring-1 ring-inset ring-[#c85776]' : ''}`}
                >
                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 align-top">
                    <div className="font-semibold tabular-nums text-[#352432]">{fmtDue(c)}</div>
                    <div className="text-[10px] text-[#705a66]">
                      {isThisMonth ? 'bu ay' : `${MONTHS_SHORT[c.month - 1]} ${c.year}`}
                      {c.installmentCount > 1 ? ` · ${c.installmentCount} taksit` : ''}
                    </div>
                  </td>

                  {/* PLANLANAN: plan tutarı + (varsa) devreden borç → o ay ödenmesi gereken */}
                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 text-right align-top">
                    <div className="font-semibold tabular-nums text-[#352432]">{formatTL(Math.round(c.due))}</div>
                    {c.carryIn > 0.005 && (
                      <div className="text-[10px] font-semibold tabular-nums text-rose-700">
                        +{formatTL(Math.round(c.carryIn))} devir → {formatTL(Math.round(c.expected))}
                      </div>
                    )}
                  </td>

                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 text-right align-top tabular-nums text-emerald-700">
                    {c.paid > 0.005 ? formatTL(Math.round(c.paid)) : '—'}
                  </td>

                  {/* KALAN: o ayın borcundan geriye kalan = bir sonraki aya devredecek tutar */}
                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 text-right align-top">
                    <div className={`font-bold tabular-nums ${c.outstanding > 0.005 ? 'text-[#a3576f]' : 'text-emerald-700'}`}>
                      {formatTL(Math.round(c.outstanding))}
                    </div>
                    {c.outstanding > 0.005 && c.carryIn > 0.005 && (
                      <div className="text-[10px] text-[#705a66]">sonraki aya devreder</div>
                    )}
                  </td>

                  <td className="border-b border-[#f0dce5] px-3 py-2 text-center align-top">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.badge}`}>
                      {s.mark && <span>{s.mark}</span>}{s.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* TOPLAM BANDI — Excel'deki toplam satırı gibi tablonun altında yapışık durur. */}
          <tfoot>
            <tr className="text-[12px] font-bold text-[#352432]">
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2">TOPLAM</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right tabular-nums">{formatTL(Math.round(totals.due))}</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right tabular-nums text-emerald-700">{formatTL(Math.round(totals.paid))}</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right tabular-nums text-[#a3576f]">{formatTL(Math.round(totals.remaining))}</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-center text-[10px] font-semibold text-[#705a66]">
                {rows.length} vade
              </td>
            </tr>
          </tfoot>
        </table>
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
