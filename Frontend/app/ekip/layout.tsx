'use client'

import { useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import {
  BellRing,
  Boxes,
  Calendar,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Gift,
  FileBarChart,
  Landmark,
  LayoutGrid,
  Package,
  PenLine,
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
  { group: 'Genel', label: 'Dashboard', href: '/ekip', icon: LayoutGrid },
  {
    group: 'Genel',
    label: 'Müşterilerim',
    href: '/ekip/musteriler',
    icon: Users,
    permissionKey: 'Customers',
    children: [
      { label: 'Tüm müşteriler', href: '/ekip/musteriler?scope=all' },
      { label: 'KVKK onaylı', href: '/ekip/musteriler?scope=kvkk' },
      { label: 'Yeni eklenen', href: '/ekip/musteriler?scope=recent' },
    ],
  },
  {
    group: 'Genel',
    label: 'Randevularım',
    href: '/ekip/randevular',
    icon: Calendar,
    permissionKey: 'Appointments',
    children: [
      { label: 'Bugün', href: '/ekip/randevular?scope=today' },
      { label: 'Bu hafta', href: '/ekip/randevular?scope=week' },
      { label: 'Bu ay', href: '/ekip/randevular?scope=month' },
      { label: 'Bekleyenler', href: '/ekip/randevular?scope=pending' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Paket & Hizmet',
    href: '/ekip/paketler',
    icon: Package,
    permissionKey: 'Services',
    children: [
      { label: 'Hizmet havuzu', href: '/ekip/paketler?scope=services' },
      { label: 'Paketler', href: '/ekip/paketler?scope=packages' },
      { label: 'Aktif hizmetler', href: '/ekip/paketler?scope=active' },
      { label: 'Pasif hizmetler', href: '/ekip/paketler?scope=inactive' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Seanslarım',
    href: '/ekip/seanslar',
    icon: Scissors,
    permissionKey: 'Services',
  },
  {
    group: 'İşletme',
    label: 'İmza Tableti',
    href: '/imza',
    icon: PenLine,
    permissionKey: 'Services',
  },
  {
    group: 'İşletme',
    label: 'Hediye Çeki',
    href: '/ekip/hediye-cek',
    icon: Gift,
    permissionKey: 'GiftCards',
    featureKeys: ['marketing.giftcards'],
    children: [
      { label: 'Tümü', href: '/ekip/hediye-cek?scope=all' },
      { label: 'Aktif', href: '/ekip/hediye-cek?scope=active' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Bekleme Listesi',
    href: '/ekip/bekleme-listesi',
    icon: CalendarClock,
    permissionKey: 'Waitlist',
    featureKeys: ['appointments.waitlist'],
  },
  {
    group: 'İşletme',
    label: 'Stok & Ürün',
    href: '/ekip/stok',
    icon: Boxes,
    permissionKey: 'Stock',
    featureKeys: ['stock.products', 'stock.movements'],
    children: [
      { label: 'Tüm ürünler', href: '/ekip/stok?scope=all' },
      { label: 'Kritik stok', href: '/ekip/stok?scope=critical' },
      { label: 'Satış ürünleri', href: '/ekip/stok?scope=sale' },
      { label: 'Sarf malzeme', href: '/ekip/stok?scope=consumable' },
    ],
  },
  {
    group: 'Finans',
    label: 'Günlük Kasa',
    href: '/ekip/kasa',
    icon: Wallet,
    permissionKey: 'CashRegister',
    children: [
      { label: 'Bugün', href: '/ekip/kasa?scope=today' },
      { label: 'Bu hafta', href: '/ekip/kasa?scope=week' },
      { label: 'Gelir-Gider', href: '/ekip/kasa?scope=flow' },
    ],
  },
  {
    group: 'Finans',
    label: 'Kasa Kapanışı',
    href: '/ekip/kasa-kapanis',
    icon: CalendarCheck,
    permissionKey: 'CashClosing',
    featureKeys: ['finance.cashclosing'],
  },
  {
    group: 'Finans',
    label: 'Ön Muhasebe',
    href: '/ekip/on-muhasebe',
    icon: Landmark,
    badge: 'PDF',
    permissionKey: 'Accounting',
    children: [
      { label: 'Genel bakış', href: '/ekip/on-muhasebe?scope=overview' },
      { label: 'Cari hesap', href: '/ekip/on-muhasebe?scope=accounts' },
      { label: 'Bekleyen taksitler', href: '/ekip/on-muhasebe?scope=upcoming' },
      { label: 'Geciken ödemeler', href: '/ekip/on-muhasebe?scope=overdue' },
      { label: 'Giderler', href: '/ekip/on-muhasebe?scope=expenses' },
      { label: 'Personel maaşları', href: '/ekip/on-muhasebe?scope=salary' },
    ],
  },
  {
    group: 'Finans',
    label: 'Raporlar',
    href: '/ekip/raporlar',
    icon: FileBarChart,
    permissionKey: 'Reports',
    featureKeys: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    children: [
      { label: 'Finans özet', href: '/ekip/raporlar?scope=finance' },
      { label: 'Müşteri analitiği', href: '/ekip/raporlar?scope=customer' },
      { label: 'Personel performansı', href: '/ekip/raporlar?scope=staff' },
      { label: 'Hizmet doluluk', href: '/ekip/raporlar?scope=services' },
    ],
  },
  {
    group: 'Operasyon',
    label: 'Bildirimler',
    href: '/ekip/bildirimler',
    icon: BellRing,
    permissionKey: 'Notifications',
    featureKeys: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    children: [
      { label: 'Tümü', href: '/ekip/bildirimler?scope=all' },
      { label: 'SMS şablonları', href: '/ekip/bildirimler?scope=sms' },
      { label: 'WhatsApp', href: '/ekip/bildirimler?scope=whatsapp' },
    ],
  },
  {
    group: 'Operasyon',
    label: 'Loglarım',
    href: '/ekip/loglar',
    icon: ClipboardList,
    permissionKey: 'Logs',
    featureKeys: ['audit.logs'],
    children: [
      { label: 'Bugün', href: '/ekip/loglar?scope=today' },
      { label: 'Bu hafta', href: '/ekip/loglar?scope=week' },
      { label: 'Tüm geçmiş', href: '/ekip/loglar?scope=all' },
    ],
  },
  { group: 'Kişisel', label: 'Profilim', href: '/ekip/profil', icon: UserRound },
]

const ROUTE_PERMISSION_GUARDS: Array<{ prefix: string; permissionKey: string; label: string }> = [
  { prefix: '/ekip/randevular', permissionKey: 'Appointments', label: 'Randevular' },
  { prefix: '/ekip/musteriler', permissionKey: 'Customers', label: 'Müşteriler' },
  { prefix: '/ekip/seanslar', permissionKey: 'Services', label: 'Seanslar' },
  { prefix: '/ekip/paketler', permissionKey: 'Services', label: 'Paket & Hizmet' },
  { prefix: '/ekip/kasa', permissionKey: 'CashRegister', label: 'Günlük Kasa' },
  { prefix: '/ekip/on-muhasebe', permissionKey: 'Accounting', label: 'Ön Muhasebe' },
  { prefix: '/ekip/stok', permissionKey: 'Stock', label: 'Stok & Ürün' },
  { prefix: '/ekip/bekleme-listesi', permissionKey: 'Waitlist', label: 'Bekleme Listesi' },
  { prefix: '/ekip/hediye-cek', permissionKey: 'GiftCards', label: 'Hediye Çeki' },
  { prefix: '/ekip/kasa-kapanis', permissionKey: 'CashClosing', label: 'Kasa Kapanışı' },
  { prefix: '/ekip/raporlar', permissionKey: 'Reports', label: 'Raporlar' },
  { prefix: '/ekip/bildirimler', permissionKey: 'Notifications', label: 'Bildirimler' },
  { prefix: '/ekip/loglar', permissionKey: 'Logs', label: 'Loglar' },
]

const ROUTE_FEATURE_GUARDS: Array<{ prefix: string; anyOf: FeatureKey[]; title: string }> = [
  { prefix: '/ekip/loglar', anyOf: ['audit.logs'], title: 'Log kayıtları paketinizde yok' },
  { prefix: '/ekip/stok', anyOf: ['stock.products', 'stock.movements'], title: 'Stok yönetimi paketinizde yok' },
  { prefix: '/ekip/bekleme-listesi', anyOf: ['appointments.waitlist'], title: 'Bekleme listesi paketinizde yok' },
  { prefix: '/ekip/hediye-cek', anyOf: ['marketing.giftcards'], title: 'Hediye çeki paketinizde yok' },
  { prefix: '/ekip/kasa-kapanis', anyOf: ['finance.cashclosing'], title: 'Kasa kapanışı paketinizde yok' },
  {
    prefix: '/ekip/raporlar',
    anyOf: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    title: 'Raporlar paketinizde yok',
  },
  {
    prefix: '/ekip/bildirimler',
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
        <main id="main" tabIndex={-1} className="relative z-10 min-w-0 flex-1 pb-24 pt-[65px] lg:pb-0 lg:pt-0">
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
