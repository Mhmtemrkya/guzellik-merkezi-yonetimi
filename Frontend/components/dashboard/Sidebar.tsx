'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, LogOut, Menu, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useBranch } from './BranchContext'
import { useAuth } from './AuthContext'

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

function isActivePath(pathname: string | null, href: string): boolean {
  const rootRoutes = ['/admin', '/personel', '/platform']
  if (!pathname) return false
  if (rootRoutes.includes(href)) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
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

interface NavGroupsProps {
  groups: Record<string, SidebarNavItem[]>
  pathname: string | null
  onNavigate: () => void
  openGroups: Record<string, boolean>
  toggleGroup: (group: string) => void
  openItems: Record<string, boolean>
  toggleItem: (href: string) => void
  mobile?: boolean
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
}: NavGroupsProps) {
  return (
    <nav
      className={`${
        mobile ? 'px-3 py-4 space-y-4' : 'flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-4'
      }`}
    >
      {Object.entries(groups).map(([groupName, list], gi) => {
        const isOpen = openGroups[groupName] ?? true
        return (
          <div key={groupName}>
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="group flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-wide text-[#9d7386] transition-colors hover:text-[#c85776]"
            >
              <span className="flex items-center gap-2">
                <motion.span
                  className="inline-block h-px w-3 bg-[#efbfd0] transition-all group-hover:w-5 group-hover:bg-[#ef6f94]"
                  layout
                />
                {groupName}
              </span>
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="text-[#b997a6] group-hover:text-[#c85776]"
              >
                <ChevronDown className="h-3 w-3" strokeWidth={1.6} />
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key={`group-${groupName}`}
                  initial="closed"
                  animate="open"
                  exit="closed"
                  variants={groupAccordion}
                  className="overflow-hidden"
                >
                  <div className="mt-1.5 space-y-0.5">
                    {list.map((it, i) => {
                      const active = isActivePath(pathname, it.href)
                      const hasChildren = !!it.children?.length
                      const childOpen = hasChildren && (openItems[it.href] ?? active)
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
                                layoutId="sidebar-active-indicator"
                                className="pointer-events-none absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-full bg-gradient-to-b from-[#f7b6cb] via-[#ef6f94] to-[#d65f83] shadow-[0_0_16px_rgba(239,111,148,0.32)]"
                                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                              />
                            )}

                            <div
                              className={`group/item relative flex min-h-11 items-center gap-3 overflow-hidden px-3 py-2.5 text-[13px] transition-colors ${
                                active
                                  ? 'rounded-[16px] bg-[#fff1f6] text-[#9b4c65] ring-1 ring-[#efbfd0]/70 shadow-[0_12px_26px_-16px_rgba(214,95,131,0.55)]'
                                  : 'rounded-[16px] text-[#5f4855] hover:bg-[#fff4f8] hover:text-[#9b4c65]'
                              }`}
                            >
                              {/* Hover gradient slide-in (not active) */}
                              {!active && (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-[#ffdce8]/72 via-white/70 to-transparent transition-transform duration-500 group-hover/item:translate-x-0"
                                />
                              )}

                              <Link
                                href={it.href}
                                onClick={onNavigate}
                                className="relative z-10 flex flex-1 items-center gap-3"
                              >
                                <motion.span
                                  whileHover={{ scale: 1.12, rotate: active ? 0 : -6 }}
                                  transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                                  className="shrink-0"
                                >
                                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                                </motion.span>
                                <span className="flex-1 truncate">{it.label}</span>
                                {it.badge !== undefined && (
                                  <motion.span
                                    initial={{ scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.18 + i * 0.03, type: 'spring', stiffness: 380, damping: 22 }}
                                    className={`text-[9px] font-mono px-1.5 py-0.5 ${
                                      active
                                        ? 'rounded-full bg-[#c85776] text-white'
                                        : 'rounded-full bg-[#fff1f6] text-[#c85776] ring-1 ring-[#efbfd0]'
                                    }`}
                                  >
                                    {it.badge}
                                  </motion.span>
                                )}
                              </Link>

                              {hasChildren && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleItem(it.href)
                                  }}
                                  aria-label={childOpen ? 'Alt sayfaları kapat' : 'Alt sayfaları aç'}
                                  className={`relative z-10 -mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-sm transition-colors ${
                                    active
                                      ? 'text-[#9b4c65]/70 hover:text-[#9b4c65]'
                                      : 'text-[#b997a6] hover:text-[#c85776]'
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

                          {hasChildren && (
                            <AnimatePresence initial={false}>
                              {childOpen && (
                                <motion.div
                                  key={`children-${it.href}`}
                                  initial="closed"
                                  animate="open"
                                  exit="closed"
                                  variants={childListAccordion}
                                  className="relative ml-5 overflow-hidden border-l border-[#efbfd0] pl-3"
                                >
                                  <div className="space-y-0.5 py-1">
                                    {it.children!.map((child) => {
                                      const childActive = pathname === child.href
                                      return (
                                        <motion.div key={child.href} variants={childItemVariants}>
                                          <Link
                                            href={child.href}
                                            onClick={onNavigate}
                                            className={`group/child relative flex min-h-9 items-center gap-2.5 px-2.5 py-1.5 text-[12px] transition-colors ${
                                              childActive
                                                ? 'font-semibold text-[#c85776]'
                                                : 'text-[#7c6170] hover:text-[#c85776]'
                                            }`}
                                          >
                                            <span
                                              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${
                                                childActive
                                                  ? 'bg-[#ef6f94] shadow-[0_0_8px_rgba(239,111,148,0.45)] ring-2 ring-white'
                                                  : 'bg-[#efbfd0] group-hover/child:bg-[#ef6f94]/70'
                                              }`}
                                            />
                                            <span className="flex-1 truncate">{child.label}</span>
                                            {child.badge !== undefined && (
                                              <span className="text-[8px] font-semibold text-[#9d7386]">
                                                {child.badge}
                                              </span>
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
}

function UserBlock({ user, pathname, compact = false }: UserBlockProps) {
  const { selectedBranch, selectedInstitution } = useBranch()
  const { logout } = useAuth()
  return (
    <div className={`${compact ? '' : 'border-t border-[#ead8df]/75 p-4'}`}>
      {selectedBranch && !pathname?.startsWith('/platform') && !compact && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative mb-3 overflow-hidden rounded-[18px] border border-[#efbfd0]/80 bg-gradient-to-br from-[#fff1f6] via-white to-transparent px-3 py-2.5 shadow-[0_12px_32px_-28px_rgba(150,78,104,0.45)]"
        >
          <div className="text-[9px] font-semibold tracking-tight text-[#c85776]">
            Seçili kapsam
          </div>
          <div className="mt-1 truncate text-[11px] font-semibold text-[#352432]">{selectedInstitution?.name}</div>
          <div className="mt-0.5 truncate text-[10px] text-[#7c6170]/78">
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
      <div className="group/user flex items-center gap-3">
        <motion.div
          whileHover={{ scale: 1.04 }}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#efbfd0] bg-[#fff7fa] font-display text-sm text-[#7b3d55]"
        >
          <span className="relative z-10">{user.avatar}</span>
          <motion.span
            aria-hidden
            animate={{ opacity: [0.25, 0.55, 0.25] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-0 rounded-[12px] border border-[#efbfd0]/70"
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium">{user.name}</div>
          <div className="truncate text-[10px] text-[#9d7386]">{user.role}</div>
        </div>
        <motion.button
          type="button"
          whileHover={{ x: 2, color: '#c85776' }}
          whileTap={{ scale: 0.94 }}
          onClick={async () => {
            await logout()
            if (typeof window !== 'undefined') window.location.href = '/login'
          }}
          className="grid h-8 w-8 place-items-center text-[#9d7386] transition-colors hover:text-[#c85776]"
          aria-label="Oturumu kapat"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.6} />
        </motion.button>
      </div>
    </div>
  )
}

export default function Sidebar({ items, role, user, version = '1.0' }: SidebarProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState<boolean>(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})

  const groups = useMemo<Record<string, SidebarNavItem[]>>(
    () =>
      items.reduce<Record<string, SidebarNavItem[]>>((acc, it) => {
        const g = it.group || 'Genel'
        ;(acc[g] = acc[g] || []).push(it)
        return acc
      }, {}),
    [items],
  )

  // Initialize all groups open on first mount
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      Object.keys(groups).forEach((g) => {
        if (next[g] === undefined) next[g] = true
      })
      return next
    })
  }, [groups])

  // Auto-open the item that contains the active route
  useEffect(() => {
    if (!pathname) return
    const activeParent = items.find(
      (it) => it.children?.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`)),
    )
    if (activeParent) {
      setOpenItems((prev) => ({ ...prev, [activeParent.href]: true }))
    }
  }, [pathname, items])

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
      <aside className="hidden h-screen w-[270px] shrink-0 flex-col border-r border-[#ead8df]/75 bg-white/82 text-[#352432] shadow-[18px_0_54px_-48px_rgba(150,78,104,0.52)] backdrop-blur-2xl lg:sticky lg:top-0 lg:z-30 lg:flex">
        {/* Decorative aurora wash inside sidebar */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-12 top-8 h-40 w-40 rounded-full bg-[#ffdce8]/66 blur-[60px]" />
          <div className="absolute -right-8 top-1/3 h-32 w-32 rounded-full bg-white/85 blur-[50px]" />
          <div className="absolute -left-10 bottom-24 h-44 w-44 rounded-full bg-[#f6b8cb]/36 blur-[70px]" />
        </div>

        {/* LOGO */}
        <div className="relative border-b border-[#ead8df]/75 px-5 pb-6 pt-5">
          <Link href="/" className="group flex items-center gap-3">
            <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-[#efbfd0] bg-[#fff7fa] shadow-[0_10px_28px_-22px_rgba(190,91,125,0.75)] transition-shadow duration-500 group-hover:shadow-[0_14px_34px_-20px_rgba(190,91,125,0.8)]">
              <img
                src="/logo.png"
                alt="BeautyAsist logosu"
                className="h-full w-full object-cover scale-125 transition-transform duration-500 group-hover:scale-110"
              />
              <motion.span
                aria-hidden
                animate={{ opacity: [0, 0.7, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-[#fff4f8]/35 to-transparent"
              />
            </div>
            <div className="min-w-0">
              <div className="font-display text-[17px] tracking-[0.08em] leading-none beautyasist-text-gradient">
                BeautyAsist
              </div>
              <div className="mt-1 truncate text-[10px] text-[#9d7386]">
                v.{version} · {role}
              </div>
            </div>
          </Link>
        </div>

        <NavGroups
          groups={groups}
          pathname={pathname}
          onNavigate={() => setOpen(false)}
          openGroups={openGroups}
          toggleGroup={toggleGroup}
          openItems={openItems}
          toggleItem={toggleItem}
        />

        <UserBlock user={user} pathname={pathname} />
      </aside>

      {/* MOBILE TOP BAR */}
      <div className="fixed inset-x-0 top-0 z-50 border-b border-[#ead8df]/75 bg-white/90 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            className="flex min-h-10 items-center gap-2 rounded-2xl border border-[#ead8df] bg-white/72 px-3 text-[11px] font-semibold text-[#6a4f5c] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
          >
            <Menu className="h-4 w-4" /> Menü
          </motion.button>
          <Link href={activeItem?.href || '/admin'} className="min-w-0 text-center">
            <div className="font-display text-[17px] leading-none beautyasist-text-gradient">BeautyAsist</div>
            <div className="mt-1 truncate text-[10px] text-[#9d7386]">
              {role} · {activeItem?.label}
            </div>
          </Link>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#efbfd0] bg-[#fff7fa] font-display text-xs text-[#7b3d55]">
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
                <div>
                  <div className="font-display text-xl beautyasist-text-gradient">BeautyAsist</div>
                  <div className="mt-1 text-[10px] text-[#9d7386]">
                    {role}
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#ead8df] text-[#9d7386] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
                  aria-label="Menüyü kapat"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </div>
              <div className="border-b border-[#ead8df]/75 p-4">
                <UserBlock user={user} pathname={pathname} compact />
              </div>
              <NavGroups
                groups={groups}
                pathname={pathname}
                onNavigate={() => setOpen(false)}
                openGroups={openGroups}
                toggleGroup={toggleGroup}
                openItems={openItems}
                toggleItem={toggleItem}
                mobile
              />
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
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-center text-[9px] leading-tight transition-colors ${
                  active ? 'text-[#c85776]' : 'text-[#7c6170] hover:text-[#c85776]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-active"
                    className="absolute inset-0 rounded-2xl bg-[#fff1f6]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10 flex flex-col items-center gap-1">
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
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
