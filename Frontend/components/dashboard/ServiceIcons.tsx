'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

/**
 * Güzellik / bakım temalı özel SVG hizmet ikon kütüphanesi.
 * Her ikon 24×24 grid, currentColor ile çizilir (yuvarlak uç/birleşim, 1.6 stroke).
 * Hizmet/paket eklerken IconPicker'dan seçilir ve IconKey olarak saklanır;
 * her yerde ServiceIcon ile aynı görsel gösterilir.
 */

interface IconDef {
  key: string
  label: string
  group: string
  paths: ReactNode
}

const G_FACE = 'Cilt & Yüz'
const G_BODY = 'Vücut'
const G_HAIR = 'Saç'
const G_NAIL = 'Tırnak'
const G_EYE = 'Göz & Dudak'
const G_ENERGY = 'Lazer & Enerji'
const G_MED = 'Medikal'
const G_SPA = 'Doğal & Spa'

export const ICON_GROUPS = [G_FACE, G_BODY, G_HAIR, G_NAIL, G_EYE, G_ENERGY, G_MED, G_SPA] as const

export const SERVICE_ICONS: IconDef[] = [
  // ---- Cilt & Yüz ----
  { key: 'face-care', label: 'Cilt Bakımı', group: G_FACE, paths: (<><circle cx="12" cy="12" r="8.25" /><path d="M9 14.4c1.7 1.4 4.3 1.4 6 0" /><circle cx="9.5" cy="10.6" r=".85" fill="currentColor" stroke="none" /><circle cx="14.5" cy="10.6" r=".85" fill="currentColor" stroke="none" /></>) },
  { key: 'face-glow', label: 'Işıltı / Glow', group: G_FACE, paths: (<><circle cx="10.5" cy="13" r="6.4" /><path d="M8.5 14.2c1.2 1 2.8 1 4 0" /><path d="M18.5 3.2l.85 2.1 2.1.85-2.1.85-.85 2.1-.85-2.1-2.1-.85 2.1-.85z" fill="currentColor" stroke="none" /></>) },
  { key: 'face-mask', label: 'Yüz Maskesi', group: G_FACE, paths: (<><path d="M5.5 7.8c0-1 .8-1.8 1.8-1.8h9.4c1 0 1.8.8 1.8 1.8 0 5.4-3.1 9.7-6.5 9.7S5.5 13.2 5.5 7.8z" /><path d="M8.6 10.4h6.8M9.8 13.6h4.4" /></>) },
  { key: 'serum', label: 'Serum / Damla', group: G_FACE, paths: (<><rect x="9" y="8.4" width="6" height="11.6" rx="2.4" /><path d="M10.4 8.4V5h3.2v3.4M11 2.4h2v2.6h-2z" /><path d="M11 12.4h2M11 15.4h2" /></>) },
  { key: 'cream', label: 'Krem / Kavanoz', group: G_FACE, paths: (<><path d="M6.4 9.2h11.2v8.4a2.6 2.6 0 0 1-2.6 2.6H9a2.6 2.6 0 0 1-2.6-2.6z" /><path d="M8 9.2V6.6c0-.9.7-1.6 1.6-1.6h4.8c.9 0 1.6.7 1.6 1.6v2.6" /><path d="M9.6 13.6h4.8" /></>) },
  { key: 'peeling', label: 'Peeling', group: G_FACE, paths: (<><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r=".95" fill="currentColor" stroke="none" /><circle cx="14.6" cy="9.6" r=".75" fill="currentColor" stroke="none" /><circle cx="13.2" cy="14" r=".85" fill="currentColor" stroke="none" /><circle cx="9.4" cy="14.4" r=".65" fill="currentColor" stroke="none" /><circle cx="15" cy="13.4" r=".55" fill="currentColor" stroke="none" /></>) },
  { key: 'droplet', label: 'Hydrafacial / Nem', group: G_FACE, paths: (<><path d="M12 3.4c3.1 4.1 5.2 6.4 5.2 9.3a5.2 5.2 0 0 1-10.4 0c0-2.9 2.1-5.2 5.2-9.3z" /><path d="M9.6 13.4a2.4 2.4 0 0 0 2.4 2.4" /></>) },

  // ---- Vücut ----
  { key: 'body-contour', label: 'Bölgesel İncelme', group: G_BODY, paths: (<><circle cx="12" cy="5" r="2.1" /><path d="M9.4 11c0-1.5 1.1-2.6 2.6-2.6s2.6 1.1 2.6 2.6c0 1.7-.8 2.7-.7 4.4l.5 5.2M9.4 11c0 1.7.8 2.7.7 4.4L9.6 20.6" /></>) },
  { key: 'massage', label: 'Masaj', group: G_BODY, paths: (<><path d="M3.8 13.6c2-2 5-2 7 0M3.8 13.6v3c0 1.1.9 2 2 2h6.2" /><path d="M13.8 5.2l4.2 1.9-1.5 4.6c-.4 1.2-1.7 1.9-2.9 1.5l-.7-.2" /><circle cx="18.6" cy="6" r="1.4" /></>) },
  { key: 'slimming', label: 'Zayıflama', group: G_BODY, paths: (<><path d="M7 4.2h10l-1.6 7.2H8.6z" /><path d="M8.5 11.4c-1 2.6-1 5.6 1.2 8.4M15.5 11.4c1 2.6 1 5.6-1.2 8.4" /></>) },
  { key: 'scrub', label: 'Vücut Peelingi', group: G_BODY, paths: (<><path d="M5.5 8c2.2-2.2 4.3-2.2 6.5 0s4.3 2.2 6.5 0" /><path d="M5.5 12c2.2-2.2 4.3-2.2 6.5 0s4.3 2.2 6.5 0" /><path d="M5.5 16c2.2-2.2 4.3-2.2 6.5 0s4.3 2.2 6.5 0" /></>) },

  // ---- Saç ----
  { key: 'scissors', label: 'Saç Kesim', group: G_HAIR, paths: (<><circle cx="6" cy="6.2" r="2.3" /><circle cx="6" cy="17.8" r="2.3" /><path d="M8 7.7L20 17M8 16.3L20 7M11 10.1l1.8 1.5" /></>) },
  { key: 'hair-dryer', label: 'Fön / Föhn', group: G_HAIR, paths: (<><path d="M4 7.2h9.2a3.6 3.6 0 0 1 0 7.2H4z" /><path d="M8 14.4l-1 5.8M13.2 9.4v5.4" /><circle cx="8.4" cy="10.8" r="1.5" /></>) },
  { key: 'comb', label: 'Tarak', group: G_HAIR, paths: (<><path d="M4 8h16v3.2H4z" /><path d="M6.4 11.2v5.6M9.2 11.2v5.6M12 11.2v5.6M14.8 11.2v5.6M17.6 11.2v4" /></>) },
  { key: 'hair-color', label: 'Saç Boya', group: G_HAIR, paths: (<><path d="M7 4.2h6l3 3-7 7-3-3z" /><path d="M9 14.2l-3 5 5-3" /><path d="M16 7.2c1.6 1.6 1.6 4.2 0 5.4" /></>) },
  { key: 'keratin', label: 'Keratin / Bakım', group: G_HAIR, paths: (<><path d="M8 3.2c0 4-3 6.2-3 10.2a7 7 0 0 0 14 0c0-4-3-6.2-3-10.2" /><path d="M9.2 7.4c0 3-1 5-1 7M14.8 7.4c0 3 1 5 1 7" /></>) },

  // ---- Tırnak ----
  { key: 'nail-polish', label: 'Oje / Manikür', group: G_NAIL, paths: (<><rect x="9" y="9" width="6" height="11" rx="1.6" /><path d="M10 9V6.2h4V9M11 4.2h2v2h-2z" /></>) },
  { key: 'hand-nails', label: 'El & Tırnak', group: G_NAIL, paths: (<><path d="M7 11.2V6.6a1.5 1.5 0 0 1 3 0v4.6m0-1V5a1.5 1.5 0 0 1 3 0v5.2m0-.7V6.2a1.5 1.5 0 0 1 3 0v6.8c0 3.4-2.2 6-5.4 6-3 0-4.6-2-4.6-4.6v-2.6a1.5 1.5 0 0 1 3 0v.4" /></>) },
  { key: 'nail-file', label: 'Törpü', group: G_NAIL, paths: (<><path d="M4.5 18L16 6.5l1.8 1.8L6.3 19.8z" /><path d="M16 6.5l1.8-1.8 1.8 1.8-1.8 1.8" /><path d="M7.4 15.1l1.6 1.6M9.8 12.7l1.6 1.6M12.2 10.3l1.6 1.6" /></>) },

  // ---- Göz & Dudak ----
  { key: 'lashes', label: 'Kirpik / İpek', group: G_EYE, paths: (<><path d="M3.5 13c3-4 14-4 17 0" /><path d="M5.5 12.6l-1 3M9 11.6l-.5 3.4M12 11.3v3.6M15 11.6l.5 3.4M18.5 12.6l1 3" /></>) },
  { key: 'eyebrow', label: 'Kaş Dizayn', group: G_EYE, paths: (<><path d="M4 11.2c3-2.6 7-3.1 9.2-1M4.4 11.4l.2 1.6M7.2 9.9l-.1 1.7M10 9.4l.3 1.7M12.6 10.4l.5 1.6" /><path d="M16 14c1.5-1 3.4-1 4 .5" /></>) },
  { key: 'eye', label: 'Göz Bakımı', group: G_EYE, paths: (<><path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.7" /></>) },
  { key: 'lips', label: 'Dudak / Lip', group: G_EYE, paths: (<><path d="M12 9.2c-1.6-2-4.6-2.5-6.2-1 1 0 2 .5 2.6 1.5C7 9.2 5 9.7 4 11.2c2.6 1.1 5.2 3 8 3s5.4-1.9 8-3c-1-1.5-3-2-4.4-1.5.6-1 1.6-1.5 2.6-1.5-1.6-1.5-4.6-1-6.2 1z" /></>) },

  // ---- Lazer & Enerji ----
  { key: 'laser', label: 'Lazer Epilasyon', group: G_ENERGY, paths: (<><path d="M12 2.4v4.4M12 8.8l-2 5.2h4l-2 7.6" /><path d="M6.4 5l1.9 2.9M17.6 5l-1.9 2.9" /></>) },
  { key: 'flame', label: 'Termal / Isı', group: G_ENERGY, paths: (<><path d="M12 3c1.1 3.1 4.2 4.2 4.2 8.2A4.2 4.2 0 0 1 7.8 11.2c0-1.5.5-2.6 1.5-3.6C10.2 6.8 11.2 5.2 12 3z" /><path d="M10.8 16.2a1.7 1.7 0 0 0 2.4 0" /></>) },
  { key: 'led-light', label: 'LED Terapi', group: G_ENERGY, paths: (<><path d="M9.4 16.4h5.2M10.4 19.2h3.2" /><path d="M12 3a6.2 6.2 0 0 0-4.1 10.8c.6.6 1 1.4 1.1 2.6h6c.1-1.2.5-2 1.1-2.6A6.2 6.2 0 0 0 12 3z" /></>) },
  { key: 'radio-wave', label: 'Radyofrekans', group: G_ENERGY, paths: (<><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8 8 0 0 0 0 12M18 6a8 8 0 0 1 0 12" /></>) },
  { key: 'sun', label: 'Bronzlaşma', group: G_ENERGY, paths: (<><circle cx="12" cy="12" r="4" /><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" /></>) },

  // ---- Medikal ----
  { key: 'syringe', label: 'Dolgu / Botoks', group: G_MED, paths: (<><path d="M4.6 19.4l4-4M8 12.2l3.8 3.8M11 9.2l3.8 3.8-3 3-3.8-3.8z" /><path d="M14 6.2l3.8 3.8M16 4.2l3.8 3.8M13 7.2l3.8 3.8" /></>) },
  { key: 'medical', label: 'Medikal Bakım', group: G_MED, paths: (<><rect x="4" y="6.2" width="16" height="13" rx="2.6" /><path d="M9 6.2V4.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6v1.6" /><path d="M12 10v5.2M9.4 12.6h5.2" /></>) },
  { key: 'shield-care', label: 'Koruyucu Bakım', group: G_MED, paths: (<><path d="M12 3l7 2.5v5c0 5-3 8-7 10-4-2-7-5-7-10v-5z" /><path d="M9 12l2 2 4-4.2" /></>) },

  // ---- Doğal & Spa ----
  { key: 'leaf', label: 'Doğal / Bitkisel', group: G_SPA, paths: (<><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" /><path d="M8 16c3-3 6-5 9-6" /></>) },
  { key: 'lotus', label: 'Spa / Lotus', group: G_SPA, paths: (<><path d="M12 6c-1.6 2-1.6 5.2 0 7.2 1.6-2 1.6-5.2 0-7.2z" /><path d="M12 13.2c2.1-1 3.6-3.6 3.6-6.7-2.6.5-3.6 3.6-3.6 6.7zM12 13.2c-2.1-1-3.6-3.6-3.6-6.7 2.6.5 3.6 3.6 3.6 6.7z" /><path d="M4 13.2c2.6 4.1 13.4 4.1 16 0-2 2-4 3.1-8 3.1s-6-1.1-8-3.1z" /></>) },
  { key: 'flower', label: 'Çiçek / Aroma', group: G_SPA, paths: (<><circle cx="12" cy="12" r="2.3" /><path d="M12 3.8a3 3 0 0 1 0 5.9M12 20.2a3 3 0 0 0 0-5.9M3.8 12a3 3 0 0 0 5.9 0M20.2 12a3 3 0 0 1-5.9 0" /></>) },
  { key: 'candle', label: 'Aroma Terapi', group: G_SPA, paths: (<><rect x="9" y="9.2" width="6" height="10.8" rx="1.2" /><path d="M12 9.2V6.4" /><path d="M12 2.2c1.3 1.1 1.3 2.6 0 3.7-1.3-1.1-1.3-2.6 0-3.7z" fill="currentColor" stroke="none" /></>) },
  { key: 'stones', label: 'Sıcak Taş', group: G_SPA, paths: (<><ellipse cx="9" cy="14.2" rx="5" ry="2.5" /><ellipse cx="14.2" cy="9.8" rx="4" ry="2.1" /></>) },
  { key: 'gem', label: 'Premium / Elmas', group: G_SPA, paths: (<><path d="M6 4h12l3 5-9 11L3 9z" /><path d="M3 9h18M9 4l-3 5 6 11 6-11-3-5M9 4l3 5 3-5" /></>) },
  { key: 'heart', label: 'Gelin / Özel Gün', group: G_SPA, paths: (<><path d="M12 20.2s-7-4.6-7-10.2a4 4 0 0 1 7-2.6 4 4 0 0 1 7 2.6c0 5.6-7 10.2-7 10.2z" /></>) },
  { key: 'star', label: 'VIP / Yıldız', group: G_SPA, paths: (<><path d="M12 3l2.6 5.6 6.1.9-4.4 4.3 1 6.1L12 17.9 6.7 20l1-6.1-4.4-4.3 6.1-.9z" /></>) },
]

const ICON_MAP = new Map(SERVICE_ICONS.map((i) => [i.key, i]))

export function ServiceIcon({ iconKey, className = 'h-5 w-5', strokeWidth = 1.6 }: { iconKey?: string | null; className?: string; strokeWidth?: number }) {
  const def = iconKey ? ICON_MAP.get(iconKey) : undefined
  const content = def?.paths ?? SERVICE_ICONS[0].paths
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {content}
    </svg>
  )
}

export function iconLabel(iconKey?: string | null): string {
  return (iconKey && ICON_MAP.get(iconKey)?.label) || 'Hizmet'
}

/** Hizmet/paket adına veya kategoriye göre makul bir varsayılan ikon anahtarı önerir. */
export function suggestIcon(text?: string | null): string {
  const s = (text || '').toLocaleLowerCase('tr')
  const has = (...w: string[]) => w.some((x) => s.includes(x))
  if (has('lazer', 'epilasyon')) return 'laser'
  if (has('hydra', 'nem', 'su', 'damla')) return 'droplet'
  if (has('cilt', 'yüz', 'facial')) return 'face-care'
  if (has('maske', 'mask')) return 'face-mask'
  if (has('led')) return 'led-light'
  if (has('saç', 'fön', 'kesim', 'boya', 'keratin')) return 'hair-dryer'
  if (has('tırnak', 'manikür', 'oje', 'pedikür')) return 'nail-polish'
  if (has('kirpik', 'ipek')) return 'lashes'
  if (has('kaş')) return 'eyebrow'
  if (has('dudak', 'lip')) return 'lips'
  if (has('dolgu', 'botoks', 'mezo')) return 'syringe'
  if (has('masaj', 'spa', 'terapi')) return 'massage'
  if (has('bölgesel', 'incelme', 'zayıf')) return 'body-contour'
  if (has('radyo', 'rf')) return 'radio-wave'
  if (has('bronz', 'güneş')) return 'sun'
  if (has('gelin', 'özel')) return 'heart'
  if (has('medikal', 'estetik')) return 'medical'
  if (has('peeling')) return 'peeling'
  return 'face-care'
}

/**
 * Premium hizmet ikon seçici — arama + kategori çipleri + gül gradyan seçili madalyon ızgarası.
 * `columns` ile sütun sayısı, `maxHeight` ile ızgara yüksekliği ayarlanabilir.
 */
export function IconPicker({
  value,
  onChange,
  columns = 6,
  maxHeight = 'max-h-[210px]',
  bare = false,
  fill = false,
}: {
  value?: string | null
  onChange: (key: string) => void
  columns?: number
  maxHeight?: string
  /** true: çevre kutusu olmadan (krem sütun içinde Stitch düzeniyle) render eder */
  bare?: boolean
  /** true: ebeveyn yüksekliğini doldurur — arama/çipler sabit, yalnız ızgara kayar */
  fill?: boolean
}) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('all')

  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('tr')
    return SERVICE_ICONS.filter((i) => {
      const matchesGroup = group === 'all' || i.group === group
      const matchesTerm = !term || i.label.toLocaleLowerCase('tr').includes(term) || i.group.toLocaleLowerCase('tr').includes(term)
      return matchesGroup && matchesTerm
    })
  }, [q, group])

  const gridColsClass =
    columns === 8 ? 'grid-cols-8' : columns === 7 ? 'grid-cols-7' : columns === 5 ? 'grid-cols-5' : 'grid-cols-6'

  const inner = (
    <>
      {/* arama */}
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#705a66]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="İkon ara..."
          className="w-full rounded-xl border border-[#efe1e7] bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#4a3a44] outline-none transition focus:border-[#c85776] focus:ring-1 focus:ring-[#c85776] placeholder:text-[#705a66]/60"
        />
      </div>

      {/* kategori çipleri — yatay kaydırılır (Stitch) */}
      <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(['all', ...ICON_GROUPS] as string[]).map((g) => {
          const active = group === g
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                active
                  ? 'bg-[#c85776] text-white shadow-sm'
                  : 'border border-[#efe1e7] bg-white text-[#705a66] hover:border-[#c85776]/50 hover:text-[#c85776]'
              }`}
            >
              {g === 'all' ? 'Tümü' : g}
            </button>
          )
        })}
      </div>

      {/* ızgara */}
      <div className={`mt-3 grid gap-2 overflow-y-auto pr-0.5 ${gridColsClass} ${fill ? 'min-h-0 flex-1' : maxHeight}`}>
        {filtered.map((i) => {
          const selected = value === i.key
          return (
            <button
              key={i.key}
              type="button"
              title={i.label}
              onClick={() => onChange(i.key)}
              className={`grid aspect-square place-items-center rounded-xl transition-all duration-200 ${
                selected
                  ? 'bg-gradient-to-br from-[#f47699] to-[#ef6088] text-white shadow-[0_4px_12px_-8px_rgba(200,87,118,0.5)] ring-2 ring-[#c85776]'
                  : 'border border-[#efe1e7] bg-white text-[#705a66] shadow-sm hover:border-[#c85776] hover:text-[#c85776]'
              }`}
            >
              <ServiceIcon iconKey={i.key} className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="col-span-full py-5 text-center text-[12px] text-[#9d7386]">İkon bulunamadı.</div>
        )}
      </div>
    </>
  )

  if (bare) return <div className={fill ? 'flex min-h-0 flex-1 flex-col' : ''}>{inner}</div>
  return <div className={`rounded-[16px] border border-[#efe1e7] bg-[#fffafc] p-3 ${fill ? 'flex min-h-0 flex-1 flex-col' : ''}`}>{inner}</div>
}
