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
  PenLine,
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
  Store,
} from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeatureContext } from '@/components/dashboard/FeatureContext'
import type { FeatureKey } from '@/lib/types'

const items: SidebarNavItem[] = [
  { group: 'Genel', label: 'Dashboard', href: '/panel', icon: LayoutGrid },
  {
    group: 'Genel',
    label: 'Müşteriler',
    href: '/panel/musteriler',
    icon: Users,
    permissionKey: 'Customers',
    children: [
      { label: 'Tüm müşteriler', href: '/panel/musteriler?scope=all' },
      { label: 'KVKK onaylı', href: '/panel/musteriler?scope=kvkk' },
      { label: 'KVKK onaysız', href: '/panel/musteriler?scope=kvkk-pending' },
      { label: 'Yeni eklenen', href: '/panel/musteriler?scope=recent' },
    ],
  },
  {
    group: 'Genel',
    label: 'Randevular',
    href: '/panel/randevular',
    icon: Calendar,
    permissionKey: 'Appointments',
    children: [
      { label: 'Bugün', href: '/panel/randevular?scope=today' },
      { label: 'Bu hafta', href: '/panel/randevular?scope=week' },
      { label: 'Bu ay', href: '/panel/randevular?scope=month' },
      { label: 'Bekleyenler', href: '/panel/randevular?scope=pending' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Paket & Hizmet',
    href: '/panel/paketler',
    icon: Package,
    permissionKey: 'Services',
    children: [
      { label: 'Hizmet havuzu', href: '/panel/paketler?scope=services' },
      { label: 'Paketler', href: '/panel/paketler?scope=packages' },
      { label: 'Kategoriler', href: '/panel/paketler?scope=categories' },
      { label: 'Aktif hizmetler', href: '/panel/paketler?scope=active' },
      { label: 'Pasif hizmetler', href: '/panel/paketler?scope=inactive' },
    ],
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
    href: '/panel/hediye-cek',
    icon: Gift,
    permissionKey: 'GiftCards',
    featureKeys: ['marketing.giftcards'],
    children: [
      { label: 'Tümü', href: '/panel/hediye-cek?scope=all' },
      { label: 'Aktif', href: '/panel/hediye-cek?scope=active' },
      { label: 'Hediye çeki', href: '/panel/hediye-cek?scope=stored' },
      { label: 'Kupon', href: '/panel/hediye-cek?scope=coupon' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Stok & Ürün',
    href: '/panel/stok',
    icon: Boxes,
    permissionKey: 'Stock',
    featureKeys: ['stock.products', 'stock.movements'],
    children: [
      { label: 'Tüm ürünler', href: '/panel/stok?scope=all' },
      { label: 'Kritik stok', href: '/panel/stok?scope=critical' },
      { label: 'Satış ürünleri', href: '/panel/stok?scope=sale' },
      { label: 'Sarf malzeme', href: '/panel/stok?scope=consumable' },
    ],
  },
  {
    group: 'İşletme',
    label: 'Bekleme Listesi',
    href: '/panel/bekleme-listesi',
    icon: CalendarClock,
    permissionKey: 'Waitlist',
    featureKeys: ['appointments.waitlist'],
  },
  {
    group: 'Finans',
    label: 'Günlük Kasa',
    href: '/panel/kasa',
    icon: Wallet,
    permissionKey: 'CashRegister',
    children: [
      { label: 'Bugün', href: '/panel/kasa?scope=today' },
      { label: 'Bu hafta', href: '/panel/kasa?scope=week' },
      { label: 'Gelir-Gider', href: '/panel/kasa?scope=flow' },
    ],
  },
  {
    group: 'Finans',
    label: 'Kasa Kapanışı',
    href: '/panel/kasa-kapanis',
    icon: CalendarCheck,
    permissionKey: 'CashClosing',
    featureKeys: ['finance.cashclosing'],
  },
  {
    group: 'Finans',
    label: 'Ön Muhasebe',
    href: '/panel/on-muhasebe',
    icon: Landmark,
    badge: 'PDF',
    permissionKey: 'Accounting',
    children: [
      { label: 'Genel bakış', href: '/panel/on-muhasebe?scope=overview' },
      { label: 'Adisyon', href: '/panel/on-muhasebe?scope=adisyon' },
      { label: 'Cari hesap', href: '/panel/on-muhasebe?scope=accounts' },
      { label: 'Bekleyen taksitler', href: '/panel/on-muhasebe?scope=upcoming' },
      { label: 'Geciken ödemeler', href: '/panel/on-muhasebe?scope=overdue' },
      { label: 'Giderler', href: '/panel/on-muhasebe?scope=expenses' },
      { label: 'Personel maaşları', href: '/panel/on-muhasebe?scope=salary' },
    ],
  },
  {
    group: 'Finans',
    label: 'Raporlar',
    href: '/panel/raporlar',
    icon: FileBarChart,
    permissionKey: 'Reports',
    featureKeys: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    children: [
      { label: 'Finans özet', href: '/panel/raporlar?scope=finance' },
      { label: 'Müşteri analitiği', href: '/panel/raporlar?scope=customer' },
      { label: 'Personel performansı', href: '/panel/raporlar?scope=staff' },
      { label: 'Hizmet doluluk', href: '/panel/raporlar?scope=services' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Onay Bekleyenler',
    href: '/panel/onaylar',
    icon: ShieldCheck,
    // Sadece kurum yöneticisi onay verir — Staff için gizli
    featureKeys: ['approval.workflow'],
    children: [
      { label: 'Bekleyenler', href: '/panel/onaylar?scope=pending' },
      { label: 'Onaylanmış', href: '/panel/onaylar?scope=approved' },
      { label: 'Reddedilmiş', href: '/panel/onaylar?scope=rejected' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Personel & Roller',
    href: '/panel/ekip',
    icon: UserCog,
    // Personel yetkilendirmesi kurum yöneticisi yetkisi
    children: [
      { label: 'Tüm personel', href: '/panel/ekip?scope=all' },
      { label: 'Aktif kadro', href: '/panel/ekip?scope=active' },
      { label: 'Pasif / izinli', href: '/panel/ekip?scope=inactive' },
      { label: 'Çizelge', href: '/panel/ekip/cizelge' },
      { label: 'Yetki seti', href: '/panel/ekip?scope=permissions' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Bildirimler',
    href: '/panel/bildirimler',
    icon: BellRing,
    permissionKey: 'Notifications',
    featureKeys: ['notifications.sms', 'notifications.whatsapp', 'notifications.email', 'notifications.bulk', 'notifications.templates'],
    children: [
      { label: 'Tümü', href: '/panel/bildirimler?scope=all' },
      { label: 'SMS şablonları', href: '/panel/bildirimler?scope=sms' },
      { label: 'WhatsApp', href: '/panel/bildirimler?scope=whatsapp' },
    ],
  },
  {
    group: 'Yönetim',
    label: 'Salon Vitrini',
    href: '/panel/salon-profili',
    icon: Store,
    permissionKey: 'Settings',
    featureKeys: ['appointments.onlinebooking'],
  },
  {
    group: 'Yönetim',
    label: 'Log Kayıtları',
    href: '/panel/loglar',
    icon: ClipboardList,
    permissionKey: 'Logs',
    featureKeys: ['audit.logs'],
    children: [
      { label: 'Bugün', href: '/panel/loglar?scope=today' },
      { label: 'Bu hafta', href: '/panel/loglar?scope=week' },
      { label: 'Tüm geçmiş', href: '/panel/loglar?scope=all' },
    ],
  },
  { group: 'Yönetim', label: 'Ayarlar', href: '/panel/ayarlar', icon: Settings, permissionKey: 'Settings' },
]

// Personel rolüne kapalı sayfalar (permissionKey yetmediği için patlamasın diye href bazlı gizleniyor)
const ADMIN_ONLY_HREFS = new Set<string>([
  '/panel/onaylar',
  '/panel/ekip',
  '/panel/loglar',
  '/panel/ayarlar',
])

// Sayfa-seviyesi paket kapısı: bu prefix'lerden birine giren rota, ilgili özelliklerden
// hiçbirine sahip değilse "pakete dahil değil" ekranı gösterir (direkt URL erişimini de kapsar).
const ROUTE_FEATURE_GUARDS: Array<{ prefix: string; anyOf: FeatureKey[]; title: string }> = [
  { prefix: '/panel/onaylar', anyOf: ['approval.workflow'], title: 'Onay akışı paketinizde yok' },
  { prefix: '/panel/loglar', anyOf: ['audit.logs'], title: 'Log kayıtları paketinizde yok' },
  { prefix: '/panel/stok', anyOf: ['stock.products', 'stock.movements'], title: 'Stok yönetimi paketinizde yok' },
  {
    prefix: '/panel/raporlar',
    anyOf: ['reports.finance', 'reports.customer', 'reports.staff', 'reports.services', 'excel.reports', 'pdf.reports'],
    title: 'Raporlar paketinizde yok',
  },
  {
    prefix: '/panel/bildirimler',
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
        <main id="main" tabIndex={-1} className="relative z-10 min-w-0 flex-1 pb-24 pt-[65px] lg:pb-0 lg:pt-0">
          {blockedByPlan && activeGuard ? <FeatureLockedNotice title={activeGuard.title} /> : children}
        </main>
        <QuickMenu />
      </div>
    </RouteGuard>
  )
}
