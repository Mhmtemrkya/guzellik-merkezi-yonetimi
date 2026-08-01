'use client'

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import ImportDialog from '@/components/dashboard/ImportDialog'
import StaffFormDialog from '@/components/dashboard/StaffFormDialog'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import TenantCredentialsDialog from '@/components/dashboard/TenantCredentialsDialog'
import CommissionPanel from '@/components/dashboard/CommissionPanel'
import StaffDeviceDialog from '@/components/dashboard/StaffDeviceDialog'
import StaffWorkingHoursDialog from '@/components/dashboard/StaffWorkingHoursDialog'
import StaffCalendarLinkButton from '@/components/dashboard/StaffCalendarLinkButton'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { apiItems, formatTL, guidOrUndefined, initialsFromName, normalizeAppointment, normalizeStaff } from '@/lib/apiMappers'
import { downscaleImage } from '@/lib/imageUtils'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeftRight, ArrowUpDown, Bell, Boxes, Calendar, CalendarCheck, CalendarClock, Check, ClipboardList,
  Crown, FileBarChart, FileUp, Gift, Hourglass, ImagePlus, KeyRound, Landmark, Minus, MonitorSmartphone,
  Package, Search, Settings, Shield, ShieldCheck, Sparkles, Star, TrendingUp, UserCheck, UserCog, UserPlus,
  UserX, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ApiAppointment, ApiStaff, ApiStaffCredentials, ApiTenantCredentials, PagedResult, PermissionMeta, Staff } from '@/lib/types'

/* ============================================================================
   Personel & Roller — kurum yöneticisi paneli.
   Görünüm 2 moda ayrılır:
     • Kadro  (scope: all/active/inactive) → ekip panosu + personel kartları + seçili personel dosyası
     • Yetki  (scope: permissions)         → yetki matrisi (sayfa × personel) + sayfa dosyası
   Yetki tarafı artık backend kataloğundan (`/api/admin/staff/permissions`) beslenir;
   sayfa/işlem ayrımı ve "eski kayıt = tam yetki" kuralı Permissions.IsActionAllowed ile birebir.
   ========================================================================== */

type ScopeKey = 'all' | 'active' | 'inactive' | 'permissions'
const SCOPE_LABEL: Record<ScopeKey, string> = { all: 'Tüm Personel', active: 'Aktif Kadro', inactive: 'Pasif / İzinli', permissions: 'Yetki Seti' }
const SCOPE_TABS: Array<{ key: ScopeKey; label: string; icon: LucideIcon }> = [
  { key: 'all', label: 'Tüm Personel', icon: Users },
  { key: 'active', label: 'Aktif Kadro', icon: UserCheck },
  { key: 'inactive', label: 'Pasif / İzinli', icon: UserX },
  { key: 'permissions', label: 'Yetki Seti', icon: ShieldCheck },
]

/** Sayfa yetki anahtarı → ikon (Domain/Permissions.cs kataloğuyla birebir). */
const PAGE_ICONS: Record<string, LucideIcon> = {
  Customers: Users,
  Appointments: Calendar,
  Waitlist: Hourglass,
  Services: Package,
  GiftCards: Gift,
  Stock: Boxes,
  CashRegister: Wallet,
  CashClosing: CalendarCheck,
  Accounting: Landmark,
  Reports: FileBarChart,
  Notifications: Bell,
  Logs: ClipboardList,
  Settings: Settings,
}
const pageIcon = (key: string): LucideIcon => PAGE_ICONS[key] || Shield

type SortKey = 'performance' | 'name' | 'rating' | 'appointments'
const SORT_LABEL: Record<SortKey, string> = {
  performance: 'Bu ayın performansı',
  name: 'Ada göre (A→Z)',
  rating: 'Müşteri puanı',
  appointments: 'Randevu sayısı',
}

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

/* ---------------------------------------------------------------- yardımcılar */

/** Bir personelin bir sayfadaki yetki durumu (matris hücresi + rozetler). */
type CellState = 'none' | 'partial' | 'full'
interface PermCell { state: CellState; granted: number; total: number; legacy: boolean }

const permCell = (perms: Set<string>, page: PermissionMeta): PermCell => {
  const actions = page.actions ?? []
  const total = actions.length
  if (!perms.has(page.key)) return { state: 'none', granted: 0, total, legacy: false }
  if (total === 0) return { state: 'full', granted: 0, total: 0, legacy: false }
  const granted = actions.filter((a) => perms.has(a.key)).length
  // Eski kayıt: sayfa açık ama hiçbir işlem anahtarı atanmamış → backend tam yetkili sayar.
  if (granted === 0) return { state: 'full', granted: total, total, legacy: true }
  return { state: granted === total ? 'full' : 'partial', granted, total, legacy: false }
}

/** 0 → hedef arası tek seferlik yumuşak sayaç (pano rakamları canlansın diye). */
function useCountUp(target: number, duration = 850): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!Number.isFinite(target)) { setValue(0); return }
    let raf = 0
    const started = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / duration)
      setValue(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const animated = useCountUp(value)
  return <>{animated.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>
}

/** İnce SVG halka — yüzdeyi çizerek doldurur. */
/** Rapor ucundan gelen personel bazlı parasal satır (/api/admin/reports/staff). */
interface ApiStaffMoneyRow {
  staffMemberId?: string
  serviceRevenue?: number
  salesAmount?: number
  salesCount?: number
}

function Ring({ value, size = 74, stroke = 7, tone = '#e0617f', title, sub }: {
  value: number; size?: number; stroke?: number; tone?: string; title: string; sub?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f7e9ee" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * pct) / 100 }}
          transition={{ duration: 0.85, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div className="leading-tight">
          <div className="font-display text-[15px] tracking-tight text-[#352432]">{title}</div>
          {sub && <div className="text-[10px] text-[#705a66]">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

/** Kesirli dolan 5 yıldız (3.6 → 3 tam + %60). */
function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`${value.toFixed(1)} / 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i))
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-[#e6d3da]" style={{ width: size, height: size }} strokeWidth={1.7} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="text-[#d8ad55]" fill="#d8ad55" style={{ width: size, height: size }} strokeWidth={1.7} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** Haftalık aktivite — gün başına randevu (son 30 gün). Kolon yüksekliği piksel:
 *  yüzde yükseklik esnek kutuda çözülmeyebiliyor, o yüzden sabit iz yüksekliği. */
const BAR_TRACK = 52
function WeeklyBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const peak = values.indexOf(max)
  return (
    <div className="flex items-end justify-between gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] tabular-nums text-[#705a66] opacity-0 transition-opacity group-hover:opacity-100">{v}</span>
          {/* iz sabit yükseklikte: veri sıfırken de grafik alanı çökmesin */}
          <span className="flex w-full items-end" style={{ height: BAR_TRACK }}>
            <motion.span
              className={`w-full rounded-t-[4px] ${i === peak && values[peak] > 0 ? 'bg-gradient-to-t from-[#c85776] to-[#f3a3bf]' : 'bg-gradient-to-t from-[#e0617f]/75 to-[#f3a3bf]/70'}`}
              initial={{ height: 0 }} animate={{ height: Math.max(4, (v / max) * BAR_TRACK) }}
              transition={{ duration: 0.5, delay: i * 0.04, ease: 'easeOut' }}
            />
          </span>
          <span className="text-[10px] text-[#705a66]">{DAYS[i]}</span>
        </div>
      ))}
    </div>
  )
}

/** Sayfa yetkisi rozeti — tam / kısmi / kapalı. */
function CellBadge({ cell, compact = false }: { cell: PermCell; compact?: boolean }) {
  const box = compact ? 'h-7 w-7' : 'h-8 w-8'
  if (cell.state === 'full') {
    return (
      <span className={`grid ${box} place-items-center rounded-[10px] bg-gradient-to-br from-[#e0617f] to-[#c85776] text-white shadow-[0_6px_14px_-8px_rgba(200,87,118,0.9)]`}>
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    )
  }
  if (cell.state === 'partial') {
    return (
      <span className={`grid ${box} place-items-center rounded-[10px] border border-[#e0617f]/55 bg-[#fff1f6] text-[11px] font-semibold tabular-nums text-[#b14d6c]`}>
        {cell.granted}/{cell.total}
      </span>
    )
  }
  return (
    <span className={`grid ${box} place-items-center rounded-[10px] border border-dashed border-[#e6d3da] text-[#b9a3ad]`}>
      <Minus className="h-3.5 w-3.5" />
    </span>
  )
}

function Avatar({ name, photoUrl, size = 40, radius = 12 }: { name: string; photoUrl?: string; size?: number; radius?: number }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt={name} className="object-cover" style={{ width: size, height: size, borderRadius: radius }} />
    )
  }
  return (
    <span
      className="grid place-items-center bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5] font-display text-[#8e3f5b]"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.34) }}
    >
      {initialsFromName(name)}
    </span>
  )
}

/* ------------------------------------------------------------------- sayfa */

function PersonelPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in SCOPE_LABEL ? scopeParam : 'all'

  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('performance')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPerm, setSelectedPerm] = useState<string | null>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [resetCredentials, setResetCredentials] = useState<ApiTenantCredentials | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [transferBranchId, setTransferBranchId] = useState('')
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false)
  const deviceControlFeature = useFeature('security.devicecontrol')
  const { selectedInstitutionId, selectedBranch, selectedInstitution, branches: tenantBranches } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const branchOptions = useMemo(
    () => (tenantBranches || []).map((b) => ({ id: b.id || b.branchId || '', name: b.name || b.branchName || 'Şube' })).filter((b) => b.id),
    [tenantBranches],
  )

  const { data, loading, error, reload } = useApiQuery<{
    staff: PagedResult<ApiStaff>
    appts: ApiAppointment[]
    perms: PermissionMeta[]
    money: ApiStaffMoneyRow[]
  }>(
    async () => {
      // Bu ayın parasal üretimi rapor ucundan gelir: uygulanan hizmet cirosu + satış tutarı
      // personel bazında zaten orada hesaplanıyor (randevu listesinden türetilemez).
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      // METRİK PENCERESİ: eskiden "tüm geçmişten ilk 500 randevu" çekiliyordu; backend
      // randevuları ESKİDEN YENİYE sıraladığı için kurum 500 randevuyu aşınca bu ayın
      // kayıtları sonuç setine hiç girmiyor, "bu ay yapılan iş" ve son 30 gün grafiği
      // sıfır görünüyordu. Artık sınır tarih: son 1 yıl, sayfalar sonuna kadar okunur.
      const statsSince = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      const [staff, appts, perms, money] = await Promise.all([
        adminApi.staff<ApiStaff>({ tenantId, search: filter || undefined, page: 1, pageSize: 100 }),
        fetchAllPaged<ApiAppointment>((page, pageSize) =>
          adminApi.appointments<ApiAppointment>({ tenantId, page, pageSize, fromUtc: statsSince.toISOString() }),
        ).catch(() => [] as ApiAppointment[]),
        adminApi.staffPermissions<PermissionMeta>().catch(() => [] as PermissionMeta[]),
        adminApi
          .reportStaff<{ rows?: ApiStaffMoneyRow[] }>({
            tenantId,
            fromUtc: monthStart.toISOString(),
            toUtc: now.toISOString(),
          })
          .then((r) => r?.rows ?? [])
          .catch(() => [] as ApiStaffMoneyRow[]),
      ])
      return { staff, appts, perms, money }
    },
    [tenantId, filter],
    { initialData: { staff: { items: [] }, appts: [], perms: [], money: [] } },
  )

  /** Personel başına bu ayki üretim: hizmet cirosu + satış tutarı (rapor ucundan). */
  const moneyByStaff = useMemo(() => {
    const m = new Map<string, { revenue: number; salesAmount: number; serviceRevenue: number; salesCount: number }>()
    for (const r of data?.money || []) {
      const id = String(r.staffMemberId ?? '')
      if (!id) continue
      const serviceRevenue = Number(r.serviceRevenue ?? 0)
      const salesAmount = Number(r.salesAmount ?? 0)
      m.set(id, {
        serviceRevenue,
        salesAmount,
        salesCount: Number(r.salesCount ?? 0),
        revenue: serviceRevenue + salesAmount,
      })
    }
    return m
  }, [data])

  const moneyOf = (id: string) =>
    moneyByStaff.get(id) ?? { revenue: 0, salesAmount: 0, serviceRevenue: 0, salesCount: 0 }

  const allStaff = useMemo<Staff[]>(() => apiItems(data?.staff).map((m, i) => normalizeStaff(m, i)), [data])
  const appts = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])

  // ---- per-staff istatistikleri (randevulardan)
  const staffStats = useMemo(() => {
    const m = new Map<string, { total: number; month: number; completed: number; cancelled: number; monthCompleted: number; monthCancelled: number; weekly: number[]; services: Map<string, number> }>()
    const now = new Date(); const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const since30 = Date.now() - 30 * 86_400_000
    for (const s of allStaff) m.set(s.id, { total: 0, month: 0, completed: 0, cancelled: 0, monthCompleted: 0, monthCancelled: 0, weekly: Array(7).fill(0), services: new Map() })
    for (const a of appts) {
      if (!a.staffMemberId) continue
      const e = m.get(a.staffMemberId); if (!e) continue
      e.total++
      const t = new Date(a.date).getTime()
      const inMonth = t >= m0
      if (inMonth) e.month++
      if (a.status === 'tamamlandi') { e.completed++; if (inMonth) e.monthCompleted++ }
      else if (a.status === 'iptal') { e.cancelled++; if (inMonth) e.monthCancelled++ }
      if (t >= since30) { const dow = (new Date(a.date).getDay() + 6) % 7; e.weekly[dow]++ }
      if (a.islem) e.services.set(a.islem, (e.services.get(a.islem) ?? 0) + 1)
    }
    return m
  }, [allStaff, appts])

  /**
   * Performans = bu ay YAPILAN İŞ SAYISI + ÜRETİLEN TUTAR.
   *
   * "Başarı oranı" [tamamlanan / (tamamlanan + iptal + gelmedi)] KALDIRILDI: müşterinin
   * gelmemesi ya da randevuyu iptal etmesi personelin performansı değildir, ama oran onu
   * personelin hanesine yazıp cezalandırıyordu. Ölçtüğünü iddia ettiği şeyi ölçmüyordu.
   *
   * Müşteri skoru personel kartında p.averageRating (gerçek yıldız ortalaması) ile gösterilir.
   */
  const scoreOf = (id: string) => {
    const s = staffStats.get(id)
    const money = moneyOf(id)
    if (!s) return { monthCompleted: 0, monthTotal: 0, ...money }
    return { monthCompleted: s.monthCompleted, monthTotal: s.month, ...money }
  }
  const topServices = (id: string, n = 3) => {
    const s = staffStats.get(id); if (!s) return []
    return Array.from(s.services.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name)
  }

  const staff = useMemo(() => {
    let list = allStaff
    if (scope === 'active') list = list.filter((p) => p.active)
    else if (scope === 'inactive') list = list.filter((p) => !p.active)
    if (statusFilter === 'active') list = list.filter((p) => p.active)
    else if (statusFilter === 'inactive') list = list.filter((p) => !p.active)
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'tr')
      if (sortKey === 'rating') return (b.averageRating ?? -1) - (a.averageRating ?? -1)
      if (sortKey === 'appointments') return (staffStats.get(b.id)?.total ?? 0) - (staffStats.get(a.id)?.total ?? 0)
      // Sıralama ÜRETİLEN TUTARA göre; eşitlikte işlem sayısı ayırır.
      const sa = scoreOf(a.id); const sb = scoreOf(b.id)
      return sb.revenue - sa.revenue || sb.monthCompleted - sa.monthCompleted
    })
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStaff, scope, statusFilter, sortKey, staffStats])

  const selected = useMemo(() => staff.find((m) => m.id === selectedId) || staff[0], [staff, selectedId])
  useEffect(() => {
    if (!selectedId && staff[0]?.id) setSelectedId(staff[0].id)
    if (selectedId && staff.length && !staff.some((m) => m.id === selectedId)) setSelectedId(staff[0].id)
  }, [staff, selectedId])

  /* ---- yetki kataloğu + matris -------------------------------------- */

  // Katalog backend'den gelir; gelmezse personelde kayıtlı sayfa anahtarlarından türetilir (sayfa boş kalmasın).
  const catalog = useMemo<PermissionMeta[]>(() => {
    const fromApi = data?.perms ?? []
    if (fromApi.length) return fromApi
    const keys = new Set<string>()
    for (const s of allStaff) for (const k of s.permissions) if (!k.includes('.')) keys.add(k)
    return Array.from(keys).map((key) => ({ key, label: key, description: 'Katalog dışı yetki anahtarı.', actions: [] }))
  }, [data, allStaff])

  const permSets = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const s of allStaff) m.set(s.id, new Set(s.permissions))
    return m
  }, [allStaff])

  /** Sayfa başına: kimlerde var, kaç tam / kaç kısmi. */
  const pageRows = useMemo(() => {
    return catalog.map((page) => {
      const holders = allStaff.filter((s) => permSets.get(s.id)?.has(page.key))
      const full = holders.filter((s) => permCell(permSets.get(s.id) ?? new Set(), page).state === 'full').length
      return { page, holders, full, partial: holders.length - full }
    })
  }, [catalog, allStaff, permSets])

  const selPage = useMemo(
    () => pageRows.find((r) => r.page.key === selectedPerm) || pageRows.find((r) => r.holders.length > 0) || pageRows[0],
    [pageRows, selectedPerm],
  )

  /** Katalogda olmayan (eski/özel) anahtarlar — sessizce kaybolmasın. */
  const orphanKeys = useMemo(() => {
    const known = new Set<string>()
    for (const p of catalog) { known.add(p.key); for (const a of p.actions ?? []) known.add(a.key) }
    const out = new Set<string>()
    for (const s of allStaff) for (const k of s.permissions) if (!known.has(k)) out.add(k)
    return Array.from(out)
  }, [catalog, allStaff])

  /* ---- pano metrikleri ---------------------------------------------- */

  const activeCount = allStaff.filter((p) => p.active).length
  const teamPulse = useMemo(() => {
    let monthCompleted = 0, monthRevenue = 0, ratingSum = 0, ratingWeight = 0
    for (const s of allStaff) {
      const st = staffStats.get(s.id)
      if (st) monthCompleted += st.monthCompleted
      monthRevenue += moneyOf(s.id).revenue
      if (s.averageRating != null && (s.ratingCount ?? 0) > 0) { ratingSum += s.averageRating * (s.ratingCount ?? 0); ratingWeight += s.ratingCount ?? 0 }
    }
    const coveredPages = pageRows.filter((r) => r.holders.length > 0).length
    return {
      monthCompleted,
      monthRevenue,
      rating: ratingWeight > 0 ? ratingSum / ratingWeight : 0,
      ratingCount: ratingWeight,
      coveredPages,
      catalogPages: catalog.length,
      coverage: catalog.length ? Math.round((coveredPages / catalog.length) * 100) : 0,
    }
  }, [allStaff, staffStats, pageRows, catalog])

  /** Ayın en çok iş bitiren personeli (kartta taç rozeti). */
  const topPerformerId = useMemo(() => {
    let best: string | null = null; let bestVal = 0
    for (const s of allStaff) {
      const v = staffStats.get(s.id)?.monthCompleted ?? 0
      if (v > bestVal) { bestVal = v; best = s.id }
    }
    return best
  }, [allStaff, staffStats])

  /* ---- aksiyonlar ---------------------------------------------------- */

  const uploadStaffPhoto = async (member: Staff, file: File): Promise<void> => {
    setActionError('')
    try {
      const dataUrl = await downscaleImage(file, 320)
      await adminApi.updateStaff(member.id, {
        fullName: member.name, title: member.role, phone: member.phone || null, specialties: member.dept || null,
        commissionRate: member.commissionRate ?? null, isActive: member.active, permissions: member.permissions, photoUrl: dataUrl,
      }, tenantId)
      await reload()
    } catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Fotoğraf yüklenemedi.') }
  }

  const handleTransfer = async (): Promise<void> => {
    if (!selected || !transferBranchId) return
    setActionError('')
    try {
      await adminApi.transferStaffBranch(selected.id, transferBranchId, tenantId)
      setTransferOpen(false)
      await reload()
    } catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Personel aktarılamadı.') }
  }

  const selectedCells = useMemo(() => {
    if (!selected) return []
    const set = permSets.get(selected.id) ?? new Set<string>()
    return catalog.map((page) => ({ page, cell: permCell(set, page) })).filter((x) => x.cell.state !== 'none')
  }, [selected, permSets, catalog])

  return (
    <>
      <Topbar
        title="Personel & Roller"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Merkez'} · ${SCOPE_LABEL[scope]}`}
        breadcrumbs={['Admin', 'Yönetim', 'Personel', SCOPE_LABEL[scope]]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StaffFormDialog
              mode="create" branches={branchOptions} tenantId={tenantId} tenantName={selectedInstitution?.name}
              onSubmitted={async () => { await reload() }}
              trigger={
                <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#e0617f] to-[#c85776] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_12px_26px_-16px_rgba(200,87,118,0.95)] transition-transform hover:-translate-y-0.5">
                  <UserPlus className="h-4 w-4" strokeWidth={2.1} /> Personel Ekle
                </button>
              }
            />
            <ExcelTransferActions<Staff>
              featureKey="excel.staff" moduleName="Personel" context={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || ''}`}
              rows={staff}
              sheet={{
                subtitle: `${staff.length} personel`,
                columns: [
                  { key: 'name', header: 'Ad Soyad', width: 26, type: 'text', accessor: (p) => p.name },
                  { key: 'role', header: 'Unvan', width: 20, type: 'text', accessor: (p) => p.role },
                  { key: 'dept', header: 'Uzmanlık', width: 24, type: 'text', accessor: (p) => p.dept },
                  { key: 'phone', header: 'Telefon', width: 18, type: 'text', accessor: (p) => p.phone },
                  { key: 'email', header: 'E-posta', width: 26, type: 'text', accessor: (p) => p.email || '' },
                  { key: 'commission', header: 'Komisyon %', width: 12, type: 'number', accessor: (p) => Number(p.commissionRate || 0) },
                  { key: 'status', header: 'Durum', width: 10, type: 'text', accessor: (p) => (p.active ? 'Aktif' : 'Pasif') },
                ],
              }}
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi (kolon-agnostik,
                mükerrer atlar, tek istekte parti hâlinde gönderir). */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white px-4 py-2 text-[12px] font-semibold text-[#c85776] transition-transform hover:-translate-y-0.5 hover:bg-[#fff4f8]"
            >
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && allStaff.length === 0} emptyMessage="Personel kaydı yok." />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}

        {/* ══════════════════════ EKİP PANOSU ══════════════════════ */}
        <motion.section
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[24px] border border-[#ead8df]/80 bg-white/92 p-5 shadow-[0_26px_60px_-44px_rgba(150,78,104,0.55)] sm:p-6"
        >
          {/* gül + altın ışık lekeleri */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.16]">
            <div className="absolute -left-24 -top-28 h-56 w-56 rounded-full bg-[#c85776] blur-[70px]" />
            <div className="absolute -bottom-28 right-10 h-56 w-56 rounded-full bg-[#b88938] blur-[80px]" />
          </div>

          <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-7">
            {/* — sol: kadro kimliği */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]">
                <Sparkles className="h-4 w-4" /> Ekip Panosu
              </div>
              <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className="font-display text-4xl tabular-nums tracking-tight text-[#352432]"><CountUp value={allStaff.length} /></span>
                <span className="pb-1 text-[13px] font-medium text-[#4a3a44]">kişilik kadro</span>
              </div>

              {/* aktif / pasif oranı */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] font-medium">
                  <span className="text-[#2f9e72]">{activeCount} aktif</span>
                  <span className="text-[#705a66]">{allStaff.length - activeCount} pasif / izinli</span>
                </div>
                <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-[#f4e6ec]">
                  <motion.span
                    className="block h-full rounded-full bg-gradient-to-r from-[#3cae8d] to-[#5cc9a7]"
                    initial={{ width: 0 }} animate={{ width: `${allStaff.length ? (activeCount / allStaff.length) * 100 : 0}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* ekip şeridi */}
              <div className="mt-4 flex items-center gap-3">
                <div className="flex -space-x-2.5">
                  {allStaff.slice(0, 7).map((p, i) => (
                    <motion.span
                      key={p.id}
                      initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + i * 0.05 }}
                      className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border-2 border-white shadow-[0_4px_10px_-6px_rgba(120,71,88,0.7)]"
                      title={`${p.name} · ${p.role}`}
                    >
                      <Avatar name={p.name} photoUrl={p.photoUrl || undefined} size={36} radius={999} />
                    </motion.span>
                  ))}
                  {allStaff.length > 7 && (
                    <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#fff1f6] text-[11px] font-semibold text-[#b14d6c]">
                      +{allStaff.length - 7}
                    </span>
                  )}
                </div>
                {allStaff.length === 0 && <span className="text-[12px] text-[#705a66]">Henüz personel eklenmedi.</span>}
              </div>

              {/* kapsam görünümü sekmeleri */}
              <div className="mt-5 inline-flex flex-wrap gap-1 rounded-[14px] border border-[#ead8df]/80 bg-[#fffafc] p-1">
                {SCOPE_TABS.map((t) => {
                  const on = scope === t.key
                  return (
                    <Link
                      key={t.key}
                      href={`/admin/personel?scope=${t.key}`}
                      className={`relative inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11.5px] font-medium transition-colors ${on ? 'text-white' : 'text-[#4a3a44] hover:text-[#c85776]'}`}
                    >
                      {on && (
                        <motion.span
                          layoutId="personel-scope-pill"
                          className="absolute inset-0 rounded-[10px] bg-gradient-to-r from-[#e0617f] to-[#c85776]"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <t.icon className="relative z-10 h-3.5 w-3.5" />
                      <span className="relative z-10">{t.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* — sağ: 4 gerçek metrik */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] border border-[#ead8df]/70 bg-[#fffafc] p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#705a66]">
                  <TrendingUp className="h-3.5 w-3.5 text-[#c85776]" /> Bu ay tamamlanan iş
                </div>
                <div className="mt-1 font-display text-3xl tabular-nums tracking-tight text-[#352432]"><CountUp value={teamPulse.monthCompleted} /></div>
                <div className="text-[11px] text-[#705a66]">tüm ekip · randevu bazlı</div>
              </div>

              {/* Başarı oranı yerine ÜRETİLEN TUTAR: müşteri kaynaklı iptal/gelmedi personeli
                  cezalandırmasın (bkz. scoreOf). */}
              <div className="rounded-[16px] border border-[#ead8df]/70 bg-[#fffafc] p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#705a66]">
                  <Wallet className="h-3.5 w-3.5 text-[#c85776]" /> Bu ay üretilen tutar
                </div>
                <div className="mt-1 font-display text-3xl tabular-nums tracking-tight text-[#352432]">
                  {formatTL(teamPulse.monthRevenue)}
                </div>
                <div className="text-[11px] text-[#705a66]">tüm ekip · uygulama + satış</div>
              </div>

              <div className="rounded-[16px] border border-[#ead8df]/70 bg-[#fffafc] p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#705a66]">
                  <Star className="h-3.5 w-3.5 text-[#d8ad55]" /> Ortalama müşteri puanı
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-display text-3xl tabular-nums tracking-tight text-[#352432]">
                    {teamPulse.ratingCount ? <CountUp value={teamPulse.rating} decimals={1} /> : '—'}
                  </span>
                  <Stars value={teamPulse.rating} />
                </div>
                <div className="text-[11px] text-[#705a66]">{teamPulse.ratingCount ? `${teamPulse.ratingCount} değerlendirme` : 'Henüz puan yok'}</div>
              </div>

              <div className="flex items-center gap-3 rounded-[16px] border border-[#ead8df]/70 bg-[#fffafc] p-4">
                <Ring value={teamPulse.coverage} tone="#b88938" title={`${teamPulse.coveredPages}/${teamPulse.catalogPages}`} />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[#705a66]">Yetki kapsamı</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-[#4a3a44]">En az bir kişiye açık sayfa</div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {scope === 'permissions' ? (
          /* ═══════════════════ YETKİ MATRİSİ ═══════════════════ */
          <div className="space-y-4">
            <div className="min-w-0 rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_20px_48px_-38px_rgba(150,78,104,0.5)] sm:p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]">
                    <ShieldCheck className="h-4 w-4" /> Yetki Matrisi
                  </div>
                  <div className="mt-1 font-display text-2xl tracking-tight text-[#352432]">
                    {catalog.length} panel sayfası × {allStaff.length} personel
                  </div>
                  <div className="text-[12px] text-[#705a66]">Satıra tıklayınca sayfanın işlem kırılımı aşağıda açılır.</div>
                </div>
                {/* açıklama */}
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#4a3a44]">
                  <span className="inline-flex items-center gap-1.5"><CellBadge cell={{ state: 'full', granted: 0, total: 0, legacy: false }} compact /> Tam yetki</span>
                  <span className="inline-flex items-center gap-1.5"><CellBadge cell={{ state: 'partial', granted: 2, total: 4, legacy: false }} compact /> Kısmi (açık/toplam işlem)</span>
                  <span className="inline-flex items-center gap-1.5"><CellBadge cell={{ state: 'none', granted: 0, total: 0, legacy: false }} compact /> Kapalı</span>
                </div>
              </div>

              {allStaff.length === 0 || catalog.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-12 text-center text-[12.5px] text-[#705a66]">
                  Matris için personel ve yetki kataloğu gerekiyor. Personel ekleyip “Rol Düzenle” ile yetki verin.
                </div>
              ) : (
                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <div
                    className="min-w-max [--matrix-head:148px] sm:[--matrix-head:210px]"
                    style={{ display: 'grid', gridTemplateColumns: `minmax(var(--matrix-head), 1.3fr) repeat(${allStaff.length}, minmax(58px, 1fr))` }}
                  >
                    {/* başlık satırı */}
                    <div className="sticky left-0 z-20 flex items-end bg-white px-1 pb-2.5 text-[10px] font-mono uppercase tracking-widest text-[#705a66]">
                      Sayfa \ Personel
                    </div>
                    {allStaff.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseEnter={() => setHoverCol(p.id)}
                        onMouseLeave={() => setHoverCol(null)}
                        onClick={() => setHoverCol(hoverCol === p.id ? null : p.id)}
                        className={`flex flex-col items-center gap-1 rounded-t-[12px] px-1 pb-2.5 pt-1 transition-colors ${hoverCol === p.id ? 'bg-[#fff1f6]' : ''}`}
                        title={`${p.name} · ${p.role}`}
                      >
                        <span className="overflow-hidden rounded-full border-2 border-white shadow-[0_4px_10px_-6px_rgba(120,71,88,0.8)]">
                          <Avatar name={p.name} photoUrl={p.photoUrl || undefined} size={34} radius={999} />
                        </span>
                        <span className="max-w-[70px] truncate text-[10px] font-medium text-[#4a3a44]">{p.name.split(' ')[0]}</span>
                      </button>
                    ))}

                    {/* satırlar */}
                    {pageRows.map((row, ri) => {
                      const Icon = pageIcon(row.page.key)
                      const on = selPage?.page.key === row.page.key
                      return (
                        <Fragment key={row.page.key}>
                          <button
                            type="button"
                            onClick={() => setSelectedPerm(row.page.key)}
                            className={`sticky left-0 z-10 flex items-center gap-2.5 rounded-l-[12px] border-l-2 py-2 pl-2 pr-3 text-left transition-colors ${
                              on ? 'border-[#c85776] bg-[#fff1f6]' : `border-transparent ${ri % 2 ? 'bg-[#fffafc]' : 'bg-white'} hover:bg-[#fff7fa]`
                            }`}
                          >
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${on ? 'bg-[#c85776] text-white' : 'bg-[#fff1f6] text-[#c85776]'}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[12.5px] font-medium text-[#352432]">{row.page.label}</span>
                              <span className="block text-[10.5px] text-[#705a66]">
                                {row.holders.length ? `${row.holders.length} personel${row.partial ? ` · ${row.partial} kısmi` : ''}` : 'Kimseye açık değil'}
                              </span>
                            </span>
                          </button>
                          {allStaff.map((p) => {
                            const cell = permCell(permSets.get(p.id) ?? new Set(), row.page)
                            return (
                              <div
                                key={p.id}
                                onMouseEnter={() => setHoverCol(p.id)}
                                onMouseLeave={() => setHoverCol(null)}
                                title={`${p.name} · ${row.page.label} → ${cell.state === 'none' ? 'kapalı' : cell.state === 'full' ? (cell.legacy ? 'tam yetki (eski kayıt)' : 'tam yetki') : `${cell.granted}/${cell.total} işlem`}`}
                                className={`grid place-items-center py-2 transition-colors ${
                                  on ? 'bg-[#fff1f6]' : hoverCol === p.id ? 'bg-[#fff7fa]' : ri % 2 ? 'bg-[#fffafc]' : 'bg-white'
                                }`}
                              >
                                <CellBadge cell={cell} />
                              </div>
                            )
                          })}
                        </Fragment>
                      )
                    })}

                    {/* toplam satırı */}
                    <div className="sticky left-0 z-10 flex items-center gap-2 rounded-bl-[12px] border-t border-[#ead8df]/70 bg-white px-2 py-2.5 text-[11px] font-medium text-[#705a66]">
                      Açık sayfa sayısı
                    </div>
                    {allStaff.map((p) => {
                      const count = pageRows.filter((r) => permSets.get(p.id)?.has(r.page.key)).length
                      return (
                        <div
                          key={p.id}
                          className={`grid place-items-center border-t border-[#ead8df]/70 py-2.5 ${hoverCol === p.id ? 'bg-[#fff7fa]' : ''}`}
                        >
                          <span className={`font-display text-[15px] tabular-nums ${count ? 'text-[#c85776]' : 'text-[#b9a3ad]'}`}>{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {allStaff.length > 1 && (
                <div className="mt-2 text-[11px] text-[#705a66] lg:hidden">Diğer personel kolonları için tabloyu yana kaydırın →</div>
              )}

              {orphanKeys.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#705a66]"><Shield className="h-3.5 w-3.5" /> Katalog dışı anahtar:</span>
                  {orphanKeys.map((k) => (
                    <span key={k} className="rounded-md border border-[#ead8df] bg-white px-2 py-0.5 text-[10.5px] text-[#4a3a44]">{k}</span>
                  ))}
                  <span className="text-[11px] text-[#705a66]">Personeli düzenleyip kaydedince temizlenir.</span>
                </div>
              )}
            </div>

            {/* sayfa dosyası + kapsam sıralaması */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_20px_48px_-38px_rgba(150,78,104,0.5)] sm:p-5">
                <AnimatePresence mode="wait">
                  {selPage ? (
                    <motion.div key={selPage.page.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
                      <div className="flex items-start gap-3">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#fff1f6] to-[#ffe4ec] text-[#c85776]">
                          {(() => { const I = pageIcon(selPage.page.key); return <I className="h-6 w-6" /> })()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-xl tracking-tight text-[#352432]">{selPage.page.label}</div>
                          <div className="mt-0.5 text-[12px] leading-relaxed text-[#4a3a44]">{selPage.page.description}</div>
                        </div>
                        <Ring
                          value={activeCount ? (selPage.holders.filter((h) => h.active).length / activeCount) * 100 : 0}
                          size={62} stroke={6}
                          title={`${selPage.holders.filter((h) => h.active).length}/${activeCount}`}
                        />
                      </div>

                      {/* sayfayı görebilenler */}
                      <div className="mt-5">
                        <div className="text-[11px] font-mono uppercase tracking-widest text-[#705a66]">Sayfayı görebilenler ({selPage.holders.length})</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selPage.holders.map((h) => {
                            const cell = permCell(permSets.get(h.id) ?? new Set(), selPage.page)
                            return (
                              <span key={h.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#ead8df] bg-white py-1 pl-1 pr-2.5 text-[11.5px] text-[#4a3a44]">
                                <Avatar name={h.name} photoUrl={h.photoUrl || undefined} size={20} radius={999} />
                                {h.name}
                                {cell.state === 'partial' && <span className="rounded bg-[#fff1f6] px-1 text-[10px] font-semibold text-[#b14d6c]">{cell.granted}/{cell.total}</span>}
                              </span>
                            )
                          })}
                          {!selPage.holders.length && <span className="text-[12px] text-[#705a66]">Bu sayfa hiçbir personele açık değil.</span>}
                        </div>
                      </div>

                      {/* işlem kırılımı */}
                      <div className="mt-5">
                        <div className="text-[11px] font-mono uppercase tracking-widest text-[#705a66]">İşlem yetkileri</div>
                        {(selPage.page.actions ?? []).length === 0 ? (
                          <div className="mt-2 rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-3 text-[12px] text-[#705a66]">
                            Bu sayfada ayrı işlem yetkisi yok — sayfa açıksa tam erişim verilir.
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {(selPage.page.actions ?? []).map((a) => {
                              // Eski kayıtta işlem anahtarı yazılı olmasa da yetki geçerlidir (IsActionAllowed).
                              const owners = selPage.holders.filter((h) => {
                                const set = permSets.get(h.id) ?? new Set<string>()
                                return set.has(a.key) || permCell(set, selPage.page).legacy
                              })
                              const pct = selPage.holders.length ? Math.round((owners.length / selPage.holders.length) * 100) : 0
                              return (
                                <div key={a.key} className="rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-[12.5px] font-medium text-[#352432]">{a.label}</span>
                                    <span className="shrink-0 text-[11px] tabular-nums text-[#705a66]">{owners.length}/{selPage.holders.length}</span>
                                  </div>
                                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f4e6ec]">
                                    <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                                  </div>
                                  {owners.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {owners.map((o) => (
                                        <span key={o.id} className="rounded-md bg-white px-1.5 py-0.5 text-[10.5px] text-[#4a3a44] ring-1 ring-[#ead8df]">{o.name.split(' ')[0]}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="grid h-full place-items-center py-16 text-[13px] text-[#705a66]">Yetki kataloğu yüklenemedi.</div>
                  )}
                </AnimatePresence>
              </div>

              {/* kapsam sıralaması */}
              <div className="min-w-0 rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_20px_48px_-38px_rgba(150,78,104,0.5)] sm:p-5">
                <div className="text-[11px] font-mono uppercase tracking-widest text-[#c85776]">Sayfa Kapsamı</div>
                <div className="mt-1 font-display text-xl tracking-tight text-[#352432]">Hangi sayfa kaç kişide açık?</div>
                <div className="mt-4 space-y-2">
                  {[...pageRows].sort((a, b) => b.holders.length - a.holders.length).map((row) => {
                    const Icon = pageIcon(row.page.key)
                    const pct = allStaff.length ? Math.round((row.holders.length / allStaff.length) * 100) : 0
                    const on = selPage?.page.key === row.page.key
                    return (
                      <button
                        key={row.page.key}
                        type="button"
                        onClick={() => setSelectedPerm(row.page.key)}
                        className={`flex w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-colors ${on ? 'border-[#c85776]/60 bg-[#fff1f6]/60' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12.5px] font-medium text-[#352432]">{row.page.label}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[#705a66]">{row.holders.length} kişi</span>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#f4e6ec]">
                            <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#c85776] to-[#f3a3bf]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ═══════════════════ KADRO + PERSONEL DOSYASI ═══════════════════ */
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* KADRO */}
            <div className="min-w-0 rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-4 shadow-[0_20px_48px_-38px_rgba(150,78,104,0.5)] sm:p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-[#c85776]">Kadro</div>
                  <div className="font-display text-2xl tracking-tight text-[#352432]">{staff.length} personel</div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <div className="relative min-w-[150px] flex-1 sm:flex-none">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#705a66]" />
                    <input
                      value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Personel ara"
                      className="w-full rounded-[10px] border border-[#ead8df] bg-white py-1.5 pl-8 pr-2.5 text-[12px] text-[#352432] outline-none transition-colors placeholder:text-[#705a66] focus:border-[#c85776] sm:w-40"
                    />
                  </div>
                  <select
                    value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                    className="min-w-0 flex-1 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776] sm:flex-none"
                  >
                    <option value="">Tüm durumlar</option><option value="active">Aktif</option><option value="inactive">Pasif</option>
                  </select>
                  <div className="relative min-w-[170px] flex-1 sm:flex-none">
                    <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#705a66]" />
                    <select
                      value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                      className="w-full appearance-none rounded-[10px] border border-[#ead8df] bg-white py-1.5 pl-8 pr-3 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                    >
                      {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Kart ızgarası panelin GENİŞLİĞİNE göre: xl'de sağda dosya paneli açıldığı
                  için tek kolona iner, 2xl'de tekrar ikiye ayrılır (14" ekranda sıkışmasın). */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {staff.map((p, i) => {
                  const st = staffStats.get(p.id)
                  const sc = scoreOf(p.id)
                  const on = selected?.id === p.id
                  const pages = p.permissions.filter((k) => !k.includes('.')).length
                  const actions = p.permissions.filter((k) => k.includes('.')).length
                  return (
                    <motion.button
                      key={p.id} type="button"
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
                      whileHover={{ y: -3 }} onClick={() => setSelectedId(p.id)}
                      className={`group relative overflow-hidden rounded-[18px] border p-3.5 text-left transition-colors ${
                        on ? 'border-[#c85776]/70 bg-[#fff1f6]/45 shadow-[0_18px_40px_-30px_rgba(200,87,118,0.85)]' : 'border-[#ead8df]/80 bg-white hover:border-[#efbfd0]'
                      }`}
                    >
                      {/* seçili göstergesi */}
                      <span className={`absolute inset-y-0 left-0 w-1 rounded-r bg-gradient-to-b from-[#e0617f] to-[#c85776] transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />

                      <div className="flex items-start gap-3">
                        <label
                          className="group/photo relative h-[74px] w-[74px] shrink-0 cursor-pointer overflow-hidden rounded-[16px] border border-[#efbfd0]/70 bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5]"
                          onClick={(e) => e.stopPropagation()}
                          title="Fotoğraf yükle / değiştir"
                        >
                          {p.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.photoUrl} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="grid h-full w-full place-items-center font-display text-xl text-[#8e3f5b]">{initialsFromName(p.name)}</span>
                          )}
                          <span className="absolute inset-0 grid place-items-center bg-[#241923]/40 opacity-0 transition-opacity group-hover/photo:opacity-100"><ImagePlus className="h-4 w-4 text-white" /></span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadStaffPhoto(p, f); e.target.value = '' }} />
                        </label>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-display text-[17px] tracking-tight text-[#352432]">{p.name}</span>
                                {topPerformerId === p.id && (
                                  <span title="Bu ayın en çok iş bitiren personeli" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[#e7c169] to-[#b88938] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                    <Crown className="h-3 w-3" /> Ayın 1.
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] font-medium text-[#c85776]">{p.role}</div>
                            </div>
                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${p.active ? 'bg-emerald-500' : 'bg-rose-500'}`} /> {p.active ? 'Aktif' : 'Pasif'}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Stars value={p.averageRating ?? 0} size={12} />
                            <span className="text-[11px] text-[#705a66]">
                              {p.averageRating != null ? `${p.averageRating.toFixed(1)}${p.ratingCount ? ` · ${p.ratingCount} oy` : ''}` : 'puan yok'}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-[#705a66]">{p.dept}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-[10px] border border-[#ead8df]/70 bg-[#fffafc] px-2 py-1.5">
                          {/* Sayaç son 1 yıllık pencereden gelir (metrik penceresi) — "tüm zamanlar" değil. */}
                          <div className="text-[10px] text-[#705a66]">Randevu (1 yıl)</div>
                          <div className="font-display text-[15px] tabular-nums text-[#352432]">{st?.total ?? 0}</div>
                        </div>
                        <div className="rounded-[10px] border border-[#ead8df]/70 bg-[#fffafc] px-2 py-1.5">
                          <div className="text-[10px] text-[#705a66]">Bu ay</div>
                          <div className="font-display text-[15px] tabular-nums text-[#352432]">{sc.monthCompleted}</div>
                        </div>
                        <div className="rounded-[10px] border border-[#ead8df]/70 bg-[#fffafc] px-2 py-1.5" title={`${pages} sayfa yetkisi · ${actions} işlem yetkisi`}>
                          <div className="text-[10px] text-[#705a66]">Sayfa yetkisi</div>
                          <div className="font-display text-[15px] tabular-nums text-[#352432]">{pages}</div>
                        </div>
                      </div>

                      {/* Başarı oranı yerine bu ayki ÜRETİM: kaç iş yaptı ve ne kadar tutar üretti.
                          Uygulama (tamamlanan randevu cirosu) ve satış ayrı ayrı okunabilir. */}
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#705a66]">Bu ay üretim</span>
                          <span className="font-semibold text-[#352432]">
                            {sc.monthCompleted} işlem · {formatTL(sc.revenue)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[10.5px] text-[#705a66]">
                          <span>Uygulama {formatTL(sc.serviceRevenue)}</span>
                          <span aria-hidden>·</span>
                          <span>Satış {formatTL(sc.salesAmount)}</span>
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {topServices(p.id).map((s) => (
                          <span key={s} className="rounded-md border border-[#ead8df]/80 bg-white px-1.5 py-0.5 text-[10.5px] text-[#4a3a44]">{s}</span>
                        ))}
                        {topServices(p.id).length === 0 && p.dept && (
                          <span className="rounded-md border border-[#ead8df]/80 bg-white px-1.5 py-0.5 text-[10.5px] text-[#4a3a44]">{p.dept}</span>
                        )}
                      </div>
                    </motion.button>
                  )
                })}
                {!staff.length && (
                  <div className="col-span-full rounded-[16px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-12 text-center">
                    <Users className="mx-auto h-8 w-8 text-[#efbfd0]" />
                    <div className="mt-2 text-[13px] font-medium text-[#352432]">Personel bulunamadı</div>
                    <div className="mt-0.5 text-[12px] text-[#705a66]">Arama/filtreyi değiştirin ya da “Personel Ekle” ile kadroya kişi tanımlayın.</div>
                  </div>
                )}
              </div>
            </div>

            {/* PERSONEL DOSYASI */}
            <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
              <div className="overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 shadow-[0_20px_48px_-38px_rgba(150,78,104,0.5)]">
                {selected ? (() => {
                  const st = staffStats.get(selected.id)
                  const sc = scoreOf(selected.id)
                  return (
                    <AnimatePresence mode="wait">
                      <motion.div key={selected.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.24 }}>
                        {/* başlık bandı */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-[#fff1f6] via-[#ffe8f0] to-[#fff7f2] px-5 pb-5 pt-5">
                          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#c85776] opacity-[0.10] blur-[50px]" />
                          <div className="relative flex gap-4">
                            <label className="group relative h-[92px] w-[82px] shrink-0 cursor-pointer overflow-hidden rounded-[18px] border-2 border-white bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5] shadow-[0_12px_28px_-18px_rgba(120,71,88,0.9)]" title="Fotoğraf yükle / değiştir">
                              {selected.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={selected.photoUrl} alt={selected.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="grid h-full w-full place-items-center font-display text-3xl text-[#8e3f5b]">{initialsFromName(selected.name)}</span>
                              )}
                              <span className="absolute inset-0 grid place-items-center bg-[#241923]/40 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span>
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadStaffPhoto(selected, f); e.target.value = '' }} />
                            </label>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-display text-xl tracking-tight text-[#352432] sm:text-2xl">{selected.name}</div>
                                  <div className="truncate text-[12px] font-medium text-[#c85776]">{selected.role}</div>
                                </div>
                                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${selected.active ? 'bg-white text-emerald-700' : 'bg-white text-rose-700'}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${selected.active ? 'bg-emerald-500' : 'bg-rose-500'}`} /> {selected.active ? 'Aktif' : 'Pasif'}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                                {selected.dept && <span className="rounded-full bg-white/85 px-2 py-0.5 text-[#4a3a44]">{selected.dept}</span>}
                                {selected.phone && <span className="rounded-full bg-white/85 px-2 py-0.5 text-[#4a3a44]">{selected.phone}</span>}
                                {selected.commissionRate ? <span className="rounded-full bg-white/85 px-2 py-0.5 font-medium text-[#b88938]">%{selected.commissionRate} prim</span> : null}
                              </div>
                            </div>
                          </div>

                          {/* 4'lü metrik şeridi */}
                          <div className="relative mt-4 grid grid-cols-4 gap-2">
                            {[
                              { k: 'Randevu (1 yıl)', v: String(st?.total ?? 0) },
                              { k: 'Bu ay işlem', v: String(sc.monthCompleted) },
                              { k: 'Bu ay tutar', v: formatTL(sc.revenue) },
                              { k: 'Yetki', v: String(selected.permissions.filter((x) => !x.includes('.')).length) },
                            ].map((m) => (
                              <div key={m.k} className="rounded-[12px] border border-white/70 bg-white/80 px-2 py-2 text-center">
                                <div className="font-display text-[17px] tabular-nums tracking-tight text-[#352432]">{m.v}</div>
                                <div className="text-[10px] text-[#705a66]">{m.k}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4 p-5">
                          {/* aktivite + puan */}
                          <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
                            <div className="rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] p-3">
                              <div className="text-[11px] font-medium text-[#705a66]">Haftalık aktivite <span className="text-[10.5px]">(son 30 gün)</span></div>
                              <div className="mt-2"><WeeklyBars values={st?.weekly || Array(7).fill(0)} /></div>
                            </div>
                            <div className="flex flex-col items-center justify-center gap-1.5 rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] p-3">
                              <div className="text-[11px] font-medium text-[#705a66]">Müşteri puanı</div>
                              <Ring
                                value={((selected.averageRating ?? 0) / 5) * 100} tone="#d8ad55" size={68}
                                title={selected.averageRating != null ? selected.averageRating.toFixed(1) : '—'}
                              />
                              <Stars value={selected.averageRating ?? 0} size={12} />
                              <div className="text-[10.5px] text-[#705a66]">{selected.ratingCount ? `${selected.ratingCount} değerlendirme` : 'Henüz puan yok'}</div>
                            </div>
                          </div>

                          {/* yetki dosyası — gerçek katalog etiketleriyle */}
                          <div className="rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#705a66]"><ShieldCheck className="h-3.5 w-3.5 text-[#c85776]" /> Yetki dosyası</div>
                              <Link href="/admin/personel?scope=permissions" className="text-[11px] font-medium text-[#c85776] transition-opacity hover:opacity-75">Matriste gör →</Link>
                            </div>
                            {selectedCells.length === 0 ? (
                              <div className="mt-2 text-[12px] text-[#705a66]">Henüz yetki tanımlı değil — “Rol Düzenle” ile sayfa ve işlem yetkilerini açın.</div>
                            ) : (
                              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                                {selectedCells.map(({ page, cell }) => {
                                  const Icon = pageIcon(page.key)
                                  return (
                                    <div key={page.key} className="flex items-center gap-2 rounded-[10px] border border-[#ead8df]/70 bg-white px-2 py-1.5">
                                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-3.5 w-3.5" /></span>
                                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#352432]">{page.label}</span>
                                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cell.state === 'full' ? 'bg-emerald-50 text-emerald-700' : 'bg-[#fff1f6] text-[#b14d6c]'}`}>
                                        {cell.state === 'full' ? 'tam' : `${cell.granted}/${cell.total}`}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {/* aksiyonlar */}
                          <div className="flex flex-wrap gap-2">
                            <StaffFormDialog
                              mode="edit" branches={branchOptions} tenantId={tenantId} tenantName={selectedInstitution?.name} staffId={selected.id}
                              initialValues={{
                                branchId: selected.branchId || branchId || branchOptions[0]?.id || '',
                                fullName: selected.name, title: selected.role || '', phone: selected.phone || '',
                                specialties: selected.dept || '', commissionRate: selected.commissionRate ?? 0,
                                isActive: selected.active, permissions: selected.permissions || [],
                                photoUrl: selected.photoUrl || '',
                              }}
                              onSubmitted={async () => { await reload() }}
                              trigger={
                                <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-[#e0617f] to-[#c85776] px-3.5 py-2 text-[11.5px] font-semibold text-white shadow-[0_10px_22px_-14px_rgba(200,87,118,0.95)] transition-transform hover:-translate-y-0.5">
                                  <UserCog className="h-3.5 w-3.5" /> Rol Düzenle
                                </button>
                              }
                            />
                            <StaffWorkingHoursDialog
                              staffId={selected.id}
                              staffName={selected.name}
                              tenantId={tenantId}
                              trigger={
                                <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11.5px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                                  <CalendarClock className="h-3.5 w-3.5" /> Çalışma Saatleri
                                </button>
                              }
                            />
                            <StaffCalendarLinkButton staffId={selected.id} staffName={selected.name} tenantId={tenantId} />
                            {branchOptions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => { setTransferBranchId(''); setTransferOpen(true) }}
                                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11.5px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" /> Şube Aktar
                              </button>
                            )}
                            {deviceControlFeature && selected.tenantUserId && (
                              <button
                                type="button"
                                onClick={() => setDeviceDialogOpen(true)}
                                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11.5px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
                              >
                                <MonitorSmartphone className="h-3.5 w-3.5" /> Cihazlar
                              </button>
                            )}
                            <ConfirmDialog
                              icon={KeyRound}
                              title={`${selected.name} · şifre sıfırlansın mı?`}
                              description="Yeni geçici şifre üretilir, personelin aktif oturumları kapanır ve ilk girişte şifresini değiştirmesi zorunlu olur. Geçici şifre yalnızca bir kez gösterilir."
                              confirmLabel="Şifreyi sıfırla"
                              cancelLabel="Vazgeç"
                              onConfirm={async () => {
                                setActionError('')
                                try {
                                  const creds = await adminApi.resetStaffPassword<ApiStaffCredentials>(selected.id, tenantId)
                                  setResetCredentials({
                                    ownerName: creds.fullName,
                                    email: creds.email,
                                    initialPassword: creds.initialPassword,
                                    tenantName: creds.tenantName,
                                    branchName: creds.branchName ?? null,
                                    mustChangePassword: true,
                                  })
                                } catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Şifre sıfırlanamadı.') }
                              }}
                              trigger={
                                <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11.5px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                                  <KeyRound className="h-3.5 w-3.5" /> Şifre Sıfırla
                                </button>
                              }
                            />
                            <button type="button"
                              onClick={async () => {
                                setActionError('')
                                try { await adminApi.deleteStaff(selected.id, tenantId); setSelectedId(null); await reload() }
                                catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Personel silinemedi.') }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-[10px] border border-rose-300/50 bg-rose-50 px-3.5 py-2 text-[11.5px] font-medium text-rose-700 transition-colors hover:bg-rose-100">
                              <UserX className="h-3.5 w-3.5" /> Personeli Sil
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  )
                })() : (
                  <div className="grid place-items-center px-5 py-20 text-center">
                    <UserCog className="h-8 w-8 text-[#efbfd0]" />
                    <div className="mt-2 text-[13px] font-medium text-[#352432]">Personel seçilmedi</div>
                    <div className="mt-0.5 text-[12px] text-[#705a66]">Soldaki kadrodan bir kişiye tıklayın.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <CommissionPanel tenantId={tenantId} />
      </div>

      {selected?.tenantUserId && (
        <StaffDeviceDialog
          open={deviceDialogOpen}
          onClose={() => setDeviceDialogOpen(false)}
          staffName={selected.name}
          tenantUserId={selected.tenantUserId}
          tenantId={tenantId}
        />
      )}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent
          className="overflow-hidden rounded-[24px] border border-[#ead8df]/90 bg-white p-0 text-[#352432] shadow-[0_34px_110px_-50px_rgba(120,71,88,0.6)]"
          style={{ width: 'min(94vw, 460px)', maxWidth: 'min(94vw, 460px)' }}
        >
          <div className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]"><ArrowLeftRight className="h-4 w-4" /></span>
              <div>
                <DialogTitle className="font-display text-xl tracking-tight">Şube Aktar</DialogTitle>
                <DialogDescription className="mt-0.5 text-[12px] text-[#705a66]">
                  {selected?.name ? `${selected.name} adlı personeli` : 'Personeli'} başka bir şubeye aktar. Giriş kapsamı da yeni şubeye taşınır.
                </DialogDescription>
              </div>
            </div>
            <div className="mt-5">
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-[#705a66]">Hedef şube</label>
              <select
                value={transferBranchId}
                onChange={(e) => setTransferBranchId(e.target.value)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] outline-none focus:border-[#c85776]"
              >
                <option value="">Hedef şube seçin…</option>
                {branchOptions.filter((b) => b.id !== selected?.branchId).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setTransferOpen(false)} className="rounded-[10px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-medium text-[#4a3a44] transition-colors hover:text-[#352432]">Vazgeç</button>
              <button type="button" onClick={handleTransfer} disabled={!transferBranchId} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                <ArrowLeftRight className="h-3.5 w-3.5" /> Aktar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <TenantCredentialsDialog
        credentials={resetCredentials}
        onClose={() => setResetCredentials(null)}
        kicker="Şifre sıfırlandı"
        title="Yeni personel giriş bilgileri"
        description="Yeni geçici şifre üretildi; personelin aktif oturumları kapatıldı. Bu bilgiler yalnızca bir kez gösterilir."
        pdfHeading="PERSONEL GİRİŞ BİLGİLERİ"
        pdfSubjectLabel="PERSONEL"
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="staff"
        onDone={() => void reload()}
      />
    </>
  )
}

export default function PersonelPage() {
  return (
    <Suspense fallback={null}>
      <PersonelPageInner />
    </Suspense>
  )
}
