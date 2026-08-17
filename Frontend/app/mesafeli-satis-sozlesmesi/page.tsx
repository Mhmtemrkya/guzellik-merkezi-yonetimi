import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { LegalFacts, LegalList, LegalSection, MailLink } from '@/components/legal/LegalPage'
import PaymentBadges from '@/components/legal/PaymentBadges'
import { company } from '@/lib/legal/company'

export const metadata: Metadata = {
  title: 'Mesafeli Satış Sözleşmesi — BeautyAsist',
  description:
    'BeautyAsist abonelik hizmetinin satışına ilişkin mesafeli satış sözleşmesi: taraflar, hizmetin nitelikleri, ödeme, otomatik yenileme, iptal ve cayma hakkı.',
}

export default function MesafeliSatisSozlesmesiPage() {
  return (
    <LegalPage
      eyebrow="Yasal"
      title="Mesafeli Satış Sözleşmesi"
      intro={
        <>
          Bu sözleşme, <strong>{company.brand}</strong> abonelik hizmetinin internet üzerinden
          satışına ilişkin koşulları düzenler. Ödeme adımını tamamlayan Alıcı, bu sözleşmeyi
          okuduğunu ve kabul ettiğini beyan eder.
        </>
      }
    >
      <LegalSection title="1. Taraflar">
        <p>
          <strong>SATICI</strong>
        </p>
        <LegalFacts
          rows={[
            { label: 'Ticaret unvanı', value: company.legalName },
            { label: 'Şirket türü', value: company.companyType },
            { label: 'Adres', value: company.address },
            { label: 'Telefon', value: company.phone },
            {
              label: 'E-posta',
              value: <MailLink />,
            },
            { label: 'Vergi dairesi / no', value: `${company.taxOffice} / ${company.taxNumber}` },
            { label: 'MERSİS no', value: company.mersis },
            { label: 'Web sitesi', value: company.website },
          ]}
        />
        <p className="mt-4">
          <strong>ALICI</strong>
        </p>
        <p>
          Hizmeti satın alan gerçek veya tüzel kişi; sipariş/abonelik adımında beyan ettiği ad-soyad
          veya ticaret unvanı, adres, e-posta ve telefon bilgileriyle taraftır. Alıcı, verdiği
          bilgilerin doğru ve güncel olduğunu kabul eder.
        </p>
      </LegalSection>

      <LegalSection title="2. Sözleşmenin konusu">
        <p>
          Sözleşmenin konusu; Alıcı’nın {company.website} adresinden elektronik ortamda satın aldığı,
          aşağıda nitelikleri ve satış bedeli belirtilen <strong>{company.brand} yazılım abonelik
          hizmetinin</strong> sunulmasına ilişkin tarafların hak ve yükümlülüklerinin belirlenmesidir.
        </p>
      </LegalSection>

      <LegalSection title="3. Hizmetin temel nitelikleri ve bedeli">
        <p>
          {company.brand}; güzellik merkezleri ve klinikler için randevu, müşteri, paket/seans,
          personel, stok ve ön muhasebe yönetimi sağlayan, internet üzerinden erişilen bir
          <strong> yazılım hizmetidir (SaaS)</strong>. Fiziksel bir ürün teslimi yoktur.
        </p>
        <LegalList
          items={[
            'Hizmetin kapsamı, kullanıcı/şube sayısı ve aylık mesaj kotaları seçilen pakete göre değişir; güncel paket içerikleri ve limitleri satın alma ekranında listelenir.',
            'Satış bedeli (KDV dâhil), seçilen paket ve dönem (aylık/yıllık) için ödeme adımında açıkça gösterilir; ödemeden önce Alıcı’nın onayına sunulur.',
            'Paket fiyatları ileriye dönük olarak değiştirilebilir. Değişiklik, yürürlükteki abonelik döneminin bedelini etkilemez; yeni bedel yalnızca sonraki yenileme döneminde uygulanır ve yenilemeden önce Alıcı’ya bildirilir.',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Ödeme şekli">
        <p>
          Ödeme, kredi kartı veya banka kartı ile <strong>{company.paymentProvider}</strong>{' '}
          tarafından barındırılan güvenli ödeme sayfası üzerinden yapılır. Kart bilgileri hiçbir
          aşamada Satıcı’nın sunucularına iletilmez ve Satıcı tarafından saklanmaz.
        </p>
        <p>
          Alıcı, ödeme adımında kartını kaydetmeyi seçerse, kart bilgisi yerine ödeme kuruluşunun
          ürettiği <strong>kart jetonu (token)</strong> saklanır; bu jeton yalnızca bu sözleşme
          kapsamındaki abonelik yenilemelerinde kullanılabilir.
        </p>
        <PaymentBadges className="mt-4" showNote={false} />
      </LegalSection>

      <LegalSection title="5. Abonelik süresi, otomatik yenileme ve iptal">
        <LegalList
          items={[
            <>Abonelik, ödemenin <strong>başarıyla tamamlandığı anda</strong> başlar ve seçilen dönem (aylık veya yıllık) boyunca devam eder. Ödeme tamamlanmadan hesap ücretli kullanıma açılmaz.</>,
            <>Alıcı kartını kaydetmişse abonelik, dönem sonunda <strong>aynı paket ve dönem için otomatik olarak yenilenir</strong>. Yenileme tahsilatı, vade tarihinden <strong>3 gün önce</strong> denenir.</>,
            <>Tahsilat başarısız olursa <strong>24 saat arayla en fazla 3 deneme</strong> yapılır. Üç deneme de başarısız olursa abonelik askıya alınır ve panele erişim kısıtlanır. Veriler bu süreçte silinmez.</>,
            <>Yeni dönem, mevcut abonelik bitiş tarihinden itibaren işler; erken tahsilat nedeniyle Alıcı gün kaybetmez.</>,
            <>Alıcı, panelindeki <strong>Paket</strong> ekranından kayıtlı kartını dilediği zaman kaldırabilir. Kart kaldırıldığında <strong>otomatik yenileme durur</strong>; hizmet, bedeli ödenmiş dönemin sonuna kadar kesintisiz devam eder.</>,
            <>Satıcı, sözleşmeye veya yürürlükteki mevzuata aykırı kullanım hâlinde aboneliği askıya alma veya sona erdirme hakkını saklı tutar.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Hizmetin ifası (teslimat)">
        <p>
          Hizmet elektronik ortamda sunulur; <strong>fiziksel teslimat ve kargo yoktur</strong>.
          Ödeme onaylandığı anda Alıcı’nın hesabı ilgili pakete geçirilir ve hizmet kullanıma açılır.
          İfa yeri, Alıcı’nın internet erişimi olan cihazıdır. Ayrıntılar için{' '}
          <Link href="/teslimat-ve-iade" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Teslimat ve İade Şartları
          </Link>{' '}
          sayfasına bakınız.
        </p>
      </LegalSection>

      <LegalSection title="7. Cayma hakkı ve istisnası">
        <p>
          Satın almadan önce hizmet, kart bilgisi istenmeksizin{' '}
          <strong>14 gün boyunca ücretsiz</strong> denenebilir. Bu deneme süresi, Alıcı’nın hizmeti
          satın almadan değerlendirmesi içindir.
        </p>
        <p>
          Mesafeli Sözleşmeler Yönetmeliği’nin 15’inci maddesinin birinci fıkrasının (ğ) bendi
          uyarınca; <strong>elektronik ortamda anında ifa edilen hizmetler</strong> ile{' '}
          <strong>tüketiciye anında teslim edilen gayrimaddi mallara</strong> ilişkin sözleşmelerde
          cayma hakkı kullanılamaz. {company.brand} aboneliği, ödeme onayının ardından anında ifa
          edilen bir hizmet olduğundan bu istisna kapsamındadır; Alıcı, ödeme adımında bu durumu
          bilerek onay verir.
        </p>
        <p>
          Bununla birlikte Satıcı, <strong>hizmetin hiç kullanılmadığı</strong> ve ödeme tarihinden
          itibaren <strong>14 gün içinde</strong> başvurulan durumlarda, ticari nezaket gereği iade
          talebini değerlendirir. Başvuru ve iade süreci{' '}
          <Link href="/teslimat-ve-iade" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Teslimat ve İade Şartları
          </Link>{' '}
          sayfasında açıklanmıştır.
        </p>
      </LegalSection>

      <LegalSection title="8. Alıcının yükümlülükleri">
        <LegalList
          items={[
            'Hesap ve şifre güvenliğinden, kendi kullanıcılarının yetkilendirilmesinden Alıcı sorumludur.',
            'Alıcı, kendi müşterilerine ait kişisel verilerin işlenmesinde veri sorumlusudur; ilgili kişileri aydınlatma ve gerekli açık rızaları alma yükümlülüğü Alıcı’ya aittir. Satıcı, bu verileri Alıcı adına işleyen veri işleyen konumundadır.',
            'Hizmet; yasa dışı içerik barındırmak, izinsiz toplu ileti göndermek veya üçüncü kişilerin haklarını ihlal etmek amacıyla kullanılamaz.',
            'Alıcı, fatura bilgilerinin doğruluğundan ve güncelliğinden sorumludur.',
          ]}
        />
      </LegalSection>

      <LegalSection title="9. Kişisel verilerin korunması">
        <p>
          Kişisel verilerin işlenmesine ilişkin esaslar{' '}
          <Link href="/gizlilik" className="font-medium text-[#EF6F94] underline underline-offset-2">
            Gizlilik Politikası
          </Link>{' '}
          sayfasında açıklanmıştır. Hassas müşteri alanları veritabanında AES-256-GCM ile şifrelenir
          ve tüm veri iletişimi HTTPS üzerinden yapılır.
        </p>
      </LegalSection>

      <LegalSection title="10. Fikri mülkiyet">
        <p>
          {company.brand} yazılımı, arayüzleri, kaynak kodu, markası ve dokümantasyonu üzerindeki tüm
          fikri mülkiyet hakları Satıcı’ya aittir. Abonelik, Alıcı’ya yalnızca abonelik süresince
          geçerli, devredilemez ve münhasır olmayan bir <strong>kullanım hakkı</strong> verir.
          Alıcı’nın panele girdiği veriler Alıcı’ya aittir.
        </p>
      </LegalSection>

      <LegalSection title="11. Mücbir sebep">
        <p>
          Doğal afet, savaş, grev, salgın, altyapı/hat arızaları, elektrik ve internet kesintileri,
          barındırma ya da ödeme kuruluşu kaynaklı kesintiler gibi tarafların kontrolü dışındaki
          hâllerde, edimin yerine getirilememesinden dolayı taraflar sorumlu tutulamaz.
        </p>
      </LegalSection>

      <LegalSection title="12. Uyuşmazlıkların çözümü">
        <p>
          Alıcı’nın 6502 sayılı Tüketicinin Korunması Hakkında Kanun anlamında{' '}
          <strong>tüketici</strong> olduğu hâllerde; Ticaret Bakanlığı’nca ilan edilen parasal
          sınırlar çerçevesinde Alıcı’nın yerleşim yerindeki <strong>Tüketici Hakem Heyetleri</strong>{' '}
          ve <strong>Tüketici Mahkemeleri</strong> yetkilidir.
        </p>
        <p>
          Alıcı’nın ticari veya mesleki amaçlarla hareket eden bir işletme (tacir) olması hâlinde
          tüketici mevzuatı uygulanmaz; bu durumda uyuşmazlıklarda{' '}
          <strong>{company.address}</strong> adresinin bulunduğu yer mahkemeleri ve icra daireleri
          yetkilidir.
        </p>
      </LegalSection>

      <LegalSection title="13. Yürürlük">
        <p>
          Alıcı, ödeme adımında bu sözleşmenin tüm koşullarını okuduğunu ve kabul ettiğini beyan
          eder. Sözleşme, ödemenin onaylanmasıyla birlikte yürürlüğe girer ve elektronik ortamda
          saklanır.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
