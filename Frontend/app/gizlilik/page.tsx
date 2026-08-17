import type { Metadata } from 'next'
import LegalPage, { LegalFacts, LegalList, LegalSection, MailLink } from '@/components/legal/LegalPage'
import { company } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Gizlilik Politikası — BeautyAsist',
  description:
    'BeautyAsist güzellik merkezi yönetim uygulamasının kişisel verileri işleme, saklama ve koruma esaslarını açıklayan gizlilik politikası.',
}

export default function GizlilikPage() {
  return (
    <LegalPage
      eyebrow="Yasal"
      title="Gizlilik Politikası"
      intro={
        <>
          Bu politika, <strong>{company.brand}</strong> mobil, masaüstü ve web uygulamasının
          (“Uygulama”) kişisel verileri nasıl topladığını, kullandığını, sakladığını ve koruduğunu
          açıklar. Uygulama; güzellik merkezleri ve klinikler için randevu, müşteri, stok, paket
          satış ve finans yönetimi amacıyla işletme çalışanları tarafından kullanılır.
        </>
      }
    >
      <LegalSection title="1. Veri sorumlusu">
        <p>
          Uygulama {company.shortName} tarafından geliştirilmiştir. Uygulamayı kullanan güzellik
          merkezi/işletme, kendi müşterilerine ait verilerin işlenmesinden birinci derecede sorumlu
          olan <strong>veri sorumlusudur</strong>. {company.shortName}, işletmeler adına verileri
          işleyen hizmet sağlayıcı (<strong>veri işleyen</strong>) konumundadır.
        </p>
      </LegalSection>

      <LegalSection title="2. Topladığımız veriler">
        <p>Uygulama, işletmenin operasyonlarını yürütmesi için aşağıdaki verileri işleyebilir:</p>
        <LegalList
          items={[
            <><strong>Kullanıcı (çalışan) hesap bilgileri:</strong> ad-soyad, e-posta, telefon, rol ve şifre (şifreler geri döndürülemez şekilde hash’lenerek saklanır).</>,
            <><strong>Müşteri bilgileri:</strong> ad-soyad, telefon numarası, T.C. kimlik numarası (girildiyse), e-posta, adres ve müşteriye ait notlar.</>,
            <><strong>Operasyonel veriler:</strong> randevular, seanslar, paket ve hizmet satışları, stok, ödeme/kasa kayıtları ve finansal işlemler.</>,
            <><strong>Abonelik ve fatura verileri:</strong> abonelik paketi, dönem, fatura kayıtları ve ödeme sonuçları.</>,
            <><strong>Cihaz ve bildirim verileri:</strong> anlık bildirim (push) gönderebilmek için cihazın bildirim token’ı ve temel cihaz/platform bilgisi.</>,
            <><strong>Teknik kayıtlar:</strong> güvenlik ve hata takibi amacıyla oturum, IP adresi ve işlem (audit) günlükleri.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Verileri kullanma amaçlarımız">
        <LegalList
          items={[
            'Randevu, müşteri, paket, stok ve finans yönetimi hizmetini sunmak,',
            'Randevu hatırlatmaları ve işlemlerle ilgili anlık bildirimler göndermek,',
            'Abonelik bedelini tahsil etmek ve fatura düzenlemek,',
            'Hesap güvenliğini sağlamak, yetkisiz erişimi tespit etmek ve önlemek,',
            'Yasal yükümlülükleri yerine getirmek ve hizmeti iyileştirmek.',
          ]}
        />
        <p>Verileriniz pazarlama amacıyla üçüncü taraflara satılmaz veya kiralanmaz.</p>
      </LegalSection>

      <LegalSection title="4. Ödeme verileri">
        <p>
          Abonelik ödemeleri <strong>{company.paymentProvider}</strong> altyapısı üzerinden alınır.
          Kart numarası, son kullanma tarihi ve CVV gibi bilgiler{' '}
          <strong>hiçbir aşamada sunucularımıza iletilmez</strong>; ödeme, ödeme kuruluşunun
          barındırdığı güvenli sayfada tamamlanır.
        </p>
        <p>
          Kartınızı kaydetmeyi seçerseniz, kart bilgisi yerine ödeme kuruluşunun ürettiği ve tek
          başına kart bilgisi taşımayan <strong>jeton (token)</strong> saklanır; bu jeton
          veritabanında şifrelenir ve yalnızca abonelik yenilemelerinde kullanılır. Kartınızı
          panelden dilediğiniz zaman kaldırabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="5. Veri güvenliği">
        <p>
          Ad, telefon, T.C. kimlik numarası, adres ve notlar gibi hassas müşteri alanları
          veritabanında <strong>AES-256-GCM</strong> ile şifrelenerek saklanır. Tüm veri iletişimi{' '}
          <strong>HTTPS</strong> üzerinden şifreli olarak yapılır. Şifreler güçlü algoritmalarla
          hash’lenir ve düz metin olarak tutulmaz. Erişim, rol tabanlı yetkilendirme ile
          sınırlandırılır ve kritik işlemler denetim günlüğüne yazılır.
        </p>
      </LegalSection>

      <LegalSection title="6. Üçüncü taraf hizmetler">
        <p>Uygulama, işlevini yerine getirmek için sınırlı sayıda güvenilir hizmetten yararlanır:</p>
        <LegalList
          items={[
            <><strong>{company.paymentProvider}:</strong> abonelik ödemelerinin güvenli şekilde tahsil edilmesi.</>,
            <><strong>Firebase Cloud Messaging (Google):</strong> anlık bildirimlerin iletilmesi için cihaz token’ı kullanılır.</>,
            <><strong>Apple Push Notification service (Apple):</strong> iOS cihazlara bildirim iletimi için kullanılır.</>,
            <><strong>Mesajlaşma sağlayıcıları:</strong> randevu hatırlatma ve bilgilendirme için WhatsApp, SMS ve e-posta servisleri.</>,
            <><strong>Barındırma/altyapı sağlayıcıları:</strong> verilerin güvenli sunucularda saklanması için kullanılır.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Verilerin saklanması ve silinmesi">
        <p>
          Kişisel veriler, hizmetin sunulması ve yasal saklama süreleri boyunca tutulur. İşletme veya
          ilgili kişi talep ettiğinde, yasal yükümlülükler saklı kalmak kaydıyla veriler silinir veya
          anonim hâle getirilir.
        </p>
      </LegalSection>

      <LegalSection title="8. Haklarınız (KVKK / GDPR)">
        <p>
          İlgili kişi olarak; verilerinize erişme, düzeltilmesini veya silinmesini isteme, işlenmesine
          itiraz etme ve verilerinizin bir kopyasını talep etme haklarına sahipsiniz. Bu haklarınızı
          kullanmak için aşağıdaki iletişim adresinden bize ulaşabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="9. Çocukların gizliliği">
        <p>
          Uygulama bir işletme yönetim aracıdır ve 13 yaşın altındaki bireylere yönelik değildir; bu
          kişilerden bilerek veri toplamayız.
        </p>
      </LegalSection>

      <LegalSection title="10. Değişiklikler">
        <p>
          Bu politika zaman zaman güncellenebilir. Güncellemeler bu sayfada yayımlandığı tarihte
          yürürlüğe girer.
        </p>
      </LegalSection>

      <LegalSection title="11. İletişim">
        <LegalFacts
          rows={[
            { label: 'Ticaret unvanı', value: company.legalName },
            { label: 'Adres', value: company.address },
            {
              label: 'E-posta',
              value: <MailLink />,
            },
            { label: 'Telefon', value: company.phone },
          ]}
        />
      </LegalSection>
    </LegalPage>
  )
}
