'use client'

import { useState } from 'react'
import { MessageCircle, Loader2 } from 'lucide-react'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import { useFeature } from '@/components/dashboard/FeatureContext'
import type { WhatsAppConfirmation, ApiWhatsAppReminderResult } from '@/lib/types'

const CONF_META: Record<WhatsAppConfirmation, { label: string; cls: string } | null> = {
  None: null,
  Pending: { label: 'Onay bekliyor', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  Confirmed: { label: 'Onaylandı', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Declined: { label: 'İptal etti', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  RescheduleRequested: { label: 'Erteleme istedi', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
}

/** Randevu için WhatsApp onay rozeti + "Hatırlat" düğmesi. */
export default function AppointmentReminderControl({
  appointmentId,
  confirmation = 'None',
  tenantId,
  onChanged,
}: {
  appointmentId: string
  confirmation?: WhatsAppConfirmation
  tenantId?: string
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [failed, setFailed] = useState(false)
  const allowed = useFeature('notifications.whatsapp')
  const meta = CONF_META[confirmation] ?? null

  if (!allowed) return null

  const send = async () => {
    setBusy(true); setMsg(''); setFailed(false)
    let hideAfterMs = 3000
    try {
      const res = await adminApi.sendWhatsappReminder<ApiWhatsAppReminderResult>(appointmentId, tenantId)
      if (isPendingApprovalResult(res)) setMsg('Onaya gönderildi')
      else { setMsg(res?.simulated ? 'Gönderildi (simülasyon)' : 'Gönderildi ✓'); onChanged?.() }
    } catch (e) {
      // SUNUCUNUN SEBEBİNİ GÖSTER. Buradaki mesaj kullanıcının çözebileceği tek bilgi:
      // "24 saat penceresi kapalı, onaylı şablon tanımlı değil", "aylık kota doldu",
      // "kontör yetersiz", "kampanya mesajları kapalı"… Genel "Gönderilemedi" yazmak bunu yutuyordu
      // (mobilde zaten sebep gösteriliyordu — parite).
      setFailed(true)
      setMsg(e instanceof Error && e.message ? e.message : 'Gönderilemedi')
      hideAfterMs = 9000 // hata metni okunacak kadar ekranda kalsın
    } finally {
      setBusy(false)
      setTimeout(() => { setMsg(''); setFailed(false) }, hideAfterMs)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {meta && <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        title="WhatsApp hatırlatması gönder"
        className="inline-flex items-center gap-1 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-2 py-1 text-[10.5px] font-semibold text-[#1da851] transition hover:bg-[#25D366]/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />} Hatırlat
      </button>
      {msg && (
        <span
          title={msg}
          className={`max-w-[280px] text-[10px] font-medium leading-snug ${failed ? 'text-rose-600' : 'text-[#5A4B53]'}`}
        >
          {msg}
        </span>
      )}
    </div>
  )
}
