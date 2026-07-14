'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImagePlus, Images, Loader2, Trash2, X } from 'lucide-react'
import { platformApi } from '@/lib/apiClient'
import { downscaleImage } from '@/lib/imageUtils'

interface GalleryPhoto {
  id: string
  kind: string
  imageData: string
  caption: string | null
  sortOrder: number
}

const KINDS = [
  { value: 'Slider', label: 'Vitrin (Slider)', maxSize: 1280 },
  { value: 'Service', label: 'Hizmet Galerisi', maxSize: 960 },
] as const

/**
 * Platform admin: kurumun herkese açık vitrin görsellerini yönetir
 * (kurum eklendikten sonra profil fotoğrafları buradan yüklenir).
 */
export default function TenantGalleryDialog({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('Slider')
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = async (): Promise<void> => {
    try {
      setPhotos(await platformApi.tenantGallery<GalleryPhoto>(tenantId))
    } catch {
      setPhotos([])
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const upload = async (file: File): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const meta = KINDS.find((k) => k.value === kind)!
      const dataUrl = await downscaleImage(file, meta.maxSize)
      await platformApi.addTenantGalleryPhoto(tenantId, { kind, imageData: dataUrl })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (photoId: string): Promise<void> => {
    setBusy(true)
    try {
      await platformApi.deleteTenantGalleryPhoto(tenantId, photoId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  const list = photos.filter((p) => p.kind === kind)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white/70 px-2 py-2 text-[9px] font-mono tracking-widest text-[#7c6170] transition-colors hover:border-[#efbfd0] hover:bg-[#fff1f6] hover:text-[#3b2330]"
      >
        <Images className="h-3 w-3" /> GÖRSELLER
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[#4a2335]/25 px-4 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl overflow-hidden rounded-[24px] border border-[#ead8df] bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[#ead8df]/70 px-5 py-4">
                <div>
                  <div className="text-[14px] font-bold text-[#352432]">{tenantName} · Vitrin Görselleri</div>
                  <div className="mt-0.5 text-[11px] text-[#7c6170]">
                    Herkese açık salon sayfasında görünen fotoğraflar (tür başına en fazla 10).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Kapat"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-[#ead8df] text-[#9d7386] hover:text-[#c85776]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 px-5 pt-4">
                <div className="flex gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKind(k.value)}
                      className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        kind === k.value
                          ? 'bg-gradient-to-r from-[#ef6f94] to-[#d65f83] text-white'
                          : 'bg-[#fff4f8] text-[#7c6170] hover:text-[#c85776]'
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy || list.length >= 10}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#efbfd0] bg-white px-3.5 text-[11px] font-semibold text-[#c85776] transition-colors hover:border-[#ef9ab5] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  Fotoğraf Ekle
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void upload(f)
                  }}
                />
              </div>

              {error && <div className="mx-5 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}

              <div className="max-h-[50vh] overflow-y-auto p-5">
                {list.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#ead8df] px-4 py-10 text-center text-[12px] text-[#9d7386]">
                    Bu galeride henüz fotoğraf yok.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {list.map((p) => (
                      <div key={p.id} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.imageData} alt={p.caption || 'Vitrin fotoğrafı'} className="h-28 w-40 rounded-[14px] object-cover" />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(p.id)}
                          aria-label="Fotoğrafı sil"
                          className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-rose-600 opacity-0 shadow transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
