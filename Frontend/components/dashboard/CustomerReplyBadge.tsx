'use client'

import { useState } from 'react'
import { CalendarClock, CalendarCheck2, CheckCircle2, Hourglass, Loader2, XCircle } from 'lucide-react'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import type { WhatsAppConfirmation } from '@/lib/types'

/**
 * Müşterinin WhatsApp hatırlatmasına verdiği yanıt — randevu listesi, gün takvimi ve aylık takvimde ORTAK görünüm.
 *
 * Palet kuralı (globals.css --bd-*): yüzey rengin KENDİSİ (soluk tint değil), üstünde beyaz yazı; pembe üzerinde
 * koyu yazı. "Erteleme istedi" lacivert şerittir ve yanında aksiyon taşır: müşteri somut bir zaman önerdiyse
 * "Bu saate taşı" (tek tık, çakışma sunucuda denetlenir), her durumda "Yeni saat ver" (düzenleme penceresi).
 */
const META: Record<Exclude<WhatsAppConfirmation, 'None'>, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  Pending: { label: 'Yanıt bekleniyor', cls: 'bg-[#F9A1B9] text-[#5A1730]', Icon: Hourglass },
  Confirmed: { label: 'Gelecek', cls: 'bg-[#A5556E] text-white', Icon: CheckCircle2 },
  Declined: { label: 'Gelmeyecek', cls: 'bg-[#8E7882] text-white', Icon: XCircle },
  RescheduleRequested: { label: 'Erteleme istedi', cls: 'bg-[#1E4E8C] text-white', Icon: CalendarClock },
}

export function formatProposal(utc: string): string {
  const d = new Date(utc)
  return d.toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CustomerReplyBadge({
  confirmation = 'None',
  appointmentId,
  proposalUtc,
  durationMinutes,
  tenantId,
  compact = false,
  onReschedule,
  onChanged,
}: {
  confirmation?: WhatsAppConfirmation
  appointmentId?: string
  proposalUtc?: string | null
  durationMinutes?: number
  tenantId?: string
  /** Takvim kartı gibi dar yerler: yalnız rozet, aksiyon yok. */
  compact?: boolean
  onReschedule?: () => void
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!confirmation || confirmation === 'None') return null
  const meta = META[confirmation]
  if (!meta) return null
  const { Icon } = meta
  const isReschedule = confirmation === 'RescheduleRequested'

  const moveToProposal = async () => {
    if (!appointmentId || !proposalUtc) return
    setBusy(true); setMsg('')
    try {
      const start = new Date(proposalUtc)
      const end = new Date(start.getTime() + Math.max(15, durationMinutes || 60) * 60_000)
      const res = await adminApi.rescheduleAppointment(appointmentId, { startUtc: start.toISOString(), endUtc: end.toISOString() }, tenantId)
      setMsg(isPendingApprovalResult(res) ? 'Onaya gönderildi' : 'Taşındı ✓')
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : 'Taşınamadı')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${compact ? '' : 'max-w-full'}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold shadow-sm ${meta.cls}`}
        title={isReschedule && proposalUtc ? `Önerdiği zaman: ${formatProposal(proposalUtc)}` : undefined}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {meta.label}
        {isReschedule && proposalUtc && <span className="font-medium opacity-95">· {formatProposal(proposalUtc)}</span>}
      </span>
      {isReschedule && !compact && (
        <>
          {proposalUtc && appointmentId && (
            <button
              type="button"
              onClick={() => void moveToProposal()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-[#1E4E8C] bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[#1E4E8C] transition hover:bg-[#1E4E8C] hover:text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarCheck2 className="h-3 w-3" />} Bu saate taşı
            </button>
          )}
          {onReschedule && (
            <button
              type="button"
              onClick={onReschedule}
              className="inline-flex items-center gap-1 rounded-md border border-[#1E4E8C]/50 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[#1E4E8C] transition hover:border-[#1E4E8C]"
            >
              <CalendarClock className="h-3 w-3" /> Yeni saat ver
            </button>
          )}
          {msg && <span className="text-[10.5px] font-medium text-[#4a3a44]">{msg}</span>}
        </>
      )}
    </span>
  )
}
