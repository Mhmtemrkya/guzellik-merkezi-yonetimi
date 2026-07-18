'use client'
import type { ReactNode } from 'react'
import Sidebar, { type SidebarNavItem, type SidebarUser } from '@/components/dashboard/Sidebar'
import RouteGuard from '@/components/dashboard/RouteGuard'
import PanelBackdrop from '@/components/dashboard/PanelBackdrop'
import { LayoutGrid, Building2, BarChart3, Receipt, AlertTriangle, Settings2, Package, FileUp } from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'

const items: SidebarNavItem[] = [
  { group: 'Genel', label: 'Overview', href: '/platform', icon: LayoutGrid },
  {
    group: 'Kurumlar',
    label: 'Tüm Kurumlar',
    href: '/platform/kurumlar',
    icon: Building2,
    badge: '8',
    children: [
      { label: 'Aktif', href: '/platform/kurumlar?scope=active' },
      { label: 'Deneme', href: '/platform/kurumlar?scope=trial' },
      { label: 'Askıda', href: '/platform/kurumlar?scope=paused' },
    ],
  },
  {
    group: 'Kurumlar',
    label: 'Sağlık Uyarıları',
    href: '/platform/uyarilar',
    icon: AlertTriangle,
    badge: '2',
    children: [
      { label: 'Kritik', href: '/platform/uyarilar?scope=critical' },
      { label: 'Yüksek', href: '/platform/uyarilar?scope=high' },
    ],
  },
  {
    group: 'Finans',
    label: 'MRR & Abonelik',
    href: '/platform/finans',
    icon: BarChart3,
    children: [
      { label: 'Genel görünüm', href: '/platform/finans?scope=overview' },
      { label: 'Plan bazlı gelir', href: '/platform/finans?scope=plans' },
    ],
  },
  { group: 'Finans', label: 'Plan Kataloğu', href: '/platform/planlar', icon: Package },
  { group: 'Finans', label: 'Faturalama', href: '/platform/fatura', icon: Receipt },
  { group: 'Sistem', label: 'Veri Aktarımı', href: '/platform/aktarim', icon: FileUp },
  { group: 'Sistem', label: 'Sistem Ayarları', href: '/platform/sistem', icon: Settings2 },
]

const fallbackUser: SidebarUser = { name: 'Platform Admin', role: 'Super Admin', avatar: 'PA' }

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const sidebarUser: SidebarUser = user
    ? { name: user.fullName || user.email, role: user.roleLabel || 'Platform Admin', avatar: user.avatar }
    : fallbackUser

  return (
    <RouteGuard allowedRoles={['PlatformAdmin']}>
      <div className="relative flex min-h-screen overflow-hidden bg-[#fff7fa] text-[#3b2330]">
        <PanelBackdrop variant="platform" />
        <Sidebar items={items} role="Platform Admin" user={sidebarUser} />
        <main className="relative z-10 min-w-0 flex-1 pb-24 pt-[65px] lg:pb-0 lg:pt-0">{children}</main>
      </div>
    </RouteGuard>
  )
}
