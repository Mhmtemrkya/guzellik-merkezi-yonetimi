import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Gizlilik Politikası — BeautyAsist',
  description:
    'BeautyAsist güzellik merkezi yönetim uygulamasının kişisel verileri işleme, saklama ve koruma esaslarını açıklayan gizlilik politikası.',
}

const SON_GUNCELLEME = '8 Temmuz 2026'
const ILETISIM_EPOSTA = 'oguzhan.mindivanli@gmail.com'
const SIRKET = 'Maydanoz Yazılım'

function Bolum({ baslik, children }: { baslik: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-neutral-900">{baslik}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-neutral-700">{children}</div>
    </section>
  )
}

export default function GizlilikPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-5 py-12 text-neutral-800 sm:px-8">
      <header className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-medium text-neutral-500">BeautyAsist</p>
        <h1 className="mt-1 text-2xl font-bold text-neutral-900 sm:text-3xl">Gizlilik Politikası</h1>
        <p className="mt-2 text-sm text-neutral-500">Son güncelleme: {SON_GUNCELLEME}</p>
      </header>

      <div className="mt-6">
        <p className="text-[15px] leading-relaxed text-neutral-700">
          Bu gizlilik politikası, <strong>BeautyAsist</strong> mobil ve masaüstü uygulaması ile web panelinin
          (“Uygulama”) kişisel verileri nasıl topladığını, kullandığını, sakladığını ve koruduğunu açıklar.
          Uygulama, güzellik merkezleri ve klinikler için randevu, müşteri, stok, paket satış ve finans yönetimi
          amacıyla işletme çalışanları tarafından kullanılır.
        </p>
      </div>

      <Bolum baslik="1. Veri Sorumlusu">
        <p>
          Uygulama {SIRKET} tarafından geliştirilmiştir. Uygulamayı kullanan güzellik merkezi/işletme, kendi
          müşterilerine ait verilerin işlenmesinden birinci derecede sorumlu olan veri sorumlusudur. {SIRKET},
          işletmeler adına verileri işleyen hizmet sağlayıcı (veri işleyen) konumundadır.
        </p>
      </Bolum>

      <Bolum baslik="2. Topladığımız Veriler">
        <p>Uygulama, işletmenin operasyonlarını yürütmesi için aşağıdaki verileri işleyebilir:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Kullanıcı (çalışan) hesap bilgileri:</strong> ad-soyad, e-posta, telefon, rol ve şifre (şifreler
            geri döndürülemez şekilde hash’lenerek saklanır).
          </li>
          <li>
            <strong>Müşteri bilgileri:</strong> ad-soyad, telefon numarası, T.C. kimlik numarası (girildiyse),
            e-posta, adres ve müşteriye ait notlar.
          </li>
          <li>
            <strong>Operasyonel veriler:</strong> randevular, seanslar, paket ve hizmet satışları, stok, ödeme/kasa
            kayıtları ve finansal işlemler.
          </li>
          <li>
            <strong>Cihaz ve bildirim verileri:</strong> anlık bildirim (push) gönderebilmek için cihazın bildirim
            token’ı ve temel cihaz/platform bilgisi.
          </li>
          <li>
            <strong>Teknik kayıtlar:</strong> güvenlik ve hata takibi amacıyla oturum, IP adresi ve işlem (audit)
            günlükleri.
          </li>
        </ul>
      </Bolum>

      <Bolum baslik="3. Verileri Kullanma Amaçlarımız">
        <ul className="ml-5 list-disc space-y-1">
          <li>Randevu, müşteri, paket, stok ve finans yönetimi hizmetini sunmak,</li>
          <li>Randevu hatırlatmaları ve işlemlerle ilgili anlık bildirimler göndermek,</li>
          <li>Hesap güvenliğini sağlamak, yetkisiz erişimi tespit etmek ve önlemek,</li>
          <li>Yasal yükümlülükleri yerine getirmek ve hizmeti iyileştirmek.</li>
        </ul>
        <p>Verileriniz pazarlama amacıyla üçüncü taraflara satılmaz veya kiralanmaz.</p>
      </Bolum>

      <Bolum baslik="4. Veri Güvenliği">
        <p>
          Ad, telefon, T.C. kimlik numarası, adres ve notlar gibi hassas müşteri alanları veritabanında
          <strong> AES-256-GCM</strong> ile şifrelenerek saklanır. Tüm veri iletişimi <strong>HTTPS</strong> üzerinden
          şifreli olarak yapılır. Şifreler güçlü algoritmalarla hash’lenir ve düz metin olarak tutulmaz. Erişim,
          rol tabanlı yetkilendirme ile sınırlandırılır.
        </p>
      </Bolum>

      <Bolum baslik="5. Üçüncü Taraf Hizmetler">
        <p>Uygulama, işlevini yerine getirmek için sınırlı sayıda güvenilir hizmetten yararlanır:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Firebase Cloud Messaging (Google):</strong> anlık bildirimlerin iletilmesi için cihaz token’ı
            kullanılır.
          </li>
          <li>
            <strong>Apple Push Notification service (Apple):</strong> iOS cihazlara bildirim iletimi için kullanılır.
          </li>
          <li>
            <strong>Barındırma/altyapı sağlayıcıları:</strong> verilerin güvenli sunucularda saklanması için
            kullanılır.
          </li>
        </ul>
      </Bolum>

      <Bolum baslik="6. Verilerin Saklanması ve Silinmesi">
        <p>
          Kişisel veriler, hizmetin sunulması ve yasal saklama süreleri boyunca tutulur. İşletme veya ilgili kişi
          talep ettiğinde, yasal yükümlülükler saklı kalmak kaydıyla veriler silinir veya anonim hale getirilir.
        </p>
      </Bolum>

      <Bolum baslik="7. Haklarınız (KVKK / GDPR)">
        <p>
          İlgili kişi olarak; verilerinize erişme, düzeltilmesini veya silinmesini isteme, işlenmesine itiraz etme ve
          verilerinizin bir kopyasını talep etme haklarına sahipsiniz. Bu haklarınızı kullanmak için aşağıdaki
          iletişim adresinden bize ulaşabilirsiniz.
        </p>
      </Bolum>

      <Bolum baslik="8. Çocukların Gizliliği">
        <p>
          Uygulama bir işletme yönetim aracıdır ve 13 yaşın altındaki bireylere yönelik değildir; bu kişilerden
          bilerek veri toplamayız.
        </p>
      </Bolum>

      <Bolum baslik="9. Değişiklikler">
        <p>
          Bu politika zaman zaman güncellenebilir. Güncellemeler bu sayfada yayımlandığı tarihte yürürlüğe girer.
        </p>
      </Bolum>

      <Bolum baslik="10. İletişim">
        <p>
          Gizlilikle ilgili soru ve talepleriniz için:{' '}
          <a className="font-medium text-indigo-600 underline" href={`mailto:${ILETISIM_EPOSTA}`}>
            {ILETISIM_EPOSTA}
          </a>
        </p>
      </Bolum>

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-sm text-neutral-400">
        © {new Date().getFullYear()} {SIRKET} — BeautyAsist
      </footer>
    </main>
  )
}
