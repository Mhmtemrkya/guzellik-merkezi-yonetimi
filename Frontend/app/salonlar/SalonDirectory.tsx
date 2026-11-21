'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, ChevronDown, Flower2, MapPin,
  MessageSquare, Search, SlidersHorizontal, X,
} from 'lucide-react'
import SalonDirectoryCard from '@/components/public/SalonDirectoryCard'
import {
  getPublicSalonFacets,
  listPublicSalons,
  type PublicSalonFacets,
  type PublicSalonListItem,
} from '@/lib/publicSalonApi'
import styles from './salonlar.module.css'

const PAGE_SIZE = 12
const emptyFilters = { q: '', city: '', category: '' }
const emptyFacets: PublicSalonFacets = { cities: [], categories: [] }
const countFormatter = new Intl.NumberFormat('tr-TR')

const discoverySteps = [
  { title: 'Hizmetleri inceleyin', body: 'İhtiyacınıza uygun salonları şehir ve hizmete göre bulun.', icon: Search },
  { title: 'Yorumlara göz atın', body: 'Salon profillerinde paylaşılan müşteri deneyimlerini okuyun.', icon: MessageSquare },
  { title: 'Randevunuzu planlayın', body: 'Salonun profilinden hizmetinizi ve uygun saatinizi seçin.', icon: CalendarDays },
]

export default function SalonDirectory() {
  const [draft, setDraft] = useState(emptyFilters)
  const [search, setSearch] = useState({ ...emptyFilters, page: 1 })
  const [facets, setFacets] = useState(emptyFacets)
  const [facetsUnavailable, setFacetsUnavailable] = useState(false)
  const [items, setItems] = useState<PublicSalonListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const resultsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true
    void getPublicSalonFacets()
      .then((data) => { if (active) setFacets(data) })
      .catch(() => { if (active) setFacetsUnavailable(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void listPublicSalons({
      q: search.q || undefined,
      city: search.city || undefined,
      category: search.category || undefined,
      page: search.page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return
        setItems((previous) => search.page === 1
          ? result.items
          : [...previous, ...result.items.filter((item) => !previous.some(({ slug }) => slug === item.slug))])
        setTotal(result.total)
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search])

  function applyFilters(filters: typeof emptyFilters) {
    setDraft(filters)
    setLoading(true)
    setError(false)
    setItems([])
    setTotal(0)
    setSearch({ ...filters, q: filters.q.trim(), page: 1 })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyFilters(draft)
    resultsRef.current?.scrollIntoView({ block: 'start' })
  }

  function requestPage(page: number) {
    setLoading(true)
    setError(false)
    setSearch({ ...search, page })
  }

  const filtered = Boolean(search.q || search.city || search.category)
  const remaining = Math.max(0, total - items.length)
  const initialLoading = loading && search.page === 1

  return (
    <>
      <main id="salon-icerik" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="salon-title">
          <div className={styles.heroArt} aria-hidden="true">
            <Image src="/landing/salon-discovery.webp" alt="" fill sizes="100vw" preload />
          </div>
          <div className={styles.heroBody}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span /> BeautyAsist Salonlar</p>
              <h1 id="salon-title">Salonunuzu bulun.<br /><span>Randevu alın.</span></h1>
              <p>Şehrinizdeki güzellik salonlarını keşfedin, hizmetleri ve yorumları inceleyin, size uygun saate online randevu alın.</p>
            </div>

            <form className={styles.searchForm} role="search" aria-label="Salon ara" onSubmit={submit}>
              <label className={styles.field}>
                <Search size={19} aria-hidden="true" />
                <span>
                  <span>Salon adı</span>
                  <input type="search" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="Salon adıyla arayın" />
                </span>
              </label>
              <label className={styles.field}>
                <MapPin size={19} aria-hidden="true" />
                <span>
                  <span>Şehir</span>
                  <select value={draft.city} onChange={(event) => applyFilters({ ...draft, city: event.target.value })}>
                    <option value="">Tüm şehirler</option>
                    {facets.cities.map((city) => <option key={city}>{city}</option>)}
                  </select>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
              <label className={styles.field}>
                <Flower2 size={19} aria-hidden="true" />
                <span>
                  <span>Hizmet</span>
                  <select value={draft.category} onChange={(event) => applyFilters({ ...draft, category: event.target.value })}>
                    <option value="">Tüm hizmetler</option>
                    {facets.categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
              <button className={styles.searchButton} type="submit">Salon ara <ArrowRight size={17} aria-hidden="true" /></button>
            </form>
            {facetsUnavailable && <p className={styles.facetNote} role="status">Şehir ve hizmet seçenekleri yüklenemedi. Salon adıyla arayabilirsiniz.</p>}
          </div>
        </section>

        <section id="salon-sonuclari" className={styles.results} aria-labelledby="results-title" ref={resultsRef}>
          <div id="kategoriler" className={styles.categoryAnchor}>
            {facets.categories.length > 0 && (
              <div className={styles.categories} role="group" aria-label="Hizmete göre filtrele">
                <button type="button" aria-pressed={!search.category} onClick={() => applyFilters({ ...draft, category: '' })}>
                  <SlidersHorizontal size={15} aria-hidden="true" /> Tüm hizmetler
                </button>
                {facets.categories.map((category) => (
                  <button
                    type="button"
                    key={category}
                    aria-pressed={search.category === category}
                    onClick={() => applyFilters({ ...draft, category })}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </div>
          <header className={styles.resultsHeader}>
            <div>
              <h2 id="results-title">{filtered ? 'Arama sonuçları' : 'Salonları keşfedin'}</h2>
              <p className={styles.resultCount} role="status">
                {loading ? 'Salonlar yükleniyor…' : error ? 'Sonuçlar şu anda yüklenemedi.' : countFormatter.format(total) + ' salon'}
              </p>
            </div>
            {filtered && (
              <button className={styles.clear} type="button" onClick={() => applyFilters(emptyFilters)}>
                <X size={16} aria-hidden="true" /> Filtreleri temizle
              </button>
            )}
          </header>

          {(items.length > 0 || initialLoading) && (
            <div className={styles.cards} aria-busy={loading}>
              {items.map((salon) => <SalonDirectoryCard key={salon.slug} salon={salon} />)}
              {initialLoading && Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.skeleton} aria-hidden="true"><i /><i /><i /></div>
              ))}
            </div>
          )}

          {error && (
            <div className={styles.resultState}>
              <Search size={25} aria-hidden="true" />
              <div>
                <h3>{search.page === 1 ? 'Salonlar yüklenemedi.' : 'Diğer salonlar yüklenemedi.'}</h3>
                <p>Biraz sonra tekrar deneyin.</p>
              </div>
              <button type="button" className={styles.clear} onClick={() => requestPage(search.page)}>Tekrar dene <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className={styles.resultState}>
              <MapPin size={25} aria-hidden="true" />
              <div>
                <h3>{filtered ? 'Aramanıza uyan salon bulunamadı.' : 'Şu anda listelenecek salon yok.'}</h3>
                {filtered && <p>Farklı bir salon adı, şehir veya hizmet deneyin.</p>}
              </div>
              {filtered && <button type="button" className={styles.clear} onClick={() => applyFilters(emptyFilters)}>Tüm salonları gör <ArrowRight size={16} aria-hidden="true" /></button>}
            </div>
          )}

          {!error && remaining > 0 && (
            <button type="button" className={styles.loadMore} disabled={loading} onClick={() => requestPage(search.page + 1)}>
              {loading ? 'Yükleniyor…' : 'Daha fazla salon (' + countFormatter.format(remaining) + ')'}
              <ArrowDown size={17} aria-hidden="true" />
            </button>
          )}
        </section>

        <section className={styles.guide} aria-label="Online randevu adımları">
          {discoverySteps.map(({ title, body, icon: Icon }) => (
            <div key={title}>
              <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <p className={styles.eyebrow}><span /> İşletmeler için BeautyAsist</p>
          <h2>Salonunuz bu listede yer alsın.</h2>
          <p>Salon profilinizi ve hizmetlerinizi yayınlayın, online randevu almaya başlayın.</p>
        </div>
        <Link href="/kayit">BeautyAsist’e başvurun <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </footer>
    </>
  )
}
