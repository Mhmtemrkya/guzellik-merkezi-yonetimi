'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

/**
 * Güzellik / bakım temalı özel SVG hizmet ikon kütüphanesi.
 * Her ikon currentColor ile çizilir; hizmet/paket eklerken IconPicker'dan seçilir
 * ve IconKey olarak saklanır. ServiceIcon ile her yerde aynı görsel gösterilir.
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

export const SERVICE_ICONS: IconDef[] = [
  // ---- Cilt & Yüz ----
  { key: 'face-care', label: 'Cilt Bakımı', group: G_FACE, paths: (<><circle cx="12" cy="12" r="8.2" /><path d="M9 14.5c1.6 1.3 4.4 1.3 6 0" /><circle cx="9.4" cy="10.5" r=".7" fill="currentColor" stroke="none" /><circle cx="14.6" cy="10.5" r=".7" fill="currentColor" stroke="none" /></>) },
  { key: 'face-glow', label: 'Işıltı / Glow', group: G_FACE, paths: (<><circle cx="11" cy="13" r="6.5" /><path d="M9 14c1.2 1 3 1 4 0" /><path d="M18 4l.7 1.7L20.5 6l-1.8.6L18 8.5l-.7-1.9L15.5 6l1.8-.3z" fill="currentColor" stroke="none" /></>) },
  { key: 'face-mask', label: 'Yüz Maskesi', group: G_FACE, paths: (<><path d="M5.5 8c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2 0 5.2-3 9.5-6.5 9.5S5.5 13.2 5.5 8z" /><path d="M6 10.5h12M9 14h6" /></>) },
  { key: 'serum', label: 'Serum / Damla', group: G_FACE, paths: (<><rect x="9" y="8.5" width="6" height="11.5" rx="2.2" /><path d="M10.2 8.5V5.2h3.6v3.3M12 2.2v3" /><path d="M11 12.5h2M11 15.5h2" /></>) },
  { key: 'cream', label: 'Krem / Kavanoz', group: G_FACE, paths: (<><path d="M6.5 9h11v8.5a2.5 2.5 0 0 1-2.5 2.5H9a2.5 2.5 0 0 1-2.5-2.5z" /><path d="M8 9V6.5C8 5.7 8.7 5 9.5 5h5c.8 0 1.5.7 1.5 1.5V9" /></>) },
  { key: 'peeling', label: 'Peeling', group: G_FACE, paths: (<><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r=".9" fill="currentColor" stroke="none" /><circle cx="14.5" cy="9.5" r=".7" fill="currentColor" stroke="none" /><circle cx="13" cy="14" r=".8" fill="currentColor" stroke="none" /><circle cx="9.5" cy="14.5" r=".6" fill="currentColor" stroke="none" /></>) },
  // ---- Vücut ----
  { key: 'body-contour', label: 'Bölgesel İncelme', group: G_BODY, paths: (<><path d="M12 3a2 2 0 1 0 0 0z" /><circle cx="12" cy="4.5" r="1.8" /><path d="M9 9c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5c0 2-1 3-1 5l1 6M9 9c0 2 1 3 1 5l-1 6" /></>) },
  { key: 'massage', label: 'Masaj', group: G_BODY, paths: (<><path d="M4 14c2-2 5-2 7 0M4 14v3c0 1 1 2 2 2h6" /><path d="M14 5l4 2-1.5 4.5c-.4 1.2-1.7 1.8-2.9 1.4l-.6-.2" /><circle cx="18.5" cy="6" r="1.3" /></>) },
  { key: 'slimming', label: 'Zayıflama', group: G_BODY, paths: (<><path d="M7 4h10l-1.5 7H8.5z" /><path d="M8.5 11c-1 2.5-1 5.5 1 8M15.5 11c1 2.5 1 5.5-1 8" /></>) },
  { key: 'scrub', label: 'Vücut Peelingi', group: G_BODY, paths: (<><path d="M6 8c2-2 4-2 6 0s4 2 6 0" /><path d="M6 12c2-2 4-2 6 0s4 2 6 0" /><path d="M6 16c2-2 4-2 6 0s4 2 6 0" /></>) },
  // ---- Saç ----
  { key: 'scissors', label: 'Saç Kesim', group: G_HAIR, paths: (<><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><path d="M8 7.5L20 17M8 16.5L20 7M11 10l2 1.7" /></>) },
  { key: 'hair-dryer', label: 'Fön / Föhn', group: G_HAIR, paths: (<><path d="M4 7h9a3.5 3.5 0 0 1 0 7H4z" /><path d="M8 14l-1 6M13 9v6" /><circle cx="8.5" cy="10.5" r="1.4" /></>) },
  { key: 'comb', label: 'Tarak', group: G_HAIR, paths: (<><path d="M4 8h16v3H4z" /><path d="M6 11v6M9 11v6M12 11v6M15 11v6M18 11v4" /></>) },
  { key: 'hair-color', label: 'Saç Boya', group: G_HAIR, paths: (<><path d="M7 4h6l3 3-7 7-3-3z" /><path d="M9 14l-3 5 5-3" /><path d="M16 7c1.5 1.5 1.5 4 0 5" /></>) },
  { key: 'keratin', label: 'Keratin / Bakım', group: G_HAIR, paths: (<><path d="M8 3c0 4-3 6-3 10a7 7 0 0 0 14 0c0-4-3-6-3-10" /><path d="M9 7c0 3-1 5-1 7M15 7c0 3 1 5 1 7" /></>) },
  // ---- Tırnak ----
  { key: 'nail-polish', label: 'Oje / Manikür', group: G_NAIL, paths: (<><rect x="9" y="9" width="6" height="11" rx="1.5" /><path d="M10 9V6h4v3M11 4h2v2h-2z" /></>) },
  { key: 'hand-nails', label: 'El & Tırnak', group: G_NAIL, paths: (<><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v5m0-.5V6a1.5 1.5 0 0 1 3 0v7c0 3-2 6-5 6s-5-2-5-5v-2.5a1.5 1.5 0 0 1 3 0V11" /></>) },
  { key: 'nail-file', label: 'Törpü', group: G_NAIL, paths: (<><path d="M4 18L16 6l2 2L6 20z" /><path d="M16 6l2-2 2 2-2 2" /><path d="M7 15l2 2M9.5 12.5l2 2" /></>) },
  // ---- Göz & Dudak ----
  { key: 'lashes', label: 'Kirpik / İpek', group: G_EYE, paths: (<><path d="M3 13c3-4 15-4 18 0" /><path d="M5 12.5l-1 3M9 11.5l-.5 3.5M12 11l0 4M15 11.5l.5 3.5M19 12.5l1 3" /></>) },
  { key: 'eyebrow', label: 'Kaş Dizayn', group: G_EYE, paths: (<><path d="M4 11c3-2.5 7-3 9-1M4 11l0 1.5M7 9.7l-.2 1.8M10 9.2l.2 1.8M13 10.2l.6 1.6" /><path d="M16 14c1.5-1 3.5-1 4 .5" /></>) },
  { key: 'eye', label: 'Göz Bakımı', group: G_EYE, paths: (<><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.6" /></>) },
  { key: 'lips', label: 'Dudak / Lip', group: G_EYE, paths: (<><path d="M12 9c-1.5-2-4.5-2.5-6-1 1 0 2 .5 2.5 1.5C7 9 5 9.5 4 11c2.5 1 5 3 8 3s5.5-2 8-3c-1-1.5-3-2-4.5-1.5C16 8.5 17 8 18 8c-1.5-1.5-4.5-1-6 1z" /></>) },
  // ---- Lazer & Enerji ----
  { key: 'laser', label: 'Lazer Epilasyon', group: G_ENERGY, paths: (<><path d="M12 2v5M12 9l-2 5h4l-2 7" /><path d="M6 5l2 3M18 5l-2 3" /></>) },
  { key: 'flame', label: 'Termal / Isı', group: G_ENERGY, paths: (<><path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5C10 7 11 5 12 3z" /><path d="M11 16a1.6 1.6 0 0 0 2 0" /></>) },
  { key: 'led-light', label: 'LED Terapi', group: G_ENERGY, paths: (<><path d="M9 16h6M10 19h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z" /></>) },
  { key: 'radio-wave', label: 'Radyofrekans', group: G_ENERGY, paths: (<><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8 8 0 0 0 0 12M18 6a8 8 0 0 1 0 12" /></>) },
  { key: 'sun', label: 'Bronzlaşma', group: G_ENERGY, paths: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>) },
  // ---- Medikal ----
  { key: 'syringe', label: 'Dolgu / Botoks', group: G_MED, paths: (<><path d="M5 19l4-4M8 12l4 4M11 9l4 4-3 3-4-4z" /><path d="M14 6l4 4M16 4l4 4M13 7l4 4" /></>) },
  { key: 'medical', label: 'Medikal Bakım', group: G_MED, paths: (<><rect x="4" y="6" width="16" height="13" rx="2.5" /><path d="M9 6V4.5C9 3.7 9.7 3 10.5 3h3c.8 0 1.5.7 1.5 1.5V6" /><path d="M12 10v5M9.5 12.5h5" /></>) },
  { key: 'shield-care', label: 'Koruyucu Bakım', group: G_MED, paths: (<><path d="M12 3l7 2.5v5c0 5-3 8-7 10-4-2-7-5-7-10v-5z" /><path d="M9 12l2 2 4-4" /></>) },
  // ---- Doğal & Spa ----
  { key: 'leaf', label: 'Doğal / Bitkisel', group: G_SPA, paths: (<><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" /><path d="M8 16c3-3 6-5 9-6" /></>) },
  { key: 'lotus', label: 'Spa / Lotus', group: G_SPA, paths: (<><path d="M12 6c-1.5 2-1.5 5 0 7 1.5-2 1.5-5 0-7z" /><path d="M12 13c2-1 3.5-3.5 3.5-6.5C13 7 12 10 12 13zM12 13c-2-1-3.5-3.5-3.5-6.5C11 7 12 10 12 13z" /><path d="M4 13c2.5 4 13.5 4 16 0-2 2-4 3-8 3s-6-1-8-3z" /></>) },
  { key: 'flower', label: 'Çiçek / Aroma', group: G_SPA, paths: (<><circle cx="12" cy="12" r="2.2" /><path d="M12 4a3 3 0 0 1 0 5.6M12 20a3 3 0 0 0 0-5.6M4 12a3 3 0 0 0 5.6 0M20 12a3 3 0 0 1-5.6 0" /></>) },
  { key: 'candle', label: 'Aroma Terapi', group: G_SPA, paths: (<><rect x="9" y="9" width="6" height="11" rx="1" /><path d="M12 9V6" /><path d="M12 2c1.2 1 1.2 2.5 0 3.5C10.8 4.5 10.8 3 12 2z" fill="currentColor" stroke="none" /></>) },
  { key: 'stones', label: 'Sıcak Taş', group: G_SPA, paths: (<><ellipse cx="9" cy="14" rx="5" ry="2.4" /><ellipse cx="14" cy="10" rx="4" ry="2" /></>) },
  { key: 'gem', label: 'Premium / Elmas', group: G_SPA, paths: (<><path d="M6 4h12l3 5-9 11L3 9z" /><path d="M3 9h18M9 4l-3 5 6 11 6-11-3-5M9 4l3 5 3-5" /></>) },
  { key: 'heart', label: 'Gelin / Özel Gün', group: G_SPA, paths: (<><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></>) },
  { key: 'star', label: 'VIP / Yıldız', group: G_SPA, paths: (<><path d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" /></>) },
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
  if (has('hydra', 'nem', 'su')) return 'droplet'
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

export function IconPicker({ value, onChange }: { value?: string | null; onChange: (key: string) => void }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const filtered = q.trim()
      ? SERVICE_ICONS.filter((i) => i.label.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')) || i.group.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
      : SERVICE_ICONS
    const map = new Map<string, IconDef[]>()
    for (const i of filtered) { const arr = map.get(i.group) ?? []; arr.push(i); map.set(i.group, arr) }
    return Array.from(map.entries())
  }, [q])

  return (
    <div className="rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İkon ara (cilt, lazer, saç...)"
            className="w-full rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]" />
        </div>
        {value && (
          <span className="flex items-center gap-1.5 rounded-[10px] border border-[#efbfd0]/70 bg-[#fff1f6] px-2 py-1 text-[11px] text-[#b14d6c]">
            <ServiceIcon iconKey={value} className="h-4 w-4" /> {iconLabel(value)}
          </span>
        )}
      </div>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {groups.map(([group, icons]) => (
          <div key={group}>
            <div className="mb-1.5 text-[9px] font-mono uppercase tracking-widest text-[#c85776]/55">{group}</div>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {icons.map((i) => (
                <button key={i.key} type="button" title={i.label} onClick={() => onChange(i.key)}
                  className={`grid aspect-square place-items-center rounded-[10px] border transition-colors ${value === i.key ? 'border-[#c85776] bg-[#fff1f6] text-[#c85776]' : 'border-[#ead8df]/70 bg-white text-[#352432]/65 hover:border-[#efbfd0] hover:bg-[#fff4f8]/60 hover:text-[#c85776]'}`}>
                  <ServiceIcon iconKey={i.key} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="py-4 text-center text-[12px] text-[#352432]/40">İkon bulunamadı.</div>}
      </div>
    </div>
  )
}
