'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Banknote, Boxes, CalendarDays, CheckCircle2, CreditCard, Package, Percent,
  Plus, ReceiptText, Sparkles, Ticket, User, XCircle,
} from 'lucide-react'
import type { Adisyon, AdisyonItemTypeKey } from '@/lib/types'
import { adisyonItemTypeLabel, formatTL } from '@/lib/apiMappers'

// ---------------------------------------------------------------------------
// ONAYLANMIŞ / İPTAL EDİLMİŞ ADİSYON FİŞİ
// Açık adisyon düzenlenebilir olduğu için AdisyonModal (AdisyonPanel) ile açılır;
// kapanmış adisyon ise değiştirilemez — burada okunur bir "fiş" olarak gösterilir.
// ---------------------------------------------------------------------------

const TYPE_TONES: Record<AdisyonItemTypeKey, string> = {
  Service: 'border-sky-300/40 bg-sky-50 text-sky-700',
  Product: 'border-violet-300/40 bg-violet-50 text-violet-700',
  PackageUse: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Extra: 'border-slate-300/40 bg-slate-50 text-slate-700',
  Payment: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Discount: 'border-rose-300/40 bg-rose-50 text-rose-700',
  PackageSale: 'border-fuchsia-300/40 bg-fuchsia-50 text-fuchsia-700',
}

const TYPE_ICONS: Record<AdisyonItemTypeKey, typeof Sparkles> = {
  Service: Sparkles,
  Product: Package,
  PackageUse: Ticket,
  Extra: Plus,
  Payment: Banknote,
  Discount: Percent,
  PackageSale: Boxes,
}

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function formatDay(iso: string | null | undefined): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

interface Props {
  adisyon: Adisyon | null
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Bu adisyonun bağlı olduğu satış iptal edildiyse gerekçesi (fişte de görünsün). */
  saleCancelled?: { at: string | null; reason: string }
  onShowInAccounts: () => void
  /** Silme akışı sayfada kalır (onaylıda geri alma uyarıları + "zorla sil" yükseltmesi). */
  deleteSlot?: ReactNode
}

export default function AdisyonReceiptModal({
  adisyon, open, onOpenChange, saleCancelled, onShowInAccounts, deleteSlot,
}: Props) {
  if (!adisyon) return null

  const approved = adisyon.status === 'Approved'
  const net = adisyon.chargeTotal - adisyon.paymentTotal

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: 'min(96vw, 640px)', height: 'min(92dvh, 820px)', maxHeight: '92dvh' }}
      >
        {/* ---- Fiş başlığı ---- */}
        <div className="relative shrink-0 border-b border-[#f2e2e9] bg-gradient-to-br from-[#fff5f8] via-white to-[#fff1f6] px-5 py-4">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 22%, #d9a441 50%, #ffd3df 78%, transparent)' }}
          />
          <div className="flex items-start justify-between gap-3 pr-10">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#c05277]">
                <ReceiptText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Adisyon fişi</div>
                <DialogTitle className="truncate text-[17px] font-bold tracking-tight text-[#2b1e29]">
                  {adisyon.customerName || 'Müşteri'}
                </DialogTitle>
                <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#705a66]">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3 text-[#c85776]" /> Açılış {formatDay(adisyon.openedAtUtc)}</span>
                  {adisyon.approvedAtUtc && <span>· Onay {formatDay(adisyon.approvedAtUtc)}</span>}
                  <span>· {adisyon.items.length} kalem</span>
                </DialogDescription>
              </div>
            </div>
            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold ${approved ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {approved ? 'ONAYLANDI' : 'İPTAL'}
            </span>
          </div>

          {/* Toplamlar */}
          <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#f0dae2] bg-[#f7e9ee] text-center">
            <div className="bg-white px-2 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">Borç</div>
              <div className="font-display text-[18px] tabular-nums text-rose-700">{formatTL(adisyon.chargeTotal)}</div>
            </div>
            <div className="bg-white px-2 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">Tahsilat</div>
              <div className="font-display text-[18px] tabular-nums text-emerald-700">{formatTL(adisyon.paymentTotal)}</div>
            </div>
            <div className="bg-white px-2 py-2.5">
              <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">{net >= 0 ? 'Kalan' : 'Fazla'}</div>
              <div className="font-display text-[18px] tabular-nums">{formatTL(Math.abs(net))}</div>
            </div>
          </div>
        </div>

        {/* ---- Kalemler ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {saleCancelled && (
            <div className="mb-3 flex items-start gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                <b>Bu adisyondan doğan satış iptal edildi</b>
                {saleCancelled.at ? ` · ${formatDay(saleCancelled.at)}` : ''}
                {saleCancelled.reason ? ` — ${saleCancelled.reason}` : ' — gerekçe belirtilmemiş'}
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-[14px] border border-[#f0e0e6]">
            {adisyon.items.map((it, idx) => {
              const Icon = TYPE_ICONS[it.type]
              return (
                <div key={it.id} className={`flex items-center gap-2.5 bg-white px-3 py-2.5 ${idx > 0 ? 'border-t border-[#f6ebef]' : ''}`}>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border ${TYPE_TONES[it.type]}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-[#352432]">{it.description}</span>
                    <span className="block truncate text-[10px] text-[#705a66]">
                      {adisyonItemTypeLabel(it.type, it.coveredByPackage)}
                      {it.quantity > 1 ? ` · ${it.quantity} adet × ${formatTL(it.unitPrice)}` : ''}
                      {it.staffName ? ` · ${it.staffName}` : ''}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-display text-[14px] tabular-nums ${
                      it.type === 'Payment' ? 'text-emerald-700' : it.type === 'Discount' ? 'text-rose-700' : it.coveredByPackage ? 'text-amber-700' : 'text-[#352432]'
                    }`}
                  >
                    {it.coveredByPackage ? 'paketten' : `${it.type === 'Payment' ? '+' : it.type === 'Discount' ? '−' : ''}${formatTL(it.lineTotal)}`}
                  </span>
                </div>
              )
            })}
            {adisyon.items.length === 0 && (
              <div className="bg-[#fffafb] px-3 py-6 text-center text-[11.5px] text-[#705a66]">Kalem yok.</div>
            )}
          </div>

          {approved && (
            <div className="mt-3 flex items-center gap-1.5 rounded-[12px] border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Borç cariye, tahsilat kasaya işlendi. Değişiklik için adisyonu silip yeniden oluşturmak gerekir.
            </div>
          )}

          {adisyon.plannedInstallmentCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-3 py-2 text-[11px] text-[#b14d6c]">
              <CreditCard className="h-3.5 w-3.5 shrink-0" />
              Taksitli satış: {adisyon.plannedInstallmentCount} taksit
              {adisyon.plannedFirstDueDate ? ` · ilk vade ${formatDay(adisyon.plannedFirstDueDate)}` : ''}
            </div>
          )}
        </div>

        {/* ---- Aksiyonlar ---- */}
        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {deleteSlot ?? <span />}
            <button
              type="button"
              onClick={onShowInAccounts}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-emerald-300/60 bg-emerald-50 px-4 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <User className="h-4 w-4" /> Cari hesaplarda gör
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
