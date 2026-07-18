'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import CustomerFormDialog from '@/components/dashboard/CustomerFormDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import CustomerSessionsCard from '@/components/dashboard/CustomerSessionsCard'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'
import CustomerOperationsJournal from '@/components/dashboard/CustomerOperationsJournal'
import CustomerDetailModal from '@/components/dashboard/CustomerDetailModal'
import TreatmentJournal from '@/components/dashboard/TreatmentJournal'
import ConsultationForm from '@/components/dashboard/ConsultationForm'
import CustomerBlacklistCard from '@/components/dashboard/CustomerBlacklistCard'
import PassiveCustomersPanel from '@/components/dashboard/PassiveCustomersPanel'
import { useFeature } from '@/components/dashboard/FeatureContext'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import AppointmentEditor, { type AppointmentEditorValues } from '@/components/dashboard/AppointmentEditor'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { apiItems, formatTL, guidOrUndefined, normalizeAccount, normalizeAppointment, normalizeCustomer, normalizePackage, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import { downscaleImage } from '@/lib/imageUtils'
import {
  ChevronLeft, ChevronRight, CreditCard,
  Mail, Phone, PenLine, PieChart, Search, Sparkles,
  UserPlus, UserRound, Users, Wallet,
} from 'lucide-react'
import type { ApiAppointment, ApiCustomer, ApiCustomerAccount, ApiService, ApiServicePackage, ApiStaff, Customer, CustomerGender, PagedResult } from '@/lib/types'

interface CustomerFormValues {
  fullName?: string; phone?: string; email?: string; birthDate?: string
  gender?: CustomerGender; kvkkConsent?: boolean; notes?: string; branchId?: string; photoUrl?: string
}

type TabKey = 'all' | 'vip' | 'kvkk' | 'kvkk-pending' | 'debt' | 'recent' | 'blacklist' | 'passive'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'vip', label: 'VIP' }, { key: 'kvkk', label: 'KVKK Onaylı' }, { key: 'kvkk-pending', label: 'KVKK Bekleyen' },
  { key: 'debt', label: 'Borçlu' }, { key: 'recent', label: 'Yeni Eklenen' },
  { key: 'blacklist', label: 'Kara Liste' }, { key: 'passive', label: 'Pasif' },
]
type SortKey = 'name' | 'debt' | 'spent' | 'recent'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'İsim (A-Z)' }, { key: 'recent', label: 'Son işlem (yeni)' },
  { key: 'debt', label: 'Borç (yüksek)' }, { key: 'spent', label: 'Harcama (yüksek)' },
]

const AVATAR_COLORS = ['from-[#f3a3bf] to-[#ffd9e6]', 'from-[#9c70bb] to-[#e3cdf2]', 'from-[#5aa9e6] to-[#cfe7fb]', 'from-[#54c1a0] to-[#cdeee2]', 'from-[#e6a14f] to-[#fbe6cb]', 'from-[#e0617f] to-[#fbd2dc]']
function avatarColor(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }
function initials(name: string): string { const p = name.trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase() }

// Modal "Hızlı İşlemler" içindeki satış (paket/hizmet/ürün) tetikleyici buton stili.
const SALE_TRIGGER_CLS = 'flex w-full cursor-pointer items-center gap-2 rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] px-3 py-2.5 text-[12px] font-medium text-[#352432] transition-colors hover:border-[#efbfd0] hover:bg-[#fff1f6]/60'

function weeklySeries(times: number[], weeks = 12): number[] {
  const now = Date.now(); const wk = 7 * 86_400_000; const start = now - weeks * wk
  const b = Array(weeks).fill(0)
  for (const t of times) { if (t < start || t > now) continue; b[Math.min(weeks - 1, Math.floor((t - start) / wk))]++ }
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

interface Enriched extends Customer { debt: number; spent: number; apptCount: number; lastService: string; lastDate: string; lastTime: number; tags: string[] }

function ageOf(birth: string): number | null {
  const d = new Date(birth); if (Number.isNaN(d.getTime())) return null
  const a = (Date.now() - d.getTime()) / (365.25 * 86_400_000)
  return a > 0 && a < 120 ? Math.floor(a) : null
}
function ageSegment(age: number): string {
  if (age < 25) return '18–24 Yaş'; if (age < 35) return '25–34 Yaş'; if (age < 45) return '35–44 Yaş'; if (age < 55) return '45–54 Yaş'; return '55+ Yaş'
}

function MusterilerPageInner() {
  const search = useSearchParams()
  const scopeParam = (search?.get('scope') as TabKey | null)
  const [tab, setTab] = useState<TabKey>(scopeParam && TABS.some((t) => t.key === scopeParam) ? scopeParam : 'all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [apptOpen, setApptOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  // Seans kartını tazelemek için sayaç — paket satışı / randevu sonrası artar.
  const [sessRefresh, setSessRefresh] = useState(0)
  // Liste payload'ı için fotoğraf artık liste DTO'sunda gelmiyor; seçili müşterinin fotoğrafını ayrı çekeriz.
  const [detailPhoto, setDetailPhoto] = useState<string | null>(null)
  // Paket dahilinde mi — kara liste / pasif sekmeleri pakete bağlı.
  const canBlacklist = useFeature('customers.blacklist')
  const canPassive = useFeature('customers.passive')
  const canAdisyon = useFeature('billing.adisyon')
  const visibleTabs = useMemo(() => TABS.filter((t) => (t.key !== 'blacklist' || canBlacklist) && (t.key !== 'passive' || canPassive)), [canBlacklist, canPassive])
  // Pakette olmayan bir sekmedeyse Tümü'ne dön.
  useEffect(() => {
    if ((tab === 'blacklist' && !canBlacklist) || (tab === 'passive' && !canPassive)) setTab('all')
  }, [tab, canBlacklist, canPassive])
  // Hızlı menüden ?action=new ile gelindiğinde yeni müşteri modalını aç
  useEffect(() => {
    if (search?.get('action') === 'new') setNewOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  // Satış/başka sayfadan ?customer=ID ile gelince o müşteriyi seç + detay modalını aç (önmuhasebeye uğramadan).
  useEffect(() => {
    const cid = search?.get('customer')
    if (!cid) return
    setTab('all')
    setQ('')
    setSelectedId(cid)
    setModalOpen(true)
    if (search?.get('sale') === '1') {
      setActionMsg('Satış adisyona eklendi. "Adisyon & İşlemler" sekmesinden onaylayınca cariye/taksite işlenir.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const { isStaff, performWrite } = useStaffApproval()

  const { data, loading, error, reload } = useApiQuery<{ customers: ApiCustomer[]; accounts: ApiCustomerAccount[]; appts: ApiAppointment[]; staff: ApiStaff[]; services: ApiService[]; packages: ApiServicePackage[] }>(
    async () => {
      if (!tenantId) return { customers: [], accounts: [], appts: [], staff: [], services: [], packages: [] }
      // Müşteri/cari/randevu listeleri TÜM kayıtlar gelene kadar sayfa sayfa çekilir
      // (12 bin+ müşteri içeri aktarımı sonrası tek sayfa yetmiyor).
      const [customers, accounts, appts, staff, services, packages] = await Promise.all([
        fetchAllPaged<ApiCustomer>((page, pageSize) => adminApi.customers<ApiCustomer>({ tenantId, page, pageSize })),
        fetchAllPaged<ApiCustomerAccount>((page, pageSize) => adminApi.accounts<ApiCustomerAccount>({ tenantId, page, pageSize })).catch(() => []),
        fetchAllPaged<ApiAppointment>((page, pageSize) => adminApi.appointments<ApiAppointment>({ tenantId, page, pageSize })).catch(() => []),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
      ])
      return { customers, accounts, appts, staff: apiItems(staff), services: apiItems(services), packages: apiItems(packages) }
    },
    [tenantId],
    { initialData: { customers: [], accounts: [], appts: [], staff: [], services: [], packages: [] } },
  )

  // Paket/hizmet/ürün satışı veya randevu sonrası: ana listeyi yenile + detay kartlarını tazele.
  const reloadWithSessions = async () => {
    setSessRefresh((v) => v + 1)
    await reload()
  }

  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const appts = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const staffList = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const servicesList = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const packagesList = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])

  const acctMap = useMemo(() => {
    const m = new Map<string, { debt: number; spent: number; payments: { amount: number; date: string; time: number }[] }>()
    for (const a of accounts) {
      const e = m.get(a.customerId) ?? { debt: 0, spent: 0, payments: [] }
      e.debt += a.remainingAmount; e.spent += a.paidAmount
      for (const p of a.payments) e.payments.push({ amount: p.amount, date: (p.occurredAtUtc || '').slice(0, 10), time: new Date(p.occurredAtUtc).getTime() })
      m.set(a.customerId, e)
    }
    return m
  }, [accounts])

  const apptMap = useMemo(() => {
    const m = new Map<string, { count: number; list: typeof appts }>()
    for (const a of appts) {
      if (!a.customerId) continue
      const e = m.get(a.customerId) ?? { count: 0, list: [] }
      e.count++; e.list.push(a); m.set(a.customerId, e)
    }
    for (const e of m.values()) e.list.sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time))
    return m
  }, [appts])

  const enriched = useMemo<Enriched[]>(() => {
    return (data?.customers || []).map((c, i) => normalizeCustomer(c, i)).map((c) => {
      const acct = acctMap.get(c.id); const ap = apptMap.get(c.id)
      const last = ap?.list[0]
      const spent = acct?.spent ?? 0
      const tags: string[] = []
      if (c.isVip) tags.push('VIP')
      if (last?.islem) tags.push(last.islem)
      return {
        ...c, debt: acct?.debt ?? 0, spent, apptCount: ap?.count ?? 0,
        lastService: last?.islem || '—', lastDate: last?.date || '',
        lastTime: last ? new Date(last.date).getTime() : 0, tags: tags.slice(0, 2),
      }
    })
  }, [data, acctMap, apptMap])

  const total = enriched.length
  const within = (date: string, days: number) => { if (!date) return false; const t = new Date(date).getTime(); return !Number.isNaN(t) && Date.now() - t <= days * 86_400_000 }

  const filtered = useMemo(() => {
    let list = enriched
    if (tab === 'vip') list = list.filter((c) => c.isVip)
    else if (tab === 'kvkk') list = list.filter((c) => c.tier === 'KVKK Onaylı')
    else if (tab === 'kvkk-pending') list = list.filter((c) => c.tier !== 'KVKK Onaylı')
    else if (tab === 'debt') list = list.filter((c) => c.debt > 0)
    else if (tab === 'recent') list = list.filter((c) => within(c.lastDate, 30) || c.apptCount === 0)
    else if (tab === 'blacklist') list = list.filter((c) => c.isBlacklisted)
    if (q.trim()) {
      const s = q.trim().toLocaleLowerCase('tr')
      list = list.filter((c) => c.name.toLocaleLowerCase('tr').includes(s) || c.phone.includes(s) || c.email.toLocaleLowerCase('tr').includes(s))
    }
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    else if (sort === 'debt') sorted.sort((a, b) => b.debt - a.debt)
    else if (sort === 'spent') sorted.sort((a, b) => b.spent - a.spent)
    else sorted.sort((a, b) => b.lastTime - a.lastTime)
    return sorted
  }, [enriched, tab, q, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1) }, [tab, q, sort, pageSize])

  const selected = useMemo(() => filtered.find((c) => c.id === selectedId) || filtered[0], [filtered, selectedId])
  // Seçili müşterinin profil fotoğrafını tekil uçtan çek (liste artık fotoğraf taşımıyor — perf).
  useEffect(() => {
    let cancelled = false
    setDetailPhoto(null)
    const id = selected?.id
    if (id && tenantId) {
      adminApi.customer<ApiCustomer>(id, tenantId)
        .then((c) => { if (!cancelled) setDetailPhoto(c?.photoUrl || null) })
        .catch(() => { /* fotoğraf alınamadı — baş harf avatarı gösterilir */ })
    }
    return () => { cancelled = true }
  }, [selected?.id, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // stats
  const debtTotal = enriched.reduce((s, c) => s + c.debt, 0)
  const kvkkApproved = enriched.filter((c) => c.tier === 'KVKK Onaylı').length
  const active90 = enriched.filter((c) => within(c.lastDate, 90)).length
  const apptTimes = useMemo(() => appts.map((a) => new Date(a.date).getTime()).filter((t) => !Number.isNaN(t)), [appts])
  const payTimes = useMemo(() => accounts.flatMap((a) => a.payments.map((p) => new Date(p.occurredAtUtc).getTime())).filter((t) => !Number.isNaN(t)), [accounts])
  const apptSeries = useMemo(() => weeklySeries(apptTimes), [apptTimes])
  const paySeries = useMemo(() => weeklySeries(payTimes), [payTimes])

  const statCards = [
    { label: 'Toplam müşteri', value: total.toLocaleString('tr-TR'), icon: UserRound, series: apptSeries, stroke: '#d7839d' },
    { label: 'KVKK onaylı', value: kvkkApproved.toLocaleString('tr-TR'), icon: Sparkles, series: apptSeries, stroke: '#3cae8d' },
    { label: 'Açık borç', value: formatTL(debtTotal), icon: Wallet, series: paySeries, stroke: '#e0617f' },
    { label: 'Son 90 gün', value: active90.toLocaleString('tr-TR'), icon: Phone, series: apptSeries, stroke: '#9c70bb' },
  ]

  // summary
  const summary = useMemo(() => {
    const segs = new Map<string, number>(); let withAge = 0
    for (const c of enriched) { const a = ageOf(c.joined); if (a !== null) { segs.set(ageSegment(a), (segs.get(ageSegment(a)) ?? 0) + 1); withAge++ } }
    let topSeg = '—'; let topSegCount = 0
    for (const [s, n] of segs) if (n > topSegCount) { topSeg = s; topSegCount = n }
    const spenders = enriched.filter((c) => c.spent > 0)
    const avgSpent = spenders.length ? spenders.reduce((s, c) => s + c.spent, 0) / spenders.length : 0
    const thisMonth = new Date(); const m0 = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1).getTime()
    const prevM0 = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1).getTime()
    const newThis = enriched.filter((c) => c.lastTime >= m0).length
    const newPrev = enriched.filter((c) => c.lastTime >= prevM0 && c.lastTime < m0).length
    const growth = newPrev > 0 ? Math.round(((newThis - newPrev) / newPrev) * 100) : null
    const debtors = enriched.filter((c) => c.debt > 0).length
    return {
      topSeg, segPct: withAge ? Math.round((topSegCount / withAge) * 100) : 0,
      avgSpent, newThis, growth, debtors, debtorPct: total ? Math.round((debtors / total) * 1000) / 10 : 0,
    }
  }, [enriched, total])

  const customerPayload = (values: CustomerFormValues): Record<string, unknown> => ({
    branchId: guidOrUndefined(values.branchId) || branchId, fullName: values.fullName, phone: values.phone,
    email: values.email || null, birthDate: values.birthDate || null, gender: values.gender || 'Unspecified',
    kvkkConsent: Boolean(values.kvkkConsent), notes: values.notes || null,
    photoUrl: typeof values.photoUrl === 'string' ? values.photoUrl : null,
  })

  const fullPayloadOf = (c: Enriched, extra: Record<string, unknown>): Record<string, unknown> => ({
    branchId: c.branchId || branchId, fullName: c.name, phone: c.phone, email: c.email || null,
    birthDate: ageOf(c.joined) !== null ? c.joined : null, gender: c.gender || 'Unspecified',
    kvkkConsent: c.tier === 'KVKK Onaylı', notes: c.notes || null, ...extra,
  })

  const uploadPhoto = async (c: Enriched, file: File) => {
    setActionError('')
    try {
      const dataUrl = await downscaleImage(file, 320)
      await adminApi.updateCustomer(c.id, fullPayloadOf(c, { photoUrl: dataUrl }), tenantId)
      setDetailPhoto(dataUrl)
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Fotoğraf yüklenemedi.') }
  }
  const handleSaveNote = async (text: string) => {
    if (!selected || (text || '') === (selected.notes || '')) return
    setActionError('')
    try { await adminApi.updateCustomer(selected.id, fullPayloadOf(selected, { notes: text || null }), tenantId); await reload() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Not kaydedilemedi.') }
  }
  const handleDeleteCustomer = async () => {
    if (!selected) return
    setActionError('')
    try {
      const res = await performWrite({ operationType: 'DeleteCustomer', title: `Müşteri silme: ${selected.name}`, summary: selected.phone, payload: { customerId: selected.id }, tenantId, directAction: async () => { await adminApi.deleteCustomer(selected.id, tenantId) } })
      if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Müşteri silme'))
      else { setSelectedId(null); setModalOpen(false) }
      await reload()
    } catch (e: unknown) { setActionError(e instanceof Error ? e.message : 'Müşteri silinemedi.') }
  }

  // Randevu oluşturma — randevular sayfasındaki AppointmentEditor'ün aynısı, müşteri seçili gelir.
  const handleCreateAppointment = async (values: AppointmentEditorValues): Promise<void> => {
    const service = servicesList.find((s) => s.id === values.serviceDefinitionId)
    const start = new Date(`${values.date}T${values.time || '09:00'}:00`)
    const duration = Math.max(5, values.durationMinutes || service?.duration || 30)
    const end = new Date(start.getTime() + duration * 60000)
    const payload: Record<string, unknown> = {
      branchId, customerId: values.customerId, staffMemberId: values.staffMemberId || null,
      serviceDefinitionId: values.serviceDefinitionId, startUtc: start.toISOString(), endUtc: end.toISOString(),
      // Randevu ciro taşımaz — satış adisyon+cari katmanında; tamamlanınca seans düşer.
      price: 0, notes: values.notes || null,
    }
    // Randevu artık PendingOperation'a değil doğrudan oluşturulur; personel oluşturursa
    // backend onu "taslak" yapıp kurum yöneticisi onayına düşürür (randevularda taslak → aktif akışı).
    await adminApi.createAppointment(payload, tenantId)
    if (isStaff) {
      setActionMsg('Randevu taslak olarak oluşturuldu ve kurum yöneticisi onayına gönderildi.')
    }
    await reloadWithSessions()
  }

  const goPage = (p: number) => setPage(Math.min(totalPages, Math.max(1, p)))
  const pageNumbers = useMemo(() => {
    const out: (number | '...')[] = []
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) out.push(p)
      else if (out[out.length - 1] !== '...') out.push('...')
    }
    return out
  }, [page, totalPages])

  return (
    <>
      <Topbar
        title={isStaff ? 'Müşterilerim' : 'Müşteriler'}
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${TABS.find((t) => t.key === tab)?.label}`}
        breadcrumbs={isStaff ? ['Personel', 'Müşterilerim'] : ['Admin', 'İşletme', 'Müşteriler', TABS.find((t) => t.key === tab)?.label || 'Tüm Müşteriler']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CustomerFormDialog
              mode="create"
              open={newOpen}
              onOpenChange={setNewOpen}
              submitLabel={isStaff ? 'Onaya gönder' : 'Müşteri oluştur'}
              onSubmit={async (values) => {
                const payload = customerPayload(values)
                const res = await performWrite({ operationType: 'CreateCustomer', title: `Müşteri: ${String(payload.fullName || '—')}`, summary: String(payload.phone || ''), payload, tenantId, directAction: () => adminApi.createCustomer(payload, tenantId) })
                if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Müşteri ekleme'))
                await reload()
              }}
              trigger={
                <button type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                  <UserPlus className="h-4 w-4" strokeWidth={2.1} /> Yeni müşteri
                </button>
              }
            />
            <ExcelTransferActions<Customer>
              featureKey="excel.customers" moduleName="Müşteriler"
              context={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
              rows={filtered}
              sheet={{
                subtitle: `${filtered.length} müşteri kaydı`,
                columns: [
                  { key: 'name', header: 'Ad Soyad', width: 28, type: 'text', accessor: (c) => c.name },
                  { key: 'phone', header: 'Telefon', width: 18, type: 'text', accessor: (c) => c.phone },
                  { key: 'email', header: 'E-posta', width: 26, type: 'text', accessor: (c) => c.email || '' },
                  { key: 'gender', header: 'Cinsiyet', width: 12, type: 'text', accessor: (c) => c.gender || '' },
                  { key: 'tier', header: 'KVKK', width: 14, type: 'text', accessor: (c) => c.tier || '' },
                  { key: 'debt', header: 'Açık Borç', width: 16, type: 'currency', accessor: (c) => Number((c as Enriched).debt || 0) },
                  { key: 'notes', header: 'Not', width: 40, type: 'text', accessor: (c) => c.notes || '' },
                ],
                totals: { name: 'TOPLAM', debt: filtered.reduce((s, c) => s + (c as Enriched).debt, 0) },
              }}
              onImport={async (result) => {
                const first = result[0]; if (!first) return
                for (const row of first.rows) {
                  const fullName = String(row['Ad Soyad'] || row['Ad'] || '').trim(); const phone = String(row['Telefon'] || '').trim()
                  if (!fullName || !phone) continue
                  await adminApi.createCustomer({ branchId, fullName, phone, email: String(row['E-posta'] || '') || null, gender: String(row['Cinsiyet'] || 'Unspecified'), kvkkConsent: String(row['KVKK'] || '').toLocaleLowerCase('tr-TR') === 'evet', notes: String(row['Not'] || '') || null }, tenantId)
                }
                await reload()
              }}
            />
          </div>
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && total === 0} emptyMessage="Customer API döndü ama müşteri kaydı yok." />
        {(actionError || actionMsg) && (
          <div className={`rounded-[12px] border px-4 py-2.5 text-[12px] ${actionError ? 'border-rose-300/30 bg-rose-50 text-rose-700' : 'border-emerald-300/30 bg-emerald-50 text-emerald-700'}`}>{actionError || actionMsg}</div>
        )}

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><card.icon className="h-4 w-4" /></span>
              <div className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{card.label}</div>
              <div className="mt-0.5 flex items-end justify-between gap-2">
                <div className="font-display text-3xl tabular-nums tracking-tight">{card.value}</div>
                <div className="w-24 shrink-0"><Sparkline values={card.series} stroke={card.stroke} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
            {visibleTabs.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`rounded-[9px] px-3.5 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-[#c85776] text-white shadow-sm' : 'text-[#352432]/55 hover:bg-white'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {(tab !== 'all' || q || sort !== 'name') && (
            <button type="button" onClick={() => { setTab('all'); setQ(''); setSort('name') }}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2 text-[11px] text-[#352432]/60 transition-colors hover:bg-[#fff4f8]/40">
              <Sparkles className="h-3.5 w-3.5" /> Filtreleri Temizle
            </button>
          )}
        </div>

        {/* MAIN: LIST (tam genişlik) — detay zengin modalda açılır */}
        <div className="grid gap-4">
          {/* LIST */}
          <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ead8df]/70 px-5 py-4">
              <div>
                <div className="font-display text-xl tracking-tight">Müşteri Listesi <span className="ml-1 rounded-full bg-[#fff1f6] px-2 py-0.5 text-[12px] text-[#b14d6c]">{filtered.length}</span></div>
                <div className="text-[11px] text-[#352432]/45">Danışan kayıtlarını görüntüleyin ve yönetin.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri ara"
                    className="w-44 rounded-[10px] border border-[#ead8df]/70 bg-white px-9 py-2 text-[12px] outline-none focus:border-[#c85776]" />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
                  className="rounded-[10px] border border-[#ead8df]/70 bg-white px-2.5 py-2 text-[12px] text-[#352432] outline-none focus:border-[#c85776]">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {tab === 'passive' ? (
              <div className="p-4">
                <PassiveCustomersPanel tenantId={tenantId} onSelect={(id) => { setTab('all'); setSelectedId(id) }} />
              </div>
            ) : (
              <>
            <div className="hidden grid-cols-[1.4fr_1.4fr_0.9fr_1.1fr_0.7fr_1fr_0.8fr] gap-3 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 lg:grid">
              <span>Müşteri</span><span>İletişim</span><span>Durum</span><span>Son İşlem</span><span>Borç</span><span>Etiketler</span><span className="text-right">İşlemler</span>
            </div>

            <div className="divide-y divide-[#f1e5ea]">
              {pageRows.map((c) => (
                <button key={c.id} type="button" onClick={() => { setSelectedId(c.id); setModalOpen(true) }}
                  className={`grid w-full grid-cols-1 gap-3 px-5 py-3 text-left transition-colors hover:bg-[#fffafc] lg:grid-cols-[1.4fr_1.4fr_0.9fr_1.1fr_0.7fr_1fr_0.8fr] lg:items-center ${selected?.id === c.id ? 'bg-[#fff1f6]/50' : ''}`}>
                  {/* Müşteri */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    {c.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photoUrl} alt={c.name} className="h-9 w-9 shrink-0 rounded-full border border-[#efbfd0]/50 object-cover" />
                    ) : (
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(c.name)} text-[11px] font-display text-[#3a1a2a]`}>{initials(c.name)}</span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-[#352432]">{c.name}</div>
                      <div className="truncate text-[10px] font-mono text-[#352432]/40">{c.id.slice(0, 10)}</div>
                    </div>
                  </div>
                  {/* İletişim */}
                  <div className="min-w-0 space-y-0.5 text-[11px] text-[#352432]/65">
                    <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-[#c85776]/70" /> {c.phone}</div>
                    <div className="flex items-center gap-1.5 truncate"><Mail className="h-3 w-3 text-[#c85776]/70" /> <span className="truncate">{c.email || '—'}</span></div>
                  </div>
                  {/* Durum */}
                  <div>
                    <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${c.tier === 'KVKK Onaylı' ? 'border-emerald-300/40 bg-emerald-50 text-emerald-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>{c.tier === 'KVKK Onaylı' ? 'KVKK ONAYLI' : 'BEKLİYOR'}</span>
                  </div>
                  {/* Son İşlem */}
                  <div className="text-[11px] text-[#352432]/60">
                    <div className="font-mono text-[10px] text-[#352432]/45">{c.lastDate || '—'}</div>
                    <div className="truncate">{c.lastService}</div>
                  </div>
                  {/* Borç */}
                  <div className={`font-display tabular-nums ${c.debt > 0 ? 'text-rose-700' : 'text-[#352432]/55'}`}>{formatTL(c.debt)}</div>
                  {/* Etiketler */}
                  <div className="flex flex-wrap gap-1">
                    {c.tags.length === 0 ? <span className="text-[10px] text-[#352432]/30">—</span> : c.tags.map((t) => (
                      <span key={t} className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium ${t === 'VIP' ? 'bg-[#f3e8ff] text-[#7c3aed]' : 'bg-[#e0f2fe] text-[#0369a1]'}`}>{t}</span>
                    ))}
                  </div>
                  {/* İşlemler */}
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="rounded-md border border-[#ead8df]/70 bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/70">Detay</span>
                  </div>
                </button>
              ))}
              {!pageRows.length && (
                <div className="px-5 py-12 text-center text-sm text-[#352432]/45">{q || tab !== 'all' ? 'Filtreyle eşleşen müşteri bulunamadı.' : 'Müşteri kaydı yok.'}</div>
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
              </>
            )}
          </div>

          {/* DETAIL MODAL — danışan kartı zengin, sekmeli modalda açılır */}
          <CustomerDetailModal
            open={modalOpen && Boolean(selected)}
            onClose={() => setModalOpen(false)}
            customer={selected}
            detailPhoto={detailPhoto}
            tenantId={tenantId}
            appts={appts}
            accounts={accounts}
            isStaff={isStaff}
            canAdisyon={canAdisyon}
            canBlacklist={canBlacklist}
            sessRefresh={sessRefresh}
            onReload={reload}
            onReloadWithSessions={reloadWithSessions}
            onSaveNote={handleSaveNote}
            onUploadPhoto={(file) => { if (selected) void uploadPhoto(selected, file) }}
            onCreateAppointment={() => setApptOpen(true)}
            onDelete={handleDeleteCustomer}
            editSlot={selected ? (
              <CustomerFormDialog
                mode="edit"
                title={selected.name}
                submitLabel={isStaff ? 'Onaya gönder' : 'Müşteriyi güncelle'}
                initial={{
                  fullName: selected.name,
                  phone: selected.phone || '',
                  email: selected.email || '',
                  birthDate: ageOf(selected.joined) !== null ? selected.joined : '',
                  gender: (selected.gender || 'Unspecified') as CustomerGender,
                  kvkkConsent: selected.tier === 'KVKK Onaylı',
                  notes: selected.notes || '',
                  photoUrl: detailPhoto || selected.photoUrl || '',
                }}
                onSubmit={async (values) => {
                  const payload = customerPayload({ ...values, branchId: selected.branchId || branchId })
                  const res = await performWrite({ operationType: 'UpdateCustomer', title: `Müşteri güncellemesi: ${selected.name}`, summary: String(payload.phone || ''), payload: { ...payload, customerId: selected.id }, tenantId, directAction: () => adminApi.updateCustomer(selected.id, payload, tenantId) })
                  if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Müşteri güncelleme'))
                  await reload()
                }}
                trigger={
                  <button type="button"
                    className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                    <PenLine className="h-3.5 w-3.5" /> Düzenle
                  </button>
                }
              />
            ) : null}
            saleSlot={selected ? (
              <>
                <PackageSaleDialog tenantId={tenantId} presetCustomer={{ id: selected.id, name: selected.name, branchId: selected.branchId }} onDone={reloadWithSessions} triggerLabel="Paket Sat" triggerClassName={SALE_TRIGGER_CLS} />
                <PackageSaleDialog tenantId={tenantId} serviceSale presetCustomer={{ id: selected.id, name: selected.name, branchId: selected.branchId }} onDone={reloadWithSessions} triggerLabel="Hizmet Sat" triggerClassName={SALE_TRIGGER_CLS} />
                <PackageSaleDialog tenantId={tenantId} productSale presetCustomer={{ id: selected.id, name: selected.name, branchId: selected.branchId }} onDone={reloadWithSessions} triggerLabel="Ürün Sat" triggerClassName={SALE_TRIGGER_CLS} />
              </>
            ) : null}
          />
        </div>

        {/* MÜŞTERİ ÖZETİ */}
        <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
          <div className="font-display text-xl tracking-tight">Müşteri Özeti</div>
          <div className="text-[11px] text-[#352432]/45">Seçili filtreye göre özet bilgiler</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile icon={Users} tone="text-[#c85776] bg-[#fff1f6]" label="En Aktif Segment" value={summary.topSeg} sub={`%${summary.segPct} oran`} />
            <SummaryTile icon={CreditCard} tone="text-sky-600 bg-sky-50" label="Ortalama Harcama" value={formatTL(summary.avgSpent)} sub="Tüm müşteriler" />
            <SummaryTile icon={UserPlus} tone="text-emerald-600 bg-emerald-50" label="Bu Ay Yeni Müşteri" value={String(summary.newThis)} sub={summary.growth !== null ? `↑ %${summary.growth} artış geçen aya göre` : 'bu ay aktif'} subTone={summary.growth !== null && summary.growth >= 0 ? 'text-emerald-600' : undefined} />
            <SummaryTile icon={PieChart} tone="text-violet-600 bg-violet-50" label="Borçlu Müşteri Oranı" value={`%${String(summary.debtorPct).replace('.', ',')}`} sub={`${summary.debtors} müşteri`} />
          </div>
        </div>
      </div>

      {/* Randevu oluşturma — müşteri seçili gelir (randevular sayfasındaki modal) */}
      <AppointmentEditor
        mode="create"
        open={apptOpen}
        onOpenChange={setApptOpen}
        customers={enriched}
        staff={staffList}
        services={servicesList}
        packages={packagesList}
        tenantId={tenantId}
        initialValues={{ customerId: selected?.id || '', date: new Date().toISOString().slice(0, 10) }}
        onSubmit={handleCreateAppointment}
      />
    </>
  )
}

function SummaryTile({ icon: Icon, tone, label, value, sub, subTone }: { icon: typeof Users; tone: string; label: string; value: string; sub: string; subTone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div>
        <div className="truncate font-display text-lg tracking-tight text-[#352432]">{value}</div>
        <div className={`truncate text-[10px] ${subTone || 'text-[#352432]/45'}`}>{sub}</div>
      </div>
    </div>
  )
}

export default function MusterilerPage() {
  return (
    <Suspense fallback={null}>
      <MusterilerPageInner />
    </Suspense>
  )
}
