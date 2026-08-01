'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  ChevronsLeft,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useBranch } from './BranchContext'
import { useAuth } from './AuthContext'

// ---------------------------------------------------------------------------
// SIDEBAR — "Sekme"
//
// Panelin kart diliyle AYNI sözlüğü konuşur: aynı hairline (#ead8df), aynı
// aksiyon rengi (#c85776), aynı yumuşak zemin (#fff1f6). Sidebar panelden
// yalnız bir tık daha sıcak bir kremle ayrılır — çelişmez, ayrışır.
//
// İMZA ÖĞESİ — SEKME: aktif sayfa satırı panelin BEYAZINA boyanır, sağ köşeleri
// düz kalır ve sidebar'ın kenar hairline'ına dayanarak onu kendi hizasında keser.
// Satır böylece panele bağlanmış görünür; "şu an buradasın" bilgisi renk
// rozetiyle değil mimariyle söylenir. Sol kenardaki ince altın tek metal vurgu.
// Sayfa değişince sekme layoutId ile yay gibi kayar.
//
// Sadeleştirilenler (görsel gürültüydü): ambient aurora, gradyan ikon çipi,
// hover ışık süzülmesi, kalın renkli aktif bar.
//
// HAREKET katmanlı ama disiplinli: sekme kayması (ana jest) · satırların sırayla
// süzülmesi · ikonun hover'da bir tık ilerlemesi · rozetin değişince yaylanması ·
// akordeon açılışlarında alt sayfaların kademeli gelişi. Tamamı
// prefers-reduced-motion'da susar.
//
// İşlevler korunur: ray modu (78px, tercih localStorage'da), "/" · Ctrl+K ile
// sayfa arama, grup/alt sayfa akordeonları, mobil çekmece + alt bar.
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

/* ---------------------------------------------------------------------------
 * PALET — altı isimli ton. Hepsi panelin kendi sözlüğünden; sidebar panele
 * yabancı bir renk getirmez. Metin tonları globals.css'teki okunabilirlik
 * eşiğiyle uyumlu (≥4.5:1).
 *
 * porcelain  zemin      — beyazın pembeye kırılmış hâli; panelden ayrışır, çelişmez
 * chalk      aktif sekme — panel kartlarının beyazı (sekme buraya "bağlanır")
 * quartz     hairline   — panelin kenarlığıyla aynı
 * rose       aksiyon    — panelin birincil aksiyon rengi (logonun #CC6084'ü ile
 *                         neredeyse birebir; panel bu rengi zaten logodan almış)
 * oxblood    vurgu      — LOGODAN ALINDI (#6C243C, logonun en derin bordosu).
 *                         Aktif metin; beyaz üzerinde ~10:1 okunur.
 * gilt       altın      — YALNIZ aktif sekmenin sol kenarında (dekorasyon değil,
 *                         "buradasın" işareti)
 * ------------------------------------------------------------------------- */
const C = {
  porcelain: '#FDF7F9',
  chalk: '#FFFFFF',
  quartz: '#EAD8DF',
  quartzDeep: '#EFBFD0',
  rose: '#C85776',
  oxblood: '#6C243C',
  gilt: '#D9A441',
  // Metin merdiveni — panelle birebir aynı üç kademe.
  ink: '#352432', // birincil (~13:1)
  mute: '#705A66', // ikincil (~5.9:1)
  soft: '#8A6172', // üçüncül — grup başlığı (~4.9:1; 10px metin WCAG AA)
  wash: '#FFF1F6', // yumuşak vurgu zemini
} as const

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

const EASE = [0.22, 1, 0.36, 1] as const
/** Aktif sekmenin kayma hissi — tek imza hareketi, bu yüzden yaylı. */
const TAB_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const

const groupAccordion: Variants = {
  open: { height: 'auto', opacity: 1, transition: { duration: 0.3, ease: EASE } },
  closed: { height: 0, opacity: 0, transition: { duration: 0.22, ease: [0.7, 0, 0.84, 0] } },
}

const childListAccordion: Variants = {
  open: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.3, ease: EASE, staggerChildren: 0.03, delayChildren: 0.03 },
  },
  closed: { height: 0, opacity: 0, transition: { duration: 0.2, ease: [0.7, 0, 0.84, 0] } },
}

const childItemVariants: Variants = {
  open: { opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE } },
  closed: { opacity: 0, x: -6 },
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
  /** Sekme metaforu yalnız masaüstü rayında anlamlı (çekmecede panel kenarı yok). */
  tabbed?: boolean
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
      <mark className="rounded-[3px] bg-[#FFE0EB] px-0.5 text-[#6C243C]">{text.slice(idx, idx + q.length)}</mark>
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
  tabbed = false,
}: NavGroupsProps) {
  // Hareket bu sidebar'ın dili; ama sistem "azalt" diyorsa tamamı susar.
  const reduce = useReducedMotion()
  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776] focus-visible:ring-offset-1 focus-visible:ring-offset-[#FDF7F9]'

  return (
    <nav
      aria-label="Sayfa menüsü"
      className={`${
        mobile ? 'space-y-5 px-3 py-4' : 'no-scrollbar flex-1 space-y-5 overflow-y-auto py-4 pl-3 pr-0'
      } ${collapsed ? 'px-2' : ''}`}
    >
      {Object.entries(groups).map(([groupName, list]) => {
        const isOpen = openGroups[groupName] ?? true
        return (
          <div key={groupName}>
            {collapsed ? (
              <div aria-hidden className="mx-auto mb-2 h-px w-6" style={{ background: C.quartz }} />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(groupName)}
                aria-expanded={isOpen}
                className={`group flex w-full cursor-pointer items-center justify-between rounded-[8px] px-2 py-1 ${focusRing}`}
              >
                <span className="flex items-baseline gap-1.5">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.14em] transition-colors group-hover:text-[#C85776]"
                    style={{ color: C.soft }}
                  >
                    {groupName}
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.quartzDeep }}>
                    {list.length}
                  </span>
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 0 : -90 }}
                  transition={{ duration: 0.26, ease: EASE }}
                  className="transition-colors group-hover:text-[#C85776]"
                  style={{ color: C.soft }}
                >
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
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
                  <div className={collapsed ? 'space-y-1' : 'mt-1 space-y-0.5'}>
                    {list.map((it, i) => {
                      const active = isActivePath(pathname, it.href)
                      const hasChildren = !!it.children?.length
                      const childOpen = !collapsed && hasChildren && (openItems[it.href] ?? active)
                      const Icon = it.icon

                      return (
                        <motion.div
                          key={it.href}
                          // Satırlar sırayla süzülerek gelir — liste bir anda "yapışmaz".
                          initial={reduce ? false : { opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={
                            reduce ? { duration: 0 } : { duration: 0.34, delay: Math.min(i * 0.028, 0.28), ease: EASE }
                          }
                        >
                          <div className="relative">
                            {/* SEKME — aktif satır panelin beyazına boyanır; sağ köşeleri düz
                                kalır ve kenardaki kavisle panele bağlanır. */}
                            {active && (
                              <motion.span
                                layoutId={`${idPrefix}-active-tab`}
                                aria-hidden
                                className={`pointer-events-none absolute inset-0 ${
                                  tabbed ? 'rounded-l-[14px]' : 'rounded-[14px]'
                                }`}
                                style={{
                                  background: C.chalk,
                                  // Sol kenarda ince altın: markanın tek metal vurgusu ve
                                  // "buradasın" işareti. Sağ kenar açık bırakılır — sekme
                                  // sidebar'ın hairline'ına dayanıp panele bağlanmış görünür.
                                  boxShadow: tabbed
                                    ? `inset 2px 0 0 ${C.gilt}, inset 0 1px 0 ${C.quartz}, inset 0 -1px 0 ${C.quartz}, -10px 0 24px -20px rgba(150,78,104,0.6)`
                                    : `inset 2px 0 0 ${C.gilt}, inset 0 0 0 1px ${C.quartz}`,
                                }}
                                transition={TAB_SPRING}
                              />
                            )}

                            <div
                              className={`group/item relative flex min-h-11 items-center rounded-[14px] transition-colors duration-200 ${
                                collapsed ? 'justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2'
                              } text-[13px] ${!active ? 'hover:bg-[#FFF1F6]' : ''}`}
                            >
                              <Link
                                href={it.href}
                                onClick={onNavigate}
                                title={collapsed ? it.label : undefined}
                                aria-current={active ? 'page' : undefined}
                                onMouseEnter={(e) => {
                                  if (!collapsed || !onHint) return
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  onHint({ label: it.label, top: r.top + r.height / 2 })
                                }}
                                onMouseLeave={() => onHint?.(null)}
                                className={`relative z-10 flex flex-1 cursor-pointer items-center rounded-[10px] ${focusRing} ${
                                  collapsed ? 'justify-center' : 'gap-2.5'
                                }`}
                              >
                                {/* İkon çipsiz durur — hiyerarşiyi renk, kalınlık ve hareket taşır.
                                    Üzerine gelince bir tık ileri kayar: satır "davet ediyor". */}
                                <motion.span
                                  className="relative grid h-7 w-7 shrink-0 place-items-center"
                                  animate={{ scale: active ? 1.06 : 1 }}
                                  whileHover={reduce ? undefined : { x: 2 }}
                                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 24 }}
                                >
                                  <Icon
                                    className="h-[17px] w-[17px] transition-colors duration-200"
                                    strokeWidth={active ? 2.1 : 1.7}
                                    style={{ color: active ? C.rose : C.mute }}
                                  />
                                  {collapsed && it.badge !== undefined && (
                                    <span
                                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                                      style={{ background: C.rose, boxShadow: `0 0 0 2px ${C.porcelain}` }}
                                    />
                                  )}
                                </motion.span>

                                {!collapsed && (
                                  <>
                                    <span
                                      className={`flex-1 truncate transition-all duration-200 group-hover/item:translate-x-[2px] ${
                                        active ? 'font-semibold' : ''
                                      }`}
                                      style={{ color: active ? C.oxblood : C.ink }}
                                    >
                                      <Highlight text={it.label} query={query} />
                                    </span>
                                    {it.badge !== undefined && (
                                      <motion.span
                                        // Rozet değeri değişince kısa bir yay — gözden kaçmasın.
                                        key={String(it.badge)}
                                        initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 22 }}
                                        className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                                        style={
                                          active
                                            ? { background: C.rose, color: '#fff' }
                                            : { background: C.wash, color: C.rose }
                                        }
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
                                  aria-expanded={childOpen}
                                  className={`relative z-10 -mr-0.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-[8px] transition-colors hover:bg-[#FFF1F6] ${focusRing}`}
                                  style={{ color: active ? C.rose : C.soft }}
                                >
                                  <motion.span
                                    animate={{ rotate: childOpen ? 180 : 0 }}
                                    transition={{ duration: 0.26, ease: EASE }}
                                  >
                                    <ChevronDown className="h-3 w-3" strokeWidth={2} />
                                  </motion.span>
                                </button>
                              )}
                            </div>
                          </div>

                          {hasChildren && !collapsed && (
                            <AnimatePresence initial={false}>
                              {childOpen && (
                                <motion.div
                                  key={`children-${it.href}`}
                                  initial="closed"
                                  animate="open"
                                  exit="closed"
                                  variants={childListAccordion}
                                  className="relative ml-[22px] overflow-hidden pl-3"
                                >
                                  <span
                                    aria-hidden
                                    className="pointer-events-none absolute bottom-2 left-0 top-0 w-px"
                                    style={{ background: `linear-gradient(180deg, ${C.quartzDeep}, transparent)` }}
                                  />
                                  <div className="space-y-0.5 py-1">
                                    {it.children!.map((child) => {
                                      const childActive = pathname === child.href
                                      return (
                                        <motion.div key={child.href} variants={childItemVariants}>
                                          <Link
                                            href={child.href}
                                            onClick={onNavigate}
                                            aria-current={childActive ? 'page' : undefined}
                                            className={`group/child relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[12px] transition-colors duration-200 ${
                                              childActive ? 'font-semibold' : 'hover:bg-[#FDF7F9]'
                                            } ${focusRing}`}
                                            style={
                                              childActive
                                                ? { background: C.wash, color: C.oxblood }
                                                : { color: C.mute }
                                            }
                                          >
                                            <span
                                              aria-hidden
                                              className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200"
                                              style={{ background: childActive ? C.rose : C.quartzDeep }}
                                            />
                                            <span className="flex-1 truncate">
                                              <Highlight text={child.label} query={query} />
                                            </span>
                                            {child.badge !== undefined && (
                                              <span
                                                className="text-[10px] font-semibold tabular-nums"
                                                style={{ color: C.soft }}
                                              >
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
                        </motion.div>
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

  const iconBtn =
    'grid h-8 w-8 cursor-pointer place-items-center rounded-[10px] transition-colors hover:bg-[#FFF1F6] hover:text-[#C85776] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]'

  // Ray modu: yalnız avatar + çıkış, dikey dizilir.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-3" style={{ borderTop: `1px solid ${C.quartz}` }}>
        <span
          title={`${user.name} · ${user.role}`}
          className="grid h-9 w-9 place-items-center rounded-[12px] font-display text-[13px]"
          style={{ background: C.wash, color: C.oxblood, boxShadow: `inset 0 0 0 1px ${C.quartzDeep}` }}
        >
          {user.avatar}
        </span>
        <button
          type="button"
          onClick={signOut}
          title="Oturumu kapat"
          aria-label="Oturumu kapat"
          className={iconBtn}
          style={{ color: C.soft }}
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'p-3'} style={compact ? undefined : { borderTop: `1px solid ${C.quartz}` }}>
      {selectedBranch && !isPlatform && !compact && (
        <div
          className="mb-2.5 rounded-[14px] px-3 py-2.5"
          style={{ background: C.wash, boxShadow: `inset 0 0 0 1px ${C.quartzDeep}` }}
        >
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.rose }}>
              Seçili kapsam
            </span>
          </div>
          <div className="mt-1 truncate text-[11.5px] font-semibold" style={{ color: C.ink }}>
            {selectedInstitution?.name}
          </div>
          <div className="mt-0.5 truncate text-[10.5px]" style={{ color: C.mute }}>
            {selectedBranch.name} · {selectedBranch.city}
          </div>
        </div>
      )}

      <div
        className="flex items-center gap-2.5 rounded-[14px] p-2 transition-colors"
        style={{ background: C.chalk, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] font-display text-[13px]"
          style={{ background: C.wash, color: C.oxblood, boxShadow: `inset 0 0 0 1px ${C.quartzDeep}` }}
        >
          {user.avatar}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold" style={{ color: C.ink }}>
            {user.name}
          </div>
          <div className="truncate text-[10.5px]" style={{ color: C.mute }}>
            {user.role}
          </div>
        </div>
        {!isPlatform && (
          <Link href="/admin/ayarlar" aria-label="Ayarlar" title="Ayarlar" className={iconBtn} style={{ color: C.soft }}>
            <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          </Link>
        )}
        <button
          type="button"
          onClick={signOut}
          className={iconBtn}
          style={{ color: C.soft }}
          aria-label="Oturumu kapat"
          title="Oturumu kapat"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
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
      <div
        className="flex items-center gap-2 rounded-[12px] px-2.5 py-2 transition-shadow focus-within:shadow-[0_0_0_2px_#EFBFD0]"
        style={{ background: C.chalk, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
      >
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} style={{ color: C.rose }} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('')
          }}
          placeholder="Sayfa ara"
          aria-label="Menüde sayfa ara"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#8A6172]"
          style={{ color: C.ink }}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Aramayı temizle"
            className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full transition-colors hover:bg-[#FFF1F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]"
            style={{ color: C.soft }}
          >
            <X className="h-3 w-3" strokeWidth={2.2} />
          </button>
        ) : (
          <kbd
            className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: C.wash, color: C.soft }}
          >
            /
          </kbd>
        )}
      </div>
      {value && (
        <div
          className="mt-1.5 px-1 text-[10px] font-semibold"
          style={{ color: resultCount > 0 ? C.rose : C.mute }}
        >
          {resultCount > 0 ? `${resultCount} sayfa eşleşti` : 'Eşleşen sayfa yok'}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ items, role, user, version = '1.0' }: SidebarProps) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState<boolean>(false)
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [mobileQuery, setMobileQuery] = useState('')
  const [hint, setHint] = useState<RailHint | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

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

  // Ray tercihi kullanıcıya ait — sunucuda okunamaz, ilk boyamadan sonra yüklenir.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1')
    } catch {
      /* depolama kapalıysa varsayılan geniş kalır */
    }
  }, [])

  /** Ray modunu açar/kapatır ve tercihi kalıcı yazar. */
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* depolama kapalıysa tercih kalıcı olmaz — davranış değişmez */
      }
      if (next) setQuery('')
      return next
    })
    setHint(null)
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
      {/* Klavye kullanıcısı menüyü atlayabilsin (nav-ağır sayfa kuralı). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-[10px] focus:bg-white focus:px-3 focus:py-2 focus:text-[12px] focus:font-semibold focus:text-[#6C243C] focus:shadow-[0_10px_28px_-16px_rgba(150,78,104,0.8)] focus:outline-none focus:ring-2 focus:ring-[#C85776]"
      >
        İçeriğe geç
      </a>

      {/* DESKTOP SIDEBAR */}
      <aside
        style={{ background: C.porcelain }}
        className={`relative hidden h-screen shrink-0 flex-col transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:sticky lg:top-0 lg:z-30 lg:flex ${
          collapsed ? 'w-[78px]' : 'w-[272px]'
        }`}
      >
        {/* Sağ kenar hairline — aktif sekme buraya dayanıp çizgiyi kendi hizasında keser. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px" style={{ background: C.quartz }} />


        {/* Ray anahtarı — kenara oturan yuvarlak düğme. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          className="absolute -right-3 top-[86px] z-40 grid h-6 w-6 cursor-pointer place-items-center rounded-full transition-colors hover:text-[#C85776] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]"
          style={{
            background: C.chalk,
            color: C.soft,
            boxShadow: `0 0 0 1px ${C.quartz}, 0 8px 20px -14px rgba(150,78,104,0.85)`,
          }}
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.28, ease: EASE }}>
            <ChevronsLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
          </motion.span>
        </button>

        {/* LOGO */}
        <div
          className={`relative ${collapsed ? 'px-2 pb-4 pt-4' : 'px-4 pb-4 pt-5'}`}
          style={{ borderBottom: `1px solid ${C.quartz}` }}
        >
          <Link
            href="/"
            className={`group flex cursor-pointer items-center gap-3 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776] ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <div className={`relative shrink-0 overflow-hidden ${collapsed ? 'h-10 w-10' : 'h-12 w-12'}`}>
              <img
                src="/logo.png"
                alt="BeautyAsist logosu"
                className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="beautyasist-text-gradient font-display text-[17px] leading-none tracking-[0.06em]">
                  BeautyAsist
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums"
                    style={{ background: C.wash, color: C.rose }}
                  >
                    v{version}
                  </span>
                  <span
                    className="truncate text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: C.soft }}
                  >
                    {role}
                  </span>
                </div>
              </div>
            )}
          </Link>
        </div>

        {!collapsed && (
          <NavSearch value={query} onChange={setQuery} inputRef={searchRef} resultCount={desktopItems.length} />
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
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
            tabbed={!collapsed}
          />

          {!collapsed && query.trim() && desktopItems.length === 0 && (
            <div
              className="mx-3 rounded-[12px] px-3 py-4 text-center text-[11.5px]"
              style={{ background: C.chalk, color: C.mute, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
            >
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
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            style={{
              top: hint.top,
              background: C.chalk,
              color: C.ink,
              boxShadow: `0 0 0 1px ${C.quartz}, 0 14px 30px -20px rgba(150,78,104,0.9)`,
            }}
            className="pointer-events-none fixed left-[86px] z-[80] hidden -translate-y-1/2 rounded-[10px] px-2.5 py-1.5 text-[11.5px] font-semibold lg:block"
          >
            {hint.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE TOP BAR */}
      <div
        className="fixed inset-x-0 top-0 z-50 backdrop-blur-xl lg:hidden"
        style={{ background: 'rgba(253,247,249,0.92)', borderBottom: `1px solid ${C.quartz}` }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[12px] px-3 text-[11.5px] font-semibold transition-colors hover:text-[#C85776] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]"
            style={{ background: C.chalk, color: C.mute, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
          >
            <Menu className="h-4 w-4" strokeWidth={2} /> Menü
          </button>
          <Link href={activeItem?.href || '/admin'} className="min-w-0 cursor-pointer text-center">
            <div className="beautyasist-text-gradient font-display text-[16px] leading-none">BeautyAsist</div>
            <div className="mt-1 truncate text-[10px]" style={{ color: C.mute }}>
              {role} · {activeItem?.label}
            </div>
          </Link>
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] font-display text-xs"
            style={{ background: C.wash, color: C.oxblood, boxShadow: `inset 0 0 0 1px ${C.quartzDeep}` }}
          >
            {user.avatar}
          </span>
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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] backdrop-blur-sm lg:hidden"
            style={{ background: 'rgba(74,35,53,0.18)' }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="mobile-drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              className="relative h-full w-[min(88vw,340px)] overflow-y-auto"
              style={{ background: C.porcelain, boxShadow: '24px 0 60px -40px rgba(150,78,104,0.6)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="sticky top-0 z-10 flex items-center justify-between px-4 py-4"
                style={{ background: C.porcelain, borderBottom: `1px solid ${C.quartz}` }}
              >
                <div className="min-w-0">
                  <div className="beautyasist-text-gradient font-display text-[18px] leading-none">BeautyAsist</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums"
                      style={{ background: C.wash, color: C.rose }}
                    >
                      v{version}
                    </span>
                    <span
                      className="truncate text-[10px] font-semibold uppercase tracking-[0.1em]"
                      style={{ color: C.soft }}
                    >
                      {role}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-[12px] transition-colors hover:text-[#C85776] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]"
                  style={{ background: C.chalk, color: C.mute, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
                  aria-label="Menüyü kapat"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              <div className="p-4" style={{ borderBottom: `1px solid ${C.quartz}` }}>
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
                <div
                  className="mx-3 mb-4 rounded-[12px] px-3 py-4 text-center text-[11.5px]"
                  style={{ background: C.chalk, color: C.mute, boxShadow: `inset 0 0 0 1px ${C.quartz}` }}
                >
                  &ldquo;{mobileQuery}&rdquo; için sayfa bulunamadı.
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MOBILE BOTTOM NAV */}
      <nav
        aria-label="Hızlı gezinme"
        className="fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-xl lg:hidden"
        style={{ background: 'rgba(253,247,249,0.94)', borderTop: `1px solid ${C.quartz}` }}
      >
        <div className="grid grid-cols-5 gap-1">
          {mobileItems.map((it) => {
            const active = isActivePath(pathname, it.href)
            const Icon = it.icon
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-center text-[10px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C85776]"
                style={{ color: active ? C.oxblood : C.mute }}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-active"
                    aria-hidden
                    className="absolute inset-0 rounded-[12px]"
                    style={{ background: C.chalk, boxShadow: `inset 0 0 0 1px ${C.quartzDeep}` }}
                    transition={TAB_SPRING}
                  />
                )}
                <span className="relative z-10 flex flex-col items-center gap-1">
                  <Icon
                    className="h-4 w-4"
                    strokeWidth={active ? 2.1 : 1.7}
                    style={{ color: active ? C.rose : C.mute }}
                  />
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
