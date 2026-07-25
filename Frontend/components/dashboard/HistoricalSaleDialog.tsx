'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Archive, CalendarClock, CheckCircle2, Loader2, Package, Scissors, User, Wallet, X } from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'

/**
 * GEÇMİŞ SATIŞ girişi — yazılıma yeni geçen kurumlar, önceki yıllarda sattıkları paket/hizmetleri
 * buradan sisteme işler. Satış tarihi, satan personel, o güne kadar tahsil edilen tutar, kalan
 * taksitler ve KULLANILMIŞ seanslar birlikte girilir; böylece müşteri kartındaki geçmiş eksiksiz olur.
 */

export interface HistoricalSaleValues {
  name: string
  soldAt: string
  soldByStaffMemberId: string | null
  servicePackageId: string | null
  serviceDefinitionId: string | null
  totalAmount: number
  paidAmount: number
  sessionsTotal: number
  sessionsUsed: number
  installmentCount: number
  firstDueDate: string | null
  notes: string | null
}

const FIELD = 'w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40'
const LABEL = 'mb-1 block text-[11px] font-semibold text-[#4a3a44]'

export default function HistoricalSaleDialog({
  customerName,
  staffOptions,
  packageOptions,
  serviceOptions,
  busy = false,
  onClose,
  onSubmit,
}: {
  customerName: string
  staffOptions: { id: string; name: string }[]
  packageOptions: { id: string; name: string; price: number }[]
  serviceOptions: { id: string; name: string; price: number }[]
  busy?: boolean
  onClose: () => void
  onSubmit: (values: HistoricalSaleValues) => Promise<void>
}) {
  // Katalogdan seçim: paket ya da tek hizmet. "Serbest" seçilirse ad elle yazılır
  // (kataloğa hiç girilmemiş eski paketler için).
  const [kind, setKind] = useState<'package' | 'service' | 'free'>('package')
  const [packageId, setPackageId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [soldAt, setSoldAt] = useState('')
  const [staffId, setStaffId] = useState('')
  const [total, setTotal] = useState('')
  const [paid, setPaid] = useState('')
  const [sessionsTotal, setSessionsTotal] = useState('')
  const [sessionsUsed, setSessionsUsed] = useState('')
  const [installments, setInstallments] = useState('0')
  const [firstDue, setFirstDue] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const todayIso = new Date().toISOString().slice(0, 10)

  // Katalogdan seçim yapılınca ad ve tutar otomatik dolar (kullanıcı değiştirebilir).
  const applyPackage = (id: string): void => {
    setPackageId(id)
    const p = packageOptions.find((x) => x.id === id)
    if (p) { setName(p.name); if (!total) setTotal(String(p.price)) }
  }
  const applyService = (id: string): void => {
    setServiceId(id)
    const s = serviceOptions.find((x) => x.id === id)
    if (s) { setName(s.name); if (!total) setTotal(String(s.price)) }
  }

  const totalNum = Math.max(0, Number(total) || 0)
  const paidNum = Math.max(0, Number(paid) || 0)
  const remaining = Math.max(0, totalNum - Math.min(paidNum, totalNum))
  const instCount = Math.max(0, Number(installments) || 0)
  const perInstallment = instCount > 0 && remaining > 0 ? remaining / instCount : 0

  const effectiveName = useMemo(() => {
    if (kind === 'package') return packageOptions.find((p) => p.id === packageId)?.name || name
    if (kind === 'service') return serviceOptions.find((s) => s.id === serviceId)?.name || name
    return name
  }, [kind, packageId, serviceId, name, packageOptions, serviceOptions])

  const submit = async (): Promise<void> => {
    if (!effectiveName.trim()) { setError('Paket / hizmet adı zorunludur.'); return }
    if (!soldAt) { setError('Satış tarihi zorunludur.'); return }
    if (soldAt > todayIso) { setError('Satış tarihi bugünden ileri olamaz.'); return }
    if (totalNum <= 0) { setError('Tutar sıfırdan büyük olmalı.'); return }
    if (paidNum > totalNum) { setError('Tahsil edilen tutar, toplam tutardan fazla olamaz.'); return }
    const st = Math.max(0, Number(sessionsTotal) || 0)
    const su = Math.max(0, Number(sessionsUsed) || 0)
    if (su > st) { setError('Kullanılan seans, toplam seanstan fazla olamaz.'); return }
    if (st > 0 && kind !== 'package' && !serviceId) { setError('Seans takibi için hizmet seçin (seanslar bir hizmetten düşer).'); return }

    setSaving(true)
    setError('')
    try {
      await onSubmit({
        name: effectiveName.trim(),
        // Girilen gün yerel; günün başlangıcı UTC'ye çevrilir.
        soldAt: new Date(`${soldAt}T12:00:00`).toISOString(),
        soldByStaffMemberId: staffId || null,
        servicePackageId: kind === 'package' && packageId ? packageId : null,
        serviceDefinitionId: kind !== 'package' && serviceId ? serviceId : null,
        totalAmount: totalNum,
        paidAmount: Math.min(paidNum, totalNum),
        sessionsTotal: st,
        sessionsUsed: su,
        installmentCount: remaining > 0 ? instCount : 0,
        firstDueDate: remaining > 0 && instCount > 0 ? (firstDue || null) : null,
        notes: notes.trim() || null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kayıt başarısız.')
    } finally {
      setSaving(false)
    }
  }

  const working = saving || busy

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[#f2e6eb] px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#e0d3f2] bg-[#faf6ff] text-[#6b4aa0]">
            <Archive className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[17px] font-bold text-[#241923]">Geçmiş satış ekle</div>
            <div className="mt-0.5 text-[11px] text-[#705a66]">
              <b className="text-[#4a3a44]">{customerName}</b> · yazılıma geçmeden önce yapılmış paket/hizmet satışını sisteme işleyin
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#efe1e7] text-[#705a66] hover:text-[#c85776]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {/* Ne satıldı? */}
          <div>
            <span className={LABEL}>Ne satıldı? *</span>
            <div className="mb-2 inline-flex rounded-full border border-[#efe1e7] bg-[#fff8fa] p-0.5">
              {([['package', 'Paket', Package], ['service', 'Hizmet', Scissors], ['free', 'Elle yaz', Archive]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${kind === k ? 'bg-[#c85776] text-white' : 'text-[#705a66] hover:text-[#a34a62]'}`}
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
            </div>

            {kind === 'package' && (
              <select value={packageId} onChange={(e) => applyPackage(e.target.value)} className={FIELD}>
                <option value="">Paket seçin…</option>
                {packageOptions.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatTL(p.price)}</option>)}
              </select>
            )}
            {kind === 'service' && (
              <select value={serviceId} onChange={(e) => applyService(e.target.value)} className={FIELD}>
                <option value="">Hizmet seçin…</option>
                {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatTL(s.price)}</option>)}
              </select>
            )}
            {(kind === 'free' || (kind === 'package' && !packageId) || (kind === 'service' && !serviceId)) && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="örn. 2023 Lazer Epilasyon Paketi"
                className={`${FIELD} ${kind === 'free' ? '' : 'mt-2'}`}
              />
            )}
            {kind === 'free' && <p className="mt-1 text-[10px] text-[#705a66]">Katalogda olmayan eski paketler için adı elle yazın.</p>}
          </div>

          {/* Tarih + personel */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}><CalendarClock className="mr-1 inline h-3 w-3 text-[#c85776]" />Satış tarihi *</span>
              <input type="date" value={soldAt} max={todayIso} onChange={(e) => setSoldAt(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}><User className="mr-1 inline h-3 w-3 text-[#c85776]" />Satan personel</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={FIELD}>
                <option value="">Belirtilmedi</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>

          {/* Tutar + tahsilat */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Toplam tutar (₺) *</span>
              <input type="number" min={0} step={50} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
            </label>
            <label className="block">
              <span className={LABEL}><Wallet className="mr-1 inline h-3 w-3 text-[#c85776]" />O güne kadar tahsil edilen (₺)</span>
              <input type="number" min={0} step={50} value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
            </label>
          </div>

          {/* Seanslar */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Toplam seans</span>
              <input type="number" min={0} value={sessionsTotal} onChange={(e) => setSessionsTotal(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
            </label>
            <label className="block">
              <span className={LABEL}>Bugüne kadar kullanılan seans</span>
              <input type="number" min={0} value={sessionsUsed} onChange={(e) => setSessionsUsed(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
            </label>
          </div>
          {kind === 'package' && packageId && Number(sessionsTotal) > 0 && (
            <p className="-mt-1 text-[10px] text-[#705a66]">Paket seçildiğinde seanslar paketin kalemlerinden açılır; buradaki &quot;kullanılan&quot; sayısı düşülür.</p>
          )}

          {/* Seans takibi bir hizmete bağlıdır: elle yazılan eski paketlerde seans girilecekse
              seansın hangi hizmetten düşeceği seçilmeli (yoksa kalan seans takip edilemez). */}
          {kind === 'free' && Number(sessionsTotal) > 0 && (
            <label className="block">
              <span className={LABEL}><Scissors className="mr-1 inline h-3 w-3 text-[#c85776]" />Seanslar hangi hizmetten düşülsün? *</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={FIELD}>
                <option value="">Hizmet seçin…</option>
                {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="mt-1 block text-[10px] text-[#705a66]">Randevu tamamlandıkça seans buradan düşer.</span>
            </label>
          )}

          {/* Kalan borç varsa taksit planı */}
          {remaining > 0 && (
            <div className="rounded-[13px] border border-[#f2e6eb] bg-[#fffafc] p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[#4a3a44]">
                <span>Kalan borç için taksit planı</span>
                <span className="text-[#cf4d68]">{formatTL(Math.round(remaining))} kalan</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={LABEL}>Taksit sayısı</span>
                  <input type="number" min={0} max={36} value={installments} onChange={(e) => setInstallments(e.target.value)} className={`${FIELD} tabular-nums`} />
                </label>
                <label className="block">
                  <span className={LABEL}>İlk vade</span>
                  <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={FIELD} />
                </label>
              </div>
              {perInstallment > 0 && (
                <p className="mt-1.5 text-[10px] text-[#705a66]">
                  {instCount} taksit × {formatTL(Math.round(perInstallment))} · vade verilmezse satış tarihinden bir ay sonra başlar.
                </p>
              )}
            </div>
          )}

          <label className="block">
            <span className={LABEL}>Not</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsiyonel" className={FIELD} />
          </label>

          {error && <div className="rounded-[11px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">{error}</div>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#f2e6eb] bg-white px-5 py-3">
          <span className="text-[10px] text-[#705a66]">Kayıt &quot;Geçmiş kayıt&quot; olarak işaretlenir.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={working} className="rounded-[11px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-semibold text-[#705a66] disabled:opacity-60">Vazgeç</button>
            <button
              type="button"
              onClick={submit}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-[11px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-5 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(214,95,131,0.95)] disabled:opacity-60"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Kaydet
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  )
}
