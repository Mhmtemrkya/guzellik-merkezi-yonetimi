'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Download, FileText, Loader2, ShieldCheck, X } from 'lucide-react'
import { useBranch } from '@/components/dashboard/BranchContext'
import { adminApi } from '@/lib/apiClient'
import { guidOrUndefined } from '@/lib/apiMappers'
import { resolveKvkkText } from '@/lib/kvkkDefault'
import { generateKvkkPdf } from '@/lib/kvkkPdf'

interface PublicProfileLite {
  kvkkConsentText?: string | null
  logoData?: string | null
}

/**
 * KVKK aydınlatma metnini gösteren modal. Kurumun özel metni + logosu (salon vitrini)
 * modal açılınca çekilir; metin kurum adına göre çözülür ve markalı PDF olarak indirilebilir.
 * Kendi içinde BranchContext'i kullanır — dışarıdan prop gerektirmez.
 */
export default function KvkkConsentModal({ triggerClassName }: { triggerClassName?: string }) {
  const { selectedInstitution, selectedInstitutionId } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const institutionName = selectedInstitution?.name || 'Kurum'

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<PublicProfileLite | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    adminApi
      .publicProfile<PublicProfileLite>()
      .then((p) => { if (!cancelled) setProfile(p) })
      .catch(() => { if (!cancelled) setProfile(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId])

  const text = resolveKvkkText(profile?.kvkkConsentText, institutionName)

  const downloadPdf = (): void => {
    generateKvkkPdf({ institutionName, text, logoData: profile?.logoData })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={triggerClassName || 'inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#c85776] underline-offset-2 hover:underline'}
        >
          <FileText className="h-3.5 w-3.5" /> KVKK aydınlatma metnini görüntüle
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden rounded-[24px] border border-[#ead8df]/90 bg-white p-0 text-[#352432] shadow-[0_40px_120px_-60px_rgba(120,71,88,0.7)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 780px)' }}
      >
        <header className="relative flex shrink-0 items-start gap-3 border-b border-[#f2e6eb] p-5 pr-14 sm:px-7">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#efbfd0] bg-[#fff1f6] text-[#c85776]">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#c85776]">Yasal · KVKK</div>
            <DialogTitle className="mt-0.5 font-display text-xl font-bold tracking-tight text-[#241923]">
              Aydınlatma Metni
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12px] text-[#705a66]">
              {institutionName} · Kişisel verilerin korunması
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Kapat"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-[#ead8df] bg-white text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#9d7386]">
              <Loader2 className="h-4 w-4 animate-spin" /> Metin yükleniyor…
            </div>
          ) : (
            <article className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#3d2b34]">{text}</article>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#f2e6eb] bg-white/80 p-4 sm:px-7">
          <span className="hidden text-[10px] text-[#9d7386] sm:inline">Metni Ayarlar sayfasından düzenleyebilirsiniz.</span>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
            >
              Kapat
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-5 py-2.5 text-[12px] font-semibold text-white shadow-[0_15px_26px_-15px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Download className="h-4 w-4" /> PDF indir
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
