import { LandingGsapReveals, LightFaq, LightFinalCta, LightFrameStory, LightPricing } from '@/components/landing/LandingRevampSections'
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Gem,
  LayoutDashboard,
  LineChart,
  LockKeyhole,
  PackageCheck,
  Percent,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  UserRoundPlus,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'

interface MetricCard {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone: string
  chart: 'line' | 'bars' | 'donut'
}

interface ModuleCard {
  title: string
  body: string
  icon: LucideIcon
  stat: string
}

interface FlowStep {
  title: string
  body: string
  icon: LucideIcon
}

const navItems = [
  { href: '#hikaye', label: 'Vitrin' },
  { href: '#moduller', label: 'Modüller' },
  { href: '#akis', label: 'Akış' },
  { href: '#fiyat', label: 'Fiyat' },
  { href: '#sss', label: 'SSS' },
]

const metrics: MetricCard[] = [
  {
    label: 'Bugünkü Randevular',
    value: '28',
    hint: '6 tamamlandı · 4 beklemede',
    icon: CalendarCheck,
    tone: 'bg-rose-50 text-rose-500 ring-rose-100',
    chart: 'line',
  },
  {
    label: 'Günlük Ciro',
    value: '₺42.500',
    hint: 'Düne göre +%18',
    icon: CircleDollarSign,
    tone: 'bg-amber-50 text-amber-600 ring-amber-100',
    chart: 'bars',
  },
  {
    label: 'Yeni Danışanlar',
    value: '12',
    hint: 'Bu hafta +34',
    icon: UserRoundPlus,
    tone: 'bg-violet-50 text-violet-500 ring-violet-100',
    chart: 'line',
  },
  {
    label: 'Doluluk Oranı',
    value: '%76',
    hint: 'Personel ve oda bazlı',
    icon: Percent,
    tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    chart: 'donut',
  },
]

const modules: ModuleCard[] = [
  {
    title: 'Danışan CRM',
    body: 'Paket, borç, seans, randevu, not ve ödeme geçmişi tek danışan kartında görünür.',
    icon: UsersRound,
    stat: '360° kart',
  },
  {
    title: 'Randevu Takvimi',
    body: 'Uzman, oda, hizmet ve durum akışı çakışmasız yönetilir; gün sonu netleşir.',
    icon: CalendarDays,
    stat: 'Canlı akış',
  },
  {
    title: 'Paket & Seans',
    body: 'Lazer, cilt bakımı, incelme gibi hizmetlerde toplam/kalan seans otomatik takip edilir.',
    icon: PackageCheck,
    stat: 'Otomatik düşüm',
  },
  {
    title: 'Ön Muhasebe',
    body: 'Nakit, kart, havale, taksit, geciken alacak ve günlük kasa tek panelde kapanır.',
    icon: CreditCard,
    stat: 'Cari kontrol',
  },
  {
    title: 'Personel Performansı',
    body: 'Uzman bazlı randevu, ciro, puan, prim ve doluluk raporu yöneticinin önüne gelir.',
    icon: BarChart3,
    stat: 'Prim raporu',
  },
  {
    title: 'Stok & Kampanya',
    body: 'Kritik stok uyarısı, ürün çıkışı ve kampanya kurguları premium operasyona bağlanır.',
    icon: Tags,
    stat: 'Uyarı sistemi',
  },
]

const flow: FlowStep[] = [
  {
    title: 'Randevu oluşturulur',
    body: 'Danışan, hizmet, uzman ve saat seçilir; çakışma riski panelde görünür.',
    icon: CalendarCheck,
  },
  {
    title: 'Seans ve paket güncellenir',
    body: 'Tamamlanan işlem paketten düşer; kalan haklar danışan kartına işlenir.',
    icon: PackageCheck,
  },
  {
    title: 'Tahsilat plana bağlanır',
    body: 'Düzensiz ödeme bile eski kayıtları bozmadan yeni taksit planına dönüşür.',
    icon: ReceiptText,
  },
  {
    title: 'Yönetici raporu alır',
    body: 'Günlük kasa, personel performansı, alacak ve stok uyarıları tek ekranda kapanır.',
    icon: LineChart,
  },
]

const pricingFeatures = [
  'Sınırsız danışan kartı ve randevu akışı',
  'Paket, seans, taksit ve kasa yönetimi',
  'Personel performansı ve stok uyarıları',
  'PDF / Excel raporları ve rol bazlı paneller',
]

function BrandMark() {
  return (
    <a href="/" className="group flex items-center gap-3" aria-label="BeautyAsist ana sayfa">
      <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border border-[#ead8df] bg-white shadow-[0_14px_34px_-24px_rgba(142,63,91,0.65)]">
        <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full scale-125 object-cover transition duration-500 group-hover:scale-110" />
      </span>
      <span className="leading-none">
        <span className="block font-display text-[18px] tracking-[-0.04em] text-[#6f4153]">BeautyAsist</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.28em] text-[#b58295]">Güzellik merkezi</span>
      </span>
    </a>
  )
}

function Header() {
  return (
    <header
      data-landing-nav
      className="fixed inset-x-0 top-0 z-50 border-b border-[#e7bfd0]/80 bg-[#fbe7ef]/85 shadow-[0_18px_60px_-44px_rgba(142,63,91,0.7)] backdrop-blur-2xl"
    >
      {/* Üst ince marka şeridi */}
      <span aria-hidden className="block h-[3px] w-full bg-gradient-to-r from-[#df6688] via-[#f5abc0] to-[#ee789a]" />
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10 xl:px-14">
        <span data-nav-item className="inline-flex">
          <BrandMark />
        </span>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Ana navigasyon">
          {navItems.map((item) => (
            <a
              key={item.href}
              data-nav-item
              href={item.href}
              className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-[#5f4654] transition hover:bg-[#fff0f5] hover:text-[#c85776]"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            data-nav-item
            href="/salonlar"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#efbfd0] bg-white/80 px-4 text-[12px] font-bold text-[#c85776] shadow-[0_14px_32px_-22px_rgba(200,87,118,0.6)] transition hover:-translate-y-0.5 hover:border-[#ef9ab5] hover:bg-white sm:px-5"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            Randevu Al
          </a>
          <a
            data-nav-item
            href="/login"
            className="hidden min-h-11 items-center rounded-full bg-[#8e3f5b] px-5 text-[12px] font-bold text-white shadow-[0_14px_32px_-16px_rgba(142,63,91,0.8)] transition hover:bg-[#7a3450] sm:inline-flex"
          >
            Giriş
          </a>
          <a
            data-nav-item
            href="/login"
            className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#ee789a] via-[#ef8cad] to-[#f5abc0] px-4 text-[12px] font-bold text-white shadow-[0_18px_38px_-20px_rgba(200,87,118,0.82)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-20px_rgba(200,87,118,0.92)]"
          >
            Demo Al
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </header>
  )
}

function MiniLineChart() {
  return (
    <svg viewBox="0 0 96 42" className="h-12 w-24 overflow-visible" aria-hidden="true">
      <path d="M4 34 C18 29 21 19 33 23 C47 28 45 10 58 15 C72 21 75 8 92 5" fill="none" stroke="#d65f83" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M4 34 C18 29 21 19 33 23 C47 28 45 10 58 15 C72 21 75 8 92 5 L92 42 L4 42 Z" fill="url(#lineFill)" opacity="0.42" />
      <defs>
        <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#f5abc0" />
          <stop offset="1" stopColor="#fff7fa" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function MiniBars() {
  return (
    <div className="flex h-12 items-end gap-1.5" aria-hidden="true">
      {[18, 26, 34, 30, 42, 50].map((height, index) => (
        <span key={index} className="w-2.5 rounded-full bg-gradient-to-t from-[#e4c58a] to-[#f5e6bd]" style={{ height }} />
      ))}
    </div>
  )
}

function MiniDonut() {
  return (
    <div className="relative grid h-16 w-16 place-items-center rounded-full bg-[conic-gradient(#75bea0_0_76%,#eef7f3_76%_100%)] shadow-inner" aria-hidden="true">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-[12px] font-bold text-[#4d8f74]">76%</div>
    </div>
  )
}

function DashboardMetric({ item }: { item: MetricCard }) {
  const Icon = item.icon
  return (
    <article className="rounded-[26px] border border-[#ead8df]/80 bg-white/92 p-4 shadow-[0_22px_58px_-42px_rgba(142,63,91,0.78)] transition hover:-translate-y-1 hover:shadow-[0_30px_72px_-42px_rgba(142,63,91,0.88)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`inline-grid h-10 w-10 place-items-center rounded-2xl ring-1 ${item.tone}`}>
            <Icon className="h-4.5 w-4.5" />
          </span>
          <p className="mt-3 text-[12px] font-semibold text-[#6f5968]">{item.label}</p>
          <p className="mt-1 font-display text-[26px] leading-none text-[#211721]">{item.value}</p>
        </div>
        {item.chart === 'bars' ? <MiniBars /> : item.chart === 'donut' ? <MiniDonut /> : <MiniLineChart />}
      </div>
      <p className="mt-3 text-[11px] font-medium text-[#9b7b8d]">{item.hint}</p>
    </article>
  )
}

function AppointmentTable() {
  const rows = [
    ['10:00', 'Ayşe Korkmaz', 'Lazer Epilasyon', 'Elif Yıldız', 'Bekliyor', 'rose'],
    ['11:30', 'Zeynep Arslan', 'Cilt Bakımı', 'Merve Demir', 'Onaylandı', 'emerald'],
    ['13:00', 'Derya Topal', 'Bölgesel İncelme', 'Selin Kaya', 'Tamamlandı', 'violet'],
    ['14:30', 'Ayça Tan', 'Kaş Laminasyon', 'Elif Yıldız', 'Bekliyor', 'rose'],
  ]

  return (
    <div className="rounded-[28px] border border-[#ead8df]/80 bg-white/92 p-4 shadow-[0_24px_68px_-48px_rgba(142,63,91,0.75)]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[18px] text-[#211721]">Bugünkü Randevu Akışı</h3>
        <a href="/login" className="text-[12px] font-semibold text-[#d65f83]">Tümünü gör</a>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#f1e2e8]">
        <div className="grid grid-cols-[64px_1.2fr_1.2fr_1fr_94px] bg-[#fff8fa] px-3 py-3 text-[11px] font-semibold text-[#8d7180] max-md:hidden">
          <span>Saat</span><span>Danışan</span><span>İşlem</span><span>Uzman</span><span>Durum</span>
        </div>
        {rows.map((row) => (
          <div key={`${row[0]}-${row[1]}`} className="grid gap-2 border-t border-[#f2e6eb] px-3 py-3 text-[12px] text-[#55414f] md:grid-cols-[64px_1.2fr_1.2fr_1fr_94px]">
            <span className="font-semibold text-[#211721]">{row[0]}</span>
            <span className="flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#f7d0dc] to-[#fff3f7] ring-1 ring-[#efbfd0]" />{row[1]}</span>
            <span>{row[2]}</span>
            <span className="flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#ecd7c4] to-[#fff7ef] ring-1 ring-[#ead8df]" />{row[3]}</span>
            <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${row[5] === 'emerald' ? 'bg-emerald-50 text-emerald-700' : row[5] === 'violet' ? 'bg-violet-50 text-violet-700' : 'bg-rose-50 text-rose-700'}`}>{row[4]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickActions() {
  const actions = [
    { label: 'Yeni Randevu', icon: CalendarCheck, tone: 'bg-rose-50 text-rose-500' },
    { label: 'Danışan Ekle', icon: UserRoundPlus, tone: 'bg-pink-50 text-pink-500' },
    { label: 'Paket Satışı', icon: PackageCheck, tone: 'bg-amber-50 text-amber-600' },
    { label: 'Ödeme Al', icon: CreditCard, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Stok Çıkışı', icon: ClipboardList, tone: 'bg-violet-50 text-violet-600' },
    { label: 'Kampanya', icon: Tags, tone: 'bg-fuchsia-50 text-fuchsia-600' },
  ]

  return (
    <div className="rounded-[28px] border border-[#ead8df]/80 bg-white/92 p-4 shadow-[0_24px_68px_-48px_rgba(142,63,91,0.75)]">
      <h3 className="font-display text-[18px] text-[#211721]">Hızlı İşlemler</h3>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <a key={action.label} href="/login" className="group rounded-2xl border border-[#f0e0e6] bg-[#fffafb] p-3 text-center transition hover:-translate-y-1 hover:border-[#efbfd0] hover:bg-white hover:shadow-[0_18px_42px_-30px_rgba(142,63,91,0.75)]">
              <span className={`mx-auto grid h-10 w-10 place-items-center rounded-2xl ${action.tone}`}>
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="mt-2 block text-[11px] font-bold leading-snug text-[#4d3947]">{action.label}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function RevenuePanel() {
  const bars = [36, 52, 58, 74, 63, 70, 56]
  return (
    <div className="rounded-[28px] border border-[#ead8df]/80 bg-white/92 p-4 shadow-[0_24px_68px_-48px_rgba(142,63,91,0.75)]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[18px] text-[#211721]">Haftalık Gelir Analizi</h3>
        <span className="rounded-full border border-[#ead8df] bg-white px-3 py-1 text-[11px] font-semibold text-[#8d7180]">Bu Hafta</span>
      </div>
      <div className="mt-5 grid h-44 grid-cols-7 items-end gap-3 border-b border-l border-[#f0e0e6] px-4 pb-3">
        {bars.map((height, index) => (
          <div key={index} className="flex h-full flex-col items-center justify-end gap-2">
            <div className="relative flex h-full w-full items-end justify-center">
              <span className="w-full max-w-10 rounded-t-2xl bg-gradient-to-t from-[#ffdce8] via-[#ffeaf1] to-[#fff7fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]" style={{ height: `${height}%` }} />
              <span className="absolute h-2.5 w-2.5 translate-y-1/2 rounded-full bg-white ring-2 ring-[#d65f83]" style={{ bottom: `${height}%` }} />
            </div>
            <span className="text-[10px] font-semibold text-[#9b7b8d]">{['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'][index]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformancePanel() {
  const staff = [
    ['Elif Yıldız', '9', '₺14.000', '4.9'],
    ['Merve Demir', '7', '₺10.500', '4.8'],
    ['Selin Kaya', '6', '₺8.750', '4.7'],
  ]
  return (
    <div className="rounded-[28px] border border-[#ead8df]/80 bg-white/92 p-4 shadow-[0_24px_68px_-48px_rgba(142,63,91,0.75)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[18px] text-[#211721]">Personel Performansı</h3>
        <Gem className="h-4.5 w-4.5 text-[#d9b56c]" />
      </div>
      <div className="space-y-2.5">
        {staff.map((row) => (
          <div key={row[0]} className="grid grid-cols-[1fr_42px_74px_42px] items-center gap-2 rounded-2xl bg-[#fffafb] px-3 py-2 text-[11px] text-[#6f5968]">
            <span className="flex items-center gap-2 font-semibold text-[#4d3947]"><span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#f2c4d2] to-white ring-1 ring-[#efbfd0]" />{row[0]}</span>
            <span>{row[1]}</span>
            <span>{row[2]}</span>
            <span className="flex items-center gap-1 font-bold text-[#8e6f3e]">{row[3]} <Star className="h-3 w-3 fill-[#ddb968] text-[#ddb968]" /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardMockup() {
  return (
    <div id="urun" className="relative mx-auto w-full max-w-[1160px] scroll-mt-28 rounded-[34px] border border-white/80 bg-white/60 p-2 shadow-[0_34px_120px_-58px_rgba(142,63,91,0.75)] backdrop-blur-2xl">
      <div className="overflow-hidden rounded-[28px] border border-[#ead8df]/80 bg-[#fffafb]">
        <div className="grid lg:grid-cols-[214px_1fr]">
          <aside className="hidden border-r border-[#f0e0e6] bg-gradient-to-b from-[#fff4f8] to-[#fffafd] p-4 lg:block">
            <div className="mb-8 flex items-center gap-3 px-1">
              <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-[#ead8df]">
                <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full scale-125 object-cover" />
              </span>
              <div>
                <div className="font-display text-[22px] text-[#9b7444]">Bellora</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-[#b58295]">kalitesinde</div>
              </div>
            </div>
            <nav className="space-y-1.5">
              {[
                ['Dashboard', LayoutDashboard, true],
                ['Randevular', CalendarDays, false],
                ['Danışanlar', UsersRound, false],
                ['Hizmetler', WandSparkles, false],
                ['Paketler', PackageCheck, false],
                ['Ödemeler', CreditCard, false],
                ['Personel', ShieldCheck, false],
                ['Raporlar', LineChart, false],
              ].map(([label, Icon, active]) => {
                const MenuIcon = Icon as LucideIcon
                return (
                  <span key={label as string} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-[13px] font-semibold ${active ? 'bg-[#ffe9f0] text-[#c85776]' : 'text-[#69515f]'}`}>
                    <MenuIcon className="h-4.5 w-4.5" />
                    {label as string}
                  </span>
                )
              })}
            </nav>
            <div className="mt-10 rounded-[24px] bg-gradient-to-br from-[#ffe4ed] to-white p-4 shadow-inner">
              <Sparkles className="h-4 w-4 text-[#d65f83]" />
              <p className="mt-3 font-display text-[18px] leading-tight text-[#9d5570]">Güzelliğinizi yönetin, başarıyı büyütün.</p>
            </div>
          </aside>
          <section className="p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex min-h-12 flex-1 items-center gap-3 rounded-2xl border border-[#ead8df] bg-white px-4 text-[12px] text-[#9b7b8d] shadow-[0_12px_34px_-28px_rgba(142,63,91,0.65)]">
                <Sparkles className="h-4 w-4 text-[#d65f83]" />
                Danışan, randevu, işlem veya personel ara...
              </div>
              <span className="hidden h-11 w-11 place-items-center rounded-2xl bg-white text-[#7c6170] ring-1 ring-[#ead8df] sm:grid"><Bell className="h-4.5 w-4.5" /></span>
              <a href="/login" className="hidden min-h-11 items-center gap-2 rounded-2xl bg-[#ee789a] px-4 text-[12px] font-bold text-white shadow-[0_16px_34px_-22px_rgba(200,87,118,0.85)] sm:inline-flex"><Plus className="h-4 w-4" /> Yeni Randevu</a>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => <DashboardMetric key={metric.label} item={metric} />)}
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_0.95fr]">
              <AppointmentTable />
              <QuickActions />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.85fr]">
              <RevenuePanel />
              <PerformancePanel />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden px-4 pb-20 pt-32 sm:px-6 sm:pt-36 lg:px-8 lg:pb-28">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,220,232,0.95),transparent_36%),radial-gradient(circle_at_88%_18%,rgba(255,240,245,0.9),transparent_34%),linear-gradient(180deg,#fffafb_0%,#fff6f9_64%,#fff0f5_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-[#ffdce8]/34 blur-3xl" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[#efbfd0] bg-white/75 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#b65f7b] shadow-[0_18px_48px_-34px_rgba(142,63,91,0.62)] backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5" />
            Premium güzellik merkezi yönetimi
          </div>
          <h1 className="font-display text-[clamp(3.05rem,8vw,7.35rem)] leading-[0.92] tracking-[-0.065em] text-[#251923]">
            Güzellik merkeziniz için zarif, hızlı ve tek panel.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-8 text-[#755d6d] sm:text-[18px]">
            Danışan, randevu, paket, seans, taksit, kasa ve personel akışını açık pudra-beyaz premium arayüzde birleştiren yönetim sistemi.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="/login" className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-7 text-[14px] font-bold text-white shadow-[0_22px_50px_-22px_rgba(200,87,118,0.92)] transition hover:-translate-y-0.5">
              Paneli Deneyin
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </a>
            <a href="#urun" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-[#ead8df] bg-white/78 px-7 text-[14px] font-bold text-[#6f4153] shadow-[0_16px_42px_-30px_rgba(142,63,91,0.62)] transition hover:border-[#ef9ab5] hover:text-[#c85776]">
              Arayüzü Gör
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-3 gap-3 text-left">
            {[
              ['9+', 'operasyon modülü'],
              ['360°', 'danışan kartı'],
              ['7/24', 'bulut panel'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-[22px] border border-white/80 bg-white/62 p-4 text-center shadow-[0_16px_44px_-36px_rgba(142,63,91,0.7)] backdrop-blur-xl">
                <div className="font-display text-[28px] leading-none text-[#c85776]">{value}</div>
                <div className="mt-1 text-[11px] font-semibold text-[#8d7180]">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14">
          <DashboardMockup />
        </div>
      </div>
    </section>
  )
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="mb-4 inline-flex rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[#b65f7b] shadow-[0_14px_40px_-34px_rgba(142,63,91,0.62)]">{eyebrow}</div>
      <h2 className="font-display text-[clamp(2.35rem,5vw,5rem)] leading-[0.96] tracking-[-0.055em] text-[#251923]">{title}</h2>
      <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-8 text-[#755d6d]">{body}</p>
    </div>
  )
}

function ModulesSection() {
  return (
    <section id="moduller" className="relative px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#fff0f5_0%,#fffafb_50%,#fff4f8_100%)]" />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Modüler operasyon"
          title="Salonun her kritik işi aynı zarif sistemde."
          body="Referans dashboard kalitesindeki kart mimarisi; yöneticinin en sık baktığı verileri yormadan, hataya açık Excel akışını azaltarak gösterir."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon
            return (
              <article key={module.title} className="group rounded-[30px] border border-[#ead8df]/80 bg-white/78 p-6 shadow-[0_24px_70px_-48px_rgba(142,63,91,0.72)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-[#efbfd0] hover:bg-white hover:shadow-[0_32px_88px_-48px_rgba(142,63,91,0.85)]">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df] transition group-hover:scale-105">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full bg-[#fff7fa] px-3 py-1 text-[11px] font-bold text-[#b65f7b] ring-1 ring-[#f0dfe7]">{module.stat}</span>
                </div>
                <h3 className="mt-6 font-display text-[24px] tracking-[-0.04em] text-[#251923]">{module.title}</h3>
                <p className="mt-3 text-[14px] leading-7 text-[#755d6d]">{module.body}</p>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FlowSection() {
  return (
    <section id="akis" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(255,220,232,0.8),transparent_34%),linear-gradient(180deg,#fff4f8_0%,#fffafb_100%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <div className="mb-4 inline-flex rounded-full border border-[#efbfd0] bg-white/74 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[#b65f7b]">Operasyon akışı</div>
            <h2 className="font-display text-[clamp(2.35rem,5vw,5rem)] leading-[0.96] tracking-[-0.055em] text-[#251923]">
              Her işlem kendi sonucunu otomatik üretir.
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-8 text-[#755d6d]">
              Randevu sadece takvim kaydı değildir; seans, tahsilat, kasa ve raporlama zincirini tetikleyen operasyon merkezidir.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {['Çakışmasız takvim', 'Kalan seans', 'Geciken alacak', 'PDF/Excel rapor'].map((item) => (
                <span key={item} className="rounded-full border border-[#ead8df] bg-white/72 px-4 py-2 text-[12px] font-bold text-[#6f4153]">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-[34px] border border-white/80 bg-white/62 p-3 shadow-[0_34px_110px_-60px_rgba(142,63,91,0.78)] backdrop-blur-2xl">
            <div className="rounded-[28px] border border-[#ead8df]/80 bg-[#fffafb] p-5">
              <div className="grid gap-4">
                {flow.map((step, index) => {
                  const Icon = step.icon
                  return (
                    <article key={step.title} className="relative grid gap-4 rounded-[24px] border border-[#f0e0e6] bg-white/86 p-4 shadow-[0_18px_46px_-36px_rgba(142,63,91,0.65)] sm:grid-cols-[56px_1fr]">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#c85776]">0{index + 1}</div>
                        <h3 className="mt-1 font-display text-[22px] text-[#251923]">{step.title}</h3>
                        <p className="mt-2 text-[14px] leading-7 text-[#755d6d]">{step.body}</p>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PricingSection() {
  return (
    <section id="fiyat" className="relative px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#fffafb_0%,#fff0f5_100%)]" />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Premium başlangıç"
          title="Küçük ekipten çok şubeli yapıya kadar hazır."
          body="Açık pudra dashboard dili; sade, güvenilir, yüksek kontrastlı ve ürün odaklı bir satın alma deneyimine dönüşür."
        />
        <div className="mx-auto mt-14 grid max-w-5xl gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[32px] border border-[#ead8df]/80 bg-white/78 p-7 shadow-[0_28px_82px_-52px_rgba(142,63,91,0.76)] backdrop-blur-xl">
            <div className="inline-flex rounded-full bg-[#fff0f5] px-3 py-1 text-[11px] font-bold text-[#b65f7b] ring-1 ring-[#ffd3df]">Operasyon paketi</div>
            <h3 className="mt-5 font-display text-[34px] tracking-[-0.05em] text-[#251923]">Tek panel lisansı</h3>
            <p className="mt-3 text-[14px] leading-7 text-[#755d6d]">Güzellik merkezi operasyonunu Excel’den çıkarıp web, tablet ve masaüstü panellerde yönetmek için.</p>
            <a href="/login" className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#ee789a] px-5 text-[13px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)]">
              Teklif / Demo Al <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="rounded-[32px] border border-[#ead8df]/80 bg-white/90 p-7 shadow-[0_28px_82px_-52px_rgba(142,63,91,0.76)]">
            <div className="grid gap-3 sm:grid-cols-2">
              {pricingFeatures.map((feature) => (
                <div key={feature} className="flex gap-3 rounded-2xl bg-[#fff7fa] p-4 text-[14px] font-semibold leading-6 text-[#5d4652] ring-1 ring-[#f0e0e6]">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><Check className="h-3.5 w-3.5" /></span>
                  {feature}
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-[24px] bg-gradient-to-r from-[#fff0f5] to-white p-5 ring-1 ring-[#f0dfe7]">
              <div className="flex items-center gap-3 text-[13px] font-bold text-[#6f4153]"><LockKeyhole className="h-4.5 w-4.5 text-[#d65f83]" /> Rol bazlı güvenli erişim</div>
              <p className="mt-2 text-[13px] leading-6 text-[#856a7a]">Platform, admin ve personel panelleri aynı veri modelinden beslenir; yetki dışı aksiyonlar arayüzde net ayrılır.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[#fff0f5]" />
      <div className="absolute left-1/2 top-1/2 h-[520px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffdce8]/65 blur-3xl" />
      <div className="relative mx-auto max-w-5xl rounded-[40px] border border-white/80 bg-white/72 p-8 text-center shadow-[0_38px_130px_-70px_rgba(142,63,91,0.82)] backdrop-blur-2xl sm:p-12">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#fff0f5] text-[#d65f83] ring-1 ring-[#ffd3df]"><WandSparkles className="h-6 w-6" /></div>
        <h2 className="mx-auto mt-6 max-w-3xl font-display text-[clamp(2.4rem,5.5vw,5.3rem)] leading-[0.94] tracking-[-0.06em] text-[#251923]">
          Yeni vitrin, ürün kalitesini ilk saniyede hissettiriyor.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-8 text-[#755d6d]">
          Açık pudra arayüz, gerçek dashboard mockup, güçlü modül anlatımı ve net demo aksiyonu ile güzellik merkezi projesi artık premium hissediyor.
        </p>
        <a href="/login" className="mt-8 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-7 text-[14px] font-bold text-white shadow-[0_22px_50px_-22px_rgba(200,87,118,0.92)]">
          Demo Paneline Geç <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  )
}

function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden border-t border-[#ead8df] bg-[linear-gradient(180deg,#fffafb_0%,#fff0f5_100%)] px-4 py-14 sm:px-6 lg:px-10 xl:px-14">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-[#ffdce8]/64 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-0 h-80 w-80 rounded-full bg-[#fff7fa] blur-3xl" />
      <div className="relative w-full">
        <div className="grid gap-10 rounded-[38px] border border-white/80 bg-white/70 p-6 shadow-[0_34px_110px_-68px_rgba(142,63,91,0.72)] backdrop-blur-2xl md:grid-cols-[1.4fr_0.8fr_0.8fr_1fr] lg:p-10">
          <div>
            <BrandMark />
            <p className="mt-5 max-w-sm text-[14px] leading-7 text-[#755d6d]">
              Güzellik merkezleri için danışan, randevu, paket, seans, taksit, kasa ve personel yönetimini tek premium panelde toplar.
            </p>
            <a href="/login" className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#df6688] via-[#ee789a] to-[#f4a3bb] px-5 text-[13px] font-bold text-white shadow-[0_18px_40px_-22px_rgba(200,87,118,0.88)] transition hover:-translate-y-0.5">
              Demo Paneline Geç <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b65f7b]">Ürün</div>
            <ul className="mt-4 space-y-3 text-[13px] font-semibold text-[#6f5968]">
              <li><a href="#hikaye" className="hover:text-[#c85776]">Frame-scroll vitrin</a></li>
              <li><a href="#moduller" className="hover:text-[#c85776]">Ana modüller</a></li>
              <li><a href="#akis" className="hover:text-[#c85776]">Operasyon akışı</a></li>
              <li><a href="#fiyat" className="hover:text-[#c85776]">Paketler</a></li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b65f7b]">Modüller</div>
            <ul className="mt-4 space-y-3 text-[13px] font-semibold text-[#6f5968]">
              <li>Danışan CRM</li>
              <li>Randevu takvimi</li>
              <li>Paket ve seans</li>
              <li>Ön muhasebe</li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b65f7b]">Kalite standardı</div>
            <div className="mt-4 rounded-[26px] border border-[#ead8df]/80 bg-[#fffafb] p-4">
              <div className="font-display text-[26px] leading-tight tracking-[-0.04em] text-[#251923]">Pudra-beyaz premium arayüz</div>
              <p className="mt-2 text-[13px] leading-6 text-[#755d6d]">GSAP scroll, frame sequence ve okunabilir kart mimarisi aynı tasarım dilinde çalışır.</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b7b8d] sm:flex-row sm:items-center sm:justify-between">
          <span>© {year} Özlem Özge Güzellik Merkezi Yönetim Sistemi</span>
          <div className="flex flex-wrap gap-4">
            <a href="#sss" className="hover:text-[#c85776]">SSS</a>
            <a href="/salonlar" className="hover:text-[#c85776]">Randevu Al</a>
            <a href="/login" className="hover:text-[#c85776]">Giriş</a>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#fff7fa] text-[#352432]">
      <LandingGsapReveals />
      <Header />
      <LightFrameStory />
      <ModulesSection />
      <FlowSection />
      <LightPricing />
      <LightFaq />
      <LightFinalCta />
      <Footer />
    </main>
  )
}
