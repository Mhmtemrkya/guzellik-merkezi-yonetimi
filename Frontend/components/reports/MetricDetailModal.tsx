'use client'

/**
 * Rapor kartı detay modali — herhangi bir KPI kartına ya da bölüm başlığındaki (i) düğmesine
 * tıklanınca açılır.
 *
 * İÇERİK
 *  • Büyük değer + kıyas dönemine göre fark
 *  • "Bu veri nedir?"        → sade tanım
 *  • "Nereden geliyor?"      → hangi kayıttan (kullanıcının uygulamada gördüğü yerle eşleşir)
 *  • "Nasıl hesaplanıyor?"   → formül
 *  • "Dikkat"                → yanlış okunmaya açık nokta (varsa)
 *  • Varsa dönem içi eğri ve alt kırılım (ör. ödeme yöntemi dağılımı)
 *
 * Açıklama metinleri `lib/reportMetricInfo.ts` kataloğundan gelir; arayüzde dağıtılmaz.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Calculator, Database, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { MiniSpark } from '@/components/reports/ReportCharts'
import { DeltaBadge, formatValue, type ReportValueUnit } from '@/components/reports/ReportUi'
import type { MetricInfo } from '@/lib/reportMetricInfo'

export interface MetricDetailPayload {
  info: MetricInfo
  /** Kartın gösterdiği değer — verilmezse yalnız açıklama gösterilir. */
  value?: number
  unit?: ReportValueUnit
  previous?: number
  compareLabel?: string
  /** Gider gibi düşmesi iyi olan metrikler. */
  invert?: boolean
  /** Dönem etiketi ("Temmuz 2026"). */
  rangeLabel?: string
  /** Dönem içi seyir (KPI kartındaki sparkline ile aynı seri). */
  series?: number[]
  /** Ek kırılım satırları — ör. ödeme yöntemleri. */
  breakdown?: { label: string; value: string; hint?: string }[]
  /** Kartın altındaki serbest not (ör. "3 şube"). */
  hint?: string
}

export default function MetricDetailModal({
  payload,
  onClose,
}: {
  payload: MetricDetailPayload | null
  onClose: () => void
}) {
  return (
    <ModalPortal>
      <AnimatePresence>
        {payload && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[145] grid place-items-center bg-[#2f1724]/45 p-4 backdrop-blur-sm"
            onClick={onClose}
            role="presentation"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={payload.info.title}
              className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-[#eadde3] bg-white shadow-[0_40px_90px_-40px_rgba(150,78,104,0.55)]"
            >
              {/* başlık */}
              <header className="flex items-start justify-between gap-3 border-b border-[#f2e6eb] bg-[linear-gradient(135deg,#fff8fa,#fff1f6)] px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border border-[#f0d9e2] bg-white text-[#c05277]">
                      <Info className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </span>
                    <h3 className="truncate font-display text-[16px] font-bold text-[#2f2230]">
                      {payload.info.title}
                    </h3>
                  </div>
                  {payload.rangeLabel && (
                    <p className="mt-1 pl-9 text-[11px] font-semibold text-[#705a66]">{payload.rangeLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Kapat"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white text-[#705a66] transition-colors hover:border-[#e7bccb] hover:text-[#c05277]"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </header>

              {/* gövde */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {payload.value !== undefined && (
                  <div className="rounded-[16px] border border-[#f2e6eb] bg-[#fffafc] px-4 py-3.5">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <span className="armo-stat-value text-[30px] leading-none">
                        {formatValue(payload.value, payload.unit ?? 'count')}
                      </span>
                      {payload.previous !== undefined && payload.compareLabel && (
                        <DeltaBadge
                          current={payload.value}
                          previous={payload.previous}
                          unit={payload.unit ?? 'count'}
                          compareLabel={payload.compareLabel}
                          invert={payload.invert}
                        />
                      )}
                    </div>
                    {payload.hint && <p className="mt-1.5 text-[11.5px] text-[#705a66]">{payload.hint}</p>}

                    {payload.previous !== undefined && payload.compareLabel && (
                      <p className="mt-2 border-t border-[#f2e6eb] pt-2 text-[11.5px] text-[#4a3a44]">
                        <span className="font-semibold">{payload.compareLabel}</span> döneminde{' '}
                        <span className="font-bold text-[#2f2230]">
                          {formatValue(payload.previous, payload.unit ?? 'count')}
                        </span>
                        {payload.previous !== 0 && (
                          <>
                            {' '}·{' '}
                            {payload.value >= payload.previous ? 'artış' : 'azalış'}{' '}
                            <span className="font-bold text-[#2f2230]">
                              {formatValue(Math.abs(payload.value - payload.previous), payload.unit ?? 'count')}
                            </span>
                          </>
                        )}
                      </p>
                    )}

                    {payload.series && payload.series.length > 1 && (
                      <div className="mt-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-[#8a7480]">
                          Dönem içi seyir
                        </div>
                        <div className="mt-1">
                          <MiniSpark values={payload.series} height={44} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Block icon={BookOpen} title="Bu veri nedir?" text={payload.info.summary} />
                <Block icon={Database} title="Nereden geliyor?" text={payload.info.source} />
                <Block icon={Calculator} title="Nasıl hesaplanıyor?" text={payload.info.formula} mono />
                {payload.info.caveat && (
                  <Block icon={TriangleAlert} title="Dikkat" text={payload.info.caveat} tone="warn" />
                )}

                {payload.breakdown && payload.breakdown.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#8a7480]">Kırılım</div>
                    <div className="mt-2 divide-y divide-[#f7edf1] rounded-[14px] border border-[#f2e6eb]">
                      {payload.breakdown.map((row, i) => (
                        <div key={`${row.label}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium text-[#2f2230]">{row.label}</span>
                            {row.hint && <span className="block text-[10.5px] text-[#705a66]">{row.hint}</span>}
                          </span>
                          <span className="shrink-0 text-[12px] font-bold text-[#2f2230]">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}

function Block({
  icon: Icon,
  title,
  text,
  mono = false,
  tone = 'neutral',
}: {
  icon: typeof Info
  title: string
  text: string
  mono?: boolean
  tone?: 'neutral' | 'warn'
}): ReactNode {
  const warn = tone === 'warn'
  return (
    <div
      className={`mt-3 rounded-[14px] border px-3.5 py-3 ${
        warn ? 'border-[#f0e0bd] bg-[#fffaef]' : 'border-[#f2e6eb] bg-white'
      }`}
    >
      <div
        className={`flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide ${
          warn ? 'text-[#8a6320]' : 'text-[#8a7480]'
        }`}
      >
        <Icon className={`h-3.5 w-3.5 ${warn ? 'text-[#937022]' : 'text-[#c05277]'}`} strokeWidth={1.9} />
        {title}
      </div>
      <p
        className={`mt-1.5 text-[12.5px] leading-[1.55] ${warn ? 'text-[#7a5a20]' : 'text-[#4a3a44]'} ${
          mono ? 'font-mono text-[12px]' : ''
        }`}
      >
        {text}
      </p>
    </div>
  )
}
