'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Building2, CalendarDays, Info, Loader2, Receipt, ShoppingBag, Trash2, UserRound, Users, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { branchRemovalLines } from '@/lib/branchRemoval'
import type { BranchDeletePreview } from '@/lib/types'

const tl = (n: number) => `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface DeletableBranch {
  id: string
  name: string
  isDefault: boolean
}

/**
 * ŞUBE SİLME (kullanıcı isteği 18 Kas 2026: "şube silme olsun; silerse fiyat ona göre güncellensin").
 * KAYITLAR SİLİNMEZ: şubenin müşterileri, personeli, kullanıcıları, randevuları, satışları ve diğer kayıtları seçilen
 * şubeye aktarılır; şube ardından kaldırılır. Paket tutarı şube sayısından hesaplandığı için sonraki ödemeden
 * itibaren düşer (önizleme sunucudan: aktarılacak kayıtlar + yeni tutar). Varsayılan ve tek şube silinemez.
 */
export default function BranchDeleteModal({
  branch,
  branches,
  tenantId,
  onDeleted,
  trigger,
}: {
  branch: DeletableBranch
  branches: DeletableBranch[]
  tenantId?: string
  /** Silindi: hedef şube (seçili şube silindiyse oraya geçilir). */
  onDeleted: (targetBranchId: string) => void | Promise<void>
  trigger: (open: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const targets = branches.filter((b) => b.id !== branch.id)
  const [target, setTarget] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: preview, loading } = useApiQuery<BranchDeletePreview | null>(
    () => (open ? adminApi.branchDeletePreview<BranchDeletePreview>(branch.id, tenantId).catch(() => null) : Promise.resolve(null)),
    [branch.id, tenantId, open, refresh],
    { initialData: null },
  )

  const targetId = target || (targets.find((b) => b.isDefault) ?? targets[0])?.id || ''
  const targetName = targets.find((b) => b.id === targetId)?.name ?? ''
  const lines = preview ? branchRemovalLines(preview.impact ?? null) : null

  const show = () => {
    setTarget('')
    setAcknowledged(false)
    setError(null)
    setRefresh((n) => n + 1)
    setOpen(true)
  }

  async function submit() {
    if (busy || !targetId || !acknowledged) return
    setBusy(true)
    setError(null)
    try {
      await adminApi.deleteBranch(branch.id, targetId, tenantId)
      setOpen(false)
      await onDeleted(targetId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Şube silinemedi.')
      setRefresh((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const counts = preview
    ? [
        { icon: Users, label: 'Müşteri', value: preview.customers },
        { icon: UserRound, label: 'Aktif personel', value: preview.staff },
        { icon: UserRound, label: 'Kullanıcı', value: preview.users },
        { icon: CalendarDays, label: 'Randevu', value: preview.appointments, note: preview.upcomingAppointments > 0 ? `${preview.upcomingAppointments} yaklaşan` : null },
        { icon: ShoppingBag, label: 'Adisyon', value: preview.sales },
      ]
    : []

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
        <DialogContent
          className="flex flex-col overflow-hidden rounded-[28px] border border-[#EAD8DF] bg-white !p-0 text-[#2A2027] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
          style={{ width: 'min(94vw, 560px)', maxWidth: 'min(94vw, 560px)', maxHeight: '94dvh' }}
        >
          <div className="flex min-h-0 max-h-[94dvh] flex-col overflow-hidden">
            <div className="relative shrink-0 overflow-hidden bg-[#A5556E] px-6 pb-5 pt-6 text-white">
              <motion.span
                aria-hidden
                animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.08, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#F9A1B9]/40 blur-3xl"
              />
              <button type="button" onClick={() => !busy && setOpen(false)} aria-label="Kapat"
                className="absolute right-4 top-4 rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
                <X className="h-4 w-4" />
              </button>
              <div className="relative flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Trash2 className="h-5 w-5" /></span>
                <div>
                  <DialogTitle className="text-[18px] font-semibold tracking-tight text-white">{branch.name} şubesini sil</DialogTitle>
                  <DialogDescription className="mt-0.5 text-[12.5px] text-white/80">Kayıtlar silinmez; seçtiğiniz şubeye aktarılır.</DialogDescription>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-5">
              {loading && !preview ? (
                <p className="flex items-center gap-2 text-[13px] text-[#74616A]"><Loader2 className="h-4 w-4 animate-spin" /> Şubenin kayıtları sayılıyor…</p>
              ) : !preview ? (
                <p className="text-[13px] text-[#74616A]">Şube bilgisi şu an alınamadı. Lütfen biraz sonra yeniden deneyin.</p>
              ) : preview.blocker ? (
                <p className="flex items-start gap-2 rounded-2xl border border-[#A5556E]/30 bg-[#FCF3F6] px-4 py-3 text-[13px] leading-relaxed text-[#5A1730]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" /> {preview.blocker}
                </p>
              ) : (
                <>
                  <div className="rounded-2xl border border-[#EAD8DF] bg-[#F7F6F6] p-4">
                    <p className="text-[12.5px] font-semibold text-[#5A4650]">Aktarılacak kayıtlar</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {counts.map(({ icon: Icon, label, value, note }) => (
                        <div key={label} className="rounded-xl bg-white px-3 py-2.5">
                          <div className="flex items-center gap-1.5 text-[11px] text-[#74616A]"><Icon className="h-3.5 w-3.5" /> {label}</div>
                          <div className="mt-0.5 text-[16px] font-semibold text-[#2A2027]">{value.toLocaleString('tr-TR')}</div>
                          {note ? <div className="text-[10.5px] text-[#8C4460]">{note}</div> : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11.5px] leading-relaxed text-[#74616A]">Kasa, cari, ürün ve geçmiş kayıtlar dahil şubeye bağlı her kayıt aktarılır; hiçbir kayıt silinmez.</p>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#5A4650]"><Building2 className="h-3.5 w-3.5" /> Kayıtların aktarılacağı şube</span>
                    <select value={targetId} onChange={(e) => setTarget(e.target.value)}
                      className="w-full rounded-2xl border border-[#EAD8DF] bg-white px-4 py-3 text-[14px] text-[#2A2027] outline-none transition focus:border-[#A5556E] focus:ring-4 focus:ring-[#A5556E]/15">
                      {targets.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isDefault ? ' (varsayılan)' : ''}</option>)}
                    </select>
                  </label>

                  <div className="overflow-hidden rounded-2xl border border-[#EAD8DF] bg-white">
                    <div className="flex items-center gap-2 bg-[#1E8C60] px-4 py-2.5 text-[12.5px] font-semibold text-white">
                      <Receipt className="h-4 w-4" /> Ücretinize etkisi
                    </div>
                    <div className="space-y-1.5 px-4 py-4 text-[13px] leading-relaxed text-[#2A2027]">
                      {lines ? (
                        <>
                          <p>{lines.headline} <b>{tl(lines.current)}</b> <ArrowRight className="inline h-3.5 w-3.5 text-[#74616A]" /> <b className="text-[#1E8C60]">{tl(lines.next)}</b> <span className="text-[#74616A]">(KDV dahil, {lines.branchesAfter} şube)</span></p>
                          <p className="text-[#74616A]">{lines.note}</p>
                        </>
                      ) : (
                        <p className="text-[#74616A]">Paketiniz şube başına ücretlendirilmiyor; şube silmek ücretinizi değiştirmez.</p>
                      )}
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#A5556E]/30 bg-[#FCF3F6] px-4 py-3 text-[12.5px] leading-relaxed text-[#5A1730]">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#A5556E]" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                    <span><b>{branch.name}</b> şubesinin silineceğini ve bütün kayıtlarının <b>{targetName}</b> şubesine aktarılacağını anladım.</span>
                  </label>
                </>
              )}

              {error ? (
                <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#EAD8DF] bg-[#F7F6F6] px-6 py-4">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#74616A] transition hover:bg-white">Vazgeç</button>
              {preview && !preview.blocker ? (
                <button type="button" onClick={() => void submit()} disabled={busy || !acknowledged || !targetId}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_14px_30px_-16px_rgba(225,29,72,0.8)] transition hover:bg-rose-700 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Şubeyi sil
                </button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
