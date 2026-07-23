'use client'

import { useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  ReceiptText,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { normalizeDailyAdisyon } from '@/lib/apiMappers'
import { formatTL } from '@/lib/apiMappers'
import type { ApiDailyAdisyon, AdisyonItemTypeKey, DailyAdisyonRow } from '@/lib/types'

const TYPE_LABELS: Record<AdisyonItemTypeKey, string> = {
  Service: 'Hizmet', Product: 'Ürün', PackageUse: 'Paketten', Extra: 'Ek', Payment: 'Tahsilat', Discount: 'İndirim', PackageSale: 'Paket Satışı',
}
const TYPE_TONES: Record<AdisyonItemTypeKey, string> = {
  Service: 'border-sky-200 bg-sky-50 text-sky-700',
  Product: 'border-amber-200 bg-amber-50 text-amber-700',
  PackageUse: 'border-violet-200 bg-violet-50 text-violet-700',
  Extra: 'border-slate-200 bg-slate-50 text-slate-700',
  Payment: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Discount: 'border-rose-200 bg-rose-50 text-rose-600',
  PackageSale: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
}
const TYPE_DOTS: Record<AdisyonItemTypeKey, string> = {
  Service: 'bg-[#e0617f]', Product: 'bg-amber-400', PackageUse: 'bg-violet-400', Extra: 'bg-slate-400',
  Payment: 'bg-emerald-400', Discount: 'bg-rose-400', PackageSale: 'bg-fuchsia-400',
}
const TYPE_ORDER: AdisyonItemTypeKey[] = ['Service', 'Product', 'PackageSale', 'PackageUse', 'Payment', 'Discount', 'Extra']

function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })

/** Yüzde delta (önceki güne göre); önceki 0 ise gizlenir. */
function pctDelta(cur: number, prevVal: number): number | null {
  if (!prevVal) return null
  return Math.round(((cur - prevVal) / prevVal) * 100)
}

/**
 * Günlük adisyon kartı — bir günün tüm işlemleri (kime ne yapıldı, saatli, kim yaptı),
 * KPI'lar (dün karşılaştırmalı), filtreler ve gün sonu özeti. Randevular ve Ön Muhasebe'den açılır.
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
  const [typeFilter, setTypeFilter] = useState<AdisyonItemTypeKey | ''>('')
  const [staffFilter, setStaffFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  const { fromUtc, toUtc, prevFromUtc, prevToUtc } = useMemo(() => {
    const start = parseDayKey(dayKey)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1)
    return {
      fromUtc: start.toISOString(),
      toUtc: end.toISOString(),
      prevFromUtc: prevStart.toISOString(),
      prevToUtc: start.toISOString(),
    }
  }, [dayKey])

  const { data, loading } = useApiQuery<{ cur: ApiDailyAdisyon | null; prev: ApiDailyAdisyon | null }>(
    async () => {
      if (!tenantId || !open) return { cur: null, prev: null }
      const [cur, prev] = await Promise.all([
        adminApi.dailyAdisyon<ApiDailyAdisyon>(fromUtc, toUtc, tenantId).catch(() => null),
        adminApi.dailyAdisyon<ApiDailyAdisyon>(prevFromUtc, prevToUtc, tenantId).catch(() => null),
      ])
      return { cur, prev }
    },
    [tenantId, fromUtc, toUtc, open],
    { initialData: { cur: null, prev: null } },
  )

  const daily = useMemo(() => normalizeDailyAdisyon(data?.cur), [data])
  const prev = useMemo(() => normalizeDailyAdisyon(data?.prev), [data])
  const rows = daily.rows

  // Filtre seçenekleri + filtrelenmiş satırlar
  const staffOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (r.staffMemberId && r.staffName) m.set(r.staffMemberId, r.staffName)
    return [...m.entries()].map(([id, name]) => ({ id, name }))
  }, [rows])
  const typeOptions = useMemo(() => TYPE_ORDER.filter((t) => rows.some((r) => r.type === t)), [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false
      if (staffFilter && r.staffMemberId !== staffFilter) return false
      if (q && !`${r.customerName || ''} ${r.description} ${r.staffName || ''}`.toLocaleLowerCase('tr').includes(q)) return false
      return true
    })
  }, [rows, typeFilter, staffFilter, search])

  // Gün sonu özeti (tür bazlı dökümler)
  const summary = useMemo(() => {
    let product = 0
    let service = 0
    let discount = 0
    for (const r of rows) {
      if (r.type === 'Product') product += r.amount
      else if (r.type === 'Service' || r.type === 'PackageSale' || r.type === 'Extra') service += r.amount
      else if (r.type === 'Discount') discount += r.amount
    }
    return { product, service, discount }
  }, [rows])

  const kalan = Math.max(0, daily.chargeTotal - daily.paymentTotal)
  const prevKalan = Math.max(0, prev.chargeTotal - prev.paymentTotal)

  const shiftDay = (delta: number) => {
    const d = parseDayKey(dayKey)
    d.setDate(d.getDate() + delta)
    setDayKey(dayKeyOf(d))
  }

  const isToday = dayKey === dayKeyOf(new Date())
  const dateLabel = dateFmt.format(parseDayKey(dayKey))
  const anyFilter = Boolean(typeFilter || staffFilter || search.trim())

  const [exporting, setExporting] = useState(false)

  // Ödeme yöntemi etiketi (nakit/kart/havale) — eski kayıtlarda yöntem yoksa Nakit varsay.
  const methodLabel = (m: string | null): string => {
    const k = (m || '').toLowerCase()
    if (k === 'card') return 'Kart'
    if (k === 'transfer') return 'Havale/EFT'
    if (k === 'check') return 'Çek'
    return 'Nakit'
  }
  const methodKey = (m: string | null): 'cash' | 'card' | 'transfer' => {
    const k = (m || '').toLowerCase()
    if (k === 'card') return 'card'
    if (k === 'transfer') return 'transfer'
    return 'cash'
  }

  // Şık Excel dışa aktarma — BeautyAsist logosu + yöntem kırılımlı toplam (exceljs).
  const exportExcel = async () => {
    setExporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const { saveAs } = await import('file-saver')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'BeautyAsist'
      const ws = wb.addWorksheet('Günlük Adisyon', { views: [{ showGridLines: false }] })
      ws.columns = [
        { width: 9 }, { width: 15 }, { width: 34 }, { width: 22 }, { width: 24 }, { width: 13 }, { width: 14 }, { width: 13 },
      ]

      // Logo (public/logo.png) — sol üst
      try {
        const res = await fetch('/logo.png')
        const buf = await res.arrayBuffer()
        const imgId = wb.addImage({ buffer: buf, extension: 'png' })
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 46 } })
      } catch {
        /* logo yüklenemezse başlıkla devam */
      }

      // Başlık bloğu (logonun sağında)
      ws.mergeCells('C1:H1')
      const t = ws.getCell('C1')
      t.value = 'Günlük Adisyon Raporu'
      t.font = { size: 16, bold: true, color: { argb: 'FF7A2E44' } }
      t.alignment = { vertical: 'middle', horizontal: 'right' }
      ws.mergeCells('C2:H2')
      const s = ws.getCell('C2')
      s.value = `${dateLabel}${anyFilter ? ' · (filtrelenmiş görünüm)' : ''}`
      s.font = { size: 10, color: { argb: 'FF8A7480' } }
      s.alignment = { horizontal: 'right' }
      ws.getRow(1).height = 26
      ws.getRow(2).height = 15
      ws.getRow(3).height = 6

      // Kolon başlıkları
      const head = ws.addRow(['Saat', 'İçerik', 'Açıklama', 'Danışan', 'İşlemi Yapan Personel', 'Yöntem', 'Tutar', 'Durum'])
      head.height = 20
      head.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA63E5F' } }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
      })
      head.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' }

      // Satırlar (hizmetler + tahsilatlar dahil)
      let zebra = false
      for (const r of filteredRows) {
        const isPayment = r.type === 'Payment'
        const isPkgUse = r.type === 'PackageUse'
        const isDiscount = r.type === 'Discount'
        const row = ws.addRow([
          r.occurredAtUtc ? timeFmt.format(new Date(r.occurredAtUtc)) : '',
          TYPE_LABELS[r.type],
          r.description,
          r.customerName || '',
          r.staffName || '',
          isPayment ? methodLabel(r.method) : isPkgUse ? 'Paketten' : '',
          isPkgUse ? 0 : isDiscount ? -r.amount : r.amount,
          r.adisyonStatus === 'Open' ? 'Açık' : 'Tamamlandı',
        ])
        row.getCell(7).numFmt = '#,##0.00 ₺'
        row.getCell(7).alignment = { horizontal: 'right' }
        row.eachCell((cell) => {
          cell.font = { size: 10, color: { argb: 'FF352432' } }
          cell.alignment = { ...cell.alignment, vertical: 'middle' }
          if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7FA' } }
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFF3E4EA' } } }
        })
        row.getCell(2).font = { size: 9, bold: true, color: { argb: 'FFA63E5F' } }
        zebra = !zebra
      }

      // Yöntem kırılımı (tahsilatlar) + toplamlar
      const byMethod = { cash: 0, card: 0, transfer: 0 }
      let ciro = 0
      let tahsilat = 0
      for (const r of filteredRows) {
        if (r.type === 'Payment') { byMethod[methodKey(r.method)] += r.amount; tahsilat += r.amount }
        else if (r.type === 'Service' || r.type === 'Product' || r.type === 'PackageSale' || r.type === 'Extra') ciro += r.amount
        else if (r.type === 'Discount') ciro -= r.amount
      }

      ws.addRow([])
      const addTotal = (label: string, value: number, opts?: { strong?: boolean; color?: string }) => {
        const rr = ws.addRow(['', '', '', '', '', label, value, ''])
        rr.getCell(6).font = { bold: !!opts?.strong, size: opts?.strong ? 11 : 10, color: { argb: opts?.color || 'FF5D4A56' } }
        rr.getCell(6).alignment = { horizontal: 'right' }
        rr.getCell(7).numFmt = '#,##0.00 ₺'
        rr.getCell(7).font = { bold: true, size: opts?.strong ? 12 : 10, color: { argb: opts?.color || 'FF241923' } }
        rr.getCell(7).alignment = { horizontal: 'right' }
        return rr
      }
      addTotal('Nakit', byMethod.cash, { color: 'FF2F9E72' })
      addTotal('Kart', byMethod.card, { color: 'FF2563EB' })
      addTotal('Havale / EFT', byMethod.transfer, { color: 'FF7C3AED' })
      addTotal('Toplam Tahsilat', tahsilat, { strong: true, color: 'FF2F9E72' })
      addTotal('Toplam Ciro', ciro, { strong: true, color: 'FFA63E5F' })

      const buffer = await wb.xlsx.writeBuffer()
      saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `gunluk-adisyon-${dayKey}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 1080px)', maxHeight: '94dvh' }}
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
                <DialogTitle className="mt-0.5 truncate font-display text-2xl capitalize tracking-tight text-[#352432]">
                  {dateLabel}
                  {isToday && <span className="ml-2 align-middle rounded-full bg-[#ffe4ec] px-2.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-[#c85776]">Bugün</span>}
                </DialogTitle>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => shiftDay(-1)} aria-label="Önceki gün" className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#ead8df]/80 bg-white text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#c85776]"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => shiftDay(1)} aria-label="Sonraki gün" className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#ead8df]/80 bg-white text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#c85776]"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" onClick={() => setDayKey(dayKeyOf(new Date()))} className="rounded-[12px] border border-[#ead8df]/80 bg-white px-3.5 py-2 text-[12px] font-semibold text-[#5d4a56] transition hover:border-[#efbfd0] hover:text-[#c85776]">Bugün</button>
                <button type="button" onClick={() => onOpenChange(false)} aria-label="Kapat" className="grid h-9 w-9 place-items-center rounded-[12px] border border-[#ead8df]/80 bg-white text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#3b2330]"><X className="h-4 w-4" /></button>
              </div>
            </div>

            {/* KPI STRIP — dün karşılaştırmalı */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi icon={ReceiptText} label="İşlem" value={String(daily.serviceCount)} prevText={`Dün: ${prev.serviceCount}`} delta={pctDelta(daily.serviceCount, prev.serviceCount)} iconTone="bg-[#fbeaf1] text-[#c85776]" />
              <Kpi icon={Users} label="Danışan" value={String(daily.customerCount)} prevText={`Dün: ${prev.customerCount}`} delta={pctDelta(daily.customerCount, prev.customerCount)} iconTone="bg-sky-50 text-sky-600" />
              <Kpi icon={TrendingUp} label="Ciro" value={formatTL(daily.chargeTotal)} prevText={`Dün: ${formatTL(prev.chargeTotal)}`} delta={pctDelta(daily.chargeTotal, prev.chargeTotal)} iconTone="bg-[#fbeaf1] text-[#b14d6c]" />
              <Kpi icon={Wallet} label="Tahsilat" value={formatTL(daily.paymentTotal)} prevText={`Dün: ${formatTL(prev.paymentTotal)}`} delta={pctDelta(daily.paymentTotal, prev.paymentTotal)} iconTone="bg-emerald-50 text-emerald-600" />
              <Kpi icon={CheckCircle2} label="Kalan / Bakiye" value={formatTL(kalan)} prevText={`Dün: ${formatTL(prevKalan)}`} delta={pctDelta(kalan, prevKalan)} invertDelta iconTone="bg-rose-50 text-rose-500" />
            </div>

            {/* FİLTRE SATIRI */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as AdisyonItemTypeKey | '')} className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]">
                <option value="">İşlem Türü: Tümü</option>
                {typeOptions.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]">
                <option value="">Personel: Tümü</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#c85776]/60" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Müşteri, işlem veya not ara…" className="w-full rounded-[10px] border border-[#ead8df] bg-white py-1.5 pl-8 pr-3 text-[12px] text-[#241923] outline-none transition-colors focus:border-[#ef9ab5]" />
              </div>
              {anyFilter && (
                <button type="button" onClick={() => { setTypeFilter(''); setStaffFilter(''); setSearch('') }} className="text-[11px] font-semibold text-[#c85776] hover:underline">Temizle</button>
              )}
              <button type="button" onClick={() => void exportExcel()} disabled={exporting} className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#efbfd0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#c85776] transition hover:bg-[#fff4f8] disabled:opacity-60">
                <Download className="h-3.5 w-3.5" /> {exporting ? 'Hazırlanıyor…' : 'Excel Aktar'}
              </button>
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#efbfd0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#c85776] transition hover:bg-[#fff4f8]">
                <Printer className="h-3.5 w-3.5" /> Yazdır
              </button>
            </div>
          </header>

          {/* GÖVDE — tablo (saat + timeline noktası + tür + detay + tutar + durum) */}
          <div className="min-h-0 flex-auto overflow-y-auto bg-[#fffafb] px-4 py-3">
            {loading ? (
              <div className="grid place-items-center py-16 text-sm text-[#352432]/45">Yükleniyor…</div>
            ) : filteredRows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-16 text-center">
                <ReceiptText className="h-8 w-8 text-[#e6c6d2]" />
                <div className="text-sm text-[#352432]/50">{rows.length === 0 ? 'Bu gün için işlem yok.' : 'Filtrelere uyan işlem yok.'}</div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[16px] border border-[#efe1e7] bg-white">
                {/* Başlık satırı */}
                <div className="grid grid-cols-[64px_20px_110px_minmax(0,1fr)_110px_120px] items-center gap-2 border-b border-[#f3e4ea] bg-[#fff8fa] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a7480] max-sm:hidden">
                  <span>Saat</span><span /><span>İşlem</span><span>Danışan &amp; İşlem Detayı</span><span className="text-right">Tutar</span><span className="text-center">Durum</span>
                </div>
                <div className="relative before:absolute before:bottom-3 before:left-[81px] before:top-3 before:w-px before:bg-[#f0dbe4] max-sm:before:hidden">
                  {filteredRows.map((r) => <TableRow key={r.itemId} row={r} />)}
                </div>
              </div>
            )}
          </div>

          {/* FOOTER — Gün Sonu Özeti */}
          <footer className="shrink-0 border-t border-[#ead8df]/70 bg-[#fff8fa]/90 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-[#f47699] to-[#ef6088] text-white shadow-[0_10px_20px_-12px_rgba(214,95,131,0.9)]">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[12.5px] font-bold text-[#241923]">Gün Sonu Özeti</div>
                  <div className="text-[10.5px] capitalize text-[#8a7480]">{dateLabel} gününe ait özet bilgiler.</div>
                </div>
              </div>
              <div className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-5">
                <SummaryStat label="Toplam Ciro" value={formatTL(daily.chargeTotal)} tone="text-[#c85776]" />
                <SummaryStat label="Toplam Tahsilat" value={formatTL(daily.paymentTotal)} tone="text-emerald-600" />
                <SummaryStat label="Ürün Satışı" value={formatTL(summary.product)} tone="text-amber-600" />
                <SummaryStat label="Hizmet Cirosu" value={formatTL(summary.service)} tone="text-sky-600" />
                <SummaryStat label="Toplam İndirim" value={formatTL(summary.discount)} tone="text-rose-500" />
              </div>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  prevText,
  delta,
  invertDelta,
  iconTone,
}: {
  icon: typeof Wallet
  label: string
  value: string
  prevText: string
  delta: number | null
  /** true ise azalma "iyi" (ör. Kalan) — renk tersine döner. */
  invertDelta?: boolean
  iconTone: string
}) {
  const good = delta != null && (invertDelta ? delta < 0 : delta > 0)
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] border border-[#efe1e7] bg-white px-3 py-2.5 shadow-[0_10px_26px_-22px_rgba(200,87,118,0.5)]">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${iconTone}`}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10.5px] font-semibold text-[#8a7480]">{label}</div>
        <div className="flex items-center gap-1.5">
          <span className="font-display text-[17px] font-bold leading-tight text-[#241923] tabular-nums">{value}</span>
          {delta != null && delta !== 0 && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${good ? 'text-emerald-600' : 'text-rose-500'}`}>
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}%{Math.abs(delta)}
            </span>
          )}
        </div>
        <div className="truncate text-[10px] text-[#a58d99]">{prevText}</div>
      </div>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium text-[#8a7480]">{label}</div>
      <div className={`truncate text-[14px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

function TableRow({ row }: { row: DailyAdisyonRow }) {
  const isPayment = row.type === 'Payment'
  const isDiscount = row.type === 'Discount'
  const time = row.occurredAtUtc ? timeFmt.format(new Date(row.occurredAtUtc)) : '—'
  const amountText = row.type === 'PackageUse'
    ? 'paket'
    : `${isPayment ? '' : isDiscount ? '−' : ''}${formatTL(row.amount)}`
  const isOpen = row.adisyonStatus === 'Open'
  return (
    <div className="grid grid-cols-[64px_20px_110px_minmax(0,1fr)_110px_120px] items-center gap-2 border-b border-[#f6ecf1] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[#fff8fa] max-sm:grid-cols-[52px_minmax(0,1fr)_90px]">
      <span className="font-mono text-[11.5px] font-semibold tabular-nums text-[#5d4a56]">{time}</span>
      <span className={`relative z-10 h-2.5 w-2.5 justify-self-center rounded-full border-2 border-white shadow-[0_0_0_2px_#f0dbe4] max-sm:hidden ${TYPE_DOTS[row.type]}`} />
      <span className={`w-fit rounded-[7px] border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide max-sm:hidden ${TYPE_TONES[row.type]}`}>{TYPE_LABELS[row.type]}</span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-[#241923]">{row.description}</div>
        <div className="truncate text-[11px] text-[#8a7480]">
          {row.customerName || 'Müşteri'}
          {row.staffName && <span className="text-[#c2adb6]"> &nbsp;•&nbsp; </span>}
          {row.staffName}
        </div>
      </div>
      <span className={`text-right font-mono text-[13px] font-bold tabular-nums ${isPayment ? 'text-emerald-600' : isDiscount ? 'text-rose-500' : row.type === 'PackageUse' ? 'text-violet-600' : 'text-[#241923]'}`}>{amountText}</span>
      <span className="justify-self-center max-sm:hidden">
        {isOpen ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Açık</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Tamamlandı
          </span>
        )}
      </span>
    </div>
  )
}
