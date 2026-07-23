'use client'

import {
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  FileClock,
  FileUp,
  Search,
  Sparkles,
  UserX,
  X,
  Zap,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import BranchSwitcher from './BranchSwitcher'
import ImportDialog from './ImportDialog'
import PageGuide from './PageGuide'
import { useAuth } from './AuthContext'
import { useManagerInbox } from '@/hooks/useManagerInbox'
import type { NotificationItem } from '@/lib/types'

interface SearchRoute {
  label: string
  path: string
  keywords: string
  /** true ise sayfa değil bir "aksiyon" (ör. yeni kayıt modalı açar) — palette'te rozetli gösterilir. */
  action?: boolean
}

type SearchScope = 'platform' | 'admin' | 'personel'

const searchRoutes: Record<SearchScope, SearchRoute[]> = {
  platform: [
    { label: 'Platform Overview', path: '/platform', keywords: 'overview dashboard tenant kurum abonelik sistem durum' },
    { label: 'Tüm Kurumlar', path: '/platform/kurumlar', keywords: 'kurum tenant plan domain limit müşteri işletme' },
    { label: 'Sağlık Uyarıları', path: '/platform/uyarilar', keywords: 'sağlık uyarı risk alarm sla health entegrasyon' },
    { label: 'MRR & Abonelik', path: '/platform/finans', keywords: 'mrr abonelik gelir churn plan finans' },
    { label: 'Faturalama', path: '/platform/fatura', keywords: 'fatura ödeme mutabakat tahsilat bakiye' },
    { label: 'Sistem Ayarları', path: '/platform/sistem', keywords: 'sistem ayar health webhook bakım yedekleme güvenlik entegrasyon veri saklama' },
  ],
  admin: [
    { label: 'Yeni Randevu Oluştur', path: '/admin/randevular?action=new', keywords: 'yeni randevu oluştur ekle aç booking aksiyon', action: true },
    { label: 'Yeni Müşteri Ekle', path: '/admin/musteriler?action=new', keywords: 'yeni müşteri danışan ekle kayıt aksiyon', action: true },
    { label: 'Tahsilat Al / Kasa', path: '/admin/kasa', keywords: 'tahsilat ödeme al kasa para aksiyon', action: true },
    { label: 'Bugünün Randevuları', path: '/admin/randevular?scope=today', keywords: 'bugün randevu günlük aksiyon', action: true },
    { label: 'Onay Bekleyenler', path: '/admin/onaylar?scope=pending', keywords: 'onay bekleyen taslak aksiyon', action: true },
    { label: 'Dashboard', path: '/admin', keywords: 'özet dashboard performans' },
    { label: 'Müşteriler', path: '/admin/musteriler', keywords: 'müşteri danışan kayıt crm' },
    { label: 'Randevular', path: '/admin/randevular', keywords: 'randevu takvim seans' },
    { label: 'Paket & Hizmet', path: '/admin/paketler', keywords: 'paket hizmet fiyat seans' },
    { label: 'Stok & Ürün', path: '/admin/stok', keywords: 'stok ürün depo' },
    { label: 'Günlük Kasa', path: '/admin/kasa', keywords: 'kasa ödeme tahsilat günlük' },
    { label: 'Ön Muhasebe', path: '/admin/on-muhasebe', keywords: 'cari taksit ön muhasebe' },
    { label: 'Raporlar', path: '/admin/raporlar', keywords: 'rapor finans personel müşteri' },
    { label: 'Personel & Roller', path: '/admin/personel', keywords: 'personel rol yetki ekip' },
    { label: 'Bildirimler', path: '/admin/bildirimler', keywords: 'bildirim hatırlatma sms' },
    { label: 'Onay Bekleyenler', path: '/admin/onaylar', keywords: 'onay bekleyen aksiyon' },
    { label: 'Log Kayıtları', path: '/admin/loglar', keywords: 'log audit geçmiş' },
    { label: 'Ayarlar', path: '/admin/ayarlar', keywords: 'ayar şube kurum güvenlik' },
  ],
  personel: [
    { label: 'Yeni Randevu Oluştur', path: '/personel/randevular?action=new', keywords: 'yeni randevu oluştur ekle aksiyon', action: true },
    { label: 'Yeni Müşteri Ekle', path: '/personel/musteriler?action=new', keywords: 'yeni müşteri ekle danışan aksiyon', action: true },
    { label: 'Bugünün Randevularım', path: '/personel/randevular?scope=today', keywords: 'bugün randevu günlük aksiyon', action: true },
    { label: 'Personel Paneli', path: '/personel', keywords: 'özet dashboard görev' },
    { label: 'Randevularım', path: '/personel/randevular', keywords: 'randevu takvim seans' },
    { label: 'Müşterilerim', path: '/personel/musteriler', keywords: 'müşteri danışan kayıt' },
    { label: 'Seanslarım', path: '/personel/seanslar', keywords: 'seans tamamlama paket' },
    { label: 'Paket Satışı', path: '/personel/paketler', keywords: 'paket hizmet satış' },
    { label: 'Kasa / Tahsilat', path: '/personel/kasa', keywords: 'kasa tahsilat ödeme' },
    { label: 'Performansım', path: '/personel/raporlar', keywords: 'performans rapor komisyon' },
    { label: 'Profilim', path: '/personel/profil', keywords: 'profil oturum hesap' },
  ],
}

function normalize(text: string | undefined | null): string {
  return (text || '').toLocaleLowerCase('tr-TR')
}

interface TopbarProps {
  title: string
  subtitle?: string
  breadcrumbs?: string[]
  actions?: ReactNode
  pendingCount?: number
  notifications?: NotificationItem[]
  compact?: boolean
}

const noticeListVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
}

const noticeItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

const paletteResultsVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03, delayChildren: 0.06 } },
}

const paletteRowVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
}

export default function Topbar({
  title,
  subtitle,
  breadcrumbs = [],
  actions = null,
  pendingCount = 0,
  notifications = [],
  compact = false,
}: TopbarProps) {
  const [time, setTime] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false)
  const [noticeOpen, setNoticeOpen] = useState<boolean>(false)
  const [importOpen, setImportOpen] = useState<boolean>(false)
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const displayName = user?.fullName || user?.email || 'Melis Yılmaz'
  const displayRole = user?.roleLabel || 'Yönetici'
  const avatarText =
    user?.avatar ||
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('tr-TR'))
      .join('') ||
    'MY'

  useEffect(() => {
    const update = (): void => {
      const d = new Date()
      setTime(
        new Intl.DateTimeFormat('tr-TR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(d),
      )
    }
    update()
    const id = setInterval(update, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('tr-TR') === 'k') {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      }
      if (event.key === 'Escape' && paletteOpen) {
        event.preventDefault()
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  useEffect(() => {
    if (paletteOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
    setQuery('')
    setActiveIndex(0)
    return undefined
  }, [paletteOpen])

  const scope: SearchScope = pathname?.startsWith('/platform')
    ? 'platform'
    : pathname?.startsWith('/personel')
      ? 'personel'
      : 'admin'
  const placeholder =
    scope === 'platform'
      ? 'Ara: kurum, fatura, sistem…'
      : scope === 'personel'
        ? 'Ara: randevu, müşteri, profil…'
        : 'Ara: müşteri, paket, randevu…'
  const routes = searchRoutes[scope] || searchRoutes.admin

  // Kurum yöneticisi randevu aksiyon kutusu — admin scope'unda (yönetici) canlı yoklanır.
  // "Randevu saati gelince yöneticiye bildirim düşer" davranışını zil rozetiyle sağlar.
  const managerInbox = useManagerInbox({ enabled: scope === 'admin' })
  const [inboxBusyId, setInboxBusyId] = useState<string | null>(null)
  const runInboxAction = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setInboxBusyId(id)
    try {
      await fn()
    } catch {
      /* zil içi aksiyon sessizce yutulur; poll bir sonraki turda düzeltir */
    } finally {
      setInboxBusyId(null)
    }
  }

  const noticeItems = useMemo<NotificationItem[]>(() => {
    const items = Array.isArray(notifications) ? notifications.filter(Boolean) : []
    if (items.length) return items.slice(0, 6)
    if (pendingCount > 0) {
      return [
        {
          title: `${pendingCount} onay bekleyen işlem var`,
          description: 'İlgili operasyon kuyruğunu kontrol et.',
          meta: 'Aksiyon',
          href:
            scope === 'platform'
              ? '/platform/uyarilar'
              : scope === 'personel'
                ? '/personel/bildirimler'
                : '/admin/bildirimler',
        },
      ]
    }
    return []
  }, [notifications, pendingCount, scope])

  const visibleNoticeCount = Math.max(Number(pendingCount || 0), noticeItems.length) + managerInbox.total

  const results = useMemo<SearchRoute[]>(() => {
    const q = normalize(query).trim()
    if (!q) return routes.slice(0, 8)
    return routes.filter((item) => normalize(`${item.label} ${item.keywords}`).includes(q)).slice(0, 8)
  }, [query, routes])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const goToResult = (item: SearchRoute): void => {
    setQuery('')
    setPaletteOpen(false)
    router.push(item.path)
  }

  const handlePaletteKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      goToResult(results[activeIndex]!)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % Math.max(results.length, 1))
    }
  }

  return (
    <>
      <header className="relative z-20 border-b border-[#ead8df]/70 bg-white/75 shadow-[0_18px_46px_-36px_rgba(150,78,104,0.42)] backdrop-blur-2xl">
        {/* Üstte yumuşak gold flare */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 right-12 h-40 w-72 rounded-full bg-[#ffdce8]/65 blur-3xl"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/3 h-32 w-72 rounded-full bg-[#f4b9c9]/32 blur-3xl"
        />
        {/* Alt çift hairline — birincisi ince altın, ikincisi mor mat */}
        <motion.span
          aria-hidden
          initial={{ opacity: 0.5 }}
          animate={{ opacity: [0.55, 0.95, 0.55] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(239,111,148,0.34) 28%, rgba(255,220,232,0.92) 52%, rgba(239,111,148,0.34) 72%, transparent)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-12 bottom-[-3px] h-px bg-white/80"
        />

        <div className={`relative flex items-stretch justify-between gap-3 px-4 py-3.5 sm:px-6 ${compact ? 'lg:items-center lg:gap-3 lg:px-6' : 'flex-col sm:py-4 lg:flex-row lg:items-center lg:gap-4 lg:px-6 xl:gap-5 xl:px-8'}`}>
          {/* Title block */}
          {!compact && (
            <div className="min-w-0 flex-1 lg:min-w-[180px] xl:min-w-[240px]">
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto text-[10px] font-semibold tracking-tight text-[#7c6170]/58">
                {breadcrumbs.map((b, i) => (
                  <span key={`${b}-${i}`} className="flex shrink-0 items-center gap-2">
                    {i > 0 && (
                      <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-[#f0aac2]/55" />
                    )}
                    <span className={i === breadcrumbs.length - 1 ? 'text-[#c85776]' : ''}>{b}</span>
                  </span>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.h1
                  key={title}
                  initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="armo-heading mt-1.5 truncate text-[1.55rem] leading-tight sm:text-2xl xl:text-[28px]"
                >
                  <span className="armo-shimmer">{title}</span>
                </motion.h1>
              </AnimatePresence>

              {subtitle && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={subtitle}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, delay: 0.06 }}
                    className="mt-1.5 truncate text-[12px] leading-relaxed text-[#7c6170]/70"
                  >
                    {subtitle}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          )}

          {/* Right controls */}
          <div className={`flex min-w-0 flex-wrap items-center gap-2 sm:gap-3 2xl:flex-nowrap ${compact ? 'w-full lg:justify-end' : 'lg:justify-end'}`}>
            {/* SEARCH TRIGGER (opens palette) */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setPaletteOpen(true)}
              className={`group relative items-center gap-2 overflow-hidden rounded-2xl border border-[#ead8df]/80 bg-white/82 px-3.5 py-2.5 text-left shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] ${compact ? 'flex min-h-11 min-w-[240px] flex-1 lg:max-w-[640px]' : 'hidden w-[220px] min-w-0 shrink md:flex xl:w-[300px]'}`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#ffdce8]/55 via-white/60 to-transparent transition-transform duration-500 group-hover:translate-x-0"
              />
              <Search className="relative z-10 h-3.5 w-3.5 text-[#9d7386] transition-colors group-hover:text-[#c85776]" />
              <span className="relative z-10 flex-1 truncate text-[12px] text-[#7c6170]/70 group-hover:text-[#4a3542]">
                {compact ? 'Danışan, randevu, işlem veya personel ara...' : placeholder}
              </span>
              <kbd className="relative z-10 rounded-md border border-[#ead8df] bg-[#fff7fa] px-1.5 text-[9px] font-semibold text-[#9d7386] transition-colors group-hover:border-[#ef9ab5] group-hover:text-[#c85776]">
                ⌘K
              </kbd>
            </motion.button>

            {/* TIME — tarih çipi */}
            {!compact && (
              <span className="hidden min-h-10 items-center gap-2 rounded-2xl border border-[#ead8df]/80 bg-white/82 px-3 text-[11px] font-semibold tracking-tight text-[#7c6170] shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] xl:flex">
                <motion.span
                  aria-hidden
                  animate={{ opacity: [0.55, 1, 0.55] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="inline-flex"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-[#c85776]" strokeWidth={1.7} />
                </motion.span>
                {time}
              </span>
            )}

            {/* HER SAYFADA RANDEVU OLUŞTUR — randevu ekranındaki tam create akışını açar (?action=new) */}
            {scope !== 'platform' && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => router.push(`${scope === 'personel' ? '/personel' : '/admin'}/randevular?action=new`)}
                aria-label="Randevu oluştur"
                title="Randevu oluştur"
                className="group relative flex min-h-10 items-center gap-2 overflow-hidden rounded-2xl border border-[#c85776]/30 bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-3 text-[11px] font-semibold text-white shadow-[0_14px_30px_-18px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
              >
                <CalendarPlus className="relative z-10 h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="relative z-10 hidden md:inline">Randevu Oluştur</span>
              </motion.button>
            )}

            {!compact && scope !== 'personel' && <BranchSwitcher />}

            {/* GENEL EXCEL İÇERİ AKTAR — yalnızca dashboard'da; diğer sayfaların aksiyon
                dolu navbar'ını sıkıştırmasın */}
            {scope === 'admin' && pathname === '/admin' && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => setImportOpen(true)}
                aria-label="Excel içeri aktar"
                title="Excel içeri aktar"
                className="group relative flex min-h-10 items-center gap-2 overflow-hidden rounded-2xl border border-[#ead8df]/80 bg-white/82 px-3 text-[11px] font-semibold text-[#7c6170] shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#ffdce8]/65 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                />
                <FileUp className="relative z-10 h-3.5 w-3.5" strokeWidth={1.7} />
                <span className="relative z-10 hidden lg:inline">İçeri Aktar</span>
              </motion.button>
            )}

            {/* SAYFA KILAVUZU */}
            <PageGuide />

            {/* BELL + TRAY */}
            <div className="relative">
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                aria-label="Bildirimleri göster"
                aria-expanded={noticeOpen}
                onClick={() => setNoticeOpen((value) => !value)}
                className="group relative grid min-h-10 min-w-10 place-items-center overflow-hidden rounded-2xl border border-[#ead8df]/80 bg-white/82 text-[#7c6170] shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#ffdce8]/65 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                />
                <motion.span
                  animate={visibleNoticeCount > 0 ? { rotate: [0, -8, 8, -4, 4, 0] } : { rotate: 0 }}
                  transition={{ duration: 1.6, repeat: visibleNoticeCount > 0 ? Infinity : 0, repeatDelay: 3 }}
                  className="relative z-10"
                >
                  <Bell className="h-3.5 w-3.5" strokeWidth={1.6} />
                </motion.span>
                {visibleNoticeCount > 0 && (
                  <>
                    <motion.span
                      key={visibleNoticeCount}
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                      className="absolute -right-1.5 -top-1.5 z-10 grid h-4 min-w-4 place-items-center rounded-full bg-[#ef6f94] px-1 text-[9px] font-semibold text-white"
                    >
                      {visibleNoticeCount > 9 ? '9+' : visibleNoticeCount}
                    </motion.span>
                    <motion.span
                      aria-hidden
                      animate={{ scale: [1, 1.7, 1.7], opacity: [0.6, 0, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                      className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-[#ef6f94]/45"
                    />
                  </>
                )}
              </motion.button>

              <AnimatePresence>
                {noticeOpen && (
                  <motion.div
                    key="notice-tray"
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute right-0 top-[calc(100%+10px)] z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[22px] border border-[#ead8df]/80 bg-white/96 shadow-2xl shadow-[#b86a87]/18 backdrop-blur-xl"
                  >
                    <div className="relative">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#f0aac2]/15 blur-3xl"
                      />
                      <div className="relative flex items-center justify-between border-b border-[#ead8df]/70 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-[#c85776]" />
                          <span className="text-[11px] font-semibold tracking-tight text-[#7c6170]/82">
                            Bildirimler
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold text-[#9d7386]/70">
                          {visibleNoticeCount} aktif
                        </span>
                      </div>

                      {/* KURUM YÖNETİCİSİ RANDEVU AKSİYON KUTUSU */}
                      {managerInbox.total > 0 && (
                        <div className="max-h-[340px] divide-y divide-[#ead8df]/60 overflow-y-auto">
                          {managerInbox.awaitingApproval.length > 0 && (
                            <div className="px-4 py-2.5">
                              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-indigo-500/80">
                                <FileClock className="h-3 w-3" /> Onay bekleyen taslaklar
                              </div>
                              <div className="space-y-2">
                                {managerInbox.awaitingApproval.slice(0, 6).map((a) => (
                                  <div key={a.id} className="rounded-[12px] border border-dashed border-indigo-200 bg-indigo-50/40 px-2.5 py-2">
                                    <div className="truncate text-[12px] font-semibold text-[#241923]">{a.musteri}</div>
                                    <div className="truncate text-[11px] text-[#7c6170]/75">{a.islem} · {a.date.slice(5)} {a.time} · {a.personel}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      <button type="button" disabled={inboxBusyId === a.id} onClick={() => runInboxAction(a.id, () => managerInbox.approve(a.id))} className="inline-flex items-center gap-1 rounded-md bg-[#c85776] px-2 py-1 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"><Check className="h-3 w-3" /> Onayla</button>
                                      <button type="button" disabled={inboxBusyId === a.id} onClick={() => runInboxAction(a.id, () => managerInbox.reject(a.id))} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"><X className="h-3 w-3" /> Reddet</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {managerInbox.awaitingOutcome.length > 0 && (
                            <div className="px-4 py-2.5">
                              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#b14d6c]/80">
                                <Clock3 className="h-3 w-3" /> Saati gelen randevular
                              </div>
                              <div className="space-y-2">
                                {managerInbox.awaitingOutcome.slice(0, 6).map((a) => (
                                  <div key={a.id} className="rounded-[12px] border border-[#f0e0e6] bg-white px-2.5 py-2">
                                    <div className="truncate text-[12px] font-semibold text-[#241923]">{a.musteri}</div>
                                    <div className="truncate text-[11px] text-[#7c6170]/75">{a.islem} · {a.date.slice(5)} {a.time} · {a.personel}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      <button type="button" disabled={inboxBusyId === a.id} onClick={() => runInboxAction(a.id, () => managerInbox.complete(a.id))} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"><CheckCircle2 className="h-3 w-3" /> Tamamlandı</button>
                                      <button type="button" disabled={inboxBusyId === a.id} onClick={() => runInboxAction(a.id, () => managerInbox.noShow(a.id))} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"><UserX className="h-3 w-3" /> Gelmedi</button>
                                      <button type="button" onClick={() => { setNoticeOpen(false); router.push('/admin/randevular') }} className="inline-flex items-center gap-1 rounded-md border border-[#ead8df] bg-white px-2 py-1 text-[10px] font-semibold text-[#7c6170] transition-colors hover:bg-[#fff4f8]"><CalendarClock className="h-3 w-3" /> Ertele</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {noticeItems.length ? (
                        <motion.div
                          variants={noticeListVariants}
                          initial="hidden"
                          animate="visible"
                          className="divide-y divide-[#ead8df]/60"
                        >
                          {noticeItems.map((item, index) => {
                            const clickable = Boolean(item.href)
                            const body = (
                              <>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-[12px] font-semibold leading-5 text-[#352432]">
                                    {item.title}
                                  </div>
                                  {item.meta && (
                                    <span className="shrink-0 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-1.5 py-0.5 text-[9px] font-semibold text-[#c85776]">
                                      {item.meta}
                                    </span>
                                  )}
                                </div>
                                {item.description && (
                                  <div className="mt-1 text-[11px] leading-5 text-[#7c6170]/72">
                                    {item.description}
                                  </div>
                                )}
                              </>
                            )
                            return (
                              <motion.div key={`${item.title}-${index}`} variants={noticeItemVariants}>
                                {clickable && item.href ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNoticeOpen(false)
                                      router.push(item.href as string)
                                    }}
                                    className="group block w-full px-4 py-3 text-left transition-colors hover:bg-[#fff7fa]"
                                  >
                                    {body}
                                  </button>
                                ) : (
                                  <div className="px-4 py-3">{body}</div>
                                )}
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      ) : managerInbox.total === 0 ? (
                        <p className="px-4 pb-4 pt-3 text-[12px] leading-5 text-[#7c6170]/76">
                          Bekleyen bildirim yok. Randevu saati geldiğinde veya personel taslak randevu önerdiğinde burada görünür.
                        </p>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {compact && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => router.push('/admin/randevular')}
                className="group relative grid min-h-11 min-w-11 place-items-center overflow-hidden rounded-2xl border border-[#ead8df]/80 bg-white/82 text-[#7c6170] shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
                aria-label="Takvim"
              >
                <CalendarDays className="relative z-10 h-4 w-4" strokeWidth={1.55} />
              </motion.button>
            )}

            {actions && (
              <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${compact ? 'shrink-0' : 'shrink-0 basis-full 2xl:shrink 2xl:basis-auto'}`}>
                {actions}
              </div>
            )}

            {compact && (
              <div className="hidden shrink-0 items-center gap-2.5 pl-1 md:flex">
                <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-[#efbfd0] bg-gradient-to-br from-[#fff3f7] to-[#f4bfd0] text-[12px] font-semibold text-[#8c415b] shadow-[0_14px_28px_-20px_rgba(190,91,125,0.75)]">
                  {avatarText}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-[10px] font-medium text-[#9d7386]">Hoş geldiniz,</div>
                  <div className="flex items-center gap-1 text-[12px] font-semibold text-[#3c2733]">
                    <span className="max-w-[130px] truncate">{displayName}</span>
                    <ChevronDown className="h-3 w-3 text-[#9d7386]" strokeWidth={1.6} />
                  </div>
                  <div className="sr-only">{displayRole}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* COMMAND PALETTE OVERLAY */}
      <AnimatePresence>
        {paletteOpen && (
          <motion.div
            key="palette-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[200] flex items-start justify-center bg-[#4a2335]/18 px-4 pt-[12vh] backdrop-blur-md"
            onClick={() => setPaletteOpen(false)}
          >
            <motion.div
              key="palette-shell"
              initial={{ opacity: 0, y: -18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-xl overflow-hidden rounded-[24px] border border-[#ead8df]/85 bg-white/96 shadow-[0_36px_110px_rgba(150,78,104,0.22)] backdrop-blur-2xl"
            >
              {/* aurora wash */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#f0aac2]/20 blur-3xl"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-[#ffd3df]/12 blur-3xl"
              />

              {/* input */}
              <div className="relative flex items-center gap-3 border-b border-[#ead8df]/75 px-5 py-4">
                <Search className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handlePaletteKeyDown}
                  placeholder={placeholder}
                  className="flex-1 bg-transparent text-[14px] text-[#352432] placeholder:text-[#9d7386]/55 focus:outline-none"
                  aria-label="Komut paleti"
                />
                <kbd className="hidden rounded-md border border-[#ead8df] bg-[#fff7fa] px-1.5 text-[9px] font-semibold text-[#9d7386] sm:inline-block">
                  ESC
                </kbd>
              </div>

              {/* results */}
              <div className="relative max-h-[55vh] overflow-y-auto p-2">
                {results.length ? (
                  <motion.div
                    variants={paletteResultsVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-0.5"
                  >
                    {results.map((item, i) => {
                      const active = i === activeIndex
                      const isCurrent = pathname === item.path
                      return (
                        <motion.button
                          key={item.path}
                          variants={paletteRowVariants}
                          type="button"
                          onMouseEnter={() => setActiveIndex(i)}
                          onClick={() => goToResult(item)}
                          className={`group flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors ${
                            active
                              ? 'rounded-2xl bg-gradient-to-r from-[#fff1f6] via-white to-transparent text-[#352432]'
                              : 'text-[#7c6170]/78 hover:text-[#352432]'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            {item.action ? (
                              <Zap className="h-3.5 w-3.5 shrink-0 text-[#ef6f94]" strokeWidth={2} fill="currentColor" />
                            ) : (
                              <motion.span
                                animate={active ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0.4 }}
                                transition={{ duration: 0.25 }}
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ef6f94] shadow-[0_0_10px_rgba(239,111,148,0.42)]"
                              />
                            )}
                            <span className="truncate">{item.label}</span>
                            {item.action && (
                              <span className="shrink-0 rounded-full border border-[#efbfd0]/75 bg-[#fff1f6] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest text-[#c85776]">
                                Aksiyon
                              </span>
                            )}
                            {isCurrent && (
                              <span className="shrink-0 border border-[#efbfd0]/75 bg-[#f0aac2]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest text-[#c85776]">
                                Açık
                              </span>
                            )}
                          </span>
                          <AnimatePresence>
                            {active && (
                              <motion.span
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -4 }}
                                className="flex items-center gap-1 text-[10px] font-semibold text-[#c85776]"
                              >
                                Git <CornerDownLeft className="h-3 w-3" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.button>
                      )
                    })}
                  </motion.div>
                ) : (
                  <div className="px-3 py-6 text-center text-[12px] text-[#7c6170]/65">
                    Sonuç bulunamadı. Farklı bir kelime deneyin.
                  </div>
                )}
              </div>

              {/* footer */}
              <div className="relative flex items-center justify-between border-t border-[#ead8df]/75 bg-[#fff7fa]/78 px-5 py-2.5 text-[10px] font-semibold text-[#9d7386]/78">
                <span className="flex items-center gap-3">
                  <span>↑↓ gezin</span>
                  <span>↵ git</span>
                </span>
                <span>ESC kapat</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
