'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ReceiptText, TrendingUp, Users, Wallet, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { normalizeDailyAdisyon } from '@/lib/apiMappers'
import { formatTL } from '@/lib/apiMappers'
import type { ApiDailyAdisyon, AdisyonItemTypeKey, DailyAdisyonRow } from '@/lib/types'

const TYPE_LABELS: Record<AdisyonItemTypeKey, string> = {
  Service: 'Hizmet', Product: 'Ürün', PackageUse: 'Paketten', Extra: 'Ek', Payment: 'Tahsilat', Discount: 'İndirim', PackageSale: 'Paket satışı',
}
const TYPE_TONES: Record<AdisyonItemTypeKey, string> = {
  Service: 'border-sky-300/40 bg-sky-50 text-sky-700',
  Product: 'border-violet-300/40 bg-violet-50 text-violet-700',
  PackageUse: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Extra: 'border-slate-300/40 bg-slate-50 text-slate-700',
  Payment: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Discount: 'border-rose-300/40 bg-rose-50 text-rose-700',
  PackageSale: 'border-fuchsia-300/40 bg-fuchsia-50 text-fuchsia-700',
}

function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * Günlük adisyon kartı — bir günün tüm işlemleri (kime ne yapıldı, saatli, kim yaptı) ve tahsilatları
 * kronolojik zaman çizelgesi + gün toplamları. Randevular ve Ön Muhasebe'den açılır.
 */
export default function DailyAdisyonModal({
  open,
  onOpenChange,
  tenantId,
  initialDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId?: string
  initialDate?: string
}) {
  const [dayKey, setDayKey] = useState<string>(initialDate || dayKeyOf(new Date()))

  const { fromUtc, toUtc } = useMemo(() => {
    const start = parseDayKey(dayKey)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    return { fromUtc: start.toISOString(), toUtc: end.toISOString() }
  }, [dayKey])

  const { data, loading } = useApiQuery<ApiDailyAdisyon | null>(
    async () => {
      if (!tenantId || !open) return null
      return adminApi.dailyAdisyon<ApiDailyAdisyon>(fromUtc, toUtc, tenantId).catch(() => null)
    },
    [tenantId, fromUtc, toUtc, open],
    { initialData: null },
  )

  const daily = useMemo(() => normalizeDailyAdisyon(data), [data])
  const rows = daily.rows

  const shiftDay = (delta: number) => {
    const d = parseDayKey(dayKey)
    d.setDate(d.getDate() + delta)
    setDayKey(dayKeyOf(d))
  }

  const isToday = dayKey === dayKeyOf(new Date())
  const dateLabel = dateFmt.format(parseDayKey(dayKey))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 760px)', maxHeight: '94dvh' }}
      >
        <div className="flex min-h-0 max-h-[94dvh] flex-col overflow-hidden">
          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/70 bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] px-5 py-4">
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #b88938 50%, #ffd3df 80%, transparent)' }} />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/80">
                  <CalendarDays className="h-3.5 w-3.5" /> Günlük Adisyon Kartı
                </div>
                <DialogTitle className="mt-0.5 truncate font-display text-xl capitalize tracking-tight text-[#352432]">
                  {dateLabel}{isToday && <span className="ml-2 align-middle rounded-full bg-[#fff1f6] px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]">Bugün</span>}
                </DialogTitle>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => shiftDay(-1)} aria-label="Önceki gün" className="grid h-8 w-8 place-items-center rounded-full border border-[#ead8df]/80 bg-white text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#c85776]"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setDayKey(dayKeyOf(new Date()))} className="rounded-full border border-[#ead8df]/80 bg-white px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#c85776]">Bugün</button>
                <button type="button" onClick={() => shiftDay(1)} aria-label="Sonraki gün" className="grid h-8 w-8 place-items-center rounded-full border border-[#ead8df]/80 bg-white text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#c85776]"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" onClick={() => onOpenChange(false)} aria-label="Kapat" className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-[#ead8df]/80 bg-white/86 text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#3b2330]"><X className="h-4 w-4" /></button>
              </div>
            </div>

            {/* KPI STRIP */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi icon={ReceiptText} label="İşlem" value={String(daily.serviceCount)} tone="text-[#c85776]" />
              <Kpi icon={Users} label="Danışan" value={String(daily.customerCount)} tone="text-sky-700" />
              <Kpi icon={TrendingUp} label="Ciro" value={formatTL(daily.chargeTotal)} tone="text-[#b14d6c]" />
              <Kpi icon={Wallet} label="Tahsilat" value={formatTL(daily.paymentTotal)} tone="text-emerald-700" />
            </div>
          </header>

          {/* GÖVDE — zaman çizelgesi */}
          <div className="min-h-0 flex-auto overflow-y-auto bg-[#fffafb] px-4 py-4">
            {loading ? (
              <div className="grid place-items-center py-16 text-sm text-[#352432]/45">Yükleniyor…</div>
            ) : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-16 text-center">
                <ReceiptText className="h-8 w-8 text-[#e6c6d2]" />
                <div className="text-sm text-[#352432]/50">Bu gün için işlem yok.</div>
              </div>
            ) : (
              <ol className="relative space-y-2 before:absolute before:bottom-2 before:left-[52px] before:top-2 before:w-px before:bg-[#f0dbe4]">
                {rows.map((r) => (
                  <TimelineRow key={r.itemId} row={r} />
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-[12px] border border-[#ead8df]/70 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">
        <Icon className={`h-3 w-3 ${tone}`} /> {label}
      </div>
      <div className={`mt-0.5 font-display text-[16px] tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

function TimelineRow({ row }: { row: DailyAdisyonRow }) {
  const isPayment = row.type === 'Payment'
  const isDiscount = row.type === 'Discount'
  const time = row.occurredAtUtc ? timeFmt.format(new Date(row.occurredAtUtc)) : '—'
  const amountText = row.type === 'PackageUse'
    ? 'paket'
    : `${isPayment ? '+' : isDiscount ? '−' : ''}${formatTL(row.amount)}`
  return (
    <li className="relative flex items-center gap-3">
      <span className="w-[42px] shrink-0 text-right font-mono text-[11px] tabular-nums text-[#8a7480]">{time}</span>
      <span className={`relative z-10 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-2 border-white ${isPayment ? 'bg-emerald-400' : isDiscount ? 'bg-rose-300' : 'bg-[#e0617f]'} shadow-[0_0_0_2px_#f0dbe4]`} />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${TYPE_TONES[row.type]}`}>{TYPE_LABELS[row.type]}</span>
            <span className="truncate text-[12px] text-[#352432]">{row.description}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#352432]/50">
            <span className="inline-flex items-center gap-1"><Users className="h-2.5 w-2.5" /> {row.customerName || 'Müşteri'}</span>
            {row.staffName && <span className="inline-flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {row.staffName}</span>}
            {row.adisyonStatus === 'Open' && <span className="rounded-full bg-amber-50 px-1.5 text-[9px] font-mono uppercase text-amber-700">açık</span>}
          </div>
        </div>
        <span className={`shrink-0 font-mono text-[12px] tabular-nums ${isPayment ? 'text-emerald-700' : isDiscount ? 'text-rose-700' : row.type === 'PackageUse' ? 'text-amber-700' : 'text-[#352432]'}`}>{amountText}</span>
      </div>
    </li>
  )
}
