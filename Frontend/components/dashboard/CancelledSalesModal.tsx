'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Ban, RotateCcw, Search, XCircle } from 'lucide-react'
import type { CancelledSale } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'

// İPTAL ARŞİVİ. İptalde cari kaydı (taksit/tahsilat/seans dahil) canlı tablolardan silinip
// `cancelled_sales`e taşınır — finansal iz kaybolmaz, yer değiştirir. Bu yüzden liste artık
// cari listesinden süzülmez; ayrı bir uçtan (adminApi.listCancelledSales) gelir.

interface Props {
  sales: CancelledSale[]
  open: boolean
  onOpenChange: (next: boolean) => void
  /** İptali geri al — arşivdeki yedekten cari, taksit, tahsilat ve seanslar yeniden kurulur. */
  onRestore?: (originalAccountId: string) => Promise<void>
  busy?: boolean
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatDay(iso: string | null | undefined): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

export default function CancelledSalesModal({ sales, open, onOpenChange, onRestore, busy = false }: Props) {
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)

  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const filtered = q
      ? sales.filter((a) => `${a.customerName} ${a.name}`.toLocaleLowerCase('tr').includes(q))
      : sales
    return [...filtered].sort((a, b) => (b.cancelledAtUtc || '').localeCompare(a.cancelledAtUtc || ''))
  }, [sales, query])

  const totalCancelled = list.reduce((s, a) => s + a.totalAmount, 0)
  const totalPaid = list.reduce((s, a) => s + a.collectedAmount, 0)
  const totalRefunded = list.reduce((s, a) => s + a.refundedAmount, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 820px)', height: 'min(90dvh, 720px)', maxHeight: '90dvh' }}
      >
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f6] via-white to-[#fff2f4] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-rose-200 bg-rose-50 text-rose-600">
              <Ban className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[16px] font-bold text-[#2b1e29]">İptal edilen satışlar</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11.5px] text-[#705a66]">
                {list.length} kayıt · toplam {formatTL(totalCancelled)} · tahsil edilmiş {formatTL(totalPaid)}
                {totalRefunded > 0.005 ? ` · iade edilen ${formatTL(totalRefunded)}` : ''}
              </DialogDescription>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#b499a6]" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Müşteri / paket ara…"
              className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#b499a6]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {list.map((a) => (
            <div
              key={a.id}
              className="w-full rounded-[14px] border border-[#f0dae2] bg-white px-3.5 py-3 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-[#352432]">{a.customerName || a.name}</div>
                  <div className="truncate text-[11px] text-[#705a66]">{a.name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-[15px] tabular-nums text-[#352432]">{formatTL(a.totalAmount)}</div>
                  <div className="text-[10px] text-[#705a66]">tahsil {formatTL(a.collectedAmount)}</div>
                  {a.refundedAmount > 0.005 && (
                    <div className="text-[10px] text-[#a34a62]">iade {formatTL(a.refundedAmount)}</div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-rose-50 px-2.5 py-1.5 text-[10.5px] text-rose-700">
                <XCircle className="mt-px h-3 w-3 shrink-0" />
                <span>
                  <b>İptal · {formatDay(a.cancelledAtUtc)}</b>
                  {a.cancellationReason ? ` — ${a.cancellationReason}` : ' — gerekçe belirtilmemiş'}
                </span>
              </div>
              {onRestore && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={busy || restoring === a.id}
                    onClick={async () => {
                      setRestoring(a.id)
                      try { await onRestore(a.originalAccountId) } finally { setRestoring(null) }
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6] disabled:opacity-60"
                  >
                    <RotateCcw className={`h-3 w-3 ${restoring === a.id ? 'animate-spin' : ''}`} /> İptali geri al
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && (
            <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-10 text-center text-[12px] text-[#705a66]">
              İptal edilmiş satış yok.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
