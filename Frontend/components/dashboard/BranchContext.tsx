'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { adminApi, pagedItems, setApiScope } from '@/lib/apiClient'
import { useAuth } from './AuthContext'
import type { ApiBranch, Branch, Institution } from '@/lib/types'

const BRANCH_KEY = 'armonessa.selectedBranchId'
const INSTITUTION_KEY = 'armonessa.selectedInstitutionId'

interface BranchContextValue {
  institutions: Institution[]
  selectedInstitution: Institution | null
  selectedInstitutionId: string | null
  branches: Branch[]
  selectedBranch: Branch | null
  selectedBranchId: string | null
  setBranch: (branchId: string | null) => void
  setScope: (institutionId: string | null, branchId: string | null) => void
  /** Şube ekleme/güncelleme sonrası navbar dropdown'ını re-login olmadan tazeler. */
  refreshBranches: () => void
}

const BranchContext = createContext<BranchContextValue | null>(null)

interface ScopeInstitutionInput {
  id?: string
  tenantId?: string
  name?: string
  tenantName?: string
  plan?: string
  status?: string
  branches?: ApiBranch[]
}

function normalizeBranchEntry(branch: ApiBranch): Branch {
  const id = branch.id || branch.branchId || ''
  return {
    id,
    branchId: id,
    name: branch.name || branch.branchName || 'Şube',
    branchName: branch.branchName || branch.name || 'Şube',
    city: branch.city || 'Şube',
    isDefault: Boolean(branch.isDefault),
    staff: branch.staffCount ?? branch.staff ?? 0,
    rooms: branch.roomCount ?? branch.rooms ?? 0,
    todayAppointments: branch.todayAppointments || 0,
    monthlyRevenue: branch.monthlyRevenue || 0,
  }
}

function normalizeInstitution(institution: ScopeInstitutionInput | null | undefined): Institution | null {
  if (!institution) return null
  const id = institution.id || institution.tenantId || ''
  return {
    id,
    tenantId: id,
    name: institution.name || institution.tenantName || 'Kurum',
    tenantName: institution.tenantName || institution.name || 'Kurum',
    plan: institution.plan || 'Aktif plan',
    status: institution.status || 'active',
    branches: (institution.branches || []).map(normalizeBranchEntry),
  }
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { session, setSession } = useAuth()
  const authInstitutions = useMemo<Institution[]>(
    () =>
      (session?.scope?.tenants || [])
        .map((tenant) => normalizeInstitution(tenant as ScopeInstitutionInput))
        .filter((tenant): tenant is Institution => tenant !== null),
    [session?.scope],
  )
  const institutions = authInstitutions
  const defaultInstitution: Institution | undefined = institutions[0]

  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(
    session?.selectedTenantId || defaultInstitution?.id || null,
  )
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(
    session?.selectedBranchId ||
      defaultInstitution?.branches?.find((b) => b.isDefault)?.id ||
      defaultInstitution?.branches?.[0]?.id ||
      null,
  )

  // Canlı şube listesi: session.scope yalnızca login anındaki şubeleri tutar. Yeni eklenen şube
  // re-login olmadan görünsün + doğru personel/oda sayısı gelsin diye seçili kurumun şubelerini API'den çekeriz.
  const [liveBranches, setLiveBranches] = useState<Branch[] | null>(null)
  const [branchRefreshKey, setBranchRefreshKey] = useState(0)
  const refreshBranches = useCallback(() => setBranchRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedInstitution = window.localStorage.getItem(INSTITUTION_KEY)
    const savedBranch = window.localStorage.getItem(BRANCH_KEY)
    setSelectedInstitutionId(session?.selectedTenantId || savedInstitution || defaultInstitution?.id || null)
    setSelectedBranchId(
      session?.selectedBranchId ||
        savedBranch ||
        defaultInstitution?.branches?.find((b) => b.isDefault)?.id ||
        defaultInstitution?.branches?.[0]?.id ||
        null,
    )
  }, [session?.selectedTenantId, session?.selectedBranchId, defaultInstitution?.id])

  const selectedInstitution = useMemo<Institution | null>(
    () =>
      institutions.find((k) => k.id === selectedInstitutionId || k.tenantId === selectedInstitutionId) ||
      defaultInstitution ||
      null,
    [institutions, selectedInstitutionId, defaultInstitution],
  )
  const scopeBranches = selectedInstitution?.branches || []
  const activeInstitutionId = selectedInstitution?.id || selectedInstitutionId

  useEffect(() => {
    if (!session?.accessToken || !activeInstitutionId) {
      setLiveBranches(null)
      return
    }
    let cancelled = false
    adminApi
      .branches<ApiBranch>(activeInstitutionId)
      .then((res) => {
        if (!cancelled) setLiveBranches(pagedItems<ApiBranch>(res).map(normalizeBranchEntry))
      })
      .catch(() => {
        if (!cancelled) setLiveBranches(null)
      })
    return () => {
      cancelled = true
    }
  }, [session?.accessToken, activeInstitutionId, branchRefreshKey])

  // Canlı liste varsa onu kullan (yeni şube + doğru sayımlar); yoksa login-scope'a düş.
  const branches = liveBranches ?? scopeBranches
  const fallbackBranch: Branch | undefined = branches.find((b) => b.isDefault) || branches[0]
  const selectedBranch = useMemo<Branch | null>(
    () =>
      branches.find((b) => b.id === selectedBranchId || b.branchId === selectedBranchId) || fallbackBranch || null,
    [branches, selectedBranchId, fallbackBranch],
  )

  const setScope = (institutionId: string | null, branchId: string | null): void => {
    const institution =
      institutions.find((k) => k.id === institutionId || k.tenantId === institutionId) || defaultInstitution
    const institutionBranches = institution?.branches || []
    const branch =
      institutionBranches.find((b) => b.id === branchId || b.branchId === branchId) ||
      institutionBranches.find((b) => b.isDefault) ||
      institutionBranches[0]
    const nextInstitutionId = institution?.id || institutionId || null
    const nextBranchId = branch?.id || branchId || null

    setSelectedInstitutionId(nextInstitutionId)
    setSelectedBranchId(nextBranchId)
    if (typeof window !== 'undefined') {
      if (nextInstitutionId) window.localStorage.setItem(INSTITUTION_KEY, nextInstitutionId)
      else window.localStorage.removeItem(INSTITUTION_KEY)
      if (nextBranchId) window.localStorage.setItem(BRANCH_KEY, nextBranchId)
      else window.localStorage.removeItem(BRANCH_KEY)
    }
    setApiScope({ tenantId: nextInstitutionId, branchId: nextBranchId })

    if (session?.accessToken) {
      setSession({
        ...session,
        selectedTenantId: nextInstitutionId,
        selectedBranchId: nextBranchId,
      })
    }
  }

  // Şube-içi geçiş: tıklanan şubeyi doğrudan uygula (setScope'un "scope'ta yoksa default'a düş"
  // davranışı yeni eklenen şubeye geçişi engelliyordu).
  const setBranch = (branchId: string | null): void => {
    const tenantId = selectedInstitution?.id || selectedInstitutionId
    setSelectedBranchId(branchId)
    if (typeof window !== 'undefined') {
      if (branchId) window.localStorage.setItem(BRANCH_KEY, branchId)
      else window.localStorage.removeItem(BRANCH_KEY)
    }
    setApiScope({ tenantId, branchId })
    if (session?.accessToken) {
      setSession({ ...session, selectedBranchId: branchId })
    }
  }

  useEffect(() => {
    if (session?.accessToken) {
      setApiScope({
        tenantId:
          selectedInstitution?.id ||
          selectedInstitutionId ||
          session.selectedTenantId ||
          session.user?.tenantId,
        branchId:
          selectedBranch?.id || selectedBranchId || session.selectedBranchId || session.user?.branchId,
      })
    }
  }, [
    session?.accessToken,
    session?.selectedTenantId,
    session?.selectedBranchId,
    session?.user?.tenantId,
    session?.user?.branchId,
    selectedInstitution?.id,
    selectedInstitutionId,
    selectedBranch?.id,
    selectedBranchId,
  ])

  const value: BranchContextValue = {
    institutions,
    selectedInstitution,
    selectedInstitutionId: selectedInstitution?.id || selectedInstitutionId,
    branches,
    selectedBranch,
    selectedBranchId: selectedBranch?.id || selectedBranchId,
    setBranch,
    setScope,
    refreshBranches,
  }

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

const fallbackBranch: BranchContextValue = {
  institutions: [],
  selectedInstitution: null,
  selectedInstitutionId: null,
  branches: [],
  selectedBranch: null,
  selectedBranchId: null,
  setBranch: () => {},
  setScope: () => {},
  refreshBranches: () => {},
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  return ctx ?? fallbackBranch
}
