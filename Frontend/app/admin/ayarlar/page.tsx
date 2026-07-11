'use client'

import Link from 'next/link'
import Topbar from '@/components/dashboard/Topbar'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ExcelTransferActions from '@/components/dashboard/ExcelTransferActions'
import WhatsAppSettingsCard from '@/components/dashboard/WhatsAppSettingsCard'
import SecuritySettingsCard from '@/components/dashboard/SecuritySettingsCard'
import { UsageBar } from '@/components/dashboard/UsageBar'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import {
  apiItems, formatTL, guidOrUndefined, normalizeAccount, normalizeAdisyon, normalizeAppointment,
  normalizeService, normalizeStaff, normalizeSubscriptionPlan, normalizeTenant, normalizeTenantUsage,
} from '@/lib/apiMappers'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Banknote, Building2, Calendar, CalendarClock, ClipboardList,
  CreditCard, DoorOpen, FileText, Landmark, Layers3, Mail, MapPin, MessageSquare, Package, PenLine,
  Percent, Phone as PhoneIcon, Plus, Receipt, ShoppingBag, Sparkles, Star, Tag, TrendingUp, Users, UsersRound, Wallet, Zap,
} from 'lucide-react'
import type {
  ApiAdisyon, ApiAuditLog, ApiBranch, ApiCustomerAccount, ApiAppointment, ApiService, ApiServicePackage,
  ApiStaff, ApiSubscriptionPlan, ApiTenant, ApiTenantUsage, PagedResult, Service, Staff, SubscriptionPlan, Tenant,
} from '@/lib/types'

interface SettingsBranch {
  id: string
  name: string
  city: string
  isDefault: boolean
  staffCount: number
  roomCount: number
}

function normalizeSettingsBranch(branch: ApiBranch | null | undefined, index = 0): SettingsBranch {
  return {
    id: branch?.id || branch?.branchId || `branch-${index}`,
    name: branch?.name || branch?.branchName || `Şube ${index + 1}`,
    city: branch?.city || 'Şehir yok',
    isDefault: Boolean(branch?.isDefault),
    staffCount: branch?.staffCount ?? branch?.staff ?? 0,
    roomCount: branch?.roomCount ?? branch?.rooms ?? 0,
  }
}

interface AyarlarData {
  tenant: ApiTenant
  branchesResult: PagedResult<ApiBranch>
  staffResult: PagedResult<ApiStaff>
  servicesResult: PagedResult<ApiService>
  packagesResult: PagedResult<ApiServicePackage>
  accountsResult: PagedResult<ApiCustomerAccount>
  apptsResult: PagedResult<ApiAppointment>
  adisyonResult: PagedResult<ApiAdisyon>
  auditResult: PagedResult<ApiAuditLog>
  usage: ApiTenantUsage
  plans: ApiSubscriptionPlan[]
}

export default function AyarlarPage() {
  const { selectedInstitutionId, selectedInstitution, refreshBranches } = useBranch()
  const canMultiBranch = useFeature('multiBranch')
  const tenantId = guidOrUndefined(selectedInstitutionId)

  const { data, loading, error, reload } = useApiQuery<AyarlarData>(
    async () => {
      const [tenant, branchesResult, staffResult, servicesResult, packagesResult, accountsResult, apptsResult, adisyonResult, auditResult, usage, plans] = await Promise.all([
        adminApi.currentTenant<ApiTenant>(tenantId),
        adminApi.branches<ApiBranch>(tenantId),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 100 }),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch<PagedResult<ApiServicePackage>>(() => ({ items: [] })),
        adminApi.accounts<ApiCustomerAccount>({ tenantId, page: 1, pageSize: 500 }).catch<PagedResult<ApiCustomerAccount>>(() => ({ items: [] })),
        adminApi.appointments<ApiAppointment>({ tenantId, page: 1, pageSize: 500 }).catch<PagedResult<ApiAppointment>>(() => ({ items: [] })),
        adminApi.adisyonlar<ApiAdisyon>({ tenantId, page: 1, pageSize: 200 }).catch<PagedResult<ApiAdisyon>>(() => ({ items: [] })),
        adminApi.auditLogs<ApiAuditLog>({ tenantId, page: 1, pageSize: 1 }).catch<PagedResult<ApiAuditLog>>(() => ({ items: [] })),
        adminApi.currentTenantUsage<ApiTenantUsage>(tenantId),
        adminApi.subscriptionPlans<ApiSubscriptionPlan>(),
      ])
      return { tenant, branchesResult, staffResult, servicesResult, packagesResult, accountsResult, apptsResult, adisyonResult, auditResult, usage, plans }
    },
    [tenantId],
    { initialData: null },
  )

  const tenant: Tenant | null = data?.tenant ? normalizeTenant(data.tenant) : null
  const rawTenant = data?.tenant
  const branches: SettingsBranch[] = apiItems(data?.branchesResult).map((b, i) => normalizeSettingsBranch(b, i))
  const staff: Staff[] = apiItems(data?.staffResult).map((s, i) => normalizeStaff(s, i))
  const services: Service[] = apiItems(data?.servicesResult).map((s, i) => normalizeService(s, i))
  const packages = apiItems(data?.packagesResult).map((p, i) => ({ id: p?.id || String(i) }))
  const accounts = useMemoLike(apiItems(data?.accountsResult).map((a, i) => normalizeAccount(a, i)))
  const appts = useMemoLike(apiItems(data?.apptsResult).map((a, i) => normalizeAppointment(a, {}, i)))
  const adisyonlar = useMemoLike(apiItems(data?.adisyonResult).map((a) => normalizeAdisyon(a)))
  const auditTotal = data?.auditResult?.total ?? data?.auditResult?.totalCount ?? 0
  const lastLog = apiItems(data?.auditResult)[0]

  const activeStaff = staff.filter((p) => p.active).length
  const serviceGroups = [...new Set(services.map((s) => s.group).filter(Boolean))]
  const specialties = [...new Set(staff.map((s) => s.dept).filter(Boolean))]
  const defaultBranch = branches.find((b) => b.isDefault) || branches[0]
  const usage = normalizeTenantUsage(data?.usage)
  const currentPlan: SubscriptionPlan | undefined = (data?.plans ?? [])
    .map((p, i) => normalizeSubscriptionPlan(p, i))
    .find((p) => p.id === usage.subscriptionPlanId)
  const metricIcons: Record<string, typeof Building2> = {
    branches: Building2, staff: UsersRound, customers: Users, appointments: Calendar, sms: MessageSquare,
  }

  // ---------- gelir hesapları ----------
  const now = new Date()
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const prevM0 = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
  const inRange = (iso: string | undefined | null, from: number, to: number) => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t >= from && t < to
  }
  const calcIncome = (from: number, to: number) => {
    const pay = accounts.flatMap((a) => a.payments).filter((p) => inRange(p.occurredAtUtc, from, to)).reduce((s, p) => s + p.amount, 0)
    const appt = appts.filter((a) => a.status === 'tamamlandi' && inRange(a.date, from, to)).reduce((s, a) => s + Number(a.price || 0), 0)
    return pay + appt
  }
  const incomeMonth = calcIncome(m0, Date.now() + 86_400_000)
  const incomePrev = calcIncome(prevM0, m0)
  const growth = incomePrev > 0 ? Math.round(((incomeMonth - incomePrev) / incomePrev) * 100) : incomeMonth > 0 ? 100 : 0

  // Gelir kalemleri (bu ay)
  const pkgAccountIds = new Set(accounts.filter((a) => a.servicePackageId).map((a) => a.id))
  const paketGelir = accounts.filter((a) => pkgAccountIds.has(a.id)).flatMap((a) => a.payments).filter((p) => inRange(p.occurredAtUtc, m0, Date.now() + 86_400_000)).reduce((s, p) => s + p.amount, 0)
  const hizmetGelir = appts.filter((a) => a.status === 'tamamlandi' && inRange(a.date, m0, Date.now() + 86_400_000)).reduce((s, a) => s + Number(a.price || 0), 0)
  const urunGelir = adisyonlar.filter((a) => a.status === 'Approved' && inRange(a.approvedAtUtc, m0, Date.now() + 86_400_000)).flatMap((a) => a.items).filter((i) => i.type === 'Product').reduce((s, i) => s + i.lineTotal, 0)
  const digerGelir = accounts.filter((a) => !pkgAccountIds.has(a.id)).flatMap((a) => a.payments).filter((p) => inRange(p.occurredAtUtc, m0, Date.now() + 86_400_000)).reduce((s, p) => s + p.amount, 0)
  const kalemler = [
    { label: 'Hizmet Satışları', value: hizmetGelir, icon: Zap },
    { label: 'Paket Satışları', value: paketGelir, icon: Package },
    { label: 'Ürün Satışları', value: urunGelir, icon: ShoppingBag },
    { label: 'Diğer Gelirler', value: digerGelir, icon: Wallet },
  ]
  const kalemToplam = kalemler.reduce((s, k) => s + k.value, 0)
  const kalemMax = Math.max(1, ...kalemler.map((k) => k.value))

  // ---------- handler'lar ----------
  interface BranchFormValues { name?: string; city?: string; isDefault?: boolean; staffCount?: number; roomCount?: number }
  const branchPayload = (values: BranchFormValues): Record<string, unknown> => ({
    name: values.name, city: values.city, isDefault: Boolean(values.isDefault),
    staffCount: Number(values.staffCount || 0), roomCount: Number(values.roomCount || 0),
  })

  interface TenantProfileValues { name?: string; legalName?: string; ownerName?: string; phone?: string; email?: string; domain?: string; taxNumber?: string; taxOffice?: string }
  interface TenantFinanceValues { currency?: string; maxInstallments?: number; overdueGraceDays?: number }

  const updateTenantProfile = async (values: TenantProfileValues) => {
    if (!tenant) return
    await adminApi.updateCurrentTenant({
      name: values.name || tenant.name, plan: tenant.plan, status: rawTenant?.status || 'Active',
      domain: values.domain || null, ownerName: values.ownerName || null, phone: values.phone || null,
      taxNumber: values.taxNumber || null, currency: tenant.currency,
      maxInstallments: tenant.maxInstallments, overdueGraceDays: tenant.overdueGraceDays,
      legalName: values.legalName || null, taxOffice: values.taxOffice || null, email: values.email || null,
    }, tenantId)
    await reload()
  }

  const updateTenantFinance = async (values: TenantFinanceValues) => {
    if (!tenant) return
    await adminApi.updateCurrentTenant({
      name: tenant.name, plan: tenant.plan, status: rawTenant?.status || 'Active',
      domain: tenant.domain, ownerName: tenant.ownerName, phone: tenant.phone || null, taxNumber: tenant.taxNumber || null,
      currency: (values.currency || tenant.currency).toUpperCase(),
      maxInstallments: Number(values.maxInstallments ?? tenant.maxInstallments),
      overdueGraceDays: Number(values.overdueGraceDays ?? tenant.overdueGraceDays),
      legalName: rawTenant?.legalName || null, taxOffice: rawTenant?.taxOffice || null, email: rawTenant?.email || null,
    }, tenantId)
    await reload()
  }

  const profileEditDialog = tenant && (
    <AdminEditDialog
      triggerLabel="Kurum Profili" titleIcon={PenLine} title="Kurum profilini düzenle"
      description="Marka adı, yasal unvan, vergi ve iletişim bilgileri tüm sistemde ve faturalarda kullanılır."
      submitLabel="Profili güncelle"
      onSubmit={(v) => updateTenantProfile(v as TenantProfileValues)}
      fields={[
        { label: 'Kurum adı', name: 'name', value: tenant.name, required: true, icon: Building2, section: 'Marka', fullWidth: true },
        { label: 'Yasal işletme adı', name: 'legalName', value: rawTenant?.legalName || '', icon: Landmark, fullWidth: true, helper: 'Ticari unvan — faturalarda görünür' },
        { label: 'Yetkili kişi', name: 'ownerName', value: tenant.ownerName, icon: Users },
        { label: 'Domain', name: 'domain', value: tenant.domain.replace(/\.beautyassist\.app$/, ''), icon: Tag },
        { label: 'Vergi numarası', name: 'taxNumber', value: tenant.taxNumber, icon: Receipt, section: 'Fatura & iletişim' },
        { label: 'Vergi dairesi', name: 'taxOffice', value: rawTenant?.taxOffice || '', icon: Landmark },
        { label: 'İletişim telefonu', name: 'phone', value: tenant.phone, icon: PhoneIcon, placeholder: '+90 312 123 45 67' },
        { label: 'E-posta', name: 'email', type: 'email', value: rawTenant?.email || '', icon: Mail, placeholder: 'info@kurum.com.tr' },
      ]}
    />
  )

  const financeEditDialog = tenant && (
    <AdminEditDialog
      triggerVariant="ghost" triggerLabel="Düzenle" titleIcon={CreditCard} title="Ödeme & taksit ayarları"
      description="Cari hesap ve taksit modülünün çalışma kurallarını belirler." submitLabel="Ayarları kaydet"
      onSubmit={(v) => updateTenantFinance(v as TenantFinanceValues)}
      fields={[
        { label: 'Para birimi', name: 'currency', type: 'select', value: tenant.currency, options: [{ value: 'TRY', label: 'TRY — Türk Lirası' }, { value: 'USD', label: 'USD — Dolar' }, { value: 'EUR', label: 'EUR — Euro' }], icon: Banknote },
        { label: 'Maksimum taksit', name: 'maxInstallments', type: 'number', value: tenant.maxInstallments, icon: Percent, suffix: 'ay' },
        { label: 'Vade hatırlatma / tolerans', name: 'overdueGraceDays', type: 'number', value: tenant.overdueGraceDays, icon: CalendarClock, suffix: 'gün' },
      ]}
    />
  )

  return (
    <>
      <Topbar
        title="Ayarlar"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · Kurum profili, finans ve takip ayarlarını yönetin`}
        breadcrumbs={['Admin', 'Yönetim', 'Ayarlar']}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {profileEditDialog}
            {(canMultiBranch || branches.length === 0) && (
              <AdminEditDialog
                triggerVariant="ghost" triggerLabel="Şube Ekle" titleIcon={Plus} title="Yeni şube oluştur"
                description="Şube fiziksel bir çalışma noktası tanımlar." submitLabel="Şube oluştur"
                onSubmit={async (values) => { await adminApi.createBranch(branchPayload(values as BranchFormValues), tenantId); await reload(); refreshBranches() }}
                fields={[
                  { label: 'Şube adı', name: 'name', value: 'Yeni Şube', required: true, icon: Building2, section: 'Lokasyon' },
                  { label: 'Şehir', name: 'city', value: 'İstanbul', icon: MapPin },
                  { label: 'Varsayılan şube', name: 'isDefault', type: 'checkbox', value: !branches.length, icon: Star, fullWidth: true },
                  { label: 'Personel kapasitesi', name: 'staffCount', type: 'number', value: 3, icon: UsersRound, section: 'Kapasite' },
                  { label: 'Oda kapasitesi', name: 'roomCount', type: 'number', value: 2, icon: DoorOpen },
                ]}
              />
            )}
            <ExcelTransferActions<SettingsBranch>
              featureKey="excel.branches" moduleName="Şubeler" context={`${selectedInstitution?.name || 'Kurum'} · ${branches.length} şube`}
              rows={branches}
              sheet={{
                subtitle: `${selectedInstitution?.name || 'Kurum'} şube kayıtları`,
                columns: [
                  { key: 'name', header: 'Şube', width: 26, type: 'text', accessor: (b) => b.name },
                  { key: 'city', header: 'Şehir', width: 18, type: 'text', accessor: (b) => b.city },
                  { key: 'isDefault', header: 'Varsayılan', width: 12, type: 'boolean', accessor: (b) => b.isDefault },
                  { key: 'staffCount', header: 'Personel Kapasitesi', width: 18, type: 'number', accessor: (b) => b.staffCount },
                  { key: 'roomCount', header: 'Oda Kapasitesi', width: 16, type: 'number', accessor: (b) => b.roomCount },
                ],
                totals: { name: 'TOPLAM', staffCount: branches.reduce((s, b) => s + b.staffCount, 0), roomCount: branches.reduce((s, b) => s + b.roomCount, 0) },
              }}
              onImport={async (result) => {
                const first = result[0]; if (!first) return
                for (const row of first.rows) {
                  const name = String(row['Şube'] || '').trim(); if (!name) continue
                  await adminApi.createBranch({ name, city: String(row['Şehir'] || ''), isDefault: String(row['Varsayılan'] || 'Hayır').toLocaleLowerCase('tr-TR') === 'evet', staffCount: Number(row['Personel Kapasitesi'] || 0), roomCount: Number(row['Oda Kapasitesi'] || 0) }, tenantId)
                }
                await reload(); refreshBranches()
              }}
            />
          </div>
        }
      />

      <div className="space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && !tenant && !branches.length} emptyMessage="Bu tenant için ayar kaynağı yok." />

        {/* SATIR 1: KURUM PROFİLİ + ÖDEME & TAKSİT */}
        <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          {/* KURUM PROFİLİ */}
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
            className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            <span aria-hidden className="pointer-events-none absolute -right-10 top-6 h-64 w-64 rounded-full bg-[#fbd2dc]/45 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/settings/kurum-profili.png" alt="" className="pointer-events-none absolute -right-4 top-10 hidden w-72 select-none lg:block" />

            <div className="relative flex items-start justify-between gap-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/75">
                <Building2 className="h-4 w-4" /> Kurum Profili
              </div>
              {tenant && (
                <AdminEditDialog
                  triggerVariant="ghost" triggerLabel="Düzenle" titleIcon={PenLine} title="Kurum profilini düzenle"
                  description="Marka adı, yasal unvan, vergi ve iletişim bilgileri." submitLabel="Profili güncelle"
                  onSubmit={(v) => updateTenantProfile(v as TenantProfileValues)}
                  fields={[
                    { label: 'Kurum adı', name: 'name', value: tenant.name, required: true, icon: Building2, section: 'Marka', fullWidth: true },
                    { label: 'Yasal işletme adı', name: 'legalName', value: rawTenant?.legalName || '', icon: Landmark, fullWidth: true },
                    { label: 'Yetkili kişi', name: 'ownerName', value: tenant.ownerName, icon: Users },
                    { label: 'Domain', name: 'domain', value: tenant.domain.replace(/\.beautyassist\.app$/, ''), icon: Tag },
                    { label: 'Vergi numarası', name: 'taxNumber', value: tenant.taxNumber, icon: Receipt, section: 'Fatura & iletişim' },
                    { label: 'Vergi dairesi', name: 'taxOffice', value: rawTenant?.taxOffice || '', icon: Landmark },
                    { label: 'İletişim telefonu', name: 'phone', value: tenant.phone, icon: PhoneIcon },
                    { label: 'E-posta', name: 'email', type: 'email', value: rawTenant?.email || '', icon: Mail },
                  ]}
                />
              )}
            </div>

            <h2 className="relative mt-4 font-display text-4xl leading-none tracking-tight">{tenant?.name || 'Kurum'}</h2>
            <div className="relative mt-3">
              <div className="text-[10px] text-[#352432]/45">Yasal İşletme Adı</div>
              <div className="text-[14px] text-[#352432]/80">{rawTenant?.legalName || tenant?.name || '—'}</div>
            </div>

            <div className="relative mt-4 grid max-w-md gap-2 sm:grid-cols-2">
              <ProfileBox icon={Receipt} label="Vergi No" value={tenant?.taxNumber || '—'} />
              <ProfileBox icon={Landmark} label="Vergi Dairesi" value={rawTenant?.taxOffice || '—'} />
              <ProfileBox icon={PhoneIcon} label="İletişim" value={tenant?.phone || '—'} />
              <ProfileBox icon={Mail} label="E-posta" value={rawTenant?.email || tenant?.loginEmails?.[0] || '—'} />
            </div>

            <div className="relative mt-5 grid gap-2 rounded-[16px] border border-[#ead8df]/65 bg-white/80 p-2 sm:grid-cols-4">
              {([
                [String(branches.length), 'Şube', Building2],
                [String(activeStaff), 'Aktif Personel', Users],
                [String(serviceGroups.length), 'Hizmet Grubu', Layers3],
                [String(packages.length), 'Paket', Package],
              ] as const).map(([v, l, Icon]) => (
                <div key={l} className="flex items-center gap-2.5 rounded-[12px] px-2 py-1.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-4 w-4" /></span>
                  <div><div className="font-display text-2xl leading-none tabular-nums">{v}</div><div className="text-[10px] text-[#352432]/45">{l}</div></div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ÖDEME & TAKSİT */}
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.06 }}
            className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/settings/odeme-taksit.png" alt="" className="pointer-events-none absolute -bottom-4 -right-2 w-52 select-none" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#352432]"><CreditCard className="h-4 w-4 text-[#c85776]" /> <span className="font-display text-lg tracking-tight">ÖDEME & TAKSİT</span></div>
              {financeEditDialog}
            </div>
            <div className="relative mt-4 space-y-2.5">
              <PaymentRow icon={Wallet} title="Kasa Ödeme" sub="Nakit ve pos tahsilatları" value={tenant?.currency || 'TRY'} />
              <PaymentRow icon={Percent} title="Maks. Taksit" sub="Müşteri ödemelerinde" value={tenant ? `${tenant.maxInstallments} ay` : '—'} />
              <PaymentRow icon={CalendarClock} title="Vade ve Hatırlatma" sub="Hatırlatma ayarları" value={tenant ? `${tenant.overdueGraceDays} gün` : '—'} />
            </div>
            {tenant && tenant.overdueGraceDays === 0 && (
              <div className="relative mt-4 flex max-w-xs items-start gap-2 rounded-[12px] border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Tolerans 0 — vade gelir gelmez kayıt "gecikmiş" sayılır.
              </div>
            )}
          </motion.div>
        </section>

        {/* WHATSAPP HATIRLATMA ENTEGRASYONU */}
        <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <WhatsAppSettingsCard tenantId={tenantId} />
        </section>

        {/* GÜVENLİK — personel ekran görüntüsü izni */}
        <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <SecuritySettingsCard tenantId={tenantId} />
        </section>

        {/* SATIR 2: GELİR BİLGİLERİ + GELİR KALEMLERİ */}
        <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}
            className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/settings/gelir-bilgileri.png" alt="" className="pointer-events-none absolute -bottom-6 right-0 hidden w-80 select-none md:block" />
            <div className="absolute right-44 top-8 hidden md:block">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-white/90 shadow-[0_14px_40px_-18px_rgba(200,87,118,0.5)]">
                <div className="text-center"><div className="font-display text-xl leading-none text-[#c85776]">%{Math.abs(growth)}</div><div className="text-[8px] text-[#352432]/45">Bu ay {growth >= 0 ? 'artış' : 'düşüş'}</div></div>
              </div>
            </div>

            <div className="relative flex items-center gap-2 text-[12px] font-medium"><TrendingUp className="h-4 w-4 text-[#c85776]" /> <span className="font-display text-lg tracking-tight">GELİR BİLGİLERİ</span></div>
            <div className="relative text-[12px] text-[#352432]/50">Klinik genel gelir performansı ve özet bilgiler</div>
            <div className="relative mt-3 font-display text-5xl tabular-nums tracking-tight text-[#c85776]">{formatTL(incomeMonth)}</div>

            <div className="relative mt-4 flex max-w-md flex-wrap gap-1.5">
              {([
                ['Brüt Gelir Takibi', '/admin/kasa'],
                ['Hizmet Performansı', '/admin/raporlar?scope=services'],
                ['Paket Satışları', '/admin/paketler?scope=packages'],
                ['Randevu Gelirleri', '/admin/randevular'],
                ['Tahsilat Analizi', '/admin/raporlar?scope=finance'],
              ] as const).map(([l, href]) => (
                <Link key={l} href={href} className="rounded-[9px] border border-[#ead8df]/70 bg-white px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest text-[#352432]/60 transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">{l}</Link>
              ))}
            </div>
            <Link href="/admin/raporlar?scope=finance"
              className="relative mt-3 inline-flex items-center gap-2 rounded-[10px] border border-[#efbfd0]/75 bg-[#fff1f6] px-3.5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#ffe6ef]">
              Detaylı Gelir Raporu <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {/* GELİR KALEMLERİ — koyu kart */}
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.14 }}
            className="relative overflow-hidden rounded-[22px] border border-[#5c2138]/40 bg-gradient-to-br from-[#5c2138] via-[#6d2a44] to-[#3a1426] p-6 text-white shadow-[0_26px_60px_-34px_rgba(92,33,56,0.9)]">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-[12px]"><Users className="h-4 w-4 text-white/70" /> <span className="font-display text-lg tracking-tight">GELİR KALEMLERİ</span></div>
              <div className="text-right"><div className="text-[9px] uppercase tracking-widest text-white/50">Toplam</div><div className="font-display text-2xl tabular-nums">{formatTL(kalemToplam)}</div></div>
            </div>
            <div className="mt-5 space-y-4">
              {kalemler.map((k) => (
                <div key={k.label}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2 text-white/85"><span className="grid h-7 w-7 place-items-center rounded-[8px] bg-white/10"><k.icon className="h-3.5 w-3.5" /></span>{k.label}</span>
                    <span className="font-display tabular-nums">{formatTL(k.value)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#f3a3bf] to-[#ff7fa8]" style={{ width: `${Math.max(4, (k.value / kalemMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* SATIR 3: KAYIT ÖZETİ + AKTİF KADRO */}
        <section className="grid gap-4 xl:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.18 }}
            className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/settings/kayit-ozeti.png" alt="" className="pointer-events-none absolute -bottom-4 right-2 w-44 select-none" />
            <div className="relative flex items-center gap-2 text-[12px] font-medium"><ClipboardList className="h-4 w-4 text-[#c85776]" /> <span className="font-display text-lg tracking-tight">KAYIT ÖZETİ</span></div>
            <div className="relative mt-5 flex flex-wrap items-center gap-6">
              <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full border-8 border-[#fbd2dc]/60 bg-[#fff1f6]">
                <div className="text-center"><FileText className="mx-auto h-5 w-5 text-[#c85776]" /><div className="font-display text-3xl tabular-nums leading-none">{auditTotal.toLocaleString('tr-TR')}</div><div className="text-[9px] text-[#352432]/45">Toplam Kayıt</div></div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-[#352432]/50">Kayıtlarınızın detayını görüntüleyin</div>
                <div className="mt-3 grid max-w-xs grid-cols-2 gap-2 rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                  <div><div className="text-[13px] font-medium uppercase text-[#352432]">{lastLog?.actorName || '—'}</div><div className="text-[10px] text-[#352432]/45">Kayıt sahibi</div></div>
                  <div className="text-right"><div className="text-[13px] font-medium text-[#352432]">{lastLog?.createdAtUtc ? new Date(lastLog.createdAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div><div className="text-[10px] text-[#352432]/45">Oluşturulma tarihi</div></div>
                </div>
                <Link href="/admin/loglar" className="mt-3 inline-flex items-center gap-2 rounded-[10px] border border-[#ead8df]/70 bg-white px-3.5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/70 transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                  Tüm Kayıtları Görüntüle <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.22 }}
            className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/settings/aktif-kadro.png" alt="" className="pointer-events-none absolute -bottom-2 right-2 w-44 select-none" />
            <div className="relative flex items-center gap-2 text-[12px] font-medium"><Users className="h-4 w-4 text-[#c85776]" /> <span className="font-display text-lg tracking-tight">AKTİF KADRO</span></div>
            <div className="relative mt-4 flex flex-wrap gap-6">
              <div>
                <div className="font-display text-5xl tabular-nums leading-none"><span className="text-[#c85776]">{activeStaff}</span><span className="text-[#352432]/30"> / {staff.length}</span></div>
                <div className="mt-1 text-[10px] text-[#352432]/45">Aktif / Toplam</div>
                <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Uzmanlık Dağılımı</div>
                <div className="mt-1.5 flex max-w-[220px] flex-wrap gap-1.5">
                  {specialties.slice(0, 4).map((d) => <span key={d} className="rounded-[8px] border border-[#ead8df]/70 bg-[#fffafc] px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-[#352432]/60">{d}</span>)}
                  {!specialties.length && <span className="text-[11px] text-[#352432]/40">—</span>}
                </div>
                <Link href="/admin/personel" className="mt-4 inline-flex items-center gap-2 rounded-[10px] border border-[#ead8df]/70 bg-white px-3.5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/70 transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                  Tüm Personeli Görüntüle <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {staff.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5">
                    {p.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photoUrl} alt={p.name} className="h-10 w-10 shrink-0 rounded-full border border-[#efbfd0]/50 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fbd2dc] text-[11px] font-display text-[#8e3f5b]">{p.name.slice(0, 2).toUpperCase()}</span>
                    )}
                    <div className="min-w-0"><div className="truncate text-[13px] font-medium text-[#352432]">{p.name}</div><div className="text-[10px] text-[#352432]/45">{p.role}</div></div>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[8px] font-mono uppercase ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{p.active ? 'Aktif' : 'Pasif'}</span>
                  </div>
                ))}
                {!staff.length && <div className="text-[11px] text-[#352432]/40">Personel kaydı yok.</div>}
              </div>
            </div>
          </motion.div>
        </section>

        {/* MEVCUT PAKET + KULLANIM */}
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.26 }}
          className="overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
          <div className="grid gap-0 lg:grid-cols-[.65fr_1fr]">
            <div className="border-b border-[#ead8df]/70 p-6 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/75"><Package className="h-4 w-4" /> Mevcut Paket</div>
              <h3 className="mt-3 font-display text-3xl tracking-tight">{usage.planName || 'Atanmamış'}</h3>
              {currentPlan?.description && <p className="mt-1 line-clamp-2 text-[12px] text-[#352432]/55">{currentPlan.description}</p>}
              <div className="mt-4 font-display text-4xl tabular-nums beautyassist-text-gradient">{usage.planMonthlyPriceTRY === 0 ? 'Özel' : formatTL(usage.planMonthlyPriceTRY)}</div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">aylık</div>
              {(usage.hasOverflow || usage.hasWarning) && (
                <div className={`mt-5 flex items-start gap-2 rounded-[12px] border px-3 py-2.5 text-[11px] ${usage.hasOverflow ? 'border-rose-300/30 bg-rose-50 text-rose-700' : 'border-amber-300/30 bg-amber-50 text-amber-700'}`}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>{usage.hasOverflow ? 'Bazı metrikler paket limitlerini aşıyor — yükseltme önerilir.' : 'Bazı metrikler sınıra yaklaşıyor (%80+).'}</div>
                </div>
              )}
              <Link href="/admin/paket" className="group mt-5 inline-flex items-center gap-2 rounded-[10px] border border-[#efbfd0]/75 bg-[#fff1f6] px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#ffe6ef]">
                Paket detayı & yükselt <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/45"><Sparkles className="h-3.5 w-3.5" /> Kullanım</div>
                <div className={`font-display text-lg tabular-nums ${usage.hasOverflow ? 'text-rose-700' : usage.hasWarning ? 'text-amber-700' : 'text-[#c85776]'}`}>%{usage.maxPercent}</div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {usage.metrics.map((m) => <UsageBar key={m.key} metric={m} icon={metricIcons[m.key]} />)}
                {!usage.metrics.length && <div className="col-span-2 text-[11px] text-[#352432]/45">Kullanım verisi alınamadı.</div>}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ŞUBELER */}
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.3 }}
          className="overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
          <div className="flex items-center justify-between border-b border-[#ead8df]/70 px-5 py-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Şubeler</div>
              <div className="font-display text-2xl tracking-tight">{branches.length} kayıt{defaultBranch && <span className="ml-2 text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">· varsayılan: {defaultBranch.name}</span>}</div>
            </div>
            <Building2 className="h-5 w-5 text-[#c85776]/60" />
          </div>
          <div className="divide-y divide-[#f1e5ea]">
            {branches.map((b) => (
              <div key={b.id} className="grid grid-cols-1 gap-3 px-5 py-4 transition-colors hover:bg-[#fffafc] md:grid-cols-12 md:items-center">
                <div className="md:col-span-5">
                  <div className="flex items-center gap-2 text-sm text-[#352432]/85">
                    {b.name}
                    {b.isDefault && <span className="inline-flex items-center gap-1 rounded-md border border-[#efbfd0]/75 bg-[#fff1f6] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest text-[#c85776]"><Star className="h-2.5 w-2.5" /> varsayılan</span>}
                  </div>
                  <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#352432]/45"><MapPin className="mr-1 inline h-3 w-3" />{b.city}</div>
                </div>
                <div className="md:col-span-2 text-[11px] font-mono text-[#352432]/55"><UsersRound className="mr-1 inline h-3 w-3" /> {b.staffCount}</div>
                <div className="md:col-span-2 text-[11px] font-mono text-[#352432]/55"><DoorOpen className="mr-1 inline h-3 w-3" /> {b.roomCount}</div>
                <div className="md:col-span-3 flex justify-end">
                  <AdminEditDialog
                    triggerVariant="ghost" triggerLabel="Düzenle" titleIcon={PenLine} title={`${b.name} · şube ayarı`}
                    description="Şubenin isim, lokasyon ve kapasite bilgilerini günceller." submitLabel="Şubeyi güncelle"
                    onSubmit={async (values) => { await adminApi.updateBranch(b.id, branchPayload(values as BranchFormValues), tenantId); await reload(); refreshBranches() }}
                    fields={[
                      { label: 'Şube adı', name: 'name', value: b.name, required: true, icon: Tag, section: 'Lokasyon' },
                      { label: 'Şehir', name: 'city', value: b.city, icon: MapPin },
                      { label: 'Varsayılan şube', name: 'isDefault', type: 'checkbox', value: b.isDefault, icon: Star, fullWidth: true },
                      { label: 'Personel kapasitesi', name: 'staffCount', type: 'number', value: b.staffCount, icon: UsersRound, section: 'Kapasite' },
                      { label: 'Oda kapasitesi', name: 'roomCount', type: 'number', value: b.roomCount, icon: DoorOpen },
                    ]}
                  />
                </div>
              </div>
            ))}
            {!branches.length && !loading && <div className="px-5 py-8 text-center text-sm text-[#352432]/45">Henüz şube tanımlanmadı. Sağ üstten "Şube Ekle" ile başla.</div>}
          </div>
        </motion.section>
      </div>
    </>
  )
}

// useMemo kullanmadan render başına stabil dizi (sayfa zaten data değişiminde yeniden render olur)
function useMemoLike<T>(v: T): T { return v }

function ProfileBox({ icon: Icon, label, value }: { icon: typeof PhoneIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[12px] border border-[#ead8df]/65 bg-white/85 px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0">
        <div className="text-[9px] text-[#352432]/45">{label}</div>
        <div className="truncate text-[12px] font-medium text-[#352432]/85">{value}</div>
      </div>
    </div>
  )
}

function PaymentRow({ icon: Icon, title, sub, value }: { icon: typeof Wallet; title: string; sub: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[14px] border border-[#ead8df]/65 bg-white/85 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-4 w-4" /></span>
        <div><div className="text-[13px] font-medium text-[#352432]">{title}</div><div className="text-[10px] text-[#352432]/45">{sub}</div></div>
      </div>
      <div className="font-display text-base tabular-nums text-[#c85776]">{value}</div>
    </div>
  )
}
