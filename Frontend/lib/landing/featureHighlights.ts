/**
 * ÖNE ÇIKAN ÖZELLİKLER — tanıtım metinlerinin TEK kaynağı (ana sayfa bölümü, SSS ve arama motorları / yapay zekâ
 * için yapılandırılmış veri bunu okur). Kullanıcı isteği 23 Kas 2026: "yapay zekâlar ve kullanıcı web sitesine girdiğinde
 * görsün" — Gemini, sitede yazmadığı için WhatsApp, online randevu, veri aktarımı ve çoklu cihazı kıyaslamaya almamıştı.
 *
 * Her madde paneldeki gerçek bir işleve karşılık gelir (backend: NotificationTrigger, WhatsApp niyet motoru, müşteri
 * portalı, DataImportService, masaüstü çevrimdışı kuyruğu). Olmayan bir özellik buraya yazılmaz.
 */

export interface Spotlight {
  id: string
  kicker: string
  title: string
  lead: string
  points: string[]
}

export const spotlights: Spotlight[] = [
  {
    id: 'whatsapp',
    kicker: 'WhatsApp entegrasyonu',
    title: 'Danışanlarınıza WhatsApp’tan ulaşın, yanıtı panelde görün.',
    lead:
      'BeautyAsist, Meta’nın resmî WhatsApp Business altyapısıyla salonunuzun numarasından mesaj gönderir. Hatırlatmalar kendiliğinden gider; danışanın verdiği yanıt da randevunun yanına düşer.',
    points: [
      'Randevu hatırlatması: danışan “EVET” yazarak gelişini onaylar, “HAYIR” yazarak iptal eder; durum takvimde rozet olarak görünür.',
      'Erteleme isteği: danışan “perşembe 15.00 olur mu?” gibi yazdığında BeautyAsist tarihi ve saati anlar, önerilen saati tek dokunuşla uygularsınız.',
      'KVKK onayı WhatsApp üzerinden alınır ve danışan kartına kaydedilir.',
      'Doğum günü kutlaması, kampanya duyurusu, taksit/ödeme hatırlatması, seans yenileme ve uzun süredir gelmeyen danışanlara geri kazanım mesajı.',
      'Hazır şablonlar, kendi şablonlarınız, gönderim geçmişi ve iletim durumu; aynı mesajları SMS ve e-postayla da gönderebilirsiniz.',
    ],
  },
  {
    id: 'online-randevu',
    kicker: 'Online randevu ve müşteri portalı',
    title: 'Danışanlarınız 7/24 kendi randevusunu alsın.',
    lead:
      'Salonunuz BeautyAsist’te kendi vitrin sayfasıyla yer alır. Danışan web’den ya da mobil uygulamadan şubeyi, hizmeti, uzmanı ve boş saati seçer; talep onayınıza düşer.',
    points: [
      'Salon vitrini: hizmetler, fiyatlar, fotoğraflar, çalışma saatleri ve danışan değerlendirmeleri tek sayfada.',
      'Yalnız gerçekten boş olan saatler gösterilir; uzmanın çizelgesi ve kapalı saatler hesaba katılır.',
      'Müşteri portalı: danışan randevularını görür, kurallarınıza uygun süre içinde online iptal eder ya da erteler.',
      'Dolu güne gelen talepler bekleme listesine alınır; saat boşalınca danışana teklif edersiniz.',
      'Hizmet sonrası QR kodla puan ve yorum; hediye kartları da QR ile doğrulanır.',
    ],
  },
  {
    id: 'veri-aktarimi',
    kicker: 'Hazır veriyi aktarma',
    title: 'Eski programınızdaki kayıtlarla başlayın.',
    lead:
      'Başka bir programdan ya da kendi tablolarınızdan aldığınız Excel dosyasını yükleyin. BeautyAsist sütunları tanır, kayıtları doğru yere yerleştirir.',
    points: [
      'Danışanlar, hizmetler, paketler, ürünler (stok) ve personel tek dosyadan ya da ayrı ayrı aktarılır.',
      'Sistemde zaten olan kayıtlar ikinci kez eklenmez; atlanan ve hatalı satırlar sonuçta tek tek gösterilir.',
      'Kurulum ekibimiz aktarımda yardımcı olur; geçiş günü iş akışınız durmaz.',
      'Verileriniz sizindir: kayıtları ve raporları istediğiniz an Excel ve PDF olarak dışa aktarırsınız.',
    ],
  },
  {
    id: 'her-cihaz',
    kicker: 'Çoklu cihaz desteği',
    title: 'Resepsiyonda, cebinizde ve tablette aynı panel.',
    lead:
      'BeautyAsist web tarayıcısında, iPhone ve iPad’de, Android’de ve Mac ile Windows masaüstü uygulamasında çalışır. Ekran telefona, tablete ve geniş monitöre göre kendini düzenler.',
    points: [
      'Bir cihazda yapılan değişiklik diğerlerinde anında görünür; randevu ve kasa herkes için aynıdır.',
      'Masaüstü uygulamasında internet kesilse bile işlemler sıraya alınır, bağlantı gelince çift kayıt olmadan gönderilir.',
      'Tablet, danışana onam imzalatmak için imza istasyonuna dönüşür.',
      'Masaüstü bildirimleri ve cihaz güvenliği: personelin hangi cihazlardan girebileceğini siz belirlersiniz.',
    ],
  },
]

/** Kısa özellik listesi: "ve dahası" ızgarası ve yapılandırılmış verinin featureList'i. */
export const moreFeatures: { title: string; body: string }[] = [
  { title: 'Takvim ve çizelge', body: 'Uzman, oda ve saatleri aynı takvimde; haftalık ve aylık personel çizelgesi.' },
  { title: 'Paket ve seans takibi', body: 'Kalan seans hakları, paket satışı ve seans yenileme hatırlatması.' },
  { title: 'Dijital onam ve imza', body: 'Hizmete göre onam şablonu, tabletle imza, danışan dosyasına imzalı PDF.' },
  { title: 'Konsültasyon ve işlem günlüğü', body: 'Danışan beyanları, özel alanlar, önce ve sonra fotoğrafları.' },
  { title: 'Adisyon, kasa ve ön muhasebe', body: 'Adisyon, cari hesap, taksit, gider ve gün sonu kasa kapanışı.' },
  { title: 'Stok ve ürün', body: 'Ürün hareketleri ve kritik stok uyarıları.' },
  { title: 'Personel ve prim', body: 'Görev bazlı yetki, izin günleri ve adisyon onayında prim hesabı.' },
  { title: 'Kampanya, sadakat ve hediye çeki', body: 'İndirimler, puan kazanımı, hediye çeki ve kupon.' },
  { title: 'Çoklu şube', body: 'Şubeleri tek hesaptan yönetin; personel şubesinin verisini görür.' },
  { title: 'KVKK ve denetim', body: 'Maskeli telefon ve e-posta, yönetici onaylı işlemler, kim neyi ne zaman değiştirdi kaydı.' },
  { title: 'Raporlar', body: 'Finans, danışan, personel ve hizmet raporları; Excel ve PDF.' },
  { title: 'Maydi yapay zekâ asistanı', body: 'Bugünkü randevuları, kasayı sorun ya da bir işlemin nasıl yapıldığını öğrenin.' },
]

/** SSS'ye eklenen, özellikleri soran sorular (yapılandırılmış veride FAQPage olarak da yayımlanır). */
export const featureQuestions: { question: string; answer: string }[] = [
  {
    question: 'BeautyAsist WhatsApp ile bildirim gönderebiliyor mu?',
    answer:
      'Evet. Randevu hatırlatması, doğum günü, kampanya, ödeme ve seans yenileme mesajları salonunuzun WhatsApp Business numarasından gider. Danışan EVET/HAYIR ile randevusunu onaylar ya da iptal eder, erteleme isterse önerdiği saat panelinize düşer. Aynı mesajlar SMS ve e-postayla da gönderilebilir.',
  },
  {
    question: 'Danışanlarım online randevu alabilir mi?',
    answer:
      'Evet. Salonunuzun vitrin sayfasından ya da BeautyAsist mobil uygulamasından şube, hizmet, uzman ve boş saat seçilerek randevu talebi gönderilir; talep onayınıza düşer. Danışan müşteri portalından randevularını görür, kurallarınıza uygun süre içinde iptal eder ya da erteler.',
  },
  {
    question: 'Eski programımdaki müşteri listesini aktarabilir miyim?',
    answer:
      'Evet. Danışan, hizmet, paket, ürün ve personel listelerinizi Excel dosyası olarak yükleyebilirsiniz; BeautyAsist sütunları tanır ve zaten kayıtlı olanları tekrar eklemez. Kurulum ekibimiz aktarımda yardımcı olur.',
  },
]
