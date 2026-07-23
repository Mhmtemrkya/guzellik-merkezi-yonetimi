'use client'

import { useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import {
  BellRing,
  Boxes,
  Calendar,
  ClipboardList,
  FileBarChart,
  Landmark,
  LayoutGrid,
  Package,
  Scissors,
  ShieldAlert,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import Sidebar, { type SidebarNavItem, type SidebarUser } from '@/components/dashboard/Sidebar'
import RouteGuard from '@/components/dashboard/RouteGuard'
import PanelBackdrop from '@/components/dashboard/PanelBackdrop'
import QuickMenu from '@/components/dashboard/QuickMenu'
import { FeatureLockedNotice } from '@/components/dashboard/FeatureGate'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeatureContext } from '@/components/dashboard/FeatureContext'
import type { FeatureKey } from '@/lib/types'

const personelItems: SidebarNavItem[] = [
  { group: 'Genel', label: 'Dashboard', href: '/personel', icon: LayoutGrid },
  {
    group: 'Genel',
    label: 'Müşterilerim',
    href: '/personel/musteriler',
    icon: Users,
    permissionKey: 'Customers',
    children: [
      { label: 'Tüm müşteriler', href: '/personel/musteriler?scope=all' },
      { label: 'KVKK onaylı', href: '/personel/musteriler?scope=kvkk' },
      { label: 'Yeni eklenen', href: '/personel/musteriler?scope=recent' },
    ],
  },
  {
    group: 'Genel',
    label: 'Randevularım',
    href: '/personel/randevular',
    icon: Calendar,
    permissionKey: 'Appointments',
    children: [
      { label: 'Bugün', href: '/personel/randevular?scope=today' },
      { label: 'Bu hafta', href: '/personel/randevular?scope=week' },
      { label: 'Bu ay', href: '/personel/randevular?scope=month' },
      { label: 'Bekleyenler', href: '/personel/randevular?scope=pending' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Paket & Hizmet',
    href: '/personel/paketler',
    icon: Package,
    permissionKey: 'Services',
    children: [
      { label: 'Hizmet havuzu', href: '/personel/paketler?scope=services' },
      { label: 'Paketler', href: '/personel/paketler?scope=packages' },
      { label: 'Aktif hizmetler', href: '/personel/paketler?scope=active' },
      { label: 'Pasif hizmetler', href: '/personel/paketler?scope=inactive' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Seanslarım',
    href: '/personel/seanslar',
    icon: Scissors,
    permissionKey: 'Services',
  },
  {
    group: 'İşletme',
    label: 'Stok & Ürün',
    href: '/personel/stok',
    icon: Boxes,
    permissionKey: 'Stock',
    featureKeys: ['stock.products', 'stock.movements'],
    children: [
      { label: 'Tüm ürünler', href: '/personel/stok?scope=all' },
      { label: 'Kritik stok', href: '/personel/stok?scope=critical' },
      { label: 'Satış ürünleri', href: '/personel/stok?scope=sale' },
      { label: 'Sarf malzeme', href: '/personel/stok?scope=consumable' },
    ],
  },
  {
    group: 'Finans',
    label: 'Günlük Kasa',
    href: '/personel/kasa',
    icon: Wallet,
    permissionKey: 'CashRegister',
    children: [
      { label: 'Bugün', href: '/personel/kasa?scope=today' },
      { label: 'Bu hafta', href: '/personel/kasa?scope=week' },
      { label: 'Gelir-Gider', href: '/personel/kasa?scope=flow' },
    ],
  },
  {
    group: 'Finans',
    label: 'Ön Muhasebe',
    href: '/personel/on-muhasebe',
    icon: Landmark,
    badge: 'PDF',
    permissionKey: 'Accounting',
    children: [
      { label: 'Genel bakış', href: '/personel/on-muhasebe?scope=overview' },
      { label: 'Cari hesap', href: '/personel/on-muhasebe?scope=accounts' },
      { label: 'Bekleyen taksitler', href: '/personel/on-muhasebe?scope=upcoming' },
      { label: 'Geciken ödemeler', href: '/personel/on-muhasebe?scope=overdue' },
      { label: 'Giderler', href: '/personel/on-muhasebe?scope=expenses' },
      { label: 'Personel maaşları', href: '/personel/on-muhasebe?scope=salary' },
    ],
  },
  {
    group: 'Finans',
    label: 'Raporlar',
    href: '/personel/raporlar',
    icon: FileBarChart,
    permissionKey: 'Reports',
    featureKeys: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    children: [
      { label: 'Finans özet', href: '/personel/raporlar?scope=finance' },
      { label: 'Müşteri analitiği', href: '/personel/raporlar?scope=customer' },
      { label: 'Personel performansı', href: '/personel/raporlar?scope=staff' },
      { label: 'Hizmet doluluk', href: '/personel/raporlar?scope=services' },
    ],
  },
  {
    group: 'Operasyon',
    label: 'Bildirimler',
    href: '/personel/bildirimler',
    icon: BellRing,
    permissionKey: 'Notifications',
    featureKeys: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    children: [
      { label: 'Tümü', href: '/personel/bildirimler?scope=all' },
      { label: 'SMS şablonları', href: '/personel/bildirimler?scope=sms' },
      { label: 'WhatsApp', href: '/personel/bildirimler?scope=whatsapp' },
    ],
  },
  {
    group: 'Operasyon',
    label: 'Loglarım',
    href: '/personel/loglar',
    icon: ClipboardList,
    permissionKey: 'Logs',
    featureKeys: ['audit.logs'],
    children: [
      { label: 'Bugün', href: '/personel/loglar?scope=today' },
      { label: 'Bu hafta', href: '/personel/loglar?scope=week' },
      { label: 'Tüm geçmiş', href: '/personel/loglar?scope=all' },
    ],
  },
  { group: 'Kişisel', label: 'Profilim', href: '/personel/profil', icon: UserRound },
]

const ROUTE_PERMISSION_GUARDS: Array<{ prefix: string; permissionKey: string; label: string }> = [
  { prefix: '/personel/randevular', permissionKey: 'Appointments', label: 'Randevular' },
  { prefix: '/personel/musteriler', permissionKey: 'Customers', label: 'Müşteriler' },
  { prefix: '/personel/seanslar', permissionKey: 'Services', label: 'Seanslar' },
  { prefix: '/personel/paketler', permissionKey: 'Services', label: 'Paket & Hizmet' },
  { prefix: '/personel/kasa', permissionKey: 'CashRegister', label: 'Günlük Kasa' },
  { prefix: '/personel/on-muhasebe', permissionKey: 'Accounting', label: 'Ön Muhasebe' },
  { prefix: '/personel/stok', permissionKey: 'Stock', label: 'Stok & Ürün' },
  { prefix: '/personel/raporlar', permissionKey: 'Reports', label: 'Raporlar' },
  { prefix: '/personel/bildirimler', permissionKey: 'Notifications', label: 'Bildirimler' },
  { prefix: '/personel/loglar', permissionKey: 'Logs', label: 'Loglar' },
]

const ROUTE_FEATURE_GUARDS: Array<{ prefix: string; anyOf: FeatureKey[]; title: string }> = [
  { prefix: '/personel/loglar', anyOf: ['audit.logs'], title: 'Log kayıtları paketinizde yok' },
  { prefix: '/personel/stok', anyOf: ['stock.products', 'stock.movements'], title: 'Stok yönetimi paketinizde yok' },
  {
    prefix: '/personel/raporlar',
    anyOf: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    title: 'Raporlar paketinizde yok',
  },
  {
    prefix: '/personel/bildirimler',
    anyOf: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    title: 'Bildirimler paketinizde yok',
  },
]

function pathMatches(pathname: string | null, prefix: string): boolean {
  return Boolean(pathname && (pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`)))
}

function StaffPermissionNotice({ label }: { label: string }) {
  return (
    <div className="relative flex min-h-[60vh] items-center justify-center p-6">
      <div className="relative w-full max-w-lg overflow-hidden border border-[#f0aac2]/25 bg-gradient-to-br from-[#2a1320] via-[#2f1724] to-[#1f0d16] p-8 text-center shadow-[0_50px_140px_rgba(0,0,0,0.6)]">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[#f0aac2]/18 blur-3xl" />
        <div className="relative mx-auto grid h-14 w-14 place-items-center border border-[#f0aac2]/35 bg-[#160b12]/55 shadow-[0_0_28px_rgba(240,170,194,0.35)]">
          <ShieldAlert className="h-5 w-5 text-[#ffd3df]" strokeWidth={1.6} />
        </div>
        <div className="relative mt-5 inline-flex items-center gap-1.5 border border-[#f0aac2]/25 bg-[#f0aac2]/10 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.22em] text-[#ffd3df]">
          Personel yetkisi gerekli
        </div>
        <h2 className="relative mt-3 font-display text-2xl tracking-tight text-[#fff4f8]">{label} yetkisi tanımlı değil</h2>
        <p className="relative mt-2 text-[12.5px] leading-relaxed text-[#fff4f8]/60">
          Bu sayfa kurum yöneticisi panelindeki modülle aynı altyapıyı kullanır; personelin erişebilmesi için ilgili rol izni ayrıca verilmelidir.
        </p>
      </div>
    </div>
  )
}

export default function PersonelLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const featureCtx = useFeatureContext()
  const pathname = usePathname()
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions])

  const featureVisible = (item: SidebarNavItem): boolean => {
    if (!item.featureKeys || item.featureKeys.length === 0) return true
    return featureCtx.hasAny(...(item.featureKeys as FeatureKey[]))
  }

  const visibleItems = useMemo(
    () => personelItems.filter((item) => featureVisible(item) && (!item.permissionKey || permissions.has(item.permissionKey))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions, featureCtx.features],
  )

  const activePermissionGuard = ROUTE_PERMISSION_GUARDS.find((g) => pathMatches(pathname, g.prefix))
  const missingPermission = Boolean(activePermissionGuard && user && !permissions.has(activePermissionGuard.permissionKey))
  const activeFeatureGuard = ROUTE_FEATURE_GUARDS.find((g) => pathMatches(pathname, g.prefix))
  const blockedByPlan = Boolean(activeFeatureGuard && featureCtx.features && !featureCtx.hasAny(...activeFeatureGuard.anyOf))

  const sidebarUser: SidebarUser = user
    ? {
        name: user.fullName || user.email,
        role: user.roleLabel || 'Personel',
        avatar: user.avatar,
      }
    : { name: 'Giriş bekleniyor', role: 'Personel', avatar: 'P' }

  return (
    <RouteGuard allowedRoles={['Staff']}>
      <div className="relative flex min-h-screen overflow-hidden bg-[#160b12] text-[#fff4f8]">
        <PanelBackdrop variant="personel" />
        <Sidebar items={visibleItems} role="Personel" user={sidebarUser} />
        <main className="relative z-10 min-w-0 flex-1 pb-24 pt-[65px] lg:pb-0 lg:pt-0">
          {missingPermission && activePermissionGuard ? (
            <StaffPermissionNotice label={activePermissionGuard.label} />
          ) : blockedByPlan && activeFeatureGuard ? (
            <FeatureLockedNotice title={activeFeatureGuard.title} />
          ) : (
            children
          )}
        </main>
        <QuickMenu />
      </div>
    </RouteGuard>
  )
}
