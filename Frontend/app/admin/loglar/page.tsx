'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, auditActionLabels, auditEntityLabels, guidOrUndefined, normalizeAuditLog, normalizeStaff } from '@/lib/apiMappers'
import { exportAuditLogsToExcel } from '@/lib/excel'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Eye,
  PencilLine,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Search,
  Star,
  Trash2,
  Users,
  Wallet,
  Package,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ApiAuditLog, ApiStaff, AuditLog, PagedResult } from '@/lib/types'

type ScopeKey = 'today' | 'week' | 'all'
type RangeKey = 'today' | 'week' | 'month' | 'quarter' | 'all'

const RANGE_DAYS: Record<RangeKey, number | null> = { today: 1, week: 7, month: 30, quarter: 90, all: null }
const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Bugün', week: 'Son 7 gün', month: 'Son 30 gün', quarter: 'Son 90 gün', all: 'Tümü',
}
const SCOPE_TO_RANGE: Record<ScopeKey, RangeKey> = { today: 'today', week: 'week', all: 'all' }

const actionIcon: Record<string, LucideIcon> = {
  Create: Plus, Update: PencilLine, Delete: Trash2, ChangeStatus: RefreshCcw, Reschedule: Calendar,
  ChangeNotes: PencilLine, RegisterPayment: Wallet, StockMovement: Package, Submit: ClipboardList,
  Approve: ShieldCheck, Reject: AlertCircle, Cancel: X, View: Eye,
}
const actionTone: Record<string, string> = {
  Create: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Update: 'border-violet-300/40 bg-violet-50 text-violet-700',
  Delete: 'border-rose-300/40 bg-rose-50 text-rose-700',
  ChangeStatus: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Reschedule: 'border-amber-300/40 bg-amber-50 text-amber-700',
  ChangeNotes: 'border-violet-300/40 bg-violet-50 text-violet-700',
  RegisterPayment: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  StockMovement: 'border-sky-300/40 bg-sky-50 text-sky-700',
  Submit: 'border-[#efbfd0]/75 bg-[#fff1f6] text-[#c85776]',
  Approve: 'border-indigo-300/40 bg-indigo-50 text-indigo-700',
  Reject: 'border-rose-300/40 bg-rose-50 text-rose-700',
  Cancel: 'border-[#ead8df]/70 bg-[#fff4f8]/40 text-[#352432]/65',
  View: 'border-sky-300/40 bg-sky-50 text-sky-700',
}
const moduleTone = 'border-[#e7c7d4]/70 bg-[#fff1f6]/70 text-[#b14d6c]'

const AVATAR_COLORS = [
  'from-[#f3a3bf] to-[#ffd9e6]', 'from-[#9c70bb] to-[#e3cdf2]', 'from-[#5aa9e6] to-[#cfe7fb]',
  'from-[#54c1a0] to-[#cdeee2]', 'from-[#e6a14f] to-[#fbe6cb]', 'from-[#e0617f] to-[#fbd2dc]',
]
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function shortRef(id: string): number {
  const tail = id.replace(/[^0-9a-f]/gi, '').slice(-3)
  const n = parseInt(tail || '1', 16)
  return (n % 99) + 1
}

/** Logları n eşit zaman kovasına bölüp her kovadaki kayıt sayısını döndürür (sparkline için). */
function bucketCounts(logs: AuditLog[], n: number): number[] {
  if (logs.length === 0) return Array(n).fill(0)
  const times = logs.map((l) => new Date(l.createdAt).getTime()).filter((t) => !Number.isNaN(t))
  if (times.length === 0) return Array(n).fill(0)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(1, max - min)
  const buckets = Array(n).fill(0)
  for (const t of times) {
    const idx = Math.min(n - 1, Math.floor(((t - min) / span) * n))
    buckets[idx]++
  }
  return buckets
}

function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const max = Math.max(1, ...values)
  const n = values.length
  const pts = values.map((v, i) => `${(i / Math.max(n - 1, 1)) * 100},${28 - (v / max) * 24}`).join(' ')
  const last = values[n - 1] ?? 0
  const lastX = 100
  const lastY = 28 - (last / max) * 24
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-9 w-full overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="1.8" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface StatDef {
  label: string
  value: number
  badge?: string
  icon: LucideIcon
  series: number[]
  stroke: string
}

function LoglarPageInner() {
  const sp = useSearchParams()
  const scopeParam = sp?.get('scope') as ScopeKey | null
  const initialRange: RangeKey = scopeParam && scopeParam in SCOPE_TO_RANGE ? SCOPE_TO_RANGE[scopeParam] : 'all'

  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'
  const tenantId = guidOrUndefined(selectedInstitutionId)

  const [rangeKey, setRangeKey] = useState<RangeKey>(initialRange)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const fromUtc = useMemo(() => {
    const days = RANGE_DAYS[rangeKey]
    return days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined
  }, [rangeKey])

  const baseQuery = useMemo(() => ({
    tenantId,
    fromUtc,
    action: actionFilter || undefined,
    entity: entityFilter || undefined,
    actorUserId: isStaffUser ? user?.userId : (userFilter || undefined),
    search: search || undefined,
  }), [tenantId, fromUtc, actionFilter, entityFilter, userFilter, search, isStaffUser, user?.userId])

  // Tablo — sunucu taraflı sayfalama
  const { data, loading, error, setData } = useApiQuery<PagedResult<ApiAuditLog>>(
    () => adminApi.auditLogs<ApiAuditLog>({ ...baseQuery, page, pageSize }),
    [baseQuery, page, pageSize, refreshKey],
    { initialData: null, enabled: Boolean(tenantId) },
  )

  // Örneklem — sparkline + özet + kullanıcı listesi için (filtreye göre son 200)
  const { data: sampleData } = useApiQuery<PagedResult<ApiAuditLog>>(
    () => adminApi.auditLogs<ApiAuditLog>({ ...baseQuery, page: 1, pageSize: 200 }),
    [baseQuery, refreshKey],
    { initialData: null, enabled: Boolean(tenantId) },
  )

  // Personel — actorUserId → fotoğraf eşlemesi (Kullanıcı sütununda gerçek fotoğraf)
  const { data: staffData } = useApiQuery<PagedResult<ApiStaff>>(
    () => adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }),
    [tenantId, refreshKey],
    { initialData: null, enabled: Boolean(tenantId) },
  )
  const photoByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of apiItems(staffData).map((m, i) => normalizeStaff(m, i))) {
      if (s.tenantUserId && s.photoUrl) map.set(s.tenantUserId, s.photoUrl)
    }
    return map
  }, [staffData])

  const logs: AuditLog[] = useMemo(() => apiItems(data).map((l, i) => normalizeAuditLog(l, i)), [data])
  const sample: AuditLog[] = useMemo(() => apiItems(sampleData).map((l, i) => normalizeAuditLog(l, i)), [sampleData])
  const total = data?.total ?? data?.totalCount ?? logs.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  const userOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of sample) if (l.actorUserId && !map.has(l.actorUserId)) map.set(l.actorUserId, l.actorName)
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [sample])

  const inGroup = useCallback((l: AuditLog, group: 'create' | 'update' | 'delete') => {
    if (group === 'create') return ['Create', 'Submit', 'RegisterPayment'].includes(l.action)
    if (group === 'update') return ['Update', 'ChangeStatus', 'Reschedule', 'ChangeNotes'].includes(l.action)
    return ['Delete', 'Approve', 'Reject', 'Cancel'].includes(l.action)
  }, [])

  const statCards: StatDef[] = useMemo(() => {
    const createL = sample.filter((l) => inGroup(l, 'create'))
    const updateL = sample.filter((l) => inGroup(l, 'update'))
    const deleteL = sample.filter((l) => inGroup(l, 'delete'))
    return [
      { label: 'Toplam İşlem', value: total, icon: Activity, series: bucketCounts(sample, 14), stroke: '#d7839d' },
      { label: 'Oluşturma', value: createL.length, badge: 'create + submit + payment', icon: Plus, series: bucketCounts(createL, 14), stroke: '#3cae8d' },
      { label: 'Güncelleme', value: updateL.length, badge: 'update + status + reschedule', icon: PencilLine, series: bucketCounts(updateL, 14), stroke: '#9c70bb' },
      { label: 'Silme / Onay', value: deleteL.length, icon: ShieldCheck, series: bucketCounts(deleteL, 14), stroke: '#e0617f' },
    ]
  }, [sample, total, inGroup])

  // Log Özeti
  const summary = useMemo(() => {
    const byHour = new Array(24).fill(0)
    const byModule = new Map<string, number>()
    const users = new Set<string>()
    let warnings = 0
    for (const l of sample) {
      const d = new Date(l.createdAt)
      if (!Number.isNaN(d.getTime())) byHour[d.getHours()]++
      byModule.set(l.entityLabel || l.entityName, (byModule.get(l.entityLabel || l.entityName) ?? 0) + 1)
      users.add(l.actorUserId || l.actorName)
      if (['Reject', 'Cancel'].includes(l.action)) warnings++
    }
    let topHour = 0
    for (let h = 1; h < 24; h++) if (byHour[h] > byHour[topHour]) topHour = h
    const hasHour = byHour.some((c) => c > 0)
    let topModule = '—'; let topModuleCount = 0
    for (const [m, c] of byModule) if (c > topModuleCount) { topModule = m; topModuleCount = c }
    const modulePct = sample.length ? Math.round((topModuleCount / sample.length) * 100) : 0
    return {
      busiestHour: hasHour ? `${String(topHour).padStart(2, '0')}:00 – ${String((topHour + 1) % 24).padStart(2, '0')}:00` : '—',
      topModule, modulePct,
      uniqueUsers: users.size,
      warnings,
    }
  }, [sample])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  const hasFilters = Boolean(search || actionFilter || entityFilter || userFilter || rangeKey !== 'all')
  const clearFilters = useCallback(() => {
    setSearch(''); setActionFilter(''); setEntityFilter(''); setUserFilter(''); setRangeKey('all'); setPage(1)
  }, [])

  const exportCsv = useCallback(async () => {
    await exportAuditLogsToExcel(
      sample.map((l) => ({
        createdAt: l.createdAt,
        createdAtFormatted: l.createdAtFormatted,
        user: l.actorName,
        role: l.actorRole,
        action: l.actionLabel,
        module: l.entityLabel,
        summary: (l.summary || '').replace(/\s+/g, ' '),
        ip: l.ipAddress,
      })),
      { context: selectedInstitution?.name },
    )
  }, [sample, selectedInstitution?.name])

  const handleDeleteAllLogs = useCallback(async () => {
    if (!tenantId) { setDeleteError('Log silme için kurum seçimi gerekiyor.'); return }
    setDeleting(true); setDeleteError('')
    try {
      await adminApi.deleteAllAuditLogs(tenantId)
      setData({ items: [], total: 0, totalCount: 0, page: 1, pageSize: 0 })
      setExpandedId(null); setDeleteConfirmOpen(false)
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Log kayıtları silinemedi.')
    } finally { setDeleting(false) }
  }, [setData, tenantId])

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => {
    const out: (number | '...')[] = []
    const window = 2
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) out.push(p)
      else if (out[out.length - 1] !== '...') out.push('...')
    }
    return out
  }, [page, totalPages])

  return (
    <>
      <Topbar
        title={isStaffUser ? 'Loglarım' : 'Log Kayıtları'}
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${RANGE_LABELS[rangeKey]}`}
        breadcrumbs={isStaffUser ? ['Personel', 'Operasyon', 'Loglarım'] : ['Admin', 'Genel', 'Loglar', RANGE_LABELS[rangeKey]]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={refresh}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/75 transition-colors hover:bg-[#fff4f8]/40">
              <RefreshCcw className="h-3.5 w-3.5" /> Yenile
            </button>
            {!isStaffUser && (
              <button type="button" onClick={() => { setDeleteError(''); setDeleteConfirmOpen(true) }} disabled={!tenantId || deleting}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-rose-300/35 bg-rose-500/12 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-rose-700 transition-colors hover:bg-rose-500/22 disabled:cursor-not-allowed disabled:opacity-45">
                <Trash2 className="h-3.5 w-3.5" /> Logları Sil
              </button>
            )}
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        {/* SCOPE TABS + CLEAR */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
            {(['today', 'week', 'all'] as RangeKey[]).map((r) => (
              <button key={r} type="button" onClick={() => { setRangeKey(r); setPage(1) }}
                className={`rounded-[9px] px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                  rangeKey === r ? 'bg-[#c85776] text-white shadow-sm' : 'text-[#352432]/55 hover:bg-white'
                }`}>
                {r === 'all' ? 'Tüm geçmiş' : RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button type="button" onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[11px] text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/40">
              <X className="h-3.5 w-3.5" /> Filtreleri Temizle
            </button>
          )}
        </div>

        <ApiStateNotice loading={loading} error={error} />
        {deleteError && (
          <div className="rounded-[12px] border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-[12px] text-rose-700">{deleteError}</div>
        )}

        {/* STAT CARDS + SPARKLINES */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <motion.div key={card.label}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]">
                  <card.icon className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{card.label}</div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <div className="font-display text-3xl tabular-nums tracking-tight">{card.value.toLocaleString('tr-TR')}</div>
                <div className="w-24 shrink-0"><Sparkline values={card.series} stroke={card.stroke} /></div>
              </div>
              {card.badge && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#fff1f6]/70 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide text-[#b14d6c]">
                  ↗ {card.badge}
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* FILTER BAR */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,0.9fr)_auto] lg:items-end">
            <Field label="Arama">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Action veya entity adı"
                  className="w-full rounded-[10px] border border-[#ead8df]/70 bg-white px-9 py-2 text-[12px] text-[#352432] outline-none focus:border-[#c85776]" />
              </div>
            </Field>
            <Field label="Eylem">
              <Select value={actionFilter} onChange={(v) => { setActionFilter(v); setPage(1) }}
                options={[{ value: '', label: 'Tümü' }, ...Object.entries(auditActionLabels).map(([k, label]) => ({ value: k, label }))]} />
            </Field>
            <Field label="Modül">
              <Select value={entityFilter} onChange={(v) => { setEntityFilter(v); setPage(1) }}
                options={[{ value: '', label: 'Tümü' }, ...Object.entries(auditEntityLabels).map(([k, label]) => ({ value: k, label }))]} />
            </Field>
            <Field label="Kullanıcı">
              <Select value={userFilter} onChange={(v) => { setUserFilter(v); setPage(1) }} disabled={isStaffUser}
                options={[{ value: '', label: 'Tümü' }, ...userOptions.map((u) => ({ value: u.id, label: u.name }))]} />
            </Field>
            <Field label="Tarih Aralığı">
              <Select value={rangeKey} onChange={(v) => { setRangeKey(v as RangeKey); setPage(1) }}
                options={(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
            </Field>
            <button type="button" onClick={exportCsv}
              className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-[#c85776]/40 bg-[#fff1f6] px-3 text-[11px] font-medium text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]">
              <Download className="h-3.5 w-3.5" /> Dışa aktar (Excel)
            </button>
          </div>
        </div>

        {/* ACTIVITY TABLE */}
        <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
          <div className="flex items-center justify-between gap-3 border-b border-[#ead8df]/70 px-5 py-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">{RANGE_LABELS[rangeKey]} · Aktivite Akışı</div>
              <div className="mt-0.5 font-display text-2xl tracking-tight">
                <span className="armonessa-text-gradient">{total.toLocaleString('tr-TR')}</span> kayıt
              </div>
            </div>
          </div>

          {/* Column headers */}
          <div className="hidden grid-cols-[1fr_180px_120px_130px_140px_80px] gap-3 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
            <span>İşlem</span><span>Kullanıcı</span><span>Eylem</span><span>Modül</span><span>Tarih</span><span className="text-right">Detay</span>
          </div>

          <div className="divide-y divide-[#f1e5ea]">
            {logs.map((log) => {
              const Icon = actionIcon[log.action] || Activity
              const tone = actionTone[log.action] || 'border-[#ead8df]/70 bg-[#fff4f8]/40 text-[#352432]/70'
              const isExpanded = expandedId === log.id
              const photo = log.actorUserId ? photoByUserId.get(log.actorUserId) : undefined
              return (
                <div key={log.id} className="px-5 py-3 transition-colors hover:bg-[#fffafc]">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_120px_130px_140px_80px] lg:items-center">
                    {/* İşlem */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border ${tone}`}>
                        <Icon className="h-4 w-4" strokeWidth={1.6} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] text-[#352432]">{log.summary || `${log.actionLabel} · ${log.entityLabel}`}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[9px] font-mono uppercase tracking-wide text-[#352432]/40">
                          <span className="truncate">{log.actorName?.toLowerCase()}</span>
                          {log.actorRole && <span className="text-[#c85776]/55">· {log.actorRole}</span>}
                          <span className="text-[#352432]/30">· ⊕ #{shortRef(log.id)}</span>
                        </div>
                      </div>
                    </div>
                    {/* Kullanıcı */}
                    <div className="flex items-center gap-2">
                      {photo ? (
                        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[#efbfd0]/60">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo} alt={log.actorName} className="h-full w-full object-cover" />
                        </span>
                      ) : (
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(log.actorName)} text-[10px] font-display text-[#3a1a2a]`}>
                          {initials(log.actorName)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-[#352432]">{log.actorName}</div>
                        <div className="truncate text-[9px] font-mono uppercase tracking-wide text-[#352432]/40">{log.actorRole || '—'}</div>
                      </div>
                    </div>
                    {/* Eylem */}
                    <div>
                      <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${tone}`}>{log.actionLabel}</span>
                    </div>
                    {/* Modül */}
                    <div>
                      <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${moduleTone}`}>{log.entityLabel}</span>
                    </div>
                    {/* Tarih */}
                    <div className="text-[10.5px] font-mono text-[#352432]/50">{log.createdAtFormatted}</div>
                    {/* Detay */}
                    <div className="flex lg:justify-end">
                      <button type="button" disabled={!log.data}
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#ead8df]/70 bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/70 transition-colors hover:bg-[#fff4f8]/50 disabled:opacity-35">
                        {isExpanded ? 'Gizle' : 'Detay'}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && log.data && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                        <div className="mt-3 grid gap-1.5 border-t border-[#ead8df]/60 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(log.data).slice(0, 12).map(([k, v]) => (
                            <div key={k} className="rounded-[8px] border border-[#ead8df]/60 bg-[#fffafc] px-2.5 py-1.5">
                              <div className="font-mono text-[9px] uppercase tracking-widest text-[#c85776]/55">{k}</div>
                              <div className="mt-0.5 truncate text-[11px] text-[#352432]/85">
                                {v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}

            {!logs.length && !loading && (
              <div className="px-5 py-14 text-center">
                <ClipboardList className="mx-auto h-10 w-10 text-[#c85776]/45" strokeWidth={1.3} />
                <div className="mt-3 text-sm text-[#352432]/65">
                  {hasFilters ? 'Filtreyle eşleşen log bulunamadı.' : 'Bu zaman aralığında henüz işlem yapılmamış.'}
                </div>
              </div>
            )}
          </div>

          {/* PAGINATION */}
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 px-5 py-3.5">
              <div className="text-[11px] text-[#352432]/50">
                {rangeStart} – {rangeEnd} / {total.toLocaleString('tr-TR')} kayıt gösteriliyor
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1}
                  className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/50 disabled:opacity-35">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageNumbers.map((p, i) =>
                  p === '...' ? (
                    <span key={`e-${i}`} className="px-1 text-[12px] text-[#352432]/35">…</span>
                  ) : (
                    <button key={p} type="button" onClick={() => goPage(p)}
                      className={`grid h-8 min-w-8 place-items-center rounded-[9px] border px-2 text-[12px] tabular-nums transition-colors ${
                        p === page ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fff4f8]/50'
                      }`}>
                      {p}
                    </button>
                  ),
                )}
                <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages}
                  className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/50 disabled:opacity-35">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                  className="ml-2 rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[11px] text-[#352432]/65 outline-none focus:border-[#c85776]">
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* LOG ÖZETİ */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="font-display text-xl tracking-tight">Log Özeti</div>
          <div className="text-[11px] text-[#352432]/45">Seçili filtreye göre özet bilgiler</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile icon={Clock} tone="text-[#c85776] bg-[#fff1f6]" label="En Yoğun Saat" value={summary.busiestHour} sub="Akşam aralığı" />
            <SummaryTile icon={Star} tone="text-violet-600 bg-violet-50" label="En Aktif Modül" value={summary.topModule} sub={`Toplam işlem oranı %${summary.modulePct}`} />
            <SummaryTile icon={Users} tone="text-emerald-600 bg-emerald-50" label="Benzersiz Kullanıcı" value={String(summary.uniqueUsers)} sub="Bu filtredeki kullanıcı sayısı" />
            <SummaryTile icon={AlertTriangle} tone="text-amber-600 bg-amber-50" label="Hata / Uyarı" value={String(summary.warnings)} sub="Hata & uyarı sayısı" />
          </div>
        </div>
      </div>

      {/* DELETE CONFIRM */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-white/80 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }} transition={{ duration: 0.22 }}
              className="w-full max-w-lg rounded-[18px] border border-rose-300/30 bg-white p-5 shadow-2xl shadow-black/20">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-rose-300/35 bg-rose-500/15 text-rose-700">
                  <AlertCircle className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <div>
                  <div className="font-display text-xl text-[#352432]">Tüm log kayıtları silinsin mi?</div>
                  <p className="mt-2 text-sm leading-6 text-[#352432]/65">
                    Bu işlem seçili kurumun tüm log geçmişini kalıcı olarak temizler. Arama/filtreler dikkate alınmaz.
                  </p>
                  <div className="mt-3 rounded-[10px] border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">
                    Silinecek kurum: {selectedInstitution?.name || 'Seçili kurum'} · Toplam kayıt: {total.toLocaleString('tr-TR')}
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}
                  className="rounded-[10px] border border-[#ead8df]/70 bg-white px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/70 transition-colors hover:bg-[#fff4f8]/40 disabled:opacity-50">
                  Vazgeç
                </button>
                <button type="button" onClick={handleDeleteAllLogs} disabled={deleting}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-rose-300/40 bg-rose-600 px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-white transition-colors hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60">
                  {deleting ? <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Evet, tümünü sil
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-2 text-[12px] text-[#352432] outline-none focus:border-[#c85776] disabled:opacity-50">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SummaryTile({ icon: Icon, tone, label, value, sub }: { icon: LucideIcon; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div>
        <div className="truncate font-display text-lg tracking-tight text-[#352432]">{value}</div>
        <div className="truncate text-[10px] text-[#352432]/45">{sub}</div>
      </div>
    </div>
  )
}

export default function LoglarPage() {
  return (
    <Suspense fallback={null}>
      <LoglarPageInner />
    </Suspense>
  )
}
