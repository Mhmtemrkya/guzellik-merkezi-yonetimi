'use client'

import { useState } from 'react'
import { Ban, ShieldCheck, Loader2, Clock3, X } from 'lucide-react'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'

/** Müşteri detayında kara liste kontrolü — kara listedekiye randevu verilemez. */
export default function CustomerBlacklistCard({
  customerId,
  tenantId,
  isBlacklisted,
  reason,
  onChanged,
}: {
  customerId: string
  tenantId?: string
  isBlacklisted: boolean
  reason?: string | null
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reasonText, setReasonText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const apply = async (blacklisted: boolean) => {
    setBusy(true); setMsg('')
    try {
      const res = await adminApi.setCustomerBlacklist(customerId, { blacklisted, reason: blacklisted ? (reasonText.trim() || null) : null }, tenantId)
      if (isPendingApprovalResult(res)) setMsg('Onaya gönderildi')
      else { setOpen(false); setReasonText(''); onChanged?.() }
    } catch { setMsg('İşlem başarısız') } finally { setBusy(false); setTimeout(() => setMsg(''), 3500) }
  }

  if (isBlacklisted) {
    return (
      <div className="rounded-[16px] border border-rose-200 bg-rose-50/70 p-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-rose-600">
          <Ban className="h-3.5 w-3.5" /> Kara listede
        </div>
        <div className="mt-1 text-[11.5px] text-rose-700/80">Bu müşteriye randevu verilemez.{reason ? ` Sebep: ${reason}` : ''}</div>
        <button type="button" disabled={busy} onClick={() => apply(false)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Kara listeden çıkar
        </button>
        {msg && <div className="mt-1.5 text-[10.5px] text-rose-600/70">{msg}</div>}
      </div>
    )
  }

  return (
    <div className="rounded-[16px] border border-[#ead8df]/70 bg-white/70 p-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-[11.5px] font-semibold text-rose-600 transition hover:bg-rose-100/60">
          <Ban className="h-3.5 w-3.5" /> Kara listeye al
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-rose-600">
            <Ban className="h-3.5 w-3.5" /> Kara listeye al
          </div>
          <input value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Sebep (opsiyonel) — ör. tekrar no-show"
            className="w-full rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-rose-300" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); setReasonText('') }}
              className="inline-flex items-center gap-1 rounded-lg border border-[#ead8df] bg-white px-2.5 py-1 text-[11.5px] text-[#352432]/60"><X className="h-3 w-3" /> Vazgeç</button>
            <button type="button" disabled={busy} onClick={() => apply(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1 text-[11.5px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Kara listeye al
            </button>
          </div>
        </div>
      )}
      {msg && <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-amber-600"><Clock3 className="h-3 w-3" /> {msg}</div>}
    </div>
  )
}
