'use client'

import { ReceiptText, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'

/**
 * Randevular sayfasından adisyon kartını (AdisyonPanel) modal olarak açar — Ön Muhasebe'ye
 * gitmeden kalem ekleme (= satış), ödeme/peşinat, sadakat, onay ve silme tek sayfadan yapılır.
 */
export default function AdisyonModal({
  open,
  onOpenChange,
  customerId,
  customerName,
  tenantId,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId?: string
  customerName?: string | null
  tenantId?: string
  onChanged?: () => unknown
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 640px)', maxHeight: '94dvh' }}
      >
        <div className="flex min-h-0 max-h-[94dvh] flex-col overflow-hidden">
          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/70 bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] px-5 py-4">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
              style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #b88938 50%, #ffd3df 80%, transparent)' }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/80">
                  <ReceiptText className="h-3.5 w-3.5" /> Adisyon
                </div>
                <DialogTitle className="mt-0.5 truncate font-display text-xl tracking-tight text-[#352432]">
                  {customerName || 'Müşteri adisyonu'}
                </DialogTitle>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/80 bg-white/86 text-[#7e5f6e] transition hover:border-[#efbfd0] hover:text-[#3b2330]"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* GÖVDE — AdisyonPanel (kaydırılabilir) */}
          <div className="min-h-0 flex-auto overflow-y-auto bg-[#fffafb] p-4">
            {customerId ? (
              <AdisyonPanel customerId={customerId} tenantId={tenantId} onChanged={onChanged} />
            ) : (
              <div className="grid place-items-center py-16 text-sm text-[#352432]/45">Müşteri seçili değil.</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
