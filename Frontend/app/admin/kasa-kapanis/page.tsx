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
import type { ApiCashClosing, ApiCashClosingPreview, ApiCashFlowEntry } from '@/lib/types'
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarCheck, Calculator, CheckCircle2, Lock, Receipt, Trash2 } from 'lucide-react'

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
  const cashEntries = useMemo(
    () => (flowData || []).map((e, i) => normalizeCashFlowEntry(e, i)).filter((e) => e.method === 'cash'),
    [flowData],
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
          <div className="mt-3 font-display text-xl">Gün Sonu Kasa Kapanışı</div>
          <p className="mt-2 text-[13px] text-[#352432]/55">Bu özellik paketinizde yok. Üst pakete geçerek Z raporu / kasa kapanışını kullanabilirsiniz.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar
        title="Gün Sonu Kasa Kapanışı"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'Finans', 'Kasa Kapanışı']}
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        {/* Kapanış kartı */}
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[20px] border border-[#efe1e7] bg-white/94 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#241923]">
              <CalendarCheck className="h-4 w-4 text-[#c85776]" /> Kapanış (Z raporu)
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">İş günü</span>
                <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Açılış (devir) ₺</span>
                <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder={String(suggestedOpening)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]" />
              </label>
            </div>

            {/* Sistem hesabı */}
            <div className="mt-4 space-y-2 rounded-[14px] border border-[#f1e3e9] bg-[#fffafc] p-3.5 text-[12px]">
              <div className="flex items-center justify-between text-[#5d4a56]"><span className="flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5 text-[#8a7480]" /> Açılış (devir)</span><span className="tabular-nums">{formatTL(Math.round(opening))}</span></div>
              <div className="flex items-center justify-between text-emerald-700"><span className="flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5" /> + Günün nakit tahsilatı</span><span className="tabular-nums">{formatTL(Math.round(cashIncome))}</span></div>
              <div className="flex items-center justify-between text-rose-600"><span className="flex items-center gap-1.5"><ArrowDownRight className="h-3.5 w-3.5" /> − Günün nakit gideri</span><span className="tabular-nums">{formatTL(Math.round(cashExpense))}</span></div>
              <div className="flex items-center justify-between border-t border-dashed border-[#eadde3] pt-2 font-semibold text-[#241923]"><span className="flex items-center gap-1.5"><Calculator className="h-3.5 w-3.5 text-[#c85776]" /> Sistem nakdi (beklenen)</span><span className="tabular-nums">{formatTL(Math.round(systemCash))}</span></div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Sayılan fiziki nakit ₺ *</span>
              <input type="number" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="kasada saydığın tutar" className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[14px] font-semibold text-[#352432] outline-none focus:border-[#ef9ab5]" />
            </label>

            {/* Fark */}
            {countedCash !== '' && (
              <div className={`mt-3 flex items-center justify-between rounded-[12px] border px-3.5 py-2.5 text-[13px] font-semibold ${
                difference === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : difference > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                <span>{difference === 0 ? 'Kasa tuttu ✓' : difference > 0 ? 'Kasa fazlası' : 'Kasa eksiği'}</span>
                <span className="tabular-nums">{difference > 0 ? '+' : ''}{formatTL(Math.round(difference))}</span>
              </div>
            )}

            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Not (ops.)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="örn. 50₺ bozuk para eksik" className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]" />
            </label>

            {alreadyClosed && <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Bu gün zaten kapatılmış — kaydetmek mevcut kaydı günceller.</div>}
            {actionError && <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</div>}

            <div className="mt-4 flex justify-end">
              <button type="button" disabled={busy} onClick={handleSave} className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
                <Lock className="h-4 w-4" /> {alreadyClosed ? 'Güncelle' : 'Günü kapat'}
              </button>
            </div>
          </div>

          {/* Bilgi paneli */}
          <div className="rounded-[20px] border border-[#efe1e7] bg-gradient-to-br from-white to-[#fff8fa] p-5">
            <div className="text-[13px] font-semibold text-[#241923]">Nasıl çalışır?</div>
            <ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-[#5d4a56]">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sistem, seçtiğin günün <b>nakit</b> tahsilat ve giderini kasadan otomatik hesaplar.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Sen yalnızca kasadaki <b>fiziki parayı</b> sayıp girersin; fark anında çıkar.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Açılış (devir) bir önceki günün sayımından otomatik önerilir.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Yalnızca <b>nakit</b> hesaba katılır; kart/havale kasada para olmadığı için hariç tutulur.</li>
            </ul>
          </div>
        </div>

        {/* Günün nakit hareketleri (drill-down) — sistem nakdinin hangi işlemlerden oluştuğu */}
        {cashEntries.length > 0 && (
          <div className="rounded-[18px] border border-[#efe1e7] bg-white/94 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#241923]">
              <Receipt className="h-4 w-4 text-[#c85776]" /> Günün nakit hareketleri
              <span className="ml-1 rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2 py-0.5 text-[10px] font-medium text-[#9a8590]">{cashEntries.length} kayıt</span>
            </div>
            <div className="mt-3 divide-y divide-[#f2e6eb]">
              {cashEntries.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 text-[12px]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.type === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-[#8a7480]">{e.time || '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-[#3d2f3a]">
                    {e.description || e.category || (e.type === 'income' ? 'Tahsilat' : 'Gider')}
                    {e.customerName ? ` · ${e.customerName}` : ''}
                  </span>
                  <span className="hidden shrink-0 rounded-full border border-[#efe1e7] px-2 py-0.5 text-[10px] text-[#9a8590] sm:inline">{cashFlowMethodLabel(e.method)}</span>
                  <span className={`w-20 shrink-0 text-right font-semibold tabular-nums ${e.type === 'income' ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {e.type === 'income' ? '+' : '−'}{formatTL(e.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && closings.length === 0} emptyMessage="Henüz kasa kapanışı yapılmadı." />

        {/* Geçmiş */}
        {closings.length > 0 && (
          <div className="overflow-x-auto rounded-[18px] border border-[#efe1e7] bg-white/94">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#efe1e7] bg-[#fff8fa] text-[11px] text-[#8a7480]">
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
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#3d2f3a] hover:bg-[#fff8fa]">
                    <td className="px-4 py-3 font-medium">{c.businessDate ? new Date(`${c.businessDate}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatTL(Math.round(c.openingBalance))}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatTL(Math.round(c.cashIncome))}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-600">{formatTL(Math.round(c.cashExpense))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatTL(Math.round(c.systemCash))}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatTL(Math.round(c.countedCash))}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${c.difference === 0 ? 'text-emerald-700' : c.difference > 0 ? 'text-amber-700' : 'text-rose-600'}`}>
                      {c.difference > 0 ? '+' : ''}{formatTL(Math.round(c.difference))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" disabled={busy} onClick={() => handleDelete(c.id)} title="Sil" className="grid h-7 w-7 place-items-center rounded-[8px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
