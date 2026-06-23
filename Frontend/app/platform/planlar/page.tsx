'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import PlanFormDialog from '@/components/dashboard/PlanFormDialog'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import Sparkline from '@/components/dashboard/Sparkline'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { formatTL, normalizeFeatureCatalog, normalizeSubscriptionPlan } from '@/lib/apiMappers'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Calendar,
  CheckCircle2,
  Mail,
  MessageSquare,
  Package,
  PenLine,
  Plus,
  Trash2,
  Users,
  UsersRound,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ApiFeatureCatalog, ApiSubscriptionPlan, FeatureCatalogItem, SubscriptionPlan } from '@/lib/types'

const gridContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
}

const cardVariant: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
}

function limitDisplay(n: number): string {
  return n < 0 ? '∞' : n.toLocaleString('tr-TR')
}

export default function PlanlarPage() {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const { data, loading, error } = useApiQuery<ApiSubscriptionPlan[]>(
    () => platformApi.subscriptionPlans<ApiSubscriptionPlan>(),
    [refreshKey],
    { initialData: [] },
  )

  const { data: catalogData } = useApiQuery<ApiFeatureCatalog>(
    () => platformApi.featuresCatalog<ApiFeatureCatalog>(),
    [],
    { initialData: { items: [] } },
  )

  const featureCatalog: FeatureCatalogItem[] = useMemo(
    () => normalizeFeatureCatalog(catalogData),
    [catalogData],
  )

  const featureLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    featureCatalog.forEach((f) => map.set(f.key, f.name))
    return map
  }, [featureCatalog])

  const plans: SubscriptionPlan[] = useMemo(
    () => (data ?? []).map((p, i) => normalizeSubscriptionPlan(p, i)),
    [data],
  )

  // Aktif önce, sonra displayOrder/fiyat — pasifler sona.
  const sortedPlans = useMemo(
    () =>
      [...plans].sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          a.displayOrder - b.displayOrder ||
          (a.monthlyPriceTRY || Infinity) - (b.monthlyPriceTRY || Infinity),
      ),
    [plans],
  )

  const totalTenants = plans.reduce((s, p) => s + p.tenantCount, 0)
  const totalRevenue = plans
    .filter((p) => p.isActive)
    .reduce((s, p) => s + p.monthlyPriceTRY * p.tenantCount, 0)
  const activeCount = plans.filter((p) => p.isActive).length
  const topPlan = plans.slice().sort((a, b) => b.tenantCount - a.tenantCount)[0]
  const bestSellerId = topPlan && topPlan.tenantCount > 0 ? topPlan.id : null

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const handleDelete = useCallback(async (p: SubscriptionPlan) => {
    if (!confirm(`"${p.name}" paketini silmek istediğine emin misin?\n(Bu pakete bağlı kurum varsa silinmez.)`)) return
    setBusyId(p.id); setActionErr(null); setActionMsg(null)
    try {
      await platformApi.deleteSubscriptionPlan(p.id)
      setActionMsg('Paket silindi.')
      refresh()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Silme başarısız.')
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  const kpis: { label: string; value: ReactNode; delta?: string; icon: LucideIcon; spark?: number[] }[] = [
    { label: 'Aktif paket', value: <AnimatedNumber value={activeCount} />, delta: `${plans.length} toplam`, icon: Package, spark: [3, 4, 4, 5, 5, 5, 6, 5] },
    { label: 'Plana bağlı kurum', value: <AnimatedNumber value={totalTenants} />, delta: `${plans.length} pakette`, icon: Building2, spark: [6, 8, 7, 10, 12, 11, 14, 16] },
    { label: 'Hesaplanan MRR', value: <AnimatedNumber value={totalRevenue} format={(n) => formatTL(Math.round(n))} />, delta: 'aktif kurum × paket fiyatı', icon: Wallet, spark: [4, 6, 5, 8, 7, 10, 12, 15] },
    { label: 'En popüler', value: topPlan?.name || '—', delta: topPlan && topPlan.tenantCount > 0 ? `${topPlan.tenantCount} kurum` : 'henüz veri yok', icon: BadgeCheck },
  ]

  return (
    <>
      <Topbar
        title="Plan Kataloğu"
        subtitle="Abonelik paketleri ve limit kuralları — kurumların hangi limitlerle çalışacağını belirler"
        breadcrumbs={['Platform', 'Finans', 'Plan Kataloğu']}
        actions={
          <PlanFormDialog
            mode="create"
            onSuccess={(m) => { setActionMsg(m); refresh() }}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[12px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5"
              >
                <Plus className="h-4 w-4" strokeWidth={2.3} /> Paket ekle
              </button>
            }
          />
        }
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} />

        <AnimatePresence>
          {actionMsg && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12px] font-medium text-emerald-700">
              <CheckCircle2 className="mr-2 inline h-3.5 w-3.5" />{actionMsg}
            </motion.div>
          )}
          {actionErr && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12px] font-medium text-rose-700">
              <AlertCircle className="mr-2 inline h-3.5 w-3.5" />{actionErr}
            </motion.div>
          )}
        </AnimatePresence>

        {/* KPI'lar */}
        <motion.section variants={gridContainer} initial="hidden" animate="visible"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </motion.section>

        {/* Plan kartları */}
        <motion.section variants={gridContainer} initial="hidden" animate="visible"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedPlans.map((p) => (
            <PlanCard key={p.id}
              plan={p}
              busy={busyId === p.id}
              bestSeller={p.id === bestSellerId}
              featureLabelMap={featureLabelMap}
              onDelete={() => handleDelete(p)}
              onSuccess={(m) => { setActionMsg(m); refresh() }}
            />
          ))}
          {!plans.length && !loading && (
            <div className="sm:col-span-2 xl:col-span-3 rounded-[20px] border border-[#f0dde5] bg-white/60 p-12 text-center">
              <Package className="mx-auto h-10 w-10 text-[#d9a9bb]" strokeWidth={1.3} />
              <div className="mt-3 text-sm text-[#9d7386]">Henüz paket tanımlanmadı. Sağ üstten “Paket ekle” ile başla.</div>
            </div>
          )}
        </motion.section>
      </div>
    </>
  )
}

// ---------- KPI Card ----------

function KpiCard({ kpi }: { kpi: { label: string; value: ReactNode; delta?: string; icon: LucideIcon; spark?: number[] } }) {
  const Icon = kpi.icon
  return (
    <motion.div
      variants={cardVariant}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="armo-card armo-card-luxury armo-lift group p-5"
    >
      <div className="flex items-stretch justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#f3cdda] bg-[#fff1f6] text-[#c85776]">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <div className="mt-3 text-[12px] font-semibold text-[#6a4f5c]">{kpi.label}</div>
          <div className="mt-1 truncate font-display text-[26px] leading-none tabular-nums text-[#3b2330] lg:text-[30px]">{kpi.value}</div>
          {kpi.delta && (
            <div className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1 text-[11px] font-semibold text-[#a84f69]">
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
              {kpi.delta}
            </div>
          )}
        </div>
        {kpi.spark && (
          <div className="hidden flex-1 items-end justify-end sm:flex">
            <Sparkline points={kpi.spark} tone="rose" variant="line" width={150} height={80} className="h-[80px] w-full max-w-[170px] overflow-visible" />
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------- Plan Card ----------

function PlanCard({
  plan,
  busy,
  bestSeller,
  featureLabelMap,
  onDelete,
  onSuccess,
}: {
  plan: SubscriptionPlan
  busy: boolean
  bestSeller: boolean
  featureLabelMap: Map<string, string>
  onDelete: () => void
  onSuccess: (msg: string) => void
}) {
  const monthlyRevenue = plan.monthlyPriceTRY * plan.tenantCount
  const featureCount = plan.features.length
  const visibleFeatures = plan.features.slice(0, 6)
  const remainingFeatures = Math.max(0, featureCount - visibleFeatures.length)
  const isCustom = plan.monthlyPriceTRY === 0

  return (
    <motion.div
      variants={cardVariant}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`armo-card armo-card-luxury armo-lift group relative flex h-full flex-col overflow-hidden ${
        bestSeller ? 'ring-1 ring-[#ef9ab5]' : ''
      } ${plan.isActive ? '' : 'opacity-75'}`}
    >
      {/* EN ÇOK SATILAN şeridi */}
      {bestSeller && (
        <div className="relative z-10 flex items-center justify-between gap-2 bg-gradient-to-r from-[#f43f5e] via-[#ec4f7e] to-[#d65f83] px-4 py-2">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
            <img src="/best-seller-badge.png" alt="" className="-my-1 h-8 w-auto drop-shadow-[0_4px_8px_rgba(120,20,40,0.4)]" />
            En çok satılan
          </span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-semibold text-white">{plan.tenantCount} kurum</span>
        </div>
      )}

      <div className="relative z-10 flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#c85776]">
            <Package className="h-3.5 w-3.5" strokeWidth={1.7} /> {plan.planKey || '—'}
          </span>
          {plan.isActive ? (
            !bestSeller && (
              <span className="rounded-full border border-[#f0dde5] bg-[#fff7fa] px-2 py-0.5 text-[9px] font-mono text-[#9d7386]">{plan.tenantCount} kurum</span>
            )
          ) : (
            <span className="rounded-full border border-[#e7d6de] bg-[#f3eef1] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-[#705a66]">Pasif</span>
          )}
        </div>

        <h3 className="mt-3 font-display text-2xl tracking-tight text-[#3b2330]">{plan.name}</h3>
        {plan.description && (
          <p className="mt-1 line-clamp-2 text-[11px] text-[#7c6170]">{plan.description}</p>
        )}

        {/* Fiyat */}
        <div className="mt-4">
          {isCustom ? (
            <span className="font-display text-2xl armonessa-text-gradient">Özel fiyatlandırma</span>
          ) : (
            <span className="font-display text-[34px] tabular-nums armonessa-text-gradient">
              {formatTL(plan.monthlyPriceTRY)}
              <span className="ml-1 text-[11px] font-mono uppercase tracking-widest text-[#9d7386]">/ay</span>
            </span>
          )}
        </div>

        {/* Limitler */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <LimitTile icon={Building2} label="Şube" value={limitDisplay(plan.maxBranches)} />
          <LimitTile icon={UsersRound} label="Personel" value={limitDisplay(plan.maxStaff)} />
          <LimitTile icon={Users} label="Müşteri" value={limitDisplay(plan.maxCustomers)} />
          <LimitTile icon={Calendar} label="Aylık randevu" value={limitDisplay(plan.maxMonthlyAppointments)} />
          <LimitTile icon={MessageSquare} label="Aylık SMS" value={limitDisplay(plan.maxMonthlySmsCount)} />
          <LimitTile icon={MessageSquare} label="Aylık WhatsApp" value={limitDisplay(plan.maxMonthlyWhatsAppCount)} />
          <LimitTile icon={Mail} label="Aylık E-posta" value={limitDisplay(plan.maxMonthlyEmailCount)} fullWidth />
        </div>

        {/* Özellikler */}
        {featureCount > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#9d7386]">
              <span>Dahil özellikler</span>
              <span className="font-semibold text-[#c85776]">{featureCount}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {visibleFeatures.map((f) => (
                <span key={f}
                  className="inline-flex items-center gap-1 rounded-full border border-[#f3cdda] bg-[#fff1f6] px-2 py-0.5 text-[9px] font-medium text-[#a84f69]">
                  <Zap className="h-2.5 w-2.5" /> {featureLabelMap.get(f) || f}
                </span>
              ))}
              {remainingFeatures > 0 && (
                <span className="inline-flex items-center rounded-full border border-[#efbfd0] bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-[#c85776]">
                  +{remainingFeatures}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between border-t border-[#f3e1e9] pt-3 text-[10px] font-mono uppercase tracking-widest text-[#9d7386]">
          <span>{plan.tenantCount} kurum</span>
          <span className="text-[#7c6170]">{formatTL(Math.round(monthlyRevenue))} /ay</span>
        </div>

        <div className="mt-3 flex gap-2">
          <PlanFormDialog
            mode="edit"
            plan={plan}
            onSuccess={onSuccess}
            trigger={
              <button type="button"
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white/70 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#7c6170] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                <PenLine className="h-3 w-3" /> Düzenle
              </button>
            }
          />
          <button type="button" disabled={busy} onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#f3c9d4] bg-[#fff1f4] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#cf4d68] transition-colors hover:bg-[#ffe4ea] disabled:opacity-50">
            <Trash2 className="h-3 w-3" /> Sil
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function LimitTile({
  icon: Icon, label, value, fullWidth,
}: { icon: LucideIcon; label: string; value: string; fullWidth?: boolean }) {
  return (
    <div className={`rounded-[10px] border border-[#f0dde5] bg-[#fff7fa]/70 px-2.5 py-2 ${fullWidth ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#9d7386]">
        <Icon className="h-3 w-3 text-[#c85776]" /> {label}
      </div>
      <div className="mt-0.5 font-display text-base tabular-nums text-[#3b2330]">{value}</div>
    </div>
  )
}
