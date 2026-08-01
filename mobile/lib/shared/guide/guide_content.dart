import 'package:flutter/material.dart';

import 'page_guide.dart';

/// Sayfa kılavuzu içerikleri — web `lib/guideContent.ts` ile aynı dilde, mobil ekranlara
/// uyarlanmış hâli. Yeni bir ekrana kılavuz eklemek için buraya bir kayıt açıp ekranda
/// `showPageGuide(...)` çağırmak yeterlidir.
class GuideContent {
  /// Ekran anahtarı → kılavuz. Anahtar "görüldü" kaydında da kullanılır.
  static const Map<String, PageGuideContent> _guides = {
    'home': PageGuideContent(
      title: 'Panel — Genel Bakış',
      intro:
          'Salonunuzun günlük nabzını tek ekranda tutar: randevular, gelir, paket/hizmet raporları ve hızlı işlemler burada.',
      steps: [
        GuideStep(
          icon: Icons.bolt_rounded,
          title: 'Hızlı işlemler',
          desc:
              'En sık kullanılan işlemleri tek dokunuşla başlatır: yeni randevu, müşteri ekleme, paket ve ürün satışı, ödeme alma, stok, Excel içeri aktarma ve kampanya. İlgili sayfaya gitmenize gerek kalmaz.',
        ),
        GuideStep(
          icon: Icons.query_stats_rounded,
          title: 'Dönem seçici',
          desc:
              'Kartların üstündeki gün/hafta/ay seçimi tüm sayaçları ve grafikleri birlikte değiştirir. Böylece "bu ay ne oldu" sorusunu tek yerden yanıtlarsınız.',
        ),
        GuideStep(
          icon: Icons.workspaces_rounded,
          title: 'Paket ve Hizmet Raporu',
          desc:
              'İki ayrı bloktur: Paket Raporu yalnızca PAKET satışlarını, Hizmet Raporu tekil hizmet satışlarını sayar. Bir hizmet satışı paket sayacını artırmaz.',
        ),
        GuideStep(
          icon: Icons.groups_2_rounded,
          title: 'Takip edilecek danışanlar',
          desc:
              'Uzun süredir gelmeyen, doğum günü olan, KVKK onaysız ve kara listedeki müşterileri özetler. "Gelmeyen" satırına dokunarak isim listesini görebilir ve pasiflik gün eşiğini değiştirebilirsiniz.',
        ),
      ],
    ),
    'appointments': PageGuideContent(
      title: 'Randevular',
      intro:
          'Günlük, haftalık ve aylık takvim; randevu oluşturma, işleme alma ve tamamlama akışı bu ekranda.',
      steps: [
        GuideStep(
          icon: Icons.calendar_month_rounded,
          title: 'Takvim görünümleri',
          desc:
              'Gün görünümü personel sütunlarıyla saatlik çizelgeyi, hafta ve ay görünümü genel doluluğu gösterir. Boş bir saate dokunarak doğrudan randevu oluşturabilirsiniz.',
        ),
        GuideStep(
          icon: Icons.auto_awesome_rounded,
          title: 'Randevu akışı',
          desc:
              'Planlandı → Şu an işlemde → Tamamlandı. "Tamamlandı" seansı paketten düşer, bekleyen satış varsa cariye işler ve müşteriye puanlama linki üretir.',
        ),
        GuideStep(
          icon: Icons.chat_rounded,
          title: 'WhatsApp hatırlatma',
          desc:
              'Randevu detayındaki "Hatırlat" düğmesi müşteriye WhatsApp mesajı gönderir. Müşterinin yanıtı (onayladı / iptal etti / erteleme istedi) aynı kartta rozet olarak görünür.',
        ),
        GuideStep(
          icon: Icons.delete_outline_rounded,
          title: 'İptal ile silme farkı',
          desc:
              'İptal, randevuyu durumu "İptal" olarak listede bırakır — geçmiş kaybolmaz. Silme ise kaydı tamamen kaldırır ve geri alınamaz.',
        ),
      ],
    ),
    'customers': PageGuideContent(
      title: 'Müşteriler',
      intro:
          'Müşteri kartları, iletişim bilgileri, KVKK durumu ve müşteriye ait tüm geçmiş bu ekrandan yönetilir.',
      steps: [
        GuideStep(
          icon: Icons.search_rounded,
          title: 'Arama sunucuda çalışır',
          desc:
              'Binlerce kayıtta liste tümüyle indirilmez; yazdığınız terim sunucuya gönderilir. Bu yüzden arama hem hızlıdır hem de tüm kayıtları kapsar.',
        ),
        GuideStep(
          icon: Icons.insights_rounded,
          title: 'Müşteri özeti',
          desc:
              'Listenin üstündeki özet kurum geneli sayaçları verir: en yaygın yaş aralığı, ortalama harcama, bu ay eklenen müşteri ve borçlu oranı. Ortalama harcamanın dönemini kart üzerinden seçebilirsiniz (tüm zamanlar, son 30/90 gün, son 1 yıl); ölçüt tahsilat tarihidir. Başlığa dokunarak özeti katlayabilirsiniz.',
        ),
        GuideStep(
          icon: Icons.badge_rounded,
          title: 'Müşteri kartı sekmeleri',
          desc:
              'Genel bakış, randevular, adisyon/işlemler, sağlık ve notlar. Hızlı işlemlerden randevu oluşturma, tahsilat alma ve ürün satışı doğrudan yapılabilir.',
        ),
        GuideStep(
          icon: Icons.history_edu_rounded,
          title: 'İşlem defteri',
          desc:
              'Satış, tahsilat, paket kullanımı, indirim ve tamamlanmış seanslar tek kronolojik akışta görünür. Gün/hafta/ay süzgeci ile dönem toplamlarını okuyabilirsiniz.',
        ),
        GuideStep(
          icon: Icons.ios_share_rounded,
          title: 'Dışa aktarma',
          desc:
              'Sağ üstteki paylaş düğmesi, ekranda görünen (filtrelenmiş) listeyi Excel veya PDF olarak dışarı verir.',
        ),
      ],
    ),
    'accounting': PageGuideContent(
      title: 'Ön Muhasebe',
      intro:
          'Adisyonlar, cari hesaplar, taksitler, tahsilatlar ve giderler bu ekranda toplanır.',
      steps: [
        GuideStep(
          icon: Icons.receipt_long_rounded,
          title: 'Adisyon = ara katman',
          desc:
              'İşlemler önce adisyona yazılır, cariye ve kasaya ANINDA düşmez. Yönetici adisyonu onaylayınca tutar cariye borç, tahsilat kasaya gelir olarak işlenir.',
        ),
        GuideStep(
          icon: Icons.account_balance_wallet_rounded,
          title: 'Cari ve taksitler',
          desc:
              'Taksit planı sabittir; tahsilatlar vade sırasıyla taksitlere dağıtılır. Kısmi ödeme ilgili taksiti kısmen kapatır, fazla ödeme bir sonrakine geçer.',
        ),
        GuideStep(
          icon: Icons.block_rounded,
          title: 'İptal ve iade',
          desc:
              'Satış iptalinde kayıt canlı listelerden çıkar ve arşive taşınır (geri alınabilir). Müşteriye para iade ettiyseniz iptal ekranında tutarı girin — iade gerçek bir kasa çıkışı olarak raporlanır.',
        ),
        GuideStep(
          icon: Icons.check_circle_rounded,
          title: 'Gider onayı',
          desc:
              'Personelin girdiği gider "Onay bekliyor" olarak durur ve raporlara girmez. Kartındaki Onayla düğmesiyle yöneticinin onaylaması gerekir.',
        ),
      ],
    ),
    'stock': PageGuideContent(
      title: 'Stok',
      intro: 'Ürünler, stok hareketleri, kritik seviye uyarıları ve barkod okuma.',
      steps: [
        GuideStep(
          icon: Icons.qr_code_scanner_rounded,
          title: 'Barkod ile hızlı işlem',
          desc:
              'Ürün eklerken veya ararken barkod okuyucuyu kullanabilirsiniz; kamera ile okutulan kod alana otomatik yazılır.',
        ),
        GuideStep(
          icon: Icons.trending_down_rounded,
          title: 'Kritik stok',
          desc:
              'Minimum stok seviyesinin altına düşen ürünler panoda uyarı olarak listelenir. Satış yapıldığında stok otomatik düşer, satış iptal edilirse geri eklenir.',
        ),
        GuideStep(
          icon: Icons.shopping_bag_rounded,
          title: 'Ürün satışı',
          desc:
              'Ürün satışı randevuya bağlı değildir: kaydedildiği anda cariye işlenir ve stoktan düşer. Geçmişe dönük satış için satış tarihini değiştirebilirsiniz.',
        ),
      ],
    ),
    'notifications': PageGuideContent(
      title: 'Bildirimler',
      intro: 'SMS, WhatsApp ve e-posta şablonları; otomatik gönderim ve gönderim kayıtları.',
      steps: [
        GuideStep(
          icon: Icons.insights_rounded,
          title: 'Özet sayaçları',
          desc:
              'Aktif şablon, bugün gönderilen, kuyrukta bekleyen ve başarısız mesaj sayısını gösterir. Başarısız varsa tekrar göndermek gerekir.',
        ),
        GuideStep(
          icon: Icons.bolt_rounded,
          title: 'Otomatik gönderim',
          desc:
              'Bir tetikleyiciye (randevu hatırlatma, doğum günü, ödeme) AKTİF şablon eklerseniz sistem arka planda otomatik gönderir. Kartlar hangi otomasyonun açık olduğunu gösterir.',
        ),
        GuideStep(
          icon: Icons.auto_awesome_rounded,
          title: 'Hazır şablonlar',
          desc:
              'Doğum günü, geri kazanım, paket yenileme gibi hazır metinleri tek dokunuşla ekleyip düzenleyebilirsiniz.',
        ),
      ],
    ),
  };

  static PageGuideContent? forKey(String key) => _guides[key];
}
