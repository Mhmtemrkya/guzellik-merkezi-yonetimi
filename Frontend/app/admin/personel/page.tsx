'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
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
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, initialsFromName, normalizeAppointment, normalizeStaff } from '@/lib/apiMappers'
import { downscaleImage } from '@/lib/imageUtils'
import { motion } from 'framer-motion'
import {
  ArrowLeftRight, Boxes, Calendar, CalendarClock, CreditCard, FileBarChart, ImagePlus, KeyRound, Layers3, Search, ShieldCheck, Star,
  MonitorSmartphone, UserCheck, UserCog, UserPlus, UserX, Users, Wallet, Zap, type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ApiAppointment, ApiStaff, ApiStaffCredentials, ApiTenantCredentials, PagedResult, Staff } from '@/lib/types'

type ScopeKey = 'all' | 'active' | 'inactive' | 'permissions'
const SCOPE_LABEL: Record<ScopeKey, string> = { all: 'Tüm Personel', active: 'Aktif Kadro', inactive: 'Pasif / İzinli', permissions: 'Yetki Seti' }

const PERM_META: Record<string, { label: string; icon: LucideIcon }> = {
  Appointments: { label: 'Randevular', icon: Calendar },
  Customers: { label: 'Müşteriler', icon: Users },
  Packages: { label: 'Paketler', icon: Layers3 },
  Services: { label: 'Hizmetler', icon: Zap },
  Stock: { label: 'Stok', icon: Boxes },
  Reports: { label: 'Raporlar', icon: FileBarChart },
  Finance: { label: 'Finans', icon: Wallet },
  Cash: { label: 'Kasa', icon: CreditCard },
  Accounts: { label: 'Ön Muhasebe', icon: CreditCard },
  Notifications: { label: 'Bildirimler', icon: Star },
  Expenses: { label: 'Giderler', icon: Wallet },
  Logs: { label: 'Loglar', icon: FileBarChart },
}
const permMeta = (key: string) => PERM_META[key] || { label: key, icon: ShieldCheck }

function MiniBars({ values, tone = '#e0617f' }: { values: number[]; tone?: string }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <span key={i} className="w-[5px] rounded-t-sm" style={{ height: `${Math.max(10, (v / max) * 100)}%`, backgroundColor: tone, opacity: 0.35 + (i / values.length) * 0.65 }} />
      ))}
    </div>
  )
}

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function PersonelPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in SCOPE_LABEL ? scopeParam : 'all'

  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedPerm, setSelectedPerm] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [resetCredentials, setResetCredentials] = useState<ApiTenantCredentials | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
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

  const { data, loading, error, reload } = useApiQuery<{ staff: PagedResult<ApiStaff>; appts: ApiAppointment[] }>(
    async () => {
      const [staff, appts] = await Promise.all([
        adminApi.staff<ApiStaff>({ tenantId, search: filter || undefined, page: 1, pageSize: 100 }),
        adminApi.appointments<ApiAppointment>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
      ])
      return { staff, appts: apiItems(appts) }
    },
    [tenantId, filter],
    { initialData: { staff: { items: [] }, appts: [] } },
  )

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

  // Performans = bu ay tamamlanan iş + başarı oranı [tamamlanan / (tamamlanan + iptal/gelmedi)].
  // Müşteri skoru artık personel kartında p.averageRating (gerçek yıldız ortalaması) ile gösterilir.
  const scoreOf = (id: string) => {
    const s = staffStats.get(id)
    if (!s) return { successRate: 0, monthCompleted: 0, monthTotal: 0, resolved: 0 }
    const resolved = s.monthCompleted + s.monthCancelled
    const successRate = resolved > 0 ? Math.round((s.monthCompleted / resolved) * 100) : 0
    return { successRate, monthCompleted: s.monthCompleted, monthTotal: s.month, resolved }
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
    return list
  }, [allStaff, scope, statusFilter])

  const selected = useMemo(() => staff.find((m) => m.id === selectedId) || staff[0], [staff, selectedId])
  useEffect(() => {
    if (!selectedId && staff[0]?.id) setSelectedId(staff[0].id)
    if (selectedId && staff.length && !staff.some((m) => m.id === selectedId)) setSelectedId(staff[0].id)
  }, [staff, selectedId])

  // ---- yetki haritası
  const permGroups = useMemo(() => {
    const m = new Map<string, Staff[]>()
    for (const p of allStaff) for (const key of p.permissions) { const arr = m.get(key) ?? []; arr.push(p); m.set(key, arr) }
    return Array.from(m.entries()).map(([key, holders]) => ({ key, holders })).sort((a, b) => b.holders.length - a.holders.length)
  }, [allStaff])
  const selPerm = useMemo(() => permGroups.find((g) => g.key === selectedPerm) || permGroups[0], [permGroups, selectedPerm])

  const activeCount = allStaff.filter((p) => p.active).length
  const apptSeries = useMemo(() => {
    const times = appts.map((a) => new Date(a.date).getTime()).filter((t) => !Number.isNaN(t))
    const now = Date.now(); const wk = 7 * 86_400_000; const b = Array(10).fill(0)
    for (const t of times) { const idx = Math.floor((now - t) / wk); if (idx >= 0 && idx < 10) b[9 - idx]++ }
    return b
  }, [appts])

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
                <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
                  <UserPlus className="h-3.5 w-3.5" /> Personel Ekle
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
              onImport={async (result) => {
                const first = result[0]; if (!first) return
                for (const row of first.rows) {
                  const fullName = String(row['Ad Soyad'] || '').trim(); if (!fullName) continue
                  await adminApi.createStaff({ branchId: branchId || branchOptions[0]?.id, fullName, title: String(row['Unvan'] || 'Personel'), phone: String(row['Telefon'] || '') || null, specialties: String(row['Uzmanlık'] || '') || null, commissionRate: Number(row['Komisyon %'] || 0) || null, isActive: true, email: String(row['E-posta'] || '') || null, permissions: [] }, tenantId)
                }
                await reload()
              }}
            />
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && allStaff.length === 0} emptyMessage="Personel kaydı yok." />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Toplam personel', value: allStaff.length, icon: Users, tone: '#d7839d' },
            { label: 'Aktif', value: activeCount, icon: UserCheck, tone: '#3cae8d' },
            { label: 'Pasif', value: allStaff.length - activeCount, icon: UserX, tone: '#9c70bb' },
            { label: 'Yetki seti', value: permGroups.length, icon: ShieldCheck, tone: '#e0617f' },
          ].map((c) => (
            <div key={c.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><c.icon className="h-4 w-4" /></span>
                <MiniBars values={apptSeries} tone={c.tone} />
              </div>
              <div className="mt-2 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{c.label}</div>
              <div className="font-display text-3xl tabular-nums tracking-tight">{c.value}</div>
            </div>
          ))}
        </div>

        <CommissionPanel tenantId={tenantId} />

        {scope === 'permissions' ? (
          /* ================= YETKİ SETİ (mockup 12) ================= */
          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
              <div className="mb-1 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Yetki Haritası</div>
              <div className="font-display text-2xl tracking-tight">{permGroups.length} yetki anahtarı · {permGroups.length} grup</div>
              <div className="mt-4 space-y-2.5">
                {permGroups.map((g) => {
                  const meta = permMeta(g.key)
                  return (
                    <button key={g.key} type="button" onClick={() => setSelectedPerm(g.key)}
                      className={`flex w-full items-center gap-3 rounded-[16px] border p-3.5 text-left transition-colors ${selPerm?.key === g.key ? 'border-[#c85776]/60 bg-[#fff1f6]/50' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}>
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><meta.icon className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="text-[14px] font-medium text-[#352432]">{meta.label}</span><span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[9px] text-[#b14d6c]">1 anahtar</span></div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-[#352432]/40">Atanan personel</span>
                          <div className="flex -space-x-1.5">
                            {g.holders.slice(0, 4).map((h) => h.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={h.id} src={h.photoUrl} alt={h.name} className="h-5 w-5 rounded-full border border-white object-cover" />
                            ) : (
                              <span key={h.id} className="grid h-5 w-5 place-items-center rounded-full border border-white bg-[#f3a3bf] text-[7px] font-display text-[#3a1a2a]">{initialsFromName(h.name)}</span>
                            ))}
                          </div>
                          <span className="truncate text-[10px] text-[#352432]/55">{g.holders.map((h) => h.name).join(', ')}</span>
                        </div>
                      </div>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-white font-display text-[15px] text-[#c85776]">{g.holders.length}</span>
                    </button>
                  )
                })}
                {permGroups.length === 0 && <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#352432]/45">Henüz yetki ataması yok. Personel düzenleyerek yetki verin.</div>}
              </div>
            </div>

            {/* Seçili Yetki Detayı */}
            <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
              {selPerm ? (() => {
                const meta = permMeta(selPerm.key)
                const coverage = activeCount ? Math.round((selPerm.holders.filter((h) => h.active).length / activeCount) * 100) : 0
                return (
                  <>
                    <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80"><ShieldCheck className="h-4 w-4" /> Seçili Yetki Detayı</div>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#fff1f6] text-[#c85776]"><meta.icon className="h-6 w-6" /></span>
                      <div><div className="flex items-center gap-2"><span className="font-display text-xl tracking-tight">{meta.label}</span><span className="rounded-full bg-[#fff1f6] px-2 py-0.5 text-[9px] text-[#b14d6c]">1 anahtar</span></div>
                        <div className="text-[11px] text-[#352432]/50">{meta.label} yönetimi ile ilgili tüm işlemler ve kontrol.</div></div>
                    </div>
                    <div className="mt-4">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Atanan Personel ({selPerm.holders.length})</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selPerm.holders.map((h) => (
                          <span key={h.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#ead8df]/70 bg-white px-2 py-1 text-[11px] text-[#352432]/75">
                            {h.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={h.photoUrl} alt={h.name} className="h-5 w-5 rounded-full object-cover" />
                            ) : (
                              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#f3a3bf] text-[7px] font-display text-[#3a1a2a]">{initialsFromName(h.name)}</span>
                            )}
                            {h.name} <span className="text-[#352432]/40">· {h.role}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Yetkiler</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {['Oluştur', 'Düzenle', 'Görüntüle', 'Sil / İptal'].map((y, i) => (
                          <span key={y} className={`rounded-md px-2 py-1 text-[10px] font-medium ${['bg-emerald-50 text-emerald-700', 'bg-sky-50 text-sky-700', 'bg-violet-50 text-violet-700', 'bg-amber-50 text-amber-700'][i]}`}>{meta.label === y ? y : `${meta.label.split(' ')[0]} ${y}`}</span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-4 items-center gap-2 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                      <div className="relative grid h-16 w-16 place-items-center rounded-full" style={{ background: `conic-gradient(#e0617f 0% ${coverage}%, #f7e9ee ${coverage}% 100%)` }}>
                        <div className="grid h-11 w-11 place-items-center rounded-full bg-white font-display text-[13px]">%{coverage}</div>
                      </div>
                      <Mini k="Grup" v={String(permGroups.length)} />
                      <Mini k="Anahtar" v={String(permGroups.length)} />
                      <Mini k="Aktif atama" v={String(selPerm.holders.filter((h) => h.active).length)} />
                    </div>
                  </>
                )
              })() : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Yetki seçimi yok.</div>}
            </div>
          </div>
        ) : (
          /* ================= PERSONEL LİSTESİ + ROL DETAYI (mockup 10) ================= */
          <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
            {/* STAFF CARDS */}
            <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Staff API Listesi</div>
                  <div className="font-display text-2xl tracking-tight">{staff.length} personel</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Personel ara" className="w-36 rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]" />
                  </div>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
                    <option value="">Tümü</option><option value="active">Aktif</option><option value="inactive">Pasif</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {staff.map((p) => {
                  const st = staffStats.get(p.id)
                  const sc = scoreOf(p.id)
                  return (
                    <motion.button key={p.id} type="button" whileHover={{ y: -2 }} onClick={() => setSelectedId(p.id)}
                      className={`rounded-[18px] border p-3.5 text-left transition-colors ${selected?.id === p.id ? 'border-[#c85776]/60 bg-[#fff1f6]/40' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}>
                      <div className="flex items-start gap-3">
                        <label className="group relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-[16px] border border-[#efbfd0]/60 bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5]" onClick={(e) => e.stopPropagation()}>
                          {p.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.photoUrl} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="grid h-full w-full place-items-center font-display text-xl text-[#8e3f5b]">{initialsFromName(p.name)}</span>
                          )}
                          <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-4 w-4 text-white" /></span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadStaffPhoto(p, f); e.target.value = '' }} />
                          <span className="absolute bottom-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-[#c85776] text-[8px] font-display text-white">{initialsFromName(p.name)}</span>
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="truncate font-display text-lg tracking-tight">{p.name}</div>
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-mono uppercase ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{p.active ? 'Aktif' : 'Pasif'}</span>
                          </div>
                          <div className="text-[9px] font-mono uppercase tracking-widest text-[#c85776]/70">{p.role}</div>
                          <div className="truncate text-[10px] text-[#352432]/50">{p.dept}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 rounded-[10px] border border-[#ead8df]/60 bg-[#fffafc] px-2.5 py-1.5"><Calendar className="h-3.5 w-3.5 text-[#c85776]" /><div><div className="text-[8px] font-mono uppercase text-[#352432]/40">Randevu</div><div className="font-display text-[14px]">{st?.total ?? 0}</div></div></div>
                        <div className="flex items-center gap-2 rounded-[10px] border border-[#ead8df]/60 bg-[#fffafc] px-2.5 py-1.5"><Star className="h-3.5 w-3.5 text-[#d8ad55]" /><div><div className="text-[8px] font-mono uppercase text-[#352432]/40">Müşteri Skoru</div><div className="font-display text-[14px]">{p.averageRating != null ? p.averageRating.toFixed(1) : '—'} <span className="text-[10px] text-[#352432]/40">/ 5{p.ratingCount ? ` · ${p.ratingCount}` : ''}</span></div></div></div>
                      </div>
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[10px]"><span className="text-[#352432]/45">Performans (Bu Ay)</span><span className="font-medium text-[#352432]">{sc.monthCompleted} iş · %{sc.successRate}</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]"><span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${sc.successRate}%` }} /></div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {topServices(p.id).map((s) => <span key={s} className="rounded-md border border-[#ead8df]/60 bg-white px-1.5 py-0.5 text-[9px] text-[#352432]/60">⚡ {s}</span>)}
                        {topServices(p.id).length === 0 && p.dept && <span className="rounded-md border border-[#ead8df]/60 bg-white px-1.5 py-0.5 text-[9px] text-[#352432]/60">{p.dept}</span>}
                      </div>
                    </motion.button>
                  )
                })}
                {!staff.length && <div className="col-span-full py-10 text-center text-sm text-[#352432]/45">Personel bulunamadı.</div>}
              </div>
            </div>

            {/* ROL DETAYI */}
            <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
              {selected ? (() => {
                const st = staffStats.get(selected.id)
                const sc = scoreOf(selected.id)
                const ratingPct = Math.round(((selected.averageRating ?? 0) / 5) * 100)
                return (
                  <>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Rol Detayı</div>
                    <div className="mt-3 flex gap-4">
                      <label className="group relative h-32 w-28 shrink-0 cursor-pointer overflow-hidden rounded-[18px] border border-[#efbfd0]/60 bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5]">
                        {selected.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={selected.photoUrl} alt={selected.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="grid h-full w-full place-items-center font-display text-3xl text-[#8e3f5b]">{initialsFromName(selected.name)}</span>
                        )}
                        <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadStaffPhoto(selected, f); e.target.value = '' }} />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff1f6] font-display text-[12px] text-[#c85776]">{initialsFromName(selected.name)}</span>
                          <div className="min-w-0"><div className="truncate font-display text-xl tracking-tight">{selected.name}</div><div className="truncate text-[10px] text-[#352432]/50">{selected.role}{selected.dept ? ` · ${selected.dept}` : ''}</div></div>
                          <span className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-mono uppercase ${selected.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{selected.active ? 'Aktif' : 'Pasif'}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-[10px] border border-[#ead8df]/60 bg-[#fffafc] px-3 py-2"><div className="font-display text-xl">{selected.permissions.length}</div><div className="text-[8px] font-mono uppercase text-[#352432]/40">Yetki</div></div>
                          <div className="rounded-[10px] border border-[#ead8df]/60 bg-[#fffafc] px-3 py-2"><div className="font-display text-xl">%{sc.successRate}</div><div className="text-[8px] font-mono uppercase text-[#352432]/40">Başarı (Bu Ay)</div></div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selected.permissions.slice(0, 4).map((k) => <span key={k} className="rounded-md bg-[#fff1f6] px-1.5 py-0.5 text-[9px] text-[#b14d6c]">{permMeta(k).label}</span>)}
                          {selected.permissions.length === 0 && <span className="text-[10px] text-[#352432]/40">Yetki tanımlı değil</span>}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                      {/* Haftalık aktivite */}
                      <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                        <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">Haftalık Aktivite</div>
                        <div className="mt-2 flex h-16 items-end justify-between gap-1">
                          {(st?.weekly || Array(7).fill(0)).map((v, i) => {
                            const max = Math.max(1, ...(st?.weekly || [1]))
                            return <div key={i} className="flex flex-1 flex-col items-center gap-1"><span className="w-full rounded-t-sm bg-gradient-to-t from-[#e0617f] to-[#f3a3bf]" style={{ height: `${Math.max(8, (v / max) * 100)}%` }} /><span className="text-[7px] font-mono text-[#352432]/40">{DAYS[i]}</span></div>
                          })}
                        </div>
                      </div>
                      {/* Müşteri puanı (gerçek yıldız ortalaması) */}
                      <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3 text-center">
                        <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">Müşteri Puanı</div>
                        <div className="relative mx-auto mt-2 grid h-16 w-16 place-items-center rounded-full" style={{ background: `conic-gradient(#d8ad55 0% ${ratingPct}%, #f7e9ee ${ratingPct}% 100%)` }}>
                          <div className="grid h-11 w-11 place-items-center rounded-full bg-white font-display text-[13px]">{selected.averageRating != null ? selected.averageRating.toFixed(1) : '—'}</div>
                        </div>
                        <div className="mt-1 text-[9px] text-[#352432]/45">{selected.ratingCount ? `${selected.ratingCount} değerlendirme` : 'Henüz puan yok'}</div>
                      </div>
                      {/* Yetki seti grid */}
                      <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                        <div className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/40">Yetki Seti</div>
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          {(selected.permissions.length ? selected.permissions : ['—']).slice(0, 6).map((k) => {
                            const meta = permMeta(k)
                            return <span key={k} title={meta.label} className="grid aspect-square place-items-center rounded-[9px] border border-[#ead8df]/70 bg-white text-[#c85776]"><meta.icon className="h-3.5 w-3.5" /></span>
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
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
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90">
                            <UserCog className="h-3.5 w-3.5" /> Rol Düzenle
                          </button>
                        }
                      />
                      <StaffWorkingHoursDialog
                        staffId={selected.id}
                        staffName={selected.name}
                        tenantId={tenantId}
                        trigger={
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11px] font-medium text-[#352432]/80 transition-colors hover:border-[#efbfd0] hover:text-[#352432]">
                            <CalendarClock className="h-3.5 w-3.5" /> Çalışma Saatleri
                          </button>
                        }
                      />
                      <StaffCalendarLinkButton staffId={selected.id} staffName={selected.name} tenantId={tenantId} />
                      {branchOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => { setTransferBranchId(''); setTransferOpen(true) }}
                          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11px] font-medium text-[#352432]/80 transition-colors hover:border-[#efbfd0] hover:text-[#352432]"
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" /> Şube Aktar
                        </button>
                      )}
                      {deviceControlFeature && selected.tenantUserId && (
                        <button
                          type="button"
                          onClick={() => setDeviceDialogOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11px] font-medium text-[#352432]/80 transition-colors hover:border-[#efbfd0] hover:text-[#352432]"
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
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11px] font-medium text-[#352432]/80 hover:border-[#efbfd0] hover:text-[#352432]">
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
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3.5 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100">
                        <UserX className="h-3.5 w-3.5" /> Personeli Sil
                      </button>
                    </div>
                  </>
                )
              })() : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Personel seçimi yok.</div>}
            </div>
          </div>
        )}
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
                <DialogDescription className="mt-0.5 text-[12px] text-[#352432]/55">
                  {selected?.name ? `${selected.name} adlı personeli` : 'Personeli'} başka bir şubeye aktar. Giriş kapsamı da yeni şubeye taşınır.
                </DialogDescription>
              </div>
            </div>
            <div className="mt-5">
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">Hedef şube</label>
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
              <button type="button" onClick={() => setTransferOpen(false)} className="rounded-[10px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-medium text-[#352432]/70 transition-colors hover:text-[#352432]">Vazgeç</button>
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
    </>
  )
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div className="text-center"><div className="font-display text-lg text-[#352432]">{v}</div><div className="text-[8px] font-mono uppercase text-[#352432]/40">{k}</div></div>
}

export default function PersonelPage() {
  return (
    <Suspense fallback={null}>
      <PersonelPageInner />
    </Suspense>
  )
}
