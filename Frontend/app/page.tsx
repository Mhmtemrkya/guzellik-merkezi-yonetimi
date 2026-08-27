import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import CountUp from '@/components/landing/CountUp'
import ProductTour from '@/components/landing/ProductTour'
import Reveal from '@/components/landing/Reveal'
import { HeroStage } from '@/components/landing/HeroStage'
import Hero from '@/components/landing/apple/Hero'
import Nav from '@/components/landing/apple/Nav'
import Film from '@/components/landing/apple/Film'
import DragRail from '@/components/landing/apple/DragRail'
import PressButton from '@/components/landing/apple/PressButton'
import PlanPicker from '@/components/landing/apple/PlanPicker'
import AmbientVideo from '@/components/landing/apple/AmbientVideo'
import JourneyBackdrop from '@/components/landing/apple/JourneyBackdrop'
import { fetchPublicPlans, planFeatureLabels, planLimitLabels, type PublicPlan } from '@/lib/landingPlans'
import {
  ArrowRight, BellRing, Boxes, CalendarDays, Check, ClipboardList, FileBarChart, Globe,
  Landmark, MessageCircle, Package, Quote, ShieldCheck, Star, UserCog, Users, Wallet,
  type LucideIcon,
} from 'lucide-react'
import PaymentBadges, { LegalLinkRow } from '@/components/legal/PaymentBadges'
import { legalLinks } from '@/lib/legal/company'

/** Paket kataloğu ISR ile tazelenir: platformda plan güncellenince tanıtım sayfası da güncellenir. */
export const revalidate = 300

/**
 * TANITIM SAYFASI.
 *
 * ANLATI: sayfa bir SENARYODUR — "bir merkezin bir günü". Arkada 48 saniyelik TEK KESİNTİSİZ
 * çekim akar (bkz. JourneyBackdrop) ve onu oynatan kaydırmanın kendisidir: sayfanın en üstü
 * klibin şafağı, en altı gecesidir. "Bir gün" bölümündeki saatler (08:40 → 20:10) bu yüzden
 * gerçekten arkadaki ışıkla aynı saati gösterir. Her sahne panelde GERÇEKTEN VAR OLAN bir
 * sayfaya bağlıdır (bkz. Film.tsx `panel` alanı); vitrinde olmayan bir özellik vaat edilmez.
 *
 * İKİ ZEMİN:
 *   · YOLCULUK (`yolculuk.mp4`) — sayfanın tamamının arkasında, kaydırmayla sürülür.
 *   · İPEK DÜZLEM (`moduller.mp4`) — ürün turundan paketlere kadar olan blok kendi sakin
 *     zeminine geçer (`SilkStage`); konu merkezin günü olmaktan çıkıp ÜRÜN olur. Paketlerden
 *     sonra yolculuk kaldığı yerden sürer.
 * Üçüncü klip `kurulum.mp4` zemin değil NESNEDİR: "Nasıl çalışır" bölümünde kendi çerçevesinde durur.
 *
 * HAREKET (Apple dili — bkz. components/landing/apple/springs.ts):
 *   · Kullanıcının DOKUNDUĞU her şey YAY ile sürülür ve kesilebilirdir: butonlar basınca
 *     (bırakınca değil) tepki verir, sürüklenen ray parmağın hızını devralır ve momentumun
 *     taşıyacağı karta oturur.
 *   · Kullanıcının dokunmadığı bölüm girişleri kritik sönümlü bir CSS eğrisiyle gelir —
 *     aşma yoktur ve JavaScript'siz güvenlidir.
 *   · Aşma (bounce) yalnız kullanıcının kendisi momentum verdiği hareketlerde vardır.
 *
 * MALZEME: içerik hareketli görüntünün ÜSTÜNDE durur. Okunabilirlik metnin opaklığını
 * düşürerek değil, ARADAKİ MALZEME ile kurulur (`.material-light` / `.material-dark`):
 * koyu bölümlerde koyu cam + beyaz metin, açık bölümlerde açık cam + koyu metin. Fiyat
 * kartları DÜZ BEYAZDIR — karar noktasında okunabilirlik süse feda edilmez.
 *
 * İÇERİK ASLA HAREKETE BAĞLI DEĞİLDİR: `Reveal` gizlemeyi yalnız JS çalışınca uygular,
 * `cine-*` sınıfları `@supports` ile korunur, videolar süstür (kaynak yalnız JS ile takılır,
 * hareket azaltma açıksa hiç indirilmez, altlarında durağan kare durur).
 *
 * TUZAK: sabitlenen katmanların (JourneyBackdrop, SilkStage) ata zincirinde `overflow-hidden`
 * OLAMAZ — tarayıcı `hidden` için kaydırma bağlamı doğurur ve `position: sticky` sessizce
 * ölür. Her yerde `overflow-clip` kullanılır; kök sarmalayıcıdaki `overflow-x-clip` de bu yüzden.
 *
 * SATIN ALMA: "Planı seç" (PlanPicker) planı sepete koyup `/odeme`'ye götürür; kimlik orada
 * sorulur (bkz. lib/cart.ts, components/checkout/CheckoutClient.tsx).
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
  { quote: 'Personel yetkileri sayesinde herkes yalnız kendi işini görüyor. Onay kutusundan geçmeden hiçbir kayıt değişmiyor; ay sonunda tartışma çıkmıyor.', name: 'Derma Luxe', city: 'İstanbul' },
]

export default async function LandingPage() {
  // Fiyat bölümü platformdaki GERÇEK paketlerden beslenir; backend kapalıysa null döner ve
  // sayfa fiyatsız "teklif iste" akışına düşer (bkz. Pricing).
  const plans = await fetchPublicPlans()

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#140A11] text-[#352432] antialiased">
      {/* Sayfanın TAMAMININ arkasındaki tek kesintisiz çekim; kaydırma onu sürer. */}
      <JourneyBackdrop />
      <div className="relative z-10">
      <Nav />
      <main>
        <Hero />
        <ProofStrip />
        <Film />

        {/* ÜRÜN BÖLÜMÜ — yolculuk burada bir süreliğine durur.
            "Bir gün" anlatısı bittiğinde konu değişir: artık merkezin günü değil, ÜRÜN
            anlatılır. Bu yüzden zemin de değişir — kesintisiz çekimin yerini sakin, krem
            ipek dokusu alır ve ürün turu, modüller, kurulum ve fiyat aynı yüzeyin üstünde
            tek bir blok olarak okunur. Paketlerden sonra yolculuk kaldığı yerden sürer. */}
        <SilkStage>
          <ProductStage />
          <Modules />
          <Steps />
          <Pricing plans={plans} />
        </SilkStage>

        <Voices />
        <FinalCta />
      </main>
      <SiteFooter />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * BÖLÜM ZEMİNİ — uzun bölümlerin altında duran video düzlemi.
 *
 * NEDEN `sticky`: bölüm bir kart ızgarası kadar uzun olabilir. Videoyu bölümün TAMAMINA
 * yaymak 16:9 kaynağı dikeyde ezip aşırı kırpar ve bulanıklaştırır. Bunun yerine video ekran
 * boyunda kalır, içerik onun üstünden akar — görüntü hep kendi en-boy oranında ve net durur.
 * Peçe zeminin İÇİNDEDİR: ekranda ne görünüyorsa onun üstünü örter.
 */
function Veil({ color }: { color: string }) {
  return <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: color }} />
}

/**
 * İPEK SAHNE — ürün bölümünün ortak zemini.
 *
 * Ürün turundan paketlere kadar olan dört bölüm tek bir yüzeyin üstünde durur: yavaşça
 * dalgalanan krem-blush ipek. Bu bir SAHNE değil DÜZLEMDİR — anlatacak bir olayı yoktur,
 * yüzeye canlılık verir ve arkadaki yolculuğu bu blok boyunca örter.
 *
 * NEDEN `sticky`: blok dört bölüm boyu uzundur. 16:9 klibi bu yüksekliğe yaymak görüntüyü
 * dikeyde ezip bulanıklaştırır. Video ekran boyunda kalır, içerik üstünden akar.
 * Ata zincirinde `overflow-hidden` OLAMAZ (sticky ölür) — `overflow-clip` kullanılır.
 *
 * Üstteki ve alttaki yumuşak geçişler, yolculuktan ipeğe ve ipekten yolculuğa dönüşü
 * sert bir kenar olmadan bağlar.
 */
function SilkStage({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate overflow-clip">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="sticky top-0 h-[100svh]">
          <AmbientVideo src="/landing/film/moduller.mp4" poster="/landing/film/moduller.webp" />
          {/* Doku görünsün ama kartların altında sakinleşsin. */}
          <div className="absolute inset-0 bg-[#FFF7FA]/72" />
        </div>
      </div>

      {/* Yolculuktan ipeğe ve ipekten yolculuğa yumuşak geçiş. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: 'linear-gradient(to bottom, rgba(20,10,17,0.85), rgba(255,247,250,0))' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: 'linear-gradient(to top, rgba(20,10,17,0.85), rgba(255,247,250,0))' }}
      />

      <div className="relative">{children}</div>
    </div>
  )
}

function SectionHead({
  eyebrow,
  title,
  body,
  tone = 'light',
}: {
  eyebrow: string
  title: string
  body?: string
  /** `dark` = koyu sahne üstünde beyaz metin. */
  tone?: 'light' | 'dark'
}) {
  const dark = tone === 'dark'
  // Başlık hareketli bir görüntünün üstünde durur; okunabilirlik metnin rengiyle değil
  // ALTINDAKİ MALZEME ile kurulur. Aksi hâlde arkadaki ışık değiştikçe başlık titrer.
  return (
    <div
      className={`mx-auto max-w-[68ch] rounded-[24px] px-7 py-8 text-center sm:px-10 sm:py-10 ${
        dark ? 'material-dark material-thick' : 'material-light material-thick'
      }`}
    >
      <span className={`text-[11.5px] font-semibold uppercase tracking-[0.18em] ${dark ? 'text-[#FFB6CC]' : 'text-[#EF6F94]'}`}>
        {eyebrow}
      </span>
      <h2 className={`display-lg balance mt-4 ${dark ? 'text-white' : 'text-[#352432]'}`}>{title}</h2>
      {body && (
        <p className={`on-material balance mt-4 text-[16px] leading-relaxed ${dark ? 'text-white' : 'text-[#4A3A44]'}`}>
          {body}
        </p>
      )}
    </div>
  )
}

/** Açılıştan sonraki tek nefes: rakamlar ve birlikte çalışılan merkezler. */
function ProofStrip() {
  const row = [...clients, ...clients]
  return (
    <section className="relative isolate">
      <Veil color="rgba(255,247,250,0.55)" />

      <div className="relative mx-auto max-w-[1200px] px-5 py-14 sm:px-8">
        <Reveal>
          <div className="material-light material-thick rounded-[24px] px-6 py-8 sm:px-10">
            <dl className="flex flex-wrap items-center justify-center gap-x-14 gap-y-6 text-center">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd>
                    <span className="block text-[30px] font-semibold tracking-[-0.035em] text-[#352432]">
                      <CountUp value={s.value} prefix={'prefix' in s ? s.prefix : ''} suffix={'suffix' in s ? s.suffix : ''} />
                    </span>
                    <span className="on-material mt-1 block text-[12px] text-[#5A4752]">{s.label}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 border-t border-[#F2DFE7] pt-7">
              <p className="on-material px-5 text-center text-[12.5px] text-[#5A4752]">
                Türkiye’nin dört bir yanındaki güzellik merkezleri BeautyAsist ile çalışıyor
              </p>
              <div className="landing-marquee mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
                <div className="landing-marquee-track flex w-max items-center gap-14 px-6">
                  {row.map((name, i) => (
                    <span key={`${name}-${i}`} className="whitespace-nowrap font-display text-[18px] tracking-[-0.02em] text-[#9E8390]">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/**
 * ÜRÜN SAHNESİ — panelin gerçek ekranları.
 * Sinematik anlatının hemen ardından gelir: güzel görüntünün arkasında gerçek bir ürün
 * olduğu görülsün. Ekran sahneye yatık girer, kaydırdıkça doğrulur.
 */
function ProductStage() {
  return (
    <section id="tur" className="relative isolate scroll-mt-16 px-5 py-24 sm:px-8 sm:py-32">
      <div className="relative mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead
            eyebrow="Ürün turu"
            title="Panelin kendisi, süslemesi değil."
            body="Aşağıdaki ekranlar panelin gerçek yüzeyidir. Modüle dokunun, tur o modülde dursun."
          />
        </Reveal>
      </div>

      <div className="relative mx-auto mt-12 max-w-[1080px]">
        <HeroStage>
          <ProductTour />
        </HeroStage>
      </div>
    </section>
  )
}

/**
 * MODÜLLER — az kontrastlı ipek dokusu üstünde SÜRÜKLENEN cam kartlar.
 *
 * Buradaki klip bir SAHNE değil DÜZLEMDİR: anlatacak bir olayı yoktur, yüzeye canlılık verir.
 * Kartlar bir rayda durur; ray parmakla sürüklenir, bırakma hızını devralır ve momentumun
 * taşıyacağı karta oturur (bkz. DragRail). On iki modül böylece sayfayı şişirmeden gezilir.
 */
function Modules() {
  return (
    <section id="moduller" className="relative isolate scroll-mt-16 py-24 sm:py-32">

      <div className="relative">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <Reveal>
            <SectionHead
              eyebrow="Tüm ihtiyaçlarınız tek platformda"
              title="Eksiksiz modüller, tek veri."
              body="Randevudan tahsilata bütün operasyon aynı veri üzerinde çalışır; modüller arası kopukluk olmaz."
            />
          </Reveal>
        </div>

        <div className="mx-auto mt-14 max-w-[1200px] px-5 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m, i) => (
              <Reveal key={m.title} delay={(i % 3) * 70}>
                <article className="material-light h-full rounded-[22px] p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94]">
                    <m.icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <h3 className="mt-5 text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">{m.title}</h3>
                  <p className="on-material mt-2.5 text-[13.5px] leading-relaxed text-[#5A4752]">{m.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <Reveal delay={120}>
            <div className="mt-8 flex flex-col items-center gap-4">
              <p className="material-light on-material w-fit rounded-full px-5 py-2.5 text-center text-[13px] text-[#4A3A44]">
                Hepsi kurum yöneticisi panelinde hazır — ayrı ayrı satın alınan eklentiler değil.
              </p>
              <PressButton href="/moduller" tone="glass-light" className="border border-[#EEC9D7] px-6 py-3 text-[14px] font-medium">
                Tüm özellikleri görün <ArrowRight className="h-4 w-4" />
              </PressButton>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/**
 * NASIL ÇALIŞIR — solda çerçeveli video, sağda dört adım.
 * Klip burada zemin değil NESNEDİR: kendi yuvarlatılmış çerçevesinde durur, adımlar yanında
 * düz zeminde okunur. Kurulumun "elle hazırlanan" hissi görüntüyle, bilgi metinle taşınır.
 */
function Steps() {
  return (
    <section id="nasil" className="relative isolate scroll-mt-16 px-5 py-24 sm:px-8 sm:py-32">
      <div className="relative mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead
            eyebrow="Nasıl çalışır"
            title="4 adımda merkezinizi dijitale taşıyın"
            body="Kurulumu biz yapıyoruz. Siz yalnız hizmet listenizi onaylıyorsunuz."
          />
        </Reveal>

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
          <Reveal>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[26px] shadow-[0_40px_90px_-55px_rgba(90,40,62,0.85)]">
              <AmbientVideo src="/landing/film/kurulum.mp4" poster="/landing/film/kurulum.webp" />
            </div>
          </Reveal>

          <ol className="material-light space-y-7 rounded-[24px] p-7 sm:p-9">
            {steps.map((s, i) => (
              <Reveal key={s.title} as="li" delay={i * 80}>
                <div className="flex gap-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#EEC9D7] bg-white text-[14px] font-semibold text-[#EF6F94]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.015em] text-[#352432]">{s.title}</h3>
                    <p className="on-material mt-2 text-[14px] leading-relaxed text-[#4A3A44]">{s.body}</p>
                  </div>
                </div>
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
 *
 * Zeminde su yüzeyi düzlemi döner; fiyat KARARININ verildiği yer olduğu için peçe burada en
 * güçlüdür ve kartlar DÜZ BEYAZDIR — okunabilirlik süse feda edilmez.
 */
function Pricing({ plans }: { plans: PublicPlan[] | null }) {
  // Vitrinde en fazla dört paket (kataloğun tamamı daha fazlaysa ilk dördü): beşinci kart
  // ızgarayı sıkıştırıp okunurluğu düşürüyor.
  const shown = plans?.slice(0, 4) ?? []
  // Öne çıkan: ortadan bir üst basamak — "büyüyen merkez" alıcısının tipik seçimi.
  const featuredIndex = shown.length >= 3 ? 1 : shown.length - 1

  return (
    <section id="fiyat" className="relative isolate scroll-mt-16 px-5 py-24 sm:px-8 sm:py-32">

      <div className="relative mx-auto max-w-[1200px]">
        <Reveal>
          <SectionHead
            eyebrow="Fiyatlandırma"
            title="Merkezinize göre bir plan."
            body="Kurulum, veri aktarımı ve eğitim bizde. Planınızı istediğiniz zaman yükseltebilirsiniz."
          />
        </Reveal>

        {shown.length === 0 ? (
          <Reveal delay={80}>
            <div className="mx-auto mt-12 max-w-[560px] rounded-[22px] border border-[#EEC9D7] bg-white p-8 text-center shadow-[0_30px_70px_-46px_rgba(90,40,62,0.75)]">
              <h3 className="font-display text-[19px] tracking-[-0.02em] text-[#352432]">Size özel teklif hazırlayalım</h3>
              <p className="mx-auto mt-3 max-w-[46ch] text-[14px] leading-relaxed text-[#4A3A44]">
                Paket, şube ve kullanıcı sayınıza göre belirlenir. Merkezinizin ölçüsünü paylaşın,
                uygun planı fiyatıyla birlikte gönderelim.
              </p>
              <PressButton href="/login" tone="primary" className="mt-6 px-6 py-3 text-[14.5px] font-medium">
                Teklif iste <ArrowRight className="h-4 w-4" />
              </PressButton>
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
                    className={`relative flex h-full flex-col rounded-[22px] border bg-white p-6 ${
                      featured
                        ? 'border-[#EF6F94] shadow-[0_38px_84px_-40px_rgba(239,111,148,0.95)]'
                        : 'border-[#EEC9D7] shadow-[0_30px_70px_-46px_rgba(90,40,62,0.75)]'
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
                      <p className="mt-1 text-[11.5px] text-[#8E3F5B]">Yıllık ödemede {tl(yearlyPerMonth)}/ay</p>
                    )}

                    <ul className="mt-6 flex-1 space-y-2.5">
                      {rows.map((f) => (
                        <li key={f} className="flex gap-2.5 text-[13px] text-[#4A3A44]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={2.2} />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* Seçim sepete düşer; kimlik ödeme sayfasında sorulur (bkz. PlanPicker). */}
                    <PlanPicker
                      planId={p.id}
                      planName={p.name}
                      priceTRY={p.monthlyPriceTRY}
                      featured={featured}
                    />
                  </article>
                </Reveal>
              )
            })}
          </div>
        )}

        {shown.length > 0 && (
          <Reveal delay={120}>
            <aside className="material-light mt-4 grid gap-6 rounded-[22px] p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <h3 className="font-display text-[17px] leading-snug tracking-[-0.02em] text-[#352432]">Yatırımınızın gerçek getirisi</h3>
                <ul className="mt-4 flex flex-wrap gap-x-7 gap-y-2.5">
                  {['Telefon trafiği azalır', 'Gelmeyen danışan oranı düşer', 'Operasyon hızlanır', 'Kasa gün sonunda tutar'].map((t) => (
                    <li key={t} className="on-material flex gap-2.5 text-[12.5px] text-[#4A3A44]">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EF6F94]" strokeWidth={2.4} />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[16px] border border-[#EEC9D7] bg-white px-6 py-4 text-center lg:min-w-[190px]">
                <div className="text-fine text-[10.5px] uppercase tracking-[0.14em] text-[#705A66]">Ortalama geri dönüş</div>
                <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.03em] text-[#EF6F94]">3–6 ay</div>
              </div>
            </aside>
          </Reveal>
        )}

        {/* SATIN ALMA NOKTASINDA ÖDEME + YASAL BİLGİ.
            Ödeme kuruluşu incelemesi bu bilgileri yalnız footer'da değil, fiyatın görüldüğü
            yerde de arar; kullanıcı da hangi kartla ödeyeceğini burada görmek ister. */}
        <Reveal delay={140}>
          <div className="material-light mx-auto mt-6 flex max-w-[760px] flex-col items-center gap-3 rounded-[18px] px-6 py-5 text-center">
            <PaymentBadges />
            <LegalLinkRow className="justify-center text-[#705A66]" />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/**
 * REFERANSLAR — uzaktan, odak dışı bir salon iç mekânı üstünde SÜRÜKLENEN koyu cam alıntılar.
 * Sahne klibi olduğu için muamele koyudur; kartlar `material-dark` katmanıdır.
 */
function Voices() {
  return (
    <section id="referans" className="relative isolate scroll-mt-16 py-24 sm:py-32">
      <Veil color="rgba(20,10,17,0.48)" />

      <div className="relative">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <Reveal>
            <SectionHead eyebrow="Referanslar" title="Kullanıcılarımız ne diyor?" tone="dark" />
          </Reveal>
        </div>

        <Reveal delay={80}>
          <DragRail label="Kullanıcı yorumları" className="mt-14">
            <div className="flex gap-4 px-5 pb-2 sm:px-8">
              {testimonials.map((t) => (
                <figure
                  key={t.name}
                  className="material-dark material-thick w-[320px] shrink-0 snap-start rounded-[22px] p-7 sm:w-[420px]"
                >
                  <Quote className="h-7 w-7 text-[#FFB6CC]" strokeWidth={2} />
                  <blockquote className="on-material mt-4 text-[15.5px] leading-relaxed text-white">{t.quote}</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-white/20 pt-5">
                    <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-[#FFB6CC] text-[13px] font-semibold text-[#5A2038]">
                      {t.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-semibold text-white">{t.name}</span>
                      <span className="text-fine block text-[12px] text-white/80">{t.city}</span>
                    </span>
                    <span className="ml-auto flex gap-0.5" aria-label="5 üzerinden 5">
                      {Array.from({ length: 5 }).map((_, s) => (
                        <Star key={s} className="h-3.5 w-3.5 fill-[#FFB6CC] text-[#FFB6CC]" />
                      ))}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </DragRail>
        </Reveal>
      </div>
    </section>
  )
}

/**
 * KAPANIŞ — yolculuğun son karesi.
 *
 * Arkada tek çekimin gecesi akar (camın ardında şehir ışıkları). Metin doğrudan görüntünün
 * üstüne serilmez: kendi KOYU CAM PANELİNDE durur, böylece hareketli ışık kontrastı bozamaz.
 * Panel geniş bir yüzey olduğu için `material-thick` ile daha kalın okunur.
 */
function FinalCta() {
  return (
    <section className="relative isolate">
      <Veil color="rgba(20,10,17,0.55)" />

      <div className="relative mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Reveal>
          <div className="material-dark material-thick mx-auto max-w-[760px] rounded-[28px] p-9 text-center sm:p-12">
            <h2 className="display-lg balance mx-auto max-w-[20ch] text-white">Yarın sabah, gün yine hazır olsun.</h2>
            <p className="on-material balance mx-auto mt-5 max-w-[50ch] text-[16.5px] leading-relaxed text-white">
              Kartsız, 14 gün ücretsiz deneyin; farkı ilk günden görün. Mevcut danışan ve paket
              kayıtlarınızı biz aktarıyoruz.
            </p>

            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <PressButton href="/kayit" tone="primary" className="px-7 py-3.5 text-[15px] font-medium">
                14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
              </PressButton>
              <PressButton
                href="/salonlar"
                tone="glass-dark"
                className="border border-white/40 px-7 py-3.5 text-[15px]"
              >
                <MessageCircle className="h-4 w-4" /> Salonları keşfet
              </PressButton>
            </div>

            <ul className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2.5 border-t border-white/20 pt-7">
              {['14 gün ücretsiz deneme', 'Kurulum ve eğitim dahil', 'Kredi kartı gerektirmez'].map((t) => (
                <li key={t} className="flex items-center gap-2 text-[13.5px] text-white">
                  <Check className="h-4 w-4 shrink-0 text-[#FFB6CC]" strokeWidth={2.4} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function SiteFooter() {
  // YASAL SÜTUN ZORUNLU: ödeme kuruluşu (iyzico) üye iş yeri incelemesinde hakkımızda,
  // mesafeli satış, teslimat/iade ve gizlilik metinlerinin siteden ulaşılabilir olmasını arar.
  const columns = [
    { title: 'Ürün', links: [['#bir-gun', 'Bir gün'], ['#tur', 'Ürün turu'], ['/moduller', 'Modüller'], ['#nasil', 'Nasıl çalışır'], ['#fiyat', 'Fiyatlandırma']] },
    { title: 'Danışanlar', links: [['/salonlar', 'Salonları keşfet'], ['/salonlar', 'Randevu al'], ['/randevu', 'Randevularım']] },
    // "Hakkımızda" YASAL sütununda duruyor (kriterler listesinde sözleşmelerle birlikte aranır).
    { title: 'Kurumsal', links: [['#referans', 'Referanslar'], ['/login', 'Giriş yap']] },
    { title: 'Yasal', links: legalLinks.map((link) => [link.href, link.label] as [string, string]) },
  ]

  return (
    <footer className="relative isolate overflow-hidden">
      {/* Yolculuk burada biter: gece karesi tam örtülür ve sayfa kendi zeminine oturur.
          Yarı saydam bir peçe olsaydı arkadaki hareket altbilgi metnini titretirdi. */}
      <div aria-hidden className="absolute inset-0 bg-[#FFF7FA]" />
      {/* Geceden gündüze geçiş: sert bir kenar yerine gecenin rengi footer zeminine erir. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: 'linear-gradient(to bottom, #140A11 0%, rgba(90,32,56,0.35) 38%, rgba(255,247,250,0) 100%)' }}
      />

      <div className="relative mx-auto max-w-[1200px] px-5 pt-16 sm:px-8">
        <Reveal>
          <div className="material-light flex flex-col items-start justify-between gap-6 rounded-[22px] p-6 sm:p-8 lg:flex-row lg:items-center">
            <div>
              <h2 className="display-md text-[#352432]">Merkezinizi 14 gün ücretsiz deneyin.</h2>
              <p className="on-material mt-2 max-w-[52ch] text-[14px] leading-relaxed text-[#4A3A44]">
                Kurulum, veri aktarımı ve eğitim bizde. Kredi kartı gerekmez.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <PressButton href="/kayit" tone="primary" className="px-6 py-3 text-[14.5px] font-medium">
                14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
              </PressButton>
              <PressButton href="/salonlar" tone="glass-light" className="border border-[#EEC9D7] px-6 py-3 text-[14.5px]">
                Salonları görün
              </PressButton>
            </div>
          </div>
        </Reveal>
      </div>

      <div className="relative mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div>
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="" width={48} height={48} className="h-12 w-12 object-contain" />
            <span className="text-[18px] font-semibold tracking-[-0.02em]">BeautyAsist</span>
          </Link>
          <p className="mt-4 max-w-[42ch] text-[13px] leading-relaxed text-[#705A66]">
            Güzellik merkezleri için geliştirilmiş hepsi bir arada yönetim platformu. Daha mutlu
            danışan, daha net veri, daha hızlı büyüme.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {['Web', 'Tablet', 'Mobil', 'Masaüstü'].map((p) => (
              <span key={p} className="text-fine rounded-full border border-[#EEC9D7] bg-white/70 px-2.5 py-1 text-[11.5px] text-[#705A66]">
                {p}
              </span>
            ))}
          </div>
          <PaymentBadges className="mt-6" />
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

      <div className="relative border-t border-[#F2DFE7]">
        <div className="text-fine mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-5 text-[12px] text-[#705A66] sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
