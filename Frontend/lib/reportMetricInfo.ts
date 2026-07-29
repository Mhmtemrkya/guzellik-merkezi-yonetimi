/**
 * RAPOR METRİK SÖZLÜĞÜ
 *
 * Raporlar sayfasındaki her kartın "bu nedir / nereden geliyor / nasıl hesaplanıyor" açıklaması.
 * Kartlara tıklanınca açılan detay modali bu katalogtan beslenir — açıklama arayüzde dağılmasın,
 * tek yerden güncellensin diye.
 *
 * Anahtarlar backend'in döndürdüğü metrik `key` değerleriyle birebir aynıdır; sekmeye özel
 * kartlar için `<sekme>.<alan>` biçiminde anahtar kullanılır (ör. `catalog.soldCount`).
 */

export interface MetricInfo {
  /** Kartın başlığı (modal başlığı olarak da kullanılır). */
  title: string
  /** Tek cümlede: bu sayı neyi gösteriyor? */
  summary: string
  /** Veri hangi kayıttan geliyor — kullanıcının uygulamada gördüğü yerle eşleşecek şekilde. */
  source: string
  /** Hesaplama kuralı, sade dille. */
  formula: string
  /** Yanlış okunmaya açık noktalar — yalnız gerekliyse. */
  caveat?: string
}

// Sık tekrar eden kaynak cümleleri.
const S = {
  payment:
    'Tahsilat kayıtları (cari hesaplara işlenen ödemeler). Kasa sayfasındaki "gelir" satırlarıyla aynı kaynak.',
  expense: 'İşletme giderleri (Ön Muhasebe → Giderler). Maaş, kira, fatura, ürün alımı vb.',
  sale:
    'Satış kayıtları (cari hesaplar). Dönem, satışın GERÇEK tarihine göre süzülür; geçmiş satış girişinde girilen tarih esas alınır.',
  appointment: 'Randevu kayıtları. Dönem, randevunun başlangıç tarihine göre süzülür.',
  customer: 'Müşteri kartları.',
  session: 'Paket/hizmet seans bakiyeleri. Randevu "Tamamlandı" yapılınca ilgili seans düşer.',
  commission: 'Personel prim tahakkukları (Ön Muhasebe → Prim).',
  stock: 'Stok hareketleri (giriş, çıkış, satış, fire) ve ürün kartları.',
  gift: 'Hediye çeki / kupon kayıtları.',
} as const

export const metricInfo: Record<string, MetricInfo> = {
  // ======================================================= GENEL BAKIŞ =====
  income: {
    title: 'Toplam Gelir',
    summary: 'Dönem içinde kasaya FİİLEN giren para.',
    source: S.payment,
    formula: 'Dönemdeki tüm tahsilat kayıtlarının tutar toplamı.',
    caveat:
      'Satış tutarı değildir. 10.000 ₺ paket satıp 2.000 ₺ peşinat aldıysanız gelire 2.000 ₺ yazar; kalan taksitler tahsil edildikçe ilgili aya eklenir.',
  },
  expense: {
    title: 'Toplam Gider',
    summary: 'Dönem içinde yapılan işletme harcamaları.',
    source: S.expense,
    formula: 'Dönemdeki tüm gider kayıtlarının tutar toplamı.',
    caveat: 'Ürün alımı buraya girer; satılan ürünün maliyeti ayrıca Stok sekmesinde de görünür.',
  },
  net: {
    title: 'Net Kâr',
    summary: 'Dönemin cebe kalan tutarı.',
    source: 'Gelir ve gider kayıtları birlikte.',
    formula: 'Toplam Gelir − Toplam Gider',
    caveat: 'Nakit esaslıdır: tahsil edilmemiş alacak buraya girmez.',
  },
  margin: {
    title: 'Kâr Marjı',
    summary: 'Her 100 ₺ tahsilatın kaç lirasının kâr olarak kaldığı.',
    source: 'Gelir ve gider kayıtları.',
    formula: '(Gelir − Gider) ÷ Gelir × 100',
    caveat: 'Gelir 0 ise 0 gösterilir. Giderin şubesiz (kurum geneli) olanları da hesaba girer.',
  },
  sales: {
    title: 'Satış Tutarı',
    summary: 'Dönemde yapılan paket/hizmet satışlarının toplam bedeli (tahsil edilmiş olsun ya da olmasın).',
    source: S.sale,
    formula: 'Dönemde satılan carilerin toplam tutarı. İptal edilmiş satışlar sayılmaz.',
    caveat: 'Gelirden farklıdır: satış "ne kadar sattım", gelir "ne kadar tahsil ettim" demektir.',
  },
  appointments: {
    title: 'Randevu',
    summary: 'Dönemde takvimde yer alan tüm randevular.',
    source: S.appointment,
    formula: 'Her durumdaki randevu adedi (planlandı, onaylandı, tamamlandı, iptal, gelmedi).',
  },
  completed: {
    title: 'Tamamlanan İşlem',
    summary: 'Fiilen uygulanan seans/işlem adedi.',
    source: S.appointment,
    formula: 'Durumu "Tamamlandı" olan randevu adedi.',
    caveat: 'Paket seansı düşümü de bu randevular üzerinden yapılır.',
  },
  occupancy: {
    title: 'Tamamlanma Oranı',
    summary: 'Alınan randevuların ne kadarının gerçekten yapıldığı.',
    source: S.appointment,
    formula: 'Tamamlanan randevu ÷ Toplam randevu × 100',
    caveat: 'Düşükse iptal ve "gelmedi" oranınız yüksek demektir — Personel sekmesinde kırılımı var.',
  },
  activeCustomers: {
    title: 'Aktif Müşteri',
    summary: 'Dönemde en az bir randevusu olan farklı müşteri sayısı.',
    source: S.appointment,
    formula: 'Dönemdeki randevuların benzersiz müşteri sayısı.',
    caveat: 'Toplam müşteri sayısı değildir; sadece o dönemde salona gelenler.',
  },
  newCustomers: {
    title: 'Yeni Müşteri',
    summary: 'Dönemde sisteme ilk kez kaydedilen müşteriler.',
    source: S.customer,
    formula: 'Kayıt tarihi dönem içinde olan müşteri adedi.',
  },
  avgTicket: {
    title: 'Ortalama Sepet',
    summary: 'Kasaya giren her bir tahsilatın ortalama büyüklüğü.',
    source: S.payment,
    formula: 'Toplam Gelir ÷ Tahsilat adedi',
    caveat:
      'Müşteri başına değil, İŞLEM başına ortalamadır. Aynı müşteri ay içinde 3 kez ödeme yaptıysa 3 işlem sayılır. Müşteri bazlı ortalama için "Müşteri Başına Ciro" kartına bakın.',
  },
  revenuePerCustomer: {
    title: 'Müşteri Başına Ciro',
    summary: 'Salona gelen bir müşterinin ortalama ne kadar para bıraktığı.',
    source: 'Tahsilat kayıtları + randevu kayıtları.',
    formula: 'Toplam Gelir ÷ Aktif Müşteri sayısı',
    caveat: 'Paydada dönemde randevusu olan müşteriler var; hiç gelmeyip taksit ödeyen müşteri paydaya girmez.',
  },

  // Genel Bakış'taki grafik/dağılım kartları
  'overview.paymentMethods': {
    title: 'Ödeme Yöntemi Dağılımı',
    summary: 'Tahsilatın nakit / kart / havale gibi hangi kanaldan geldiği.',
    source: S.payment,
    formula: 'Dönemdeki tahsilatlar ödeme yöntemine göre gruplanır.',
    caveat:
      '"Yöntem Kaydedilmemiş": adisyon tahsilatlarının yöntem kırılımıyla yazılmaya başlandığı sürümden ÖNCEKİ kayıtlar. O kayıtlarda gerçek yöntem hiç saklanmadığı için sonradan üretilemez — yeni tahsilatlar doğru yöntemle düşer.',
  },
  'overview.expenseCategories': {
    title: 'Gider Kalemleri',
    summary: 'Paranın nereye harcandığı.',
    source: S.expense,
    formula: 'Dönemdeki giderler kategoriye göre gruplanır (maaş, kira, fatura, ürün alımı…).',
  },
  'overview.revenueSources': {
    title: 'Ciro Kaynağı',
    summary: 'Cironun hizmetten mi, paketten mi, üründen mi geldiği.',
    source: 'Onaylanmış adisyon kalemleri.',
    formula: 'Borç yazan kalemler (hizmet, ürün, paket satışı, ek kalem) türe göre toplanır.',
    caveat: 'Tahsilat, indirim ve paketten karşılanan kalemler hariçtir — bunlar yeni ciro yaratmaz.',
  },
  'overview.heatmap': {
    title: 'Randevu Yoğunluğu',
    summary: 'Haftanın hangi günü, hangi saatte yoğun olduğunuz.',
    source: S.appointment,
    formula: 'Randevular yerel saate göre gün × saat kutucuklarına dağıtılır; koyu renk = yoğun.',
    caveat: 'Personel çizelgesi ve mesai planlaması için kullanılır.',
  },

  // ====================================================== KARŞILAŞTIRMA =====
  'compare.builder': {
    title: 'Karşılaştırılacak Dönemler',
    summary: 'Serbest seçilmiş 2–5 dönemi yan yana koyar (ör. bu yıl ↔ 5 yıl önce).',
    source: 'Her dönem için Genel Bakış ile AYNI hesaplayıcı çalışır.',
    formula:
      'İlk dönem "temel" kabul edilir; diğer dönemlerin farkı ona göre yüzde olarak gösterilir.',
    caveat:
      'Kova genişliği (gün/hafta/ay) temel dönemden türetilir ve tüm dönemlere uygulanır — yoksa eğriler üst üste binmezdi.',
  },

  // ==================================================== PAKET / HİZMET =====
  'catalog.soldCount': {
    title: 'Satılan Adet',
    summary: 'Dönemde kaç kez satıldığı (katalogda kaç çeşit olduğu değil).',
    source: S.sale,
    formula: 'Aynı paket 5 müşteriye satıldıysa 5 sayılır. İptal edilenler ayrı kartta.',
  },
  'catalog.grossAmount': {
    title: 'Satış Tutarı',
    summary: 'Dönemde satılan paket/hizmetlerin toplam bedeli.',
    source: S.sale,
    formula:
      'Bir satışta birden çok paket varsa satışın toplamı, paketlerin seans ağırlığına göre paylaştırılır.',
  },
  'catalog.collectedAmount': {
    title: 'Tahsil Edilen',
    summary: 'Bu satışlara karşılık bugüne kadar alınan para.',
    source: 'Satış + tahsilat kayıtları.',
    formula: 'Satışın tahsilat oranı, o satışa düşen tutarla çarpılır.',
    caveat: 'Dönem içi değil, bugüne kadarki toplam tahsilattır — "ne kadarı ödendi" sorusunun cevabı.',
  },
  'catalog.remainingAmount': {
    title: 'Kalan Tutar',
    summary: 'Bu satışlardan hâlâ tahsil edilmemiş para.',
    source: 'Satış + tahsilat kayıtları.',
    formula: 'Satış Tutarı − Tahsil Edilen',
  },
  'catalog.sessionsInPeriod': {
    title: 'Yapılan Seans',
    summary: 'Dönem içinde fiilen uygulanan seans adedi.',
    source: S.appointment,
    formula:
      'Dönemde "Tamamlandı" yapılan randevular. Müşterinin o hizmeti içeren paketi varsa seans o pakete yazılır.',
    caveat:
      'Satıştan bağımsızdır: geçen yıl satılmış bir paketin bu ay yapılan seansı bu dönemde görünür.',
  },
  'catalog.sessionsRemaining': {
    title: 'Kalan Seans',
    summary: 'Müşterilerin hakkı olan ama henüz kullanılmamış seanslar.',
    source: S.session,
    formula: 'Toplam seans − Kullanılan seans',
    caveat: 'Gelecekte size iş yükü, müşteriye alacak demektir.',
  },
  'catalog.netRevenue': {
    title: 'Prim Sonrası Net',
    summary: 'Uygulamadan elde edilen cirodan personel priminin düşülmüş hâli — gerçek kârlılık.',
    source: 'Tamamlanan randevular + personelin komisyon oranı.',
    formula: 'Uygulama cirosu − (randevu fiyatı × uygulayan personelin komisyon oranı)',
    caveat: 'Personelin komisyon oranı tanımlı değilse prim 0 kabul edilir.',
  },
  'catalog.cancelledCount': {
    title: 'İptal Edilen',
    summary: 'Satılmış ama sonradan iptal edilmiş satış adedi.',
    source: S.sale,
    formula: 'Dönemde satılıp iptal edilmiş cari adedi.',
    caveat: 'Bu satışlar diğer kartların hiçbirine girmez; ayrı izlenir.',
  },
  'catalog.sellers': {
    title: 'Kim Sattı',
    summary: 'Satışı kimin yaptığı — personel bazlı ciro sıralaması.',
    source: 'Satış kaydındaki "satan personel" alanı.',
    formula:
      'Satışta personel seçilmemişse kaydı OLUŞTURAN kullanıcıya düşülür ("Kurum Yöneticisi (Ad Soyad)").',
    caveat: 'Hiçbiri çözülemezse "Belirtilmemiş" yazar — isim uydurulmaz.',
  },
  'catalog.performers': {
    title: 'Kim Uyguladı',
    summary: 'Seansı fiilen kimin yaptığı.',
    source: 'Tamamlanan randevunun personeli.',
    formula: 'Dönemde tamamlanan randevular uygulayan personele göre gruplanır.',
    caveat: 'Satan ile uygulayan farklı kişiler olabilir; iki kırılım ayrı tutulur.',
  },

  // ========================================================== PERSONEL =====
  'staff.contribution': {
    title: 'Toplam Katkı',
    summary: 'Personelin işletmeye toplam parasal katkısı.',
    source: 'Tamamlanan randevular + satış kayıtları.',
    formula: 'Uygulama Cirosu + Satış Cirosu',
  },
  'staff.serviceRevenue': {
    title: 'Uygulama Cirosu',
    summary: 'Personelin yaptığı işlerin toplam bedeli.',
    source: S.appointment,
    formula: 'Tamamlanan randevuların fiyat toplamı.',
    caveat: 'Paketten karşılanan seanslarda randevunun kendi fiyatı esas alınır.',
  },
  'staff.salesAmount': {
    title: 'Satış Cirosu',
    summary: 'Personelin sattığı paket/hizmetlerin bedeli.',
    source: S.sale,
    formula: 'Satan personel olarak o kişiye düşen satışların toplamı.',
    caveat: 'Yönetici satışları personel karnesine yazılmaz.',
  },
  'staff.commission': {
    title: 'Komisyon',
    summary: 'Personelin dönemde hak ettiği prim.',
    source: S.commission,
    formula: 'Dönemde tahakkuk eden prim kayıtlarının toplamı.',
    caveat: 'Ödenmiş olması gerekmez; "hak edilen" tutardır.',
  },
  'staff.workedMinutes': {
    title: 'Çalışılan Süre',
    summary: 'Personelin fiilen işlem yaptığı toplam süre.',
    source: S.appointment,
    formula: 'Tamamlanan randevuların (bitiş − başlangıç) süreleri toplamı.',
    caveat: 'Mesai süresi değildir; boş geçen saatler dâhil değildir.',
  },
  'staff.rating': {
    title: 'Müşteri Puanı',
    summary: 'Müşterilerin QR ile verdiği yıldız ortalaması.',
    source: 'Randevu değerlendirmeleri.',
    formula: 'Dönemde gönderilen puanların ortalaması (5 üzerinden).',
    caveat: 'Yalnızca müşterinin gerçekten doldurduğu değerlendirmeler sayılır.',
  },

  // ============================================================ ŞUBELER =====
  'branch.income': {
    title: 'Şube Geliri',
    summary: 'Şubeye bağlı müşterilerden yapılan tahsilat.',
    source: S.payment,
    formula: 'Tahsilatın şubesi, bağlı olduğu cari hesabın şubesinden gelir.',
  },
  'branch.expense': {
    title: 'Şube Gideri',
    summary: 'Şubeye yazılmış işletme giderleri.',
    source: S.expense,
    formula: 'Gider kaydındaki şube alanına göre gruplanır.',
    caveat:
      'Şubesi seçilmemiş kurum geneli giderler "Şube atanmamış" satırında toplanır — para kaybolmaz, ama şube kârı olduğundan yüksek görünebilir.',
  },
  'branch.net': {
    title: 'Şube Net Kârı',
    summary: 'Şubenin dönem sonunda cebe koyduğu tutar.',
    source: 'Şube geliri ve gideri.',
    formula: 'Şube Geliri − Şube Gideri',
  },
  'branch.receivable': {
    title: 'Açık Alacak',
    summary: 'Şubenin müşterilerinden tahsil etmeyi beklediği para.',
    source: 'Taksit planları + tahsilatlar.',
    formula: 'Planlanan taksit toplamı − tahsil edilen (iptal taksitler hariç).',
    caveat: 'Dönemden bağımsız ANLIK bakiyedir; dönem filtresi bu kartı etkilemez.',
  },
  'branch.averageTicket': {
    title: 'Ortalama Sepet (Şube)',
    summary: 'Şubede işlem başına ortalama tahsilat.',
    source: S.payment,
    formula: 'Şube geliri ÷ şubedeki tahsilat adedi',
  },
  'branch.scope': {
    title: 'Şube Kapsamı',
    summary: 'Bu sekme üst menüdeki şube seçiminden bağımsız çalışır.',
    source: 'Şube kayıtları.',
    formula: 'Kurum yöneticisi için TÜM şubeler listelenir — aksi hâlde karşılaştırma tek satıra düşerdi.',
    caveat: 'Personel ve şube müdürü yalnız kendi şubesini görür; o durumda sayfada uyarı çıkar.',
  },

  // ========================================================= MÜŞTERİLER =====
  'customer.total': {
    title: 'Toplam Müşteri',
    summary: 'Kurumda kayıtlı tüm müşteriler.',
    source: S.customer,
    formula: 'Silinmemiş müşteri kartlarının adedi.',
    caveat: 'Dönem filtresinden etkilenmez.',
  },
  'customer.returning': {
    title: 'Tekrar Gelen',
    summary: 'Dönem içinde birden fazla kez gelen müşteriler.',
    source: S.appointment,
    formula: 'Dönemde 2 veya daha fazla randevusu olan müşteri adedi.',
  },
  'customer.lost': {
    title: 'Kayıp Müşteri',
    summary: 'Uzun süredir uğramayan müşteriler.',
    source: S.appointment + ' + müşteri kayıt tarihi.',
    formula: 'Dönem sonundan geriye 180 gün içinde hiç randevusu olmayan eski müşteriler.',
    caveat: 'Geri kazanım kampanyası için hedef listedir.',
  },
  'customer.spent': {
    title: 'Dönem Harcaması',
    summary: 'Müşterilerin dönemde ödediği toplam para.',
    source: S.payment,
    formula: 'Dönemdeki tahsilatların toplamı (Genel Bakış\'taki Toplam Gelir ile aynı).',
  },
  'customer.debt': {
    title: 'Açık Borç',
    summary: 'Müşterilerin size olan toplam borcu.',
    source: 'Taksit planları + tahsilatlar.',
    formula: 'Kalan taksit toplamı.',
    caveat: 'Anlık bakiyedir; dönem filtresinden etkilenmez.',
  },
  'customer.retention': {
    title: 'Tekrar Gelme Oranı',
    summary: 'Gelen müşterilerin ne kadarının birden fazla kez geldiği.',
    source: S.appointment,
    formula: 'Tekrar gelen ÷ Aktif müşteri × 100',
  },

  // ======================================================= STOK & ÜRÜN =====
  'inventory.soldAmount': {
    title: 'Ürün Satışı',
    summary: 'Dönemde müşteriye satılan ürünlerin toplam satış bedeli.',
    source: S.stock,
    formula: 'Satış türündeki stok hareketleri × ürünün satış fiyatı.',
  },
  'inventory.soldProfit': {
    title: 'Satış Kârı',
    summary: 'Ürün satışından kalan brüt kâr.',
    source: S.stock,
    formula: 'Satış tutarı − satılan malın maliyeti.',
    caveat: 'Maliyet, hareketteki birim maliyet varsa ondan; yoksa ürün kartındaki maliyetten alınır.',
  },
  'inventory.purchased': {
    title: 'Alım Tutarı',
    summary: 'Dönemde stoğa giren ürünlerin maliyeti.',
    source: S.stock,
    formula: 'Giriş türündeki stok hareketleri × birim maliyet.',
  },
  'inventory.stockValue': {
    title: 'Stok Değeri',
    summary: 'Şu an depoda duran malın maliyet değeri.',
    source: 'Ürün kartlarındaki mevcut stok.',
    formula: 'Mevcut stok × ürün maliyeti (satış fiyatıyla değeri ipucunda gösterilir).',
    caveat: 'Anlık değerdir; dönem filtresinden etkilenmez.',
  },
  'inventory.critical': {
    title: 'Kritik Stok',
    summary: 'Minimum seviyeye düşmüş, sipariş verilmesi gereken ürünler.',
    source: 'Ürün kartları.',
    formula: 'Mevcut stok ≤ minimum seviye olan aktif ürünler.',
  },
  'inventory.used': {
    title: 'Sarf / Fire',
    summary: 'Satılmadan tüketilen veya bozulan ürün miktarı.',
    source: S.stock,
    formula: 'Çıkış (iç kullanım) + fire hareketlerinin miktar toplamı.',
  },

  // ======================================================= HEDİYE ÇEKİ =====
  'gift.issued': {
    title: 'Kesilen Çek',
    summary: 'Dönemde oluşturulan hediye çeki / kupon adedi ve değeri.',
    source: S.gift,
    formula: 'Oluşturma tarihi dönem içinde olan çekler.',
  },
  'gift.redeemed': {
    title: 'Kullanılan',
    summary: 'Çeklerden bugüne kadar harcanan toplam tutar.',
    source: S.gift,
    formula:
      'Yüklü bakiyeli çekte (değer − kalan bakiye); indirim kuponunda (kullanım adedi × değer).',
    caveat: 'Dönemden bağımsız kümülatif tutardır.',
  },
  'gift.outstanding': {
    title: 'Açık Bakiye',
    summary: 'Müşterilerin elinde duran, harcanmayı bekleyen çek bakiyesi.',
    source: S.gift,
    formula: 'Aktif hediye çeklerinin kalan bakiye toplamı.',
    caveat: 'İşletme için gelecekteki bir yükümlülüktür.',
  },
  'gift.expired': {
    title: 'Süresi Dolan',
    summary: 'Geçerlilik tarihi geçmiş, artık kullanılamayan çekler.',
    source: S.gift,
    formula: 'Geçerlilik tarihi bugünden önce olan çek adedi.',
  },
}

/** Metrik anahtarından açıklamayı getirir; tanımlı değilse null (kart tıklanabilir olmaz). */
export function getMetricInfo(key: string | undefined): MetricInfo | null {
  if (!key) return null
  return metricInfo[key] ?? null
}
