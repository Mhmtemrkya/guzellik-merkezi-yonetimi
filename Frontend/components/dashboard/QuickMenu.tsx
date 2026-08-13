'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus,
  X,
  Menu as MenuIcon,
  CalendarPlus,
  UserPlus,
  Wallet,
  Package,
  Boxes,
  FileBarChart,
  BellRing,
  Landmark,
  Users,
  Calendar,
  Settings2,
  UserCog,
  ClipboardList,
  ShieldCheck,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Scissors,
  UserRound,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { useBranch } from './BranchContext'

/** Hızlı menüye eklenebilecek işlem kataloğu. */
export interface QuickAction {
  id: string
  label: string
  icon: LucideIcon
  href: string
  /** Personel rolünde gizlenecekse (kurum yöneticisi kataloğunda) */
  adminOnly?: boolean
  /** Personel kataloğunda: bu işlem için gerekli rol izni (personelde yoksa gizlenir). */
  permissionKey?: string
}

const CATALOG: QuickAction[] = [
  { id: 'randevu-yeni', label: 'Yeni Randevu', icon: CalendarPlus, href: '/panel/randevular?action=new' },
  { id: 'musteri-yeni', label: 'Yeni Müşteri', icon: UserPlus, href: '/panel/musteriler?action=new' },
  { id: 'randevular', label: 'Randevular', icon: Calendar, href: '/panel/randevular' },
  { id: 'musteriler', label: 'Müşteriler', icon: Users, href: '/panel/musteriler' },
  { id: 'kasa', label: 'Günlük Kasa', icon: Wallet, href: '/panel/kasa' },
  { id: 'on-muhasebe', label: 'Ön Muhasebe', icon: Landmark, href: '/panel/on-muhasebe' },
  { id: 'adisyon', label: 'Adisyon', icon: ClipboardList, href: '/panel/on-muhasebe?scope=adisyon' },
  { id: 'paketler', label: 'Paket & Hizmet', icon: Package, href: '/panel/paketler' },
  { id: 'stok', label: 'Stok & Ürün', icon: Boxes, href: '/panel/stok' },
  { id: 'raporlar', label: 'Raporlar', icon: FileBarChart, href: '/panel/raporlar' },
  { id: 'bildirimler', label: 'Bildirimler', icon: BellRing, href: '/panel/bildirimler' },
  { id: 'personel', label: 'Personel', icon: UserCog, href: '/panel/personel', adminOnly: true },
  { id: 'onaylar', label: 'Onaylar', icon: ShieldCheck, href: '/panel/onaylar', adminOnly: true },
]

const DEFAULT_IDS = ['randevu-yeni', 'musteri-yeni', 'kasa', 'adisyon', 'raporlar']

/** Personelin hızlı menüsü: işlemler /ekip/* sayfalarına gider ve rol izniyle süzülür. */
const STAFF_CATALOG: QuickAction[] = [
  { id: 'randevu-yeni', label: 'Yeni Randevu', icon: CalendarPlus, href: '/ekip/randevular?action=new', permissionKey: 'Appointments' },
  { id: 'musteri-yeni', label: 'Yeni Müşteri', icon: UserPlus, href: '/ekip/musteriler?action=new', permissionKey: 'Customers' },
  { id: 'randevular', label: 'Randevularım', icon: Calendar, href: '/ekip/randevular', permissionKey: 'Appointments' },
  { id: 'musteriler', label: 'Müşterilerim', icon: Users, href: '/ekip/musteriler', permissionKey: 'Customers' },
  { id: 'seanslar', label: 'Seanslarım', icon: Scissors, href: '/ekip/seanslar', permissionKey: 'Services' },
  { id: 'paketler', label: 'Paket & Hizmet', icon: Package, href: '/ekip/paketler', permissionKey: 'Services' },
  { id: 'kasa', label: 'Günlük Kasa', icon: Wallet, href: '/ekip/kasa', permissionKey: 'CashRegister' },
  { id: 'on-muhasebe', label: 'Ön Muhasebe', icon: Landmark, href: '/ekip/on-muhasebe', permissionKey: 'Accounting' },
  { id: 'adisyon', label: 'Adisyon', icon: ClipboardList, href: '/ekip/on-muhasebe?scope=adisyon', permissionKey: 'Accounting' },
  { id: 'stok', label: 'Stok & Ürün', icon: Boxes, href: '/ekip/stok', permissionKey: 'Stock' },
  { id: 'raporlar', label: 'Raporlar', icon: FileBarChart, href: '/ekip/raporlar', permissionKey: 'Reports' },
  { id: 'bildirimler', label: 'Bildirimler', icon: BellRing, href: '/ekip/bildirimler', permissionKey: 'Notifications' },
  { id: 'loglar', label: 'Loglarım', icon: ScrollText, href: '/ekip/loglar', permissionKey: 'Logs' },
  { id: 'profil', label: 'Profilim', icon: UserRound, href: '/ekip/profil' },
]
const STAFF_DEFAULT_IDS = ['randevu-yeni', 'musteri-yeni', 'randevular', 'seanslar', 'kasa']
const MAX_ITEMS = 7
const STORAGE_KEY = 'beautyasist.quickmenu.v1'
const STAFF_STORAGE_KEY = 'beautyasist.quickmenu.staff.v1'

/** Kurum yöneticisi hızlı menüsü kuruma özeldir: anahtar tenantId ile etiketlenir. */
function quickMenuKey(institutionId?: string | null): string {
  return institutionId ? `${STORAGE_KEY}.${institutionId}` : STORAGE_KEY
}

/** Personel hızlı menüsü kişiye özeldir: anahtar personelin kullanıcı id'siyle etiketlenir. */
function staffQuickMenuKey(userId?: string | null): string {
  return userId ? `${STAFF_STORAGE_KEY}.${userId}` : STAFF_STORAGE_KEY
}

function parseIds(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed.slice(0, MAX_ITEMS)
  } catch {
    /* bozuk kayıt */
  }
  return null
}

function loadIds(key: string, fallback: string[], legacyKey?: string): string[] {
  if (typeof window === 'undefined') return fallback
  // Önce kişiye/kuruma özel anahtar; yoksa (varsa) eski global anahtar; yoksa varsayılan.
  return parseIds(localStorage.getItem(key)) ?? (legacyKey ? parseIds(localStorage.getItem(legacyKey)) : null) ?? fallback
}

/** Radial menü: butonları FAB merkezli yarım daire yayına dizer. */
function arcPosition(index: number, total: number, radius: number) {
  // 164° → 16° arası yay (alt kenara yapışık FAB'dan yukarı doğru), tek eleman tepede.
  // Uçlar biraz içeri alındı: etiket balonları ekran kenarına taşmasın.
  const start = (164 * Math.PI) / 180
  const end = (16 * Math.PI) / 180
  const t = total === 1 ? 0.5 : index / (total - 1)
  const angle = start + (end - start) * t
  return { x: Math.cos(angle) * radius, y: -Math.sin(angle) * radius }
}

export default function QuickMenu() {
  const router = useRouter()
  const { user } = useAuth()
  const { selectedInstitutionId } = useBranch()
  const isStaff = user?.role === 'Staff'
  const isAdmin = !isStaff

  // Rol'e göre katalog + varsayılanlar. Personelde işlemler /ekip/* sayfalarına gider
  // ve personelin rol izniyle süzülür; yöneticide kurum kataloğu kullanılır.
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions])
  const catalog = isStaff ? STAFF_CATALOG : CATALOG
  const defaultIds = isStaff ? STAFF_DEFAULT_IDS : DEFAULT_IDS
  // Personel kataloğunda yalnızca izin verilen işlemler (yetki yoksa o işlem hiç görünmez).
  const allowedCatalog = useMemo(
    () => catalog.filter((a) => (isStaff ? !a.permissionKey || permissions.has(a.permissionKey) : isAdmin || !a.adminOnly)),
    [catalog, isStaff, isAdmin, permissions],
  )

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState<string[]>(defaultIds)

  // Ayar kişiye/kuruma özel: personelde kullanıcı id'sine, yöneticide kurum id'sine göre yüklenir.
  const storageKey = useMemo(
    () => (isStaff ? staffQuickMenuKey(user?.userId) : quickMenuKey(selectedInstitutionId)),
    [isStaff, user?.userId, selectedInstitutionId],
  )

  useEffect(() => {
    setIds(loadIds(storageKey, defaultIds, isStaff ? undefined : STORAGE_KEY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const actions = useMemo(
    () =>
      ids
        .map((id) => allowedCatalog.find((a) => a.id === id))
        .filter((a): a is QuickAction => Boolean(a)),
    [ids, allowedCatalog],
  )

  const save = (next: string[]) => {
    setIds(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* depolama dolu/kapalı — sessizce geç */
    }
  }

  const toggleId = (id: string) => {
    if (ids.includes(id)) save(ids.filter((x) => x !== id))
    else if (ids.length < MAX_ITEMS) save([...ids, id])
  }

  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  // ESC menüyü kapatsın (açıkken sayfanın geri kalanı zaten karartma ile kilitli).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* Karartma — menü açıkken arka plan yumuşak bir vinyetle geri çekilir */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[70] backdrop-blur-[3px]"
            style={{ background: 'radial-gradient(120% 90% at 50% 100%, rgba(122,41,64,0.42) 0%, rgba(59,35,48,0.34) 45%, rgba(59,35,48,0.22) 100%)' }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* FAB + radial yay */}
      <div className="pointer-events-none fixed bottom-16 left-1/2 z-[75] -translate-x-1/2 lg:bottom-0">
        {/* Açıkken FAB'ın arkasında ışık halesi */}
        <AnimatePresence>
          {open && (
            <motion.span
              key="glow"
              aria-hidden
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.3 }}
              className="absolute left-1/2 top-1/2 -ml-[190px] -mt-[190px] h-[380px] w-[380px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255,214,228,0.30) 0%, rgba(255,214,228,0) 62%)' }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {open &&
            actions.map((action, i) => {
              const pos = arcPosition(i, actions.length, 148)
              const Icon = action.icon
              return (
                <motion.button
                  key={action.id}
                  initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                  animate={{ x: pos.x, y: pos.y, scale: 1, opacity: 1 }}
                  exit={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26, delay: i * 0.04 }}
                  whileHover={{ scale: 1.07 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => go(action.href)}
                  className="pointer-events-auto group absolute left-1/2 top-1/2 -ml-[44px] -mt-[44px] flex w-[88px] flex-col items-center gap-1.5"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-white/70 bg-gradient-to-b from-white to-[#fff1f6] text-[#a63e5f] shadow-[0_18px_34px_-16px_rgba(59,35,48,0.6)] transition-colors group-hover:from-[#A5556E] group-hover:to-[#a63e5f] group-hover:text-white">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="max-w-[88px] rounded-full bg-[#3b2330]/85 px-2 py-0.5 text-center text-[10.5px] font-semibold leading-tight text-[#ffe7ef] shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)] backdrop-blur-sm">
                    {action.label}
                  </span>
                </motion.button>
              )
            })}

          {/* Düzenle — FAB'ın TAM ÜSTÜNDE, ortalanmış.
              DİKKAT: motion `transform`u yazdığı için `-translate-x-1/2` iç öğeye verilemez;
              ortalama dıştaki statik katmanda yapılır, animasyon içeride kalır. */}
          {open && (
            <div key="edit" className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 pb-1.5">
              <motion.button
                initial={{ y: 14, scale: 0.8, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ y: 14, scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26, delay: actions.length * 0.04 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => { setOpen(false); setEditing(true) }}
                className="pointer-events-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#f0d9e2] bg-white/95 px-3.5 py-1.5 text-[11px] font-semibold text-[#a63e5f] shadow-[0_14px_30px_-14px_rgba(59,35,48,0.6)] backdrop-blur-sm transition-colors hover:bg-[#F6DFE6]"
                title="Hızlı menüyü düzenle"
              >
                <Settings2 className="h-3.5 w-3.5" /> Menüyü düzenle
              </motion.button>
            </div>
          )}
        </AnimatePresence>

        {/* FAB — açık zeminli kavisli taban + markalı bordo yuvarlak buton */}
        <div className="pointer-events-none relative flex h-[64px] w-[148px] items-end justify-center">
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[40px] rounded-t-[74px] border border-b-0 border-[#f0d9e2] bg-white shadow-[0_-12px_34px_-16px_rgba(122,41,64,0.45)] backdrop-blur-md"
          />
          <span
            aria-hidden
            className="absolute inset-x-12 bottom-[38px] h-[2px] rounded-full opacity-70"
            style={{ background: 'linear-gradient(90deg, transparent, #f0d9e2 35%, #d9a441 50%, #f0d9e2 65%, transparent)' }}
          />

          <motion.button
            onClick={() => setOpen((v) => !v)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            className="pointer-events-auto absolute bottom-[12px] grid h-[60px] w-[60px] place-items-center rounded-full bg-gradient-to-br from-[#e0617f] via-[#A5556E] to-[#8e3f5b] text-white shadow-[0_20px_38px_-16px_rgba(140,50,80,0.95)] ring-[3px] ring-white"
            title="Hızlı menü"
            aria-label="Hızlı menü"
            aria-expanded={open}
          >
            <span aria-hidden className="absolute inset-[3px] rounded-full ring-1 ring-white/35" />
            <motion.span
              className="relative"
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            >
              {open ? <X className="h-[26px] w-[26px]" /> : <MenuIcon className="h-[26px] w-[26px]" />}
            </motion.span>
            {!open && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full ring-2 ring-[#e78ba8]/60"
                animate={{ scale: [1, 1.2, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.button>
        </div>
      </div>

      {/* Düzenleme modalı */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-[#3b2330]/45 p-4 backdrop-blur-sm"
            onClick={() => setEditing(false)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 18, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 18, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="flex w-full max-w-lg flex-col overflow-hidden rounded-[26px] border border-[#EAD8DF] bg-white shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)]"
              style={{ maxHeight: 'min(88dvh, 760px)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Başlık */}
              <div className="relative shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f8] via-white to-[#fff2f6] px-5 py-4">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                  style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 22%, #d9a441 50%, #ffd3df 78%, transparent)' }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#A5556E]">
                      <Sparkles className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15.5px] font-bold text-[#2b1e29]">Hızlı menüyü düzenle</h3>
                      <p className="mt-0.5 text-[11.5px] text-[#74616A]">
                        Alt menüde görünecek kısayolları seç ve sırala.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditing(false)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#7e5f6e] transition hover:border-[#BE7690] hover:text-[#3b2330]"
                    aria-label="Kapat"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Doluluk göstergesi */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf] transition-all"
                      style={{ width: `${Math.round((ids.length / MAX_ITEMS) * 100)}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-[10.5px] font-semibold text-[#74616A]">{ids.length}/{MAX_ITEMS} kısayol</span>
                </div>
              </div>

              {/* Gövde */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">Menüdeki sıra</div>
                <div className="mt-2 space-y-1.5">
                  {ids.map((id, index) => {
                    const action = allowedCatalog.find((a) => a.id === id)
                    if (!action) return null
                    const Icon = action.icon
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2.5 rounded-[14px] border border-[#f0dae2] bg-[#F7F6F6] px-3 py-2.5"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[10.5px] font-bold text-[#8C4460] ring-1 ring-[#f0d9e2]">
                          {index + 1}
                        </span>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#A5556E] to-[#8C4460] text-white">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#2A2027]">{action.label}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => move(id, -1)}
                            disabled={index === 0}
                            className="grid h-7 w-7 place-items-center rounded-[9px] border border-[#EAD8DF] bg-white text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:opacity-30"
                            title="Yukarı taşı"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => move(id, 1)}
                            disabled={index === ids.length - 1}
                            className="grid h-7 w-7 place-items-center rounded-[9px] border border-[#EAD8DF] bg-white text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:opacity-30"
                            title="Aşağı taşı"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => toggleId(id)}
                            className="grid h-7 w-7 place-items-center rounded-[9px] border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100"
                            title="Menüden çıkar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    )
                  })}
                  {ids.length === 0 && (
                    <div className="rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-6 text-center text-[11.5px] text-[#74616A]">
                      Menü boş — aşağıdan kısayol ekle.
                    </div>
                  )}
                </div>

                <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">Eklenebilir işlemler</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {allowedCatalog.filter((a) => !ids.includes(a.id)).map((action) => {
                    const Icon = action.icon
                    const full = ids.length >= MAX_ITEMS
                    return (
                      <button
                        key={action.id}
                        onClick={() => toggleId(action.id)}
                        disabled={full}
                        className="flex items-center gap-2.5 rounded-[14px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#BE7690] hover:bg-[#fff7fa] disabled:opacity-40"
                        title={full ? `En fazla ${MAX_ITEMS} kısayol eklenebilir` : undefined}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F6DFE6] text-[#a63e5f]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#3E343A]">{action.label}</span>
                        <Plus className="h-4 w-4 shrink-0 text-[#A5556E]" />
                      </button>
                    )
                  })}
                  {allowedCatalog.filter((a) => !ids.includes(a.id)).length === 0 && (
                    <div className="rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-5 text-center text-[11.5px] text-[#74616A] sm:col-span-2">
                      Tüm işlemler menüde.
                    </div>
                  )}
                </div>
              </div>

              {/* Alt bar */}
              <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => save(defaultIds)}
                    className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#BE7690]"
                  >
                    Varsayılana dön
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
                  >
                    Tamam
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
