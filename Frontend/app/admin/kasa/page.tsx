'use client'

import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import ExpenseFormDialog, { type ExpenseFormDialogValues } from '@/components/dashboard/ExpenseFormDialog'
import ScopeBadge from '@/components/dashboard/ScopeBadge'
import StatCard, { statGridContainer } from '@/components/dashboard/StatCard'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useStaffApproval, staffApprovalSuccessMessage } from '@/hooks/useStaffApproval'
import { adminApi } from '@/lib/apiClient'
import {
  cashFlowMethodLabel,
  cashFlowMethodTone,
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
  CreditCard,
  FileText,
  Hash,
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

interface KasaData {
  entries: ApiCashFlowEntry[]
  summary: ApiCashFlowSummary
  accounts: { items: ApiCustomerAccount[] }
  customCategories: ApiCustomExpenseCategory[]
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
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

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScopeBadge label={scopeInfo.label} description={scopeInfo.description} />
        </div>

        <ApiStateNotice loading={loading} error={error} />

        {staffActionMsg && (
          <div className="border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-700">{staffActionMsg}</div>
        )}

        {/* HEADLINE: Bugün */}
        <motion.section
          variants={statGridContainer}
          initial="hidden"
          animate="visible"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard
            index={0}
            label="Bugünkü gelir"
            value={<AnimatedNumber value={todayIncome} format={(n) => formatTL(Math.round(n))} />}
            icon={TrendingUp}
            accent="rose"
            delta={`${todayEntries.filter((e) => e.type === 'income').length} tahsilat`}
          />
          <StatCard
            index={1}
            label="Bugünkü gider"
            value={<AnimatedNumber value={todayExpense} format={(n) => formatTL(Math.round(n))} />}
            icon={TrendingDown}
            accent="copper"
            delta={`${todayEntries.filter((e) => e.type === 'expense').length} gider`}
          />
          <StatCard
            index={2}
            label="Net kasa (bugün)"
            value={<AnimatedNumber value={todayNet} format={(n) => formatTL(Math.round(n))} />}
            icon={Wallet}
            accent={todayNet >= 0 ? 'gold' : 'copper'}
            delta={todayNet >= 0 ? 'pozitif' : 'negatif'}
          />
          <StatCard
            index={3}
            label={`${scopeInfo.label} işlem`}
            value={<AnimatedNumber value={entries.length} />}
            icon={Receipt}
            accent="gold"
            delta={`${summary.incomeCount} gelir · ${summary.expenseCount} gider`}
          />
        </motion.section>

        {/* PAYMENT METHOD BREAKDOWN */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="armo-card armo-card-luxury p-5 sm:p-6"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-10 h-44 w-44 rounded-full bg-[#f0aac2]/14 blur-3xl"
          />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
              <Banknote className="h-3.5 w-3.5" /> Bugünün ödeme yöntemi dağılımı
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(['cash', 'card', 'transfer'] as const).map((method) => {
                const amount = todayMethodTotals[method] || 0
                const ratio = todayIncome > 0 ? Math.round((amount / todayIncome) * 100) : 0
                return (
                  <div key={method} className="border border-[#ead8df]/65 bg-white/74 p-4">
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${cashFlowMethodTone(method)}`}>
                        {cashFlowMethodLabel(method)}
                      </span>
                      <span className="text-[9px] font-mono text-[#352432]/45">%{ratio}</span>
                    </div>
                    <div className="mt-3 font-display text-2xl tracking-tight">
                      <AnimatedNumber value={amount} format={(n) => formatTL(Math.round(n))} />
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden bg-[#fff4f8]/8">
                      <motion.span
                        initial={{ width: 0 }}
                        animate={{ width: `${ratio}%` }}
                        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                        className="block h-full bg-gradient-to-r from-[#f0aac2] to-[#ffd3df]"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.section>

        {/* SCOPED INCOME/EXPENSE LIST */}
        <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden armo-card armo-card-luxury"
          >
            <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#f0aac2]/12 blur-3xl" />
            <div className="relative flex flex-col gap-3 border-b border-[#ead8df]/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
                  {scopeInfo.label} · kasa hareketleri
                </div>
                <div className="font-display text-2xl tracking-tight">
                  <AnimatedNumber value={entries.length} className="armonessa-text-gradient" /> işlem
                </div>
              </div>
            </div>
            <motion.div
              variants={listContainer}
              initial="hidden"
              animate="visible"
              className="relative divide-y divide-[#fff4f8]/8 max-h-[680px] overflow-y-auto"
            >
              {entries.slice(0, 100).map((e) => (
                <motion.div
                  key={e.id}
                  variants={listRow}
                  whileHover={{ x: 4 }}
                  className="grid items-center gap-3 px-5 py-3 transition-colors hover:bg-[#fff4f8]/[0.035] md:grid-cols-12"
                >
                  <div className="md:col-span-1">
                    <motion.span
                      whileHover={{ scale: 1.12 }}
                      className={`grid h-8 w-8 place-items-center ${
                        e.type === 'income'
                          ? 'border border-emerald-300/30 bg-emerald-400/12 text-emerald-700'
                          : 'border border-rose-300/30 bg-rose-400/12 text-rose-700'
                      }`}
                    >
                      {e.type === 'income' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    </motion.span>
                  </div>
                  <div className="md:col-span-2">
                    <div className="font-display text-sm tabular-nums">{e.time}</div>
                    <div className="text-[9px] font-mono text-[#352432]/40">{e.date}</div>
                  </div>
                  <div className="md:col-span-4 min-w-0">
                    <div className="truncate text-[13px] font-medium">
                      {e.description || e.category || (e.type === 'income' ? 'Tahsilat' : 'Gider')}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/55">
                      {e.customerName || e.staffName || e.category}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <span
                      className={`inline-flex border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${cashFlowMethodTone(e.method)}`}
                    >
                      {cashFlowMethodLabel(e.method)}
                    </span>
                  </div>
                  <div className="md:col-span-2 text-right">
                    <div
                      className={`font-display text-base tabular-nums ${
                        e.type === 'income' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {e.type === 'income' ? '+' : '−'} {formatTL(e.amount)}
                    </div>
                    {e.reference && (
                      <div className="text-[9px] font-mono text-[#352432]/40">{e.reference}</div>
                    )}
                  </div>
                  <div className="md:col-span-1 text-right">
                    {e.isApproved ? (
                      <span className="inline-flex border border-emerald-300/30 bg-emerald-400/12 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest text-emerald-700">
                        OK
                      </span>
                    ) : (
                      <span className="inline-flex border border-amber-300/30 bg-amber-400/12 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest text-amber-700">
                        Onay
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
              {!entries.length && (
                <div className="px-5 py-10 text-center text-sm text-[#352432]/45">
                  {scopeInfo.label} kapsamında kasa hareketi yok. Üstten tahsilat veya gider ekleyebilirsin.
                </div>
              )}
            </motion.div>
          </motion.div>

          {/* BUGÜN ÖZETİ (mockup) */}
          <motion.aside
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5"
          >
            <div className="font-display text-xl tracking-tight">{scopeInfo.label} Özeti</div>

            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between rounded-[14px] border border-emerald-200/60 bg-emerald-50/50 px-4 py-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-emerald-700/80">Gelir</div>
                  <div className="font-display text-2xl tabular-nums text-emerald-700">+<AnimatedNumber value={scopedIncome} format={(n) => formatTL(Math.round(n))} /></div>
                  <div className="text-[10px] text-emerald-700/60">{summary.incomeCount} tahsilat</div>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white text-emerald-600"><ArrowUpRight className="h-4 w-4" /></span>
              </div>
              <div className="flex items-center justify-between rounded-[14px] border border-rose-200/60 bg-rose-50/50 px-4 py-3">
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-rose-700/80">Gider</div>
                  <div className="font-display text-2xl tabular-nums text-rose-700">−<AnimatedNumber value={scopedExpense} format={(n) => formatTL(Math.round(n))} /></div>
                  <div className="text-[10px] text-rose-700/60">{summary.expenseCount} gider</div>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white text-rose-600"><ArrowDownRight className="h-4 w-4" /></span>
              </div>
              <div className="rounded-[14px] bg-gradient-to-r from-[#f7c8d8] to-[#fbdde8] px-4 py-3.5">
                <div className="text-[9px] font-mono uppercase tracking-widest text-[#8e3f5b]/80">Net Kasa</div>
                <div className="font-display text-3xl tabular-nums text-[#5c2138]"><AnimatedNumber value={scopedNet} format={(n) => formatTL(Math.round(n))} /></div>
              </div>
            </div>

            {/* Yöntem dağılımı — donut */}
            {(() => {
              const methods = summary.byMethod.filter((m) => m.incomeAmount > 0)
              const totalIn = methods.reduce((a, m) => a + m.incomeAmount, 0)
              const colors = ['#3b82f6', '#e0617f', '#10b981', '#a78bfa', '#f59e0b']
              let acc = 0
              const segs = methods.map((m, i) => {
                const pct = totalIn > 0 ? (m.incomeAmount / totalIn) * 100 : 0
                const seg = `${colors[i % colors.length]} ${acc}% ${acc + pct}%`
                acc += pct
                return seg
              })
              const topPct = totalIn > 0 && methods[0] ? Math.round((Math.max(...methods.map((m) => m.incomeAmount)) / totalIn) * 100) : 0
              const topMethod = methods.length ? [...methods].sort((a, b) => b.incomeAmount - a.incomeAmount)[0] : null
              return (
                <div className="mt-4 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">Yöntem Dağılımı ({scopeInfo.label})</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      {methods.map((m, i) => (
                        <div key={m.method} className="flex items-center gap-2 text-[11px]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                          <span className="text-[#352432]/65">{cashFlowMethodLabel(m.method)}</span>
                          <span className="ml-auto tabular-nums text-[#352432]">+{formatTL(m.incomeAmount)}</span>
                        </div>
                      ))}
                      {methods.length === 0 && <div className="text-[11px] text-[#352432]/40">Tahsilat yok.</div>}
                    </div>
                    {methods.length > 0 && (
                      <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${segs.join(', ')})` }}>
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-center">
                          <div>
                            <div className="font-display text-[15px] leading-none text-[#352432]">%{topPct}</div>
                            <div className="text-[8px] font-mono uppercase text-[#352432]/45">{topMethod ? cashFlowMethodLabel(topMethod.method) : ''}</div>
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
