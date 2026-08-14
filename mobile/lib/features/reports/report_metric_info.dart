import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import 'report_charts.dart';

/// RAPOR METRİK SÖZLÜĞÜ (mobil) — web'deki `lib/reportMetricInfo.ts` ile birebir aynı içerik.
/// Karta dokununca açılan detay sayfası bu katalogtan beslenir.
class MetricInfo {
  const MetricInfo({
    required this.title,
    required this.summary,
    required this.source,
    required this.formula,
    this.caveat,
  });

  final String title;

  /// Tek cümlede: bu sayı neyi gösteriyor?
  final String summary;

  /// Veri hangi kayıttan geliyor.
  final String source;

  /// Hesaplama kuralı.
  final String formula;

  /// Yanlış okunmaya açık nokta.
  final String? caveat;
}

// Sık tekrar eden kaynak cümleleri.
const _payment =
    'Tahsilat kayıtları (cari hesaplara işlenen ödemeler). Kasa sayfasındaki "gelir" satırlarıyla aynı kaynak.';
const _expense =
    'İşletme giderleri (Ön Muhasebe → Giderler). Maaş, kira, fatura, ürün alımı vb.';
const _sale =
    'Satış kayıtları (cari hesaplar). Dönem, satışın GERÇEK tarihine göre süzülür; geçmiş satış girişinde girilen tarih esas alınır.';
const _appointment =
    'Randevu kayıtları. Dönem, randevunun başlangıç tarihine göre süzülür.';
const _customer = 'Müşteri kartları.';
const _session =
    'Paket/hizmet seans bakiyeleri. Randevu "Tamamlandı" yapılınca ilgili seans düşer.';
const _commission = 'Personel prim tahakkukları (Ön Muhasebe → Prim).';
const _stock = 'Stok hareketleri (giriş, çıkış, satış, fire) ve ürün kartları.';
const _gift = 'Hediye çeki / kupon kayıtları.';

const reportMetricInfo = <String, MetricInfo>{
  // ------------------------------------------------------- GENEL BAKIŞ ---
  'income': MetricInfo(
    title: 'Toplam Gelir',
    summary: 'Dönem içinde kasaya FİİLEN giren para.',
    source: _payment,
    formula: 'Dönemdeki tüm tahsilat kayıtlarının tutar toplamı.',
    caveat:
        'Satış tutarı değildir. 10.000 ₺ paket satıp 2.000 ₺ peşinat aldıysanız gelire 2.000 ₺ yazar; kalan taksitler tahsil edildikçe ilgili aya eklenir.',
  ),
  'expense': MetricInfo(
    title: 'Toplam Gider',
    summary: 'Dönem içinde yapılan işletme harcamaları.',
    source: _expense,
    formula: 'Dönemdeki tüm gider kayıtlarının tutar toplamı.',
  ),
  'openReceivable': MetricInfo(
    title: 'Toplam Alacak',
    summary: 'Dönemde yapılan satışlardan hâlâ tahsil edilmemiş tutar.',
    source: _sale,
    formula:
        'Dönemde satılan carilerin kalan borçları toplamı (satış tutarı − tahsilat + iade).',
    caveat:
        'Taksit planı değil SATIŞ bazlıdır: peşin satışın ödenmeyen kısmı da buraya girer. Dönem süzgeci satışın tarihine bakar.',
  ),
  'sales': MetricInfo(
    title: 'Toplam Satış Tutarı',
    summary:
        'Dönemde yapılan paket/hizmet satışlarının toplam bedeli (tahsil edilmiş olsun ya da olmasın).',
    source: _sale,
    formula:
        'Dönemde satılan carilerin toplam tutarı. İptal edilmiş satışlar sayılmaz.',
    caveat:
        'Gelirden farklıdır: satış "ne kadar sattım", gelir "ne kadar tahsil ettim" demektir.',
  ),
  'appointments': MetricInfo(
    title: 'Randevu Sayısı',
    summary: 'Dönemde takvimde yer alan tüm randevular.',
    source: _appointment,
    formula:
        'Her durumdaki randevu adedi (planlandı, onaylandı, tamamlandı, iptal, gelmedi).',
  ),
  'activeCustomers': MetricInfo(
    title: 'Aktif Müşteri',
    summary: 'Dönemde en az bir randevusu olan farklı müşteri sayısı.',
    source: _appointment,
    formula: 'Dönemdeki randevuların benzersiz müşteri sayısı.',
    caveat: 'Toplam müşteri sayısı değildir; sadece o dönemde salona gelenler.',
  ),
  // Genel Bakış kart setinde YOK ama Müşteriler sekmesindeki "Yeni Müşteri" kartı hâlâ bu
  // anahtarla açılır — girdi silinirse kart detayı boş açılırdı.
  'newCustomers': MetricInfo(
    title: 'Yeni Müşteri',
    summary: 'Dönemde sisteme ilk kez kaydedilen müşteriler.',
    source: _customer,
    formula: 'Kayıt tarihi dönem içinde olan müşteri adedi.',
    caveat:
        '"Eski müşterim" seçilerek geçmiş tarihle eklenen kayıt, girilen KAYIT TARİHİNİN dönemine düşer.',
  ),
  'overview.paymentMethods': MetricInfo(
    title: 'Ödeme Yöntemi Dağılımı',
    summary: 'Tahsilatın nakit / kart / havale gibi hangi kanaldan geldiği.',
    source: _payment,
    formula: 'Dönemdeki tahsilatlar ödeme yöntemine göre gruplanır.',
    caveat:
        '"Yöntem Kaydedilmemiş": adisyon tahsilatlarının yöntem kırılımıyla yazılmaya başlandığı sürümden ÖNCEKİ kayıtlar. O kayıtlarda gerçek yöntem hiç saklanmadığı için sonradan üretilemez.',
  ),
  'overview.expenseCategories': MetricInfo(
    title: 'Gider Kalemleri',
    summary: 'Paranın nereye harcandığı.',
    source: _expense,
    formula: 'Dönemdeki giderler kategoriye göre gruplanır.',
  ),
  'overview.revenueSources': MetricInfo(
    title: 'Ciro Kaynağı',
    summary: 'Cironun hizmetten mi, paketten mi, üründen mi geldiği.',
    source: 'Onaylanmış adisyon kalemleri.',
    formula:
        'Borç yazan kalemler (hizmet, ürün, paket satışı, ek kalem) türe göre toplanır.',
    caveat: 'Tahsilat, indirim ve paketten karşılanan kalemler hariçtir.',
  ),

  // ------------------------------------------------------ KARŞILAŞTIRMA ---
  'compare.builder': MetricInfo(
    title: 'Karşılaştırılacak Dönemler',
    summary:
        'Serbest seçilmiş 2–5 dönemi yan yana koyar (ör. bu yıl ↔ 5 yıl önce).',
    source: 'Her dönem için Genel Bakış ile AYNI hesaplayıcı çalışır.',
    formula:
        'İlk dönem "temel" kabul edilir; diğerlerinin farkı ona göre gösterilir.',
    caveat:
        'Kova genişliği temel dönemden türetilir ve tüm dönemlere uygulanır.',
  ),

  // ---------------------------------------------------- PAKET / HİZMET ---
  'catalog.soldCount': MetricInfo(
    title: 'Satılan Adet',
    summary: 'Dönemde kaç kez satıldığı (katalogda kaç çeşit olduğu değil).',
    source: _sale,
    formula: 'Aynı paket 5 müşteriye satıldıysa 5 sayılır.',
  ),
  'catalog.grossAmount': MetricInfo(
    title: 'Satış Tutarı',
    summary: 'Dönemde satılan paket/hizmetlerin toplam bedeli.',
    source: _sale,
    formula:
        'Bir satışta birden çok paket varsa toplam, seans ağırlığına göre paylaştırılır.',
  ),
  'catalog.collectedAmount': MetricInfo(
    title: 'Tahsil Edilen',
    summary: 'Bu satışlara karşılık bugüne kadar alınan para.',
    source: 'Satış + tahsilat kayıtları.',
    formula: 'Satışın tahsilat oranı, o satışa düşen tutarla çarpılır.',
    caveat: 'Dönem içi değil, bugüne kadarki toplam tahsilattır.',
  ),
  'catalog.remainingAmount': MetricInfo(
    title: 'Kalan Tutar',
    summary: 'Bu satışlardan hâlâ tahsil edilmemiş para.',
    source: 'Satış + tahsilat kayıtları.',
    formula: 'Satış Tutarı − Tahsil Edilen',
  ),
  'catalog.sessionsInPeriod': MetricInfo(
    title: 'Yapılan Seans',
    summary: 'Dönem içinde fiilen uygulanan seans adedi.',
    source: _appointment,
    formula:
        'Dönemde "Tamamlandı" yapılan randevular ilgili pakete/hizmete yazılır.',
    caveat:
        'Satıştan bağımsızdır: geçen yıl satılmış paketin bu ayki seansı burada görünür.',
  ),
  'catalog.sessionsRemaining': MetricInfo(
    title: 'Kalan Seans',
    summary: 'Müşterilerin hakkı olan ama henüz kullanılmamış seanslar.',
    source: _session,
    formula: 'Toplam seans − Kullanılan seans',
    caveat: 'Gelecekte size iş yükü, müşteriye alacak demektir.',
  ),
  'catalog.netRevenue': MetricInfo(
    title: 'Prim Sonrası Net',
    summary:
        'Uygulama cirosundan personel priminin düşülmüş hâli — gerçek kârlılık.',
    source: 'Tamamlanan randevular + personelin komisyon oranı.',
    formula:
        'Uygulama cirosu − (randevu fiyatı × uygulayan personelin komisyon oranı)',
    caveat: 'Komisyon oranı tanımlı değilse prim 0 kabul edilir.',
  ),
  'catalog.cancelledCount': MetricInfo(
    title: 'İptal Edilen',
    summary: 'Satılmış ama sonradan iptal edilmiş satış adedi.',
    source: _sale,
    formula: 'Dönemde satılıp iptal edilmiş cari adedi.',
    caveat: 'Bu satışlar diğer kartların hiçbirine girmez.',
  ),
  'catalog.sellers': MetricInfo(
    title: 'Kim Sattı',
    summary: 'Satışı kimin yaptığı — personel bazlı ciro sıralaması.',
    source: 'Satış kaydındaki "satan personel" alanı.',
    formula: 'Personel seçilmemişse kaydı OLUŞTURAN kullanıcıya düşülür.',
    caveat: 'Çözülemezse "Belirtilmemiş" yazar — isim uydurulmaz.',
  ),
  'catalog.performers': MetricInfo(
    title: 'Kim Uyguladı',
    summary: 'Seansı fiilen kimin yaptığı.',
    source: 'Tamamlanan randevunun personeli.',
    formula:
        'Dönemde tamamlanan randevular uygulayan personele göre gruplanır.',
    caveat: 'Satan ile uygulayan farklı kişiler olabilir.',
  ),

  // -------------------------------------------------------------- PERSONEL ---
  'staff.contribution': MetricInfo(
    title: 'Toplam Katkı',
    summary: 'Personelin işletmeye toplam parasal katkısı.',
    source: 'Tamamlanan randevular + satış kayıtları.',
    formula: 'Uygulama Cirosu + Satış Cirosu',
  ),
  'staff.serviceRevenue': MetricInfo(
    title: 'Uygulama Cirosu',
    summary: 'Personelin yaptığı işlerin toplam bedeli.',
    source: _appointment,
    formula: 'Tamamlanan randevuların fiyat toplamı.',
  ),
  'staff.salesAmount': MetricInfo(
    title: 'Satış Cirosu',
    summary: 'Personelin sattığı paket/hizmetlerin bedeli.',
    source: _sale,
    formula: 'Satan personel olarak o kişiye düşen satışların toplamı.',
    caveat: 'Yönetici satışları personel karnesine yazılmaz.',
  ),
  'staff.commission': MetricInfo(
    title: 'Komisyon',
    summary: 'Personelin dönemde hak ettiği prim.',
    source: _commission,
    formula: 'Dönemde tahakkuk eden prim kayıtlarının toplamı.',
    caveat: 'Ödenmiş olması gerekmez; "hak edilen" tutardır.',
  ),
  'staff.appointments': MetricInfo(
    title: 'Randevu Sayısı',
    summary: 'Seçili kapsamdaki personelin dönemdeki toplam randevusu.',
    source: _appointment,
    formula:
        'Her durumdaki randevu adedi (planlandı, onaylandı, tamamlandı, iptal, gelmedi).',
    caveat:
        'Kaçının uygulandığı karnedeki "Randevu" sütununda (tamamlanan/toplam) yazar.',
  ),
  'staff.workedMinutes': MetricInfo(
    title: 'Çalışılan Süre',
    summary: 'Personelin fiilen işlem yaptığı toplam süre.',
    source: _appointment,
    formula: 'Tamamlanan randevuların süreleri toplamı.',
    caveat: 'Mesai süresi değildir; boş saatler dâhil değildir.',
  ),
  'staff.rating': MetricInfo(
    title: 'Müşteri Puanı',
    summary: 'Müşterilerin QR ile verdiği yıldız ortalaması.',
    source: 'Randevu değerlendirmeleri.',
    formula: 'Dönemde gönderilen puanların ortalaması (5 üzerinden).',
  ),

  // --------------------------------------------------------------- ŞUBELER ---
  'branch.income': MetricInfo(
    title: 'Şube Geliri',
    summary: 'Şubeye bağlı müşterilerden yapılan tahsilat.',
    source: _payment,
    formula: 'Tahsilatın şubesi, bağlı olduğu cari hesabın şubesinden gelir.',
  ),
  'branch.expense': MetricInfo(
    title: 'Şube Gideri',
    summary: 'Şubeye yazılmış işletme giderleri.',
    source: _expense,
    formula: 'Gider kaydındaki şube alanına göre gruplanır.',
    caveat:
        'Şubesi seçilmemiş kurum geneli giderler "Şube atanmamış" satırında toplanır — şube kârı olduğundan yüksek görünebilir.',
  ),
  'branch.customers': MetricInfo(
    title: 'Aktif Müşteri',
    summary:
        'Şubede dönem içinde en az bir randevusu olan farklı müşteri sayısı.',
    source: _appointment,
    formula: 'Şubedeki randevuların benzersiz müşteri sayısı.',
    caveat: 'Kayıtlı müşteri sayısı değildir; yalnız o dönemde gelenler sayılır.',
  ),
  'branch.receivable': MetricInfo(
    title: 'Toplam Alacak',
    summary: 'Şubenin müşterilerinden tahsil etmeyi beklediği para.',
    source: 'Taksit planları + tahsilatlar.',
    formula: 'Planlanan taksit toplamı − tahsil edilen.',
    caveat: 'Dönemden bağımsız ANLIK bakiyedir.',
  ),
  'branch.scope': MetricInfo(
    title: 'Şube Kapsamı',
    summary: 'Bu sekme üst menüdeki şube seçiminden bağımsız çalışır.',
    source: 'Şube kayıtları.',
    formula: 'Kurum yöneticisi için TÜM şubeler listelenir.',
    caveat: 'Personel ve şube müdürü yalnız kendi şubesini görür.',
  ),

  // ------------------------------------------------------------ MÜŞTERİLER ---
  'customer.total': MetricInfo(
    title: 'Toplam Müşteri',
    summary: 'Kurumda kayıtlı tüm müşteriler.',
    source: _customer,
    formula: 'Silinmemiş müşteri kartlarının adedi.',
    caveat: 'Dönem filtresinden etkilenmez.',
  ),
  'customer.returning': MetricInfo(
    title: 'Tekrar Gelen',
    summary: 'Dönem içinde birden fazla kez gelen müşteriler.',
    source: _appointment,
    formula: 'Dönemde 2+ randevusu olan müşteri adedi.',
  ),
  'customer.lost': MetricInfo(
    title: 'Kayıp Müşteri',
    summary: 'Uzun süredir uğramayan müşteriler.',
    source: 'Randevu kayıtları + müşteri kayıt tarihi.',
    formula:
        'Dönem sonundan geriye 180 gün içinde hiç randevusu olmayan eski müşteriler.',
    caveat: 'Geri kazanım kampanyası için hedef listedir.',
  ),
  'customer.spent': MetricInfo(
    title: 'Dönem Harcaması',
    summary: 'Müşterilerin dönemde ödediği toplam para.',
    source: _payment,
    formula: 'Dönemdeki tahsilatların toplamı.',
  ),
  'customer.debt': MetricInfo(
    title: 'Açık Borç',
    summary: 'Müşterilerin size olan toplam borcu.',
    source: 'Taksit planları + tahsilatlar.',
    formula: 'Kalan taksit toplamı.',
    caveat: 'Anlık bakiyedir; dönem filtresinden etkilenmez.',
  ),
  'customer.retention': MetricInfo(
    title: 'Tekrar Gelme Oranı',
    summary: 'Gelen müşterilerin ne kadarının birden fazla kez geldiği.',
    source: _appointment,
    formula: 'Tekrar gelen ÷ Aktif müşteri × 100',
  ),

  // ----------------------------------------------------------- STOK & ÜRÜN ---
  'inventory.soldAmount': MetricInfo(
    title: 'Ürün Satışı',
    summary: 'Dönemde müşteriye satılan ürünlerin toplam satış bedeli.',
    source: _stock,
    formula: 'Satış türündeki stok hareketleri × ürünün satış fiyatı.',
  ),
  'inventory.soldProfit': MetricInfo(
    title: 'Satış Kârı',
    summary: 'Ürün satışından kalan brüt kâr.',
    source: _stock,
    formula: 'Satış tutarı − satılan malın maliyeti.',
  ),
  'inventory.purchased': MetricInfo(
    title: 'Alım Tutarı',
    summary: 'Dönemde stoğa giren ürünlerin maliyeti.',
    source: _stock,
    formula: 'Giriş türündeki stok hareketleri × birim maliyet.',
  ),
  'inventory.stockValue': MetricInfo(
    title: 'Stok Değeri',
    summary: 'Şu an depoda duran malın maliyet değeri.',
    source: 'Ürün kartlarındaki mevcut stok.',
    formula: 'Mevcut stok × ürün maliyeti.',
    caveat: 'Anlık değerdir; dönem filtresinden etkilenmez.',
  ),
  'inventory.critical': MetricInfo(
    title: 'Kritik Stok',
    summary: 'Minimum seviyeye düşmüş, sipariş verilmesi gereken ürünler.',
    source: 'Ürün kartları.',
    formula: 'Mevcut stok ≤ minimum seviye olan aktif ürünler.',
  ),
  'inventory.used': MetricInfo(
    title: 'Sarf / Fire',
    summary: 'Satılmadan tüketilen veya bozulan ürün miktarı.',
    source: _stock,
    formula: 'Çıkış (iç kullanım) + fire hareketlerinin miktar toplamı.',
  ),

  // ----------------------------------------------------------- HEDİYE ÇEKİ ---
  'gift.issued': MetricInfo(
    title: 'Kesilen Çek',
    summary: 'Dönemde oluşturulan hediye çeki / kupon adedi ve değeri.',
    source: _gift,
    formula: 'Oluşturma tarihi dönem içinde olan çekler.',
  ),
  'gift.redeemed': MetricInfo(
    title: 'Kullanılan',
    summary: 'Çeklerden bugüne kadar harcanan toplam tutar.',
    source: _gift,
    formula:
        'Yüklü bakiyeli çekte (değer − kalan); indirim kuponunda (kullanım × değer).',
    caveat: 'Dönemden bağımsız kümülatif tutardır.',
  ),
  'gift.outstanding': MetricInfo(
    title: 'Açık Bakiye',
    summary: 'Müşterilerin elinde duran, harcanmayı bekleyen çek bakiyesi.',
    source: _gift,
    formula: 'Aktif hediye çeklerinin kalan bakiye toplamı.',
    caveat: 'İşletme için gelecekteki bir yükümlülüktür.',
  ),
  'gift.expired': MetricInfo(
    title: 'Süresi Dolan',
    summary: 'Geçerlilik tarihi geçmiş, artık kullanılamayan çekler.',
    source: _gift,
    formula: 'Geçerlilik tarihi bugünden önce olan çek adedi.',
  ),
};

/// Karta dokununca açılan detay sayfası (alttan yükselen sayfa).
///
/// Web'deki `MetricDetailModal` ile aynı bölümleri taşır: değer + kıyas farkı,
/// "bu veri nedir / nereden geliyor / nasıl hesaplanıyor / dikkat" ve varsa kırılım.
Future<void> showMetricDetail(
  BuildContext context, {
  required String metricKey,
  String? valueText,
  double? value,
  double? previous,
  String? compareLabel,
  String? rangeLabel,
  String? hint,
  bool invert = false,
  List<({String label, String value, String? hint})> breakdown = const [],
}) async {
  final info = reportMetricInfo[metricKey];
  if (info == null) return;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => DraggableScrollableSheet(
      initialChildSize: .78,
      minChildSize: .45,
      maxChildSize: .95,
      expand: false,
      builder: (_, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 10, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          info.title,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                        if (rangeLabel != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              rangeLabel,
                              style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.muted,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(
                      Icons.close_rounded,
                      color: AppColors.muted,
                    ),
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
                children: [
                  if (valueText != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    valueText,
                                    style: const TextStyle(
                                      fontSize: 26,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.ink,
                                      letterSpacing: -.8,
                                    ),
                                  ),
                                ),
                              ),
                              if (value != null &&
                                  previous != null &&
                                  compareLabel != null)
                                DeltaChip(
                                  current: value,
                                  previous: previous,
                                  invert: invert,
                                ),
                            ],
                          ),
                          if (hint != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                hint,
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: AppColors.muted,
                                ),
                              ),
                            ),
                          if (compareLabel != null && previous != null) ...[
                            const Divider(height: 16, color: AppColors.border),
                            Text(
                              '$compareLabel döneminde: ${reportMoney(previous)}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.ink,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  _block(
                    Icons.menu_book_rounded,
                    'Bu veri nedir?',
                    info.summary,
                  ),
                  _block(
                    Icons.storage_rounded,
                    'Nereden geliyor?',
                    info.source,
                  ),
                  _block(
                    Icons.calculate_rounded,
                    'Nasıl hesaplanıyor?',
                    info.formula,
                  ),
                  if (info.caveat != null)
                    _block(
                      Icons.warning_amber_rounded,
                      'Dikkat',
                      info.caveat!,
                      warn: true,
                    ),
                  if (breakdown.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    const Text(
                      'KIRILIM',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: .8,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        children: [
                          for (var i = 0; i < breakdown.length; i++)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 9,
                              ),
                              decoration: BoxDecoration(
                                border: i == 0
                                    ? null
                                    : const Border(
                                        top: BorderSide(
                                          color: AppColors.border,
                                          width: .6,
                                        ),
                                      ),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          breakdown[i].label,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 12.5,
                                            fontWeight: FontWeight.w600,
                                            color: AppColors.ink,
                                          ),
                                        ),
                                        if (breakdown[i].hint != null)
                                          Text(
                                            breakdown[i].hint!,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 10.5,
                                              color: AppColors.muted,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    breakdown[i].value,
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.ink,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _block(IconData icon, String title, String text, {bool warn = false}) {
  final accent = warn ? AppColors.warning : AppColors.primaryDark;
  return Container(
    width: double.infinity,
    margin: const EdgeInsets.only(top: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: warn
          ? AppColors.warning.withValues(alpha: .08)
          : AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(
        color: warn
            ? AppColors.warning.withValues(alpha: .3)
            : AppColors.border,
      ),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 15, color: accent),
            const SizedBox(width: 6),
            Text(
              title.toUpperCase(),
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: .7,
                color: accent,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          text,
          style: TextStyle(
            fontSize: 12.5,
            height: 1.5,
            color: warn ? const Color(0xFF7A5A20) : AppColors.ink,
          ),
        ),
      ],
    ),
  );
}
