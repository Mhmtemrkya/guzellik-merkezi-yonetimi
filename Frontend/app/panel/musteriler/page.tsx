'use client'

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import CustomerFormDialog from '@/components/dashboard/CustomerFormDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import ImportDialog from '@/components/dashboard/ImportDialog'
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
import BulkSelectBar, { SelectBox, useBulkSelect, type BulkAction } from '@/components/dashboard/BulkSelectBar'
import CustomerSalesPanel from '@/components/dashboard/CustomerSalesPanel'
import type { HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'
import { usePermission } from '@/hooks/usePermission'
import AppointmentEditor, { type AppointmentEditorValues } from '@/components/dashboard/AppointmentEditor'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, guidOrUndefined, mapCancelledSale, normalizeAccount, normalizeAppointment, normalizeCustomer, normalizePackage, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import { downscaleImage } from '@/lib/imageUtils'
import type { IdempotentWriteOptions } from '@/lib/idempotency'
import {
  ChevronLeft, ChevronRight, CreditCard, FileUp,
  Mail, MessageCircle, Phone, PenLine, PieChart, Search, ShieldAlert, Sparkles,
  UserPlus, UserRound, Users, Wallet,
} from 'lucide-react'
import type { ApiAppointment, ApiCustomer, ApiCustomerAccount, ApiCustomerSpendingStats, ApiCustomerStats, ApiService, ApiServicePackage, ApiStaff, Customer, CustomerGender, PagedResult } from '@/lib/types'

interface CustomerFormValues {
  fullName?: string; phone?: string; email?: string; birthDate?: string
  gender?: CustomerGender; kvkkConsent?: boolean; notes?: string; branchId?: string; photoUrl?: string
}

type TabKey = 'all' | 'vip' | 'kvkk' | 'kvkk-pending' | 'debt' | 'recent' | 'blacklist' | 'passive'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tümü' }, { key: 'vip', label: 'VIP' }, { key: 'kvkk', label: 'KVKK Onaylı' }, { key: 'kvkk-pending', label: 'KVKK Onaysız' },
  { key: 'debt', label: 'Borçlu' }, { key: 'recent', label: 'Yeni Eklenen' },
  { key: 'blacklist', label: 'Kara Liste' }, { key: 'passive', label: 'Pasif' },
]
// Sıralama SUNUCUDA yapılır. Ad AES-GCM ile şifreli saklandığından alfabetik sıralama SQL'de
// mümkün değil; bu yüzden "İsim (A-Z)" yerine kayıt tarihi / tutar / son ziyaret ölçütleri var.
type SortKey = 'recent' | 'oldest' | 'debt' | 'spent' | 'last-visit'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Son eklenen' }, { key: 'oldest', label: 'İlk eklenen' },
  { key: 'last-visit', label: 'Son ziyaret' },
  { key: 'debt', label: 'Borç (yüksek)' }, { key: 'spent', label: 'Harcama (yüksek)' },
]

// "Ortalama Harcama" kartının dönem seçimi. Ölçüt TAHSİLAT tarihidir: dönemde kasaya fiilen
// giren para sayılır — geçmiş bir satışın bu ay ödenen taksiti de bu aya düşer.
// null = tüm zamanlar (kartın eski davranışı; varsayılan da budur).
type SpendPeriod = { key: string; label: string; days: number | null }
const SPEND_PERIODS: SpendPeriod[] = [
  { key: 'all', label: 'Tüm zamanlar', days: null },
  { key: '30', label: 'Son 30 gün', days: 30 },
  { key: '90', label: 'Son 90 gün', days: 90 },
  { key: '365', label: 'Son 1 yıl', days: 365 },
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
  const [sort, setSort] = useState<SortKey>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Toplu seçim: satırlara tıklayarak seç, alt çubuktan topluca sil.
  // Silme yetkisi olmayan personelde seçim hiç açılmaz (buton da görünmez).
  const { can } = usePermission()
  const canBulkDelete = can('Customers.Delete')
  // KVKK onay mesajı gönderme müşteri düzenleme yetkisine bağlı — silme yetkisi gerekmez.
  const canSendKvkk = can('Customers.Manage')
  const canSelectRows = canBulkDelete || canSendKvkk
  const bulk = useBulkSelect()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [apptOpen, setApptOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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

  // Arama sunucuya gider — her tuşta istek atmamak için 350 ms debounce.
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])

  // ---- LİSTE: yalnızca görünen SAYFA çekilir (sunucu tarafı filtre/sıralama/arama).
  // 12 bin de 1 milyon müşteri de aynı hızda açılır; istemci hiçbir zaman tüm listeyi indirmez.
  const { data, loading, error, reload } = useApiQuery<PagedResult<ApiCustomer>>(
    async () => {
      if (!tenantId) return { items: [], total: 0 }
      return adminApi.customers<ApiCustomer>({
        tenantId,
        page,
        pageSize,
        search: debouncedQ || undefined,
        filter: tab === 'all' || tab === 'passive' ? undefined : tab,
        sort,
      })
    },
    [tenantId, page, pageSize, tab, sort, debouncedQ],
    { initialData: { items: [], total: 0 } },
  )

  // ---- KARTLAR: tüm kurum için toplu sayaçlar (tek hafif sorgu, liste indirilmeden).
  const { data: statsData, reload: reloadStats } = useApiQuery<ApiCustomerStats>(
    async () => (tenantId ? adminApi.customersStats<ApiCustomerStats>(tenantId).catch(() => ({})) : {}),
    [tenantId],
    { initialData: {} },
  )
  const stats = statsData || {}

  // ---- Ortalama harcama kartının dönemi. Ağır /stats sorgusunu tekrar koşturmamak için
  // ayrı ve hafif bir uçtan gelir (yalnız tahsilat tablosu taranır).
  const [spendPeriod, setSpendPeriod] = useState<string>('all')
  const spendDays = useMemo(() => SPEND_PERIODS.find((p) => p.key === spendPeriod)?.days ?? null, [spendPeriod])
  const { data: spendData, reload: reloadSpend } = useApiQuery<ApiCustomerSpendingStats>(
    async () => (tenantId ? adminApi.customersSpendingStats<ApiCustomerSpendingStats>(spendDays, tenantId).catch(() => ({})) : {}),
    [tenantId, spendDays],
    { initialData: {} },
  )

  // ---- Randevu/satış modalları için küçük sabit listeler (tek sayfa, ~200 kayıt).
  const { data: lookups } = useApiQuery<{ staff: ApiStaff[]; services: ApiService[]; packages: ApiServicePackage[] }>(
    async () => {
      if (!tenantId) return { staff: [], services: [], packages: [] }
      const [staff, services, packages] = await Promise.all([
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
      ])
      return { staff: apiItems(staff), services: apiItems(services), packages: apiItems(packages) }
    },
    [tenantId],
    { initialData: { staff: [], services: [], packages: [] } },
  )

  // Paket/hizmet/ürün satışı veya randevu sonrası: listeyi + sayaçları + detay kartlarını tazele.
  const reloadWithSessions = async () => {
    setSessRefresh((v) => v + 1)
    await Promise.all([reload(), reloadStats(), reloadSpend()])
  }

  // Toplu işlem: seçili müşterilere WhatsApp'tan KVKK açık rıza mesajı gönder.
  // Müşteri "ONAYLIYORUM" yazınca onay webhook'ta otomatik işlenir; liste bir sonraki
  // yenilemede "KVKK Onaylı" olarak görünür.
  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canSendKvkk) return []
    return [
      {
        key: 'kvkk',
        label: 'KVKK onay mesajı gönder',
        icon: MessageCircle,
        run: async (ids: string[]) => {
          const res = await adminApi.sendKvkkRequest<{ queued?: number; alreadyApproved?: number; noPhone?: number; pendingApproval?: boolean }>(ids, tenantId)
          if (res?.pendingApproval) return 'KVKK mesaj gönderimi onaya gönderildi.'
          const queued = Number(res?.queued ?? 0)
          const approved = Number(res?.alreadyApproved ?? 0)
          const noPhone = Number(res?.noPhone ?? 0)
          const extra = [
            approved > 0 ? `${approved} kayıt zaten onaylı` : '',
            noPhone > 0 ? `${noPhone} kayıtta telefon yok` : '',
          ].filter(Boolean).join(' · ')
          return queued === 0
            ? `Mesaj gönderilmedi${extra ? ` — ${extra}` : ''}.`
            : `${queued} müşteriye KVKK onay mesajı gönderiliyor${extra ? ` · ${extra}` : ''}.`
        },
      },
    ]
  }, [canSendKvkk, tenantId])

  const staffList = useMemo(() => (lookups?.staff || []).map((s, i) => normalizeStaff(s, i)), [lookups])
  const servicesList = useMemo(() => (lookups?.services || []).map((s, i) => normalizeService(s, i)), [lookups])
  const packagesList = useMemo(() => (lookups?.packages || []).map((p, i) => normalizePackage(p, i)), [lookups])

  // Sayfadaki satırlar: borç / harcama / son ziyaret bilgisi SUNUCUDAN gelir.
  const enriched = useMemo<Enriched[]>(() => {
    return apiItems(data).map((c, i) => normalizeCustomer(c, i)).map((c) => {
      const lastDate = (c.lastVisitUtc || '').slice(0, 10)
      const tags: string[] = []
      if (c.isVip) tags.push('VIP')
      if (c.lastServiceName) tags.push(c.lastServiceName)
      return {
        ...c,
        debt: c.debt,
        spent: c.totalSpent,
        apptCount: c.appointmentCount ?? 0,
        lastService: c.lastServiceName || '—',
        lastDate,
        lastTime: lastDate ? new Date(lastDate).getTime() : 0,
        tags: tags.slice(0, 2),
      }
    })
  }, [data])

  // Toplam müşteri sayısı sunucudan (sayfadaki satır sayısı değil).
  const total = Number(stats.total ?? data?.total ?? data?.totalCount ?? enriched.length)
  const filteredTotal = Number(data?.total ?? data?.totalCount ?? enriched.length)

  // Filtre/sıralama/arama sunucuda uygulandı — satırlar olduğu gibi gösterilir.
  const filtered = enriched
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize))
  const pageRows = enriched
  // Filtre/arama/sıralama değişince ilk sayfaya dön.
  useEffect(() => { setPage(1) }, [tab, debouncedQ, sort, pageSize])

  const selected = useMemo(() => filtered.find((c) => c.id === selectedId) || filtered[0], [filtered, selectedId])

  // ---- Seçili müşterinin randevu + cari kayıtları (yalnız modal açıkken, yalnız o müşteri için).
  const { data: detailData, loading: detailLoading, error: detailError } = useApiQuery<{
    appts: ApiAppointment[]
    accounts: ApiCustomerAccount[]
    cancelled: unknown[]
  }>(
    async () => {
      const cid = selected?.id
      if (!cid || !tenantId || !modalOpen) return { appts: [], accounts: [], cancelled: [] }
      const [apptRes, salesRes] = await Promise.all([
        adminApi.appointments<ApiAppointment>({ tenantId, customerId: cid, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        // CANLI + ARŞİV TEK İSTEKTE, TEK ANLIK GÖRÜNTÜDEN.
        //
        // Bunlar iki AYRI istekle çekiliyordu ve modalin "Toplam Harcama / Tahsil Edilen" KPI'ları
        // ikisinin TOPLAMIDIR. Araya bir iptal girdiğinde aynı satış hem canlıda hem arşivde
        // görünüp ÇİFT sayılabiliyor, ters sırada ise hiçbirinde görünmeyip 0'a düşüyordu.
        // Sunucu ikisini tek transaction'da (RepeatableRead) okur; yarış penceresi kapanır.
        //
        // Sayfalama da SUNUCUDA: bu uç, müşteri kapsamında listenin TAMAMINI döndürür ya da
        // reddeder — `fetchAllPaged` ile taklit etmek her sayfayı ayrı ana düşürüp yarışı
        // geri getirirdi. Hata YUTULMAZ: boş liste "satış yok" demektir, oysa gerçek
        // "veri alınamadı"dır — modal "—", sayfa hata gösterir.
        adminApi.accountsWithArchive<{
          live?: { items?: ApiCustomerAccount[] }
          cancelled?: unknown[]
        }>({ customerId: cid }, tenantId),
      ])
      const accounts = Array.isArray(salesRes?.live?.items) ? salesRes.live!.items! : []
      const cancelled = Array.isArray(salesRes?.cancelled) ? salesRes.cancelled : []
      return { appts: apiItems(apptRes), accounts, cancelled }
    },
    [tenantId, selected?.id, modalOpen, sessRefresh],
    { initialData: { appts: [], accounts: [], cancelled: [] } },
  )
  const appts = useMemo(() => (detailData?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [detailData])
  const accounts = useMemo(() => (detailData?.accounts || []).map((a, i) => normalizeAccount(a, i)), [detailData])
  const cancelledSales = useMemo(() => (detailData?.cancelled || []).map(mapCancelledSale), [detailData])
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

  // ---- Kartlar/özet: tamamı sunucudaki toplu sayaçlardan (liste indirilmeden).
  const kvkkMissing = Number(stats.kvkkPending ?? 0)
  const newIn90 = Number(stats.newLast90 ?? 0)
  const debtTotal = Number(stats.totalDebt ?? 0)
  // Sparkline: kayıt tarihine göre günlük yeni müşteri serisi (stats.newByDay).
  const newSeries = useMemo(() => {
    const times = (stats.newByDay || []).flatMap((d) => {
      const t = new Date(`${d?.date}T00:00:00`).getTime()
      return Number.isNaN(t) ? [] : Array.from({ length: d?.count || 0 }, () => t)
    })
    return weeklySeries(times)
  }, [stats.newByDay])

  const statCards = [
    { label: 'Toplam müşteri', value: total.toLocaleString('tr-TR'), icon: UserRound, series: newSeries, stroke: '#d7839d' },
    { label: 'KVKK onaysız', value: kvkkMissing.toLocaleString('tr-TR'), icon: ShieldAlert, series: newSeries, stroke: '#e0a33c' },
    { label: 'Açık borç', value: formatTL(Math.round(debtTotal)), icon: Wallet, series: newSeries, stroke: '#e0617f' },
    { label: 'Son 90 günde eklenen müşteri', value: newIn90.toLocaleString('tr-TR'), icon: UserPlus, series: newSeries, stroke: '#9c70bb' },
  ]

  const summary = useMemo(() => {
    const newThis = Number(stats.newThisMonth ?? 0)
    const newPrev = Number(stats.newPrevMonth ?? 0)
    const debtors = Number(stats.debtorCount ?? 0)
    const rawPct = total ? (debtors / total) * 100 : 0
    return {
      topSeg: stats.topAgeSegment || '—',
      segPct: Number(stats.topAgeSegmentPercent ?? 0),
      // Yaş segmenti YALNIZCA doğum tarihi girilmiş müşterilerden hesaplanır — kaç kişilik
      // veriye dayandığı kartta yazılır, aksi halde "%83" tüm müşterileri temsil ediyor sanılıyor.
      ageKnown: Number(stats.ageKnownCount ?? 0),
      // Ortalama harcama SEÇİLİ DÖNEMDEN gelir (/stats/spending); harcaması OLAN müşteriler
      // üzerinden alınır — o dönemde ödeme yapmayanlar ortalamayı aşağı çekmesin.
      avgSpent: Number(spendData?.avgSpent ?? 0),
      spenders: Number(spendData?.spenderCount ?? 0),
      newThis,
      newPrev,
      growth: newPrev > 0 ? Math.round(((newThis - newPrev) / newPrev) * 100) : null,
      debtors,
      // 3/12568 gibi küçük oranlar "%0" görünmesin: %1'in altında iki ondalık gösterilir
      // (0,02 gibi), tam sıfır değilse asla 0 yazılmaz. Kesin sayı alt satırda zaten var.
      debtorPct: debtors === 0
        ? '0'
        : rawPct >= 1
          ? String(Math.round(rawPct * 10) / 10).replace('.', ',')
          : String(Math.max(0.01, Math.round(rawPct * 100) / 100)).replace('.', ','),
    }
  }, [stats, total, spendData])

  // --- Müşteri kartı satış paneli aksiyonları (geçmiş kayıt / iptal / tahsilat) ---
  const [salesBusy, setSalesBusy] = useState(false)
  const runSaleAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setSalesBusy(true)
    try {
      await fn()
      setSessRefresh((v) => v + 1)
      await Promise.all([reload(), reloadStats(), reloadSpend()])
    } finally {
      setSalesBusy(false)
    }
  }

  const handleCreateHistoricalSale = (values: HistoricalSaleValues): Promise<void> =>
    runSaleAction(() => adminApi.createHistoricalSale({
      customerId: selected?.id,
      name: values.name,
      soldAtUtc: values.soldAt,
      totalAmount: values.totalAmount,
      paidAmount: values.paidAmount,
      soldByStaffMemberId: values.soldByStaffMemberId,
      servicePackageId: values.servicePackageId,
      serviceDefinitionId: values.serviceDefinitionId,
      sessionsTotal: values.sessionsTotal,
      sessionsUsed: values.sessionsUsed,
      installmentCount: values.installmentCount,
      firstDueDate: values.firstDueDate,
      // Ödeme geçmişi: kaç taksit ödenmiş + yöntem. Backend ödenen ayları KENDİ VADE
      // TARİHLERİYLE tahsilat yazar → geçmiş satış geçmiş cariye de düşer.
      paidInstallmentCount: values.paidInstallmentCount,
      paymentMethod: values.paymentMethod,
      // Seansı kim yaptı + yapılan seanslar randevu geçmişine işlensin mi.
      appliedByStaffMemberId: values.appliedByStaffMemberId,
      createSessionAppointments: values.createSessionAppointments,
      sessionIntervalDays: values.sessionIntervalDays,
      notes: values.notes,
      branchId: branchId ?? null,
    }, tenantId))

  const handleCancelSale = (accountId: string, reason: string, refundedAmount = 0, refundMethod = 'cash'): Promise<void> =>
    runSaleAction(() => adminApi.cancelSale(accountId, reason || null, refundedAmount, tenantId, refundMethod))

  const handleRestoreSale = (accountId: string): Promise<void> =>
    runSaleAction(() => adminApi.restoreSale(accountId, tenantId))

  // opts: SaleDetailModal'ın ürettiği çift-tıklama freni — damga da anahtar da ORADAN gelir,
  // burada `new Date()` üretilirse ikinci tıklamanın gövdesi değişir ve oynatma yerine 409 olur.
  const handleCollectInstallment = (accountId: string, amount: number, opts: IdempotentWriteOptions): Promise<void> =>
    runSaleAction(() => adminApi.registerAccountPayment(accountId, {
      amount,
      method: 'cash',
      reference: null,
      occurredAtUtc: opts.occurredAtUtc,
    }, tenantId, opts.idempotencyKey))

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
      // SEÇİLEN PAKET/SEANS SUNUCUYA TAŞINMALI. Editör bu alanı üretiyordu ama bu ekran payload'a
      // koymuyordu (randevular sayfası koyuyor): müşterinin aynı hizmeti içeren iki paketi varsa
      // kullanıcı B'yi seçse bile backend EN ESKİ paketi bağlıyor ve tamamlamada A'nın seansı
      // tükeniyordu. İki ekran aynı sözleşmeyi göndermeli.
      sourceCustomerPackageSessionId: values.sourceSessionId || null,
    }
    // Randevu artık PendingOperation'a değil doğrudan oluşturulur; personel oluşturursa
    // backend onu "taslak" yapıp kurum yöneticisi onayına düşürür (randevularda taslak → aktif akışı).
    //
    // KATALOGDAN SATIŞ tek transaction: randevu açılamazsa satış da geri alınır.
    if (values.catalogSale) {
      await adminApi.createAppointmentWithSale({ appointment: payload, sale: values.catalogSale }, tenantId)
    } else {
      await adminApi.createAppointment(payload, tenantId)
    }
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
            />
            {/* İçeri aktarma dashboard'daki GENEL aktarıcıya devredildi: kolon adlarına bağlı
                değil (otomatik eşleme), mükerrer telefonu atlar ve 400'lük partiler hâlinde tek
                istekte gönderir. Eskiden burada satır başına bir API çağrısı yapan, başlıkları
                birebir tutturmayı şart koşan bir döngü vardı. */}
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
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && total === 0} emptyMessage="Henüz müşteri kaydı yok. “Yeni Müşteri” ile ilkini ekleyebilirsin." />
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
          {(tab !== 'all' || q || sort !== 'recent') && (
            <button type="button" onClick={() => { setTab('all'); setQ(''); setSort('recent') }}
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
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    // Seçim modundayken satır tıklaması detay açmaz, seçimi değiştirir.
                    if (canSelectRows && bulk.active) { bulk.toggle(c.id); return }
                    setSelectedId(c.id); setModalOpen(true)
                  }}
                  className={`grid w-full grid-cols-1 gap-3 px-5 py-3 text-left transition-colors hover:bg-[#fffafc] lg:grid-cols-[1.4fr_1.4fr_0.9fr_1.1fr_0.7fr_1fr_0.8fr] lg:items-center ${bulk.isSelected(c.id) ? 'bg-[#fff1f6]' : selected?.id === c.id ? 'bg-[#fff1f6]/50' : ''}`}>
                  {/* Müşteri */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    {canSelectRows && <SelectBox checked={bulk.isSelected(c.id)} onToggle={() => bulk.toggle(c.id)} />}
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
                    <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-wide ${c.tier === 'KVKK Onaylı' ? 'border-emerald-300/40 bg-emerald-50 text-emerald-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>{c.tier === 'KVKK Onaylı' ? 'KVKK ONAYLI' : 'KVKK ONAYSIZ'}</span>
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
            /* Hata da "yükleniyor" gibi ele alınır: veri gelmediyse ₺0 GERÇEK RAKAM gibi
               okunuyordu (müşteri hiç ödememiş sanılırdı). Kartlar "—" gösterir. */
            accountsLoading={detailLoading || Boolean(detailError)}
            cancelledSales={cancelledSales}
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
            // Hızlı işlemlerdeki "Tahsilat Al". Cari/tutar/yöntem modalde seçilir; kayıt
            // sonrası satış listesi + seans/istatistikler tazelenir (runSaleAction).
            onCollectPayment={async (payload) => {
              await runSaleAction(() => adminApi.registerAccountPayment(payload.accountId, {
                amount: payload.amount,
                method: payload.method,
                reference: payload.reference,
                occurredAtUtc: payload.occurredAtUtc,
              }, tenantId, payload.idempotencyKey))
            }}
            salesPanel={selected ? (
              <CustomerSalesPanel
                variant="flush"
                customerName={selected.name}
                accounts={accounts}
                staffOptions={staffList.map((s) => ({ id: s.id, name: s.name }))}
                packageOptions={packagesList.map((p) => ({ id: p.id, name: p.name, price: p.totalPrice, cat: p.category, sub: p.subCategory, meta: `${formatTL(p.totalPrice)} · ${p.totalSessions} seans` }))}
                serviceOptions={servicesList.map((s) => ({ id: s.id, name: s.name, price: s.price, cat: s.group, sub: s.subGroup, meta: formatTL(s.price) }))}
                busy={salesBusy}
                onCreateHistorical={handleCreateHistoricalSale}
                onCancelSale={handleCancelSale}
                onRestoreSale={handleRestoreSale}
                onCollectInstallment={handleCollectInstallment}
              />
            ) : undefined}
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
          <div className="text-[11px] text-[#352432]/45">Kurum geneli — sekme/arama filtresinden bağımsız</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Yaş aralığı: doğum tarihi OLAN müşterilerden hesaplanır — dayanak sayısı da yazılır. */}
            <SummaryTile
              icon={Users}
              tone="text-[#c85776] bg-[#fff1f6]"
              label="En Yaygın Yaş Aralığı"
              value={summary.ageKnown > 0 ? summary.topSeg : '—'}
              sub={summary.ageKnown > 0
                ? `%${summary.segPct} · doğum tarihi girili ${summary.ageKnown.toLocaleString('tr-TR')} müşteri`
                : 'Doğum tarihi girilmiş müşteri yok'}
            />
            {/* Ortalama harcamanın DÖNEMİ kartın üzerinden seçilir; ölçüt tahsilat tarihidir
                (geçmiş bir satışın bu ay ödenen taksiti de bu aya düşer). Ortalama, o dönemde
                harcaması OLAN müşteriler üzerinden alınır — ödeme yapmayanlar bastırmasın. */}
            <SummaryTile
              icon={CreditCard}
              tone="text-sky-600 bg-sky-50"
              label="Ortalama Harcama"
              value={summary.spenders > 0 ? formatTL(Math.round(summary.avgSpent)) : '—'}
              sub={summary.spenders > 0
                ? `Harcaması olan ${summary.spenders.toLocaleString('tr-TR')} müşteri`
                : spendDays === null ? 'Henüz tahsilat yok' : 'Bu dönemde tahsilat yok'}
              control={(
                <select
                  value={spendPeriod}
                  onChange={(e) => setSpendPeriod(e.target.value)}
                  aria-label="Ortalama harcama dönemi"
                  className="shrink-0 rounded-[8px] border border-[#ead8df] bg-white px-1.5 py-1 text-[10px] text-[#352432] outline-none focus:border-[#c85776]">
                  {SPEND_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              )}
            />
            {/* "Yeni" değil "eklenen": toplu Excel aktarımı da kayıt tarihine göre buraya düşer. */}
            <SummaryTile
              icon={UserPlus}
              tone="text-emerald-600 bg-emerald-50"
              label="Bu Ay Eklenen Müşteri"
              value={summary.newThis.toLocaleString('tr-TR')}
              // Negatif değişimde "↑ %-50 artış" yazılmasın: yön ve kelime birlikte değişir.
              sub={summary.growth !== null
                ? `${summary.growth >= 0 ? '↑' : '↓'} %${Math.abs(summary.growth)} ${summary.growth >= 0 ? 'artış' : 'azalış'} · geçen ay ${summary.newPrev.toLocaleString('tr-TR')}`
                : `Geçen ay ${summary.newPrev.toLocaleString('tr-TR')} müşteri eklendi`}
              subTone={summary.growth === null ? undefined : summary.growth >= 0 ? 'text-emerald-600' : 'text-[#cf4d68]'}
            />
            <SummaryTile
              icon={PieChart}
              tone="text-violet-600 bg-violet-50"
              label="Borçlu Müşteri Oranı"
              value={`%${summary.debtorPct}`}
              sub={`${summary.debtors.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} müşteri`}
            />
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

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="customer"
        onDone={() => void reloadWithSessions()}
      />

      {/* Toplu işlem çubuğu — seçim yapılınca ekranın altında belirir (silme + KVKK mesajı). */}
      {canSelectRows && (
      <BulkSelectBar
        api={bulk}
        itemLabel="müşteri"
        pageIds={pageRows.map((c) => c.id)}
        allowDelete={canBulkDelete}
        actions={bulkActions}
        onDelete={(id) => adminApi.deleteCustomer(id, tenantId)}
        onDone={() => reloadWithSessions()}
      />
      )}
    </>
  )
}

// `control`: değerin yanında duran küçük kumanda (ör. ortalama harcamanın dönem seçimi).
// Başlık satırı yerine değer satırına konur — başlık mono/tracking-widest olduğu için
// 4 kolonlu ızgarada seçiciyle yan yana sığmıyor, kırpılıyordu.
function SummaryTile({ icon: Icon, tone, label, value, sub, subTone, control }: { icon: typeof Users; tone: string; label: string; value: string; sub: string; subTone?: string; control?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/60 bg-white px-4 py-3.5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">{label}</div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-display text-lg tracking-tight text-[#352432]">{value}</div>
          {control}
        </div>
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
