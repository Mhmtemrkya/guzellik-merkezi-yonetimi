import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:barcode/barcode.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../shared/json_helpers.dart';

/// HEDİYE KARTI GÖRSELİ — web'deki `GiftCardArtwork` bileşeninin mobil karşılığı.
///
/// AYNI ŞABLON, AYNI KOORDİNATLAR: kart 2479×825 ölçüsünde çizilir, ekranda ölçeklenir.
/// Şablon PNG'si yalnız pembe zemini ve alt bilgi şeridini taşır; "HEDİYE KARTI" başlığı,
/// GEÇERLİLİK/BAKİYE etiketleri ve gövde metni burada çizilir — böylece kart tamamen veriye
/// bağlıdır ve iki platformda aynı görünür.
///
/// NEDEN CustomPainter: kart hem ekranda gösterilecek hem PDF'e gömülüp WhatsApp'tan
/// gönderilecek. Tek kaynak olsun diye çizim tek yerdedir; önizleme ve gönderilen dosya
/// aynı koddan çıkar.

const double kCardW = 2479;
const double kCardH = 825;
const String _templateAsset = 'assets/images/gift-card-template.png';

const _ink = Color(0xFF3F3B3C);
const _pinkStrong = Color(0xFFD6537F);
const _pinkTitle = Color(0xFFE0698E);
const _inkSoft = Color(0xFF5A5658);

/// Karta basılacak veri kümesi — türe göre çağıran hazırlar.
class GiftCardArtworkData {
  const GiftCardArtworkData({
    required this.code,
    required this.amountText,
    required this.amountLabel,
    required this.validText,
    required this.scopeLabel,
    required this.recipientName,
    required this.salonName,
    this.logoBytes,
  });

  final String code;
  final String amountText;
  final String amountLabel;
  final String validText;
  final String scopeLabel;
  final String recipientName;
  final String salonName;

  /// Kurum logosu (çözülmüş bayt dizisi). Yoksa kurum adı yazıyla çizilir.
  final Uint8List? logoBytes;
}

/// Karttaki veriyi kayıttan türetir (web'deki `giftCardArtworkData` ile aynı kurallar).
GiftCardArtworkData giftCardArtworkData(
  Map<String, dynamic> card,
  String salonName,
  Uint8List? logoBytes,
) {
  String two(int v) => v.toString().padLeft(2, '0');
  String? fmt(dynamic iso) {
    final d = parseUtcToLocal(iso);
    if (d == null) return null;
    return '${two(d.day)}.${two(d.month)}.${d.year}';
  }

  final from = fmt(card['validFromUtc']);
  final until = fmt(card['validUntilUtc']);
  // Süre metni ELDEKİ VERİYE göre kurulur; olmayan bir başlangıç uydurulmaz.
  final validText = from != null && until != null
      ? '$from-$until'
      : until != null
          ? "$until'a kadar"
          : from != null
              ? "$from'dan itibaren"
              : 'Süresiz';

  final kind = '${card['kind'] ?? 'StoredValue'}';
  final value = numberOf(card, const ['value']);
  final balance = numberOf(card, const ['balance']);
  String money(num v) => '₺${v.round()}';

  return GiftCardArtworkData(
    code: valueOf(card, const ['code'], fallback: '—'),
    amountText: kind == 'Percentage'
        ? '%${value.round()}'
        : kind == 'StoredValue'
            ? money(balance)
            : money(value),
    amountLabel: kind == 'StoredValue' ? 'BAKİYE' : 'İNDİRİM',
    validText: validText,
    scopeLabel: valueOf(card, const ['scopeLabel'], fallback: ''),
    recipientName: valueOf(card, const ['recipientName'], fallback: ''),
    salonName: salonName,
    logoBytes: logoBytes,
  );
}

/// Şablon ve QR görüntülerini bir kez çözer; her çizimde yeniden kod çözmek pahalıdır.
class GiftCardImages {
  const GiftCardImages({required this.template, this.qr, this.logo});
  final ui.Image template;
  final ui.Image? qr;
  final ui.Image? logo;
}

/// QR'ı `barcode` paketiyle matris olarak üretip görüntüye çevirir.
///
/// Kutucuklar TAM SAYI piksele oturtulur: ondalık kenar, ölçeklenirken modüller arasında
/// gri saçaklar bırakıp okuyucuyu yanıltıyordu.
Future<ui.Image> _buildQrImage(String data) async {
  final qr = Barcode.qrCode();
  const size = 530;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  // Beyaz zemin: karttaki desenin üstünde okuyucular kodu seçebilsin.
  canvas.drawRect(Rect.fromLTWH(0, 0, size.toDouble(), size.toDouble()), Paint()..color = const Color(0xFFFFFFFF));
  final paint = Paint()..color = const Color(0xFF000000);
  for (final element in qr.make(data, width: size.toDouble(), height: size.toDouble())) {
    if (element is BarcodeBar && element.black) {
      canvas.drawRect(
        Rect.fromLTWH(
          element.left.floorToDouble(),
          element.top.floorToDouble(),
          element.width.ceilToDouble(),
          element.height.ceilToDouble(),
        ),
        paint,
      );
    }
  }
  return recorder.endRecording().toImage(size, size);
}

Future<ui.Image> _decode(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  return frame.image;
}

/// Kart görselleri: şablon + (varsa) QR ve logo.
Future<GiftCardImages> loadGiftCardImages({
  required String qrData,
  Uint8List? logoBytes,
}) async {
  final templateBytes = (await rootBundle.load(_templateAsset)).buffer.asUint8List();
  final template = await _decode(templateBytes);

  ui.Image? qr;
  if (qrData.isNotEmpty) qr = await _buildQrImage(qrData);

  ui.Image? logo;
  if (logoBytes != null && logoBytes.isNotEmpty) {
    try {
      logo = await _decode(logoBytes);
    } catch (_) {
      // Logo bozuksa kart yine çizilir; ada düşülür.
    }
  }

  return GiftCardImages(template: template, qr: qr, logo: logo);
}

/// Metni verilen genişliğe göre satırlara böler.
List<String> _wrap(String text, TextStyle style, double maxWidth) {
  final words = text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  final lines = <String>[];
  var line = '';
  for (final word in words) {
    final candidate = line.isEmpty ? word : '$line $word';
    final tp = TextPainter(
      text: TextSpan(text: candidate, style: style),
      textDirection: TextDirection.ltr,
    )..layout();
    if (tp.width > maxWidth && line.isNotEmpty) {
      lines.add(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.isNotEmpty) lines.add(line);
  return lines;
}

double _drawText(Canvas canvas, String text, TextStyle style, double x, double y) {
  final tp = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: TextDirection.ltr,
  )..layout();
  // y ALT ÇİZGİDİR (web'deki alphabetic baseline ile aynı): metin yukarı doğru çizilir.
  tp.paint(canvas, Offset(x, y - tp.height));
  return x + tp.width;
}

/// Kartı çizen boyacı — hem ekranda hem PDF için kullanılır.
class GiftCardPainter extends CustomPainter {
  const GiftCardPainter({required this.data, required this.images});

  final GiftCardArtworkData data;
  final GiftCardImages images;

  @override
  void paint(Canvas canvas, Size size) {
    // Çizim daima 2479×825 koordinatında yapılır, hedef boyuta ölçeklenir.
    canvas.save();
    canvas.scale(size.width / kCardW, size.height / kCardH);

    // Şablon
    final t = images.template;
    canvas.drawImageRect(
      t,
      Rect.fromLTWH(0, 0, t.width.toDouble(), t.height.toDouble()),
      const Rect.fromLTWH(0, 0, kCardW, kCardH),
      Paint(),
    );

    /* ---------------- SOL SÜTUN ---------------- */

    const logoBox = Rect.fromLTWH(150, 78, 640, 165);
    final logo = images.logo;
    if (logo != null) {
      // Oranı bozmadan sığdır (contain).
      final scale = (logoBox.width / logo.width) < (logoBox.height / logo.height)
          ? logoBox.width / logo.width
          : logoBox.height / logo.height;
      final w = logo.width * scale;
      final h = logo.height * scale;
      canvas.drawImageRect(
        logo,
        Rect.fromLTWH(0, 0, logo.width.toDouble(), logo.height.toDouble()),
        Rect.fromLTWH(logoBox.left + (logoBox.width - w) / 2, logoBox.top + (logoBox.height - h) / 2, w, h),
        Paint(),
      );
    } else {
      const nameStyle = TextStyle(color: _ink, fontSize: 54, fontWeight: FontWeight.w800);
      final lines = _wrap(data.salonName.toUpperCase(), nameStyle, logoBox.width);
      for (var i = 0; i < lines.length && i < 2; i++) {
        _drawText(canvas, lines[i], nameStyle, logoBox.left, logoBox.top + 78 + i * 62);
      }
    }

    _drawText(
      canvas,
      'HEDİYE KARTI',
      const TextStyle(color: _pinkTitle, fontSize: 96, fontWeight: FontWeight.w800),
      130,
      355,
    );

    // Gövde: "Bu çek, <alıcı> size <salon>'nde geçerli <kapsam> çekidir."
    const bodySize = 34.0;
    const bodyRegular = TextStyle(color: _inkSoft, fontSize: bodySize, fontWeight: FontWeight.w500, letterSpacing: 1.4);
    const bodyBold = TextStyle(color: _inkSoft, fontSize: bodySize, fontWeight: FontWeight.w800, letterSpacing: 1.4);
    const bodyX = 130.0;
    var bodyY = 445.0;

    var cursor = _drawText(canvas, 'Bu çek, ', bodyRegular, bodyX, bodyY);
    // Alıcı adı yoksa elle yazılsın diye noktalı boşluk kalır (basılı kart geleneği).
    cursor = _drawText(
      canvas,
      data.recipientName.isEmpty ? '..........' : data.recipientName,
      data.recipientName.isEmpty ? bodyRegular : bodyBold,
      cursor,
      bodyY,
    );
    _drawText(canvas, ' size', bodyRegular, cursor, bodyY);

    bodyY += 46;
    for (final line in _wrap("${data.salonName}'nde geçerli", bodyRegular, 780)) {
      _drawText(canvas, line, bodyRegular, bodyX, bodyY);
      bodyY += 46;
    }
    cursor = _drawText(
      canvas,
      data.scopeLabel.isEmpty ? 'tüm hizmetlerde' : data.scopeLabel,
      bodyBold,
      bodyX,
      bodyY,
    );
    _drawText(canvas, ' çekidir.', bodyRegular, cursor, bodyY);

    _drawText(
      canvas,
      data.code,
      const TextStyle(color: _inkSoft, fontSize: 36, fontWeight: FontWeight.w600),
      bodyX,
      bodyY + 70,
    );

    /* ---------------- SAĞ SÜTUN ---------------- */

    const rightX = 1250.0;
    const labelStyle = TextStyle(color: _pinkStrong, fontSize: 46, fontWeight: FontWeight.w800);

    _drawText(canvas, 'GEÇERLİLİK SÜRESİ', labelStyle, rightX, 268);
    _drawText(canvas, data.validText, const TextStyle(color: _ink, fontSize: 54, fontWeight: FontWeight.w500), rightX, 352);
    _drawText(canvas, data.amountLabel, labelStyle, rightX, 445);
    _drawText(canvas, data.amountText, const TextStyle(color: _ink, fontSize: 62, fontWeight: FontWeight.w600), rightX, 528);

    /* ---------------- QR ---------------- */

    final qr = images.qr;
    if (qr != null) {
      canvas.drawImageRect(
        qr,
        Rect.fromLTWH(0, 0, qr.width.toDouble(), qr.height.toDouble()),
        const Rect.fromLTWH(2082, 366, 268, 268),
        Paint()..filterQuality = FilterQuality.none,
      );
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant GiftCardPainter old) =>
      old.data.code != data.code ||
      old.data.amountText != data.amountText ||
      old.data.validText != data.validText ||
      old.data.scopeLabel != data.scopeLabel ||
      old.data.recipientName != data.recipientName ||
      old.images != images;
}

/// Kartı PNG bayta çevirir (PDF'e gömmek ve paylaşmak için).
Future<Uint8List?> renderGiftCardPng(GiftCardArtworkData data, GiftCardImages images) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  GiftCardPainter(data: data, images: images).paint(canvas, const Size(kCardW, kCardH));
  final picture = recorder.endRecording();
  final image = await picture.toImage(kCardW.toInt(), kCardH.toInt());
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  return bytes?.buffer.asUint8List();
}

/// Ekranda kartı gösteren önizleme (oranı korur).
class GiftCardArtwork extends StatelessWidget {
  const GiftCardArtwork({required this.data, required this.images, super.key});

  final GiftCardArtworkData data;
  final GiftCardImages images;

  /*
   * ÇİZİMİN METİN KARŞILIĞI.
   *
   * Kartın tüm bilgisi tuvale çiziliyor; TalkBack/VoiceOver için burası bomboş bir kutuydu ve
   * görme engelli kullanıcı kendi kartının kodunu, tutarını, geçerliliğini hiç öğrenemiyordu.
   * `Semantics` etiketi çizimle aynı veriden üretilir — görsel tasarım değişmez. (Web tarafında
   * aynı işi canvas'ın `role="img"` + gizli özeti yapıyor.)
   */
  String get _semanticsLabel {
    final parts = <String>[
      '${data.salonName} hediye kartı.',
      // Kod harf harf okunur: "A5K2" yerine "A 5 K 2" — sesli okumada karışmaz.
      'Kart kodu ${data.code.split('').join(' ')}.',
      '${data.amountLabel}: ${data.amountText}.',
      'Geçerlilik: ${data.validText}.',
      'Kapsam: ${data.scopeLabel.isEmpty ? 'tüm hizmetler' : data.scopeLabel}.',
      if (data.recipientName.isNotEmpty) 'Alıcı: ${data.recipientName}.',
    ];
    return parts.join(' ');
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: _semanticsLabel,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: AspectRatio(
          aspectRatio: kCardW / kCardH,
          child: CustomPaint(painter: GiftCardPainter(data: data, images: images)),
        ),
      ),
    );
  }
}
