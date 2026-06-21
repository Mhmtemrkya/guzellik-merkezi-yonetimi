'use client'

import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { authApi } from '@/lib/apiClient'
import { initialsFromName } from '@/lib/apiMappers'
import { BadgeCheck, Building2, KeyRound, Mail, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ApiUser } from '@/lib/types'

export default function PersonelProfilPage() {
  const { user } = useAuth()
  const { selectedInstitution, selectedInstitutionId, selectedBranch, selectedBranchId } = useBranch()
  const { data: me, loading, error } = useApiQuery<ApiUser | null>(
    () => authApi.me(),
    [],
    { initialData: (user as ApiUser | null) ?? null, clearOnError: false },
  )
  const profile = (me || user || {}) as Partial<ApiUser> & { roleLabel?: string }
  const permissions: string[] = profile.permissions || user?.permissions || []

  const statCards: Array<[string, string | number, LucideIcon]> = [
    ['E-posta', profile.email || 'Yok', Mail],
    [
      'Tenant',
      selectedInstitution?.name || selectedInstitutionId || profile.tenantId || 'Seçilmedi',
      Building2,
    ],
    [
      'Şube',
      selectedBranch?.name || selectedBranchId || profile.branchId || 'Seçilmedi',
      BadgeCheck,
    ],
    ['Yetki sayısı', permissions.length, KeyRound],
  ]

  return (
    <>
      <Topbar
        title="Profil"
        subtitle="Auth /me endpoint’i ve tenant-branch context üzerinden canlı oturum bilgisi"
        breadcrumbs={['Personel', 'Profil']}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && !profile?.email}
          emptyMessage="Oturum profili bulunamadı; yeniden giriş gerekiyor."
        />

        <section className="grid gap-6 lg:grid-cols-[.75fr_1fr]">
          <div className="border border-[#fff4f8]/15 p-6">
            <div className="flex h-20 w-20 items-center justify-center border border-[#fff4f8]/20 font-display text-3xl">
              {initialsFromName(profile.fullName || profile.email)}
            </div>
            <h2 className="mt-6 font-display text-5xl leading-none tracking-tight">
              {profile.fullName || profile.email || 'Kullanıcı'}
            </h2>
            <div className="mt-3 text-sm text-[#fff4f8]/55">
              {profile.roleLabel || profile.role || 'Rol bilgisi yok'}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <AdminEditDialog
                triggerLabel="Profil düzenle"
                title="Profil bilgilerim"
                description="Profil düzenleme backend endpoint’i henüz ayrı değil; mevcut değerler Auth /me üzerinden okunur."
                note="Profil güncelleme endpoint’i eklendiğinde bu form submit edilecek; şu an fake kayıt yapılmaz."
                fields={[
                  { label: 'Ad soyad', value: profile.fullName || '' },
                  { label: 'E-posta', type: 'email', value: profile.email || '' },
                  { label: 'Rol', value: profile.role || '' },
                ]}
              />
              <AdminEditDialog
                triggerVariant="ghost"
                triggerLabel="Parola"
                title="Parola değiştirme"
                description="Parola değiştirme endpoint’i eklenene kadar fake işlem yapılmaz."
                note="Güvenli parola değişimi için eski parola + yeni parola backend endpoint’i bekleniyor."
                fields={[
                  { label: 'Mevcut parola', value: '' },
                  { label: 'Yeni parola', value: '' },
                  { label: 'Yeni parola tekrar', value: '' },
                ]}
              />
            </div>
          </div>

          <div className="grid gap-px border border-[#fff4f8]/10 bg-[#fff4f8]/10 sm:grid-cols-2">
            {statCards.map(([label, value, Icon]) => (
              <div key={label} className="bg-[#2f1724] p-5">
                <Icon className="h-4 w-4 text-[#fff4f8]/55" />
                <div className="mt-5 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/40">{label}</div>
                <div className="mt-2 truncate text-sm text-[#fff4f8]/80">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-[#fff4f8]/15">
          <div className="flex items-center justify-between border-b border-[#fff4f8]/15 px-5 py-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">Auth permissions</div>
              <div className="font-display text-2xl tracking-tight">Canlı yetki anahtarları</div>
            </div>
            <ShieldCheck className="h-5 w-5 text-[#fff4f8]/45" />
          </div>
          <div className="flex flex-wrap gap-2 p-5">
            {permissions.map((permission) => (
              <span
                key={permission}
                className="border border-[#fff4f8]/15 px-2 py-1 text-[10px] font-mono text-[#fff4f8]/60"
              >
                {permission}
              </span>
            ))}
            {!permissions.length && (
              <div className="text-sm text-[#fff4f8]/45">Bu kullanıcı için permission listesi boş döndü.</div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
