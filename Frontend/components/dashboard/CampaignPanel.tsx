'use client'

import { useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeCampaign, normalizePackage, normalizeService } from '@/lib/apiMappers'
import type { ApiCampaign, ApiService, ApiServicePackage, CampaignTargetKey, DiscountTypeKey } from '@/lib/types'
import { Megaphone, Plus, Tag, Trash2 } from 'lucide-react'

const TARGET_LABELS: Record<CampaignTargetKey, string> = { All: 'Tüm hizmet/paket', Service: 'Belirli hizmet', Package: 'Belirli paket' }

interface CampaignForm {
  name: string
  discountType: DiscountTypeKey
  discountValue: number
  target: CampaignTargetKey
  targetId: string
  startDate: string
  endDate: string
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function plusDaysIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const emptyForm: CampaignForm = {
  name: '',
  discountType: 'Percent',
  discountValue: 10,
  target: 'All',
  targetId: '',
  startDate: todayIso(),
  endDate: plusDaysIso(30),
}

/** Kampanya yönetimi (4C) — indirim tanımla, listele, sil. marketing.campaigns ile kapılı. */
export default function CampaignPanel({ tenantId }: { tenantId?: string }) {
  const canCampaigns = useFeature('marketing.campaigns')
  const [form, setForm] = useState<CampaignForm>(emptyForm)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { data, reload } = useApiQuery<{ campaigns: ApiCampaign[]; services: ApiService[]; packages: ApiServicePackage[] }>(
    async () => {
      if (!tenantId || !canCampaigns) return { campaigns: [], services: [], packages: [] }
      const [campaigns, services, packages] = await Promise.all([
        adminApi.campaigns<ApiCampaign>({ tenantId }).catch(() => []),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
      ])
      return { campaigns: Array.isArray(campaigns) ? campaigns : [], services: apiItems(services), packages: apiItems(packages) }
    },
    [tenantId, canCampaigns],
    { initialData: { campaigns: [], services: [], packages: [] } },
  )

  const campaigns = useMemo(() => (data?.campaigns || []).map((c, i) => normalizeCampaign(c, i)), [data])
  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])

  if (!canCampaigns) return null

  const targetName = (t: CampaignTargetKey, id: string | null) => {
    if (t === 'Service') return services.find((s) => s.id === id)?.name || 'Hizmet'
    if (t === 'Package') return packages.find((p) => p.id === id)?.name || 'Paket'
    return 'Tümü'
  }

  const submit = async () => {
    setError('')
    if (!form.name.trim()) { setError('Kampanya adı gerekli'); return }
    if (form.discountValue <= 0) { setError('İndirim değeri pozitif olmalı'); return }
    if (form.target !== 'All' && !form.targetId) { setError('Hedef hizmet/paket seçin'); return }
    setBusy(true)
    try {
      await adminApi.createCampaign({
        branchId: null,
        name: form.name.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        target: form.target,
        targetId: form.target === 'All' ? null : form.targetId,
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: true,
      }, tenantId)
      setForm(emptyForm)
      setOpen(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kampanya oluşturulamadı')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await adminApi.deleteCampaign(id, tenantId)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="kampanyalar" className="rounded-[22px] border border-[#ead8df]/70 bg-white/86 p-5 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <Megaphone className="h-4 w-4" /> Kampanyalar
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#c85776] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Kampanya oluştur
        </button>
      </div>

      {error && <div className="mb-2 rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>}

      {open && (
        <div className="mb-4 grid gap-2.5 rounded-[16px] border border-[#f0e0e6] bg-[#fffafb] p-3 sm:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Kampanya adı (örn. Yaz İndirimi)"
            className="col-span-full rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
          />
          <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountTypeKey })} className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
            <option value="Percent">Yüzde (%)</option>
            <option value="Amount">Tutar (₺)</option>
          </select>
          <input
            type="number"
            min={1}
            value={form.discountValue || ''}
            onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
            placeholder={form.discountType === 'Percent' ? 'Yüzde' : 'Tutar'}
            className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
          />
          <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value as CampaignTargetKey, targetId: '' })} className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
            {(Object.keys(TARGET_LABELS) as CampaignTargetKey[]).map((t) => <option key={t} value={t}>{TARGET_LABELS[t]}</option>)}
          </select>
          {form.target !== 'All' ? (
            <select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]">
              <option value="">{form.target === 'Service' ? 'Hizmet seç…' : 'Paket seç…'}</option>
              {(form.target === 'Service' ? services.map((s) => ({ id: s.id, name: s.name })) : packages.map((p) => ({ id: p.id, name: p.name }))).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          ) : <div />}
          <label className="flex flex-col text-[9px] font-mono uppercase tracking-wide text-[#352432]/45">
            Başlangıç
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-0.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]" />
          </label>
          <label className="flex flex-col text-[9px] font-mono uppercase tracking-wide text-[#352432]/45">
            Bitiş
            <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-0.5 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]" />
          </label>
          <button type="button" disabled={busy} onClick={submit} className="col-span-full rounded-[10px] bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            Kampanyayı kaydet
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {campaigns.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center text-[12px] text-[#352432]/45">
            Henüz kampanya yok. "Kampanya oluştur" ile indirim tanımlayın.
          </div>
        )}
        {campaigns.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-[#f0e0e6] bg-white px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]">
                <Tag className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-[#352432]">{c.name}</span>
                  {c.isRunning ? (
                    <span className="rounded-full border border-emerald-300/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wide text-emerald-700">Aktif</span>
                  ) : (
                    <span className="rounded-full border border-[#ead8df] bg-[#fff4f8]/60 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wide text-[#352432]/45">Pasif</span>
                  )}
                </div>
                <div className="truncate text-[10px] font-mono text-[#352432]/45">
                  {c.discountType === 'Percent' ? `%${c.discountValue}` : formatTL(c.discountValue)} · {targetName(c.target, c.targetId)} · {c.startDate} → {c.endDate}
                </div>
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => remove(c.id)} className="text-[#352432]/30 transition-colors hover:text-rose-600 disabled:opacity-40" aria-label="Kampanyayı sil">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
