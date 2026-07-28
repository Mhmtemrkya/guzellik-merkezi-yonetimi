import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// Onam formu PDF'i (web `lib/consentPdf.ts` paritesi).
///
/// İki kullanım vardır:
///  • Şablon önizlemesi: boş form + ıslak imza çizgisi.
///  • İmzalı belge: müşteri adı, işaretlenen maddeler, imza görseli, tarih/saat.
class ConsentPdf {
  static const _burgundy = PdfColor.fromInt(0xFF2F1724);
  static const _roseGold = PdfColor.fromInt(0xFFD48AA7);
  static const _inkSoft = PdfColor.fromInt(0xFF666666);
  static const _ok = PdfColor.fromInt(0xFF2F7A63);

  /// Metindeki yer tutucuları doldurur: {{musteri}} {{hizmet}} {{tarih}} {{kurum}} {{personel}}
  static String fillPlaceholders(
    String body, {
    String? customerName,
    String? serviceName,
    String? institutionName,
    String? staffName,
    DateTime? date,
  }) {
    final d = date ?? DateTime.now();
    final dateStr =
        '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
    return body
        .replaceAll(RegExp(r'\{\{\s*musteri\s*\}\}', caseSensitive: false), customerName ?? '.....................')
        .replaceAll(RegExp(r'\{\{\s*hizmet\s*\}\}', caseSensitive: false), serviceName ?? '.....................')
        .replaceAll(RegExp(r'\{\{\s*kurum\s*\}\}', caseSensitive: false), institutionName ?? '.....................')
        .replaceAll(RegExp(r'\{\{\s*personel\s*\}\}', caseSensitive: false), staffName ?? '.....................')
        .replaceAll(RegExp(r'\{\{\s*tarih\s*\}\}', caseSensitive: false), dateStr);
  }

  static Future<Uint8List> build({
    required String institutionName,
    required String title,
    required String body,
    String? logoBase64,
    List<String> checkItems = const [],
    List<String> checkedItems = const [],
    String? customerName,
    String? serviceName,
    String? staffName,
    String? staffNotes,
    String? signatureBase64,
    DateTime? signedAt,
    String? signerName,
  }) async {
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans-Bold.ttf'));
    final theme = pw.ThemeData.withFont(base: regular, bold: bold);

    final logo = _decodeImage(logoBase64);
    final signature = _decodeImage(signatureBase64);
    final signedText = signedAt != null
        ? '${signedAt.day.toString().padLeft(2, '0')}.${signedAt.month.toString().padLeft(2, '0')}.${signedAt.year} '
            '${signedAt.hour.toString().padLeft(2, '0')}:${signedAt.minute.toString().padLeft(2, '0')}'
        : null;
    final now = DateTime.now();
    final todayStr =
        '${now.day.toString().padLeft(2, '0')}.${now.month.toString().padLeft(2, '0')}.${now.year}';

    final info = <List<String>>[
      if ((customerName ?? '').trim().isNotEmpty) ['Müşteri', customerName!],
      if ((serviceName ?? '').trim().isNotEmpty) ['İşlem', serviceName!],
      if ((staffName ?? '').trim().isNotEmpty) ['Uygulayan', staffName!],
    ];
    final checkedLower = checkedItems.map((e) => e.trim().toLowerCase()).toSet();

    final doc = pw.Document(
      title: '$institutionName - $title',
      author: institutionName,
      creator: 'BeautyAsist',
    );

    doc.addPage(
      pw.MultiPage(
        theme: theme,
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.fromLTRB(40, 40, 40, 46),
        footer: (ctx) => pw.Container(
          margin: const pw.EdgeInsets.only(top: 10),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text('$institutionName · $title',
                  style: pw.TextStyle(fontSize: 7.5, color: _inkSoft)),
              pw.Text('BeautyAsist · Sayfa ${ctx.pageNumber}/${ctx.pagesCount}',
                  style: pw.TextStyle(fontSize: 7.5, color: _inkSoft)),
            ],
          ),
        ),
        build: (ctx) => [
          // Başlık: logo + kurum adı + form başlığı
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              if (logo != null) ...[
                pw.SizedBox(
                  width: 64,
                  height: 64,
                  child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain),
                ),
                pw.SizedBox(width: 12),
              ],
              pw.Expanded(
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(institutionName,
                        style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: _burgundy)),
                    pw.SizedBox(height: 2),
                    pw.Text(title,
                        style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: _roseGold)),
                  ],
                ),
              ),
            ],
          ),
          pw.SizedBox(height: 8),
          pw.Container(height: 1.4, color: _roseGold),
          pw.SizedBox(height: 4),
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text('BeautyAsist ile hazırlanmıştır', style: pw.TextStyle(fontSize: 8, color: _inkSoft)),
              pw.Text(signedText != null ? 'İmza: $signedText' : 'Düzenlenme: $todayStr',
                  style: pw.TextStyle(fontSize: 8, color: _inkSoft)),
            ],
          ),
          pw.SizedBox(height: 10),

          // Bağlam kutusu
          if (info.isNotEmpty) ...[
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                for (final row in info)
                  pw.Padding(
                    padding: const pw.EdgeInsets.only(bottom: 2),
                    child: pw.Row(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.SizedBox(
                          width: 66,
                          child: pw.Text(row[0],
                              style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _inkSoft)),
                        ),
                        pw.Expanded(child: pw.Text(row[1], style: const pw.TextStyle(fontSize: 9.5))),
                      ],
                    ),
                  ),
              ],
            ),
            pw.SizedBox(height: 10),
          ],

          ..._textWidgets(body),

          // Onay maddeleri
          if (checkItems.isNotEmpty) ...[
            pw.SizedBox(height: 8),
            pw.Text('Onay Maddeleri',
                style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _burgundy)),
            pw.SizedBox(height: 4),
            for (final item in checkItems)
              pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 3),
                child: pw.Row(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(checkedLower.contains(item.trim().toLowerCase()) ? '[X]  ' : '[  ]  ',
                        style: pw.TextStyle(
                          fontSize: 9.5,
                          color: checkedLower.contains(item.trim().toLowerCase()) ? _ok : _inkSoft,
                          fontWeight: pw.FontWeight.bold,
                        )),
                    pw.Expanded(
                      child: pw.Text(item,
                          style: pw.TextStyle(
                            fontSize: 9.5,
                            lineSpacing: 1.4,
                            color: checkedLower.contains(item.trim().toLowerCase()) ? _ok : PdfColors.black,
                          )),
                    ),
                  ],
                ),
              ),
          ],

          if ((staffNotes ?? '').trim().isNotEmpty) ...[
            pw.SizedBox(height: 10),
            pw.Text('Uygulama Notları',
                style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _burgundy)),
            pw.SizedBox(height: 4),
            pw.Text(staffNotes!, style: const pw.TextStyle(fontSize: 9.5, lineSpacing: 1.4)),
          ],

          pw.SizedBox(height: 22),
          // İmza alanı
          if (signature != null)
            pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Expanded(
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(signerName ?? customerName ?? 'Müşteri',
                          style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _inkSoft)),
                      pw.SizedBox(height: 4),
                      pw.SizedBox(height: 60, child: pw.Image(pw.MemoryImage(signature), fit: pw.BoxFit.contain)),
                      pw.Container(height: 0.8, color: _inkSoft),
                      pw.SizedBox(height: 3),
                      pw.Text('Müşteri imzası', style: pw.TextStyle(fontSize: 8, color: _inkSoft)),
                    ],
                  ),
                ),
                pw.SizedBox(width: 28),
                pw.Expanded(
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text('Onay bilgileri',
                          style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _inkSoft)),
                      pw.SizedBox(height: 4),
                      pw.Text(signedText ?? '—', style: const pw.TextStyle(fontSize: 9.5)),
                      pw.SizedBox(height: 2),
                      pw.Text('Dijital olarak tablet üzerinden imzalanmıştır.',
                          style: pw.TextStyle(fontSize: 8, color: _inkSoft)),
                    ],
                  ),
                ),
              ],
            )
          else
            pw.Row(
              children: [
                pw.Expanded(child: _signBlock('Müşteri Ad Soyad')),
                pw.SizedBox(width: 24),
                pw.Expanded(child: _signBlock('Tarih & İmza')),
              ],
            ),
        ],
      ),
    );

    return doc.save();
  }

  /// Paylaş/yazdır sistem sayfasını açar (PDF olarak kaydet dahil).
  static Future<void> share({
    required String institutionName,
    required String title,
    required String body,
    String? logoBase64,
    List<String> checkItems = const [],
    List<String> checkedItems = const [],
    String? customerName,
    String? serviceName,
    String? staffName,
    String? staffNotes,
    String? signatureBase64,
    DateTime? signedAt,
    String? signerName,
  }) async {
    final bytes = await build(
      institutionName: institutionName,
      title: title,
      body: body,
      logoBase64: logoBase64,
      checkItems: checkItems,
      checkedItems: checkedItems,
      customerName: customerName,
      serviceName: serviceName,
      staffName: staffName,
      staffNotes: staffNotes,
      signatureBase64: signatureBase64,
      signedAt: signedAt,
      signerName: signerName,
    );
    final name = [
      _slug(customerName ?? ''),
      _slug(title).isEmpty ? 'Onam-Formu' : _slug(title),
    ].where((e) => e.isNotEmpty).join('-');
    await Printing.sharePdf(bytes: bytes, filename: '$name.pdf');
  }

  static String _slug(String s) => s
      .replaceAll(RegExp(r'[^\wğüşöçıİĞÜŞÖÇ]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');

  static Uint8List? _decodeImage(String? base64Data) {
    if (base64Data == null || base64Data.trim().isEmpty) return null;
    try {
      var data = base64Data.trim();
      final comma = data.indexOf(',');
      if (comma >= 0) {
        // pdf paketi yalnız png/jpg gömebilir.
        final header = data.substring(0, comma).toLowerCase();
        if (!header.contains('image/png') && !header.contains('image/jpeg') && !header.contains('image/jpg')) {
          return null;
        }
        data = data.substring(comma + 1);
      }
      return base64Decode(data);
    } catch (_) {
      return null;
    }
  }

  static List<pw.Widget> _textWidgets(String text) {
    final widgets = <pw.Widget>[];
    final bullets = <String>[];

    void flush() {
      if (bullets.isEmpty) return;
      for (final b in bullets) {
        widgets.add(pw.Padding(
          padding: const pw.EdgeInsets.only(left: 6, bottom: 3),
          child: pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('•  ', style: const pw.TextStyle(fontSize: 9.5)),
              pw.Expanded(child: pw.Text(b, style: const pw.TextStyle(fontSize: 9.5, lineSpacing: 1.5))),
            ],
          ),
        ));
      }
      bullets.clear();
    }

    for (final raw in text.replaceAll('\r\n', '\n').split('\n')) {
      final line = raw.trim();
      if (line.isEmpty) {
        flush();
        continue;
      }
      if (line.startsWith('•') || line.startsWith('-')) {
        bullets.add(line.replaceFirst(RegExp(r'^[•-]\s*'), ''));
        continue;
      }
      flush();
      final isHeading = RegExp(r'^\d+\.\s').hasMatch(line);
      widgets.add(pw.Padding(
        padding: pw.EdgeInsets.only(top: isHeading ? 8 : 0, bottom: 6),
        child: pw.Text(
          line,
          style: isHeading
              ? pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold, color: _burgundy)
              : const pw.TextStyle(fontSize: 9.5, lineSpacing: 1.5),
        ),
      ));
    }
    flush();
    return widgets;
  }

  static pw.Widget _signBlock(String label) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _inkSoft)),
          pw.SizedBox(height: 18),
          pw.Text('__________________________', style: const pw.TextStyle(fontSize: 9)),
        ],
      );
}
