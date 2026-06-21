'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import CategoryExplorer from '@/components/dashboard/CategoryExplorer'
import PackageLibrary from '@/components/dashboard/PackageLibrary'
import ServiceLibrary from '@/components/dashboard/ServiceLibrary'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { guidOrUndefined } from '@/lib/apiMappers'

type ScopeKey = 'services' | 'packages' | 'active' | 'inactive' | 'categories'

const scopeLabels: Record<ScopeKey, string> = {
  services: 'Hizmet Havuzu',
  packages: 'Paketler',
  active: 'Aktif Hizmetler',
  inactive: 'Pasif Hizmetler',
  categories: 'Kategoriler',
}

function PaketHizmetPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeLabels ? scopeParam : 'services'

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const canCustomServiceCat = useFeature('categories.service.custom')

  if (scope === 'categories') {
    return (
      <CategoryExplorer
        tenantId={tenantId}
        institutionName={selectedInstitution?.name}
        branchLabel={selectedBranch?.name}
      />
    )
  }

  if (scope === 'packages') {
    return (
      <PackageLibrary
        tenantId={tenantId}
        branchId={branchId}
        institutionName={selectedInstitution?.name}
        branchLabel={selectedBranch?.name}
        canCustomServiceCat={canCustomServiceCat}
      />
    )
  }

  return (
    <ServiceLibrary
      tenantId={tenantId}
      branchId={branchId}
      institutionName={selectedInstitution?.name}
      branchLabel={selectedBranch?.name}
      scopeLabel={scopeLabels[scope]}
      canCustomServiceCat={canCustomServiceCat}
    />
  )
}

export default function PaketHizmetPage() {
  return (
    <Suspense fallback={null}>
      <PaketHizmetPageInner />
    </Suspense>
  )
}
