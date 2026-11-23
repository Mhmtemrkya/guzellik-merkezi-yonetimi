import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight, CalendarDays, ChartNoAxesCombined, Check, LockKeyhole, ShieldCheck, UsersRound, WalletCards } from 'lucide-react'
import FeatureHighlights from '@/components/landing/FeatureHighlights'
import PublicNavbar from '@/components/public/PublicNavbar'
import { administratorTools, categories, pages, staffRules, type CatalogEntry } from './catalog'
import CategoryBar from './CategoryBar'
import styles from './ModulesPage.module.css'
import RevealOnScroll from './RevealOnScroll'

export const metadata: Metadata = {
  title: 'Modüller ve yetkiler — BeautyAsist',
  description: 'BeautyAsist özellikleri ve modül kataloğu: WhatsApp bildirimleri, online randevu ve müşteri portalı, Excel’den veri aktarımı, her cihazda kullanım; randevu, danışan, seans, kasa, ekip ve Maydi modülleri ile personel işlem izinleri.',
}

const permissionTotal = pages.reduce((total, page) => total + page.actions.length, 0)

/** Bölüm panelindeki kısa açıklama (kategori kimliğine göre). */
const categoryLead: Record<string, string> = {
  planlama: 'Takvim, bekleme listesi ve danışan kartı tek akışta.',
  hizmetler: 'Hizmet kataloğu, seans takibi, dijital onam ve stok.',
  finans: 'Kasa, gün sonu, ön muhasebe ve raporlar.',
  buyume: 'Bildirimler, kampanyalar, hediye çekleri ve Maydi.',
  yonetim: 'Ekip, onaylar, şubeler ve kurum ayarları.',
}

function ModuleCard({ entry, featured }: { entry: CatalogEntry; featured: boolean }) {
  const Icon = entry.icon
  const isPermission = entry.kind === 'permission'
  const actions = isPermission ? entry.actions.map(({ label }) => label) : []
  const steps = isPermission ? [] : entry.steps

  return (
    <article className={styles.card} data-featured={featured || undefined} data-reveal>
      <div className={styles.cardTop}>
        <span className={styles.cardIcon}><Icon size={featured ? 26 : 22} strokeWidth={1.65} aria-hidden="true" /></span>
        {isPermission && entry.adminOnly ? (
          <span className={styles.cardBadge}><LockKeyhole size={12} aria-hidden="true" /> Yönetici alanı</span>
        ) : isPermission && actions.length > 0 ? (
          <span className={styles.cardBadge}>{actions.length} işlem izni</span>
        ) : null}
      </div>
      <h4>{entry.title}</h4>
      <p className={styles.cardSummary}>{entry.summary}</p>

      {actions.length > 0 && (
        <ul className={styles.chips} aria-label="İşlem izinleri">
          {actions.map(label => <li key={label}>{label}</li>)}
        </ul>
      )}
      {steps.length > 0 && (
        <ul className={styles.steps}>
          {steps.map(label => <li key={label}><Check size={14} aria-hidden="true" />{label}</li>)}
        </ul>
      )}
      {isPermission && actions.length === 0 && !entry.adminOnly && (
        <p className={styles.readAccess}><LockKeyhole size={13} aria-hidden="true" /> Görüntüleme için sayfa izni yeterlidir.</p>
      )}
    </article>
  )
}

export default function ModulesPage() {
  const barItems = categories.map(category => ({ id: `modul-${category.id}`, title: category.title, count: category.entries.length, tone: category.id }))

  return (
    <div id="moduller" className={styles.page}>
      <RevealOnScroll rootId="moduller" />
      <PublicNavbar />
      <main>
        <section className={styles.hero} aria-labelledby="modules-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>BeautyAsist modül kataloğu</p>
            <h1 id="modules-title">Bütün modüller.<br /><span>Tek yazılımda.</span></h1>
            <p className={styles.intro}>Randevu, danışan, kasa ve ekip yönetimi modüllerini keşfedin. Ekibinizin sayfa ve işlem izinlerini siz belirleyin.</p>
            <div className={styles.actions}>
              <a href="#katalog" className={styles.primary}>Modüllere göz atın <ArrowDown size={16} aria-hidden="true" /></a>
              <a href="#yetkiler" className={styles.secondary}>Yetkileri inceleyin <ArrowRight size={16} aria-hidden="true" /></a>
            </div>
          </div>
          <div className={styles.maydiStage}>
            <div className={styles.orbit} aria-hidden="true" />
            <span className={styles.orbitIcon} data-orbit="calendar" aria-hidden="true"><CalendarDays size={24} strokeWidth={1.55} /></span>
            <span className={styles.orbitIcon} data-orbit="wallet" aria-hidden="true"><WalletCards size={24} strokeWidth={1.55} /></span>
            <span className={styles.orbitIcon} data-orbit="reports" aria-hidden="true"><ChartNoAxesCombined size={24} strokeWidth={1.55} /></span>
            <Image src="/mascots/maydi/speaking.webp" alt="BeautyAsist’in yapay zekâ asistanı Maydi" width={256} height={320} unoptimized loading="eager" />
            <p>Maydi <span>Panel asistanınız</span></p>
          </div>
        </section>

        <FeatureHighlights />

        <section id="katalog" className={styles.catalog} aria-labelledby="catalog-title">
          <div className={`${styles.wide} ${styles.catalogIntro}`}>
            <h2 id="catalog-title">Salonunuzun bütün işleri, modül modül.</h2>
            <p>Kullanılabilir özellikler, paketinizde etkin olan modüllere ve hesabınızın rolüne göre değişir.</p>
          </div>

          <CategoryBar items={[...barItems, { id: 'yetkiler', title: 'Personel ve yetkiler', count: 2, tone: 'yetki' }]} />

          <div className={`${styles.wide} ${styles.chapters}`}>
            {categories.map(category => (
              <section id={`modul-${category.id}`} className={styles.chapter} data-tone={category.id} key={category.id} aria-labelledby={`title-${category.id}`}>
                <header className={styles.chapterPanel} data-reveal>
                  <p className={styles.chapterCount}>{category.entries.length} modül</p>
                  <h3 id={`title-${category.id}`}>{category.title}</h3>
                  {categoryLead[category.id] && <p className={styles.chapterLead}>{categoryLead[category.id]}</p>}
                </header>
                <div className={styles.bento}>
                  {category.entries.map((entry, index) => <ModuleCard key={entry.key} entry={entry} featured={index === 0} />)}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section id="yetkiler" className={`${styles.wide} ${styles.permissions}`} aria-labelledby="permissions-title">
          <header>
            <p className={styles.eyebrow}>{pages.length} sayfa izni · {permissionTotal} işlem izni</p>
            <h2 id="permissions-title">Kim neyi görecek, siz karar verin.</h2>
            <p>Sayfa izni görüntüleme erişimi verir. İşlem izinleri personelin o sayfada yapabileceği işlemleri belirler.</p>
          </header>
          <div className={styles.roles}>
            <article data-tone="planlama" data-reveal>
              <span className={styles.cardIcon}><ShieldCheck size={22} aria-hidden="true" /></span>
              <h3>Kurum yöneticisi</h3>
              <p>Modülleri yönetir, ekip izinlerini belirler ve onaya tabi işlemleri inceler.</p>
              <ul>{administratorTools.map(label => <li key={label}><Check size={15} aria-hidden="true" />{label}</li>)}</ul>
            </article>
            <article data-tone="hizmetler" data-reveal>
              <span className={styles.cardIcon}><UsersRound size={22} aria-hidden="true" /></span>
              <h3>Personel</h3>
              <p>Kendisine açılan şubelerde, atanmış sayfa ve işlem izinleriyle çalışır.</p>
              <ul>{staffRules.map(label => <li key={label}><Check size={15} aria-hidden="true" />{label}</li>)}</ul>
            </article>
          </div>
        </section>
      </main>

      <footer className={`${styles.wide} ${styles.footer}`}>
        <div>
          <h2>Salonunuzda deneyin, farkı görün.</h2>
          <p>Kurulum, veri aktarımı ve eğitim dahil. Ücretsiz deneme kredi kartı gerektirmez.</p>
        </div>
        <div className={styles.actions}>
          <Link href="/kayit" className={styles.primary}>14 gün ücretsiz deneyin <ArrowRight size={16} aria-hidden="true" /></Link>
          <Link href="/#fiyat" className={styles.secondary}>Fiyatlandırmayı görün</Link>
        </div>
      </footer>
    </div>
  )
}
