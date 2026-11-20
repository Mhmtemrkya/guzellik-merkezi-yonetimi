'use client'

import { useState } from 'react'
import { BellRing, Loader2, MessageCircle, X } from 'lucide-react'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import { useFeature } from '@/components/dashboard/FeatureContext'
import type { ApiWhatsAppReminderResult } from '@/lib/types'

/** Oluşturma yanıtından randevu kimliğini çıkarır (düz randevu ya da { appointment, sale }). */
export function createdAppointmentId(res: unknown): string | null {
  const r = res as { id?: string; appointment?: { id?: string }; appointmentId?: string } | null | undefined
  return r?.id || r?.appointment?.id || r?.appointmentId || null
}

/**
 * RANDEVU OLUŞTURULUR OLUŞTURULMAZ "hatırlatma hemen gitsin mi?" sorusu (sağ alt kart).
 *
 * "Şimdi gönder" randevuya BAĞLI iki yönlü hatırlatmayı yollar (randevu ekranındaki "Hatırlat" ile aynı uç):
 * müşterinin EVET/HAYIR/ERTELE yanıtı bu randevuya işlenir ve randevuya damga vurulur — otomatik tarama ikinci
 * kez göndermez. "Daha sonra" kartı kapatır; hatırlatma yine otomatik zamanında gider.
 */
export default function ReminderNowPrompt({
  appointmentId,
  customerName,
  tenantId,
  onClose,
  onSent,
}: {
  appointmentId: string
  customerName?: string
  tenantId?: string
  onClose: () => void
  onSent?: () => void
}) {
  const allowed = useFeature('notifications.whatsapp')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [failed, setFailed] = useState(false)
  if (!allowed) return null

  const send = async () => {
    setBusy(true); setMsg(''); setFailed(false)
    try {
      const res = await adminApi.sendWhatsappReminder<ApiWhatsAppReminderResult>(appointmentId, tenantId)
      if (isPendingApprovalResult(res)) setMsg('Onaya gönderildi.')
      else setMsg(res?.simulated ? 'Gönderildi (simülasyon).' : 'Hatırlatma gönderildi ✓')
      onSent?.()
      setTimeout(onClose, 2200)
    } catch (e) {
      setFailed(true)
      setMsg(e instanceof Error && e.message ? e.message : 'Gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[min(360px,calc(100vw-32px))] animate-in fade-in slide-in-from-bottom-3 overflow-hidden rounded-2xl border border-[#EAD8DF] bg-white shadow-[0_18px_40px_-12px_rgba(42,17,25,0.35)]">
      <div className="flex items-center gap-2 bg-[#A5556E] px-4 py-2.5 text-white">
        <BellRing className="h-4 w-4" />
        <span className="flex-1 text-[13px] font-semibold">Randevu oluşturuldu</span>
        <button type="button" onClick={onClose} aria-label="Kapat" className="rounded p-0.5 hover:bg-white/15"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-[#2A2027]">
          {customerName ? <b>{customerName}</b> : 'Müşteriye'}{customerName ? ' adlı müşteriye' : ''} WhatsApp hatırlatması <b>şimdi</b> gönderilsin mi?
          <span className="mt-1 block text-[11.5px] text-[#4a3a44]">Müşteri EVET / HAYIR / ERTELE yazınca randevuya otomatik işlenir.</span>
        </p>
        {msg && <p className={`text-[12px] font-medium ${failed ? 'text-rose-700' : 'text-[#1E4E8C]'}`}>{msg}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#EAD8DF] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#4a3a44]">Daha sonra</button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DA851] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#178a43] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />} Şimdi gönder
          </button>
        </div>
      </div>
    </div>
  )
}
