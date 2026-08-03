'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BarChart3, CalendarDays, CreditCard, Globe, Layers, Users, type LucideIcon,
} from 'lucide-react'

/**
 * SABİTLENEN SAHNE: ekran sabit kalırken kaydırma modülleri değiştirir.
 *
 * Apple'ın ürün sayfalarındaki dil — bölüm ekranı doldurur, kaydırma ilerledikçe içerik
 * sahne sahne değişir. Burada her sahne panelin bir modülü: solda anlatı, sağda o modülün
 * gerçek ekranı.
 *
 * İLERİCİ ZENGİNLEŞTİRME: sahne geçişi IntersectionObserver ile sürülür. Script çalışmazsa
 * bölüm normal bir liste gibi akar ve TÜM içerik okunabilir kalır (aşağıdaki `no-js` yedeği).
 */

interface Scene {
  id: string
  eyebrow: string
  title: string
  body: string
  icon: LucideIcon
  screen: 'randevu' | 'danisan' | 'paket' | 'kasa' | 'portal' | 'rapor'
}

const scenes: Scene[] = [
  {
    id: 'sahne-randevu',
    eyebrow: 'Randevu',
    title: 'Gün, kendiliğinden dolar.',
    body: 'Uzman, oda ve saat çakışması engellenir. Bir randevu iptal olduğunda boşalan saat bekleme listesindeki danışana otomatik teklif edilir.',
    icon: CalendarDays,
    screen: 'randevu',
  },
  {
    id: 'sahne-danisan',
    eyebrow: 'Danışan',
    title: 'Bir kere kaydedin, bir daha aramayın.',
    body: 'Paket, borç, seans, onam formu ve önce/sonra fotoğrafları aynı kartta durur. Geçmişi görmek için telefon karıştırmazsınız.',
    icon: Users,
    screen: 'danisan',
  },
  {
    id: 'sahne-paket',
    eyebrow: 'Paket & seans',
    title: 'Kalan seans, siz sormadan bellidir.',
    body: 'Randevu tamamlandığı anda doğru paketten bir seans düşer. Hangi satıştan düştüğü kaydedilir; iptalde aynı pakete geri yazılır.',
    icon: Layers,
    screen: 'paket',
  },
  {
    id: 'sahne-kasa',
    eyebrow: 'Tahsilat',
    title: 'Gün sonunda hesap tutar.',
    body: 'Nakit, kart, havale ve taksit tek hesapta birleşir. Beklenen tutar ile sayılan tutar yan yana durur, fark gerekçesiyle kaydedilir.',
    icon: CreditCard,
    screen: 'kasa',
  },
  {
    id: 'sahne-portal',
    eyebrow: 'Online portal',
    title: 'Danışanınız randevusunu kendi alır.',
    body: 'Kendi sayfanızdan 7/24 randevu alınır, kalan seans görünür. Hatırlatma WhatsApp’tan gider, “Evet” yanıtı randevuyu onaylar.',
    icon: Globe,
    screen: 'portal',
  },
  {
    id: 'sahne-rapor',
    eyebrow: 'Rapor',
    title: 'Kararı veri verir.',
    body: 'Hangi hizmet kazandırıyor, kim sattı, kim uyguladı, hangi ay ne oldu — gelir-gider ve performans aynı veriden üretilir.',
    icon: BarChart3,
    screen: 'rapor',
  },
]

export default function StickyTour() {
  const [active, setActive] = useState(0)
  const stepRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    const nodes = stepRefs.current.filter((n): n is HTMLDivElement => n !== null)
    if (nodes.length === 0 || typeof IntersectionObserver === 'undefined') return

    // Ekranın orta bandını kesen adım "şu anki sahne"dir.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const i = Number((e.target as HTMLElement).dataset.index)
          if (!Number.isNaN(i)) setActive(i)
        }
      },
      { rootMargin: '-48% 0px -48% 0px', threshold: 0 },
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  const current = scenes[active]

  return (
    <section id="tur" className="scroll-mt-16">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
          {/* Sol: kaydırılan anlatı adımları */}
          <div>
            {scenes.map((s, i) => (
              <div
                key={s.id}
                ref={(el) => { stepRefs.current[i] = el }}
                data-index={i}
                className="flex min-h-[62vh] flex-col justify-center py-10 lg:min-h-[76vh] lg:py-0"
              >
                <span
                  className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-500 ${
                    i === active
                      ? 'border-[#EF6F94] bg-[#FFDCE8] text-[#8E3F5B]'
                      : 'border-[#EEC9D7] bg-white text-[#705A66]'
                  }`}
                >
                  <s.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {s.eyebrow}
                </span>

                <h3
                  className={`display-lg mt-5 transition-colors duration-500 ${
                    i === active ? 'text-[#352432]' : 'text-[#352432]/45'
                  }`}
                >
                  {s.title}
                </h3>
                <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-[#4A3A44]">{s.body}</p>

                {/* Dar ekranda sahne, adımın hemen altında görünür (sabitleme yok). */}
                <div className="mt-7 lg:hidden">
                  <ScreenFrame>
                    <Screen kind={s.screen} />
                  </ScreenFrame>
                </div>
              </div>
            ))}
          </div>

          {/* Sağ: sabitlenen ekran (yalnız geniş ekran) */}
          <div className="hidden lg:block">
            <div className="sticky top-[14vh] flex h-[72vh] items-center">
              <ScreenFrame>
                {/* key: sahne değişince içerik yeniden monte olur → geçiş animasyonu tetiklenir. */}
                <div key={current.id} className="animate-[cine-rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
                  <Screen kind={current.screen} />
                </div>
              </ScreenFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Panel penceresi — kurum yöneticisi panelinin GERÇEK kabuğu taklit edilir:
 * solda daraltılmış sidebar rayı, üstte breadcrumb + başlık taşıyan Topbar, altta içerik yüzeyi.
 * Yüzey değerleri panelden alınmıştır (#ead8df kenarlık, beyaz/blur topbar, #fffafc içerik zemini).
 */
function ScreenFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-[22px] border border-[#EEC9D7] bg-white/75 p-2 shadow-[0_40px_90px_-52px_rgba(150,78,104,0.6)] backdrop-blur-sm">
      <div className="flex min-h-[340px] overflow-hidden rounded-[16px] border border-[#ead8df]/70 bg-[#fffafc] sm:min-h-[392px]">
        <PanelRail />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

/** Daraltılmış sidebar rayı — panelin sol kenarındaki ikon şeridinin izlenimi. */
function PanelRail() {
  return (
    <div aria-hidden className="hidden w-11 shrink-0 flex-col items-center gap-3 border-r border-[#ead8df]/70 bg-white/70 py-3 sm:flex">
      <span className="h-6 w-6 rounded-[8px] bg-[#EF6F94]" />
      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#EF6F94]" />
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className="h-4 w-4 rounded-[6px] bg-[#f3dde5]" />
      ))}
    </div>
  )
}

/** Panelin Topbar'ı: breadcrumb + sayfa başlığı + sağda durum rozeti. */
function PanelHead({ crumbs, title, hint }: { crumbs: string[]; title: string; hint: string }) {
  return (
    <div className="border-b border-[#ead8df]/70 bg-white/75 px-3.5 py-2.5 backdrop-blur-sm sm:px-4">
      <div className="flex items-center gap-1.5 text-[9.5px] font-semibold tracking-tight text-[#7c6170]/60">
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-[#f0aac2]/60" />}
            {c}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h4 className="font-display text-[15px] tracking-[-0.02em] text-[#352432]">{title}</h4>
        <span className="shrink-0 rounded-full bg-[#fff4f8] px-2 py-0.5 text-[10px] font-semibold text-[#a3576f]">{hint}</span>
      </div>
    </div>
  )
}

/** İçerik yüzeyi — panelin sayfa gövdesindeki iç boşluk ritmi. */
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 p-3.5 sm:p-4">{children}</div>
}

/** Panelin KPI kartı: gradient yüzey, köşe ışıması, rozet. */
function PanelKpi({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-[#f3dde5] bg-gradient-to-br from-white to-[#fffafc] p-2.5 shadow-[0_16px_40px_-32px_rgba(120,71,88,0.55)]">
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-16 w-16 rounded-full bg-[#ffdce8]/45 blur-2xl" />
      <div className="relative text-[9.5px] font-medium uppercase tracking-[0.1em] text-[#7d6a72]">{label}</div>
      <div className="relative mt-0.5 text-[16px] font-semibold tabular-nums tracking-[-0.02em] text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      {badge && (
        <div className="relative mt-1 inline-block rounded-full bg-[#fff4f8] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#a3576f]">{badge}</div>
      )}
    </div>
  )
}

/** Panelin tablo/liste yüzeyi. */
function PanelSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#eee3e7] bg-white/75 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      {children}
    </div>
  )
}

function Screen({ kind }: { kind: Scene['screen'] }) {
  if (kind === 'randevu') return <AppointmentScreen />
  if (kind === 'danisan') return <CustomerScreen />
  if (kind === 'paket') return <PackageScreen />
  if (kind === 'kasa') return <CashScreen />
  if (kind === 'portal') return <PortalScreen />
  return <ReportScreen />
}

function AppointmentScreen() {
  const rows = [
    ['09:00', 'Elif Aydın', 'Lazer epilasyon', 'Tamamlandı'],
    ['10:30', 'Ayşe Demir', 'Cilt bakımı', 'İşlemde'],
    ['11:15', 'Merve Şahin', 'Bölgesel incelme', 'Bekliyor'],
    ['12:00', 'Zeynep Ateş', 'Kaş tasarımı', 'Bekliyor'],
    ['13:30', 'Buse Yıldırım', 'Lazer epilasyon', 'Bekliyor'],
  ]
  const tone: Record<string, string> = {
    'Tamamlandı': 'bg-emerald-50 text-emerald-700',
    'İşlemde': 'bg-[#FFDCE8] text-[#8E3F5B]',
    'Bekliyor': 'bg-amber-50 text-amber-700',
  }
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Randevular']} title="Günlük ajanda" hint="Bugün" />
      <PanelBody>
        <div className="grid grid-cols-3 gap-2">
          <PanelKpi label="Randevu" value="32" badge="+4 bugün" />
          <PanelKpi label="Doluluk" value="%76" />
          <PanelKpi label="Boş slot" value="3" badge="teklif gitti" />
        </div>
        <PanelSurface>
          <ul className="divide-y divide-[#F6E7EE]">
            {rows.map(([time, name, service, state]) => (
              <li key={time} className="flex items-center gap-3 py-2">
                <span className="w-[42px] shrink-0 text-[11.5px] tabular-nums text-[#7d6a72]" style={{ fontFamily: 'var(--font-mono)' }}>
                  {time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-[#352432]">{name}</span>
                  <span className="block truncate text-[11px] text-[#7d6a72]">{service}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${tone[state]}`}>{state}</span>
              </li>
            ))}
          </ul>
        </PanelSurface>
      </PanelBody>
    </>
  )
}

function CustomerScreen() {
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Müşteriler']} title="Danışan kartı" hint="360° geçmiş" />
      <PanelBody>
        <PanelSurface>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#FFDCE8] text-[12.5px] font-semibold text-[#8E3F5B]">MŞ</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-[#352432]">Merve Şahin</div>
              <div className="text-[11px] tabular-nums text-[#7d6a72]" style={{ fontFamily: 'var(--font-mono)' }}>0532 ••• •• 47</div>
            </div>
            <span className="shrink-0 rounded-full bg-[#fff4f8] px-2 py-0.5 text-[9.5px] font-semibold text-[#a3576f]">VIP</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {['Lazer paketi', 'Onam imzalı', 'KVKK onaylı'].map((t) => (
              <span key={t} className="rounded-full border border-[#f3dde5] bg-[#fffafc] px-2 py-0.5 text-[10.5px] text-[#7d6a72]">{t}</span>
            ))}
          </div>
        </PanelSurface>

        <div className="grid grid-cols-3 gap-2">
          <PanelKpi label="Kalan seans" value="2" />
          <PanelKpi label="Açık borç" value="₺1.800" badge="taksitli" />
          <PanelKpi label="Harcama" value="₺24.600" />
        </div>

        <PanelSurface>
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#7d6a72]">Son işlemler</div>
          <ul className="mt-1.5 divide-y divide-[#F6E7EE]">
            {[['12 Tem', 'Bölgesel incelme', 'Tamamlandı'], ['28 Haz', 'Cilt bakımı', 'Tamamlandı']].map(([d, s, st]) => (
              <li key={d} className="flex items-center justify-between gap-3 py-1.5 text-[11.5px]">
                <span className="tabular-nums text-[#7d6a72]" style={{ fontFamily: 'var(--font-mono)' }}>{d}</span>
                <span className="min-w-0 flex-1 truncate text-[#352432]">{s}</span>
                <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] text-emerald-700">{st}</span>
              </li>
            ))}
          </ul>
        </PanelSurface>
      </PanelBody>
    </>
  )
}

function PackageScreen() {
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Paket & Hizmet']} title="Paket takibi" hint="Otomatik düşüm" />
      <PanelBody>
        <PanelSurface>
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-[#352432]">Lazer epilasyon</span>
            <span className="text-[10.5px] text-[#7d6a72]">8 seanslık paket</span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className={`h-7 flex-1 rounded-[5px] border ${i < 6 ? 'border-[#EF6F94] bg-[#EF6F94]' : 'border-dashed border-[#EEC9D7] bg-white'}`} />
            ))}
          </div>
          <div className="mt-2.5 flex justify-between border-t border-[#F6E7EE] pt-2 text-[11.5px]">
            <span className="text-[#7d6a72]">Kullanılan 6 · Kalan</span>
            <span className="font-semibold text-[#EF6F94]" style={{ fontFamily: 'var(--font-mono)' }}>2 seans</span>
          </div>
        </PanelSurface>

        <div className="grid grid-cols-3 gap-2">
          <PanelKpi label="Aktif paket" value="3" />
          <PanelKpi label="Bu ay düşen" value="18" badge="otomatik" />
          <PanelKpi label="Biten" value="1" badge="yenileme" />
        </div>

        <div className="rounded-[12px] border border-[#f3dde5] bg-[#FFF0F5] px-3 py-2 text-[11px] leading-relaxed text-[#7d6a72]">
          Ücretli randevu paketten seans düşürmez — aynı iş iki kez ödetilmez.
        </div>
      </PanelBody>
    </>
  )
}

function CashScreen() {
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Kasa Kapanışı']} title="Gün sonu kasa" hint="19:00" />
      <PanelBody>
        <div className="grid grid-cols-3 gap-2">
          <PanelKpi label="Nakit" value="₺8.400" />
          <PanelKpi label="Kart" value="₺12.100" />
          <PanelKpi label="Havale" value="₺5.200" />
        </div>

        <PanelSurface>
          <dl className="space-y-1.5 text-[11.5px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[#7d6a72]">Beklenen</dt>
              <dd className="tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>₺25.700</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[#7d6a72]">Sayılan</dt>
              <dd className="tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>₺25.700</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-[#F6E7EE] pt-1.5">
              <dt className="font-medium text-[#352432]">Net kasa</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>₺25.700</dd>
            </div>
          </dl>
        </PanelSurface>

        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="text-[11.5px] font-medium text-emerald-800">Fark yok — sayım tuttu</span>
          <span className="text-[10.5px] text-emerald-700">Kapanış kilitlendi</span>
        </div>
      </PanelBody>
    </>
  )
}

function PortalScreen() {
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Onaylar']} title="Online randevu talepleri" hint="3 bekleyen" />
      <PanelBody>
        <PanelSurface>
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#7d6a72]">Danışanın gördüğü saatler</div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {['10:00', '10:45', '11:30', '12:15', '13:00', '13:45', '14:30', '15:15'].map((t, i) => (
              <span
                key={t}
                className={`rounded-[9px] border px-1 py-1.5 text-center text-[10.5px] tabular-nums ${
                  i === 2 ? 'border-[#EF6F94] bg-[#EF6F94] text-white' : 'border-[#f3dde5] bg-white text-[#7d6a72]'
                }`}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {t}
              </span>
            ))}
          </div>
        </PanelSurface>

        <PanelSurface>
          <ul className="divide-y divide-[#F6E7EE]">
            {[['Ayşe Demir', '11:30 · Cilt bakımı'], ['Buse Yıldırım', '14:30 · Lazer epilasyon']].map(([n, s]) => (
              <li key={n} className="flex items-center gap-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[#352432]">{n}</span>
                  <span className="block truncate text-[10.5px] text-[#7d6a72]">{s}</span>
                </span>
                <span className="shrink-0 rounded-full bg-[#EF6F94] px-2 py-0.5 text-[9.5px] font-medium text-white">Onayla</span>
                <span className="shrink-0 rounded-full border border-[#f3dde5] px-2 py-0.5 text-[9.5px] text-[#7d6a72]">Reddet</span>
              </li>
            ))}
          </ul>
        </PanelSurface>

        <div className="rounded-[12px] border border-[#f3dde5] bg-[#FFF0F5] px-3 py-2 text-[11px] leading-relaxed text-[#7d6a72]">
          Hatırlatma WhatsApp’tan gider; danışan “Evet” yazınca randevu onaylanır.
        </div>
      </PanelBody>
    </>
  )
}

function ReportScreen() {
  const rows: Array<[string, string, number]> = [
    ['Lazer epilasyon', '₺186.400', 82],
    ['Cilt bakımı', '₺124.900', 58],
    ['Bölgesel incelme', '₺78.200', 36],
    ['Kaş & kirpik', '₺38.500', 18],
  ]
  return (
    <>
      <PanelHead crumbs={['Ana Sayfa', 'Raporlar']} title="Hizmet performansı" hint="Son 30 gün" />
      <PanelBody>
        <div className="grid grid-cols-3 gap-2">
          <PanelKpi label="Ciro" value="₺428.000" badge="+%18" />
          <PanelKpi label="Gider" value="₺96.500" />
          <PanelKpi label="Net kâr" value="₺331.500" badge="kâr-zarar" />
        </div>

        <PanelSurface>
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#7d6a72]">Hizmet kırılımı</div>
          <ul className="mt-2 space-y-2.5">
            {rows.map(([name, amount, pct]) => (
              <li key={name}>
                <div className="flex items-baseline justify-between text-[11.5px]">
                  <span className="text-[#4A3A44]">{name}</span>
                  <span className="tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>{amount}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#FFECF2]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#f3a3bf] to-[#EF6F94]" style={{ width: `${pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </PanelSurface>
      </PanelBody>
    </>
  )
}
