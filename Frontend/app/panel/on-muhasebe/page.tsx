'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import CollectionDialog, { type CollectionSubmitPayload } from '@/components/dashboard/CollectionDialog'
import NewAccountDialog from '@/components/dashboard/NewAccountDialog'
import SalaryPaymentDialog from '@/components/dashboard/SalaryPaymentDialog'
import AccountDetailModal from '@/components/dashboard/AccountDetailModal'
import CustomerLedgerModal from '@/components/dashboard/CustomerLedgerModal'
import CariSalesWorkspace from '@/components/dashboard/CariSalesWorkspace'
import ModalPortal from '@/components/dashboard/ModalPortal'
import CustomerPicker, { type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'
import CancelledSalesModal, { type CancelledTab } from '@/components/dashboard/CancelledSalesModal'
import AdisyonModal from '@/components/dashboard/AdisyonModal'
import AdisyonReceiptModal from '@/components/dashboard/AdisyonReceiptModal'
import DailyAdisyonModal from '@/components/dashboard/DailyAdisyonModal'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import ExpenseFormDialog, { type ExpenseFormDialogValues } from '@/components/dashboard/ExpenseFormDialog'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi, ApiClientError } from '@/lib/apiClient'
import { activeInstallments, groupAccountsByCustomer } from '@/lib/accountGrouping'
import { customerSearchProvider } from '@/components/dashboard/CustomerPicker'
import {
  apiItems, expenseCategoryLabels, formatTL, guidOrUndefined, mapCancelledSale, normalizeAccount, normalizeAdisyon,
  normalizeAppointment, normalizeCustomCategory, normalizeCustomer, normalizeExpense, normalizePackage, normalizeService, normalizeStaff,
  paymentMethodLabel,
} from '@/lib/apiMappers'
import {
  Ban, Banknote, Boxes, Briefcase, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  CreditCard, History, Landmark, Megaphone, Package, PieChart, Plus, Printer, Receipt, ReceiptText, Search,
  Trash2, TrendingDown, TrendingUp, Undo2, Users, Wallet, Wrench, Zap,
} from 'lucide-react'
import type {
  Adisyon, ApiAdisyon, ApiAppointment, ApiBusinessExpense, ApiCustomExpenseCategory, ApiCustomer,
  ApiCustomerAccount, ApiService, ApiServicePackage, ApiStaff, BusinessExpense, CustomerAccount, CustomExpenseCategory,
  ExpensePaymentMethodKey,
} from '@/lib/types'

type TabKey = 'overview' | 'adisyon' | 'accounts' | 'expenses' | 'salary'
type ScopeKey = TabKey | 'upcoming' | 'overdue'

const TAB_OF_SCOPE: Record<ScopeKey, TabKey> = {
  overview: 'overview', adisyon: 'adisyon', accounts: 'accounts',
  upcoming: 'accounts', overdue: 'accounts', expenses: 'expenses', salary: 'salary',
}
const TABS: { key: TabKey; label: string; icon: typeof Wallet }[] = [
  { key: 'overview', label: 'Genel Bakış', icon: PieChart },
  { key: 'adisyon', label: 'Adisyon', icon: ReceiptText },
  { key: 'accounts', label: 'Cari Hesaplar', icon: CreditCard },
  { key: 'expenses', label: 'Giderler', icon: TrendingDown },
  { key: 'salary', label: 'Personel Maaşları', icon: Users },
]
const TR_MONTHS = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK']
const METHOD_LABEL: Record<ExpensePaymentMethodKey, string> = { Cash: 'Nakit', Card: 'Kart', BankTransfer: 'Havale / EFT', Check: 'Çek' }

/** Gider kategorisi başına ikon + renk — liste ve dağılım tek dille okunsun. */
const EXPENSE_ICONS: Record<string, typeof Wallet> = {
  Salary: Users, Tax: Landmark, Rent: Building2, Utilities: Zap, Supplies: Package,
  Inventory: Boxes, Marketing: Megaphone, Maintenance: Wrench, Professional: Briefcase,
  Equipment: Printer, Office: Printer, Other: Receipt,
}
const EXPENSE_TONES: Record<string, string> = {
  Salary: 'bg-violet-50 text-violet-600', Tax: 'bg-slate-100 text-slate-600',
  Rent: 'bg-amber-50 text-amber-700', Utilities: 'bg-sky-50 text-sky-600',
  Supplies: 'bg-teal-50 text-teal-600', Inventory: 'bg-indigo-50 text-indigo-600',
  Marketing: 'bg-fuchsia-50 text-fuchsia-600', Maintenance: 'bg-orange-50 text-orange-600',
  Professional: 'bg-emerald-50 text-emerald-600', Equipment: 'bg-cyan-50 text-cyan-600',
  Office: 'bg-rose-50 text-rose-600', Other: 'bg-[#fff1f6] text-[#c85776]',
}

const TR_MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** "2026-08-14" → "14 Ağu 2026" (cari kartındaki vade etiketi). */
function shortDay(iso: string | null | undefined): string {
  const [y, m, d] = (iso || '').slice(0, 10).split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${TR_MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

function MiniBars({ values, tone = '#e0617f' }: { values: number[]; tone?: string }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {values.map((v, i) => (
        <span key={i} className="w-[5px] rounded-t-sm" style={{ height: `${Math.max(10, (v / max) * 100)}%`, backgroundColor: tone, opacity: 0.3 + (i / values.length) * 0.7 }} />
      ))}
    </div>
  )
}

function OnMuhasebePageInner() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeParam = (search?.get('scope') as ScopeKey | null) ?? 'overview'
  const scope: ScopeKey = scopeParam in TAB_OF_SCOPE ? scopeParam : 'overview'
  const tab = TAB_OF_SCOPE[scope]

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const { isStaff, performWrite } = useStaffApproval()
  const canAdisyon = useFeature('billing.adisyon')

  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [selectedAdisyonId, setSelectedAdisyonId] = useState<string | null>(null)
  const [adisyonFilter, setAdisyonFilter] = useState<'all' | 'Open' | 'Approved' | 'Cancelled'>('all')
  const [adisyonQuery, setAdisyonQuery] = useState('')
  // Açık adisyon düzenlenebilir (AdisyonModal), kapanmış olan okunur fiş (AdisyonReceiptModal).
  const [adisyonEditOpen, setAdisyonEditOpen] = useState(false)
  const [adisyonReceiptOpen, setAdisyonReceiptOpen] = useState(false)
  const [accountFilter, setAccountFilter] = useState<'all' | 'installment' | 'upcoming' | 'overdue' | 'closed'>(scope === 'upcoming' ? 'upcoming' : scope === 'overdue' ? 'overdue' : 'all')
  const [accountQuery, setAccountQuery] = useState('')
  const [expenseQuery, setExpenseQuery] = useState('')
  const [expenseCat, setExpenseCat] = useState<'all' | string>('all')
  const [newAdisyonOpen, setNewAdisyonOpen] = useState(false)
  // Cari detay + tahsilat modalları sayfada tutulur (iç içe dialog yığınından kaçınmak için).
  const [accountDetailOpen, setAccountDetailOpen] = useState(false)
  // TEK tahsilat modalı (eski 'general' | 'monthly' ayrımı kaldırıldı).
  const [collectOpen, setCollectOpen] = useState(false)
  /**
   * Modaldeki cari seçicinin KAPSAMI. Çok satışlı müşteride "Tahsilat al" dendiğinde seçici
   * yalnız O MÜŞTERİNİN satışlarını listeler: tahsilat tek bir satışın carisine yazılır
   * (bölüştürülmez), o yüzden kullanıcı hangisi olduğunu modalde seçer.
   * null = kapsam yok, tüm cariler listelenir (kasa/randevu gibi genel girişler).
   */
  const [collectScopeIds, setCollectScopeIds] = useState<string[] | null>(null)
  /** Modal "Tümü" seçili mi açılsın (defterdeki Toplam kartından gelindiğinde). */
  const [collectAllDefault, setCollectAllDefault] = useState(false)
  const [cancelledOpen, setCancelledOpen] = useState(false)
  /** Arşiv modalı hangi sekmeyle açılacak — "İptal edilenler" / "İade edilenler" butonları. */
  const [cancelledTab, setCancelledTab] = useState<CancelledTab>('all')
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // Kullanılmış seans içeren onaylı adisyon silmede: ilk deneme engellenirse "zorla sil" onayına yükseltilir.
  const [forceDeleteAdisyon, setForceDeleteAdisyon] = useState(false)
  const [dailyOpen, setDailyOpen] = useState(false)

  useEffect(() => {
    if (scope === 'upcoming') setAccountFilter('upcoming')
    else if (scope === 'overdue') setAccountFilter('overdue')
  }, [scope])

  const { monthStart, monthEnd, monthLabel } = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
    return { monthStart: start, monthEnd: end, monthLabel: `${TR_MONTHS[start.getMonth()]} ${start.getFullYear()}` }
  }, [monthOffset])

  const { data, loading, error, reload } = useApiQuery<{
    accounts: ApiCustomerAccount[]; expenses: ApiBusinessExpense[]; adisyonlar: ApiAdisyon[]
    appts: ApiAppointment[]; customers: ApiCustomer[]; packages: ApiServicePackage[]
    staff: ApiStaff[]; expenseCats: ApiCustomExpenseCategory[]; cancelled: unknown[]
    // Geçmiş satış dialogu paketin yanında TEKİL HİZMET de seçtiriyor.
    services: ApiService[]
  }>(
    async () => {
      if (!tenantId) return { accounts: [], expenses: [], adisyonlar: [], appts: [], customers: [], packages: [], staff: [], expenseCats: [], cancelled: [], services: [] }
      const [sales, expenses, adisyonlar, appts, customers, packages, staff, expenseCats, services] = await Promise.all([
        // CANLI CARİLER + İPTAL ARŞİVİ TEK İSTEKTE, TEK ANLIK GÖRÜNTÜDEN.
        //
        // İkisi AYRI çekiliyordu; tablo müşteri bazında gruplanıp para topladığı için araya giren
        // bir iptal aynı satışı hem canlıda hem arşivde gösterip ÇİFT saydırabiliyor, ters sırada
        // ise hiçbirinde göstermeyip 0'a düşürüyordu. Sunucu ikisini tek transaction'da okur.
        //
        // Sayfalama da SUNUCUDA: uç listenin TAMAMINI döndürür ya da açıkça reddeder — bu yüzden
        // `fetchAllPaged` gerekmez (o, her sayfayı ayrı ana düşürüp yarışı geri getirirdi).
        // HATA YUTULMAZ: boş liste "cari yok" demektir, oysa gerçek "veri alınamadı"dır. Cari
        // tablosu gruplama yaptığı için eksik veri YANLIŞ TOPLAM üretir — sayfa hata göstersin
        // (useApiQuery.error) ki kullanıcı rakama güvenmesin.
        adminApi.accountsWithArchive<{
          live?: { items?: ApiCustomerAccount[] }
          cancelled?: unknown[]
        }>({}, tenantId),
        adminApi.expenses<ApiBusinessExpense>({ tenantId, fromUtc: monthStart.toISOString(), toUtc: monthEnd.toISOString(), page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        adminApi.adisyonlar<ApiAdisyon>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        // Sınırsız müşteri ölçeği: liste çekilmez, seçim sunucu aramasıyla.
        Promise.resolve<ApiCustomer[]>([]),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 100 }).catch(() => ({ items: [] })),
        adminApi.expenseCategories<ApiCustomExpenseCategory>(tenantId).catch(() => []),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
      ])
      return {
        // Canlı cariler ve iptal arşivi AYNI yanıttan çözülür (bkz. yukarıdaki uç).
        accounts: Array.isArray(sales?.live?.items) ? sales.live!.items! : [],
        expenses: apiItems(expenses), adisyonlar: apiItems(adisyonlar),
        appts: apiItems(appts), customers, packages: apiItems(packages),
        staff: apiItems(staff), expenseCats: Array.isArray(expenseCats) ? expenseCats : [],
        cancelled: Array.isArray(sales?.cancelled) ? sales.cancelled : [],
        services: apiItems(services),
      }
    },
    [tenantId, monthStart.toISOString()],
    { initialData: { accounts: [], expenses: [], adisyonlar: [], appts: [], customers: [], packages: [], staff: [], expenseCats: [], cancelled: [], services: [] } },
  )

  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const expenses = useMemo(() => (data?.expenses || []).map((e, i) => normalizeExpense(e, i)), [data])
  const adisyonlar = useMemo(() => (data?.adisyonlar || []).map((a) => normalizeAdisyon(a)), [data])
  const appts = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const customers = useMemo(() => (data?.customers || []).map((c, i) => normalizeCustomer(c, i)), [data])
  const customerSearch = useMemo(() => customerSearchProvider(tenantId), [tenantId])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])

  // --- CARİ → SATIŞ ÇALIŞMA ALANI (satış listesi / geçmiş satış / iptal) ---
  // Bu üçü şimdiye kadar yalnız müşteri kartındaydı; ön muhasebeden çalışan kişi borcunu gördüğü
  // satışı iptal etmek için müşteriler sayfasına gidip müşteriyi yeniden bulmak zorundaydı.
  const [salesCustomer, setSalesCustomer] = useState<{ id: string; name: string } | null>(null)
  const [salesPickerOpen, setSalesPickerOpen] = useState(false)
  const [pickerValue, setPickerValue] = useState('')
  const searchCustomers = useMemo(() => customerSearchProvider(tenantId), [tenantId])

  const salesStaffOptions = useMemo(() => staff.map((s) => ({ id: s.id, name: s.name })), [staff])
  const salesPackageOptions = useMemo(
    () => packages.map((p) => ({
      id: p.id, name: p.name, price: p.totalPrice, cat: p.category, sub: p.subCategory,
      meta: `${formatTL(p.totalPrice)} · ${p.totalSessions} seans`,
    })),
    [packages],
  )
  const salesServiceOptions = useMemo(
    () => services.map((s) => ({
      id: s.id, name: s.name, price: s.price, cat: s.group, sub: s.subGroup, meta: formatTL(s.price),
    })),
    [services],
  )
  const customExpenseCats = useMemo<CustomExpenseCategory[]>(() => (data?.expenseCats || []).map((c, i) => normalizeCustomCategory(c, i)), [data])

  // Sayfa verisi her yenilendiğinde (ör. adisyon onayı sonrası reload) artar; seans kartını taze çekmeye zorlar.
  const [sessionsTick, setSessionsTick] = useState(0)
  useEffect(() => { setSessionsTick((t) => t + 1) }, [data])

  // ---------- ortak hesaplar ----------
  const inMonth = (iso: string | null | undefined) => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t >= monthStart.getTime() && t < monthEnd.getTime()
  }
  // YEREL tarih (UTC değil) — gece yarısından sonra gün kaymasını önler (tahsilat/gider bugüne işlensin).
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

  // Ön muhasebe standardı: GELİR = fiili tahsilat (kasaya giren para). Randevu cirosu
  // tahakkuktur; cari/adisyon üzerinden tahsil edildiğinde zaten paymentsMonth'a düşer —
  // ikisini toplamak mükerrer sayım olur, bu yüzden ciro ayrı gösterilir.
  const paymentsMonth = useMemo(() => accounts.flatMap((a) => a.payments).filter((p) => inMonth(p.occurredAtUtc)).reduce((s, p) => s + p.amount, 0), [accounts, monthStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const apptRevenueMonth = useMemo(() => appts.filter((a) => a.status === 'tamamlandi' && inMonth(a.date)).reduce((s, a) => s + Number(a.price || 0), 0), [appts, monthStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const incomeMonth = paymentsMonth
  const expenseMonth = expenses.reduce((s, e) => s + e.amount, 0)
  const netMonth = incomeMonth - expenseMonth
  const openReceivable = accounts.filter((a) => a.isActive).reduce((s, a) => s + a.remainingAmount, 0)
  const activeAccountCount = accounts.filter((a) => a.isActive && a.remainingAmount > 0).length
  const overdue = useMemo(() => {
    let sum = 0; let count = 0
    // İptal edilmiş satışın taksiti "geciken bakiye" değildir — tahsil edilmeyecek.
    for (const a of accounts) { if (a.saleStatus === 'Cancelled') continue; for (const i of a.installments) if (i.overdue) { sum += i.remaining; count++ } }
    return { sum, count }
  }, [accounts, todayIso])

  const monthBars = useMemo(() => {
    const b = Array(10).fill(0)
    for (const a of accounts) for (const p of a.payments) { const t = new Date(p.occurredAtUtc); if (!Number.isNaN(t.getTime())) b[Math.min(9, Math.max(0, 9 - Math.floor((Date.now() - t.getTime()) / (7 * 86_400_000))))] += p.amount }
    return b.map((v) => v || 1)
  }, [accounts])

  const salaryExpenses = expenses.filter((e) => e.category === 'Salary')
  const rentTotal = expenses.filter((e) => e.category === 'Rent').reduce((s, e) => s + e.amount, 0)
  const utilTotal = expenses.filter((e) => e.category === 'Utilities').reduce((s, e) => s + e.amount, 0)
  const salaryTotal = salaryExpenses.reduce((s, e) => s + e.amount, 0)

  // ---------- adisyon hesapları ----------
  const adisyonStats = useMemo(() => {
    const open = adisyonlar.filter((a) => a.status === 'Open')
    const approvedMonth = adisyonlar.filter((a) => a.status === 'Approved' && inMonth(a.approvedAtUtc))
    return {
      openCount: open.length,
      openNet: open.reduce((s, a) => s + (a.chargeTotal - a.paymentTotal), 0),
      approvedCount: approvedMonth.length,
      charge: approvedMonth.reduce((s, a) => s + a.chargeTotal, 0),
      payment: approvedMonth.reduce((s, a) => s + a.paymentTotal, 0),
    }
  }, [adisyonlar, monthStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dönemdeki adisyonlar + her zaman açık olanlar (açık fiş ay değişince gözden kaybolmasın).
  const monthAdisyonlar = useMemo(
    () => adisyonlar.filter((a) => inMonth(a.openedAtUtc) || a.status === 'Open'),
    [adisyonlar, monthStart], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const adisyonCounts = useMemo(() => ({
    all: monthAdisyonlar.length,
    Open: monthAdisyonlar.filter((a) => a.status === 'Open').length,
    Approved: monthAdisyonlar.filter((a) => a.status === 'Approved').length,
    Cancelled: monthAdisyonlar.filter((a) => a.status === 'Cancelled').length,
  }), [monthAdisyonlar])

  const filteredAdisyonlar = useMemo(() => {
    let list = adisyonFilter === 'all' ? monthAdisyonlar : monthAdisyonlar.filter((a) => a.status === adisyonFilter)
    const q = adisyonQuery.trim().toLocaleLowerCase('tr')
    if (q) {
      list = list.filter((a) =>
        `${a.customerName} ${a.items.map((i) => i.description).join(' ')}`.toLocaleLowerCase('tr').includes(q))
    }
    // Açık fişler en üstte, sonra en yeni.
    return [...list].sort((a, b) => {
      const ao = a.status === 'Open', bo = b.status === 'Open'
      if (ao !== bo) return ao ? -1 : 1
      return (b.openedAtUtc || '').localeCompare(a.openedAtUtc || '')
    })
  }, [monthAdisyonlar, adisyonFilter, adisyonQuery])
  const selAdisyon = useMemo(() => adisyonlar.find((a) => a.id === selectedAdisyonId) || null, [adisyonlar, selectedAdisyonId])
  const openAdisyonDetail = (a: Adisyon): void => {
    setSelectedAdisyonId(a.id)
    if (a.status === 'Open') setAdisyonEditOpen(true)
    else setAdisyonReceiptOpen(true)
  }
  // Görüntülenen adisyon değişince "zorla sil" modunu sıfırla (bir sonraki adisyonda taze onay akışı).
  useEffect(() => { setForceDeleteAdisyon(false) }, [selAdisyon?.id])

  // ---------- iptal arşivi ----------
  // İptalde cari kaydı (taksit/tahsilat/seans dahil) canlı tablolardan SİLİNİP cancelled_sales'e
  // taşınır — finansal iz kaybolmaz, yer değiştirir. Bu yüzden iptaller `accounts` içinde aranmaz.
  const cancelledSales = useMemo(() => (data?.cancelled || []).map(mapCancelledSale), [data])

  // Adisyondan açılan satış iptal edilmişse fişte de görünsün. Eşleşme adisyon Id'si üzerinden:
  // iptalde carinin bağı koparıldığı için (satır siliniyor) customerAccountId artık null kalır.
  const cancelledSaleByAdisyonId = useMemo(() => {
    const m = new Map<string, { at: string | null; reason: string }>()
    for (const c of cancelledSales) {
      if (c.adisyonId) m.set(c.adisyonId, { at: c.cancelledAtUtc, reason: c.cancellationReason })
    }
    return m
  }, [cancelledSales])

  const cancelledCount = cancelledSales.length

  // İADE = iptal edilirken müşteriye para geri ödenmiş kayıtlar. Ayrı listede toplanır.
  const refundedSales = useMemo(() => cancelledSales.filter((c) => c.refundedAmount > 0.005), [cancelledSales])
  const refundedCount = refundedSales.length
  const refundedTotal = useMemo(() => refundedSales.reduce((s, c) => s + c.refundedAmount, 0), [refundedSales])

  // ---------- cari hesaplar ----------
  // Arşive taşıma sayesinde liste zaten temiz gelir; süzgeç, migration'ı henüz uygulanmamış
  // kurumlarda eski damgalı (CancelledAtUtc dolu) satırlara karşı savunma olarak durur.
  /**
   * CANLI CARİLER. İptal ölçütü İKİ KAYNAKTAN: `saleStatus`/`cancelledAtUtc` damgası VE iptal
   * arşivi. Yalnız damgaya bakmak, damgası eksik kalmış (eski kayıt, yarım kalmış iptal) satışı
   * canlı ve TAHSİLAT ALINABİLİR bırakıyordu — arşivde iptal görünen bir satışa para yazılabilirdi.
   */
  const cancelledAccountIds = useMemo(
    () => new Set(cancelledSales.map((c) => c.originalAccountId).filter(Boolean)),
    [cancelledSales],
  )
  const liveAccounts = useMemo(
    () => accounts.filter((a) => a.saleStatus !== 'Cancelled' && !a.cancelledAtUtc && !cancelledAccountIds.has(a.id)),
    [accounts, cancelledAccountIds],
  )

  const accountCounts = useMemo(() => ({
    all: liveAccounts.length,
    installment: liveAccounts.filter((a) => activeInstallments(a).length > 1).length,
    upcoming: liveAccounts.filter((a) => a.remainingAmount > 0.005 && !a.hasOverdue).length,
    overdue: liveAccounts.filter((a) => a.hasOverdue).length,
    closed: liveAccounts.filter((a) => a.remainingAmount <= 0.005).length,
  }), [liveAccounts])

  const filteredAccounts = useMemo(() => {
    let list = liveAccounts
    if (accountFilter === 'installment') list = list.filter((a) => a.installments.filter((i) => i.status !== 'Cancelled').length > 1)
    else if (accountFilter === 'upcoming') list = list.filter((a) => a.remainingAmount > 0.005 && !a.hasOverdue)
    else if (accountFilter === 'overdue') list = list.filter((a) => a.hasOverdue)
    else if (accountFilter === 'closed') list = list.filter((a) => a.remainingAmount <= 0.005)

    const q = accountQuery.trim().toLocaleLowerCase('tr')
    if (q) list = list.filter((a) => `${a.customerName} ${a.name} ${a.servicePackageName} ${a.customerPhone}`.toLocaleLowerCase('tr').includes(q))

    // SIRALAMA: EN YENİ CARİ HER ZAMAN EN ÜSTTE.
    //
    // Eskiden gecikenler önce, sonra açık hesaplar (en yakın vade) diye diziliyordu: yeni açılan
    // bir satış listenin ortasına düşüyor, "az önce yaptığım satış nerede" diye aranıyordu.
    // Geciken/açık/kapalı ayrımı zaten üstteki süzgeç çipleriyle (sayılarıyla birlikte) yapılıyor,
    // bu yüzden sıralamanın taşıması gereken bilgi TAZELİK.
    // Aynı anda açılan kayıtlar için vade sırası ikincil ölçüt olarak korunur.
    return [...list].sort((a, b) => {
      const at = Date.parse(a.createdAtUtc || '') || 0
      const bt = Date.parse(b.createdAtUtc || '') || 0
      if (at !== bt) return bt - at
      return (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999')
    })
  }, [liveAccounts, accountFilter, accountQuery])

  /**
   * MÜŞTERİ BAZINDA GRUPLAMA — liste satırı artık satış değil MÜŞTERİ.
   *
   * Aynı müşterinin üç satışı üç ayrı cari kartı açar (kural değişmedi: tahsilat/iptal/taksit
   * doğru satışa bağlansın diye şart). Ama ön muhasebede soru "bu müşteri ne kadar borçlu" —
   * aynı ad üç satırda üç tutarla görününce toplamı kullanıcı kafadan yapıyordu.
   * Süzgeç ÖNCE hesap düzeyinde uygulanır (çipler hesap sayar), sonra kalanlar gruplanır.
   */
  const accountGroups = useMemo(() => {
    const groups = groupAccountsByCustomer(filteredAccounts)
    return groups.sort((a, b) => {
      // Geciken müşteri üstte: ön muhasebede ilk iş "kim ödemedi" bakmaktır.
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1
      // Sonra tazelik (yeni satış hemen görünsün), eşitse en yakın vade.
      const t = b.lastSaleAtUtc.localeCompare(a.lastSaleAtUtc)
      if (t !== 0) return t
      return (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999')
    })
  }, [filteredAccounts])

  /**
   * Tablodan açılan müşteri (grup) — defter bu müşterinin TÜM satışlarını gösterir.
   *
   * DEFTER SÜZGEÇTEN BAĞIMSIZ KURULUR: grup, `filteredAccounts`'tan değil TÜM canlı carilerden
   * türetilir. Aksi hâlde "Geciken" çipi ya da arama açıkken defter yalnız EŞLEŞEN satışı
   * gösteriyor; "Toplam Satış / Tahsil Edilen / Kalan Borç" ve taksit takvimi müşterinin
   * gerçeğini değil süzgecin kalıntısını anlatıyordu (ekstre de eksik çıkıyordu).
   * İPTAL EDİLENLER de eklenir: iptal satırı canlı listede yok ama parası (tahsilat/iade)
   * defterin ekstresine ve "iptalden kalan" hesabına girmeli.
   */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const selGroup = useMemo(() => {
    if (!selectedGroupId) return null
    // Süzgeçli listeden yalnız KİMLİĞİ öğrenilir (hangi müşteri seçildi).
    const picked = accountGroups.find((g) => (g.customerId || g.accounts[0]?.id) === selectedGroupId)
    if (!picked) return null
    const all = picked.customerId
      ? liveAccounts.filter((a) => a.customerId === picked.customerId)
      : picked.accounts
    return groupAccountsByCustomer(all)[0] ?? picked
  }, [accountGroups, selectedGroupId, liveAccounts])

  /** Seçili müşterinin İPTAL arşivi — defterdeki "iptaller" bölümünün kaynağı. */
  const selGroupCancelled = useMemo(
    () => (selGroup?.customerId ? cancelledSales.filter((c) => c.customerId === selGroup.customerId) : []),
    [cancelledSales, selGroup],
  )

  const selAccount = useMemo(() => accounts.find((a) => a.id === selectedAccountId) || null, [accounts, selectedAccountId])
  const openAccount = (id: string): void => { setSelectedAccountId(id); setAccountDetailOpen(true) }

  // Cari hesap ekstresi — ön muhasebe standardı: tarih · işlem · borç · alacak · yürüyen bakiye.
  // Borç: hesap açılış tutarı + onaylı adisyon borçları. Alacak: tahsilatlar. Son bakiye = kalan borç.
  const ledger = useMemo(() => {
    if (!selAccount) return [] as { date: string; label: string; detail: string; debit: number; credit: number; balance: number }[]
    const rows: { date: string; label: string; detail: string; debit: number; credit: number }[] = []
    const linked = adisyonlar.filter((a) => a.status === 'Approved' && a.customerAccountId === selAccount.id)
    const linkedCharge = linked.reduce((s, a) => s + a.chargeTotal, 0)
    const openingDebit = Math.max(0, selAccount.totalAmount - linkedCharge)
    if (openingDebit > 0) {
      rows.push({
        date: selAccount.createdAtUtc || selAccount.installments[0]?.dueDate || '',
        label: 'Hesap açılışı',
        detail: selAccount.servicePackageName || selAccount.name,
        debit: openingDebit,
        credit: 0,
      })
    }
    for (const a of linked) {
      rows.push({
        date: a.approvedAtUtc || a.openedAtUtc || '',
        label: 'Adisyon',
        detail: a.items.filter((i) => i.type !== 'Payment').map((i) => i.description).slice(0, 3).join(', ') || `${a.items.length} kalem`,
        debit: a.chargeTotal,
        credit: 0,
      })
    }
    for (const p of selAccount.payments) {
      rows.push({
        date: p.occurredAtUtc || '',
        label: 'Tahsilat',
        // Yöntem HAM kodla ("cash") yazılıyordu — cari ekstresinde Türkçe etiket görünsün.
        detail: [p.method ? paymentMethodLabel(p.method) : '', p.reference].filter(Boolean).join(' · '),
        debit: 0,
        credit: p.amount,
      })
    }
    rows.sort((x, y) => (x.date || '').localeCompare(y.date || ''))
    let bal = 0
    return rows.map((r) => ({ ...r, balance: (bal += r.debit - r.credit) }))
  }, [selAccount, adisyonlar])

  const totalCollected = accounts.reduce((s, a) => s + a.paidAmount, 0)

  // ---------- işlemler ----------
  const goScope = (s: ScopeKey) => router.push(`/panel/on-muhasebe?scope=${s}`)

  /**
   * Bir müşterinin satışları için tahsilat modalını açar.
   *
   * Çok satışlı müşteride hangi satışın seçili GELECEĞİ önemlidir: kullanıcı "Tahsilat al"a
   * bastığında aklındaki satış neredeyse her zaman en acil olandır — gecikmişi olan, yoksa
   * vadesi en yakın, yoksa borcu en büyük olan. Kapalı satışlar seçiciye hiç girmez.
   */
  const openCollectFor = (list: CustomerAccount[]): void => {
    const open = list.filter((a) => a.remainingAmount > 0.005)
    const pool = open.length > 0 ? open : list
    if (pool.length === 0) return
    const primary = [...pool].sort((a, b) => {
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1
      const ad = a.nextDueDate || '9999-12-31'
      const bd = b.nextDueDate || '9999-12-31'
      if (ad !== bd) return ad.localeCompare(bd)
      return b.remainingAmount - a.remainingAmount
    })[0]
    setCollectScopeIds(pool.map((a) => a.id))
    setSelectedAccountId(primary.id)
    setCollectAllDefault(false)
    setCollectOpen(true)
  }

  /** "Tümünden tahsilat al" — modal Tümü seçili açılır (para satışlara vade sırasıyla bölünür). */
  const openCollectAllFor = (list: CustomerAccount[]): void => {
    const open = list.filter((a) => a.remainingAmount > 0.005)
    if (open.length === 0) return
    setCollectScopeIds(open.map((a) => a.id))
    setSelectedAccountId(open[0].id)
    setCollectAllDefault(true)
    setCollectOpen(true)
  }

  // Tahsilat tek uca gider; sunucu tutarı vade sırasıyla taksitlere dağıtır (allocation
  // modeli). "Bu ay ödenmesi gereken" yalnız modalin ÖNERDİĞİ tutardır — kullanıcı değiştirebilir.
  const registerCollection = async (p: CollectionSubmitPayload): Promise<void> => {
    const payload = { amount: p.amount, method: p.method, reference: p.reference, occurredAtUtc: p.occurredAtUtc }
    const res = await performWrite({
      operationType: 'RegisterAccountPayment',
      title: `Tahsilat: ${formatTL(p.amount)}`,
      summary: accounts.find((a) => a.id === p.accountId)?.customerName || '',
      payload: { ...payload, accountId: p.accountId },
      tenantId,
      directAction: () => adminApi.registerAccountPayment(p.accountId, payload, tenantId, p.idempotencyKey),
    })
    if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Tahsilat'))
    await reload()
  }

  const handleCreateExpense = async (values: ExpenseFormDialogValues): Promise<void> => {
    const occurredIso = values.occurredAt || new Date().toISOString().slice(0, 10)
    const customName = values.category === 'Other' ? values.customCategoryName : null
    const description = customName ? (values.description ? `[${customName}] ${values.description}` : customName) : values.description || null
    const payload = {
      category: values.category, amount: Number(values.amount || 0), paymentMethod: values.paymentMethod,
      occurredAtUtc: new Date(`${occurredIso}T12:00:00`).toISOString(), staffMemberId: null,
      periodLabel: values.periodLabel || null, description, reference: values.reference || null, branchId: branchId || null,
    }
    const res = await performWrite({
      operationType: 'CreateExpense', title: `Gider: ${values.category} · ${Number(values.amount || 0)}`,
      summary: description || '', payload, tenantId,
      directAction: () => adminApi.createExpense(payload, tenantId),
    })
    if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Gider ekleme'))
    await reload()
  }
  const handleCreateExpenseCat = async (name: string) => { const r = await adminApi.createExpenseCategory<ApiCustomExpenseCategory>({ name, isActive: true }, tenantId); await reload(); return normalizeCustomCategory(r) }
  const handleDeleteExpenseCat = async (id: string) => { await adminApi.deleteExpenseCategory(id, tenantId); await reload() }

  // Bekleyen gider/maaş kaydını onayla (yalnız personelin girdiği kayıtlar beklemede olur).
  const approveExpense = async (e: BusinessExpense) => {
    setActionError('')
    try { await adminApi.approveExpense(e.id, tenantId); await reload() }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Kayıt onaylanamadı.') }
  }

  /**
   * ONAYLANMIŞ GİDER SİLİNMEZ, GEÇERSİZ KILINIR.
   *
   * Silme onaylı kaydı gizliyordu: kasa akışı ve kâr-zarar gerçekleşmiş çıkışı bir daha
   * görmüyor, kimin hangi gerekçeyle kaldırdığı da bilinmiyordu. Onaylı kayıtta backend artık
   * gerekçeli void ister (ayrı yetki); onay bekleyen kayıt normal silinir.
   */
  const deleteExpense = async (e: BusinessExpense) => {
    setActionError('')
    if (e.isApproved) {
      const reason = window.prompt(
        'Onaylanmış gider silinemez. Geçersiz kılmak için gerekçe yazın (ör. "yanlış girildi, para çıkmadı"):',
      )
      if (!reason || !reason.trim()) return
      try { await adminApi.voidExpense(e.id, reason.trim(), tenantId); await reload() }
      catch (err) { setActionError(err instanceof Error ? err.message : 'Gider geçersiz kılınamadı.') }
      return
    }
    try { await adminApi.deleteExpense(e.id, tenantId); await reload() }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Gider silinemedi.') }
  }

  const createAdisyonFor = async (customerId: string) => {
    setBusy(true); setActionError('')
    try {
      const created = await adminApi.createAdisyon<ApiAdisyon>({ customerId, customerAccountId: null, notes: null }, tenantId)
      if (created?.id) setSelectedAdisyonId(created.id)
      setAdisyonFilter('all')
      await reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Adisyon açılamadı.') } finally { setBusy(false) }
  }

  const showInAccounts = (a: Adisyon) => {
    const acct = accounts.find((x) => x.id === a.customerAccountId) || accounts.find((x) => x.customerId === a.customerId)
    // Cari doğrudan detay modalinde açılsın — listede aramaya gerek kalmasın.
    if (acct) { setSelectedAccountId(acct.id); setAccountDetailOpen(true) }
    setAccountFilter('all')
    goScope('accounts')
  }

  // Adisyonu tamamen sil — onaylıda backend cari/kasa/prim/sadakat/stok/seans + ilgili randevular geri alınır (yönetici-only).
  // force=true: kullanılmış seans olsa bile sil (kullanılmış seanslar korunur, kalan tüm bedel iade edilir).
  const doDeleteAdisyon = async (a: Adisyon, force = false) => {
    setBusy(true); setActionError(''); setActionMsg('')
    try {
      await adminApi.deleteAdisyon(a.id, tenantId, force)
      setActionMsg('Adisyon silindi ve ilgili kayıtlar geri alındı.')
      setForceDeleteAdisyon(false)
      setSelectedAdisyonId(null)
      await reload()
    } catch (e) {
      // Kullanılmış seans engeli → aynı modalı "zorla sil" onayına yükselt (ikinci tık force gönderir).
      if (!force && e instanceof ApiClientError && e.code === 'AdisyonSessionUsed') setForceDeleteAdisyon(true)
      setActionError(e instanceof Error ? e.message : 'Adisyon silinemedi.')
      throw e // modalın hata mesajını göstermesi + açık kalması için
    } finally { setBusy(false) }
  }

  // ---------- topbar aksiyonu (sekmeye göre) ----------
  const topAction = (() => {
    if (tab === 'adisyon') {
      return (
        <button
          type="button"
          onClick={() => setNewAdisyonOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Yeni Adisyon
        </button>
      )
    }
    if (tab === 'expenses') {
      return (
        <ExpenseFormDialog
          customCategories={customExpenseCats} onCreateCustomCategory={handleCreateExpenseCat} onDeleteCustomCategory={handleDeleteExpenseCat}
          onSubmit={handleCreateExpense}
          trigger={<button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90"><TrendingDown className="h-3.5 w-3.5" /> Yeni Gider</button>}
        />
      )
    }
    if (tab === 'salary') {
      return (
        <SalaryPaymentDialog
          staff={staff}
          salaryExpenses={salaryExpenses}
          defaultPeriod={`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`}
          onSubmit={async (p) => {
            await adminApi.createExpense({
              category: 'Salary', amount: p.amount, paymentMethod: p.method,
              occurredAtUtc: new Date(`${p.occurredAt}T12:00:00`).toISOString(),
              staffMemberId: p.staffMemberId, periodLabel: p.periodLabel,
              description: p.description, reference: null, branchId: branchId || null,
            }, tenantId)
            await reload()
          }}
          trigger={<button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90"><Users className="h-3.5 w-3.5" /> Maaş Öde</button>}
        />
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* GEÇMİŞ SATIŞ BURADAN DA GİRİLİR. Önceden yalnız müşteri kartında vardı; ön muhasebede
            çalışan kişi yazılıma geçmeden önceki bir satışı girmek için müşteriler sayfasına
            gitmek zorundaydı. Müşteri seçilince aynı satış çalışma alanı açılır. */}
        <button
          type="button"
          onClick={() => { setPickerValue(''); setSalesPickerOpen(true) }}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#efbfd0] bg-white px-3.5 py-2 text-[11px] font-medium text-[#c85776] hover:bg-[#fff4f8]"
        >
          <History className="h-3.5 w-3.5" /> Geçmiş Satış
        </button>
      <NewAccountDialog
        packages={packages}
        onSearchCustomers={customerSearch}
        onSubmit={async (p) => {
          await adminApi.createAccount({
            customerId: p.customerId, servicePackageId: p.servicePackageId, name: p.name,
            totalAmount: p.totalAmount, depositAmount: p.depositAmount,
            installmentCount: p.installmentCount, firstDueDate: p.firstDueDate, notes: p.notes,
          }, tenantId)
          await reload()
        }}
        trigger={<button type="button" className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90"><CreditCard className="h-3.5 w-3.5" /> Yeni Cari</button>}
      />
      </div>
    )
  })()

  const monthNav = (
    <div className="ml-auto inline-flex items-center gap-1 rounded-[12px] border border-[#ead8df] bg-white p-1">
      <button type="button" onClick={() => setMonthOffset((o) => o - 1)} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#352432]/55 hover:bg-[#fff4f8]"><ChevronLeft className="h-4 w-4" /></button>
      <span className="flex items-center gap-1.5 px-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]"><CalendarDays className="h-3.5 w-3.5" /> {monthLabel}</span>
      <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#352432]/55 hover:bg-[#fff4f8]"><ChevronRight className="h-4 w-4" /></button>
    </div>
  )

  return (
    <>
      <Topbar
        title="Ön Muhasebe"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Merkez'} · ${TABS.find((t) => t.key === tab)?.label}`}
        breadcrumbs={['Admin', 'Finans', 'Ön Muhasebe', TABS.find((t) => t.key === tab)?.label || '']}
        actions={<div className="flex flex-wrap items-center gap-2">{topAction}</div>}
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        {/* SEKMELER */}
        <div className="flex flex-wrap items-center gap-1 border-b border-[#ead8df]/70">
          {TABS.filter((t) => t.key !== 'adisyon' || canAdisyon).map((t) => (
            <button key={t.key} type="button" onClick={() => goScope(t.key)}
              className={`relative -mb-px inline-flex items-center gap-2 px-4 py-3 text-[12px] font-medium uppercase tracking-wide transition-colors ${tab === t.key ? 'text-[#c85776]' : 'text-[#352432]/50 hover:text-[#352432]/75'}`}>
              <t.icon className="h-4 w-4" /> {t.label}
              {tab === t.key && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#c85776]" />}
            </button>
          ))}
        </div>

        <ApiStateNotice loading={loading} error={error} />
        {actionError && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>}
        {actionMsg && <div className="rounded-[12px] border border-emerald-300/30 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700">{actionMsg}</div>}

        {/* ================= GENEL BAKIŞ ================= */}
        {tab === 'overview' && (
          <>
            <div className="flex flex-wrap items-center gap-3">{monthNav}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={TrendingUp} label="Bu ay tahsilat (kasa girişi)" value={formatTL(incomeMonth)} chip={`↗ Randevu cirosu ${formatTL(apptRevenueMonth)} (tahakkuk)`} bars={monthBars} />
              <OverviewCard icon={TrendingDown} label="Bu ay gider" value={formatTL(expenseMonth)} chip={`↗ ${expenses.length} kalem`} bars={monthBars} />
              <OverviewCard icon={Receipt} label="Net nakit akışı" value={formatTL(netMonth)} chip={netMonth >= 0 ? '↗ tahsilat − gider' : '↘ gider tahsilatı aştı'} chipTone={netMonth >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'} bars={monthBars} valueTone={netMonth < 0 ? 'text-rose-700' : undefined} />
              <OverviewCard icon={CreditCard} label="Açık alacak" value={formatTL(openReceivable)} chip={`↗ ${activeAccountCount} cari · ${formatTL(overdue.sum)} geciken (${overdue.count})`} chipTone={overdue.count ? 'text-rose-700 bg-rose-50' : undefined} bars={monthBars} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
              {/* Nakit akışı — giren/çıkan tek bakışta */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#a3576f]">Nakit akışı · {monthLabel}</div>
                    <div className={`font-display text-3xl tracking-tight ${netMonth < 0 ? 'text-rose-700' : 'text-[#352432]'}`}>{formatTL(netMonth)}</div>
                    <div className="text-[11px] text-[#705a66]">{netMonth >= 0 ? 'Kasada kalan' : 'Kasa açığı'}</div>
                  </div>
                  <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${netMonth >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    <Wallet className="h-5 w-5" />
                  </span>
                </div>

                {(() => {
                  const scale = Math.max(incomeMonth, expenseMonth, 1)
                  const rows: [string, number, string, string][] = [
                    ['Tahsilat', incomeMonth, 'bg-gradient-to-r from-emerald-400 to-emerald-500', 'text-emerald-700'],
                    ['Gider', expenseMonth, 'bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]', 'text-rose-700'],
                  ]
                  return (
                    <div className="mt-4 space-y-3">
                      {rows.map(([label, value, bar, tone]) => (
                        <div key={label}>
                          <div className="flex items-center justify-between text-[12px]">
                            <span className="text-[#4a3a44]">{label}</span>
                            <span className={`font-display tabular-nums ${tone}`}>{formatTL(value)}</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f7e9ee]">
                            <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, Math.round((value / scale) * 100))}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#f0dae2] bg-[#f7e9ee] text-center">
                  {[
                    ['Kira', formatTL(rentTotal), Building2],
                    ['Faturalar', formatTL(utilTotal), Zap],
                    ['Maaş', formatTL(salaryTotal), Users],
                  ].map(([l, v, Icon]) => {
                    const I = Icon as typeof Wallet
                    return (
                      <div key={String(l)} className="bg-white px-2 py-2.5">
                        <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-[9px] bg-[#fff1f6] text-[#c85776]"><I className="h-3.5 w-3.5" /></span>
                        <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">{String(l)}</div>
                        <div className="font-display text-[15px] tabular-nums">{String(v)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Gider dağılımı */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#a3576f]">Gider dağılımı</div>
                    <div className="font-display text-3xl tracking-tight">{formatTL(expenseMonth)}</div>
                    <div className="text-[11px] text-[#705a66]">{expenses.length} kalem · {monthLabel}</div>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><PieChart className="h-5 w-5" /></span>
                </div>
                <div className="mt-4 space-y-2.5">
                  {Object.entries(expenses.reduce<Record<string, { sum: number; count: number }>>((m, e) => {
                    const k = e.category
                    m[k] = { sum: (m[k]?.sum ?? 0) + e.amount, count: (m[k]?.count ?? 0) + 1 }
                    return m
                  }, {}))
                    .sort((a, b) => b[1].sum - a[1].sum)
                    .map(([cat, v]) => {
                      const pct = expenseMonth > 0 ? Math.round((v.sum / expenseMonth) * 100) : 0
                      const Icon = EXPENSE_ICONS[cat] || Receipt
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="flex min-w-0 items-center gap-2 text-[#4a3a44]">
                              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${EXPENSE_TONES[cat] || 'bg-[#fff1f6] text-[#c85776]'}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="truncate">{expenseCategoryLabels[cat as keyof typeof expenseCategoryLabels] || cat}</span>
                              <span className="shrink-0 text-[10px] text-[#705a66]">{v.count} kalem</span>
                            </span>
                            <span className="shrink-0 font-display tabular-nums text-[#c85776]">{formatTL(v.sum)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
                              <span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-9 shrink-0 text-right text-[10px] font-semibold text-[#705a66]">%{pct}</span>
                          </div>
                        </div>
                      )
                    })}
                  {expenses.length === 0 && (
                    <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#705a66]">
                      Bu ay gider kaydı yok.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Personel maaş yükü */}
            <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#a3576f]">Personel maaş yükü</div>
                  <div className="font-display text-3xl tracking-tight">{formatTL(salaryTotal)}</div>
                  <div className="text-[11px] text-[#705a66]">{salaryExpenses.length} ödeme · {monthLabel}</div>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-violet-50 text-violet-600"><Users className="h-5 w-5" /></span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries(salaryExpenses.reduce<Record<string, { sum: number; count: number }>>((m, e) => {
                  const k = e.staffName || e.description || 'Personel'
                  m[k] = { sum: (m[k]?.sum ?? 0) + e.amount, count: (m[k]?.count ?? 0) + 1 }
                  return m
                }, {}))
                  .sort((a, b) => b[1].sum - a[1].sum)
                  .map(([name, v]) => (
                    <div key={name} className="flex items-center gap-2.5 rounded-[14px] border border-[#f0e0e6] bg-[#fffafc] px-3 py-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-50 text-[11px] font-bold text-violet-700">
                        {name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('tr') || '—'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-[#352432]">{name}</span>
                        <span className="block text-[10px] text-[#705a66]">{v.count} ödeme</span>
                      </span>
                      <span className="shrink-0 font-display text-[14px] tabular-nums text-[#c85776]">{formatTL(v.sum)}</span>
                    </div>
                  ))}
                {salaryExpenses.length === 0 && (
                  <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#705a66] sm:col-span-2 xl:col-span-3">
                    Bu ay maaş ödemesi yok.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ================= ADİSYON ================= */}
        {tab === 'adisyon' && canAdisyon && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                <ReceiptText className="h-4 w-4" /> Açık hesap fişleri. Kalemler önce adisyona düşer; yönetici onaylayınca borç cariye, tahsilat kasaya işlenir.
              </div>
              <button
                type="button"
                onClick={() => setDailyOpen(true)}
                className="inline-flex items-center gap-2 rounded-[12px] border border-[#efbfd0] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#c85776] transition-transform hover:-translate-y-0.5 hover:bg-[#fff4f8]"
              >
                <CalendarDays className="h-4 w-4" /> Bugünün Kartı
              </button>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={ReceiptText} label="Açık adisyon" value={String(adisyonStats.openCount)} chip={`↗ ${formatTL(adisyonStats.openNet)} bekleyen net`} bars={monthBars} />
              <OverviewCard icon={CheckCircle2} label="Onaylanan adisyon" value={String(adisyonStats.approvedCount)} chip="↗ Cariye + kasaya işlendi" chipTone="text-emerald-700 bg-emerald-50" bars={monthBars} />
              <OverviewCard icon={CreditCard} label="Cariye işlenen borç" value={formatTL(adisyonStats.charge)} bars={monthBars} />
              <OverviewCard icon={Landmark} label="Kasaya işlenen tahsilat" value={formatTL(adisyonStats.payment)} bars={monthBars} />
            </div>

            {/* Akış şeridi — üç adım tek satırda */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-[14px] border border-[#ead8df]/70 bg-white/70 px-3 py-2 text-[10.5px]">
              {[
                ['1', 'Adisyon açılır, kalemler toplanır', 'bg-amber-50 text-amber-700'],
                ['2', 'Yönetici onaylar', 'bg-emerald-50 text-emerald-700'],
                ['3', 'Borç cariye, tahsilat kasaya işlenir', 'bg-rose-50 text-rose-700'],
              ].map(([n, t, cls], i) => (
                <span key={n} className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${cls}`}>
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-white/70 text-[9px] font-bold">{n}</span>
                    {t}
                  </span>
                  {i < 2 && <ChevronRight className="h-3.5 w-3.5 text-[#c9b3bd]" />}
                </span>
              ))}
            </div>

            {/* ---- Araç çubuğu ---- */}
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-3">
              <div className="flex min-w-[230px] flex-1 items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#b499a6]" />
                <input
                  value={adisyonQuery}
                  onChange={(e) => setAdisyonQuery(e.target.value)}
                  placeholder="Müşteri veya kalem ara…"
                  className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#b499a6]"
                />
                {adisyonQuery && (
                  <button type="button" onClick={() => setAdisyonQuery('')} className="shrink-0 text-[10px] font-semibold text-[#a3576f]">Temizle</button>
                )}
              </div>
              <div className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/50 p-1">
                {([
                  ['all', 'Tümü', adisyonCounts.all],
                  ['Open', 'Açık', adisyonCounts.Open],
                  ['Approved', 'Onaylı', adisyonCounts.Approved],
                  ['Cancelled', 'İptal', adisyonCounts.Cancelled],
                ] as const).map(([k, l, n]) => (
                  <button
                    key={k} type="button" onClick={() => setAdisyonFilter(k)}
                    className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${adisyonFilter === k ? 'bg-[#c85776] text-white' : 'text-[#705a66] hover:bg-white'}`}
                  >
                    {l} <span className={adisyonFilter === k ? 'opacity-80' : 'text-[#a3576f]'}>{n}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ---- Adisyon fişleri ---- */}
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredAdisyonlar.map((a) => {
                const saleCancelled = cancelledSaleByAdisyonId.get(a.id)
                const net = a.chargeTotal - a.paymentTotal
                const isOpen = a.status === 'Open'
                const paidPct = a.chargeTotal > 0 ? Math.min(100, Math.round((a.paymentTotal / a.chargeTotal) * 100)) : 0
                const initials = (a.customerName || 'Müşteri').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('tr')
                return (
                  <div
                    key={a.id}
                    className={`rounded-[18px] border bg-white p-4 transition-shadow hover:shadow-[0_22px_46px_-34px_rgba(150,78,104,0.5)] ${
                      isOpen ? 'border-amber-200' : a.status === 'Approved' ? 'border-[#ead8df]/80' : 'border-rose-200/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => openAdisyonDetail(a)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#fde7ee] to-[#f6d0dd] text-[12px] font-bold text-[#a3576f]">
                          {initials || '—'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-[#352432]">{a.customerName || 'Müşteri'}</span>
                          <span className="block truncate text-[11px] text-[#705a66]">
                            {shortDay(a.openedAtUtc)} · {a.items.length} kalem
                            {a.items.length > 0 ? ` · ${a.items.slice(0, 2).map((i) => i.description).join(', ')}${a.items.length > 2 ? '…' : ''}` : ''}
                          </span>
                        </span>
                      </button>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-[19px] tabular-nums text-[#c85776]">{formatTL(a.chargeTotal)}</div>
                        <div className="text-[9.5px] font-mono uppercase tracking-wide text-[#705a66]">borç</div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-md px-2 py-0.5 text-[9.5px] font-bold ${
                        isOpen ? 'bg-amber-50 text-amber-700' : a.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        ● {isOpen ? 'AÇIK' : a.status === 'Approved' ? 'ONAYLANDI' : 'İPTAL'}
                      </span>
                      <span className="text-[10.5px] text-[#705a66]">
                        Tahsilat <b className="text-emerald-700">{formatTL(a.paymentTotal)}</b>
                        {' · '}{net >= 0 ? 'Kalan' : 'Fazla'} <b className="text-[#4a3a44]">{formatTL(Math.abs(net))}</b>
                      </span>
                      {saleCancelled && (
                        <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[9.5px] font-bold text-rose-600">SATIŞ İPTAL</span>
                      )}
                    </div>

                    {saleCancelled && (
                      <div className="mt-1.5 rounded-[10px] bg-rose-50/70 px-2.5 py-1.5 text-[10.5px] text-rose-700">
                        Gerekçe: {saleCancelled.reason || 'belirtilmemiş'}{saleCancelled.at ? ` · ${shortDay(saleCancelled.at)}` : ''}
                      </div>
                    )}

                    {a.chargeTotal > 0 && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
                          <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${paidPct}%` }} />
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold text-[#705a66]">%{paidPct} tahsil</span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {isOpen ? (
                        <button
                          type="button" onClick={() => openAdisyonDetail(a)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-[11px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-3 text-[11.5px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
                        >
                          <ReceiptText className="h-3.5 w-3.5" /> Adisyonu aç
                        </button>
                      ) : (
                        <button
                          type="button" onClick={() => openAdisyonDetail(a)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white px-3 text-[11.5px] font-semibold text-[#4a3a44] transition-colors hover:border-[#efbfd0]"
                        >
                          <ReceiptText className="h-3.5 w-3.5" /> Fişi gör
                        </button>
                      )}
                      <button
                        type="button" onClick={() => showInAccounts(a)}
                        className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[11px] border border-emerald-300/50 bg-emerald-50 px-3 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        <CreditCard className="h-3.5 w-3.5" /> Cari
                      </button>
                    </div>
                  </div>
                )
              })}
              {filteredAdisyonlar.length === 0 && (
                <div className="rounded-[18px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-12 text-center text-[12.5px] text-[#705a66] lg:col-span-2">
                  {adisyonQuery ? 'Aramaya uyan adisyon yok.' : 'Bu dönemde adisyon yok. Üstten “Yeni Adisyon” ile açabilirsin.'}
                </div>
              )}
            </div>

            {/* ---- Açık adisyon: düzenlenebilir kart ---- */}
            <AdisyonModal
              open={adisyonEditOpen}
              onOpenChange={setAdisyonEditOpen}
              customerId={selAdisyon?.customerId}
              customerName={selAdisyon?.customerName}
              tenantId={tenantId}
              onChanged={reload}
            />

            {/* ---- Kapanmış adisyon: okunur fiş ---- */}
            <AdisyonReceiptModal
              adisyon={selAdisyon}
              open={adisyonReceiptOpen}
              onOpenChange={setAdisyonReceiptOpen}
              saleCancelled={selAdisyon ? cancelledSaleByAdisyonId.get(selAdisyon.id) : undefined}
              onShowInAccounts={() => { if (selAdisyon) { setAdisyonReceiptOpen(false); showInAccounts(selAdisyon) } }}
              deleteSlot={!isStaff && selAdisyon ? (
                <ConfirmDialog
                  destructive
                  title={forceDeleteAdisyon ? 'Kullanılmış seans var — zorla sil' : (selAdisyon.status === 'Approved' ? 'Adisyonu geri al ve sil' : 'Adisyonu sil')}
                  confirmLabel={forceDeleteAdisyon ? 'Yine de zorla sil' : 'Evet, sil'}
                  cancelLabel="Vazgeç"
                  onConfirm={() => doDeleteAdisyon(selAdisyon, forceDeleteAdisyon)}
                  description={
                    forceDeleteAdisyon ? (
                      <span className="block space-y-1.5">
                        <span className="block">Bu satıştan <b>kullanılmış (müşteriye verilmiş) seans</b> var.</span>
                        <span className="block">• <b>Kullanılmış seanslar korunur</b>, silinmez</span>
                        <span className="block">• Kullanılmamış seanslar geri alınır</span>
                        <span className="block">• <b>Borç, tahsilat, prim, sadakat ve stok tamamen iade edilir</b></span>
                        <span className="block text-rose-600">Müşteri kullandığı hizmetlerin bedelini de geri almış olur; cariyi kontrol et. Geri alınamaz.</span>
                      </span>
                    ) : selAdisyon.status === 'Approved' ? (
                      <span className="block space-y-1.5">
                        <span className="block">Bu <b>onaylı</b> adisyon silinince şunlar da geri alınacak:</span>
                        <span className="block">• Bu satışa ait <b>cari hesap</b> (varsa) silinir</span>
                        <span className="block">• Satılan <b>hizmet/paket seansları</b> geri alınır</span>
                        <span className="block">• İlgili <b>randevular</b> (planlı/onaylı) silinir</span>
                        <span className="block">• <b>Prim, sadakat puanı ve stok</b> geri alınır</span>
                        <span className="block text-rose-600">Bu işlem geri alınamaz.</span>
                      </span>
                    ) : (
                      <span className="block">Bu adisyon ve kalemleri kalıcı olarak silinecek. Bu işlem geri alınamaz.</span>
                    )
                  }
                  trigger={
                    <button type="button" disabled={busy}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 text-[11.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" /> Adisyonu sil{selAdisyon.status === 'Approved' ? ' (geri al)' : ''}
                    </button>
                  }
                />
              ) : undefined}
            />
          </>
        )}

        {/* ================= CARİ HESAPLAR ================= */}
        {tab === 'accounts' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                <CreditCard className="h-4 w-4" /> Müşterilerin kalan borcu, taksit planı ve tahsilatları. Peşin satışta tek tahsilat, taksitlide aylık taksit ya da genel tahsilat alınır.
              </div>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={CreditCard} label="Toplam açık alacak" value={formatTL(openReceivable)} chip={`↗ ${activeAccountCount} aktif cari`} bars={monthBars} />
              <OverviewCard icon={TrendingDown} label="Geciken bakiye" value={formatTL(overdue.sum)} chip={`↗ ${overdue.count} taksit`} chipTone={overdue.count ? 'text-rose-700 bg-rose-50' : undefined} bars={monthBars} />
              <OverviewCard icon={Banknote} label={`Tahsilat · ${monthLabel}`} value={formatTL(paymentsMonth)} bars={monthBars} />
              <OverviewCard icon={Landmark} label="Toplam tahsilat" value={formatTL(totalCollected)} bars={monthBars} />
            </div>

            {/* ---- Araç çubuğu: arama · filtre · iptal edilenler ---- */}
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-3">
              <div className="flex min-w-[230px] flex-1 items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#b499a6]" />
                <input
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder="Müşteri, paket veya telefon ara…"
                  className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#b499a6]"
                />
                {accountQuery && (
                  <button type="button" onClick={() => setAccountQuery('')} className="shrink-0 text-[10px] font-semibold text-[#a3576f]">Temizle</button>
                )}
              </div>
              <div className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/50 p-1">
                {([
                  ['all', 'Tümü', accountCounts.all],
                  ['overdue', 'Geciken', accountCounts.overdue],
                  ['upcoming', 'Bekleyen', accountCounts.upcoming],
                  ['installment', 'Taksitli', accountCounts.installment],
                  ['closed', 'Kapanan', accountCounts.closed],
                ] as const).map(([k, l, n]) => (
                  <button
                    key={k} type="button" onClick={() => setAccountFilter(k)}
                    className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${accountFilter === k ? 'bg-[#c85776] text-white' : 'text-[#705a66] hover:bg-white'}`}
                  >
                    {l} <span className={accountFilter === k ? 'opacity-80' : 'text-[#a3576f]'}>{n}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button" onClick={() => { setCancelledTab('all'); setCancelledOpen(true) }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[11.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                >
                  <Ban className="h-3.5 w-3.5" /> İptal edilenler{cancelledCount > 0 ? ` · ${cancelledCount}` : ''}
                </button>
                {/* İade = müşteriye para geri ödenmiş iptaller. Ayrı buton: yönetici "ne kadar
                    para geri çıktı" sorusunu tek tıkla görebilsin. */}
                <button
                  type="button" onClick={() => { setCancelledTab('refunded'); setCancelledOpen(true) }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[12px] border border-amber-200 bg-amber-50 px-3 text-[11.5px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  <Undo2 className="h-3.5 w-3.5" /> İade edilenler
                  {refundedCount > 0 ? ` · ${refundedCount}` : ''}
                  {refundedTotal > 0.005 && (
                    <span className="ml-0.5 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] tabular-nums">{formatTL(Math.round(refundedTotal))}</span>
                  )}
                </button>
              </div>
            </div>

            {/* ---- Cari TABLOSU (müşteri bazında) ----
                Kart ızgarası yerine tablo: aynı müşterinin birden çok satışı tek satırda
                toplanır, satıra tıklayınca müşterinin cari defteri (tam sayfa) açılır. */}
            <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/80 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-[#fff7fa]">
                    <tr className="border-b border-[#f0dce5] text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
                      <th className="px-4 py-2.5">Müşteri</th>
                      <th className="px-3 py-2.5 text-center">Satış</th>
                      <th className="px-3 py-2.5 text-right">Toplam</th>
                      <th className="px-3 py-2.5 text-right">Tahsil edilen</th>
                      <th className="px-3 py-2.5 text-right">Kalan borç</th>
                      <th className="px-3 py-2.5">Tahsilat durumu</th>
                      <th className="px-3 py-2.5">Sıradaki vade</th>
                      <th className="px-3 py-2.5 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountGroups.map((g) => {
                      const isOpen = g.remainingAmount > 0.005
                      const pct = g.totalAmount > 0 ? Math.min(100, Math.round((g.paidAmount / g.totalAmount) * 100)) : 0
                      const initials = g.customerName.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toLocaleUpperCase('tr')
                      const rowKey = g.customerId || g.accounts[0]?.id || g.customerName
                      return (
                        <tr
                          key={rowKey}
                          onClick={() => setSelectedGroupId(rowKey)}
                          className={`cursor-pointer border-b border-[#f8f0f4] transition-colors last:border-b-0 hover:bg-[#fff7fa] ${g.hasOverdue ? 'bg-rose-50/40' : ''}`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#fde7ee] to-[#f6d0dd] text-[11px] font-bold text-[#a3576f]">
                                {initials || '—'}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[#352432]">{g.customerName}</span>
                                <span className="block truncate text-[11px] text-[#705a66]">
                                  {g.saleCount === 1 ? (g.accounts[0].servicePackageName || g.accounts[0].name) : `${g.saleCount} satış`}
                                  {g.customerPhone ? ` · ${g.customerPhone}` : ''}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#ead8df] bg-[#fffafc] px-2 py-0.5 text-[10.5px] font-bold tabular-nums text-[#a3576f]">
                              {g.saleCount}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#4a3a44]">{formatTL(Math.round(g.totalAmount))}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{formatTL(Math.round(g.paidAmount))}</td>
                          <td className={`px-3 py-2.5 text-right font-display text-[15px] tabular-nums ${isOpen ? (g.hasOverdue ? 'text-rose-700' : 'text-[#c85776]') : 'text-emerald-700'}`}>
                            {formatTL(Math.round(g.remainingAmount))}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[#f7e9ee]">
                                <span className={`block h-full rounded-full ${isOpen ? 'bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]' : 'bg-gradient-to-r from-[#7fc7ad] to-[#2c7d63]'}`} style={{ width: `${Math.max(3, pct)}%` }} />
                              </span>
                              <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-[#705a66]">%{pct}</span>
                              {g.hasOverdue && (
                                <span className="shrink-0 rounded-md bg-rose-100 px-1.5 py-0.5 text-[9.5px] font-bold text-rose-700">GECİKMİŞ</span>
                              )}
                              {g.hasInstallmentPlan && !g.hasOverdue && (
                                <span className="shrink-0 rounded-md bg-[#f3e8ff] px-1.5 py-0.5 text-[9.5px] font-bold text-[#7c3aed]">TAKSİTLİ</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[11.5px] text-[#705a66]">
                            {isOpen && g.nextDueDate ? (
                              <span className="inline-flex items-center gap-1">
                                <CalendarDays className="h-3 w-3 text-[#c85776]" /> {shortDay(g.nextDueDate)}
                                <b className="text-[#4a3a44]">{formatTL(g.nextDueAmount)}</b>
                              </span>
                            ) : isOpen ? '—' : <span className="text-emerald-700">kapandı</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {/* ÇOK SATIŞLIDA DA VAR: eskiden buton yalnız tek satışlı müşteride
                                  çıkıyordu, çünkü para hangi cariye yazılacağı belirsizdi. Artık
                                  modal o müşterinin satışlarını listeleyip seçtiriyor. */}
                              {isOpen && (
                                <button
                                  type="button"
                                  onClick={() => openCollectFor(g.accounts)}
                                  className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-2.5 text-[11px] font-semibold text-white transition-transform hover:-translate-y-0.5"
                                >
                                  <Banknote className="h-3.5 w-3.5" /> Tahsilat al
                                  {g.accounts.filter((a) => a.remainingAmount > 0.005).length > 1 && (
                                    <span className="rounded-full bg-white/25 px-1.5 text-[9.5px] font-bold">
                                      {g.accounts.filter((a) => a.remainingAmount > 0.005).length} satış
                                    </span>
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedGroupId(rowKey)}
                                className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 text-[11px] font-semibold text-[#4a3a44] transition-colors hover:border-[#efbfd0]"
                              >
                                Defter <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {accountGroups.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-[#f0dce5] bg-[#fff7fa] text-[11.5px] font-bold text-[#352432]">
                        <td className="px-4 py-2.5">{accountGroups.length} müşteri</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{accountGroups.reduce((s, g) => s + g.saleCount, 0)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatTL(Math.round(accountGroups.reduce((s, g) => s + g.totalAmount, 0)))}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatTL(Math.round(accountGroups.reduce((s, g) => s + g.paidAmount, 0)))}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#c85776]">{formatTL(Math.round(accountGroups.reduce((s, g) => s + g.remainingAmount, 0)))}</td>
                        <td className="px-3 py-2.5" colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {accountGroups.length === 0 && (
                <div className="px-4 py-12 text-center text-[12.5px] text-[#705a66]">
                  {accountQuery ? 'Aramaya uyan cari hesap yok.' : 'Bu kapsamda cari hesap yok.'}
                </div>
              )}
            </div>

            {/* ---- Modallar ---- */}
            {/* SATIŞ ÇALIŞMA ALANI — müşteri kartındaki panellerin AYNISI (iki ayrı liste değil).
                Veri müşteri başına taze çekilir; sayfanın cari listesi 500 ile sınırlı ve
                iptalleri dışlıyor, oysa panelin "İptal" sekmesi onları göstermek zorunda. */}
            {salesCustomer && (
              <CariSalesWorkspace
                open
                customerId={salesCustomer.id}
                customerName={salesCustomer.name}
                tenantId={tenantId}
                branchId={branchId}
                staffOptions={salesStaffOptions}
                packageOptions={salesPackageOptions}
                serviceOptions={salesServiceOptions}
                onClose={() => setSalesCustomer(null)}
                onChanged={async () => { await reload() }}
              />
            )}

            {/* Geçmiş satış için önce müşteri seçilir (cari listesinde olmayan müşteri de olabilir —
                sunucu araması kullanılır, 12 bin+ müşteride liste çekmek doğru değil). */}
            {salesPickerOpen && (
              <ModalPortal>
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                  <button type="button" aria-label="Kapat" onClick={() => setSalesPickerOpen(false)}
                    className="absolute inset-0 cursor-default bg-[#2a141f]/50 backdrop-blur-[3px]" />
                  <div role="dialog" aria-modal="true" aria-label="Geçmiş satış için müşteri seç"
                    className="relative z-10 w-full max-w-[440px] rounded-[20px] border border-[#ead8df] bg-white p-5 shadow-[0_40px_120px_-50px_rgba(90,40,60,0.65)]">
                    <div className="text-[14px] font-semibold text-[#352432]">Geçmiş satış · müşteri seç</div>
                    <p className="mt-1 text-[11.5px] text-[#705a66]">
                      Yazılıma geçmeden önce yapılmış bir satışı kaydedeceksin. Müşteriyi seç, satış
                      penceresi açılsın.
                    </p>
                    <div className="mt-3">
                      <CustomerPicker
                        items={[]}
                        value={pickerValue}
                        onSearch={searchCustomers}
                        onChange={setPickerValue}
                        onSelectItem={(item: CustomerPickerItem) => {
                          setSalesPickerOpen(false)
                          setSalesCustomer({ id: item.id, name: item.name })
                        }}
                      />
                    </div>
                    <button type="button" onClick={() => setSalesPickerOpen(false)}
                      className="mt-4 w-full rounded-[11px] border border-[#ead8df] px-3 py-2 text-[12px] font-semibold text-[#705a66] hover:bg-[#fff4f8]">
                      Vazgeç
                    </button>
                  </div>
                </div>
              </ModalPortal>
            )}

            {/* MÜŞTERİ CARİ DEFTERİ — tablodan açılır, tam sayfa. Aylık taksit takvimi burada;
                tahsilat hâlâ TEK BİR SATIŞIN carisine yazılır (para doğru yere gitsin). */}
            <CustomerLedgerModal
              group={selGroup}
              cancelledSales={selGroupCancelled}
              open={Boolean(selGroup)}
              onClose={() => setSelectedGroupId(null)}
              /* Defterden tahsilat: seçici yine o müşterinin satışlarına daralır — kullanıcı
                 defteri kapatmadan yanlış satışı seçtiyse düzeltebilsin. */
              onCollect={(accountId) => {
                setCollectScopeIds(selGroup ? selGroup.accounts.map((a) => a.id) : null)
                setSelectedAccountId(accountId)
                setCollectAllDefault(false)
                setCollectOpen(true)
              }}
              onCollectAll={() => { if (selGroup) openCollectAllFor(selGroup.accounts) }}
              onOpenSale={(accountId) => { setSelectedGroupId(null); openAccount(accountId) }}
              onOpenSalesWorkspace={() => {
                if (!selGroup?.customerId) return
                setSelectedGroupId(null)
                setSalesCustomer({ id: selGroup.customerId, name: selGroup.customerName })
              }}
            />

            <AccountDetailModal
              account={selAccount}
              open={accountDetailOpen}
              onOpenChange={setAccountDetailOpen}
              tenantId={tenantId}
              ledger={ledger}
              sessionsTick={sessionsTick}
              onCollect={() => setCollectOpen(true)}
              onReschedule={async (installmentCount, firstDueDate) => {
                if (!selAccount) return
                await adminApi.rescheduleAccount(selAccount.id, { installmentCount, firstDueDate }, tenantId)
                await reload()
              }}
            />

            <CancelledSalesModal
              sales={cancelledSales}
              initialTab={cancelledTab}
              open={cancelledOpen}
              onOpenChange={setCancelledOpen}
              busy={busy}
              onRestore={async (originalAccountId, voidRefund, voidReason) => {
                await adminApi.restoreSale(originalAccountId, tenantId, voidRefund, { voidReason })
                await reload()
              }}
            />

            {/* TEK TAHSİLAT MODALI — "genel" ve "aylık taksit" ayrımı kaldırıldı: modal taksitli
                hesapta planı, devri ve "bu ay ödenmesi gereken" tutarı kendisi getirir. */}
            {selAccount && (
              <CollectionDialog
                /* Kapsam varsa seçici o müşterinin satışlarına daralır. Kapsam boş kalırsa
                   (liste tazelenip kimlikler değişirse) tüm carilere düşülür — modal asla
                   seçeneksiz açılmaz. */
                accounts={
                  collectScopeIds
                    ? (liveAccounts.filter((a) => collectScopeIds.includes(a.id)).length > 0
                        ? liveAccounts.filter((a) => collectScopeIds.includes(a.id))
                        : liveAccounts)
                    : liveAccounts
                }
                initialAccountId={selAccount.id}
                defaultAll={collectAllDefault}
                hideTrigger
                open={collectOpen}
                onOpenChange={(next) => { setCollectOpen(next); if (!next) { setCollectScopeIds(null); setCollectAllDefault(false) } }}
                onSubmit={registerCollection}
              />
            )}
          </>
        )}

        {/* ================= GİDERLER + MAAŞLAR ================= */}
        {(tab === 'expenses' || tab === 'salary') && (() => {
          const source = tab === 'salary' ? salaryExpenses : expenses
          const cats = Array.from(new Set(source.map((e) => e.category)))
          const q = expenseQuery.trim().toLocaleLowerCase('tr')
          const list = source.filter((e) => {
            if (tab === 'expenses' && expenseCat !== 'all' && e.category !== expenseCat) return false
            if (!q) return true
            return `${e.description} ${expenseCategoryLabels[e.category] || ''} ${e.staffName} ${e.periodLabel}`.toLocaleLowerCase('tr').includes(q)
          })
          const listTotal = list.reduce((s, e) => s + e.amount, 0)
          return (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                {tab === 'salary'
                  ? <><Users className="h-4 w-4" /> Personel maaş ve avans ödemeleri. Kayıtlar gider olarak kasaya işlenir.</>
                  : <><TrendingDown className="h-4 w-4" /> Tüm işletme giderleri: kira, sarf, fatura, ekipman ve diğerleri.</>}
              </div>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={TrendingDown} label={`Toplam · ${monthLabel}`} value={formatTL(tab === 'salary' ? salaryTotal : expenseMonth)} chip={`↗ ${source.length} kalem`} bars={monthBars} />
              <OverviewCard icon={Users} label="Personel maaşı" value={formatTL(salaryTotal)} chip={`↗ ${salaryExpenses.length} ödeme`} bars={monthBars} />
              <OverviewCard icon={Building2} label="Kira" value={formatTL(rentTotal)} chip="↗ Şubeler" bars={monthBars} />
              <OverviewCard icon={Zap} label="Faturalar" value={formatTL(utilTotal)} chip="↗ Elektrik / su / internet" bars={monthBars} />
            </div>

            {/* Araç çubuğu */}
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-3">
              <div className="flex min-w-[230px] flex-1 items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#b499a6]" />
                <input
                  value={expenseQuery}
                  onChange={(e) => setExpenseQuery(e.target.value)}
                  placeholder={tab === 'salary' ? 'Personel veya dönem ara…' : 'Açıklama veya kategori ara…'}
                  className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#b499a6]"
                />
                {expenseQuery && (
                  <button type="button" onClick={() => setExpenseQuery('')} className="shrink-0 text-[10px] font-semibold text-[#a3576f]">Temizle</button>
                )}
              </div>
              {tab === 'expenses' && cats.length > 1 && (
                <div className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-[#ead8df] bg-[#fff4f8]/50 p-1">
                  <button
                    type="button" onClick={() => setExpenseCat('all')}
                    className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${expenseCat === 'all' ? 'bg-[#c85776] text-white' : 'text-[#705a66] hover:bg-white'}`}
                  >
                    Tümü {source.length}
                  </button>
                  {cats.map((c) => (
                    <button
                      key={c} type="button" onClick={() => setExpenseCat(c)}
                      className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${expenseCat === c ? 'bg-[#c85776] text-white' : 'text-[#705a66] hover:bg-white'}`}
                    >
                      {expenseCategoryLabels[c] || c} {source.filter((e) => e.category === c).length}
                    </button>
                  ))}
                </div>
              )}
              <span className="ml-auto rounded-[10px] bg-[#fff1f6] px-3 py-1.5 text-[11.5px] font-semibold text-[#a3576f]">
                {list.length} kalem · {formatTL(listTotal)}
              </span>
            </div>

            {/* Liste */}
            <div className="grid gap-2.5">
              {list.map((e) => {
                const Icon = EXPENSE_ICONS[e.category] || Receipt
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[#ead8df]/80 bg-white px-4 py-3 transition-shadow hover:shadow-[0_20px_40px_-34px_rgba(150,78,104,0.5)]">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[13px] ${EXPENSE_TONES[e.category] || 'bg-[#fff1f6] text-[#c85776]'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-[#352432]">
                        {e.description || expenseCategoryLabels[e.category]}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[#705a66]">
                        <span className="rounded-md bg-[#fff4f8] px-1.5 py-0.5 font-semibold text-[#a3576f]">{expenseCategoryLabels[e.category]}</span>
                        {e.staffName && <span>· {e.staffName}</span>}
                        {e.periodLabel && <span>· dönem {e.periodLabel}</span>}
                        <span className="inline-flex items-center gap-1">· <CalendarDays className="h-3 w-3 text-[#c85776]" />{shortDay(e.occurredAt)}</span>
                        <span className="inline-flex items-center gap-1">· <Landmark className="h-3 w-3 text-[#c85776]" />{METHOD_LABEL[e.paymentMethod] || e.paymentMethod}</span>
                      </div>
                    </div>
                    {/* Sistem üretimi satır (müşteri iadesi): gider ÖZETİNDE zaten sayılıyordu,
                        artık listede de görünür. Elle girilmiş kayıt olmadığı için onay/silme yok. */}
                    {e.isSystemGenerated ? (
                      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[9.5px] font-bold text-slate-600" title="İptal edilen satışın iadesi — sistem kaydı">SİSTEM</span>
                    ) : e.isApproved ? (
                      <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-[9.5px] font-bold text-emerald-700">ONAYLI</span>
                    ) : (
                      // Personelin girdiği kayıt onay bekler; yönetici tek tıkla onaylar.
                      <button
                        type="button"
                        onClick={() => void approveExpense(e)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[9.5px] font-bold text-amber-700 transition-colors hover:bg-amber-100"
                        title="Bu kaydı onayla"
                      >
                        <CheckCircle2 className="h-3 w-3" /> ONAYLA
                      </button>
                    )}
                    <span className="shrink-0 font-display text-[18px] tabular-nums text-[#c85776]">{formatTL(e.amount)}</span>
                    {e.isSystemGenerated ? (
                      // İade kaydı buradan silinemez: kaynağı iptal edilmiş satıştır (defter kaydı).
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#f0e6ea] bg-[#faf6f8] text-[#c9b7c0]" title="Sistem kaydı — buradan silinemez">
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <ConfirmDialog
                        destructive title="Gider silinsin mi?"
                        description={`${e.description || expenseCategoryLabels[e.category]} · ${formatTL(e.amount)}`}
                        confirmLabel="Sil"
                        onConfirm={() => deleteExpense(e)}
                        trigger={
                          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#ead8df] bg-white text-[#b499a6] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                      />
                    )}
                  </div>
                )
              })}
              {list.length === 0 && (
                <div className="rounded-[18px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-12 text-center text-[12.5px] text-[#705a66]">
                  {expenseQuery
                    ? 'Aramaya uyan kayıt yok.'
                    : tab === 'salary' ? 'Bu ay maaş ödemesi yok. Üstten “Maaş Öde” ile başla.' : 'Bu ay gider kaydı yok. Üstten “Yeni Gider” ile başla.'}
                </div>
              )}
            </div>
          </>
          )
        })()}
      </div>

      {/* Yeni adisyon: müşteri seçtirir, ardından adisyon kartını açar */}
      <AdisyonModal
        open={newAdisyonOpen}
        onOpenChange={setNewAdisyonOpen}
        tenantId={tenantId}
        allowPick
        onChanged={reload}
      />

      {/* Günlük adisyon kartı — gün içinde kime ne yapıldı, saatli, tahsilatlar */}
      <DailyAdisyonModal open={dailyOpen} onOpenChange={setDailyOpen} tenantId={tenantId} />
    </>
  )
}

function OverviewCard({ icon: Icon, label, value, chip, chipTone, bars, valueTone }: {
  icon: typeof Wallet; label: string; value: string; chip?: string; chipTone?: string; bars: number[]; valueTone?: string
}) {
  return (
    <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-5 w-5" /></span>
        <MiniBars values={bars} />
      </div>
      <div className="mt-3 text-[11px] text-[#352432]/55">{label}</div>
      <div className={`font-display text-3xl tabular-nums tracking-tight ${valueTone || 'text-[#352432]'}`}>{value}</div>
      {chip && <span className={`mt-2 inline-block rounded-full border border-transparent px-2 py-0.5 text-[9px] font-medium ${chipTone || 'bg-[#fff1f6] text-[#b14d6c]'}`}>{chip}</span>}
    </div>
  )
}

function BottomCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: typeof Wallet }) {
  return (
    <div className="flex items-center justify-between rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">{label}</div>
        <div className="mt-1 font-display text-3xl tabular-nums tracking-tight">{value}</div>
        <div className="text-[10px] text-[#352432]/45">{sub}</div>
      </div>
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fff1f6] text-[#e0a18f]"><Icon className="h-6 w-6" /></span>
    </div>
  )
}

export default function OnMuhasebePage() {
  return (
    <Suspense fallback={null}>
      <OnMuhasebePageInner />
    </Suspense>
  )
}
