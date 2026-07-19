'use client'

import { useState } from 'react'
import { CalendarPlus, Check, Copy, Loader2, X } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'

/**
 * Personel ICS takvim aboneliği — Google Takvim / Apple Takvim / Outlook'un
 * "URL ile abone ol" özelliğiyle personelin randevuları kendi telefonundaki
 * takvimde canlı görünür. Link sunucu sırrından türetilen token'lıdır.
 */
export default function StaffCalendarLinkButton({
  staffId,
  staffName,
  tenantId,
}: {
  staffId: string
  staffName: string
  tenantId?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = async (): Promise<void> => {
    setOpen(true)
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.staffCalendarLink<{ url?: string }>(staffId, tenantId)
      setUrl(res?.url || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link alınamadı.')
    } finally {
      setLoading(false)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // pano izni yoksa kullanıcı metni elle seçebilir
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void load()}
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3.5 py-2 text-[11px] font-medium text-[#352432]/80 transition-colors hover:border-[#efbfd0] hover:text-[#352432]"
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Takvim Aboneliği
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-[18px] border border-[#efe1e7] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-lg text-[#241923]">Takvim Aboneliği</div>
                <div className="mt-0.5 text-[11.5px] text-[#705a66]">{staffName} · randevular Google/Apple takvimde canlı görünür</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-full text-[#705a66] hover:bg-[#f7ecf1]" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>
            {loading ? (
              <div className="grid h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#c85776]" /></div>
            ) : error ? (
              <div className="mt-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
            ) : (
              <>
                <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#efe1e7] bg-[#fffafc] px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-[11px] text-[#4a3a44]">{url}</code>
                  <button type="button" onClick={() => void copy()}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#efe1e7] text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776]" title="Kopyala">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-[#705a66]">
                  <div><strong className="text-[#4a3a44]">Google Takvim:</strong> Ayarlar → Takvim ekle → <em>URL ile</em> → linki yapıştır.</div>
                  <div><strong className="text-[#4a3a44]">iPhone/Apple:</strong> Ayarlar → Takvim → Hesaplar → Takvim Aboneliği ekle.</div>
                  <div><strong className="text-[#4a3a44]">Outlook:</strong> Takvim ekle → İnternetten abone ol.</div>
                  <div className="pt-1 text-[10.5px] text-[#9d7386]">Takvim uygulamaları beslemeyi birkaç saatte bir yeniler. Linki yalnızca ilgili personelle paylaşın.</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
