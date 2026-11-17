/// BİLDİRİM MESAJI ORTAK KİTİ — web `components/dashboard/notifications/messageKit.ts` ile
/// BİREBİR aynı kurallar (parça sayımı, değişkenler, hazır metinler).
///
/// SMS PARÇA KURALI arka uçla (SmsSegments.cs) aynıdır: Türkçe karakter bozulmasın diye SMS
/// Unicode gider → 70 karaktere kadar 1 parça, daha uzunu 67'lik parçalar. Dart `String.length`
/// .NET/JS gibi UTF-16 birim sayar; emoji 2 birim tutar (telde de 2 yer kaplar).
library;

const int smsSinglePart = 70;
const int smsMultiPart = 67;

int smsParts(String text) {
  if (text.isEmpty) return 0;
  final len = text.length;
  return len <= smsSinglePart ? 1 : (len + smsMultiPart - 1) ~/ smsMultiPart;
}

/// Metinde emoji var mı? (SMS'te 2 karakter sayılır, bazı telefonlarda kutucuk görünür.)
bool hasEmoji(String text) =>
    RegExp(r'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]', unicode: true).hasMatch(text);

class TemplateVariable {
  const TemplateVariable(this.key, this.label, this.hint, {this.onlyFor});
  final String key;
  final String label;
  final String hint;
  final List<String>? onlyFor;
}

/// Arka uçtaki RenderContext'in doldurduğu değişkenler ({{anahtar}}).
const templateVariables = <TemplateVariable>[
  TemplateVariable('ad', 'Müşteri adı', 'Müşterinin adı soyadı'),
  TemplateVariable('tarih', 'Tarih', 'Randevu hatırlatmasında randevunun tarihi'),
  TemplateVariable('saat', 'Saat', 'Randevu hatırlatmasında randevunun saati'),
  TemplateVariable('hizmet', 'Hizmet', 'Yaklaşan randevunun hizmeti', onlyFor: ['AppointmentReminder']),
  TemplateVariable('salon', 'Salon adı', 'Müşterinin şubesi (yoksa kurum adı)'),
  TemplateVariable('telefon', 'Telefon', 'Müşterinin telefonu'),
];

List<TemplateVariable> variablesFor(String trigger) =>
    templateVariables.where((v) => v.onlyFor == null || v.onlyFor!.contains(trigger)).toList();

/// Önizleme için örnek doldurma — gerçek gönderimde değerler müşteriye göre sunucuda dolar.
String renderSample(String body, String salonName) {
  final t = DateTime.now().add(const Duration(days: 1));
  final sample = <String, String>{
    'ad': 'Ayşe Yılmaz',
    'isim': 'Ayşe Yılmaz',
    'tarih': '${t.day.toString().padLeft(2, '0')}.${t.month.toString().padLeft(2, '0')}.${t.year}',
    'saat': '14:00',
    'hizmet': 'Lazer Epilasyon',
    'salon': salonName.isEmpty ? 'Salonunuz' : salonName,
    'telefon': '0555 123 45 67',
  };
  return body.replaceAllMapped(RegExp(r'\{\{\s*(\w+)\s*\}\}'), (m) => sample[m.group(1)!.toLowerCase()] ?? '');
}

class TriggerOption {
  const TriggerOption(this.key, this.title, this.desc, {required this.automatic});
  final String key;
  final String title;
  final String desc;
  final bool automatic;
}

/// "Ne zaman gönderilsin?" — kullanıcıya teknik tetikleyici adı gösterilmez.
const triggerOptions = <TriggerOption>[
  TriggerOption('Manual', 'Duyuru / kampanya', 'Siz gönderirsiniz: tüm müşterilere ya da seçtiklerinize.', automatic: false),
  TriggerOption('AppointmentReminder', 'Randevu hatırlatma', 'Randevudan 24 saat önce otomatik.', automatic: true),
  TriggerOption('BirthdayGreeting', 'Doğum günü', 'Doğum gününde otomatik (yılda 1).', automatic: true),
  TriggerOption('PaymentDue', 'Ödeme hatırlatma', 'Vadesi gelen taksiti olana (günde en çok 1).', automatic: true),
  TriggerOption('WinBack', 'Sizi özledik', 'Uzun süredir gelmeyene (ayda en çok 1).', automatic: true),
  TriggerOption('SessionRenewal', 'Paket yenileme', 'Paketi bitmek üzere olana (ayda en çok 1).', automatic: true),
];

String triggerTitle(String key) =>
    triggerOptions.firstWhere((t) => t.key == key, orElse: () => const TriggerOption('Campaign', 'Kampanya', '', automatic: false)).title;

bool isAutomatic(String key) => triggerOptions.any((t) => t.key == key && t.automatic);

/// Tetikleyici başına hazır metinler — KISA ve EMOJİSİZ (SMS parça başına ücretlenir).
const suggestedTexts = <String, List<String>>{
  'Manual': [
    'Merhaba {{ad}}, {{salon}} olarak bu hafta size özel indirimlerimiz başladı. Randevu için bize ulaşabilirsiniz.',
    'Merhaba {{ad}}, yeni hizmetimizi denemeye ne dersiniz? Detaylar ve randevu için {{salon}} sizi bekliyor.',
  ],
  'Campaign': [
    'Merhaba {{ad}}, {{salon}} olarak bu hafta size özel indirimlerimiz başladı. Randevu için bize ulaşabilirsiniz.',
  ],
  'AppointmentReminder': [
    'Merhaba {{ad}}, {{tarih}} {{saat}} {{hizmet}} randevunuzu hatırlatırız. Gelemeyecekseniz lütfen haber verin. {{salon}}',
    'Sayın {{ad}}, {{tarih}} saat {{saat}} randevunuz var. Sizi bekliyoruz! {{salon}}',
  ],
  'BirthdayGreeting': [
    'Doğum gününüz kutlu olsun {{ad}}! Bu ay yapacağınız randevuda size özel bir sürprizimiz var. {{salon}}',
    'Nice mutlu yıllara {{ad}}! {{salon}} ailesi olarak yeni yaşınızı kutlarız.',
  ],
  'PaymentDue': [
    'Sayın {{ad}}, vadesi gelen taksit ödemeniz bulunmaktadır. Bilgi için {{salon}} ile iletişime geçebilirsiniz.',
  ],
  'WinBack': [
    'Merhaba {{ad}}, sizi özledik! Bu hafta randevu alırsanız size özel bir karşılama hazırlayalım. {{salon}}',
  ],
  'SessionRenewal': [
    'Merhaba {{ad}}, paketinizdeki seanslarınız bitmek üzere. Yenileme yapan müşterilerimize özel avantajlarımız var. {{salon}}',
  ],
};

class ChannelOption {
  const ChannelOption(this.key, this.title, this.note);
  final String key;
  final String title;
  final String note;
}

const channelOptions = <ChannelOption>[
  ChannelOption('Sms', 'SMS', 'Her telefona ulaşır. Paket SMS kotasından, kota bitince mesaj kredisinden (parça başına) düşer.'),
  ChannelOption('WhatsApp', 'WhatsApp', 'Serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir (Meta kuralı).'),
  ChannelOption('Email', 'E-posta', 'Yalnız e-postası kayıtlı müşterilere gider; krediden düşmez.'),
];

String channelTitle(String key) => switch (key) {
      'Sms' => 'SMS',
      'WhatsApp' => 'WhatsApp',
      'Email' => 'E-posta',
      _ => key,
    };

/// WhatsApp randevu hatırlatması AYRI akıştan gider (iki yönlü onay; metni WhatsApp ayarlarından).
bool usesWhatsAppReminderFlow(String channel, String trigger) =>
    channel == 'WhatsApp' && trigger == 'AppointmentReminder';

/// Kredi: tam sayıysa ondalıksız ve binlik ayraçlı (1.000), kesirliyse iki hane.
String formatCredits(num? value) {
  final n = value ?? 0;
  if (n == n.roundToDouble()) return thousands(n.round());
  return n.toStringAsFixed(2).replaceAll('.', ',');
}

String thousands(int v) {
  final s = v.abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return '${v < 0 ? '-' : ''}$b';
}
