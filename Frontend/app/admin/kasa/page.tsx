'use client'

import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import ExpenseFormDialog, { type ExpenseFormDialogValues } from '@/components/dashboard/ExpenseFormDialog'
import ScopeBadge from '@/components/dashboard/ScopeBadge'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi } from '@/lib/apiClient'
import {
  cashFlowMethodLabel,
  formatTL,
  guidOrUndefined,
  normalizeAccount,
  normalizeCashFlowEntry,
  normalizeCashFlowSummary,
  normalizeCustomCategory,
  apiItems,
} from '@/lib/apiMappers'
import { motion, type Variants } from 'framer-motion'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Calendar,
  Clock,
  CreditCard,
  Hash,
  Landmark,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
  User,
} from 'lucide-react'
import type {
  ApiCashFlowEntry,
  ApiCashFlowSummary,
  ApiCustomerAccount,
  ApiCustomExpenseCategory,
  CashFlowEntry,
  CashFlowMethodKey,
  CashFlowSummary,
  CustomExpenseCategory,
  CustomerAccount,
} from '@/lib/types'

type ScopeKey = 'today' | 'week' | 'flow'

const scopeMeta: Record<ScopeKey, { label: string; description: string }> = {
  today: { label: 'Bugün', description: 'Sadece bugünkü kasa hareketleri' },
  week: { label: 'Bu Hafta', description: 'Son 7 gündeki kasa hareketleri' },
  flow: { label: 'Gelir-Gider Akışı', description: 'Son 60 günün tüm kasa hareketleri kronolojik' },
}

// Açık tema yöntem tonları (apiMappers'taki cashFlowMethodTone koyu temaya göre — burada beyaz kart için)
const methodLight: Record<CashFlowMethodKey, { badge: string; bar: string; dot: string }> = {
  cash: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', bar: 'bg-emerald-400', dot: '#2f9e72' },
  card: { badge: 'border-sky-200 bg-sky-50 text-sky-700', bar: 'bg-sky-400', dot: '#3b82f6' },
  transfer: { badge: 'border-violet-200 bg-violet-50 text-violet-700', bar: 'bg-violet-400', dot: '#a78bfa' },
  check: { badge: 'border-amber-200 bg-amber-50 text-amber-700', bar: 'bg-amber-400', dot: '#f59e0b' },
  unknown: { badge: 'border-[#e7d6de] bg-[#f3eef1] text-[#705a66]', bar: 'bg-[#c9b3bd]', dot: '#a98a98' },
}

const methodIcon: Record<'cash' | 'card' | 'transfer', typeof CreditCard> = {
  cash: Banknote,
  card: CreditCard,
  transfer: Landmark,
}

interface KasaData {
  entries: ApiCashFlowEntry[]
  summary: ApiCashFlowSummary
  accounts: { items: ApiCustomerAccount[] }
  customCategories: ApiCustomExpenseCategory[]
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

function isoDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRange(scope: ScopeKey): { from: Date; to: Date } {
  const now = new Date()
  if (scope === 'today') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return { from, to }
  }
  if (scope === 'week') {
    const from = new Date(now)
    from.setDate(from.getDate() - 6)
    from.setHours(0, 0, 0, 0)
    const to = new Date(now)
    to.setDate(to.getDate() + 1)
    to.setHours(0, 0, 0, 0)
    return { from, to }
  }
  // flow: son 60 gün (bu ay + geçen ay görünür)
  const from = new Date(now)
  from.setDate(from.getDate() - 60)
  from.setHours(0, 0, 0, 0)
  const to = new Date(now)
  to.setDate(to.getDate() + 1)
  to.setHours(0, 0, 0, 0)
  return { from, to }
}

interface PaymentFormValues {
  accountId?: string
  amount?: number
  method?: string
  reference?: string
  occurredAtUtc?: string
}

function KasaPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'today'
  const scopeInfo = scopeMeta[scope]

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const { isStaff, performWrite } = useStaffApproval()
  const [staffActionMsg, setStaffActionMsg] = useState<string>('')

  const { from, to } = useMemo(() => getRange(scope), [scope])

  const { data, loading, error, reload } = useApiQuery<KasaData>(
    async () => {
      const [entries, summary, accounts, customCategories] = await Promise.all([
        adminApi
          .cashFlow<ApiCashFlowEntry>({ tenantId, fromUtc: from.toISOString(), toUtc: to.toISOString() })
          .catch<ApiCashFlowEntry[]>(() => []),
        adminApi
          .cashFlowSummary<ApiCashFlowSummary>({
            tenantId,
            fromUtc: from.toISOString(),
            toUtc: to.toISOString(),
          })
          .catch<ApiCashFlowSummary>(() => ({})),
        adminApi
          .accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 200 })
          .catch<{ items: ApiCustomerAccount[] }>(() => ({ items: [] })),
        adminApi
          .expenseCategories<ApiCustomExpenseCategory>(tenantId)
          .catch<ApiCustomExpenseCategory[]>(() => []),
      ])
      return { entries, summary, accounts, customCategories }
    },
    [tenantId, from.toISOString(), to.toISOString()],
    {
      initialData: { entries: [], summary: {}, accounts: { items: [] }, customCategories: [] },
    },
  )

  const entries = useMemo<CashFlowEntry[]>(
    () => (data?.entries || []).map((e, i) => normalizeCashFlowEntry(e, i)),
    [data],
  )
  const summary: CashFlowSummary = useMemo(() => normalizeCashFlowSummary(data?.summary), [data])
  const accounts = useMemo<CustomerAccount[]>(
    () => apiItems(data?.accounts).map((a, i) => normalizeAccount(a, i)),
    [data],
  )
  const customCategories = useMemo<CustomExpenseCategory[]>(
    () => (data?.customCategories || []).map((c, i) => normalizeCustomCategory(c, i)),
    [data],
  )

  // Bugünün hızlı toplamı (scope ne olursa olsun başlık için bugün)
  const todayIso = isoDateOnly(new Date())
  const todayEntries = useMemo(() => entries.filter((e) => e.date === todayIso), [entries, todayIso])
  const todayIncome = todayEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
  const todayExpense = todayEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
  const todayNet = todayIncome - todayExpense
  const todayIncomeCount = todayEntries.filter((e) => e.type === 'income').length
  const todayExpenseCount = todayEntries.filter((e) => e.type === 'expense').length

  // Method dağılımı (bugün)
  const todayMethodTotals = (['cash', 'card', 'transfer'] as CashFlowMethodKey[]).reduce<Record<string, number>>(
    (acc, m) => {
      acc[m] = todayEntries.filter((e) => e.type === 'income' && e.method === m).reduce((s, e) => s + e.amount, 0)
      return acc
    },
    {},
  )

  // Modal handlers
  const handleCreatePayment = async (values: PaymentFormValues): Promise<void> => {
    if (!values.accountId) throw new Error('Cari hesap seçimi zorunlu.')
    const occurredIso = values.occurredAtUtc || new Date().toISOString().slice(0, 10)
    const body = {
      amount: Number(values.amount || 0),
      method: values.method || 'cash',
      reference: values.reference || null,
      occurredAtUtc: new Date(`${occurredIso}T12:00:00`).toISOString(),
    }
    const res = await performWrite({
      operationType: 'RegisterAccountPayment',
      title: `Tahsilat: ${Number(values.amount || 0)} ₺`,
      summary: `${values.method || 'cash'}`,
      payload: { accountId: values.accountId, body },
      tenantId,
      directAction: () => adminApi.registerAccountPayment(values.accountId!, body, tenantId),
    })
    if (res.submittedToApproval) setStaffActionMsg(staffApprovalSuccessMessage('Tahsilat'))
    await reload()
  }

  const handleCreateExpense = async (values: ExpenseFormDialogValues): Promise<void> => {
    const occurredIso = values.occurredAt || new Date().toISOString().slice(0, 10)
    const customName = values.category === 'Other' ? values.customCategoryName : null
    const description = customName
      ? (values.description ? `[${customName}] ${values.description}` : customName)
      : values.description || null
    const payload = {
      category: values.category,
      amount: Number(values.amount || 0),
      paymentMethod: values.paymentMethod,
      occurredAtUtc: new Date(`${occurredIso}T12:00:00`).toISOString(),
      staffMemberId: null,
      periodLabel: values.periodLabel || null,
      description,
      reference: values.reference || null,
    }
    const res = await performWrite({
      operationType: 'CreateExpense',
      title: `Gider: ${values.category} · ${Number(values.amount || 0)}`,
      summary: description || '',
      payload,
      tenantId,
      directAction: () => adminApi.createExpense(payload, tenantId),
    })
    if (res.submittedToApproval) setStaffActionMsg(staffApprovalSuccessMessage('Gider ekleme'))
    await reload()
  }

  const handleCreateCustomCategory = async (name: string): Promise<CustomExpenseCategory | null> => {
    const result = await adminApi.createExpenseCategory<ApiCustomExpenseCategory>({ name, isActive: true }, tenantId)
    await reload()
    return normalizeCustomCategory(result)
  }

  const handleDeleteCustomCategory = async (id: string): Promise<void> => {
    await adminApi.deleteExpenseCategory(id, tenantId)
    await reload()
  }

  // Scope summary
  const scopedIncome = summary.totalIncome
  const scopedExpense = summary.totalExpense
  const scopedNet = summary.netAmount

  const kpis: { label: string; value: number; money: boolean; delta: string; icon: typeof Wallet; chip: string; negative?: boolean }[] = [
    { label: 'Bugünkü gelir', value: todayIncome, money: true, delta: `${todayIncomeCount} tahsilat`, icon: TrendingUp, chip: 'bg-[#e6f5ee] text-[#2f9e72]' },
    { label: 'Bugünkü gider', value: todayExpense, money: true, delta: `${todayExpenseCount} gider`, icon: TrendingDown, chip: 'bg-[#fdeaef] text-[#cf4d68]' },
    { label: 'Net kasa (bugün)', value: todayNet, money: true, delta: todayNet >= 0 ? 'pozitif' : 'negatif', icon: Wallet, chip: 'bg-[#f7eed9] text-[#b88938]', negative: todayNet < 0 },
    { label: `${scopeInfo.label} işlem`, value: entries.length, money: false, delta: `${summary.incomeCount} gelir · ${summary.expenseCount} gider`, icon: Receipt, chip: 'bg-[#fbeaf1] text-[#c85776]' },
  ]

  return (
    <>
      <Topbar
        title={isStaff ? 'Kasa / Tahsilat' : 'Günlük Kasa'}
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}${isStaff ? ' · personel yetkisi' : ''}`}
        breadcrumbs={isStaff ? ['Personel', 'Finans', 'Günlük Kasa', scopeInfo.label] : ['Admin', 'Finans', 'Günlük Kasa', scopeInfo.label]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AdminEditDialog
              triggerLabel="Tahsilat al"
              eyebrow="AccountPayment · POST"
              titleIcon={ArrowUpRight}
              title="Yeni tahsilat"
              description="Cari hesabı olan bir müşteriden ödeme al. Tahsilat sıradaki açık taksiti otomatik kapatır."
              note="POST /api/admin/accounts/{id}/payments"
              submitLabel="Tahsilatı kaydet"
              onSubmit={async (v) => handleCreatePayment(v as PaymentFormValues)}
              fields={[
                {
                  label: 'Cari hesap',
                  name: 'accountId',
                  type: 'select',
                  value: accounts[0]?.id || '',
                  options: accounts.map((a) => ({
                    value: a.id,
                    label: `${a.customerName} · ${a.name} · ${formatTL(a.remainingAmount)} kalan`,
                  })),
                  required: true,
                  icon: User,
                  fullWidth: true,
                  section: 'Cari & tutar',
                  helper: 'Cari hesap yoksa Ön Muhasebe → Yeni cari ile aç',
                },
                {
                  label: 'Tutar',
                  name: 'amount',
                  type: 'number',
                  value: 1500,
                  required: true,
                  icon: Wallet,
                  prefix: '₺',
                },
                {
                  label: 'Ödeme yöntemi',
                  name: 'method',
                  type: 'select',
                  value: 'card',
                  options: [
                    { value: 'cash', label: 'Nakit' },
                    { value: 'card', label: 'Kart' },
                    { value: 'transfer', label: 'Havale / EFT' },
                  ],
                  required: true,
                  icon: CreditCard,
                },
                {
                  label: 'Tarih',
                  name: 'occurredAtUtc',
                  type: 'date',
                  value: new Date().toISOString().slice(0, 10),
                  icon: Calendar,
                  section: 'İz',
                },
                {
                  label: 'Dekont / referans',
                  name: 'reference',
                  value: '',
                  icon: Hash,
                  placeholder: 'Opsiyonel',
                  fullWidth: true,
                },
              ]}
            />
            <ExpenseFormDialog
              customCategories={customCategories}
              onCreateCustomCategory={handleCreateCustomCategory}
              onDeleteCustomCategory={handleDeleteCustomCategory}
              onSubmit={handleCreateExpense}
              trigger={
                <button
                  type="button"
                  className="group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden border border-[#ead8df]/70 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/72 transition-colors hover:border-[#efbfd0]/75 hover:text-[#352432]"
                >
                  <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={1.6} />
                  <span>Gider ekle</span>
                </button>
              }
            />
          </div>
        }
      />

      <div className="relative space-y-7 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScopeBadge label={scopeInfo.label} description={scopeInfo.description} />
        </div>

        <ApiStateNotice loading={loading} error={error} />

        {staffActionMsg && (
          <div className="rounded-[14px] border border-emerald-300/40 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">{staffActionMsg}</div>
        )}

        {/* HEADLINE KPI'lar */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="rounded-[20px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_12px_30px_-20px_rgba(200,87,118,0.5)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full ${k.chip}`}>
                  <k.icon className="h-5 w-5" strokeWidth={1.9} />
                </div>
                <span className="rounded-full bg-[#f7ecf1] px-2.5 py-1 text-[10px] font-semibold text-[#705a66]">{k.delta}</span>
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#705a66]">{k.label}</p>
              <p className={`mt-1 font-display text-[26px] font-bold tabular-nums ${k.negative ? 'text-[#cf4d68]' : 'text-[#241923]'}`}>
                <AnimatedNumber value={k.value} format={k.money ? (n) => formatTL(Math.round(n)) : undefined} />
              </p>
            </motion.div>
          ))}
        </section>

        {/* ÖDEME YÖNTEMİ DAĞILIMI (bugün) */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)] sm:p-6"
        >
          <div className="flex items-center gap-2 text-[#241923]">
            <Banknote className="h-4 w-4 text-[#c85776]" />
            <h2 className="font-display text-lg font-bold">Bugünün ödeme yöntemi dağılımı</h2>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {(['cash', 'card', 'transfer'] as const).map((method) => {
              const amount = todayMethodTotals[method] || 0
              const ratio = todayIncome > 0 ? Math.round((amount / todayIncome) * 100) : 0
              const MIcon = methodIcon[method]
              const tone = methodLight[method]
              return (
                <div key={method} className="rounded-[16px] border border-[#efe1e7] bg-[#fffafc] p-4">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#241923]">
                      <MIcon className="h-4 w-4 text-[#c85776]" strokeWidth={1.9} /> {cashFlowMethodLabel(method)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.badge}`}>%{ratio}</span>
                  </div>
                  <div className="mt-3 font-display text-2xl font-bold tabular-nums text-[#241923]">
                    <AnimatedNumber value={amount} format={(n) => formatTL(Math.round(n))} />
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#f1e6eb]">
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${ratio}%` }}
                      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                      className={`block h-full rounded-full ${tone.bar}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </motion.section>

        {/* HAREKETLER + ÖZET */}
        <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          {/* Sol: kasa hareketleri */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)] sm:p-6"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#f2e6eb] pb-4">
              <h2 className="font-display text-lg font-bold text-[#241923]">{scopeInfo.label} · kasa hareketleri</h2>
              <span className="rounded-full border border-[#efe1e7] bg-[#fffafc] px-3 py-1 text-[11px] font-semibold text-[#705a66]">{entries.length} işlem</span>
            </div>
            <motion.div
              variants={listContainer}
              initial="hidden"
              animate="visible"
              className="mt-4 max-h-[660px] space-y-2.5 overflow-y-auto pr-1"
            >
              {entries.slice(0, 100).map((e) => {
                const income = e.type === 'income'
                const tone = methodLight[e.method]
                return (
                  <motion.div
                    key={e.id}
                    variants={listRow}
                    className="flex items-center gap-3 rounded-[16px] border border-[#efe1e7] bg-white/96 p-3.5 shadow-[0_8px_22px_-20px_rgba(200,87,118,0.5)] transition-colors hover:border-[#efbfd0]"
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                        income ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-[#cf4d68]'
                      }`}
                    >
                      {income ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[#241923]">
                          {e.description || e.category || (income ? 'Tahsilat' : 'Gider')}
                        </span>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.badge}`}>
                          {cashFlowMethodLabel(e.method)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-medium text-[#705a66]">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {e.time || '—'}{e.date ? ` · ${e.date}` : ''}</span>
                        {(e.customerName || e.staffName || e.category) && (
                          <span className="inline-flex items-center gap-1 text-[#c85776]">{e.customerName || e.staffName || e.category}</span>
                        )}
                        {e.reference && <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> {e.reference}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`font-display text-[15px] font-bold tabular-nums ${income ? 'text-emerald-700' : 'text-[#cf4d68]'}`}>
                        {income ? '+' : '−'} {formatTL(e.amount)}
                      </div>
                      <span
                        className={`mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                          e.isApproved ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {e.isApproved ? 'OK' : 'Onay'}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
              {!entries.length && (
                <div className="px-5 py-10 text-center text-sm text-[#705a66]">
                  {scopeInfo.label} kapsamında kasa hareketi yok. Üstten tahsilat veya gider ekleyebilirsin.
                </div>
              )}
            </motion.div>
          </motion.div>

          {/* Sağ: özet + donut */}
          <motion.aside
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)]"
          >
            <div className="font-display text-lg font-bold text-[#241923]">{scopeInfo.label} Özeti</div>

            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between rounded-[14px] border border-emerald-200/70 bg-emerald-50/60 px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/80">Gelir</div>
                  <div className="font-display text-2xl font-bold tabular-nums text-emerald-700">+<AnimatedNumber value={scopedIncome} format={(n) => formatTL(Math.round(n))} /></div>
                  <div className="text-[10px] font-medium text-emerald-700/70">{summary.incomeCount} tahsilat</div>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-emerald-600"><ArrowUpRight className="h-4 w-4" /></span>
              </div>
              <div className="flex items-center justify-between rounded-[14px] border border-rose-200/70 bg-rose-50/60 px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700/80">Gider</div>
                  <div className="font-display text-2xl font-bold tabular-nums text-[#cf4d68]">−<AnimatedNumber value={scopedExpense} format={(n) => formatTL(Math.round(n))} /></div>
                  <div className="text-[10px] font-medium text-rose-700/70">{summary.expenseCount} gider</div>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#cf4d68]"><ArrowDownRight className="h-4 w-4" /></span>
              </div>
              <div className="rounded-[14px] bg-gradient-to-r from-[#f7c8d8] to-[#fbdde8] px-4 py-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8e3f5b]/85">Net Kasa</div>
                <div className="font-display text-3xl font-bold tabular-nums text-[#5c2138]"><AnimatedNumber value={scopedNet} format={(n) => formatTL(Math.round(n))} /></div>
              </div>
            </div>

            {/* Yöntem dağılımı — donut */}
            {(() => {
              const methods = summary.byMethod.filter((m) => m.incomeAmount > 0)
              const totalIn = methods.reduce((a, m) => a + m.incomeAmount, 0)
              let acc = 0
              const segs = methods.map((m) => {
                const pct = totalIn > 0 ? (m.incomeAmount / totalIn) * 100 : 0
                const seg = `${methodLight[m.method].dot} ${acc}% ${acc + pct}%`
                acc += pct
                return seg
              })
              const topMethod = methods.length ? [...methods].sort((a, b) => b.incomeAmount - a.incomeAmount)[0] : null
              const topPct = totalIn > 0 && topMethod ? Math.round((topMethod.incomeAmount / totalIn) * 100) : 0
              return (
                <div className="mt-4 rounded-[16px] border border-[#efe1e7] bg-[#fffafc] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#705a66]">Yöntem Dağılımı ({scopeInfo.label})</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      {methods.map((m) => (
                        <div key={m.method} className="flex items-center gap-2 text-[11px]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: methodLight[m.method].dot }} />
                          <span className="text-[#4a3a44]">{cashFlowMethodLabel(m.method)}</span>
                          <span className="ml-auto font-semibold tabular-nums text-[#241923]">+{formatTL(m.incomeAmount)}</span>
                        </div>
                      ))}
                      {methods.length === 0 && <div className="text-[11px] text-[#705a66]">Tahsilat yok.</div>}
                    </div>
                    {methods.length > 0 && (
                      <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${segs.join(', ')})` }}>
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-center">
                          <div>
                            <div className="font-display text-[15px] font-bold leading-none text-[#241923]">%{topPct}</div>
                            <div className="text-[8px] font-semibold uppercase text-[#705a66]">{topMethod ? cashFlowMethodLabel(topMethod.method) : ''}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </motion.aside>
        </section>
      </div>
    </>
  )
}

export default function KasaPage() {
  return (
    <Suspense fallback={null}>
      <KasaPageInner />
    </Suspense>
  )
}
