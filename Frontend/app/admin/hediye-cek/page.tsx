'use client'

import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { formatTL, guidOrUndefined, normalizeGiftCard } from '@/lib/apiMappers'
import type { ApiGiftCard, GiftCard, GiftCardKind } from '@/lib/types'
import { CheckCircle2, Gift, Lock, Percent, Plus, Power, Sparkles, Ticket, Trash2, Wallet, XCircle } from 'lucide-react'

type ScopeKey = 'all' | 'active' | 'stored' | 'coupon'

const kindMeta: Record<GiftCardKind, { label: string; icon: typeof Gift }> = {
  Percentage: { label: 'Yüzde İndirim', icon: Percent },
  FixedAmount: { label: 'Sabit İndirim', icon: Ticket },
  StoredValue: { label: 'Hediye Çeki', icon: Wallet },
}

function statusBadge(g: GiftCard): { label: string; cls: string; Icon: typeof CheckCircle2 } {
  if (g.isValid) return { label: 'Geçerli', cls: 'text-[#2f9e72] bg-[#2f9e72]/12 border-[#2f9e72]/30', Icon: CheckCircle2 }
  if (g.isActive) return { label: 'Süresi/hakkı doldu', cls: 'text-[#d1556f] bg-[#d1556f]/10 border-[#d1556f]/25', Icon: XCircle }
  return { label: 'Pasif', cls: 'text-[#705a66] bg-[#705a66]/10 border-[#705a66]/20', Icon: XCircle }
}

/* ----- İmza bileşen: gerçek hediye-kartı / bilet görünümlü kart ----- */
function GiftCardTile({
  card,
  index,
  busy,
  onToggleActive,
  onDelete,
}: {
  card: GiftCard
  index: number
  busy: boolean
  onToggleActive: () => void
  onDelete: () => void
}) {
  const meta = kindMeta[card.kind]
  const Icon = meta.icon
  const status = statusBadge(card)

  // Üst görsel — türüne göre farklı bilet/kart estetiği
  let visual: ReactNode
  if (card.kind === 'StoredValue') {
    // Metalik gül-altın hediye çeki
    visual = (
      <div className="gc-metallic relative flex min-h-[212px] flex-col overflow-hidden rounded-t-[22px] p-5">
        {/* parlak köşe vurgusu */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_85%_-15%,rgba(255,255,255,0.6),transparent_55%)]" />
        {/* marka monogramı */}
        <div className="pointer-events-none absolute right-4 top-2 select-none font-display text-[42px] font-bold leading-none text-[#7a3450]/20">A</div>
        <div className="relative flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5e2740] backdrop-blur">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border bg-white/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="relative mt-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a3450]/75">Bakiye</p>
          <p className="mt-1 font-display text-[34px] font-bold leading-none text-[#4a1f33]">
            {formatTL(card.balance)}
            <span className="ml-1.5 align-baseline text-base font-semibold text-[#7a3450]/55">/ {formatTL(card.value)}</span>
          </p>
        </div>
        <div className="relative mt-auto flex items-end justify-between gap-2 border-t border-[#7a3450]/15 pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a3450]/65">Kod</p>
            <p className="gc-code mt-0.5 text-[15px] font-bold text-[#4a1f33]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#7a3450]/75">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  } else if (card.kind === 'Percentage') {
    // Yüzde indirim kuponu — sol perforasyonlu beyaz bilet
    visual = (
      <div className="gc-perf-left relative flex min-h-[212px] flex-col rounded-t-[22px] border border-[#efe1e7] bg-white p-5 pl-8">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#c85776]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#c85776]">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="my-auto py-3 text-center">
          <p className="font-display text-[52px] font-bold leading-none text-[#c85776]">%{card.value}</p>
          {card.note && <p className="mt-2 text-[12px] font-medium text-[#705a66]">{card.note}</p>}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#efe1e7] pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#705a66]">Kod</p>
            <p className="gc-code mt-0.5 text-[15px] font-bold text-[#241923]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#705a66]">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  } else {
    // Sabit tutar kuponu — krem/altın kesik kenarlı bilet
    visual = (
      <div className="gc-perf-edges relative flex min-h-[212px] flex-col rounded-t-[22px] border border-[#e7cfa6]/60 bg-[#fbf3e6] p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#b88938]/25 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9a6f22]">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="my-auto py-3 text-center">
          <p className="font-display text-[46px] font-bold leading-none text-[#9a6f22]">{formatTL(card.value)}</p>
          {card.note && <p className="mt-2 text-[12px] font-medium text-[#705a66]">{card.note}</p>}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#b88938]/25 pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#705a66]">Kod</p>
            <p className="gc-code mt-0.5 rounded-md bg-white px-2 py-0.5 text-[15px] font-bold text-[#241923]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#705a66]">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -5 }}
      className={`flex h-full flex-col rounded-[24px] shadow-[0_20px_44px_-28px_rgba(200,87,118,0.55)] ${
        card.isValid ? '' : 'opacity-70 grayscale transition-all duration-500 hover:opacity-100 hover:grayscale-0'
      }`}
    >
      {visual}
      {/* Aksiyon barı */}
      <div className="flex gap-2 rounded-b-[22px] border border-t-0 border-[#efe1e7] bg-white/96 p-3">
        <button
          type="button"
          disabled={busy}
          onClick={onToggleActive}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#f7ecf1] px-2.5 py-2 text-[11px] font-semibold text-[#5d4a56] transition-colors hover:bg-[#efdfe7] hover:text-[#c85776] disabled:opacity-50"
        >
          <Power className="h-3.5 w-3.5" /> {card.isActive ? 'Pasifleştir' : 'Aktifleştir'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#d1556f]/10 px-2.5 py-2 text-[11px] font-semibold text-[#cf4d68] transition-colors hover:bg-[#d1556f]/18 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Sil
        </button>
      </div>
    </motion.div>
  )
}

function HediyeCekPageInner() {
  const search = useSearchParams()
  const scopeParam = (search?.get('scope') as ScopeKey | null) ?? 'all'
  const scope: ScopeKey = ['all', 'active', 'stored', 'coupon'].includes(scopeParam) ? scopeParam : 'all'

  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)

  const { data, loading, error, reload } = useApiQuery<ApiGiftCard[]>(
    async () => (tenantId ? adminApi.giftCards<ApiGiftCard>(tenantId).catch(() => []) : []),
    [tenantId],
    { initialData: [] },
  )
  const cards = useMemo(() => (data || []).map((g, i) => normalizeGiftCard(g, i)), [data])

  const filtered = useMemo(() => {
    switch (scope) {
      case 'active':
        return cards.filter((c) => c.isValid)
      case 'stored':
        return cards.filter((c) => c.kind === 'StoredValue')
      case 'coupon':
        return cards.filter((c) => c.kind !== 'StoredValue')
      default:
        return cards
    }
  }, [cards, scope])

  // ----- Oluşturma formu -----
  const [kind, setKind] = useState<GiftCardKind>('StoredValue')
  const [value, setValue] = useState('')
  const [code, setCode] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const resetForm = (): void => {
    setValue('')
    setCode('')
    setValidUntil('')
    setMaxUses('')
    setNote('')
  }

  const handleCreate = async (): Promise<void> => {
    const numericValue = Number(value)
    if (!numericValue || numericValue <= 0) {
      setActionError('Geçerli bir değer girin.')
      return
    }
    if (kind === 'Percentage' && numericValue > 100) {
      setActionError('Yüzde indirim 100’ü aşamaz.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await adminApi.createGiftCard(
        {
          code: code.trim() || null,
          kind,
          value: numericValue,
          validUntilUtc: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
          maxUses: maxUses ? Number(maxUses) : 0,
          note: note.trim() || null,
          customerId: null,
          branchId: branchId ?? null,
        },
        tenantId,
      )
      resetForm()
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setActionError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => {
    const active = cards.filter((c) => c.isValid).length
    const storedBalance = cards.filter((c) => c.kind === 'StoredValue').reduce((s, c) => s + c.balance, 0)
    return { total: cards.length, active, storedBalance }
  }, [cards])

  const valueLabel = kind === 'Percentage' ? 'Yüzde (%)' : kind === 'StoredValue' ? 'Yüklenecek bakiye' : 'İndirim tutarı'
  const valueAdorn = kind === 'Percentage' ? '%' : '₺'

  const featureAllowed = useFeature('marketing.giftcards')
  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Hediye Çeki & Kupon" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl text-[#241923]">Hediye Çeki & Kupon</div>
          <p className="mt-2 text-[13px] text-[#705a66]">Bu özellik paketinizde yok. Üst pakete geçerek hediye çeki ve kupon tanımlayabilirsiniz.</p>
        </div>
      </>
    )
  }

  const statCards = [
    { label: 'Toplam kod', value: String(stats.total), icon: Gift, chip: 'bg-[#fbeaf1] text-[#c85776]' },
    { label: 'Geçerli (aktif)', value: String(stats.active), icon: CheckCircle2, chip: 'bg-[#e6f5ee] text-[#2f9e72]' },
    { label: 'Hediye çeki bakiyesi', value: formatTL(Math.round(stats.storedBalance)), icon: Wallet, chip: 'bg-[#f7eed9] text-[#b88938]' },
  ]

  const tabs: [ScopeKey, string][] = [
    ['all', 'Tümü'],
    ['active', 'Aktif'],
    ['stored', 'Hediye çeki'],
    ['coupon', 'Kupon'],
  ]

  return (
    <>
      <Topbar
        title="Hediye Çeki & Kupon"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']}
      />

      <div className="relative space-y-7 p-4 sm:p-6 lg:p-8">
        {/* Özet */}
        <div className="grid gap-4 sm:grid-cols-3">
          {statCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="flex items-start gap-4 rounded-[20px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_12px_30px_-20px_rgba(200,87,118,0.5)]"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${s.chip}`}>
                <s.icon className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#705a66]">{s.label}</p>
                <p className="mt-1 truncate font-display text-[28px] font-bold leading-tight text-[#241923]">{s.value}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Oluşturma formu */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)] sm:p-6"
        >
          <div className="flex items-center gap-3 border-b border-[#f2e6eb] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f47699] to-[#ef6088] text-white shadow-[0_8px_16px_-8px_rgba(214,95,131,0.9)]">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <h2 className="font-display text-lg font-bold text-[#241923]">Yeni hediye çeki / kupon oluştur</h2>
            <Sparkles className="ml-auto h-4 w-4 text-[#e9a6bf]" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Tür</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as GiftCardKind)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              >
                <option value="StoredValue">Hediye Çeki (yüklü bakiye)</option>
                <option value="Percentage">Yüzde İndirim Kuponu</option>
                <option value="FixedAmount">Sabit Tutar İndirim Kuponu</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">{valueLabel}</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#a98a98]">{valueAdorn}</span>
                <input
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kind === 'Percentage' ? 'örn. 15' : 'örn. 500'}
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white py-2.5 pl-8 pr-3 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Kod (boş = otomatik)</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="örn. YILBASI25"
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.12em' }}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] uppercase text-[#352432] outline-none transition placeholder:tracking-normal placeholder:text-[#c9b3bd] focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Son geçerlilik (ops.)</span>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Maks. kullanım (0 = sınırsız)</span>
              <input
                type="number"
                min={0}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="0"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Açıklama (ops.)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="örn. Yılbaşı kampanyası"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
          </div>
          {actionError && <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{actionError}</div>}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Oluştur
            </button>
          </div>
        </motion.div>

        {/* Filtre sekmeleri */}
        <div className="flex flex-wrap items-center gap-1 border-b border-[#ead8df]/70">
          {tabs.map(([key, label]) => (
            <a
              key={key}
              href={`/admin/hediye-cek?scope=${key}`}
              className={`relative px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                scope === key ? 'text-[#c85776]' : 'text-[#705a66] hover:text-[#241923]'
              }`}
            >
              {label}
              {scope === key && (
                <motion.span layoutId="gc-tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#c85776]" />
              )}
            </a>
          ))}
        </div>

        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && filtered.length === 0}
          emptyMessage="Bu filtrede kayıt yok. Yukarıdan yeni bir hediye çeki/kupon oluşturabilirsin."
        />

        {/* Kart ızgarası */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g, i) => (
            <GiftCardTile
              key={g.id}
              card={g}
              index={i}
              busy={busy}
              onToggleActive={() => runAction(() => adminApi.setGiftCardActive(g.id, !g.isActive, tenantId))}
              onDelete={() => runAction(() => adminApi.deleteGiftCard(g.id, tenantId))}
            />
          ))}
        </div>
      </div>
    </>
  )
}

export default function HediyeCekPage() {
  return (
    <Suspense fallback={null}>
      <HediyeCekPageInner />
    </Suspense>
  )
}
