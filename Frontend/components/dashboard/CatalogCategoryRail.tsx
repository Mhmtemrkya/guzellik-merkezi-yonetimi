'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

export interface CategoryRailItem {
  name: string
  count: number
}

interface Props {
  items: CategoryRailItem[]
  /** Seçili kategori adı; boş string = "Tümü". */
  value: string
  onChange: (name: string) => void
  /** "Tümü" rozetindeki toplam kayıt sayısı. */
  total: number
  /** Ekran okuyucu etiketi ve boş durum metni için ("hizmet" / "paket"). */
  itemLabel?: string
}

/**
 * Katalog kategori rayı — hizmet/paket kütüphanelerinde kategori filtresi.
 *
 * Neden bu tasarım:
 * - **Durum sekmeleriyle karışmasın.** Kategoriler eskiden durum sekmeleriyle (Tümü/Aktif/Pasif)
 *   birebir aynı "kenarlıklı pill" dilini kullanıyordu; iki satır aynı görünüp farklı şey yapıyor,
 *   üstelik "Tümü" iki kez geçiyordu. Burada kenarlık yok, seçili olan dolu zeminle ayrışıyor.
 * - **Tek satır.** Kategori sayısı arttıkça alta sarıp düzeni zıplatmak yerine yatay kaydırır;
 *   kenarlardaki soluklaşma daha fazla içerik olduğunu belli eder.
 * - **Adet + pay barı.** Her kategori kendi payını gösteren ince bir bar taşır: katalogun neye
 *   ağırlık verdiği (121 hizmetin 32'si lazer epilasyon) tek bakışta okunur. Filtre aynı zamanda
 *   küçük bir dağılım grafiği olur.
 */
export default function CatalogCategoryRail({ items, value, onChange, total, itemLabel = 'kayıt' }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })

  // Kaydırma göstergeleri: içerik taşmıyorsa hiç gösterilmez (gereksiz gürültü olmasın).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const update = (): void => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ left: el.scrollLeft > 4, right: max > 4 && el.scrollLeft < max - 4 })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [items.length])

  if (items.length === 0) return null

  // Bar genişliği en kalabalık kategoriye göre ölçeklenir — küçük kategoriler tamamen kaybolmasın diye taban %8.
  const max = Math.max(1, ...items.map((i) => i.count))
  const barWidth = (count: number): string => `${Math.max(8, Math.round((count / max) * 100))}%`

  return (
    <div className="relative mt-3">
      <div
        ref={scrollerRef}
        role="group"
        aria-label={`Kategoriye göre ${itemLabel} filtresi`}
        className="no-scrollbar flex items-stretch gap-1 overflow-x-auto scroll-smooth pb-0.5"
      >
        <RailButton
          label="Tümü"
          count={total}
          active={!value}
          barWidth="100%"
          onClick={() => onChange('')}
        />
        {items.map((c) => (
          <RailButton
            key={c.name}
            label={c.name}
            count={c.count}
            active={value === c.name}
            barWidth={barWidth(c.count)}
            onClick={() => onChange(value === c.name ? '' : c.name)}
          />
        ))}
      </div>

      {/* Kaydırma ipucu — yalnızca o yönde içerik varken. pointer-events-none: tıklamayı engellemez. */}
      {edges.left && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent" />
      )}
      {edges.right && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
      )}
    </div>
  )
}

function RailButton({
  label,
  count,
  active,
  barWidth,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  barWidth: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} · ${count}`}
      className={`group shrink-0 rounded-[10px] px-2.5 py-1.5 text-left transition-colors ${
        active ? 'bg-[#fff1f6]' : 'hover:bg-[#fffafc]'
      }`}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={`whitespace-nowrap text-[12px] font-medium ${active ? 'text-[#c85776]' : 'text-[#4a3a44] group-hover:text-[#c85776]'}`}>
          {label}
        </span>
        <span className={`tabular-nums text-[10.5px] ${active ? 'text-[#c85776]/70' : 'text-[#705a66]'}`}>{count}</span>
      </span>
      {/* Pay barı — kategorinin katalogdaki ağırlığı. */}
      <span aria-hidden className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-[#f4e3ea]">
        <motion.span
          className={`block h-full rounded-full ${active ? 'bg-[#c85776]' : 'bg-[#efbfd0] group-hover:bg-[#e79bb4]'}`}
          initial={false}
          animate={{ width: barWidth }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      </span>
    </button>
  )
}
