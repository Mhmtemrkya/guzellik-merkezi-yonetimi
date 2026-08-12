'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ReceiptText, Users, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'
import ConsentWarningBanner from '@/components/dashboard/ConsentWarningBanner'
import CustomerPicker, { customerSearchProvider } from '@/components/dashboard/CustomerPicker'

/**
 * Adisyon kartını (AdisyonPanel) modal olarak açar — Ön Muhasebe'ye gitmeden kalem ekleme (= satış),
 * ödeme/peşinat, sadakat, onay ve silme tek sayfadan yapılır.
 * `allowPick` açık ve müşteri verilmemişse önce müşteri seçtirir (müşteri bazlı adisyon açma butonu).
 */
export default function AdisyonModal({
  open,
  onOpenChange,
  customerId,
  customerName,
  tenantId,
  onChanged,
  allowPick = false,
  defaultStaffMemberId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId?: string
  customerName?: string | null
  tenantId?: string
  onChanged?: () => unknown
  /** true ve müşteri verilmemişse: modalda önce müşteri seçtirir, sonra adisyonunu açar. */
  allowPick?: boolean
  /** Adisyon bir randevudan açıldıysa o randevunun personeli — kalem formunda hazır gelir. */
  defaultStaffMemberId?: string
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const customerSearch = useMemo(() => customerSearchProvider(tenantId), [tenantId])

  // Modal her kapandığında seçimi sıfırla ki bir sonraki açılış temiz gelsin.
  useEffect(() => {
    if (!open) setPicked(null)
  }, [open])

  const effectiveId = customerId || picked?.id
  const effectiveName = customerName || picked?.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 900px)', height: 'min(94dvh, 940px)', maxHeight: '94dvh' }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] px-5 py-4">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
              style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 20%, #b88938 50%, #ffd3df 80%, transparent)' }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {/* Seçiciden panele geçince "geri" ile müşteri değiştir */}
                {allowPick && !customerId && picked && (
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#EAD8DF]/80 bg-white text-[#7e5f6e] transition hover:border-[#BE7690] hover:text-[#A5556E]"
                    aria-label="Müşteri değiştir"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/80">
                    <ReceiptText className="h-3.5 w-3.5" /> Adisyon
                  </div>
                  <DialogTitle className="mt-0.5 truncate font-display text-xl tracking-tight text-[#2A2027]">
                    {effectiveName || (allowPick && !effectiveId ? 'Müşteri adisyonu aç' : 'Müşteri adisyonu')}
                  </DialogTitle>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF]/80 bg-white text-[#7e5f6e] transition hover:border-[#BE7690] hover:text-[#3b2330]"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* GÖVDE */}
          <div className="min-h-0 flex-auto overflow-y-auto bg-[#F7F6F6] p-4">
            {effectiveId ? (
              <>
                {/* Onam formu eksikse adisyonun başında uyarı — imzasız işlem gözden kaçmasın. */}
                <ConsentWarningBanner customerId={effectiveId} customerName={effectiveName} className="mb-3" />
                <AdisyonPanel
                  customerId={effectiveId}
                  tenantId={tenantId}
                  onChanged={onChanged}
                  defaultStaffMemberId={defaultStaffMemberId}
                />
              </>
            ) : allowPick ? (
              // Müşteri seçimi: arama kutusu ve sonuç listesi rahat sığsın diye ortada geniş bir alan.
              <div className="mx-auto w-full max-w-[560px] pt-6">
                <div className="text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#A5556E] text-white">
                    <Users className="h-6 w-6" />
                  </span>
                  <div className="mt-2 text-[15px] font-bold text-[#2A2027]">Adisyon açılacak müşteri</div>
                  <div className="mt-0.5 text-[11.5px] text-[#74616A]">
                    İsim ya da telefon ile arayın; seçtiğiniz müşterinin adisyon kartı hemen açılır.
                  </div>
                </div>
                <div className="mt-4">
                  <CustomerPicker
                    items={[]}
                    onSearch={customerSearch}
                    value=""
                    onChange={() => undefined}
                    onSelectItem={(it) => setPicked({ id: it.id, name: it.name })}
                    placeholder="İsim veya telefon ile ara…"
                  />
                </div>
              </div>
            ) : (
              <div className="grid place-items-center py-16 text-sm text-[#74616A]">Müşteri seçili değil.</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
