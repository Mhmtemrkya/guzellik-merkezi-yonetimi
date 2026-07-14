import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlarmClock,
  BadgePercent,
  BarChart3,
  Bell,
  Box,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  CreditCard,
  Crown,
  FileClock,
  FileSpreadsheet,
  Filter,
  Gift,
  HandCoins,
  HeartPulse,
  Hourglass,
  KeyRound,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Lock,
  Megaphone,
  MessageCircle,
  PackageOpen,
  PartyPopper,
  PieChart,
  Receipt,
  Scale,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Timer,
  TrendingUp,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
  Wallet,
  Zap,
} from 'lucide-react'

export interface GuideStep {
  icon: LucideIcon
  title: string
  desc: string
  /** Sayfadaki hedef bölüm: [data-guide="<anchor>"] işaretli öğe. Yoksa spot gösterilmez. */
  anchor?: string
}

export interface PageGuide {
  /** Kılavuz başlığı — modal üstünde görünür. */
  title: string
  /** Sayfayı tek cümleyle tanıtan giriş metni. */
  intro: string
  steps: GuideStep[]
}

/** Personelin admin sayfalarını kullanırken görmesi gereken ek not. */
const STAFF_NOTE: GuideStep = {
  icon: ShieldCheck,
  title: 'Personel notu: Onay kapısı',
  desc:
    'Bu sayfada yaptığınız kaydetme/değiştirme işlemleri doğrudan uygulanmaz; yöneticinize "onay bekleyen taslak" olarak düşer. Yönetici onayladığında işlem otomatik gerçekleşir. Adisyon ve seans tamamlama gibi bazı işlemler bu kuraldan muaftır.',
}

const guides: Record<string, PageGuide> = {
  /* ─────────────────────────── KURUM YÖNETİCİSİ ─────────────────────────── */
  '/admin': {
    title: 'Dashboard — Genel Bakış',
    intro:
      'Salonunuzun günlük nabzını tek ekranda tutar: gelir grafikleri, randevu durumu, personel performansı ve hızlı işlemler burada.',
    steps: [
      {
        icon: Hourglass,
        title: 'Abonelik sayacı',
        anchor: 'dash-abonelik',
        desc:
          'Sayfanın en üstündeki kart, BeautyAsist aboneliğinizin (deneme / aylık / yıllık) kalan süresini canlı geri sayımla gösterir. Süre azaldıkça birim otomatik olarak aydan güne, günden saate iner.',
      },
      {
        icon: Zap,
        title: 'Hızlı menü',
        desc:
          'Tek tıkla en sık kullanılan 6 işlemi başlatır: Yeni Randevu Oluştur, Danışan Ekle, Paket Satışı Yap, Ödeme Al, Stok Çıkışı Yap ve Kampanya Oluştur. İlgili sayfaya gitmeden işlemi buradan açabilirsiniz.',
      },
      {
        icon: PieChart,
        title: 'Randevu durum halkası',
        desc:
          'Renkli halka grafik, seçtiğiniz dönemdeki randevuların dağılımını gösterir: Tamamlandı (yeşil), Devam, Bekliyor, İptal ve Taslak (personelin önerdiği, onayınızı bekleyen randevular). Dilimlerin üzerine gelince adet ve oran görünür.',
      },
      {
        icon: LineChart,
        title: 'Gelir grafiği (Gün / Hafta / Yıl)',
        anchor: 'dash-gelir',
        desc:
          'Toplam gelir çizgi grafiği; üstteki Gün, Hafta ve Yıl sekmeleriyle dönemi değiştirirsiniz. Günlük görünüm saat bazında, yıllık görünüm ay bazında tahsilatı çizer. Eğrinin üzerine gelerek noktasal tutarları okuyabilirsiniz.',
      },
      {
        icon: BarChart3,
        title: 'Dönem tahsilatı & Aylık Taksit Performansı',
        anchor: 'dash-taksit',
        desc:
          'Sütun grafik, ay ay planlanan taksitler ile gerçekleşen tahsilatı karşılaştırır. Sütunların üzerine gelince ayrıntı (toplam vade, ödenen, kalan) açılır. Ok butonlarıyla önceki/sonraki aylara kaydırabilirsiniz.',
      },
      {
        icon: Crown,
        title: 'En çok çalışan personel & satılan paketler',
        anchor: 'dash-insights',
        desc:
          'İki liste kartı: dönem içinde en çok randevu tamamlayan personeliniz ve en çok satılan paketleriniz. Ekibinizin yükünü ve hangi hizmetin öne çıktığını buradan izlersiniz.',
      },
      {
        icon: Bell,
        title: 'Topbar zili — randevu aksiyon kutusu',
        desc:
          'Sağ üstteki zil; personelin önerdiği taslak randevuları (Onayla/Reddet) ve saati gelen randevuları (Tamamlandı/Gelmedi/Ertele) doğrudan içinden yönetmenizi sağlar. Tamamlandı derseniz paketli müşteride seans otomatik düşer.',
      },
    ],
  },

  '/admin/randevular': {
    title: 'Randevular',
    intro:
      'Takvim üzerinde randevu oluşturur, onaylar, tamamlar; iptal ve gelmedi durumlarını yönetirsiniz. Bekleme listesi ve WhatsApp onayı da bu akışa bağlıdır.',
    steps: [
      {
        icon: CalendarDays,
        title: 'Takvim görünümleri',
        desc:
          'Bugün / Bu Hafta / Bu Ay sekmeleriyle görünümü değiştirin; ok butonlarıyla dönemler arasında gezinin, "Bugüne dön" ile geri gelin. Her randevu statü rengiyle görünür: Tamamlandı, Devam, Bekliyor, İptal, Gelmedi ve Taslak.',
      },
      {
        icon: CalendarClock,
        title: 'Yeni randevu oluşturma',
        desc:
          'Yeni Randevu butonuyla müşteri, hizmet/paket, personel, tarih ve saat seçin. Aynı personelde çakışan saat seçerseniz sistem uyarır. Kara listedeki müşteriye randevu açılamaz.',
      },
      {
        icon: FileClock,
        title: 'Taslak → Onay akışı',
        desc:
          'Personelin oluşturduğu randevular önce Taslak statüsünde gelir; siz onaylayana kadar kesinleşmez. Onay/red işlemini bu sayfadan veya sağ üstteki zilden yapabilirsiniz.',
      },
      {
        icon: CheckCircle2,
        title: 'Tamamlama ve seans düşümü',
        desc:
          'Saati gelen randevuyu "Tamamlandı" yaptığınızda, müşteri paketliyse kalan seansı otomatik bir azalır. "Gelmedi" işaretlerseniz müşterinin NoShow geçmişine işlenir; sık tekrarında online randevusu kısıtlanır.',
      },
      {
        icon: MessageCircle,
        title: 'WhatsApp hatırlatma ve müşteri onayı',
        desc:
          'Randevu hatırlatmaları WhatsApp üzerinden otomatik gider; müşteri "Evet/Hayır" yanıtı verirse randevunun müşteri onay durumu takvimde görünür.',
      },
      {
        icon: AlarmClock,
        title: 'Dolu slot → Bekleme listesi',
        desc:
          'Dolu bir saate randevu almaya çalışırsanız sistem sizi uyarır ve müşteriyi tek tıkla bekleme listesine ekler. O saat iptal olursa sıradaki müşteriye otomatik WhatsApp teklifi gider.',
      },
      {
        icon: TrendingUp,
        title: 'Üst istatistik şeridi',
        desc:
          'Bu ay toplam randevu, tamamlanan, bekleyen ve tahmini ciro kartları dönemin özetini verir; takvimde gezindikçe seçili döneme göre güncellenir.',
      },
    ],
  },

  '/admin/musteriler': {
    title: 'Müşteriler',
    intro:
      'Tüm danışan kayıtlarınız: segment sekmeleri, detay kartı (grafik, konsültasyon, tedavi günlüğü, seans ve cari), satış ve sadakat yönetimi.',
    steps: [
      {
        icon: Filter,
        title: 'Segment sekmeleri',
        desc:
          'Üstteki sekmeler listeyi anında süzer: Tümü, VIP, KVKK Onaylı / Bekleyen, Borçlu, Yeni Eklenen, Kara Liste ve Pasif (belirlediğiniz gün sayısınca gelmeyenler). Sıralamayı isim, son işlem, borç veya harcamaya göre değiştirebilirsiniz.',
      },
      {
        icon: TrendingUp,
        title: 'Analitik kartlar',
        desc:
          'Liste üstündeki kartlar canlı metrikler sunar: toplam müşteri, KVKK onay oranı, açık borç toplamı, son 90 günde aktif müşteri, en aktif segment, ortalama harcama, bu ay yeni müşteri ve borçlu müşteri oranı.',
      },
      {
        icon: Users,
        title: 'Müşteri detay kartı (5 sekme)',
        desc:
          'Bir müşteriye tıklayınca sekmeli detay penceresi açılır. Genel Bakış sekmesinde harcama/ziyaret grafiği ve hızlı işlem butonları (düzenle, satış, sil) bulunur; diğer sekmeler konsültasyon, tedavi günlüğü, seanslar ve cari hesaptır.',
      },
      {
        icon: HeartPulse,
        title: 'Konsültasyon formu & kontrendikasyon uyarısı',
        desc:
          'Anamnez formunu (hastalık, ilaç, alerji, hamilelik…) müşteri başına bir kez doldurursunuz. Sistem riskli kombinasyonlarda otomatik uyarı bandı gösterir — örneğin hamile müşteriye lazer randevusu alınırken.',
      },
      {
        icon: Sparkles,
        title: 'Tedavi günlüğü (Önce / Sonra)',
        desc:
          'Seans fotoğraflarını tarih tarih yükleyin; kaydırmalı Önce/Sonra karşılaştırıcısıyla gelişimi müşterinize gösterin.',
      },
      {
        icon: ShoppingBag,
        title: 'Satış ve taksitlendirme',
        desc:
          'Detay kartından paket/hizmet satışı başlatın; peşin veya taksitli plan seçin. Taksitli satış otomatik cari hesap ve ödeme planı oluşturur.',
      },
      {
        icon: UserX,
        title: 'Kara liste & VIP',
        desc:
          'Sorunlu müşteriyi kara listeye alırsanız yeni randevu açılması engellenir. VIP işareti ise listede ve randevularda özel rozetle görünür.',
      },
      {
        icon: FileSpreadsheet,
        title: 'Excel aktarımı',
        desc:
          'Müşteri listesini tek tıkla Excel olarak indirebilir veya hazır şablonla toplu müşteri içe aktarabilirsiniz.',
      },
    ],
  },

  '/admin/paketler': {
    title: 'Paket & Hizmet',
    intro:
      'Hizmet kataloğunuzu ve seanslı paketlerinizi burada kurarsınız; fiyatlar, kategoriler ve sadakat puanı ayarları da buradadır.',
    steps: [
      {
        icon: ClipboardList,
        title: 'Hizmet kütüphanesi',
        desc:
          'Tekil hizmetlerinizi (lazer, cilt bakımı, manikür…) fiyat, süre ve kategoriyle tanımlayın. Kategorileri kendiniz oluşturup renk/ikon atayabilirsiniz.',
      },
      {
        icon: PackageOpen,
        title: 'Paket oluşturma',
        desc:
          'Hizmet havuzundan seçim yaparak seanslı paketler kurun (ör. 6 seans lazer). Pakete dahil hizmetler, seans adedi ve toplam fiyat kartta özetlenir; artan/azalan sıralama ve kategori filtresiyle listeyi yönetirsiniz.',
      },
      {
        icon: Gift,
        title: 'Sadakat puan maliyeti',
        desc:
          'Her hizmet ve pakete "puan maliyeti" atayabilirsiniz. Müşteri biriken sadakat puanıyla adisyonda bu hizmeti hediye olarak alabilir.',
      },
      {
        icon: BarChart3,
        title: 'Paket özeti ve satış performansı',
        desc:
          'Paket detayında satış performansını özet olarak görürsünüz: kaç kez satıldı, aktif kullanıcı sayısı. Buradan doğrudan paket satışı da başlatabilirsiniz.',
      },
    ],
  },

  '/admin/stok': {
    title: 'Stok & Ürün',
    intro:
      'Ürün envanterinizi, kritik stok uyarılarını ve tüm giriş/çıkış hareketlerini buradan takip edersiniz.',
    steps: [
      {
        icon: Box,
        title: 'Ürün kütüphanesi',
        desc:
          'Ürünleri kategori, maliyet, satış fiyatı, mevcut miktar ve minimum stok eşiğiyle kaydedin. Arama ve kategori filtresiyle hızla bulun.',
      },
      {
        icon: ShieldAlert,
        title: 'Kritik stok uyarısı',
        desc:
          'Miktarı minimum eşiğin altına düşen ürünler "Kritik" rozetiyle işaretlenir; öne çıkan uyarı bloğunda toplanır, böylece sipariş zamanını kaçırmazsınız.',
      },
      {
        icon: Activity,
        title: 'Stok hareketleri',
        desc:
          'Her giriş ve çıkış; tarih, miktar, işlemi yapan kullanıcı ve gerekçeyle "Son Stok Hareketleri" akışına yazılır. Adisyonda kullanılan ürünler stoktan otomatik düşer.',
      },
      {
        icon: PieChart,
        title: 'Kategori bazlı stok değeri grafiği',
        desc:
          'Grafik, deponuzdaki toplam ürün değerinin kategorilere dağılımını gösterir — hangi kategoriye ne kadar sermaye bağladığınızı tek bakışta görürsünüz.',
      },
    ],
  },

  '/admin/kasa': {
    title: 'Günlük Kasa',
    intro:
      'Günün tüm tahsilatlarını alır, ödeme yöntemlerine göre izler ve gelir-gider akışını grafikle takip edersiniz.',
    steps: [
      {
        icon: HandCoins,
        title: 'Yeni tahsilat alma',
        desc:
          '"Yeni tahsilat" ile tutar, ödeme yöntemi (Nakit / Kart / Havale-EFT), tarih ve dekont/referans bilgisini girin. Tahsilatı bir cari hesaba bağlarsanız müşterinin borcundan otomatik düşer.',
      },
      {
        icon: Wallet,
        title: 'Günlük özet kartları',
        desc:
          'Bugünkü gelir, bugünkü gider ve net kasa kartları anlık durumu gösterir. Bugün / Bu Hafta sekmesiyle dönemi genişletebilirsiniz.',
      },
      {
        icon: LineChart,
        title: 'Gelir-Gider Akışı grafiği',
        desc:
          'Çift seri grafik; gelirleri ve giderleri aynı zaman ekseninde çizer. Makasın açıldığı günleri (yüksek gider / düşük tahsilat) kolayca yakalarsınız.',
      },
      {
        icon: Receipt,
        title: 'Hareket listesi',
        desc:
          'Günün tüm kayıtları tablo halinde: saat, müşteri/cari, yöntem, tutar. Yanlış kaydı buradan düzeltebilir veya silebilirsiniz.',
      },
    ],
  },

  '/admin/on-muhasebe': {
    title: 'Ön Muhasebe',
    intro:
      'Cari hesaplar, taksit planları, giderler, personel maaşları ve adisyon — salonunuzun tüm finans operasyonu bu sekmelerde.',
    steps: [
      {
        icon: LayoutDashboard,
        title: 'Genel Bakış sekmesi',
        desc:
          'Dönem seçerek toplam alacak, tahsilat ve gider dengesini özet kartlar ve grafiklerle görürsünüz.',
      },
      {
        icon: Scale,
        title: 'Cari Hesaplar & taksit planı',
        desc:
          'Taksitli satışlar otomatik cari açar; peşinat ve taksit sayısına göre sabit vade planı oluşur. Aldığınız her tahsilat, vadesi en yakın taksitten başlayarak otomatik dağıtılır — kısmi ödemede taksit kısmen kapanır, fazla ödeme kredi olarak kalır.',
      },
      {
        icon: Receipt,
        title: 'Adisyon',
        desc:
          'Müşterinin o günkü tüm işlemlerini (hizmet, ürün, paket) tek fişte toplarsınız. Hediye çeki/kupon kodu uygulayabilir, müşterinin sadakat puanıyla hediye hizmet ekleyebilirsiniz. Kapanışta ödeme yöntemini seçip kasaya işlersiniz.',
      },
      {
        icon: CreditCard,
        title: 'Giderler & Personel Maaşları',
        desc:
          'Kira, fatura, malzeme gibi giderleri kategoriyle kaydedin; personel maaş ödemelerini ayrı sekmede izleyin. Hepsi raporlara ve kasa grafiklerine otomatik yansır.',
      },
      {
        icon: AlarmClock,
        title: 'Taksit hatırlatma',
        desc:
          'Vadesi yaklaşan veya geçen taksitler için müşteriye otomatik WhatsApp/SMS hatırlatması gönderilir; tolerans süresini Ayarlar sayfasından belirlersiniz.',
      },
    ],
  },

  '/admin/kasa-kapanis': {
    title: 'Gün Sonu Kasa Kapanışı',
    intro:
      'Gün biterken kasayı sayar, sistemin beklediği tutarla karşılaştırır ve farkı kayıt altına alırsınız.',
    steps: [
      {
        icon: Timer,
        title: 'Kapanış başlatma',
        desc:
          'Gün sonunda sistem; nakit, kart ve havale kırılımıyla "beklenen" tutarı otomatik hesaplar. Siz fiilen saydığınız tutarları girersiniz.',
      },
      {
        icon: Scale,
        title: 'Fark analizi',
        desc:
          'Sayım ile beklenen tutar karşılaştırılır ve sonuç rozetlenir: Kasa tuttu (yeşil), Kasa eksiği veya Kasa fazlası. Fark için açıklama notu ekleyebilirsiniz.',
      },
      {
        icon: FileClock,
        title: 'Kapanış geçmişi',
        desc:
          'Tüm geçmiş kapanışlar tarih, sayan kişi ve fark tutarıyla listelenir — hangi gün kimin kapattığını sonradan denetleyebilirsiniz.',
      },
    ],
  },

  '/admin/hediye-cek': {
    title: 'Hediye Çeki & Kupon',
    intro:
      'İndirim kuponları ve hediye çekleri üretir, geçerliliklerini yönetir ve kullanımlarını izlersiniz.',
    steps: [
      {
        icon: Gift,
        title: 'Kod oluşturma',
        desc:
          'Üç tip tanımlayabilirsiniz: Yüzde İndirim (ör. %20), Sabit İndirim (ör. 500 TL) ve bakiyeli Hediye Çeki. Kod, geçerlilik tarihi ve kullanım hakkı belirlenir.',
      },
      {
        icon: BadgePercent,
        title: 'Adisyonda kullanım',
        desc:
          'Müşteri öderken kupon kodunu adisyona girersiniz; indirim tutara otomatik yansır, hediye çekinde kalan bakiye takip edilir.',
      },
      {
        icon: PieChart,
        title: 'Durum istatistikleri',
        desc:
          'Üst kartlar toplam kod, geçerli (aktif), süresi/hakkı dolmuş ve pasif kod sayılarını gösterir; listede her kodun kalan hakkı ve kullanım geçmişi bulunur.',
      },
    ],
  },

  '/admin/bekleme-listesi': {
    title: 'Bekleme Listesi',
    intro:
      'Dolu saatler için müşteri sırası tutar; yer açıldığında WhatsApp üzerinden otomatik teklif gönderir.',
    steps: [
      {
        icon: ListChecks,
        title: 'Sıra yönetimi',
        desc:
          'Kayıtlar statüleriyle listelenir: Bekliyor, Bilgilendirildi, Randevu yapıldı, İptal. Kaydı elle "randevu yapıldı" işaretleyebilir, yeniden sıraya alabilir veya silebilirsiniz.',
      },
      {
        icon: Send,
        title: 'Otomatik WhatsApp teklifi',
        desc:
          'Dolu bir slottaki randevu iptal edildiğinde sistem sıradaki müşteriye otomatik teklif mesajı atar. Müşteri "Evet" yanıtlarsa randevu otomatik açılır; "Hayır" derse teklif sıradaki kişiye geçer.',
      },
      {
        icon: TrendingUp,
        title: 'Dönüşüm istatistikleri',
        desc:
          'Üst kartlar toplam kayıt, sırada bekleyen ve randevuya dönen sayılarını gösterir — bekleme listesinin size kaç randevu kazandırdığını ölçersiniz.',
      },
    ],
  },

  '/admin/personel': {
    title: 'Personel & Roller',
    intro:
      'Ekibinizi yönetir, iki seviyeli yetkiler atar, giriş bilgilerini üretir ve performansı izlersiniz.',
    steps: [
      {
        icon: UserPlus,
        title: 'Personel ekleme ve giriş bilgileri',
        desc:
          'Yeni personel eklediğinizde sistem kullanıcı adı ve parola üretir; bilgileri şık bir PDF olarak indirip personele verebilirsiniz. Ayrılan personeli pasife alırsınız, kayıtları silinmez.',
      },
      {
        icon: KeyRound,
        title: 'İki seviyeli yetki sistemi',
        desc:
          'Her personel için önce hangi sayfaları görebileceğini, sonra o sayfalarda hangi işlemleri (ekleme, düzenleme, silme…) yapabileceğini ayrı ayrı işaretlersiniz. Yetkisi olmayan sayfa menüde hiç görünmez.',
      },
      {
        icon: ShieldCheck,
        title: 'Onay kapısı',
        desc:
          'Personelin yaptığı tüm yazma işlemleri (randevu, müşteri, satış…) önce taslağa düşer ve sizin onayınızla uygulanır. Onay kuyruğunu "Onay Bekleyenler" sayfasından veya zilden yönetirsiniz.',
      },
      {
        icon: Star,
        title: 'Yıldız puanı (QR ile müşteri oyu)',
        desc:
          'Seans sonrası müşteriye QR kod gösterirsiniz; müşteri 15 dakika geçerli bağlantıdan personele yıldız verir. Puanlar personel kartında ortalama olarak birikir.',
      },
      {
        icon: TrendingUp,
        title: 'Performans ve şube aktarma',
        desc:
          'Aylık tamamlanan randevu sayısı ve başarı oranı personel kartında görünür. Çok şubeli kurumlarda personeli başka şubeye buradan aktarırsınız.',
      },
      {
        icon: Lock,
        title: 'Cihaz güvenliği',
        desc:
          'Paketiniz destekliyorsa personelin hangi cihazlardan giriş yapabileceğini kısıtlarsınız; tanımsız cihazdan giriş denemesi güvenlik loguna düşer.',
      },
    ],
  },

  '/admin/personel/cizelge': {
    title: 'Personel Çizelgesi',
    intro:
      'Ekibinizin gün, hafta ve ay bazında doluluğunu tek tabloda görürsünüz; kim ne zaman hangi müşteriyle çalışıyor.',
    steps: [
      {
        icon: CalendarRange,
        title: 'Üç görünüm',
        desc:
          'Günlük ajanda personel × saat ızgarası sunar; haftalık ve aylık görünümler doluluk yoğunluğunu renk tonuyla gösterir. Bir güne tıklayarak o günün ajandasını açarsınız.',
      },
      {
        icon: Users,
        title: 'Müşteri-işlem detayı',
        desc:
          'Hücrelerde randevunun müşterisi ve işlemi yazar; statü renkleri (Tamamlandı, Devam, Bekliyor, İptal, Taslak, İzinli) takvimle aynıdır.',
      },
      {
        icon: PieChart,
        title: 'Doluluk metrikleri',
        desc:
          'Üst kartlar aktif personel sayısı, planlı randevu adedi ve doluluk oranını gösterir — hangi gün ekip boş, hangi gün tıkalı anında görürsünüz.',
      },
      {
        icon: Lock,
        title: 'Paket özelliği',
        desc: 'Çizelge, Pro ve üzeri paketlerde açıktır; paketinizde yoksa kart kilitli görünür.',
      },
    ],
  },

  '/admin/onaylar': {
    title: 'Onay Bekleyenler',
    intro:
      'Personelin yaptığı tüm işlemler burada taslak olarak bekler; siz onaylayınca sistem işlemi otomatik uygular.',
    steps: [
      {
        icon: ClipboardCheck,
        title: 'Onay kuyruğu',
        desc:
          'Bekleyen, Onaylanan ve Reddedilen sekmeleriyle talepleri süzersiniz. Her kartta talebi yapan personel, işlem türü ve içerik özeti görünür.',
      },
      {
        icon: CheckCircle2,
        title: 'Onayla / Reddet',
        desc:
          'Onayladığınızda işlem (randevu, müşteri kaydı, satış…) sanki personel o an yapmış gibi otomatik uygulanır; taksitli satış onayında cari hesap ve ödeme planı da kurulur. Reddederseniz hiçbir değişiklik olmaz.',
      },
      {
        icon: Clock3,
        title: 'Bekleme istatistikleri',
        desc:
          'Üst kartlar ortalama bekleme süresi, en uzun bekleyen talep ve bugün onaylanan/reddedilen sayılarını gösterir — kuyruk birikmeden fark edersiniz.',
      },
    ],
  },

  '/admin/bildirimler': {
    title: 'Bildirimler & Mesajlaşma',
    intro:
      'WhatsApp, SMS ve e-posta üzerinden otomatik hatırlatmalar ve kampanya duyuruları yönetilir.',
    steps: [
      {
        icon: MessageCircle,
        title: 'WhatsApp hatırlatma (2 yönlü)',
        desc:
          'Randevu hatırlatmaları otomatik gider; müşterinin "Evet/Hayır/başka saat" yanıtlarını Türkçe niyet motoru anlar ve randevu durumuna işler. Bağlantı ayarlarını buradan yaparsınız.',
      },
      {
        icon: Megaphone,
        title: 'Kampanya gönderimi',
        desc:
          'Hedef kitleyi seçin — tüm müşteriler, son 90 günde aktifler, 30 gündür gelmeyenler veya bu hafta doğum günü olanlar — mesajı yazın, kanalı (WhatsApp / SMS / E-posta) seçip gönderin. Hedef sayısı göndermeden önce görünür.',
      },
      {
        icon: PartyPopper,
        title: 'Otomatik tetikleyiciler',
        desc:
          'Doğum günü kutlaması, randevu sonrası teşekkür, taksit hatırlatması gibi otomatik mesajları tetikleyici bazında açıp kapatırsınız.',
      },
      {
        icon: Scale,
        title: 'Aylık kotalar',
        desc:
          'WhatsApp, SMS ve e-posta gönderimleri paketinize göre aylık kotaya tabidir; kalan kotanız sayfada görünür, aşımda gönderim durur.',
      },
    ],
  },

  '/admin/loglar': {
    title: 'Log Kayıtları',
    intro:
      'Sistemde kimin, ne zaman, hangi cihazdan ne yaptığının tam denetim izi.',
    steps: [
      {
        icon: Search,
        title: 'Filtreleme ve arama',
        desc:
          'Kayıtları eylem türüne (Oluşturma / Güncelleme / Silme-Onay), modüle, kullanıcıya veya serbest metne göre süzersiniz. Her satırda IP adresi, cihaz kimliği ve ağ bilgisi bulunur.',
      },
      {
        icon: BarChart3,
        title: 'İstatistik kartları',
        desc:
          'Toplam işlem, benzersiz kullanıcı, hata/uyarı sayısı, en aktif modül ve en yoğun saat kartları genel aktiviteyi özetler.',
      },
      {
        icon: ShieldAlert,
        title: 'Güvenlik olayları',
        desc:
          'Yetkisiz cihaz girişi gibi güvenlik olayları ayrıca işaretlenir; şüpheli aktiviteyi buradan yakalarsınız. Kayıtları Excel olarak dışa aktarabilirsiniz.',
      },
    ],
  },

  '/admin/ayarlar': {
    title: 'Ayarlar',
    intro:
      'Kurum kimliği, şubeler, finans tercihleri ve güvenlik politikaları — sistemin tüm yapılandırması burada.',
    steps: [
      {
        icon: Building2,
        title: 'Kurum ve şube bilgileri',
        anchor: 'ayarlar-kurum',
        desc:
          'Kurum adı, domain, e-posta ve şubelerinizi yönetirsiniz. Çok şubeli kurumda üst bardaki şube seçici tüm sayfaları seçili şubeye göre süzer.',
      },
      {
        icon: Wallet,
        title: 'Finans tercihleri',
        anchor: 'ayarlar-gelir',
        desc:
          'Para birimi (TRY/USD/EUR), maksimum taksit sayısı ve vade hatırlatma/tolerans süresi burada belirlenir; taksitli satış ve hatırlatmalar bu kurallara uyar.',
      },
      {
        icon: UserCog,
        title: 'Kapasite ve pasif müşteri eşiği',
        desc:
          'Oda ve personel kapasitesi randevu planlamasını besler. "Pasif müşteri eşiği" (gün) — bu süredir gelmeyen müşteriler, Müşteriler sayfasındaki Pasif sekmesine düşer.',
      },
      {
        icon: MessageCircle,
        title: 'WhatsApp bağlantısı',
        anchor: 'ayarlar-whatsapp',
        desc:
          'Randevu hatırlatmaları ve otomatik mesajlar için kurum numaranızı Meta WhatsApp Business API ile bağlarsınız. Karttaki "Nasıl bağlanır? (adım adım)" bölümü tüm kurulumu anlatır; bilgiler girilmeden sistem Simülasyon modunda kalır (mesaj gitmez), Phone Number ID + kalıcı token girilince rozet Canlı olur.',
      },
      {
        icon: ShieldCheck,
        title: 'Güvenlik',
        anchor: 'ayarlar-guvenlik',
        desc:
          'Parola politikası, cihaz kontrolü ve oturum ayarları güvenlik kartında toplanır.',
      },
    ],
  },

  '/admin/paket': {
    title: 'Paketim (Abonelik)',
    intro:
      'BeautyAsist aboneliğinizin planı, kotaları ve yükseltme seçenekleri.',
    steps: [
      {
        icon: Crown,
        title: 'Mevcut paket ve kotalar',
        desc:
          'Planınıza dahil özellikler ve aylık kullanım kotalarınız (WhatsApp/SMS/e-posta, müşteri limiti vb.) doluluk çubuklarıyla görünür; "en yüksek metrik" kartı sınıra en çok yaklaşan kotanızı vurgular.',
      },
      {
        icon: TrendingUp,
        title: 'Üst paketler',
        desc:
          'Bir üst plana geçtiğinizde açılacak özellikler karşılaştırmalı listelenir. Paketinize dahil olmayan sayfalar panelde kilit rozetiyle işaretlenir.',
      },
    ],
  },

  '/admin/raporlar': {
    title: 'Raporlar',
    intro:
      'Finans, müşteri, personel ve hizmet analitiği — dört rapor sekmesi ve dönem karşılaştırmalı grafikler.',
    steps: [
      {
        icon: CalendarRange,
        title: 'Dönem seçimi',
        desc:
          'Günlük / Haftalık / Aylık sekmeleri tüm raporun zaman penceresini değiştirir; ok butonlarıyla önceki dönemlere gider, dönemler arası karşılaştırma kartlarını görürsünüz.',
      },
      {
        icon: Wallet,
        title: 'Finans Özet sekmesi',
        desc:
          'Toplam gelir (tahsilat), toplam gider, net kâr, ortalama sepet ve müşteri başına ciro kartları; altında Ödeme Yöntemi Dağılımı grafiği (nakit/kart/havale oranları), hareket listesi ve gider kırılımı yer alır.',
      },
      {
        icon: Users,
        title: 'Müşteri Analitiği sekmesi',
        desc:
          'En sık gelen müşteriler listesi, yeni/dönen müşteri dengesi ve segment dağılımı — sadık kitlenizi ve kaybettiğiniz müşterileri gösterir.',
      },
      {
        icon: UserCheck,
        title: 'Personel Performansı sekmesi',
        desc:
          'Personel bazında tamamlanan randevu, üretilen ciro ve başarı oranı tablo + grafikle karşılaştırılır; prim hesabına temel veri buradan çıkar.',
      },
      {
        icon: BarChart3,
        title: 'Hizmet Doluluk & Ciro sekmesi',
        desc:
          'Hangi hizmet/paket ne kadar dolu ve ne kadar ciro üretiyor — kapasite planlaması ve fiyatlama kararları için hizmet bazlı doluluk grafiği.',
      },
      {
        icon: FileSpreadsheet,
        title: 'Dışa aktarma',
        desc: 'Tüm rapor sekmeleri PDF/Excel olarak indirilebilir; dosyalar marka başlığıyla üretilir.',
      },
    ],
  },

  /* ─────────────────────────── PERSONEL PANELİ ─────────────────────────── */
  '/personel': {
    title: 'Personel Paneli',
    intro:
      'Gününüzün özeti: bugünkü programınız, atanmış müşterileriniz ve bekleyen işleriniz tek ekranda.',
    steps: [
      {
        icon: CalendarDays,
        title: 'Bugünkü programım',
        desc:
          'Size atanan günün randevuları saat sırasıyla listelenir; her satırda müşteri, işlem ve statü rozeti (Tamamlandı, Devam, Bekliyor, Taslak, İptal) görünür.',
      },
      {
        icon: Zap,
        title: 'Hızlı erişim kartları',
        desc:
          'Randevularım, Müşterilerim, Seanslarım ve Günlük Kasa sayfalarına tek dokunuşla geçersiniz; kartlarda atanmış müşteri ve bekleyen işlem sayaçları bulunur.',
      },
      {
        icon: ShieldCheck,
        title: 'Onay akışı nasıl çalışır?',
        desc:
          'Oluşturduğunuz randevu ve kayıtlar önce "Taslak" olur ve yöneticinize düşer; yönetici onaylayınca kesinleşir. Reddedilirse bildirim alırsınız.',
      },
      {
        icon: Star,
        title: 'Yıldız puanınız',
        desc:
          'Seans sonrası müşterilerinize gösterdiğiniz QR ile aldığınız yıldızlar performans kartınızda birikir; yöneticiniz aylık başarı oranınızı buradan izler.',
      },
    ],
  },

  '/personel/seanslar': {
    title: 'Seanslarım',
    intro:
      'Paketli müşterilerinizin kalan seanslarını ve tahsilat durumlarını takip edersiniz.',
    steps: [
      {
        icon: ListChecks,
        title: 'Paket ve seans takibi',
        desc:
          'Her müşteri kartında aktif paketi, tamamlanan/kalan seans sayısı ve ilerleme halkası görünür. Randevu "Tamamlandı" yapıldığında seans otomatik düşer.',
      },
      {
        icon: Wallet,
        title: 'Kalan tahsilat',
        desc:
          'Üst kartlar paketli müşteri sayısı, aktif paket adedi, tamamlanan seans toplamı ve kalan tahsilat tutarını gösterir — hangi müşterinin ödemesi eksik anında görürsünüz.',
      },
    ],
  },

  '/personel/profil': {
    title: 'Profilim',
    intro: 'Hesap bilgileriniz ve parola değişikliği.',
    steps: [
      {
        icon: UserCog,
        title: 'Profil bilgilerim',
        desc: 'Ad soyad, e-posta ve rolünüz burada görünür; bilgilerinizi güncelleyebilirsiniz.',
      },
      {
        icon: KeyRound,
        title: 'Parola değiştirme',
        desc:
          'Mevcut parolanızı doğrulayıp yeni parola belirlersiniz. Güçlü bir parola seçin — cihaz kontrolü açıksa yalnızca tanımlı cihazlardan giriş yapabilirsiniz.',
      },
    ],
  },

  /* ─────────────────────────── PLATFORM YÖNETİCİSİ ─────────────────────────── */
  '/platform': {
    title: 'Platform Overview',
    intro: 'Tüm kurumların (tenant) abonelik, kullanım ve sağlık özeti.',
    steps: [
      {
        icon: LayoutDashboard,
        title: 'KPI şeridi ve sparkline grafikleri',
        desc:
          'Aktif kurum, toplam MRR, deneme dönüşümü gibi metrikler mini trend çizgileriyle (sparkline) görünür; kartlara tıklayarak ilgili sayfaya geçersiniz.',
      },
      {
        icon: Activity,
        title: 'Sistem durumu',
        desc: 'API, kuyruk ve entegrasyon sağlığı özet kartlarda; sorunlu kurumlar uyarı listesinde öne çıkar.',
      },
    ],
  },
  '/platform/kurumlar': {
    title: 'Tüm Kurumlar',
    intro: 'Kurum (tenant) oluşturma, plan atama ve limit yönetimi.',
    steps: [
      {
        icon: Building2,
        title: 'Kurum listesi ve oluşturma',
        desc:
          'Her kurumun planı, domaini, müşteri sayısı ve durumu listelenir. Yeni kurum oluştururken slug otomatik domaine dönüşür ve yönetici giriş bilgileri üretilir.',
      },
      {
        icon: Crown,
        title: 'Plan ve limitler',
        desc: 'Kuruma plan atar, özellik ve kota limitlerini bireysel olarak geçersiz kılabilirsiniz.',
      },
    ],
  },
  '/platform/uyarilar': {
    title: 'Sağlık Uyarıları',
    intro: 'Kurumların risk ve sağlık sinyalleri.',
    steps: [
      {
        icon: ShieldAlert,
        title: 'Uyarı akışı',
        desc:
          'Kota aşımı, entegrasyon hatası, ödeme gecikmesi gibi uyarılar önem derecesiyle listelenir; Excel dışa aktarımı vardır.',
      },
    ],
  },
  '/platform/finans': {
    title: 'MRR & Abonelik',
    intro: 'Platform gelir metrikleri.',
    steps: [
      {
        icon: TrendingUp,
        title: 'MRR grafikleri',
        desc:
          'Aylık yinelenen gelir (MRR), plan bazlı dağılım ve churn eğilimi grafiklerle izlenir; deneme→ücretli dönüşüm hunisi ayrı kartta.',
      },
    ],
  },
  '/platform/fatura': {
    title: 'Faturalama',
    intro: 'Kurum faturaları ve tahsilat mutabakatı.',
    steps: [
      {
        icon: Receipt,
        title: 'Fatura yönetimi',
        desc: 'Kurum bazında fatura kesme, ödeme durumu işaretleme ve bakiye mutabakatı buradan yapılır.',
      },
    ],
  },
  '/platform/planlar': {
    title: 'Plan Kataloğu',
    intro: 'Satılabilir abonelik planlarının tanımı.',
    steps: [
      {
        icon: PackageOpen,
        title: 'Plan tanımlama',
        desc:
          'Plan fiyatı, dahil özellik anahtarları ve aylık kotalar (WhatsApp/SMS/e-posta, müşteri limiti) plan formunda belirlenir; kurumlar bu katalogdan plan alır.',
      },
    ],
  },
  '/platform/sistem': {
    title: 'Sistem Ayarları',
    intro: 'Platform geneli teknik yapılandırma.',
    steps: [
      {
        icon: Settings2,
        title: 'Entegrasyon ve bakım',
        desc:
          'SMS/e-posta sağlayıcıları (Netgsm/Twilio/SMTP), webhook, yedekleme ve veri saklama politikaları JSON bölümleri halinde düzenlenir; arka plan iş kuyruğu buradan izlenir.',
      },
    ],
  },
}

/**
 * Verilen path için kılavuzu bulur.
 * - Query string ve sondaki / temizlenir.
 * - /personel/* sayfaları admin eşdeğerini kullanır (personel notu eklenerek),
 *   çünkü bu sayfalar aynı bileşenin re-export'udur.
 */
export function resolveGuide(pathname: string | null): { key: string; guide: PageGuide } | null {
  if (!pathname) return null
  const path = pathname.split('?')[0]!.replace(/\/+$/, '') || '/'

  const direct = guides[path]
  if (direct) return { key: path, guide: direct }

  if (path.startsWith('/personel/')) {
    const adminPath = path.replace('/personel', '/admin')
    const adminGuide = guides[adminPath]
    if (adminGuide) {
      return {
        key: path,
        guide: { ...adminGuide, steps: [...adminGuide.steps, STAFF_NOTE] },
      }
    }
  }
  return null
}
