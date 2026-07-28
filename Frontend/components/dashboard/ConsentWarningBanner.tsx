'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, FileSignature, ShieldAlert } from 'lucide-react'
import ConsentCenterModal from '@/components/dashboard/ConsentCenterModal'
import { useBranch } from '@/components/dashboard/BranchContext'
import { consentApi } from '@/lib/apiClient'
import { guidOrUndefined } from '@/lib/apiMappers'
import { missingRequirements } from '@/lib/consent'
import type { ApiConsentStatus } from '@/lib/types'

/**
 * "Onam formu eksik" uyarısı — müşteri kartı, cari hesap ve adisyon ekranlarında ortak.
 *
 * Sessizdir: eksik yoksa (ya da hiç form tanımlı değilse) hiçbir şey çizmez; yalnız
 * [showWhenComplete] verilirse tamam durumunu da yeşil satır olarak gösterir.
 * Uyarıya tıklayınca onam merkezi açılır — personel formu oradan tablete gönderir.
 */
export default function ConsentWarningBanner({
  customerId,
  customerName,
  appointmentId,
  compact = false,
  showWhenComplete = false,
  className = '',
}: {
  customerId?: string | null
  customerName?: string | null
  appointmentId?: string | null
  /** Dar alanlar (adisyon başlığı, cari satırı) için tek satırlık ince biçim. */
  compact?: boolean
  showWhenComplete?: boolean
  className?: string
}) {
  const { selectedInstitutionId } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const [status, setStatus] = useState<ApiConsentStatus | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!customerId) return
    try {
      const st = appointmentId
        ? await consentApi.appointmentStatus<ApiConsentStatus>(appointmentId, tenantId)
        : await consentApi.customerStatus<ApiConsentStatus>(customerId, tenantId)
      setStatus(st)
    } catch {
      // Onam özelliği kapalı ya da uç erişilemez — uyarı hiç gösterilmez.
      setStatus(null)
    }
  }, [customerId, appointmentId, tenantId])

  useEffect(() => { void load() }, [load])

  if (!customerId || !status) return null
  const missing = missingRequirements(status)
  const total = status.requiredCount ?? 0
  if (total === 0) return null
  if (missing.length === 0 && !showWhenComplete) return null

  const complete = missing.length === 0

  return (
    <>
      <motion.button
        type="button"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2.5 rounded-[12px] border px-3.5 text-left transition-colors ${
          compact ? 'py-2' : 'py-3'
        } ${
          complete
            ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70'
            : 'border-amber-200 bg-amber-50 hover:bg-amber-100/70'
        } ${className}`}
      >
        {complete ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block text-[12.5px] font-semibold ${complete ? 'text-emerald-800' : 'text-amber-900'}`}>
            {complete ? 'Onam formları tamam' : `${missing.length} onam formu imzasız`}
          </span>
          {!compact && (
            <span className={`mt-0.5 block text-[11.5px] ${complete ? 'text-emerald-700' : 'text-amber-900/80'}`}>
              {complete
                ? `${status.signedCount ?? 0}/${total} form imzalı.`
                : `${missing.map((m) => m.title).join(' · ')} — görüntülemek için tıklayın.`}
            </span>
          )}
        </span>
        {!complete && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] bg-white/70 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-900">
            <FileSignature className="h-3.5 w-3.5" /> Formlar
          </span>
        )}
      </motion.button>

      <ConsentCenterModal
        open={open}
        onClose={() => { setOpen(false); void load() }}
        customerId={customerId}
        customerName={customerName}
        appointmentId={appointmentId}
        onChanged={load}
      />
    </>
  )
}
