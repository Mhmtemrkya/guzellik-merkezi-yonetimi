'use client'

import Topbar from './Topbar'
import ApiStateNotice from './ApiStateNotice'
import { useAuth } from './AuthContext'
import { useBranch } from './BranchContext'
import { realModuleNotice } from '@/lib/apiMappers'
import { AlertTriangle, Boxes, Database, Link2, ShieldCheck } from 'lucide-react'

interface MissingBackendModuleProps {
  title: string
  moduleName?: string
  breadcrumbs?: string[]
  description?: string
  expectedModels?: string[]
  availableApis?: string[]
}

export default function MissingBackendModule({
  title,
  moduleName,
  breadcrumbs = [],
  description,
  expectedModels = [],
  availableApis = ['Auth', 'Tenant', 'Branch', 'Customer', 'Staff', 'ServiceDefinition', 'Appointment'],
}: MissingBackendModuleProps) {
  const { user, isAuthenticated } = useAuth()
  const { selectedInstitution, selectedInstitutionId, selectedBranch, selectedBranchId } = useBranch()
  const scopeLines: Array<[string, string]> = [
    [
      'Oturum',
      isAuthenticated
        ? `${user?.roleLabel || user?.role || 'Kullanıcı'} · ${user?.email || 'e-posta yok'}`
        : 'Giriş bekleniyor',
    ],
    ['Tenant', selectedInstitution?.name || selectedInstitutionId || user?.tenantId || 'Seçilmedi'],
    ['Şube', selectedBranch?.name || selectedBranchId || user?.branchId || 'Tüm şubeler / seçilmedi'],
  ]

  return (
    <>
      <Topbar
        title={title}
        subtitle="Bu panelde fake operasyon verisi kapalı; yalnızca backend modeli olan API’ler canlı gösterilir."
        breadcrumbs={breadcrumbs}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice missingModule={realModuleNotice(moduleName || title)} />

        <section className="grid gap-6 lg:grid-cols-[1fr_.72fr]">
          <div className="border border-[#EAD8DF] bg-[radial-gradient(circle_at_top_right,rgba(240,170,194,0.12),transparent_36%)] p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#74616A]">
              <AlertTriangle className="h-4 w-4" /> Backend modeli bekleniyor
            </div>
            <h2 className="mt-5 max-w-3xl font-display text-4xl leading-[0.95] tracking-tight lg:text-6xl">
              Sahte kayıt yerine gerçek entegrasyon durumu gösteriliyor.
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-[#5A4B53]">
              {description ||
                `${moduleName || title} için domain entity, DTO, endpoint ve yetki kuralı backend’e eklendiğinde bu sayfa aynı apiClient/auth/tenant/branch context temeliyle canlı veriye bağlanacak.`}
            </p>
            <div className="mt-8 grid gap-px border border-[#EAD8DF]/65 bg-[#F6DFE6]/72 sm:grid-cols-3">
              {scopeLines.map(([label, value]) => (
                <div key={label} className="bg-white p-4">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-[#74616A]">{label}</div>
                  <div className="mt-3 truncate text-[13px] text-[#2A2027]/80">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="border border-[#EAD8DF] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.26em] text-[#74616A]">
                  Entegrasyon kontratı
                </div>
                <div className="mt-2 font-display text-3xl tracking-tight">Eksik backend parçaları</div>
              </div>
              <Database className="h-5 w-5 text-[#5A4B53]" />
            </div>
            <div className="mt-6 space-y-3">
              {(expectedModels.length
                ? expectedModels
                : ['Domain entity', 'Application DTO/service', 'Minimal API endpoint', 'Role/permission policy']
              ).map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 border border-[#EAD8DF]/65 bg-white/74 p-3 text-sm text-[#5A4B53]"
                >
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-[#74616A]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="border border-[#EAD8DF]">
          <div className="flex flex-col gap-3 border-b border-[#EAD8DF] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Canlı API temeli</div>
              <div className="font-display text-2xl tracking-tight">Bu ekranda hazır kullanılan ortak altyapı</div>
            </div>
            <ShieldCheck className="h-5 w-5 text-[#74616A]" />
          </div>
          <div className="grid gap-px bg-[#F7F6F6]/10 md:grid-cols-2 xl:grid-cols-4">
            {availableApis.map((api) => (
              <div key={api} className="bg-white p-5">
                <Link2 className="h-4 w-4 text-[#5A4B53]" />
                <div className="mt-5 font-display text-2xl tracking-tight">{api}</div>
                <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-[#74616A]">
                  hazır endpoint/client
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
