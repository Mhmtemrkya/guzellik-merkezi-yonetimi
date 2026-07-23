'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { cashFlowMethodLabel, formatTL, guidOrUndefined, normalizeCashClosing, normalizeCashFlowEntry } from '@/lib/apiMappers'
import type { ApiCashClosing, ApiCashClosingPreview, ApiCashFlowEntry, CashFlowMethodKey } from '@/lib/types'
import { ArrowDownRight, ArrowUpRight, Award, Banknote, Calculator, CalendarCheck, CheckCircle2, CreditCard, HelpCircle, Landmark, Lock, Receipt, TrendingDown, TrendingUp, Trash2, Wallet, type LucideIcon } from 'lucide-react'

// Kasa kapanışı yöntem kırılımı — günün tahsilatları nakit/kart/EFT-havale/çek olarak
// ayrı gösterilir. Yalnızca NAKİT fiziki sayıma ve sistem nakdine girer.
const METHOD_CARDS: { key: CashFlowMethodKey; label: string; icon: LucideIcon; ring: string; chip: string; text: string }[] = [
  { key: 'cash', label: 'Nakit', icon: Banknote, ring: 'border-emerald-200', chip: 'bg-emerald-50/60', text: 'text-emerald-700' },
  { key: 'card', label: 'Kart', icon: CreditCard, ring: 'border-sky-200', chip: 'bg-sky-50/60', text: 'text-sky-700' },
  { key: 'transfer', label: 'EFT / Havale', icon: Landmark, ring: 'border-violet-200', chip: 'bg-violet-50/60', text: 'text-violet-700' },
  { key: 'check', label: 'Çek', icon: Receipt, ring: 'border-amber-200', chip: 'bg-amber-50/60', text: 'text-amber-700' },
]

function todayLocalIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayRangeIso(dateStr: string): { fromUtc: string; toUtc: string } {
  const start = new Date(`${dateStr}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { fromUtc: start.toISOString(), toUtc: end.toISOString() }
}

export default function KasaKapanisPage() {
  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)
  const featureAllowed = useFeature('finance.cashclosing')

  const [businessDate, setBusinessDate] = useState(todayLocalIso())
  const [openingBalance, setOpeningBalance] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const { fromUtc, toUtc } = useMemo(() => dayRangeIso(businessDate), [businessDate])

  const { data: previewData, reload: reloadPreview } = useApiQuery<ApiCashClosingPreview | null>(
    async () => {
      if (!tenantId) return null
      return adminApi.cashClosingPreview<ApiCashClosingPreview>({ businessDate, fromUtc, toUtc }, tenantId).catch(() => null)
    },
    [tenantId, businessDate, fromUtc, toUtc],
    { initialData: null },
  )

  const { data: listData, loading, error, reload: reloadList } = useApiQuery<ApiCashClosing[]>(
    async () => (tenantId ? adminApi.cashClosings<ApiCashClosing>(tenantId).catch(() => []) : []),
    [tenantId],
    { initialData: [] },
  )
  const closings = useMemo(() => (listData || []).map((c, i) => normalizeCashClosing(c, i)), [listData])

  // Drill-down: seçili günün kasa hareketleri (yalnızca NAKİT olanlar sistem nakdini oluşturur).
  const { data: flowData } = useApiQuery<ApiCashFlowEntry[]>(
    async () => (tenantId ? adminApi.cashFlow<ApiCashFlowEntry>({ tenantId, fromUtc, toUtc }).catch(() => []) : []),
    [tenantId, fromUtc, toUtc],
    { initialData: [] },
  )
  const normEntries = useMemo(() => (flowData || []).map((e, i) => normalizeCashFlowEntry(e, i)), [flowData])
  const cashEntries = useMemo(() => normEntries.filter((e) => e.method === 'cash'), [normEntries])

  // Ödeme yöntemi kırılımı — günün tüm tahsilat/giderleri yönteme göre gruplanır.
  const methodBreakdown = useMemo(() => {
    const acc: Record<string, { income: number; expense: number; count: number }> = {}
    for (const e of normEntries) {
      const key = e.method || 'unknown'
      const b = acc[key] || { income: 0, expense: 0, count: 0 }
      if (e.type === 'income') b.income += e.amount
      else b.expense += e.amount
      b.count += 1
      acc[key] = b
    }
    return acc
  }, [normEntries])
  const totalMethodIncome = useMemo(
    () => Object.values(methodBreakdown).reduce((s, b) => s + b.income, 0),
    [methodBreakdown],
  )

  // Canlı hesap — kullanıcı açılış/sayım girdikçe güncellenir.
  const cashIncome = Number(previewData?.cashIncome ?? 0)
  const cashExpense = Number(previewData?.cashExpense ?? 0)
  const suggestedOpening = Number(previewData?.suggestedOpening ?? 0)
  const alreadyClosed = Boolean(previewData?.alreadyClosed)
  const opening = openingBalance !== '' ? Number(openingBalance) : suggestedOpening
  const systemCash = opening + cashIncome - cashExpense
  const counted = countedCash !== '' ? Number(countedCash) : 0
  const difference = counted - systemCash

  const handleSave = async (): Promise<void> => {
    if (countedCash === '') { setActionError('Sayılan nakdi girin.'); return }
    setBusy(true)
    setActionError('')
    try {
      await adminApi.createCashClosing(
        { businessDate, fromUtc, toUtc, openingBalance: opening, countedCash: counted, note: note.trim() || null, branchId: branchId ?? null },
        tenantId,
      )
      setCountedCash(''); setNote(''); setOpeningBalance('')
      await Promise.all([reloadList(), reloadPreview()])
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await adminApi.deleteCashClosing(id, tenantId)
      await Promise.all([reloadList(), reloadPreview()])
    } finally {
      setBusy(false)
    }
  }

  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Gün Sonu Kasa Kapanışı" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'Finans', 'Kasa Kapanışı']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl text-[#241923]">Gün Sonu Kasa Kapanışı</div>
          <p className="mt-2 text-[13px] text-[#705a66]">Bu özellik paketinizde yok. Üst pakete geçerek Z raporu / kasa kapanışını kullanabilirsiniz.</p>
        </div>
      </>
    )
  }

  // Fark sonucu (banner)
  const verdict = difference === 0
    ? { label: 'Kasa tuttu', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 }
    : difference > 0
      ? { label: 'Kasa fazlası', cls: 'border-amber-200 bg-amber-50 text-amber-700', icon: TrendingUp }
      : { label: 'Kasa eksiği', cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: TrendingDown }
  const VerdictIcon = verdict.icon

  return (
    <>
      <Topbar
        title="Gün Sonu Kasa Kapanışı"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'Finans', 'Kasa Kapanışı']}
      />

      <div className="relative space-y-7 p-4 sm:p-6 lg:p-8">
        {/* Z RAPORU çipi */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7cfa6]/60 bg-[#fbf3e6] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a6f22]">
            <Award className="h-3.5 w-3.5" /> Z Raporu
          </span>
          <span className="text-[12px] font-medium text-[#705a66]">Gün sonu nakit mutabakatı</span>
        </div>

        {/* Kapanış + bilgi */}
        <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Kapanış kartı */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_16px_38px_-26px_rgba(200,87,118,0.55)] sm:p-6"
          >
            <div className="flex items-center gap-3 border-b border-[#f2e6eb] pb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fbeaf1] text-[#c85776]">
                <CalendarCheck className="h-4 w-4" strokeWidth={1.9} />
              </div>
              <h2 className="font-display text-lg font-bold text-[#241923]">Kapanış (Z Raporu)</h2>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">İş günü</span>
                <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Açılış (devir) ₺</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#a98a98]">₺</span>
                  <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder={String(suggestedOpening)} className="w-full rounded-[12px] border border-[#ead8df] bg-white py-2.5 pl-8 pr-3 text-[13px] tabular-nums text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40" />
                </div>
              </label>
            </div>

            {/* Makbuz / döküm */}
            <div className="gc-receipt mt-5 space-y-2.5 rounded-[16px] border border-[#f1e3e9] bg-[#fffafc] p-5 text-[13px]">
              <div className="flex items-center justify-between text-[#4a3a44]">
                <span className="flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5 text-[#705a66]" /> Açılış (devir)</span>
                <span className="tabular-nums font-semibold">{formatTL(Math.round(opening))}</span>
              </div>
              <div className="border-t border-dashed border-[#ead0d9]" />
              <div className="flex items-center justify-between text-emerald-700">
                <span className="flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5" /> + Günün nakit tahsilatı</span>
                <span className="tabular-nums font-semibold">{formatTL(Math.round(cashIncome))}</span>
              </div>
              <div className="flex items-center justify-between text-[#cf4d68]">
                <span className="flex items-center gap-1.5"><ArrowDownRight className="h-3.5 w-3.5" /> − Günün nakit gideri</span>
                <span className="tabular-nums font-semibold">{formatTL(Math.round(cashExpense))}</span>
              </div>
              <div className="border-t-2 border-[#ead0d9]" />
              <div className="flex items-center justify-between pt-0.5 text-[15px] font-bold text-[#241923]">
                <span className="flex items-center gap-1.5"><Calculator className="h-4 w-4 text-[#c85776]" /> = Sistem nakdi (beklenen)</span>
                <span className="tabular-nums text-[#b06a26]">{formatTL(Math.round(systemCash))}</span>
              </div>
            </div>

            {/* Sayılan fiziki nakit */}
            <label className="mt-5 block">
              <span className="mb-2 block text-[13px] font-bold text-[#241923]">Sayılan fiziki nakit ₺ *</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-[#c85776]">₺</span>
                <input
                  type="number"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder="kasada saydığın tutar"
                  className="w-full rounded-[14px] border-2 border-[#f3b6c8] bg-white py-4 pl-12 pr-4 font-display text-2xl font-bold tabular-nums text-[#241923] shadow-sm outline-none transition placeholder:text-[15px] placeholder:font-medium placeholder:text-[#c9b3bd] focus:border-[#ef6088] focus:ring-4 focus:ring-[#f4b6cb]/25"
                />
              </div>
            </label>

            {/* Fark sonuç banner'ı */}
            {countedCash !== '' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={`mt-4 flex items-center justify-between rounded-[16px] border px-4 py-3.5 ${verdict.cls}`}
              >
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  <VerdictIcon className="h-5 w-5" /> {verdict.label}
                </span>
                <span className="font-display text-xl font-bold tabular-nums">
                  Fark: {difference > 0 ? '+' : ''}{formatTL(Math.round(difference))}
                </span>
              </motion.div>
            )}

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Not (ops.)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="örn. 50₺ bozuk para eksik" className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40" />
            </label>

            {alreadyClosed && <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">Bu gün zaten kapatılmış — kaydetmek mevcut kaydı günceller.</div>}
            {actionError && <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{actionError}</div>}

            <div className="mt-5 flex justify-end">
              <button type="button" disabled={busy} onClick={handleSave} className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
                <Lock className="h-4 w-4" /> {alreadyClosed ? 'Güncelle' : 'Günü kapat'}
              </button>
            </div>
          </motion.div>

          {/* Bilgi paneli */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_16px_38px_-28px_rgba(200,87,118,0.5)] sm:p-6"
          >
            <div className="flex items-center gap-2 font-display text-lg font-bold text-[#241923]">
              <HelpCircle className="h-4 w-4 text-[#c85776]" /> Nasıl çalışır?
            </div>
            <ul className="mt-4 space-y-3 text-[12.5px] leading-relaxed text-[#4a3a44]">
              <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sistem, seçtiğin günün <b className="font-semibold text-[#241923]">nakit</b> tahsilat ve giderini kasadan otomatik hesaplar.</li>
              <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sen yalnızca kasadaki <b className="font-semibold text-[#241923]">fiziki parayı</b> sayıp girersin; fark anında çıkar.</li>
              <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Açılış (devir) bir önceki günün sayımından otomatik önerilir.</li>
              <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Yalnızca <b className="font-semibold text-[#241923]">nakit</b> hesaba katılır; kart/havale kasada para olmadığı için hariç tutulur.</li>
            </ul>
            <div className="mt-5 rounded-[16px] border border-[#f3d9cf] bg-gradient-to-br from-[#fdf1ea] to-[#fbf3e6] p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9a6f22]">Önerilen açılış (devir)</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#b06a26]">{formatTL(Math.round(suggestedOpening))}</p>
            </div>
          </motion.div>
        </div>

        {/* Ödeme yöntemi kırılımı — nakit + kart + EFT/havale (+çek) */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.13 }}
          className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-26px_rgba(200,87,118,0.5)] sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[#f2e6eb] pb-4 text-[#241923]">
            <Wallet className="h-4 w-4 text-[#c85776]" />
            <h3 className="font-display text-lg font-bold">Ödeme yöntemi kırılımı</h3>
            <span className="rounded-full border border-[#efe1e7] bg-[#fffafc] px-2.5 py-0.5 text-[10px] font-semibold text-[#705a66]">bugünün tahsilatları</span>
            <span className="ml-auto text-[12px] font-semibold text-[#705a66]">
              Toplam tahsilat: <span className="font-display text-[15px] font-bold text-[#b06a26]">{formatTL(Math.round(totalMethodIncome))}</span>
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {METHOD_CARDS.filter((m) => m.key !== 'check' || (methodBreakdown['check']?.count ?? 0) > 0).map((m) => {
              const b = methodBreakdown[m.key] || { income: 0, expense: 0, count: 0 }
              const Icon = m.icon
              return (
                <div key={m.key} className={`rounded-[16px] border ${m.ring} ${m.chip} p-4`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${m.text}`}>
                      <Icon className="h-4 w-4" /> {m.label}
                    </span>
                    {m.key === 'cash' && (
                      <span className="rounded-full border border-emerald-200 bg-white/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-emerald-700">sayıma dahil</span>
                    )}
                  </div>
                  <div className={`mt-2 font-display text-xl font-bold tabular-nums ${m.text}`}>{formatTL(Math.round(b.income))}</div>
                  <div className="mt-0.5 text-[10.5px] text-[#705a66]">
                    {b.count} tahsilat{b.expense > 0 ? ` · ${formatTL(Math.round(b.expense))} gider` : ''}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#705a66]">
            Kart / EFT / havale kasada fiziki nakit oluşturmaz; yalnızca <b className="font-semibold text-[#241923]">nakit</b> sistem nakdine ve sayım farkına girer. Bu kırılım, günün tüm tahsilat yöntemlerini alınan tahsilatlardan otomatik gösterir.
          </p>
        </motion.div>

        {/* Günün nakit hareketleri (drill-down) */}
        {cashEntries.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.16 }}
            className="rounded-[22px] border border-[#efe1e7] bg-white/95 p-5 shadow-[0_14px_34px_-26px_rgba(200,87,118,0.5)] sm:p-6"
          >
            <div className="flex items-center gap-2 border-b border-[#f2e6eb] pb-4 text-[#241923]">
              <Receipt className="h-4 w-4 text-[#c85776]" />
              <h3 className="font-display text-lg font-bold">Günün nakit hareketleri</h3>
              <span className="ml-1 rounded-full border border-[#efe1e7] bg-[#fffafc] px-2.5 py-0.5 text-[10px] font-semibold text-[#705a66]">{cashEntries.length} kayıt</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {cashEntries.map((e) => {
                const income = e.type === 'income'
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-[12px] px-2.5 py-2 transition-colors hover:bg-[#fffafc]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${income ? 'bg-emerald-500' : 'bg-[#cf4d68]'}`} />
                    <span className="w-11 shrink-0 text-[11px] font-semibold tabular-nums text-[#705a66]">{e.time || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#3d2f3a]">
                      {e.description || e.category || (income ? 'Tahsilat' : 'Gider')}
                      {e.customerName ? ` · ${e.customerName}` : ''}
                    </span>
                    <span className="hidden shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 sm:inline">{cashFlowMethodLabel(e.method)}</span>
                    <span className={`w-24 shrink-0 text-right font-display text-[14px] font-bold tabular-nums ${income ? 'text-emerald-700' : 'text-[#cf4d68]'}`}>
                      {income ? '+' : '−'}{formatTL(e.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}

        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && closings.length === 0} emptyMessage="Henüz kasa kapanışı yapılmadı." />

        {/* Geçmiş kapanışlar */}
        {closings.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.22 }}
            className="overflow-hidden rounded-[22px] border border-[#efe1e7] bg-white/95 shadow-[0_14px_34px_-26px_rgba(200,87,118,0.5)]"
          >
            <div className="flex items-center gap-2 border-b border-[#f2e6eb] bg-[#fff8fa] px-5 py-4 text-[#241923]">
              <CalendarCheck className="h-4 w-4 text-[#c85776]" />
              <h3 className="font-display text-lg font-bold">Geçmiş kapanışlar</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#efe1e7] bg-[#fffafc] text-[10px] font-semibold uppercase tracking-wide text-[#705a66]">
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3 text-right">Açılış</th>
                    <th className="px-4 py-3 text-right">Nakit Gelir</th>
                    <th className="px-4 py-3 text-right">Nakit Gider</th>
                    <th className="px-4 py-3 text-right">Sistem</th>
                    <th className="px-4 py-3 text-right">Sayılan</th>
                    <th className="px-4 py-3 text-right">Fark</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2e6eb]">
                  {closings.map((c) => (
                    <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#3d2f3a] transition-colors hover:bg-[#fffafc]">
                      <td className="px-4 py-3 font-medium text-[#241923]">{c.businessDate ? new Date(`${c.businessDate}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatTL(Math.round(c.openingBalance))}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatTL(Math.round(c.cashIncome))}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#cf4d68]">{formatTL(Math.round(c.cashExpense))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatTL(Math.round(c.systemCash))}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#241923]">{formatTL(Math.round(c.countedCash))}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                            c.difference === 0
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : c.difference > 0
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-rose-200 bg-rose-50 text-[#cf4d68]'
                          }`}
                        >
                          {c.difference > 0 ? '+' : ''}{formatTL(Math.round(c.difference))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" disabled={busy} onClick={() => handleDelete(c.id)} title="Sil" className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#d1556f]/10 text-[#cf4d68] transition-colors hover:bg-[#d1556f]/18 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>
    </>
  )
}
