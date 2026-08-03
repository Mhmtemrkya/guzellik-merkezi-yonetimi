import Image from 'next/image'
import Link from 'next/link'
import CountUp from '@/components/landing/CountUp'
import ProductTour from '@/components/landing/ProductTour'
import Reveal from '@/components/landing/Reveal'
import StickyTour from '@/components/landing/StickyTour'
import { HeroStage, HeroWords } from '@/components/landing/HeroStage'
import { Magnetic, ScrollProgress, Spotlight } from '@/components/landing/Interactions'
import LiveEvents from '@/components/landing/LiveEvents'
import { fetchPublicPlans, planFeatureLabels, planLimitLabels, type PublicPlan } from '@/lib/landingPlans'
import {
  ArrowRight, BarChart3, BellRing, Boxes, CalendarDays, CalendarPlus, Check, ClipboardList,
  CreditCard, FileBarChart, Globe, Landmark, Layers, MessageCircle, Package, PlayCircle, Quote,
  ShieldCheck, Sparkles, Star, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react'

/** Paket kataloğu ISR ile tazelenir: platformda plan güncellenince tanıtım sayfası da güncellenir. */
export const revalidate = 300

/**
 * TANITIM SAYFASI.
 *
 * DİL: Apple'ın ürün sayfaları — dev tipografi, kenardan kenara görseller, sahne sahne açılan
 * bölümler, kaydırmaya bağlı sinematik hareket. Renk ve yüzeyler panelden gelir (#FFF7FA zemin,
 * #EF6F94 aksan, blush tonlar) ki tanıtımdan panele geçen kullanıcı aynı ürünün içinde kalsın.
 *
 * HAREKET İLKESİ — İÇERİK ASLA HAREKETE BAĞLI DEĞİLDİR:
 *   · `Reveal` gizlemeyi yalnız JavaScript çalışınca uygular (bkz. .landing-js kuralı).
 *   · `cine-*` sınıfları CSS scroll-driven animasyondur, `@supports` ile korunur.
 * Script yüklenmezse ya da tarayıcı desteklemezse sayfa statik ama TAM okunur kalır.
 *
 * ÖRNEK VERİ UYARISI: sayaçlar, referans salon adları ve yorumlar TEMSİLİDİR; yayına almadan
 * önce gerçek rakam ve referanslarla değiştirilmelidir.
 */

const stats = [
  { value: 2350, suffix: '+', label: 'Aktif merkez' },
  { value: 620000, suffix: '+', label: 'Aylık randevu' },
  { value: 78, prefix: '%', label: 'Otomasyon oranı' },
] as const

const clients = ['Lale Güzellik', 'Bella Vita', 'Derma Luxe', 'Mona Güzellik', 'Viva Estetik', 'Silk Touch', 'Rönesans', 'Aura Beauty']

interface ModuleItem { title: string; body: string; icon: LucideIcon }

/**
 * Kurum yöneticisi panelindeki GERÇEK modüller (bkz. QuickMenu / Sidebar rotaları).
 * Vitrinde olmayan bir özellik vaat edilmez; her satırın panelde bir karşılığı vardır.
 */
const modules: ModuleItem[] = [
  { title: 'Randevular', body: 'Günlük ajanda, haftalık ve aylık takvim. Uzman, oda ve saat çakışması engellenir; iptal olan slot bekleme listesinden kendiliğinden dolar.', icon: CalendarDays },
  { title: 'Müşteriler', body: 'Paket, borç, seans, not, konsültasyon ve onam formu ile önce/sonra fotoğrafları tek danışan kartında toplanır.', icon: Users },
  { title: 'Paket & hizmet', body: 'Hizmet, paket ve kampanya tanımlanır. Randevu tamamlanınca doğru paketten otomatik seans düşer.', icon: Package },
  { title: 'Ön muhasebe', body: 'Cari hesap, taksit planı ve tahsilat dağıtımı. Satış iptali arşive taşınır, tahsilat defteri korunur.', icon: Landmark },
  { title: 'Adisyon', body: 'Hizmet, ürün ve paket satışı tek fişte. Onayda stok düşer, prim tahakkuk eder, sadakat puanı işlenir.', icon: ClipboardList },
  { title: 'Günlük kasa', body: 'Nakit, kart ve havale ayrı ayrı toplanır; gün sonu kapanışı sayımla doğrulanır ve kilitlenir.', icon: Wallet },
  { title: 'Stok & ürün', body: 'Ürün giriş-çıkışı, kritik seviye uyarısı ve hareket geçmişi. Satış anında stoktan otomatik düşer.', icon: Boxes },
  { title: 'Personel', body: 'İki seviyeli yetki (sayfa + işlem), prim hesabı, çalışma çizelgesi, performans ve müşteri yıldızı.', icon: UserCog },
  { title: 'Raporlar', body: 'Dokuz sekmeli analiz: gelir-gider, hizmet ve personel kırılımı, kim sattı–kim uyguladı, dönem karşılaştırma.', icon: FileBarChart },
  { title: 'Bildirimler', body: 'WhatsApp hatırlatma ve iki yönlü onay, SMS ve e-posta; randevu, tahsilat ve doğum günü akışları.', icon: BellRing },
  { title: 'Online randevu', body: 'Danışanlarınız kendi sayfanızdan 7/24 randevu alır, kalan seansını görür; talep onay kutunuza düşer.', icon: Globe },
  { title: 'Onaylar', body: 'Personelin yazma işlemleri taslağa düşer, yönetici onayıyla uygulanır. Her adım denetim kaydına yazılır.', icon: ShieldCheck },
]

const steps = [
  { title: 'Merkezinizi kurun', body: 'Kurum bilgileri, şubeler ve kullanıcılar tanımlanır. Mevcut danışan kayıtlarınızı biz aktarırız.' },
  { title: 'Hizmetlerinizi ekleyin', body: 'Hizmet, paket ve fiyatlar girilir; online randevuya açılacak olanlar seçilir.' },
  { title: 'Randevuları açın', body: 'Danışanlar portalden randevu alır, WhatsApp hatırlatmasıyla onay süreci yürür.' },
  { title: 'Tahsilat ve raporlar', body: 'Ödemeler tek hesapta toplanır, gün sonu kapanır, aylık rapor kendiliğinden oluşur.' },
]

/** Türk Lirası biçimi — kuruş göstermeden, binlik ayraçlı. */
const tl = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`

const testimonials = [
  { quote: 'Randevu karışıklığı bitti. Danışanlar 7/24 online randevu alabiliyor, WhatsApp hatırlatmaları sayesinde gelmeyen danışan oranımız belirgin şekilde azaldı.', name: 'Lale Güzellik Merkezi', city: 'İzmir' },
  { quote: 'Rapor ve paket takibi çok net. Gelirimizi, kalan seansları ve stoğu tek yerden görüyoruz; gün sonunda kasa tutuyor mu tutmuyor mu hemen belli oluyor.', name: 'Mona Güzellik', city: 'Ankara' },
]

export default async function LandingPage() {
  // Fiyat bölümü platformdaki GERÇEK paketlerden beslenir; backend kapalıysa null döner ve
  // sayfa fiyatsız "teklif iste" akışına düşer (bkz. Pricing).
  const plans = await fetchPublicPlans()

  // Kök sarmalayıcıda overflow-x: CLIP (hidden DEĞİL). `overflow-x: hidden` tarayıcıda karşı
  // ekseni otomatik `auto` yapar ve yeni bir kaydırma bağlamı doğurur; bu da içerideki
  // `position: sticky` öğelerini sessizce devre dışı bırakır — ürün turunun sabitlenen ekranı
  // tam bu yüzden kayboluyordu. `clip` taşmayı aynı şekilde keser ama kaydırma bağlamı üretmez.
  return (
    <div className="min-h-screen overflow-x-clip bg-[#FFF7FA] text-[#352432] antialiased">
      <ScrollProgress />
      <SiteNav />
      <main>
        <Hero />
        <ClientStrip />
        <ImageStatement />
        <StickyTour />
        <Modules />
        <SplitStatement />
        <Steps />
        <Pricing plans={plans} />
        <Testimonials />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function SiteNav() {
  const links = [
    { href: '#tur', label: 'Ürün turu' },
    { href: '#moduller', label: 'Modüller' },
    { href: '#nasil', label: 'Nasıl çalışır' },
    { href: '#fiyat', label: 'Fiyatlandırma' },
    { href: '#referans', label: 'Referanslar' },
  ]
  return (
    <header className="sticky top-0 z-50 border-b border-[#F2DFE7]/80 bg-[#FFF7FA]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={44} height={44} priority className="h-11 w-11 object-contain" />
          <span className="text-[16.5px] font-semibold tracking-[-0.015em]">BeautyAsist</span>
        </Link>

        <nav className="hidden items-center gap-8 text-[12.5px] text-[#4A3A44] lg:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-[#EF6F94]">{l.label}</a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/login" className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-[#4A3A44] transition-colors hover:text-[#EF6F94]">
            Giriş
          </Link>
          {/* Danışan tarafı: önce salon vitrini — ziyaretçi merkezi seçer, randevuyu oradan alır. */}
          <Link href="/salonlar" className="whitespace-nowrap rounded-full border border-[#EEC9D7] bg-white px-3.5 py-1.5 text-[12.5px] text-[#4A3A44] transition-colors hover:border-[#EF6F94]">
            Randevu<span className="hidden sm:inline"> al</span>
          </Link>
          <a href="#fiyat" className="whitespace-nowrap rounded-full bg-[#EF6F94] px-4 py-1.5 text-[12.5px] font-medium text-white transition-transform hover:-translate-y-px">
            Demo<span className="hidden sm:inline"> talep et</span>
          </a>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Zeminde yavaşça sürüklenen renk bulutları — sakin canlılık, dikkat çalmaz. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bloom absolute -top-40 left-[22%] h-[620px] w-[620px] rounded-full bg-[#FFDCE8]/60 blur-[130px]" />
        <div className="bloom-slow absolute -top-24 right-[6%] h-[520px] w-[520px] rounded-full bg-[#FFECF2]/85 blur-[120px]" />
        <div className="bloom absolute top-[42%] left-[4%] h-[380px] w-[380px] rounded-full bg-[#F7C7D8]/40 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-5 pb-8 pt-14 sm:px-8 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,296px)]">
          <div className="text-center lg:text-left">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#EEC9D7] bg-white/85 px-3.5 py-1.5 text-[12px] font-medium text-[#8E3F5B] backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#EF6F94] opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#EF6F94]" />
                </span>
                Güzellik merkezlerinin büyüme ortağı
              </span>
            </Reveal>

            <h1 className="display-xl mx-auto mt-6 max-w-[15ch] text-[#352432] lg:mx-0">
              <HeroWords text="Merkeziniz büyür." />
              <br />
              <span className="text-[#EF6F94]">
                <HeroWords text="Kaosu büyümez." delay={0.34} />
              </span>
            </h1>

            <Reveal delay={200}>
              <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-relaxed text-[#4A3A44] lg:mx-0">
                Randevu, danışan, paket seansı, stok, tahsilat ve raporlar tek panelde. Boş kalan
                saat kendiliğinden dolar, biten seans otomatik düşer, gün sonunda hesap tutar.
              </p>
            </Reveal>

            <Reveal delay={260}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <Magnetic>
                  <a
                    href="#fiyat"
                    className="inline-flex items-center gap-2 rounded-full bg-[#EF6F94] px-7 py-3.5 text-[15px] font-medium text-white shadow-[0_20px_44px_-18px_rgba(239,111,148,0.95)] transition-shadow duration-300 hover:shadow-[0_28px_56px_-16px_rgba(239,111,148,1)]"
                  >
                    Ücretsiz demo al <ArrowRight className="h-4 w-4" />
                  </a>
                </Magnetic>
                <Magnetic>
                  <a
                    href="#tur"
                    className="inline-flex items-center gap-2 rounded-full border border-[#EEC9D7] bg-white/90 px-7 py-3.5 text-[15px] text-[#4A3A44] backdrop-blur transition-colors hover:border-[#EF6F94]"
                  >
                    <PlayCircle className="h-4 w-4 text-[#EF6F94]" /> Ürün turunu izle
                  </a>
                </Magnetic>
              </div>
            </Reveal>

            <Reveal delay={300}>
              {/* Danışan yolu: bu sayfaya merkez sahibi de danışan da gelir. */}
              <p className="mt-5 text-[13px] text-[#705A66]">
                Bir merkezden randevu almak mı istiyorsunuz?{' '}
                <Link href="/salonlar" className="font-medium text-[#EF6F94] underline-offset-4 hover:underline">
                  Salonları görün
                </Link>
              </p>
            </Reveal>

            <Reveal delay={340}>
              <dl className="mt-9 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 lg:justify-start">
                {stats.map((s) => (
                  <div key={s.label} className="text-center lg:text-left">
                    <dt className="sr-only">{s.label}</dt>
                    <dd>
                      <span className="block text-[27px] font-semibold tracking-[-0.03em] text-[#352432]">
                        <CountUp value={s.value} prefix={'prefix' in s ? s.prefix : ''} suffix={'suffix' in s ? s.suffix : ''} />
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[#705A66]">{s.label}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* Canlı olay akışı — ürünün gerçekten ürettiği olaylar, olurken. */}
          <Reveal delay={240} className="hidden lg:block">
            <div className="soft-float">
              <LiveEvents />
            </div>
          </Reveal>
        </div>
      </div>

      {/* Ürün ekranı — sahneye yatık girer, kaydırdıkça doğrulup karşınıza dikilir. */}
      <div className="relative mx-auto max-w-[1080px] px-5 pb-20 sm:px-8">
        <HeroStage>
          <ProductTour />
        </HeroStage>
      </div>
    </section>
  )
}

function ClientStrip() {
  const row = [...clients, ...clients]
  return (
    <section className="border-y border-[#F2DFE7] bg-white/60 py-9">
      <p className="px-5 text-center text-[12.5px] text-[#705A66]">
        Türkiye’nin dört bir yanındaki güzellik merkezleri BeautyAsist ile çalışıyor
      </p>
      <div className="landing-marquee mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="landing-marquee-track flex w-max items-center gap-14 px-6">
          {row.map((name, i) => (
            <span key={`${name}-${i}`} className="whitespace-nowrap font-display text-[18px] tracking-[-0.02em] text-[#B79AA6] transition-colors hover:text-[#8E3F5B]">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Kenardan kenara görsel + üstünde tek cümlelik iddia.
 * Fotoğraf sayfadan yavaş kayar (parallax) → derinlik.
 */
function ImageStatement() {
  return (
    <section className="relative h-[78vh] min-h-[460px] overflow-hidden">
      <div className="absolute inset-0 scale-[1.14]">
        <div className="cine-parallax relative h-full w-full">
          <Image
            src="/landing/resepsiyon.webp"
            alt="Modern bir güzellik merkezinin resepsiyonunda danışanı karşılayan uzman"
            fill
            sizes="100vw"
            className="object-cover"
            priority={false}
          />
        </div>
      </div>
      {/* Metnin okunması için ölçülü bir örtü — görseli boğmaz. */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#2A1320]/70 via-[#2A1320]/35 to-transparent" />

      <div className="relative mx-auto flex h-full max-w-[1200px] items-center px-5 sm:px-8">
        <Reveal>
          <div className="max-w-[36ch]">
            <h2 className="display-lg text-white">Danışanınız kapıdan girdiğinde her şey hazır.</h2>
            <p className="mt-5 max-w-[44ch] text-[16.5px] leading-relaxed text-white/90">
              Geçmişi, paketi, kalan seansı ve borcu tek ekranda. Karşılama, aramayla değil bakışla başlar.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/**
 * İki yönlü anlatı: solda danışanın telefonu (online randevu), sağda uzmanın tableti (panel).
 * Görseller kaydırma ile ölçeklenir; metin katmanı üstte kalır.
 */
function SplitStatement() {
  const items = [
    {
      src: '/landing/danisan-telefon.webp',
      alt: 'Bekleme alanında telefonundan randevu alan danışan',
      eyebrow: 'Danışan tarafı',
      title: 'Telefonundan randevu alır.',
      body: 'Kendi sayfanızdan uygun saati seçer, kalan seansını görür. Hatırlatma WhatsApp’tan gider; “Evet” yanıtı randevuyu onaylar.',
      href: '/salonlar',
      cta: 'Salonları görün',
    },
    {
      src: '/landing/tablet.webp',
      alt: 'Resepsiyonda tabletten paneli kullanan uzman',
      eyebrow: 'Merkez tarafı',
      title: 'Siz paneli açarsınız.',
      body: 'Gün, danışan geçmişi, kalan seans ve kasa aynı ekranda. Tablet, masaüstü ve telefonda aynı veriyle çalışır.',
      href: '#tur',
      cta: 'Ürün turunu izleyin',
    },
  ]

  return (
    <section className="px-5 py-6 sm:px-8">
      <div className="mx-auto grid max-w-[1200px] gap-4 lg:grid-cols-2">
        {items.map((it, i) => (
          <Reveal key={it.title} delay={i * 90}>
            <article className="group relative h-[440px] overflow-hidden rounded-[22px] sm:h-[520px]">
              <div className="absolute inset-0">
                <Image
                  src={it.src}
                  alt={it.alt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover object-center transition-transform duration-[1200ms] group-hover:scale-[1.05]"
                />
              </div>
              {/* Örtü yalnız ALT ÜÇTE BİRDE yoğunlaşır: metin okunur kalır, fotoğrafın üst
                  bölümü (yüz, ortam) kararmaz. Tam yükseklikte degrade görseli boğuyordu. */}
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#2A1320]/88 via-[#2A1320]/45 to-transparent" />

              <div className="relative flex h-full flex-col justify-end p-6 sm:p-8">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFDCE8]">{it.eyebrow}</span>
                <h3 className="mt-2.5 font-display text-[26px] leading-[1.1] tracking-[-0.03em] text-white sm:text-[32px]">{it.title}</h3>
                <p className="mt-3 max-w-[42ch] text-[14.5px] leading-relaxed text-white/90">{it.body}</p>
                <Link
                  href={it.href}
                  className="mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-white/95 px-5 py-2.5 text-[13.5px] font-medium text-[#8E3F5B] transition-transform hover:-translate-y-0.5"
                >
                  {it.cta} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-[64ch] text-center">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#EF6F94]">{eyebrow}</span>
      <h2 className="display-lg mt-4 text-[#352432]">{title}</h2>
      {body && <p className="mt-4 text-[16px] leading-relaxed text-[#4A3A44]">{body}</p>}
    </div>
  )
}

function Modules() {
  return (
    <section id="moduller" className="scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead
            eyebrow="Tüm ihtiyaçlarınız tek platformda"
            title="Eksiksiz modüller, tek veri."
            body="Randevudan tahsilata bütün operasyon aynı veri üzerinde çalışır; modüller arası kopukluk olmaz."
          />
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => (
            <Reveal key={m.title} delay={(i % 3) * 70}>
              <Spotlight className="h-full">
                <article className="group relative h-full overflow-hidden rounded-[20px] border border-[#EEC9D7] bg-white p-6 transition-all duration-500 hover:-translate-y-1.5 hover:border-[#EF6F94] hover:shadow-[0_30px_66px_-40px_rgba(150,78,104,0.7)]">
                  <span className="relative z-[2] grid h-11 w-11 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94] transition-colors duration-500 group-hover:bg-[#EF6F94] group-hover:text-white">
                    <m.icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <h3 className="relative z-[2] mt-5 text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">{m.title}</h3>
                  <p className="relative z-[2] mt-2.5 text-[13.5px] leading-relaxed text-[#705A66]">{m.body}</p>
                </article>
              </Spotlight>
            </Reveal>
          ))}
        </div>

        <Reveal delay={80}>
          <p className="mt-8 text-center text-[13px] text-[#705A66]">
            Hepsi kurum yöneticisi panelinde hazır — ayrı ayrı satın alınan eklentiler değil.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function Steps() {
  return (
    <section id="nasil" className="scroll-mt-16 border-y border-[#F2DFE7] bg-[#FFF0F5] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead eyebrow="Nasıl çalışır" title="4 adımda merkezinizi dijitale taşıyın" />
        </Reveal>

        <Reveal delay={60}>
          <div className="mx-auto mt-11 max-w-[760px] overflow-hidden rounded-[22px]">
            <div className="cine-zoom relative h-[220px] w-full sm:h-[280px]">
              <Image
                src="/landing/bakim.webp"
                alt="Güzellik merkezinde uygulanan bir cilt bakımı"
                fill
                sizes="(max-width: 760px) 100vw, 760px"
                className="object-cover"
              />
            </div>
          </div>
        </Reveal>

        <div className="relative mt-12">
          <div aria-hidden className="absolute left-0 right-0 top-5 hidden h-px bg-[#EEC9D7] lg:block" />
          <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {steps.map((s, i) => (
              <Reveal key={s.title} as="li" delay={i * 90}>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-[#EEC9D7] bg-white text-[14px] font-semibold text-[#EF6F94]">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">{s.title}</h3>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-[#705A66]">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

/**
 * Fiyat bölümü — platformdaki gerçek paketlerden üretilir.
 * `plans` null ise (backend kapalı ya da tanımlı ücretli paket yok) fiyat yerine teklif akışı gösterilir.
 */
function Pricing({ plans }: { plans: PublicPlan[] | null }) {
  // Vitrinde en fazla dört paket (kataloğun tamamı daha fazlaysa ilk dördü): beşinci kart
  // ızgarayı sıkıştırıp okunurluğu düşürüyor.
  const shown = plans?.slice(0, 4) ?? []
  // Öne çıkan: ortadan bir üst basamak — "büyüyen merkez" alıcısının tipik seçimi.
  const featuredIndex = shown.length >= 3 ? 1 : shown.length - 1

  return (
    <section id="fiyat" className="scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead
            eyebrow="Fiyatlandırma"
            title="Merkezinize göre bir plan."
            body="Kurulum, veri aktarımı ve eğitim bizde. Planınızı istediğiniz zaman yükseltebilirsiniz."
          />
        </Reveal>

        {shown.length === 0 ? (
          <Reveal delay={80}>
            <div className="mx-auto mt-12 max-w-[560px] rounded-[20px] border border-[#EEC9D7] bg-white p-8 text-center">
              <h3 className="font-display text-[19px] tracking-[-0.02em] text-[#352432]">Size özel teklif hazırlayalım</h3>
              <p className="mx-auto mt-3 max-w-[46ch] text-[14px] leading-relaxed text-[#4A3A44]">
                Paket, şube ve kullanıcı sayınıza göre belirlenir. Merkezinizin ölçüsünü paylaşın,
                uygun planı fiyatıyla birlikte gönderelim.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#EF6F94] px-6 py-3 text-[14.5px] font-medium text-white transition-transform hover:-translate-y-0.5"
              >
                Teklif iste <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        ) : (
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((p, i) => {
              const featured = i === featuredIndex
              const rows = [...planLimitLabels(p), ...planFeatureLabels(p.features, 4)]
              const yearlyPerMonth = p.yearlyPriceTRY > 0 ? p.yearlyPriceTRY / 12 : 0
              return (
                <Reveal key={p.id} delay={i * 80}>
                  <article
                    className={`relative flex h-full flex-col rounded-[20px] border p-6 transition-all duration-500 hover:-translate-y-1.5 ${
                      featured
                        ? 'border-[#EF6F94] bg-white shadow-[0_34px_78px_-44px_rgba(239,111,148,0.9)]'
                        : 'border-[#EEC9D7] bg-white hover:border-[#EF6F94]'
                    }`}
                  >
                    {featured && (
                      <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-[#EF6F94] px-3 py-1 text-[10.5px] font-medium text-white">
                        <Star className="h-3 w-3" /> En çok tercih edilen
                      </span>
                    )}
                    <h3 className="text-[16.5px] font-semibold tracking-[-0.015em] text-[#352432]">{p.name}</h3>
                    {p.description && <p className="mt-1 text-[12px] leading-relaxed text-[#705A66]">{p.description}</p>}

                    <div className="mt-5 flex items-baseline gap-1">
                      <span className="text-[36px] font-semibold tabular-nums tracking-[-0.035em] text-[#352432]">
                        {tl(p.monthlyPriceTRY)}
                      </span>
                      <span className="text-[13px] text-[#705A66]">/ay</span>
                    </div>
                    {yearlyPerMonth > 0 && yearlyPerMonth < p.monthlyPriceTRY && (
                      <p className="mt-1 text-[11.5px] text-[#8E3F5B]">
                        Yıllık ödemede {tl(yearlyPerMonth)}/ay
                      </p>
                    )}

                    <ul className="mt-6 flex-1 space-y-2.5">
                      {rows.map((f) => (
                        <li key={f} className="flex gap-2.5 text-[13px] text-[#4A3A44]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={2.2} />
                          {f}
                        </li>
                      ))}
                    </ul>

                    <Link
                      href="/login"
                      className={`mt-7 block rounded-full px-5 py-3 text-center text-[14px] font-medium transition-transform hover:-translate-y-px ${
                        featured ? 'bg-[#EF6F94] text-white' : 'border border-[#EEC9D7] bg-white text-[#4A3A44] hover:border-[#EF6F94]'
                      }`}
                    >
                      Planı seç
                    </Link>
                  </article>
                </Reveal>
              )
            })}

          </div>
        )}

        {shown.length > 0 && (
          <Reveal delay={120}>
            <aside className="mt-4 grid gap-6 rounded-[20px] border border-[#EEC9D7] bg-[#FFF0F5] p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <h3 className="font-display text-[17px] leading-snug tracking-[-0.02em] text-[#352432]">Yatırımınızın gerçek getirisi</h3>
                <ul className="mt-4 flex flex-wrap gap-x-7 gap-y-2.5">
                  {['Telefon trafiği azalır', 'Gelmeyen danışan oranı düşer', 'Operasyon hızlanır', 'Kasa gün sonunda tutar'].map((t) => (
                    <li key={t} className="flex gap-2.5 text-[12.5px] text-[#4A3A44]">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EF6F94]" strokeWidth={2.4} />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[16px] border border-[#EEC9D7] bg-white px-6 py-4 text-center lg:min-w-[190px]">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[#705A66]">Ortalama geri dönüş</div>
                <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-[#EF6F94]">3–6 ay</div>
              </div>
            </aside>
          </Reveal>
        )}

        <Reveal delay={80}>
          <p className="mt-7 text-center text-[12.5px] text-[#705A66]">
            Kurulum bir kereliktir: hesap açılışı, kullanıcılar, paket tanımları ve online eğitim dahil.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function Testimonials() {
  return (
    <section id="referans" className="scroll-mt-16 border-y border-[#F2DFE7] bg-white/60 px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead eyebrow="Referanslar" title="Kullanıcılarımız ne diyor?" />
        </Reveal>

        {/* Ekip fotoğrafı — referansların insan yüzü. Kaydırmayla kadraja oturur. */}
        <Reveal delay={60}>
          <div className="mt-12 overflow-hidden rounded-[22px]">
            <div className="cine-zoom relative h-[240px] w-full sm:h-[320px]">
              <Image
                src="/landing/ekip.webp"
                alt="Bir güzellik merkezinin ekibi"
                fill
                sizes="(max-width: 1200px) 100vw, 1200px"
                className="object-cover"
              />
            </div>
          </div>
        </Reveal>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <figure className="h-full rounded-[20px] border border-[#EEC9D7] bg-white p-7 transition-shadow duration-500 hover:shadow-[0_30px_66px_-42px_rgba(150,78,104,0.65)]">
                <Quote className="h-7 w-7 text-[#FFDCE8]" strokeWidth={2} />
                <blockquote className="mt-4 text-[15.5px] leading-relaxed text-[#4A3A44]">{t.quote}</blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-[#F2DFE7] pt-5">
                  <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-[#FFDCE8] text-[13px] font-semibold text-[#8E3F5B]">
                    {t.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-semibold text-[#352432]">{t.name}</span>
                    <span className="block text-[12px] text-[#705A66]">{t.city}</span>
                  </span>
                  <span className="ml-auto flex gap-0.5" aria-label="5 üzerinden 5">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star key={s} className="h-3.5 w-3.5 fill-[#EF6F94] text-[#EF6F94]" />
                    ))}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 scale-[1.14]">
        <div className="cine-parallax relative h-full w-full">
          <Image
            src="/landing/tedavi-odasi.webp"
            alt="Modern bir güzellik merkezinin bakım odası"
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
      </div>
      {/* Fotoğrafın açık bölgelerinde beyaz metnin kontrastı düşüyordu; örtü bir tık koyulaştırıldı. */}
      <div aria-hidden className="absolute inset-0 bg-[#2A1320]/80" />

      <div className="relative mx-auto max-w-[1200px] px-5 py-24 text-center sm:px-8 sm:py-32">
        <Reveal>
          <h2 className="display-lg mx-auto max-w-[20ch] text-white">Merkezinizi bir üst seviyeye taşıyın.</h2>
          <p className="mx-auto mt-5 max-w-[50ch] text-[16.5px] leading-relaxed text-white/95">
            Ücretsiz demo alın, farkı ilk günden görün. Mevcut danışan ve paket kayıtlarınızı biz aktarıyoruz.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-medium text-[#8E3F5B] transition-transform hover:-translate-y-0.5">
              Ücretsiz demo al <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/salonlar" className="inline-flex items-center gap-2 rounded-full border border-white/40 px-7 py-3.5 text-[15px] text-white transition-colors hover:bg-white/10">
              <MessageCircle className="h-4 w-4" /> Salonları keşfet
            </Link>
          </div>
          <ul className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2.5">
            {['14 gün ücretsiz deneme', 'Kurulum ve eğitim dahil', 'Kredi kartı gerektirmez'].map((t) => (
              <li key={t} className="flex items-center gap-2 text-[13.5px] text-white/90">
                <Check className="h-4 w-4 shrink-0 text-[#FFDCE8]" strokeWidth={2.4} />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}

function SiteFooter() {
  const columns = [
    { title: 'Ürün', links: [['#tur', 'Ürün turu'], ['#moduller', 'Modüller'], ['#nasil', 'Nasıl çalışır'], ['#fiyat', 'Fiyatlandırma']] },
    { title: 'Danışanlar', links: [['/salonlar', 'Salonları keşfet'], ['/salonlar', 'Randevu al'], ['/randevu', 'Randevularım']] },
    { title: 'Kurumsal', links: [['#referans', 'Referanslar'], ['/login', 'Giriş yap'], ['/gizlilik', 'Gizlilik'], ['/kvkk', 'KVKK']] },
  ]

  return (
    <footer className="relative overflow-hidden border-t border-[#F2DFE7] bg-[#FFF7FA]">
      {/* Zeminde tek, çok yumuşak bir renk bulutu — hero ile aynı dil, daha sessiz. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bloom-slow absolute -bottom-40 left-1/3 h-[460px] w-[560px] rounded-full bg-[#FFDCE8]/45 blur-[120px]" />
      </div>

      {/* Kapanış çağrısı — sayfanın sonuna gelen ziyaretçiye son bir kapı. */}
      <div className="mx-auto max-w-[1200px] px-5 pt-14 sm:px-8">
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-6 rounded-[20px] border border-[#EEC9D7] bg-white/80 p-6 backdrop-blur sm:p-8 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-[22px] leading-snug tracking-[-0.025em] text-[#352432] sm:text-[26px]">
                Merkezinizi 14 gün ücretsiz deneyin.
              </h2>
              <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-[#4A3A44]">
                Kurulum, veri aktarımı ve eğitim bizde. Kredi kartı gerekmez.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Magnetic>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full bg-[#EF6F94] px-6 py-3 text-[14.5px] font-medium text-white shadow-[0_18px_40px_-20px_rgba(239,111,148,0.95)] transition-shadow hover:shadow-[0_24px_50px_-18px_rgba(239,111,148,1)]"
                >
                  Ücretsiz demo al <ArrowRight className="h-4 w-4" />
                </Link>
              </Magnetic>
              <Link
                href="/salonlar"
                className="inline-flex items-center gap-2 rounded-full border border-[#EEC9D7] bg-white px-6 py-3 text-[14.5px] text-[#4A3A44] transition-colors hover:border-[#EF6F94]"
              >
                Salonları görün
              </Link>
            </div>
          </div>
        </Reveal>
      </div>

      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="" width={52} height={52} className="h-13 w-13 object-contain" />
            <span className="text-[18px] font-semibold tracking-[-0.015em]">BeautyAsist</span>
          </Link>
          <p className="mt-4 max-w-[42ch] text-[13px] leading-relaxed text-[#705A66]">
            Güzellik merkezleri için geliştirilmiş hepsi bir arada yönetim platformu. Daha mutlu
            danışan, daha net veri, daha hızlı büyüme.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {['Web', 'Tablet', 'Mobil', 'Masaüstü'].map((p) => (
              <span key={p} className="rounded-full border border-[#EEC9D7] bg-white/70 px-2.5 py-1 text-[11.5px] text-[#705A66]">
                {p}
              </span>
            ))}
          </div>
        </div>

        {columns.map((col) => (
          <nav key={col.title}>
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#EF6F94]">{col.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map(([href, label]) => (
                <li key={`${col.title}-${label}`}>
                  <Link
                    href={href}
                    className="group inline-flex items-center gap-1.5 text-[13px] text-[#705A66] transition-colors hover:text-[#EF6F94]"
                  >
                    <span aria-hidden className="h-px w-0 bg-[#EF6F94] transition-all duration-300 group-hover:w-3" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-[#F2DFE7]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-5 text-[12px] text-[#705A66] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} BeautyAsist. Tüm hakları saklıdır.</p>
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#EF6F94]" />
            KVKK uyumlu · verileriniz şifreli saklanır
          </p>
        </div>
      </div>
    </footer>
  )
}
