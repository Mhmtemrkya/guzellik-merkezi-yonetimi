'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Layers3, Search, Tag } from 'lucide-react'

/** Kategori + alt kategori + arama ile filtrelenebilen kaynak (paket/hizmet) seçici öğesi. */
export interface PickerItem {
  id: string
  name: string
  price: number
  cat: string
  sub: string
  meta?: string
  content?: string[]
  /** Adın yanında vurgulu rozet (ör. "3 seans hakkı") — seçmeden önce görülmesi gereken bilgi. */
  badge?: string
}

/**
 * Kategori + alt kategori + arama ile süzülebilir katalog seçici.
 * Satış modallarında (paket/hizmet) ve bekleme listesinde ortak kullanılır.
 * `clearable` açıksa seçili öğeye tekrar tıklamak seçimi kaldırır (opsiyonel alanlar için "farketmez").
 */
export default function CatalogPicker({
  items,
  value,
  onChange,
  accent = 'rose',
  emptyText,
  clearable = false,
  categoryOrder,
}: {
  items: PickerItem[]
  value: string
  onChange: (id: string) => void
  accent?: 'rose' | 'violet'
  emptyText: string
  /** true ise seçili öğeye tekrar tıklamak seçimi temizler (opsiyonel alanlarda). */
  clearable?: boolean
  /** Kategori/alt kategori pill'lerini manuel sıraya (SortOrder) göre dizmek için ad→sıra çözücü. */
  categoryOrder?: (name: string) => number
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')

  const cats = useMemo(
    () => Array.from(new Set(items.map((i) => i.cat).filter(Boolean)))
      .sort((a, b) => (categoryOrder ? categoryOrder(a) - categoryOrder(b) : 0) || a.localeCompare(b, 'tr')),
    [items, categoryOrder],
  )
  const subs = useMemo(
    () => Array.from(new Set(items.filter((i) => !cat || i.cat === cat).map((i) => i.sub).filter(Boolean)))
      .sort((a, b) => (categoryOrder ? categoryOrder(a) - categoryOrder(b) : 0) || a.localeCompare(b, 'tr')),
    [items, cat, categoryOrder],
  )
  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('tr')
    return items.filter(
      (i) =>
        (!cat || i.cat === cat) &&
        (!sub || i.sub === sub) &&
        (!term || i.name.toLocaleLowerCase('tr').includes(term)),
    )
  }, [items, cat, sub, q])

  const selectedActive = accent === 'violet'
    ? 'border-violet-400 bg-violet-50'
    : 'border-[#8C4460] bg-[#fdf4f8]'
  const pillActive = accent === 'violet'
    ? 'bg-violet-500 text-white'
    : 'bg-[#A5556E] text-white'

  const Pill = ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
        active ? pillActive : 'border border-[#EAD8DF] bg-white text-[#5A4B53] hover:bg-[#F7F6F6]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="mt-1 space-y-2">
      {/* Arama */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A5556E]/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ada göre ara…"
          className="w-full rounded-[10px] border border-[#EAD8DF] bg-white py-2 pl-9 pr-3 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]"
        />
      </div>

      {/*
        KATEGORİLER SARAR, YANA KAYMAZ.
        Önceden tek satırda `overflow-x-auto` idi: kategori sayısı arttıkça son çipler panelin
        sağından taşıp kelimenin ortasından kırpılıyor ("Lazer Epilasyo…"), altında da bir yatay
        kaydırma çubuğu beliriyordu — var olan kategorilerin bir kısmı görünmüyordu bile.
        Sarma ile hepsi görünür. YÜKSEKLİK SINIRI DA YOK: sabit bir tavan (denendi) son satırı
        ortasından kesip aynı "alta kaçtı" görüntüsünü geri getiriyordu. Şerit kaç satır gerekiyorsa
        o kadar uzar; kategori sayısı salımlarda zaten sınırlıdır.
      */}
      {cats.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          <Tag className="h-3 w-3 shrink-0 text-[#A5556E]/50" />
          <Pill active={!cat} label="Tümü" onClick={() => { setCat(''); setSub('') }} />
          {cats.map((c) => (
            <Pill key={c} active={cat === c} label={c} onClick={() => { setCat(c); setSub('') }} />
          ))}
        </div>
      )}

      {/* Alt kategori filtresi (seçili üst kategoriye göre) — aynı kural. */}
      {subs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5 pl-4">
          <Layers3 className="h-3 w-3 shrink-0 text-[#A5556E]/40" />
          <Pill active={!sub} label="Tüm alt kategoriler" onClick={() => setSub('')} />
          {subs.map((s) => (
            <Pill key={s} active={sub === s} label={s} onClick={() => setSub(s)} />
          ))}
        </div>
      )}

      {/* Sonuç listesi */}
      <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] p-1.5">
        {filtered.map((i) => {
          const active = value === i.id
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onChange(clearable && active ? '' : i.id)}
              className={`flex w-full items-start justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                active ? selectedActive : 'border-transparent bg-white hover:border-[#BE7690]'
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-[#2A2027]">{i.name}</span>
                  {i.badge && (
                    <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {i.badge}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[#74616A]">
                  {i.cat && <span className="rounded bg-[#F6DFE6] px-1 py-0.5 text-[#8C4460]">{i.cat}</span>}
                  {i.sub && <span className="rounded bg-[#f4ecf9] px-1 py-0.5 text-violet-600">{i.sub}</span>}
                  {i.meta && <span>{i.meta}</span>}
                </div>
                {i.content && i.content.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.content.map((c, idx) => (
                      <span key={idx} className="rounded border border-[#e7c7d4]/60 bg-white px-1 py-0.5 text-[9.5px] text-[#8C4460]">{c}</span>
                    ))}
                  </div>
                )}
              </div>
              {active && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#A5556E]" />}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-[#74616A]">{emptyText}</div>
        )}
      </div>
    </div>
  )
}
