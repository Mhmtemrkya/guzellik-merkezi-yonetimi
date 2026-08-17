import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalFacts, LegalList, LegalSection, MailLink } from '@/components/legal/LegalPage'
import PaymentBadges from '@/components/legal/PaymentBadges'
import { company } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Hakkımızda — BeautyAsist',
  description:
    'BeautyAsist; güzellik merkezleri, klinikler ve salonlar için randevu, müşteri, paket, seans, taksit ve ön muhasebe yönetimini tek panelde toplayan bir yönetim yazılımıdır.',
}

export default function HakkimizdaPage() {
  return (
    <LegalPage
      eyebrow="Kurumsal"
      title="Hakkımızda"
      showUpdatedAt={false}
      intro={
        <>
          <strong>{company.brand}</strong>; güzellik merkezleri, medikal estetik klinikleri ve
          salonlar için geliştirilmiş bir işletme yönetim yazılımıdır. Randevudan seansa, paket
          satışından taksit takibine ve ön muhasebeye kadar bir merkezin günlük işleyişini tek
          panelde toplar. Web, tablet, mobil ve masaüstü uygulamalarıyla aynı veriye her yerden
          erişilir.
        </>
      }
    >
      <LegalSection title="Ne yapıyoruz?">
        <p>
          Güzellik sektöründe işletmeler; randevu defterini bir yerde, paket ve seans takibini
          başka yerde, tahsilat ve borç takibini ise çoğu zaman elde tutuyor. Bu dağınıklık
          unutulan seansa, tahsil edilmemiş taksite ve kaybolan müşteriye dönüşüyor.
          {' '}{company.brand}, bu üç defteri tek yerde birleştirir ve aralarındaki bağı otomatik kurar:
          bir randevu tamamlandığında seans düşer, satış cariye işlenir, tahsilat kasaya yazılır.
        </p>
      </LegalSection>

      <LegalSection title="Neler sunuyoruz?">
        <LegalList
          items={[
            <><strong>Randevu ve çizelge:</strong> günlük/haftalık/aylık ajanda, personel bazlı çalışma saatleri, çakışma kontrolü, bekleme listesi.</>,
            <><strong>Müşteri yönetimi:</strong> müşteri kartı, işlem geçmişi, tedavi günlüğü (önce/sonra), konsültasyon ve onam formları, KVKK aydınlatma akışı.</>,
            <><strong>Paket, hizmet ve seans:</strong> paket kurgusu, kalan seans takibi, hediye/sadakat puanı, kampanya tanımları.</>,
            <><strong>Ön muhasebe:</strong> cari hesap, taksitlendirme, tahsilat, gider, günlük kasa ve kasa kapanışı.</>,
            <><strong>Personel:</strong> rol ve yetki yönetimi, prim/komisyon, performans ve onay akışı.</>,
            <><strong>İletişim:</strong> WhatsApp, SMS ve e-posta ile randevu hatırlatma, değerlendirme ve bilgilendirme mesajları.</>,
            <><strong>Raporlama:</strong> satış, tahsilat, paket, personel ve şube kırılımlarında dönem karşılaştırmalı raporlar.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Verilerinize yaklaşımımız">
        <p>
          Müşteri adı, telefonu, kimlik numarası ve notları gibi hassas alanlar veritabanında
          <strong> AES-256-GCM</strong> ile şifrelenerek saklanır; tüm iletişim <strong>HTTPS</strong>{' '}
          üzerinden yapılır. Erişim rol tabanlı yetkilerle sınırlandırılır, kritik işlemler denetim
          günlüğüne yazılır. Ayrıntılar için{' '}
          <Link href="/gizlilik" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Gizlilik Politikası
          </Link>{' '}
          sayfamıza bakabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="Nasıl satın alınır?">
        <p>
          {company.brand} bir <strong>abonelik (SaaS)</strong> hizmetidir; kutulu ürün veya fiziksel
          teslimat yoktur. Hesabınızı açtıktan sonra <strong>14 gün ücretsiz</strong> deneyebilir,
          memnun kalırsanız panel içindeki “Paket” ekranından kredi/banka kartıyla aboneliğinizi
          başlatabilirsiniz. Ödeme adımı {company.paymentProvider} tarafından barındırılan güvenli
          ödeme sayfasında tamamlanır; kart bilgileri hiçbir aşamada sunucularımıza gelmez.
        </p>
        <p>
          Satın alma koşullarının tamamı{' '}
          <Link href="/mesafeli-satis-sozlesmesi" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Mesafeli Satış Sözleşmesi
          </Link>{' '}
          ve{' '}
          <Link href="/teslimat-ve-iade" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Teslimat ve İade Şartları
          </Link>{' '}
          sayfalarındadır.
        </p>
        <PaymentBadges className="mt-4" />
      </LegalSection>

      <LegalSection title="İletişim ve künye">
        <LegalFacts
          rows={[
            { label: 'Ticaret unvanı', value: company.legalName },
            { label: 'Marka', value: company.brand },
            { label: 'Adres', value: company.address },
            {
              label: 'E-posta',
              value: <MailLink />,
            },
            { label: 'Telefon', value: company.phone },
            { label: 'Web sitesi', value: company.website },
            { label: 'Destek saatleri', value: company.supportHours },
          ]}
        />
      </LegalSection>
    </LegalPage>
  )
}
