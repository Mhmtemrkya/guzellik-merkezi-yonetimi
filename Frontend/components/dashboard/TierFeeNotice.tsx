'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Receipt } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { guidOrUndefined } from '@/lib/apiMappers'
import { tierFeeView, type TierFeeDimension } from '@/lib/tierFee'
import type { TierAllowance } from '@/lib/types'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useBranch } from '@/components/dashboard/BranchContext'

/**
 * "Ücretinize bu kadar yansıyacak" uyarısı — kayıtlı müşteri / imzalı onam kademesi (bkz. `lib/tierFee.ts`).
 * Faturalama bilgisini yalnız kurum sahibi ve platform yöneticisi görür (uç personele 403 döner); diğerlerine
 * `fallback` (nötr metin) gösterilir. `bare` = dış kutu yok (hata kutusunun içine gömmek için).
 */
export default function TierFeeNotice({
  dimension,
  reached = false,
  fallback = null,
  bare = false,
  refreshKey,
}: {
  dimension: TierFeeDimension
  /** Sunucu az önce 409 `CustomerLimitReached` / `ConsentLimitReached` döndü. */
  reached?: boolean
  fallback?: ReactNode
  bare?: boolean
  refreshKey?: unknown
}) {
  const { user } = useAuth()
  const { selectedInstitutionId } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const billing = user?.role === 'InstitutionOwner' || user?.role === 'PlatformAdmin'
  const { data } = useApiQuery<TierAllowance | null>(
    () => {
      if (!billing) return Promise.resolve(null)
      const request = dimension === 'customers'
        ? adminApi.customerAllowance<TierAllowance>(tenantId)
        : adminApi.consentAllowance<TierAllowance>(tenantId)
      return request.catch(() => null)
    },
    [dimension, tenantId, billing, reached, refreshKey],
    { initialData: null },
  )
  const view = tierFeeView(data, dimension, reached)
  if (!view) return <>{fallback}</>

  const red = view.tone === 'reached'
  const body = (
    <>
      <div className="flex items-start gap-2 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{view.title}</span></div>
      {view.fee ? <p className="mt-1.5 flex items-start gap-2"><Receipt className="mt-0.5 h-4 w-4 shrink-0" /><span>{view.fee}</span></p> : null}
      {view.today ? <p className="mt-1 pl-6">{view.today}</p> : null}
      {view.invoice ? <p className="mt-1 pl-6">{view.invoice}</p> : null}
      <Link href="/panel/paket" className="mt-2 inline-flex items-center gap-1 pl-6 font-semibold underline underline-offset-2">
        Paketim&apos;den kademeyi yönetin <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </>
  )
  if (bare) return <div className="mt-2 text-[12px] font-normal leading-relaxed">{body}</div>
  return (
    <div role={red ? 'alert' : 'status'}
      className={`rounded-[12px] border px-3.5 py-3 text-[12.5px] leading-relaxed ${red ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      {body}
    </div>
  )
}
