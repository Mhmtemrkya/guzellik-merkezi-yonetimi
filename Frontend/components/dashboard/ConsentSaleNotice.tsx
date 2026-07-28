'use client'

import { useEffect, useState } from 'react'
import { FileSignature } from 'lucide-react'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import type { ApiConsentTemplate } from '@/lib/types'

/**
 * Satış modallarında "bu kalemin onam formu var" bilgisi.
 *
 * Satışı ENGELLEMEZ — form imzası satış anında değil, işlem/randevu tamamlanırken istenir.
 * Amaç, satışı yapan personelin baştan haberdar olması: müşteri hâlâ salondayken formu
 * imzalatmak, sonradan peşine düşmekten kolaydır.
 *
 * Hiç form bağlı değilse ya da özellik kapalıysa hiçbir şey çizmez.
 */
export default function ConsentSaleNotice({
  packageId,
  serviceId,
  tenantId,
  className = '',
}: {
  packageId?: string | null
  serviceId?: string | null
  tenantId?: string
  className?: string
}) {
  const allowed = useFeature('clinical.consentforms')
  const [titles, setTitles] = useState<string[]>([])

  useEffect(() => {
    if (!allowed || (!packageId && !serviceId)) { setTitles([]); return }
    let cancelled = false
    adminApi
      .consentTemplates<ApiConsentTemplate>(tenantId)
      .then((list) => {
        if (cancelled) return
        const matched = (Array.isArray(list) ? list : [])
          .filter((t) => t.isActive !== false)
          .filter((t) =>
            (packageId && (t.packageIds || []).includes(packageId))
            || (serviceId && (t.serviceIds || []).includes(serviceId)))
          .map((t) => t.title || 'Onam formu')
        setTitles(matched)
      })
      .catch(() => { if (!cancelled) setTitles([]) })
    return () => { cancelled = true }
  }, [allowed, packageId, serviceId, tenantId])

  if (titles.length === 0) return null

  return (
    <div className={`flex items-start gap-2.5 rounded-[12px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 ${className}`}>
      <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-amber-900">
          Bu satışta {titles.length} onam formu isteniyor
        </div>
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-amber-900/80">
          {titles.join(' · ')} — müşteri salondayken imzalatmanız önerilir. İmzalanmadan işlem
          tamamlanmaya çalışılırsa uyarı çıkar.
        </div>
      </div>
    </div>
  )
}
