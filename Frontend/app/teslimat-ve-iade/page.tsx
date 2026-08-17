import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalFacts, LegalList, LegalSection, MailLink } from '@/components/legal/LegalPage'
import PaymentBadges from '@/components/legal/PaymentBadges'
import { company } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Teslimat ve İade Şartları — BeautyAsist',
  description:
    'BeautyAsist abonelik hizmetinin teslimi (hesap aktivasyonu), iptal ve iade koşulları ile iade süreçlerine ilişkin bilgilendirme.',
}

export default function TeslimatVeIadePage() {
  return (
    <LegalPage
      eyebrow="Yasal"
      title="Teslimat ve İade Şartları"
      intro={
        <>
          <strong>{company.brand}</strong> bir yazılım abonelik hizmetidir. Fiziksel bir ürün
          satılmaz; <strong>kargo ve fiziksel teslimat yoktur</strong>. Bu sayfa, hizmetin nasıl
          teslim edildiğini, aboneliğin nasıl iptal edileceğini ve hangi hâllerde iade yapıldığını
          açıklar.
        </>
      }
    >
      <LegalSection title="1. Teslimat: hizmet nasıl ve ne zaman sunulur?">
        <LegalList
          items={[
            <><strong>Teslim şekli:</strong> elektronik ortamda hesap aktivasyonu. Ödeme onaylandığı anda hesabınız satın alınan pakete geçirilir ve panel kullanıma açılır.</>,
            <><strong>Teslim süresi:</strong> ödemenin başarıyla tamamlanmasının ardından <strong>anında</strong> (genellikle birkaç saniye içinde). Ayrıca aktivasyon bilgisi kayıtlı e-posta adresinize iletilir.</>,
            <><strong>Teslim yeri:</strong> internet erişimi olan herhangi bir cihaz. Hizmete {company.website} adresinden, mobil uygulamadan ve masaüstü uygulamasından erişilir.</>,
            <><strong>Teslimat ücreti:</strong> yoktur. Kargo, kurulum veya aktivasyon bedeli alınmaz.</>,
          ]}
        />
        <p>
          Ödemeniz kartınızdan tahsil edildiği hâlde hesabınız 30 dakika içinde açılmazsa, ödeme
          referansınızla birlikte{' '}
          <MailLink />{' '}
          adresine yazın. Aktivasyon tamamlanamazsa ödemeniz <strong>tam olarak iade edilir</strong>.
        </p>
      </LegalSection>

      <LegalSection title="2. Ücretsiz deneme">
        <p>
          Satın almadan önce hizmet <strong>14 gün boyunca ücretsiz</strong> denenebilir. Deneme için
          kredi kartı bilgisi istenmez, deneme süresi sonunda otomatik ücretlendirme yapılmaz.
          Denemenin amacı, ödeme yapmadan önce hizmetin ihtiyacınızı karşılayıp karşılamadığını
          görmenizdir.
        </p>
      </LegalSection>

      <LegalSection title="3. Aboneliği iptal etme">
        <LegalList
          items={[
            <>Panelinizdeki <strong>Paket</strong> ekranından <strong>“Kartı kaldır”</strong> seçeneğiyle kayıtlı kartınızı silebilirsiniz. Bu işlem otomatik yenilemeyi durdurur.</>,
            <>İptal ettiğinizde hizmet hemen kesilmez: <strong>bedeli ödenmiş dönemin sonuna kadar</strong> kullanmaya devam edersiniz. Dönem bitiminde hesap ücretli kullanıma kapanır.</>,
            <>İptal için ayrıca bize yazmanız gerekmez; dilerseniz destek adresimizden de talep edebilirsiniz.</>,
            <>Aboneliğiniz sona erdiğinde verileriniz silinmez; hesabınızı yeniden etkinleştirdiğinizde kayıtlarınız yerinde durur. Verilerinizin kalıcı olarak silinmesini isterseniz destek adresimize başvurabilirsiniz.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Cayma hakkı ve iade">
        <p>
          Mesafeli Sözleşmeler Yönetmeliği m.15/1-(ğ) uyarınca, <strong>elektronik ortamda anında
          ifa edilen hizmetlerde cayma hakkı kullanılamaz</strong>. {company.brand} aboneliği ödeme
          onayının ardından anında ifa edildiğinden bu istisna kapsamındadır; bu nedenle 14 günlük
          ücretsiz deneme, satın almadan önce değerlendirme imkânı olarak sunulur.
        </p>
        <p>Buna rağmen aşağıdaki hâllerde iade yapılır:</p>
        <LegalList
          items={[
            <><strong>Teknik nedenle hizmet sunulamaması:</strong> ödeme alındığı hâlde hesap açılamazsa veya hizmet Satıcı kaynaklı bir sorunla kullanılamaz durumdaysa bedelin tamamı iade edilir.</>,
            <><strong>Mükerrer/hatalı tahsilat:</strong> aynı dönem için birden fazla tahsilat yapılmışsa fazla tutar iade edilir.</>,
            <><strong>Ticari nezaket iadesi:</strong> ödeme tarihinden itibaren <strong>14 gün içinde</strong> başvurulması ve hizmetin <strong>fiilen kullanılmamış</strong> olması hâlinde (panelde veri girişi/işlem yapılmamışsa) talebiniz değerlendirilir ve uygun bulunursa bedel iade edilir.</>,
          ]}
        />
        <p>
          Kullanılmış bir abonelik döneminin <strong>kalan günleri için kısmi iade yapılmaz</strong>;
          iptal hâlinde hizmet dönem sonuna kadar açık kalır.
        </p>
      </LegalSection>

      <LegalSection title="5. İade nasıl talep edilir?">
        <LegalList
          items={[
            <>İade talebinizi <MailLink /> adresine, hesabınıza kayıtlı e-posta adresinden gönderin.</>,
            'Mesajınızda kurum adınızı, ödeme tarihini ve tutarını belirtin.',
            'Talebiniz en geç 3 iş günü içinde sonuçlandırılır ve size yazılı olarak bildirilir.',
          ]}
        />
      </LegalSection>

      <LegalSection title="6. İade süresi ve şekli">
        <p>
          Onaylanan iadeler, <strong>ödemenin yapıldığı kart</strong>a ve aynı para biriminde
          (TL) yapılır; farklı bir hesaba veya nakit olarak iade yapılamaz. İade tutarı,
          {' '}{company.paymentProvider} üzerinden en geç <strong>14 gün içinde</strong> bankaya
          iletilir. Tutarın kart ekstrenize yansıma süresi bankanıza bağlıdır ve genellikle{' '}
          <strong>2–10 iş günü</strong> sürer; bu süre Satıcı’nın kontrolünde değildir.
        </p>
        <PaymentBadges className="mt-4" />
      </LegalSection>

      <LegalSection title="7. Ödeme alınamazsa ne olur?">
        <p>
          Otomatik yenileme tahsilatı, vade tarihinden 3 gün önce denenir. Başarısız olursa 24 saat
          arayla en fazla 3 deneme yapılır ve her denemede bilgilendirilirsiniz. Üç deneme de
          başarısız olursa abonelik askıya alınır; panele erişim kısıtlanır ancak{' '}
          <strong>verileriniz silinmez</strong>. Kartınızı güncelleyip ödemeyi tamamladığınızda hesap
          kaldığı yerden açılır.
        </p>
      </LegalSection>

      <LegalSection title="8. İletişim">
        <LegalFacts
          rows={[
            { label: 'Ticaret unvanı', value: company.legalName },
            { label: 'Adres', value: company.address },
            { label: 'Telefon', value: company.phone },
            {
              label: 'E-posta',
              value: <MailLink />,
            },
            { label: 'Destek saatleri', value: company.supportHours },
          ]}
        />
        <p className="mt-4">
          Satış koşullarının tamamı için{' '}
          <Link href="/mesafeli-satis-sozlesmesi" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Mesafeli Satış Sözleşmesi
          </Link>{' '}
          sayfasına bakabilirsiniz.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
