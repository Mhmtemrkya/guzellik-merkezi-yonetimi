'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Download, FileText, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { useBranch } from '@/components/dashboard/BranchContext'
import { adminApi } from '@/lib/apiClient'
import { DEFAULT_KVKK_TEXT, kvkkEditorInitial, resolveKvkkText } from '@/lib/kvkkDefault'
import { generateKvkkPdf } from '@/lib/kvkkPdf'

interface PublicProfileLite {
  kvkkConsentText?: string | null
  logoData?: string | null
}

/**
 * Ayarlar sayfasında KVKK aydınlatma metnini düzenleme kartı. Kurum yöneticisi metni
 * özelleştirebilir; boş bırakılıp "Varsayılana dön" ile yerleşik metne dönebilir.
 * {KURUM} yer tutucusu PDF/görüntülemede kurum adına dönüşür. PDF önizleme/indirme mevcut.
 */
export default function KvkkSettingsCard({ tenantId }: { tenantId?: string }) {
  const { selectedInstitution } = useBranch()
  const institutionName = selectedInstitution?.name || 'Kurum'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [logoData, setLogoData] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [isCustom, setIsCustom] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminApi
      .publicProfile<PublicProfileLite>()
      .then((p) => {
        if (cancelled) return
        setLogoData(p?.logoData ?? null)
        setIsCustom(!!(p?.kvkkConsentText && p.kvkkConsentText.trim().length > 0))
        setText(kvkkEditorInitial(p?.kvkkConsentText))
      })
      .catch(() => { if (!cancelled) setText(DEFAULT_KVKK_TEXT) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenantId])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // Varsayılanla birebir aynıysa özel metin saklamayalım (null = varsayılana dön).
      const payload = text.trim() === DEFAULT_KVKK_TEXT.trim() ? null : text
      await adminApi.setKvkkText(payload)
      setIsCustom(!!payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Metin kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = (): void => {
    setText(DEFAULT_KVKK_TEXT)
    setSaved(false)
  }

  const previewPdf = (): void => {
    generateKvkkPdf({ institutionName, text: resolveKvkkText(text, institutionName), logoData })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/75">
            <ShieldCheck className="h-4 w-4" /> KVKK Aydınlatma Metni
          </div>
          <h3 className="mt-2 font-display text-2xl tracking-tight">Yasal Metin</h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[#352432]/55">
            Yeni müşteri ekleme ekranında gösterilen KVKK aydınlatma metni. <code className="rounded bg-[#fff1f6] px-1 text-[#c85776]">{'{KURUM}'}</code> yazdığınız yere kurum adı otomatik yerleşir.
            {isCustom ? ' Şu an özel metin kullanılıyor.' : ' Şu an yerleşik varsayılan metin kullanılıyor.'}
          </p>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[#fff1f6] text-[#c85776]">
          <FileText className="h-5 w-5" />
        </span>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center gap-2 py-10 text-[13px] text-[#9d7386]">
          <Loader2 className="h-4 w-4 animate-spin" /> Metin yükleniyor…
        </div>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setSaved(false) }}
            rows={14}
            spellCheck={false}
            className="mt-5 w-full resize-y rounded-[14px] border border-[#ead8df] bg-[#fffafc] p-4 text-[12px] leading-relaxed text-[#352432] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
          />

          {error && (
            <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{error}</div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-5 py-2.5 text-[12px] font-semibold text-white shadow-[0_15px_26px_-15px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-70"
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Kaydediliyor</> : saved ? <><CheckCircle2 className="h-4 w-4" /> Kaydedildi</> : <><Save className="h-4 w-4" /> Metni kaydet</>}
            </button>
            <button
              type="button"
              onClick={previewPdf}
              className="inline-flex items-center gap-2 rounded-[12px] border border-[#efbfd0]/75 bg-[#fff1f6] px-4 py-2.5 text-[12px] font-semibold text-[#c85776] transition-colors hover:bg-[#ffe6ef]"
            >
              <Download className="h-4 w-4" /> PDF önizle / indir
            </button>
            <button
              type="button"
              onClick={resetToDefault}
              className="inline-flex items-center gap-2 rounded-[12px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]"
            >
              <RotateCcw className="h-4 w-4" /> Varsayılana dön
            </button>
          </div>
        </>
      )}
    </motion.div>
  )
}
