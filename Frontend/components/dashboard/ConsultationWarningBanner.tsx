'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ClipboardPen, FileWarning, ShieldAlert, ShieldCheck } from 'lucide-react'
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
  onEdit,
  refreshKey = 0,
}: {
  customerId?: string
  tenantId?: string
  className?: string
  /**
   * Verilirse bandın içinde formu açan bir buton çıkar ("Formu doldur" / "Formu aç").
   * Randevu verilirken eksik form için müşteri kartına gidip akışı bölmek gerekmesin.
   */
  onEdit?: () => void
  /** Form kaydedildikten sonra bandı tazelemek için sayaç. */
  refreshKey?: number
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
  }, [allowed, customerId, tenantId, refreshKey])

  if (!allowed || !customerId || !ready) return null

  /** Bandın içindeki "formu aç" butonu — yalnız çağıran istediğinde. */
  const editButton = (label: string, tone: 'amber' | 'plain'): ReactNode =>
    onEdit ? (
      <button
        type="button"
        onClick={onEdit}
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition-colors ${
          tone === 'amber'
            ? 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'
            : 'border-[#e8c2d1] bg-white text-[#8e3f5b] hover:bg-[#fff4f8]'
        }`}
      >
        <ClipboardPen className="h-3 w-3" strokeWidth={2} />
        {label}
      </button>
    ) : null

  if (missing) {
    return (
      <div className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 ${className}`}>
        <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">Müşteri bilgi ve onay formu doldurulmamış. İşlemden önce alınması önerilir.</span>
        {editButton('Formu doldur', 'amber')}
      </div>
    )
  }

  if (!form) return null

  const warnings = deriveConsultationWarnings(form)
  const highCount = warnings.filter((w) => w.severity === 'high').length

  if (warnings.length === 0) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700 ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">Müşteri bilgi formu mevcut · belirgin işlem uygunluğu uyarısı yok.</span>
        {editButton('Formu aç', 'plain')}
      </div>
    )
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#b14d6c]">
        <ShieldAlert className="h-3.5 w-3.5" /> İşlem uygunluğu uyarıları ({warnings.length}{highCount > 0 ? ` · ${highCount} yüksek` : ''})
        <span className="ml-auto">{editButton('Formu aç', 'plain')}</span>
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
