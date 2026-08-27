import type { Metadata } from 'next'
import Nav from '@/components/landing/apple/Nav'
import Reveal from '@/components/landing/Reveal'
import PressButton from '@/components/landing/apple/PressButton'
import AmbientVideo from '@/components/landing/apple/AmbientVideo'
import {
  ArrowRight, Bell, Boxes, Calendar, CalendarCheck, ClipboardList, Check, Gift, Hourglass,
  Landmark, Package, Settings as SettingsIcon, ShieldCheck, Users, Wallet, FileBarChart,
  type LucideIcon,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Modüller ve yetkiler — BeautyAsist',
  description:
    'Kurum yöneticisi ve personelin panelde yapabildiği her şey: sayfa sayfa modüller, işlem izinleri ve onay kapısı.',
}

/**
 * MODÜLLER SAYFASI — panelin TAM yetki haritası.
 *
 * KAYNAK: `backend/src/GuzellikMerkezi.Domain/Permissions.cs`. Aşağıdaki sayfa ve işlem
 * anahtarları o dosyadaki `Permissions.All` kataloğunun birebir karşılığıdır; etiketler de
 * oradan alınmıştır. Vitrinde olmayan bir özellik vaat edilmez — yeni bir satır eklenecekse
 * ÖNCE o anahtarın katalogda var olduğu doğrulanmalıdır.
 *
 * İKİ SEVİYELİ YETKİ (bkz. lib/permissions.ts): personelin yetkisi SAYFA (ör. `Customers`)
 * ve İŞLEM (ör. `Customers.Delete`) olarak ikiye ayrılır. Kurum yöneticisi bütün sayfalara
 * ve işlemlere sahiptir; personele yalnız seçilenler açılır.
 */

interface Action {
  key: string
  label: string
}

interface ModulePage {
  key: string
  title: string
  summary: string
  icon: LucideIcon
  actions: Action[]
  /** Bu sayfa personele genelde verilmez (yönetici alanı). */
  adminOnly?: boolean
}

const PAGES: ModulePage[] = [
  {
    key: 'Customers',
    title: 'Müşteriler',
    summary: 'Müşteri kartı, bilgi-onay formu ve tedavi günlüğünü görme.',
    icon: Users,
    actions: [
      { key: 'Customers.Manage', label: 'Müşteri ekleme / düzenleme' },
      { key: 'Customers.Delete', label: 'Müşteri silme' },
      { key: 'Customers.Tags', label: 'VIP & kara liste etiketi' },
    ],
  },
  {
    key: 'Appointments',
    title: 'Randevular',
    summary: 'Takvim, çizelge görünümü ve randevuları görme.',
    icon: Calendar,
    actions: [
      { key: 'Appointments.Create', label: 'Randevu oluşturma / düzenleme' },
      { key: 'Appointments.Status', label: 'Durum güncelleme (Tamamlandı / İptal / Gelmedi)' },
      { key: 'Appointments.VoidCompletion', label: 'Yanlış tamamlamayı geri alma (seansı iade eder)' },
    ],
  },
  {
    key: 'Waitlist',
    title: 'Bekleme Listesi',
    summary: 'Dolu güne talep listesini görme.',
    icon: Hourglass,
    actions: [
      { key: 'Waitlist.Manage', label: 'Talep ekleme / kapatma / slot teklifi' },
      { key: 'Waitlist.Convert', label: 'Bekleme kaydını randevuya aktarma' },
    ],
  },
  {
    key: 'Services',
    title: 'Paket, Hizmet & Seans',
    summary: 'Hizmet/paket kataloğu, kampanyalar ve seans takibini görme.',
    icon: Package,
    actions: [
      { key: 'Services.Manage', label: 'Hizmet / paket / kampanya tanımlama' },
      { key: 'Services.Delete', label: 'Hizmet / paket silme (toplu silme dahil)' },
    ],
  },
  {
    key: 'GiftCards',
    title: 'Hediye Çeki & Kupon',
    summary: 'Hediye çeki ve kuponları görme.',
    icon: Gift,
    actions: [{ key: 'GiftCards.Manage', label: 'Çek / kupon tanımlama ve iptal' }],
  },
  {
    key: 'Stock',
    title: 'Stok & Ürün',
    summary: 'Ürün listesi ve kritik stok uyarılarını görme.',
    icon: Boxes,
    actions: [
      { key: 'Stock.Manage', label: 'Ürün tanımlama / düzenleme' },
      { key: 'Stock.Delete', label: 'Ürün silme (toplu silme dahil)' },
      { key: 'Stock.Movements', label: 'Stok giriş / çıkış hareketi' },
    ],
  },
  {
    key: 'CashRegister',
    title: 'Günlük Kasa',
    summary: 'Kasa ve gelir-gider akışını görme.',
    icon: Wallet,
    actions: [{ key: 'CashRegister.Entry', label: 'Gelir / gider girişi' }],
  },
  {
    key: 'CashClosing',
    title: 'Kasa Kapanışı',
    summary: 'Gün sonu Z raporlarını görme.',
    icon: CalendarCheck,
    actions: [{ key: 'CashClosing.Close', label: 'Kapanış kaydı oluşturma (sayım + mutabakat)' }],
  },
  {
    key: 'Accounting',
    title: 'Ön Muhasebe',
    summary: 'Adisyon, cari hesap, taksit ve giderleri görme.',
    icon: Landmark,
    actions: [
      { key: 'Accounting.Adisyon', label: 'Adisyon açma / kalem ekleme' },
      { key: 'Accounting.Accounts', label: 'Cari hesap oluşturma / düzenleme' },
      { key: 'Accounting.Collect', label: 'Tahsilat kaydı alma' },
      { key: 'Accounting.Expenses', label: 'Gider girişi' },
      { key: 'Accounting.VoidRefund', label: 'Yapılmış para iadesini geçersiz kılma' },
      { key: 'Accounting.VoidExpense', label: 'Onaylanmış gideri geçersiz kılma' },
    ],
  },
  {
    key: 'Reports',
    title: 'Raporlar',
    summary: 'Finans, müşteri, personel ve hizmet raporlarını görme (PDF/Excel).',
    icon: FileBarChart,
    actions: [],
  },
  {
    key: 'Notifications',
    title: 'Bildirimler',
    summary: 'Mesaj şablonları ve gönderim geçmişini görme.',
    icon: Bell,
    actions: [
      { key: 'Notifications.Send', label: 'SMS / WhatsApp / e-posta gönderimi' },
      { key: 'Notifications.Templates', label: 'Şablon oluşturma / düzenleme' },
    ],
  },
  {
    key: 'Logs',
    title: 'Loglar',
    summary: 'Sistem ve denetim (audit) günlükleri.',
    icon: ClipboardList,
    actions: [],
  },
  {
    key: 'Settings',
    title: 'Ayarlar',
    summary: 'Şube ve genel ayarlar — yönetici alanı.',
    icon: SettingsIcon,
    actions: [],
    adminOnly: true,
  },
]

/** Panelde yalnız kurum yöneticisinde olan, izinle personele açılmayan yetkiler. */
const ADMIN_ONLY = [
  'Personel tanımlama, giriş bilgisi üretme ve yetki setini belirleme',
  'Personelin yaptığı taslak işlemleri onaylama ya da reddetme',
  'Şube açma, şubeler arası personel ve veri aktarımı',
  'Paket/abonelik yönetimi, fatura ve ödeme yöntemi',
  'Kurum profili, salon vitrini ve online randevu ayarları',
  'KVKK aydınlatma metni ve onam formu şablonları',
  'Cihaz güvenliği: personelin hangi cihazdan girebileceği',
  'Denetim günlüğü: kim, ne zaman, neyi değiştirdi',
]

/** Personelin yetkisi olmasa da her zaman geçerli olan kurallar. */
const STAFF_RULES = [
  'Personelin yazma işlemleri taslağa düşer; yönetici onaylayana kadar uygulanmaz.',
  'Danışan telefonunun yalnız son 4 hanesini görür, e-posta maskelenir.',
  'Yalnız kendisine açılan şubenin verisini görür.',
  'Sayfa izni yoksa o sayfaya ait hiçbir işlemi yapamaz.',
  'Her işlem denetim günlüğüne kullanıcı ve zaman damgasıyla yazılır.',
]

export default function ModulesPage() {
  const totalActions = PAGES.reduce((n, p) => n + p.actions.length, 0)

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#FFF7FA] text-[#352432] antialiased">
      {/* Sayfanın zemini: tanıtım sayfasındaki ürün bloğuyla aynı ipek düzlemi — aynı ailedendir. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <AmbientVideo src="/landing/film/moduller.mp4" poster="/landing/film/moduller.webp" priority />
        <div className="absolute inset-0 bg-[#FFF7FA]/78" />
      </div>

      <div className="relative z-10">
        <Nav />

        <main>
          <section className="mx-auto max-w-[1200px] px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
            <Reveal>
              <div className="material-light material-thick mx-auto max-w-[70ch] rounded-[26px] px-7 py-9 text-center sm:px-10 sm:py-11">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#EF6F94]">
                  Modüller ve yetkiler
                </span>
                <h1 className="display-lg balance mt-4 text-[#352432]">Panelde ne varsa, burada yazıyor.</h1>
                <p className="on-material balance mx-auto mt-5 max-w-[58ch] text-[16px] leading-relaxed text-[#4A3A44]">
                  {PAGES.length} modül ve {totalActions} ayrı işlem izni. Kurum yöneticisi hepsine sahiptir;
                  personele hangi sayfanın hangi işlemi açılacağını tek tek siz seçersiniz.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <PressButton href="/kayit" tone="primary" className="px-6 py-3 text-[14.5px] font-medium">
                    14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
                  </PressButton>
                  <PressButton href="/#fiyat" tone="glass-light" className="border border-[#EEC9D7] px-6 py-3 text-[14.5px]">
                    Fiyatlandırmayı görün
                  </PressButton>
                </div>
              </div>
            </Reveal>
          </section>

          {/* ---- İKİ SEVİYELİ YETKİ AÇIKLAMASI ---- */}
          <section className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8">
            <div className="grid gap-4 lg:grid-cols-2">
              <Reveal>
                <div className="material-light h-full rounded-[22px] p-7">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94]">
                    <ShieldCheck className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.02em] text-[#352432]">
                    Kurum yöneticisi
                  </h2>
                  <p className="on-material mt-2 text-[13.5px] leading-relaxed text-[#5A4752]">
                    Aşağıdaki bütün modüllere ve işlemlere sahiptir. Ek olarak yalnız yöneticide olan
                    yetkiler:
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {ADMIN_ONLY.map((t) => (
                      <li key={t} className="on-material flex gap-2.5 text-[13.5px] leading-relaxed text-[#4A3A44]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={2.2} />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              <Reveal delay={70}>
                <div className="material-light h-full rounded-[22px] p-7">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94]">
                    <Users className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.02em] text-[#352432]">Personel</h2>
                  <p className="on-material mt-2 text-[13.5px] leading-relaxed text-[#5A4752]">
                    Yalnız kendisine açılan sayfaları ve o sayfalarda seçtiğiniz işlemleri görür.
                    İzinden bağımsız olarak her zaman geçerli kurallar:
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {STAFF_RULES.map((t) => (
                      <li key={t} className="on-material flex gap-2.5 text-[13.5px] leading-relaxed text-[#4A3A44]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={2.2} />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </section>

          {/* ---- MODÜL LİSTESİ ---- */}
          <section className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14">
            <Reveal>
              <h2 className="display-md balance text-[#352432]">Modül modül, işlem işlem</h2>
              <p className="on-material mt-3 max-w-[62ch] text-[15px] leading-relaxed text-[#4A3A44]">
                Her kartın başlığı bir <strong className="font-semibold">sayfa iznidir</strong>; altındaki
                satırlar o sayfada ayrı ayrı açılıp kapatılabilen <strong className="font-semibold">işlem
                izinleridir</strong>.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PAGES.map((page, i) => (
                <Reveal key={page.key} delay={(i % 3) * 60}>
                  <article className="material-light flex h-full flex-col rounded-[22px] p-6">
                    <div className="flex items-start gap-4">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94]">
                        <page.icon className="h-5 w-5" strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">
                          {page.title}
                        </h3>
                        <p className="on-material mt-1.5 text-[13px] leading-relaxed text-[#5A4752]">
                          {page.summary}
                        </p>
                      </div>
                    </div>

                    {page.actions.length > 0 ? (
                      <ul className="mt-5 space-y-2 border-t border-[#F2DFE7] pt-4">
                        {page.actions.map((a) => (
                          <li key={a.key} className="on-material flex gap-2.5 text-[13px] leading-relaxed text-[#4A3A44]">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EF6F94]" strokeWidth={2.4} />
                            {a.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-5 border-t border-[#F2DFE7] pt-4 text-[12.5px] text-[#705A66]">
                        {page.adminOnly
                          ? 'Yönetici alanı — personele genelde verilmez.'
                          : 'Ayrı bir işlem izni yoktur; sayfa izni görüntülemeye yeter.'}
                      </p>
                    )}
                  </article>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ---- KAPANIŞ ---- */}
          <section className="mx-auto max-w-[1200px] px-5 pb-20 sm:px-8 sm:pb-28">
            <Reveal>
              <div className="material-light material-thick flex flex-col items-start justify-between gap-6 rounded-[24px] p-7 sm:p-9 lg:flex-row lg:items-center">
                <div>
                  <h2 className="display-md text-[#352432]">Hepsi tek pakette.</h2>
                  <p className="on-material mt-2 max-w-[56ch] text-[14px] leading-relaxed text-[#4A3A44]">
                    Modüller ayrı ayrı satın alınan eklentiler değildir. Kurulum, veri aktarımı ve
                    eğitim dahildir; kredi kartı gerekmez.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-3">
                  <PressButton href="/kayit" tone="primary" className="px-6 py-3 text-[14.5px] font-medium">
                    14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
                  </PressButton>
                  <PressButton href="/" tone="glass-light" className="border border-[#EEC9D7] px-6 py-3 text-[14.5px]">
                    Tanıtıma dön
                  </PressButton>
                </div>
              </div>
            </Reveal>
          </section>
        </main>
      </div>
    </div>
  )
}
