'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import AdisyonPanel from '@/components/dashboard/AdisyonPanel'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import CustomerSessionsCard from '@/components/dashboard/CustomerSessionsCard'
import ExpenseFormDialog, { type ExpenseFormDialogValues } from '@/components/dashboard/ExpenseFormDialog'
import LoyaltyCard from '@/components/dashboard/LoyaltyCard'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { customerSearchProvider } from '@/components/dashboard/CustomerPicker'
import {
  apiItems, expenseCategoryLabels, formatTL, guidOrUndefined, normalizeAccount, normalizeAdisyon,
  normalizeAppointment, normalizeCustomCategory, normalizeCustomer, normalizeExpense, normalizePackage, normalizeStaff,
} from '@/lib/apiMappers'
import {
  Banknote, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  CreditCard, FileText, Landmark, PencilLine, Phone, PieChart, Receipt, ReceiptText,
  Trash2, TrendingDown, TrendingUp, User, Users, Wallet, Zap,
} from 'lucide-react'
import type {
  Adisyon, ApiAdisyon, ApiAppointment, ApiBusinessExpense, ApiCustomExpenseCategory, ApiCustomer,
  ApiCustomerAccount, ApiServicePackage, ApiStaff, BusinessExpense, CustomExpenseCategory,
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
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false)
  const [selectedAdisyonId, setSelectedAdisyonId] = useState<string | null>(null)
  const [adisyonFilter, setAdisyonFilter] = useState<'all' | 'Open' | 'Approved' | 'Cancelled'>('all')
  const [accountFilter, setAccountFilter] = useState<'all' | 'upcoming' | 'overdue'>(scope === 'upcoming' ? 'upcoming' : scope === 'overdue' ? 'overdue' : 'all')
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [busy, setBusy] = useState(false)

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
    staff: ApiStaff[]; expenseCats: ApiCustomExpenseCategory[]
  }>(
    async () => {
      if (!tenantId) return { accounts: [], expenses: [], adisyonlar: [], appts: [], customers: [], packages: [], staff: [], expenseCats: [] }
      const [accounts, expenses, adisyonlar, appts, customers, packages, staff, expenseCats] = await Promise.all([
        adminApi.accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.expenses<ApiBusinessExpense>({ tenantId, fromUtc: monthStart.toISOString(), toUtc: monthEnd.toISOString(), page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        adminApi.adisyonlar<ApiAdisyon>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        // Sınırsız müşteri ölçeği: liste çekilmez, seçim sunucu aramasıyla.
        Promise.resolve<ApiCustomer[]>([]),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 100 }).catch(() => ({ items: [] })),
        adminApi.expenseCategories<ApiCustomExpenseCategory>(tenantId).catch(() => []),
      ])
      return {
        accounts: apiItems(accounts), expenses: apiItems(expenses), adisyonlar: apiItems(adisyonlar),
        appts: apiItems(appts), customers, packages: apiItems(packages),
        staff: apiItems(staff), expenseCats: Array.isArray(expenseCats) ? expenseCats : [],
      }
    },
    [tenantId, monthStart.toISOString()],
    { initialData: { accounts: [], expenses: [], adisyonlar: [], appts: [], customers: [], packages: [], staff: [], expenseCats: [] } },
  )

  const accounts = useMemo(() => (data?.accounts || []).map((a, i) => normalizeAccount(a, i)), [data])
  const expenses = useMemo(() => (data?.expenses || []).map((e, i) => normalizeExpense(e, i)), [data])
  const adisyonlar = useMemo(() => (data?.adisyonlar || []).map((a) => normalizeAdisyon(a)), [data])
  const appts = useMemo(() => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)), [data])
  const customers = useMemo(() => (data?.customers || []).map((c, i) => normalizeCustomer(c, i)), [data])
  const customerSearch = useMemo(() => customerSearchProvider(tenantId), [tenantId])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
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
  const todayIso = new Date().toISOString().slice(0, 10)

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
    for (const a of accounts) for (const i of a.installments) if (i.overdue) { sum += i.remaining; count++ }
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

  const filteredAdisyonlar = useMemo(() => {
    const list = adisyonlar.filter((a) => inMonth(a.openedAtUtc) || a.status === 'Open')
    return adisyonFilter === 'all' ? list : list.filter((a) => a.status === adisyonFilter)
  }, [adisyonlar, adisyonFilter, monthStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const selAdisyon = useMemo(() => filteredAdisyonlar.find((a) => a.id === selectedAdisyonId) || filteredAdisyonlar[0], [filteredAdisyonlar, selectedAdisyonId])

  // ---------- cari hesaplar ----------
  const filteredAccounts = useMemo(() => {
    let list = accounts
    if (accountFilter === 'upcoming') list = list.filter((a) => a.installments.some((i) => i.status !== 'Paid' && i.remaining > 0 && !i.overdue))
    else if (accountFilter === 'overdue') list = list.filter((a) => a.installments.some((i) => i.overdue))
    return list
  }, [accounts, accountFilter, todayIso])
  const selAccount = useMemo(() => filteredAccounts.find((a) => a.id === selectedAccountId) || filteredAccounts[0], [filteredAccounts, selectedAccountId])

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
        detail: [p.method, p.reference].filter(Boolean).join(' · '),
        debit: 0,
        credit: p.amount,
      })
    }
    rows.sort((x, y) => (x.date || '').localeCompare(y.date || ''))
    let bal = 0
    return rows.map((r) => ({ ...r, balance: (bal += r.debit - r.credit) }))
  }, [selAccount, adisyonlar])

  const totalCollected = accounts.reduce((s, a) => s + a.paidAmount, 0)
  const apptRevenueAll = appts.filter((a) => a.status === 'tamamlandi').reduce((s, a) => s + Number(a.price || 0), 0)

  // ---------- işlemler ----------
  const goScope = (s: ScopeKey) => router.push(`/admin/on-muhasebe?scope=${s}`)

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

  const deleteExpense = async (e: BusinessExpense) => {
    setActionError('')
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
    if (acct) setSelectedAccountId(acct.id)
    setAccountFilter('all')
    goScope('accounts')
  }

  // ---------- topbar aksiyonu (sekmeye göre) ----------
  const topAction = (() => {
    if (tab === 'adisyon') {
      return (
        <AdminEditDialog
          triggerLabel="Yeni Adisyon" eyebrow="Adisyon · POST" titleIcon={ReceiptText} title="Yeni adisyon aç"
          description="Müşteri için açık hesap fişi açılır. Kalemler eklendikçe toplanır; onaylanınca cariye + kasaya işlenir."
          submitLabel="Adisyonu aç"
          onSubmit={async (v) => { const cid = String((v as Record<string, unknown>).customerId || ''); if (!cid) throw new Error('Müşteri seç.'); await createAdisyonFor(cid) }}
          fields={[{ label: 'Müşteri', name: 'customerId', type: 'select', search: customerSearch, value: '', required: true, icon: User, fullWidth: true }]}
        />
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
        <AdminEditDialog
          triggerLabel="Maaş Öde" eyebrow="BusinessExpense · Salary" titleIcon={Users} title="Personel maaşı öde"
          description="Maaş ödemesi gider olarak kasaya işlenir ve personel maaşları sekmesinde listelenir." submitLabel="Maaşı öde"
          onSubmit={async (v) => {
            const fv = v as Record<string, unknown>
            const payload = {
              category: 'Salary', amount: Number(fv.amount || 0), paymentMethod: fv.method || 'BankTransfer',
              occurredAtUtc: new Date(`${String(fv.date || new Date().toISOString().slice(0, 10))}T12:00:00`).toISOString(),
              staffMemberId: fv.staffMemberId || null, periodLabel: String(fv.period || ''), description: 'Aylık maaş', reference: null, branchId: branchId || null,
            }
            await adminApi.createExpense(payload, tenantId)
            await reload()
          }}
          fields={[
            { label: 'Personel', name: 'staffMemberId', type: 'select', value: staff[0]?.id || '', options: staff.map((s) => ({ value: s.id, label: `${s.name} · ${s.role}` })), required: true, icon: User, fullWidth: true },
            { label: 'Tutar', name: 'amount', type: 'number', value: 25000, required: true, icon: Wallet, prefix: '₺' },
            { label: 'Ödeme yöntemi', name: 'method', type: 'select', value: 'BankTransfer', options: [{ value: 'BankTransfer', label: 'Havale / EFT' }, { value: 'Cash', label: 'Nakit' }, { value: 'Card', label: 'Kart' }], icon: Landmark },
            { label: 'Dönem', name: 'period', value: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`, icon: CalendarDays },
            { label: 'Tarih', name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10), icon: CalendarDays },
          ]}
        />
      )
    }
    return (
      <AdminEditDialog
        triggerLabel="Yeni Cari" eyebrow="CustomerAccount · POST" titleIcon={CreditCard} title="Yeni cari hesap" size="lg"
        description="Müşteri için borç/taksit takibi yapılacak cari hesap açılır. Paket seçilirse seans bakiyeleri otomatik oluşturulur."
        submitLabel="Cari hesabı aç"
        onSubmit={async (v) => {
          const fv = v as Record<string, unknown>
          const payload = {
            customerId: fv.customerId, servicePackageId: fv.servicePackageId || null,
            name: String(fv.name || 'Cari hesap'), totalAmount: Number(fv.totalAmount || 0),
            depositAmount: Number(fv.depositAmount || 0), installmentCount: Number(fv.installmentCount || 0),
            firstDueDate: String(fv.firstDueDate || new Date().toISOString().slice(0, 10)), notes: (fv.notes as string) || null,
          }
          await adminApi.createAccount(payload, tenantId)
          await reload()
        }}
        fields={[
          { label: 'Müşteri', name: 'customerId', type: 'select', search: customerSearch, value: '', required: true, icon: User, section: 'Müşteri & paket', fullWidth: true },
          { label: 'Paket (opsiyonel)', name: 'servicePackageId', type: 'select', value: '', options: [{ value: '', label: '— Paketsiz —' }, ...packages.map((p) => ({ value: p.id, label: `${p.name} · ${formatTL(p.totalPrice)}` }))], icon: ClipboardList, fullWidth: true, helper: 'Paket seçilirse hizmet seans bakiyeleri otomatik açılır' },
          { label: 'Cari adı', name: 'name', value: 'Paket satışı', required: true, icon: FileText, section: 'Tutar & plan' },
          { label: 'Toplam tutar', name: 'totalAmount', type: 'number', value: 2500, required: true, icon: Wallet, prefix: '₺' },
          { label: 'Peşinat', name: 'depositAmount', type: 'number', value: 500, icon: Banknote, prefix: '₺' },
          { label: 'Taksit sayısı', name: 'installmentCount', type: 'number', value: 5, icon: CalendarDays, suffix: 'ay' },
          { label: 'İlk vade', name: 'firstDueDate', type: 'date', value: new Date().toISOString().slice(0, 10), icon: CalendarDays },
          { label: 'Not', name: 'notes', type: 'textarea', value: '', icon: FileText, fullWidth: true },
        ]}
      />
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

            <div className="grid gap-4 xl:grid-cols-2">
              {/* Gider dağılımı */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex items-center justify-between">
                  <div><div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Bu Ay Gider Dağılımı</div><div className="font-display text-3xl tracking-tight">{formatTL(expenseMonth)}</div></div>
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><PieChart className="h-5 w-5" /></span>
                </div>
                <div className="mt-4 space-y-3">
                  {Object.entries(expenses.reduce<Record<string, { sum: number; count: number }>>((m, e) => { const k = expenseCategoryLabels[e.category] || e.category; m[k] = { sum: (m[k]?.sum ?? 0) + e.amount, count: (m[k]?.count ?? 0) + 1 }; return m }, {}))
                    .sort((a, b) => b[1].sum - a[1].sum)
                    .map(([name, v]) => {
                      const pct = expenseMonth > 0 ? Math.round((v.sum / expenseMonth) * 100) : 0
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between text-[12px]">
                            <span className="flex items-center gap-2 text-[#352432]/75"><span className="grid h-7 w-7 place-items-center rounded-[8px] bg-violet-50 text-violet-600"><Users className="h-3.5 w-3.5" /></span>{name}</span>
                            <span className="font-display tabular-nums text-[#c85776]">{formatTL(v.sum)}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]"><span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${pct}%` }} /></div>
                          <div className="mt-0.5 text-[9px] font-mono uppercase text-[#352432]/40">%{pct} · {v.count} kalem</div>
                        </div>
                      )
                    })}
                  {expenses.length === 0 && <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[12px] text-[#352432]/45">Bu ay gider kaydı yok.</div>}
                </div>
              </div>

              {/* Personel maaş yükü */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex items-center justify-between">
                  <div><div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Personel Maaş Yükü</div><div className="font-display text-3xl tracking-tight">{formatTL(salaryTotal)}</div></div>
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-violet-50 text-violet-600"><Users className="h-5 w-5" /></span>
                </div>
                <div className="mt-4 space-y-2">
                  {Object.entries(salaryExpenses.reduce<Record<string, { sum: number; count: number }>>((m, e) => { const k = e.staffName || e.description || 'Personel'; m[k] = { sum: (m[k]?.sum ?? 0) + e.amount, count: (m[k]?.count ?? 0) + 1 }; return m }, {}))
                    .sort((a, b) => b[1].sum - a[1].sum)
                    .map(([name, v]) => (
                      <div key={name} className="flex items-center justify-between rounded-[12px] border border-[#f0e0e6] bg-[#fffafc] px-3 py-2.5">
                        <span className="flex items-center gap-2.5 text-[13px] text-[#352432]"><span className="grid h-8 w-8 place-items-center rounded-[9px] bg-violet-50 text-violet-600"><User className="h-4 w-4" /></span>{name} <span className="text-[10px] text-[#352432]/40">{v.count} ödeme</span></span>
                        <span className="font-display tabular-nums text-[#c85776]">{formatTL(v.sum)}</span>
                      </div>
                    ))}
                  {salaryExpenses.length === 0 && <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[12px] text-[#352432]/45">Bu ay maaş ödemesi yok.</div>}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <BottomCard label="Kira" value={formatTL(rentTotal)} sub="Bu ay" icon={Building2} />
              <BottomCard label="Faturalar" value={formatTL(utilTotal)} sub="Elektrik / su / internet" icon={Zap} />
              <BottomCard label="Açık Alacak" value={formatTL(openReceivable)} sub={`${activeAccountCount} cari`} icon={CreditCard} />
            </div>
          </>
        )}

        {/* ================= ADİSYON ================= */}
        {tab === 'adisyon' && canAdisyon && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                <ReceiptText className="h-4 w-4" /> <b>ADİSYON</b> · AÇIK HESAP FİŞLERİ — ONAYLANANLAR CARİYE VE KASAYA İŞLENİR
              </div>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={ReceiptText} label="Açık adisyon" value={String(adisyonStats.openCount)} chip={`↗ ${formatTL(adisyonStats.openNet)} bekleyen net`} bars={monthBars} />
              <OverviewCard icon={CheckCircle2} label="Onaylanan adisyon" value={String(adisyonStats.approvedCount)} chip="↗ Cariye + kasaya işlendi" chipTone="text-emerald-700 bg-emerald-50" bars={monthBars} />
              <OverviewCard icon={CreditCard} label="Cariye işlenen borç" value={formatTL(adisyonStats.charge)} bars={monthBars} />
              <OverviewCard icon={Landmark} label="Kasaya işlenen tahsilat" value={formatTL(adisyonStats.payment)} bars={monthBars} />
            </div>

            {/* Akış adımları */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                ['1 · Adisyon açılır, kalemler toplanır', 'border-amber-300/50 bg-amber-50 text-amber-700'],
                ['2 · Yönetici onaylar', 'border-emerald-300/50 bg-emerald-50 text-emerald-700'],
                ['3 · Borç cariye, tahsilat kasaya işlenir', 'border-rose-300/50 bg-rose-50 text-rose-700'],
              ].map(([t, cls], i) => (
                <span key={t} className="flex items-center gap-2">
                  <span className={`rounded-[12px] border px-3.5 py-2 text-[11px] font-medium ${cls}`}>{t}</span>
                  {i < 2 && <ChevronRight className="h-4 w-4 text-[#352432]/30" />}
                </span>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
              {/* ADİSYONLAR listesi */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Adisyonlar</div><div className="font-display text-2xl tracking-tight">{filteredAdisyonlar.length} fiş</div></div>
                  <div className="inline-flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
                    {([['all', 'TÜMÜ'], ['Open', 'AÇIK'], ['Approved', 'ONAYLI'], ['Cancelled', 'İPTAL']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setAdisyonFilter(k)}
                        className={`rounded-[8px] px-2.5 py-1 text-[10px] font-mono tracking-wide transition-colors ${adisyonFilter === k ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {filteredAdisyonlar.map((a) => (
                    <button key={a.id} type="button" onClick={() => setSelectedAdisyonId(a.id)}
                      className={`flex w-full items-center gap-3 rounded-[14px] border p-3.5 text-left transition-colors ${selAdisyon?.id === a.id ? 'border-[#c85776]/60 bg-[#fff1f6]/50' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-[#352432]">{a.customerName || 'Müşteri'}</div>
                        <div className="text-[10px] font-mono text-[#352432]/45">{(a.openedAtUtc || '').slice(0, 10)} · {a.items.length} kalem</div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-[16px] tabular-nums text-[#c85776]">{formatTL(a.chargeTotal)}</div>
                        <div className="text-[9px] font-mono uppercase text-emerald-700">TAHSİLAT {formatTL(a.paymentTotal)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-mono uppercase text-[#352432]/40">Net</div>
                        <div className="font-display text-[14px] tabular-nums">{formatTL(a.chargeTotal - a.paymentTotal)}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-mono uppercase ${a.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : a.status === 'Open' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                        ● {a.status === 'Approved' ? 'ONAYLANDI' : a.status === 'Open' ? 'AÇIK' : 'İPTAL'}
                      </span>
                    </button>
                  ))}
                  {filteredAdisyonlar.length === 0 && <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#352432]/45">Bu dönemde adisyon yok. Üstten "Yeni Adisyon" ile açabilirsin.</div>}
                </div>
              </div>

              {/* ADİSYON DETAY */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                {selAdisyon ? (
                  selAdisyon.status === 'Open' ? (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Adisyon Detay · {selAdisyon.customerName}</div>
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-mono uppercase text-amber-700">● AÇIK</span>
                      </div>
                      <AdisyonPanel customerId={selAdisyon.customerId} tenantId={tenantId} onChanged={reload} />
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Adisyon Detay</div>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-mono uppercase ${selAdisyon.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>● {selAdisyon.status === 'Approved' ? 'ONAYLANDI' : 'İPTAL'}</span>
                      </div>
                      <div className="mt-1 font-display text-3xl tracking-tight">{selAdisyon.customerName}</div>
                      <div className="text-[11px] text-[#352432]/50">Açılış: {(selAdisyon.openedAtUtc || '').slice(0, 10)}{selAdisyon.approvedAtUtc ? ` · Onay: ${selAdisyon.approvedAtUtc.slice(0, 10)}` : ''}</div>

                      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#ead8df]/65 bg-[#f1e5ea]">
                        <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Borç</div><div className="font-display text-2xl tabular-nums text-rose-700">{formatTL(selAdisyon.chargeTotal)}</div></div>
                        <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Tahsilat</div><div className="font-display text-2xl tabular-nums text-emerald-700">{formatTL(selAdisyon.paymentTotal)}</div></div>
                        <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Net</div><div className="font-display text-2xl tabular-nums">{formatTL(selAdisyon.chargeTotal - selAdisyon.paymentTotal)}</div></div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        {selAdisyon.items.map((it) => (
                          <div key={it.id} className="flex items-center justify-between rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-mono uppercase ${it.type === 'Payment' ? 'bg-emerald-50 text-emerald-700' : it.type === 'Discount' ? 'bg-rose-50 text-rose-700' : 'bg-[#fff1f6] text-[#c85776]'}`}>
                                {{ Payment: 'TAHSİLAT', Product: 'ÜRÜN', Service: 'HİZMET', PackageSale: 'PAKET SATIŞI', PackageUse: 'PAKETTEN', Extra: 'EK KALEM', Discount: 'İNDİRİM' }[it.type] || 'KALEM'}
                              </span>
                              <span className="truncate text-[13px] text-[#352432]">{it.description}</span>
                            </span>
                            <span className="font-display tabular-nums text-[14px]">{formatTL(it.lineTotal)}</span>
                          </div>
                        ))}
                      </div>

                      <button type="button" onClick={() => showInAccounts(selAdisyon)}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-emerald-300/50 bg-emerald-50 px-4 py-3 text-[12px] font-medium text-emerald-700 hover:bg-emerald-100">
                        <CreditCard className="h-4 w-4" /> Cari hesaplarda gör
                      </button>
                    </>
                  )
                ) : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Adisyon seçimi yok.</div>}
              </div>
            </div>
          </>
        )}

        {/* ================= CARİ HESAPLAR ================= */}
        {tab === 'accounts' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                <CreditCard className="h-4 w-4" /> Cari hesaplar modülü ile müşterilerin borç, ödeme, tahsilat ve taksit işlemlerini görüntüleyebilir ve yönetebilirsiniz.
              </div>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={CreditCard} label="Toplam açık alacak" value={formatTL(openReceivable)} chip={`↗ ${activeAccountCount} aktif`} bars={monthBars} />
              <OverviewCard icon={TrendingDown} label="Geciken bakiye" value={formatTL(overdue.sum)} chip={`↗ ${overdue.count} kayıt`} chipTone={overdue.count ? 'text-rose-700 bg-rose-50' : undefined} bars={monthBars} />
              <OverviewCard icon={Landmark} label="Toplam tahsilat" value={formatTL(totalCollected)} bars={monthBars} />
              <OverviewCard icon={CalendarDays} label="Randevu cirosu (tahakkuk)" value={formatTL(apptRevenueAll)} chip="↗ Tahsilatla karıştırılmaz" bars={monthBars} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
              {/* LİSTE */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Cari Hesaplar</div><div className="font-display text-2xl tracking-tight">{filteredAccounts.length} kayıt</div></div>
                  <div className="inline-flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
                    {([['all', 'Tümü'], ['upcoming', 'Bekleyen'], ['overdue', 'Geciken']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setAccountFilter(k)}
                        className={`rounded-[8px] px-2.5 py-1 text-[10px] font-medium transition-colors ${accountFilter === k ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {filteredAccounts.map((a) => {
                    const pct = a.totalAmount > 0 ? Math.round((a.paidAmount / a.totalAmount) * 100) : 0
                    const isOverdue = a.installments.some((i) => i.overdue)
                    return (
                      <button key={a.id} type="button" onClick={() => setSelectedAccountId(a.id)}
                        className={`w-full rounded-[14px] border p-3.5 text-left transition-colors ${selAccount?.id === a.id ? 'border-[#c85776]/60 bg-[#fff1f6]/50' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-medium text-[#352432]">{a.customerName || a.name}</div>
                            <div className="truncate text-[10px] text-[#352432]/45">{a.servicePackageName || a.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-display text-[16px] tabular-nums text-[#c85776]">{formatTL(a.remainingAmount)}</div>
                            <div className="text-[9px] font-mono text-[#352432]/40">{a.nextDueDate ? `Vade: ${a.nextDueDate}` : 'Vade yok'}</div>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-1 text-[9px] font-mono uppercase ${a.remainingAmount > 0 ? (isOverdue ? 'border-rose-300/40 bg-rose-50 text-rose-700' : 'border-amber-300/40 bg-amber-50 text-amber-700') : 'border-emerald-300/40 bg-emerald-50 text-emerald-700'}`}>
                            {a.remainingAmount > 0 ? (isOverdue ? 'GECİKEN' : 'AÇIK') : 'KAPALI'}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]"><span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${pct}%` }} /></div>
                        <div className="mt-1 text-[9px] font-mono uppercase text-[#352432]/40">%{pct} ÖDENDİ · {formatTL(a.paidAmount)} / {formatTL(a.totalAmount)}</div>
                      </button>
                    )
                  })}
                  {filteredAccounts.length === 0 && <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#352432]/45">Bu kapsamda cari hesap yok.</div>}
                </div>
              </div>

              {/* CARİ DETAY */}
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
                {selAccount ? (
                  <>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Cari Detay</div>
                    <div className="mt-1 font-display text-3xl tracking-tight">{selAccount.customerName || selAccount.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#352432]/55">
                      {selAccount.customerPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-[#c85776]" /> {selAccount.customerPhone}</span>}
                      <span className="truncate">{[selAccount.name, selAccount.servicePackageName].filter(Boolean).join(' • ')}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#ead8df]/65 bg-[#f1e5ea]">
                      <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Toplam</div><div className="font-display text-xl tabular-nums">{formatTL(selAccount.totalAmount)}</div></div>
                      <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Ödenen</div><div className="font-display text-xl tabular-nums text-emerald-700">{formatTL(selAccount.paidAmount)}</div></div>
                      <div className="bg-white p-3 text-center"><div className="text-[9px] font-mono uppercase text-[#352432]/40">Kalan</div><div className="font-display text-xl tabular-nums text-rose-700">{formatTL(selAccount.remainingAmount)}</div></div>
                    </div>
                    {selAccount.creditBalance > 0 && (
                      <div className="mt-2 flex items-center justify-between rounded-[12px] border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-700">
                        <span className="flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5" /> Fazla ödeme (kredi)</span>
                        <span className="font-display tabular-nums">{formatTL(selAccount.creditBalance)}</span>
                      </div>
                    )}

                    <button type="button" onClick={() => setAccountDetailsOpen((open) => !open)}
                      className="mt-3 flex w-full items-center justify-between rounded-[12px] border border-[#ead8df]/70 bg-[#fff4f8]/40 px-3 py-2.5 text-[11px] font-mono uppercase tracking-widest text-[#352432]/70 transition-colors hover:bg-[#fff1f6]">
                      <span>{accountDetailsOpen ? 'Detayları gizle' : 'Cari hesap detayları'}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${accountDetailsOpen ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence initial={false}>
                      {accountDetailsOpen && (
                        <motion.div
                          key={`account-details-${selAccount.id}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          {/* Hesap ekstresi — borç / alacak / yürüyen bakiye */}
                          <div className="mt-4">
                            <div className="flex items-center justify-between">
                              <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Hesap Ekstresi · {ledger.length} hareket</div>
                              {ledger.length > 0 && (
                                <span className={`rounded-md px-2 py-0.5 text-[9px] font-mono uppercase ${ledger[ledger.length - 1].balance > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                  Bakiye {formatTL(ledger[ledger.length - 1].balance)} {ledger[ledger.length - 1].balance > 0 ? '(B)' : ''}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 overflow-hidden rounded-[12px] border border-[#ead8df]/65">
                              <div className="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.7fr_0.7fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-3 py-2 text-[8px] font-mono uppercase tracking-widest text-[#352432]/40">
                                <span>Tarih</span><span>İşlem</span><span className="text-right">Borç</span><span className="text-right">Alacak</span><span className="text-right">Bakiye</span>
                              </div>
                              <div className="max-h-44 divide-y divide-[#f1e5ea] overflow-y-auto bg-white">
                                {ledger.map((r, i) => (
                                  <div key={i} className="grid grid-cols-[0.8fr_1.4fr_0.7fr_0.7fr_0.7fr] items-center gap-2 px-3 py-2 text-[11px]">
                                    <span className="font-mono text-[10px] text-[#352432]/50">{(r.date || '').slice(0, 10) || '—'}</span>
                                    <span className="min-w-0">
                                      <span className={`mr-1.5 rounded px-1 py-0.5 text-[8px] font-mono uppercase ${r.credit > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-[#fff1f6] text-[#c85776]'}`}>{r.label}</span>
                                      <span className="truncate text-[10px] text-[#352432]/50">{r.detail}</span>
                                    </span>
                                    <span className="text-right font-display tabular-nums text-rose-700">{r.debit > 0 ? formatTL(r.debit) : '—'}</span>
                                    <span className="text-right font-display tabular-nums text-emerald-700">{r.credit > 0 ? formatTL(r.credit) : '—'}</span>
                                    <span className={`text-right font-display tabular-nums ${r.balance > 0 ? 'text-[#352432]' : 'text-emerald-700'}`}>{formatTL(r.balance)}</span>
                                  </div>
                                ))}
                                {ledger.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-[#352432]/45">Hareket yok.</div>}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3"><CustomerSessionsCard customerId={selAccount.customerId} tenantId={tenantId} refreshKey={sessionsTick} /></div>
                          <div className="mt-3"><LoyaltyCard customerId={selAccount.customerId} tenantId={tenantId} /></div>

                          {/* Taksit planı — tahsilatlar vade sırasıyla taksitlere dağıtılır (kısmi/tam/gecikti) */}
                          <div className="mt-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Taksit Planı · {selAccount.installments.length} kalem</div>
                            <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                              {selAccount.installments.map((i) => {
                                const partial = i.status !== 'Paid' && i.paidAmount > 0.005
                                const late = i.overdue
                                const tone = i.status === 'Paid' ? 'border-emerald-200/60 bg-emerald-50/50'
                                  : late ? 'border-rose-200/60 bg-rose-50/50'
                                  : partial ? 'border-sky-200/70 bg-sky-50/40'
                                  : 'border-[#f0e0e6] bg-[#fffafc]'
                                const [badgeLabel, badgeTone] = i.status === 'Paid' ? ['ÖDENDİ', 'bg-emerald-100 text-emerald-700']
                                  : late ? ['GECİKTİ', 'bg-rose-100 text-rose-700']
                                  : partial ? ['KISMİ', 'bg-sky-100 text-sky-700']
                                  : ['BEKLİYOR', 'bg-amber-50 text-amber-700']
                                return (
                                  <div key={i.id} className={`rounded-[10px] border px-3 py-2 text-[12px] ${tone}`}>
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-2"><span className="font-mono text-[10px] text-[#352432]/40">#{i.no}</span><span>{i.dueDate}</span></span>
                                      <span className="flex items-center gap-2"><span className="font-display tabular-nums">{formatTL(i.amount)}</span>
                                        <span className={`rounded-md px-1.5 py-0.5 text-[8px] font-mono uppercase ${badgeTone}`}>{badgeLabel}</span></span>
                                    </div>
                                    {partial && (
                                      <div className="mt-1 flex items-center justify-between text-[10px]">
                                        <span className="text-emerald-700">✓ Ödendi {formatTL(i.paidAmount)}</span>
                                        <span className="font-medium text-rose-700">Kalan {formatTL(i.remaining)}</span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                              {selAccount.installments.length === 0 && <div className="rounded-[10px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[11px] text-[#352432]/45">Taksit planı yok.</div>}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Aksiyonlar */}
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <AdminEditDialog
                        triggerLabel="Tahsilat Al" eyebrow="AccountPayment · POST" titleIcon={Banknote} title={`Tahsilat · ${selAccount.customerName || selAccount.name}`}
                        description="Tahsilat en eski vadeden başlayarak taksitlere dağıtılır: tutar yettiği taksitleri tam kapatır, eksik kalırsa o taksit kısmen ödenmiş görünür. Bir taksitten fazla ödeme sonraki taksitlere sayılır." submitLabel="Tahsilatı kaydet"
                        onSubmit={async (v) => {
                          const fv = v as Record<string, unknown>
                          const payload = { amount: Number(fv.amount || 0), method: String(fv.method || 'cash'), reference: (fv.reference as string) || null, occurredAtUtc: new Date(`${String(fv.date || todayIso)}T12:00:00`).toISOString() }
                          const res = await performWrite({ operationType: 'RegisterAccountPayment', title: `Tahsilat: ${formatTL(payload.amount)}`, summary: selAccount.customerName || '', payload: { ...payload, accountId: selAccount.id }, tenantId, directAction: () => adminApi.registerAccountPayment(selAccount.id, payload, tenantId) })
                          if (res.submittedToApproval) setActionMsg(staffApprovalSuccessMessage('Tahsilat'))
                          await reload()
                        }}
                        fields={[
                          { label: 'Tutar', name: 'amount', type: 'number', value: selAccount.nextDueAmount || 500, required: true, icon: Wallet, prefix: '₺' },
                          { label: 'Yöntem', name: 'method', type: 'select', value: 'cash', options: [{ value: 'cash', label: 'Nakit' }, { value: 'card', label: 'Kart' }, { value: 'transfer', label: 'Havale / EFT' }], icon: CreditCard },
                          { label: 'Tarih', name: 'date', type: 'date', value: todayIso, icon: CalendarDays },
                          { label: 'Referans', name: 'reference', value: '', icon: FileText },
                        ]}
                      />
                      <AdminEditDialog
                        triggerVariant="ghost" triggerLabel="Taksiti Değiştir" eyebrow="Reschedule · PATCH" titleIcon={PencilLine} title="Taksit planını yeniden oluştur"
                        description="Finanse edilen tutar (toplam − peşinat) seçtiğin taksit sayısına eşit bölünür; alınan tahsilatlar yeni plana baştan dağıtılır." submitLabel="Planı güncelle"
                        onSubmit={async (v) => {
                          const fv = v as Record<string, unknown>
                          await adminApi.rescheduleAccount(selAccount.id, { installmentCount: Number(fv.installmentCount || 0), firstDueDate: String(fv.firstDueDate || todayIso) }, tenantId)
                          await reload()
                        }}
                        fields={[
                          { label: 'Taksit sayısı', name: 'installmentCount', type: 'number', value: Math.max(1, selAccount.installments.filter((i) => i.status === 'Planned').length), required: true, icon: CalendarDays, suffix: 'ay' },
                          { label: 'İlk vade', name: 'firstDueDate', type: 'date', value: todayIso, icon: CalendarDays },
                        ]}
                      />
                      <ConfirmDialog destructive title={`"${selAccount.customerName || selAccount.name}" carisi silinsin mi?`} description="Cari pasifleştirilir; ödeme geçmişi raporlarda kalır." confirmLabel="Cariyi sil"
                        onConfirm={async () => { await adminApi.deleteAccount(selAccount.id, tenantId); setSelectedAccountId(null); await reload() }}
                        trigger={<button type="button" className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" /> Cariyi Sil</button>} />
                    </div>
                  </>
                ) : <div className="grid h-full place-items-center py-16 text-sm text-[#352432]/45">Cari seçimi yok.</div>}
              </div>
            </div>
          </>
        )}

        {/* ================= GİDERLER + MAAŞLAR ================= */}
        {(tab === 'expenses' || tab === 'salary') && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
                {tab === 'salary' ? <><Users className="h-4 w-4" /> <b>PERSONEL MAAŞLARI</b> · SADECE MAAŞ VE AVANS KAYITLARI</> : <><TrendingDown className="h-4 w-4" /> <b>GİDERLER</b> · TÜM İŞLETME GİDERLERİ (KİRA, SARF, FATURA)</>}
              </div>
              {monthNav}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard icon={TrendingDown} label="Bu ay toplam" value={formatTL(expenseMonth)} chip={`↗ ${expenses.length} kalem`} bars={monthBars} />
              <OverviewCard icon={Users} label="Personel maaşı" value={formatTL(salaryTotal)} chip="↗ Tüm personel" bars={monthBars} />
              <OverviewCard icon={Building2} label="Kira" value={formatTL(rentTotal)} chip="↗ Şubeler" bars={monthBars} />
              <OverviewCard icon={Zap} label="Faturalar" value={formatTL(utilTotal)} chip="↗ Elektrik / su / internet" bars={monthBars} />
            </div>

            <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
              <div className="border-b border-[#ead8df]/70 px-5 py-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">{tab === 'salary' ? 'Personel Maaş Ödemeleri' : 'Tüm Giderler'}</div>
                <div className="font-display text-2xl tracking-tight">{(tab === 'salary' ? salaryExpenses : expenses).length} kalem <span className="ml-2 text-[12px] font-mono uppercase tracking-widest text-[#352432]/40">TOPLAM: {formatTL((tab === 'salary' ? salaryExpenses : expenses).reduce((s, e) => s + e.amount, 0))}</span></div>
              </div>
              <div className="hidden grid-cols-[1.6fr_0.8fr_0.9fr_0.7fr_0.6fr_0.4fr] gap-2 border-b border-[#ead8df]/50 bg-[#fffafc] px-5 py-2.5 text-[9px] font-mono uppercase tracking-widest text-[#352432]/40 sm:grid">
                <span>Açıklama</span><span>Tarih</span><span>Ödeme Yöntemi</span><span>Tutar</span><span>Durum</span><span />
              </div>
              <div className="divide-y divide-[#f1e5ea]">
                {(tab === 'salary' ? salaryExpenses : expenses).map((e) => (
                  <div key={e.id} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[1.6fr_0.8fr_0.9fr_0.7fr_0.6fr_0.4fr] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-violet-50 text-violet-600">{e.category === 'Salary' ? <Users className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-[#352432]">{e.description || expenseCategoryLabels[e.category]}</div>
                        <div className="truncate text-[10px] text-[#352432]/45">{[expenseCategoryLabels[e.category], e.staffName, e.periodLabel].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/55"><CalendarDays className="h-3 w-3 text-[#c85776]/60" /> {(e.occurredAt || '').slice(0, 10)}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/55"><Landmark className="h-3 w-3 text-[#c85776]/60" /> {METHOD_LABEL[e.paymentMethod] || e.paymentMethod}</div>
                    <div className="font-display text-[15px] tabular-nums text-[#c85776]">{formatTL(e.amount)}</div>
                    <div><span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-mono uppercase ${e.isApproved ? 'border-emerald-300/40 bg-emerald-50 text-emerald-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}><CheckCircle2 className="h-3 w-3" /> {e.isApproved ? 'ONAYLI' : 'BEKLİYOR'}</span></div>
                    <div className="flex justify-end">
                      <ConfirmDialog destructive title="Gider silinsin mi?" description={`${e.description || expenseCategoryLabels[e.category]} · ${formatTL(e.amount)}`} confirmLabel="Sil"
                        onConfirm={() => deleteExpense(e)}
                        trigger={<button type="button" className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df]/70 bg-white text-[#352432]/40 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>} />
                    </div>
                  </div>
                ))}
                {(tab === 'salary' ? salaryExpenses : expenses).length === 0 && (
                  <div className="px-5 py-12 text-center text-sm text-[#352432]/45">{tab === 'salary' ? 'Bu ay maaş ödemesi yok. Üstten "Maaş Öde" ile başla.' : 'Bu ay gider kaydı yok. Üstten "Yeni Gider" ile başla.'}</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
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
