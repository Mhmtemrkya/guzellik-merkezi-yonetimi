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
  String? servicePackageId,
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
    'servicePackageId': servicePackageId,
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
    CustomerAccountGroup referenceGroup() {
      final insts = List.generate(10, (i) {
        final month = 7 + i;
        final year = month > 12 ? 2027 : 2026;
        final m = month > 12 ? month - 12 : month;
        return inst(no: i + 1, dueDate: '$year-${m.toString().padLeft(2, '0')}-01', amount: 43000);
      });
      return groupOf([
        acc(
          id: 'a1', servicePackageName: '9-D', totalAmount: 580000, depositAmount: 150000,
          installments: insts,
          payments: [pay(id: 'p1', amount: 150000, reference: 'MKB-202606-00001', at: '2026-06-18T12:00:00Z')],
        ),
      ]);
    }

    test('satışın TAMAMINI satış gününde tek borç satırı yazar, tahsilatı alacak', () {
      final rows = buildStatementRows(referenceGroup(), const [], today);

      expect(rows.length, 2); // 1 satış + 1 tahsilat — taksitler belgeye DÜŞMEZ
      expect(rows[0].type, 'Satış');
      expect(rows[0].date, '2026-06-18');
      expect(rows[0].debit, 580000);
      // Aynı gün: önce borç, sonra tahsilat (bakiye önce eksiye düşmesin).
      expect(rows[1].type, 'Tahsilat');
      expect(rows[1].credit, 150000);
    });

    test('vadesi gelmemiş taksiti belgeye YAZMAZ — borcun toplamı yine satış tutarı', () {
      final rows = buildStatementRows(referenceGroup(), const [], today);
      expect(rows.any((r) => r.label.contains('Taksit')), isFalse);
      expect(rows.fold<double>(0, (s, r) => s + r.debit), 580000);
    });

    test('peşin satışta da tek "Satış" borç satırı üretir', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 4000, servicePackageName: 'Lazer 5 Seans')]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.length, 1);
      expect(rows.first.type, 'Satış');
      expect(rows.first.debit, 4000);
      expect(rows.first.description, 'Lazer 5 Seans');
    });

    test('iptal edilmiş taksit borcu EKSİLTMEZ (borç satış tutarından okunur)', () {
      final g = groupOf([
        acc(id: 'a1', totalAmount: 3000, installments: [
          inst(no: 1, dueDate: '2026-07-01', amount: 1000),
          inst(no: 2, dueDate: '2026-08-01', amount: 1000, status: 'Cancelled'),
          inst(no: 3, dueDate: '2026-09-01', amount: 1000),
        ]),
      ]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.length, 1);
      expect(rows.fold<double>(0, (s, r) => s + r.debit), 3000);
    });

    test('işlem türü ile açıklamayı TEK sütunda birleştirir', () {
      final rows = buildStatementRows(referenceGroup(), const [], today);
      expect(rows[0].label, 'Satış (9-D)');
      // Tahsilatta önce ödeme yöntemi yazar (kullanıcı isteği: "Tahsilat (Nakit)").
      expect(rows[1].label, 'Tahsilat (Nakit · 9-D · Belge: MKB-202606-00001)');
    });

    test('paket bağı olan satış "Paket Satışı" yazar, olmayan yalın "Satış" kalır', () {
      final pkg = groupOf([
        acc(
          id: 'a1', totalAmount: 30000,
          servicePackageId: 'pkg-1', servicePackageName: 'Ela Cilt Bakım Paketi',
        ),
      ]);
      expect(buildStatementRows(pkg, const [], today)[0].label,
          'Paket Satışı (Ela Cilt Bakım Paketi)');

      // Hizmet ↔ ürün ayrımı cari DTO'sunda YOK — uydurma tür etiketi yazılmaz.
      final plain = groupOf([acc(id: 'a2', totalAmount: 500, servicePackageName: 'Ağda')]);
      expect(buildStatementRows(plain, const [], today)[0].label, 'Satış (Ağda)');
    });

    test('"Paket satışı:" ön ekini kırpar — satışta da tahsilatta da tekrar etmez', () {
      // Adisyondan açılan carilerde `servicePackageName` = "Paket satışı: X + Y" (canlı veri).
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 3600, servicePackageId: 'pkg-1',
          servicePackageName: 'Paket satışı: Bölgesel İncelme + Cilt Bakımı',
          payments: [pay(id: 'p1', amount: 400, at: '2026-07-05T09:00:00Z')],
        ),
      ]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows[0].label, 'Paket Satışı (Bölgesel İncelme + Cilt Bakımı)');
      expect(rows[1].label, 'Tahsilat (Nakit · Bölgesel İncelme + Cilt Bakımı)');
    });

    test('adı gerçekten "Satış" ile başlayan paketi KIRPMAZ', () {
      final g = groupOf([acc(id: 'a1', totalAmount: 1000, servicePackageName: 'Satış Danışmanlığı')]);
      expect(buildStatementRows(g, const [], today)[0].label, 'Satış (Satış Danışmanlığı)');
    });

    test('yöntemi kaydedilmemiş tahsilatta uydurma "Nakit" yazmaz', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 1000, servicePackageName: 'X',
          payments: [pay(id: 'p1', amount: 400, method: '', at: '2026-07-01T09:00:00Z')],
        ),
      ]);
      expect(buildStatementRows(g, const [], today)[1].label,
          'Tahsilat (Yöntem Kaydedilmemiş · X)');
    });

    test('satırları kronolojik ARTAN dizer: en yeni hareket EN ALTTA', () {
      final g = groupOf([
        acc(id: 'a1', totalAmount: 1000, soldAtUtc: '2026-06-01T09:00:00Z'),
        acc(id: 'a2', totalAmount: 2000, soldAtUtc: '2026-08-01T09:00:00Z'),
      ]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.map((r) => r.date).toList(), ['2026-06-01', '2026-08-01']);
    });

    test('tarihi olmayan satırı EN ALTA koyar (eskiden belgenin tepesine düşüyordu)', () {
      final g = groupOf([
        acc(id: 'a1', totalAmount: 1000, soldAtUtc: '2026-06-01T09:00:00Z'),
        acc(id: 'a2', totalAmount: 2000, soldAtUtc: ''),
      ]);
      final rows = buildStatementRows(g, const [], today);
      expect(rows.last.date, '');
    });

    test('kullanıcı senaryosu: 30.000 paket satışı → 5.000 tahsilat → bakiye 25.000', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 30000,
          servicePackageId: 'pkg-1', servicePackageName: 'Ela Cilt Bakım Paketi',
          soldAtUtc: '2026-08-12T09:00:00Z',
          payments: [pay(id: 'p1', amount: 5000, at: '2026-09-12T09:00:00Z')],
        ),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: '2026-09-20');

      expect(doc.rows.length, 2);
      expect(doc.rows[0].date, '2026-08-12');
      expect(doc.rows[0].label, 'Paket Satışı (Ela Cilt Bakım Paketi)');
      expect(doc.rows[0].debit, 30000);
      expect(doc.rows[0].balance, 30000);
      expect(doc.rows[1].date, '2026-09-12');
      expect(doc.rows[1].label, 'Tahsilat (Nakit · Ela Cilt Bakım Paketi)');
      expect(doc.rows[1].credit, 5000);
      expect(doc.rows[1].balance, 25000);
      expect(doc.closing, 25000);
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
      // Satış (3.000) ve tahsilat (1.000) ikisi de 18.06 — tamamı devre girer.
      expect(doc.opening, 2000);
      expect(doc.rows.first.type, 'Devir');
      expect(doc.rows.first.balance, 2000);
      expect(doc.closing, 2000);
      expect(doc.netAll, 2000);
    });

    test('dönem sonu süzgeci sonraki hareketleri çıkarır ama netAll korunur', () {
      final g = groupOf([
        acc(
          id: 'a1', totalAmount: 2000, soldAtUtc: '2026-06-18T09:00:00Z',
          payments: [pay(id: 'p1', amount: 500, at: '2026-12-01T09:00:00Z')],
        ),
      ]);
      final doc = buildAccountStatement(group: g, todayIso: today, to: '2026-08-31');
      expect(doc.rows.length, 1); // yalnız satış; aralık dışı tahsilat belgeye girmez
      expect(doc.closing, 2000);
      expect(doc.netAll, 1500);
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
