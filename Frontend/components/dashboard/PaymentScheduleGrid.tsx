'use client'

import { useEffect, useMemo, useRef } from 'react'
import { formatTL } from '@/lib/apiMappers'
import type { DueDateRow } from '@/lib/accountGrouping'

/**
 * TAKSİT TAKVİMİ — satır = VADE TARİHİ (ay değil).
 *
 * Dört sütun: <b>Tarih · Planlanan Miktar · Ödenen Taksit · Durum</b>.
 * Renk kuralı: ödendi YEŞİL · bekliyor SARI · vadesi geçtiyse KIRMIZI.
 * RENK TEK BAŞINA ANLAM TAŞIMAZ — "Durum" sütununda yazılı karşılığı da vardır
 * (renk körlüğü + siyah-beyaz çıktı).
 *
 * AYNI GÜN TOPLANIR: müşterinin 12.08'de bir pakette 5.000, başkasında 2.000 taksiti varsa
 * o gün tek satırda 7.000 yazar; hangi satıştan geldiği satırın altında dökülür (yalnız
 * "Tümü" görünümünde — tek satış seçiliyken kaynak zaten bellidir).
 *
 * "Kalan" sütunu ve devir (carry) mantığı KALDIRILDI: devir aylık ızgaraya özeldi ve tahsilat
 * hesap havuzundan dağıtıldığı için birden çok satışı birleştiren bu listede tanımsız kalıyordu.
 */

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/**
 * Satır zemini + durum rozeti. Yeşil = ödendi, kırmızı = RESMEN gecikti, amber = bekleyen/geçmiş.
 *
 * "Gecikti" sözü ve kırmızı YALNIZ `overdue`da: o da kanonik tolerans kuralını uygulayan
 * sunucu bayrağıdır (bkz. `buildDueDateSchedule`). Vadesi geçmiş ama tolerans penceresi süren
 * gün `grace` ile "Vadesi geçti" yazar — görünür kalır, ama cari kartı "gecikme yok" derken
 * bu tablo aynı borç için "Gecikti" ilan etmez.
 */
const CELL: Record<DueDateRow['status'], { row: string; badge: string; label: string; mark: string; title?: string }> = {
  paid: { row: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: 'Ödendi', mark: '✓' },
  overdue: { row: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800 border-rose-300', label: 'Gecikti', mark: '!' },
  grace: {
    row: 'bg-amber-50', badge: 'bg-amber-100 text-amber-900 border-amber-400', label: 'Vadesi geçti', mark: '•',
    title: 'Vadesi geçti ama tolerans süresi henüz dolmadı — borç resmen gecikmiş sayılmıyor.',
  },
  partial: { row: 'bg-amber-50', badge: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Kısmi', mark: '◐' },
  upcoming: { row: 'bg-amber-50/60', badge: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Bekliyor', mark: '·' },
}

/** "2026-08-12" → "12 Ağu 2026". */
function fmtDue(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

export default function PaymentScheduleGrid({
  rows,
  todayIso,
  showSources = true,
}: {
  rows: DueDateRow[]
  /** `YYYY-MM-DD` yerel bugün — sıradaki vadeyi vurgulamak ve oraya kaydırmak için. */
  todayIso: string
  /** Kaynak dökümü ("hangi satıştan") gösterilsin mi — tek satış seçiliyken gereksiz. */
  showSources?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const focusRef = useRef<HTMLTableRowElement | null>(null)

  /**
   * ODAK SATIRI: bugünden itibaren ilk vade (yoksa son satır). Aylık ızgarada "bu ay" satırı
   * vardı; tarih listesinde her günün satırı olmadığı için bugünün kendisi listede olmayabilir.
   */
  const focusDate = useMemo(() => {
    const next = rows.find((r) => r.date >= todayIso)
    return next?.date ?? rows[rows.length - 1]?.date ?? ''
  }, [rows, todayIso])

  // Açılışta odak satırına kaydır: uzun planda kullanıcı her seferinde elle arıyordu.
  useEffect(() => {
    const box = scrollRef.current
    const target = focusRef.current
    if (!box || !target) return
    box.scrollTop = Math.max(0, target.offsetTop - box.clientHeight / 2 + target.clientHeight / 2)
  }, [rows, focusDate])

  // "Gecikmiş" toplamı YALNIZ kanonik `overdue` satırlarını sayar → cari kartındaki gecikme
  // tutarıyla birebir tutar. Tolerans penceresi süren (`grace`) günler ayrı sayılır ve ayrı
  // yazılır; ikisi tek çipte toplansaydı rakam yine karttan büyük çıkardı.
  const totals = useMemo(() => ({
    due: rows.reduce((s, r) => s + r.due, 0),
    paid: rows.reduce((s, r) => s + r.paid, 0),
    remaining: rows.reduce((s, r) => s + r.remaining, 0),
    overdue: rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.remaining, 0),
    grace: rows.filter((r) => r.status === 'grace').reduce((s, r) => s + r.remaining, 0),
  }), [rows])

  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-8 text-center text-[12px] text-[#74616A]">
        Bu seçimde taksit planı yok — satış peşin.
      </div>
    )
  }

  return (
    <div>
      {/* Özet şeridi — KAPSAM AÇIKÇA YAZILI: bu rakamlar YALNIZ taksitleri sayar. Peşinat ve
          peşin satışlar taksit satırı üretmediğinden buraya girmez. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <SummaryChip label="Taksit planı" value={totals.due} tone="text-[#3E343A] border-[#EAD8DF] bg-white" />
        <SummaryChip label="Taksitlerden tahsil" value={totals.paid} tone="text-emerald-800 border-emerald-200 bg-emerald-50" />
        <SummaryChip label="Kalan taksit" value={totals.remaining} tone="text-[#8C4460] border-[#BE7690] bg-[#F7F6F6]" />
        {totals.overdue > 0.005 && (
          <SummaryChip label="Gecikmiş" value={totals.overdue} tone="text-rose-800 border-rose-200 bg-rose-50" />
        )}
        {totals.grace > 0.005 && (
          <SummaryChip label="Vadesi geçti" value={totals.grace} tone="text-amber-900 border-amber-300 bg-amber-50" />
        )}
        <span className="ml-auto hidden items-center gap-2 text-[10px] text-[#74616A] sm:flex">
          <Legend swatch="bg-emerald-100 border-emerald-300" text="Ödendi" />
          <Legend swatch="bg-amber-100 border-amber-300" text="Bekliyor" />
          <Legend swatch="bg-amber-100 border-amber-400" text="Vadesi geçti" />
          <Legend swatch="bg-rose-100 border-rose-300" text="Gecikti" />
        </span>
      </div>

      <div ref={scrollRef} className="max-h-[420px] overflow-auto rounded-[12px] border border-[#EAD8DF]">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          {/* YAPIŞKANLIK HÜCREDE, thead/tfoot ÜZERİNDE DEĞİL: `position: sticky` bölüm
              elemanlarında (özellikle tfoot) tarayıcılar arasında güvenilir değil. */}
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#8C4460]">
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2">Tarih</th>
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right">Planlanan Miktar</th>
              <th className="sticky top-0 z-10 border-b border-r border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right">Ödenen Taksit</th>
              <th className="sticky top-0 z-10 border-b border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-center">Durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = CELL[r.status]
              const isFocus = r.date === focusDate
              const isToday = r.date === todayIso
              return (
                <tr
                  key={r.date}
                  ref={isFocus ? focusRef : undefined}
                  className={`${s.row} ${isFocus ? 'ring-1 ring-inset ring-[#A5556E]' : ''}`}
                >
                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 align-top">
                    <div className="font-semibold tabular-nums text-[#2A2027]">{fmtDue(r.date)}</div>
                    {(isToday || r.installmentCount > 1) && (
                      <div className="text-[10px] text-[#74616A]">
                        {isToday ? 'bugün' : ''}
                        {isToday && r.installmentCount > 1 ? ' · ' : ''}
                        {r.installmentCount > 1 ? `${r.installmentCount} taksit birleşti` : ''}
                      </div>
                    )}
                  </td>

                  {/* PLANLANAN: o günün toplamı + (Tümü'de, birden çok satış varsa) kaynak dökümü */}
                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 text-right align-top">
                    <div className="font-semibold tabular-nums text-[#2A2027]">{formatTL(Math.round(r.due))}</div>
                    {showSources && r.sources.length > 1 && (
                      <div className="mt-0.5 space-y-0.5">
                        {r.sources.map((src) => (
                          <div key={src.accountId} className="text-[10px] text-[#74616A]">
                            <span className="tabular-nums">{formatTL(Math.round(src.amount))}</span>
                            {' · '}{src.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="border-b border-r border-[#f0dce5] px-3 py-2 text-right align-top tabular-nums text-emerald-700">
                    {r.paid > 0.005 ? formatTL(Math.round(r.paid)) : '—'}
                  </td>

                  <td className="border-b border-[#f0dce5] px-3 py-2 text-center align-top">
                    <span
                      title={s.title}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.badge}`}
                    >
                      {s.mark && <span>{s.mark}</span>}{s.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* TOPLAM BANDI — Excel'deki toplam satırı gibi tablonun altında yapışık durur. */}
          <tfoot>
            <tr className="text-[12px] font-bold text-[#2A2027]">
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2">TOPLAM</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right tabular-nums">{formatTL(Math.round(totals.due))}</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-right tabular-nums text-emerald-700">{formatTL(Math.round(totals.paid))}</td>
              <td className="sticky bottom-0 border-t-2 border-[#f0dce5] bg-[#fff7fa] px-3 py-2 text-center text-[10px] font-semibold text-[#74616A]">
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
