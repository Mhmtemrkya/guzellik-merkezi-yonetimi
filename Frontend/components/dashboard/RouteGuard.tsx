'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import type { UserRole } from '@/lib/types'

const roleHome: Record<UserRole, string> = {
  PlatformAdmin: '/platform',
  InstitutionOwner: '/admin',
  BranchManager: '/admin',
  Staff: '/personel',
}

function resolveHome(role: UserRole | undefined | null): string {
  if (role && role in roleHome) return roleHome[role]
  return '/login'
}

interface RouteGuardProps {
  allowedRoles?: UserRole[]
  children: ReactNode
}

export default function RouteGuard({ allowedRoles = [], children }: RouteGuardProps) {
  const { hydrated, isAuthenticated, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const allowed = useMemo(() => {
    if (!allowedRoles.length) return true
    return Boolean(user?.role && allowedRoles.includes(user.role))
  }, [allowedRoles, user?.role])

  useEffect(() => {
    if (!hydrated) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    if (!allowed) {
      router.replace(resolveHome(user?.role))
    }
  }, [allowed, hydrated, isAuthenticated, pathname, router, user?.role])

  if (!hydrated || !isAuthenticated || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-[#352432]">
        <div className="max-w-md border border-[#ead8df]/70 bg-white/82 p-8 text-center shadow-[0_28px_76px_-48px_rgba(150,78,104,0.52)] backdrop-blur-2xl">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-[#efbfd0]/75 bg-[#f0aac2]/10 text-[#c85776]">
            <ShieldAlert className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="font-display text-2xl tracking-tight">
            {!hydrated
              ? 'Oturum kontrol ediliyor'
              : !isAuthenticated
                ? 'Giriş ekranına yönlendiriliyor'
                : 'Yetkili panelinize yönlendiriliyor'}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#352432]/60">
            Bu alan rol bazlı korunur. Yanlış panel açıldıysa sistem sizi kendi yetkinize uygun panele taşır.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
