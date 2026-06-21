'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ManagerAppointmentInbox from '@/components/dashboard/ManagerAppointmentInbox'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizePendingOperation, normalizeStaff } from '@/lib/apiMappers'
import { exportApprovalsToExcel } from '@/lib/excel'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, CreditCard, Download,
  FileText, Hourglass, MoreVertical, Package, RefreshCcw, Sparkles, TrendingDown,
  TrendingUp, User, Users, Wallet, XCircle,
} from 'lucide-react'
import type { ApiPendingOperation, ApiStaff, PagedResult, PendingOperation, PendingOperationStatusKey } from '@/lib/types'

type TabKey = 'all' | 'pending' | 'approved' | 'rejected'
const TABS: { key: TabKey; label: string; status?: PendingOperationStatusKey }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'pending', label: 'Bekleyenler', status: 'Pending' },
  { key: 'approved', label: 'Onaylanmış', status: 'Approved' }, { key: 'rejected', label: 'Reddedilmiş', status: 'Rejected' },
]

const statusBadge: Record<PendingOperationStatusKey, string> = {
  Pending: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Approved: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Rejected: 'border-rose-300/40 bg-rose-50 text-rose-700',
  Cancelled: 'border-[#ead8df]/70 bg-[#fff4f8]/40 text-[#352432]/55',
}
const statusLabel: Record<PendingOperationStatusKey, string> = { Pending: 'Bekliyor', Approved: 'Onaylandı', Rejected: 'Reddedildi', Cancelled: 'İptal' }

function opIcon(type: string) {
  if (type.includes('Customer')) return User
  if (type.includes('Appointment')) return Calendar
  if (type.includes('Expense')) return Wallet
  if (type.includes('Account') || type.includes('Payment')) return CreditCard
  if (type.includes('Stock') || type.includes('Product')) return Package
  return FileText
}

const AVATAR_COLORS = ['from-[#f3a3bf] to-[#ffd9e6]', 'from-[#9c70bb] to-[#e3cdf2]', 'from-[#5aa9e6] to-[#cfe7fb]', 'from-[#54c1a0] to-[#cdeee2]', 'from-[#e6a14f] to-[#fbe6cb]', 'from-[#e0617f] to-[#fbd2dc]']
function avatarColor(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }
function initials(name: string): string { const p = (name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase() }

function fmtDur(ms: number): string {
  if (ms <= 0 || Number.isNaN(ms)) return '—'
  const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}s ${m}dk` : `${m}dk`
}
function dayKey(t: number): string { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function looksPhone(s: string): boolean { return /\d{6,}/.test((s || '').replace(/\s/g, '')) }

function extractCustomer(op: PendingOperation): { name: string; phone: string } {
  const p = (op.payload || {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  let name = str(p.fullName) || str(p.customerName) || str(p.name)
  if (!name && op.title.includes(':')) name = op.title.split(':').slice(1).join(':').trim()
  const phone = str(p.phone) || str(p.customerPhone) || (looksPhone(op.summary) ? op.summary : '')
  return { name: name || '—', phone }
}

// HttpReplay (personel işlemi) payload'ını teknik yerine okunur Türkçe gösterir.
const STATUS_TR: Record<string, string> = {
  Completed: 'Tamamlandı', Cancelled: 'İptal', Canceled: 'İptal', Confirmed: 'Onaylandı',
  Scheduled: 'Planlandı', NoShow: 'Gelmedi', Draft: 'Taslak',
}
const FIELD_TR: Record<string, string> = {
  status: 'Yeni durum', reason: 'Gerekçe', notes: 'Not', note: 'Not', fullName: 'Ad Soyad',
  name: 'Ad', phone: 'Telefon', email: 'E-posta', title: 'Unvan', specialties: 'Uzmanlık',
  amount: 'Tutar', price: 'Fiyat', isActive: 'Aktif', branchId: 'Şube',
}
function isReplayOp(op: PendingOperation): boolean {
  const p = op.payload as Record<string, unknown> | undefined
  return Boolean(p && typeof p.path === 'string' && typeof p.method === 'string')
}
function replayBodyFields(op: PendingOperation): [string, string][] {
  const p = (op.payload || {}) as Record<string, unknown>
  let body: Record<string, unknown> = {}
  try {
    body = typeof p.body === 'string' ? (p.body ? JSON.parse(p.body) : {}) : ((p.body as Record<string, unknown>) || {})
  } catch { body = {} }
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === undefined || v === '') continue
    let val = typeof v === 'boolean' ? (v ? 'Evet' : 'Hayır') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (k === 'status') val = STATUS_TR[val] || val
    out.push([FIELD_TR[k] || k, val])
  }
  return out
}

function bucketDaily(times: number[], n: number): number[] {
  const now = Date.now(); const day = 86_400_000; const start = now - n * day
  const b = Array(n).fill(0)
  for (const t of times) { if (t < start || t > now) continue; b[Math.min(n - 1, Math.floor((t - start) / day))]++ }
  return b
}
function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const max = Math.max(1, ...values); const n = values.length
  const pts = values.map((v, i) => `${(i / Math.max(n - 1, 1)) * 100},${28 - (v / max) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-9 w-full overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={100} cy={28 - ((values[n - 1] ?? 0) / max) * 24} r="1.8" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function OnaylarPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as TabKey | null
  const [tab, setTab] = useState<TabKey>(scopeParam && TABS.some((t) => t.key === scopeParam) ? scopeParam : 'pending')
  const { selectedInstitutionId, selectedBranch, selectedInstitution, branches } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const { data, loading, error } = useApiQuery<{ ops: ApiPendingOperation[]; staff: ApiStaff[] }>(
    async () => {
      if (!tenantId) return { ops: [], staff: [] }
      const [ops, staff] = await Promise.all([
        adminApi.pendingOperations<ApiPendingOperation>({ tenantId, page: 1, pageSize: 500 }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
      ])
      return { ops: apiItems(ops), staff: apiItems(staff) }
    },
    [tenantId, refreshKey],
    { initialData: { ops: [], staff: [] } },
  )

  const all: PendingOperation[] = useMemo(() => (data?.ops || []).map((op, i) => normalizePendingOperation(op, i)), [data])
  const photoByUserId = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of (data?.staff || []).map((x, i) => normalizeStaff(x, i))) if (s.tenantUserId && s.photoUrl) m.set(s.tenantUserId, s.photoUrl)
    return m
  }, [data])
  const branchName = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of branches || []) { const id = b.id || b.branchId; if (id) m.set(id, b.name || b.branchName || 'Şube') }
    return m
  }, [branches])

  const filtered = useMemo(() => {
    const st = TABS.find((t) => t.key === tab)?.status
    return st ? all.filter((o) => o.status === st) : all
  }, [all, tab])
  useEffect(() => { setPage(1) }, [tab, pageSize])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  const tMs = (s: string | null) => { if (!s) return NaN; const t = new Date(s).getTime(); return Number.isNaN(t) ? NaN : t }
  const todayKey = dayKey(Date.now()); const yKey = dayKey(Date.now() - 86_400_000)

  const stats = useMemo(() => {
    const mk = (list: PendingOperation[], dateOf: (o: PendingOperation) => number) => {
      const times = list.map(dateOf).filter((t) => !Number.isNaN(t))
      const today = times.filter((t) => dayKey(t) === todayKey).length
      const yest = times.filter((t) => dayKey(t) === yKey).length
      return { value: list.length, yest, delta: yest > 0 ? Math.round(((today - yest) / yest) * 100) : null, series: bucketDaily(times, 14) }
    }
    const pending = all.filter((o) => o.status === 'Pending')
    const approved = all.filter((o) => o.status === 'Approved')
    const rejected = all.filter((o) => o.status === 'Rejected')
    return {
      pending: mk(pending, (o) => tMs(o.requestedAt)),
      approved: mk(approved, (o) => tMs(o.decidedAt)),
      rejected: mk(rejected, (o) => tMs(o.decidedAt)),
      total: mk(all, (o) => tMs(o.requestedAt)),
    }
  }, [all, todayKey, yKey])

  const summary = useMemo(() => {
    const decided = all.filter((o) => o.status === 'Approved' || o.status === 'Rejected')
    const waits = decided.map((o) => tMs(o.decidedAt) - tMs(o.requestedAt)).filter((x) => !Number.isNaN(x) && x >= 0)
    const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0
    const yWaits = decided.filter((o) => dayKey(tMs(o.decidedAt)) === yKey).map((o) => tMs(o.decidedAt) - tMs(o.requestedAt)).filter((x) => !Number.isNaN(x) && x >= 0)
    const yAvg = yWaits.length ? yWaits.reduce((a, b) => a + b, 0) / yWaits.length : 0
    const pendingOps = all.filter((o) => o.status === 'Pending')
    let longest = 0; let longestOp: PendingOperation | null = null
    for (const o of pendingOps) { const w = Date.now() - tMs(o.requestedAt); if (!Number.isNaN(w) && w > longest) { longest = w; longestOp = o } }
    const todayApproved = all.filter((o) => o.status === 'Approved' && dayKey(tMs(o.decidedAt)) === todayKey).length
    const todayRejected = all.filter((o) => o.status === 'Rejected' && dayKey(tMs(o.decidedAt)) === todayKey).length
    const todayDecided = todayApproved + todayRejected
    return {
      avgWait, yAvg, longest, longestLabel: longestOp?.operationTypeLabel || '—',
      todayApproved, todayRejected,
      successRate: todayDecided ? Math.round((todayApproved / todayDecided) * 100) : 0,
      rejectRate: todayDecided ? Math.round((todayRejected / todayDecided) * 100) : 0,
    }
  }, [all, todayKey, yKey])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  const handleApprove = useCallback(async (op: PendingOperation) => {
    setBusyId(op.id); setActionError(null)
    try { await adminApi.approvePendingOperation(op.id, tenantId); refresh() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Onaylama başarısız.') } finally { setBusyId(null) }
  }, [tenantId, refresh])
  const handleReject = useCallback(async (op: PendingOperation) => {
    setBusyId(op.id); setActionError(null)
    try { await adminApi.rejectPendingOperation(op.id, reasonDrafts[op.id]?.trim() || null, tenantId); refresh() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Reddetme başarısız.') } finally { setBusyId(null) }
  }, [tenantId, refresh, reasonDrafts])

  const exportCsv = useCallback(async () => {
    await exportApprovalsToExcel(
      filtered.map((o) => {
        const c = extractCustomer(o)
        return {
          type: o.operationTypeLabel,
          customer: c.name,
          phone: c.phone,
          staff: o.requestedByName,
          branch: (o.branchId && branchName.get(o.branchId)) || '—',
          createdAt: o.requestedAtFormatted,
          status: o.status,
          statusLabel: statusLabel[o.status],
        }
      }),
      { context: selectedInstitution?.name },
    )
  }, [filtered, branchName, selectedInstitution?.name])

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => {
    const out: (number | '...')[] = []
    for (let p = 1; p <= totalPages; p++) { if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) out.push(p); else if (out[out.length - 1] !== '...') out.push('...') }
    return out
  }, [page, totalPages])

  const statCards = [
    { label: 'Bekleyen', s: stats.pending, icon: Clock, stroke: '#e0617f', iconBg: 'bg-[#fff1f6] text-[#c85776]' },
    { label: 'Onaylanan', s: stats.approved, icon: CheckCircle2, stroke: '#3cae8d', iconBg: 'bg-emerald-50 text-emerald-600' },
    { label: 'Reddedilen', s: stats.rejected, icon: XCircle, stroke: '#e0617f', iconBg: 'bg-rose-50 text-rose-600' },
    { label: 'Toplam', s: stats.total, icon: Users, stroke: '#9c70bb', iconBg: 'bg-violet-50 text-violet-600' },
  ]

  return (
    <>
      <Topbar
        title="Onay Bekleyenler"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${TABS.find((t) => t.key === tab)?.label}`}
        breadcrumbs={['Admin', 'Yönetim', 'Onay Bekleyenler']}
        actions={
          <button type="button" onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/75 transition-colors hover:bg-[#fff4f8]/40">
            <RefreshCcw className="h-3.5 w-3.5" /> Yenile
          </button>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        {/* Personelin onaya gönderdiği taslak randevular + saati gelmiş randevular */}
        <ManagerAppointmentInbox enabled={Boolean(tenantId)} tenantId={tenantId} />

        {/* TABS */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`rounded-[9px] px-3.5 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#c85776] text-white shadow-sm' : 'text-[#352432]/55 hover:bg-white'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {tab !== 'pending' && (
            <button type="button" onClick={() => setTab('pending')}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[11px] text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/40">
              <Sparkles className="h-3.5 w-3.5" /> Filtreleri Temizle
            </button>
          )}
        </div>

        <ApiStateNotice loading={loading} error={error} />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700"><AlertCircle className="mr-2 inline h-3.5 w-3.5" />{actionError}</div>}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <div className="flex items-center justify-between">
                <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${card.iconBg}`}><card.icon className="h-4 w-4" /></span>
                {card.s.delta !== null && (
                  <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${card.s.delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                    {card.s.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}%{Math.abs(card.s.delta)}
                  </span>
                )}
              </div>
              <div className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{card.label}</div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <div className="font-display text-3xl tabular-nums tracking-tight">{card.s.value.toLocaleString('tr-TR')}</div>
                <div className="w-24 shrink-0"><Sparkline values={card.s.series} stroke={card.stroke} /></div>
              </div>
              <div className="mt-1 text-[10px] text-[#352432]/40">Dün: {card.s.yest}</div>
            </div>
          ))}
        </div>

        {/* TABLE */}
        <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ead8df]/70 px-5 py-4">
            <div>
              <div className="font-display text-xl tracking-tight">{TABS.find((t) => t.key === tab)?.label === 'Bekleyenler' ? 'Onay Bekleyen Talepler' : 'Onay Talepleri'} <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[12px] text-[#b14d6c]">{filtered.length}</span></div>
              <div className="text-[11px] text-[#352432]/45">Onay taleplerini görüntüleyin ve işlem yapın.</div>
            </div>
            <button type="button" onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[11px] text-[#352432]/70 transition-colors hover:bg-[#fff4f8]/40">
              <Download className="h-3.5 w-3.5" /> Tabloyu dışa aktar
            </button>
          </div>

          <div className="hidden grid-cols-[1.3fr_1.4fr_1.2fr_0.9fr_1fr_0.8fr_1.3fr] gap-3 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
            <span>Talep Türü</span><span>Müşteri / Danışan</span><span>Personel</span><span>Şube</span><span>Oluşturulma</span><span>Durum</span><span className="text-right">İşlemler</span>
          </div>

          <div className="divide-y divide-[#f1e5ea]">
            {pageRows.map((op) => {
              const Icon = opIcon(op.operationType)
              const cust = extractCustomer(op)
              const photo = op.requestedByUserId ? photoByUserId.get(op.requestedByUserId) : undefined
              const isExpanded = expandedId === op.id
              const isPending = op.status === 'Pending'
              const isBusy = busyId === op.id
              return (
                <div key={op.id} className="px-5 py-3 transition-colors hover:bg-[#fffafc]">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1.4fr_1.2fr_0.9fr_1fr_0.8fr_1.3fr] lg:items-center">
                    {/* Talep Türü */}
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]"><Icon className="h-4 w-4" strokeWidth={1.6} /></span>
                      <div className="min-w-0"><div className="truncate text-[12.5px] font-medium text-[#352432]">{op.operationTypeLabel}</div></div>
                    </div>
                    {/* Müşteri */}
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(cust.name)} text-[10px] font-display text-[#3a1a2a]`}>{initials(cust.name)}</span>
                      <div className="min-w-0"><div className="truncate text-[12px] text-[#352432]">{cust.name}</div><div className="truncate text-[10px] font-mono text-[#352432]/40">{cust.phone || '—'}</div></div>
                    </div>
                    {/* Personel */}
                    <div className="flex min-w-0 items-center gap-2.5">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt={op.requestedByName} className="h-8 w-8 shrink-0 rounded-full border border-[#efbfd0]/50 object-cover" />
                      ) : (
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(op.requestedByName)} text-[10px] font-display text-[#3a1a2a]`}>{initials(op.requestedByName)}</span>
                      )}
                      <div className="min-w-0 truncate text-[12px] text-[#352432]">{op.requestedByName}</div>
                    </div>
                    {/* Şube */}
                    <div className="text-[11px] text-[#352432]/60">
                      <div className="truncate">{(op.branchId && branchName.get(op.branchId)) || 'Merkez'}</div>
                      <div className="truncate text-[10px] text-[#352432]/40">{selectedInstitution?.name || ''}</div>
                    </div>
                    {/* Oluşturulma */}
                    <div className="text-[11px] text-[#352432]/55">
                      {(() => { const parts = op.requestedAtFormatted.split(/[ ]+/); return (<><div>{parts.slice(0, 3).join(' ') || op.requestedAtFormatted}</div><div className="font-mono text-[10px] text-[#352432]/40">{parts.slice(3).join(' ')}</div></>) })()}
                    </div>
                    {/* Durum */}
                    <div><span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${statusBadge[op.status]}`}>{statusLabel[op.status]}</span></div>
                    {/* İşlemler */}
                    <div className="flex items-center justify-end gap-1.5">
                      {isPending ? (
                        <>
                          <button type="button" disabled={isBusy} onClick={() => handleApprove(op)}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300/40 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Onayla
                          </button>
                          <button type="button" disabled={isBusy} onClick={() => setExpandedId(isExpanded ? null : op.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-300/40 bg-rose-50 px-2.5 py-1.5 text-[10px] font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50">
                            <XCircle className="h-3.5 w-3.5" /> Reddet
                          </button>
                        </>
                      ) : op.rejectionReason ? <span className="truncate text-[10px] text-rose-600/70" title={op.rejectionReason}>{op.rejectionReason}</span> : <span className="text-[10px] text-[#352432]/35">karara bağlandı</span>}
                      <button type="button" onClick={() => setExpandedId(isExpanded ? null : op.id)}
                        className="grid h-7 w-7 place-items-center rounded-md border border-[#ead8df]/70 bg-white text-[#352432]/45 transition-colors hover:bg-[#fff4f8]/50"><MoreVertical className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                        <div className="mt-3 space-y-3 border-t border-[#ead8df]/60 pt-3">
                          {isReplayOp(op) ? (
                            <>
                              <div className="flex items-start gap-2 text-[12.5px] text-[#352432]/75">
                                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c85776]/70" />
                                <span><span className="font-medium text-[#352432]">{op.operationTypeLabel}</span> — onaylanınca uygulanacak: {op.title}</span>
                              </div>
                              {replayBodyFields(op).length > 0 && (
                                <div className="grid gap-1.5 sm:grid-cols-2">
                                  {replayBodyFields(op).map(([label, val]) => (
                                    <div key={label} className="rounded-[8px] border border-[#ead8df]/60 bg-[#fffafc] px-2.5 py-1.5">
                                      <div className="text-[10px] tracking-wide text-[#c85776]/70">{label}</div>
                                      <div className="mt-0.5 truncate text-[12px] text-[#352432]/85">{val}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="text-[12px] text-[#352432]/70">{op.title}{op.summary ? ` · ${op.summary}` : ''}</div>
                              {op.payload && (
                                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                  {Object.entries(op.payload).slice(0, 9).map(([k, v]) => (
                                    <div key={k} className="rounded-[8px] border border-[#ead8df]/60 bg-[#fffafc] px-2.5 py-1.5">
                                      <div className="text-[10px] tracking-wide text-[#c85776]/70">{FIELD_TR[k] || k}</div>
                                      <div className="mt-0.5 truncate text-[12px] text-[#352432]/85">{v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          {isPending && (
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="flex-1 min-w-[200px]">
                                <label className="block text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">Red gerekçesi (opsiyonel)</label>
                                <input value={reasonDrafts[op.id] || ''} onChange={(e) => setReasonDrafts((p) => ({ ...p, [op.id]: e.target.value }))} placeholder="Personele iletilecek kısa açıklama"
                                  className="mt-1.5 w-full rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[12px] text-[#352432] outline-none focus:border-[#c85776]" />
                              </div>
                              <button type="button" disabled={isBusy} onClick={() => handleReject(op)}
                                className="rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50">Reddet</button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
            {!pageRows.length && !loading && (
              <div className="px-5 py-14 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-300/60" strokeWidth={1.4} />
                <div className="mt-3 text-sm text-[#352432]/65">{tab === 'pending' ? 'Bekleyen onay yok. Tüm personel işlemleri karara bağlanmış.' : `${TABS.find((t) => t.key === tab)?.label} kapsamında kayıt yok.`}</div>
              </div>
            )}
          </div>

          {/* PAGINATION */}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ead8df]/70 px-5 py-3.5">
              <div className="text-[11px] text-[#352432]/50">{(page - 1) * pageSize + 1} – {Math.min(page * pageSize, filtered.length)} / {filtered.length} kayıt gösteriliyor</div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
                {pageNumbers.map((p, i) => p === '...' ? <span key={`e${i}`} className="px-1 text-[12px] text-[#352432]/35">…</span> : (
                  <button key={p} type="button" onClick={() => goPage(p)} className={`grid h-8 min-w-8 place-items-center rounded-[9px] border px-2 text-[12px] tabular-nums transition-colors ${p === page ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#352432]/65 hover:bg-[#fff4f8]/50'}`}>{p}</button>
                ))}
                <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] bg-white text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/50 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="ml-2 rounded-[9px] border border-[#ead8df] bg-white px-2 py-1.5 text-[11px] text-[#352432]/65 outline-none focus:border-[#c85776]">
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ONAY ÖZETİ */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="font-display text-xl tracking-tight">Onay Özeti</div>
          <div className="text-[11px] text-[#352432]/45">Seçili filtreye göre özet bilgiler</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile icon={Clock} tone="text-[#c85776] bg-[#fff1f6]" label="Ortalama Bekleme Süresi" value={fmtDur(summary.avgWait)} sub={`Dün: ${fmtDur(summary.yAvg)}`} />
            <SummaryTile icon={Hourglass} tone="text-amber-600 bg-amber-50" label="En Uzun Bekleyen Talep" value={fmtDur(summary.longest)} sub={summary.longestLabel} />
            <SummaryTile icon={CheckCircle2} tone="text-emerald-600 bg-emerald-50" label="Bugün Onaylanan" value={String(summary.todayApproved)} sub={`%${summary.successRate} başarı oranı`} />
            <SummaryTile icon={XCircle} tone="text-rose-600 bg-rose-50" label="Bugün Reddedilen" value={String(summary.todayRejected)} sub={`%${summary.rejectRate} ret oranı`} />
          </div>
        </div>
      </div>
    </>
  )
}

function SummaryTile({ icon: Icon, tone, label, value, sub }: { icon: typeof Clock; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div>
        <div className="truncate font-display text-lg tracking-tight text-[#352432]">{value}</div>
        <div className="truncate text-[10px] text-[#352432]/45">{sub}</div>
      </div>
    </div>
  )
}

export default function OnaylarPage() {
  return (
    <Suspense fallback={null}>
      <OnaylarPageInner />
    </Suspense>
  )
}
