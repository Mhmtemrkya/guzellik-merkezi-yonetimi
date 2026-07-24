import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// KVKK aydınlatma metni için markalı PDF üretimi (web lib/kvkkPdf.ts paritesi).
/// - Üstte kurum logosu (yüklenmişse) + kurum adı
/// - BeautyAsist marka imzası
/// - Türkçe uyumlu bundle font (Carlito) — emülatörde internetsiz de çalışır
/// - Numaralı başlık / madde imi / paragraf biçimlemesi + imza alanı
class KvkkPdf {
  static const _burgundy = PdfColor.fromInt(0xFF2F1724);
  static const _roseGold = PdfColor.fromInt(0xFFD48AA7);
  static const _inkSoft = PdfColor.fromInt(0xFF666666);

  static Future<Uint8List> build({
    required String institutionName,
    required String text,
    String? logoBase64,
  }) async {
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans-Bold.ttf'));
    final theme = pw.ThemeData.withFont(base: regular, bold: bold);

    final logo = _decodeLogo(logoBase64);
    final now = DateTime.now();
    final dateStr =
        '${now.day.toString().padLeft(2, '0')}.${now.month.toString().padLeft(2, '0')}.${now.year}';

    final doc = pw.Document(
      title: '$institutionName - KVKK Aydınlatma Metni',
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
              pw.Text('$institutionName · KVKK Aydınlatma Metni',
                  style: pw.TextStyle(fontSize: 7.5, color: _inkSoft, fontStyle: pw.FontStyle.italic)),
              pw.Text('BeautyAsist · Sayfa ${ctx.pageNumber}/${ctx.pagesCount}',
                  style: pw.TextStyle(fontSize: 7.5, color: _inkSoft)),
            ],
          ),
        ),
        build: (ctx) => [
          // Başlık: logo + kurum adı
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              if (logo != null) ...[
                pw.Container(
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
                    pw.Text('Kişisel Verilerin Korunması Aydınlatma Metni',
                        style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _roseGold)),
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
              pw.Text('BeautyAsist ile hazırlanmıştır',
                  style: pw.TextStyle(fontSize: 8, color: _inkSoft, fontStyle: pw.FontStyle.italic)),
              pw.Text('Düzenlenme: $dateStr',
                  style: pw.TextStyle(fontSize: 8, color: _inkSoft, fontStyle: pw.FontStyle.italic)),
            ],
          ),
          pw.SizedBox(height: 12),
          ..._textWidgets(text),
          pw.SizedBox(height: 24),
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
    required String text,
    String? logoBase64,
  }) async {
    final bytes = await build(institutionName: institutionName, text: text, logoBase64: logoBase64);
    final safe = institutionName.replaceAll(RegExp(r'[^\wğüşöçıİĞÜŞÖÇ]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
    await Printing.sharePdf(bytes: bytes, filename: '${safe.isEmpty ? 'Kurum' : safe}-KVKK-Aydinlatma.pdf');
  }

  static Uint8List? _decodeLogo(String? logoBase64) {
    if (logoBase64 == null || logoBase64.trim().isEmpty) return null;
    try {
      var data = logoBase64.trim();
      final comma = data.indexOf(',');
      // Yalnızca png/jpg gömülebilir (pdf paketi bunları destekler)
      final header = comma >= 0 ? data.substring(0, comma).toLowerCase() : '';
      if (comma >= 0) {
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
    final lines = text.replaceAll('\r\n', '\n').split('\n');
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

    for (final raw in lines) {
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
