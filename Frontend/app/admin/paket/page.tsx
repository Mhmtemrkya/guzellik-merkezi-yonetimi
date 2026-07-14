'use client'

import { useCallback, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { formatTL, guidOrUndefined, normalizeSubscriptionPlan, normalizeTenant, normalizeTenantUsage } from '@/lib/apiMappers'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertCircle, AlertTriangle, Building2, Calendar, CheckCircle2, Crown, CreditCard, Gem, Loader2,
  MailPlus, MessageSquare, Sparkles, Star, TrendingUp, Users, UsersRound, type LucideIcon,
} from 'lucide-react'
import type { ApiSubscriptionPlan, ApiTenant, ApiTenantUsage, SubscriptionPlan, UsageMetric } from '@/lib/types'

const cardVariant: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}
const gridVariant: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }

const metricIcons: Record<string, LucideIcon> = {
  branches: Building2, staff: UsersRound, customers: Users, appointments: Calendar, sms: MessageSquare,
}
const metricLabel: Record<string, string> = {
  branches: 'Şube', staff: 'Personel', customers: 'Müşteri', appointments: 'Aylık Randevu', sms: 'Aylık SMS',
}

// Pakete göre vitrin "öne çıkan" özellik etiketleri (mockup ile birebir). Tanınmayan planKey için
// gerçek feature anahtarlarından üretilen yedek liste kullanılır.
const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  Starter: ['Randevu Yönetimi', 'Müşteri Kayıt', 'Raporlama'],
  Pro: ['Randevu Yönetimi', 'Hatırlatma SMS', 'Stok & Ürün', 'Gelişmiş Raporlar', 'Personel Yönetimi'],
  Premium: ['Randevu Yönetimi', 'Otomatik Hatırlatma', 'Paket & Seans', 'Stok & Ürün', 'Gelişmiş Raporlar', 'Personel Yönetimi', 'SMS Entegrasyonu', 'Kasa & Tahsilat', 'Ön Muhasebe'],
  AIKlinik: ['AI Asistanı', 'Akıllı Hatırlatma', 'Tahmin Analitiği', 'Otomatik Kampanya', 'Gelişmiş Raporlar', 'Çoklu Şube Yönetimi', 'API & Entegrasyon', 'Ön Muhasebe', 'Kasa & Tahsilat', 'Yetki & Roller'],
  Enterprise: ['Özel Geliştirme', 'Özel Entegrasyon', '7/24 Destek', 'SLA & Güvence', 'Dedicated Hesap Yöneticisi'],
}

const FEATURE_FALLBACK: Array<[RegExp, string]> = [
  [/^reports\.finance/, 'Finans raporu'], [/^reports\.customer/, 'Müşteri analitiği'],
  [/^reports\.staff/, 'Personel performansı'], [/^reports\.services/, 'Hizmet doluluk'],
  [/^notifications\.automation/, 'Otomatik bildirim'], [/^notifications\.sms/, 'SMS bildirimi'],
  [/^notifications\.whatsapp/, 'WhatsApp'], [/^notifications\.email/, 'E-posta'], [/^notifications\.templates/, 'Şablonlar'],
  [/^accounting\./, 'Ön muhasebe'], [/^billing\.adisyon/, 'Adisyon'], [/^staff\.commission/, 'Personel primi'],
  [/^staff\.schedule/, 'Personel çizelge'], [/^loyalty\.points/, 'Sadakat puanı'], [/^marketing\.campaigns/, 'Kampanya'],
  [/^stock\./, 'Stok & Ürün'], [/^multiBranch/, 'Çoklu şube'], [/^pdf\./, 'PDF raporlar'], [/^excel\./, 'Excel aktarımı'],
]

function planHighlights(plan: SubscriptionPlan): string[] {
  if (PLAN_HIGHLIGHTS[plan.planKey]) return PLAN_HIGHLIGHTS[plan.planKey]
  const out: string[] = []
  for (const key of plan.features) {
    const m = FEATURE_FALLBACK.find(([re]) => re.test(key))
    const label = m ? m[1] : key
    if (!out.includes(label)) out.push(label)
    if (out.length >= 8) break
  }
  return out
}

interface PaketData { plans: ApiSubscriptionPlan[]; usage: ApiTenantUsage; tenant: ApiTenant }

export default function PaketPage() {
  const { selectedInstitutionId, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [upgradePeriod, setUpgradePeriod] = useState<'Monthly' | 'Yearly'>('Yearly')

  const { data, loading, error, reload } = useApiQuery<PaketData>(
    async () => {
      const [plans, usage, tenant] = await Promise.all([
        adminApi.subscriptionPlans<ApiSubscriptionPlan>(),
        adminApi.currentTenantUsage<ApiTenantUsage>(tenantId),
        adminApi.currentTenant<ApiTenant>(tenantId),
      ])
      return { plans, usage, tenant }
    },
    [tenantId, refreshKey],
    { initialData: null },
  )

  const handleChangePlan = useCallback(async (plan: SubscriptionPlan) => {
    const price = upgradePeriod === 'Yearly' ? plan.yearlyPriceTRY : plan.monthlyPriceTRY
    const periodText = upgradePeriod === 'Yearly' ? 'yıllık' : 'aylık'
    if (!confirm(`"${plan.name}" paketine ${periodText} dönemle geçeceksin. Tutar: ${price === 0 ? 'Özel teklif' : formatTL(price)}. Abonelik bugünden ${upgradePeriod === 'Yearly' ? '1 yıl' : '1 ay'} geçerli olur. Devam edilsin mi?`)) return
    setBusyPlanId(plan.id); setActionMsg(null); setActionErr(null)
    try {
      await adminApi.upgradeTenantPlan(plan.id, tenantId, upgradePeriod)
      setActionMsg(`Paket başarıyla "${plan.name}" (${periodText}) olarak değiştirildi.`)
      setRefreshKey((k) => k + 1)
      await reload()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Paket değiştirilirken hata oluştu.')
    } finally {
      setBusyPlanId(null)
    }
  }, [tenantId, reload, upgradePeriod])

  const usage = normalizeTenantUsage(data?.usage)
  const tenantModel = data?.tenant ? normalizeTenant(data.tenant) : null
  const plans: SubscriptionPlan[] = (data?.plans ?? [])
    .map((p, i) => normalizeSubscriptionPlan(p, i))
    .filter((p) => p.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.monthlyPriceTRY - b.monthlyPriceTRY)

  const currentPlan = plans.find((p) => p.id === usage.subscriptionPlanId)
  const currentIndex = currentPlan ? plans.findIndex((p) => p.id === currentPlan.id) : -1
  const upgradePath = currentIndex >= 0 ? plans.slice(currentIndex + 1) : plans
  // Önerilen: mevcut üstündeki ilk ücretli plan, yoksa en yüksek ücretli (mevcut hariç) standart plan.
  const recommendedPlan =
    upgradePath.find((p) => p.monthlyPriceTRY > 0) ??
    plans.filter((p) => p.monthlyPriceTRY > 0 && p.id !== currentPlan?.id).sort((a, b) => b.monthlyPriceTRY - a.monthlyPriceTRY)[0]

  const topMetric = usage.metrics.reduce<UsageMetric | undefined>((a, b) => (!a || b.percent > a.percent ? b : a), undefined)

  // Trial uyarısı
  const trialEndsAt = tenantModel?.trialEndsAt
  const status = data?.tenant?.status?.toString().toLowerCase()
  const isTrial = status === 'trial'
  const daysLeft = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000) : null
  const showTrialBanner = isTrial && trialEndsAt && daysLeft !== null && daysLeft <= 7

  // Ücretli abonelik dönemi uyarısı (trial mantığının aynısı, ücretli abonelik için).
  const subscriptionEndsAt = tenantModel?.subscriptionEndsAt
  const subscriptionPeriod = tenantModel?.subscriptionPeriod
  const isSuspended = status === 'suspended' || status === 'paused' || status === 'cancelled'
  const subDaysLeft = subscriptionEndsAt ? Math.ceil((new Date(subscriptionEndsAt).getTime() - Date.now()) / 86_400_000) : null
  // Aktifken son 30 gün → yenileme hatırlatması; pasifken abonelik bitmişse → "paket satın al".
  const showSubBanner = !isTrial && subscriptionEndsAt != null && (
    (status === 'active' && subDaysLeft !== null && subDaysLeft <= 30) || (isSuspended && subDaysLeft !== null)
  )
  const subPeriodLabel = subscriptionPeriod === 'Yearly' ? 'Yıllık' : subscriptionPeriod === 'Monthly' ? 'Aylık' : 'Abonelik'

  return (
    <>
      <Topbar
        title="Paketim"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · Mevcut abonelik, kullanım ve yükseltme yolu`}
        breadcrumbs={['Ana Sayfa', 'Paketim']}
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        {showTrialBanner && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-[14px] border px-4 py-3 text-[12px] ${daysLeft! <= 0 ? 'border-rose-300/35 bg-rose-50 text-rose-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-display text-[13px]">{daysLeft! <= 0 ? 'Deneme sürenin doldu — abonelik gerek.' : `Deneme süren ${daysLeft} gün içinde dolacak.`}</strong>
                <div className="mt-1 text-[11px] opacity-85">{daysLeft! <= 0 ? 'Hesabın yakında pasifleştirilecek; bir paket seçerek aktivasyonu sürdür.' : 'Şimdi bir paket seçerek geçişi sorunsuz yap.'}</div>
              </div>
            </div>
          </motion.div>
        )}

        {showSubBanner && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-[14px] border px-4 py-3 text-[12px] ${subDaysLeft! <= 0 ? 'border-rose-300/35 bg-rose-50 text-rose-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-display text-[13px]">
                  {subDaysLeft! <= 0
                    ? `${subPeriodLabel} aboneliğin doldu — lütfen paket satın al.`
                    : `${subPeriodLabel} aboneliğin ${subDaysLeft} gün içinde bitiyor.`}
                </strong>
                <div className="mt-1 text-[11px] opacity-85">
                  {subDaysLeft! <= 0
                    ? 'Kurum pasife alındı; aşağıdan bir paket seçip dönem yenileyerek erişimi sürdür.'
                    : `Bitiş: ${new Date(subscriptionEndsAt!).toLocaleDateString('tr-TR')} · Şimdi yenileyerek kesintisiz devam et.`}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {actionMsg && (
            <motion.div key="msg" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-[12px] border border-emerald-300/30 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700"><CheckCircle2 className="mr-2 inline h-3.5 w-3.5" />{actionMsg}</motion.div>
          )}
          {actionErr && (
            <motion.div key="err" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700"><AlertCircle className="mr-2 inline h-3.5 w-3.5" />{actionErr}</motion.div>
          )}
        </AnimatePresence>

        {/* STAT CARDS */}
        <motion.section variants={gridVariant} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Crown} label="Mevcut paket"
            value={<span className="font-display text-[26px] leading-none tracking-tight">{usage.planName || 'Atanmamış'}</span>}
            badge={{ text: isTrial ? 'Deneme' : 'Aktif', tone: isTrial ? 'amber' : 'emerald' }} decoration="crown" />
          <StatCard icon={CreditCard} label="Aylık fiyat"
            value={<AnimatedNumber value={usage.planMonthlyPriceTRY} format={(n) => (n === 0 ? 'Özel' : formatTL(Math.round(n)))} />}
            sub="Aylık faturalandırılır" />
          <StatCard icon={TrendingUp} label="En yüksek metrik" value={`%${usage.maxPercent}`}
            sub={topMetric ? metricLabel[topMetric.key] || topMetric.label : 'kullanım'}
            badge={{ text: usage.hasOverflow ? 'limit aşıldı' : usage.hasWarning ? 'sınıra yakın' : `%${usage.maxPercent} kullanıldı`, tone: usage.hasOverflow ? 'rose' : usage.hasWarning ? 'amber' : 'emerald' }} />
          <StatCard icon={Star} label="Üst paketler" value={<AnimatedNumber value={upgradePath.length} />}
            badge={recommendedPlan ? { text: `${recommendedPlan.name} (Önerilen)`, tone: 'rose' } : undefined}
            sub={recommendedPlan ? undefined : 'en üst paktesin'} decoration="sparkle" />
        </motion.section>

        {/* BU AYKİ KULLANIM */}
        <motion.section variants={cardVariant} initial="hidden" animate="visible"
          className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75"><Sparkles className="h-3.5 w-3.5" /> Bu Ayki Kullanım</div>
            {(usage.hasOverflow || usage.hasWarning) && (
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${usage.hasOverflow ? 'border-rose-300/40 bg-rose-50 text-rose-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>
                <AlertTriangle className="h-3 w-3" /> {usage.hasOverflow ? 'kritik' : 'sınıra yakın'}
              </span>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {usage.metrics.map((m) => <UsageCell key={m.key} metric={m} icon={metricIcons[m.key]} />)}
            {!usage.metrics.length && <div className="col-span-full text-[12px] text-[#352432]/45">Kullanım verisi alınamadı.</div>}
          </div>
        </motion.section>

        {/* YÜKSELTME YOLU */}
        <motion.section variants={cardVariant} initial="hidden" animate="visible">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75"><Sparkles className="h-3.5 w-3.5" /> Yükseltme Yolu</div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#352432]/45">Dönem</span>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-[#ead8df]">
                {(['Monthly', 'Yearly'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setUpgradePeriod(p)}
                    className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      upgradePeriod === p ? 'bg-[#fff1f6] text-[#c85776]' : 'bg-white text-[#9d7386] hover:text-[#c85776]'
                    }`}>
                    {p === 'Monthly' ? 'Aylık' : 'Yıllık'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {plans.map((p) => (
              <PlanCard
                key={p.id} plan={p}
                isCurrent={p.id === usage.subscriptionPlanId}
                isRecommended={recommendedPlan?.id === p.id && p.id !== usage.subscriptionPlanId}
                busy={busyPlanId === p.id}
                onChoose={() => handleChangePlan(p)}
              />
            ))}
            {!plans.length && !loading && (
              <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/80 p-12 text-center sm:col-span-2 lg:col-span-3 2xl:col-span-5">
                <Crown className="mx-auto h-10 w-10 text-[#c85776]/45" strokeWidth={1.3} />
                <div className="mt-3 text-sm text-[#352432]/65">Plan kataloğu henüz yüklenmedi.</div>
              </div>
            )}
          </div>
        </motion.section>
      </div>
    </>
  )
}

/* ---------- alt bileşenler ---------- */

const BADGE_TONE: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-300/40',
  amber: 'bg-amber-50 text-amber-700 border-amber-300/40',
  rose: 'bg-[#fff1f6] text-[#c85776] border-[#efbfd0]/70',
}

function StatCard({
  icon: Icon, label, value, sub, badge, decoration,
}: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub?: string
  badge?: { text: string; tone: string }; decoration?: 'crown' | 'sparkle'
}) {
  return (
    <motion.div variants={cardVariant}
      className="relative overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      {decoration === 'crown' && <Crown aria-hidden className="pointer-events-none absolute -right-3 top-3 h-20 w-20 text-[#f3a3bf]/15" strokeWidth={1.2} />}
      {decoration === 'sparkle' && <Sparkles aria-hidden className="pointer-events-none absolute -right-2 top-4 h-16 w-16 text-[#f3a3bf]/15" strokeWidth={1.2} />}
      <div className="relative flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><Icon className="h-5 w-5" /></span>
        <div className="text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{label}</div>
      </div>
      <div className="relative mt-3 font-display text-3xl tabular-nums tracking-tight text-[#352432]">{value}</div>
      {sub && <div className="relative mt-1 text-[11px] text-[#352432]/45">{sub}</div>}
      {badge && <span className={`relative mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide ${BADGE_TONE[badge.tone] || BADGE_TONE.rose}`}>{badge.tone === 'emerald' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{badge.text}</span>}
    </motion.div>
  )
}

function UsageCell({ metric, icon: Icon }: { metric: UsageMetric; icon?: LucideIcon }) {
  const { used, limit, percent, isUnlimited, isOver, isWarning, label } = metric
  const tone = isOver ? 'text-rose-700' : isWarning ? 'text-amber-700' : 'text-[#c85776]'
  const bar = isOver ? 'from-rose-400 to-rose-300' : isWarning ? 'from-amber-400 to-amber-300' : 'from-[#e0617f] to-[#f3a3bf]'
  return (
    <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-[#352432]/65">{Icon && <Icon className="h-3.5 w-3.5 text-[#c85776]/70" strokeWidth={1.7} />}{label}</div>
        <div className={`font-display text-[12px] tabular-nums ${tone}`}>{isUnlimited ? `${used.toLocaleString('tr-TR')} / ∞` : `${used.toLocaleString('tr-TR')} / ${limit.toLocaleString('tr-TR')}`}</div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
        <motion.div initial={{ width: 0 }} animate={{ width: `${isUnlimited ? 6 : Math.min(percent, 100)}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className={`h-full rounded-full bg-gradient-to-r ${bar}`} />
      </div>
      <div className="mt-1.5 text-right text-[10px] font-mono text-[#352432]/40">{isUnlimited ? 'sınırsız' : `%${percent}`}</div>
    </div>
  )
}

function PlanCard({
  plan, isCurrent, isRecommended, busy, onChoose,
}: {
  plan: SubscriptionPlan; isCurrent: boolean; isRecommended: boolean; busy: boolean; onChoose: () => void
}) {
  const isCustom = plan.monthlyPriceTRY === 0
  const highlights = planHighlights(plan)
  const metrics: Array<[LucideIcon, string, number]> = [
    [Building2, 'Şube', plan.maxBranches],
    [UsersRound, 'Personel', plan.maxStaff],
    [Users, 'Müşteri', plan.maxCustomers],
    [Calendar, 'Aylık Randevu', plan.maxMonthlyAppointments],
    [MessageSquare, 'Aylık SMS', plan.maxMonthlySmsCount],
  ]
  const fmt = (v: number) => (v < 0 ? '∞' : v.toLocaleString('tr-TR'))

  return (
    <motion.div variants={cardVariant}
      className={`relative flex flex-col overflow-hidden rounded-[20px] border p-5 transition-shadow ${
        isCurrent
          ? 'border-[#7a2f4d] bg-gradient-to-br from-[#5c2138] via-[#7a2f4d] to-[#3a1426] text-white shadow-[0_30px_70px_-30px_rgba(92,33,56,0.85)]'
          : isRecommended
            ? 'border-[#e0617f]/60 bg-white shadow-[0_24px_58px_-34px_rgba(200,87,118,0.55)]'
            : 'border-[#ead8df]/70 bg-white/90'
      }`}>
      {isCurrent && <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,200,220,0.25),transparent_55%)]" />}
      {isCurrent && <Gem aria-hidden className="pointer-events-none absolute -right-4 top-10 h-24 w-24 text-white/10" strokeWidth={1} />}

      {/* üst rozet */}
      <div className="relative flex items-center justify-between">
        <span className={`rounded-md px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${isCurrent ? 'bg-white/15 text-white' : 'bg-[#fff1f6] text-[#b14d6c]'}`}>
          {isCurrent ? 'Aktif Paket' : plan.planKey.toUpperCase()}
        </span>
        {isRecommended && <span className="rounded-md bg-[#e0617f] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-white">Önerilen</span>}
        {isCurrent && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
      </div>

      {/* ad + açıklama */}
      <div className="relative mt-3 flex items-center gap-1.5">
        <h3 className={`font-display text-2xl tracking-tight ${isCurrent ? 'text-white' : 'text-[#352432]'}`}>{plan.name}</h3>
        {isCurrent && <Gem className="h-4 w-4 text-[#f3a3bf]" />}
      </div>
      {plan.description && <p className={`relative mt-1 line-clamp-2 text-[11px] ${isCurrent ? 'text-white/70' : 'text-[#352432]/55'}`}>{plan.description}</p>}

      {/* fiyat */}
      <div className="relative mt-4">
        {isCustom ? (
          <div className={`font-display text-3xl tracking-tight ${isCurrent ? 'text-white' : 'text-[#c85776]'}`}>Özel Fiyat</div>
        ) : (
          <div className="flex items-end gap-1">
            <span className={`font-display text-4xl tabular-nums tracking-tight ${isCurrent ? 'text-white' : 'text-[#c85776]'}`}>{formatTL(plan.monthlyPriceTRY)}</span>
            <span className={`mb-1 text-[12px] ${isCurrent ? 'text-white/60' : 'text-[#352432]/45'}`}>/ay</span>
          </div>
        )}
      </div>

      {/* metrikler */}
      <div className="relative mt-4 space-y-1.5">
        {metrics.map(([Icon, label, value]) => (
          <div key={label} className={`flex items-center justify-between border-b pb-1.5 text-[12px] last:border-b-0 ${isCurrent ? 'border-white/10' : 'border-[#f1e5ea]'}`}>
            <span className={`flex items-center gap-1.5 ${isCurrent ? 'text-white/75' : 'text-[#352432]/60'}`}><Icon className={`h-3.5 w-3.5 ${isCurrent ? 'text-[#f3a3bf]' : 'text-[#c85776]/70'}`} strokeWidth={1.7} />{label}</span>
            <span className={`font-display tabular-nums ${isCurrent ? 'text-white' : 'text-[#352432]'}`}>{fmt(value)}</span>
          </div>
        ))}
      </div>

      {/* öne çıkan özellikler */}
      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {highlights.map((f) => (
          <span key={f} className={`rounded-md border px-2 py-0.5 text-[9px] ${isCurrent ? 'border-white/20 bg-white/10 text-white/85' : 'border-[#ead8df]/70 bg-[#fffafc] text-[#352432]/65'}`}>{f}</span>
        ))}
      </div>

      {/* aksiyon */}
      <div className="relative mt-5 pt-1">
        {isCurrent ? (
          <button type="button" disabled className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-white/25 bg-white/12 px-3 py-2.5 text-[11px] font-medium text-white">
            <CheckCircle2 className="h-4 w-4" /> Mevcut paketiniz
          </button>
        ) : isCustom ? (
          <a href="mailto:destek@beautyasist.app?subject=Enterprise%20paket%20talebi"
            className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[11px] font-medium text-[#352432]/75 transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
            <MailPlus className="h-4 w-4" /> İletişime geç
          </a>
        ) : (
          <button type="button" disabled={busy} onClick={onChoose}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-[12px] px-3 py-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              isRecommended ? 'bg-[#c85776] text-white hover:opacity-90' : 'border border-[#efbfd0]/75 bg-[#fff1f6] text-[#c85776] hover:bg-[#ffe6ef]'
            }`}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uygulanıyor…</> : <>Bu pakete geç</>}
          </button>
        )}
      </div>
    </motion.div>
  )
}
