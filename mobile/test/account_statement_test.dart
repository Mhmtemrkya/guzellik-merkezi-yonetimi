import 'package:beautyasist_mobile/features/accounting/account_grouping.dart';
import 'package:beautyasist_mobile/features/accounting/account_statement.dart';
import 'package:flutter_test/flutter_test.dart';

/// CARİ HESAP EKSTRESİ — web `lib/accountStatement.test.ts` ile AYNI vakalar.
///
/// Belgenin kırılmaz kuralı: yürüyen bakiye sütunu toplanabilir olmalı ve kapanış bakiyesi
/// sunucunun borç tanımıyla (`Σ total − paid`) BİREBİR tutmalı. Belge basılıp müşteriye
/// veriliyor; sessizce kayan bir kuruş bile itiraz konusudur.

Map<String, dynamic> inst({
  required int no,
  required String dueDate,
  required double amount,
  double paidAmount = 0,
  String status = 'Planned',
}) =>
    {
      'id': 'i-$no',
      'no': no,
      'dueDate': dueDate,
      'amount': amount,
      'paidAmount': paidAmount,
      'status': status,
      'paidAtUtc': null,
    };

Map<String, dynamic> pay({
  required String id,
  required double amount,
  String method = 'cash',
  String reference = '',
  required String at,
}) =>
    {'id': id, 'amount': amount, 'method': method, 'reference': reference, 'occurredAtUtc': at};

Map<String, dynamic> acc({
  required String id,
  required double totalAmount,
  double depositAmount = 0,
  double? paidAmount,
  double? remainingAmount,
  String servicePackageName = 'Cilt Bakımı 10 Seans',
  List<Map<String, dynamic>> installments = const [],
  List<Map<String, dynamic>> payments = const [],
  String soldAtUtc = '2026-06-18T09:00:00Z',
}) {
  final paid = paidAmount ?? payments.fold<double>(0, (s, p) => s + (p['amount'] as double));
  return {
    'id': id,
    'customerId': 'c1',
    'customerName': 'Ela Yılmaz',
    'customerPhone': '+90 555 111 22 33',
    'name': 'Satış',
    'servicePackageName': servicePackageName,
    'totalAmount': totalAmount,
    'depositAmount': depositAmount,
    'paidAmount': paid,
    'remainingAmount': remainingAmount ?? (totalAmount - paid < 0 ? 0.0 : totalAmount - paid),
    'installments': installments,
    'payments': payments,
    'soldAtUtc': soldAtUtc,
    'createdAtUtc': soldAtUtc,
    'sessionsTotal': 0,
    'sessionsRemaining': 0,
    'saleStatus': 'Active',
  };
}

Map<String, dynamic> cancelledSale({
  required String id,
  double totalAmount = 0,
  double collectedAmount = 0,
  double refundedAmount = 0,
  List<Map<String, dynamic>> payments = const [],
  List<Map<String, dynamic>> refunds = const [],
}) =>
    {
      'id': id,
      'originalAccountId': 'acc-$id',
      'customerId': 'c1',
      'name': 'İptal Paketi',
      'totalAmount': totalAmount,
      'collectedAmount': collectedAmount,
      'refundedAmount': refundedAmount,
      'retainedAmount': collectedAmount - refundedAmount,
      'soldAtUtc': '2026-05-01T09:00:00Z',
      'cancelledAtUtc': '2026-06-01T09:00:00Z',
      'payments': payments,
      'refunds': refunds,
    };

const today = '2026-08-11';

CustomerAccountGroup groupOf(List<Map<String, dynamic>> accounts) =>
    groupAccountsByCustomer(accounts).first;

void main() {
  group('buildStatementRows', () {
    test('satışı peşinat + taksitler olarak borçlandırır, tahsilatı alacak yazar', () {
      final insts = List.generate(10, (i) {
        final month = 7 + i;
        final year = month > 12 ? 2027 : 2026;
        final m = month > 12 ? month - 12 : month;
        return inst(no: i + 1, dueDate: '$year-${m.toString().padLeft(2, '0')}-01', amount: 43000);
      });
      final g = groupOf([
        acc(
          id: 'a1', servicePackageName: '9-D', totalAmount: 580000, depositAmount: 150000,
          installments: insts,
          payments: [pay(id: 'p1', amount: 150000, reference: 'MKB-202606-00001', at: '2026-06-18T12:00:00Z')],
        ),
      ]);

      final rows = buildStatementRows(g, const [], today);
      expect(rows.length, 12); // 1 peşinat + 10 taksit + 1 tahsilat
      expect(rows[0].type, 'Peşinat');
      expect(rows[0].debit, 150000);
      expect(rows[0].description, contains('Kayıt peşinatı'));
      // Aynı gün: önce borç, sonra tahsilat (bakiye önce eksiye düşmesin).
      expect(rows[1].type, 'Tahsilat');
      expect(rows[1].credit, 150000);
      expect(rows[1].description, contains('Nakit'));
      expect(rows[1].description, contains('MKB-202606-00001'));

      expect(rows[2].type, 'Taksit');
      expect(rows[2].description, '1. Taksit • 9-D');
      expect(rows[4].type, 'Taksit (Vade)');
      expect(rows[11].date, '2027-04-01');
      expect(rows[11].description, '10. Taksit • 9-D');
    });

    test('peşin satışta tek "Satış" borç satırı üretir', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 4000, servicePackageName: 'Lazer 5 Seans')]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.length, 1);
      expect(rows.first.type, 'Satış');
      expect(rows.first.debit, 4000);
      expect(rows.first.description, 'Lazer 5 Seans');
    });

    test('iptal edilmiş taksitin tutarını "plan dışı bakiye" olarak borçta tutar', () {
      final g = groupOf([
        acc(id: 'a1', totalAmount: 3000, installments: [
          inst(no: 1, dueDate: '2026-07-01', amount: 1000),
          inst(no: 2, dueDate: '2026-08-01', amount: 1000, status: 'Cancelled'),
          inst(no: 3, dueDate: '2026-09-01', amount: 1000),
        ]),
      ]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.fold<double>(0, (s, r) => s + r.debit), 3000);
      expect(rows.any((r) => r.description.contains('plan dışı bakiye')), isTrue);
    });

    test('canlı carideki iade (DTO alanı yok) ödeme toplamı ile paidAmount farkından yazılır', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 5000, paidAmount: 1200,
          payments: [pay(id: 'p1', amount: 2000, method: 'card', at: '2026-07-05T10:00:00Z')],
        ),
      ]);
      final rows = buildStatementRows(g, const [], today);
      final refund = rows.firstWhere((r) => r.type == 'İade');
      expect(refund.debit, 800);
      expect(refund.date, '2026-07-05');
    });
  });

  group('buildAccountStatement — mutabakat', () {
    test('kapanış bakiyesi = Σ(totalAmount − paidAmount)', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 580000, depositAmount: 150000,
          installments: [inst(no: 1, dueDate: '2026-07-01', amount: 430000)],
          payments: [pay(id: 'p1', amount: 150000, at: '2026-06-18T12:00:00Z')],
        ),
        acc(
          id: 'a2', totalAmount: 3000, soldAtUtc: '2026-07-20T09:00:00Z',
          payments: [pay(id: 'p2', amount: 1000, method: 'card', at: '2026-07-20T09:10:00Z')],
        ),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: today);
      const expected = 580000 - 150000 + 3000 - 1000;

      expect(doc.closing, expected);
      expect(doc.netAll, expected);
      expect(doc.totalDebit - doc.totalCredit, expected);

      var running = 0.0;
      for (final row in doc.rows) {
        running = ((running + row.debit - row.credit) * 100).round() / 100;
        expect(row.balance, running);
      }
    });

    test('iptal edilen satış bakiyeye ETKİ ETMEZ', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 1000)]);
      final doc = buildAccountStatement(
        group: g,
        cancelledSales: [
          cancelledSale(
            id: 'x1', totalAmount: 5000,
            payments: [pay(id: 'cp1', amount: 2000, at: '2026-05-02T09:00:00Z')],
            refunds: [
              {'id': 'cr1', 'amount': 500.0, 'method': 'cash', 'reference': '', 'refundedAtUtc': '2026-06-01T09:00:00Z'}
            ],
          ),
        ],
        todayIso: today,
      );

      expect(doc.netAll, 1000);
      expect(doc.rows.firstWhere((r) => r.type == 'Satış (İptal)').debit, 1500);
      expect(doc.rows.any((r) => r.type == 'İade' && r.debit == 500), isTrue);
    });

    test('eski arşiv kaydında skalerlerden satır üretir ve yine sıfıra kapanır', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 0)]);
      final doc = buildAccountStatement(
        group: g,
        cancelledSales: [cancelledSale(id: 'x1', collectedAmount: 900, refundedAmount: 400)],
        todayIso: today,
      );
      expect(doc.netAll, 0);
      expect(doc.totalCredit, 900);
      expect(doc.totalDebit, 900); // 400 iade + 500 kurumda kalan
    });

    test('tarih süzgecinde önceki hareketler Devir satırında toplanır', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 3000, depositAmount: 1000,
          installments: [
            inst(no: 1, dueDate: '2026-07-01', amount: 1000),
            inst(no: 2, dueDate: '2026-08-01', amount: 1000),
          ],
          payments: [pay(id: 'p1', amount: 1000, at: '2026-06-18T12:00:00Z')],
        ),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: today, from: '2026-07-15');
      expect(doc.opening, 1000);
      expect(doc.rows.first.type, 'Devir');
      expect(doc.rows.first.balance, 1000);
      expect(doc.closing, 2000);
      expect(doc.netAll, 2000);
    });

    test('dönem sonu süzgeci gelecek taksitleri çıkarır ama netAll korunur', () {
      final g = groupOf([
        acc(id: 'a1', totalAmount: 2000, installments: [
          inst(no: 1, dueDate: '2026-07-01', amount: 1000),
          inst(no: 2, dueDate: '2026-12-01', amount: 1000),
        ]),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: today, to: '2026-08-31');
      expect(doc.rows.length, 1);
      expect(doc.closing, 1000);
      expect(doc.netAll, 2000);
    });

    test('fazla ödemede belge NET yazar, KPI ile farkı raporlar', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 1000, paidAmount: 1500, remainingAmount: 0,
          payments: [pay(id: 'p1', amount: 1500, at: '2026-07-01T09:00:00Z')],
        ),
        acc(id: 'a2', totalAmount: 2000, soldAtUtc: '2026-07-02T09:00:00Z'),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: today);
      expect(doc.netAll, 1500);
      expect(g.remainingAmount, 2000);
      expect(doc.clampDifference, 500);
    });

    test('hareketsiz müşteride boş belge üretir', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 0)]);
      final doc = buildAccountStatement(group: g, todayIso: today);
      expect(doc.rows, isEmpty);
      expect(doc.closing, 0);
      expect(doc.firstDate, isNull);
    });
  });

  group('turkishNumberToWords', () {
    const cases = <int, String>{
      0: 'Sıfır',
      1: 'Bir',
      11: 'OnBir',
      100: 'Yüz',
      101: 'YüzBir',
      200: 'İkiYüz',
      1000: 'Bin',
      1001: 'BinBir',
      2000: 'İkiBin',
      11000: 'OnBirBin',
      430000: 'DörtYüzOtuzBin',
      580000: 'BeşYüzSeksenBin',
      1000000: 'BirMilyon',
      1001000: 'BirMilyonBin',
      1234567: 'BirMilyonİkiYüzOtuzDörtBinBeşYüzAltmışYedi',
    };
    cases.forEach((value, expected) {
      test('$value → $expected', () => expect(turkishNumberToWords(value), expected));
    });
  });

  group('turkishAmountInWords', () {
    test('kuruşsuz tutarı TL ile yazar', () {
      expect(turkishAmountInWords(430000), 'DörtYüzOtuzBin TL');
    });
    test('kuruşu ayrı yazar', () {
      expect(turkishAmountInWords(12.45), 'Onİki TL KırkBeş Kr');
    });
    test('negatif bakiyeyi işaretler', () {
      expect(turkishAmountInWords(-250), 'Eksi İkiYüzElli TL');
    });
  });

  group('cariCode', () {
    test('aynı müşteri her belgede aynı kodu alır', () {
      const id = '3f2a1b9c-4d5e-6f70-8192-a3b4c5d6e7f8';
      expect(cariCode(id), cariCode(id));
      expect(cariCode(id), 'CR-3F2A1B');
    });
    test('kimliksiz kayıtta çökmez', () {
      expect(cariCode(''), 'CR-000000');
    });
  });

  group('formatStatementAmount', () {
    test('binlik ayracı ve iki hane kuruş yazar', () {
      expect(formatStatementAmount(150000), '150.000,00');
      expect(formatStatementAmount(0), '0,00');
      expect(formatStatementAmount(43000.5), '43.000,50');
    });
  });
}
