'use client'

/**
 * Raporlar sayfasının üst filtre çubuğu.
 *
 *  1. Dönem: Günlük · Haftalık · Aylık · Yıllık · Özel Aralık
 *  2. Gezinme: hazır dönemlerde ileri/geri ok; özel aralıkta iki tarih kutusu
 *  3. Karşılaştırma: yok · önceki dönem · geçen yıl · 2 yıl önce · özel dönem
 *
 * Seçilen aralık üstteki rozette her zaman açıkça yazar ("01 Temmuz 2026 — 02 Eylül 2026"),
 * karşılaştırma açıkken ikinci rozet kıyas dönemini gösterir.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { CalendarRange, ChevronLeft, ChevronRight, GitCompareArrows, History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import {
  compareLabels,
  describeRange,
  fromDateInput,
  periodLabels,
  toDateInput,
  type CompareMode,
  type DateRange,
  type PeriodPreset,
  type ResolvedRange,
} from '@/lib/reportRanges'

export interface ReportFilterState {
  preset: PeriodPreset
  offset: number
  custom: DateRange
  compareMode: CompareMode
  compareCustom: DateRange
}

export default function ReportFilterBar({
  state,
  onChange,
  range,
  compare,
  right,
}: {
  state: ReportFilterState
  onChange: (next: ReportFilterState) => void
  range: ResolvedRange
  compare: ResolvedRange | null
  right?: React.ReactNode
}) {
  const [showCompareCustom, setShowCompareCustom] = useState(state.compareMode === 'custom')

  const set = (patch: Partial<ReportFilterState>): void => onChange({ ...state, ...patch })

  const presets: PeriodPreset[] = ['daily', 'weekly', 'monthly', 'yearly', 'custom']
  const compareModes: CompareMode[] = ['none', 'previous', 'lastYear', 'twoYearsAgo', 'custom']

  return (
    <div className="armo-card armo-card-luxury sticky top-2 z-30 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* --- dönem presetleri --- */}
        <div className="inline-flex flex-wrap rounded-full border border-[#efe1e7] bg-[#fff8fa] p-0.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set({ preset: p, offset: 0 })}
              className={`relative rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                state.preset === p ? 'text-white' : 'text-[#705a66] hover:text-[#a34a62]'
              }`}
            >
              {state.preset === p && (
                <motion.span
                  layoutId="report-period-pill"
                  className="absolute inset-0 rounded-full bg-[#c05277] shadow-[0_10px_22px_-16px_rgba(192,82,119,0.9)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative">{periodLabels[p]}</span>
            </button>
          ))}
        </div>

        {/* --- gezinme / özel aralık --- */}
        {state.preset === 'custom' ? (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-2 py-1">
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-[#c05277]" strokeWidth={1.8} />
            <input
              type="date"
              value={toDateInput(state.custom.from)}
              max={toDateInput(state.custom.to)}
              onChange={(e) => {
                const d = fromDateInput(e.target.value)
                if (d) set({ custom: { ...state.custom, from: d } })
              }}
              className="w-[124px] bg-transparent text-[11.5px] font-semibold text-[#4a3a44] outline-none"
            />
            <span className="text-[11px] text-[#a3576f]">→</span>
            <input
              type="date"
              value={toDateInput(state.custom.to)}
              min={toDateInput(state.custom.from)}
              onChange={(e) => {
                const d = fromDateInput(e.target.value)
                if (d) set({ custom: { ...state.custom, to: d } })
              }}
              className="w-[124px] bg-transparent text-[11.5px] font-semibold text-[#4a3a44] outline-none"
            />
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 rounded-full border border-[#efe1e7] bg-white p-0.5">
            <button
              type="button"
              onClick={() => set({ offset: state.offset - 1 })}
              title="Önceki dönem"
              className="grid h-7 w-7 place-items-center rounded-full text-[#705a66] transition-colors hover:bg-[#fff2f6] hover:text-[#a34a62]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[150px] px-2 text-center text-[11.5px] font-bold text-[#a34a62]">{range.label}</span>
            <button
              type="button"
              onClick={() => set({ offset: state.offset + 1 })}
              disabled={state.offset >= 0}
              title="Sonraki dönem"
              className="grid h-7 w-7 place-items-center rounded-full text-[#705a66] transition-colors hover:bg-[#fff2f6] hover:text-[#a34a62] disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {state.offset !== 0 && (
              <button
                type="button"
                onClick={() => set({ offset: 0 })}
                title="Bugüne dön"
                className="ml-0.5 inline-flex items-center gap-1 rounded-full border-l border-[#f2e6eb] px-2 py-1 text-[10.5px] font-semibold text-[#705a66] transition-colors hover:text-[#c05277]"
              >
                <History className="h-3 w-3" /> Bugün
              </button>
            )}
          </div>
        )}

        {/* --- karşılaştırma --- */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#efe1e7] bg-white px-2.5 py-1.5">
          <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-[#7b52ba]" strokeWidth={1.8} />
          <select
            value={state.compareMode}
            onChange={(e) => {
              const mode = e.target.value as CompareMode
              setShowCompareCustom(mode === 'custom')
              set({ compareMode: mode })
            }}
            className="bg-transparent text-[11.5px] font-semibold text-[#4a3a44] outline-none"
          >
            {compareModes.map((m) => (
              <option key={m} value={m}>
                {compareLabels[m]}
              </option>
            ))}
          </select>
        </div>

        <AnimatePresence initial={false}>
          {showCompareCustom && state.compareMode === 'custom' && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-2 py-1"
            >
              <input
                type="date"
                value={toDateInput(state.compareCustom.from)}
                onChange={(e) => {
                  const d = fromDateInput(e.target.value)
                  if (d) set({ compareCustom: { ...state.compareCustom, from: d } })
                }}
                className="w-[122px] bg-transparent text-[11.5px] font-semibold text-[#4a3a44] outline-none"
              />
              <span className="text-[11px] text-[#6b4aa0]">→</span>
              <input
                type="date"
                value={toDateInput(state.compareCustom.to)}
                onChange={(e) => {
                  const d = fromDateInput(e.target.value)
                  if (d) set({ compareCustom: { ...state.compareCustom, to: d } })
                }}
                className="w-[122px] bg-transparent text-[11.5px] font-semibold text-[#4a3a44] outline-none"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>
      </div>

      {/* --- seçili aralık özeti --- */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f0d9e2] bg-[#fff1f6] px-2.5 py-1 text-[10.5px] font-semibold text-[#a34a62]">
          <CalendarRange className="h-3 w-3" strokeWidth={1.9} />
          {describeRange(range)}
        </span>
        {compare && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e0d3f2] bg-[#faf6ff] px-2.5 py-1 text-[10.5px] font-semibold text-[#6b4aa0]">
            <GitCompareArrows className="h-3 w-3" strokeWidth={1.9} />
            Kıyas: {describeRange(compare)}
          </span>
        )}
        {state.preset === 'custom' && (
          <button
            type="button"
            onClick={() => set({ preset: 'monthly', offset: 0 })}
            className="inline-flex items-center gap-1 rounded-full border border-[#efe1e7] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[#705a66] transition-colors hover:text-[#c05277]"
          >
            <RotateCcw className="h-3 w-3" /> Aylık görünüme dön
          </button>
        )}
      </div>
    </div>
  )
}
