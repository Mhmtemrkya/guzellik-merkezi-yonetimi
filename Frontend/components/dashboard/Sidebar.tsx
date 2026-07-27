'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  ChevronsLeft,
  CornerDownLeft,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useBranch } from './BranchContext'
import { useAuth } from './AuthContext'

// ---------------------------------------------------------------------------
// SIDEBAR
// Panelin omurgası. Pano diliyle aynı: cam yüzey + aurora, gradyan ikon çipi,
// rozetli satırlar. İşlevsel olarak üç şey ekler:
//   • Ray modu (daraltılmış 78px) — tercih localStorage'da kalır, ipuçları uçar.
//   • Sayfa arama — "/" ya da Ctrl/⌘+K ile odaklanır, alt sayfalarda da arar.
//   • Aktif rota göstergesi — gruplar arası yumuşak geçen ışıklı şerit.
// ---------------------------------------------------------------------------

export interface SidebarChildItem {
  label: string
  href: string
  badge?: string | number
}

export interface SidebarNavItem {
  group?: string
  label: string
  href: string
  icon: LucideIcon
  badge?: string | number
  children?: SidebarChildItem[]
  /** Personel rolü için sayfa izin anahtarı. Kullanıcının permissions listesinde yoksa item gizlenir. */
  permissionKey?: string
  /** Paket özellik anahtar(lar)ı. Tenant'ın paketinde bunlardan hiçbiri yoksa item gizlenir. */
  featureKeys?: string[]
}

export interface SidebarUser {
  name: string
  role: string
  avatar: string
}

interface SidebarProps {
  items: SidebarNavItem[]
  role: string
  user: SidebarUser
  version?: string
}

const COLLAPSE_STORAGE_KEY = 'ba:sidebar:collapsed'

function isActivePath(pathname: string | null, href: string): boolean {
  const rootRoutes = ['/admin', '/personel', '/platform']
  if (!pathname) return false
  if (rootRoutes.includes(href)) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Arama karşılaştırması — Türkçe küçük harf (İ/I tuzağına düşmemek için). */
function tr(value: string): string {
  return value.toLocaleLowerCase('tr')
}

const groupAccordion: Variants = {
  open: { height: 'auto', opacity: 1, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
  closed: { height: 0, opacity: 0, transition: { duration: 0.24, ease: [0.7, 0, 0.84, 0] } },
}

const childListAccordion: Variants = {
  open: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1], staggerChildren: 0.04, delayChildren: 0.05 },
  },
  closed: { height: 0, opacity: 0, transition: { duration: 0.22, ease: [0.7, 0, 0.84, 0] } },
}

const childItemVariants: Variants = {
  open: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
  closed: { opacity: 0, x: -8 },
}

/** Ray modunda satırın yanında beliren ipucu (nav kırpmasın diye fixed konumlanır). */
interface RailHint {
  label: string
  top: number
}

interface NavGroupsProps {
  groups: Record<string, SidebarNavItem[]>
  pathname: string | null
  onNavigate: () => void
  openGroups: Record<string, boolean>
  toggleGroup: (group: string) => void
  openItems: Record<string, boolean>
  toggleItem: (href: string) => void
  mobile?: boolean
  /** Ray modu: yalnız ikonlar, etiketler ipucu olarak uçar. */
  collapsed?: boolean
  onHint?: (hint: RailHint | null) => void
  /** layoutId çakışmasın diye masaüstü/mobil örnekleri ayrı ad alanı kullanır. */
  idPrefix: string
  /** Aramada eşleşen parça vurgulanır. */
  query?: string
}

/** Eşleşen harfleri vurgular — arama yaparken gözün nereye bakacağını söyler. */
function Highlight({ text, query }: { text: string; query?: string }) {
  const q = (query || '').trim()
  if (!q) return <>{text}</>
  const idx = tr(text).indexOf(tr(q))
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[4px] bg-[#ffe0eb] px-0.5 text-[#9b4c65]">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

function NavGroups({
  groups,
  pathname,
  onNavigate,
  openGroups,
  toggleGroup,
  openItems,
  toggleItem,
  mobile = false,
  collapsed = false,
  onHint,
  idPrefix,
  query,
}: NavGroupsProps) {
  return (
    <nav
      className={`${
        mobile ? 'space-y-4 px-3 py-4' : 'no-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-4'
      } ${collapsed ? 'px-2' : ''}`}
    >
      {Object.entries(groups).map(([groupName, list], gi) => {
        const isOpen = openGroups[groupName] ?? true
        return (
          <div key={groupName}>
            {collapsed ? (
              // Ray modunda başlık yerine ince bir ayraç kalır — ritim korunur, yer harcanmaz.
              gi > 0 && <div aria-hidden className="mx-auto mb-2.5 h-px w-7 bg-gradient-to-r from-transparent via-[#efbfd0] to-transparent" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(groupName)}
                className="group flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wide text-[#8a6a79] transition-colors hover:text-[#c85776]"
              >
                <span className="flex items-center gap-2">
                  <motion.span
                    className="inline-block h-px w-3 bg-[#efbfd0] transition-all group-hover:w-5 group-hover:bg-[#ef6f94]"
                    layout
                  />
                  {groupName}
                  <span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b1798e] ring-1 ring-[#f6dde6]">
                    {list.length}
                  </span>
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 0 : -90 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="text-[#b1798e] group-hover:text-[#c85776]"
                >
                  <ChevronDown className="h-3 w-3" strokeWidth={1.6} />
                </motion.span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {(isOpen || collapsed) && (
                <motion.div
                  key={`group-${groupName}`}
                  initial="closed"
                  animate="open"
                  exit="closed"
                  variants={groupAccordion}
                  className="overflow-hidden"
                >
                  <div className={`space-y-0.5 ${collapsed ? 'mt-0' : 'mt-1.5'}`}>
                    {list.map((it, i) => {
                      const active = isActivePath(pathname, it.href)
                      const hasChildren = !!it.children?.length
                      const childOpen = !collapsed && hasChildren && (openItems[it.href] ?? active)
                      const Icon = it.icon

                      return (
                        <div key={it.href}>
                          <motion.div
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                              duration: 0.35,
                              delay: 0.03 * i + 0.02 * gi,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="relative"
                          >
                            {active && (
                              <motion.span
                                layoutId={`${idPrefix}-sidebar-active-indicator`}
                                className="pointer-events-none absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-full bg-gradient-to-b from-[#f7b6cb] via-[#ef6f94] to-[#d65f83] shadow-[0_0_16px_rgba(239,111,148,0.32)]"
                                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                              />
                            )}

                            <div
                              className={`group/item relative flex min-h-11 items-center overflow-hidden rounded-[16px] transition-colors ${
                                collapsed ? 'justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2'
                              } text-[13px] ${
                                active
                                  ? 'bg-gradient-to-r from-[#fff1f6] to-white text-[#9b4c65] shadow-[0_12px_26px_-16px_rgba(214,95,131,0.55)] ring-1 ring-[#efbfd0]/70'
                                  : 'text-[#5f4855] hover:bg-[#fff4f8] hover:text-[#9b4c65]'
                              }`}
                            >
                              {/* Hover'da soldan süzülen ışık — aktif satırda gerekmez. */}
                              {!active && (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#ffdce8]/72 via-white/70 to-transparent transition-transform duration-500 group-hover/item:translate-x-0"
                                />
                              )}

                              <Link
                                href={it.href}
                                onClick={onNavigate}
                                title={collapsed ? it.label : undefined}
                                onMouseEnter={(e) => {
                                  if (!collapsed || !onHint) return
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  onHint({ label: it.label, top: r.top + r.height / 2 })
                                }}
                                onMouseLeave={() => onHint?.(null)}
                                className={`relative z-10 flex flex-1 items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}
                              >
                                {/* İkon çipi: aktifken markanın gradyanıyla dolu, boştayken yumuşak gül zemin. */}
                                <motion.span
                                  whileHover={{ scale: 1.08, rotate: active ? 0 : -5 }}
                                  transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                                  className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-[11px] transition-colors ${
                                    active
                                      ? 'bg-gradient-to-br from-[#ef6f94] to-[#c85776] text-white shadow-[0_10px_20px_-12px_rgba(200,87,118,0.9)]'
                                      : 'bg-[#fff5f8] text-[#a3707f] ring-1 ring-[#f6e3ea] group-hover/item:bg-white group-hover/item:text-[#c85776] group-hover/item:ring-[#efbfd0]'
                                  }`}
                                >
                                  <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
                                  {/* Ray modunda rozet, sayı yerine ışıklı bir noktaya iner. */}
                                  {collapsed && it.badge !== undefined && (
                                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ef6f94] ring-2 ring-white" />
                                  )}
                                </motion.span>

                                {!collapsed && (
                                  <>
                                    <span className="flex-1 truncate">
                                      <Highlight text={it.label} query={query} />
                                    </span>
                                    {it.badge !== undefined && (
                                      <motion.span
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ delay: 0.18 + i * 0.03, type: 'spring', stiffness: 380, damping: 22 }}
                                        className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                                          active
                                            ? 'rounded-full bg-[#c85776] text-white'
                                            : 'rounded-full bg-[#fff1f6] text-[#c85776] ring-1 ring-[#efbfd0]'
                                        }`}
                                      >
                                        {it.badge}
                                      </motion.span>
                                    )}
                                  </>
                                )}
                              </Link>

                              {hasChildren && !collapsed && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleItem(it.href)
                                  }}
                                  aria-label={childOpen ? 'Alt sayfaları kapat' : 'Alt sayfaları aç'}
                                  className={`relative z-10 -mr-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] transition-colors ${
                                    active
                                      ? 'text-[#9b4c65] hover:bg-white'
                                      : 'text-[#b1798e] hover:bg-white hover:text-[#c85776]'
                                  }`}
                                >
                                  <motion.span
                                    animate={{ rotate: childOpen ? 180 : 0 }}
                                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                                  >
                                    <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
                                  </motion.span>
                                </button>
                              )}
                            </div>
                          </motion.div>

                          {hasChildren && !collapsed && (
                            <AnimatePresence initial={false}>
                              {childOpen && (
                                <motion.div
                                  key={`children-${it.href}`}
                                  initial="closed"
                                  animate="open"
                                  exit="closed"
                                  variants={childListAccordion}
                                  className="relative ml-[26px] overflow-hidden pl-3"
                                >
                                  {/* Bağlantı çizgisi: üstte belirgin, altta söner. */}
                                  <span
                                    aria-hidden
                                    className="pointer-events-none absolute bottom-2 left-0 top-0 w-px bg-gradient-to-b from-[#efbfd0] via-[#f6dde6] to-transparent"
                                  />
                                  <div className="space-y-0.5 py-1">
                                    {it.children!.map((child) => {
                                      const childActive = pathname === child.href
                                      return (
                                        <motion.div key={child.href} variants={childItemVariants}>
                                          <Link
                                            href={child.href}
                                            onClick={onNavigate}
                                            className={`group/child relative flex min-h-9 items-center gap-2.5 rounded-[11px] px-2.5 py-1.5 text-[12px] transition-colors ${
                                              childActive
                                                ? 'bg-[#fff4f8] font-semibold text-[#c85776]'
                                                : 'text-[#6f5764] hover:bg-[#fff8fb] hover:text-[#c85776]'
                                            }`}
                                          >
                                            <span
                                              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${
                                                childActive
                                                  ? 'bg-[#ef6f94] shadow-[0_0_8px_rgba(239,111,148,0.45)] ring-2 ring-white'
                                                  : 'bg-[#e9c2d0] group-hover/child:bg-[#ef6f94]'
                                              }`}
                                            />
                                            <span className="flex-1 truncate">
                                              <Highlight text={child.label} query={query} />
                                            </span>
                                            {child.badge !== undefined && (
                                              <span className="text-[10px] font-semibold text-[#8a6a79]">{child.badge}</span>
                                            )}
                                          </Link>
                                        </motion.div>
                                      )
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </nav>
  )
}

interface UserBlockProps {
  user: SidebarUser
  pathname: string | null
  compact?: boolean
  collapsed?: boolean
}

function UserBlock({ user, pathname, compact = false, collapsed = false }: UserBlockProps) {
  const { selectedBranch, selectedInstitution } = useBranch()
  const { logout } = useAuth()
  const isPlatform = pathname?.startsWith('/platform')

  const signOut = async (): Promise<void> => {
    await logout()
    if (typeof window !== 'undefined') window.location.href = '/login'
  }

  // Ray modu: yalnız avatar + çıkış, dikey dizilir.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-[#ead8df]/75 px-2 py-3">
        <span
          title={`${user.name} · ${user.role}`}
          className="grid h-9 w-9 place-items-center rounded-[12px] bg-gradient-to-br from-[#fff1f6] to-white font-display text-[13px] text-[#7b3d55] ring-1 ring-[#efbfd0]"
        >
          {user.avatar}
        </span>
        <button
          type="button"
          onClick={signOut}
          title="Oturumu kapat"
          aria-label="Oturumu kapat"
          className="grid h-8 w-8 place-items-center rounded-[10px] text-[#a3707f] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    )
  }

  return (
    <div className={`${compact ? '' : 'border-t border-[#ead8df]/75 p-3.5'}`}>
      {selectedBranch && !isPlatform && !compact && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative mb-3 overflow-hidden rounded-[18px] border border-[#efbfd0]/80 bg-gradient-to-br from-[#fff1f6] via-white to-transparent px-3 py-2.5 shadow-[0_12px_32px_-28px_rgba(150,78,104,0.45)]"
        >
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold tracking-tight text-[#c85776]">Seçili kapsam</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] font-semibold text-[#352432]">{selectedInstitution?.name}</div>
          <div className="mt-0.5 truncate text-[10.5px] text-[#705a66]">
            {selectedBranch.name} · {selectedBranch.city}
          </div>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-8 h-16 w-16 rounded-full bg-[#ffdce8]/80 blur-2xl"
            animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.15, 1] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      )}

      <div className="group/user flex items-center gap-2.5 rounded-[16px] border border-[#f2e0e7] bg-white/70 p-2 transition-colors hover:border-[#efbfd0] hover:bg-white">
        <motion.div
          whileHover={{ scale: 1.04 }}
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-gradient-to-br from-[#ffe3ec] to-[#ffd0e0] font-display text-[13px] text-[#7b3d55]"
        >
          <span className="relative z-10">{user.avatar}</span>
          <motion.span
            aria-hidden
            animate={{ opacity: [0.25, 0.6, 0.25] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-0 rounded-[12px] ring-1 ring-[#ef6f94]/45"
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[#352432]">{user.name}</div>
          <div className="truncate text-[10.5px] text-[#8a6a79]">{user.role}</div>
        </div>
        {!isPlatform && (
          <Link
            href="/admin/ayarlar"
            aria-label="Ayarlar"
            title="Ayarlar"
            className="grid h-8 w-8 place-items-center rounded-[10px] text-[#a3707f] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.7} />
          </Link>
        )}
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={signOut}
          className="grid h-8 w-8 place-items-center rounded-[10px] text-[#a3707f] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
          aria-label="Oturumu kapat"
          title="Oturumu kapat"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
        </motion.button>
      </div>
    </div>
  )
}

/** Nav üstündeki arama kutusu — "/" ya da Ctrl/⌘+K ile odaklanır. */
function NavSearch({
  value,
  onChange,
  inputRef,
  resultCount,
}: {
  value: string
  onChange: (v: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  resultCount: number
}) {
  return (
    <div className="px-3 pt-3">
      <div className="group flex items-center gap-2 rounded-[14px] border border-[#f2e0e7] bg-white/75 px-2.5 py-2 transition-colors focus-within:border-[#efbfd0] focus-within:bg-white focus-within:shadow-[0_12px_30px_-24px_rgba(150,78,104,0.6)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-[#c85776]" strokeWidth={1.9} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('')
          }}
          placeholder="Sayfa ara"
          aria-label="Menüde sayfa ara"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[#352432] outline-none placeholder:text-[#a3707f]"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Aramayı temizle"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#a3707f] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : (
          <kbd className="shrink-0 rounded-[6px] border border-[#f2e0e7] bg-[#fff8fb] px-1.5 py-0.5 text-[10px] font-semibold text-[#a3707f]">/</kbd>
        )}
      </div>
      {value && (
        <div className="mt-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold text-[#8a6a79]">
          <CornerDownLeft className="h-3 w-3 text-[#c85776]" strokeWidth={2} />
          {resultCount > 0 ? `${resultCount} sayfa eşleşti` : 'Eşleşen sayfa yok'}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ items, role, user, version = '1.0' }: SidebarProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState<boolean>(false)
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [mobileQuery, setMobileQuery] = useState('')
  const [hint, setHint] = useState<RailHint | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ray tercihi kullanıcıya ait — sunucuda okunamaz, ilk render sonrası yüklenir.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1')
    } catch {
      /* depolama kapalıysa varsayılan geniş kalır */
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* yoksay */
      }
      if (next) setQuery('')
      return next
    })
    setHint(null)
  }, [])

  // "/" ya da Ctrl/⌘+K aramaya odaklanır; yazı alanındayken devreye girmez.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const isSearchHotkey = e.key === '/' || ((e.metaKey || e.ctrlKey) && tr(e.key) === 'k')
      if (!isSearchHotkey || typing) return
      e.preventDefault()
      setCollapsed((prev) => {
        if (!prev) return prev
        try {
          window.localStorage.setItem(COLLAPSE_STORAGE_KEY, '0')
        } catch {
          /* yoksay */
        }
        return false
      })
      // Ray açılıyorsa girdi bir sonraki boyamada var olur.
      window.setTimeout(() => searchRef.current?.focus(), 40)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Aramaya göre süzülmüş liste: başlık eşleşirse item bütün, yalnız alt sayfa eşleşirse o alt küme. */
  const filterItems = useCallback((source: SidebarNavItem[], q: string): SidebarNavItem[] => {
    const needle = tr(q.trim())
    if (!needle) return source
    const out: SidebarNavItem[] = []
    for (const it of source) {
      if (tr(it.label).includes(needle)) {
        out.push(it)
        continue
      }
      const kids = it.children?.filter((c) => tr(c.label).includes(needle))
      if (kids && kids.length > 0) out.push({ ...it, children: kids })
    }
    return out
  }, [])

  const desktopItems = useMemo(() => filterItems(items, query), [filterItems, items, query])
  const mobileDrawerItems = useMemo(() => filterItems(items, mobileQuery), [filterItems, items, mobileQuery])

  const groupBy = useCallback(
    (list: SidebarNavItem[]): Record<string, SidebarNavItem[]> =>
      list.reduce<Record<string, SidebarNavItem[]>>((acc, it) => {
        const g = it.group || 'Genel'
        ;(acc[g] = acc[g] || []).push(it)
        return acc
      }, {}),
    [],
  )

  const groups = useMemo(() => groupBy(desktopItems), [groupBy, desktopItems])
  const mobileGroups = useMemo(() => groupBy(mobileDrawerItems), [groupBy, mobileDrawerItems])

  // Yeni gelen gruplar varsayılan olarak açık başlar.
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      let changed = false
      Object.keys(groups).forEach((g) => {
        if (next[g] === undefined) {
          next[g] = true
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [groups])

  // Aktif rotayı içeren item'ın alt sayfaları kendiliğinden açılır.
  useEffect(() => {
    if (!pathname) return
    const activeParent = items.find(
      (it) => it.children?.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`)),
    )
    if (activeParent) {
      setOpenItems((prev) => (prev[activeParent.href] ? prev : { ...prev, [activeParent.href]: true }))
    }
  }, [pathname, items])

  // Arama yapılırken eşleşen alt sayfalar görünsün diye ilgili item'lar açılır.
  useEffect(() => {
    if (!query.trim()) return
    setOpenItems((prev) => {
      const next = { ...prev }
      desktopItems.forEach((it) => {
        if (it.children?.length) next[it.href] = true
      })
      return next
    })
  }, [query, desktopItems])

  const toggleGroup = (group: string): void =>
    setOpenGroups((prev) => ({ ...prev, [group]: !(prev[group] ?? true) }))

  const toggleItem = (href: string): void =>
    setOpenItems((prev) => ({ ...prev, [href]: !prev[href] }))

  const activeItem = items.find((it) => isActivePath(pathname, it.href)) || items[0]
  const mobileItems = items
    .filter(
      (it) =>
        it.href === activeItem?.href ||
        it.badge ||
        ['Dashboard', 'Overview', 'Randevularım', 'Müşterilerim', 'Tüm Kurumlar'].includes(it.label),
    )
    .slice(0, 5)

  return (
    <>
      {/* DESKTOP SIDEBAR */}
      <aside
        className={`relative hidden h-screen shrink-0 flex-col border-r border-[#ead8df]/75 bg-white/85 text-[#352432] shadow-[18px_0_54px_-48px_rgba(150,78,104,0.52)] backdrop-blur-2xl transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:sticky lg:top-0 lg:z-30 lg:flex ${
          collapsed ? 'w-[78px]' : 'w-[272px]'
        }`}
      >
        {/* Sağ kenarda altın hairline — panelle sidebar'ı ayıran ince ışık. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: 'linear-gradient(180deg, transparent, #f0d5c0 22%, #d9a441 52%, #f0d5c0 78%, transparent)' }}
        />

        {/* Aurora yıkaması */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -left-12 top-8 h-40 w-40 rounded-full bg-[#ffdce8]/66 blur-[60px]"
            animate={{ y: [0, 16, 0], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="absolute -right-8 top-1/3 h-32 w-32 rounded-full bg-white/85 blur-[50px]" />
          <motion.div
            className="absolute -left-10 bottom-24 h-44 w-44 rounded-full bg-[#f6b8cb]/36 blur-[70px]"
            animate={{ y: [0, -18, 0], opacity: [0.55, 0.85, 0.55] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Ray anahtarı — kenara oturan yuvarlak düğme. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          className="absolute -right-3 top-[86px] z-30 grid h-6 w-6 place-items-center rounded-full border border-[#f2dbe4] bg-white text-[#a3707f] shadow-[0_10px_22px_-14px_rgba(150,78,104,0.85)] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <ChevronsLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </motion.span>
        </button>

        {/* LOGO */}
        <div className={`relative border-b border-[#ead8df]/75 ${collapsed ? 'px-2 pb-4 pt-4' : 'px-5 pb-5 pt-5'}`}>
          <Link href="/" className={`group flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className={`relative overflow-hidden ${collapsed ? 'h-10 w-10' : 'h-14 w-14'}`}>
              <img
                src="/logo.png"
                alt="BeautyAsist logosu"
                className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
              />
              <motion.span
                aria-hidden
                animate={{ opacity: [0, 0.7, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-[#fff4f8]/35 to-transparent"
              />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="beautyasist-text-gradient font-display text-[17px] leading-none tracking-[0.08em]">
                  BeautyAsist
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b1798e] ring-1 ring-[#f6dde6]">
                    v{version}
                  </span>
                  <span className="truncate text-[10.5px] font-medium text-[#8a6a79]">{role}</span>
                </div>
              </div>
            )}
          </Link>
        </div>

        {!collapsed && (
          <NavSearch value={query} onChange={setQuery} inputRef={searchRef} resultCount={desktopItems.length} />
        )}

        {/* Kaydırma alanı: üst/alt kenarda yumuşak solma maskesi. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-white/90 to-transparent" />
          <NavGroups
            groups={groups}
            pathname={pathname}
            onNavigate={() => setOpen(false)}
            openGroups={openGroups}
            toggleGroup={toggleGroup}
            openItems={openItems}
            toggleItem={toggleItem}
            collapsed={collapsed}
            onHint={setHint}
            idPrefix="desktop"
            query={query}
          />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-white/90 to-transparent" />

          {!collapsed && query.trim() && desktopItems.length === 0 && (
            <div className="mx-3 rounded-[14px] border border-dashed border-[#f2dbe4] bg-[#fff8fb] px-3 py-4 text-center text-[11.5px] text-[#705a66]">
              &ldquo;{query}&rdquo; için sayfa bulunamadı.
            </div>
          )}
        </div>

        <UserBlock user={user} pathname={pathname} collapsed={collapsed} />
      </aside>

      {/* RAY İPUCU — nav kırpmasın diye ekrana sabitlenir. */}
      <AnimatePresence>
        {collapsed && hint && (
          <motion.div
            key="rail-hint"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.16 }}
            style={{ top: hint.top }}
            className="pointer-events-none fixed left-[86px] z-[80] hidden -translate-y-1/2 rounded-[10px] border border-[#f2dbe4] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#7b3d55] shadow-[0_16px_36px_-24px_rgba(150,78,104,0.9)] lg:block"
          >
            {hint.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE TOP BAR */}
      <div className="fixed inset-x-0 top-0 z-50 border-b border-[#ead8df]/75 bg-white/90 backdrop-blur-xl lg:hidden">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 18%, #d9a441 50%, #ffd3df 82%, transparent)' }}
        />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            className="flex min-h-10 items-center gap-2 rounded-2xl border border-[#ead8df] bg-white/72 px-3 text-[11.5px] font-semibold text-[#6a4f5c] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
          >
            <Menu className="h-4 w-4" /> Menü
          </motion.button>
          <Link href={activeItem?.href || '/admin'} className="min-w-0 text-center">
            <div className="beautyasist-text-gradient font-display text-[17px] leading-none">BeautyAsist</div>
            <div className="mt-1 truncate text-[10.5px] text-[#8a6a79]">
              {role} · {activeItem?.label}
            </div>
          </Link>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ffe3ec] to-[#ffd0e0] font-display text-xs text-[#7b3d55]">
            {user.avatar}
          </div>
        </div>
      </div>

      {/* MOBILE DRAWER */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="mobile-drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[70] bg-[#4a2335]/18 backdrop-blur-sm lg:hidden"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="mobile-drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              className="relative h-full w-[min(88vw,360px)] overflow-y-auto border-r border-[#ead8df]/75 bg-white/96 text-[#352432] shadow-2xl shadow-[#b86a87]/18"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ead8df]/75 bg-white/95 px-4 py-4 backdrop-blur-xl">
                <div className="min-w-0">
                  <div className="beautyasist-text-gradient font-display text-xl">BeautyAsist</div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b1798e] ring-1 ring-[#f6dde6]">
                      v{version}
                    </span>
                    <span className="truncate text-[10.5px] font-medium text-[#8a6a79]">{role}</span>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-2xl border border-[#ead8df] text-[#8a6a79] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
                  aria-label="Menüyü kapat"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </div>
              <div className="border-b border-[#ead8df]/75 p-4">
                <UserBlock user={user} pathname={pathname} compact />
              </div>
              <NavSearch value={mobileQuery} onChange={setMobileQuery} resultCount={mobileDrawerItems.length} />
              <NavGroups
                groups={mobileGroups}
                pathname={pathname}
                onNavigate={() => {
                  setOpen(false)
                  setMobileQuery('')
                }}
                openGroups={openGroups}
                toggleGroup={toggleGroup}
                openItems={openItems}
                toggleItem={toggleItem}
                idPrefix="mobile"
                query={mobileQuery}
                mobile
              />
              {mobileQuery.trim() && mobileDrawerItems.length === 0 && (
                <div className="mx-3 mb-4 rounded-[14px] border border-dashed border-[#f2dbe4] bg-[#fff8fb] px-3 py-4 text-center text-[11.5px] text-[#705a66]">
                  &ldquo;{mobileQuery}&rdquo; için sayfa bulunamadı.
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE BOTTOM NAV */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#ead8df]/75 bg-white/92 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-18px_44px_-34px_rgba(150,78,104,0.48)] backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileItems.map((it) => {
            const active = isActivePath(pathname, it.href)
            const Icon = it.icon
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-center text-[10px] leading-tight transition-colors ${
                  active ? 'text-[#c85776]' : 'text-[#6f5764] hover:text-[#c85776]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-active"
                    className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#fff1f6] to-white ring-1 ring-[#f6dde6]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10 flex flex-col items-center gap-1">
                  <Icon className="h-4 w-4" strokeWidth={1.7} />
                  <span className="line-clamp-2">{it.label}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
