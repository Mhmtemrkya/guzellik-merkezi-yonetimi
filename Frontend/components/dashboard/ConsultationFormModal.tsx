'use client'

import { ClipboardList, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import ConsultationForm from '@/components/dashboard/ConsultationForm'

/**
 * Müşteri bilgi ve onay formunu (anamnez + işlem onayı) MODAL olarak açar.
 *
 * Randevu verilirken formun eksik olduğu görülüyordu ama doldurmak için müşteri kartına gitmek,
 * randevuyu yarıda bırakmak gerekiyordu. Form aynı yerde doldurulup kapatılınca uyarı bandı
 * tazelenir ve işlem uygunluğu uyarıları hemen görünür.
 */
export default function ConsultationFormModal({
  open,
  onOpenChange,
  customerId,
  customerName,
  tenantId,
  branchId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId?: string
  customerName?: string | null
  tenantId?: string
  branchId?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 880px)', height: 'min(94dvh, 940px)', maxHeight: '94dvh' }}
      >
        <header className="relative shrink-0 border-b border-[#ead8df]/70 bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] px-5 py-4">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #b88938 50%, #ffd3df 80%, transparent)' }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/80">
                <ClipboardList className="h-3.5 w-3.5" /> Bilgi ve onay formu
              </div>
              <DialogTitle className="mt-0.5 truncate font-display text-xl tracking-tight text-[#352432]">
                {customerName || 'Müşteri formu'}
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

        <div className="min-h-0 flex-auto overflow-y-auto bg-[#fffafb] p-4">
          {customerId ? (
            <ConsultationForm customerId={customerId} tenantId={tenantId} branchId={branchId} />
          ) : (
            <div className="grid place-items-center py-16 text-sm text-[#705a66]">Müşteri seçili değil.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
