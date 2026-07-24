'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Search } from 'lucide-react'

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
  /** Ekran okuyucu etiketi için ("hizmet" / "paket"). */
  itemLabel?: string
}

/** Bu sayıdan fazla kategori varsa açılan panelde arama kutusu çıkar. */
const SEARCH_THRESHOLD = 12
/** Öğeler arası boşluk (px) — ölçüm hesabı bunu bilmek zorunda (Tailwind gap-1). */
const GAP = 4

/**
 * Katalog kategori rayı — hizmet/paket kütüphanelerinde kategori filtresi.
 *
 * Tasarım kararları ve gerekçeleri:
 *
 * 1. **Durum sekmeleriyle karışmasın.** Kategoriler eskiden durum sekmeleriyle (Tümü/Aktif/Pasif)
 *    birebir aynı "kenarlıklı pill" dilini kullanıyordu; iki satır aynı görünüp farklı şey yapıyor,
 *    üstelik "Tümü" iki kez geçiyordu. Burada kenarlık yok, seçili olan dolu zeminle ayrışır.
 *
 * 2. **Taşanı gizlemek yerine katla.** İlk hâli yatay kaydırmalıydı ama kaydırma, sığdırmak değil
 *    görüş alanının dışına itmektir — 20 kategoride kullanıcı ne olduğunu göremez. Onun yerine
 *    satıra KAÇ TANE SIĞIYORSA o kadarı gösterilir, kalanı "+N daha" ile YERİNDE açılır.
 *
 * 3. **Sığan sayısı tahmin edilmez, ÖLÇÜLÜR.** Görünmez bir ölçüm katmanı her etiketin gerçek
 *    genişliğini verir (kategori adları çok değişken uzunlukta: "Göz" ile "Bölgesel İncelme").
 *    Sabit bir "6 tane göster" varsayımı dar ekranda taşar, geniş ekranda yer israf ederdi.
 *    Ölçüm katmanı hep TÜM öğeleri içerir; görünen sayı değiştikçe ölçüm değişmediği için
 *    "göster/gizle" salınımı (layout oscillation) oluşmaz.
 *
 * 4. **Seçili kategori asla saklanmaz.** Sıralamada geride kalsa bile seçiliyse görünür kısma alınır;
 *    aksi halde aktif filtre "+N daha"nın içinde kaybolur ve kullanıcı neye baktığını anlamaz.
 *
 * 5. **Pay barı.** Her kategori kendi payını gösteren ince bir bar taşır: kataloğun neye ağırlık
 *    verdiği (121 hizmetin 32'si lazer epilasyon) tek bakışta okunur.
 */
export default function CatalogCategoryRail({ items, value, onChange, total, itemLabel = 'kayıt' }: Props) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState<number>(items.length)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  // Bar genişliği en kalabalık kategoriye göre ölçeklenir — küçükler tamamen kaybolmasın diye taban %8.
  const max = Math.max(1, ...items.map((i) => i.count))
  const barWidth = (count: number): string => `${Math.max(8, Math.round((count / max) * 100))}%`

  // --- kaç tane sığıyor? ------------------------------------------------------
  // Ölçüm katmanının çocuk sırası: [0] "Tümü", [1..N] kategoriler, [N+1] "+N daha" butonu.
  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return

    const compute = (): void => {
      const available = row.clientWidth
      if (available <= 0) return
      const kids = Array.from(measure.children) as HTMLElement[]
      if (kids.length < items.length + 2) return

      const allWidth = kids[0]!.offsetWidth
      const moreWidth = kids[items.length + 1]!.offsetWidth
      const widths = items.map((_, i) => kids[i + 1]!.offsetWidth)

      // Önce hepsi "daha" butonu olmadan sığıyor mu?
      const totalAll = allWidth + widths.reduce((a, w) => a + w + GAP, 0)
      if (totalAll <= available) {
        setVisibleCount(items.length)
        return
      }

      // Sığmıyor → "+N daha" butonuna yer ayırarak greedy doldur.
      let used = allWidth + GAP + moreWidth
      let fit = 0
      for (const w of widths) {
        if (used + w + GAP > available) break
        used += w + GAP
        fit++
      }
      // En az bir kategori görünsün; aksi halde ray yalnız "Tümü" + "+N daha"ya düşer.
      setVisibleCount(Math.max(1, fit))
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(row)

    // Marka yazı tipi geç yüklenirse ilk ölçüm sistem fontuyla yapılır ve etiketler
    // gerçekte olduğundan dar/geniş görünür → yanlış sayıda kategori gösterilir.
    // Font yerleşince bir kez daha ölç. (ResizeObserver bunu yakalamaz: satır genişliği değişmez.)
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) compute()
    })

    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [items])

  // Seçili kategori görünür kısma alınır (bkz. tasarım notu 4).
  const orderedItems = useMemo(() => {
    if (!value) return items
    const idx = items.findIndex((i) => i.name === value)
    if (idx < visibleCount) return items
    const copy = items.slice()
    const [picked] = copy.splice(idx, 1)
    copy.splice(Math.max(0, visibleCount - 1), 0, picked!)
    return copy
  }, [items, value, visibleCount])

  const hiddenCount = Math.max(0, orderedItems.length - visibleCount)
  const shown = expanded ? orderedItems : orderedItems.slice(0, visibleCount)

  const filteredExpanded = useMemo(() => {
    if (!expanded || !query.trim()) return orderedItems
    const t = query.trim().toLocaleLowerCase('tr')
    return orderedItems.filter((i) => i.name.toLocaleLowerCase('tr').includes(t))
  }, [expanded, query, orderedItems])

  if (items.length === 0) return null

  const renderButton = (item: CategoryRailItem | 'all'): React.ReactElement => {
    const isAll = item === 'all'
    const label = isAll ? 'Tümü' : item.name
    const count = isAll ? total : item.count
    const active = isAll ? !value : value === item.name
    return (
      <RailButton
        key={isAll ? '__all__' : item.name}
        label={label}
        count={count}
        active={active}
        barWidth={isAll ? '100%' : barWidth(item.count)}
        onClick={() => onChange(isAll ? '' : value === item.name ? '' : item.name)}
      />
    )
  }

  return (
    <div className="relative mt-3">
      {/* ÖLÇÜM KATMANI — görünmez, tıklanamaz, akışta yer kaplamaz. Her zaman TÜM öğeleri
          içerir ki görünen sayı değişince ölçüm kaymasın (salınım olmaz).
          overflow-hidden ŞART: tek satırda 20+ kategori kapsayıcıdan taşar ve kırpılmazsa
          sayfaya yatay kaydırma çubuğu ekler. Kırpma yalnız boyamayı etkiler; çocuklar
          shrink-0 olduğu için offsetWidth doğal genişliği vermeye devam eder. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex flex-nowrap gap-1 overflow-hidden"
      >
        <RailButton label="Tümü" count={total} active={false} barWidth="100%" onClick={() => {}} />
        {items.map((c) => (
          <RailButton key={c.name} label={c.name} count={c.count} active={false} barWidth="100%" onClick={() => {}} />
        ))}
        <MoreButton hiddenCount={99} expanded={false} onClick={() => {}} />
      </div>

      <div
        ref={rowRef}
        role="group"
        aria-label={`Kategoriye göre ${itemLabel} filtresi`}
        className={`flex items-stretch gap-1 ${expanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}
      >
        {renderButton('all')}
        {!expanded && shown.map((c) => renderButton(c))}
        {expanded && filteredExpanded.map((c) => renderButton(c))}
        {(hiddenCount > 0 || expanded) && (
          <MoreButton
            hiddenCount={hiddenCount}
            expanded={expanded}
            onClick={() => {
              setExpanded((v) => !v)
              setQuery('')
            }}
          />
        )}
      </div>

      {/* Çok kategori varsa açık panelde arama — 25 kategoride göz taraması yorucu olur. */}
      {expanded && items.length > SEARCH_THRESHOLD && (
        <div className="relative mt-2 w-full max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kategori ara…"
            className="w-full rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
          />
        </div>
      )}
    </div>
  )
}

function MoreButton({ hiddenCount, expanded, onClick }: { hiddenCount: number; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="group shrink-0 rounded-[10px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#fffafc]"
    >
      <span className="flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-[#c85776]">
        {expanded ? 'Daha az' : `+${hiddenCount} daha`}
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={2} />
      </span>
      {/* Diğer öğelerle aynı yüksekliği korumak için bar yuvası (görünmez). */}
      <span aria-hidden className="mt-1 block h-[3px] w-full rounded-full bg-transparent" />
    </button>
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
