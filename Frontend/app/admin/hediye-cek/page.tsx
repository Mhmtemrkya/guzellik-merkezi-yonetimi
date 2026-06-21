'use client'

import { Suspense, useMemo, useState } from 'react'
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
import { CheckCircle2, Gift, Lock, Percent, Plus, Power, Ticket, Trash2, Wallet, XCircle } from 'lucide-react'

type ScopeKey = 'all' | 'active' | 'stored' | 'coupon'

const kindMeta: Record<GiftCardKind, { label: string; icon: typeof Gift; tone: string }> = {
  Percentage: { label: 'Yüzde İndirim', icon: Percent, tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  FixedAmount: { label: 'Tutar İndirim', icon: Ticket, tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  StoredValue: { label: 'Hediye Çeki', icon: Wallet, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
}

function valueLabel(g: GiftCard): string {
  if (g.kind === 'Percentage') return `%${g.value}`
  if (g.kind === 'StoredValue') return `${formatTL(g.balance)} / ${formatTL(g.value)}`
  return formatTL(g.value)
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

  const featureAllowed = useFeature('marketing.giftcards')
  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Hediye Çeki & Kupon" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl">Hediye Çeki & Kupon</div>
          <p className="mt-2 text-[13px] text-[#352432]/55">Bu özellik paketinizde yok. Üst pakete geçerek hediye çeki ve kupon tanımlayabilirsiniz.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar
        title="Hediye Çeki & Kupon"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']}
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        {/* Özet */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Toplam kod', value: String(stats.total), icon: Gift, tone: 'text-[#c85776]' },
            { label: 'Geçerli (aktif)', value: String(stats.active), icon: CheckCircle2, tone: 'text-emerald-600' },
            { label: 'Hediye çeki bakiyesi', value: formatTL(Math.round(stats.storedBalance)), icon: Wallet, tone: 'text-[#b88938]' },
          ].map((s) => (
            <div key={s.label} className="rounded-[18px] border border-[#efe1e7] bg-white/94 p-4">
              <div className="flex items-center gap-2 text-[12px] text-[#8a7480]">
                <s.icon className={`h-4 w-4 ${s.tone}`} strokeWidth={1.7} /> {s.label}
              </div>
              <div className="mt-2 text-[26px] font-semibold tabular-nums text-[#241923]">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Oluşturma formu */}
        <div className="rounded-[20px] border border-[#efe1e7] bg-white/94 p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#241923]">
            <Plus className="h-4 w-4 text-[#c85776]" /> Yeni hediye çeki / kupon oluştur
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Tür</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as GiftCardKind)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]"
              >
                <option value="StoredValue">Hediye Çeki (yüklü bakiye)</option>
                <option value="Percentage">Yüzde İndirim Kuponu</option>
                <option value="FixedAmount">Sabit Tutar İndirim Kuponu</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">
                {kind === 'Percentage' ? 'Yüzde (%)' : kind === 'StoredValue' ? 'Yüklenecek bakiye (₺)' : 'İndirim tutarı (₺)'}
              </span>
              <input
                type="number"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === 'Percentage' ? 'örn. 15' : 'örn. 500'}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Kod (boş = otomatik)</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="örn. YILBASI25"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 font-mono text-[13px] uppercase text-[#352432] outline-none focus:border-[#ef9ab5]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Son geçerlilik (ops.)</span>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Maks. kullanım (0 = sınırsız)</span>
              <input
                type="number"
                min={0}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="0"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Açıklama (ops.)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="örn. Yılbaşı kampanyası"
                className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]"
              />
            </label>
          </div>
          {actionError && <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</div>}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Oluştur
            </button>
          </div>
        </div>

        {/* Filtre sekmeleri */}
        <div className="flex flex-wrap gap-1 border-b border-[#ead8df]/70">
          {([
            ['all', 'Tümü'],
            ['active', 'Aktif'],
            ['stored', 'Hediye çeki'],
            ['coupon', 'Kupon'],
          ] as [ScopeKey, string][]).map(([key, label]) => (
            <a
              key={key}
              href={`/admin/hediye-cek?scope=${key}`}
              className={`px-4 py-2.5 text-[12px] font-medium transition-colors ${
                scope === key ? 'border-b-2 border-[#c85776] text-[#c85776]' : 'text-[#352432]/55 hover:text-[#352432]'
              }`}
            >
              {label}
            </a>
          ))}
        </div>

        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && filtered.length === 0} emptyMessage="Bu filtrede kayıt yok. Yukarıdan yeni bir hediye çeki/kupon oluşturabilirsin." />

        {/* Liste */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g, i) => {
            const meta = kindMeta[g.kind]
            const Icon = meta.icon
            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                className={`relative overflow-hidden rounded-[18px] border bg-white/94 p-4 ${g.isValid ? 'border-[#efe1e7]' : 'border-[#ead8df] opacity-75'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
                    <Icon className="h-3 w-3" /> {meta.label}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${g.isValid ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {g.isValid ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {g.isValid ? 'Geçerli' : g.isActive ? 'Süresi/hakkı doldu' : 'Pasif'}
                  </span>
                </div>
                <div className="mt-3 font-mono text-[18px] font-bold tracking-wider text-[#241923]">{g.code}</div>
                <div className="mt-1 text-[20px] font-semibold tabular-nums text-[#c85776]">{valueLabel(g)}</div>
                <div className="mt-2 space-y-0.5 text-[11px] text-[#8a7480]">
                  <div>Kullanım: {g.usedCount}{g.maxUses > 0 ? ` / ${g.maxUses}` : ' (sınırsız)'}</div>
                  {g.validUntil && <div>Son geçerlilik: {new Date(g.validUntil).toLocaleDateString('tr-TR')}</div>}
                  {g.note && <div className="truncate">{g.note}</div>}
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-[#f2e6eb] pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => adminApi.setGiftCardActive(g.id, !g.isActive, tenantId))}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#5d4a56] transition-colors hover:border-[#efbfd0] hover:text-[#c85776] disabled:opacity-50"
                  >
                    <Power className="h-3.5 w-3.5" /> {g.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => adminApi.deleteGiftCard(g.id, tenantId))}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Sil
                  </button>
                </div>
              </motion.div>
            )
          })}
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
