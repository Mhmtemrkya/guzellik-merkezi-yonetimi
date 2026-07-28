'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check, Download, FileSignature, Loader2, Plus, Save, Trash2, X,
} from 'lucide-react'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, guidOrUndefined, normalizeService } from '@/lib/apiMappers'
import { generateConsentPdf, fillConsentPlaceholders } from '@/lib/consentPdf'
import type { ApiConsentTemplate, ApiService } from '@/lib/types'

interface PublicProfileLite { logoData?: string | null }

/** Yeni form açarken kullanılan iskelet — boş sayfa yerine doldurulabilir bir taslak. */
const STARTER_BODY = `Sayın {{musteri}},

{{kurum}} bünyesinde tarafınıza uygulanacak {{hizmet}} işlemi hakkında aşağıdaki bilgilendirme yapılmıştır.

1. İŞLEMİN TANIMI
İşlemin nasıl uygulanacağı, süresi ve beklenen sonuçları tarafıma anlatılmıştır.

2. OLASI YAN ETKİLER
İşlem sonrası geçici kızarıklık, hassasiyet ve ödem görülebileceği bilgisi tarafıma verilmiştir.

3. UYGULAMA ÖNCESİ BEYANIM
Kullandığım ilaçlar, alerjilerim ve kronik rahatsızlıklarım hakkında doğru bilgi verdiğimi beyan ederim.

4. UYGULAMA SONRASI BAKIM
İşlem sonrası uyulması gereken bakım önerileri tarafıma anlatılmıştır.

Tarih: {{tarih}}`

const STARTER_ITEMS = [
  'Bilgilendirme metnini okudum ve anladım.',
  'Sorularımı sordum, tatmin edici yanıt aldım.',
  'Beyanlarımın doğru olduğunu kabul ediyorum.',
  'İşlemin uygulanmasına onay veriyorum.',
]

interface Draft {
  id: string | null
  title: string
  body: string
  checkItems: string[]
  requiresSignature: boolean
  isActive: boolean
  serviceIds: string[]
}

const emptyDraft = (): Draft => ({
  id: null, title: '', body: STARTER_BODY, checkItems: [...STARTER_ITEMS],
  requiresSignature: true, isActive: true, serviceIds: [],
})

/**
 * Ayarlar sayfasında onam formu şablonlarını yöneten kart.
 *
 * Şablon = kurumun yazdığı metin + müşterinin işaretleyeceği onay maddeleri + hangi
 * hizmetlerde zorunlu olduğu. Randevu "Tamamlandı" yapılırken bu bağa bakılır.
 * Metinde {{musteri}} {{hizmet}} {{tarih}} {{kurum}} {{personel}} yer tutucuları kullanılabilir.
 */
export default function ConsentTemplatesCard({ tenantId }: { tenantId?: string }) {
  const { selectedInstitution, selectedInstitutionId } = useBranch()
  // Paket kapısı: özellik kapalıysa kart hiç çizilmez (uçlar da 409 döner).
  const allowed = useFeature('clinical.consentforms')
  const resolvedTenantId = tenantId || guidOrUndefined(selectedInstitutionId)
  const institutionName = selectedInstitution?.name || 'Kurum'

  const [templates, setTemplates] = useState<ApiConsentTemplate[]>([])
  const [services, setServices] = useState<{ id: string; name: string; group: string }[]>([])
  const [logo, setLogo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newItem, setNewItem] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!allowed) { setLoading(false); return }
    setLoading(true)
    try {
      const [tpl, svc] = await Promise.all([
        adminApi.consentTemplates<ApiConsentTemplate>(resolvedTenantId),
        adminApi.services<ApiService>({ tenantId: resolvedTenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
      ])
      setTemplates(Array.isArray(tpl) ? tpl : [])
      setServices(apiItems(svc).map((s, i) => {
        const n = normalizeService(s, i)
        return { id: n.id, name: n.name, group: (s?.category || '').trim() || 'Kategorisiz' }
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onam formları yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [resolvedTenantId, allowed])

  useEffect(() => {
    void load()
    adminApi.publicProfile<PublicProfileLite>().then((p) => setLogo(p?.logoData || null)).catch(() => setLogo(null))
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>()
    for (const s of services) {
      if (!map.has(s.group)) map.set(s.group, [])
      map.get(s.group)!.push({ id: s.id, name: s.name })
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'))
  }, [services])

  const startNew = (): void => { setDraft(emptyDraft()); setError(''); setSaved(false) }
  const startEdit = (t: ApiConsentTemplate): void => {
    setDraft({
      id: t.id || null,
      title: t.title || '',
      body: t.body || '',
      checkItems: [...(t.checkItems || [])],
      requiresSignature: t.requiresSignature !== false,
      isActive: t.isActive !== false,
      serviceIds: [...(t.serviceIds || [])],
    })
    setError('')
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    if (!draft.title.trim()) { setError('Form başlığı zorunlu.'); return }
    if (!draft.body.trim()) { setError('Form metni zorunlu.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        checkItems: draft.checkItems,
        requiresSignature: draft.requiresSignature,
        isActive: draft.isActive,
        serviceIds: draft.serviceIds,
      }
      if (draft.id) await adminApi.updateConsentTemplate(draft.id, payload, resolvedTenantId)
      else await adminApi.createConsentTemplate(payload, resolvedTenantId)
      setSaved(true)
      setDraft(null)
      await load()
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await adminApi.deleteConsentTemplate(id, resolvedTenantId)
      if (draft?.id === id) setDraft(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Silinemedi.')
    } finally {
      setSaving(false)
    }
  }

  const preview = (t: ApiConsentTemplate | Draft): void => {
    generateConsentPdf({
      institutionName,
      logoData: logo,
      title: t.title || 'Onam Formu',
      body: fillConsentPlaceholders(t.body || '', { institutionName }),
      checkItems: t.checkItems,
    })
  }

  const toggleService = (id: string): void =>
    setDraft((d) => (d ? { ...d, serviceIds: d.serviceIds.includes(id) ? d.serviceIds.filter((x) => x !== id) : [...d.serviceIds, id] } : d))

  const addItem = (): void => {
    const value = newItem.trim()
    if (!value || !draft) return
    setDraft({ ...draft, checkItems: [...draft.checkItems, value] })
    setNewItem('')
  }

  if (!allowed) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#fff1f6] text-[#c85776]"><FileSignature className="h-5 w-5" /></span>
          <div>
            <div className="font-display text-xl tracking-tight text-[#352432]">Onam Formları</div>
            <div className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-[#705a66]">
              Hizmetlere bağladığınız onam formları, randevu “Tamamlandı” yapılırken imzalı mı diye kontrol edilir.
              Müşteri formu tabletten okuyup imzalar; imzalı belge logolu PDF olarak dosyasına eklenir.
            </div>
          </div>
        </div>
        {!draft && (
          <button type="button" onClick={startNew}
            className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#c85776] px-4 py-2.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90">
            <Plus className="h-4 w-4" /> Yeni form
          </button>
        )}
      </div>

      {error && <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] font-medium text-rose-700">{error}</div>}
      {saved && (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-[12px] border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-[12.5px] font-semibold text-emerald-700">
          <Check className="h-4 w-4" /> Kaydedildi
        </div>
      )}

      {/* Liste */}
      {!draft && (
        loading ? (
          <div className="grid place-items-center py-12 text-[#705a66]"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : templates.length === 0 ? (
          <div className="mt-5 rounded-[16px] border border-dashed border-[#ead8df] bg-[#fffafc] px-5 py-12 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#fff1f6] text-[#c85776]"><FileSignature className="h-6 w-6" /></span>
            <div className="mt-3 text-[13.5px] font-semibold text-[#352432]">Henüz onam formu yok</div>
            <div className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-[#705a66]">
              “Yeni form” ile hazır iskeletten başlayın; metni kendinize göre düzenleyip hangi hizmetlerde
              zorunlu olacağını seçin.
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {templates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#ead8df] bg-white p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#352432]">{t.title}</span>
                    {t.isActive === false && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Pasif</span>}
                    {t.requiresSignature === false && <span className="rounded-md bg-[#fff1f6] px-2 py-0.5 text-[11px] font-semibold text-[#b14d6c]">İmzasız</span>}
                  </div>
                  <div className="mt-1 text-[12px] text-[#705a66]">
                    {(t.checkItems?.length ?? 0)} onay maddesi ·{' '}
                    {(t.serviceNames?.length ?? 0) > 0 ? `Hizmetler: ${t.serviceNames!.join(', ')}` : 'Hiçbir hizmete bağlı değil'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => preview(t)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                    <Download className="h-3.5 w-3.5" /> Önizle
                  </button>
                  <button type="button" onClick={() => startEdit(t)}
                    className="rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12px] font-semibold text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
                    Düzenle
                  </button>
                  <button type="button" disabled={saving} onClick={() => void remove(t.id!)} title="Formu sil"
                    className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#f3dde5] bg-white text-[#b09ca5] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Düzenleyici */}
      {draft && (
        <div className="mt-5 space-y-4 rounded-[18px] border border-[#efbfd0]/70 bg-[#fffafc] p-5">
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div>
              <label className="text-[12px] font-semibold text-[#4a3a44]">Form başlığı</label>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Güzellik Uygulaması Onay Formu"
                className="mt-1.5 w-full rounded-[12px] border border-[#ead8df] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[#c85776]"
              />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#4a3a44]">
                <input type="checkbox" checked={draft.requiresSignature} onChange={(e) => setDraft({ ...draft, requiresSignature: e.target.checked })} className="h-4 w-4 accent-[#c85776]" />
                İmza zorunlu
              </label>
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#4a3a44]">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="h-4 w-4 accent-[#c85776]" />
                Aktif
              </label>
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-[#4a3a44]">Form metni</label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={14}
              className="mt-1.5 w-full rounded-[12px] border border-[#ead8df] bg-white px-3.5 py-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-[#c85776]"
            />
            <p className="mt-1.5 text-[11.5px] text-[#705a66]">
              Yer tutucular: <code className="rounded bg-white px-1">{'{{musteri}}'}</code>{' '}
              <code className="rounded bg-white px-1">{'{{hizmet}}'}</code>{' '}
              <code className="rounded bg-white px-1">{'{{tarih}}'}</code>{' '}
              <code className="rounded bg-white px-1">{'{{kurum}}'}</code>{' '}
              <code className="rounded bg-white px-1">{'{{personel}}'}</code> — form açılırken gerçek değerlerle dolar.
            </p>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-[#4a3a44]">Onay maddeleri <span className="font-normal text-[#705a66]">(müşteri tablette tek tek işaretler)</span></label>
            <div className="mt-2 space-y-1.5">
              {draft.checkItems.map((item, index) => (
                <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] border-2 border-[#dcc2ce]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#4a3a44]">{item}</span>
                  <button type="button" onClick={() => setDraft({ ...draft, checkItems: draft.checkItems.filter((_, i) => i !== index) })}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#705a66] hover:bg-rose-50 hover:text-rose-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
                  placeholder="Yeni onay maddesi…"
                  className="min-w-0 flex-1 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#c85776]"
                />
                <button type="button" onClick={addItem} disabled={!newItem.trim()}
                  className="inline-flex items-center gap-1 rounded-[10px] border border-[#efbfd0] bg-[#fff1f6] px-3 py-2 text-[12.5px] font-semibold text-[#b14d6c] disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" /> Ekle
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-[#4a3a44]">
              Bu form hangi hizmetlerde zorunlu? <span className="font-normal text-[#705a66]">({draft.serviceIds.length} seçili)</span>
            </label>
            <div className="mt-2 max-h-52 space-y-3 overflow-y-auto rounded-[12px] border border-[#ead8df] bg-white p-3">
              {grouped.length === 0 && <div className="py-6 text-center text-[12.5px] text-[#705a66]">Hizmet kaydı yok.</div>}
              {grouped.map(([group, list]) => (
                <div key={group}>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-[#b14d6c]">{group}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {list.map((s) => {
                      const on = draft.serviceIds.includes(s.id)
                      return (
                        <button key={s.id} type="button" onClick={() => toggleService(s.id)}
                          className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            on ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0] hover:text-[#c85776]'
                          }`}>
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => preview(draft)}
              className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12.5px] font-medium text-[#4a3a44] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]">
              <Download className="h-4 w-4" /> PDF önizle
            </button>
            <button type="button" onClick={() => setDraft(null)}
              className="rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12.5px] font-medium text-[#4a3a44] hover:bg-[#fff4f8]">
              Vazgeç
            </button>
            <button type="button" disabled={saving} onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#c85776] px-5 py-2.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Kaydet
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}
