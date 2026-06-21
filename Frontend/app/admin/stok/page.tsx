'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ProductLibrary from '@/components/dashboard/ProductLibrary'
import { useBranch } from '@/components/dashboard/BranchContext'
import { guidOrUndefined } from '@/lib/apiMappers'

type ScopeKey = 'all' | 'critical' | 'sale' | 'consumable'

function StokPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && ['all', 'critical', 'sale', 'consumable'].includes(scopeParam) ? scopeParam : 'all'

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)

  return (
    <ProductLibrary
      key={scope}
      tenantId={tenantId}
      branchId={branchId}
      institutionName={selectedInstitution?.name}
      branchLabel={selectedBranch?.name}
      initialTab={scope}
    />
  )
}

export default function StokPage() {
  return (
    <Suspense fallback={null}>
      <StokPageInner />
    </Suspense>
  )
}
