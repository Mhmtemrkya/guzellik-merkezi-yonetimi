/// Ödeme yöntemi kodunu Türkçe etikete çeviren TEK nokta.
///
/// Veritabanında tek bir yazım yok: web tahsilat modalleri `cash/card/transfer`, mobil taksit
/// sayfası `Cash/Card/BankTransfer`, gider kayıtları enum adı (`BankTransfer`), eski kayıtlarda
/// Türkçe serbest metin (`Nakit`, `Havale/EFT`) yazar. Bu yüzden eşleme TAM EŞİTLİK değil
/// PARÇA ARAMA yapar: ekranlardaki tam eşleşmeli tablolar (`{'Cash': 'Nakit'}`) web'in yazdığı
/// küçük harfli kodu tanımıyor ve kullanıcıya ham "cash" yazısını gösteriyordu.
///
/// Web `paymentMethodLabel` (lib/apiMappers.ts) ve backend `ReportsService.MethodLabel` ile
/// AYNI kuralı uygular — aynı kayıt üç ekranda üç farklı adla görünmesin.
library;

/// Yöntemi hiç yazılmamış kayıtlar. "Diğer" bir yöntem varmış izlenimi verirdi; burada
/// uydurma yapılmaz (yöntem kırılımı gelmeden önceki adisyon tahsilatları bu gruba düşer).
const _unrecorded = 'Yöntem Kaydedilmemiş';

String paymentMethodLabel(String? raw) {
  final text = (raw ?? '').trim();
  final m = text.toLowerCase();
  if (m.contains('cash') || m.contains('nakit')) return 'Nakit';
  if (m.contains('card') || m.contains('kart')) return 'Kart';
  if (m.contains('transfer') ||
      m.contains('havale') ||
      m.contains('eft') ||
      m.contains('bank')) {
    return 'Havale / EFT';
  }
  if (m.contains('check') || m.contains('çek')) return 'Çek';
  // "Adisyon" bir ödeme yöntemi DEĞİL: o kayıtlarda gerçek yöntem hiç saklanmamış. `unknown`,
  // backend'in bu kayıtlar için ürettiği anahtar — çevirici kendi çıktısını geri yediğinde
  // ekrana "Unknown" yazmasın.
  if (m.isEmpty || m == 'unknown' || m == 'adisyon' || m == 'adisyon tahsilatı') {
    return _unrecorded;
  }
  if (m == 'other' || m == 'diğer') return 'Diğer';
  // SIRA BACKEND'LE AYNI (ReportsService.NormalizeMethod): "giftcard" içinde "card" geçtiği için
  // yukarıdaki Kart dalına düşer. Bugün hediye çeki tahsilat DEĞİL indirim kalemi olarak
  // yazılıyor, yani bu dize üretilmiyor; sırayı burada değiştirmek raporla ayrışma demek olurdu.
  if (m.contains('hediye') || m.contains('gift')) return 'Hediye Çeki';
  if (m.contains('puan') || m.contains('sadakat') || m.contains('loyalty')) {
    return 'Sadakat Puanı';
  }
  // Serbest metin yöntem adı: uydurulmaz, yalnız okunur hâle getirilir.
  return text[0].toUpperCase() + text.substring(1);
}
