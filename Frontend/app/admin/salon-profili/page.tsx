'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { downscaleImage } from '@/lib/imageUtils'
import {
  Building2,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Images,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  Trash2,
} from 'lucide-react'

interface PublicProfile {
  isPublished: boolean
  logoData?: string | null
  description: string | null
  address: string | null
  city: string | null
  instagram: string | null
  publicEmail: string | null
  publicPhone: string | null
  workingHoursText: string | null
  mapUrl: string | null
}

interface GalleryPhoto {
  id: string
  kind: string
  imageData: string
  caption: string | null
  sortOrder: number
}

const inputCls =
  'min-h-11 w-full rounded-xl border border-[#ead8df] bg-white px-3.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#e798b4]'
const labelCls = 'mb-1.5 block text-[11px] font-semibold text-[#7c6170]'

function LogoUploader({ logo, onChanged }: { logo: string | null; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      // Logo kare karoda görünür — 512px yeterli, DB'yi şişirmez.
      const dataUrl = await downscaleImage(file, 512)
      await adminApi.setSalonLogo(dataUrl)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo yüklenemedi.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await adminApi.setSalonLogo(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo kaldırılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[22px] border border-[#ead8df] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#352432]">
        <ImagePlus className="h-4 w-4 text-[#c85776]" /> Kurum Logosu
      </h2>
      <p className="mt-1 text-[11.5px] text-[#7c6170]">
        Salon sayfanızda kapak fotoğrafının üzerindeki kare karoda görünür. Kare (1:1) bir görsel yükleyin.
      </p>
      <div className="mt-4 flex items-center gap-4">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[18px] border-2 border-[#f0d9e2] bg-gradient-to-b from-[#fff1f6] to-[#fbdce8]">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Kurum logosu" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] font-semibold text-[#b58ea0]">Logo yok</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-gradient-to-r from-[#ef6f94] to-[#d65f83] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {logo ? 'Logoyu Değiştir' : 'Logo Yükle'}
          </button>
          {logo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 text-[11.5px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Kaldır
            </button>
          )}
        </div>
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
      {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
    </div>
  )
}

function GalleryManager({
  title,
  hint,
  kind,
  photos,
  onChanged,
  maxSize,
}: {
  title: string
  hint: string
  kind: 'Slider' | 'Service'
  photos: GalleryPhoto[]
  onChanged: () => void
  maxSize: number
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = photos.filter((p) => p.kind === kind)

  const upload = async (file: File): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const dataUrl = await downscaleImage(file, maxSize)
      await adminApi.addGalleryPhoto({ kind, imageData: dataUrl })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await adminApi.deleteGalleryPhoto(id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[22px] border border-[#ead8df] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#352432]">
            <Images className="h-4 w-4 text-[#c85776]" /> {title}
          </h2>
          <p className="mt-1 text-[11.5px] text-[#7c6170]">{hint}</p>
        </div>
        <button
          type="button"
          disabled={busy || list.length >= 10}
          onClick={() => fileRef.current?.click()}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-[#ef6f94] to-[#d65f83] px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
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
      {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}
      <div className="mt-4 flex flex-wrap gap-3">
        {list.length === 0 && (
          <div className="w-full rounded-xl border border-dashed border-[#ead8df] px-4 py-8 text-center text-[12px] text-[#9d7386]">
            Henüz fotoğraf yok. En fazla 10 fotoğraf ekleyebilirsiniz.
          </div>
        )}
        {list.map((p) => (
          <div key={p.id} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.imageData} alt={p.caption || title} className="h-28 w-40 rounded-[14px] object-cover" />
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
    </div>
  )
}

export default function SalonProfiliPage() {
  const [form, setForm] = useState<PublicProfile>({
    isPublished: false,
    description: '',
    address: '',
    city: '',
    instagram: '',
    publicEmail: '',
    publicPhone: '',
    workingHoursText: '',
    mapUrl: '',
  })
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const { data: profileData, reload: reloadProfile } = useApiQuery<PublicProfile | null>(
    async () => adminApi.publicProfile<PublicProfile>().catch(() => null),
    [],
    { initialData: null },
  )
  const { data: photosData, reload: reloadPhotos } = useApiQuery<GalleryPhoto[]>(
    async () => adminApi.galleryPhotos<GalleryPhoto>().catch(() => []),
    [],
    { initialData: [] },
  )

  useEffect(() => {
    if (profileData) {
      setForm({
        isPublished: profileData.isPublished,
        description: profileData.description ?? '',
        address: profileData.address ?? '',
        city: profileData.city ?? '',
        instagram: profileData.instagram ?? '',
        publicEmail: profileData.publicEmail ?? '',
        publicPhone: profileData.publicPhone ?? '',
        workingHoursText: profileData.workingHoursText ?? '',
        mapUrl: profileData.mapUrl ?? '',
      })
    }
  }, [profileData])

  // Vitrin linki için kurum slug'ı
  useEffect(() => {
    void adminApi
      .currentTenant<{ slug?: string }>()
      .then((t) => {
        if (t?.slug) setSlug(t.slug)
      })
      .catch(() => {})
  }, [])

  const set = (key: keyof PublicProfile, value: string | boolean): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const save = async (): Promise<void> => {
    setMessage(null)
    setSaving(true)
    try {
      await adminApi.savePublicProfile(form as unknown as Record<string, unknown>)
      setMessage({
        ok: true,
        text: form.isPublished
          ? 'Profil kaydedildi — salonunuz artık herkese açık listede yayında!'
          : 'Profil kaydedildi. Yayınla anahtarını açtığınızda listede görünür.',
      })
      void reloadProfile()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Profil kaydedilemedi.' })
    } finally {
      setSaving(false)
    }
  }

  const photos = photosData || []

  return (
    <>
      <Topbar
        title="Salon Vitrini"
        subtitle="Herkese açık salon sayfanızı yönetin: fotoğraflar, işletme bilgileri ve yayın durumu."
        breadcrumbs={['Yönetim', 'Salon Vitrini']}
      />
      <div className="space-y-5 p-4 sm:p-6">
        {/* Yayın durumu + kaydet */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[#ead8df] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]"
        >
          <div className="flex items-center gap-3">
            <span
              className={`grid h-11 w-11 place-items-center rounded-2xl ${
                form.isPublished ? 'bg-emerald-50 text-emerald-600' : 'bg-[#fff1f6] text-[#c85776]'
              }`}
            >
              {form.isPublished ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </span>
            <div>
              <div className="text-[14px] font-bold text-[#352432]">
                {form.isPublished ? 'Salonunuz yayında' : 'Salonunuz yayında değil'}
              </div>
              <div className="text-[11.5px] text-[#7c6170]">
                Yayındayken salonunuz /salonlar listesinde ve herkese açık profil sayfasında görünür.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {slug && (
              <Link
                href={`/salon/${slug}`}
                target="_blank"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[#ead8df] bg-white px-4 text-[12px] font-semibold text-[#7c6170] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Sayfayı Gör
              </Link>
            )}
            <button
              type="button"
              onClick={() => set('isPublished', !form.isPublished)}
              className={`relative h-7 w-13 rounded-full transition-colors ${form.isPublished ? 'bg-emerald-500' : 'bg-[#e5d5dc]'}`}
              style={{ width: 52 }}
              aria-label="Yayın durumu"
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  form.isPublished ? 'left-[26px]' : 'left-1'
                }`}
              />
            </button>
          </div>
        </motion.div>

        <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
        {/* İşletme bilgileri formu */}
        <div className="rounded-[22px] border border-[#ead8df] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#352432]">
            <Building2 className="h-4 w-4 text-[#c85776]" /> İşletme Bilgileri
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Salon tanıtım yazısı</label>
              <textarea
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Salonunuzu birkaç cümleyle tanıtın…"
                className="w-full rounded-xl border border-[#ead8df] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#e798b4]"
              />
            </div>
            <div>
              <label className={labelCls}><MapPin className="mr-1 inline h-3 w-3" />Adres</label>
              <input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} className={inputCls} placeholder="Mahalle, cadde, no…" />
            </div>
            <div>
              <label className={labelCls}>Şehir / İlçe</label>
              <input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} className={inputCls} placeholder="Örn. Erzurum / Yakutiye" />
            </div>
            <div>
              <label className={labelCls}><Clock3 className="mr-1 inline h-3 w-3" />Çalışma saatleri</label>
              <input value={form.workingHoursText ?? ''} onChange={(e) => set('workingHoursText', e.target.value)} className={inputCls} placeholder="Örn. 09:00 - 20:00 (Pazar kapalı)" />
            </div>
            <div>
              <label className={labelCls}><Instagram className="mr-1 inline h-3 w-3" />Instagram kullanıcı adı</label>
              <input value={form.instagram ?? ''} onChange={(e) => set('instagram', e.target.value)} className={inputCls} placeholder="kullaniciadi (@ olmadan)" />
            </div>
            <div>
              <label className={labelCls}><Mail className="mr-1 inline h-3 w-3" />Herkese açık e-posta</label>
              <input value={form.publicEmail ?? ''} onChange={(e) => set('publicEmail', e.target.value)} className={inputCls} placeholder="info@salonunuz.com" />
            </div>
            <div>
              <label className={labelCls}><Phone className="mr-1 inline h-3 w-3" />Herkese açık telefon</label>
              <input value={form.publicPhone ?? ''} onChange={(e) => set('publicPhone', e.target.value)} className={inputCls} placeholder="0xxx xxx xx xx" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Harita / yol tarifi linki (opsiyonel)</label>
              <input value={form.mapUrl ?? ''} onChange={(e) => set('mapUrl', e.target.value)} className={inputCls} placeholder="https://maps.google.com/… (boşsa adresle otomatik oluşturulur)" />
            </div>
          </div>
          {message && (
            <div className={`mt-4 rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {message.text}
            </div>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#ef6f94] to-[#d65f83] px-6 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Profili Kaydet
          </button>
        </div>

        </div>

        {/* Sağ kolon: logo + galeriler */}
        <div className="space-y-5">
        <LogoUploader logo={profileData?.logoData ?? null} onChanged={() => void reloadProfile()} />
        <GalleryManager
          title="Vitrin Fotoğrafları (Slider)"
          hint="Salon sayfasının üstündeki büyük kaydırmalı görseller — salonunuzun genel görünümü."
          kind="Slider"
          photos={photos}
          onChanged={() => void reloadPhotos()}
          maxSize={1280}
        />
        <GalleryManager
          title="Hizmet Galerisi"
          hint="Yaptığınız işlerden örnekler (tırnak, cilt bakımı, saç…) — salon sayfasındaki Hizmet Galerisi bölümünde görünür."
          kind="Service"
          photos={photos}
          onChanged={() => void reloadPhotos()}
          maxSize={960}
        />
        </div>
        </div>
      </div>
    </>
  )
}
