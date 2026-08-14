'use client'

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import CustomerFormDialog from '@/components/dashboard/CustomerFormDialog'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import ImportDialog from '@/components/dashboard/ImportDialog'
import CustomerDetailModal from '@/components/dashboard/CustomerDetailModal'
import { useFeature } from '@/components/dashboard/FeatureContext'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import BulkSelectBar, { SelectBox, useBulkSelect, type BulkAction } from '@/components/dashboard/BulkSelectBar'
import CustomerSalesPanel from '@/components/dashboard/CustomerSalesPanel'
import PassiveCustomersPanel from '@/components/dashboard/PassiveCustomersPanel'
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
  ChevronLeft, ChevronRight, CreditCard, Crown, FileUp,
  Mail, MessageCircle, Phone, PenLine, PieChart, Search, ShieldAlert, ShieldCheck, Sparkles,
  UserPlus, UserRound, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import type { ApiAppointment, ApiCustomer, ApiCustomerAccount, ApiCustomerSpendingStats, ApiCustomerStats, ApiService, ApiServicePackage, ApiStaff, Customer, CustomerGender, PagedResult } from '@/lib/types'

interface CustomerFormValues {
  fullName?: string; phone?: string; email?: string; birthDate?: string
  gender?: CustomerGender; kvkkConsent?: boolean; notes?: string; branchId?: string; photoUrl?: string
  /** "Eski müşterim" akışının kayıt tarihi (yerel gün) — bkz. CustomerFormDialog. */
  registeredAt?: string
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

// ---------------------------------------------------------------------------
// PANO KART DİLİ (bkz. /panel → "Dashboard paleti", globals.css)
//   #A5556E plum · #F9A1B9 pink · #1E4E8C blue · #8E7882 mauve · #1E8C60 yeşil · #F7F6F6 paper
// Kural: kart YÜZÜ beyaz, kuyu/inset yüzeyler paper, renk doygun aksandan gelir (tint yok).
// Yeşil PARA rengidir — yalnız tahsilat/harcama kartında kullanılır.
// Tonlar panodaki `toneSurface`/`toneChip` haritalarının birebir aynısıdır; ikisi bilerek
// yerel tutulur (pano da kendi kopyasını taşır — tek dosyada kalsın diye kit'e çıkarılmadı).
// ---------------------------------------------------------------------------
type Tone = 'rose' | 'gold' | 'mint' | 'violet' | 'peach'

// Menekşe/yeşil bir tık koyu: üzerindeki küçük beyaz metin AA (4,5:1) sağlasın
// (bkz. `PanelKit.toneSurface` — aynı gerekçe ve ölçümler).
const toneSurface: Record<Tone, string> = {
  rose: 'bg-[#A5556E]', gold: 'bg-[#1D865C]', mint: 'bg-[#1E4E8C]', violet: 'bg-[#85717A]', peach: 'bg-[#F9A1B9]',
}
const toneOnBand: Record<Tone, string> = {
  rose: 'text-white', gold: 'text-white', mint: 'text-white', violet: 'text-white', peach: 'text-[#5A1730]',
}
const toneChip: Record<Tone, string> = {
  rose: 'bg-white/20 text-white', gold: 'bg-white/20 text-white', mint: 'bg-white/20 text-white',
  violet: 'bg-white/20 text-white', peach: 'bg-white/45 text-[#5A1730]',
}
const toneStroke: Record<Tone, string> = {
  rose: '#A5556E', gold: '#1E8C60', mint: '#1E4E8C', violet: '#8E7882', peach: '#E4577F',
}

// Panelin ortak kart dili: BEYAZ yüzey, üstte marka hairline'ı, hover'da derinleşen gölge.
const cardShell =
  'relative overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_22px_58px_-38px_rgba(87,39,61,0.55)] transition-shadow hover:shadow-[0_28px_66px_-34px_rgba(87,39,61,0.6)]'

/** Kartın üst kenarındaki marka çizgisi — pembe → bordo → pembe. */
function BrandHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
      style={{ background: 'linear-gradient(90deg, transparent, #F9A1B9 20%, #A5556E 50%, #F9A1B9 80%, transparent)' }}
    />
  )
}

// Sıra gecikmesi SATIR SAYISINA GÖRE kısalır: sabit 35 ms, "50 / sayfa" seçiliyken son satırı
// 1,8 sn geciktiriyordu. Sayfa değiştirmek bu ekranın en sık işlemi — tüm kaskad ≤ ~0,45 sn.
const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: (rowCount: number) => ({
    opacity: 1,
    transition: { staggerChildren: Math.min(0.035, 0.45 / Math.max(1, rowCount)), delayChildren: 0.04 },
  }),
}
const listRow: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

const AVATAR_COLORS = ['from-[#f3a3bf] to-[#ffd9e6]', 'from-[#9c70bb] to-[#e3cdf2]', 'from-[#5aa9e6] to-[#cfe7fb]', 'from-[#54c1a0] to-[#cdeee2]', 'from-[#e6a14f] to-[#fbe6cb]', 'from-[#e0617f] to-[#fbd2dc]']
function avatarColor(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length] }
function initials(name: string): string { const p = name.trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase() }

// Modal "Hızlı İşlemler" içindeki satış (paket/hizmet/ürün) tetikleyici buton stili.
const SALE_TRIGGER_CLS = 'flex w-full cursor-pointer items-center gap-2 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5 text-[12px] font-medium text-[#3E343A] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]'

function weeklySeries(times: number[], weeks = 12): number[] {
  const now = Date.now(); const wk = 7 * 86_400_000; const start = now - weeks * wk
  const b = Array(weeks).fill(0)
  for (const t of times) { if (t < start || t > now) continue; b[Math.min(weeks - 1, Math.floor((t - start) / wk))]++ }
  return b
}

/** Kartın altını boydan boya kaplayan yumuşak alan grafiği (pano `AreaSpark` dili). */
function AreaSpark({ values, tone }: { values: number[]; tone: Tone }) {
  const max = Math.max(1, ...values)
  const line = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${30 - (v / max) * 25}`).join(' ')
  const stroke = toneStroke[tone]
  const gid = `musteri-spark-${tone}`
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.30" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${line} 100,30`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Üst KPI kartı — panodaki `MetricCard` ile aynı iskelet: renkli başlık bandı (paletin
 * DOĞRUDAN rengi), beyaz gövdede büyük rakam, altta dönemin gerçek serisi.
 *
 * Seri YALNIZ anlamlı olduğu kartta verilir: "yeni kayıt" eğrisini borç kartının altına
 * çizmek, borcun o eğriyi izlediği izlenimini veriyordu.
 */
function StatCard({ icon: Icon, tone, label, value, detail, series, danger, index }: {
  icon: LucideIcon
  tone: Tone
  label: string
  value: string
  detail: string
  series?: number[]
  danger?: boolean
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className={`${cardShell} group flex flex-col`}
    >
      <BrandHairline />
      <div className={`relative flex items-center gap-2.5 ${toneSurface[tone]} ${toneOnBand[tone]} px-4 py-3`}>
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/20 blur-2xl transition-transform duration-500 group-hover:scale-125" />
        <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[12px] shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)] transition-transform duration-300 group-hover:scale-105 ${toneChip[tone]}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        <span className="relative text-[10.5px] font-semibold uppercase leading-tight tracking-[0.1em]">{label}</span>
      </div>
      <div className="relative flex-1 px-4 pb-3.5 pt-3">
        <div className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${danger ? 'text-[#B23252]' : 'text-[#2A2027]'}`}>
          {value}
        </div>
        <div className="mt-2 inline-block max-w-full truncate rounded-full bg-[#F7F6F6] px-2 py-0.5 text-[10.5px] font-medium text-[#5A4B53]">
          {detail}
        </div>
      </div>
      {series && series.length > 1 && (
        <div className="relative h-[46px] w-full">
          <AreaSpark values={series} tone={tone} />
        </div>
      )}
    </motion.div>
  )
}

interface Enriched extends Customer { debt: number; spent: number; apptCount: number; lastService: string; lastDate: string; lastTime: number; tags: string[] }

function ageOf(birth: string): number | null {
  const d = new Date(birth); if (Number.isNaN(d.getTime())) return null
  const a = (Date.now() - d.getTime()) / (365.25 * 86_400_000)
  return a > 0 && a < 120 ? Math.floor(a) : null
}

// Satır ızgarası tek yerde: başlık şeridi ile satırlar ASLA ayrışmasın.
// 14" MacBook (≈1512px, kenar çubuğu düşünce ~1200px) hedef alındı: yedi kolon yerine beş
// kolon + detay oku var, etiketler isim altına indi — kırpma/ezilme yerine nefes alan satır.
const ROW_GRID = 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(0,0.8fr)_28px]'

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

  const statCards: { icon: LucideIcon; tone: Tone; label: string; value: string; detail: string; series?: number[]; danger?: boolean }[] = [
    {
      icon: UserRound, tone: 'rose', label: 'Toplam müşteri',
      value: total.toLocaleString('tr-TR'),
      detail: selectedBranch?.name || 'Tüm şubeler',
      series: newSeries,
    },
    {
      icon: UserPlus, tone: 'mint', label: 'Son 90 günde eklenen',
      value: newIn90.toLocaleString('tr-TR'),
      detail: `Bu ay ${summary.newThis.toLocaleString('tr-TR')} kayıt`,
      series: newSeries,
    },
    {
      icon: ShieldAlert, tone: 'peach', label: 'KVKK onaysız',
      value: kvkkMissing.toLocaleString('tr-TR'),
      detail: `${Math.max(0, total - kvkkMissing).toLocaleString('tr-TR')} müşteri onaylı`,
    },
    {
      icon: Wallet, tone: 'violet', label: 'Açık borç',
      value: formatTL(Math.round(debtTotal)),
      detail: `${summary.debtors.toLocaleString('tr-TR')} borçlu müşteri`,
      danger: debtTotal > 0,
    },
  ]

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
      // Peşinat: taksit planı "toplam − peşinat"ı böler; satış tarihiyle tahsilat yazılır.
      depositAmount: values.depositAmount,
      firstDueDate: values.firstDueDate,
      // Ödeme geçmişi: kaç taksit ödenmiş + yöntem. Backend ödenen ayları KENDİ VADE
      // TARİHLERİYLE tahsilat yazar → geçmiş satış geçmiş cariye de düşer.
      paidInstallmentCount: values.paidInstallmentCount,
      paymentMethod: values.paymentMethod,
      // Seansı kim yaptı + yapılan seanslar randevu geçmişine işlensin mi.
      appliedByStaffMemberId: values.appliedByStaffMemberId,
      createSessionAppointments: values.createSessionAppointments,
      sessionIntervalDays: values.sessionIntervalDays,
      // Seans seans tarih/personel (opsiyonel) — verilmezse sunucu eşit aralık + tek personele düşer.
      sessions: values.sessions,
      notes: values.notes,
      branchId: branchId ?? null,
      // Personel satışın şubesinde çalışmıyorsa sunucu reddeder; kullanıcı modaldeki onay
      // kutusuyla "o tarihte bu şubedeydi" dediğinde geçer (bkz. AllowCrossBranchStaff).
      allowCrossBranchStaff: values.allowCrossBranchStaff,
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
    // "Eski müşterim": girilen yerel gün, günün ORTASI olarak UTC'ye çevrilir (geçmiş satış
    // girişiyle aynı kural) — böylece kayıt saat farkından bir önceki güne düşmez.
    // Alan yalnız yeni kayıtta dolar; güncellemede sunucu zaten yok sayar.
    ...(values.registeredAt ? { registeredAtUtc: new Date(`${values.registeredAt}T12:00:00`).toISOString() } : {}),
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

  const filtersDirty = tab !== 'all' || q !== '' || sort !== 'recent'
  // Satır animasyonu filtre/sayfa değişiminde yeniden oynasın diye listeye kimlik verilir.
  const rowsKey = `${tab}-${sort}-${page}-${debouncedQ}`
  const rangeStart = filteredTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, filteredTotal)

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
                  className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-[#A5556E] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(87,39,61,0.95)] transition-all hover:-translate-y-0.5 hover:bg-[#8C4460]">
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
              className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#EAD8DF] bg-white px-4 py-2 text-[12px] font-semibold text-[#8C4460] transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6]"
            >
              <FileUp className="h-4 w-4" strokeWidth={2.1} /> İçeri Aktar
            </button>
          </div>
        }
      />

      {/* Geniş ekranda içerik ortalanır: 14"da kenar boşluğu ince kalır, 27"da satır
          sonsuza uzamaz (uzun satır göz takibini bozuyordu). */}
      <div className="relative mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6 xl:px-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && total === 0} emptyMessage="Henüz müşteri kaydı yok. “Yeni Müşteri” ile ilkini ekleyebilirsin." />
        <AnimatePresence>
          {(actionError || actionMsg) && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={`rounded-[14px] border px-4 py-2.5 text-[12px] ${actionError ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}
            >
              {actionError || actionMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- KPI KARTLARI (pano dili: renkli bant + beyaz gövde + alan grafiği) ---- */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card, index) => (
            <StatCard key={card.label} index={index} {...card} />
          ))}
        </div>

        {/* ---- ARAÇ ÇUBUĞU: sekmeler + arama + sıralama ---- */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className={`${cardShell} p-3 sm:p-4`}
        >
          <BrandHairline />
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            {/* Sekmeler: seçili çip altındaki dolgu layoutId ile kayarak geçer. */}
            <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 2xl:mx-0 2xl:overflow-visible 2xl:px-0 2xl:pb-0">
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-1">
                {visibleTabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className="relative shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
                  >
                    {tab === t.key && (
                      <motion.span
                        aria-hidden
                        layoutId="musteriler-tab-pill"
                        className="absolute inset-0 rounded-full bg-[#A5556E] shadow-[0_8px_18px_-12px_rgba(87,39,61,0.9)]"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className={`relative ${tab === t.key ? 'text-white' : 'text-[#74616A] hover:text-[#2A2027]'}`}>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ad, telefon veya e-posta ara"
                  aria-label="Müşteri ara"
                  className="w-full rounded-[12px] border border-[#E4DEE0] bg-[#F7F6F6] py-2 pl-9 pr-8 text-[12px] text-[#2A2027] outline-none transition-colors placeholder:text-[#74616A] focus:border-[#A5556E] focus:bg-white sm:w-[260px]"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    aria-label="Aramayı temizle"
                    className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#8C4460]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sıralama"
                className="rounded-[12px] border border-[#E4DEE0] bg-[#F7F6F6] px-2.5 py-2 text-[12px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E] focus:bg-white"
              >
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <AnimatePresence>
                {filtersDirty && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    type="button"
                    onClick={() => { setTab('all'); setQ(''); setSort('recent') }}
                    className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Filtreleri temizle
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* ---- LİSTE ---- */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={cardShell}
        >
          <BrandHairline />
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#F9A1B9]/30 blur-3xl" />

          <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-5 sm:px-5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[#2A2027]">
                <span aria-hidden className="h-4 w-[3px] rounded-full bg-gradient-to-b from-[#F9A1B9] to-[#A5556E]" />
                Müşteri Listesi
                {/* Sayaç SUNUCU TOPLAMIDIR: burada sayfadaki satır adedi yazınca 12 bin
                    müşterili kurumda "10 kayıt" görünüyordu. */}
                <span className="rounded-full bg-[#F7F6F6] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#8C4460]">
                  {filteredTotal.toLocaleString('tr-TR')}
                </span>
              </h2>
              <p className="mt-0.5 text-[11px] text-[#74616A]">
                {filtersDirty ? 'Süzülmüş liste · satıra tıklayın, danışan kartı açılır' : 'Satıra tıklayın, danışan kartı açılır'}
              </p>
            </div>
            {canSelectRows && pageRows.length > 0 && (
              <span className="hidden rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-1.5 text-[10.5px] font-semibold text-[#5A4B53] lg:inline">
                Toplu işlem için kutucukları işaretleyin
              </span>
            )}
          </div>

          {tab === 'passive' ? (
            <div className="relative p-4 sm:p-5">
              <PassiveCustomersPanel tenantId={tenantId} onSelect={(id) => { setTab('all'); setSelectedId(id) }} />
            </div>
          ) : (
            <>
              {/* Kaydırma KUTUNUN İÇİNDE: başlık şeridi yapışkan kalsın diye kaydırma kabı
                  açıkça burada tanımlanır (sayfa kaydırmasına bırakılırsa `sticky` üstteki
                  overflow-hidden kabuk yüzünden tutmuyor). Telefonda doğal akış korunur. */}
              <div className="relative border-t border-[#EAD8DF] lg:max-h-[68vh] lg:overflow-y-auto">
                <div className={`sticky top-0 z-10 hidden gap-3 border-b border-[#EAD8DF] bg-[#F7F6F6]/95 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-[#5A4B53] backdrop-blur lg:grid sm:px-5 ${ROW_GRID}`}>
                  <span>Müşteri</span><span>İletişim</span><span>KVKK</span><span>Son işlem</span><span className="text-right">Borç</span><span />
                </div>

                {loading && pageRows.length === 0 ? (
                  <div className="divide-y divide-[#F1E7EB]">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                        <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[#F1E7EB]" />
                        <span className="h-3.5 flex-1 animate-pulse rounded-full bg-[#F1E7EB]" />
                        <span className="hidden h-3.5 w-24 animate-pulse rounded-full bg-[#F1E7EB] lg:block" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <motion.div key={rowsKey} custom={pageRows.length} variants={listContainer} initial="hidden" animate="visible" className="divide-y divide-[#F1E7EB]">
                    {pageRows.map((c) => {
                      const isSelected = bulk.isSelected(c.id)
                      return (
                        <motion.button
                          key={c.id}
                          variants={listRow}
                          type="button"
                          onClick={() => {
                            // Seçim modundayken satır tıklaması detay açmaz, seçimi değiştirir.
                            if (canSelectRows && bulk.active) { bulk.toggle(c.id); return }
                            setSelectedId(c.id); setModalOpen(true)
                          }}
                          className={`group grid w-full grid-cols-1 gap-2.5 px-4 py-3.5 text-left transition-colors sm:px-5 lg:items-center lg:gap-3 lg:py-3 ${ROW_GRID} ${
                            isSelected ? 'bg-[#F6DFE6]' : 'hover:bg-[#FBF5F7]'
                          }`}
                        >
                          {/* Müşteri — avatar · ad · etiketler (VIP/son hizmet isim altında) */}
                          <div className="flex min-w-0 items-center gap-2.5">
                            {canSelectRows && <SelectBox checked={isSelected} onToggle={() => bulk.toggle(c.id)} />}
                            {c.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.photoUrl} alt={c.name} className="h-10 w-10 shrink-0 rounded-full border border-[#EAD8DF] object-cover" />
                            ) : (
                              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarColor(c.name)} text-[12px] font-semibold text-[#3a1a2a]`}>
                                {initials(c.name)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-[#2A2027]">{c.name}</span>
                                {c.isVip && (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#8E7882] px-1.5 py-[1px] text-[10px] font-bold text-white">
                                    <Crown className="h-2.5 w-2.5" /> VIP
                                  </span>
                                )}
                                {c.isBlacklisted && (
                                  <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-[1px] text-[10px] font-bold text-rose-700">Kara liste</span>
                                )}
                              </div>
                              {/* Telefon YALNIZ "İletişim" kolonunda: isim altına da yazınca
                                  telefonda aynı numara iki kez alt alta çıkıyordu. */}
                              <div className="truncate text-[10.5px] text-[#74616A]">
                                {c.lastService !== '—' ? c.lastService : 'İşlem geçmişi yok'}
                              </div>
                            </div>
                          </div>

                          {/* İletişim */}
                          <div className="min-w-0 space-y-0.5 text-[11px] text-[#5A4B53]">
                            <div className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 shrink-0 text-[#A5556E]" />
                              <span className="truncate">{c.phone}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3 w-3 shrink-0 text-[#A5556E]" />
                              <span className="truncate">{c.email || '—'}</span>
                            </div>
                          </div>

                          {/* KVKK — durum rengi bilerek palet dışıdır (yeşil/amber evrensel okuma) */}
                          <div>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              c.tier === 'KVKK Onaylı'
                                ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                : 'border-amber-300 bg-amber-100 text-amber-800'
                            }`}>
                              {c.tier === 'KVKK Onaylı' ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                              {c.tier === 'KVKK Onaylı' ? 'Onaylı' : 'Onaysız'}
                            </span>
                          </div>

                          {/* Son işlem */}
                          <div className="min-w-0 text-[11px] text-[#5A4B53]">
                            <div className="tabular-nums text-[#2A2027]">{c.lastDate || '—'}</div>
                            <div className="text-[10.5px] text-[#74616A]">
                              {c.apptCount > 0 ? `${c.apptCount} randevu` : 'Randevu yok'}
                            </div>
                          </div>

                          {/* Borç */}
                          <div className={`text-[13px] font-semibold tabular-nums lg:text-right ${c.debt > 0 ? 'text-[#B23252]' : 'text-[#74616A]'}`}>
                            {formatTL(c.debt)}
                          </div>

                          {/* Detay oku — satırın tıklanabilir olduğunu söyler */}
                          <div className="hidden justify-end lg:flex">
                            <ChevronRight className="h-4 w-4 text-[#BE7690] transition-transform duration-200 group-hover:translate-x-0.5" />
                          </div>
                        </motion.button>
                      )
                    })}

                    {!pageRows.length && (
                      <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F7F6F6] text-[#A5556E]">
                          <Users className="h-5 w-5" />
                        </span>
                        <div className="mt-3 text-[13px] font-semibold text-[#2A2027]">
                          {filtersDirty ? 'Filtreyle eşleşen müşteri yok' : 'Müşteri kaydı yok'}
                        </div>
                        <div className="mt-1 text-[11px] text-[#74616A]">
                          {filtersDirty ? 'Aramayı sadeleştirin ya da filtreleri temizleyin.' : '“Yeni müşteri” ile ilk kaydı ekleyebilirsiniz.'}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>

              {/* ---- SAYFALAMA ---- */}
              {filteredTotal > 0 && (
                <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-[#EAD8DF] px-4 py-3.5 sm:px-5">
                  <div className="text-[11px] text-[#74616A] tabular-nums">
                    {rangeStart} – {rangeEnd} / {filteredTotal.toLocaleString('tr-TR')} kayıt
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} aria-label="Önceki sayfa"
                      className="grid h-8 w-8 place-items-center rounded-full border border-[#E4DEE0] bg-white text-[#8C4460] transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {pageNumbers.map((p, i) => p === '...' ? (
                      <span key={`e${i}`} className="px-1 text-[12px] text-[#74616A]">…</span>
                    ) : (
                      <button key={p} type="button" onClick={() => goPage(p)}
                        className={`grid h-8 min-w-8 place-items-center rounded-full border px-2 text-[12px] font-semibold tabular-nums transition-colors ${
                          p === page ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#E4DEE0] bg-white text-[#5A4B53] hover:bg-[#F6DFE6]'
                        }`}>
                        {p}
                      </button>
                    ))}
                    <button type="button" onClick={() => goPage(page + 1)} disabled={page >= totalPages} aria-label="Sonraki sayfa"
                      className="grid h-8 w-8 place-items-center rounded-full border border-[#E4DEE0] bg-white text-[#8C4460] transition-all hover:-translate-y-0.5 hover:border-[#BE7690] hover:bg-[#F6DFE6] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Sayfa başına kayıt"
                      className="ml-2 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-2.5 py-1.5 text-[11px] text-[#5A4B53] outline-none focus:border-[#A5556E]">
                      {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / sayfa</option>)}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.section>

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
              // Fazla ödeme yalnız modalde onaylandıysa geçer (bkz. RegisterPaymentAsync).
              allowOverpayment: payload.allowOverpayment,
            }, tenantId, payload.idempotencyKey))
          }}
          /* "İptali geri al" — Ön Muhasebe'deki uç ve akışın aynısı: cari, taksit, tahsilat ve
             seanslar arşiv yedeğinden yeniden kurulur. Düğme personelde de görünür; yazma
             sayfanın diğer işlemleriyle aynı yoldan (performWrite) geçtiği için personelde
             doğrudan işlenmez, onay kuyruğuna düşer ve kullanıcı bunu ekranda görür. */
          onRestoreCancelledSale={async (originalAccountId, voidRefund, voidReason) => {
            await runSaleAction(async () => {
              const res = await performWrite({
                // operationType verilmez: onay kaydının türünü backend kapısı üretir ve
                // "RestoreSale" diye bir istemci anahtarı yok (bkz. PendingOperationTypeKey).
                title: `İptali geri al: ${selected?.name || '—'}`,
                summary: voidRefund ? 'iade de geri alınacak' : '',
                payload: { accountId: originalAccountId, voidRefund, voidReason: voidReason ?? null },
                tenantId,
                directAction: () => adminApi.restoreSale(originalAccountId, tenantId, voidRefund, { voidReason }),
              })
              if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('İptali geri alma'))
            })
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
                  className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#5A4B53] transition-colors hover:border-[#BE7690] hover:text-[#8C4460]">
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

        {/* ---- MÜŞTERİ ÖZETİ ---- */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className={`${cardShell} p-4 sm:p-5`}
        >
          <BrandHairline />
          <div className="relative">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[#2A2027]">
              <span aria-hidden className="h-4 w-[3px] rounded-full bg-gradient-to-b from-[#F9A1B9] to-[#A5556E]" />
              Müşteri Özeti
            </h2>
            <p className="mt-0.5 text-[11px] text-[#74616A]">Kurum geneli — sekme/arama filtresinden bağımsız</p>
          </div>
          <div className="relative mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {/* Yaş aralığı: doğum tarihi OLAN müşterilerden hesaplanır — dayanak sayısı da yazılır. */}
            <SummaryTile
              icon={Users}
              tone="rose"
              label="En yaygın yaş aralığı"
              value={summary.ageKnown > 0 ? summary.topSeg : '—'}
              sub={summary.ageKnown > 0
                ? `%${summary.segPct} · doğum tarihi girili ${summary.ageKnown.toLocaleString('tr-TR')} müşteri`
                : 'Doğum tarihi girilmiş müşteri yok'}
            />
            {/* Ortalama harcamanın DÖNEMİ kartın üzerinden seçilir; ölçüt tahsilat tarihidir
                (geçmiş bir satışın bu ay ödenen taksiti de bu aya düşer). Ortalama, o dönemde
                harcaması OLAN müşteriler üzerinden alınır — ödeme yapmayanlar bastırmasın.
                Ton YEŞİL: paletin para rengi (tahsilat). */}
            <SummaryTile
              icon={CreditCard}
              tone="gold"
              label="Ortalama harcama"
              value={summary.spenders > 0 ? formatTL(Math.round(summary.avgSpent)) : '—'}
              sub={summary.spenders > 0
                ? `Harcaması olan ${summary.spenders.toLocaleString('tr-TR')} müşteri`
                : spendDays === null ? 'Henüz tahsilat yok' : 'Bu dönemde tahsilat yok'}
              control={(
                <select
                  value={spendPeriod}
                  onChange={(e) => setSpendPeriod(e.target.value)}
                  aria-label="Ortalama harcama dönemi"
                  className="shrink-0 rounded-full border border-[#E4DEE0] bg-[#F7F6F6] px-2 py-1 text-[10px] text-[#5A4B53] outline-none focus:border-[#A5556E]">
                  {SPEND_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              )}
            />
            {/* "Yeni" değil "eklenen": toplu Excel aktarımı da kayıt tarihine göre buraya düşer. */}
            <SummaryTile
              icon={UserPlus}
              tone="mint"
              label="Bu ay eklenen müşteri"
              value={summary.newThis.toLocaleString('tr-TR')}
              // Negatif değişimde "↑ %-50 artış" yazılmasın: yön ve kelime birlikte değişir.
              sub={summary.growth !== null
                ? `${summary.growth >= 0 ? '↑' : '↓'} %${Math.abs(summary.growth)} ${summary.growth >= 0 ? 'artış' : 'azalış'} · geçen ay ${summary.newPrev.toLocaleString('tr-TR')}`
                : `Geçen ay ${summary.newPrev.toLocaleString('tr-TR')} müşteri eklendi`}
              subTone={summary.growth === null ? undefined : summary.growth >= 0 ? 'text-[#15694A]' : 'text-[#B23252]'}
            />
            <SummaryTile
              icon={PieChart}
              tone="violet"
              label="Borçlu müşteri oranı"
              value={`%${summary.debtorPct}`}
              sub={`${summary.debtors.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} müşteri`}
            />
          </div>
        </motion.section>
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
// Başlık satırı yerine değer satırına konur — başlık uppercase/tracking olduğu için
// 4 kolonlu ızgarada seçiciyle yan yana sığmıyor, kırpılıyordu.
function SummaryTile({ icon: Icon, tone, label, value, sub, subTone, control }: {
  icon: LucideIcon
  tone: Tone
  label: string
  value: string
  sub: string
  subTone?: string
  control?: ReactNode
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="group relative flex items-center gap-3 overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white px-4 py-3.5 shadow-[0_16px_40px_-32px_rgba(87,39,61,0.6)]"
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-[#F9A1B9]/25 blur-2xl transition-transform duration-500 group-hover:scale-125" />
      <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] ${toneSurface[tone]} ${toneOnBand[tone]} shadow-[0_12px_24px_-16px_rgba(42,32,39,0.8)]`}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <div className="relative min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[#74616A]">{label}</div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-[#2A2027]">{value}</div>
          {control}
        </div>
        <div className={`truncate text-[10px] ${subTone || 'text-[#74616A]'}`}>{sub}</div>
      </div>
    </motion.div>
  )
}

export default function MusterilerPage() {
  return (
    <Suspense fallback={null}>
      <MusterilerPageInner />
    </Suspense>
  )
}
