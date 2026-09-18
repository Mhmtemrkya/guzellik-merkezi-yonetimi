import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/landing/apple/Nav'
import Reveal from '@/components/landing/Reveal'
import PressButton from '@/components/landing/apple/PressButton'
import AmbientVideo from '@/components/landing/apple/AmbientVideo'
import SupportForm from '@/components/support/SupportForm'
import PaymentBadges, { LegalLinkRow } from '@/components/legal/PaymentBadges'
import { company } from '@/lib/legal/company'
import {
  ArrowRight, BookOpen, Clock, Mail, MapPin, MessageCircle, Phone, Search,
  ShieldCheck, Ticket, Zap, type LucideIcon,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Destek — BeautyAsist',
  description:
    'BeautyAsist destek merkezi: talep oluşturun, takip kodunuzla durumunu izleyin, sık sorulan soruların yanıtlarını bulun.',
}

/**
 * DESTEK SAYFASI — tanıtım sayfasının bir parçası (aynı üst çubuk, aynı malzeme dili).
 *
 * <p>
 * <b>ÜÇ ŞEY AYNI SAYFADA:</b> (1) sık sorulanlar — çoğu kişinin aradığı yanıt zaten buradadır
 * ve talep açmasına gerek kalmaz; (2) talep formu; (3) mevcut talebi takip. Üçünü ayrı
 * sayfalara bölmek, "yardım" arayan kullanıcıyı gezinmeye zorlamak olurdu.
 * </p>
 *
 * <p>
 * <b>SSS ÖNCE GELİR, FORM SONRA.</b> Sırası bilinçlidir: hemen form göstermek, yanıtı bir
 * satır aşağıda yazan soruyu bile kuyruğa düşürür. Yine de form aynı ekranda ve tek kaydırma
 * uzaklıktadır — SSS'yi bir duvara çevirmek (önce şunu okuyun!) destek almayı zorlaştırırdı.
 * </p>
 *
 * <p>
 * Form bir istemci bileşenidir (<c>SupportForm</c>); sayfanın geri kalanı sunucuda render
 * edilir ve JavaScript olmadan da okunur.
 * </p>
 */

interface Faq {
  q: string
  a: string
}

/**
 * SIK SORULANLAR — panelde GERÇEKTEN var olan davranışları anlatır.
 * Vitrinde olmayan bir özellik vaat edilmez; her yanıtın panelde bir karşılığı vardır.
 */
const FAQS: Faq[] = [
  {
    q: 'Şifremi unuttum, ne yapmalıyım?',
    a: 'Giriş ekranındaki “Şifremi unuttum” bağlantısından hesap e-postanıza doğrulama kodu isteyin; kodu girip yeni şifrenizi belirleyin. Güvenlik için diğer tüm oturumlarınız kapatılır. Personelseniz kurum yöneticiniz de Personel sayfasından şifrenizi sıfırlayabilir.',
  },
  {
    q: 'Deneme süresi bitince verilerim silinir mi?',
    a: 'Hayır. Deneme bitince hesabınız askıya alınır ve panele giriş kapanır, ancak verileriniz durur. Bir paket seçtiğinizde kaldığınız yerden devam edersiniz.',
  },
  {
    q: 'Eski müşteri listemi sisteme aktarabilir miyim?',
    a: 'Evet. Panelde üst çubuktaki “İçeri Aktar” ile Excel dosyanızı yükleyebilirsiniz; kolon adları farklı olsa bile sistem eşleştirmeyi size sorar. Büyük listeler için kurulum ekibimiz aktarımı sizin yerinize yapar.',
  },
  {
    q: 'Personelim hangi sayfaları görebilir?',
    a: 'Yetki iki seviyelidir: sayfa izni (ör. Müşteriler) ve işlem izni (ör. Müşteri silme). Her personel için tek tek seçersiniz. Ayrıca personelin yazma işlemleri isterseniz onay kutunuza düşer; siz onaylamadan hiçbir kayıt değişmez.',
  },
  {
    q: 'WhatsApp hatırlatmaları nasıl çalışıyor?',
    a: 'Randevudan önce müşterinize otomatik hatırlatma gider ve müşteri “Evet/Hayır” yazarak randevusunu onaylayabilir ya da iptal edebilir. İptal olan slot bekleme listesindeki sıradaki kişiye teklif edilir. WhatsApp gönderimleri kontör ile çalışır; kontör bakiyenizi panelden görürsünüz.',
  },
  {
    q: 'Birden fazla şubem var, hepsini tek hesapta yönetebilir miyim?',
    a: 'Evet. Şubeleri Ayarlar sayfasından tanımlarsınız; üst çubuktaki şube seçicisiyle geçiş yaparsınız. Raporlarda şubeleri karşılaştırabilir, personeli şubeler arasında aktarabilirsiniz. Çok şube desteği pakete bağlıdır.',
  },
  {
    q: 'Hesabımı nasıl kapatırım?',
    a: 'Panelde Ayarlar sayfasının en altındaki “Hesabımı sil” bölümünden talep oluşturursunuz. Silme hemen gerçekleşmez: 30 gün bekleme süresi vardır ve bu süre içinde talebinizi geri alabilirsiniz. Süre boyunca panel normal çalışır, verilerinizi dışa aktarabilirsiniz.',
  },
  {
    q: 'Verilerim nerede saklanıyor, güvende mi?',
    a: 'Müşteri adı, telefonu, T.C. kimlik numarası ve notlar gibi hassas alanlar veritabanında AES-256-GCM ile şifrelenir. Tüm iletişim HTTPS üzerinden yapılır. Panele giriş iki adımlıdır: şifre + e-postanıza gelen doğrulama kodu. Ayrıntılar için Gizlilik Politikası sayfamıza bakabilirsiniz.',
  },
]

interface Channel {
  icon: LucideIcon
  title: string
  body: string
  action: string
  href: string
  external?: boolean
}

const CHANNELS: Channel[] = [
  {
    icon: Ticket,
    title: 'Destek talebi açın',
    body: 'Yazılı, takip kodlu ve kaydı tutulan yol. Yanıtı hem e-postanızdan hem takip ekranından görürsünüz.',
    action: 'Aşağıdaki formu doldurun',
    href: '#talep',
  },
  {
    icon: Search,
    title: 'Mevcut talebinizi izleyin',
    body: 'Elinizde takip kodu ve bağlantı varsa talebinizin durumunu görüp yanıt yazabilirsiniz.',
    action: 'Takip ekranını aç',
    href: '/destek/takip',
  },
  {
    icon: Phone,
    title: 'Telefonla arayın',
    body: 'İş duran acil durumlar için — kasa kapanmıyor, giriş yapılamıyor, ödeme alınamıyor.',
    action: company.phone,
    href: `tel:${company.phone.replace(/\s/g, '')}`,
    external: true,
  },
]

export default function SupportPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#FFF7FA] text-[#352432] antialiased">
      {/* Zemin: tanıtım sayfasındaki ürün bloğuyla aynı ipek düzlem — aynı ailedendir. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <AmbientVideo src="/landing/film/moduller.mp4" poster="/landing/film/moduller.webp" priority />
        <div className="absolute inset-0 bg-[#FFF7FA]/80" />
      </div>

      <div className="relative z-10">
        <Nav />

        <main>
          {/* ---- BAŞLIK ---- */}
          <section className="mx-auto max-w-[1200px] px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
            <Reveal>
              <div className="material-light material-thick mx-auto max-w-[70ch] rounded-[26px] px-7 py-9 text-center sm:px-10 sm:py-11">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#EF6F94]">
                  Destek merkezi
                </span>
                <h1 className="display-lg balance mt-4 text-[#352432]">Bir sorunuz mu var? Buradayız.</h1>
                <p className="on-material balance mx-auto mt-5 max-w-[58ch] text-[16px] leading-relaxed text-[#4A3A44]">
                  Aşağıdaki sık sorulanlarda yanıtı bulamazsanız talep açın. Her talebe takip kodu
                  verilir; yanıtı e-postanızdan ve takip ekranından izlersiniz.
                </p>

                <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[13px] text-[#5A4752]">
                  <span className="inline-flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[#EF6F94]" strokeWidth={1.8} /> {company.supportHours}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[#EF6F94]" strokeWidth={1.8} /> Ortalama ilk yanıt: birkaç saat
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[#EF6F94]" strokeWidth={1.8} /> Her talep kayıt altında
                  </span>
                </div>
              </div>
            </Reveal>
          </section>

          {/* ---- KANALLAR ---- */}
          <section className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8">
            <div className="grid gap-4 lg:grid-cols-3">
              {CHANNELS.map(({ icon: Icon, title, body, action, href, external }) => (
                <Reveal key={title}>
                  <div className="material-light flex h-full flex-col rounded-[22px] p-7">
                    <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#FFF0F5] text-[#EF6F94]">
                      <Icon className="h-5 w-5" strokeWidth={1.7} />
                    </span>
                    <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.02em] text-[#352432]">{title}</h2>
                    <p className="on-material mt-2 flex-1 text-[13.5px] leading-relaxed text-[#5A4752]">{body}</p>
                    {external ? (
                      <a
                        href={href}
                        className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#C85776] transition-colors hover:text-[#A23F5C]"
                      >
                        {action} <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#C85776] transition-colors hover:text-[#A23F5C]"
                      >
                        {action} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ---- SIK SORULANLAR ----
              FORMDAN ÖNCE gelir: çoğu kişinin aradığı yanıt buradadır ve talep açmasına gerek
              kalmaz. `<details>` kullanılır — açılıp kapanması JavaScript'siz de çalışır. */}
          <section id="sss" className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
            <Reveal>
              <div className="mb-6 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFF0F5] text-[#EF6F94]">
                  <BookOpen className="h-5 w-5" strokeWidth={1.7} />
                </span>
                <h2 className="display-md text-[#352432]">Sık sorulanlar</h2>
              </div>
            </Reveal>

            <div className="grid gap-3 lg:grid-cols-2">
              {FAQS.map((faq) => (
                <Reveal key={faq.q}>
                  <details className="material-light group h-full rounded-[20px] px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[15px] font-semibold text-[#352432]">
                      {faq.q}
                      <span
                        aria-hidden
                        className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[#EEC9D7] text-[#EF6F94] transition-transform duration-300 group-open:rotate-45"
                      >
                        <span className="text-[14px] leading-none">+</span>
                      </span>
                    </summary>
                    <p className="on-material mt-3 text-[13.5px] leading-relaxed text-[#5A4752]">{faq.a}</p>
                  </details>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ---- TALEP FORMU ---- */}
          <section id="talep" className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.85fr] lg:items-start">
              <Reveal>
                <div>
                  <h2 className="display-md mb-5 text-[#352432]">Destek talebi oluşturun</h2>
                  <SupportForm />
                </div>
              </Reveal>

              <Reveal>
                <aside className="material-light rounded-[22px] p-7">
                  <h3 className="text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">
                    Daha hızlı çözülmesi için
                  </h3>
                  <ul className="mt-4 space-y-3 text-[13px] leading-relaxed text-[#5A4752]">
                    {[
                      'Kurum kodunuzu (BA-XX) yazın — hesabınızı anında buluruz.',
                      'Hangi sayfada olduğunuzu ve hangi düğmeye bastığınızı belirtin.',
                      'Hata mesajı çıktıysa metnini olduğu gibi kopyalayın.',
                      'Sorun belirli bir müşteri ya da randevuda ise adını/tarihini yazın.',
                      'Ne olmasını beklediğinizi de yazın — “şu olmalıydı, bu oldu”.',
                    ].map((tip) => (
                      <li key={tip} className="on-material flex gap-2.5">
                        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EF6F94]" />
                        {tip}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 border-t border-[#F2DFE7] pt-5">
                    <h3 className="text-[15.5px] font-semibold tracking-[-0.015em] text-[#352432]">
                      Bize ulaşın
                    </h3>
                    <div className="mt-3.5 space-y-3 text-[13px] text-[#5A4752]">
                      <a
                        href={`tel:${company.phone.replace(/\s/g, '')}`}
                        className="flex items-center gap-2.5 transition-colors hover:text-[#C85776]"
                      >
                        <Phone className="h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={1.8} />
                        {company.phone}
                      </a>
                      <div className="flex items-start gap-2.5">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={1.8} />
                        <span className="leading-relaxed">{company.address}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Clock className="h-4 w-4 shrink-0 text-[#EF6F94]" strokeWidth={1.8} />
                        {company.supportHours}
                      </div>
                    </div>
                  </div>
                </aside>
              </Reveal>
            </div>
          </section>

          {/* ---- KAPANIŞ ---- */}
          <section className="mx-auto max-w-[1200px] px-5 pb-16 sm:px-8">
            <Reveal>
              <div className="material-light material-thick flex flex-col items-start justify-between gap-6 rounded-[24px] p-7 sm:p-9 lg:flex-row lg:items-center">
                <div>
                  <h2 className="display-md text-[#352432]">Henüz müşterimiz değil misiniz?</h2>
                  <p className="on-material mt-2 max-w-[56ch] text-[14px] leading-relaxed text-[#4A3A44]">
                    Kurulum, veri aktarımı ve eğitim dahil; 14 gün ücretsiz deneyin. Kredi kartı istemiyoruz.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-3">
                  <PressButton href="/kayit" tone="primary" className="px-6 py-3 text-[14.5px] font-medium">
                    14 gün ücretsiz dene <ArrowRight className="h-4 w-4" />
                  </PressButton>
                  <PressButton href="/moduller" tone="glass-light" className="border border-[#EEC9D7] px-6 py-3 text-[14.5px]">
                    Modülleri inceleyin
                  </PressButton>
                </div>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="border-t border-[#F2DFE7] bg-white/70 px-5 py-10 sm:px-8">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-[13px] text-[#5A4752]">
                <MessageCircle className="h-4 w-4 text-[#EF6F94]" strokeWidth={1.8} />
                Destek: <a href={`tel:${company.phone.replace(/\s/g, '')}`} className="font-semibold text-[#C85776] hover:underline">{company.phone}</a>
              </span>
              <PaymentBadges />
            </div>
            <LegalLinkRow />
          </div>
        </footer>
      </div>
    </div>
  )
}
