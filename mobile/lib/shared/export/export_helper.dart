import 'dart:typed_data';

import 'package:excel/excel.dart' as xls;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// EXCEL / PDF DIŞA AKTARMA — web'deki liste ve rapor dışa aktarma aksiyonlarının
/// mobil karşılığı (randevular, müşteriler, personel, loglar, günlük adisyon…).
///
/// Tek bir tablo modeli (`başlıklar` + `satırlar`) üzerinden çalışır; her ekran kendi
/// verisini bu biçime çevirip çağırır. PDF'te Türkçe için bundle font (Carlito) kullanılır —
/// KVKK/onam PDF'leriyle aynı font, internetsiz cihazda da doğru render eder.
class ExportHelper {
  static const _burgundy = PdfColor.fromInt(0xFF2F1724);
  static const _roseGold = PdfColor.fromInt(0xFFD48AA7);
  static const _headerBg = PdfColor.fromInt(0xFFFDF2F6);

  /// Dosya adında kullanılamayan karakterleri temizler.
  static String _safeName(String s) =>
      s.replaceAll(RegExp(r'[^\w\sğüşıöçĞÜŞİÖÇ-]'), '').trim().replaceAll(RegExp(r'\s+'), '_');

  static String _stamp() => DateFormat('yyyyMMdd_HHmm').format(DateTime.now());

  /// Tabloyu .xlsx olarak üretip paylaşım sayfasını açar.
  static Future<void> toExcel({
    required String title,
    required List<String> headers,
    required List<List<String>> rows,
    String? subtitle,
  }) async {
    final book = xls.Excel.createExcel();
    final sheetName = title.length > 28 ? title.substring(0, 28) : title;
    final sheet = book[sheetName];
    // createExcel varsayılan "Sheet1" açar; kendi sayfamız varken onu bırakmayalım.
    if (book.tables.keys.contains('Sheet1') && sheetName != 'Sheet1') {
      book.delete('Sheet1');
    }

    var rowIndex = 0;
    sheet.appendRow([xls.TextCellValue(title)]);
    rowIndex++;
    if (subtitle != null && subtitle.isNotEmpty) {
      sheet.appendRow([xls.TextCellValue(subtitle)]);
      rowIndex++;
    }
    sheet.appendRow([xls.TextCellValue('Oluşturma: ${DateFormat('d MMMM yyyy HH:mm', 'tr_TR').format(DateTime.now())}')]);
    rowIndex++;
    sheet.appendRow(const []); // boş ayraç satırı
    rowIndex++;

    sheet.appendRow(headers.map((h) => xls.TextCellValue(h)).toList());
    final headerRow = rowIndex;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xls.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xls.CellStyle(bold: true);
    }

    for (final r in rows) {
      sheet.appendRow(r.map((v) => xls.TextCellValue(v)).toList());
    }

    final bytes = book.encode();
    if (bytes == null) return;
    await Printing.sharePdf(
      bytes: Uint8List.fromList(bytes),
      filename: '${_safeName(title)}_${_stamp()}.xlsx',
    );
  }

  /// Tabloyu markalı PDF olarak üretir; paylaş/yazdır sayfasını açar.
  static Future<void> toPdf({
    required String title,
    required List<String> headers,
    required List<List<String>> rows,
    String? subtitle,
    String? institutionName,
  }) async {
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans-Bold.ttf'));
    final theme = pw.ThemeData.withFont(base: regular, bold: bold);

    final doc = pw.Document(
      title: title,
      author: institutionName ?? 'BeautyAsist',
      creator: 'BeautyAsist',
    );

    doc.addPage(
      pw.MultiPage(
        theme: theme,
        pageFormat: PdfPageFormat.a4.landscape,
        margin: const pw.EdgeInsets.fromLTRB(24, 26, 24, 26),
        header: (context) => context.pageNumber == 1
            ? pw.SizedBox.shrink()
            : pw.Container(
                alignment: pw.Alignment.centerRight,
                margin: const pw.EdgeInsets.only(bottom: 8),
                child: pw.Text(title,
                    style: pw.TextStyle(fontSize: 8, color: _roseGold)),
              ),
        footer: (context) => pw.Container(
          alignment: pw.Alignment.centerRight,
          child: pw.Text(
            '${context.pageNumber} / ${context.pagesCount}  ·  BeautyAsist',
            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
          ),
        ),
        build: (context) => [
          pw.Text(title,
              style: pw.TextStyle(
                  fontSize: 16, fontWeight: pw.FontWeight.bold, color: _burgundy)),
          if (subtitle != null && subtitle.isNotEmpty)
            pw.Text(subtitle,
                style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
          pw.Text(
            'Oluşturma: ${DateFormat('d MMMM yyyy HH:mm', 'tr_TR').format(DateTime.now())}'
            '${institutionName != null ? '  ·  $institutionName' : ''}',
            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
          ),
          pw.SizedBox(height: 10),
          pw.TableHelper.fromTextArray(
            headers: headers,
            data: rows,
            border: pw.TableBorder.all(color: PdfColors.grey300, width: .4),
            headerStyle: pw.TextStyle(
                fontSize: 8.5, fontWeight: pw.FontWeight.bold, color: _burgundy),
            headerDecoration: const pw.BoxDecoration(color: _headerBg),
            cellStyle: const pw.TextStyle(fontSize: 8),
            cellPadding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
            cellAlignment: pw.Alignment.centerLeft,
          ),
          pw.SizedBox(height: 8),
          pw.Text('Toplam ${rows.length} kayıt',
              style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
        ],
      ),
    );

    await Printing.sharePdf(
      bytes: await doc.save(),
      filename: '${_safeName(title)}_${_stamp()}.pdf',
    );
  }

  /// "Dışa aktar" alt menüsü: Excel / PDF seçtirir ve ilgili üretimi çalıştırır.
  /// Ekranlar tek satırla çağırabilsin diye hata yakalama da burada.
  static Future<void> showMenu(
    BuildContext context, {
    required String title,
    required List<String> headers,
    required List<List<String>> rows,
    String? subtitle,
    String? institutionName,
  }) async {
    if (rows.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Dışa aktarılacak kayıt yok.')));
      return;
    }

    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
              child: Row(
                children: [
                  const Icon(Icons.ios_share_rounded, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('$title · ${rows.length} kayıt',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  ),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.table_chart_rounded, color: Color(0xFF1D7044)),
              title: const Text('Excel (.xlsx)'),
              subtitle: const Text('Tabloyu hesap tablosunda aç'),
              onTap: () => Navigator.pop(ctx, 'excel'),
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_rounded, color: Color(0xFFB3453F)),
              title: const Text('PDF (yazdır / paylaş)'),
              subtitle: const Text('Markalı tablo; yazıcıya da gönderilebilir'),
              onTap: () => Navigator.pop(ctx, 'pdf'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (choice == null) return;

    try {
      if (choice == 'excel') {
        await toExcel(title: title, headers: headers, rows: rows, subtitle: subtitle);
      } else {
        await toPdf(
          title: title,
          headers: headers,
          rows: rows,
          subtitle: subtitle,
          institutionName: institutionName,
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Dışa aktarılamadı: $e')));
      }
    }
  }
}
