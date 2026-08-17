'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PaymentBadges, { LegalLinkRow } from '@/components/legal/PaymentBadges'
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

/** Kayıtlı kartın GÖSTERİLEBİLİR bilgileri — token/cüzdan anahtarı sunucudan hiç dönmez. */
interface StoredCard {
  id: string
  maskedNumber?: string | null
  association?: string | null
  family?: string | null
  bankName?: string | null
  lastChargedAtUtc?: string | null
  consecutiveFailureCount: number
}

interface BillingInvoice {
  id: string
  number: string
  periodStartUtc: string
  periodEndUtc: string
  amountTRY: number
  netAmountTRY: number
  vatAmountTRY: number
  vatRate: number
  status: string
  issuedAtUtc: string
  paidAtUtc?: string | null
}

interface BillingSummary {
  paymentsEnabled: boolean
  autoRenewActive: boolean
  subscriptionEndsAtUtc?: string | null
  card?: StoredCard | null
  recentInvoices: BillingInvoice[]
}

interface CheckoutStarted { checkoutToken: string; formContent?: string | null; redirectUrl?: string | null; amountTRY: number }

interface PaketData { plans: ApiSubscriptionPlan[]; usage: ApiTenantUsage; tenant: ApiTenant; billing: BillingSummary | null }

export default function PaketPage() {
  const { selectedInstitutionId, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [upgradePeriod, setUpgradePeriod] = useState<'Monthly' | 'Yearly'>('Yearly')
  const [cardBusy, setCardBusy] = useState(false)

  // Ödeme dönüşü: sağlayıcı callback'i kullanıcıyı buraya ?payment=success|failed ile gönderir.
  // Sorgu parametresi okunduktan sonra adres çubuğundan TEMİZLENİR ki sayfa yenilendiğinde
  // eski sonuç tekrar gösterilmesin.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')
    if (!payment) return
    const message = params.get('message') || ''
    if (payment === 'success') setActionMsg(message || 'Ödeme alındı, aboneliğiniz aktif.')
    else setActionErr(message || 'Ödeme tamamlanamadı.')
    params.delete('payment'); params.delete('message')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  const { data, loading, error, reload } = useApiQuery<PaketData>(
    async () => {
      const [plans, usage, tenant, billing] = await Promise.all([
        adminApi.subscriptionPlans<ApiSubscriptionPlan>(),
        adminApi.currentTenantUsage<ApiTenantUsage>(tenantId),
        adminApi.currentTenant<ApiTenant>(tenantId),
        // Ödeme altyapısı kapalıysa ya da kullanıcı yetkili değilse bu uç hata döner;
        // paket sayfasının kalanı bundan etkilenmemeli.
        adminApi.billingSummary<BillingSummary>(tenantId).catch(() => null),
      ])
      return { plans, usage, tenant, billing }
    },
    [tenantId, refreshKey],
    { initialData: null },
  )

  const billing = data?.billing ?? null

  const handleChangePlan = useCallback(async (plan: SubscriptionPlan) => {
    const price = upgradePeriod === 'Yearly' ? plan.yearlyPriceTRY : plan.monthlyPriceTRY
    const periodText = upgradePeriod === 'Yearly' ? 'yıllık' : 'aylık'
    const isPaid = price > 0

    const question = isPaid
      ? `"${plan.name}" paketine ${periodText} dönemle geçiyorsun. Tutar: ${formatTL(price)}. Güvenli ödeme sayfasına yönlendirileceksin. Devam edilsin mi?`
      : `"${plan.name}" paketine ${periodText} dönemle geçeceksin. Bu paket için ödeme alınmıyor. Devam edilsin mi?`
    if (!confirm(question)) return

    setBusyPlanId(plan.id); setActionMsg(null); setActionErr(null)
    try {
      if (isPaid) {
        // ÜCRETLİ PAKET ÖDEMEDEN AÇILMAZ: abonelik, sağlayıcı ödemeyi onayladıktan sonra
        // callback ucunda başlatılır. Burada yalnızca ödeme sayfasına gidilir.
        const checkout = await adminApi.startBillingCheckout<CheckoutStarted>(plan.id, tenantId, upgradePeriod)
        if (checkout?.redirectUrl) {
          window.location.href = checkout.redirectUrl
          return
        }
        setActionErr('Ödeme sayfası açılamadı. Lütfen tekrar deneyin.')
        return
      }

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

  const handleRemoveCard = useCallback(async () => {
    if (!confirm('Kayıtlı kart kaldırılsın mı? Otomatik yenileme durur; aboneliğin dönem sonuna kadar devam eder.')) return
    setCardBusy(true); setActionMsg(null); setActionErr(null)
    try {
      await adminApi.removeBillingCard(tenantId)
      setActionMsg('Kayıtlı kart kaldırıldı; otomatik yenileme durdu.')
      setRefreshKey((k) => k + 1)
      await reload()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Kart kaldırılamadı.')
    } finally {
      setCardBusy(false)
    }
  }, [tenantId, reload])

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

      <div className="relative mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6 xl:px-8">
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

        {/* ÖDEME: kayıtlı kart + faturalar. Ödeme altyapısı kapalıysa hiç gösterilmez. */}
        {billing?.paymentsEnabled && (
          <motion.section variants={cardVariant} initial="hidden" animate="visible"
            className="rounded-[18px] border border-[#EAD8DF] bg-white p-5 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
              <CreditCard className="h-3.5 w-3.5" /> Ödeme ve Faturalar
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
              {/* Kayıtlı kart */}
              <div className="rounded-[14px] border border-[#EAD8DF] bg-[#fff7fa] p-4">
                {billing.card ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[15px] tracking-tight text-[#2A2027]">
                        {billing.card.maskedNumber || 'Kayıtlı kart'}
                      </span>
                      <span className="rounded-full border border-emerald-300/40 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                        Otomatik yenileme açık
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-[#74616A]">
                      {[billing.card.association, billing.card.family, billing.card.bankName].filter(Boolean).join(' · ') || 'Kart bilgisi'}
                    </div>
                    {billing.card.consecutiveFailureCount > 0 && (
                      <div className="mt-2 rounded-[10px] border border-amber-300/40 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                        <AlertCircle className="mr-1 inline h-3 w-3" />
                        Son {billing.card.consecutiveFailureCount} tahsilat denemesi başarısız. Kartınızı güncelleyin.
                      </div>
                    )}
                    {billing.subscriptionEndsAtUtc && (
                      <div className="mt-2 text-[11.5px] text-[#3E343A]">
                        <Calendar className="mr-1 inline h-3 w-3" />
                        Sonraki tahsilat: {new Date(billing.subscriptionEndsAtUtc).toLocaleDateString('tr-TR')}
                      </div>
                    )}
                    <button type="button" onClick={handleRemoveCard} disabled={cardBusy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#eec9d7] px-3 py-1.5 text-[11.5px] text-[#3E343A] transition hover:bg-white disabled:opacity-60">
                      {cardBusy && <Loader2 className="h-3 w-3 animate-spin" />} Kartı kaldır
                    </button>
                  </>
                ) : (
                  <>
                    <div className="font-display text-[15px] tracking-tight text-[#2A2027]">Kayıtlı kart yok</div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-[#74616A]">
                      Aşağıdan bir paket seçtiğinizde güvenli ödeme sayfasına yönlendirilirsiniz. Kartınızı
                      kaydederseniz abonelik dönem sonunda otomatik yenilenir. Kart bilgileri bizde saklanmaz.
                    </div>
                  </>
                )}
              </div>

              {/* Faturalar */}
              <div className="min-w-0">
                {billing.recentInvoices.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-[#eec9d7] px-4 py-6 text-center text-[12px] text-[#74616A]">
                    Henüz fatura yok.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] text-left text-[12px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-widest text-[#74616A]">
                          <th className="pb-2 font-medium">Fatura</th>
                          <th className="pb-2 font-medium">Dönem</th>
                          <th className="pb-2 text-right font-medium">Net</th>
                          <th className="pb-2 text-right font-medium">KDV</th>
                          <th className="pb-2 text-right font-medium">Toplam</th>
                          <th className="pb-2 text-right font-medium">Durum</th>
                        </tr>
                      </thead>
                      <tbody className="text-[#3E343A]">
                        {billing.recentInvoices.map((inv) => (
                          <tr key={inv.id} className="border-t border-[#f2dfe7]">
                            <td className="py-2 font-mono text-[11.5px]">{inv.number}</td>
                            <td className="py-2">{new Date(inv.periodStartUtc).toLocaleDateString('tr-TR')}</td>
                            <td className="py-2 text-right">{formatTL(inv.netAmountTRY)}</td>
                            <td className="py-2 text-right">{formatTL(inv.vatAmountTRY)}</td>
                            <td className="py-2 text-right font-semibold text-[#2A2027]">{formatTL(inv.amountTRY)}</td>
                            <td className="py-2 text-right">
                              {inv.status === 'Paid' ? (
                                <span className="rounded-full border border-emerald-300/40 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">Ödendi</span>
                              ) : (
                                <span className="rounded-full border border-amber-300/40 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">{inv.status}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ÖDEME NOKTASINDA BİLGİLENDİRME.
                Kabul edilen kartlar, ödeme kuruluşu ve satış koşulları ödemenin yapıldığı
                ekranda görünür olmalı (mesafeli satış mevzuatı + iyzico üye iş yeri kriteri). */}
            <div className="mt-4 flex flex-col gap-2.5 border-t border-[#f2dfe7] pt-4">
              <PaymentBadges />
              <p className="text-[11.5px] leading-relaxed text-[#4a3a44]">
                Paket seçip ödemeyi tamamladığınızda{' '}
                <Link href="/mesafeli-satis-sozlesmesi" target="_blank" className="font-semibold text-[#A5556E] underline underline-offset-2">
                  Mesafeli Satış Sözleşmesi
                </Link>{' '}
                ve{' '}
                <Link href="/teslimat-ve-iade" target="_blank" className="font-semibold text-[#A5556E] underline underline-offset-2">
                  Teslimat ve İade Şartları
                </Link>
                ’nı kabul etmiş sayılırsınız.
              </p>
              <LegalLinkRow className="text-[#74616A]" />
            </div>
          </motion.section>
        )}

        {/* BU AYKİ KULLANIM */}
        <motion.section variants={cardVariant} initial="hidden" animate="visible"
          className="rounded-[18px] border border-[#EAD8DF] bg-white p-5 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75"><Sparkles className="h-3.5 w-3.5" /> Bu Ayki Kullanım</div>
            {(usage.hasOverflow || usage.hasWarning) && (
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${usage.hasOverflow ? 'border-rose-300/40 bg-rose-50 text-rose-700' : 'border-amber-300/40 bg-amber-50 text-amber-700'}`}>
                <AlertTriangle className="h-3 w-3" /> {usage.hasOverflow ? 'kritik' : 'sınıra yakın'}
              </span>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {usage.metrics.map((m) => <UsageCell key={m.key} metric={m} icon={metricIcons[m.key]} />)}
            {!usage.metrics.length && <div className="col-span-full text-[12px] text-[#74616A]">Kullanım verisi alınamadı.</div>}
          </div>
        </motion.section>

        {/* YÜKSELTME YOLU */}
        <motion.section variants={cardVariant} initial="hidden" animate="visible">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75"><Sparkles className="h-3.5 w-3.5" /> Yükseltme Yolu</div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono uppercase tracking-widest text-[#74616A]">Dönem</span>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-[#EAD8DF]">
                {(['Monthly', 'Yearly'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setUpgradePeriod(p)}
                    className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      upgradePeriod === p ? 'bg-[#A5556E] text-white' : 'bg-white text-[#9d7386] hover:text-[#A5556E]'
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
              <div className="rounded-[18px] border border-[#EAD8DF] bg-white/80 p-12 text-center sm:col-span-2 lg:col-span-3 2xl:col-span-5">
                <Crown className="mx-auto h-10 w-10 text-[#A5556E]/45" strokeWidth={1.3} />
                <div className="mt-3 text-sm text-[#5A4B53]">Plan kataloğu henüz yüklenmedi.</div>
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
  rose: 'bg-[#A5556E] text-white border-[#EAD8DF]',
}

function StatCard({
  icon: Icon, label, value, sub, badge, decoration,
}: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub?: string
  badge?: { text: string; tone: string }; decoration?: 'crown' | 'sparkle'
}) {
  return (
    <motion.div variants={cardVariant}
      className="relative overflow-hidden rounded-[18px] border border-[#EAD8DF] bg-white p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      {decoration === 'crown' && <Crown aria-hidden className="pointer-events-none absolute -right-3 top-3 h-20 w-20 text-[#f3a3bf]/15" strokeWidth={1.2} />}
      {decoration === 'sparkle' && <Sparkles aria-hidden className="pointer-events-none absolute -right-2 top-4 h-16 w-16 text-[#f3a3bf]/15" strokeWidth={1.2} />}
      <div className="relative flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#A5556E] text-white"><Icon className="h-5 w-5" /></span>
        <div className="text-[11px] font-mono uppercase tracking-widest text-[#74616A]">{label}</div>
      </div>
      <div className="relative mt-3 font-display text-3xl tabular-nums tracking-tight text-[#2A2027]">{value}</div>
      {sub && <div className="relative mt-1 text-[11px] text-[#74616A]">{sub}</div>}
      {badge && <span className={`relative mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide ${BADGE_TONE[badge.tone] || BADGE_TONE.rose}`}>{badge.tone === 'emerald' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{badge.text}</span>}
    </motion.div>
  )
}

function UsageCell({ metric, icon: Icon }: { metric: UsageMetric; icon?: LucideIcon }) {
  const { used, limit, percent, isUnlimited, isOver, isWarning, label } = metric
  const tone = isOver ? 'text-rose-700' : isWarning ? 'text-amber-700' : 'text-[#A5556E]'
  const bar = isOver ? 'from-rose-400 to-rose-300' : isWarning ? 'from-amber-400 to-amber-300' : 'from-[#e0617f] to-[#f3a3bf]'
  return (
    <div className="rounded-[14px] border border-[#EAD8DF]/65 bg-[#F7F6F6] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-[#5A4B53]">{Icon && <Icon className="h-3.5 w-3.5 text-[#A5556E]/70" strokeWidth={1.7} />}{label}</div>
        <div className={`font-display text-[12px] tabular-nums ${tone}`}>{isUnlimited ? `${used.toLocaleString('tr-TR')} / ∞` : `${used.toLocaleString('tr-TR')} / ${limit.toLocaleString('tr-TR')}`}</div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
        <motion.div initial={{ width: 0 }} animate={{ width: `${isUnlimited ? 6 : Math.min(percent, 100)}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className={`h-full rounded-full bg-gradient-to-r ${bar}`} />
      </div>
      <div className="mt-1.5 text-right text-[10px] font-mono text-[#74616A]">{isUnlimited ? 'sınırsız' : `%${percent}`}</div>
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
            : 'border-[#EAD8DF] bg-white'
      }`}>
      {isCurrent && <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,200,220,0.25),transparent_55%)]" />}
      {isCurrent && <Gem aria-hidden className="pointer-events-none absolute -right-4 top-10 h-24 w-24 text-white/10" strokeWidth={1} />}

      {/* üst rozet */}
      <div className="relative flex items-center justify-between">
        <span className={`rounded-md px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${isCurrent ? 'bg-white/15 text-white' : 'bg-[#F6DFE6] text-[#8C4460]'}`}>
          {isCurrent ? 'Aktif Paket' : plan.planKey.toUpperCase()}
        </span>
        {isRecommended && <span className="rounded-md bg-[#e0617f] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-white">Önerilen</span>}
        {isCurrent && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
      </div>

      {/* ad + açıklama */}
      <div className="relative mt-3 flex items-center gap-1.5">
        <h3 className={`font-display text-2xl tracking-tight ${isCurrent ? 'text-white' : 'text-[#2A2027]'}`}>{plan.name}</h3>
        {isCurrent && <Gem className="h-4 w-4 text-[#f3a3bf]" />}
      </div>
      {plan.description && <p className={`relative mt-1 line-clamp-2 text-[11px] ${isCurrent ? 'text-white/70' : 'text-[#5A4B53]'}`}>{plan.description}</p>}

      {/* fiyat */}
      <div className="relative mt-4">
        {isCustom ? (
          <div className={`font-display text-3xl tracking-tight ${isCurrent ? 'text-white' : 'text-[#A5556E]'}`}>Özel Fiyat</div>
        ) : (
          <div className="flex items-end gap-1">
            <span className={`font-display text-4xl tabular-nums tracking-tight ${isCurrent ? 'text-white' : 'text-[#A5556E]'}`}>{formatTL(plan.monthlyPriceTRY)}</span>
            <span className={`mb-1 text-[12px] ${isCurrent ? 'text-white/60' : 'text-[#74616A]'}`}>/ay</span>
          </div>
        )}
      </div>

      {/* metrikler */}
      <div className="relative mt-4 space-y-1.5">
        {metrics.map(([Icon, label, value]) => (
          <div key={label} className={`flex items-center justify-between border-b pb-1.5 text-[12px] last:border-b-0 ${isCurrent ? 'border-white/10' : 'border-[#f1e5ea]'}`}>
            <span className={`flex items-center gap-1.5 ${isCurrent ? 'text-white/75' : 'text-[#5A4B53]'}`}><Icon className={`h-3.5 w-3.5 ${isCurrent ? 'text-[#f3a3bf]' : 'text-[#A5556E]/70'}`} strokeWidth={1.7} />{label}</span>
            <span className={`font-display tabular-nums ${isCurrent ? 'text-white' : 'text-[#2A2027]'}`}>{fmt(value)}</span>
          </div>
        ))}
      </div>

      {/* öne çıkan özellikler */}
      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {highlights.map((f) => (
          <span key={f} className={`rounded-md border px-2 py-0.5 text-[9px] ${isCurrent ? 'border-white/20 bg-white/10 text-white/85' : 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]'}`}>{f}</span>
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[11px] font-medium text-[#3E343A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]">
            <MailPlus className="h-4 w-4" /> İletişime geç
          </a>
        ) : (
          <button type="button" disabled={busy} onClick={onChoose}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-[12px] px-3 py-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              isRecommended ? 'bg-[#A5556E] text-white hover:opacity-90' : 'border border-[#BE7690]/75 bg-[#A5556E] text-white hover:bg-[#F6DFE6]'
            }`}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uygulanıyor…</> : <>Bu pakete geç</>}
          </button>
        )}
      </div>
    </motion.div>
  )
}
