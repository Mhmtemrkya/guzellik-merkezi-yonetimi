'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, FileSignature, Loader2, Plus, X } from 'lucide-react'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import type { ApiConsentTemplate } from '@/lib/types'

/** Yeni form açarken kullanılan iskelet — boş sayfa yerine doldurulabilir taslak. */
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

/**
 * Hizmet/paket formlarında kullanılan onam formu seçici.
 *
 * "Onam formu istensin mi?" anahtarı açılınca kurumun kayıtlı formları çip olarak listelenir;
 * aynı yerden **yeni form da oluşturulabilir** (Ayarlar'a gitmeden). Yeni form oluşturulunca
 * seçime otomatik eklenir.
 *
 * NOT: Seçim burada KAYDEDİLMEZ; sahibi form (hizmet/paket) kaydedilirken şablonların
 * hizmet/paket bağı güncellenir — bağ şablon kaydında durur.
 */
export default function ConsentPicker({
  value,
  onChange,
  tenantId,
  label = 'Onam formu istensin mi?',
  hint,
  compact = false,
}: {
  value: string[]
  onChange: (next: string[]) => void
  tenantId?: string
  label?: string
  hint?: string
  /** Paket düzenleyicisi gibi dar alanlarda daha sıkı yerleşim. */
  compact?: boolean
}) {
  const allowed = useFeature('clinical.consentforms')
  const [enabled, setEnabled] = useState(value.length > 0)
  const [templates, setTemplates] = useState<ApiConsentTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState(STARTER_BODY)
  const [newItems, setNewItems] = useState<string[]>([...STARTER_ITEMS])
  const [newItemDraft, setNewItemDraft] = useState('')

  // Dışarıdan seçim gelirse (düzenleme modunda kayıt yüklenince) anahtarı aç.
  useEffect(() => { if (value.length > 0) setEnabled(true) }, [value.length])

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    try {
      const list = await adminApi.consentTemplates<ApiConsentTemplate>(tenantId)
      setTemplates((Array.isArray(list) ? list : []).filter((t) => t.isActive !== false))
    } catch {
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [tenantId, allowed])

  useEffect(() => { if (enabled) void load() }, [enabled, load])

  if (!allowed) return null

  const toggle = (id: string): void =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  const create = async (): Promise<void> => {
    const title = newTitle.trim()
    if (!title) { setError('Form başlığı zorunlu.'); return }
    setBusy(true)
    setError('')
    try {
      const created = await adminApi.createConsentTemplate<ApiConsentTemplate>({
        title,
        body: newBody.trim() || STARTER_BODY,
        checkItems: newItems,
        requiresSignature: true,
        isActive: true,
        serviceIds: [],
        packageIds: [],
      }, tenantId)
      await load()
      if (created?.id) onChange([...value, created.id])
      setCreating(false)
      setNewTitle('')
      setNewBody(STARTER_BODY)
      setNewItems([...STARTER_ITEMS])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Form oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? '' : 'flex flex-col gap-2'}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked)
            if (!e.target.checked) { onChange([]); setCreating(false) }
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#c85776]"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#241923]">
            <FileSignature className="h-4 w-4 text-[#c85776]" /> {label}
          </span>
          <span className="mt-0.5 block text-[12px] text-[#705a66]">
            {hint || 'Seçilen formlar, bu kalemi alan müşteride imzalanana kadar uyarı olarak görünür.'}
          </span>
        </span>
      </label>

      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 rounded-[14px] border border-[#efbfd0]/70 bg-[#fff8fa] p-3.5">
              {loading ? (
                <div className="flex items-center gap-2 py-2 text-[12.5px] text-[#705a66]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Formlar yükleniyor…
                </div>
              ) : (
                <>
                  {templates.length === 0 ? (
                    <div className="text-[12.5px] text-[#705a66]">
                      Kayıtlı onam formu yok. Aşağıdan hemen oluşturabilirsiniz.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((t) => {
                        const on = value.includes(t.id || '')
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggle(t.id || '')}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                              on
                                ? 'border-[#c85776] bg-[#c85776] text-white'
                                : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0] hover:text-[#c85776]'
                            }`}
                          >
                            {on && <CheckCircle2 className="h-3.5 w-3.5" />}
                            {t.title}
                            {t.requiresSignature === false && (
                              <span className={`text-[11px] ${on ? 'text-white/75' : 'text-[#705a66]'}`}>· imzasız</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!creating ? (
                    <button
                      type="button"
                      onClick={() => { setCreating(true); setError('') }}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[#efbfd0] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#c85776] transition-colors hover:bg-[#fff1f6]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Yeni onam formu oluştur
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2.5 rounded-[12px] border border-[#ead8df] bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-[#241923]">Yeni onam formu</span>
                        <button type="button" onClick={() => setCreating(false)}
                          className="grid h-6 w-6 place-items-center rounded-md text-[#705a66] hover:bg-[#fff1f6] hover:text-[#c85776]">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Form başlığı — örn. Lazer Epilasyon Onay Formu"
                        className="w-full rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#c85776]"
                      />
                      <textarea
                        value={newBody}
                        onChange={(e) => setNewBody(e.target.value)}
                        rows={7}
                        className="w-full rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#c85776]"
                      />
                      <div>
                        <div className="text-[12px] font-semibold text-[#241923]">Onay maddeleri</div>
                        <div className="mt-1.5 space-y-1.5">
                          {newItems.map((item, i) => (
                            <div key={`${item}-${i}`} className="flex items-center gap-2 rounded-[9px] border border-[#ead8df] bg-white px-2.5 py-1.5">
                              <span className="h-3 w-3 shrink-0 rounded-[3px] border-2 border-[#dcc2ce]" />
                              <span className="min-w-0 flex-1 truncate text-[12px] text-[#4a3a44]">{item}</span>
                              <button type="button" onClick={() => setNewItems(newItems.filter((_, x) => x !== i))}
                                className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#705a66] hover:bg-rose-50 hover:text-rose-600">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-1.5">
                            <input
                              value={newItemDraft}
                              onChange={(e) => setNewItemDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const v = newItemDraft.trim()
                                  if (v) { setNewItems([...newItems, v]); setNewItemDraft('') }
                                }
                              }}
                              placeholder="Yeni onay maddesi…"
                              className="min-w-0 flex-1 rounded-[9px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
                            />
                            <button
                              type="button"
                              onClick={() => { const v = newItemDraft.trim(); if (v) { setNewItems([...newItems, v]); setNewItemDraft('') } }}
                              disabled={!newItemDraft.trim()}
                              className="rounded-[9px] border border-[#efbfd0] bg-[#fff1f6] px-2.5 py-1.5 text-[12px] font-semibold text-[#b14d6c] disabled:opacity-50"
                            >
                              Ekle
                            </button>
                          </div>
                        </div>
                      </div>
                      {error && <div className="text-[12px] font-medium text-rose-600">{error}</div>}
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setCreating(false)}
                          className="rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] font-medium text-[#4a3a44] hover:bg-[#fff4f8]">
                          Vazgeç
                        </button>
                        <button type="button" disabled={busy || !newTitle.trim()} onClick={create}
                          className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-4 py-2 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Oluştur ve seç
                        </button>
                      </div>
                      <p className="text-[11.5px] text-[#705a66]">
                        Metinde {'{{musteri}}'} {'{{hizmet}}'} {'{{tarih}}'} {'{{kurum}}'} {'{{personel}}'} yer tutucuları
                        gerçek değerlerle dolar. Ayrıntılı düzenleme için Ayarlar › Onam Formları.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
