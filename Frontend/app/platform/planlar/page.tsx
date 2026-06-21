'use client'

import { useCallback, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import PlanFormDialog from '@/components/dashboard/PlanFormDialog'
import StatCard, { statGridContainer } from '@/components/dashboard/StatCard'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { formatTL, normalizeFeatureCatalog, normalizeSubscriptionPlan } from '@/lib/apiMappers'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  Calendar,
  CheckCircle2,
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

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
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

  const totalTenants = plans.reduce((s, p) => s + p.tenantCount, 0)
  const totalRevenue = plans
    .filter((p) => p.isActive)
    .reduce((s, p) => s + p.monthlyPriceTRY * p.tenantCount, 0)
  const activeCount = plans.filter((p) => p.isActive).length

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
              <button type="button"
                className="inline-flex items-center gap-1.5 border border-[#f0aac2]/40 bg-gradient-to-r from-[#f0aac2] to-[#ffd3df] px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-[#1d0d17] transition-opacity hover:opacity-90">
                <Plus className="h-3.5 w-3.5" /> Paket ekle
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
              className="border border-emerald-300/30 bg-emerald-400/10 px-4 py-2.5 text-[12px] text-emerald-100">
              <CheckCircle2 className="mr-2 inline h-3.5 w-3.5" />{actionMsg}
            </motion.div>
          )}
          {actionErr && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-rose-300/30 bg-rose-400/10 px-4 py-2.5 text-[12px] text-rose-100">
              <AlertCircle className="mr-2 inline h-3.5 w-3.5" />{actionErr}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.section variants={statGridContainer} initial="hidden" animate="visible"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard index={0} label="Aktif paket"
            value={<AnimatedNumber value={activeCount} />} delta={`${plans.length} toplam`} icon={Package} accent="gold" />
          <StatCard index={1} label="Plana bağlı kurum"
            value={<AnimatedNumber value={totalTenants} />} icon={Building2} accent="rose" />
          <StatCard index={2} label="Hesaplanan MRR"
            value={<AnimatedNumber value={totalRevenue} format={(n) => formatTL(Math.round(n))} />}
            delta="aktif kurumlar × paket fiyatı" icon={Wallet} accent="copper" />
          <StatCard index={3} label="En popüler"
            value={<span className="font-display text-[26px]">{plans.slice().sort((a, b) => b.tenantCount - a.tenantCount)[0]?.name || '—'}</span>}
            icon={BadgeCheck} accent="gold" />
        </motion.section>

        <motion.section variants={listContainer} initial="hidden" animate="visible"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <PlanCard key={p.id}
              plan={p}
              busy={busyId === p.id}
              featureLabelMap={featureLabelMap}
              onDelete={() => handleDelete(p)}
              onSuccess={(m) => { setActionMsg(m); refresh() }}
            />
          ))}
          {!plans.length && !loading && (
            <div className="sm:col-span-2 xl:col-span-3 border border-[#fff4f8]/12 bg-[#2f1724]/80 p-12 text-center">
              <Package className="mx-auto h-10 w-10 text-[#f0aac2]/45" strokeWidth={1.3} />
              <div className="mt-3 text-sm text-[#fff4f8]/65">Henüz paket tanımlanmadı. Sağ üstten "Paket ekle" ile başla.</div>
            </div>
          )}
        </motion.section>
      </div>
    </>
  )
}

// ---------- Plan Card ----------

function PlanCard({
  plan,
  busy,
  featureLabelMap,
  onDelete,
  onSuccess,
}: {
  plan: SubscriptionPlan
  busy: boolean
  featureLabelMap: Map<string, string>
  onDelete: () => void
  onSuccess: (msg: string) => void
}) {
  const monthlyRevenue = plan.monthlyPriceTRY * plan.tenantCount
  const tone = plan.isActive
    ? 'border-[#f0aac2]/30 bg-gradient-to-br from-[#2f1724] to-[#1d0d17]'
    : 'border-[#fff4f8]/10 bg-[#2f1724]/60 opacity-75'

  const featureCount = plan.features.length
  const visibleFeatures = plan.features.slice(0, 6)
  const remainingFeatures = Math.max(0, featureCount - visibleFeatures.length)

  return (
    <motion.div variants={cardVariant} whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`relative overflow-hidden border ${tone} p-5 backdrop-blur-md`}>
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#f0aac2]/14 blur-3xl" />

      <div className="relative flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#ffd3df]/70">
            <Package className="h-3.5 w-3.5" /> {plan.planKey}
          </div>
          <h3 className="mt-1 font-display text-2xl tracking-tight">{plan.name}</h3>
          {plan.description && (
            <p className="mt-1 line-clamp-2 text-[11px] text-[#fff4f8]/55">{plan.description}</p>
          )}
        </div>
        {!plan.isActive && (
          <span className="inline-flex border border-[#fff4f8]/20 bg-[#fff4f8]/8 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-[#fff4f8]/65">
            Pasif
          </span>
        )}
      </div>

      {/* Fiyat */}
      <div className="relative mt-5">
        <div className="font-display text-4xl tabular-nums armonessa-text-gradient">
          {plan.monthlyPriceTRY === 0 ? 'Özel' : formatTL(plan.monthlyPriceTRY)}
        </div>
        <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">aylık</div>
      </div>

      {/* Limitler */}
      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <LimitTile icon={Building2} label="Şube" value={limitDisplay(plan.maxBranches)} />
        <LimitTile icon={UsersRound} label="Personel" value={limitDisplay(plan.maxStaff)} />
        <LimitTile icon={Users} label="Müşteri" value={limitDisplay(plan.maxCustomers)} />
        <LimitTile icon={Calendar} label="Aylık randevu" value={limitDisplay(plan.maxMonthlyAppointments)} />
        <LimitTile icon={MessageSquare} label="Aylık SMS" value={limitDisplay(plan.maxMonthlySmsCount)} />
        <LimitTile icon={MessageSquare} label="Aylık WhatsApp" value={limitDisplay(plan.maxMonthlyWhatsAppCount)} />
        <LimitTile icon={MessageSquare} label="Aylık E-posta" value={limitDisplay(plan.maxMonthlyEmailCount)} fullWidth />
      </div>

      {/* Features */}
      {featureCount > 0 && (
        <div className="relative mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">
            <span>Dahil özellikler</span>
            <span className="text-[#f0aac2]">{featureCount}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleFeatures.map((f) => (
              <span key={f}
                className="inline-flex items-center gap-1 border border-[#fff4f8]/12 bg-[#fff4f8]/[0.04] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-[#ffd3df]/75">
                <Zap className="h-2.5 w-2.5" /> {featureLabelMap.get(f) || f}
              </span>
            ))}
            {remainingFeatures > 0 && (
              <span className="inline-flex items-center border border-[#f0aac2]/25 bg-[#f0aac2]/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-[#ffd3df]">
                +{remainingFeatures}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="relative mt-5 flex items-center justify-between border-t border-[#fff4f8]/8 pt-3 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">
        <span>{plan.tenantCount} kurum</span>
        <span>{formatTL(Math.round(monthlyRevenue))} /ay</span>
      </div>

      <div className="relative mt-3 flex gap-2">
        <PlanFormDialog
          mode="edit"
          plan={plan}
          onSuccess={onSuccess}
          trigger={
            <button type="button"
              className="inline-flex items-center gap-1 border border-[#fff4f8]/15 bg-[#fff4f8]/[0.03] px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#fff4f8]/85 transition-colors hover:bg-[#fff4f8]/[0.08]">
              <PenLine className="h-3 w-3" /> Düzenle
            </button>
          }
        />
        <button type="button" disabled={busy} onClick={onDelete}
          className="inline-flex items-center gap-1 border border-rose-300/30 bg-rose-400/10 px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-widest text-rose-200 transition-colors hover:bg-rose-400/20 disabled:opacity-50">
          <Trash2 className="h-3 w-3" /> Sil
        </button>
      </div>
    </motion.div>
  )
}

function LimitTile({
  icon: Icon, label, value, fullWidth,
}: { icon: LucideIcon; label: string; value: string; fullWidth?: boolean }) {
  return (
    <div className={`border border-[#fff4f8]/8 bg-[#fff4f8]/[0.025] px-2.5 py-2 ${fullWidth ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#fff4f8]/45">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 font-display text-base tabular-nums">{value}</div>
    </div>
  )
}

