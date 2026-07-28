'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, CornerDownRight, Search } from 'lucide-react'
import { categoryOrderIndex } from '@/lib/apiMappers'

export type CategoryRailKind = 'category' | 'sub'

export interface CategoryRailItem {
  name: string
  count: number
  /** 'sub' = ALT kategori: rayda değil, seçili kategorinin altındaki ayrı şeritte çıkar. */
  kind?: CategoryRailKind
  /** Alt kategorinin üst kategori adı (ipucu metni). */
  parent?: string
  /** Kuruma özel kategori kaydının id'si (yalnız kayıtlılarda). */
  customId?: string
}

interface Props {
  /** Kategori + alt kategori ağacı — buildCatalogCategoryItems ile üretilir. */
  items: CategoryRailItem[]
  /** Seçili ÜST kategori adı; boş string = "Tümü". */
  value: string
  /** Seçili alt kategori adı; boş string = seçili kategorinin tamamı. */
  sub?: string
  /** Seçim değişti: (kategori, altKategori). Alt kategori her zaman bir kategoriye bağlıdır. */
  onChange: (category: string, sub: string) => void
  /** "Tümü" rozetindeki toplam kayıt sayısı. */
  total: number
  /** Ekran okuyucu etiketi için ("hizmet" / "paket"). */
  itemLabel?: string
}

/**
 * Kategori + ALT kategori ağacını tek listeye çevirir: her üst kategoriden sonra kendi alt
 * kategorileri gelir (`kind: 'sub'`, `parent` = üst kategori adı). Ray üst kategorileri
 * satırda, alt kategorileri seçili kategorinin altındaki şeritte çizer.
 *
 * Sayaçlar ayrı tutulur: üst kategori = KATEGORİSİ o olan kayıt sayısı, alt kategori = o
 * kategorideki ALT KATEGORİSİ o olan kayıt sayısı.
 */
export function buildCatalogCategoryItems(
  customCategories: { id: string; name: string; parentId?: string | null; sortOrder: number }[],
  rows: { category?: string | null; subCategory?: string | null }[],
  uncategorizedLabel = 'Kategorisiz',
): CategoryRailItem[] {
  const tops = customCategories.filter((c) => !c.parentId)
  const nameById = new Map(customCategories.map((c) => [c.id, c.name]))

  const topMap = new Map<string, CategoryRailItem>()
  const subMap = new Map<string, Map<string, CategoryRailItem>>()
  const touchTop = (name: string): CategoryRailItem => {
    if (!topMap.has(name)) topMap.set(name, { name, count: 0, kind: 'category' })
    return topMap.get(name)!
  }
  const touchSub = (parent: string, name: string): CategoryRailItem => {
    if (!subMap.has(parent)) subMap.set(parent, new Map())
    const bucket = subMap.get(parent)!
    if (!bucket.has(name)) bucket.set(name, { name, count: 0, kind: 'sub', parent })
    return bucket.get(name)!
  }

  for (const c of tops) touchTop(c.name).customId = c.id
  for (const c of customCategories) {
    if (!c.parentId) continue
    const parent = nameById.get(c.parentId)
    if (!parent) continue // üst kategorisi silinmiş öksüz kayıt — gösterilmez
    touchTop(parent)
    touchSub(parent, c.name).customId = c.id
  }
  for (const row of rows) {
    const category = (row.category || '').trim() || uncategorizedLabel
    touchTop(category).count++
    const sub = (row.subCategory || '').trim()
    if (sub) touchSub(category, sub).count++
  }

  const orderOf = categoryOrderIndex(tops)
  const ordered = [...topMap.values()].sort((a, b) =>
    orderOf(a.name) - orderOf(b.name) || b.count - a.count || a.name.localeCompare(b.name, 'tr'))

  const out: CategoryRailItem[] = []
  for (const category of ordered) {
    out.push(category)
    const bucket = subMap.get(category.name)
    if (!bucket) continue
    const subOrderOf = categoryOrderIndex(
      customCategories.filter((c) => c.parentId && nameById.get(c.parentId) === category.name),
    )
    out.push(...[...bucket.values()].sort((a, b) =>
      subOrderOf(a.name) - subOrderOf(b.name) || a.name.localeCompare(b.name, 'tr')))
  }
  return out
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
 *
 * 6. **Alt kategori rayda DEĞİL, altında.** Kategori kayıtlarının tamamı (alt kategoriler dâhil)
 *    düz biçimde aynı sıraya diziliyordu: "Bölgesel İncelme Alt kategori" ana kategori sanılıyor,
 *    sayacı hep 0 çıkıyor (hiçbir kaydın KATEGORİSİ o değil) ve tıklanınca liste boşalıyordu.
 *    Alt kategoriler artık yalnızca seçili kategorinin altındaki ayrı şeritte, farklı biçimde
 *    (yuvarlak çip) ve kendi sayacıyla çıkar; süzme alt kategori alanına göre yapılır.
 */
export default function CatalogCategoryRail({ items, value, sub = '', onChange, total, itemLabel = 'kayıt' }: Props) {
  // ÜST kategoriler rayda; alt kategoriler ASLA aynı sırada değil — seçili kategorinin
  // altında ayrı bir şeritte çıkar (bkz. tasarım notu 6).
  const topItems = useMemo(() => items.filter((i) => i.kind !== 'sub'), [items])
  const activeSubs = useMemo(
    () => (value ? items.filter((i) => i.kind === 'sub' && i.parent === value) : []),
    [items, value],
  )
  const activeCount = useMemo(() => topItems.find((i) => i.name === value)?.count ?? 0, [topItems, value])
  const rowRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState<number>(topItems.length)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  // Bar genişliği en kalabalık kategoriye göre ölçeklenir — küçükler tamamen kaybolmasın diye taban %8.
  const max = Math.max(1, ...topItems.map((i) => i.count))
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
      if (kids.length < topItems.length + 2) return

      const allWidth = kids[0]!.offsetWidth
      const moreWidth = kids[topItems.length + 1]!.offsetWidth
      const widths = topItems.map((_, i) => kids[i + 1]!.offsetWidth)

      // Önce hepsi "daha" butonu olmadan sığıyor mu?
      const totalAll = allWidth + widths.reduce((a, w) => a + w + GAP, 0)
      if (totalAll <= available) {
        setVisibleCount(topItems.length)
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
  }, [topItems])

  // Seçili kategori görünür kısma alınır (bkz. tasarım notu 4).
  const orderedItems = useMemo(() => {
    if (!value) return topItems
    const idx = topItems.findIndex((i) => i.name === value)
    if (idx < 0 || idx < visibleCount) return topItems
    const copy = topItems.slice()
    const [picked] = copy.splice(idx, 1)
    copy.splice(Math.max(0, visibleCount - 1), 0, picked!)
    return copy
  }, [topItems, value, visibleCount])

  const hiddenCount = Math.max(0, orderedItems.length - visibleCount)
  const shown = expanded ? orderedItems : orderedItems.slice(0, visibleCount)

  const filteredExpanded = useMemo(() => {
    if (!expanded || !query.trim()) return orderedItems
    const t = query.trim().toLocaleLowerCase('tr')
    return orderedItems.filter((i) => i.name.toLocaleLowerCase('tr').includes(t))
  }, [expanded, query, orderedItems])

  if (topItems.length === 0) return null

  const renderButton = (item: CategoryRailItem | 'all'): React.ReactElement => {
    if (item === 'all') {
      return <RailButton key="__all__" label="Tümü" count={total} active={!value} barWidth="100%" onClick={() => onChange('', '')} />
    }
    const active = value === item.name
    return (
      <RailButton
        key={item.name}
        label={item.name}
        count={item.count}
        active={active}
        title={`${item.name} · ${item.count}`}
        barWidth={barWidth(item.count)}
        // Aynı kategoriye tekrar tıklamak filtreyi kaldırır; kategori değişince alt seçim düşer.
        onClick={() => onChange(active ? '' : item.name, '')}
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
        {topItems.map((c) => (
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
      {expanded && topItems.length > SEARCH_THRESHOLD && (
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

      {/* ALT KATEGORİ ŞERİDİ — kategori satırının PARÇASI DEĞİL, altında ayrı bir kutu.
          Alt kategoriler kategorilerin yanına dizilince (aynı boy, aynı biçim) ana kategori
          sanılıyordu; burada hem ayrı bir zemin/çerçeve hem "‹kategori› alt kategorileri"
          başlığı hem de yuvarlak çip biçimi var — karıştırılması mümkün değil. */}
      <AnimatePresence initial={false}>
        {value && activeSubs.length > 0 && (
          <motion.div
            key={value}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              role="group"
              aria-label={`${value} alt kategorileri`}
              className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[12px] border border-[#f0dde5] bg-[#fffafc] px-3 py-2"
            >
              <span className="mr-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#b14d6c]">
                <CornerDownRight className="h-3.5 w-3.5" />
                {value} · alt kategoriler
              </span>
              <SubChip label="Tümü" count={activeCount} active={!sub} onClick={() => onChange(value, '')} />
              {activeSubs.map((s) => (
                <SubChip
                  key={s.name}
                  label={s.name}
                  count={s.count}
                  active={sub === s.name}
                  onClick={() => onChange(value, sub === s.name ? '' : s.name)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Alt kategori çipi — raydaki kategori düğmelerinden bilerek farklı biçim (yuvarlak, kenarlıklı). */
function SubChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} · ${count}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        active
          ? 'border-[#c85776] bg-[#c85776] text-white'
          : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0] hover:text-[#c85776]'
      }`}
    >
      <span className="whitespace-nowrap font-medium">{label}</span>
      <span className={`tabular-nums text-[10.5px] ${active ? 'text-white/75' : 'text-[#705a66]'}`}>{count}</span>
    </button>
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

/** Ray düğmesi — yalnızca ÜST kategoriler için (alt kategoriler SubChip ile çizilir). */
function RailButton({
  label,
  count,
  active,
  barWidth,
  onClick,
  title,
}: {
  label: string
  count: number
  active: boolean
  barWidth: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title ?? `${label} · ${count}`}
      className={`group shrink-0 rounded-[10px] px-2.5 py-1.5 text-left transition-colors ${
        active ? 'bg-[#fff1f6]' : 'hover:bg-[#fffafc]'
      }`}
    >
      <span className="flex items-baseline gap-1.5">
        <span
          className={`whitespace-nowrap text-[12px] font-medium ${
            active ? 'text-[#c85776]' : 'text-[#4a3a44] group-hover:text-[#c85776]'
          }`}
        >
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
