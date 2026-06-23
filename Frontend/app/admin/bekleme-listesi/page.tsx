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
  WaitlistEntry,
  WaitlistStatus,
} from '@/lib/types'
import { Bell, Calendar, CalendarCheck, CalendarClock, CheckCircle2, Clock, Hourglass, ListPlus, Lock, Plus, Quote, RotateCcw, Scissors, Sparkles, Trash2, UserRound, XCircle } from 'lucide-react'

interface WaitlistData {
  entries: ApiWaitlistEntry[]
  customers: PagedResult<ApiCustomer>
  services: PagedResult<ApiService>
  staff: PagedResult<ApiStaff>
}

const statusMeta: Record<WaitlistStatus, { label: string; pill: string; bar: string; icon: typeof Clock }> = {
  Waiting: { label: 'Bekliyor', pill: 'border-amber-200 bg-amber-50 text-amber-700', bar: 'bg-amber-400', icon: Clock },
  Notified: { label: 'Bilgilendirildi', pill: 'border-sky-200 bg-sky-50 text-sky-700', bar: 'bg-sky-400', icon: Bell },
  Booked: { label: 'Randevu yapıldı', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', bar: 'bg-emerald-400', icon: CheckCircle2 },
  Cancelled: { label: 'İptal', pill: 'border-rose-200 bg-rose-50 text-rose-600', bar: 'bg-[#d1556f]', icon: XCircle },
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '•'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr-TR')
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('tr-TR')
}

function waitDuration(createdAt: string): string | null {
  if (!createdAt) return null
  const then = new Date(createdAt).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'bugün eklendi'
  return `${days} gündür listede`
}

function formatPreferred(d: string): string {
  if (!d) return '—'
  const date = new Date(`${d}T00:00:00`)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/* ----- Tek bekleme satırı — numaralı kuyruk + durum aksanı ----- */
function WaitRow({
  entry,
  queueNo,
  name,
  service,
  staff,
  index,
  busy,
  onNotify,
  onBook,
  onCancel,
  onRequeue,
  onDelete,
}: {
  entry: WaitlistEntry
  queueNo: number | null
  name: string
  service: string | null
  staff: string | null
  index: number
  busy: boolean
  onNotify: () => void
  onBook: () => void
  onCancel: () => void
  onRequeue: () => void
  onDelete: () => void
}) {
  const meta = statusMeta[entry.status]
  const StatusIcon = meta.icon
  const resolved = entry.status === 'Booked' || entry.status === 'Cancelled'
  const wait = waitDuration(entry.createdAt)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-[18px] border border-[#efe1e7] bg-white/96 p-4 pl-5 shadow-[0_12px_30px_-24px_rgba(200,87,118,0.55)] transition-all md:flex-row md:items-center ${
        resolved ? 'opacity-70 hover:opacity-100' : 'hover:shadow-[0_16px_36px_-22px_rgba(200,87,118,0.6)]'
      }`}
    >
      {/* durum aksan şeridi */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${meta.bar}`} aria-hidden />

      {/* sıra no + avatar */}
      <div className="flex shrink-0 items-center gap-3">
        {queueNo !== null ? (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#f47699] to-[#ef6088] text-[13px] font-bold text-white shadow-[0_6px_14px_-7px_rgba(214,95,131,0.95)]">
            {queueNo}
          </span>
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f1e6eb] text-[#a98a98]">
            <StatusIcon className="h-4 w-4" />
          </span>
        )}
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#fde7ef] to-[#f0aac2] font-display text-[14px] font-bold text-[#7f4057]">
          {initials(name)}
        </span>
      </div>

      {/* orta blok */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-[#241923]">{name}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.pill}`}>
            <StatusIcon className="h-3 w-3" /> {meta.label}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-medium text-[#705a66]">
          <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-[#c85776]" /> {formatPreferred(entry.preferredDate)}</span>
          {service && <span className="inline-flex items-center gap-1.5"><Scissors className="h-3.5 w-3.5 text-[#c85776]" /> {service}</span>}
          {staff && <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-[#c85776]" /> {staff}</span>}
          {wait && <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#c85776]" /> {wait}</span>}
          {entry.note && <span className="inline-flex items-center gap-1.5 text-[#9a6f22]"><Quote className="h-3.5 w-3.5" /> {entry.note}</span>}
        </div>
      </div>

      {/* aksiyonlar */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {!resolved ? (
          <>
            {entry.status === 'Waiting' && (
              <button
                type="button"
                disabled={busy}
                onClick={onNotify}
                title="Bilgilendirildi olarak işaretle"
                className="inline-flex items-center gap-1.5 rounded-[11px] bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
              >
                <Bell className="h-3.5 w-3.5" /> Bildirildi
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onBook}
              title="Randevu yapıldı"
              className="inline-flex items-center gap-1.5 rounded-[11px] bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              <CalendarCheck className="h-3.5 w-3.5" /> Randevu
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              title="İptal et"
              className="grid h-8 w-8 place-items-center rounded-[11px] bg-[#f7ecf1] text-[#705a66] transition-colors hover:bg-[#efdfe7] hover:text-[#cf4d68] disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onRequeue}
            title="Yeniden sıraya al"
            className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#f7ecf1] px-2.5 py-1.5 text-[11px] font-semibold text-[#5d4a56] transition-colors hover:bg-[#efdfe7] hover:text-[#c85776] disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Sıraya al
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          title="Sil"
          className="grid h-8 w-8 place-items-center rounded-[11px] bg-[#d1556f]/10 text-[#cf4d68] transition-colors hover:bg-[#d1556f]/18 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
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

  // Kuyruk sırası: önce aktif (Bekliyor→Bilgilendirildi), en eski kayıt en üstte; çözülenler altta soluk.
  const sorted = useMemo(() => {
    const order: Record<WaitlistStatus, number> = { Waiting: 0, Notified: 1, Booked: 2, Cancelled: 3 }
    return [...entries].sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      return (a.createdAt || '').localeCompare(b.createdAt || '')
    })
  }, [entries])

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
  const bookedCount = entries.filter((e) => e.status === 'Booked').length

  const featureAllowed = useFeature('appointments.waitlist')
  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Bekleme Listesi" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'İşletme', 'Bekleme Listesi']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#c85776]/60" />
          <div className="mt-3 font-display text-xl text-[#241923]">Bekleme Listesi</div>
          <p className="mt-2 text-[13px] text-[#705a66]">Bu özellik paketinizde yok. Üst pakete geçerek bekleme listesini kullanabilirsiniz.</p>
        </div>
      </>
    )
  }

  const statCards = [
    { label: 'Toplam kayıt', value: String(entries.length), icon: CalendarClock, chip: 'bg-[#fbeaf1] text-[#c85776]' },
    { label: 'Sırada bekleyen', value: String(activeCount), icon: Hourglass, chip: 'bg-amber-50 text-amber-600' },
    { label: 'Randevuya dönen', value: String(bookedCount), icon: CheckCircle2, chip: 'bg-[#e6f5ee] text-[#2f9e72]' },
  ]

  let qn = 0

  return (
    <>
      <Topbar
        title="Bekleme Listesi"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'İşletme', 'Bekleme Listesi']}
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

        {/* Ekleme formu */}
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
            <h2 className="font-display text-lg font-bold text-[#241923]">Bekleme listesine ekle</h2>
            <Sparkles className="ml-auto h-4 w-4 text-[#e9a6bf]" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Müşteri *</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40">
                <option value="">Seçin…</option>
                {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Hizmet (ops.)</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40">
                <option value="">Farketmez</option>
                {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Personel (ops.)</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40">
                <option value="">Farketmez</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Tercih edilen tarih *</span>
              <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#705a66]">Not (ops.)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="örn. öğleden sonrası uygun" className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40" />
            </label>
          </div>
          {actionError && <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{actionError}</div>}
          <div className="mt-5 flex justify-end">
            <button type="button" disabled={busy} onClick={handleCreate} className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
              <ListPlus className="h-4 w-4" strokeWidth={2.3} /> Listeye ekle
            </button>
          </div>
        </motion.div>

        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && entries.length === 0} emptyMessage="Bekleme listesi boş. Dolu bir güne talep gelirse buradan ekleyebilirsin." />

        {/* Kuyruk */}
        <div className="space-y-3">
          {sorted.map((w, i) => {
            const active = w.status === 'Waiting' || w.status === 'Notified'
            const queueNo = active ? ++qn : null
            return (
              <WaitRow
                key={w.id}
                entry={w}
                queueNo={queueNo}
                index={i}
                name={customerName[w.customerId] || 'Müşteri'}
                service={w.serviceDefinitionId ? serviceName[w.serviceDefinitionId] || 'Hizmet' : null}
                staff={w.staffMemberId ? staffName[w.staffMemberId] || 'Personel' : null}
                busy={busy}
                onNotify={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Notified', tenantId))}
                onBook={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Booked', tenantId))}
                onCancel={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Cancelled', tenantId))}
                onRequeue={() => runAction(() => adminApi.setWaitlistStatus(w.id, 'Waiting', tenantId))}
                onDelete={() => runAction(() => adminApi.deleteWaitlist(w.id, tenantId))}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}
