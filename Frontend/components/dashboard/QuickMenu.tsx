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
  GripVertical,
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
  { id: 'randevu-yeni', label: 'Yeni Randevu', icon: CalendarPlus, href: '/admin/randevular?action=new' },
  { id: 'musteri-yeni', label: 'Yeni Müşteri', icon: UserPlus, href: '/admin/musteriler?action=new' },
  { id: 'randevular', label: 'Randevular', icon: Calendar, href: '/admin/randevular' },
  { id: 'musteriler', label: 'Müşteriler', icon: Users, href: '/admin/musteriler' },
  { id: 'kasa', label: 'Günlük Kasa', icon: Wallet, href: '/admin/kasa' },
  { id: 'on-muhasebe', label: 'Ön Muhasebe', icon: Landmark, href: '/admin/on-muhasebe' },
  { id: 'adisyon', label: 'Adisyon', icon: ClipboardList, href: '/admin/on-muhasebe?scope=adisyon' },
  { id: 'paketler', label: 'Paket & Hizmet', icon: Package, href: '/admin/paketler' },
  { id: 'stok', label: 'Stok & Ürün', icon: Boxes, href: '/admin/stok' },
  { id: 'raporlar', label: 'Raporlar', icon: FileBarChart, href: '/admin/raporlar' },
  { id: 'bildirimler', label: 'Bildirimler', icon: BellRing, href: '/admin/bildirimler' },
  { id: 'personel', label: 'Personel', icon: UserCog, href: '/admin/personel', adminOnly: true },
  { id: 'onaylar', label: 'Onaylar', icon: ShieldCheck, href: '/admin/onaylar', adminOnly: true },
]

const DEFAULT_IDS = ['randevu-yeni', 'musteri-yeni', 'kasa', 'adisyon', 'raporlar']

/** Personelin hızlı menüsü: işlemler /personel/* sayfalarına gider ve rol izniyle süzülür. */
const STAFF_CATALOG: QuickAction[] = [
  { id: 'randevu-yeni', label: 'Yeni Randevu', icon: CalendarPlus, href: '/personel/randevular?action=new', permissionKey: 'Appointments' },
  { id: 'musteri-yeni', label: 'Yeni Müşteri', icon: UserPlus, href: '/personel/musteriler?action=new', permissionKey: 'Customers' },
  { id: 'randevular', label: 'Randevularım', icon: Calendar, href: '/personel/randevular', permissionKey: 'Appointments' },
  { id: 'musteriler', label: 'Müşterilerim', icon: Users, href: '/personel/musteriler', permissionKey: 'Customers' },
  { id: 'seanslar', label: 'Seanslarım', icon: Scissors, href: '/personel/seanslar', permissionKey: 'Services' },
  { id: 'paketler', label: 'Paket & Hizmet', icon: Package, href: '/personel/paketler', permissionKey: 'Services' },
  { id: 'kasa', label: 'Günlük Kasa', icon: Wallet, href: '/personel/kasa', permissionKey: 'CashRegister' },
  { id: 'on-muhasebe', label: 'Ön Muhasebe', icon: Landmark, href: '/personel/on-muhasebe', permissionKey: 'Accounting' },
  { id: 'adisyon', label: 'Adisyon', icon: ClipboardList, href: '/personel/on-muhasebe?scope=adisyon', permissionKey: 'Accounting' },
  { id: 'stok', label: 'Stok & Ürün', icon: Boxes, href: '/personel/stok', permissionKey: 'Stock' },
  { id: 'raporlar', label: 'Raporlar', icon: FileBarChart, href: '/personel/raporlar', permissionKey: 'Reports' },
  { id: 'bildirimler', label: 'Bildirimler', icon: BellRing, href: '/personel/bildirimler', permissionKey: 'Notifications' },
  { id: 'loglar', label: 'Loglarım', icon: ScrollText, href: '/personel/loglar', permissionKey: 'Logs' },
  { id: 'profil', label: 'Profilim', icon: UserRound, href: '/personel/profil' },
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
  // 170° → 10° arası yay (alt kenara yapışık FAB'dan yukarı doğru), tek eleman tepede
  const start = (170 * Math.PI) / 180
  const end = (10 * Math.PI) / 180
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

  // Rol'e göre katalog + varsayılanlar. Personelde işlemler /personel/* sayfalarına gider
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

  return (
    <>
      {/* Karartma */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-[#3b2330]/30 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* FAB + radial yay */}
      <div className="fixed bottom-16 left-1/2 z-[75] -translate-x-1/2 lg:bottom-0">
        <AnimatePresence>
          {open &&
            actions.map((action, i) => {
              const pos = arcPosition(i, actions.length, 130)
              const Icon = action.icon
              return (
                <motion.button
                  key={action.id}
                  initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                  animate={{ x: pos.x, y: pos.y, scale: 1, opacity: 1 }}
                  exit={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 24, delay: i * 0.035 }}
                  onClick={() => go(action.href)}
                  className="group absolute left-1/2 top-1/2 -ml-7 -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-[#3b2330] text-[#f4d7c3] shadow-lg shadow-[#3b2330]/40 ring-1 ring-[#b76e79]/40 transition-colors hover:bg-[#7a2940] hover:text-white"
                  title={action.label}
                >
                  <Icon className="h-6 w-6" />
                  <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#3b2330] px-3 py-1 text-xs font-medium text-[#f4d7c3] opacity-0 shadow transition-opacity group-hover:opacity-100">
                    {action.label}
                  </span>
                </motion.button>
              )
            })}

          {/* Düzenle butonu — yönetici kurum menüsünü, personel kendi menüsünü düzenler */}
          {open && (
            <motion.button
              key="edit"
              initial={{ y: 0, scale: 0, opacity: 0 }}
              animate={{ y: -2, x: 85, scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 24, delay: actions.length * 0.035 }}
              onClick={() => {
                setOpen(false)
                setEditing(true)
              }}
              className="absolute left-1/2 top-1/2 -ml-5 -mt-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#b76e79] text-white shadow-md ring-1 ring-white/30 hover:bg-[#7a2940]"
              title="Hızlı menüyü düzenle"
            >
              <Settings2 className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => setOpen((v) => !v)}
          whileTap={{ scale: 0.95 }}
          className="relative flex h-12 w-24 items-start justify-center rounded-t-full bg-gradient-to-b from-[#7a2940] to-[#3b2330] pt-3 text-[#f4d7c3] shadow-xl shadow-[#7a2940]/40 ring-1 ring-[#b76e79]/50"
          title="Hızlı menü"
        >
          <motion.span
            key={open ? 'x' : 'menu'}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {open ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
          </motion.span>
        </motion.button>
      </div>

      {/* Düzenleme modalı */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-[#3b2330]/50 p-4 backdrop-blur-sm"
            onClick={() => setEditing(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.92, y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between bg-gradient-to-r from-[#7a2940] to-[#3b2330] px-5 py-4 text-white">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-[#f4d7c3]" />
                  <div>
                    <h3 className="text-sm font-semibold">Hızlı Menüyü Düzenle</h3>
                    <p className="text-xs text-white/70">
                      En fazla {MAX_ITEMS} işlem · {ids.length} seçili
                    </p>
                  </div>
                </div>
                <button onClick={() => setEditing(false)} className="rounded-full p-1 hover:bg-white/15">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[60vh] space-y-1 overflow-y-auto p-4">
                {/* Seçililer (sıralanabilir) */}
                {ids.map((id) => {
                  const action = allowedCatalog.find((a) => a.id === id)
                  if (!action) return null
                  const Icon = action.icon
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-3 rounded-2xl border border-[#b76e79]/30 bg-[#fff7fa] px-3 py-2"
                    >
                      <GripVertical className="h-4 w-4 text-[#b76e79]/60" />
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3b2330] text-[#f4d7c3]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm font-medium text-[#3b2330]">{action.label}</span>
                      <button
                        onClick={() => move(id, -1)}
                        className="rounded-lg px-1.5 py-0.5 text-xs text-[#7a2940] hover:bg-[#7a2940]/10"
                        title="Yukarı taşı"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(id, 1)}
                        className="rounded-lg px-1.5 py-0.5 text-xs text-[#7a2940] hover:bg-[#7a2940]/10"
                        title="Aşağı taşı"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => toggleId(id)}
                        className="rounded-lg p-1 text-[#7a2940] hover:bg-[#7a2940]/10"
                        title="Kaldır"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}

                <p className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-[#b76e79]">
                  Eklenebilir işlemler
                </p>
                {allowedCatalog.filter((a) => !ids.includes(a.id)).map((action) => {
                  const Icon = action.icon
                  const full = ids.length >= MAX_ITEMS
                  return (
                    <button
                      key={action.id}
                      onClick={() => toggleId(action.id)}
                      disabled={full}
                      className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-left transition-colors hover:border-[#b76e79]/30 hover:bg-[#fff7fa] disabled:opacity-40"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4d7c3]/60 text-[#7a2940]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm text-[#3b2330]">{action.label}</span>
                      <Plus className="h-4 w-4 text-[#b76e79]" />
                    </button>
                  )
                })}
              </div>

              <div className="border-t border-[#b76e79]/20 px-4 py-3 text-right">
                <button
                  onClick={() => save(defaultIds)}
                  className="mr-2 rounded-xl px-3 py-1.5 text-sm text-[#7a2940] hover:bg-[#7a2940]/10"
                >
                  Varsayılana dön
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-xl bg-gradient-to-r from-[#7a2940] to-[#3b2330] px-4 py-1.5 text-sm font-medium text-white shadow"
                >
                  Tamam
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
