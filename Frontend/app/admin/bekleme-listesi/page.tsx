'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizeWaitlistEntry } from '@/lib/apiMappers'
import type {
  ApiCustomer,
  ApiService,
  ApiStaff,
  ApiWaitlistEntry,
  PagedResult,
  WaitlistStatus,
} from '@/lib/types'
import { Bell, CalendarClock, CalendarPlus, CheckCircle2, Clock, Lock, Plus, Scissors, Trash2, UserRound, XCircle } from 'lucide-react'

interface WaitlistData {
  entries: ApiWaitlistEntry[]
  customers: PagedResult<ApiCustomer>
  services: PagedResult<ApiService>
  staff: PagedResult<ApiStaff>
}

const statusMeta: Record<WaitlistStatus, { label: string; tone: string; icon: typeof Clock }> = {
  Waiting: { label: 'Bekliyor', tone: 'border-amber-200 bg-amber-50 text-amber-700', icon: Clock },
  Notified: { label: 'Bilgilendirildi', tone: 'border-sky-200 bg-sky-50 text-sky-700', icon: Bell },
  Booked: { label: 'Randevu yapıldı', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  Cancelled: { label: 'İptal', tone: 'border-rose-200 bg-rose-50 text-rose-600', icon: XCircle },
}

export default function BeklemeListesiPage() {
  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)

  const { data, loading, error, reload } = useApiQuery<WaitlistData>(
    async () => {
      if (!tenantId) return { entries: [], customers: { items: [] }, services: { items: [] }, staff: { items: [] } }
      const [entries, customers, services, staff] = await Promise.all([
        adminApi.waitlist<ApiWaitlistEntry>(tenantId).catch(() => []),
        adminApi.customers<ApiCustomer>({ tenantId, page: 1, pageSize: 500 }),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }),
      ])
      return { entries: Array.isArray(entries) ? entries : [], customers, services, staff }
    },
    [tenantId],
    { initialData: null },
  )

  const entries = useMemo(() => (data?.entries || []).map((w, i) => normalizeWaitlistEntry(w, i)), [data])
  const customerName = useMemo(() => {
    const map: Record<string, string> = {}
    apiItems(data?.customers).forEach((c) => { if (c.id) map[c.id] = c.fullName || c.name || 'Müşteri' })
    return map
  }, [data])
  const serviceName = useMemo(() => {
    const map: Record<string, string> = {}
    apiItems(data?.services).forEach((s) => { if (s.id) map[s.id] = s.name || 'Hizmet' })
    return map
  }, [data])
  const staffName = useMemo(() => {
    const map: Record<string, string> = {}
    apiItems(data?.staff).forEach((s) => { if (s.id) map[s.id] = s.fullName || s.name || 'Personel' })
    return map
  }, [data])

  const customerOptions = useMemo(() => apiItems(data?.customers).map((c) => ({ id: c.id || '', name: c.fullName || c.name || 'Müşteri' })).filter((c) => c.id), [data])
  const serviceOptions = useMemo(() => apiItems(data?.services).map((s) => ({ id: s.id || '', name: s.name || 'Hizmet' })).filter((s) => s.id), [data])
  const staffOptions = useMemo(() => apiItems(data?.staff).map((s) => ({ id: s.id || '', name: s.fullName || s.name || 'Personel' })).filter((s) => s.id), [data])

  // ----- Form -----
  const [customerId, setCustomerId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const handleCreate = async (): Promise<void> => {
    if (!customerId) { setActionError('Müşteri seçin.'); return }
    if (!preferredDate) { setActionError('Tercih edilen tarihi seçin.'); return }
    setBusy(true)
    setActionError('')
    try {
      await adminApi.addWaitlist(
        {
          customerId,
          serviceDefinitionId: serviceId || null,
          staffMemberId: staffId || null,
          preferredDate,
          note: note.trim() || null,
          branchId: branchId ?? null,
        },
        tenantId,
      )
      setCustomerId(''); setServiceId(''); setStaffId(''); setPreferredDate(''); setNote('')
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Eklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setActionError('')
    try { await fn(); await reload() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'İşlem başarısız.') }
    finally { setBusy(false) }
  }

  const activeCount = entries.filter((e) => e.status === 'Waiting' || e.status === 'Notified').length

  const featureAllowed = useFeature('appointments.waitlist')
  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Bekleme Listesi" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'İşletme', 'Bekleme Listesi']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl">Bekleme Listesi</div>
          <p className="mt-2 text-[13px] text-[#352432]/55">Bu özellik paketinizde yok. Üst pakete geçerek bekleme listesini kullanabilirsiniz.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar
        title="Bekleme Listesi"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'İşletme', 'Bekleme Listesi']}
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Toplam kayıt', value: String(entries.length), icon: CalendarClock, tone: 'text-[#c85776]' },
            { label: 'Sırada bekleyen', value: String(activeCount), icon: Clock, tone: 'text-amber-600' },
            { label: 'Randevuya dönen', value: String(entries.filter((e) => e.status === 'Booked').length), icon: CheckCircle2, tone: 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="rounded-[18px] border border-[#efe1e7] bg-white/94 p-4">
              <div className="flex items-center gap-2 text-[12px] text-[#8a7480]"><s.icon className={`h-4 w-4 ${s.tone}`} strokeWidth={1.7} /> {s.label}</div>
              <div className="mt-2 text-[26px] font-semibold tabular-nums text-[#241923]">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Ekleme formu */}
        <div className="rounded-[20px] border border-[#efe1e7] bg-white/94 p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#241923]">
            <Plus className="h-4 w-4 text-[#c85776]" /> Bekleme listesine ekle
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Müşteri *</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]">
                <option value="">Seçin…</option>
                {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Hizmet (ops.)</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]">
                <option value="">Farketmez</option>
                {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Personel (ops.)</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]">
                <option value="">Farketmez</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Tercih edilen tarih *</span>
              <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-[#8a7480]">Not (ops.)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="örn. öğleden sonrası uygun" className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none focus:border-[#ef9ab5]" />
            </label>
          </div>
          {actionError && <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</div>}
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={busy} onClick={handleCreate} className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_15px_26px_-17px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
              <Plus className="h-4 w-4" /> Listeye ekle
            </button>
          </div>
        </div>

        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && entries.length === 0} emptyMessage="Bekleme listesi boş. Dolu bir güne talep gelirse buradan ekleyebilirsin." />

        {/* Liste */}
        <div className="space-y-2.5">
          {entries.map((w, i) => {
            const meta = statusMeta[w.status]
            const Icon = meta.icon
            const resolved = w.status === 'Booked' || w.status === 'Cancelled'
            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: i * 0.02 }}
                className={`flex flex-wrap items-center gap-3 rounded-[16px] border bg-white/94 p-3.5 ${resolved ? 'border-[#ead8df] opacity-80' : 'border-[#efe1e7]'}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#efd5dd] bg-gradient-to-br from-[#fff5f8] to-[#f2b9ca] text-[11px] font-semibold text-[#7f4057]">
                  {(customerName[w.customerId] || '•').slice(0, 2).toLocaleUpperCase('tr-TR')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#241923]">{customerName[w.customerId] || 'Müşteri'}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#8a7480]">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {w.preferredDate ? new Date(`${w.preferredDate}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
                    {w.serviceDefinitionId && <span className="inline-flex items-center gap-1"><Scissors className="h-3 w-3" /> {serviceName[w.serviceDefinitionId] || 'Hizmet'}</span>}
                    {w.staffMemberId && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" /> {staffName[w.staffMemberId] || 'Personel'}</span>}
                    {w.note && <span className="truncate">“{w.note}”</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!resolved && (
                    <>
                      {w.status === 'Waiting' && (
                        <button type="button" disabled={busy} onClick={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Notified', tenantId))} title="Bilgilendirildi olarak işaretle" className="inline-flex items-center gap-1 rounded-[10px] border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50">
                          <Bell className="h-3.5 w-3.5" /> Bildirildi
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Booked', tenantId))} title="Randevu yapıldı" className="inline-flex items-center gap-1 rounded-[10px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                        <CalendarPlus className="h-3.5 w-3.5" /> Randevu yapıldı
                      </button>
                      <button type="button" disabled={busy} onClick={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Cancelled', tenantId))} title="İptal" className="inline-flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#5d4a56] hover:border-rose-200 hover:text-rose-600 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" /> İptal
                      </button>
                    </>
                  )}
                  {resolved && (
                    <button type="button" disabled={busy} onClick={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Waiting', tenantId))} className="inline-flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#5d4a56] hover:border-[#efbfd0] hover:text-[#c85776] disabled:opacity-50">
                      <Clock className="h-3.5 w-3.5" /> Sıraya al
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => runAction(() => adminApi.deleteWaitlist(w.id, tenantId))} title="Sil" className="grid h-8 w-8 place-items-center rounded-[10px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" />
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
