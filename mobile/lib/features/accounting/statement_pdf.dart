import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import 'account_statement.dart';

/// CARİ HESAP EKSTRESİ — yazdırılabilir belge (web `lib/statementPdf.ts` paritesi).
///
/// Ekrandaki belge ile BİREBİR aynı düzen: kurum başlığı, cari bilgi ızgarası,
/// Tarih / İşlem Türü / Borç / Alacak / Bakiye tablosu, toplam + bakiye bandı,
/// tutarın yazıyla okunuşu. Rakamlar `buildAccountStatement`ten hazır gelir — bu dosya
/// HESAP YAPMAZ, yalnız dizer (iki yerde hesap yapılsaydı ekran ile kâğıt ayrışabilirdi).
///
/// Font: KVKK/onam belgeleriyle AYNI bundle font (Carlito) — internetsiz cihazda da Türkçe
/// karakterler doğru render eder.
class StatementPdf {
  static const _ink = PdfColor.fromInt(0xFF241C21);
  static const _soft = PdfColor.fromInt(0xFF5D4C55);
  static const _muted = PdfColor.fromInt(0xFF7A6873);
  static const _line = PdfColor.fromInt(0xFFDED5DA);
  static const _band = PdfColor.fromInt(0xFFF4EFF1);
  static const _zebra = PdfColor.fromInt(0xFFFBF8F9);
  static const _plum = PdfColor.fromInt(0xFFA5556E);
  static const _debt = PdfColor.fromInt(0xFF9F1239);
  static const _credit = PdfColor.fromInt(0xFF15694A);

  static Future<void> share({
    required AccountStatement doc,
    required String institutionName,
    String? institutionPhone,
    String? institutionEmail,
    String? branchName,
    required String customerCode,
    required String customerName,
    String? customerPhone,
    required int saleCount,
    required String periodLabel,
  }) async {
    final regular = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans.ttf'));
    final bold = pw.Font.ttf(await rootBundle.load('assets/fonts/KvkkSans-Bold.ttf'));
    final theme = pw.ThemeData.withFont(base: regular, bold: bold);
    final issuedAt = formatDocDateTime(DateTime.now());
    final closingDebt = doc.closing >= 0;

    pw.Widget infoRow(String label, String value) => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
          child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.SizedBox(
              width: 74,
              child: pw.Text(label, style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
            ),
            pw.Text(': ', style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
            pw.Expanded(
              child: pw.Text(value.isEmpty ? '—' : value,
                  style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _ink)),
            ),
          ]),
        );

    pw.Widget cell(String text,
            {bool right = false, bool boldText = false, PdfColor color = _soft, double size = 8.5}) =>
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 5, vertical: 4),
          child: pw.Text(
            text,
            textAlign: right ? pw.TextAlign.right : pw.TextAlign.left,
            style: pw.TextStyle(
              fontSize: size,
              color: color,
              fontWeight: boldText ? pw.FontWeight.bold : pw.FontWeight.normal,
            ),
          ),
        );

    // BEŞ SÜTUN — "İşlem Türü" ile "Açıklama" tek sütunda birleşti (`row.label`).
    // Aşağıdaki her TableRow bu sayıya göre elle kuruluyor: sütun sayısı değişirse boş hücre
    // adetleri de değişmeli, yoksa tablo sessizce kayar.
    const widths = <int, pw.TableColumnWidth>{
      0: pw.FixedColumnWidth(52),
      1: pw.FlexColumnWidth(),
      2: pw.FixedColumnWidth(62),
      3: pw.FixedColumnWidth(62),
      4: pw.FixedColumnWidth(68),
    };

    final tableRows = <pw.TableRow>[
      pw.TableRow(
        decoration: const pw.BoxDecoration(
          color: _band,
          border: pw.Border(bottom: pw.BorderSide(color: _plum, width: 1.2)),
        ),
        children: [
          cell('Tarih', boldText: true, color: _ink),
          cell('İşlem Türü', boldText: true, color: _ink),
          cell('Borç (TL)', right: true, boldText: true, color: _ink),
          cell('Alacak (TL)', right: true, boldText: true, color: _ink),
          cell('Bakiye (TL)', right: true, boldText: true, color: _ink),
        ],
      ),
    ];

    if (doc.rows.isEmpty) {
      tableRows.add(pw.TableRow(children: [
        cell(''),
        cell('Bu dönemde hareket bulunmuyor.', color: _muted),
        cell(''),
        cell(''),
        cell(''),
      ]));
    }

    for (var i = 0; i < doc.rows.length; i++) {
      final row = doc.rows[i];
      tableRows.add(pw.TableRow(
        decoration: pw.BoxDecoration(
          color: i.isOdd ? _zebra : null,
          border: const pw.Border(bottom: pw.BorderSide(color: _line, width: .4)),
        ),
        children: [
          cell(formatDocDate(row.date)),
          cell(row.label),
          cell(formatStatementAmount(row.debit), right: true, color: _ink),
          cell(formatStatementAmount(row.credit), right: true, color: _ink),
          cell(formatStatementAmount(row.balance), right: true, boldText: true, color: _ink),
        ],
      ));
    }

    // TOPLAM: yalnız borç/alacak — bakiye zaten son satırda yazılıdır.
    tableRows.add(pw.TableRow(children: [
      cell(''),
      cell('Toplam', right: true, boldText: true, color: _ink, size: 9),
      cell(formatStatementAmount(doc.totalDebit), right: true, boldText: true, color: _ink, size: 9),
      cell(formatStatementAmount(doc.totalCredit), right: true, boldText: true, color: _ink, size: 9),
      cell(''),
    ]));
    tableRows.add(pw.TableRow(children: [
      cell(''),
      cell(''),
      cell(''),
      cell('Bakiye', right: true, boldText: true, color: _ink, size: 9),
      cell('${formatStatementAmount(doc.closing.abs())} TL',
          right: true, boldText: true, color: closingDebt ? _debt : _credit, size: 11),
    ]));

    final pdfDoc = pw.Document(
      title: 'Cari Hesap Ekstresi — $customerName',
      author: institutionName,
      creator: 'BeautyAsist',
    );

    pdfDoc.addPage(pw.MultiPage(
      theme: theme,
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(32, 32, 32, 36),
      footer: (context) => pw.Container(
        margin: const pw.EdgeInsets.only(top: 12),
        child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
          pw.Text('$institutionName • Cari Hesap Ekstresi • $customerCode',
              style: const pw.TextStyle(fontSize: 7.5, color: _muted)),
          pw.Text('Sayfa ${context.pageNumber} / ${context.pagesCount}',
              style: const pw.TextStyle(fontSize: 7.5, color: _muted)),
        ]),
      ),
      build: (context) => [
        // ---------- KURUM BAŞLIĞI ----------
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Expanded(
              child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                pw.Text(institutionName,
                    style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold, color: _ink)),
                if ((branchName ?? '').isNotEmpty)
                  pw.Text(branchName!, style: const pw.TextStyle(fontSize: 8.5, color: _muted)),
              ]),
            ),
            pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
              pw.Text(institutionName.toUpperCase(),
                  style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _ink)),
              if ((institutionPhone ?? '').isNotEmpty)
                pw.Text('Tel: $institutionPhone', style: const pw.TextStyle(fontSize: 8, color: _muted)),
              if ((institutionEmail ?? '').isNotEmpty)
                pw.Text(institutionEmail!, style: const pw.TextStyle(fontSize: 8, color: _muted)),
            ]),
          ],
        ),
        pw.SizedBox(height: 6),
        pw.Container(height: 1.6, color: _plum),

        // ---------- BAŞLIK ----------
        pw.SizedBox(height: 14),
        pw.Center(
          child: pw.Text('CARİ HESAP EKSTRESİ',
              style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold, color: _ink)),
        ),
        pw.SizedBox(height: 14),

        // ---------- CARİ BİLGİLERİ ----------
        pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              infoRow('Cari Kodu', customerCode),
              infoRow('Adı Soyadı', customerName),
              infoRow('Telefon', customerPhone ?? ''),
              infoRow('Kayıtlı Satış', '$saleCount satış'),
            ]),
          ),
          pw.SizedBox(width: 18),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              infoRow('Tarih Aralığı', periodLabel),
              infoRow('Düzenleme Tarihi', issuedAt),
              infoRow('Para Birimi', 'TL'),
            ]),
          ),
        ]),
        pw.SizedBox(height: 12),

        // ---------- HAREKETLER ----------
        pw.Table(columnWidths: widths, children: tableRows),

        // ---------- YAZIYLA ----------
        pw.SizedBox(height: 14),
        pw.RichText(
          text: pw.TextSpan(children: [
            const pw.TextSpan(text: 'Yalnız ', style: pw.TextStyle(fontSize: 8.5, color: _muted)),
            pw.TextSpan(
              text: turkishAmountInWords(doc.closing.abs()),
              style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold, color: _ink),
            ),
            if (!closingDebt)
              const pw.TextSpan(
                  text: ' (müşteri alacaklı)', style: pw.TextStyle(fontSize: 8.5, color: _muted)),
          ]),
        ),
        pw.SizedBox(height: 6),
        pw.Text('Not: Bu belge bilgilendirme amaçlıdır.',
            style: const pw.TextStyle(fontSize: 8, color: _muted)),
      ],
    ));

    await Printing.sharePdf(
      bytes: await pdfDoc.save(),
      filename: 'Cari-Hesap-Ekstresi-$customerCode.pdf',
    );
  }
}
