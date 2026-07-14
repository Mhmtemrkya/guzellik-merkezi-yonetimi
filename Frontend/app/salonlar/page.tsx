'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  CalendarDays,
  ChevronRight,
  Eye,
  Flower2,
  Hand,
  HeartHandshake,
  LayoutGrid,
  Lock,
  MapPin,
  Palette,
  Scissors,
  Search,
  ShieldCheck,
  Sparkle,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { getPublicSalonFacets, listPublicSalons, type PublicSalonListItem } from '@/lib/publicSalonApi'
import PublicNavbar from '@/components/public/PublicNavbar'

const PAGE_SIZE = 12

/** Gerçek kategori adlarını bilinen ikonlarla eşler; eşleşmeyene Sparkle düşer. */
function categoryIcon(name: string): LucideIcon {
  const n = name.toLocaleLowerCase('tr-TR')
  if (n.includes('lazer')) return Zap
  if (n.includes('cilt')) return Sparkle
  if (n.includes('epilasyon') || n.includes('ağda')) return Sparkles
  if (n.includes('saç')) return Scissors
  if (n.includes('manikür') || n.includes('pedikür') || n.includes('tırnak')) return Hand
  if (n.includes('makyaj')) return Palette
  if (n.includes('kaş') || n.includes('kirpik')) return Eye
  return Sparkle
}

const TRUST_ITEMS = [
  { icon: ShieldCheck, title: 'Anında Onay', desc: 'Randevu taleplerin hızlıca onaylanır.' },
  { icon: Star, title: 'Gerçek Yorumlar', desc: 'Gerçek müşterilerin yorumlarını okuyun, bilinçli seçim yapın.' },
  { icon: CalendarDays, title: 'Online Randevu', desc: '7/24 online randevu al, planını kolayca yap.' },
  { icon: Lock, title: 'Güvenli İşlem', desc: 'Kişisel verileriniz ve ödemeleriniz güvenle korunur.' },
]

function StarRow({ value }: { value: number | null }) {
  const rounded = Math.round(value ?? 0)
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className="h-3.5 w-3.5"
          style={{ fill: i <= rounded ? '#f4a821' : '#ead9df', color: i <= rounded ? '#f4a821' : '#ead9df' }}
          strokeWidth={0}
        />
      ))}
    </span>
  )
}

function SalonCard({ salon, index }: { salon: PublicSalonListItem; index: number }) {
  const featured = Boolean(salon.isFeatured)
  const cats = salon.categories ?? []
  const shownCats = cats.slice(0, 3)
  const extra = cats.length - shownCats.length
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.06 * (index % 3), ease: [0.22, 1, 0.36, 1] }}
      className="group flex gap-4 rounded-[24px] border border-[#f3e2e9] bg-white p-3.5 shadow-[0_24px_54px_-44px_rgba(200,87,118,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_30px_64px_-40px_rgba(200,87,118,0.6)]"
    >
      {/* Foto */}
      <Link href={`/salon/${salon.slug}`} className="relative block h-44 w-36 shrink-0 overflow-hidden rounded-[18px] sm:w-44">
        {salon.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={salon.coverImage}
            alt={salon.name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#fde5ee] to-[#f6cbd9]">
            {salon.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={salon.logo} alt={`${salon.name} logosu`} className="h-full w-full object-cover" />
            ) : (
              <Flower2 className="h-9 w-9 text-[#df7c9c]" strokeWidth={1.5} />
            )}
          </div>
        )}
        {featured && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#e0517a] px-2.5 py-1 text-[9.5px] font-bold text-white shadow">
            <Star className="h-2.5 w-2.5" style={{ fill: '#fff' }} strokeWidth={0} /> Öne Çıkan
          </span>
        )}
      </Link>

      {/* Bilgi */}
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <Link href={`/salon/${salon.slug}`} className="flex items-center gap-2.5">
          {salon.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={salon.logo}
              alt={`${salon.name} logosu`}
              className="h-10 w-10 shrink-0 rounded-[12px] border border-[#f3e2e9] object-cover"
            />
          )}
          <h3 className="min-w-0 font-display text-[17px] leading-snug text-[#33212b] transition-colors group-hover:text-[#b2334f]">
            {salon.name}
          </h3>
        </Link>
        {salon.city && (
          <div className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-[#8a6a78]">
            <MapPin className="h-3 w-3 text-[#e0517a]" /> {salon.city}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <StarRow value={salon.salonAvg ?? salon.staffAvg} />
          <span className="text-[12.5px] font-bold text-[#33212b]">
            {(salon.salonAvg ?? salon.staffAvg)?.toFixed(1) ?? 'Yeni'}
          </span>
          {salon.reviewCount > 0 && <span className="text-[11px] text-[#9a8791]">({salon.reviewCount})</span>}
        </div>
        {shownCats.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {shownCats.map((c) => (
              <span key={c} className="rounded-full bg-[#fdeef3] px-2.5 py-1 text-[10px] font-semibold text-[#c85776]">
                {c}
              </span>
            ))}
            {extra > 0 && (
              <span className="rounded-full border border-[#f3e2e9] px-2 py-1 text-[10px] font-semibold text-[#9a8791]">
                +{extra}
              </span>
            )}
          </div>
        )}
        <div className="mt-auto pt-3">
          <Link
            href={`/salon/${salon.slug}`}
            className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full text-[12.5px] font-bold transition-all ${
              featured
                ? 'bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-white shadow-[0_14px_28px_-14px_rgba(224,81,122,0.9)] hover:opacity-92'
                : 'border border-[#f3c6d4] bg-white text-[#e0517a] hover:bg-[#fdeef3]'
            }`}
          >
            <CalendarDays className="h-4 w-4" /> Randevu Al
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

export default function SalonListPage() {
  const [items, setItems] = useState<PublicSalonListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')
  const [applied, setApplied] = useState({ q: '', city: '', category: '' })
  const [facets, setFacets] = useState<{ categories: string[]; cities: string[] }>({ categories: [], cities: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filtre seçenekleri gerçek veriden (yayındaki salonların kategori + şehirleri).
  useEffect(() => {
    void getPublicSalonFacets()
      .then(setFacets)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    void listPublicSalons({
      q: applied.q || undefined,
      city: applied.city || undefined,
      category: applied.category || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((list) => {
        setItems((prev) => (page === 1 ? list.items : [...prev, ...list.items]))
        setTotal(list.total)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Salonlar yüklenemedi.'))
      .finally(() => setLoading(false))
  }, [applied, page])

  const applyFilters = (nextCategory?: string): void => {
    setPage(1)
    setApplied({ q: q.trim(), city: city.trim(), category: nextCategory ?? category })
  }

  return (
    <main className="min-h-screen bg-[#fdf5f7] text-[#33212b]">
      <PublicNavbar />

      {/* HERO — arka plan görseli filtreleme kartını da kapsar */}
      <section
        className="relative overflow-hidden bg-cover"
        style={{ backgroundImage: "url('/salonlar-hero.png')", backgroundPosition: 'right top' }}
      >
        {/* Metin/filtre okunurluğu: soldan sağa yumuşak açık örtü */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#fdf5f7]/96 via-[#fdf5f7]/78 to-[#fdf5f7]/25"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[#fdf5f7]" />

        <div className="relative mx-auto max-w-7xl px-5 pb-8 pt-12 lg:pt-16">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.32em] text-[#e0517a]">
              <Sparkles className="h-3.5 w-3.5" /> Güzelliğe Giden Yol
            </div>
            <h1 className="mt-4 font-display text-[42px] leading-[1.06] tracking-tight text-[#231521] sm:text-[56px]">
              Salonunu seç, <span className="text-[#e0517a]">randevunu al</span>
            </h1>
            <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-[#6d5462]">
              Şehrindeki güzellik salonlarını keşfet, fotoğraflarına, hizmetlerine ve gerçek müşteri
              yorumlarına göz atıp saniyeler içinde online randevu talebi oluştur.
            </p>
          </motion.div>

          {/* ARAMA KARTI */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-8 rounded-[26px] border border-white/80 bg-white p-3 shadow-[0_30px_70px_-42px_rgba(200,87,118,0.55)] lg:max-w-5xl"
          >
            <div className="grid gap-2.5 md:grid-cols-[1.4fr_1fr_1fr_auto]">
              <label className="flex items-center gap-3 rounded-[18px] border border-[#f3e2e9] px-4 py-3 transition-colors focus-within:border-[#eba7bd]">
                <Search className="h-4 w-4 shrink-0 text-[#e0517a]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-[#33212b]">
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                      placeholder="Salon adı ara…"
                      className="w-full bg-transparent text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-[#33212b]/70"
                    />
                  </span>
                  <span className="block truncate text-[10.5px] text-[#9a8791]">Örn: Armonessa, Güzellik Merkezi</span>
                </span>
              </label>
              <label className="flex items-center gap-3 rounded-[18px] border border-[#f3e2e9] px-4 py-3 transition-colors focus-within:border-[#eba7bd]">
                <MapPin className="h-4 w-4 shrink-0 text-[#e0517a]" />
                <span className="min-w-0 flex-1">
                  <select
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value)
                      setPage(1)
                      setApplied((a) => ({ ...a, q: q.trim(), city: e.target.value }))
                    }}
                    className="w-full appearance-none bg-transparent text-[13px] font-semibold outline-none"
                  >
                    <option value="">Şehir</option>
                    {facets.cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="block truncate text-[10.5px] text-[#9a8791]">Konum seçin</span>
                </span>
              </label>
              <label className="flex items-center gap-3 rounded-[18px] border border-[#f3e2e9] px-4 py-3 transition-colors focus-within:border-[#eba7bd]">
                <Flower2 className="h-4 w-4 shrink-0 text-[#e0517a]" />
                <span className="min-w-0 flex-1">
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value)
                      applyFilters(e.target.value)
                    }}
                    className="w-full appearance-none bg-transparent text-[13px] font-semibold outline-none"
                  >
                    <option value="">Hizmet</option>
                    {facets.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="block truncate text-[10.5px] text-[#9a8791]">Hizmet seçin</span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => applyFilters()}
                className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-[18px] bg-gradient-to-r from-[#ef6f94] to-[#e0517a] px-8 text-[14px] font-bold text-white shadow-[0_18px_36px_-16px_rgba(224,81,122,0.9)] transition-opacity hover:opacity-92"
              >
                <Search className="h-4 w-4" /> Ara
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* KATEGORİ ÇİPLERİ */}
      <section id="kategoriler" className="mx-auto max-w-7xl px-5 pt-2">
        <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
          {[{ label: 'Tümü', value: '' }, ...facets.categories.map((c) => ({ label: c, value: c }))].map((c) => {
            const active = applied.category === c.value
            const Icon = c.value === '' ? LayoutGrid : categoryIcon(c.value)
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  setCategory(c.value)
                  applyFilters(c.value)
                }}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[12px] font-bold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-[#ef6f94] to-[#e0517a] text-white shadow-[0_12px_26px_-14px_rgba(224,81,122,0.9)]'
                    : 'border border-[#f3e2e9] bg-white text-[#4a3542] hover:border-[#eba7bd] hover:text-[#e0517a]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} /> {c.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* SALON LİSTESİ */}
      <section className="mx-auto max-w-7xl px-5 pb-8 pt-7">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[20px] text-[#231521]">
              <Sparkles className="h-4 w-4 text-[#e0517a]" /> Sizin için öne çıkan salonlar
            </h2>
            <p className="mt-0.5 text-[12px] text-[#8a6a78]">Kaliteli hizmet, mutlu müşteriler</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setQ('')
              setCity('')
              setCategory('')
              setPage(1)
              setApplied({ q: '', city: '', category: '' })
            }}
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-bold text-[#e0517a] transition-colors hover:text-[#b2334f]"
          >
            Tüm salonları gör <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="mx-auto mt-6 max-w-md rounded-[24px] border border-dashed border-[#f0d4de] bg-white/80 px-6 py-12 text-center">
            <div className="font-display text-[16px] text-[#33212b]">Salon bulunamadı</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#8a6a78]">
              Bu kriterlere uygun yayında salon yok. Farklı bir arama veya kategori deneyin.
            </p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((s, i) => (
            <SalonCard key={s.slug} salon={s} index={i} />
          ))}
          {loading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={`sk-${i}`} className="flex gap-4 rounded-[24px] border border-[#f3e2e9] bg-white p-3.5">
                <div className="h-44 w-40 animate-pulse rounded-[18px] bg-[#fbe9f0]" />
                <div className="flex-1 space-y-3 py-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-[#fbe9f0]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[#fbe9f0]" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-[#fbe9f0]" />
                </div>
              </div>
            ))}
        </div>

        {!loading && items.length < total && (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#f3c6d4] bg-white px-7 text-[12.5px] font-bold text-[#e0517a] transition-colors hover:bg-[#fdeef3]"
            >
              Daha Fazla Salon Gör ({total - items.length})
            </button>
          </div>
        )}
      </section>

      {/* GÜVEN ŞERİDİ */}
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="grid divide-y divide-[#f3e2e9] rounded-[26px] border border-[#f3e2e9] bg-white px-2 shadow-[0_24px_54px_-46px_rgba(200,87,118,0.55)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {TRUST_ITEMS.map((t) => {
            const Icon = t.icon
            return (
              <div key={t.title} className="flex items-start gap-3.5 px-5 py-6">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#fdeef3] text-[#e0517a]">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <div>
                  <div className="text-[13.5px] font-bold text-[#231521]">{t.title}</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[#8a6a78]">{t.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] font-semibold text-[#9a8791]">
          <HeartHandshake className="h-3.5 w-3.5 text-[#e0517a]" />
          BeautyAsist ile güzellik salonları tek çatı altında
        </div>
      </section>
    </main>
  )
}
