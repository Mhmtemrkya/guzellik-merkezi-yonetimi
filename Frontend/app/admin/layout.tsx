'use client'
import { useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar, { type SidebarNavItem, type SidebarUser } from '@/components/dashboard/Sidebar'
import RouteGuard from '@/components/dashboard/RouteGuard'
import PanelBackdrop from '@/components/dashboard/PanelBackdrop'
import QuickMenu from '@/components/dashboard/QuickMenu'
import { FeatureLockedNotice } from '@/components/dashboard/FeatureGate'
import {
  LayoutGrid,
  Users,
  Package,
  Calendar,
  CalendarClock,
  CalendarCheck,
  Wallet,
  UserCog,
  FileBarChart,
  ShieldCheck,
  ClipboardList,
  Settings,
  BellRing,
  Landmark,
  Boxes,
  Gift,
} from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeatureContext } from '@/components/dashboard/FeatureContext'
import type { FeatureKey } from '@/lib/types'

const items: SidebarNavItem[] = [
  { group: 'Genel', label: 'Dashboard', href: '/admin', icon: LayoutGrid },
  {
    group: 'Genel',
    label: 'Onay Bekleyenler',
    href: '/admin/onaylar',
    icon: ShieldCheck,
    // Sadece kurum yöneticisi onay verir — Staff için gizli
    featureKeys: ['approval.workflow'],
    children: [
      { label: 'Bekleyenler', href: '/admin/onaylar?scope=pending' },
      { label: 'Onaylanmış', href: '/admin/onaylar?scope=approved' },
      { label: 'Reddedilmiş', href: '/admin/onaylar?scope=rejected' },
    ],
  },
  {
    group: 'Genel',
    label: 'Log Kayıtları',
    href: '/admin/loglar',
    icon: ClipboardList,
    permissionKey: 'Logs',
    featureKeys: ['audit.logs'],
    children: [
      { label: 'Bugün', href: '/admin/loglar?scope=today' },
      { label: 'Bu hafta', href: '/admin/loglar?scope=week' },
      { label: 'Tüm geçmiş', href: '/admin/loglar?scope=all' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Müşteriler',
    href: '/admin/musteriler',
    icon: Users,
    permissionKey: 'Customers',
    children: [
      { label: 'Tüm müşteriler', href: '/admin/musteriler?scope=all' },
      { label: 'KVKK onaylı', href: '/admin/musteriler?scope=kvkk' },
      { label: 'KVKK bekleyen', href: '/admin/musteriler?scope=kvkk-pending' },
      { label: 'Yeni eklenen', href: '/admin/musteriler?scope=recent' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Paket & Hizmet',
    href: '/admin/paketler',
    icon: Package,
    permissionKey: 'Services',
    children: [
      { label: 'Hizmet havuzu', href: '/admin/paketler?scope=services' },
      { label: 'Paketler', href: '/admin/paketler?scope=packages' },
      { label: 'Kategoriler', href: '/admin/paketler?scope=categories' },
      { label: 'Aktif hizmetler', href: '/admin/paketler?scope=active' },
      { label: 'Pasif hizmetler', href: '/admin/paketler?scope=inactive' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Hediye Çeki',
    href: '/admin/hediye-cek',
    icon: Gift,
    permissionKey: 'Services',
    featureKeys: ['marketing.giftcards'],
    children: [
      { label: 'Tümü', href: '/admin/hediye-cek?scope=all' },
      { label: 'Aktif', href: '/admin/hediye-cek?scope=active' },
      { label: 'Hediye çeki', href: '/admin/hediye-cek?scope=stored' },
      { label: 'Kupon', href: '/admin/hediye-cek?scope=coupon' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Stok & Ürün',
    href: '/admin/stok',
    icon: Boxes,
    permissionKey: 'Stock',
    featureKeys: ['stock.products', 'stock.movements'],
    children: [
      { label: 'Tüm ürünler', href: '/admin/stok?scope=all' },
      { label: 'Kritik stok', href: '/admin/stok?scope=critical' },
      { label: 'Satış ürünleri', href: '/admin/stok?scope=sale' },
      { label: 'Sarf malzeme', href: '/admin/stok?scope=consumable' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Randevular',
    href: '/admin/randevular',
    icon: Calendar,
    permissionKey: 'Appointments',
    children: [
      { label: 'Bugün', href: '/admin/randevular?scope=today' },
      { label: 'Bu hafta', href: '/admin/randevular?scope=week' },
      { label: 'Bu ay', href: '/admin/randevular?scope=month' },
      { label: 'Bekleyenler', href: '/admin/randevular?scope=pending' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Bekleme Listesi',
    href: '/admin/bekleme-listesi',
    icon: CalendarClock,
    permissionKey: 'Appointments',
    featureKeys: ['appointments.waitlist'],
  },
  {
    group: 'Finans',
    label: 'Günlük Kasa',
    href: '/admin/kasa',
    icon: Wallet,
    permissionKey: 'CashRegister',
    children: [
      { label: 'Bugün', href: '/admin/kasa?scope=today' },
      { label: 'Bu hafta', href: '/admin/kasa?scope=week' },
      { label: 'Gelir-Gider', href: '/admin/kasa?scope=flow' },
    ],
  },
  {
    group: 'Finans',
    label: 'Kasa Kapanışı',
    href: '/admin/kasa-kapanis',
    icon: CalendarCheck,
    permissionKey: 'CashRegister',
    featureKeys: ['finance.cashclosing'],
  },
  {
    group: 'Finans',
    label: 'Ön Muhasebe',
    href: '/admin/on-muhasebe',
    icon: Landmark,
    badge: 'PDF',
    permissionKey: 'Accounting',
    children: [
      { label: 'Genel bakış', href: '/admin/on-muhasebe?scope=overview' },
      { label: 'Adisyon', href: '/admin/on-muhasebe?scope=adisyon' },
      { label: 'Cari hesap', href: '/admin/on-muhasebe?scope=accounts' },
      { label: 'Bekleyen taksitler', href: '/admin/on-muhasebe?scope=upcoming' },
      { label: 'Geciken ödemeler', href: '/admin/on-muhasebe?scope=overdue' },
      { label: 'Giderler', href: '/admin/on-muhasebe?scope=expenses' },
      { label: 'Personel maaşları', href: '/admin/on-muhasebe?scope=salary' },
    ],
  },
  {
    group: 'Finans',
    label: 'Raporlar',
    href: '/admin/raporlar',
    icon: FileBarChart,
    permissionKey: 'Reports',
    featureKeys: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    children: [
      { label: 'Finans özet', href: '/admin/raporlar?scope=finance' },
      { label: 'Müşteri analitiği', href: '/admin/raporlar?scope=customer' },
      { label: 'Personel performansı', href: '/admin/raporlar?scope=staff' },
      { label: 'Hizmet doluluk', href: '/admin/raporlar?scope=services' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Personel & Roller',
    href: '/admin/personel',
    icon: UserCog,
    // Personel yetkilendirmesi kurum yöneticisi yetkisi
    children: [
      { label: 'Tüm personel', href: '/admin/personel?scope=all' },
      { label: 'Aktif kadro', href: '/admin/personel?scope=active' },
      { label: 'Pasif / izinli', href: '/admin/personel?scope=inactive' },
      { label: 'Çizelge', href: '/admin/personel/cizelge' },
      { label: 'Yetki seti', href: '/admin/personel?scope=permissions' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Bildirimler',
    href: '/admin/bildirimler',
    icon: BellRing,
    permissionKey: 'Notifications',
    featureKeys: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    children: [
      { label: 'Tümü', href: '/admin/bildirimler?scope=all' },
      { label: 'SMS şablonları', href: '/admin/bildirimler?scope=sms' },
      { label: 'WhatsApp', href: '/admin/bildirimler?scope=whatsapp' },
    ],
  },
  { group: 'Yönetim', label: 'Ayarlar', href: '/admin/ayarlar', icon: Settings, permissionKey: 'Settings' },
]

// Personel rolüne kapalı sayfalar (permissionKey yetmediği için patlamasın diye href bazlı gizleniyor)
const ADMIN_ONLY_HREFS = new Set<string>([
  '/admin/onaylar',
  '/admin/personel',
  '/admin/loglar',
  '/admin/ayarlar',
])

// Sayfa-seviyesi paket kapısı: bu prefix'lerden birine giren rota, ilgili özelliklerden
// hiçbirine sahip değilse "pakete dahil değil" ekranı gösterir (direkt URL erişimini de kapsar).
const ROUTE_FEATURE_GUARDS: Array<{ prefix: string; anyOf: FeatureKey[]; title: string }> = [
  { prefix: '/admin/onaylar', anyOf: ['approval.workflow'], title: 'Onay akışı paketinizde yok' },
  { prefix: '/admin/loglar', anyOf: ['audit.logs'], title: 'Log kayıtları paketinizde yok' },
  { prefix: '/admin/stok', anyOf: ['stock.products', 'stock.movements'], title: 'Stok yönetimi paketinizde yok' },
  {
    prefix: '/admin/raporlar',
    anyOf: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    title: 'Raporlar paketinizde yok',
  },
  {
    prefix: '/admin/bildirimler',
    anyOf: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    title: 'Bildirimler paketinizde yok',
  },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const featureCtx = useFeatureContext()
  const pathname = usePathname()
  const isStaff = user?.role === 'Staff'
  const roleLabel = isStaff ? 'Personel' : 'Kurum Yöneticisi'
  const sidebarUser: SidebarUser = user
    ? {
        name: user.fullName || user.email,
        role: user.roleLabel || roleLabel,
        avatar: user.avatar,
      }
    : { name: 'Giriş bekleniyor', role: roleLabel, avatar: isStaff ? 'P' : 'KY' }

  // Paket özelliğine göre nav filtresi: item'ın featureKeys'inden HİÇBİRİ pakette yoksa gizle.
  // Tüm rollerde (kurum yöneticisi + personel) geçerlidir. Platform admin bağlamı bu panelde yok.
  const featureVisible = (item: SidebarNavItem): boolean => {
    if (!item.featureKeys || item.featureKeys.length === 0) return true
    return featureCtx.hasAny(...(item.featureKeys as FeatureKey[]))
  }

  const visibleItems = useMemo(() => {
    const perms = new Set(user?.permissions ?? [])
    return items.filter((item) => {
      // Önce paket özelliği kapısı (her rol için)
      if (!featureVisible(item)) return false
      if (!isStaff) return true
      // Personel rolü ek kısıtları
      if (ADMIN_ONLY_HREFS.has(item.href)) return false
      if (item.permissionKey) return perms.has(item.permissionKey)
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, user?.permissions, featureCtx.features])

  // Rota paket kapısı: özellikler YÜKLENDİYSE ve gerekli özelliklerden hiçbiri yoksa engelle.
  // Yüklenmeden (features null) optimistik davranır; yanlış pozitif engel oluşmaz.
  const activeGuard = pathname
    ? ROUTE_FEATURE_GUARDS.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`) || pathname.startsWith(`${g.prefix}?`))
    : undefined
  const blockedByPlan = Boolean(activeGuard && featureCtx.features && !featureCtx.hasAny(...activeGuard.anyOf))

  return (
    <RouteGuard allowedRoles={['InstitutionOwner', 'BranchManager']}>
      <div className="relative flex min-h-screen overflow-hidden bg-[#fff7fa] text-[#3b2330]">
        <PanelBackdrop variant="admin" />
        <Sidebar items={visibleItems} role={roleLabel} user={sidebarUser} />
        <main className="relative z-10 min-w-0 flex-1 pb-24 pt-[65px] lg:pb-0 lg:pt-0">
          {blockedByPlan && activeGuard ? <FeatureLockedNotice title={activeGuard.title} /> : children}
        </main>
        <QuickMenu />
      </div>
    </RouteGuard>
  )
}
