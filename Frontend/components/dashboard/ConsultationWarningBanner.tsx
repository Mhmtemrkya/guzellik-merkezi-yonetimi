'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, FileWarning, ShieldAlert, ShieldCheck } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { deriveConsultationWarnings } from '@/lib/consultation'
import { useFeature } from '@/components/dashboard/FeatureContext'
import type { ApiConsultationForm } from '@/lib/types'

/**
 * Seçili müşterinin bilgi formundaki işlem uygunluğu uyarılarını gösterir.
 * Randevu ve hizmet/paket satış modallarında müşteri seçilince çıkar.
 * - Form varsa: deriveConsultationWarnings ile uyarılar (kırmızı=yüksek, amber=orta), yoksa uygunluk uyarısı gösterilmez.
 * - Form yoksa: nazik "doldurulmamış" hatırlatması.
 * - Plan özelliği (clinical.consultation) yoksa: hiçbir şey göstermez, istek atmaz.
 */
export default function ConsultationWarningBanner({
  customerId,
  tenantId,
  className = '',
}: {
  customerId?: string
  tenantId?: string
  className?: string
}) {
  const allowed = useFeature('clinical.consultation')
  const [form, setForm] = useState<ApiConsultationForm | null>(null)
  const [missing, setMissing] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setForm(null)
    setMissing(false)
    setReady(false)
    if (!allowed || !customerId) return
    let cancelled = false
    adminApi
      .consultation<ApiConsultationForm | null>(customerId, tenantId)
      .then((f) => {
        if (cancelled) return
        if (f) setForm(f)
        else setMissing(true)
        setReady(true)
      })
      .catch(() => {
        // 403 (plan kapsamı dışı) veya başka hata → sessizce gizle, akışı bozma.
        if (!cancelled) setReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [allowed, customerId, tenantId])

  if (!allowed || !customerId || !ready) return null

  if (missing) {
    return (
      <div className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 ${className}`}>
        <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Müşteri bilgi ve onay formu doldurulmamış. İşlemden önce alınması önerilir.</span>
      </div>
    )
  }

  if (!form) return null

  const warnings = deriveConsultationWarnings(form)
  const highCount = warnings.filter((w) => w.severity === 'high').length

  if (warnings.length === 0) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700 ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Müşteri bilgi formu mevcut · belirgin işlem uygunluğu uyarısı yok.
      </div>
    )
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#b14d6c]">
        <ShieldAlert className="h-3.5 w-3.5" /> İşlem uygunluğu uyarıları ({warnings.length}{highCount > 0 ? ` · ${highCount} yüksek` : ''})
      </div>
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-snug ${
            w.severity === 'high' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><span className="font-semibold">{w.title}</span> — {w.detail}</span>
        </div>
      ))}
    </div>
  )
}
