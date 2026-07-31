'use client'

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Ban, RotateCcw, Search, Undo2, XCircle } from 'lucide-react'
import type { CancelledSale } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'

// İPTAL ARŞİVİ. İptalde cari kaydı (taksit/tahsilat/seans dahil) canlı tablolardan silinip
// `cancelled_sales`e taşınır — finansal iz kaybolmaz, yer değiştirir. Bu yüzden liste artık
// cari listesinden süzülmez; ayrı bir uçtan (adminApi.listCancelledSales) gelir.
//
// İKİ SEKME:
//   İptal Edilenler → arşivdeki tüm kayıtlar
//   İade Edilenler  → yalnızca müşteriye PARA GERİ ÖDENENLER (refundedAmount > 0)
// İade yalnızca iptal anında girilebildiği için ikisi aynı kaynaktan okunur.

export type CancelledTab = 'all' | 'refunded'

interface Props {
  sales: CancelledSale[]
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * İptali geri al — arşivdeki yedekten cari, taksit, tahsilat ve seanslar yeniden kurulur.
   * `voidRefund`: iade FİİLEN yapılmamışsa (yanlış kayıt) true; kasa çıkışı da geri alınır
   * (gerekçe zorunlu). `voidReason` yalnız o durumda dolar.
   */
  onRestore?: (originalAccountId: string, voidRefund: boolean, voidReason?: string) => Promise<void>
  busy?: boolean
  /** Modal hangi sekmeyle açılsın (Ön Muhasebe'deki iki ayrı butondan gelir). */
  initialTab?: CancelledTab
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatDay(iso: string | null | undefined): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

export default function CancelledSalesModal({ sales, open, onOpenChange, onRestore, busy = false, initialTab = 'all' }: Props) {
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [tab, setTab] = useState<CancelledTab>(initialTab)
  /** İadeli bir iptal geri alınırken "para gerçekten ödendi mi?" sorusunun açık olduğu satır. */
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** İade geçersiz kılınacaksa zorunlu gerekçe (gerçek bir kasa hareketi siliniyor). */
  const [voidReason, setVoidReason] = useState('')
  const [error, setError] = useState('')

  // Modal her açılışta çağıranın istediği sekmeyle başlar (iki ayrı buton var).
  useEffect(() => {
    if (open) { setTab(initialTab); setQuery(''); setConfirmId(null); setVoidReason(''); setError('') }
  }, [open, initialTab])

  const restore = async (originalAccountId: string, rowId: string, voidRefund: boolean): Promise<void> => {
    if (!onRestore) return
    if (voidRefund && !voidReason.trim()) { setError('İadeyi geçersiz kılmak için gerekçe yazın.'); return }
    setRestoring(rowId)
    setError('')
    try {
      await onRestore(originalAccountId, voidRefund, voidRefund ? voidReason.trim() : undefined)
      setConfirmId(null); setVoidReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İptal geri alınamadı.')
    } finally {
      setRestoring(null)
    }
  }

  const refundedCount = useMemo(() => sales.filter((a) => a.refundedAmount > 0.005).length, [sales])

  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const scoped = tab === 'refunded' ? sales.filter((a) => a.refundedAmount > 0.005) : sales
    const filtered = q
      ? scoped.filter((a) => `${a.customerName} ${a.name}`.toLocaleLowerCase('tr').includes(q))
      : scoped
    return [...filtered].sort((a, b) => (b.cancelledAtUtc || '').localeCompare(a.cancelledAtUtc || ''))
  }, [sales, query, tab])

  const totalCancelled = list.reduce((s, a) => s + a.totalAmount, 0)
  const totalPaid = list.reduce((s, a) => s + a.collectedAmount, 0)
  const totalRefunded = list.reduce((s, a) => s + a.refundedAmount, 0)
  const totalRetained = list.reduce((s, a) => s + a.retainedAmount, 0)
  const isRefundTab = tab === 'refunded'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 820px)', height: 'min(90dvh, 720px)', maxHeight: '90dvh' }}
      >
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f6] via-white to-[#fff2f4] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border ${isRefundTab ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-rose-200 bg-rose-50 text-rose-600'}`}>
              {isRefundTab ? <Undo2 className="h-5 w-5" /> : <Ban className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[16px] font-bold text-[#2b1e29]">
                {isRefundTab ? 'İade edilen satışlar' : 'İptal edilen satışlar'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[11.5px] text-[#705a66]">
                {isRefundTab ? (
                  <>
                    {list.length} kayıt · müşteriye iade <b className="text-[#a34a62]">{formatTL(totalRefunded)}</b>
                    {' · '}kurumda kalan {formatTL(totalRetained)}
                  </>
                ) : (
                  <>
                    {list.length} kayıt · toplam {formatTL(totalCancelled)} · tahsil edilmiş {formatTL(totalPaid)}
                    {totalRefunded > 0.005 ? ` · iade edilen ${formatTL(totalRefunded)}` : ''}
                  </>
                )}
              </DialogDescription>
            </div>
          </div>

          {/* Sekmeler */}
          <div className="mt-3 inline-flex items-center rounded-full border border-[#ead8df] bg-white p-0.5">
            {([
              { key: 'all' as const, label: 'İptal Edilenler', count: sales.length },
              { key: 'refunded' as const, label: 'İade Edilenler', count: refundedCount },
            ]).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                  tab === t.key ? 'bg-gradient-to-r from-[#f7c6d5] to-[#f3aec3] text-[#7a2f4a]' : 'text-[#9a8590] hover:text-[#7a6570]'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 tabular-nums ${tab === t.key ? 'text-[#7a2f4a]' : 'text-[#b499a6]'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2">
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
                  {/* İade sekmesinde başrol iade tutarı; satış toplamı ikinci planda. */}
                  {isRefundTab ? (
                    <>
                      <div className="font-display text-[15px] tabular-nums text-[#a34a62]">−{formatTL(a.refundedAmount)}</div>
                      <div className="text-[10px] text-[#705a66]">tahsil {formatTL(a.collectedAmount)}</div>
                      <div className="text-[10px] text-emerald-700">kurumda {formatTL(a.retainedAmount)}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-display text-[15px] tabular-nums text-[#352432]">{formatTL(a.totalAmount)}</div>
                      <div className="text-[10px] text-[#705a66]">tahsil {formatTL(a.collectedAmount)}</div>
                      {a.refundedAmount > 0.005 && (
                        <div className="text-[10px] text-[#a34a62]">iade {formatTL(a.refundedAmount)}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
              {isRefundTab ? (
                <div className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800">
                  <Undo2 className="mt-px h-3 w-3 shrink-0" />
                  <span>
                    <b>İade · {formatDay(a.cancelledAtUtc)}</b>
                    {a.refundedAmount >= a.collectedAmount - 0.005 ? ' — tamamı iade edildi' : ' — kısmi iade'}
                    {a.cancellationReason ? ` · ${a.cancellationReason}` : ''}
                  </span>
                </div>
              ) : (
                <div className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-rose-50 px-2.5 py-1.5 text-[10.5px] text-rose-700">
                  <XCircle className="mt-px h-3 w-3 shrink-0" />
                  <span>
                    <b>İptal · {formatDay(a.cancelledAtUtc)}</b>
                    {a.cancellationReason ? ` — ${a.cancellationReason}` : ' — gerekçe belirtilmemiş'}
                  </span>
                </div>
              )}
              {onRestore && (
                confirmId === a.id ? (
                  // İADE KARARI YÖNETİCİNİN. Geri alma, müşteriye fiilen ödenmiş parayı
                  // kendiliğinden "olmamış" sayamaz — dünkü kasa çıkışı bugünkü bir düzeltme
                  // yüzünden raporlardan silinirse mali iz bozulur.
                  <div className="mt-2 rounded-[11px] border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-amber-900">
                      Bu iptalde müşteriye {formatTL(a.refundedAmount)} iade edilmişti. Para gerçekten ödendi mi?
                    </p>
                    <p className="mt-1 text-[10.5px] text-amber-800">
                      "Evet" derseniz kasa çıkışı korunur ve bu tutar müşteri borcuna geri yazılır.
                    </p>
                    {/* "Hayır" gerçek bir kasa hareketini siler → gerekçe zorunlu (denetim izi). */}
                    <input
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder="Yanlış girildiyse gerekçe yazın (ör. iade fiilen yapılmadı)"
                      className="mt-2 w-full rounded-[9px] border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-[#352432] outline-none focus:border-amber-400 placeholder:text-[#9d8590]"
                    />
                    {error && <p className="mt-1 text-[10.5px] font-semibold text-rose-700">{error}</p>}
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setConfirmId(null); setVoidReason(''); setError('') }}
                        className="cursor-pointer rounded-[9px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#705a66]"
                      >
                        Vazgeç
                      </button>
                      <button
                        type="button"
                        disabled={busy || restoring === a.id}
                        onClick={() => void restore(a.originalAccountId, a.id, true)}
                        className="cursor-pointer rounded-[9px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] disabled:opacity-60"
                      >
                        Hayır, yanlış girilmiş — iadeyi de geri al
                      </button>
                      <button
                        type="button"
                        disabled={busy || restoring === a.id}
                        onClick={() => void restore(a.originalAccountId, a.id, false)}
                        className="cursor-pointer rounded-[9px] bg-[#a34a62] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                      >
                        Evet, ödendi — kasa çıkışı kalsın
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={busy || restoring === a.id}
                      onClick={() => {
                        // İade yoksa soracak bir şey yok; doğrudan geri al.
                        setError('')
                        if (a.refundedAmount > 0.005) { setConfirmId(a.id); setVoidReason(''); return }
                        void restore(a.originalAccountId, a.id, false)
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:bg-[#fff2f6] disabled:opacity-60"
                    >
                      <RotateCcw className={`h-3 w-3 ${restoring === a.id ? 'animate-spin' : ''}`} /> İptali geri al
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
          {list.length === 0 && (
            <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-10 text-center text-[12px] text-[#705a66]">
              {isRefundTab
                ? 'Müşteriye iade edilmiş tutar yok. İade, satış iptal edilirken girilir.'
                : 'İptal edilmiş satış yok.'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
